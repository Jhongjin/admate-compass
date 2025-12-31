/**
 * 문서 타입별 청킹 전략 인터페이스
 * 각 문서 타입(PDF, DOCX, TXT, URL)에 최적화된 청킹 전략을 정의
 * 
 * 목적:
 * - 문서 타입별 최적 청크 크기 및 Overlap 적용
 * - RAG 검색 품질 향상
 * - 컨텍스트 손실 최소화
 */

import type { UnifiedChunk } from '../UnifiedChunkingService';

export interface ChunkingStrategyConfig {
  chunkSize: number;
  chunkOverlap: number;
  separators: string[];
  minChunkSize?: number;
  maxChunkSize?: number;
}

export interface ChunkingResult {
  chunks: UnifiedChunk[];
  metadata: {
    totalChunks: number;
    averageChunkSize: number;
    coverage: number;
    documentType: string;
    strategy: string;
  };
}

export interface DocumentTypeChunkingStrategy {
  /**
   * 문서 타입 반환
   */
  getDocumentType(): 'pdf' | 'docx' | 'txt' | 'url';

  /**
   * 이 전략이 적용 가능한지 확인
   * @param documentType 문서 타입
   * @param content 콘텐츠 (선택적, 일부 전략은 콘텐츠 분석 필요)
   */
  canHandle(documentType: string, content?: string): boolean;

  /**
   * 청킹 전략 설정 반환
   * @param contentLength 콘텐츠 길이
   * @param contentType 콘텐츠 타입 (선택적)
   */
  getStrategyConfig(contentLength: number, contentType?: string): ChunkingStrategyConfig;

  /**
   * 청킹 실행
   * @param content 콘텐츠
   * @param documentId 문서 ID
   * @param documentTitle 문서 제목
   * @param options 추가 옵션
   */
  chunk(
    content: string,
    documentId: string,
    documentTitle: string,
    options?: {
      contentType?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<ChunkingResult>;
}

