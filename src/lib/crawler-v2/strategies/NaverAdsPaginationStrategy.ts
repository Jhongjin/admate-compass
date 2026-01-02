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

        // 2. Pagination 요소에서 텍스트 추출 (먼저 "X/Y" 패턴을 찾기 위해)
        if (paginationElement) {
          result.paginationText = paginationElement.textContent || '';
        } else {
          // Pagination 요소를 찾지 못한 경우, 페이지 전체에서 찾기
          result.paginationText = document.body.innerText || '';
        }

        // 3. "X/Y" 패턴 찾기 (가장 정확한 방법 - 전체 페이지 수를 알 수 있음)
        // 주의: "529/35" 같은 경우 529는 무시하고 35만 사용
        // Pagination 요소 내에서만 검색 (전체 페이지에서 검색하면 다른 숫자와 혼동 가능)
        const searchText = paginationElement ? paginationElement.textContent || '' : result.paginationText;
        
        // 먼저 "X/Y" 패턴을 찾아서 전체 페이지 수를 정확히 파악
        const rangePattern = /(\d+)\s*\/\s*(\d+)/g;
        const rangeMatches = Array.from(searchText.matchAll(rangePattern));
        
        if (rangeMatches.length > 0) {
          // 모든 "X/Y" 패턴에서 Y 값만 수집 (X가 Y보다 크면 무시)
          const validRanges: { current: number; total: number }[] = [];
          
          for (const match of rangeMatches) {
            const firstNum = parseInt(match[1], 10);
            const secondNum = parseInt(match[2], 10);
            
            // X가 Y보다 크거나 같고, 둘 다 유효한지 확인 (비정상적으로 큰 값만 필터링: 10000 이상)
            if (!isNaN(firstNum) && !isNaN(secondNum) && 
                firstNum > 0 && secondNum > 0 && 
                firstNum <= secondNum && 
                secondNum < 10000) {
              validRanges.push({ current: firstNum, total: secondNum });
            } else if (!isNaN(secondNum) && secondNum > 0 && secondNum < 10000) {
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

        // 4. Pagination 요소 내의 링크에서 실제 페이지 번호 추출
        // (링크의 최대값은 현재 보이는 페이지 범위일 뿐, 전체 페이지 수가 아님)
        const searchScope = paginationElement || document.body;
        const allLinks = searchScope.querySelectorAll('a[href*="page="], a[href*="&page="]');
        const pageNumbers = new Set<number>();
        let nextPageLink: HTMLAnchorElement | null = null;
        let lastPageLink: HTMLAnchorElement | null = null;
        
        for (const link of allLinks) {
          const href = (link as HTMLAnchorElement).href;
          const pageMatch = href.match(/[?&]page=(\d+)/);
          if (pageMatch) {
            const pageNum = parseInt(pageMatch[1], 10);
            // 페이지 번호가 유효한지 확인 (1 이상, 비정상적으로 큰 값만 필터링: 10000 이상)
            if (!isNaN(pageNum) && pageNum > 0 && pageNum < 10000) {
              pageNumbers.add(pageNum);
            }
          }
          
          // "다음 페이지" 링크 확인
          const linkText = (link as HTMLElement).textContent?.toLowerCase() || '';
          const linkClass = (link as HTMLElement).className?.toLowerCase() || '';
          if ((linkText.includes('다음') || linkText.includes('next') || linkText.includes('>') || linkClass.includes('next')) && !nextPageLink) {
            nextPageLink = link as HTMLAnchorElement;
          }
          
          // "마지막 페이지" 링크 확인
          if ((linkText.includes('마지막') || linkText.includes('last') || linkText.includes('끝') || linkClass.includes('last')) && !lastPageLink) {
            lastPageLink = link as HTMLAnchorElement;
          }
        }

        if (pageNumbers.size > 0) {
          result.pageLinks = Array.from(pageNumbers).sort((a, b) => a - b);
          result.currentPageNumber = Math.min(...result.pageLinks);
          const maxLinkPage = Math.max(...result.pageLinks);
          
          // 마지막 페이지 링크가 있으면 그 링크의 페이지 번호를 사용
          if (lastPageLink) {
            const lastPageHref = lastPageLink.href;
            const lastPageMatch = lastPageHref.match(/[?&]page=(\d+)/);
            if (lastPageMatch) {
              const lastPageNum = parseInt(lastPageMatch[1], 10);
              if (!isNaN(lastPageNum) && lastPageNum > 0 && lastPageNum < 10000) {
                result.lastPageNumber = lastPageNum;
                console.log(`[NaverAdsPagination] 마지막 페이지 링크에서 발견: ${result.lastPageNumber}`);
                result.extractedNumbers = result.pageLinks;
                result.paginationText = `페이지 링크에서 발견: ${result.pageLinks.join(', ')}, 마지막 페이지: ${result.lastPageNumber}`;
                return result;
              }
            }
          }
          
          // "다음 페이지" 링크가 있으면 더 많은 페이지가 있을 수 있음
          // 하지만 정확한 전체 페이지 수를 알 수 없으므로, 링크의 최대값을 사용하되 경고
          if (nextPageLink) {
            console.warn(`[NaverAdsPagination] "다음 페이지" 링크가 있지만 전체 페이지 수를 정확히 알 수 없음. 링크의 최대값(${maxLinkPage})을 사용합니다.`);
            // "다음 페이지" 링크의 href에서 페이지 번호를 확인해볼 수 있음
            const nextPageHref = nextPageLink.href;
            const nextPageMatch = nextPageHref.match(/[?&]page=(\d+)/);
            if (nextPageMatch) {
              const nextPageNum = parseInt(nextPageMatch[1], 10);
              if (!isNaN(nextPageNum) && nextPageNum > maxLinkPage) {
                // 다음 페이지 번호가 현재 최대값보다 크면, 전체 페이지 수는 그보다 클 수 있음
                // 하지만 정확히 알 수 없으므로 보수적으로 추정
                console.warn(`[NaverAdsPagination] 다음 페이지 번호(${nextPageNum})가 현재 최대값(${maxLinkPage})보다 큼. 전체 페이지 수는 ${nextPageNum} 이상일 수 있습니다.`);
              }
            }
          }
          
          result.lastPageNumber = maxLinkPage;
          result.extractedNumbers = result.pageLinks;
          result.paginationText = `페이지 링크에서 발견: ${result.pageLinks.join(', ')}`;
          console.log(`[NaverAdsPagination] 페이지 링크에서 발견: ${result.pageLinks.length}개 (${result.pageLinks[0]}~${result.pageLinks[result.pageLinks.length - 1]})`);
          return result;
        }

        // 5. "이전 페이지 1 2 3 4 5 다음 페이지" 패턴 찾기
        // Pagination 요소 내에서만 검색
        const pageListPattern = /(?:이전|prev|previous)[\s\S]*?(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)[\s\S]*?(?:다음|next)/i;
        const pageListMatch = searchText.match(pageListPattern);
        if (pageListMatch) {
          const numbers = pageListMatch.slice(1).map(Number).filter(n => !isNaN(n) && n > 0 && n < 10000); // 비정상적으로 큰 값만 필터링
          if (numbers.length > 0) {
            result.extractedNumbers = numbers;
            result.currentPageNumber = Math.min(...numbers);
            const maxNumber = Math.max(...numbers);
            const minNumber = Math.min(...numbers);
            
            // 숫자가 연속적이면 마지막 페이지 추정
            // 예: "31 32 33 34 35" → 마지막 페이지는 35 이상일 수 있음
            // 하지만 실제 마지막 페이지를 정확히 알 수 없으므로, 최대값을 사용
            // (추가 로직: "X/Y" 패턴과 함께 사용하면 더 정확함)
            result.lastPageNumber = maxNumber;
            result.paginationText = pageListMatch[0];
            console.log(`[NaverAdsPagination] 페이지 리스트 패턴에서 발견: ${result.currentPageNumber}~${result.lastPageNumber} (연속된 숫자 패턴)`);
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
            // 유효한 페이지 번호만 허용 (비정상적으로 큰 값만 필터링: 10000 이상)
            if (!isNaN(num) && num > 0 && num < 10000) {
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
      // 실제 감지된 값을 사용 (임의 제한 없음)
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

      // 현재 페이지가 전체 페이지보다 크면 조정
      let currentPage = paginationData.currentPageNumber || 1;
      if (currentPage > totalPages) {
        console.warn(`⚠️ [NaverAdsPagination] 현재 페이지(${currentPage})가 전체 페이지(${totalPages})보다 큼, 1로 조정`);
        currentPage = 1;
      }

      // 비정상적으로 큰 값만 경고 (제한하지 않음)
      if (totalPages > 1000) {
        console.warn(`⚠️ [NaverAdsPagination] 전체 페이지 수가 매우 큼: ${totalPages}, 실제 값인지 확인 필요`);
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

