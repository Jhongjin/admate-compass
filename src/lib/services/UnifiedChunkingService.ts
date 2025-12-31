/**
 * 통합 청킹 서비스
 * 모든 청킹 로직을 단일 서비스로 통합하여 일관성과 유지보수성 향상
 * 
 * 표준 청크 크기: 800-1000자 (문서 크기에 따라 조정)
 * 표준 Overlap: 100-150자
 */

import { adaptiveChunkingService, AdaptiveChunkingConfig, AdaptiveChunk } from './AdaptiveChunkingService';
import { processTextEncoding } from '../utils/textEncoding';
import { documentTypeChunkingStrategyManager } from './chunking/DocumentTypeChunkingStrategyManager';

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
        console.error('❌ 문서 내용이 비어있습니다. 상세 정보:', {
          documentId,
          documentTitle,
          originalContentLength: content?.length || 0,
          cleanedContentLength: cleanContent?.length || 0,
          encoding: encodingResult.encoding,
          hasIssues: encodingResult.hasIssues,
          issues: encodingResult.issues,
          note: '텍스트 인코딩 후 내용이 비어있습니다. 원본 파일이 손상되었거나 텍스트가 없는 이미지 기반 문서일 수 있습니다.'
        });
        const totalTime = Date.now() - totalStartTime;
        return {
          chunks: [],
          metadata: {
            totalChunks: 0,
            averageChunkSize: 0,
            originalLength: content?.length || 0,
            coverage: 0,
            processingTimeMs: totalTime,
            performance: {
              encodingTimeMs: performanceMetrics.encodingTimeMs,
              chunkingTimeMs: 0,
              totalTimeMs: totalTime,
              chunksPerSecond: 0,
              memoryUsageMB: performanceMetrics.memoryUsageMB,
            },
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
      
      // 문서 타입별 청킹 전략 시도 (우선순위: 타입별 전략 > 기존 AdaptiveChunkingService)
      // 각 문서 타입별 전략은 독립적으로 관리되므로 새로운 타입 추가 시 기존 로직에 영향 없음
      let adaptiveChunks: AdaptiveChunk[];
      try {
        const strategyResult = await documentTypeChunkingStrategyManager.chunkDocument(
          cleanContent,
          documentId,
          documentTitle,
          documentType,
          {
            contentType,
            metadata: {
              language,
              originalLength: cleanContent.length,
            },
          }
        );

        // 전략 결과를 AdaptiveChunk 형식으로 변환
        adaptiveChunks = strategyResult.chunks.map((chunk) => ({
          id: chunk.id,
          content: chunk.content,
          metadata: {
            documentId: chunk.metadata.documentId,
            documentTitle: chunk.metadata.documentTitle,
            documentType: documentType,
            chunkIndex: chunk.metadata.chunkIndex,
            startChar: chunk.metadata.startChar,
            endChar: chunk.metadata.endChar,
            originalLength: chunk.content.length, // AdaptiveChunk 타입에 필요한 필드
            chunkType: (chunk.metadata.chunkType === 'list' ? 'text' : chunk.metadata.chunkType) || 'text' as 'text' | 'table' | 'title' | 'section' | 'image' | 'qa' | 'article',
            sectionTitle: chunk.metadata.sectionTitle,
            keywords: chunk.metadata.keywords,
            importance: chunk.metadata.importance,
            hierarchyLevel: chunk.metadata.hierarchyLevel || 'paragraph',
          },
        }));

        console.log(`✅ [UnifiedChunking] 문서 타입별 전략으로 청킹 완료: ${strategyResult.metadata.strategy} (${adaptiveChunks.length}개 청크)`);
      } catch (strategyError) {
        console.warn(`⚠️ [UnifiedChunking] 문서 타입별 전략 실행 오류, 기존 AdaptiveChunkingService로 fallback:`, strategyError);
        
        // 기존 AdaptiveChunkingService 사용 (fallback)
        const adaptiveConfig: AdaptiveChunkingConfig = {
          documentType,
          contentLength: cleanContent.length,
          language,
          contentType,
          optimizeForSpeed: options.optimizeForSpeed || false,
        };

        adaptiveChunks = await adaptiveChunkingService.chunkDocument(
          cleanContent,
          documentId,
          documentTitle,
          adaptiveConfig
        );
      }
      
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
        let adjustedEnd = endIndex;
        if (endIndex < content.length) {
          const lastSentenceEnd = Math.max(
            chunkContent.lastIndexOf('. '),
            chunkContent.lastIndexOf('! '),
            chunkContent.lastIndexOf('? '),
            chunkContent.lastIndexOf('\n\n')
          );

          if (lastSentenceEnd > chunkSize * 0.5) {
            adjustedEnd = startIndex + lastSentenceEnd + 2;
          }
        }

        // 숫자 패턴 보호: 잘린 숫자 방지
        const beforeCut = content.slice(startIndex, adjustedEnd);
        const nearCutText = content.slice(Math.max(0, adjustedEnd - 30), Math.min(content.length, adjustedEnd + 30));
        const truncatedNumberPattern = /\d+\s*\|\s*\d+/;
        
        if (truncatedNumberPattern.test(nearCutText)) {
          // 잘린 숫자 패턴 발견 - 완전한 숫자까지 포함하도록 조정
          const numberPattern = /(\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?)\s*$/;
          const numberMatch = beforeCut.match(numberPattern);
          if (numberMatch && numberMatch.index !== undefined) {
            const numberEnd = startIndex + numberMatch.index + numberMatch[0].length;
            if (numberEnd > startIndex + chunkSize * 0.5 && numberEnd < startIndex + chunkSize * 1.5) {
              adjustedEnd = numberEnd;
              console.log(`🔢 [UnifiedChunking] 숫자 패턴 보호: 잘린 숫자 방지를 위해 adjustedEnd 조정 ${adjustedEnd}자`);
          }
        }
        }

        chunkContent = content.slice(startIndex, adjustedEnd).trim();

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

