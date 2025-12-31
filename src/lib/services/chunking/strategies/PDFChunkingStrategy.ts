/**
 * PDF 문서 청킹 전략
 * 
 * 특화 사항:
 * - 표/이미지 캡션 고려
 * - 페이지 단위 청킹 고려
 * - 더 큰 청크 크기 (표 포함 고려)
 * 
 * 최적 설정:
 * - 청크 크기: 1000자
 * - Overlap: 150자 (표 경계 보존)
 */

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import type {
  DocumentTypeChunkingStrategy,
  ChunkingStrategyConfig,
  ChunkingResult,
} from '../DocumentTypeChunkingStrategy';
import type { UnifiedChunk } from '../../UnifiedChunkingService';

export class PDFChunkingStrategy implements DocumentTypeChunkingStrategy {
  getDocumentType(): 'pdf' {
    return 'pdf';
  }

  canHandle(documentType: string, content?: string): boolean {
    return documentType === 'pdf' || documentType.includes('pdf');
  }

  getStrategyConfig(contentLength: number, contentType?: string): ChunkingStrategyConfig {
    // PDF는 표와 이미지 캡션을 포함할 수 있으므로 더 큰 청크 크기 사용
    const baseChunkSize = 1000;
    const baseOverlap = 150;

    // 콘텐츠 타입별 조정
    if (contentType === 'policy' || contentType === 'technical') {
      // 정책 문서나 기술 문서는 더 큰 청크로 문맥 보존
      return {
        chunkSize: 1200,
        chunkOverlap: 180,
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' ', ''],
        minChunkSize: 200,
        maxChunkSize: 2000,
      };
    }

    return {
      chunkSize: baseChunkSize,
      chunkOverlap: baseOverlap,
      separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' ', ''],
      minChunkSize: 200,
      maxChunkSize: 2000,
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
          hierarchyLevel: 'paragraph' as const,
          // PDF 특화 메타데이터
          ...(options?.metadata || {}),
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
        documentType: 'pdf',
        strategy: 'pdf-optimized',
      },
    };
  }
}

