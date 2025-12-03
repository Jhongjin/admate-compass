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
   * 제목 추출
   */
  private async extractTitle(
    page: Page,
    html: string,
    strategy: 'h1' | 'title' | 'og:title' | 'auto',
    url: string
  ): Promise<string | null> {
    try {
      // 전략에 따라 제목 추출
      if (strategy === 'h1' || strategy === 'auto') {
        const h1Title = await page.evaluate(() => {
          const h1 = document.querySelector('h1');
          return h1?.textContent?.trim() || null;
        });

        if (h1Title) {
          return h1Title;
        }
      }

      if (strategy === 'og:title' || strategy === 'auto') {
        const ogTitle = await page.evaluate(() => {
          const meta = document.querySelector('meta[property="og:title"]');
          return meta?.getAttribute('content')?.trim() || null;
        });

        if (ogTitle) {
          return ogTitle;
        }
      }

      if (strategy === 'title' || strategy === 'auto') {
        const title = await page.evaluate(() => {
          return document.title?.trim() || null;
        });

        if (title) {
          return title;
        }
      }

      // 모든 전략 실패 시 URL에서 추출
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts.length > 0) {
          const lastPart = pathParts[pathParts.length - 1];
          return decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
        }
      } catch {
        // URL 파싱 실패 시 무시
      }

      return null;
    } catch (error) {
      console.warn('⚠️ 제목 추출 실패:', error);
      return null;
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

