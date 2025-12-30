/**
 * 콘텐츠 추출기
 * HTML에서 제목과 본문을 추출
 */

import { Page } from 'puppeteer-core';
import type { ContentExtractionOptions } from '../types';
import { extractTextFromHtml, extractTitleFromHtml, cleanHtml } from '../utils/html-utils';
import { processTextEncoding } from '@/lib/utils/textEncoding';

export class ContentExtractor {
  private defaultOptions: ContentExtractionOptions = {
    titleStrategy: 'auto',
    contentSelectors: ['main', 'article', '.content', '.main-content', '[role="main"]', '.page-content'],
    removeSelectors: ['script', 'style', 'nav', 'footer', 'header', 'aside'],
    minContentLength: 100,
  };

  /**
   * 페이지에서 콘텐츠 추출
   */
  async extractFromPage(
    page: Page,
    url: string,
    options: Partial<ContentExtractionOptions> = {}
  ): Promise<{ title: string; content: string }> {
    const config = { ...this.defaultOptions, ...options };

    try {
      // 페이지 HTML 가져오기
      const html = await page.content();

      // 제목 추출
      const title = await this.extractTitle(page, html, config.titleStrategy || 'auto', url);

      // 콘텐츠 추출
      const content = await this.extractContent(page, html, config);

      // UTF-8 인코딩 보장
      const encodingResult = processTextEncoding(content, { strictMode: true });
      const cleanContent = encodingResult.cleanedText;

      if (!cleanContent || cleanContent.length < (config.minContentLength || 100)) {
        throw new Error(`콘텐츠가 너무 짧습니다 (${cleanContent.length}자)`);
      }

      // FAQ 페이지인 경우 URL을 제목으로 사용하지 않음
      const isNaverAdsFAQ = url.includes('ads.naver.com/help/faq/');
      let finalTitle: string;
      
      if (isNaverAdsFAQ) {
        // FAQ 페이지는 제목을 찾지 못했을 때 URL을 사용하지 않음
        // 대신 "제목 없음" 또는 빈 문자열 사용 (나중에 수동으로 수정 가능)
        finalTitle = title || '제목 없음';
      } else {
        // 일반 페이지는 URL을 fallback으로 사용
        finalTitle = title || url;
      }
      
      return {
        title: finalTitle,
        content: cleanContent,
      };
    } catch (error) {
      console.error(`❌ 콘텐츠 추출 실패: ${url}`, error);
      throw error;
    }
  }

  /**
   * 제목 추출 (개선: 더 다양한 전략 + 동적 로드 대기 + 페이지 상단 가장 큰 볼드체 우선)
   */
  private async extractTitle(
    page: Page,
    html: string,
    strategy: 'h1' | 'title' | 'og:title' | 'auto',
    url: string
  ): Promise<string | null> {
    try {
      // 네이버 광고 페이지 같은 SPA의 경우 더 오래 대기
      const isNaverAds = url.includes('ads.naver.com');
      const isNaverAdsFAQ = isNaverAds && url.includes('/help/faq/');
      
      if (isNaverAdsFAQ) {
        // FAQ 페이지는 URL 파라미터로 콘텐츠가 동적으로 변경되므로 특별 처리
        try {
          // 초기 대기 (페이지 로드)
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // FAQ 제목이 로드될 때까지 대기 (최대 20초, 더 관대한 조건)
          await page.waitForFunction(
            () => {
              // 페이지에 의미있는 텍스트가 있는지 확인
              const bodyText = document.body.textContent || '';
              // 최소한의 텍스트가 있는지 확인 (제목이 로드되었는지 간접적으로 확인)
              if (bodyText.length < 100) {
                return false;
              }
              
              // FAQ 제목이 있는지 확인 (다양한 선택자 시도)
              const selectors = [
                'h1',
                'h2',
                'h3',
                '[class*="title"]',
                '[class*="question"]',
                '[class*="faq"]',
                'main h1',
                'main h2',
                'article h1',
                'article h2',
                '.content h1',
                '.content h2',
                '[role="heading"]',
                '[data-testid*="title"]',
                '[data-testid*="question"]'
              ];
              
              for (const selector of selectors) {
                try {
                  const elements = document.querySelectorAll(selector);
                  for (const el of elements) {
                    const text = el.textContent?.trim() || '';
                    // 공통 텍스트 및 피드백 텍스트 제외
                    const isCommon = ['광고주센터', '도움말', 'Help', 'Advertiser Center', '실전에 통하는'].includes(text);
                    const isFeedback = text.includes('위 도움말') || 
                                      text.includes('도움이 되었나요') ||
                                      text.includes('위 내용으로 궁금한 점이 해결되지 않았나요') ||
                                      text.includes('궁금한 점이 해결되지 않았나요');
                    const isNumeric = /^\d+[\s\-_]*$/.test(text);
                    if (text.length >= 3 && text.length <= 150 && !isCommon && !isFeedback && !isNumeric) {
                      return true;
                    }
                  }
                } catch (e) {
                  // 선택자 오류 무시
                }
              }
              return false;
            },
            { timeout: 20000, polling: 500 }
          ).catch(() => {
            console.warn('⚠️ FAQ 제목 로드 대기 타임아웃 (계속 진행)');
          });
          
          // 추가 대기 (동적 콘텐츠 완전 로드)
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
          console.warn('⚠️ FAQ 페이지 제목 대기 실패 (계속 진행):', error);
        }
      } else {
        const waitTime = isNaverAds ? 8000 : 5000;
        await this.waitForPageStabilization(page, waitTime);

        // 추가 대기 (동적 콘텐츠 로드)
        if (isNaverAds) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // 전략에 따라 제목 추출 (우선순위: h1 > h2 > 페이지 상단 가장 큰 볼드체 > title > og:title > data-testid > class 기반)
      const titleResult = await page.evaluate(() => {
        // 피드백/평가 관련 텍스트 필터링 함수
        const isFeedbackText = (text: string): boolean => {
          const lowerText = text.toLowerCase();
          const feedbackKeywords = [
            '위 도움말',
            '도움이 되었나요',
            '점 만점',
            '별점',
            '평가',
            '피드백',
            'was this help',
            'helpful',
            'rating',
            'feedback',
            '점수',
            '만족도',
            '의견',
            '보내주셔서 감사합니다',
            '위 내용으로 궁금한 점이 해결되지 않았나요',
            '궁금한 점이 해결되지 않았나요',
            '해결되지 않았나요',
            '추가 문의',
            '문의하기',
            '질문이 남아있나요'
          ];
          return feedbackKeywords.some(keyword => lowerText.includes(keyword));
        };

        // 0. 페이지 상단 가장 큰 볼드체 텍스트 찾기 (h1/h2가 없을 때만 사용)
        const findLargestBoldText = (): string | null => {
          const allElements = Array.from(document.querySelectorAll('*'));
          let largestElement: { element: Element; fontSize: number; fontWeight: number; y: number } | null = null;

          for (const el of allElements) {
            // nav, header, footer, aside 제외
            const tagName = el.tagName?.toLowerCase() || '';
            if (['nav', 'header', 'footer', 'aside', 'script', 'style'].includes(tagName)) continue;

            const text = el.textContent?.trim() || '';
            // 너무 짧거나 길면 제외
            if (text.length < 3 || text.length > 150) continue;
            // 일반적인 사이트 제목 제외 (광고주센터, 도움말 등)
            if (['광고주센터', '도움말', 'Help', 'Advertiser Center', '성공전략', '성공 전략'].includes(text)) continue;
            // 피드백/평가 텍스트 제외
            if (isFeedbackText(text)) continue;
            // 숫자만 있는 제목 제외
            if (/^\d+[\s\-_]*$/.test(text)) continue;

            const style = window.getComputedStyle(el);
            const fontSize = parseFloat(style.fontSize) || 0;
            const fontWeight = parseInt(style.fontWeight) || 400;
            const rect = el.getBoundingClientRect();
            const y = rect.top;

            // 페이지 상단 500px 이내에 있고, 큰 폰트(18px 이상) 또는 볼드체(600 이상)인 경우
            if (y >= 0 && y <= 500 && (fontSize >= 18 || fontWeight >= 600)) {
              // 자식 요소가 있으면 제외 (부모 요소가 아닌 실제 텍스트 요소만)
              const hasTextChildren = Array.from(el.children).some(child => {
                const childText = child.textContent?.trim() || '';
                return childText.length > 0 && childText.length < 150;
              });
              
              if (!hasTextChildren) {
                if (!largestElement || fontSize > largestElement.fontSize || 
                    (fontSize === largestElement.fontSize && fontWeight > largestElement.fontWeight)) {
                  largestElement = { element: el, fontSize, fontWeight, y };
                }
              }
            }
          }

          if (largestElement) {
            const text = largestElement.element.textContent?.trim() || '';
            // 일반적인 사이트 제목이 아닌 경우만 반환
            const isNumeric = /^\d+[\s\-_]*$/.test(text);
            const isCommonText = ['광고주센터', '도움말', 'Help', 'Advertiser Center', '성공전략', '성공 전략'].includes(text);
            if (text.length >= 3 && text.length <= 150 && 
                !isCommonText &&
                !isNumeric &&
                !isFeedbackText(text)) {
              return text;
            }
          }

          return null;
        };

        // Naver Ads FAQ 페이지 특화 제목 추출
        const isNaverAdsFAQ = window.location.href.includes('ads.naver.com/help/faq/');
        if (isNaverAdsFAQ) {
          // 숫자만 있는 제목인지 확인 (FAQ ID는 숫자지만 실제 제목은 문장 형태)
          const isNumericOnly = (text: string): boolean => {
            const trimmed = text.trim();
            // 숫자만 있거나, 숫자 + 공백/특수문자만 있는 경우
            if (/^\d+[\s\-_]*$/.test(trimmed)) {
              return true;
            }
            // URL에서 FAQ ID 추출하여 비교
            const urlMatch = window.location.href.match(/\/faq\/(\d+)/);
            if (urlMatch) {
              const faqId = urlMatch[1];
              // 제목이 FAQ ID와 정확히 일치하거나 숫자로만 구성된 경우
              if (trimmed === faqId || /^\d+$/.test(trimmed)) {
                return true;
              }
            }
            return false;
          };

          // 일반적인 사이트 제목 패턴 감지 함수
          const isGenericSiteTitle = (text: string): boolean => {
            return text === '네이버 광고주센터' ||
                   text === '광고주센터' ||
                   text === '도움말' ||
                   text === '네이버 광고주센터: 도움말' ||
                   text === '광고주센터: 도움말' ||
                   text.includes('네이버 광고주센터:') ||
                   text.includes('광고주센터:') ||
                   (text.length <= 20 && (
                     text.includes('광고주센터') || 
                     text.includes('도움말') ||
                     (text.includes('네이버') && !text.includes('?'))
                   ));
          };

          // 0. title 태그 확인 (하지만 일반적인 텍스트만 포함하는 경우 제외)
          const titleElement = document.querySelector('title');
          if (titleElement) {
            let titleText = titleElement.textContent?.trim() || '';
            
            // title 태그에서 불필요한 접미사 제거
            titleText = titleText
              .replace(/\s*[-|]\s*.*$/, '')
              .replace(/\s*::\s*.*$/, '')
              .trim();
            
            // "광고주센터", "NAVER" 같은 일반적인 접미사 제거
            const commonSuffixes = [
              /\s*-\s*광고주센터.*$/i,
              /\s*-\s*advertiser\s*center.*$/i,
              /\s*-\s*naver.*$/i,
              /\s*-\s*네이버.*$/i,
              /\s*\|\s*광고주센터.*$/i,
              /\s*\|\s*advertiser\s*center.*$/i,
              /\s*\|\s*naver.*$/i,
              /\s*\|\s*네이버.*$/i
            ];
            for (const suffix of commonSuffixes) {
              titleText = titleText.replace(suffix, '').trim();
            }
            
            // 일반적인 사이트 제목이 아닌 경우에만 반환
            if (titleText && titleText.length >= 5 && titleText.length <= 200 &&
                !isNumericOnly(titleText) &&
                !isGenericSiteTitle(titleText) &&
                !titleText.includes('카테고리 닫기') && !titleText.includes('카테고리 열기')) {
              console.log('✅ FAQ 제목 추출 성공 (title 태그):', titleText);
              return titleText;
            } else if (isGenericSiteTitle) {
              console.warn('⚠️ title 태그가 일반적인 사이트 제목만 포함, 본문에서 제목 찾기 시도');
            }
          }

          // 0-1. og:title 메타 태그 확인
          const ogTitle = document.querySelector('meta[property="og:title"]');
          if (ogTitle) {
            const ogTitleText = ogTitle.getAttribute('content')?.trim() || '';
            if (ogTitleText && ogTitleText.length >= 3 && ogTitleText.length <= 150 &&
                !ogTitleText.includes('카테고리') && !ogTitleText.includes('닫기') &&
                !ogTitleText.includes('광고주센터') && !ogTitleText.includes('도움말') &&
                !isFeedbackText(ogTitleText) && !isNumericOnly(ogTitleText)) {
              return ogTitleText;
            }
          }
          // FAQ 페이지의 실제 제목을 찾기 위한 특화 로직
          // 공통 텍스트 필터링 함수
          const isCommonText = (text: string): boolean => {
            const commonTexts = [
              '광고주센터',
              '도움말',
              'Help',
              'Advertiser Center',
              '실전에 통하는',
              '자주 묻는 질문',
              'FAQ',
              '성공전략',
              '성공 전략'
            ];
            return commonTexts.includes(text) || text.includes('실전에 통하는');
          };

          // UI/네비게이션 요소인지 확인하는 함수
          const isUIElement = (el: Element): boolean => {
            // 태그명 확인
            const tagName = el.tagName?.toLowerCase() || '';
            if (['nav', 'header', 'footer', 'aside', 'button', 'a'].includes(tagName)) {
              return true;
            }

            // role 속성 확인
            const role = el.getAttribute('role');
            if (role && ['navigation', 'button', 'menuitem', 'tab'].includes(role)) {
              return true;
            }

            // 클래스명 확인
            const className = el.className?.toLowerCase() || '';
            const uiKeywords = ['nav', 'menu', 'category', 'button', 'close', 'toggle', 'dropdown', 'tab'];
            if (uiKeywords.some(keyword => className.includes(keyword))) {
              return true;
            }

            // ID 확인
            const id = el.id?.toLowerCase() || '';
            if (uiKeywords.some(keyword => id.includes(keyword))) {
              return true;
            }

            // 텍스트 내용 확인 (UI 텍스트 패턴)
            const text = el.textContent?.trim() || '';
            const uiTextPatterns = ['카테고리', '닫기', '열기', '메뉴', 'category', 'close', 'open', 'menu'];
            if (uiTextPatterns.some(pattern => text.includes(pattern) && text.length < 20)) {
              return true;
            }

            // 부모 요소가 네비게이션인지 확인
            let parent = el.parentElement;
            let depth = 0;
            while (parent && depth < 5) {
              const parentTag = parent.tagName?.toLowerCase() || '';
              const parentRole = parent.getAttribute('role');
              const parentClass = parent.className?.toLowerCase() || '';
              if (['nav', 'header', 'aside'].includes(parentTag) ||
                  parentRole === 'navigation' ||
                  ['nav', 'menu', 'navigation'].some(k => parentClass.includes(k))) {
                return true;
              }
              parent = parent.parentElement;
              depth++;
            }

            return false;
          };

          // 1. 메인 콘텐츠 영역의 첫 번째 의미있는 제목 찾기
          // 네비게이션/UI 요소를 제외한 메인 콘텐츠 영역 찾기
          const mainContent = document.querySelector('main, article, .content, .main-content, [role="main"]') || document.body;
          
          // 네비게이션 요소 제외
          const navElements = document.querySelectorAll('nav, header, aside, [role="navigation"]');
          const excludedSelectors = new Set(Array.from(navElements).flatMap(el => Array.from(el.querySelectorAll('*'))));

          // 더 많은 선택자 시도
          const allHeadings = Array.from(mainContent.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="question"], [class*="heading"], [role="heading"], [data-testid*="title"], [data-testid*="question"]'));
          
          // 제목 후보들을 Y 좌표 순으로 정렬 (페이지 상단부터)
          const headingCandidates = allHeadings
            .map(el => {
              const rect = el.getBoundingClientRect();
              const text = el.textContent?.trim() || '';
              return { element: el, text, y: rect.top };
            })
            .filter(item => {
              // UI 요소 제외
              if (isUIElement(item.element)) {
                return false;
              }

              // 네비게이션 하위 요소 제외
              if (excludedSelectors.has(item.element)) {
                return false;
              }

              const text = item.text;
              
              // 너무 짧거나 길면 제외
              if (text.length < 2 || text.length > 200) {
                return false;
              }
              
              // UI 텍스트 패턴 제외 (하지만 너무 엄격하지 않게)
              if (text.length < 10 && (text.includes('카테고리') || text.includes('닫기') || text.includes('열기'))) {
                return false;
              }

              // 명확한 피드백 텍스트 패턴만 제외
              if (text.includes('위 내용으로 궁금한 점이 해결되지 않았나요') ||
                  text.includes('궁금한 점이 해결되지 않았나요?') ||
                  (text.includes('해결되지 않았나요') && text.length < 30)) {
                return false;
              }

              // 숫자만 있는 제목 제외
              if (isNumericOnly(text)) {
                return false;
              }

              // 일반적인 사이트 제목 패턴 제외 (모든 FAQ 페이지에서 동일한 제목)
              if (isGenericSiteTitle(text)) {
                return false;
              }

              // 공통 텍스트 제외 (하지만 너무 엄격하지 않게)
              if (isCommonText(text) && text.length < 20) {
                return false;
              }

              // 피드백 텍스트 제외 (하지만 너무 엄격하지 않게)
              if (isFeedbackText(text) && text.length < 30) {
                return false;
              }

              return item.y >= 0 && item.y <= 1500; // 페이지 상단 1500px 이내
            })
            .sort((a, b) => a.y - b.y); // Y 좌표 순 정렬

          // 첫 번째 유효한 제목 반환
          if (headingCandidates.length > 0) {
            const selectedTitle = headingCandidates[0].text;
            console.log('✅ FAQ 제목 추출 성공 (heading 후보):', selectedTitle);
            return selectedTitle;
          }
          
          console.warn('⚠️ FAQ 제목 후보를 찾지 못함, 다른 방법 시도');
          
          // Fallback: 페이지의 모든 텍스트 요소 중 가장 큰/볼드한 텍스트 찾기
          const allTextElements = Array.from(mainContent.querySelectorAll('*'));
          const textCandidates = allTextElements
            .map(el => {
              const rect = el.getBoundingClientRect();
              const text = el.textContent?.trim() || '';
              const style = window.getComputedStyle(el);
              const fontSize = parseFloat(style.fontSize) || 0;
              const fontWeight = parseInt(style.fontWeight) || 400;
              
              return { element: el, text, fontSize, fontWeight, y: rect.top };
            })
            .filter(item => {
              const text = item.text;
              
              // 너무 짧거나 길면 제외
              if (text.length < 5 || text.length > 200) return false;
              
              // UI 요소 제외
              if (isUIElement(item.element)) return false;
              
              // 네비게이션 하위 요소 제외
              if (excludedSelectors.has(item.element)) return false;
              
              // 명확한 UI 텍스트만 제외
              if (text.length < 10 && (text === '카테고리' || text === '닫기' || text === '열기')) return false;
              
              // 숫자만 있는 제목 제외
              if (isNumericOnly(text)) return false;
              
              // 명확한 피드백 텍스트만 제외
              if (text.includes('위 내용으로 궁금한 점이 해결되지 않았나요') ||
                  text.includes('궁금한 점이 해결되지 않았나요?')) return false;
              
              // 일반적인 사이트 제목 패턴 제외
              if (isGenericSiteTitle(text)) return false;
              
              // 페이지 상단 1500px 이내, 큰 폰트(16px 이상) 또는 볼드체(600 이상)
              return item.y >= 0 && item.y <= 1500 && 
                     (item.fontSize >= 16 || item.fontWeight >= 600);
            })
            .sort((a, b) => {
              // 폰트 크기와 굵기 우선, 그 다음 Y 좌표
              if (a.fontSize !== b.fontSize) return b.fontSize - a.fontSize;
              if (a.fontWeight !== b.fontWeight) return b.fontWeight - a.fontWeight;
              return a.y - b.y;
            });
          
          if (textCandidates.length > 0) {
            const selectedTitle = textCandidates[0].text;
            console.log('✅ FAQ 제목 추출 성공 (텍스트 후보):', selectedTitle);
            return selectedTitle;
          }

          // 일반적인 사이트 제목 패턴 감지 함수
          const isGenericSiteTitle = (text: string): boolean => {
            return text === '네이버 광고주센터' ||
                   text === '광고주센터' ||
                   text === '도움말' ||
                   text === '네이버 광고주센터: 도움말' ||
                   text === '광고주센터: 도움말' ||
                   text.includes('네이버 광고주센터:') ||
                   text.includes('광고주센터:') ||
                   (text.length <= 20 && (
                     text.includes('광고주센터') || 
                     text.includes('도움말') ||
                     (text.includes('네이버') && !text.includes('?'))
                   ));
          };

          // 2. 메인 콘텐츠 영역의 h1 우선 (UI 요소 제외)
          const mainH1Elements = Array.from(mainContent.querySelectorAll('h1'));
          for (const h1 of mainH1Elements) {
            if (isUIElement(h1)) continue;
            
            const text = h1.textContent?.trim() || '';
            if (text && text.length >= 3 && text.length <= 150 && 
                !isCommonText(text) && !isFeedbackText(text) &&
                !isNumericOnly(text) &&
                !isGenericSiteTitle(text) &&
                !text.includes('카테고리') && !text.includes('닫기')) {
              console.log('✅ FAQ 제목 추출 성공 (main h1):', text);
              return text;
            }
          }

          // 3. 모든 h1 태그 확인 (UI 요소 제외)
          const h1Elements = Array.from(document.querySelectorAll('h1'));
          for (const h1 of h1Elements) {
            if (isUIElement(h1)) continue;
            
            const rect = h1.getBoundingClientRect();
            const text = h1.textContent?.trim() || '';
            if (text && text.length >= 3 && text.length <= 150 && 
                rect.top >= 0 && rect.top <= 1000 &&
                !isCommonText(text) && !isFeedbackText(text) &&
                !isNumericOnly(text) &&
                !isGenericSiteTitle(text) &&
                !text.includes('카테고리') && !text.includes('닫기')) {
              console.log('✅ FAQ 제목 추출 성공 (h1):', text);
              return text;
            }
          }

          // 4. h2 태그 확인 (FAQ 제목이 h2에 있을 수 있음, UI 요소 제외)
          const h2Elements = Array.from(document.querySelectorAll('h2'));
          for (const h2 of h2Elements) {
            if (isUIElement(h2)) continue;
            
            const rect = h2.getBoundingClientRect();
            if (rect.top >= 0 && rect.top <= 1000) {
              const text = h2.textContent?.trim() || '';
              if (text && text.length >= 3 && text.length <= 150 && 
                  !isCommonText(text) && !isFeedbackText(text) &&
                  !isNumericOnly(text) &&
                  !isGenericSiteTitle(text) &&
                  !text.includes('카테고리') && !text.includes('닫기')) {
                console.log('✅ FAQ 제목 추출 성공 (h2):', text);
                return text;
              }
            }
          }

          // 5. FAQ 특화 클래스 선택자
          const faqSelectors = [
            '[class*="faq-title"]',
            '[class*="question-title"]',
            '[class*="faq-question"]',
            '[class*="faq-content"] h1',
            '[class*="faq-content"] h2',
            '[class*="question-content"] h1',
            '[class*="question-content"] h2',
            '[data-testid*="title"]',
            '[data-testid*="question"]'
          ];
          for (const selector of faqSelectors) {
            const element = document.querySelector(selector);
            if (element) {
              const rect = element.getBoundingClientRect();
              const text = element.textContent?.trim() || '';
              if (text && text.length >= 3 && text.length <= 150 && 
                  rect.top >= 0 && rect.top <= 1000 &&
                  !isCommonText(text) && !isFeedbackText(text) &&
                  !isNumericOnly(text)) {
                return text;
              }
            }
          }
        }

        // 1. h1 태그 (가장 우선) - 메인 콘텐츠 영역 우선
        const mainH1 = document.querySelector('main h1, article h1, .content h1, .main-content h1, [role="main"] h1');
        if (mainH1) {
          const text = mainH1.textContent?.trim() || '';
          if (text && text.length >= 3 && text.length <= 150 && 
              !['광고주센터', '도움말', 'Help', 'Advertiser Center', '실전에 통하는'].includes(text) &&
              !isFeedbackText(text) && !text.includes('실전에 통하는')) {
            return text;
          }
        }

        // 일반 h1 태그
        const h1Elements = Array.from(document.querySelectorAll('h1'));
        for (const h1 of h1Elements) {
          const text = h1.textContent?.trim() || '';
          if (text && text.length >= 3 && text.length <= 150 && 
              !['광고주센터', '도움말', 'Help', 'Advertiser Center', '실전에 통하는'].includes(text) &&
              !isFeedbackText(text) && !text.includes('실전에 통하는')) {
            return text;
          }
        }

        // 2. h2 태그 (h1이 없을 때)
        const h2Elements = Array.from(document.querySelectorAll('h2'));
        for (const h2 of h2Elements) {
          const rect = h2.getBoundingClientRect();
          if (rect.top >= 0 && rect.top <= 500) {
            const text = h2.textContent?.trim() || '';
            // 숫자만 있는 제목인지 확인
            const isNumeric = /^\d+[\s\-_]*$/.test(text);
            if (text && text.length >= 3 && text.length <= 150 && 
                !isNumeric &&
                !['광고주센터', '도움말', 'Help', 'Advertiser Center', '실전에 통하는'].includes(text) &&
                !isFeedbackText(text) && !text.includes('실전에 통하는')) {
              return text;
            }
          }
        }

        // 페이지 상단 가장 큰 볼드체 텍스트 (h1/h2가 없을 때만 사용)
        const largestBoldText = findLargestBoldText();
        if (largestBoldText) {
          return largestBoldText;
        }

        // 3. title 태그 (일반적인 사이트 제목이 아닌 경우만)
        const titleElement = document.querySelector('title');
        if (titleElement) {
          let text = titleElement.textContent?.trim() || '';
          // title 태그에서 불필요한 접미사 제거
          text = text
            .replace(/\s*[-|]\s*.*$/, '') // " - 사이트명" 또는 " | 사이트명" 제거
            .replace(/\s*::\s*.*$/, '') // " :: 사이트명" 제거
            .trim();
          
          // "광고주센터", "NAVER" 같은 일반적인 접미사 제거
          const commonSuffixes = [
            /광고주센터.*$/i,
            /advertiser\s*center.*$/i,
            /naver.*$/i,
            /네이버.*$/i
          ];
          for (const suffix of commonSuffixes) {
            text = text.replace(suffix, '').trim();
          }
          
          // 숫자만 있는 제목인지 확인
          const isNumeric = /^\d+[\s\-_]*$/.test(text);
          if (text && text.length >= 3 && text.length <= 150 && 
              !isNumeric &&
              !['광고주센터', '도움말', 'Help', 'Advertiser Center'].includes(text) &&
              !text.includes('광고주센터') && !text.includes('Advertiser Center') &&
              !isFeedbackText(text)) {
            return text;
          }
        }

        // 4. og:title 메타 태그
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) {
          const text = ogTitle.getAttribute('content')?.trim() || '';
          // 숫자만 있는 제목인지 확인
          const isNumeric = /^\d+[\s\-_]*$/.test(text);
          if (text && text.length >= 3 && text.length <= 150 && 
              !isNumeric &&
              !['광고주센터', '도움말', 'Help', 'Advertiser Center'].includes(text) &&
              !isFeedbackText(text)) {
            return text;
          }
        }

        // 5. data-testid 기반
        const dataTestIdTitle = document.querySelector('[data-testid="page-title"]');
        if (dataTestIdTitle) {
          const text = dataTestIdTitle.textContent?.trim() || '';
          // 숫자만 있는 제목인지 확인
          const isNumeric = /^\d+[\s\-_]*$/.test(text);
          if (text && text.length >= 3 && text.length <= 150 && 
              !isNumeric &&
              !['광고주센터', '도움말', 'Help', 'Advertiser Center'].includes(text) &&
              !isFeedbackText(text)) {
            return text;
          }
        }

        // 6. 클래스 기반 셀렉터들
        const classSelectors = [
          '.page-title',
          '.article-title',
          '.post-title',
          '.entry-title',
          'h1.page-title',
          'h1.article-title',
          '.content-title',
          '.main-title',
          '[role="heading"][aria-level="1"]',
          'h1[class*="title"]',
          'h1[class*="heading"]',
        ];
        for (const selector of classSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            const text = element.textContent?.trim() || '';
            // 숫자만 있는 제목인지 확인
            const isNumeric = /^\d+[\s\-_]*$/.test(text);
            if (text && text.length >= 3 && text.length <= 150 && 
                !isNumeric &&
                !['광고주센터', '도움말', 'Help', 'Advertiser Center'].includes(text) &&
                !isFeedbackText(text)) {
              return text;
            }
          }
        }

        return null;
      });

      let title: string | null = titleResult as string | null;

      // 일반적인 사이트 제목 및 피드백 텍스트 필터링
        if (title) {
        const lowerTitle = title.toLowerCase();
        const isGenericTitle = ['광고주센터', '도움말', 'Help', 'Advertiser Center', '실전에 통하는'].includes(title);
        const isFeedback = [
          '위 도움말',
          '도움이 되었나요',
          '점 만점',
          '별점',
          '평가',
          '피드백',
          'was this help',
          'helpful',
          'rating',
          'feedback',
          '점수',
          '만족도',
          '의견',
          '보내주셔서 감사합니다',
          '위 내용으로 궁금한 점이 해결되지 않았나요',
          '궁금한 점이 해결되지 않았나요',
          '해결되지 않았나요',
          '추가 문의',
          '문의하기',
          '질문이 남아있나요'
        ].some(keyword => lowerTitle.includes(keyword));
        
        // "실전에 통하는" 같은 공통 문구가 포함된 경우 제외
        const hasCommonPhrase = lowerTitle.includes('실전에 통하는');
        
        // 숫자만 있는 제목인지 확인 (FAQ ID는 숫자지만 실제 제목은 문장 형태)
        const isNumericTitle = /^\d+[\s\-_]*$/.test(title.trim());
        
        // URL에서 FAQ ID 추출하여 제목과 비교 (Naver Ads FAQ 페이지인 경우)
        let isFaqId = false;
        if (url.includes('ads.naver.com/help/faq/')) {
          const urlMatch = url.match(/\/faq\/(\d+)/);
          if (urlMatch) {
            const faqId = urlMatch[1];
            // 제목이 FAQ ID와 정확히 일치하거나 숫자로만 구성된 경우
            if (title.trim() === faqId || /^\d+$/.test(title.trim())) {
              isFaqId = true;
            }
          }
        }
        
        // UI/네비게이션 텍스트 제외
        const isUIText = [
          '카테고리',
          '닫기',
          '열기',
          '메뉴',
          'category',
          'close',
          'open',
          'menu'
        ].some(keyword => lowerTitle.includes(keyword));
        
        // "성공전략" 같은 공통 텍스트 제외
        const isCommonText = ['성공전략', '성공 전략', '광고주센터', '도움말', 'Help', 'Advertiser Center', '실전에 통하는', '자주 묻는 질문', 'FAQ'].includes(title) || lowerTitle.includes('실전에 통하는') || lowerTitle.includes('성공전략') || lowerTitle.includes('성공 전략');
        
        if (isGenericTitle || isFeedback || hasCommonPhrase || isUIText || isNumericTitle || isCommonText || isFaqId) {
          console.warn(`⚠️ 일반적인 제목/피드백/UI 텍스트/숫자 제목/공통 텍스트/FAQ ID 감지, 제외: "${title}"`);
          title = null;
        }
      }

      // 모든 전략 실패 시 URL에서 추출 (단, FAQ 페이지는 제외)
      if (!title && !url.includes('ads.naver.com/help/faq/')) {
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts.length > 0) {
          const lastPart = pathParts[pathParts.length - 1];
            // 숫자만 있는 경우 제외 (FAQ ID 등)
            if (/^\d+$/.test(lastPart)) {
              return null;
            }
            // URL 인코딩된 한글 디코딩 시도
            try {
              title = decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
            } catch {
              title = lastPart.replace(/[-_]/g, ' ');
            }
            // 숫자만 있는 제목인지 다시 확인
            if (/^\d+[\s\-_]*$/.test(title.trim())) {
              return null;
            }
        }
      } catch {
        // URL 파싱 실패 시 무시
        }
      }

      return title;
    } catch (error) {
      console.warn('⚠️ 제목 추출 실패:', error);
      return null;
    }
  }

  /**
   * 페이지 안정화 대기 (동적으로 로드되는 제목을 기다림)
   */
  private async waitForPageStabilization(page: Page, maxWaitTime: number = 5000): Promise<void> {
    try {
      // 제목이 변경되지 않을 때까지 대기 (최대 maxWaitTime)
      const startTime = Date.now();
      let previousLargestText: string | null = null;
      let stableCount = 0;
      const requiredStableCount = 3; // 연속 3번 동일하면 안정화된 것으로 간주

      while (Date.now() - startTime < maxWaitTime) {
        const currentLargestText = await page.evaluate(() => {
          // 피드백/평가 관련 텍스트 필터링 함수
          const isFeedbackText = (text: string): boolean => {
            const lowerText = text.toLowerCase();
            const feedbackKeywords = [
              '위 도움말',
              '도움이 되었나요',
              '점 만점',
              '별점',
              '평가',
              '피드백',
              'was this help',
              'helpful',
              'rating',
              'feedback',
              '점수',
              '만족도',
              '의견',
              '보내주셔서 감사합니다'
            ];
            return feedbackKeywords.some(keyword => lowerText.includes(keyword));
          };

          // h1 태그 우선 확인
          const h1 = document.querySelector('h1')?.textContent?.trim();
          if (h1 && h1.length >= 3 && h1.length <= 150 && 
              !['광고주센터', '도움말', 'Help', 'Advertiser Center'].includes(h1) &&
              !isFeedbackText(h1)) {
            return h1;
          }

          // 페이지 상단 가장 큰 볼드체 텍스트 찾기
          const allElements = Array.from(document.querySelectorAll('*'));
          let largestElement: { element: Element; fontSize: number; fontWeight: number; y: number } | null = null;

          for (const el of allElements) {
            const tagName = el.tagName?.toLowerCase() || '';
            if (['nav', 'header', 'footer', 'aside', 'script', 'style'].includes(tagName)) continue;

            const text = el.textContent?.trim() || '';
            if (text.length < 3 || text.length > 150) continue;
            if (['광고주센터', '도움말', 'Help', 'Advertiser Center'].includes(text)) continue;
            if (isFeedbackText(text)) continue;

            const style = window.getComputedStyle(el);
            const fontSize = parseFloat(style.fontSize) || 0;
            const fontWeight = parseInt(style.fontWeight) || 400;
            const rect = el.getBoundingClientRect();
            const y = rect.top;

            if (y >= 0 && y <= 500 && (fontSize >= 18 || fontWeight >= 600)) {
              const hasTextChildren = Array.from(el.children).some(child => {
                const childText = child.textContent?.trim() || '';
                return childText.length > 0 && childText.length < 150;
              });
              
              if (!hasTextChildren) {
                if (!largestElement || fontSize > largestElement.fontSize || 
                    (fontSize === largestElement.fontSize && fontWeight > largestElement.fontWeight)) {
                  largestElement = { element: el, fontSize, fontWeight, y };
                }
              }
            }
          }

          if (largestElement) {
            const text = largestElement.element.textContent?.trim() || '';
            if (text.length >= 3 && text.length <= 150 && 
                !['광고주센터', '도움말', 'Help', 'Advertiser Center'].includes(text) &&
                !isFeedbackText(text)) {
              return text;
            }
          }

          return null;
        });

        if (currentLargestText === previousLargestText && currentLargestText) {
          stableCount++;
          if (stableCount >= requiredStableCount) {
            // 제목이 안정화됨
            return;
          }
        } else {
          stableCount = 0;
        }

        previousLargestText = currentLargestText;

        // 짧은 대기 후 다시 확인
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // 최소 대기 시간 (동적 콘텐츠 로드 시간 확보)
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.warn('⚠️ 페이지 안정화 대기 실패 (계속 진행):', error);
      // 에러가 발생해도 최소 대기 시간은 확보
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * 콘텐츠 추출
   */
  private async extractContent(
    page: Page,
    html: string,
    config: ContentExtractionOptions
  ): Promise<string> {
    try {
      // 페이지에서 콘텐츠 영역 찾기
      const content = await page.evaluate((selectors, removeSelectors) => {
        // 불필요한 요소 제거
        const elementsToRemove = document.querySelectorAll(removeSelectors.join(','));
        elementsToRemove.forEach(el => el.remove());

        // 콘텐츠 영역 찾기
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            return element.textContent || '';
          }
        }

        // 콘텐츠 영역을 찾지 못하면 body 사용
        return document.body?.textContent || '';
      }, config.contentSelectors || [], config.removeSelectors || []);

      // HTML 정리
      const cleanedHtml = cleanHtml(html, config.removeSelectors);
      const textContent = extractTextFromHtml(cleanedHtml);

      // 페이지에서 추출한 콘텐츠와 HTML 파싱 결과 중 더 긴 것 사용
      const finalContent = content.length > textContent.length ? content : textContent;

      // 공백 정리
      return finalContent.replace(/\s+/g, ' ').trim();
    } catch (error) {
      console.warn('⚠️ 콘텐츠 추출 실패, HTML 파싱으로 폴백:', error);
      
      // 폴백: HTML 직접 파싱
      const cleanedHtml = cleanHtml(html, config.removeSelectors || []);
      return extractTextFromHtml(cleanedHtml).replace(/\s+/g, ' ').trim();
    }
  }

  /**
   * HTML 문자열에서 직접 콘텐츠 추출 (Puppeteer 없이)
   */
  extractFromHtml(
    html: string,
    url: string,
    options: Partial<ContentExtractionOptions> = {}
  ): { title: string; content: string } {
    const config = { ...this.defaultOptions, ...options };

    // 제목 추출
    const title = extractTitleFromHtml(html, config.titleStrategy || 'auto') || url;

    // 콘텐츠 추출
    const cleanedHtml = cleanHtml(html, config.removeSelectors);
    let content = extractTextFromHtml(cleanedHtml).replace(/\s+/g, ' ').trim();

    // UTF-8 인코딩 보장
    const encodingResult = processTextEncoding(content, { strictMode: true });
    content = encodingResult.cleanedText;

    if (!content || content.length < (config.minContentLength || 100)) {
      throw new Error(`콘텐츠가 너무 짧습니다 (${content.length}자)`);
    }

    return { title, content };
  }
}

// 싱글톤 인스턴스
export const contentExtractor = new ContentExtractor();

