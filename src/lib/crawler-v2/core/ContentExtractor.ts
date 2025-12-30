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

      // 전략에 따라 제목 추출 (우선순위: FAQ 특화 로직 > h1 > h2 > 페이지 상단 가장 큰 볼드체 > title > og:title > data-testid > class 기반)
      // FAQ 페이지인 경우 URL을 전달하여 명확하게 감지
      if (isNaverAdsFAQ) {
        console.log(`🔍 [FAQ 제목 추출] 서버 측: FAQ 페이지 감지, 제목 추출 시작... URL: ${url}`);
      }
      const titleResult = await page.evaluate((urlParam: string) => {
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

        // Naver Ads FAQ 페이지 특화 제목 추출 (가장 먼저 실행 - 일반 로직보다 우선)
        // URL 파라미터로 전달받은 URL을 사용하여 명확하게 감지
        const isNaverAdsFAQ = urlParam.includes('ads.naver.com/help/faq/');
        if (isNaverAdsFAQ) {
          console.log('🔍 [FAQ 제목 추출] Naver Ads FAQ 페이지 감지, 제목 추출 시작...');
          console.log('🔍 [FAQ 제목 추출] URL:', urlParam);
          
          // 완전히 새로운 접근: 모든 제목 후보를 수집하고 점수화 (필터링 최소화)
          const collectAllTitleCandidates = (): Array<{text: string, score: number, source: string}> => {
            const candidates: Array<{text: string, score: number, source: string}> = [];
            const mainContent = document.querySelector('main, article, .content, .main-content, [role="main"]') || document.body;
            
            console.log(`🔍 [FAQ 제목 추출] 메인 콘텐츠 영역: ${mainContent.tagName} (${mainContent.className || 'no-class'})`);
            
            // 1. 모든 h1, h2, h3, h4 수집 (네비게이션/UI 텍스트 제외)
            const headings = Array.from(mainContent.querySelectorAll('h1, h2, h3, h4'));
            console.log(`🔍 [FAQ 제목 추출] 발견된 heading 태그: ${headings.length}개`);
            
            // 제외할 텍스트 패턴 (수집 단계에서 미리 필터링)
            const excludedHeadingTexts = [
              '도움말 카테고리',
              '도움말',
              '광고주센터',
              '네이버 광고주센터',
              '카테고리',
              '카테고리 닫기',
              '카테고리 열기'
            ];
            
            headings.forEach((el, idx) => {
              const rect = el.getBoundingClientRect();
              const text = el.textContent?.trim() || '';
              
              // 네비게이션/UI 텍스트 제외 (수집 단계에서 미리 필터링)
              if (excludedHeadingTexts.some(excluded => text === excluded || text.includes(excluded))) {
                console.log(`  - ${el.tagName}: "${text.substring(0, 50)}" (제외: 네비게이션/UI 텍스트)`);
                return; // continue 대신 return 사용 (forEach 내부)
              }
              
              if (text && text.length >= 2 && text.length <= 200 && rect.top >= 0 && rect.top <= 2000) {
                let score = 100;
                if (el.tagName === 'H1') score += 50;
                else if (el.tagName === 'H2') score += 30;
                else if (el.tagName === 'H3') score += 10;
                else if (el.tagName === 'H4') score -= 20; // h4는 점수 감점 (네비게이션/UI 가능성 높음)
                // 페이지 상단에 가까울수록 높은 점수
                score += Math.max(0, 50 - Math.floor(rect.top / 20));
                // 첫 번째 제목에 보너스
                if (idx === 0) score += 20;
                candidates.push({ text, score, source: `heading-${el.tagName.toLowerCase()}` });
                console.log(`  - ${el.tagName}: "${text.substring(0, 50)}" (점수: ${score}, Y: ${Math.round(rect.top)})`);
              }
            });
            
            // 2. 클래스명에 title, question이 포함된 요소 수집
            const titleElements = Array.from(mainContent.querySelectorAll('[class*="title"], [class*="question"], [class*="heading"]'));
            console.log(`🔍 [FAQ 제목 추출] 발견된 title/question 클래스 요소: ${titleElements.length}개`);
            titleElements.forEach(el => {
              const rect = el.getBoundingClientRect();
              const text = el.textContent?.trim() || '';
              if (text && text.length >= 2 && text.length <= 200 && rect.top >= 0 && rect.top <= 2000) {
                let score = 80;
                if (el.className.includes('title')) score += 30;
                if (el.className.includes('question')) score += 25;
                score += Math.max(0, 30 - Math.floor(rect.top / 30));
                candidates.push({ text, score, source: 'class-based' });
                console.log(`  - class-based: "${text.substring(0, 50)}" (점수: ${score}, Y: ${Math.round(rect.top)})`);
              }
            });
            
            // 3. 큰 폰트/볼드 텍스트 수집 (더 관대한 조건)
            const allElements = Array.from(mainContent.querySelectorAll('*'));
            let largeTextCount = 0;
            allElements.forEach(el => {
              const rect = el.getBoundingClientRect();
              const text = el.textContent?.trim() || '';
              if (text && text.length >= 3 && text.length <= 200 && rect.top >= 0 && rect.top <= 2000) {
                const style = window.getComputedStyle(el);
                const fontSize = parseFloat(style.fontSize) || 0;
                const fontWeight = parseInt(style.fontWeight) || 400;
                
                // 더 관대한 조건: 16px 이상 또는 500 이상
                if (fontSize >= 16 || fontWeight >= 500) {
                  let score = 60;
                  if (fontSize >= 24) score += 20;
                  if (fontWeight >= 700) score += 15;
                  score += Math.max(0, 20 - Math.floor(rect.top / 50));
                  candidates.push({ text, score, source: 'large-text' });
                  largeTextCount++;
                  if (largeTextCount <= 5) {
                    console.log(`  - large-text: "${text.substring(0, 50)}" (점수: ${score}, 폰트: ${Math.round(fontSize)}px/${fontWeight}, Y: ${Math.round(rect.top)})`);
                  }
                }
              }
            });
            console.log(`🔍 [FAQ 제목 추출] 발견된 큰 텍스트 요소: ${largeTextCount}개`);
            
            console.log(`🔍 [FAQ 제목 추출] 총 후보 수집: ${candidates.length}개`);
            return candidates;
          };
          
          // 제목 후보 수집 및 점수화
          const candidates = collectAllTitleCandidates();
          
          if (candidates.length === 0) {
            console.warn('⚠️ [FAQ 제목 추출] 후보가 하나도 없음!');
          } else {
            console.log(`🔍 [FAQ 제목 추출] 수집된 후보: ${candidates.length}개`);
          }
          
          // 점수 순으로 정렬
          candidates.sort((a, b) => b.score - a.score);
          
          // 상위 10개 후보 로그
          console.log('🔍 [FAQ 제목 추출] 상위 10개 후보:');
          candidates.slice(0, 10).forEach((c, i) => {
            console.log(`  ${i + 1}. "${c.text.substring(0, 60)}" (점수: ${c.score}, 출처: ${c.source})`);
          });
          
          // 필터링: 최소한의 필터링만 적용 (거의 모든 텍스트 허용)
          const badPatterns = [
            /^[\d\s\-_]+$/, // 숫자만 (FAQ ID)
            /^광고주센터$/,
            /^도움말$/,
            /^도움말\s+카테고리$/, // "도움말 카테고리" 명시적 제외
            /도움말\s*카테고리/, // "도움말 카테고리" 포함된 모든 텍스트 제외
            /카테고리\s*(닫기|열기)/,
            /위 내용으로 궁금한 점이 해결되지 않았나요/,
            /궁금한 점이 해결되지 않았나요\?/,
            /^성공전략$/,
            /^성공 전략$/
          ];
          
          // 피드백/평가 관련 텍스트 필터링 함수 (FAQ 특화 로직용)
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
              '의견 보내주셔서 감사합니다',
              '위 내용으로 궁금한 점이 해결되지 않았나요',
              '궁금한 점이 해결되지 않았나요',
              '해결되지 않았나요',
              '추가 문의',
              '문의하기',
              '질문이 남아있나요'
            ];
            return feedbackKeywords.some(keyword => lowerText.includes(keyword));
          };
          
          // 명시적으로 제외할 텍스트 목록
          const excludedTexts = [
            '도움말 카테고리',
            '도움말',
            '광고주센터',
            '네이버 광고주센터',
            '성공전략',
            '성공 전략',
            '의견 보내주셔서 감사합니다.',
            '의견 보내주셔서 감사합니다'
          ];
          
          // URL에서 FAQ ID 추출
          const urlMatch = window.location.href.match(/\/faq\/(\d+)/);
          const faqId = urlMatch ? urlMatch[1] : null;
          
          // 최고 점수 후보 찾기 (필터링 최소화)
          for (const candidate of candidates) {
            const text = candidate.text.trim();
            
            // 명시적으로 제외할 텍스트 체크 (가장 먼저)
            if (excludedTexts.some(excluded => text === excluded || text.includes(excluded))) {
              console.log(`  ❌ 필터링됨: "${text.substring(0, 50)}" (제외 텍스트 목록)`);
              continue;
            }
            
            // 피드백/평가 텍스트 제외
            if (isFeedbackText(text)) {
              console.log(`  ❌ 필터링됨: "${text.substring(0, 50)}" (피드백 텍스트)`);
              continue;
            }
            
            // 명확히 잘못된 패턴만 제외
            if (badPatterns.some(pattern => pattern.test(text))) {
              console.log(`  ❌ 필터링됨: "${text.substring(0, 50)}" (나쁜 패턴)`);
              continue;
            }
            
            // FAQ ID와 정확히 일치하는 경우 제외
            if (faqId && text === faqId) {
              console.log(`  ❌ 필터링됨: "${text}" (FAQ ID와 일치)`);
              continue;
            }
            
            // 매우 짧은 텍스트만 제외 (2자 이상 허용)
            if (text.length < 2) {
              console.log(`  ❌ 필터링됨: "${text}" (너무 짧음)`);
              continue;
            }
            
            // 일반적인 사이트 제목만 제외 (더 엄격하게)
            if (text.length <= 10 && (
              text === '네이버 광고주센터' ||
              text === '광고주센터' ||
              text === '도움말'
            )) {
              console.log(`  ❌ 필터링됨: "${text}" (일반 사이트 제목)`);
              continue;
            }
            
            // 유효한 제목 발견
            console.log(`✅ [FAQ 제목 추출 성공] "${text}" (점수: ${candidate.score}, 출처: ${candidate.source})`);
            return { type: 'faq', title: text, score: candidate.score, source: candidate.source };
          }
          
          console.warn('⚠️ [FAQ 제목 추출] 모든 후보가 필터링됨');
          
          // Fallback 1: 첫 번째 후보를 무조건 반환 (필터링 없이)
          if (candidates.length > 0) {
            const firstCandidate = candidates[0].text.trim();
            console.log(`⚠️ [FAQ 제목 추출] 필터링 실패, 첫 번째 후보 반환: "${firstCandidate}"`);
            return { type: 'faq', title: firstCandidate, score: candidates[0].score, source: candidates[0].source };
          }
          
          // Fallback 2: 페이지의 모든 텍스트 요소 중 첫 번째 의미있는 텍스트 찾기
          console.log('🔍 [FAQ 제목 추출] Fallback: 모든 텍스트 요소 스캔 시작...');
          const allTextElements = Array.from(document.querySelectorAll('*'));
          for (const el of allTextElements) {
            const tagName = el.tagName?.toLowerCase() || '';
            // nav, header, footer, aside, script, style 제외
            if (['nav', 'header', 'footer', 'aside', 'script', 'style', 'meta', 'link'].includes(tagName)) continue;
            
            const rect = el.getBoundingClientRect();
            const text = el.textContent?.trim() || '';
            
            // 기본 조건: 3자 이상 200자 이하, 페이지 상단 2000px 이내
            if (text.length >= 3 && text.length <= 200 && rect.top >= 0 && rect.top <= 2000) {
              // 숫자만 있는 경우 제외
              if (/^[\d\s\-_]+$/.test(text)) continue;
              
              // 매우 짧은 일반 텍스트만 제외
              if (text.length <= 2) continue;
              
              // 첫 번째 유효한 텍스트 반환
              console.log(`✅ [FAQ 제목 추출] Fallback 성공: "${text.substring(0, 60)}"`);
              return { type: 'faq', title: text, score: 50, source: 'fallback-text' };
            }
          }
          
          // Fallback 3: title 태그 확인
          const titleElement = document.querySelector('title');
          if (titleElement) {
            let titleText = titleElement.textContent?.trim() || '';
            console.log(`🔍 [FAQ 제목 추출] title 태그: "${titleText}"`);
            
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
            
            // 최소한의 필터링만 적용
            const isBadTitle = 
              /^[\d\s\-_]+$/.test(titleText) || // 숫자만
              (titleText.length <= 2);
            
            if (titleText && titleText.length >= 3 && titleText.length <= 200 && !isBadTitle) {
              console.log(`✅ [FAQ 제목 추출 성공] title 태그 fallback: "${titleText}"`);
              return { type: 'faq', title: titleText, score: 40, source: 'title-tag' };
            }
          }
          
          // Fallback 4: body의 첫 번째 텍스트 노드
          const bodyText = document.body.textContent?.trim() || '';
          if (bodyText.length > 0) {
            const firstSentence = bodyText.split(/[.!?。！？\n]/)[0].trim();
            if (firstSentence.length >= 3 && firstSentence.length <= 200) {
              console.log(`✅ [FAQ 제목 추출] body 첫 문장 반환: "${firstSentence.substring(0, 60)}"`);
              return { type: 'faq', title: firstSentence, score: 30, source: 'body-first-sentence' };
            }
          }
          
          console.error('❌ [FAQ 제목 추출] 모든 방법 실패 - 제목을 찾을 수 없음');
          return null; // 명시적으로 null 반환
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
      }, url); // URL을 파라미터로 전달

      // FAQ 특화 로직 결과 처리
      let title: string | null = null;
      if (titleResult && typeof titleResult === 'object' && 'type' in titleResult && titleResult.type === 'faq') {
        title = (titleResult as { type: string; title: string; score: number; source: string }).title;
        console.log(`✅ [FAQ 제목 추출] 서버 측: 제목 추출 성공 - "${title}" (출처: ${(titleResult as any).source})`);
      } else if (typeof titleResult === 'string') {
        title = titleResult;
      } else {
        title = null;
        if (isNaverAdsFAQ) {
          console.warn(`⚠️ [FAQ 제목 추출] 서버 측: FAQ 페이지에서 제목을 찾지 못함 - null 반환`);
        }
      }

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

