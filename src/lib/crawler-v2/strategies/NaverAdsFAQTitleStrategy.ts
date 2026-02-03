/**
 * Naver Ads FAQ 페이지 제목 추출 전략
 * 
 * 특화 사항:
 * - content_title 클래스를 가진 요소를 최우선으로 추출
 * - Y 좌표가 음수여도 유효한 제목으로 처리 (스크롤 위치 고려)
 * - 피드백 텍스트, UI 요소, 프로모션 텍스트 필터링
 * 
 * 적용 대상:
 * - URL 패턴: ads.naver.com/help/faq/*
 * 
 * 주의사항:
 * - 이 전략은 Naver Ads FAQ 페이지에만 특화되어 있음
 * - 다른 벤더나 페이지 타입에는 적용되지 않음
 * - 새로운 벤더 추가 시 이 전략을 수정하지 말고 새로운 전략 클래스를 생성할 것
 */

import { Page } from 'puppeteer-core';
import { TitleExtractionStrategy, TitleExtractionResult } from './TitleExtractionStrategy';

export class NaverAdsFAQTitleStrategy implements TitleExtractionStrategy {
  getVendorType(): string {
    return 'NAVER';
  }

  async canHandle(url: string, page: Page): Promise<boolean> {
    return url.includes('ads.naver.com/help/faq/');
  }

  async extractTitle(url: string, page: Page): Promise<TitleExtractionResult> {
    console.log(`🔍 [NaverAdsFAQ] 제목 추출 시작... URL: ${url}`);

    // content_title 요소가 로드될 때까지 명시적으로 대기
    try {
      await page.waitForSelector('.content_title, h3.content_title, h2.content_title, h1.content_title', {
        timeout: 10000,
        visible: true
      });
      console.log(`✅ [NaverAdsFAQ] content_title 요소 로드 완료`);
    } catch (error) {
      console.warn(`⚠️ [NaverAdsFAQ] content_title 요소 대기 실패 (타임아웃 또는 요소 없음)`);
    }

    // 서버 측에서 content_title 요소 확인 (디버깅용)
    const contentTitleExists = await page.evaluate(() => {
      const elements = document.querySelectorAll('.content_title, h3.content_title, h2.content_title, h1.content_title');
      return {
        count: elements.length,
        texts: Array.from(elements).slice(0, 3).map(el => ({
          text: el.textContent?.trim()?.substring(0, 100) || '',
          tag: el.tagName,
          className: el.className || ''
        }))
      };
    });

    if (contentTitleExists.count > 0) {
      console.log(`✅ [NaverAdsFAQ] 서버 측: content_title 요소 ${contentTitleExists.count}개 발견`);
      contentTitleExists.texts.forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.tag}: "${item.text}" (class: ${item.className})`);
      });
    }

    // page.evaluate 내부에서 제목 추출
    const result = await page.evaluate((urlParam: string) => {
      // content_title 요소를 최우선으로 확인
      const mainContent = document.querySelector('main, article, .content, .main-content, [role="main"]') || document.body;
      const contentTitleElements = Array.from(mainContent.querySelectorAll('.content_title, h3.content_title, h2.content_title, h1.content_title'));
      
      // 디버깅 정보 수집
      const debugInfo: any = {
        contentTitleFound: contentTitleElements.length,
        contentTitleTexts: []
      };
      
      if (contentTitleElements.length > 0) {
        // content_title 요소가 있으면 즉시 반환 (최우선 처리)
        for (let i = 0; i < contentTitleElements.length; i++) {
          const el = contentTitleElements[i];
          const rect = el.getBoundingClientRect();
          const text = el.textContent?.trim() || '';
          
          debugInfo.contentTitleTexts.push({
            text: text.substring(0, 100),
            tag: el.tagName,
            y: Math.round(rect.top),
            length: text.length
          });
          
          // 기본 유효성 검사 (content_title은 Y 좌표 체크 완화)
          // Y 좌표가 음수인 경우는 스크롤 위치에 따라 요소가 화면 상단 밖에 있을 수 있음
          // content_title은 페이지의 실제 제목이므로 Y 좌표와 무관하게 유효
          // 단, 너무 멀리 떨어진 요소는 제외 (Y < -10000 또는 Y > 10000)
          const isReasonablePosition = rect.top >= -10000 && rect.top <= 10000;
          
          if (text && text.length >= 2 && text.length <= 200 && isReasonablePosition) {
            // content_title은 최고 우선순위이므로 필터링 최소화
            // 매우 명확한 잘못된 텍스트만 제외
            const lowerText = text.toLowerCase();
            const isVeryBad = 
              text.length < 2 ||
              /^[\d\s\-_]+$/.test(text) || // 숫자만
              text === '도움말 카테고리' ||
              text === '광고주센터' ||
              text === '도움말' ||
              lowerText.includes('위 내용으로 궁금한 점이 해결되지 않았나요') ||
              lowerText.includes('의견 보내주셔서 감사합니다');
            
            if (!isVeryBad) {
              return { type: 'faq', title: text, score: 1000, source: 'content_title-immediate', debugInfo };
            }
          }
        }
      }

      // content_title을 찾지 못한 경우 null 반환
      // (일반 제목 추출 로직은 ContentExtractor에서 처리)
      return { type: 'faq', title: null, score: 0, source: 'naver-ads-faq-failed', debugInfo };
    }, url);

    // 결과 처리
    if (result && typeof result === 'object' && 'type' in result && result.type === 'faq') {
      const faqResult = result as { type: string; title: string | null; score: number; source: string; debugInfo?: any };
      
      // debugInfo 출력
      if (faqResult.debugInfo) {
        console.log(`🔍 [NaverAdsFAQ] page.evaluate 내부 디버깅 정보:`);
        console.log(`  - content_title 요소 발견: ${faqResult.debugInfo.contentTitleFound}개`);
        if (faqResult.debugInfo.contentTitleTexts && faqResult.debugInfo.contentTitleTexts.length > 0) {
          faqResult.debugInfo.contentTitleTexts.forEach((item: any, idx: number) => {
            console.log(`    ${idx + 1}. "${item.text}" (tag: ${item.tag}, Y: ${item.y}, length: ${item.length})`);
          });
        }
      }
      
      if (faqResult.title) {
        console.log(`✅ [NaverAdsFAQ] 제목 추출 성공 - "${faqResult.title}" (출처: ${faqResult.source})`);
        return {
          title: faqResult.title,
          source: faqResult.source,
          score: faqResult.score,
          debugInfo: faqResult.debugInfo
        };
      }
    }

    // content_title을 찾지 못한 경우 null 반환
    // ContentExtractor에서 일반 제목 추출 로직으로 fallback
    return {
      title: null,
      source: 'naver-ads-faq-not-found',
      debugInfo: result?.debugInfo
    };
  }
}

