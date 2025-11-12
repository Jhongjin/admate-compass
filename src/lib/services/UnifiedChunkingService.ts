/**
 * 통합 청킹 서비스
 * 모든 청킹 로직을 단일 서비스로 통합하여 일관성과 유지보수성 향상
 * 
 * 표준 청크 크기: 800-1000자 (문서 크기에 따라 조정)
 * 표준 Overlap: 100-150자
 */

import { adaptiveChunkingService, AdaptiveChunkingConfig, AdaptiveChunk } from './AdaptiveChunkingService';
import { processTextEncoding } from '../utils/textEncoding';

export interface UnifiedChunkingOptions {
  // 표준 청크 크기 (800-1000자 범위)
  chunkSize?: number; // 기본값: 800
  chunkOverlap?: number; // 기본값: 100
  // 문서 타입
  documentType?: 'pdf' | 'docx' | 'txt' | 'url';
  // 콘텐츠 타입 (자동 감지 또는 수동 지정)
  contentType?: 'technical' | 'marketing' | 'policy' | 'faq' | 'general';
  // 언어
  language?: 'ko' | 'en' | 'mixed';
  // 최적화 옵션
  optimizeForSpeed?: boolean; // 분할 처리 시 속도 최적화
  // 최소/최대 청크 크기
  minChunkSize?: number; // 기본값: 100
  maxChunkSize?: number; // 기본값: 2000
}

export interface UnifiedChunk {
  id: string;
  content: string;
  metadata: {
    documentId: string;
    documentTitle: string;
    chunkIndex: number;
    startChar: number;
    endChar: number;
    chunkType?: 'text' | 'table' | 'title' | 'list';
    // 확장 메타데이터
    sectionTitle?: string;
    keywords?: string[];
    importance?: number;
    hierarchyLevel?: 'document' | 'section' | 'paragraph' | 'sentence';
  };
}

export interface ChunkingResult {
  chunks: UnifiedChunk[];
  metadata: {
    totalChunks: number;
    averageChunkSize: number;
    originalLength: number;
    coverage: number; // 원본 텍스트 커버리지 (%)
    processingTimeMs: number;
    // 성능 메트릭
    performance: {
      encodingTimeMs: number;
      chunkingTimeMs: number;
      totalTimeMs: number;
      chunksPerSecond: number;
      memoryUsageMB?: number;
    };
  };
}

export class UnifiedChunkingService {
  // 표준 청크 크기 설정
  private readonly DEFAULT_CHUNK_SIZE = 800;
  private readonly DEFAULT_CHUNK_OVERLAP = 100;
  private readonly MIN_CHUNK_SIZE = 100;
  private readonly MAX_CHUNK_SIZE = 2000;

  /**
   * 통합 청킹 메서드
   * 모든 문서 타입에 대해 일관된 청킹 제공
   */
  async chunkDocument(
    content: string,
    documentId: string,
    documentTitle: string,
    options: UnifiedChunkingOptions = {}
  ): Promise<ChunkingResult> {
    const totalStartTime = Date.now();
    const performanceMetrics = {
      encodingTimeMs: 0,
      chunkingTimeMs: 0,
      totalTimeMs: 0,
      chunksPerSecond: 0,
      memoryUsageMB: undefined as number | undefined,
    };

    try {
      // 입력 검증
      if (!content || typeof content !== 'string') {
        throw new Error('유효하지 않은 콘텐츠입니다.');
      }

      // 메모리 사용량 측정 시작
      const memoryBefore = process.memoryUsage?.()?.heapUsed || 0;

      // UTF-8 인코딩 보장
      const encodingStartTime = Date.now();
      const encodingResult = processTextEncoding(content, { strictMode: true });
      const cleanContent = encodingResult.cleanedText;
      performanceMetrics.encodingTimeMs = Date.now() - encodingStartTime;

      if (!cleanContent || cleanContent.trim().length === 0) {
        console.warn('⚠️ 문서 내용이 비어있습니다.');
        return {
          chunks: [],
          metadata: {
            totalChunks: 0,
            averageChunkSize: 0,
            originalLength: 0,
            coverage: 0,
            processingTimeMs: Date.now() - startTime,
          },
        };
      }

      // 청크 크기 검증 및 조정
      const chunkSize = this.validateChunkSize(
        options.chunkSize || this.DEFAULT_CHUNK_SIZE,
        options.minChunkSize || this.MIN_CHUNK_SIZE,
        options.maxChunkSize || this.MAX_CHUNK_SIZE
      );

      const chunkOverlap = this.validateOverlap(
        options.chunkOverlap || this.DEFAULT_CHUNK_OVERLAP,
        chunkSize
      );

      // 언어 자동 감지
      const language = options.language || this.detectLanguage(cleanContent);

      // 문서 타입 결정
      const documentType = options.documentType || this.detectDocumentType(documentTitle);

      // 콘텐츠 타입 자동 감지 (지정되지 않은 경우)
      const contentType = options.contentType || this.detectContentType(cleanContent, documentTitle);

      // AdaptiveChunkingService 사용
      const adaptiveConfig: AdaptiveChunkingConfig = {
        documentType,
        contentLength: cleanContent.length,
        language,
        contentType,
        optimizeForSpeed: options.optimizeForSpeed || false,
      };

      console.log('📦 통합 청킹 시작:', {
        documentId,
        documentTitle,
        contentLength: cleanContent.length,
        chunkSize,
        chunkOverlap,
        documentType,
        contentType,
        language,
      });

      // 청킹 시간 측정
      const chunkingStartTime = Date.now();
      const adaptiveChunks = await adaptiveChunkingService.chunkDocument(
        cleanContent,
        documentId,
        documentTitle,
        adaptiveConfig
      );
      performanceMetrics.chunkingTimeMs = Date.now() - chunkingStartTime;

      // UnifiedChunk 형식으로 변환
      const unifiedChunks: UnifiedChunk[] = adaptiveChunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        metadata: {
          documentId: chunk.metadata.documentId,
          documentTitle: chunk.metadata.documentTitle,
          chunkIndex: chunk.metadata.chunkIndex,
          startChar: chunk.metadata.startChar,
          endChar: chunk.metadata.endChar,
          chunkType: chunk.metadata.chunkType as 'text' | 'table' | 'title' | 'list' | undefined,
          sectionTitle: chunk.metadata.sectionTitle,
          keywords: chunk.metadata.keywords,
          importance: chunk.metadata.importance,
          hierarchyLevel: chunk.metadata.hierarchyLevel,
        },
      }));

      // 메모리 사용량 측정 종료
      const memoryAfter = process.memoryUsage?.()?.heapUsed || 0;
      performanceMetrics.memoryUsageMB = memoryBefore > 0 && memoryAfter > 0
        ? Number(((memoryAfter - memoryBefore) / (1024 * 1024)).toFixed(2))
        : undefined;

      const totalTime = Date.now() - totalStartTime;
      performanceMetrics.totalTimeMs = totalTime;
      performanceMetrics.chunksPerSecond = unifiedChunks.length > 0 && totalTime > 0
        ? Number((unifiedChunks.length / (totalTime / 1000)).toFixed(2))
        : 0;

      const totalChunkSize = unifiedChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
      const averageChunkSize = unifiedChunks.length > 0
        ? Math.round(totalChunkSize / unifiedChunks.length)
        : 0;
      const coverage = cleanContent.length > 0
        ? Math.round((totalChunkSize / cleanContent.length) * 100)
        : 0;

      console.log('✅ 통합 청킹 완료:', {
        documentId,
        totalChunks: unifiedChunks.length,
        averageChunkSize,
        coverage: `${coverage}%`,
        processingTimeMs: totalTime,
        performance: {
          encodingTime: `${performanceMetrics.encodingTimeMs}ms`,
          chunkingTime: `${performanceMetrics.chunkingTimeMs}ms`,
          totalTime: `${totalTime}ms`,
          chunksPerSecond: performanceMetrics.chunksPerSecond,
          memoryUsage: performanceMetrics.memoryUsageMB !== undefined
            ? `${performanceMetrics.memoryUsageMB}MB`
            : 'N/A',
        },
      });

      return {
        chunks: unifiedChunks,
        metadata: {
          totalChunks: unifiedChunks.length,
          averageChunkSize,
          originalLength: cleanContent.length,
          coverage,
          processingTimeMs: totalTime,
          performance: performanceMetrics,
        },
      };
    } catch (error) {
      const processingTime = Date.now() - totalStartTime;
      performanceMetrics.totalTimeMs = processingTime;
      console.error('❌ 통합 청킹 실패:', error);
      
      // 폴백: 간단한 청킹
      return this.fallbackChunking(content, documentId, documentTitle, options, processingTime, performanceMetrics);
    }
  }

  /**
   * 폴백 청킹 (에러 발생 시)
   */
  private fallbackChunking(
    content: string,
    documentId: string,
    documentTitle: string,
    options: UnifiedChunkingOptions,
    processingTime: number,
    performanceMetrics: { encodingTimeMs: number; chunkingTimeMs: number; totalTimeMs: number; chunksPerSecond: number; memoryUsageMB?: number }
  ): ChunkingResult {
    try {
      const chunkSize = options.chunkSize || this.DEFAULT_CHUNK_SIZE;
      const chunkOverlap = options.chunkOverlap || this.DEFAULT_CHUNK_OVERLAP;
      const minChunkSize = options.minChunkSize || this.MIN_CHUNK_SIZE;

      const chunks: UnifiedChunk[] = [];
      let startIndex = 0;
      let chunkIndex = 0;

      while (startIndex < content.length && chunkIndex < 500) {
        const endIndex = Math.min(startIndex + chunkSize, content.length);
        let chunkContent = content.slice(startIndex, endIndex).trim();

        // 문장 경계에서 자르기
        if (endIndex < content.length) {
          const lastSentenceEnd = Math.max(
            chunkContent.lastIndexOf('. '),
            chunkContent.lastIndexOf('! '),
            chunkContent.lastIndexOf('? '),
            chunkContent.lastIndexOf('\n\n')
          );

          if (lastSentenceEnd > chunkSize * 0.5) {
            chunkContent = chunkContent.substring(0, lastSentenceEnd + 2).trim();
          }
        }

        if (chunkContent.length >= minChunkSize) {
          chunks.push({
            id: `${documentId}_chunk_${chunkIndex}`,
            content: chunkContent,
            metadata: {
              documentId,
              documentTitle,
              chunkIndex,
              startChar: startIndex,
              endChar: startIndex + chunkContent.length,
              chunkType: 'text',
            },
          });
          chunkIndex++;
        }

        startIndex = startIndex + chunkContent.length - chunkOverlap;
        if (startIndex <= 0) startIndex = endIndex;
      }

      const totalChunkSize = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
      const averageChunkSize = chunks.length > 0
        ? Math.round(totalChunkSize / chunks.length)
        : 0;
      const coverage = content.length > 0
        ? Math.round((totalChunkSize / content.length) * 100)
        : 0;

      console.log('⚠️ 폴백 청킹 완료:', {
        documentId,
        totalChunks: chunks.length,
        averageChunkSize,
        coverage: `${coverage}%`,
      });

      return {
        chunks,
        metadata: {
          totalChunks: chunks.length,
          averageChunkSize,
          originalLength: content.length,
          coverage,
          processingTimeMs: processingTime,
          performance: {
            ...performanceMetrics,
            chunksPerSecond: chunks.length > 0 && processingTime > 0
              ? Number((chunks.length / (processingTime / 1000)).toFixed(2))
              : 0,
          },
        },
      };
    } catch (error) {
      console.error('❌ 폴백 청킹도 실패:', error);
      return {
        chunks: [],
        metadata: {
          totalChunks: 0,
          averageChunkSize: 0,
          originalLength: content.length,
          coverage: 0,
          processingTimeMs: processingTime,
          performance: performanceMetrics,
        },
      };
    }
  }

  /**
   * 청크 크기 검증 및 조정
   */
  private validateChunkSize(
    chunkSize: number,
    minSize: number,
    maxSize: number
  ): number {
    if (chunkSize < minSize) {
      console.warn(`⚠️ 청크 크기가 너무 작습니다 (${chunkSize}). 최소값(${minSize})으로 조정합니다.`);
      return minSize;
    }
    if (chunkSize > maxSize) {
      console.warn(`⚠️ 청크 크기가 너무 큽니다 (${chunkSize}). 최대값(${maxSize})으로 조정합니다.`);
      return maxSize;
    }
    return chunkSize;
  }

  /**
   * Overlap 검증 및 조정
   */
  private validateOverlap(overlap: number, chunkSize: number): number {
    const maxOverlap = Math.floor(chunkSize * 0.3); // 최대 30%
    if (overlap > maxOverlap) {
      console.warn(`⚠️ Overlap이 너무 큽니다 (${overlap}). 최대값(${maxOverlap})으로 조정합니다.`);
      return maxOverlap;
    }
    return overlap;
  }

  /**
   * 언어 자동 감지
   */
  private detectLanguage(content: string): 'ko' | 'en' | 'mixed' {
    const koreanCharCount = (content.match(/[가-힣]/g) || []).length;
    const englishCharCount = (content.match(/[a-zA-Z]/g) || []).length;

    if (koreanCharCount > englishCharCount) return 'ko';
    if (englishCharCount > koreanCharCount * 2) return 'en';
    return 'mixed';
  }

  /**
   * 문서 타입 자동 감지
   */
  private detectDocumentType(title: string): 'pdf' | 'docx' | 'txt' | 'url' {
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.endsWith('.pdf')) return 'pdf';
    if (lowerTitle.endsWith('.docx') || lowerTitle.endsWith('.doc')) return 'docx';
    if (lowerTitle.endsWith('.txt') || lowerTitle.endsWith('.md')) return 'txt';
    if (lowerTitle.startsWith('http://') || lowerTitle.startsWith('https://')) return 'url';
    return 'txt'; // 기본값
  }

  /**
   * 콘텐츠 타입 자동 감지
   */
  private detectContentType(
    content: string,
    title: string
  ): 'technical' | 'marketing' | 'policy' | 'faq' | 'general' {
    const lowerContent = content.toLowerCase();
    const lowerTitle = title.toLowerCase();

    // FAQ 감지
    if (
      lowerContent.includes('질문') && lowerContent.includes('답변') ||
      lowerContent.includes('q:') && lowerContent.includes('a:') ||
      lowerTitle.includes('faq') || lowerTitle.includes('자주')
    ) {
      return 'faq';
    }

    // 정책 감지
    if (
      lowerContent.includes('정책') ||
      lowerContent.includes('policy') ||
      lowerContent.includes('규정') ||
      lowerTitle.includes('정책') || lowerTitle.includes('policy')
    ) {
      return 'policy';
    }

    // 마케팅 감지
    if (
      lowerContent.includes('프로모션') ||
      lowerContent.includes('할인') ||
      lowerContent.includes('캠페인') ||
      lowerTitle.includes('마케팅') || lowerTitle.includes('marketing')
    ) {
      return 'marketing';
    }

    // 기술 문서 감지
    if (
      lowerContent.includes('api') ||
      lowerContent.includes('설정') ||
      lowerContent.includes('구현') ||
      lowerTitle.includes('api') || lowerTitle.includes('개발')
    ) {
      return 'technical';
    }

    return 'general';
  }
}

// 싱글톤 인스턴스
export const unifiedChunkingService = new UnifiedChunkingService();

