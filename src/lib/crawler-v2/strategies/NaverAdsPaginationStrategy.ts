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
          pageLinks: number[];
        } = {
          foundElements: [],
          extractedNumbers: [],
          paginationText: '',
          lastPageNumber: null,
          currentPageNumber: null,
          pageLinks: [],
        };

        // 1. Pagination 요소 찾기
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

        // 2. Pagination 요소 내의 링크에서 실제 페이지 번호 추출 (가장 정확한 방법)
        // Pagination 요소가 있으면 그 안에서만 검색, 없으면 전체 페이지에서 검색
        const searchScope = paginationElement || document.body;
        const allLinks = searchScope.querySelectorAll('a[href*="page="], a[href*="&page="]');
        const pageNumbers = new Set<number>();
        
        for (const link of allLinks) {
          const href = (link as HTMLAnchorElement).href;
          const pageMatch = href.match(/[?&]page=(\d+)/);
          if (pageMatch) {
            const pageNum = parseInt(pageMatch[1], 10);
            // 페이지 번호가 합리적인 범위 내인지 확인 (1~200)
            if (!isNaN(pageNum) && pageNum > 0 && pageNum <= 200) {
              pageNumbers.add(pageNum);
            }
          }
        }

        if (pageNumbers.size > 0) {
          result.pageLinks = Array.from(pageNumbers).sort((a, b) => a - b);
          result.currentPageNumber = Math.min(...result.pageLinks);
          result.lastPageNumber = Math.max(...result.pageLinks);
          result.extractedNumbers = result.pageLinks;
          result.paginationText = `페이지 링크에서 발견: ${result.pageLinks.join(', ')}`;
          console.log(`[NaverAdsPagination] 페이지 링크에서 발견: ${result.pageLinks.length}개 (${result.pageLinks[0]}~${result.pageLinks[result.pageLinks.length - 1]})`);
          return result;
        }

        // 3. Pagination 요소에서 텍스트 추출
        if (paginationElement) {
          result.paginationText = paginationElement.textContent || '';
        } else {
          // Pagination 요소를 찾지 못한 경우, 페이지 전체에서 찾기
          result.paginationText = document.body.innerText || '';
        }

        // 4. "X/Y" 패턴 찾기 (X/Y에서 Y가 전체 페이지)
        // 주의: "529/35" 같은 경우 529는 무시하고 35만 사용
        // Pagination 요소 내에서만 검색 (전체 페이지에서 검색하면 다른 숫자와 혼동 가능)
        const searchText = paginationElement ? paginationElement.textContent || '' : result.paginationText;
        const rangePattern = /(\d+)\s*\/\s*(\d+)/g;
        const rangeMatches = Array.from(searchText.matchAll(rangePattern));
        
        if (rangeMatches.length > 0) {
          // 모든 "X/Y" 패턴에서 Y 값만 수집 (X가 Y보다 크면 무시)
          const validRanges: { current: number; total: number }[] = [];
          
          for (const match of rangeMatches) {
            const firstNum = parseInt(match[1], 10);
            const secondNum = parseInt(match[2], 10);
            
            // X가 Y보다 크거나 같고, 둘 다 합리적인 범위 내인지 확인
            if (!isNaN(firstNum) && !isNaN(secondNum) && 
                firstNum > 0 && secondNum > 0 && 
                firstNum <= secondNum && 
                secondNum <= 200) { // 최대 200페이지로 제한
              validRanges.push({ current: firstNum, total: secondNum });
            } else if (!isNaN(secondNum) && secondNum > 0 && secondNum <= 200) {
              // X가 Y보다 크면 X는 무시하고 Y만 사용
              validRanges.push({ current: 1, total: secondNum });
            }
          }
          
          if (validRanges.length > 0) {
            // 가장 많이 나타나는 total 값 찾기
            const totalCounts = new Map<number, number>();
            validRanges.forEach(r => {
              totalCounts.set(r.total, (totalCounts.get(r.total) || 0) + 1);
            });
            
            let maxCount = 0;
            let mostCommonTotal = validRanges[0].total;
            totalCounts.forEach((count, num) => {
              if (count > maxCount) {
                maxCount = count;
                mostCommonTotal = num;
              }
            });
            
            result.lastPageNumber = mostCommonTotal;
            
            // 현재 페이지는 첫 번째 유효한 범위의 첫 번째 숫자
            const firstValid = validRanges.find(r => r.total === mostCommonTotal);
            result.currentPageNumber = firstValid ? firstValid.current : 1;
            
            result.extractedNumbers = [result.currentPageNumber, result.lastPageNumber];
            console.log(`[NaverAdsPagination] "X/Y" 패턴에서 발견: ${result.currentPageNumber}/${result.lastPageNumber}`);
            return result;
          }
        }

        // 5. "이전 페이지 1 2 3 4 5 다음 페이지" 패턴 찾기
        // Pagination 요소 내에서만 검색
        const pageListPattern = /(?:이전|prev|previous)[\s\S]*?(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)[\s\S]*?(?:다음|next)/i;
        const pageListMatch = searchText.match(pageListPattern);
        if (pageListMatch) {
          const numbers = pageListMatch.slice(1).map(Number).filter(n => !isNaN(n) && n > 0 && n <= 200); // 200 이하만 허용
          if (numbers.length > 0) {
            result.extractedNumbers = numbers;
            result.currentPageNumber = Math.min(...numbers);
            const maxNumber = Math.max(...numbers);
            const minNumber = Math.min(...numbers);
            
            // 숫자가 연속적이면 마지막 페이지 추정 (하지만 보수적으로)
            if (numbers.length >= 3 && maxNumber - minNumber === numbers.length - 1) {
              // 연속된 숫자: 마지막 페이지는 더 클 수 있지만 최대 50으로 제한
              result.lastPageNumber = Math.min(maxNumber + 10, 50);
            } else {
              result.lastPageNumber = maxNumber;
            }
            result.paginationText = pageListMatch[0];
            console.log(`[NaverAdsPagination] 페이지 리스트 패턴에서 발견: ${result.currentPageNumber}~${result.lastPageNumber}`);
            return result;
          }
        }

        // 6. Pagination 요소에서 숫자 직접 추출 (마지막 수단)
        // 주의: 이 방법은 다른 숫자와 혼동될 수 있으므로 최후의 수단
        if (paginationElement) {
          const numberPattern = /(\d+)/g;
          const matches = result.paginationText.matchAll(numberPattern);
          const allNumbers: number[] = [];
          
          for (const match of matches) {
            const num = parseInt(match[1], 10);
            // 합리적인 페이지 번호 범위만 허용 (1~200)
            if (!isNaN(num) && num > 0 && num <= 200) {
              allNumbers.push(num);
            }
          }

          if (allNumbers.length > 0) {
            // 숫자가 너무 많으면 (다른 숫자와 혼동) 무시
            if (allNumbers.length <= 10) {
              result.extractedNumbers = allNumbers;
              result.currentPageNumber = Math.min(...allNumbers);
              result.lastPageNumber = Math.max(...allNumbers);
              console.log(`[NaverAdsPagination] Pagination 요소에서 직접 추출: ${result.currentPageNumber}~${result.lastPageNumber}`);
            } else {
              console.warn(`[NaverAdsPagination] 추출된 숫자가 너무 많음 (${allNumbers.length}개), 무시`);
            }
          }
        }

        return result;
      });

      console.log(`🔍 [NaverAdsPagination] 추출된 데이터:`, paginationData);

      // 3. Pagination 정보 검증 및 생성
      // 전체 페이지 수가 비정상적으로 크면 제한 (예: 100 이하)
      let totalPages = paginationData.lastPageNumber;
      if (!totalPages || totalPages <= 1) {
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

      // 비정상적으로 큰 페이지 수 제한 (100 이하로 제한)
      if (totalPages > 100) {
        console.warn(`⚠️ [NaverAdsPagination] 전체 페이지 수가 비정상적으로 큼: ${totalPages}, 100으로 제한`);
        totalPages = 100;
      }

      // 현재 페이지가 전체 페이지보다 크면 조정
      let currentPage = paginationData.currentPageNumber || 1;
      if (currentPage > totalPages) {
        console.warn(`⚠️ [NaverAdsPagination] 현재 페이지(${currentPage})가 전체 페이지(${totalPages})보다 큼, 1로 조정`);
        currentPage = 1;
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
        currentPage,
        totalPages,
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

