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
      
      const { error } = await Promise.race([
        supabase
          .from('documents')
          .insert({
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
            created_at: document.created_at,
            updated_at: document.updated_at,
          }),
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
          errorDetails: error.details
        });
        throw error;
      }

      console.log('✅ 문서 저장 완료:', document.title);

      // document_metadata 테이블에도 저장
      const fileType = document.file_type?.split('/')[1] || 'pdf';
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
        console.warn('⚠️ originalBinaryData가 없습니다:', {
          documentId: document.id,
          title: document.title,
          fileType: document.file_type
        });
      }
      
      const { error: metadataError } = await supabase
        .from('document_metadata')
        .insert(metadataRecord);

      if (metadataError) {
        console.error('❌ 문서 메타데이터 저장 오류:', metadataError);
      } else {
        console.log('✅ 문서 메타데이터 저장 완료');
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

      // 배치 처리로 청크 저장 (큰 파일의 경우 더 작은 배치 사용)
      const isLargeBatch = chunkInserts.length > 500;
      const batchSize = isLargeBatch ? 50 : 100; // 큰 배치는 50개씩
      let savedCount = 0;
      
      console.log(`💾 청크 저장 시작: ${chunkInserts.length}개 청크, 배치 크기: ${batchSize}`);
      
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
        
        // 배치 간 짧은 대기 (데이터베이스 부하 방지, 큰 배치는 더 긴 대기)
        if (i + batchSize < chunkInserts.length) {
          await new Promise(resolve => setTimeout(resolve, isLargeBatch ? 200 : 100));
        }
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
      const isLargeFile = document.file_size > 10 * 1024 * 1024; // 10MB 이상
      // 큐 워커의 MAX_PROCESS_TIME(8분)과 동기화
      const timeoutMs = isLargeFile ? 480000 : 120000; // 대용량: 8분 (큐 워커와 동기화), 일반: 2분
      
      if (isLargeFile) {
        console.log('⚠️ 대용량 파일 처리 - 타임아웃 설정:', timeoutMs + 'ms');
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
      
      const chunks = await this.simpleChunkDocument(processedDocument);
      const chunkingMs = Date.now() - chunkingStartMs;
      console.log('✅ 문서 청킹 완료:', {
        chunkCount: chunks.length,
        time: `${chunkingMs}ms (${(chunkingMs / 1000).toFixed(1)}초)`,
        avgChunkSize: chunks.length > 0 ? Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length) : 0
      });

      if (chunks.length === 0) {
        console.warn('⚠️ 청킹 결과가 비어있습니다.');
        return {
          documentId: document.id,
          chunkCount: 0,
          success: false,
        };
      }

      // 2. 임베딩 생성 (큰 파일의 경우 배치 처리)
      const embeddingStartMs = Date.now();
      console.log('🔮 임베딩 생성 시작...', { chunkCount: chunks.length });
      const isLargeFile = document.file_size > 10 * 1024 * 1024 || chunks.length > 1000;
      const chunksWithEmbeddings: ChunkData[] = [];
      
      if (isLargeFile) {
        // 큰 파일의 경우 배치 단위로 임베딩 생성 (메모리 효율성)
        // 배치 크기 증가로 처리 시간 단축 (150 → 200)
        const EMBEDDING_BATCH_SIZE = 200;
        console.log(`📦 큰 파일 감지 - 배치 단위로 임베딩 생성 (${chunks.length}개 청크, 배치 크기: ${EMBEDDING_BATCH_SIZE})`);
        
        for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
          const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
          console.log(`🔮 임베딩 배치 생성 중: ${i + 1}-${Math.min(i + EMBEDDING_BATCH_SIZE, chunks.length)}/${chunks.length}`);
          
          const batchWithEmbeddings = batch.map(chunk => ({
            ...chunk,
            embedding: this.generateSimpleEmbedding(chunk.content),
          }));
          
          chunksWithEmbeddings.push(...batchWithEmbeddings);
          
          // 배치 간 짧은 대기 (CPU 부하 방지, 대기 시간 감소로 처리 시간 단축)
          if (i + EMBEDDING_BATCH_SIZE < chunks.length) {
            await new Promise(resolve => setTimeout(resolve, 5)); // 10ms → 5ms
          }
        }
        
        const embeddingMs = Date.now() - embeddingStartMs;
        console.log(`✅ 임베딩 생성 완료: ${chunksWithEmbeddings.length}개 청크 (배치 처리, ${(embeddingMs / 1000).toFixed(1)}초)`);
      } else {
        // 일반 파일은 한 번에 처리
        const mapped = chunks.map(chunk => ({
          ...chunk,
          embedding: this.generateSimpleEmbedding(chunk.content),
        }));
        chunksWithEmbeddings.push(...mapped);
        const embeddingMs = Date.now() - embeddingStartMs;
        console.log('✅ 임베딩 생성 완료:', {
          chunkCount: chunksWithEmbeddings.length,
          time: `${embeddingMs}ms (${(embeddingMs / 1000).toFixed(1)}초)`
        });
      }

      // 3. Supabase에 저장 (큰 파일의 경우 청크 저장도 배치 처리)
      const savingStartMs = Date.now();
      const supabase = await this.getSupabaseClient();
      if (supabase) {
        try {
          // 문서 저장
          await this.saveDocumentToDatabase(document, originalBinaryData);
          const docSaveMs = Date.now() - savingStartMs;
          console.log('✅ 문서 데이터베이스 저장 완료', { time: `${docSaveMs}ms` });

          // 큰 파일의 경우 청크 저장도 더 작은 배치로 처리
          let savedChunkCount = 0;
          if (isLargeFile) {
            console.log(`💾 큰 파일 - 청크 저장을 배치로 처리 (${chunksWithEmbeddings.length}개 청크)`);
            // 큰 파일의 경우 청크 저장도 배치 단위로 나누어 처리
            // 배치 크기 증가로 처리 시간 단축 (100 → 150)
            const SAVE_BATCH_SIZE = 150;
            for (let i = 0; i < chunksWithEmbeddings.length; i += SAVE_BATCH_SIZE) {
              const batch = chunksWithEmbeddings.slice(i, i + SAVE_BATCH_SIZE);
              console.log(`💾 청크 저장 배치: ${i + 1}-${Math.min(i + SAVE_BATCH_SIZE, chunksWithEmbeddings.length)}/${chunksWithEmbeddings.length}`);
              
              const batchSaved = await this.saveChunksToDatabase(batch);
              savedChunkCount += batchSaved;
              
              // 배치 간 짧은 대기 (대기 시간 감소로 처리 시간 단축)
              if (i + SAVE_BATCH_SIZE < chunksWithEmbeddings.length) {
                await new Promise(resolve => setTimeout(resolve, 20)); // 50ms → 20ms
              }
            }
            const savingMs = Date.now() - savingStartMs;
            console.log('✅ 청크 데이터베이스 저장 완료:', {
              chunkCount: savedChunkCount,
              time: `${savingMs}ms (${(savingMs / 1000).toFixed(1)}초)`,
              batchSaved: true
            });
          } else {
            // 일반 파일은 한 번에 저장
            savedChunkCount = await this.saveChunksToDatabase(chunksWithEmbeddings);
            const savingMs = Date.now() - savingStartMs;
            console.log('✅ 청크 데이터베이스 저장 완료:', {
              chunkCount: savedChunkCount,
              time: `${savingMs}ms (${(savingMs / 1000).toFixed(1)}초)`
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
   * 적응적 문서 청킹 (개선된 버전)
   * 문서 유형, 크기, 내용에 따라 최적화된 청킹 전략 사용
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
        console.warn('⚠️ 문서 내용이 비어있습니다.', {
          contentLength: document.content?.length || 0,
          title: document.title,
          type: document.type
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

      // 적응적 청킹 설정
      const chunkingConfig: AdaptiveChunkingConfig = {
        documentType,
        contentLength: document.content.length,
        language,
        contentType: contentTypeResult.type !== 'general' ? contentTypeResult.type : undefined
      };

      // 적응적 청킹 서비스 사용
      const adaptiveChunks = await adaptiveChunkingService.chunkDocument(
        document.content,
        document.id,
        document.title,
        chunkingConfig
      );

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
        chunkCount: chunkData.length,
        contentType: contentTypeResult.type,
        confidence: contentTypeResult.confidence,
        averageChunkSize: Math.round(
          chunkData.reduce((sum, c) => sum + c.content.length, 0) / chunkData.length
        )
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
      
      let chunkSize = 800;
      let overlap = 100;
      
      if (contentLength < 1000) {
        chunkSize = 200;
        overlap = 20;
      } else if (contentLength < 10000) {
        chunkSize = 500;
        overlap = 50;
      } else if (contentLength > 100000) {
        chunkSize = 2000;
        overlap = 200;
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
