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

    // 청킹 전 노이즈 텍스트 필터링
    const cleanedContent = this.filterNoiseText(content);
    if (!cleanedContent || cleanedContent.trim().length === 0) {
      return {
        chunks: [],
        metadata: {
          totalChunks: 0,
          averageChunkSize: 0,
          coverage: 0,
          documentType: 'url',
          strategy: 'url-optimized',
        },
      };
    }

    // HTML 구조 정보 추출 (원본 기준이 아닌 필터링된 텍스트 기준)
    const structureInfo = extractHTMLStructureFromText(cleanedContent);

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      separators: config.separators,
    });

    const textChunks = await textSplitter.splitText(cleanedContent);

    // 전체 청크 컨텍스트 준비 (TF-IDF 계산용)
    const allChunks = textChunks.map(chunk => chunk.trim());

    const chunks: UnifiedChunk[] = textChunks.map((chunk, index) => {
      let startChar = cleanedContent.indexOf(chunk);
      let endChar = startChar + chunk.length;

      // 잘린 텍스트 방지를 위한 경계 조정
      const adjustedBoundary = adjustChunkBoundary(
        cleanedContent,
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

      const trimmedChunk = cleanedContent.slice(startChar, endChar).trim();
      const position = startChar / cleanedContent.length; // 문서 내 위치 (0-1)

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
          totalLength: cleanedContent.length,
          averageChunkSize: cleanedContent.length / textChunks.length,
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

  /**
   * 청킹 전 노이즈 텍스트 필터링
   * URL 크롤링 결과에서 네비게이션, 푸터, 단순 버튼 텍스트 등을 라인 단위로 제거
   */
  private filterNoiseText(text: string): string {
    if (!text) return '';

    const lines = text.split('\n');
    const noisePatterns = [
      /^(문의하기|로그인|회원가입|광고주|비즈니스|홈|목록|전체메뉴|카테고리|검색)$/,
      /^(받아보세요|함께하세요|시작하기|구독하기|알아보기|더보기|신청하기|다운로드)$/,
      /^(X|Facebook|Instagram|YouTube|Blog|LinkedIn|KakaoTalk|Naver|Twitter)$/i,
      /^.[가-힣]{1,2}$/, // 너무 짧은 단편 (예: "어떤", "것을") - 문법적 불용어 가능성
      /^\[(자세히|더|검색|전체)\]$/,
      /^[\d\s\|\-\_\>]+$/, // 숫자와 특수문자만 있는 라인
      /^(뉴스레터\s*구독하기|신규\s*광고주라면|무료\s*체험하기)$/,
      /^[■□●○▶▷◀▼▲]\s*.*$/, // 특수문자로 시작하는 내비게이션 제목
      /^바로가기\s*>?$/
    ];

    const filteredLines = lines
      .map(line => line.trim())
      .filter(line => {
        if (!line) return false;

        // 특정 노이즈 패턴과 정확히 일치하는지 확인
        const isNoise = noisePatterns.some(pattern => pattern.test(line));
        if (isNoise) return false;

        // 문장 부호 없이 끝나는 5자 이하의 매우 짧은 텍스트는 노이즈 가능성이 높음
        if (line.length <= 5 && !/[.!?:]/.test(line)) {
          // 하지만 숫자로 시작하거나 (순서 표시) 헤딩 스타일이면 유지할 수도 있음
          // 여기서는 보수적으로 3자 이내만 제거
          if (line.length <= 3 && !/^\d+/.test(line)) return false;
        }

        // 메뉴 텍스트 뭉침 현상 감지 (공백 없이 여러 단어가 붙어있는 경우)
        // ex: "문의하기회원로그인광고주"
        if (line.includes('문의하기') && line.includes('로그인')) return false;
        if (line.includes('뉴스레터') && line.includes('구독하기')) {
          // 긴 문장이면 유지하되 20자 이내면 노이즈 처리
          if (line.length < 20) return false;
        }

        return true;
      });

    return filteredLines.join('\n');
  }
}

