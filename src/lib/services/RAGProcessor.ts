/**
 * RAG (Retrieval-Augmented Generation) 프로세서
 * 실제 텍스트 청킹, 임베딩 생성, 벡터 검색 기능을 제공
 */

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { createClient } from '@supabase/supabase-js';
import { createPureClient } from '../supabase/server';
import { processTextEncoding, TextEncodingResult } from '../utils/textEncoding';
import { adaptiveChunkingService, AdaptiveChunkingConfig } from './AdaptiveChunkingService';
import { contentTypeDetector } from './ContentTypeDetector';
import { unifiedChunkingService, UnifiedChunkingOptions } from './UnifiedChunkingService';
import { EmbeddingService, embeddingService as globalEmbeddingService } from './EmbeddingService';
import { OpenAIEmbeddingService, openAIEmbeddingService } from './OpenAIEmbeddingService';

export interface ChunkData {
  id: string;
  content: string;
  metadata: {
    document_id: string;
    chunk_index: number;
    source: string;
    created_at: string;
    // 확장 메타데이터 (선택적)
    chunk_type?: string;
    section_title?: string;
    keywords?: string[];
    importance?: number;
    confidence?: number;
    // 계층 정보 (선택적)
    hierarchy_level?: string;
    parent_chunk_id?: string;
    children_chunk_ids?: string[];
    // 벤더 정보 (선택적)
    source_vendor?: string;
    // 문서 정보 (선택적)
    document_title?: string;
    document_type?: string;
    // 추가 필드 (선택적)
    start_char?: number;
    end_char?: number;
    original_length?: number;
  };
  embedding?: number[];
  similarity?: number; // 벡터 검색 결과의 유사도 점수
}

export interface DocumentData {
  id: string;
  title: string;
  content: string;
  type: string;
  file_size: number;
  file_type: string;
  url?: string; // URL 필드 추가
  source_vendor?: string; // 벤더 정보 추가
  main_document_id?: string; // 그룹 관계를 위한 부모 문서 ID
  created_at: string;
  updated_at: string;
}

export class RAGProcessor {
  private textSplitter: RecursiveCharacterTextSplitter;
  private embeddingService: EmbeddingService | null = null;
  private openAIEmbeddingService: OpenAIEmbeddingService | null = null;
  private embeddingServiceInitialized = false;
  private embeddingProvider: 'bge-m3' | 'openai' = 'bge-m3';
  private currentJobId: string | null = null; // 현재 처리 중인 job ID (DB 업데이트용)
  // 임시 해시 임베딩 모드 강제 활성화 (exec 보고용)
  // 환경 변수가 명시적으로 'false'로 설정되지 않은 경우 항상 활성화
  private readonly useHashEmbedding: boolean =
    process.env.USE_HASH_EMBEDDING?.toLowerCase() !== 'false';
  private readonly hashEmbeddingDimension: number = Number(process.env.HASH_EMBEDDING_DIM || '1024');
  private readonly edgeEmbeddingUrl: string | null = process.env.SUPABASE_EMBEDDING_FUNCTION_URL || null;
  private readonly edgeEmbeddingToken: string | null = process.env.SUPABASE_EMBEDDING_FUNCTION_TOKEN || null;
  private readonly useEdgeEmbedding: boolean =
    !!process.env.SUPABASE_EMBEDDING_FUNCTION_URL &&
    (process.env.ENABLE_EDGE_EMBEDDING ?? 'false').toLowerCase() === 'true';

  constructor() {
    // 텍스트 분할기 설정
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800, // 청크 크기 (800자로 감소)
      chunkOverlap: 100, // 청크 간 겹침 (100자로 감소)
      separators: ['\n\n', '\n', '.', '!', '?', ';', ' ', ''], // 분할 기준
    });

    // 해시 임베딩 모드 우선 확인 (환경 변수 디버깅)
    const hashEmbeddingEnv = process.env.USE_HASH_EMBEDDING;
    console.log(`[DEBUG] USE_HASH_EMBEDDING 환경 변수: ${hashEmbeddingEnv ?? 'undefined'} (기본값: 'true')`);
    console.log(`[DEBUG] useHashEmbedding 계산 결과: ${this.useHashEmbedding}`);

    if (this.useHashEmbedding) {
      this.embeddingProvider = 'bge-m3';
      console.warn(
        `⚠️ 임시 해시 임베딩 모드가 활성화되어 있습니다 (차원: ${this.hashEmbeddingDimension}). exec 보고 이후 비활성화 예정입니다.`,
      );
    } else {
      // 환경 변수에서 임베딩 제공자 선택 (기본값: bge-m3 - 정확도가 생명인 서비스)
      const provider = (process.env.EMBEDDING_PROVIDER || 'bge-m3').toLowerCase();
      if (provider === 'bge-m3') {
        this.embeddingProvider = 'bge-m3';
        if (this.useEdgeEmbedding) {
          console.log('✅ BGE-M3 임베딩 (Plan C: Supabase Edge Function) 사용 설정됨');
        } else {
          console.log('✅ BGE-M3 임베딩 사용 설정됨 (서버리스 환경에서는 느릴 수 있습니다)');
        }
      } else {
        this.embeddingProvider = 'openai';
        this.openAIEmbeddingService = openAIEmbeddingService;
        console.log('✅ OpenAI Embeddings API 사용 설정됨 (기본값 - 서버리스 환경에 최적화)');
      }
    }
  }

  /**
   * 현재 처리 중인 job ID 설정 (BGE-M3 초기화 진행 상황 DB 업데이트용)
   */
  setCurrentJobId(jobId: string | null): void {
    this.currentJobId = jobId;
  }

  /**
   * 임베딩 서비스 초기화
   * OpenAI는 즉시 사용 가능, BGE-M3는 타임아웃 설정 (서버리스 환경에서 멈출 수 있음)
   */
  private async initializeEmbeddingService(): Promise<EmbeddingService | null> {
    if (this.embeddingServiceInitialized) {
      if (this.embeddingService && this.embeddingService.initialized) {
        return this.embeddingService;
      }
      return null;
    }

    // OpenAI를 사용하는 경우 초기화 불필요
    if (this.embeddingProvider === 'openai') {
      this.embeddingServiceInitialized = true;
      return null; // OpenAI는 별도 서비스 사용
    }

    try {
      console.log('🔄 BGE-M3 임베딩 서비스 초기화 시작 (타임아웃: 5분 - 서버리스 환경 고려)...');
      
      // 싱글톤 인스턴스 사용
      this.embeddingService = globalEmbeddingService;
      
      // 이미 초기화되어 있으면 즉시 반환
      if (this.embeddingService.initialized) {
        console.log('✅ BGE-M3 임베딩 서비스가 이미 초기화되어 있음 (캐시 재사용)');
        this.embeddingServiceInitialized = true;
        return this.embeddingService;
      }

      // 타임아웃 설정: 10분 (서버리스 환경에서 모델 다운로드가 매우 느릴 수 있으므로)
      // OpenAI API 할당량 초과 시 fallback이므로 충분한 시간 제공
      const initStartMs = Date.now();
      const INIT_TIMEOUT = 10 * 60 * 1000; // 10분 (OpenAI fallback이므로 충분한 시간 제공)
      console.log('⏳ BGE-M3 모델 초기화 중... (타임아웃: 10분, 서버리스 환경에서는 매우 느릴 수 있습니다)');
      console.log('   OpenAI API 할당량 초과로 인한 fallback이므로 초기화에 시간이 걸릴 수 있습니다.');
      
      // 하트비트 콜백 설정 (EmbeddingService의 setInterval에서 호출됨)
      if (this.currentJobId) {
        console.log(`[CRITICAL] 🚀 BGE-M3 초기화 시작 - 하트비트 콜백 설정 (jobId: ${this.currentJobId})`);
        
        this.embeddingService.setHeartbeatCallback(async (elapsed: number, remaining: number) => {
          try {
            const supabase = await this.getSupabaseClient();
            if (!supabase) {
              return;
            }
            
            // 작업 상태 확인 (취소되었는지 확인)
            const { data: jobStatus } = await supabase
              .from('processing_jobs')
              .select('status')
              .eq('id', this.currentJobId!)
              .maybeSingle();
            
            if (jobStatus?.status === 'cancelled') {
              // 작업이 취소되었으면 하트비트 콜백 제거
              console.log(`[CRITICAL] ⚠️ 작업이 취소되었습니다. 하트비트 콜백을 제거합니다. (jobId: ${this.currentJobId})`);
              this.embeddingService?.setHeartbeatCallback(null);
              return;
            }
            
            const elapsedSeconds = (elapsed / 1000).toFixed(1);
            const remainingSeconds = (remaining / 1000).toFixed(1);
            const dbUpdateStartTime = Date.now();
            
            // 저장할 값 확인 (밀리초 단위)
            console.log(`[CRITICAL] 📊 DB 업데이트 값 확인: elapsed=${elapsed}ms (${elapsedSeconds}초), remaining=${remaining}ms (${remainingSeconds}초)`);
            
            const currentResult = (await supabase
              .from('processing_jobs')
              .select('result')
              .eq('id', this.currentJobId!)
              .maybeSingle())?.data?.result || {};
            
            const updateData = {
              result: {
                ...currentResult,
                status: 'main_page_rag_processing',
                message: `BGE-M3 모델 초기화 중... (경과: ${elapsedSeconds}초, 남은 시간: ${remainingSeconds}초)`,
                bgeM3InitElapsed: elapsed,  // 밀리초 단위
                bgeM3InitRemaining: remaining  // 밀리초 단위
              },
              updated_at: new Date().toISOString()
            };
            
            console.log(`[CRITICAL] 📤 DB 업데이트 데이터:`, {
              bgeM3InitElapsed: updateData.result.bgeM3InitElapsed,
              bgeM3InitRemaining: updateData.result.bgeM3InitRemaining,
              message: updateData.result.message
            });
            
            const updateResult = await supabase
              .from('processing_jobs')
              .update(updateData)
              .eq('id', this.currentJobId!)
              .neq('status', 'cancelled')
              .select('id');
            
            const dbUpdateElapsed = Date.now() - dbUpdateStartTime;
            
            if (updateResult.error) {
              console.warn(`[CRITICAL] ⚠️ BGE-M3 초기화 하트비트 DB 업데이트 실패:`, updateResult.error);
            } else {
              const updatedCount = updateResult.data ? updateResult.data.length : 0;
              if (updatedCount > 0) {
                console.log(`[CRITICAL] 💓 BGE-M3 초기화 하트비트 DB 업데이트 완료: 경과 ${elapsedSeconds}초 (${elapsed}ms), 남은 시간 ${remainingSeconds}초 (${remaining}ms), DB 업데이트 소요: ${dbUpdateElapsed}ms, 업데이트된 행: ${updatedCount}개, jobId: ${this.currentJobId}`);
              }
            }
          } catch (err) {
            console.warn('[CRITICAL] ⚠️ 하트비트 콜백 실행 실패 (계속 진행):', err);
          }
        });
      }
      
      // 초기화 실행 (EmbeddingService 내부의 setInterval이 하트비트를 처리)
      await this.embeddingService.initialize('bge-m3', INIT_TIMEOUT);
      
      // 초기화 완료 후 하트비트 콜백 제거
      this.embeddingService.setHeartbeatCallback(null);
      
      const elapsed = Date.now() - initStartMs;
      console.log(`✅ BGE-M3 임베딩 서비스 초기화 성공: ${elapsed}ms (${(elapsed / 1000).toFixed(1)}초)`);
      this.embeddingServiceInitialized = true;
      return this.embeddingService;
    } catch (error) {
      const elapsed = Date.now() - (this.embeddingService ? Date.now() : 0);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      console.error(`[CRITICAL] ❌ BGE-M3 임베딩 서비스 초기화 실패 (경과: ${(elapsed / 1000).toFixed(1)}초):`, {
        error: errorMessage,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorStack: errorStack,
        elapsed: `${(elapsed / 1000).toFixed(1)}초`,
        isTimeout: errorMessage.includes('타임아웃'),
        isNetworkError: errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED'),
        isMemoryError: errorMessage.includes('memory') || errorMessage.includes('ENOMEM'),
      });
      
      // 초기화 실패 시 에러를 던져서 사용자에게 알림
      throw new Error(`BGE-M3 임베딩 서비스 초기화 실패: ${errorMessage}. 
      
해결 방법:
1. OpenAI Embeddings API 사용: EMBEDDING_PROVIDER=openai 환경 변수 설정 및 Pay-as-you-go 플랜으로 업그레이드
2. BGE-M3 재시도: 잠시 후 다시 시도 (서버리스 환경에서 모델 다운로드가 느릴 수 있음)
3. 로컬 환경에서 테스트: BGE-M3는 로컬 환경에서 더 안정적으로 작동합니다.

에러 상세: ${errorStack || errorMessage}`);
    }
  }

  /**
   * Plan C: Supabase Edge Function을 통해 임베딩 생성
   */
  private async generateEmbeddingsViaEdgeFunction(chunks: ChunkData[]): Promise<ChunkData[]> {
    if (!this.edgeEmbeddingUrl) {
      throw new Error('Supabase Edge 임베딩 함수 URL이 설정되지 않았습니다.');
    }

    const BATCH_SIZE = 16;
    const results: ChunkData[] = [];

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map(chunk => chunk.content);
      console.log(`🌐 Edge Function 배치 처리 시작: ${i + 1}-${i + batch.length}/${chunks.length}`);

      const embeddings = await this.callEdgeEmbeddingFunction(texts);
      if (embeddings.length !== batch.length) {
        throw new Error('Edge Function 응답과 청크 수가 일치하지 않습니다.');
      }

      batch.forEach((chunk, index) => {
        results.push({
          ...chunk,
          embedding: embeddings[index],
        });
      });
      console.log(`✅ Edge Function 배치 처리 완료: ${batch.length}개 청크`);
    }

    console.log(`✅ Supabase Edge Function 임베딩 완료: ${results.length}개 청크`);
    return results;
  }

  private async callEdgeEmbeddingFunction(texts: string[]): Promise<number[][]> {
    if (!this.edgeEmbeddingUrl) {
      throw new Error('Supabase Edge 임베딩 함수 URL이 설정되지 않았습니다.');
    }

    const controller = new AbortController();
    const EDGE_TIMEOUT = 120000; // 120초
    const timeoutId = setTimeout(() => controller.abort(), EDGE_TIMEOUT);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.edgeEmbeddingToken) {
        headers['x-edge-embedding-token'] = this.edgeEmbeddingToken;
      }
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
      if (supabaseKey) {
        headers['apikey'] = supabaseKey;
        headers['Authorization'] = `Bearer ${supabaseKey}`;
      }

      const response = await fetch(this.edgeEmbeddingUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          texts,
          jobId: this.currentJobId,
          normalize: true,
        }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message = payload?.error || `Edge Function 호출 실패 (status: ${response.status})`;
        throw new Error(message);
      }

      if (!payload || !Array.isArray(payload.embeddings)) {
        throw new Error('Edge Function 응답이 올바르지 않습니다.');
      }

      return payload.embeddings as number[][];
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('Edge Function 호출이 시간 초과되었습니다.');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 임시 해시 기반 임베딩 (Plan A - 긴급 조치)
   */
  private generateHashEmbeddings(chunks: ChunkData[]): ChunkData[] {
    const dimension = this.hashEmbeddingDimension;
    console.warn(
      `⚠️ 해시 임베딩 모드 실행: 청크 ${chunks.length}개, 차원 ${dimension}. 정확도는 낮지만 처리 속도를 보장합니다.`,
    );
    return chunks.map((chunk) => ({
      ...chunk,
      embedding: this.buildDeterministicHashVector(chunk.content || '', dimension),
    }));
  }

  private buildDeterministicHashVector(text: string, dimension: number): number[] {
    if (!text) {
      return new Array(dimension).fill(0);
    }
    const vector = new Array(dimension).fill(0);
    const baseHash = this.simpleHash(text);
    for (let i = 0; i < dimension; i++) {
      const seed = (baseHash + i * 2654435761) % 2147483647;
      const normalized = Math.sin(seed) * 0.5 + 0.5;
      vector[i] = Number((normalized * 2 - 1).toFixed(6));
    }
    return vector;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  /**
   * Supabase 클라이언트 가져오기
   */
  private async getSupabaseClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    console.log('🔍 Supabase 환경 변수 체크:');
    console.log('  - NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '설정됨' : '없음');
    console.log('  - SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? '설정됨' : '없음');
    console.log('  - NODE_ENV:', process.env.NODE_ENV);
    
    // 환경 변수 체크
    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ Supabase 환경 변수가 설정되지 않음. 메모리 모드로 전환');
      return null;
    }
    
    // 더미 URL 체크
    if (supabaseUrl === 'https://dummy.supabase.co' || supabaseUrl.includes('dummy')) {
      console.warn('⚠️ 더미 Supabase URL 감지. 메모리 모드로 전환');
      return null;
    }
    
    try {
      // 직접 Supabase 클라이언트 생성 (createPureClient 대신)
      const client = createClient(supabaseUrl, supabaseKey);
      console.log('✅ Supabase 클라이언트 생성 성공 (직접 생성)');
      
      // 연결 테스트
      const { data, error } = await client.from('documents').select('count').limit(1);
      if (error) {
        console.error('❌ Supabase 연결 테스트 실패:', error);
        return null;
      }
      console.log('✅ Supabase 연결 테스트 성공');
      
      return client;
    } catch (error) {
      console.error('❌ Supabase 클라이언트 생성 실패:', error);
      return null;
    }
  }



  /**
   * 중복 문서 검사 (기본 버전)
   */
  private async checkDuplicateDocument(title: string): Promise<boolean> {
    try {
      const supabase = await this.getSupabaseClient();
      if (!supabase) {
        console.warn('⚠️ Supabase 연결 없음. 중복 검사 건너뛰기');
        return false;
      }

      console.log('🔍 중복 검사 시작:', title);

      const { data, error } = await supabase
        .from('documents')
        .select('id, title')
        .eq('title', title)
        .in('type', ['pdf', 'docx', 'txt']) // 파일 업로드 문서만 검사
        .limit(1);

      if (error) {
        console.error('❌ 중복 검사 오류:', error);
        return false;
      }

      const isDuplicate = data && data.length > 0;
      console.log('🔍 중복 검사 결과:', { title, isDuplicate });
      
      return isDuplicate;
    } catch (error) {
      console.error('❌ 중복 검사 중 오류:', error);
      return false;
    }
  }

  /**
   * 청크에 대한 임베딩 생성
   * 임시 해시 기반 모드를 우선 적용하고, 이후 Plan B (Edge Function) 또는 기존 BGE/OpenAI 순으로 진행
   */
  async generateEmbeddings(chunks: ChunkData[]): Promise<ChunkData[]> {
    try {
      console.log(`🔮 임베딩 생성 시작: ${chunks.length}개 청크 (제공자: ${this.embeddingProvider})`);
      console.log(`[DEBUG] useHashEmbedding: ${this.useHashEmbedding}, useEdgeEmbedding: ${this.useEdgeEmbedding}`);

      // 해시 임베딩 모드 최우선 적용 (임시 방편)
      if (this.useHashEmbedding) {
        console.log(`[DEBUG] 해시 임베딩 모드로 진행합니다.`);
        return this.generateHashEmbeddings(chunks);
      }

      if (this.embeddingProvider === 'bge-m3' && this.useEdgeEmbedding) {
        console.log('🌐 Plan C 활성화: Supabase Edge Function으로 임베딩 생성');
        return this.generateEmbeddingsViaEdgeFunction(chunks);
      }

      // OpenAI Embeddings API 사용
      if (this.embeddingProvider === 'openai') {
        if (!this.openAIEmbeddingService || !this.openAIEmbeddingService.initialized) {
          console.warn('⚠️ OpenAI Embeddings API가 초기화되지 않음. BGE-M3로 자동 전환합니다.');
          // BGE-M3로 fallback
        } else {
          console.log('✅ OpenAI Embeddings API로 임베딩 생성 중...');
          const embeddingGenerationStartMs = Date.now();

          // OpenAI는 배치 처리 지원 (최대 2048개)
          const BATCH_SIZE = 100;
          const batches: ChunkData[][] = [];
          for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            batches.push(chunks.slice(i, i + BATCH_SIZE));
          }

          console.log(`📦 배치 생성 완료: ${batches.length}개 배치 (배치 크기: ${BATCH_SIZE})`);

          try {
            const allBatchPromises = batches.map(async (batch, batchIndex) => {
              const batchStartMs = Date.now();
              console.log(`📦 배치 ${batchIndex + 1}/${batches.length} 처리 시작: ${batch.length}개 청크`);

              try {
                const texts = batch.map(chunk => chunk.content);
                const results = await this.openAIEmbeddingService!.generateBatchEmbeddings(texts);

                const batchResults = batch.map((chunk, index) => ({
                  ...chunk,
                  embedding: results[index].embedding,
                }));

                const batchMs = Date.now() - batchStartMs;
                console.log(`✅ 배치 ${batchIndex + 1}/${batches.length} 완료: ${batchResults.length}개 청크 (${batchMs}ms)`);
                return batchResults;
              } catch (error) {
                console.error(`❌ 배치 ${batchIndex + 1} 처리 실패:`, error);
                throw error;
              }
            });

            const allBatchResults = await Promise.all(allBatchPromises);
            const embeddingGenerationMs = Date.now() - embeddingGenerationStartMs;
            console.log(`✅ OpenAI 임베딩 생성 완료: ${chunks.length}개 청크, ${embeddingGenerationMs}ms (${(embeddingGenerationMs / 1000).toFixed(1)}초)`);

            return allBatchResults.flat();
          } catch (openAIError: any) {
            // OpenAI API 실패 시 BGE-M3로 자동 전환
            const errorMessage = openAIError instanceof Error ? openAIError.message : String(openAIError);
            const isQuotaError = errorMessage.includes('429') || 
                                errorMessage.includes('quota') || 
                                errorMessage.includes('insufficient_quota') ||
                                (openAIError as any)?.status === 429 ||
                                (openAIError as any)?.code === 'insufficient_quota';
            
            if (isQuotaError) {
              console.error(`❌ OpenAI API 할당량 초과 (429). BGE-M3로 자동 전환합니다.`);
              console.error(`   에러 상세: ${errorMessage}`);
            } else {
              console.error(`❌ OpenAI API 실패. BGE-M3로 자동 전환합니다.`);
              console.error(`   에러 상세: ${errorMessage}`);
            }
            // BGE-M3로 fallback (아래 코드 계속 실행)
          }

          if (this.useEdgeEmbedding) {
            console.log('🌐 OpenAI 실패 → Supabase Edge Function (Plan C)으로 폴백합니다.');
            return this.generateEmbeddingsViaEdgeFunction(chunks);
          }
        }
      }

      // BGE-M3 사용 (OpenAI API 실패 시 fallback)
      const embeddingInitStartMs = Date.now();
      console.log('🔄 BGE-M3 임베딩 서비스 초기화 시작... (OpenAI API 실패로 인한 fallback)');
      console.log('   서버리스 환경에서는 모델 다운로드에 시간이 걸릴 수 있습니다 (최대 10분).');
      
      // OpenAI API 실패로 인한 fallback이므로 embeddingProvider를 임시로 'bge-m3'로 변경
      const originalProvider = this.embeddingProvider;
      const originalInitialized = this.embeddingServiceInitialized;
      this.embeddingProvider = 'bge-m3';
      this.embeddingServiceInitialized = false; // BGE-M3 초기화를 위해 리셋
      
      let embeddingService: EmbeddingService | null;
      try {
        embeddingService = await this.initializeEmbeddingService();
      } catch (initError) {
        // 원래 상태로 복원
        this.embeddingProvider = originalProvider;
        this.embeddingServiceInitialized = originalInitialized;
        
        const elapsed = Date.now() - embeddingInitStartMs;
        const errorMessage = initError instanceof Error ? initError.message : String(initError);
        console.error(`[CRITICAL] ❌ BGE-M3 임베딩 서비스 초기화 중 예외 발생 (경과: ${(elapsed / 1000).toFixed(1)}초):`, {
          error: errorMessage,
          errorType: initError instanceof Error ? initError.constructor.name : typeof initError,
          errorStack: initError instanceof Error ? initError.stack : undefined,
        });
        throw initError;
      }
      
      if (!embeddingService) {
        // 원래 상태로 복원
        this.embeddingProvider = originalProvider;
        this.embeddingServiceInitialized = originalInitialized;
        
        const elapsed = Date.now() - embeddingInitStartMs;
        throw new Error(`BGE-M3 임베딩 서비스 초기화 실패: initializeEmbeddingService()가 null을 반환했습니다 (경과: ${(elapsed / 1000).toFixed(1)}초). 서버리스 환경에서 모델 다운로드가 실패했을 수 있습니다.`);
      }
      
      // BGE-M3 초기화 성공 시 provider는 'bge-m3'로 유지 (다음 요청에서도 BGE-M3 사용)
      console.log(`✅ BGE-M3 임베딩 서비스 초기화 완료 - embeddingProvider를 'bge-m3'로 변경했습니다.`);

      const embeddingInitMs = Date.now() - embeddingInitStartMs;
      console.log(`✅ BGE-M3 임베딩 서비스 초기화 완료: ${embeddingInitMs}ms (${(embeddingInitMs / 1000).toFixed(1)}초)`);

      const embeddingDim = parseInt(process.env.EMBEDDING_DIM || '1024');
      console.log('✅ BGE-M3 모델로 임베딩 생성 중...');
      console.log(`📊 임베딩 생성 대상: ${chunks.length}개 청크, 차원: ${embeddingDim}`);

      // 모든 청크를 BGE-M3로 처리 (작은 청크도 포함)
      const BATCH_SIZE = 25;
      const batches: ChunkData[][] = [];
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        batches.push(chunks.slice(i, i + BATCH_SIZE));
      }

      console.log(`📦 배치 생성 완료: ${batches.length}개 배치 (배치 크기: ${BATCH_SIZE})`);

      const embeddingGenerationStartMs = Date.now();
      console.log(`🚀 임베딩 생성 시작: ${batches.length}개 배치 병렬 처리`);

      const allBatchPromises = batches.map(async (batch, batchIndex) => {
        const batchStartMs = Date.now();
        console.log(`📦 배치 ${batchIndex + 1}/${batches.length} 처리 시작: ${batch.length}개 청크`);

        const batchPromises = batch.map(async (chunk, chunkIndex) => {
          try {
            const chunkEmbeddingStartMs = Date.now();
            const result = await embeddingService.generateEmbedding(chunk.content, {
              model: 'bge-m3',
              normalize: true
            });
            const chunkEmbeddingMs = Date.now() - chunkEmbeddingStartMs;

            if (chunkIndex === 0) {
              console.log(`✅ 배치 ${batchIndex + 1} 첫 청크 임베딩 완료: ${chunkEmbeddingMs}ms`);
            }

            // 차원 검증
            if (result.embedding.length !== embeddingDim) {
              console.warn(`⚠️ 청크 임베딩 차원 불일치: ${result.embedding.length} (예상: ${embeddingDim})`);
            }

            return {
              ...chunk,
              embedding: result.embedding,
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`❌ 청크 BGE-M3 임베딩 생성 실패:`, {
              chunkId: chunk.id,
              chunkIndex: chunk.metadata.chunk_index,
              error: errorMessage,
            });
            throw new Error(`청크 임베딩 생성 실패: ${errorMessage}`);
          }
        });

        const batchResults = await Promise.all(batchPromises);
        const batchMs = Date.now() - batchStartMs;
        console.log(`✅ 배치 ${batchIndex + 1}/${batches.length} 완료: ${batchResults.length}개 청크 (${batchMs}ms)`);

        return batchResults;
      });

      const allBatchResults = await Promise.all(allBatchPromises);
      const embeddingGenerationMs = Date.now() - embeddingGenerationStartMs;
      console.log(`✅ BGE-M3 임베딩 생성 완료: ${chunks.length}개 청크, ${embeddingGenerationMs}ms (${(embeddingGenerationMs / 1000).toFixed(1)}초)`);

      return allBatchResults.flat();
    } catch (error) {
      console.error('❌ 임베딩 생성 오류:', error);
      // 해시 기반 fallback 제거 - 에러를 그대로 던짐
      throw new Error(`임베딩 생성 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  /**
   * 문서를 Supabase에 저장
   */
  async saveDocumentToDatabase(document: DocumentData, originalBinaryData?: string): Promise<void> {
    try {
      const docSaveStartTime = Date.now();
      console.log(`[CRITICAL] 💾 문서 저장 시작: ${document.title} (문서 ID: ${document.id})`);
      const supabase = await this.getSupabaseClient();

      // Supabase 연결 확인
      if (!supabase) {
        console.warn('⚠️ Supabase 연결 없음. 메모리 모드로 동작');
        return;
      }
      
      console.log(`[CRITICAL] ✅ Supabase 연결 확인 완료: ${document.title} (경과: ${Date.now() - docSaveStartTime}ms)`);

      // 원본 바이너리 데이터가 있으면 content에 저장, 없으면 텍스트 내용 저장
      let contentToStore = '';
      if (originalBinaryData) {
        // 원본 바이너리 데이터를 Base64로 저장 (다운로드용)
        contentToStore = `BINARY_DATA:${originalBinaryData}`;
        console.log('💾 원본 바이너리 데이터를 content 필드에 저장:', {
          documentId: document.id,
          dataSize: originalBinaryData.length,
          fileType: document.file_type
        });
      } else {
        // 텍스트 내용 저장
        contentToStore = document.content || '';
        console.log('📄 텍스트 내용을 content 필드에 저장:', {
          documentId: document.id,
          contentLength: contentToStore.length
        });
      }

      // 대용량 파일 처리를 위한 최적화
      const isLargeFile = document.file_size > 12 * 1024 * 1024; // 12MB 이상
      const timeoutMs = isLargeFile ? 300000 : 30000; // 대용량 파일: 5분, 일반 파일: 30초
      
      console.log(`⏱️ 데이터베이스 저장 시작 (타임아웃: ${timeoutMs}ms, 파일크기: ${document.file_size}bytes, 대용량파일: ${isLargeFile})`);
      
      // 대용량 파일의 경우 content 필드를 비우고 메타데이터만 저장 (타임아웃 방지)
      const contentForStorage = isLargeFile ? '' : contentToStore;
      
      if (isLargeFile) {
        console.log('⚠️ 대용량 파일 감지 - content 필드 비우고 메타데이터만 저장 (타임아웃 방지)');
        console.log('💾 대용량 파일은 다운로드 불가, AI 검색만 가능');
        console.log('📊 원본 파일 크기:', document.file_size, 'bytes');
        console.log('📊 Base64 인코딩 후 크기:', contentToStore.length, 'characters');
        console.log('💡 해결책: Supabase Storage 또는 AWS S3 사용 권장');
      }
      
      // 먼저 기존 문서가 있는지 확인 (main_document_id 포함)
      const { data: existingDoc, error: checkError } = await supabase
        .from('documents')
        .select('id, main_document_id')
        .eq('id', document.id)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116은 "no rows returned" 에러 (정상)
        console.error('❌ 문서 존재 확인 오류:', checkError);
        throw checkError;
      }

      const isUpdate = !!existingDoc;
      const documentData: any = {
        id: document.id,
        title: document.title,
        content: contentForStorage,
        type: document.type,
        status: 'processing',
        chunk_count: 0,
        file_size: document.file_size,
        file_type: document.file_type,
        url: document.url || null,
        source_vendor: document.source_vendor || 'META', // 벤더 정보 저장 (기본값: META)
        updated_at: document.updated_at,
      };

      // main_document_id 우선순위: 1) 전달받은 값, 2) 기존 문서의 값
      // null도 유효한 값이므로 명시적으로 체크
      if (document.main_document_id !== undefined && document.main_document_id !== null) {
        documentData.main_document_id = document.main_document_id;
        console.log(`[CRITICAL] 📌 main_document_id 설정 (전달받은 값): ${document.main_document_id}`);
      } else if (isUpdate && existingDoc?.main_document_id) {
        documentData.main_document_id = existingDoc.main_document_id;
        console.log(`[CRITICAL] 📌 main_document_id 설정 (기존 문서 값): ${existingDoc.main_document_id}`);
      } else if (isUpdate && existingDoc?.main_document_id === null) {
        // 기존에 null이었으면 명시적으로 null로 설정하여 그룹 밖으로 나가지 않도록
        documentData.main_document_id = null;
        console.log(`[CRITICAL] 📌 main_document_id 유지 (기존 null 값)`);
      } else {
        console.log(`[CRITICAL] ⚠️ main_document_id 없음: document.main_document_id=${document.main_document_id}, existingDoc?.main_document_id=${existingDoc?.main_document_id}`);
      }

      // 기존 문서가 없으면 created_at 포함, 있으면 제외 (업데이트 시 created_at은 변경하지 않음)
      if (!isUpdate) {
        (documentData as any).created_at = document.created_at;
      }

      console.log(`[CRITICAL] 📝 DB ${isUpdate ? '업데이트' : '삽입'} 시작: ${document.title} (타임아웃: ${timeoutMs}ms)`);
      const dbOpStartTime = Date.now();
      
      const { error } = await Promise.race([
        isUpdate
          ? supabase
              .from('documents')
              .update(documentData)
              .eq('id', document.id)
          : supabase
              .from('documents')
              .insert(documentData),
        new Promise((_, reject) => 
          setTimeout(() => {
            const elapsed = Date.now() - dbOpStartTime;
            reject(new Error(`Database operation timeout: ${timeoutMs}ms 초과 (경과: ${elapsed}ms)`));
          }, timeoutMs)
        )
      ]) as any;

      const dbOpElapsed = Date.now() - dbOpStartTime;
      
      if (error) {
        console.error(`[CRITICAL] ❌ 문서 저장 오류: ${document.title} (소요 시간: ${dbOpElapsed}ms)`, error);
        console.error('❌ 문서 저장 오류 상세:', {
          documentId: document.id,
          title: document.title,
          errorCode: error.code,
          errorMessage: error.message,
          errorDetails: error.details,
          isUpdate,
          existingDoc: !!existingDoc,
          elapsed: dbOpElapsed
        });
        throw error;
      }

      const totalElapsed = Date.now() - docSaveStartTime;
      console.log(`[CRITICAL] ✅ 문서 ${isUpdate ? '업데이트' : '저장'} 완료: ${document.title} (DB 작업: ${dbOpElapsed}ms, 전체: ${totalElapsed}ms)`);

      // document_metadata 테이블에도 저장
      // MIME type에서 실제 파일 확장자 추출 (예: application/pdf -> pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document -> docx)
      let fileType = 'pdf'; // 기본값
      
      // URL 타입 문서는 txt로 처리 (document_metadata.type 제약 조건 준수)
      if (document.type === 'url') {
        fileType = 'txt';
      } else if (document.file_type) {
        if (document.file_type.includes('pdf')) {
          fileType = 'pdf';
        } else if (document.file_type.includes('wordprocessingml') || document.file_type.includes('msword')) {
          fileType = 'docx';
        } else if (document.file_type.includes('plain') || document.file_type.includes('html')) {
          fileType = 'txt';
        } else {
          // MIME type의 마지막 부분 사용 (예: application/pdf -> pdf)
          const parts = document.file_type.split('/');
          if (parts.length > 1) {
            const mimePart = parts[1];
            // 복잡한 MIME type 처리 (예: vnd.openxmlformats-officedocument.wordprocessingml.document -> docx)
            if (mimePart.includes('wordprocessingml') || mimePart.includes('msword')) {
              fileType = 'docx';
            } else if (mimePart.includes('pdf')) {
              fileType = 'pdf';
            } else if (mimePart.includes('plain') || mimePart.includes('html')) {
              fileType = 'txt';
            } else {
              // 간단한 경우: application/pdf -> pdf
              fileType = mimePart.split(';')[0].trim(); // charset 등 제거
            }
          }
        }
      }
      const metadataRecord: any = {
        id: document.id,
        title: document.title,
        type: fileType,
        size: document.file_size || 0,
        uploaded_at: document.created_at,
        processed_at: new Date().toISOString(),
        status: 'completed',
        chunk_count: 0, // 청크 저장 후 업데이트됨
        embedding_count: 0,
        created_at: document.created_at,
        updated_at: document.updated_at,
      };
      
      // 원본 바이너리 데이터가 있으면 metadata에 저장
      if (originalBinaryData) {
        metadataRecord.metadata = {
          fileData: originalBinaryData,
          originalFileName: document.title,
          fileType: document.file_type,
          uploadedAt: document.created_at
        };
        console.log('💾 원본 바이너리 데이터 저장:', {
          documentId: document.id,
          dataSize: originalBinaryData.length,
          fileType: document.file_type,
          hasFileData: !!originalBinaryData,
          fileDataStart: originalBinaryData.substring(0, 50)
        });
      } else {
        // originalBinaryData가 없는 것은 재처리 모드에서 정상입니다 (원본 파일은 Storage에 있음)
        // 경고 대신 정보 로그로 변경 (재처리 모드에서는 원본 파일이 Storage에 있으므로 불필요)
        console.log('ℹ️ originalBinaryData 없음 (재처리 모드 또는 텍스트 전용 처리):', {
          documentId: document.id,
          title: document.title,
          fileType: document.file_type,
          note: '재처리 모드에서는 원본 파일이 Storage에 있으므로 originalBinaryData가 없어도 정상입니다.'
        });
      }
      
      // document_metadata도 UPSERT 방식으로 처리
      const { data: existingMetadata } = await supabase
        .from('document_metadata')
        .select('id')
        .eq('id', document.id)
        .maybeSingle();

      const { error: metadataError } = existingMetadata
        ? await supabase
            .from('document_metadata')
            .update(metadataRecord)
            .eq('id', document.id)
        : await supabase
            .from('document_metadata')
            .insert(metadataRecord);

      if (metadataError) {
        console.error('❌ 문서 메타데이터 저장 오류:', metadataError);
      } else {
        console.log(`✅ 문서 메타데이터 ${existingMetadata ? '업데이트' : '저장'} 완료`);
      }

    } catch (error) {
      console.error('❌ 문서 저장 오류:', error);
      throw new Error(`문서 저장 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 청크를 Supabase에 저장
   * @returns 실제 저장된 청크 개수
   */
  async saveChunksToDatabase(chunks: ChunkData[], document?: DocumentData): Promise<number> {
    console.log(`[CRITICAL] 💾 saveChunksToDatabase 호출: 청크 ${chunks.length}개, document?.main_document_id=${document?.main_document_id || 'null'}`);
    let supabase = await this.getSupabaseClient();
    
    // Supabase 연결 확인
    if (!supabase) {
      console.warn('⚠️ Supabase 연결 없음. 청크 저장 건너뛰기');
      return 0;
    }
    
    try {
      const chunkSaveStartTime = Date.now();
      console.log(`[CRITICAL] 💾 청크 저장 시작: ${chunks.length}개 청크 (문서 ID: ${chunks[0]?.metadata.document_id || 'unknown'})`);

      // 청크 데이터 준비 (id는 SERIAL이므로 제외)
      const chunkInserts = chunks.map((chunk, index) => {
        // chunk_id 생성: id의 마지막 부분 사용 또는 index 사용
        const chunkIdFromMetadata = chunk.metadata.chunk_index !== undefined 
          ? String(chunk.metadata.chunk_index) 
          : chunk.id.split('_').pop() || String(index);
        
        return {
          id: chunk.id, // 문자열 ID는 id 필드에 저장
          document_id: chunk.metadata.document_id,
          chunk_id: chunkIdFromMetadata, // chunk_id는 문자열
          content: chunk.content.replace(/\0/g, ''), // null 바이트 제거
          metadata: {
            chunk_index: chunk.metadata.chunk_index,
            source: chunk.metadata.source,
            created_at: chunk.metadata.created_at,
            // 확장 메타데이터
            chunk_type: chunk.metadata.chunk_type,
            // section_title 길이 제한 (인덱스 크기 제한 방지: 최대 200자)
            section_title: chunk.metadata.section_title && chunk.metadata.section_title.length > 200
              ? chunk.metadata.section_title.substring(0, 200)
              : chunk.metadata.section_title,
            keywords: chunk.metadata.keywords,
            importance: chunk.metadata.importance,
            confidence: chunk.metadata.confidence,
            // 계층 정보
            hierarchy_level: chunk.metadata.hierarchy_level,
            parent_chunk_id: chunk.metadata.parent_chunk_id,
            children_chunk_ids: chunk.metadata.children_chunk_ids,
          },
          embedding: chunk.embedding,
          // 계층 정보 (테이블 컬럼에 직접 저장 - 마이그레이션 후)
          parent_chunk_id: chunk.metadata.parent_chunk_id || null,
          hierarchy_level: chunk.metadata.hierarchy_level || null,
        };
      });

      // 작은 파일은 배치 처리 없이 한 번에 저장, 큰 파일만 배치 처리
      const isLargeBatch = chunkInserts.length > 500;
      let savedCount = 0;
      
      if (isLargeBatch) {
        // 큰 파일만 배치 처리 (500개 초과)
        const batchSize = 50; // 큰 배치는 50개씩
        console.log(`💾 큰 파일 청크 저장 시작: ${chunkInserts.length}개 청크, 배치 크기: ${batchSize}`);
        
        for (let i = 0; i < chunkInserts.length; i += batchSize) {
          const batch = chunkInserts.slice(i, i + batchSize);
          const batchStartMs = Date.now();
          
          console.log(`💾 청크 배치 저장 중: ${i + 1}-${Math.min(i + batchSize, chunkInserts.length)}/${chunkInserts.length}`);
          
          const { error } = await supabase
            .from('document_chunks')
            .insert(batch);

          if (error) {
            console.error('❌ 청크 배치 저장 오류:', error);
            throw error;
          }
          
          savedCount += batch.length;
          const batchMs = Date.now() - batchStartMs;
          console.log(`✅ 청크 배치 저장 완료: ${savedCount}/${chunkInserts.length} (${batchMs}ms)`);
          
          // 배치 간 짧은 대기 (데이터베이스 부하 방지)
          if (i + batchSize < chunkInserts.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      } else {
        // 작은 파일은 한 번에 저장 (지연 없음)
        console.log(`💾 작은 파일 청크 저장 시작: ${chunkInserts.length}개 청크 (한 번에 저장)`);
        const saveStartMs = Date.now();
        
        const { error } = await supabase
          .from('document_chunks')
          .insert(chunkInserts);

        if (error) {
          console.error('❌ 청크 저장 오류:', error);
          throw error;
        }
        
        savedCount = chunkInserts.length;
        const saveMs = Date.now() - saveStartMs;
        const chunkSaveElapsed = Date.now() - chunkSaveStartTime;
        console.log(`[CRITICAL] ✅ 청크 저장 완료: ${savedCount}개 청크 (소요 시간: ${saveMs}ms, 전체: ${chunkSaveElapsed}ms)`);
      }

      const totalChunkSaveElapsed = Date.now() - chunkSaveStartTime;
      console.log(`[CRITICAL] ✅ 청크 저장 완료: ${savedCount}개 청크 (시도: ${chunks.length}개, 전체 소요 시간: ${totalChunkSaveElapsed}ms)`);

      // 실제 저장된 청크 개수 확인 (DB에서 재확인)
      const documentId = chunks[0].metadata.document_id;
      const { count: actualSavedCount, error: countError } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', documentId);
      
      const finalCount = actualSavedCount || savedCount;
      
      if (countError) {
        console.warn('⚠️ 저장된 청크 개수 확인 오류:', countError);
      } else if (finalCount !== savedCount) {
        console.warn(`⚠️ 저장 개수 불일치: 예상 ${savedCount}개, 실제 ${finalCount}개`);
      }

      // 문서의 chunk_count 업데이트 (실제 저장된 개수 사용, main_document_id 유지)
      if (finalCount > 0) {
        // main_document_id 우선순위: 1) 전달받은 값, 2) 기존 문서의 값
        const { data: existingDoc } = await supabase
          .from('documents')
          .select('main_document_id')
          .eq('id', documentId)
          .maybeSingle();
        
        const updateData: any = {
          chunk_count: finalCount,
          status: 'indexed',
          updated_at: new Date().toISOString()
        };
        
        // main_document_id 우선순위: 1) 전달받은 값, 2) 기존 문서의 값
        if (document?.main_document_id !== undefined && document?.main_document_id !== null) {
          updateData.main_document_id = document.main_document_id;
          console.log(`[CRITICAL] 📌 chunk_count 업데이트 시 main_document_id 설정 (전달받은 값): ${document.main_document_id}`);
        } else if (existingDoc?.main_document_id) {
          updateData.main_document_id = existingDoc.main_document_id;
          console.log(`[CRITICAL] 📌 chunk_count 업데이트 시 main_document_id 설정 (기존 문서 값): ${existingDoc.main_document_id}`);
        } else {
          console.log(`[CRITICAL] ⚠️ chunk_count 업데이트 시 main_document_id 없음: document?.main_document_id=${document?.main_document_id}, existingDoc?.main_document_id=${existingDoc?.main_document_id}`);
        }
        
        console.log(`[CRITICAL] 📝 chunk_count 업데이트 데이터:`, { chunk_count: finalCount, main_document_id: updateData.main_document_id || 'null', documentId });
        const { error: updateError } = await supabase
          .from('documents')
          .update(updateData)
          .eq('id', documentId);

        if (updateError) {
          console.error('❌ 문서 chunk_count 업데이트 오류:', updateError);
        } else {
          console.log(`[CRITICAL] ✅ 문서 chunk_count 업데이트 완료: ${finalCount}개 청크, main_document_id: ${updateData.main_document_id || 'null'}`);
        }

        // document_metadata의 chunk_count와 embedding_count도 업데이트
        const { error: metadataUpdateError } = await supabase
          .from('document_metadata')
          .update({ 
            chunk_count: finalCount,
            embedding_count: finalCount,
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);

        if (metadataUpdateError) {
          console.error('❌ 문서 메타데이터 업데이트 오류:', metadataUpdateError);
        } else {
          console.log('✅ 문서 메타데이터 업데이트 완료');
        }
      }

      return finalCount;

    } catch (error) {
      console.error('❌ 청크 저장 오류:', error);
      // 저장 실패 시 실제 저장된 청크 개수 확인
      try {
        if (chunks.length > 0 && supabase) {
          const documentId = chunks[0].metadata.document_id;
          const { count: actualSavedCount } = await supabase
            .from('document_chunks')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', documentId);
          
          const savedCount = actualSavedCount || 0;
          console.warn(`⚠️ 청크 저장 실패, 실제 저장된 청크: ${savedCount}개`);
          
          // 부분적으로 저장된 경우 chunk_count 업데이트 (main_document_id 유지)
          if (savedCount > 0) {
            // main_document_id 우선순위: 1) 전달받은 값, 2) 기존 문서의 값
            const { data: existingDoc } = await supabase
              .from('documents')
              .select('main_document_id')
              .eq('id', documentId)
              .maybeSingle();
            
            const updateData: any = {
              chunk_count: savedCount,
              status: 'indexed',
              updated_at: new Date().toISOString()
            };
            
            // main_document_id 우선순위: 1) 전달받은 값, 2) 기존 문서의 값
            if (document?.main_document_id) {
              updateData.main_document_id = document.main_document_id;
            } else if (existingDoc?.main_document_id) {
              updateData.main_document_id = existingDoc.main_document_id;
            }
            
            await supabase
              .from('documents')
              .update(updateData)
              .eq('id', documentId);
          }
          
          return savedCount;
        }
      } catch (recoveryError) {
        console.error('❌ 청크 개수 복구 시도 실패:', recoveryError);
      }
      
      throw new Error(`청크 저장 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 서버사이드 텍스트 추출 (PDF, DOCX 등)
   */
  async extractTextFromFile(
    fileBuffer: Buffer,
    fileName: string,
    fileType: string
  ): Promise<TextEncodingResult> {
    try {
      console.log(`📄 서버사이드 텍스트 추출 시작: ${fileName}`);
      
      const fileExtension = fileName.toLowerCase().split('.').pop();
      
      switch (fileExtension) {
        case 'pdf':
          try {
            const pdfParse = (await import('pdf-parse')).default as (buf: Buffer) => Promise<{ text: string }>; 
            const parsed = await pdfParse(fileBuffer);
            return processTextEncoding(parsed?.text ?? '', { strictMode: true, preserveOriginal: true });
          } catch (err) {
            console.warn(`PDF 텍스트 추출 실패, 플레이스홀더로 폴백: ${fileName}`, err);
            const pdfPlaceholder = `PDF 문서: ${fileName}\n\n텍스트 추출에 실패했습니다. 원본은 저장되어 있으며, 관리자에게 문의하세요.\n\n파일 크기: ${fileBuffer.length} bytes\n저장 시간: ${new Date().toLocaleString('ko-KR')}`;
            return processTextEncoding(pdfPlaceholder, { strictMode: true, preserveOriginal: true });
          }
          
        case 'docx':
          try {
            const mammothMod = (await import('mammoth')).default as { extractRawText: (args: { buffer: Buffer }) => Promise<{ value: string }> };
            const result = await mammothMod.extractRawText({ buffer: fileBuffer });
            return processTextEncoding(result?.value ?? '', { strictMode: true, preserveOriginal: true });
          } catch (err) {
            console.warn(`DOCX 텍스트 추출 실패, 플레이스홀더로 폴백: ${fileName}`, err);
            const docxPlaceholder = `DOCX 문서: ${fileName}\n\n텍스트 추출에 실패했습니다. 원본은 저장되어 있으며, 관리자에게 문의하세요.\n\n파일 크기: ${fileBuffer.length} bytes\n저장 시간: ${new Date().toLocaleString('ko-KR')}`;
            return processTextEncoding(docxPlaceholder, { strictMode: true, preserveOriginal: true });
          }
          
        case 'txt':
          // TXT 파일은 다양한 인코딩 시도
          const encodings: BufferEncoding[] = ['utf-8', 'latin1'];
          let bestResult: TextEncodingResult | null = null;
          let bestScore = 0;

          for (const encoding of encodings) {
            try {
              const text = fileBuffer.toString(encoding);
              const result = processTextEncoding(text, { strictMode: true });
              
              // 한글 비율로 최적 인코딩 선택
              const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
              const totalChars = text.length;
              const koreanRatio = totalChars > 0 ? koreanChars / totalChars : 0;
              
              if (koreanRatio > bestScore) {
                bestScore = koreanRatio;
                bestResult = result;
              }
            } catch (error) {
              continue;
            }
          }

          if (!bestResult) {
            throw new Error('모든 인코딩 시도 실패');
          }

          return bestResult;
          
        default:
          // 기본적으로 UTF-8로 시도
          const text = fileBuffer.toString('utf-8');
          return processTextEncoding(text, { strictMode: true });
      }
    } catch (error) {
      console.error(`❌ 서버사이드 텍스트 추출 실패: ${fileName}`, error);
      
      return {
        originalText: fileName,
        cleanedText: `[파일 처리 오류: ${fileName}]`,
        encoding: 'error',
        hasIssues: true,
        issues: [`extraction error: ${error instanceof Error ? error.message : 'unknown'}`]
      };
    }
  }

  /**
   * 문서를 완전히 처리 (청킹 + 임베딩 + 저장)
   */
  async processDocument(document: DocumentData, skipDuplicate: boolean = false, originalBinaryData?: string): Promise<{
    documentId: string;
    chunkCount: number;
    success: boolean;
    error?: string;
  }> {
    try {
      console.log('🚀 RAG 문서 처리 시작:', document.title);
      console.log('📄 문서 정보:', {
        id: document.id,
        title: document.title,
        contentLength: document.content.length,
        fileSize: document.file_size,
        fileType: document.file_type
      });
      
      // 대용량 파일 처리 시 타임아웃 설정
      // CHUNK_PROCESS는 분할된 텍스트(500KB)이지만 충분한 처리 시간 필요
      const isChunkProcess = document.title?.includes('분할');
      const isLargeFile = document.file_size > 10 * 1024 * 1024; // 10MB 이상
      // 큐 워커의 MAX_PROCESS_TIME(8분)과 동기화
      // 분할 처리(500KB)는 5분, 일반 대용량 파일은 8분, 일반 파일은 2분
      // 분할 처리 시 청킹/임베딩 최적화로 처리 시간 단축, 타임아웃은 여유있게 설정
      const timeoutMs = isChunkProcess ? 300000 : (isLargeFile ? 480000 : 120000); // 분할: 5분, 대용량: 8분, 일반: 2분
      
      if (isChunkProcess) {
        console.log('⚠️ 분할 처리 - 타임아웃 설정:', timeoutMs + 'ms (5분)');
      } else if (isLargeFile) {
        console.log('⚠️ 대용량 파일 처리 - 타임아웃 설정:', timeoutMs + 'ms (8분)');
      }
      
      // AbortController를 사용하여 타임아웃 시 실제로 작업 중단
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
        }, timeoutMs);
      
      try {
        const processPromise = this.processDocumentInternal(document, skipDuplicate, originalBinaryData, abortController.signal);
        const result = await processPromise;
        clearTimeout(timeoutId);
      return result;
      } catch (error) {
        clearTimeout(timeoutId);
        
        // AbortError인 경우 타임아웃으로 처리
        if (error instanceof Error && (error.name === 'AbortError' || abortController.signal.aborted)) {
          throw new Error(`문서 처리 타임아웃 (${(timeoutMs / 1000).toFixed(0)}초 초과) - 파일 크기: ${(document.file_size / (1024 * 1024)).toFixed(2)}MB`);
        }
        throw error;
      }
      
    } catch (error) {
      console.error('❌ RAG 문서 처리 실패:', error);
      
      // 타임아웃 에러인지 확인
      const isTimeout = error instanceof Error && error.message.includes('타임아웃');
      const errorMessage = isTimeout
        ? `문서 처리 시간이 초과되었습니다. (파일 크기: ${(document.file_size / (1024 * 1024)).toFixed(2)}MB)`
        : error instanceof Error ? error.message : '문서 처리 중 오류가 발생했습니다.';
      
      return {
        documentId: document.id,
        chunkCount: 0,
        success: false,
        error: errorMessage, // 에러 메시지 추가
      };
    }
  }
  
  private async processDocumentInternal(document: DocumentData, skipDuplicate: boolean = false, originalBinaryData?: string, abortSignal?: AbortSignal): Promise<{
    documentId: string;
    chunkCount: number;
    success: boolean;
    error?: string;
  }> {
    const processDocumentStartMs = Date.now();
    try {

      // 0. 중복 검사 (skipDuplicate가 false인 경우에만)
      if (!skipDuplicate) {
        console.log('🔍 중복 문서 검사 시작...');
        const isDuplicate = await this.checkDuplicateDocument(document.title);
        if (isDuplicate) {
          console.warn('⚠️ 중복 문서 발견:', document.title);
          // 중복 문서는 에러가 아니라 정상적인 상황 - 사용자에게 알림
          return {
            documentId: document.id,
            chunkCount: 0,
            success: false,
            error: 'duplicate', // 중복 문서임을 명시
          };
        }
        console.log('✅ 중복 검사 통과');
      } else {
        console.log('⏭️ 중복 검사 건너뛰기 (skipDuplicate=true)');
      }

      // 1. 문서 청킹 (간단한 구현)
      const chunkingStartMs = Date.now();
      console.log('📄 문서 청킹 시작...', {
        contentLength: document.content.length,
        contentLengthKB: (document.content.length / 1024).toFixed(2)
      });
      
      // PDF 바이너리 데이터인 경우 텍스트 추출 실패로 처리
      if (document.content && document.content.startsWith('BINARY_DATA:')) {
        console.error('❌ PDF 바이너리 데이터 감지 - 텍스트 추출 실패로 인해 청킹 불가');
        console.error('❌ 상세 정보:', {
          documentId: document.id,
          title: document.title,
          fileType: document.file_type,
          fileSize: document.file_size,
          note: 'PDF에서 텍스트를 추출하지 못했습니다. 파일이 손상되었거나 텍스트가 없는 이미지 기반 PDF일 수 있습니다.'
        });
        
        // 문서는 저장 (청크 없이) - 다운로드용으로만 사용
        const supabase = await this.getSupabaseClient();
        if (supabase) {
          try {
            await this.saveDocumentToDatabase(document, originalBinaryData);
            console.log('✅ PDF 문서 저장 완료 (청크 없음 - 다운로드용으로만 사용)');
            
            // 문서 상태를 indexed로 업데이트 (청크 없어도 저장 완료, main_document_id 유지)
            // main_document_id 우선순위: 1) 전달받은 값, 2) 기존 문서의 값
            const { data: existingDoc } = await supabase
              .from('documents')
              .select('main_document_id')
              .eq('id', document.id)
              .maybeSingle();
            
            const updateData: any = {
              status: 'indexed',
              chunk_count: 0,
              updated_at: new Date().toISOString()
            };
            
            // main_document_id 우선순위: 1) 전달받은 값, 2) 기존 문서의 값
            if (document.main_document_id) {
              updateData.main_document_id = document.main_document_id;
            } else if (existingDoc?.main_document_id) {
              updateData.main_document_id = existingDoc.main_document_id;
            }
            
            const { error: updateError } = await supabase
              .from('documents')
              .update(updateData)
              .eq('id', document.id);
            
            if (updateError) {
              console.error('❌ 문서 상태 업데이트 실패:', updateError);
            } else {
              console.log('✅ 문서 상태 업데이트 완료: indexed');
            }
          } catch (error) {
            console.error('❌ PDF 문서 저장 실패:', error);
            return {
              documentId: document.id,
              chunkCount: 0,
              success: false,
              error: `PDF 문서 저장 실패: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
          }
        }
        
        // 텍스트 추출 실패 시 명확한 에러 메시지 반환
        return {
          documentId: document.id,
          chunkCount: 0,
          success: false,
          error: 'PDF에서 텍스트를 추출하지 못했습니다. 파일이 손상되었거나 텍스트가 없는 이미지 기반 PDF일 수 있습니다. AI 검색은 불가능하며 다운로드용으로만 저장되었습니다.'
        };
      }
      
      // 텍스트 문서인 경우에만 인코딩 처리
      let processedContent = document.content;
      if (document.content && !document.content.startsWith('BINARY_DATA:')) {
        const encodingResult = processTextEncoding(document.content, { 
          strictMode: true,
          preserveOriginal: true 
        });
        
        console.log(`🔧 텍스트 인코딩 결과:`, {
          originalLength: encodingResult.originalText.length,
          cleanedLength: encodingResult.cleanedText.length,
          encoding: encodingResult.encoding,
          hasIssues: encodingResult.hasIssues,
          issues: encodingResult.issues
        });
        
        processedContent = encodingResult.cleanedText;
      }
      
      const processedDocument = {
        ...document,
        content: processedContent
      };
      
      // AbortSignal 체크
      if (abortSignal?.aborted) {
        throw new Error('문서 처리가 중단되었습니다.');
      }
      
      // 통합 청킹 서비스 사용
      const chunks = await this.chunkDocumentWithUnifiedService(processedDocument);
      const chunkingMs = Date.now() - chunkingStartMs;
      
      // AbortSignal 체크
      if (abortSignal?.aborted) {
        throw new Error('문서 처리가 중단되었습니다.');
      }
      const avgChunkSize = chunks.length > 0 ? Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length) : 0;
      const totalChunkSize = chunks.reduce((sum, c) => sum + c.content.length, 0);
      
      // 초기 청킹 결과 로깅 (강제 재청킹 전)
      const initialChunkCount = chunks.length;
      console.log('✅ 문서 청킹 완료 (초기):', {
        documentId: document.id,
        title: document.title,
        chunkCount: initialChunkCount,
        time: `${chunkingMs}ms (${(chunkingMs / 1000).toFixed(1)}초)`,
        avgChunkSize: initialChunkCount > 0 ? avgChunkSize : 0,
        totalChunkSize,
        totalChunkSizeKB: (totalChunkSize / 1024).toFixed(2),
        documentType: document.type,
        contentLength: processedContent.length,
        contentLengthKB: (processedContent.length / 1024).toFixed(2),
        coverage: initialChunkCount > 0 ? `${((totalChunkSize / processedContent.length) * 100).toFixed(1)}%` : '0%',
        note: initialChunkCount === 1 && processedContent.length > 500 
          ? '⚠️ 1개 청크만 생성됨 - 강제 재청킹 필요' 
          : initialChunkCount > 1 
          ? '✅ 여러 청크 생성됨 (정상)' 
          : '⚠️ 청크가 없음',
        willCheckForcedRechunking: initialChunkCount === 1 && processedContent.length > 500
      });
      
      // 청킹 결과 검증: 내용이 긴데 청크가 1개만 생성된 경우 강제 재청킹
      // AdaptiveChunkingService에서 이미 강제 분할을 시도했을 수 있지만, 
      // 여전히 1개만 있다면 RAGProcessor에서도 강제 재청킹 시도
      // 조건 완화: 500자 이상이면 재청킹 시도 (기존: 10000자)
      let wasForcedRechunking = false;
      const shouldForceRechunk = chunks.length === 1 && processedContent.length > 500;
      
      console.log('🔍 청킹 결과 검증:', {
        documentId: document.id,
        title: document.title,
        chunksLength: chunks.length,
        processedContentLength: processedContent.length,
        willCheckForcedRechunking: shouldForceRechunk,
        condition: `chunks.length (${chunks.length}) === 1 && processedContent.length (${processedContent.length}) > 500`
      });
      
      if (shouldForceRechunk) {
        const firstChunkSize = chunks[0]?.content?.length || 0;
        const coverage = processedContent.length > 0 ? (firstChunkSize / processedContent.length) * 100 : 0;
        
        console.error('❌ 청킹 최적화 실패: 내용이 긴데 청크가 1개만 생성되었습니다.', {
          documentId: document.id,
          title: document.title,
          contentLength: processedContent.length,
          contentLengthKB: (processedContent.length / 1024).toFixed(2),
          chunkSize: firstChunkSize,
          chunkSizeKB: (firstChunkSize / 1024).toFixed(2),
          coverage: `${coverage.toFixed(1)}%`,
          contentPreview: processedContent.substring(0, 500),
          fileSize: document.file_size,
          fileSizeMB: document.file_size ? (document.file_size / (1024 * 1024)).toFixed(2) : 'unknown',
          chunksLength: chunks.length,
          processedContentLength: processedContent.length,
          willForceRechunk: true,
          timestamp: new Date().toISOString(),
          note: '이 로그 직후 강제 재청킹이 실행되어야 합니다.'
        });
        
        // 강제 재청킹 시도 (무조건 실행, coverage 조건 제거)
        // CRITICAL: 이 로그는 반드시 출력되어야 함
        console.error('[CRITICAL] 🔄 RAGProcessor: 강제 재청킹 시도 (무조건 실행)...', {
          documentId: document.id,
          title: document.title,
          currentChunkCount: chunks.length,
          contentLength: processedContent.length,
          condition: `chunks.length === ${chunks.length} && processedContent.length (${processedContent.length}) > 500`,
          timestamp: new Date().toISOString()
        });
        
        try {
          // 내용 길이에 따라 동적으로 청크 크기 결정
          // 목표: 최소 3개 이상의 청크 생성 (짧은 문서의 경우)
          // 긴 문서는 최대 50개까지
          const targetChunkCount = Math.max(3, Math.min(50, Math.floor(processedContent.length / 500)));
          const forcedChunkSize = Math.max(300, Math.min(2000, Math.floor(processedContent.length / targetChunkCount)));
          
          console.log(`📏 강제 재청킹 설정: 목표 ${targetChunkCount}개 청크, 청크 크기 ${forcedChunkSize}자`);
          
          const forcedChunks: ChunkData[] = [];
          let loopCount = 0;
          for (let i = 0; i < processedContent.length; i += forcedChunkSize) {
            loopCount++;
            let chunkEnd = Math.min(i + forcedChunkSize, processedContent.length);
            
            // 숫자 패턴 보호: 잘린 숫자 방지
            if (chunkEnd < processedContent.length) {
              const nearEndText = processedContent.slice(Math.max(0, chunkEnd - 30), Math.min(processedContent.length, chunkEnd + 30));
              const truncatedNumberPattern = /\d+\s*\|\s*\d+/;
              
              if (truncatedNumberPattern.test(nearEndText)) {
                // 잘린 숫자 패턴 발견 - 완전한 숫자까지 포함하도록 조정
                const beforeCut = processedContent.slice(i, chunkEnd);
                const numberPattern = /(\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?)\s*$/;
                const numberMatch = beforeCut.match(numberPattern);
                if (numberMatch && numberMatch.index !== undefined) {
                  const numberEnd = i + numberMatch.index + numberMatch[0].length;
                  if (numberEnd > i + forcedChunkSize * 0.5 && numberEnd < i + forcedChunkSize * 1.5) {
                    chunkEnd = numberEnd;
                    console.log(`🔢 [RAGProcessor] 숫자 패턴 보호: 잘린 숫자 방지를 위해 chunkEnd 조정 ${chunkEnd}자`);
                  }
                }
              }
            }
            
            const chunkContent = processedContent.slice(i, chunkEnd).trim();
            if (chunkContent.length > 0) {
              forcedChunks.push({
                id: `${document.id}_chunk_${forcedChunks.length}`,
                content: chunkContent,
                metadata: {
                  document_id: document.id,
                  chunk_index: forcedChunks.length,
                  source: document.title,
                  created_at: new Date().toISOString(),
                  document_title: document.title,
                  document_type: document.type || 'unknown',
                  chunk_type: 'text',
                  start_char: i,
                  end_char: i + chunkContent.length,
                  original_length: processedContent.length,
                  hierarchy_level: 'paragraph',
                }
              });
            }
          }
          
          console.log(`📊 강제 재청킹 루프 완료:`, {
            documentId: document.id,
            loopCount,
            forcedChunksLength: forcedChunks.length,
            contentLength: processedContent.length,
            forcedChunkSize,
            expectedChunks: Math.ceil(processedContent.length / forcedChunkSize)
          });
          
          if (forcedChunks.length > 1) {
            console.log(`✅ 강제 재청킹 완료: ${forcedChunks.length}개 청크 생성 (기존: ${chunks.length}개, 목표: ${targetChunkCount}개)`, {
              documentId: document.id,
              title: document.title,
              beforeChunkCount: chunks.length,
              afterChunkCount: forcedChunks.length,
              targetChunkCount,
              forcedChunkSize,
              contentLength: processedContent.length,
              timestamp: new Date().toISOString()
            });
            // 강제 청킹 결과로 대체
            console.log(`🔄 chunks 배열 교체 전: ${chunks.length}개 → 교체 후: ${forcedChunks.length}개`);
            chunks.length = 0;
            chunks.push(...forcedChunks);
            console.log(`✅ chunks 배열 교체 완료: 현재 ${chunks.length}개`);
            wasForcedRechunking = true;
          } else {
            console.warn('⚠️ 강제 재청킹 실패: 여전히 1개 청크만 생성됨. 더 작은 청크 크기로 재시도...', {
              documentId: document.id,
              title: document.title,
              forcedChunksLength: forcedChunks.length,
              contentLength: processedContent.length,
              forcedChunkSize,
              loopCount
            });
            // 더 작은 청크 크기로 재시도
            const smallerChunkSize = Math.max(200, Math.floor(forcedChunkSize / 2));
            const smallerForcedChunks: ChunkData[] = [];
            for (let i = 0; i < processedContent.length; i += smallerChunkSize) {
              const smallerChunk = processedContent.slice(i, i + smallerChunkSize).trim();
              if (smallerChunk.length > 0) {
                smallerForcedChunks.push({
                  id: `${document.id}_chunk_${smallerForcedChunks.length}`,
                  content: smallerChunk,
                  metadata: {
                    document_id: document.id,
                    chunk_index: smallerForcedChunks.length,
                    source: document.title,
                    created_at: new Date().toISOString(),
                    document_title: document.title,
                    document_type: document.type || 'unknown',
                    chunk_type: 'text',
                    start_char: i,
                    end_char: i + smallerChunk.length,
                    original_length: processedContent.length,
                    hierarchy_level: 'paragraph',
                  }
                });
              }
            }
            
            if (smallerForcedChunks.length > 1) {
              console.log(`✅ 강제 재청킹 재시도 성공: ${smallerForcedChunks.length}개 청크 생성`);
              chunks.length = 0;
              chunks.push(...smallerForcedChunks);
              wasForcedRechunking = true;
            } else {
              console.error('❌ 강제 재청킹 재시도도 실패: 여전히 1개 청크만 생성됨. 내용을 확인해주세요.');
            }
          }
        } catch (forceError) {
          console.error('❌ 강제 재청킹 실패:', {
            documentId: document.id,
            title: document.title,
            error: forceError instanceof Error ? forceError.message : String(forceError),
            stack: forceError instanceof Error ? forceError.stack : undefined,
            currentChunkCount: chunks.length,
            contentLength: processedContent.length
          });
        }
      }
      
      // 최종 청킹 결과 로깅 (강제 재청킹 후)
      // 강제 재청킹이 실행되었는지 여부와 관계없이 항상 최종 결과 로깅
      const finalChunkCount = chunks.length;
      const finalAvgChunkSize = finalChunkCount > 0 ? Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / finalChunkCount) : 0;
      const finalTotalChunkSize = chunks.reduce((sum, c) => sum + c.content.length, 0);
      
      // 최종 청킹 결과 로깅 (항상 출력) - 이 로그는 반드시 출력되어야 함
      // CRITICAL: 이 로그는 반드시 출력되어야 함
      console.error('[CRITICAL] 📊 최종 청킹 결과 (반드시 출력):', {
        documentId: document.id,
        title: document.title,
        chunkCount: finalChunkCount,
        initialChunkCount,
        avgChunkSize: finalAvgChunkSize,
        totalChunkSize: finalTotalChunkSize,
        totalChunkSizeKB: (finalTotalChunkSize / 1024).toFixed(2),
        coverage: finalChunkCount > 0 ? `${((finalTotalChunkSize / processedContent.length) * 100).toFixed(1)}%` : '0%',
        wasForcedRechunking,
        contentLength: processedContent.length,
        note: wasForcedRechunking 
          ? `✅ 강제 재청킹 실행됨: ${initialChunkCount}개 → ${finalChunkCount}개`
          : finalChunkCount > 1
          ? '✅ AdaptiveChunkingService에서 이미 여러 청크 생성됨'
          : '⚠️ 1개 청크만 생성됨 (강제 재청킹 필요했지만 실행되지 않음)'
      });
      
      if (wasForcedRechunking) {
        console.log('✅ 최종 청킹 결과 (강제 재청킹 후):', {
          chunkCount: finalChunkCount,
          initialChunkCount,
          avgChunkSize: finalAvgChunkSize,
          totalChunkSize: finalTotalChunkSize,
          totalChunkSizeKB: (finalTotalChunkSize / 1024).toFixed(2),
          coverage: finalChunkCount > 0 ? `${((finalTotalChunkSize / processedContent.length) * 100).toFixed(1)}%` : '0%',
          documentTitle: document.title
        });
      } else if (finalChunkCount > 1) {
        // 여러 청크가 생성된 경우 정상
        console.log(`✅ 청킹 성공: ${finalChunkCount}개 청크 생성 (평균 ${finalAvgChunkSize}자/청크)`, {
          documentId: document.id,
          title: document.title,
          chunkCount: finalChunkCount,
          initialChunkCount,
          avgChunkSize: finalAvgChunkSize,
          totalChunkSize: finalTotalChunkSize,
          totalChunkSizeKB: (finalTotalChunkSize / 1024).toFixed(2),
          coverage: finalChunkCount > 0 ? `${((finalTotalChunkSize / processedContent.length) * 100).toFixed(1)}%` : '0%',
          wasForcedRechunking: false,
          note: 'AdaptiveChunkingService에서 이미 여러 청크를 생성하여 강제 재청킹이 필요하지 않았음'
        });
      } else {
        // 1개 청크인데 강제 재청킹이 실행되지 않은 경우 (이상한 경우)
        console.warn('⚠️ 청킹 결과 이상: 1개 청크만 생성되었지만 강제 재청킹이 실행되지 않았습니다.', {
          documentId: document.id,
          title: document.title,
          chunkCount: finalChunkCount,
          initialChunkCount,
          contentLength: processedContent.length,
          wasForcedRechunking,
          note: '이 경우는 발생하지 않아야 합니다. AdaptiveChunkingService에서 강제 청킹이 실행되었거나 RAGProcessor에서 강제 재청킹이 실행되어야 합니다.'
        });
      }

      if (chunks.length === 0) {
        console.error('❌ 청킹 결과가 비어있습니다. 상세 정보:', {
          documentId: document.id,
          title: document.title,
          type: document.type,
          contentLength: processedContent.length,
          contentPreview: processedContent.substring(0, 500),
          trimmedContentLength: processedContent.trim().length
        });
        return {
          documentId: document.id,
          chunkCount: 0,
          success: false,
          error: '청킹 결과가 비어있습니다. 문서 내용을 확인해주세요.'
        };
      }

      // AbortSignal 체크
      if (abortSignal?.aborted) {
        throw new Error('문서 처리가 중단되었습니다.');
      }

      // 2. 임베딩 생성 (BGE-M3 모델 사용, 실패 시 해시 기반 fallback)
      const embeddingStartMs = Date.now();
      console.log('🔮 임베딩 생성 시작...', { chunkCount: chunks.length });
      const chunksWithEmbeddings = await this.generateEmbeddings(chunks);
      const embeddingMs = Date.now() - embeddingStartMs;
      console.log(`✅ 임베딩 생성 완료: ${chunksWithEmbeddings.length}개 청크 (${(embeddingMs / 1000).toFixed(1)}초)`);
      
      // AbortSignal 체크
      if (abortSignal?.aborted) {
        throw new Error('문서 처리가 중단되었습니다.');
      }

      // 큰 파일 여부 확인 (저장 시 배치 처리용)
      const isChunkProcess = document.title?.includes('분할');
      const isLargeFile = document.file_size > 10 * 1024 * 1024 || chunks.length > 1000;

      // AbortSignal 체크
      if (abortSignal?.aborted) {
        throw new Error('문서 처리가 중단되었습니다.');
      }

      // 3. Supabase에 저장 (큰 파일의 경우 청크 저장도 배치 처리)
      const savingStartMs = Date.now();
      const supabase = await this.getSupabaseClient();
      let savedChunkCount = 0; // 스코프를 밖으로 이동 (catch 블록에서도 접근 가능하도록)
      if (supabase) {
        try {
          // 문서 저장
          const docSaveStartMs = Date.now();
          await this.saveDocumentToDatabase(document, originalBinaryData);
          const docSaveMs = Date.now() - docSaveStartMs;
          console.log('✅ 문서 데이터베이스 저장 완료', { time: `${docSaveMs}ms` });
          
          // AbortSignal 체크
          if (abortSignal?.aborted) {
            throw new Error('문서 처리가 중단되었습니다.');
          }

          // 큰 파일의 경우 청크 저장도 더 작은 배치로 처리
          const chunkSaveStartMs = Date.now();
          if (isLargeFile || isChunkProcess) {
            console.log(`💾 ${isChunkProcess ? '분할 처리' : '큰 파일'} - 청크 저장을 배치로 처리 (${chunksWithEmbeddings.length}개 청크)`);
            // 큰 파일 또는 분할 처리의 경우 청크 저장도 배치 단위로 나누어 처리
            // 분할 처리 시 배치 크기 증가로 처리 시간 단축 (150 → 200)
            const SAVE_BATCH_SIZE = isChunkProcess ? 200 : 150;
            for (let i = 0; i < chunksWithEmbeddings.length; i += SAVE_BATCH_SIZE) {
              // AbortSignal 체크 (각 배치 전에)
              if (abortSignal?.aborted) {
                throw new Error('문서 처리가 중단되었습니다.');
              }
              
              const batch = chunksWithEmbeddings.slice(i, i + SAVE_BATCH_SIZE);
              const batchSaveStartMs = Date.now();
              console.log(`💾 청크 저장 배치: ${i + 1}-${Math.min(i + SAVE_BATCH_SIZE, chunksWithEmbeddings.length)}/${chunksWithEmbeddings.length}`);
              
              const batchSaved = await this.saveChunksToDatabase(batch, document);
              savedChunkCount += batchSaved;
              
              const batchSaveMs = Date.now() - batchSaveStartMs;
              console.log(`✅ 청크 저장 배치 완료: ${savedChunkCount}/${chunksWithEmbeddings.length} (${batchSaveMs}ms)`);
              
              // 배치 간 짧은 대기 (분할 처리 시 지연 제거)
              if (i + SAVE_BATCH_SIZE < chunksWithEmbeddings.length) {
                // 분할 처리 시 지연 없이 처리 (이미 충분히 작은 단위)
                const delay = isChunkProcess ? 0 : 20;
                if (delay > 0) {
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }
            }
            const chunkSaveMs = Date.now() - chunkSaveStartMs;
            console.log('✅ 청크 데이터베이스 저장 완료:', {
              chunkCount: savedChunkCount,
              time: `${chunkSaveMs}ms (${(chunkSaveMs / 1000).toFixed(1)}초)`,
              batchSaved: true,
              avgTimePerChunk: `${(chunkSaveMs / savedChunkCount).toFixed(1)}ms`
            });
          } else {
            // 작은 파일은 한 번에 저장 (지연 없음)
            savedChunkCount = await this.saveChunksToDatabase(chunksWithEmbeddings, document);
            const chunkSaveMs = Date.now() - chunkSaveStartMs;
            console.log('✅ 청크 데이터베이스 저장 완료:', {
              chunkCount: savedChunkCount,
              time: `${chunkSaveMs}ms (${(chunkSaveMs / 1000).toFixed(1)}초)`,
              avgTimePerChunk: savedChunkCount > 0 ? `${(chunkSaveMs / savedChunkCount).toFixed(1)}ms` : 'N/A'
            });
          }
          
          // 저장된 청크 개수가 생성된 청크 개수와 다른 경우 경고
          if (savedChunkCount !== chunks.length) {
            console.warn(`⚠️ 청크 저장 불일치: 생성 ${chunks.length}개, 저장 ${savedChunkCount}개`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('❌ 데이터베이스 저장 실패:', error);
          console.error('❌ 저장 실패 상세:', {
            documentId: document.id,
            title: document.title,
            error: errorMessage,
            savedChunkCount,
            totalChunks: chunks.length,
            note: '부분 저장된 청크가 있을 수 있습니다. 데이터 일관성을 확인해주세요.'
          });
          
          // 에러를 다시 throw하여 상위로 전파
          throw new Error(`데이터베이스 저장 실패: ${errorMessage}`);
        }
      } else {
        console.log('⚠️ Supabase 연결 없음, 메모리 모드');
      }

      // 실제 저장된 청크 개수 확인 (saveChunksToDatabase에서 반환된 값 사용)
      let actualSavedChunkCount = chunks.length;
      if (supabase) {
        try {
          const { count } = await supabase
            .from('document_chunks')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', document.id);
          actualSavedChunkCount = count || 0;
        } catch (countError) {
          console.warn('⚠️ 저장된 청크 개수 확인 실패:', countError);
        }
      }
      
      // 전체 처리 시간 요약
      const totalProcessingMs = Date.now() - processDocumentStartMs;
      console.log('✅ RAG 문서 처리 완료:', {
        documentId: document.id,
        title: document.title.substring(0, 50),
        chunkCount: actualSavedChunkCount,
        fileSize: `${(document.file_size / (1024 * 1024)).toFixed(2)}MB`,
        totalTime: `${(totalProcessingMs / 1000).toFixed(1)}초 (${(totalProcessingMs / 60000).toFixed(2)}분)`,
        success: true
      });

      return {
        documentId: document.id,
        chunkCount: actualSavedChunkCount, // 실제 저장된 청크 개수 사용
        success: true,
      };
    } catch (error) {
      console.error('❌ RAG 문서 처리 오류:', error);
      return {
        documentId: document.id,
        chunkCount: 0,
        success: false,
      };
    }
  }

  /**
   * 통합 청킹 서비스를 사용한 문서 청킹
   * 모든 청킹 로직을 통합 서비스로 위임
   */
  private async chunkDocumentWithUnifiedService(document: DocumentData): Promise<ChunkData[]> {
    try {
      console.log('📦 통합 청킹 서비스 사용:', {
        documentId: document.id,
        title: document.title,
        contentLength: document.content.length,
        type: document.type,
      });

      // 문서 타입 결정
      const docType = (document.file_type || document.type || 'txt').toLowerCase();
      let documentType: 'pdf' | 'docx' | 'txt' | 'url' = 'txt';
      if (docType.includes('pdf')) documentType = 'pdf';
      else if (docType.includes('docx') || docType.includes('doc')) documentType = 'docx';
      else if (docType.includes('url') || document.url) documentType = 'url';
      else documentType = 'txt';

      // 분할 처리 감지
      const isChunkProcess = document.title?.includes('분할');

      // 통합 청킹 옵션 설정
      const chunkingOptions: UnifiedChunkingOptions = {
        documentType,
        optimizeForSpeed: isChunkProcess,
        chunkSize: 800, // 표준 청크 크기
        chunkOverlap: 100, // 표준 Overlap
      };

      // 통합 청킹 서비스 호출
      const result = await unifiedChunkingService.chunkDocument(
        document.content,
        document.id,
        document.title,
        chunkingOptions
      );

      // ChunkData 형식으로 변환
      const chunkData: ChunkData[] = result.chunks.map((chunk) => {
        // section_title 길이 제한 (인덱스 크기 제한 방지: 최대 200자)
        const sectionTitle = chunk.metadata.sectionTitle;
        const limitedSectionTitle = sectionTitle && sectionTitle.length > 200 
          ? sectionTitle.substring(0, 200) 
          : sectionTitle;
        
        return {
        id: chunk.id,
        content: chunk.content,
        metadata: {
          document_id: chunk.metadata.documentId,
          chunk_index: chunk.metadata.chunkIndex,
          source: chunk.metadata.documentTitle,
          created_at: new Date().toISOString(),
          chunk_type: chunk.metadata.chunkType,
            section_title: limitedSectionTitle,
          keywords: chunk.metadata.keywords,
          importance: chunk.metadata.importance,
          hierarchy_level: chunk.metadata.hierarchyLevel,
          start_char: chunk.metadata.startChar,
          end_char: chunk.metadata.endChar,
          original_length: chunk.metadata.endChar - chunk.metadata.startChar,
        } as any,
        };
      });

      console.log('✅ 통합 청킹 완료:', {
        documentId: document.id,
        totalChunks: chunkData.length,
        averageChunkSize: result.metadata.averageChunkSize,
        coverage: `${result.metadata.coverage}%`,
        processingTimeMs: result.metadata.processingTimeMs,
        performance: {
          encodingTime: `${result.metadata.performance.encodingTimeMs}ms`,
          chunkingTime: `${result.metadata.performance.chunkingTimeMs}ms`,
          totalTime: `${result.metadata.performance.totalTimeMs}ms`,
          chunksPerSecond: result.metadata.performance.chunksPerSecond,
          memoryUsage: result.metadata.performance.memoryUsageMB !== undefined
            ? `${result.metadata.performance.memoryUsageMB}MB`
            : 'N/A',
        },
      });

      // 청크가 0개인 경우 상세 로깅 및 폴백
      if (chunkData.length === 0) {
        console.error('❌ 통합 청킹 결과가 비어있습니다. 상세 정보:', {
          documentId: document.id,
          title: document.title,
          contentLength: document.content.length,
          contentPreview: document.content.substring(0, 500),
          documentType,
          note: '통합 청킹 서비스가 청크를 생성하지 못했습니다. 기존 방식으로 폴백합니다.'
        });
        // 기존 방식으로 폴백
        return this.simpleChunkDocument(document);
      }

      return chunkData;
    } catch (error) {
      console.error('❌ 통합 청킹 실패, 기존 방식으로 폴백:', error);
      console.error('❌ 통합 청킹 실패 상세 정보:', {
        documentId: document.id,
        title: document.title,
        contentLength: document.content?.length || 0,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      // 에러 발생 시 기존 simpleChunkDocument로 폴백
      return this.simpleChunkDocument(document);
    }
  }

  /**
   * 적응적 문서 청킹 (개선된 버전)
   * 문서 유형, 크기, 내용에 따라 최적화된 청킹 전략 사용
   * @deprecated 통합 청킹 서비스 사용 권장 (chunkDocumentWithUnifiedService)
   */
  private async simpleChunkDocument(document: DocumentData): Promise<ChunkData[]> {
    try {
      console.log('📄 적응적 청킹 시작:', {
        contentLength: document.content.length,
        title: document.title,
        type: document.type
      });

      // 내용이 비어있으면 빈 청크 반환
      if (!document.content || document.content.trim() === '') {
        console.error('❌ 문서 내용이 비어있습니다. 상세 정보:', {
          documentId: document.id,
          contentLength: document.content?.length || 0,
          title: document.title,
          type: document.type,
          fileType: document.file_type,
          contentIsNull: document.content === null,
          contentIsEmpty: document.content === '',
          contentIsWhitespace: document.content?.trim() === ''
        });
        return [];
      }
      
      // 텍스트 길이 확인 및 경고
      const trimmedContent = document.content.trim();
      if (trimmedContent.length < 50) {
        console.warn('⚠️ 문서 내용이 너무 짧습니다 (최소 청크 크기 50자 미만):', {
          contentLength: trimmedContent.length,
          contentPreview: trimmedContent.substring(0, 100),
          title: document.title,
          type: document.type
        });
        // 내용이 너무 짧어도 최소 1개 청크는 생성하도록 함
        if (trimmedContent.length > 0) {
          return [{
            id: `${document.id}_chunk_0`,
            content: trimmedContent,
            metadata: {
              document_id: document.id,
              chunk_index: 0,
              source: document.title,
              created_at: new Date().toISOString(),
              document_title: document.title,
              document_type: document.type || 'unknown',
              chunk_type: 'text',
              start_char: 0,
              end_char: trimmedContent.length,
              original_length: trimmedContent.length,
              hierarchy_level: 'paragraph',
            }
          }];
        }
        return [];
      }

      // 콘텐츠 타입 자동 감지
      const contentTypeResult = contentTypeDetector.detectContentType(
        document.content,
        document.title
      );
      console.log('🔍 콘텐츠 타입 감지:', contentTypeResult);

      // 문서 유형 결정 (file_type 또는 type에서 추출)
      const docType = (document.file_type || document.type || 'txt').toLowerCase();
      let documentType: 'pdf' | 'docx' | 'txt' | 'url' = 'txt';
      if (docType.includes('pdf')) documentType = 'pdf';
      else if (docType.includes('docx') || docType.includes('doc')) documentType = 'docx';
      else if (docType.includes('url') || document.url) documentType = 'url';
      else documentType = 'txt';

      // 언어 감지 (간단한 버전)
      const koreanCharCount = (document.content.match(/[가-힣]/g) || []).length;
      const englishCharCount = (document.content.match(/[a-zA-Z]/g) || []).length;
      const language: 'ko' | 'en' | 'mixed' = 
        koreanCharCount > englishCharCount ? 'ko' :
        englishCharCount > koreanCharCount * 2 ? 'en' : 'mixed';

      // 분할 처리 감지 (제목에 "분할" 포함)
      const isChunkProcess = document.title?.includes('분할');
      
      // 적응적 청킹 설정
      // 분할 처리 시: 더 큰 청크 크기로 청킹하여 청크 수 감소 (처리 시간 단축)
      const chunkingConfig: AdaptiveChunkingConfig = {
        documentType,
        contentLength: document.content.length,
        language,
        contentType: contentTypeResult.type !== 'general' ? contentTypeResult.type : undefined,
        // 분할 처리 시 최적화 플래그 추가
        optimizeForSpeed: isChunkProcess // 분할 처리 시 속도 최적화
      };

      // 적응적 청킹 서비스 사용
      console.log('🔧 적응적 청킹 서비스 호출:', {
        contentLength: document.content.length,
        documentType: documentType,
        contentType: contentTypeResult.type,
        language: language,
        optimizeForSpeed: isChunkProcess
      });
      
      const adaptiveChunks = await adaptiveChunkingService.chunkDocument(
        document.content,
        document.id,
        document.title,
        chunkingConfig
      );
      
      // CRITICAL: 이 로그는 반드시 출력되어야 함
      console.error('[CRITICAL] 📦 적응적 청킹 결과:', {
        documentId: document.id,
        title: document.title,
        chunkCount: adaptiveChunks.length,
        firstChunkPreview: adaptiveChunks[0]?.content?.substring(0, 100) || '없음',
        lastChunkPreview: adaptiveChunks[adaptiveChunks.length - 1]?.content?.substring(0, 100) || '없음',
        contentLength: document.content.length,
        timestamp: new Date().toISOString(),
        note: adaptiveChunks.length === 1 && document.content.length > 10000
          ? '⚠️ 1개 청크만 반환됨 - RAGProcessor에서 강제 재청킹 필요'
          : adaptiveChunks.length > 1
          ? '✅ 여러 청크 반환됨 (정상)'
          : '⚠️ 청크가 없음',
        critical: '이 로그는 반드시 출력되어야 합니다.'
      });

      // ChunkData 형식으로 변환
      const chunkData: ChunkData[] = adaptiveChunks.map((chunk) => {
        // section_title 길이 제한 (인덱스 크기 제한 방지: 최대 200자)
        const sectionTitle = chunk.metadata.sectionTitle;
        const limitedSectionTitle = sectionTitle && sectionTitle.length > 200 
          ? sectionTitle.substring(0, 200) 
          : sectionTitle;
        
        return {
        id: chunk.id,
        content: chunk.content,
        metadata: {
          document_id: chunk.metadata.documentId,
          chunk_index: chunk.metadata.chunkIndex,
          source: chunk.metadata.documentTitle,
          created_at: new Date().toISOString(),
          // 추가 메타데이터 확장
          chunk_type: chunk.metadata.chunkType,
            section_title: limitedSectionTitle,
          keywords: chunk.metadata.keywords,
          importance: chunk.metadata.importance,
          confidence: chunk.metadata.confidence,
          // 계층 정보
          hierarchy_level: chunk.metadata.hierarchyLevel,
          parent_chunk_id: chunk.metadata.parentChunkId,
          children_chunk_ids: chunk.metadata.childrenChunkIds,
        } as any, // 타입 확장을 위해 any 사용
        };
      });

      console.log('📄 적응적 청킹 완료:', {
        documentId: document.id,
        title: document.title,
        chunkCount: chunkData.length,
        contentType: contentTypeResult.type,
        confidence: contentTypeResult.confidence,
        averageChunkSize: Math.round(
          chunkData.reduce((sum, c) => sum + c.content.length, 0) / chunkData.length
        ),
        contentLength: document.content.length,
        note: chunkData.length === 1 && document.content.length > 10000
          ? '⚠️ 1개 청크만 반환됨 - RAGProcessor에서 강제 재청킹 필요'
          : chunkData.length > 1
          ? '✅ 여러 청크 반환됨 (정상)'
          : '⚠️ 청크가 없음'
      });

      return chunkData;
    } catch (error) {
      console.error('❌ 적응적 청킹 실패, 기본 청킹으로 폴백:', error);
      // 에러 발생 시 기본 청킹으로 폴백
      return this.fallbackChunkDocument(document);
    }
  }

  /**
   * 기본 청킹 (폴백용)
   */
  private fallbackChunkDocument(document: DocumentData): ChunkData[] {
    try {
      const content = document.content;
      const contentLength = content.length;
      
      // 표준 청크 크기 사용 (800-1000자 범위)
      let chunkSize = 800; // 표준 청크 크기
      let overlap = 100; // 표준 겹침 크기
      
      // 문서 크기에 따라 미세 조정 (표준 범위 내에서)
      if (contentLength < 1000) {
        chunkSize = 400; // 작은 문서: 400자 (표준 범위 내)
        overlap = 50;
      } else if (contentLength < 10000) {
        chunkSize = 600; // 중간 문서: 600자 (표준 범위 내)
        overlap = 75;
      } else if (contentLength > 100000) {
        chunkSize = 1000; // 큰 문서: 1000자 (표준 범위 최대값)
        overlap = 150;
      }
      
      const chunks: string[] = [];
      let start = 0;
      
      while (start < content.length && chunks.length < 500) {
        const end = Math.min(start + chunkSize, content.length);
        let chunk = content.slice(start, end);
        
        // 문장 경계에서 자르기
        if (end < content.length) {
          const lastSentenceEnd = Math.max(
            chunk.lastIndexOf('. '),
            chunk.lastIndexOf('! '),
            chunk.lastIndexOf('? ')
          );
          if (lastSentenceEnd > chunkSize * 0.5) {
            chunk = chunk.slice(0, lastSentenceEnd + 2);
          }
        }
        
        const trimmedChunk = chunk.trim();
        if (trimmedChunk.length > 50) {
          chunks.push(trimmedChunk);
        }
        
        start = end - overlap;
        if (start <= 0) start = end;
      }
      
      return chunks.map((chunk, index) => ({
        id: `${document.id}_chunk_${index}`,
        content: chunk,
        metadata: {
          document_id: document.id,
          chunk_index: index,
          source: document.title,
          created_at: new Date().toISOString(),
          // 폴백 청킹에서도 기본 계층 정보 포함
          hierarchy_level: 'paragraph', // 기본값
          parent_chunk_id: index > 0 ? `${document.id}_chunk_${index - 1}` : undefined,
        },
      }));
    } catch (error) {
      console.error('❌ 폴백 청킹도 실패:', error);
      return [];
    }
  }

  /**
   * 벡터 검색 수행 (수정된 search_documents 함수 사용)
   * @param query 검색 질문
   * @param limit 결과 개수 제한
   * @param vendorFilter 벤더 필터 배열 (예: ['META', 'GOOGLE']) - null이면 전체 검색
   */
  async searchSimilarChunks(query: string, limit: number = 5, vendorFilter: string[] | null = null): Promise<ChunkData[]> {
    try {
      console.log('🔍 벡터 검색 시작:', query);
      if (vendorFilter && vendorFilter.length > 0) {
        console.log('🏷️ 벤더 필터 적용:', vendorFilter);
      }
      const supabase = await this.getSupabaseClient();

      if (!supabase) {
        console.warn('⚠️ Supabase 클라이언트가 없습니다. 빈 결과를 반환합니다.');
        return [];
      }

      // 쿼리 임베딩 생성 (BGE-M3 또는 OpenAI만 사용)
      console.log('🧠 쿼리 임베딩 생성 중...');
      let queryEmbedding: number[];
      
      // OpenAI Embeddings API 사용
      if (this.embeddingProvider === 'openai') {
        if (!this.openAIEmbeddingService || !this.openAIEmbeddingService.initialized) {
          throw new Error('OpenAI Embeddings API가 초기화되지 않았습니다. OPENAI_API_KEY 환경 변수를 확인하세요.');
        }
        
        console.log('🔄 OpenAI로 쿼리 임베딩 생성 중...');
        const result = await this.openAIEmbeddingService.generateEmbedding(query);
        queryEmbedding = result.embedding;
        console.log('✅ OpenAI 쿼리 임베딩 생성 완료:', queryEmbedding.length, '차원');
      } else {
        // BGE-M3 사용
        const embeddingService = await this.initializeEmbeddingService();
        
        if (!embeddingService) {
          throw new Error('BGE-M3 임베딩 서비스 초기화 실패');
        }
        
        console.log('🔄 BGE-M3로 쿼리 임베딩 생성 중...');
        const result = await embeddingService.generateEmbedding(query, {
          model: 'bge-m3',
          normalize: true
        });
        queryEmbedding = result.embedding;
        
        // 차원 확인
        const embeddingDim = parseInt(process.env.EMBEDDING_DIM || '1024');
        if (queryEmbedding.length !== embeddingDim) {
          console.warn(`⚠️ 쿼리 임베딩 차원 불일치: ${queryEmbedding.length} (예상: ${embeddingDim})`);
        }
        console.log('✅ BGE-M3 쿼리 임베딩 생성 완료:', queryEmbedding.length, '차원');
      }

      // 벤더 필터를 대문자로 변환 (ENUM과 매칭)
      const normalizedVendorFilter = vendorFilter && vendorFilter.length > 0
        ? vendorFilter.map(v => v.toUpperCase())
        : null;

      // 가중치 기반 검색 함수 사용 여부 확인
      let useWeightedSearch = false;
      try {
        const testResult = await supabase.rpc('search_documents_with_weights', {
          query_embedding: queryEmbedding,
          match_threshold: 0.7,
          match_count: 1,
          vendor_filter: normalizedVendorFilter,
        });
        useWeightedSearch = !testResult.error;
      } catch {
        useWeightedSearch = false;
      }

      // 단계적 Fallback 검색 전략
      // 1단계: 기본 임계값(0.7)으로 검색
      let chunks = await this.performVectorSearch(
        supabase,
        queryEmbedding,
        limit,
        normalizedVendorFilter,
        0.7,
        useWeightedSearch
      );

      // 2단계: 결과가 없거나 유사도가 낮으면 임계값을 낮춰서 재검색 (0.4)
      if (chunks.length === 0 || chunks.every(c => (c.similarity || 0) < 0.5)) {
        console.log('⚠️ 1단계 검색 결과 부족 - 임계값을 0.4로 낮춰서 재검색');
        const lowerThresholdChunks = await this.performVectorSearch(
          supabase,
          queryEmbedding,
          limit,
          normalizedVendorFilter,
          0.4,
          useWeightedSearch
        );
        
        // 더 나은 결과가 있으면 사용
        if (lowerThresholdChunks.length > 0 && 
            lowerThresholdChunks.some(c => (c.similarity || 0) > 0.3)) {
          console.log(`✅ 2단계 검색 성공: ${lowerThresholdChunks.length}개 결과 발견`);
          chunks = lowerThresholdChunks;
        }
      }

      // 2-1단계: 여전히 결과가 없으면 임계값을 더 낮춰서 재검색 (0.2)
      if (chunks.length === 0 || chunks.every(c => (c.similarity || 0) < 0.3)) {
        console.log('⚠️ 2단계 검색 결과 부족 - 임계값을 0.2로 낮춰서 재검색');
        const veryLowThresholdChunks = await this.performVectorSearch(
          supabase,
          queryEmbedding,
          limit * 2, // 더 많은 결과 가져오기
          normalizedVendorFilter,
          0.2,
          useWeightedSearch
        );
        
        // 더 나은 결과가 있으면 사용
        if (veryLowThresholdChunks.length > 0) {
          console.log(`✅ 2-1단계 검색 성공: ${veryLowThresholdChunks.length}개 결과 발견`);
          chunks = veryLowThresholdChunks;
        }
      }

      // 3단계: 벤더 필터가 적용된 상태에서 결과가 없으면 필터를 제거하고 재검색
      if (chunks.length === 0 && normalizedVendorFilter) {
        console.log('⚠️ 벤더 필터 적용 시 결과 없음 - 벤더 필터를 제거하고 재검색');
        const noFilterChunks = await this.performVectorSearch(
          supabase,
          queryEmbedding,
          limit * 2, // 더 많은 결과 가져오기
          null, // 벤더 필터 제거
          0.2, // 낮은 임계값 사용
          useWeightedSearch
        );
        
        if (noFilterChunks.length > 0) {
          console.log(`✅ 3단계 검색 성공 (벤더 필터 제거): ${noFilterChunks.length}개 결과 발견`);
          chunks = noFilterChunks;
        }
      }

      // 최종 결과가 없으면 키워드 검색으로 Fallback
      if (chunks.length === 0) {
        console.log('🔄 벡터 검색 결과 없음 - 키워드 검색으로 Fallback 시도...');
        return await this.fallbackKeywordSearch(query, limit, supabase, normalizedVendorFilter);
      }

      // 타입별 통계 로그
      const urlChunks = chunks.filter(c => (c.metadata as any).sourceType === 'url');
      const fileChunks = chunks.filter(c => (c.metadata as any).sourceType === 'file');
      console.log(`📊 최종 검색 결과 타입별 통계: URL ${urlChunks.length}개, 파일 ${fileChunks.length}개 (총 ${chunks.length}개)`);
      
      // 유사도 분포 로그
      const similarities = chunks.map(c => c.similarity || 0).filter(s => s > 0);
      if (similarities.length > 0) {
        const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
        const maxSimilarity = Math.max(...similarities);
        const minSimilarity = Math.min(...similarities);
        console.log(`📊 유사도 분포: 평균 ${avgSimilarity.toFixed(3)}, 최대 ${maxSimilarity.toFixed(3)}, 최소 ${minSimilarity.toFixed(3)}`);
      }
      
      if (urlChunks.length === 0 && fileChunks.length > 0) {
        console.log('⚠️ 경고: URL 검색 결과가 없습니다. URL 문서가 검색되지 않았을 수 있습니다.');
      } else if (fileChunks.length === 0 && urlChunks.length > 0) {
        console.log('⚠️ 경고: 파일 검색 결과가 없습니다. 파일 문서가 검색되지 않았을 수 있습니다.');
      }

      console.log('✅ 벡터 검색 완료:', chunks.length, '개 결과');
      return chunks;
    } catch (error) {
      console.error('❌ 벡터 검색 오류:', error);
      return [];
    }
  }

  /**
   * 벡터 검색 수행 (내부 헬퍼 메서드)
   */
  private async performVectorSearch(
    supabase: any,
    queryEmbedding: number[],
    limit: number,
    vendorFilter: string[] | null,
    threshold: number,
    useWeightedSearch: boolean
  ): Promise<ChunkData[]> {
    try {
      let data, error;
      
      if (useWeightedSearch) {
        const result = await supabase.rpc('search_documents_with_weights', {
          query_embedding: queryEmbedding,
          match_threshold: threshold,
          match_count: limit,
          vendor_filter: vendorFilter,
        });
        data = result.data;
        error = result.error;
      } else {
        const result = await supabase.rpc('search_documents', {
          query_embedding: queryEmbedding,
          match_threshold: threshold,
          match_count: limit,
          vendor_filter: vendorFilter,
        });
        data = result.data;
        error = result.error;
      }

      if (error) {
        console.error('❌ 벡터 검색 오류:', error);
        return [];
      }

      // 결과를 ChunkData 형식으로 변환
      const chunks: ChunkData[] = (data || []).map((item: any) => {
        const documentType = item.document_type || item.metadata?.document_type || 'file';
        const isUrl = documentType === 'url';
        
        const finalSimilarity = item.weighted_similarity !== undefined 
          ? item.weighted_similarity 
          : item.similarity;
        
        return {
          id: item.chunk_id,
          content: item.content,
          metadata: {
            document_id: item.document_id,
            chunk_index: item.metadata?.chunk_index || 0,
            source: item.title || item.metadata?.source || 'Unknown',
            created_at: item.metadata?.created_at || new Date().toISOString(),
            source_vendor: item.source_vendor || item.metadata?.source_vendor || null,
            document_type: documentType,
            sourceType: isUrl ? 'url' : 'file',
            weight_score: item.weight_score || 1.0,
            weighted_similarity: finalSimilarity,
          },
          similarity: finalSimilarity,
        };
      });

      return chunks;
    } catch (error) {
      console.error('❌ 벡터 검색 수행 오류:', error);
      return [];
    }
  }

  /**
   * Fallback 키워드 검색 (벤더 필터 지원, 복합 키워드 처리)
   */
  private async fallbackKeywordSearch(
    query: string, 
    limit: number, 
    supabase: any,
    vendorFilter: string[] | null = null
  ): Promise<ChunkData[]> {
    try {
      console.log('🔍 키워드 검색 Fallback 실행:', query);
      if (vendorFilter && vendorFilter.length > 0) {
        console.log('🏷️ 키워드 검색에도 벤더 필터 적용:', vendorFilter);
      }
      
      // 개선된 키워드 추출 (복합 키워드 지원)
      const queryLower = query.toLowerCase();
      
      // 불용어 목록
      const stopWords = ['에', '를', '을', '의', '와', '과', '에 대해', '에 대해 설명', '알려줘', '소개해줘', '설명해줘', '가이드', '가이드를', '알려', '소개', '설명', '에 대해', '설명해', '알려주', '소개해'];
      
      // 복합 키워드 패턴 (예: "전환API", "DV360", "포토뷰어")
      const compoundPatterns = [
        /전환\s*api/gi,
        /dv\s*360/gi,
        /포토\s*뷰어/gi,
        /youtube\s*상품/gi,
        /google\s*ads/gi,
        /meta\s*ads/gi,
        /conversion\s*api/gi,
        /conversionapi/gi,
      ];
      
      const queryKeywords: string[] = [];
      
      // 복합 키워드 먼저 추출
      compoundPatterns.forEach(pattern => {
        const matches = queryLower.match(pattern);
        if (matches) {
          matches.forEach(match => {
            const cleaned = match.replace(/\s+/g, ''); // 공백 제거
            if (cleaned.length > 1) {
              queryKeywords.push(cleaned);
            }
          });
        }
      });
      
      // 나머지 단어 추출 (복합 키워드에 포함되지 않은 경우만)
      const words = queryLower.split(/\s+/);
      words.forEach(word => {
        const cleaned = word.trim();
        // 불용어가 아니고, 길이가 1보다 크며, 복합 키워드에 포함되지 않은 경우
        if (cleaned.length > 1 && 
            !stopWords.includes(cleaned) && 
            !queryKeywords.some(kw => cleaned.includes(kw) || kw.includes(cleaned))) {
          queryKeywords.push(cleaned);
        }
      });
      
      // 중복 제거
      const searchTerms = Array.from(new Set(queryKeywords));
      
      if (searchTerms.length === 0) {
        searchTerms.push(query); // 키워드가 없으면 전체 쿼리 사용
      }
      
      console.log(`🔑 추출된 키워드: ${searchTerms.join(', ')}`);
      
      // 키워드 검색 쿼리 구성 (별도 쿼리로 분리하여 documents 테이블과 조인)
      // 1단계: document_chunks에서 키워드로 검색 (대소문자 무시, 부분 일치)
      const orConditions = searchTerms.map(term => `content.ilike.%${term}%`).join(',');
      const { data: chunksData, error: chunksError } = await supabase
        .from('document_chunks')
        .select('chunk_id, content, metadata, document_id')
        .or(orConditions)
        .limit(limit * 3); // 더 많은 결과를 가져와서 벤더 필터 후에도 충분한 결과 확보
      
      if (chunksError) {
        console.error('❌ 키워드 검색 (chunks) 오류:', chunksError);
        return [];
      }
      
      if (!chunksData || chunksData.length === 0) {
        console.log('⚠️ 키워드 검색 결과 없음');
        return [];
      }
      
      console.log(`📊 키워드 검색으로 ${chunksData.length}개 청크 발견`);
      
      // 2단계: documents 테이블에서 문서 정보 조회 (벤더 필터 적용)
      const documentIds = [...new Set(chunksData.map((c: any) => c.document_id))];
      let documentsQuery = supabase
        .from('documents')
        .select('id, title, source_vendor, type, status')
        .in('id', documentIds)
        .eq('status', 'indexed');
      
      // 벤더 필터 적용
      if (vendorFilter && vendorFilter.length > 0) {
        const normalizedVendorFilter = vendorFilter.map(v => v.toUpperCase());
        documentsQuery = documentsQuery.in('source_vendor', normalizedVendorFilter);
      }
      
      const { data: documentsData, error: documentsError } = await documentsQuery;
      
      if (documentsError) {
        console.error('❌ 키워드 검색 (documents) 오류:', documentsError);
        return [];
      }
      
      // 벤더 필터로 인해 결과가 없으면 필터를 완화하여 재검색
      if (!documentsData || documentsData.length === 0) {
        if (vendorFilter && vendorFilter.length > 0) {
          console.log('⚠️ 벤더 필터로 인해 문서 정보 없음 - 벤더 필터를 제거하고 재검색');
          // 벤더 필터 없이 재검색
          const { data: allDocumentsData, error: allDocumentsError } = await supabase
            .from('documents')
            .select('id, title, source_vendor, type, status')
            .in('id', documentIds)
            .eq('status', 'indexed');
          
          if (allDocumentsError) {
            console.error('❌ 키워드 검색 (documents, 필터 제거) 오류:', allDocumentsError);
            return [];
          }
          
          if (!allDocumentsData || allDocumentsData.length === 0) {
            console.log('⚠️ 키워드 검색 결과 없음 (벤더 필터 제거 후에도)');
            return [];
          }
          
          // 벤더 필터 없이 결과 반환
          const documentMap = new Map<string, any>(
            allDocumentsData.map((d: any) => [d.id, d])
          );
          const data = chunksData
            .filter((c: any) => documentMap.has(c.document_id))
            .slice(0, limit);
          
          const chunks: ChunkData[] = (data || []).map((item: any) => {
            const doc = documentMap.get(item.document_id);
            if (!doc) return null;
            
            const documentType = doc.type || 'file';
            const isUrl = documentType === 'url';
            
            return {
              id: item.chunk_id,
              content: item.content,
              metadata: {
                document_id: item.document_id,
                chunk_index: item.metadata?.chunk_index || 0,
                source: doc.title || item.metadata?.source || 'Unknown',
                created_at: item.metadata?.created_at || new Date().toISOString(),
                source_vendor: doc.source_vendor || item.metadata?.source_vendor || null,
                document_type: documentType,
                sourceType: isUrl ? 'url' : 'file',
              },
              similarity: 0.5,
            };
          }).filter((c: ChunkData | null): c is ChunkData => c !== null);
          
          console.log(`✅ 키워드 검색 완료 (벤더 필터 제거): ${chunks.length}개 결과`);
          return chunks;
        } else {
          console.log('⚠️ 키워드 검색 결과 없음');
          return [];
        }
      }
      
      // 3단계: chunks와 documents를 조인하여 최종 결과 생성
      interface DocumentInfo {
        id: string;
        title: string;
        source_vendor: string | null;
        type: string;
        status: string;
      }
      
      const documentMap = new Map<string, DocumentInfo>(
        documentsData.map((d: any) => [d.id, d as DocumentInfo])
      );
      const data = chunksData
        .filter((c: any) => documentMap.has(c.document_id)) // 벤더 필터를 통과한 문서만
        .slice(0, limit); // 최종 결과 제한

      const chunks: ChunkData[] = (data || []).map((item: any) => {
        const doc = documentMap.get(item.document_id);
        if (!doc) return null; // 문서 정보가 없으면 제외
        
        const documentType = doc.type || 'file';
        const isUrl = documentType === 'url';
        
        return {
          id: item.chunk_id,
          content: item.content,
          metadata: {
            document_id: item.document_id,
            chunk_index: item.metadata?.chunk_index || 0,
            source: doc.title || item.metadata?.source || 'Unknown',
            created_at: item.metadata?.created_at || new Date().toISOString(),
            source_vendor: doc.source_vendor || item.metadata?.source_vendor || null,
            document_type: documentType,
            sourceType: isUrl ? 'url' : 'file',
          },
          similarity: 0.5, // 키워드 검색은 낮은 유사도로 설정
        };
      }).filter((c: ChunkData | null): c is ChunkData => c !== null); // null 제거

      console.log(`✅ 키워드 검색 완료: ${chunks.length}개 결과 (검색어: ${searchTerms.join(', ')})`);
      return chunks;
    } catch (error) {
      console.error('❌ 키워드 검색 오류:', error);
      return [];
    }
  }
}

// 싱글톤 인스턴스
export const ragProcessor = new RAGProcessor();
