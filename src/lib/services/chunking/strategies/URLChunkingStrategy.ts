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
import { extractHTMLStructureFromText, findSectionForChunk } from '../utils/HTMLStructureExtractor';
import { extractKeywords, calculateChunkImportance } from '../utils/KeywordExtractor';
import { adjustChunkBoundary } from '../utils/ChunkBoundaryAdjuster';

export class URLChunkingStrategy implements DocumentTypeChunkingStrategy {
  getDocumentType(): 'url' {
    return 'url';
  }

  canHandle(documentType: string, content?: string): boolean {
    return documentType === 'url' || documentType.includes('url');
  }

  getStrategyConfig(contentLength: number, contentType?: string): ChunkingStrategyConfig {
    // URL은 HTML 구조를 고려하여 더 작은 청크로 정확도 향상
    const baseChunkSize = 500; // 700 → 500 (검색 정확도 향상)
    const baseOverlap = 60; // 80 → 60

    // 콘텐츠 타입별 조정
    if (contentType === 'faq') {
      // FAQ는 질문-답변 단위로 더 작은 청크
      return {
        chunkSize: 400, // 600 → 400
        chunkOverlap: 50, // 60 → 50
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' ', ''],
        minChunkSize: 100,
        maxChunkSize: 1500,
      };
    }

    if (contentType === 'policy' || contentType === 'help') {
      // 정책/도움말 문서는 작은 청크로 조정
      return {
        chunkSize: 600, // 800 → 600
        chunkOverlap: 80, // 100 → 80
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

    // HTML 구조 정보 추출
    const structureInfo = extractHTMLStructureFromText(content);

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
          maxChunkSize: config.maxChunkSize || 1500,
          preserveNumbers: true,
          preserveSentences: true,
        }
      );
      
      startChar = adjustedBoundary.start;
      endChar = adjustedBoundary.end;
      
      const trimmedChunk = content.slice(startChar, endChar).trim();
      const position = startChar / content.length; // 문서 내 위치 (0-1)

      // 청크가 속한 섹션 정보 찾기
      const sectionInfo = findSectionForChunk(startChar, endChar, structureInfo.sections);

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
          sectionTitle: sectionInfo?.title,
          headingLevel: sectionInfo?.level,
        },
        {
          totalLength: content.length,
          averageChunkSize: content.length / textChunks.length,
        }
      );

      // URL 특화 메타데이터 추출
      const urlMetadata: Record<string, any> = {
        // 페이지 구조 정보
        hasLists: structureInfo.hasLists,
        hasTables: structureInfo.hasTables,
        sectionTitle: sectionInfo?.title,
        headingLevel: sectionInfo?.level,
        // 메타데이터 강화
        keywords: keywords.length > 0 ? keywords : undefined,
        importance: importance > 0.5 ? importance : undefined,
        ...(options?.metadata || {}),
      };

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
          hierarchyLevel: sectionInfo ? 'section' : 'paragraph' as const,
          sectionTitle: sectionInfo?.title,
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

