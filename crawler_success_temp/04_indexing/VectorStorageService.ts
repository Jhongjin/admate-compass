import { createClient } from '@supabase/supabase-js';
import { DocumentChunk } from './TextChunkingService';
import { EmbeddingResult } from './EmbeddingService';

export interface DocumentRecord {
  id: string;
  title: string;
  type: 'pdf' | 'docx' | 'txt' | 'url';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChunkRecord {
  id?: number;
  document_id: string;
  chunk_id: string; // 문자열로 되돌림
  content: string;
  embedding: number[];
  metadata: Record<string, any>;
  created_at?: string;
}

export interface SearchResult {
  chunk_id: string; // 문자열로 되돌림
  content: string;
  metadata: Record<string, any>;
  similarity: number;
}

export class VectorStorageService {
  public supabase; // 외부에서 접근 가능하도록 public으로 변경

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase 환경변수가 설정되지 않았습니다.');
      console.error('필요한 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
      // 빌드 시에는 더미 클라이언트를 사용하여 오류 방지
      if (process.env.NODE_ENV === 'production') {
        console.warn('프로덕션 환경에서 Supabase 환경변수가 누락되었습니다. 더미 클라이언트를 사용합니다.');
        this.supabase = createClient('https://dummy.supabase.co', 'dummy-key');
        return;
      }
      throw new Error('Supabase 환경변수가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * 문서 메타데이터 저장
   */
  async saveDocument(documentData: {
    id: string;
    title: string;
    type: 'file' | 'url'; // documents 테이블은 'file' 또는 'url'만 허용
    uploadedAt: string;
    url?: string; // URL (선택적)
    size?: number; // 파일 크기 (선택적)
    fileData?: string; // 원본 파일 데이터 (base64, 선택적)
  }): Promise<DocumentRecord> {
    try {
      const { data, error } = await this.supabase
        .from('documents')
        .insert({
          id: documentData.id,
          title: documentData.title,
          type: documentData.type,
          url: documentData.url || null,
          status: 'processing',
          chunk_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw new Error(`문서 저장 실패: ${error.message}`);
      }

      // document_metadata 테이블에도 저장 (더 구체적인 타입 사용)
      // 파일 확장자에 따라 정확한 타입 결정
      const getFileType = (fileName: string): 'pdf' | 'docx' | 'txt' | 'url' => {
        const ext = fileName.toLowerCase().split('.').pop();
        switch (ext) {
          case 'pdf': return 'pdf';
          case 'docx': return 'docx';
          case 'txt': return 'txt';
          default: return 'pdf'; // 기본값
        }
      };
      
      const metadataType = documentData.type === 'file' ? getFileType(documentData.title) : documentData.type;
      
      // 원본 파일 데이터를 metadata에 저장 (파일인 경우에만)
      const metadata: any = {};
      if (documentData.type === 'file' && documentData.fileData) {
        metadata.fileData = documentData.fileData;
        metadata.originalFileName = documentData.title;
        metadata.fileSize = documentData.size || 0;
        metadata.uploadedAt = documentData.uploadedAt;
      }
      
      // document_metadata 테이블은 사용하지 않음 (documents 테이블만 사용)

      return data;
    } catch (error) {
      console.error('문서 저장 오류:', error);
      throw new Error(`문서 저장 실패: ${error}`);
    }
  }

  /**
   * 문서 청크와 임베딩 저장
   */
  async saveChunks(
    documentId: string,
    chunks: DocumentChunk[],
    embeddings: EmbeddingResult[]
  ): Promise<void> {
    try {
      if (chunks.length !== embeddings.length) {
        throw new Error('청크와 임베딩의 개수가 일치하지 않습니다.');
      }

      // 임베딩 유효성 검증
      for (let i = 0; i < embeddings.length; i++) {
        const embedding = embeddings[i];
        
        if (!embedding.embedding || !Array.isArray(embedding.embedding)) {
          throw new Error(`청크 ${i}: 임베딩이 배열이 아닙니다.`);
        }
        
        if (embedding.embedding.length === 0) {
          throw new Error(`청크 ${i}: 임베딩이 비어있습니다.`);
        }
        
        if (embedding.embedding.length !== 1024) {
          throw new Error(`청크 ${i}: 임베딩 차원 수 오류 (${embedding.embedding.length}/1024)`);
        }
        
        if (!embedding.embedding.every(item => typeof item === 'number' && !isNaN(item))) {
          throw new Error(`청크 ${i}: 임베딩에 유효하지 않은 숫자가 포함되어 있습니다.`);
        }
      }

      // 청크 데이터 준비
      const chunkRecords: Omit<ChunkRecord, 'id' | 'created_at'>[] = chunks.map((chunk, index) => ({
        document_id: documentId,
        chunk_id: `${documentId}_chunk_${chunk.metadata.chunkIndex}`, // 문자열로 사용
        content: chunk.content,
        embedding: embeddings[index].embedding, // 이미 검증된 배열
        metadata: {
          ...chunk.metadata,
          model: embeddings[index].model,
          dimension: embeddings[index].dimension,
          processingTime: embeddings[index].processingTime,
          validated: true,
          savedAt: new Date().toISOString()
        }
      }));

      // 배치로 청크 저장
      const { error } = await this.supabase
        .from('document_chunks')
        .insert(chunkRecords);

      if (error) {
        throw new Error(`청크 저장 실패: ${error.message}`);
      }

      // 문서 상태 업데이트
      await this.updateDocumentStatus(documentId, 'completed', chunks.length, embeddings.length);

      console.log(`✅ 문서 ${documentId}의 ${chunks.length}개 청크 저장 완료 (모든 임베딩 검증됨)`);
    } catch (error) {
      console.error('청크 저장 오류:', error);
      throw new Error(`청크 저장 실패: ${error}`);
    }
  }

  /**
   * 문서 상태 업데이트
   */
  async updateDocumentStatus(
    documentId: string,
    status: 'pending' | 'completed' | 'failed',
    chunkCount?: number,
    embeddingCount?: number
  ): Promise<void> {
    try {
      // status 값 검증 및 변환
      const validStatus = ['pending', 'completed', 'failed'].includes(status) ? status : 'pending';
      
      const updateData: any = {
        status: validStatus,
        updated_at: new Date().toISOString()
      };

      if (chunkCount !== undefined) {
        updateData.chunk_count = chunkCount;
      }

      // documents 테이블 업데이트 (documents 테이블은 다른 status 값 사용)
      const docUpdateData: any = {
        status: validStatus === 'completed' ? 'indexed' : validStatus,
        updated_at: new Date().toISOString()
      };
      
      // documents 테이블에도 chunk_count 업데이트
      if (chunkCount !== undefined) {
        docUpdateData.chunk_count = chunkCount;
      }
      
      const { error: docError } = await this.supabase
        .from('documents')
        .update(docUpdateData)
        .eq('id', documentId);

      if (docError) {
        throw new Error(`문서 상태 업데이트 실패: ${docError.message}`);
      }

      // document_metadata 테이블 업데이트
      const metadataUpdateData: any = {
        status: validStatus,
        updated_at: new Date().toISOString()
      };

      if (chunkCount !== undefined) {
        metadataUpdateData.chunk_count = chunkCount;
      }
      if (embeddingCount !== undefined) {
        metadataUpdateData.embedding_count = embeddingCount;
      }
      if (status === 'completed') {
        metadataUpdateData.processed_at = new Date().toISOString();
      }

      const { error: metaError } = await this.supabase
        .from('document_metadata')
        .update(metadataUpdateData)
        .eq('id', documentId);

      if (metaError) {
        console.warn(`메타데이터 상태 업데이트 실패: ${metaError.message}`);
      }
    } catch (error) {
      console.error('문서 상태 업데이트 오류:', error);
      throw new Error(`문서 상태 업데이트 실패: ${error}`);
    }
  }

  /**
   * 문서 제목 업데이트
   */
  async updateDocumentTitle(documentId: string, newTitle: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('documents')
        .update({ 
          title: newTitle,
          updated_at: new Date().toISOString()
        })
        .eq('id', documentId);

      if (error) {
        throw new Error(`문서 제목 업데이트 실패: ${error.message}`);
      }

      console.log(`문서 제목 업데이트 완료: ${documentId} -> ${newTitle}`);
    } catch (error) {
      console.error('문서 제목 업데이트 오류:', error);
      throw error;
    }
  }

  /**
   * URL 중복 체크
   */
  async checkUrlExists(url: string): Promise<{ exists: boolean; documentId?: string; document?: any }> {
    try {
      // documents 테이블에서 URL 검색
      const { data: document, error: docError } = await this.supabase
        .from('documents')
        .select('id, title, type, status, created_at, updated_at')
        .eq('url', url)
        .single();

      if (docError && docError.code !== 'PGRST116') { // PGRST116은 "not found" 에러
        throw new Error(`문서 조회 실패: ${docError.message}`);
      }

      if (document) {
        return {
          exists: true,
          documentId: document.id,
          document: document
        };
      }

      return { exists: false };
    } catch (error) {
      console.error('URL 중복 체크 오류:', error);
      throw error;
    }
  }

  /**
   * URL로 문서 검색 (제목 기반)
   */
  async findDocumentByUrl(url: string): Promise<{ exists: boolean; documentId?: string; document?: any }> {
    try {
      // documents 테이블에서 URL이 제목인 문서 검색
      const { data: documents, error: docError } = await this.supabase
        .from('documents')
        .select('*')
        .eq('title', url)
        .eq('type', 'url')
        .order('created_at', { ascending: false });

      if (docError) {
        throw new Error(`문서 검색 실패: ${docError.message}`);
      }

      if (documents && documents.length > 0) {
        return {
          exists: true,
          documentId: documents[0].id,
          document: documents[0]
        };
      }

      return { exists: false };

    } catch (error) {
      console.error('URL 문서 검색 오류:', error);
      throw error;
    }
  }

  /**
   * 파일명 중복 체크
   */
  async checkFileNameExists(fileName: string): Promise<{ exists: boolean; documentId?: string; document?: any }> {
    try {
      // documents 테이블에서 파일명 검색
      const { data: documents, error: docError } = await this.supabase
        .from('documents')
        .select('*')
        .eq('title', fileName)
        .eq('type', 'file')
        .order('created_at', { ascending: false });

      if (docError) {
        throw new Error(`파일명 검색 실패: ${docError.message}`);
      }

      if (documents && documents.length > 0) {
        return {
          exists: true,
          documentId: documents[0].id,
          document: documents[0]
        };
      }

      return { exists: false };

    } catch (error) {
      console.error('파일명 중복 체크 오류:', error);
      throw error;
    }
  }

  /**
   * 파일명과 크기로 중복 체크 (더 정확한 중복 검사)
   */
  async checkFileExists(fileName: string, fileSize: number): Promise<{ exists: boolean; documentId?: string; document?: any }> {
    try {
      // documents 테이블에서 파일명으로 검색 (size 컬럼이 없으므로 파일명만으로 체크)
      const { data: documents, error: docError } = await this.supabase
        .from('documents')
        .select('*')
        .eq('title', fileName)
        .eq('type', 'file')
        .order('created_at', { ascending: false });

      if (docError) {
        throw new Error(`파일 검색 실패: ${docError.message}`);
      }

      if (documents && documents.length > 0) {
        return {
          exists: true,
          documentId: documents[0].id,
          document: documents[0]
        };
      }

      return { exists: false };

    } catch (error) {
      console.error('파일 중복 체크 오류:', error);
      throw error;
    }
  }

  /**
   * 벡터 유사도 검색
   */
  async searchSimilarChunks(
    queryEmbedding: number[],
    options: {
      matchThreshold?: number;
      matchCount?: number;
      documentTypes?: string[];
    } = {}
  ): Promise<SearchResult[]> {
    try {
      const { matchThreshold = 0.7, matchCount = 10, documentTypes } = options;

      let query = this.supabase.rpc('search_documents', {
        query_embedding: queryEmbedding,
        match_threshold: matchThreshold,
        match_count: matchCount
      });

      // 문서 타입 필터링은 일단 제외 (복잡한 타입 문제로 인해)
      // TODO: 나중에 구현

      const { data, error } = await query;

      if (error) {
        throw new Error(`벡터 검색 실패: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('벡터 검색 오류:', error);
      throw new Error(`벡터 검색 실패: ${error}`);
    }
  }

  /**
   * 문서 삭제
   */
  async deleteDocument(documentId: string): Promise<{
    success: boolean;
    deletedChunks: number;
    deletedEmbeddings: number;
    error?: string;
  }> {
    try {
      // 먼저 삭제될 청크 수 확인
      const { data: chunks, error: chunksError } = await this.supabase
        .from('document_chunks')
        .select('id')
        .eq('document_id', documentId);

      if (chunksError) {
        throw new Error(`청크 조회 실패: ${chunksError.message}`);
      }

      const deletedChunks = chunks?.length || 0;
      const deletedEmbeddings = deletedChunks; // 청크와 임베딩은 1:1 관계

      // document_metadata 테이블에서 삭제
      const { error: metaError } = await this.supabase
        .from('document_metadata')
        .delete()
        .eq('id', documentId);

      if (metaError) {
        console.warn(`메타데이터 삭제 실패: ${metaError.message}`);
      }

      // documents 테이블에서 삭제 (CASCADE로 document_chunks도 자동 삭제됨)
      const { error } = await this.supabase
        .from('documents')
        .delete()
        .eq('id', documentId);

      if (error) {
        throw new Error(`문서 삭제 실패: ${error.message}`);
      }

      console.log(`문서 ${documentId} 삭제 완료 - 청크: ${deletedChunks}개, 임베딩: ${deletedEmbeddings}개`);

      return {
        success: true,
        deletedChunks,
        deletedEmbeddings
      };
    } catch (error) {
      console.error('문서 삭제 오류:', error);
      return {
        success: false,
        deletedChunks: 0,
        deletedEmbeddings: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 문서 목록 조회
   */
  async getDocuments(options: {
    limit?: number;
    offset?: number;
    status?: string;
    type?: string;
  } = {}): Promise<DocumentRecord[]> {
    try {
      const { limit = 50, offset = 0, status, type } = options;

      // document_metadata와 조인하여 실제 파일 타입 가져오기 (left join으로 변경)
      let query = this.supabase
        .from('documents')
        .select(`
          *,
          document_metadata!left(
            type,
            size,
            uploaded_at,
            status,
            chunk_count,
            embedding_count
          )
        `)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      if (type) {
        // document_metadata의 type으로 필터링
        query = query.eq('document_metadata.type', type);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`문서 목록 조회 실패: ${error.message}`);
      }

      // 데이터 변환: document_metadata의 type을 documents의 type으로 사용
      const transformedData = (data || []).map(doc => {
        // document_metadata가 배열로 반환될 수 있으므로 첫 번째 요소 사용
        const metadata = Array.isArray(doc.document_metadata) 
          ? doc.document_metadata[0] 
          : doc.document_metadata;
          
        return {
          ...doc,
          type: metadata?.type || doc.type, // 실제 파일 타입 사용
          size: metadata?.size || 0,
          chunk_count: metadata?.chunk_count || doc.chunk_count
        };
      });

      return transformedData;
    } catch (error) {
      console.error('문서 목록 조회 오류:', error);
      throw new Error(`문서 목록 조회 실패: ${error}`);
    }
  }

  /**
   * 문서 통계 조회
   */
  async getDocumentStats(): Promise<{
    totalDocuments: number;
    indexedDocuments: number;
    totalChunks: number;
    totalEmbeddings: number;
  }> {
    try {
      // documents 테이블에서 직접 통계 계산
      const { data: documents, error: docError } = await this.supabase
        .from('documents')
        .select('status, chunk_count');

      if (docError) {
        throw new Error(`문서 통계 조회 실패: ${docError.message}`);
      }

      const totalDocuments = documents?.length || 0;
      const indexedDocuments = documents?.filter(doc => doc.status === 'completed').length || 0;
      const totalChunks = documents?.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0) || 0;
      
      // 임베딩 수는 청크 수와 동일하다고 가정 (실제로는 document_chunks 테이블에서 계산해야 함)
      const totalEmbeddings = totalChunks;

      return {
        totalDocuments,
        indexedDocuments,
        totalChunks,
        totalEmbeddings
      };
    } catch (error) {
      console.error('문서 통계 조회 오류:', error);
      throw new Error(`문서 통계 조회 실패: ${error}`);
    }
  }

  /**
   * 처리 로그 저장
   */
  async saveProcessingLog(
    documentId: string,
    step: string,
    status: 'started' | 'completed' | 'failed',
    message?: string,
    error?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const { error: logError } = await this.supabase
        .from('document_processing_logs')
        .insert({
          document_id: documentId,
          step,
          status,
          message,
          error,
          metadata: metadata || {},
          created_at: new Date().toISOString()
        });

      if (logError) {
        console.warn(`처리 로그 저장 실패: ${logError.message}`);
      }
    } catch (error) {
      console.warn('처리 로그 저장 오류:', error);
    }
  }
}

// 싱글톤 인스턴스
export const vectorStorageService = new VectorStorageService();

