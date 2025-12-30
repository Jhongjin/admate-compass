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

      return {
        title: title || url,
        content: cleanContent,
      };
    } catch (error) {
      console.error(`❌ 콘텐츠 추출 실패: ${url}`, error);
      throw error;
    }
  }

  /**
   * 제목 추출 (개선: 더 다양한 전략 + 동적 로드 대기)
   */
  private async extractTitle(
    page: Page,
    html: string,
    strategy: 'h1' | 'title' | 'og:title' | 'auto',
    url: string
  ): Promise<string | null> {
    try {
      // 페이지 안정화 대기 (동적으로 로드되는 제목을 기다림)
      await this.waitForPageStabilization(page);

      // 전략에 따라 제목 추출 (우선순위: h1 > title > og:title > data-testid > class 기반 > pathname)
      const titleResult = await page.evaluate(() => {
        // 1. h1 태그 (가장 우선) - 메인 콘텐츠 영역 우선
        const mainH1 = document.querySelector('main h1, article h1, .content h1, .main-content h1');
        if (mainH1 && mainH1.textContent?.trim()) {
          return mainH1.textContent.trim();
        }

        // 일반 h1 태그
        const h1Element = document.querySelector('h1');
        if (h1Element && h1Element.textContent?.trim()) {
          return h1Element.textContent.trim();
        }

        // 2. title 태그
        const titleElement = document.querySelector('title');
        if (titleElement && titleElement.textContent?.trim()) {
          return titleElement.textContent.trim();
        }

        // 3. og:title 메타 태그
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.getAttribute('content')?.trim()) {
          return ogTitle.getAttribute('content')!.trim();
        }

        // 4. data-testid 기반
        const dataTestIdTitle = document.querySelector('[data-testid="page-title"]');
        if (dataTestIdTitle && dataTestIdTitle.textContent?.trim()) {
          return dataTestIdTitle.textContent.trim();
        }

        // 5. 클래스 기반 셀렉터들
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
          if (element && element.textContent?.trim()) {
            return element.textContent.trim();
          }
        }

        // 6. body의 첫 번째 큰 텍스트 요소 찾기 (폴백)
        const bodyText = document.body?.textContent || '';
        if (bodyText.length > 0) {
          // body의 첫 30% 영역에서 큰 폰트나 볼드 스타일을 가진 요소 찾기
          const firstThird = Math.floor(bodyText.length * 0.3);
          const bodyElements = Array.from(document.body?.querySelectorAll('*') || []);
          
          for (const el of bodyElements.slice(0, Math.floor(bodyElements.length * 0.3))) {
            const text = el.textContent?.trim() || '';
            if (!text || text.length < 2 || text.length > 100) continue;

            const style = window.getComputedStyle(el);
            const fontSize = parseInt(style.fontSize) || 0;
            const fontWeight = style.fontWeight;
            const tagName = el.tagName?.toLowerCase() || '';

            const hasLargeFont = fontSize >= 20;
            const hasBold = fontWeight === 'bold' || fontWeight === '700' || fontWeight === '800' || fontWeight === '900';
            const isHeading = ['h1', 'h2', 'h3', 'b', 'strong'].includes(tagName);

            if ((hasLargeFont || hasBold || isHeading) && text.length >= 2 && text.length <= 100) {
              return text;
            }
          }
        }

        return null;
      });

      let title: string | null = titleResult as string | null;

      // 모든 전략 실패 시 URL에서 추출
      if (!title) {
        try {
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split('/').filter(p => p);
          if (pathParts.length > 0) {
            const lastPart = pathParts[pathParts.length - 1];
            // URL 인코딩된 한글 디코딩 시도
            try {
              title = decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
            } catch {
              title = lastPart.replace(/[-_]/g, ' ');
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
      let previousTitle: string | null = null;
      let stableCount = 0;
      const requiredStableCount = 2; // 연속 2번 동일하면 안정화된 것으로 간주

      while (Date.now() - startTime < maxWaitTime) {
        const currentTitle = await page.evaluate(() => {
          // 여러 소스에서 제목 확인
          const h1 = document.querySelector('h1')?.textContent?.trim();
          const title = document.title?.trim();
          const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
          
          return h1 || title || ogTitle || null;
        });

        if (currentTitle === previousTitle && currentTitle) {
          stableCount++;
          if (stableCount >= requiredStableCount) {
            // 제목이 안정화됨
            return;
          }
        } else {
          stableCount = 0;
        }

        previousTitle = currentTitle;

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

