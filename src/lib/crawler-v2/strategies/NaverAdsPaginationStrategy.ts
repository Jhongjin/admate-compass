/**
 * Naver Ads FAQ Pagination 전략
 * Naver Ads FAQ 페이지의 pagination을 특화하여 감지
 */

import { Page } from 'puppeteer-core';
import type { PaginationInfo, PaginationDetectionResult } from '../utils/pagination-utils';

export class NaverAdsPaginationStrategy {
  /**
   * Naver Ads FAQ 페이지인지 확인
   */
  canHandle(url: string): boolean {
    return url.includes('ads.naver.com/help/faq');
  }

  /**
   * Naver Ads FAQ 페이지의 pagination 감지
   * 
   * 예상 패턴:
   * - URL: https://ads.naver.com/help/faq?categorySeq=136
   * - Pagination: "이전 페이지 1 2 3 4 5 다음 페이지" 또는 "1/35"
   * - URL 패턴: ?categorySeq=136&page=2 또는 ?categorySeq=136&p=2
   */
  async detectPagination(
    page: Page,
    url: string
  ): Promise<PaginationDetectionResult> {
    if (!this.canHandle(url)) {
      return {
        pagination: null,
        success: false,
        error: 'Naver Ads FAQ 페이지가 아닙니다',
      };
    }

    try {
      console.log(`🔍 [NaverAdsPagination] 감지 시작: ${url}`);

      // Naver Ads FAQ 특화 pagination 감지
      const paginationData = await page.evaluate(() => {
        const result: {
          foundElements: string[];
          extractedNumbers: number[];
          paginationText: string;
          lastPageNumber: number | null;
          currentPageNumber: number | null;
        } = {
          foundElements: [],
          extractedNumbers: [],
          paginationText: '',
          lastPageNumber: null,
          currentPageNumber: null,
        };

        // 1. Naver Ads FAQ 특화 pagination 선택자
        // "이전 페이지 1 2 3 4 5 다음 페이지" 패턴 찾기
        const paginationSelectors = [
          '.pagination',
          '.paging',
          '[class*="pagination"]',
          '[class*="paging"]',
          'nav[aria-label*="페이지"]',
          'nav[aria-label*="page"]',
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

        // 2. 페이지 전체에서 pagination 텍스트 찾기
        // "이전 페이지 1 2 3 4 5 다음 페이지" 또는 "1/35" 패턴
        const bodyText = document.body.innerText || '';
        
        // "1/35" 패턴 찾기 (가장 정확)
        const rangePattern = /(\d+)\s*\/\s*(\d+)/;
        const rangeMatch = bodyText.match(rangePattern);
        if (rangeMatch) {
          result.currentPageNumber = parseInt(rangeMatch[1], 10);
          result.lastPageNumber = parseInt(rangeMatch[2], 10);
          result.paginationText = rangeMatch[0];
          result.extractedNumbers = [result.currentPageNumber, result.lastPageNumber];
          return result;
        }

        // "이전 페이지 1 2 3 4 5 다음 페이지" 패턴 찾기
        const pageListPattern = /(?:이전|prev|previous)[\s\S]*?(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)[\s\S]*?(?:다음|next)/i;
        const pageListMatch = bodyText.match(pageListPattern);
        if (pageListMatch) {
          const numbers = pageListMatch.slice(1).map(Number).filter(n => !isNaN(n) && n > 0);
          result.extractedNumbers = numbers;
          result.currentPageNumber = numbers[0];
          // 마지막 페이지 번호는 추정 (연속된 숫자라면)
          if (numbers.length >= 5) {
            const maxNumber = Math.max(...numbers);
            // 연속된 숫자라면 마지막 페이지는 더 클 수 있음
            result.lastPageNumber = maxNumber + (numbers.length - 1);
          } else {
            result.lastPageNumber = Math.max(...numbers);
          }
          result.paginationText = pageListMatch[0];
          return result;
        }

        // Pagination 요소에서 직접 추출
        if (paginationElement) {
          result.paginationText = paginationElement.textContent || '';
          
          // 숫자 추출
          const numberPattern = /(\d+)/g;
          const matches = result.paginationText.matchAll(numberPattern);
          for (const match of matches) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > 0) {
              result.extractedNumbers.push(num);
            }
          }

          if (result.extractedNumbers.length > 0) {
            result.currentPageNumber = Math.min(...result.extractedNumbers);
            result.lastPageNumber = Math.max(...result.extractedNumbers);
          }
        }

        return result;
      });

      console.log(`🔍 [NaverAdsPagination] 추출된 데이터:`, paginationData);

      // 3. Pagination 정보 생성
      if (!paginationData.lastPageNumber || paginationData.lastPageNumber <= 1) {
        return {
          pagination: null,
          success: false,
          error: 'Pagination을 찾을 수 없거나 페이지가 1페이지만 있습니다',
          debugInfo: {
            foundElements: paginationData.foundElements,
            extractedNumbers: paginationData.extractedNumbers,
          },
        };
      }

      // URL 패턴 분석
      const urlPattern = this.analyzeNaverAdsUrlPattern(url);

      if (!urlPattern) {
        return {
          pagination: null,
          success: false,
          error: 'URL 패턴을 분석할 수 없습니다',
          debugInfo: {
            foundElements: paginationData.foundElements,
            extractedNumbers: paginationData.extractedNumbers,
          },
        };
      }

      const paginationInfo: PaginationInfo = {
        currentPage: paginationData.currentPageNumber || 1,
        totalPages: paginationData.lastPageNumber,
        pageUrlPattern: urlPattern.pattern,
        baseUrl: urlPattern.baseUrl,
        pageParamName: urlPattern.pageParamName,
        paginationType: 'number-list',
      };

      console.log(`✅ [NaverAdsPagination] 감지 성공:`, paginationInfo);

      return {
        pagination: paginationInfo,
        success: true,
        debugInfo: {
          foundElements: paginationData.foundElements,
          extractedNumbers: paginationData.extractedNumbers,
          urlPattern: urlPattern.pattern,
        },
      };
    } catch (error) {
      console.error(`❌ [NaverAdsPagination] 감지 실패:`, error);
      return {
        pagination: null,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Naver Ads FAQ URL 패턴 분석
   * 
   * 예: https://ads.naver.com/help/faq?categorySeq=136
   * → https://ads.naver.com/help/faq?categorySeq=136&page={page}
   */
  private analyzeNaverAdsUrlPattern(url: string): {
    baseUrl: string;
    pattern: string;
    pageParamName: string;
  } | null {
    try {
      const urlObj = new URL(url);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
      const searchParams = urlObj.searchParams;

      // categorySeq 파라미터 유지
      const categorySeq = searchParams.get('categorySeq');
      
      if (!categorySeq) {
        // categorySeq가 없으면 기본 패턴 사용
        const baseQuery = searchParams.toString();
        const pattern = baseQuery
          ? `${baseUrl}?${baseQuery}&page={page}`
          : `${baseUrl}?page={page}`;
        
        return {
          baseUrl,
          pattern,
          pageParamName: 'page',
        };
      }

      // categorySeq가 있으면 유지하고 page 파라미터 추가
      // 기존 page 파라미터가 있으면 제거
      const params = new URLSearchParams(searchParams);
      params.delete('page');
      params.delete('p');
      
      // categorySeq를 명시적으로 추가 (순서 보장)
      const pattern = `${baseUrl}?categorySeq=${categorySeq}&page={page}`;

      return {
        baseUrl,
        pattern,
        pageParamName: 'page',
      };
    } catch (error) {
      console.error(`❌ [NaverAdsPagination] URL 패턴 분석 실패:`, error);
      return null;
    }
  }
}

// 싱글톤 인스턴스
export const naverAdsPaginationStrategy = new NaverAdsPaginationStrategy();

