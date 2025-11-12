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
  created_at: string;
  updated_at: string;
}

export class RAGProcessor {
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor() {
    // 텍스트 분할기 설정
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 800, // 청크 크기 (800자로 감소)
      chunkOverlap: 100, // 청크 간 겹침 (100자로 감소)
      separators: ['\n\n', '\n', '.', '!', '?', ';', ' ', ''], // 분할 기준
    });
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
   * 간단한 로컬 임베딩 생성 (API 키 없이)
   */
  private generateSimpleEmbedding(text: string): number[] {
    try {
      // 환경변수에서 임베딩 차원 수 가져오기
      const embeddingDim = parseInt(process.env.EMBEDDING_DIM || '1024');
      
      // 간단한 해시 기반 임베딩 생성 (실제 임베딩은 아니지만 테스트용)
      const hash = this.simpleHash(text);
      const embedding = new Array(embeddingDim).fill(0);
      
      // 해시값을 기반으로 임베딩 벡터 생성
      for (let i = 0; i < embeddingDim; i++) {
        embedding[i] = Math.sin(hash + i) * 0.1;
      }
      
      return embedding;
    } catch (error) {
      console.warn('⚠️ 임베딩 생성 실패, 기본값 반환:', error);
      const embeddingDim = parseInt(process.env.EMBEDDING_DIM || '1024');
      return new Array(embeddingDim).fill(0);
    }
  }

  /**
   * 간단한 해시 함수
   */
  private simpleHash(str: string): number {
    try {
      if (!str || typeof str !== 'string') {
        return 0;
      }
      
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 32bit 정수로 변환
      }
      return Math.abs(hash);
    } catch (error) {
      console.warn('⚠️ 해시 생성 실패, 기본값 반환:', error);
      return 12345; // 기본 해시값
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
   * 청크에 대한 임베딩 생성 (로컬 버전)
   */
  async generateEmbeddings(chunks: ChunkData[]): Promise<ChunkData[]> {
    try {
      console.log('🔮 임베딩 생성 시작 (로컬):', chunks.length, '개 청크');

      // 환경변수에서 임베딩 차원 수 가져오기
      const embeddingDim = parseInt(process.env.EMBEDDING_DIM || '1024');
      console.log('📏 임베딩 차원 수:', embeddingDim);

      // 각 청크에 대해 간단한 임베딩 생성
      const chunksWithEmbeddings = chunks.map((chunk, index) => {
        try {
          return {
            ...chunk,
            embedding: this.generateSimpleEmbedding(chunk.content),
          };
        } catch (error) {
          console.warn(`⚠️ 청크 ${index} 임베딩 생성 실패, 기본값 사용:`, error);
          return {
            ...chunk,
            embedding: new Array(embeddingDim).fill(0), // 환경변수 기반 기본 임베딩
          };
        }
      });

      console.log('✅ 임베딩 생성 완료 (로컬):', chunksWithEmbeddings.length, '개 청크');

      return chunksWithEmbeddings;
    } catch (error) {
      console.error('❌ 임베딩 생성 오류:', error);
      // 오류 발생 시에도 기본 임베딩으로 반환
      console.log('⚠️ 기본 임베딩으로 대체 처리');
      const embeddingDim = parseInt(process.env.EMBEDDING_DIM || '1024');
      return chunks.map(chunk => ({
        ...chunk,
        embedding: new Array(embeddingDim).fill(0),
      }));
    }
  }

  /**
   * 문서를 Supabase에 저장
   */
  async saveDocumentToDatabase(document: DocumentData, originalBinaryData?: string): Promise<void> {
    try {
      console.log('💾 문서 저장 시작:', document.title);
      const supabase = await this.getSupabaseClient();

      // Supabase 연결 확인
      if (!supabase) {
        console.warn('⚠️ Supabase 연결 없음. 메모리 모드로 동작');
        return;
      }

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
      
      // 먼저 기존 문서가 있는지 확인
      const { data: existingDoc, error: checkError } = await supabase
        .from('documents')
        .select('id')
        .eq('id', document.id)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') { // PGRST116은 "no rows returned" 에러 (정상)
        console.error('❌ 문서 존재 확인 오류:', checkError);
        throw checkError;
      }

      const isUpdate = !!existingDoc;
      const documentData = {
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

      // 기존 문서가 없으면 created_at 포함, 있으면 제외 (업데이트 시 created_at은 변경하지 않음)
      if (!isUpdate) {
        (documentData as any).created_at = document.created_at;
      }

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
          setTimeout(() => reject(new Error('Database operation timeout')), timeoutMs)
        )
      ]) as any;

      if (error) {
        console.error('❌ 문서 저장 오류:', error);
        console.error('❌ 문서 저장 오류 상세:', {
          documentId: document.id,
          title: document.title,
          errorCode: error.code,
          errorMessage: error.message,
          errorDetails: error.details,
          isUpdate,
          existingDoc: !!existingDoc
        });
        throw error;
      }

      console.log(`✅ 문서 ${isUpdate ? '업데이트' : '저장'} 완료:`, document.title);

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
  async saveChunksToDatabase(chunks: ChunkData[]): Promise<number> {
    let supabase = await this.getSupabaseClient();
    
    // Supabase 연결 확인
    if (!supabase) {
      console.warn('⚠️ Supabase 연결 없음. 청크 저장 건너뛰기');
      return 0;
    }
    
    try {
      console.log('💾 청크 저장 시작:', chunks.length, '개 청크');

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
            section_title: chunk.metadata.section_title,
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
        console.log(`✅ 청크 저장 완료: ${savedCount}개 청크 (${saveMs}ms)`);
      }

      console.log('✅ 청크 저장 완료:', savedCount, '개 청크 (시도:', chunks.length, '개)');

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

      // 문서의 chunk_count 업데이트 (실제 저장된 개수 사용)
      if (finalCount > 0) {
        const { error: updateError } = await supabase
          .from('documents')
          .update({ 
            chunk_count: finalCount,
            status: 'indexed',
            updated_at: new Date().toISOString()
          })
          .eq('id', documentId);

        if (updateError) {
          console.error('❌ 문서 chunk_count 업데이트 오류:', updateError);
        } else {
          console.log('✅ 문서 chunk_count 업데이트 완료:', finalCount, '개 청크');
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
          
          // 부분적으로 저장된 경우 chunk_count 업데이트
          if (savedCount > 0) {
            await supabase
              .from('documents')
              .update({ 
                chunk_count: savedCount,
                status: 'indexed',
                updated_at: new Date().toISOString()
              })
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
      
      // 타임아웃 설정
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`문서 처리 타임아웃 (${timeoutMs}ms 초과)`));
        }, timeoutMs);
      });
      
      const processPromise = this.processDocumentInternal(document, skipDuplicate, originalBinaryData);
      
      // 타임아웃과 처리 작업을 경쟁시킴
      const result = await Promise.race([processPromise, timeoutPromise]);
      return result;
      
    } catch (error) {
      console.error('❌ RAG 문서 처리 실패:', error);
      return {
        documentId: document.id,
        chunkCount: 0,
        success: false,
      };
    }
  }
  
  private async processDocumentInternal(document: DocumentData, skipDuplicate: boolean = false, originalBinaryData?: string): Promise<{
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
      
      // PDF 바이너리 데이터인 경우 텍스트 추출 없이 청킹 건너뛰기 (하지만 문서는 저장)
      if (document.content && document.content.startsWith('BINARY_DATA:')) {
        console.log('⚠️ PDF 바이너리 데이터 감지 - 청킹 건너뛰기, 문서만 저장');
        
        // 문서는 저장 (청크 없이)
        const supabase = await this.getSupabaseClient();
        if (supabase) {
          try {
            await this.saveDocumentToDatabase(document, originalBinaryData);
            console.log('✅ PDF 문서 저장 완료 (청크 없음)');
            
            // 문서 상태를 indexed로 업데이트 (청크 없어도 저장 완료)
            const { error: updateError } = await supabase
              .from('documents')
              .update({ 
                status: 'indexed',
                chunk_count: 0,
                updated_at: new Date().toISOString()
              })
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
            };
          }
        }
        
        return {
          documentId: document.id,
          chunkCount: 0,
          success: true, // PDF는 다운로드용으로만 사용
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
      
      // 통합 청킹 서비스 사용
      const chunks = await this.chunkDocumentWithUnifiedService(processedDocument);
      const chunkingMs = Date.now() - chunkingStartMs;
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
            const chunkContent = processedContent.slice(i, i + forcedChunkSize).trim();
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

      // 2. 임베딩 생성 (큰 파일의 경우만 배치 처리)
      const embeddingStartMs = Date.now();
      console.log('🔮 임베딩 생성 시작...', { chunkCount: chunks.length });
      const isChunkProcess = document.title?.includes('분할');
      const isLargeFile = document.file_size > 10 * 1024 * 1024 || chunks.length > 1000;
      const chunksWithEmbeddings: ChunkData[] = [];
      
      if (isLargeFile || isChunkProcess) {
        // 큰 파일 또는 분할 처리의 경우 배치 단위로 임베딩 생성
        // 분할 처리 시 배치 크기 증가로 처리 시간 단축 (200 → 300)
        const EMBEDDING_BATCH_SIZE = isChunkProcess ? 300 : 200;
        console.log(`📦 큰 파일 감지 - 배치 단위로 임베딩 생성 (${chunks.length}개 청크, 배치 크기: ${EMBEDDING_BATCH_SIZE})`);
        
        for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
          const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
          const batchStartMs = Date.now();
          console.log(`🔮 임베딩 배치 생성 중: ${i + 1}-${Math.min(i + EMBEDDING_BATCH_SIZE, chunks.length)}/${chunks.length}`);
          
          const batchWithEmbeddings = batch.map(chunk => ({
            ...chunk,
            embedding: this.generateSimpleEmbedding(chunk.content),
          }));
          
          chunksWithEmbeddings.push(...batchWithEmbeddings);
          
          const batchMs = Date.now() - batchStartMs;
          console.log(`✅ 임베딩 배치 생성 완료: ${i + 1}-${Math.min(i + EMBEDDING_BATCH_SIZE, chunks.length)}/${chunks.length} (${batchMs}ms)`);
          
          // 배치 간 짧은 대기 (CPU 부하 방지, 분할 처리 시 지연 제거)
          if (i + EMBEDDING_BATCH_SIZE < chunks.length) {
            // 분할 처리 시 지연 없이 처리 (이미 충분히 작은 단위)
            const delay = isChunkProcess ? 0 : 5;
            if (delay > 0) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        const embeddingMs = Date.now() - embeddingStartMs;
        console.log(`✅ 임베딩 생성 완료: ${chunksWithEmbeddings.length}개 청크 (배치 처리, ${(embeddingMs / 1000).toFixed(1)}초)`);
      } else {
        // 작은 파일은 한 번에 처리 (지연 없음)
        const mappingStartMs = Date.now();
        const mapped = chunks.map(chunk => ({
          ...chunk,
          embedding: this.generateSimpleEmbedding(chunk.content),
        }));
        chunksWithEmbeddings.push(...mapped);
        const embeddingMs = Date.now() - embeddingStartMs;
        console.log('✅ 임베딩 생성 완료:', {
          chunkCount: chunksWithEmbeddings.length,
          time: `${embeddingMs}ms (${(embeddingMs / 1000).toFixed(1)}초)`,
          avgTimePerChunk: `${(embeddingMs / chunks.length).toFixed(1)}ms`
        });
      }

      // 3. Supabase에 저장 (큰 파일의 경우 청크 저장도 배치 처리)
      const savingStartMs = Date.now();
      const supabase = await this.getSupabaseClient();
      if (supabase) {
        try {
          // 문서 저장
          const docSaveStartMs = Date.now();
          await this.saveDocumentToDatabase(document, originalBinaryData);
          const docSaveMs = Date.now() - docSaveStartMs;
          console.log('✅ 문서 데이터베이스 저장 완료', { time: `${docSaveMs}ms` });

          // 큰 파일의 경우 청크 저장도 더 작은 배치로 처리
          const chunkSaveStartMs = Date.now();
          let savedChunkCount = 0;
          if (isLargeFile || isChunkProcess) {
            console.log(`💾 ${isChunkProcess ? '분할 처리' : '큰 파일'} - 청크 저장을 배치로 처리 (${chunksWithEmbeddings.length}개 청크)`);
            // 큰 파일 또는 분할 처리의 경우 청크 저장도 배치 단위로 나누어 처리
            // 분할 처리 시 배치 크기 증가로 처리 시간 단축 (150 → 200)
            const SAVE_BATCH_SIZE = isChunkProcess ? 200 : 150;
            for (let i = 0; i < chunksWithEmbeddings.length; i += SAVE_BATCH_SIZE) {
              const batch = chunksWithEmbeddings.slice(i, i + SAVE_BATCH_SIZE);
              const batchSaveStartMs = Date.now();
              console.log(`💾 청크 저장 배치: ${i + 1}-${Math.min(i + SAVE_BATCH_SIZE, chunksWithEmbeddings.length)}/${chunksWithEmbeddings.length}`);
              
              const batchSaved = await this.saveChunksToDatabase(batch);
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
            savedChunkCount = await this.saveChunksToDatabase(chunksWithEmbeddings);
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
          console.error('❌ 데이터베이스 저장 실패:', error);
          console.error('❌ 저장 실패 상세:', {
            documentId: document.id,
            title: document.title,
            error: error instanceof Error ? error.message : String(error)
          });
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
      const chunkData: ChunkData[] = result.chunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        metadata: {
          document_id: chunk.metadata.documentId,
          chunk_index: chunk.metadata.chunkIndex,
          source: chunk.metadata.documentTitle,
          created_at: new Date().toISOString(),
          chunk_type: chunk.metadata.chunkType,
          section_title: chunk.metadata.sectionTitle,
          keywords: chunk.metadata.keywords,
          importance: chunk.metadata.importance,
          hierarchy_level: chunk.metadata.hierarchyLevel,
          start_char: chunk.metadata.startChar,
          end_char: chunk.metadata.endChar,
          original_length: chunk.metadata.endChar - chunk.metadata.startChar,
        } as any,
      }));

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

      return chunkData;
    } catch (error) {
      console.error('❌ 통합 청킹 실패, 기존 방식으로 폴백:', error);
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
      const chunkData: ChunkData[] = adaptiveChunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        metadata: {
          document_id: chunk.metadata.documentId,
          chunk_index: chunk.metadata.chunkIndex,
          source: chunk.metadata.documentTitle,
          created_at: new Date().toISOString(),
          // 추가 메타데이터 확장
          chunk_type: chunk.metadata.chunkType,
          section_title: chunk.metadata.sectionTitle,
          keywords: chunk.metadata.keywords,
          importance: chunk.metadata.importance,
          confidence: chunk.metadata.confidence,
          // 계층 정보
          hierarchy_level: chunk.metadata.hierarchyLevel,
          parent_chunk_id: chunk.metadata.parentChunkId,
          children_chunk_ids: chunk.metadata.childrenChunkIds,
        } as any, // 타입 확장을 위해 any 사용
      }));

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

      // 쿼리에 대한 임베딩 생성 (BGE-M3 모델 사용)
      console.log('🧠 쿼리 임베딩 생성 중...');
      const queryEmbedding = this.generateSimpleEmbedding(query);
      console.log('✅ 쿼리 임베딩 생성 완료:', queryEmbedding.length, '차원');

      // 벤더 필터를 대문자로 변환 (ENUM과 매칭)
      const normalizedVendorFilter = vendorFilter && vendorFilter.length > 0
        ? vendorFilter.map(v => v.toUpperCase())
        : null;

      // 새로운 search_documents 함수 사용 (vendor_filter 파라미터 추가)
      const { data, error } = await supabase.rpc('search_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: limit,
        vendor_filter: normalizedVendorFilter,
      });

      if (error) {
        console.error('❌ 벡터 검색 오류:', error);
        // Fallback: 키워드 검색 시도
        console.log('🔄 키워드 검색으로 Fallback 시도...');
        return await this.fallbackKeywordSearch(query, limit, supabase);
      }

      // 결과를 ChunkData 형식으로 변환
      const chunks: ChunkData[] = (data || []).map((item: any) => ({
        id: item.chunk_id,
        content: item.content,
        metadata: {
          document_id: item.document_id,
          chunk_index: item.metadata?.chunk_index || 0,
          source: item.title || item.metadata?.source || 'Unknown',
          created_at: item.metadata?.created_at || new Date().toISOString(),
          source_vendor: item.source_vendor || item.metadata?.source_vendor || null,
        },
        similarity: item.similarity,
      }));

      console.log('✅ 벡터 검색 완료:', chunks.length, '개 결과');
      return chunks;
    } catch (error) {
      console.error('❌ 벡터 검색 오류:', error);
      return [];
    }
  }

  /**
   * Fallback 키워드 검색
   */
  private async fallbackKeywordSearch(query: string, limit: number, supabase: any): Promise<ChunkData[]> {
    try {
      console.log('🔍 키워드 검색 Fallback 실행:', query);
      
      const { data, error } = await supabase
        .from('document_chunks')
        .select('chunk_id, content, metadata, document_id')
        .or(`content.ilike.%${query}%,content.ilike.%${query.split(' ')[0]}%`)
        .limit(limit);

      if (error) {
        console.error('❌ 키워드 검색 오류:', error);
        return [];
      }

      const chunks: ChunkData[] = (data || []).map((item: any) => ({
        id: item.chunk_id,
        content: item.content,
        metadata: {
          document_id: item.document_id,
          chunk_index: item.metadata?.chunk_index || 0,
          source: item.metadata?.source || 'Unknown',
          created_at: item.metadata?.created_at || new Date().toISOString(),
        },
        similarity: 0.5, // 키워드 검색은 낮은 유사도로 설정
      }));

      console.log('✅ 키워드 검색 완료:', chunks.length, '개 결과');
      return chunks;
    } catch (error) {
      console.error('❌ 키워드 검색 오류:', error);
      return [];
    }
  }
}

// 싱글톤 인스턴스
export const ragProcessor = new RAGProcessor();
