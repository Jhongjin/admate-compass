/**
 * 기본 제목 추출 전략
 * 벤더별 특화 전략이 적용되지 않는 경우 사용되는 일반적인 제목 추출 로직
 */

import { Page } from 'puppeteer-core';
import { TitleExtractionStrategy, TitleExtractionResult } from './TitleExtractionStrategy';

export class DefaultTitleStrategy implements TitleExtractionStrategy {
  getVendorType(): string {
    return 'UNKNOWN';
  }

  async canHandle(url: string, page: Page): Promise<boolean> {
    // 기본 전략은 항상 적용 가능 (fallback)
    return true;
  }

  async extractTitle(url: string, page: Page): Promise<TitleExtractionResult> {
    // 일반적인 제목 추출 로직
    // h1, title 태그, og:title 등을 순차적으로 확인
    const title = await page.evaluate(() => {
      // 1. h1 태그 (메인 콘텐츠 영역 우선)
      const mainH1 = document.querySelector('main h1, article h1, .content h1, .main-content h1, [role="main"] h1');
      if (mainH1) {
        const text = mainH1.textContent?.trim() || '';
        if (text && text.length >= 3 && text.length <= 150) {
          return text;
        }
      }

      // 2. 일반 h1 태그
      const h1 = document.querySelector('h1');
      if (h1) {
        const text = h1.textContent?.trim() || '';
        if (text && text.length >= 3 && text.length <= 150) {
          return text;
        }
      }

      // 3. title 태그
      const titleElement = document.querySelector('title');
      if (titleElement) {
        let titleText = titleElement.textContent?.trim() || '';
        // 불필요한 접미사 제거
        titleText = titleText
          .replace(/\s*[-|]\s*.*$/, '')
          .replace(/\s*::\s*.*$/, '')
          .trim();
        if (titleText && titleText.length >= 3 && titleText.length <= 150) {
          return titleText;
        }
      }

      // 4. og:title
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        const content = ogTitle.getAttribute('content')?.trim() || '';
        if (content && content.length >= 3 && content.length <= 150) {
          return content;
        }
      }

      return null;
    });

    return {
      title: title || null,
      source: 'default-strategy'
    };
  }
}

