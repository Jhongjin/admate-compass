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
   * 
   * 전략:
   * 1. "X/Y" 패턴 찾기 (가장 정확)
   * 2. 마지막 페이지 링크 찾기
   * 3. "다음 페이지" 링크를 클릭하여 마지막 페이지까지 추적
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
      // 1단계: 현재 페이지에서 pagination 정보 추출
      const paginationData = await page.evaluate(() => {
        const result: {
          foundElements: string[];
          extractedNumbers: number[];
          paginationText: string;
          lastPageNumber: number | null;
          currentPageNumber: number | null;
          pageLinks: number[];
          nextPageLink: string | null;
        } = {
          foundElements: [],
          extractedNumbers: [],
          paginationText: '',
          lastPageNumber: null,
          currentPageNumber: null,
          pageLinks: [],
          nextPageLink: null,
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
        let searchText = '';
        if (paginationElement) {
          // textContent와 innerHTML 모두 검색 (innerHTML에는 숨겨진 텍스트도 포함될 수 있음)
          result.paginationText = paginationElement.textContent || '';
          const innerHtml = paginationElement.innerHTML || '';
          // innerHTML에서 텍스트만 추출 (태그 제거)
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = innerHtml;
          const innerText = tempDiv.textContent || tempDiv.innerText || '';
          searchText = result.paginationText + ' ' + innerText;
          
          // Pagination 요소의 모든 자식 요소의 텍스트도 수집
          const allTextNodes: string[] = [];
          const walker = document.createTreeWalker(
            paginationElement,
            NodeFilter.SHOW_TEXT,
            null
          );
          let node;
          while (node = walker.nextNode()) {
            const text = node.textContent?.trim() || '';
            if (text) {
              allTextNodes.push(text);
            }
          }
          searchText += ' ' + allTextNodes.join(' ');
        } else {
          // Pagination 요소를 찾지 못한 경우, 페이지 전체에서 찾기
          result.paginationText = document.body.innerText || '';
          searchText = result.paginationText;
        }

        // 디버깅: pagination 텍스트 로그 (서버 측에서 확인 가능하도록 반환)
        result.paginationText = searchText.substring(0, 500); // 디버깅을 위해 저장

        // 3. "X/Y" 패턴 찾기 (가장 정확한 방법 - 전체 페이지 수를 알 수 있음)
        // 주의: "529/35" 같은 경우 529는 무시하고 35만 사용
        // 더 유연한 패턴: 공백이 없어도 됨 (예: "529/35", "1/35", "1 / 35")
        // 다양한 패턴 시도: "X/Y", "X of Y", "X 페이지 중 Y", "X페이지/Y페이지"
        // "이전 페이지1/3다음 페이지" 같은 패턴도 찾기
        const rangePatterns = [
          /(?:이전|prev|previous)[\s\S]*?페이지\s*(\d+)\s*\/\s*(\d+)[\s\S]*?(?:다음|next)/gi,  // "이전 페이지1/35다음 페이지" (페이지 단어 포함)
          /(?:이전|prev|previous)[\s\S]*?(\d+)\s*\/\s*(\d+)[\s\S]*?(?:다음|next)/gi,  // "이전 페이지1/3다음 페이지" (페이지 단어 없어도 됨)
          /페이지\s*(\d+)\s*\/\s*(\d+)/g,  // "페이지 1/35" (우선순위 높임)
          /(\d+)\s*\/\s*(\d+)/g,  // "1/35", "529/35" (일반 패턴)
          /(\d+)\s+of\s+(\d+)/gi,  // "1 of 35"
          /(\d+)\s*페이지\s*중\s*(\d+)/g,  // "1 페이지 중 35"
          /(\d+)\s*페이지\s*\/\s*(\d+)\s*페이지/g,  // "1페이지/35페이지"
        ];
        
        let rangeMatches: RegExpMatchArray[] = [];
        for (const pattern of rangePatterns) {
          const matches = Array.from(searchText.matchAll(pattern));
          if (matches.length > 0) {
            rangeMatches.push(...matches);
            console.log(`[NaverAdsPagination] "X/Y" 패턴 발견: ${matches.length}개 매치, 패턴: ${pattern.source}`);
            // "이전 페이지1/3다음 페이지" 패턴을 우선 사용
            if (pattern.source.includes('이전') || pattern.source.includes('prev')) {
              console.log(`[NaverAdsPagination] "이전/다음" 패턴 발견, 즉시 사용`);
              break; // 이 패턴을 찾으면 즉시 사용
            }
          }
        }
        
        // 디버깅: "X/Y" 패턴을 찾지 못한 경우
        if (rangeMatches.length === 0) {
          console.warn(`[NaverAdsPagination] "X/Y" 패턴을 찾지 못함. 검색 텍스트 샘플: ${searchText.substring(0, 200)}`);
          // "X/Y" 패턴을 찾지 못했다는 플래그 설정
          result.paginationText = 'NO_XY_PATTERN:' + result.paginationText;
        }
        
        
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
            result.nextPageLink = (link as HTMLAnchorElement).href;
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
                // NO_XY_PATTERN 접두사가 있으면 유지
                const prefix = result.paginationText.startsWith('NO_XY_PATTERN:') ? 'NO_XY_PATTERN:' : '';
                result.paginationText = prefix + `페이지 링크에서 발견: ${result.pageLinks.join(', ')}, 마지막 페이지: ${result.lastPageNumber}`;
                return result;
              }
            }
          }
          
          // "다음 페이지" 링크가 있으면 더 많은 페이지가 있을 수 있음
          // "다음 페이지" 링크를 클릭하여 다음 페이지로 이동하고, 마지막 페이지까지 반복
          if (nextPageLink) {
            // 다음 페이지 링크의 href에서 페이지 번호를 확인
            const nextPageHref = nextPageLink.href;
            const nextPageMatch = nextPageHref.match(/[?&]page=(\d+)/);
            if (nextPageMatch) {
              const nextPageNum = parseInt(nextPageMatch[1], 10);
              if (!isNaN(nextPageNum) && nextPageNum > maxLinkPage) {
                // 다음 페이지 번호가 현재 최대값보다 크면, 전체 페이지 수는 그보다 클 수 있음
                console.warn(`[NaverAdsPagination] "다음 페이지" 링크가 있음. 다음 페이지 번호: ${nextPageNum}, 현재 최대값: ${maxLinkPage}. 전체 페이지 수는 ${nextPageNum} 이상일 수 있습니다.`);
              }
            }
          }
          
          // 일단 링크의 최대값을 사용 (Phase 1에서는 단일 페이지에서만 감지)
          // Phase 2에서 "다음 페이지" 링크를 클릭하여 마지막 페이지까지 추적할 예정
          result.lastPageNumber = maxLinkPage;
          result.extractedNumbers = result.pageLinks;
          // NO_XY_PATTERN 접두사가 있으면 유지
          const prefix = result.paginationText.startsWith('NO_XY_PATTERN:') ? 'NO_XY_PATTERN:' : '';
          result.paginationText = prefix + `페이지 링크에서 발견: ${result.pageLinks.join(', ')}`;
          console.log(`[NaverAdsPagination] 페이지 링크에서 발견: ${result.pageLinks.length}개 (${result.pageLinks[0]}~${result.pageLinks[result.pageLinks.length - 1]})`);
          return result;
        }

        // "X/Y" 패턴을 찾지 못한 경우, 더 넓은 범위에서 검색
        if (rangeMatches.length === 0) {
          const allText = paginationElement 
            ? (paginationElement.textContent || '') + ' ' + (paginationElement.innerHTML || '')
            : document.body.innerText || '';
          
          const widerRangePattern = /(\d+)\s*\/\s*(\d+)/g;
          const widerMatches = Array.from(allText.matchAll(widerRangePattern));
          if (widerMatches.length > 0) {
            console.log(`[NaverAdsPagination] 전체 텍스트에서 "X/Y" 패턴 발견: ${widerMatches.length}개`);
            rangeMatches = widerMatches;
          }
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
            // NO_XY_PATTERN 접두사가 있으면 유지
            const prefix = result.paginationText.startsWith('NO_XY_PATTERN:') ? 'NO_XY_PATTERN:' : '';
            result.paginationText = prefix + pageListMatch[0];
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
      
      // 2단계: "다음 페이지" 링크가 있고 "X/Y" 패턴을 찾지 못한 경우, 다음 페이지로 이동하여 추적
      // 중요: "X/Y" 패턴을 찾았으면 "다음 페이지" 링크 추적을 하지 않음 (이미 정확한 전체 페이지 수를 알고 있음)
      // "X/Y" 패턴을 찾았는지 확인: paginationText에 "NO_XY_PATTERN:" 접두사가 없으면 찾은 것
      const hasXYPattern = paginationData.paginationText && 
                           !paginationData.paginationText.startsWith('NO_XY_PATTERN:') &&
                           paginationData.lastPageNumber && 
                           paginationData.currentPageNumber && 
                           paginationData.lastPageNumber > paginationData.currentPageNumber &&
                           paginationData.lastPageNumber < 10000 && // 비정상적으로 큰 값 제외
                           paginationData.lastPageNumber <= 100; // 합리적인 범위 내 (100페이지 이하)
      
      console.log(`🔍 [NaverAdsPagination] "X/Y" 패턴 찾음 여부: ${hasXYPattern}, paginationText 시작: ${paginationData.paginationText?.substring(0, 50)}`);
      
      if (paginationData.pageLinks && paginationData.pageLinks.length > 0) {
        const maxLinkPage = Math.max(...paginationData.pageLinks);
        
        // "X/Y" 패턴을 찾지 못했고 "다음 페이지" 링크가 있으면, 다음 페이지로 이동하여 추적
        // lastPageNumber가 링크의 최대값으로만 설정되어 있으면 (즉, "X/Y" 패턴에서 찾지 못한 경우) 추적
        const isFromLinkMax = paginationData.lastPageNumber === maxLinkPage;
        
        console.log(`🔍 [NaverAdsPagination] 다음 페이지 링크 추적 조건: hasXYPattern=${hasXYPattern}, isFromLinkMax=${isFromLinkMax}, nextPageLink=${!!paginationData.nextPageLink}`);
        
        // "X/Y" 패턴을 찾지 않았을 때만 "다음 페이지" 링크 추적 실행
        // 단, 최대 시도 횟수를 제한하여 리소스 부족 방지
        if (!hasXYPattern && isFromLinkMax && paginationData.nextPageLink) {
          console.log(`🔍 [NaverAdsPagination] "다음 페이지" 링크 추적 시작 (현재 최대값: ${maxLinkPage})...`);
          console.log(`🔍 [NaverAdsPagination] "다음 페이지" 링크 추적 시작...`);
          
          let lastPageFound = maxLinkPage;
          let attempts = 0;
          const maxAttempts = Math.min(20, maxLinkPage + 5); // 최대 시도 횟수 제한 (리소스 부족 방지)
          let currentUrl = url;
          let consecutiveErrors = 0;
          const maxConsecutiveErrors = 3; // 연속 에러 3회 발생 시 중단
          
          while (attempts < maxAttempts) {
            attempts++;
            
            // 현재 페이지에서 "다음 페이지" 링크 찾기
            const nextLinkInfo = await page.evaluate(() => {
              const links = document.querySelectorAll('a[href*="page="], a[href*="&page="]');
              for (const link of links) {
                const linkText = (link as HTMLElement).textContent?.toLowerCase() || '';
                const linkClass = (link as HTMLElement).className?.toLowerCase() || '';
                if (linkText.includes('다음') || linkText.includes('next') || linkText.includes('>') || linkClass.includes('next')) {
                  return (link as HTMLAnchorElement).href;
                }
              }
              return null;
            });
            
            if (!nextLinkInfo) {
              // "다음 페이지" 링크가 없으면 마지막 페이지에 도달
              console.log(`[NaverAdsPagination] "다음 페이지" 링크가 없음. 마지막 페이지에 도달한 것으로 추정.`);
              break;
            }
            
            // 다음 페이지로 이동
            console.log(`[NaverAdsPagination] 다음 페이지로 이동 시도 ${attempts}/${maxAttempts}: ${nextLinkInfo}`);
            try {
              // 프레임이 분리되었는지 확인
              if (page.isClosed()) {
                console.warn(`[NaverAdsPagination] 페이지가 닫혔습니다. 추적 중단.`);
                break;
              }
              
              await page.goto(nextLinkInfo, { waitUntil: 'networkidle2', timeout: 20000 }); // 타임아웃 단축
              await new Promise(resolve => setTimeout(resolve, 1500)); // 대기 시간 단축
              
              // 현재 페이지에서 페이지 번호 및 "X/Y" 패턴 추출
              const pageInfo = await page.evaluate(() => {
                // 페이지 번호 추출
                const links = document.querySelectorAll('a[href*="page="], a[href*="&page="]');
                const pageNumbers = new Set<number>();
                for (const link of links) {
                  const href = (link as HTMLAnchorElement).href;
                  const pageMatch = href.match(/[?&]page=(\d+)/);
                  if (pageMatch) {
                    const pageNum = parseInt(pageMatch[1], 10);
                    if (!isNaN(pageNum) && pageNum > 0 && pageNum < 10000) {
                      pageNumbers.add(pageNum);
                    }
                  }
                }
                
                // "X/Y" 패턴 찾기 (더 넓은 범위에서 검색)
                const bodyText = document.body.innerText || '';
                const paginationElements = document.querySelectorAll('[class*="pagination"], [class*="paging"], nav[aria-label*="페이지"], nav[aria-label*="page"]');
                let searchText = bodyText;
                
                // Pagination 요소의 텍스트도 추가로 검색
                paginationElements.forEach(el => {
                  searchText += ' ' + (el.textContent || '');
                });
                
                // 더 정확한 패턴 사용: "페이지 X/Y" 또는 "X/Y" (X가 Y보다 작거나 같아야 함)
                const rangePattern = /(?:페이지\s*)?(\d+)\s*\/\s*(\d+)/g;
                const rangeMatches = Array.from(searchText.matchAll(rangePattern));
                
                return {
                  pageNumbers: Array.from(pageNumbers).sort((a, b) => a - b),
                  rangeMatches: rangeMatches
                    .map(m => {
                      const first = parseInt(m[1], 10);
                      const second = parseInt(m[2], 10);
                      // X가 Y보다 작거나 같고, 둘 다 유효한 경우만 반환
                      if (!isNaN(first) && !isNaN(second) && first > 0 && second > 0 && first <= second && second < 10000) {
                        return { first, second };
                      }
                      // X가 Y보다 크면 Y만 사용
                      if (!isNaN(second) && second > 0 && second < 10000) {
                        return { first: 1, second };
                      }
                      return null;
                    })
                    .filter((m): m is { first: number; second: number } => m !== null)
                };
              });
              
              consecutiveErrors = 0; // 성공 시 에러 카운터 리셋
              
              // 페이지 번호 업데이트
              if (pageInfo.pageNumbers.length > 0) {
                const currentMax = Math.max(...pageInfo.pageNumbers);
                if (currentMax > lastPageFound) {
                  lastPageFound = currentMax;
                }
              }
              
              // "X/Y" 패턴에서 전체 페이지 수 확인
              if (pageInfo.rangeMatches.length > 0) {
                for (const match of pageInfo.rangeMatches) {
                  const validTotal = match.second;
                  
                  if (validTotal > 0 && validTotal < 10000) {
                    if (validTotal > lastPageFound) {
                      lastPageFound = validTotal;
                      console.log(`[NaverAdsPagination] "X/Y" 패턴에서 전체 페이지 수 발견: ${lastPageFound} (${match.first}/${match.second})`);
                      // "X/Y" 패턴을 찾으면 즉시 중단
                      attempts = maxAttempts; // 루프 종료를 위해 attempts를 maxAttempts로 설정
                      break;
                    }
                  }
                }
              }
              
              // 현재 페이지 번호 확인: URL에서 추출
              const currentPageMatch = nextLinkInfo.match(/[?&]page=(\d+)/);
              if (currentPageMatch) {
                const currentPageNum = parseInt(currentPageMatch[1], 10);
                // 현재 페이지가 발견한 최대 페이지보다 크면 중단 (잘못된 추적 방지)
                if (!isNaN(currentPageNum) && currentPageNum > lastPageFound + 5) {
                  console.warn(`[NaverAdsPagination] 현재 페이지(${currentPageNum})가 발견한 최대 페이지(${lastPageFound})보다 너무 큼. 추적 중단.`);
                  break;
                }
              }
              
              currentUrl = nextLinkInfo;
            } catch (error: any) {
              consecutiveErrors++;
              
              // 연속 에러가 발생하면 중단
              if (consecutiveErrors >= maxConsecutiveErrors) {
                console.warn(`[NaverAdsPagination] 연속 ${consecutiveErrors}회 에러 발생. 추적 중단.`);
                break;
              }
              
              // 프레임 분리 에러는 추적 중단하되, 현재까지 발견한 최대 페이지 수는 유지
              if (error?.message?.includes('detached') || error?.message?.includes('LifecycleWatcher')) {
                console.warn(`[NaverAdsPagination] 프레임 분리 에러 발생. 현재까지 발견한 최대 페이지: ${lastPageFound}`);
                break;
              }
              
              // 리소스 부족 에러도 중단
              if (error?.message?.includes('ERR_INSUFFICIENT_RESOURCES')) {
                console.warn(`[NaverAdsPagination] 리소스 부족 에러 발생. 추적 중단.`);
                break;
              }
              
              console.error(`[NaverAdsPagination] 다음 페이지 이동 실패:`, error);
              // 에러 발생 시 잠시 대기 후 재시도
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          
          if (lastPageFound > maxLinkPage) {
            console.log(`[NaverAdsPagination] "다음 페이지" 링크 추적 결과: 전체 페이지 수 ${lastPageFound} (초기 최대값: ${maxLinkPage})`);
            paginationData.lastPageNumber = lastPageFound;
            paginationData.currentPageNumber = paginationData.currentPageNumber || 1;
          } else {
            console.warn(`[NaverAdsPagination] "다음 페이지" 링크 추적 완료. 전체 페이지 수를 정확히 알 수 없음. 링크의 최대값(${maxLinkPage})을 사용합니다.`);
          }
          
          // 원래 URL로 돌아가기 (프레임이 분리되지 않은 경우에만)
          try {
            if (!page.isClosed()) {
              await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
              await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
              console.warn(`[NaverAdsPagination] 페이지가 닫혀서 원래 URL로 복귀할 수 없습니다.`);
            }
          } catch (error: any) {
            // 프레임 분리 에러는 무시 (이미 추적은 완료됨)
            if (!error?.message?.includes('detached') && !error?.message?.includes('LifecycleWatcher')) {
              console.error(`[NaverAdsPagination] 원래 URL로 복귀 실패:`, error);
            }
          }
        }
      }

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

