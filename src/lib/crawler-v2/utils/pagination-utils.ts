/**
 * Pagination 감지 유틸리티
 * 페이지에서 pagination 정보를 추출하여 하위 페이지 URL을 생성
 */

import { Page } from 'puppeteer-core';

/**
 * Pagination 정보
 */
export interface PaginationInfo {
  /** 현재 페이지 번호 */
  currentPage: number;
  /** 전체 페이지 수 */
  totalPages: number;
  /** 페이지 URL 패턴 (예: "?categorySeq=136&page={page}") */
  pageUrlPattern: string;
  /** 기본 URL (쿼리 파라미터 제외) */
  baseUrl: string;
  /** 페이지 번호 파라미터 이름 (예: "page", "p", "pageNum") */
  pageParamName: string;
  /** 감지된 pagination 타입 */
  paginationType: 'number-list' | 'range' | 'button' | 'custom';
}

/**
 * Pagination 감지 결과
 */
export interface PaginationDetectionResult {
  /** Pagination 정보 (감지 성공 시) */
  pagination: PaginationInfo | null;
  /** 감지 성공 여부 */
  success: boolean;
  /** 에러 메시지 (실패 시) */
  error?: string;
  /** 디버깅 정보 */
  debugInfo?: {
    foundElements: string[];
    extractedNumbers: number[];
    urlPattern?: string;
  };
}

/**
 * 기본 Pagination 감지
 * 
 * @param page Puppeteer Page 객체
 * @param baseUrl 현재 페이지 URL
 * @returns Pagination 감지 결과
 */
export async function detectPagination(
  page: Page,
  baseUrl: string
): Promise<PaginationDetectionResult> {
  try {
    console.log(`🔍 [Pagination] 감지 시작: ${baseUrl}`);

    // 페이지에서 pagination 정보 추출
    const paginationData = await page.evaluate(() => {
      const result: {
        foundElements: string[];
        extractedNumbers: number[];
        paginationText: string;
        paginationHtml: string;
      } = {
        foundElements: [],
        extractedNumbers: [],
        paginationText: '',
        paginationHtml: '',
      };

      // 1. Pagination 관련 요소 찾기
      // 다양한 pagination 선택자 시도
      const paginationSelectors = [
        '.pagination',
        '.paging',
        '.page-navigation',
        '[class*="pagination"]',
        '[class*="paging"]',
        '[class*="page"]',
        'nav[aria-label*="page"]',
        'nav[aria-label*="페이지"]',
        '.pager',
        '[role="navigation"]',
      ];

      let paginationElement: Element | null = null;
      for (const selector of paginationSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          paginationElement = element;
          result.foundElements.push(selector);
          break;
        }
      }

      // Pagination 요소를 찾지 못한 경우, 페이지 전체에서 숫자 패턴 검색
      if (!paginationElement) {
        // "이전 페이지 1 2 3 4 5 다음 페이지" 같은 패턴 찾기
        const allText = document.body.innerText;
        const pageNumberPattern = /(?:이전|prev|previous|next|다음|페이지|page)[\s\S]*?(\d+)[\s\S]*?(\d+)/i;
        const match = allText.match(pageNumberPattern);
        if (match) {
          result.paginationText = match[0];
        }

        // 숫자 리스트 찾기 (연속된 숫자)
        const numberListPattern = /(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/;
        const numberMatch = allText.match(numberListPattern);
        if (numberMatch) {
          result.paginationText = numberMatch[0];
        }
      } else {
        result.paginationHtml = paginationElement.innerHTML;
        result.paginationText = paginationElement.textContent || '';
      }

      // 2. 숫자 추출
      // "1/35", "Page 1 of 35", "1 2 3 4 5" 등의 패턴에서 숫자 추출
      const numberPatterns = [
        /(\d+)\s*\/\s*(\d+)/, // "1/35"
        /(?:page|페이지)\s*(\d+)\s*(?:of|of|총)\s*(\d+)/i, // "Page 1 of 35"
        /(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/, // "1 2 3 4 5"
        /(\d+)/g, // 모든 숫자
      ];

      for (const pattern of numberPatterns) {
        const matches = result.paginationText.matchAll(pattern);
        for (const match of matches) {
          const numbers = match.slice(1).map(Number).filter(n => !isNaN(n) && n > 0);
          result.extractedNumbers.push(...numbers);
        }
      }

      // 중복 제거 및 정렬
      result.extractedNumbers = [...new Set(result.extractedNumbers)].sort((a, b) => a - b);

      return result;
    });

    console.log(`🔍 [Pagination] 추출된 데이터:`, paginationData);

    // 3. Pagination 정보 분석
    const { extractedNumbers, foundElements } = paginationData;

    if (extractedNumbers.length === 0) {
      return {
        pagination: null,
        success: false,
        error: 'Pagination 숫자를 찾을 수 없습니다',
        debugInfo: {
          foundElements,
          extractedNumbers: [],
        },
      };
    }

    // 가장 큰 숫자를 전체 페이지 수로 추정
    const totalPages = Math.max(...extractedNumbers);
    const currentPage = extractedNumbers[0] || 1;

    // URL 패턴 분석
    const urlPattern = analyzeUrlPattern(baseUrl);

    if (!urlPattern) {
      return {
        pagination: null,
        success: false,
        error: 'URL 패턴을 분석할 수 없습니다',
        debugInfo: {
          foundElements,
          extractedNumbers,
        },
      };
    }

    const paginationInfo: PaginationInfo = {
      currentPage,
      totalPages,
      pageUrlPattern: urlPattern.pattern,
      baseUrl: urlPattern.baseUrl,
      pageParamName: urlPattern.pageParamName,
      paginationType: 'number-list',
    };

    console.log(`✅ [Pagination] 감지 성공:`, paginationInfo);

    return {
      pagination: paginationInfo,
      success: true,
      debugInfo: {
        foundElements,
        extractedNumbers,
        urlPattern: urlPattern.pattern,
      },
    };
  } catch (error) {
    console.error(`❌ [Pagination] 감지 실패:`, error);
    return {
      pagination: null,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * URL 패턴 분석
 * 
 * @param url 현재 페이지 URL
 * @returns URL 패턴 정보
 */
function analyzeUrlPattern(url: string): {
  baseUrl: string;
  pattern: string;
  pageParamName: string;
} | null {
  try {
    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    const searchParams = urlObj.searchParams;

    // 기존 페이지 파라미터 확인
    const pageParamNames = ['page', 'p', 'pageNum', 'pageNumber', 'pageno', 'pno'];
    let existingPageParam: string | null = null;

    for (const paramName of pageParamNames) {
      if (searchParams.has(paramName)) {
        existingPageParam = paramName;
        break;
      }
    }

    // 기존 페이지 파라미터가 있으면 그대로 사용
    if (existingPageParam) {
      // 기존 쿼리 파라미터 유지 (page 파라미터 제외)
      const params = new URLSearchParams(searchParams);
      params.delete(existingPageParam);
      
      const baseQuery = params.toString();
      const pattern = baseQuery 
        ? `${baseUrl}?${baseQuery}&${existingPageParam}={page}`
        : `${baseUrl}?${existingPageParam}={page}`;
      
      return {
        baseUrl,
        pattern,
        pageParamName: existingPageParam,
      };
    }

    // 기존 페이지 파라미터가 없으면 새로 추가
    // 기존 쿼리 파라미터 유지
    const baseQuery = searchParams.toString();
    const pattern = baseQuery
      ? `${baseUrl}?${baseQuery}&page={page}`
      : `${baseUrl}?page={page}`;

    return {
      baseUrl,
      pattern,
      pageParamName: 'page',
    };
  } catch (error) {
    console.error(`❌ [Pagination] URL 패턴 분석 실패:`, error);
    return null;
  }
}

/**
 * 페이지 URL 목록 생성
 * 
 * @param paginationInfo Pagination 정보
 * @returns 생성된 페이지 URL 목록
 */
export function generatePageUrls(paginationInfo: PaginationInfo): string[] {
  const urls: string[] = [];

  for (let page = 1; page <= paginationInfo.totalPages; page++) {
    const url = paginationInfo.pageUrlPattern.replace('{page}', String(page));
    urls.push(url);
  }

  return urls;
}

