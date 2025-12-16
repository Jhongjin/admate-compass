/**
 * 크롤러 엔진
 * 메인 크롤링 로직
 */

import { Page } from 'puppeteer-core';
import { browserManager } from './BrowserManager';
import { contentExtractor } from './ContentExtractor';
import { urlDiscovery } from '../discovery/UrlDiscovery';
import type { CrawlResult, CrawlOptions, DiscoveredUrl } from '../types';
import { extractDomain, normalizeUrl, isAllowedDomain } from '../utils/url-utils';

export class CrawlerEngine {
  /**
   * 단일 URL 크롤링
   */
  async crawlUrl(
    url: string,
    options: Partial<CrawlOptions> = {}
  ): Promise<CrawlResult> {
    const config: CrawlOptions = {
      discoverSubPages: false,
      timeout: 30000,
      waitTime: 1000,
      ...options,
    };

    console.log(`🕷️ URL 크롤링 시작: ${url}`);

    try {
      // 브라우저 초기화
      await browserManager.initialize();

      // 페이지 생성
      const page = await browserManager.createPage();

      try {
        // 페이지 로드
        const response = await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: config.timeout || 30000,
        });

        if (!response) {
          throw new Error('페이지 응답이 없습니다.');
        }

        if (!response.ok()) {
          throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
        }

        // 봇 탐지 우회 대기
        if (config.waitTime && config.waitTime > 0) {
          const waitTime = config.waitTime + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        // 콘텐츠 추출
        const { title, content } = await contentExtractor.extractFromPage(page, url);

        // 문서 타입 결정
        const type = this.determineDocumentType(url);

        // 하위 페이지 발견 (옵션이 활성화된 경우)
        let discoveredUrls: DiscoveredUrl[] | undefined;
        if (config.discoverSubPages) {
          try {
            discoveredUrls = await urlDiscovery.discoverSubPages(url, config);
            console.log(`🔍 발견된 하위 페이지: ${discoveredUrls.length}개`);
          } catch (error) {
            console.warn('⚠️ 하위 페이지 발견 실패:', error);
          }
        }

        const result: CrawlResult = {
          url: normalizeUrl(url),
          title,
          content,
          contentLength: content.length,
          type,
          lastUpdated: new Date().toISOString(),
          discoveredUrls,
          status: 'success',
        };

        console.log(`✅ URL 크롤링 완료: ${url} (${content.length}자)`);

        return result;
      } finally {
        // 페이지 닫기 (에러 처리 강화)
        if (page) {
          try {
            await page.close();
          } catch (closeError: any) {
            // "Connection closed" 또는 "Target closed" 오류는 무시 (이미 연결이 끊어진 상태)
            if (!closeError.message?.includes('Connection closed') &&
              !closeError.message?.includes('Target closed') &&
              !closeError.message?.includes('detached')) {
              console.warn('⚠️ 페이지 닫기 실패:', closeError);
            }
          }
        }
      }
    } catch (error) {
      console.error(`❌ URL 크롤링 실패: ${url}`, error);

      // 브라우저 연결 오류인 경우 재초기화
      if (error instanceof Error && (
        error.message.includes('Connection closed') ||
        error.message.includes('detached') ||
        error.message.includes('Target closed') ||
        error.message.includes('Session closed')
      )) {
        console.warn('⚠️ 브라우저 연결 오류 감지, 재초기화...');
        try {
          await browserManager.close();
        } catch (closeError) {
          console.warn('⚠️ 브라우저 종료 실패:', closeError);
        }
      }

      return {
        url: normalizeUrl(url),
        title: url,
        content: '',
        contentLength: 0,
        type: 'general',
        lastUpdated: new Date().toISOString(),
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 여러 URL 배치 크롤링
   */
  async crawlUrls(
    urls: string[],
    options: Partial<CrawlOptions> = {},
    onProgress?: (data: { type: 'log' | 'batch_progress', message: string, current?: number, total?: number, result?: CrawlResult }) => void
  ): Promise<CrawlResult[]> {
    console.log(`🕷️ 배치 크롤링 시작: ${urls.length}개 URL`);

    const results: CrawlResult[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`📄 크롤링 진행: ${i + 1}/${urls.length} - ${url}`);

      if (onProgress) {
        onProgress({
          type: 'log',
          message: `페이지 분석 중... (${i + 1}/${urls.length})`,
          current: i + 1,
          total: urls.length
        });
      }

      try {
        const result = await this.crawlUrl(url, options);
        results.push(result);

        if (onProgress) {
          onProgress({
            type: 'batch_progress',
            message: `완료: ${url}`,
            current: i + 1,
            total: urls.length,
            result: result
          });
        }

        // 요청 간격 (서버 부하 방지)
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`❌ 크롤링 실패: ${url}`, error);
        results.push({
          url: normalizeUrl(url),
          title: url,
          content: '',
          contentLength: 0,
          type: 'general',
          lastUpdated: new Date().toISOString(),
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    console.log(`✅ 배치 크롤링 완료: 성공 ${results.filter(r => r.status === 'success').length}개, 실패 ${results.filter(r => r.status === 'failed').length}개`);

    return results;
  }

  /**
   * 문서 타입 결정
   */
  private determineDocumentType(url: string): 'policy' | 'help' | 'guide' | 'general' {
    const lowerUrl = url.toLowerCase();

    if (lowerUrl.includes('/policies/')) {
      return 'policy';
    }
    if (lowerUrl.includes('/help/')) {
      return 'help';
    }
    if (lowerUrl.includes('/docs/') || lowerUrl.includes('/guide/')) {
      return 'guide';
    }

    return 'general';
  }

  /**
   * 브라우저 정리
   */
  async cleanup(): Promise<void> {
    await browserManager.close();
  }
}

// 싱글톤 인스턴스
export const crawlerEngine = new CrawlerEngine();

