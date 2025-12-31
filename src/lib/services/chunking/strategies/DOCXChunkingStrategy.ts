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
import { extractKeywords, calculateChunkImportance } from '../utils/KeywordExtractor';
import { adjustChunkBoundary } from '../utils/ChunkBoundaryAdjuster';

export class DOCXChunkingStrategy implements DocumentTypeChunkingStrategy {
  getDocumentType(): 'docx' {
    return 'docx';
  }

  canHandle(documentType: string, content?: string): boolean {
    return documentType === 'docx' || documentType.includes('docx') || documentType.includes('doc');
  }

  getStrategyConfig(contentLength: number, contentType?: string): ChunkingStrategyConfig {
    // DOCX는 헤딩 구조를 고려하여 작은 청크로 검색 정확도 향상
    const baseChunkSize = 700; // 900 → 700 (검색 정확도 향상)
    const baseOverlap = 100; // 120 → 100

    // 콘텐츠 타입별 조정
    if (contentType === 'policy' || contentType === 'technical') {
      return {
        chunkSize: 800, // 1100 → 800
        chunkOverlap: 120, // 150 → 120
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
          minChunkSize: config.minChunkSize || 200,
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
          hierarchyLevel: 'section' as const,
          // 메타데이터 강화
          keywords: keywords.length > 0 ? keywords : undefined,
          importance: importance > 0.5 ? importance : undefined,
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

