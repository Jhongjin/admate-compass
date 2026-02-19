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
import { extractKeywords, calculateChunkImportance } from '../utils/KeywordExtractor';
import { adjustChunkBoundary } from '../utils/ChunkBoundaryAdjuster';

export class TXTChunkingStrategy implements DocumentTypeChunkingStrategy {
  getDocumentType(): 'txt' {
    return 'txt';
  }

  canHandle(documentType: string, content?: string): boolean {
    return documentType === 'txt' || documentType.includes('txt') || documentType === 'text';
  }

  getStrategyConfig(contentLength: number, contentType?: string): ChunkingStrategyConfig {
    // TXT는 검색 정확도 향상을 위해 작은 청크로 조정
    const baseChunkSize = 600; // 800 → 600 (검색 정확도 향상)
    const baseOverlap = 80; // 100 → 80

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

    // 전체 청크 컨텍스트 준비 (TF-IDF 계산용)
    const allChunks = textChunks.map(chunk => chunk.trim());

    const chunks: UnifiedChunk[] = textChunks.map((chunk, index) => {
      let startChar = content.indexOf(chunk);
      let endChar = startChar + chunk.length;
      
      // 잘린 텍스트 방지를 위한 경계 조정
      const adjustedBoundary = adjustChunkBoundary(
        content,
        startChar,
        endChar,
        {
          minChunkSize: config.minChunkSize || 100,
          maxChunkSize: config.maxChunkSize || 2000,
          preserveNumbers: true,
          preserveSentences: true,
        }
      );
      
      startChar = adjustedBoundary.start;
      endChar = adjustedBoundary.end;
      
      const trimmedChunk = content.slice(startChar, endChar).trim();
      const position = startChar / content.length; // 문서 내 위치 (0-1)

      // 키워드 추출
      const keywords = extractKeywords(trimmedChunk, 5, {
        allChunks,
        documentTitle,
      });

      // 중요도 점수 계산
      const importance = calculateChunkImportance(
        {
          content: trimmedChunk,
          position,
          hasTitle: trimmedChunk.length < 100 && index === 0,
          hasKeywords: keywords.length > 0,
        },
        {
          totalLength: content.length,
          averageChunkSize: content.length / textChunks.length,
        }
      );

      return {
        id: `${documentId}_chunk_${index}`,
        content: trimmedChunk,
        metadata: {
          documentId,
          documentTitle,
          chunkIndex: index,
          startChar,
          endChar,
          chunkType: 'text' as const,
          hierarchyLevel: 'paragraph' as const,
          // 메타데이터 강화
          keywords: keywords.length > 0 ? keywords : undefined,
          importance: importance > 0.5 ? importance : undefined,
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

