/**
 * TXT 문서 청킹 전략
 * 
 * 특화 사항:
 * - 한국어 특화 청킹
 * - 현재 로직 유지 (검증된 안정성)
 * 
 * 최적 설정:
 * - 청크 크기: 800자 (현재 유지)
 * - Overlap: 100자 (현재 유지)
 */

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import type {
  DocumentTypeChunkingStrategy,
  ChunkingStrategyConfig,
  ChunkingResult,
} from '../DocumentTypeChunkingStrategy';
import type { UnifiedChunk } from '../../UnifiedChunkingService';

export class TXTChunkingStrategy implements DocumentTypeChunkingStrategy {
  getDocumentType(): 'txt' {
    return 'txt';
  }

  canHandle(documentType: string, content?: string): boolean {
    return documentType === 'txt' || documentType.includes('txt') || documentType === 'text';
  }

  getStrategyConfig(contentLength: number, contentType?: string): ChunkingStrategyConfig {
    // TXT는 현재 검증된 설정 유지
    const baseChunkSize = 800;
    const baseOverlap = 100;

    return {
      chunkSize: baseChunkSize,
      chunkOverlap: baseOverlap,
      separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' ', ''],
      minChunkSize: 100,
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
          // TXT 특화 메타데이터
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
        documentType: 'txt',
        strategy: 'txt-optimized',
      },
    };
  }
}

