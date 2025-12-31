/**
 * URL 콘텐츠 청킹 전략
 * 
 * 특화 사항:
 * - HTML 구조 고려
 * - 섹션/헤딩 기반 청킹
 * - 더 작은 청크로 정확도 향상
 * 
 * 최적 설정:
 * - 청크 크기: 700자
 * - Overlap: 80자 (섹션 경계 보존)
 */

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import type {
  DocumentTypeChunkingStrategy,
  ChunkingStrategyConfig,
  ChunkingResult,
} from '../DocumentTypeChunkingStrategy';
import type { UnifiedChunk } from '../../UnifiedChunkingService';

export class URLChunkingStrategy implements DocumentTypeChunkingStrategy {
  getDocumentType(): 'url' {
    return 'url';
  }

  canHandle(documentType: string, content?: string): boolean {
    return documentType === 'url' || documentType.includes('url');
  }

  getStrategyConfig(contentLength: number, contentType?: string): ChunkingStrategyConfig {
    // URL은 HTML 구조를 고려하여 더 작은 청크로 정확도 향상
    const baseChunkSize = 700;
    const baseOverlap = 80;

    // 콘텐츠 타입별 조정
    if (contentType === 'faq') {
      // FAQ는 질문-답변 단위로 더 작은 청크
      return {
        chunkSize: 600,
        chunkOverlap: 60,
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' ', ''],
        minChunkSize: 100,
        maxChunkSize: 1500,
      };
    }

    if (contentType === 'policy' || contentType === 'help') {
      // 정책/도움말 문서는 중간 크기
      return {
        chunkSize: 800,
        chunkOverlap: 100,
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' ', ''],
        minChunkSize: 150,
        maxChunkSize: 1500,
      };
    }

    return {
      chunkSize: baseChunkSize,
      chunkOverlap: baseOverlap,
      separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' ', ''],
      minChunkSize: 100,
      maxChunkSize: 1500,
    };
  }

  async chunk(
    content: string,
    documentId: string,
    documentTitle: string,
    options?: {
      contentType?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<ChunkingResult> {
    const config = this.getStrategyConfig(content.length, options?.contentType);

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      separators: config.separators,
    });

    const textChunks = await textSplitter.splitText(content);

    const chunks: UnifiedChunk[] = textChunks.map((chunk, index) => {
      const startChar = content.indexOf(chunk);
      const endChar = startChar + chunk.length;

      // URL 특화 메타데이터 추출 (옵션)
      const urlMetadata: Record<string, any> = {
        // 페이지 구조 정보 (나중에 HTML 파싱으로 보강 가능)
        ...(options?.metadata || {}),
      };

      return {
        id: `${documentId}_chunk_${index}`,
        content: chunk.trim(),
        metadata: {
          documentId,
          documentTitle,
          chunkIndex: index,
          startChar,
          endChar,
          chunkType: 'text' as const,
          hierarchyLevel: 'section' as const,
          ...urlMetadata,
        },
      };
    });

    const totalChunkSize = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    const averageChunkSize = chunks.length > 0
      ? Math.round(totalChunkSize / chunks.length)
      : 0;
    const coverage = content.length > 0
      ? Math.round((totalChunkSize / content.length) * 100)
      : 0;

    return {
      chunks,
      metadata: {
        totalChunks: chunks.length,
        averageChunkSize,
        coverage,
        documentType: 'url',
        strategy: 'url-optimized',
      },
    };
  }
}

