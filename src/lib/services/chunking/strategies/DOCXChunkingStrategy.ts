/**
 * DOCX 문서 청킹 전략
 * 
 * 특화 사항:
 * - 헤딩/섹션 구조 고려
 * - 문서 구조 정보 보존
 * 
 * 최적 설정:
 * - 청크 크기: 900자
 * - Overlap: 120자 (섹션 경계 보존)
 */

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import type {
  DocumentTypeChunkingStrategy,
  ChunkingStrategyConfig,
  ChunkingResult,
} from '../DocumentTypeChunkingStrategy';
import type { UnifiedChunk } from '../../UnifiedChunkingService';

export class DOCXChunkingStrategy implements DocumentTypeChunkingStrategy {
  getDocumentType(): 'docx' {
    return 'docx';
  }

  canHandle(documentType: string, content?: string): boolean {
    return documentType === 'docx' || documentType.includes('docx') || documentType.includes('doc');
  }

  getStrategyConfig(contentLength: number, contentType?: string): ChunkingStrategyConfig {
    // DOCX는 헤딩 구조를 고려하여 중간 크기 청크 사용
    const baseChunkSize = 900;
    const baseOverlap = 120;

    // 콘텐츠 타입별 조정
    if (contentType === 'policy' || contentType === 'technical') {
      return {
        chunkSize: 1100,
        chunkOverlap: 150,
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
          hierarchyLevel: 'section' as const,
          // DOCX 특화 메타데이터
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
        documentType: 'docx',
        strategy: 'docx-optimized',
      },
    };
  }
}

