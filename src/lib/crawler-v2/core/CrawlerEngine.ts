/**
 * 크롤러 엔진 (개선 버전)
 * 메인 크롤링 로직
 * 
 * 개선 사항:
 * 1. 캐싱 시스템
 * 2. 병렬 처리
 * 3. 재시도 로직
 * 4. 진행률 표시 개선
 * 5. 메모리 관리
 */

import { Page } from 'puppeteer-core';
import { browserManager } from './BrowserManager';
import { contentExtractor } from './ContentExtractor';
import { urlDiscovery } from '../discovery/UrlDiscovery';
import { cacheManager } from '../utils/CacheManager';
import { retryManager } from '../utils/RetryManager';
import { memoryMonitor } from '../utils/MemoryMonitor';
import type { CrawlResult, CrawlOptions, DiscoveredUrl, CrawlProgress } from '../types';
import { extractDomain, normalizeUrl, isAllowedDomain } from '../utils/url-utils';

export class CrawlerEngine {
  private processingTimes: number[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * 단일 URL 크롤링 (개선: 캐싱 + 재시도)
   */
  async crawlUrl(
    url: string,
    options: Partial<CrawlOptions> = {}
  ): Promise<CrawlResult> {
    const config: CrawlOptions = {
      discoverSubPages: false,
      timeout: 30000,
      waitTime: 1000,
      useCache: true,
      cacheTTL: 24 * 60 * 60, // 24시간
      maxRetries: 3,
      retryDelay: 1000,
      enableMemoryMonitoring: true,
      ...options,
    };

    const startTime = Date.now();
    const normalizedUrl = normalizeUrl(url);

    console.log(`🕷️ URL 크롤링 시작: ${url}`);

    // 1. 캐시 확인
    if (config.useCache) {
      const cached = cacheManager.get(normalizedUrl, config.cacheTTL);
      if (cached) {
        // discoverSubPages 옵션이 활성화되어 있고, 캐시된 결과에 discoveredUrls가 없거나 너무 적으면 캐시 무시
        if (config.discoverSubPages) {
          const discoveredCount = cached.discoveredUrls?.length || 0;
          // discoveredUrls가 없거나 10개 미만이면 재크롤링 (더 많은 링크를 찾기 위해)
          if (discoveredCount === 0 || discoveredCount < 10) {
            console.log(`💾 캐시 히트했지만 discoveredUrls가 ${discoveredCount}개로 적어 재크롤링: ${url}`);
            this.cacheMisses++;
            // 캐시 삭제하여 다음에 새로 크롤링하도록
            cacheManager.delete(normalizedUrl);
          } else {
            this.cacheHits++;
            console.log(`💾 캐시 히트: ${url} (discoveredUrls: ${discoveredCount}개)`);
            return cached;
          }
        } else {
          this.cacheHits++;
          console.log(`💾 캐시 히트: ${url}`);
          return cached;
        }
      } else {
        this.cacheMisses++;
      }
    }

    // 2. 메모리 모니터링
    if (config.enableMemoryMonitoring) {
      const memoryCheck = memoryMonitor.checkMemory();
      if (memoryCheck.status === 'critical') {
        console.warn(`⚠️ ${memoryCheck.message}`);
        // 메모리 정리 시도
        if (memoryMonitor.shouldCleanup()) {
          cacheManager.cleanup();
          memoryMonitor.forceGC();
        }
      }
    }

    // 3. 재시도 로직으로 크롤링 실행
    try {
      const result = await retryManager.retry(
        async () => {
          return await this.performCrawl(url, config);
        },
        {
          maxRetries: config.maxRetries || 3,
          retryDelay: config.retryDelay || 1000,
        }
      );

      // 4. 캐시에 저장
      if (config.useCache && result.status === 'success') {
        cacheManager.set(normalizedUrl, result, config.cacheTTL);
      }

      // 5. 처리 시간 기록
      const processingTime = (Date.now() - startTime) / 1000;
      this.processingTimes.push(processingTime);
      if (this.processingTimes.length > 100) {
        this.processingTimes.shift(); // 최근 100개만 유지
      }

      console.log(`✅ URL 크롤링 완료: ${url} (${result.contentLength}자, ${processingTime.toFixed(2)}초)`);

      return result;
    } catch (error) {
      console.error(`❌ URL 크롤링 실패: ${url}`, error);

      return {
        url: normalizedUrl,
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
   * 실제 크롤링 수행 (내부 메서드)
   */
  private async performCrawl(
    url: string,
    config: CrawlOptions
  ): Promise<CrawlResult> {
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

      // 네이버 광고 페이지 같은 SPA는 더 오래 대기
      const isNaverAds = url.includes('ads.naver.com');
      const isSPA = isNaverAds || url.includes('facebook.com') || url.includes('instagram.com');

      // 봇 탐지 우회 대기
      if (config.waitTime && config.waitTime > 0) {
        const waitTime = config.waitTime + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      // 페이지 안정화를 위한 추가 대기 (동적으로 로드되는 제목을 기다림)
      // 특히 maxdepth 1이고 하위페이지 추출 X인 경우, 단일 페이지의 제목이 정확히 로드되도록 보장
      try {
        // 스크롤을 통해 콘텐츠 로드 유도 (Lazy loading 콘텐츠 활성화)
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 200;
            const timer = setInterval(() => {
              const scrollHeight = document.body.scrollHeight;
              window.scrollBy(0, distance);
              totalHeight += distance;

              if (totalHeight >= scrollHeight || totalHeight >= 3000) {
                clearInterval(timer);
                resolve();
              }
            }, 150);
          });
        });

        // 네이버 광고 페이지는 더 오래 대기 (동적 콘텐츠 로드 시간 확보)
        const scrollWaitTime = isNaverAds ? 5000 : 2000;
        await new Promise(resolve => setTimeout(resolve, scrollWaitTime));

        // 네이버 광고 페이지의 경우 추가로 DOM 변경 감지 대기
        if (isNaverAds) {
          try {
            await page.waitForFunction(
              () => {
                // 페이지 상단에 큰 텍스트가 있는지 확인
                const allElements = Array.from(document.querySelectorAll('*'));
                for (const el of allElements) {
                  const tagName = el.tagName?.toLowerCase() || '';
                  if (['nav', 'header', 'footer', 'aside', 'script', 'style'].includes(tagName)) continue;

                  const text = el.textContent?.trim() || '';
                  if (text.length < 3 || text.length > 150) continue;
                  if (['광고주센터', '도움말', 'Help', 'Advertiser Center'].includes(text)) continue;

                  const style = window.getComputedStyle(el);
                  const fontSize = parseFloat(style.fontSize) || 0;
                  const fontWeight = parseInt(style.fontWeight) || 400;
                  const rect = el.getBoundingClientRect();
                  const y = rect.top;

                  if (y >= 0 && y <= 500 && (fontSize >= 18 || fontWeight >= 600)) {
                    return true;
                  }
                }
                return false;
              },
              { timeout: 10000 }
            ).catch(() => {
              console.warn('⚠️ 네이버 광고 페이지 DOM 변경 대기 타임아웃 (계속 진행)');
            });
          } catch (error) {
            console.warn('⚠️ 네이버 광고 페이지 DOM 변경 감지 실패 (계속 진행):', error);
          }
        }
      } catch (scrollError) {
        console.warn('⚠️ 스크롤 실패 (무시):', scrollError);
        // 스크롤 실패해도 최소 대기 시간은 확보
        const minWaitTime = isNaverAds ? 5000 : 2000;
        await new Promise(resolve => setTimeout(resolve, minWaitTime));
      }

      // 콘텐츠 추출 (내부에서 추가 안정화 대기 수행)
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

      return result;
    } finally {
      // 페이지 닫기 (에러 처리 강화)
      if (page) {
        try {
          await page.close();
        } catch (closeError: any) {
          // "Connection closed" 또는 "Target closed" 오류는 무시 (이미 연결이 끊어진 상태)
          if (
            !closeError.message?.includes('Connection closed') &&
            !closeError.message?.includes('Target closed') &&
            !closeError.message?.includes('detached')
          ) {
            console.warn('⚠️ 페이지 닫기 실패:', closeError);
          }
        }
      }
    }
  }

  /**
   * 여러 URL 배치 크롤링 (개선: 병렬 처리 + 진행률 개선)
   */
  async crawlUrls(
    urls: string[],
    options: Partial<CrawlOptions> = {},
    onProgress?: (data: {
      type: 'log' | 'batch_progress' | 'progress';
      message: string;
      current?: number;
      total?: number;
      result?: CrawlResult;
      progress?: CrawlProgress;
    }) => void
  ): Promise<CrawlResult[]> {
    const config: CrawlOptions = {
      discoverSubPages: false,
      timeout: 30000,
      waitTime: 1000,
      useCache: true,
      cacheTTL: 24 * 60 * 60,
      maxRetries: 3,
      retryDelay: 1000,
      concurrency: 3, // 기본 병렬 처리 수
      enableMemoryMonitoring: true,
      ...options,
    };

    console.log(`🕷️ 배치 크롤링 시작: ${urls.length}개 URL (병렬 처리: ${config.concurrency || 1}개)`);

    const results: CrawlResult[] = [];
    const startTime = Date.now();
    const completedTimes: number[] = [];
    let completed = 0;
    let failed = 0;

    // 메모리 모니터링 시작
    if (config.enableMemoryMonitoring) {
      memoryMonitor.getCurrentMemory();
    }

    // 병렬 처리 함수
    const processUrl = async (url: string, index: number): Promise<void> => {
      const urlStartTime = Date.now();

      try {
        if (onProgress) {
          onProgress({
            type: 'log',
            message: `페이지 분석 중... (${index + 1}/${urls.length})`,
            current: index + 1,
            total: urls.length,
          });
        }

        const result = await this.crawlUrl(url, config);
        results[index] = result;

        if (result.status === 'success') {
          completed++;
        } else {
          failed++;
        }

        const urlProcessingTime = (Date.now() - urlStartTime) / 1000;
        completedTimes.push(urlProcessingTime);

        // 진행률 계산
        const totalCompleted = completed + failed;
        const progress = (totalCompleted / urls.length) * 100;

        // 평균 처리 시간 계산
        const avgTime =
          completedTimes.length > 0
            ? completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length
            : 0;

        // 예상 남은 시간 계산
        const remaining = urls.length - totalCompleted;
        const estimatedTimeRemaining = remaining * avgTime;

        // 메모리 사용량
        const memoryStats = memoryMonitor.getCurrentMemory();
        const memoryUsageMB = memoryStats
          ? memoryStats.heapUsed / (1024 * 1024)
          : undefined;

        // 캐시 히트율
        const totalCacheRequests = this.cacheHits + this.cacheMisses;
        const cacheHitRate =
          totalCacheRequests > 0
            ? (this.cacheHits / totalCacheRequests) * 100
            : undefined;

        if (onProgress) {
          const progressData: CrawlProgress = {
            currentUrl: url,
            totalUrls: urls.length,
            completedUrls: completed,
            failedUrls: failed,
            progress,
            stage: 'crawling',
            message: `처리 중: ${url}`,
            estimatedTimeRemaining,
            averageTimePerUrl: avgTime,
            memoryUsage: memoryUsageMB,
            cacheHitRate,
          };

          onProgress({
            type: 'progress',
            message: `진행률: ${progress.toFixed(1)}% (${completed} 성공, ${failed} 실패)`,
            current: totalCompleted,
            total: urls.length,
            progress: progressData,
          });

          onProgress({
            type: 'batch_progress',
            message: `완료: ${url}`,
            current: totalCompleted,
            total: urls.length,
            result: result,
          });
        }

        // 요청 간격 (서버 부하 방지)
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`❌ 크롤링 실패: ${url}`, error);
        results[index] = {
          url: normalizeUrl(url),
          title: url,
          content: '',
          contentLength: 0,
          type: 'general',
          lastUpdated: new Date().toISOString(),
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
        failed++;
      }
    };

    // 병렬 처리 실행
    const concurrency = config.concurrency || 1;
    const batches: string[][] = [];

    // URL을 배치로 분할
    for (let i = 0; i < urls.length; i += concurrency) {
      batches.push(urls.slice(i, i + concurrency));
    }

    // 각 배치를 순차적으로 처리 (배치 내부는 병렬)
    for (const batch of batches) {
      await Promise.all(
        batch.map((url, batchIndex) => {
          const globalIndex = urls.indexOf(url);
          return processUrl(url, globalIndex);
        })
      );

      // 배치 간 메모리 정리
      if (config.enableMemoryMonitoring && memoryMonitor.shouldCleanup()) {
        cacheManager.cleanup();
        memoryMonitor.forceGC();
      }
    }

    // 최종 결과 정렬 (원본 URL 순서 유지)
    const sortedResults: CrawlResult[] = [];
    for (const url of urls) {
      const index = urls.indexOf(url);
      if (results[index]) {
        sortedResults.push(results[index]);
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    const successCount = sortedResults.filter((r) => r.status === 'success').length;
    const failedCount = sortedResults.filter((r) => r.status === 'failed').length;

    console.log(
      `✅ 배치 크롤링 완료: 성공 ${successCount}개, 실패 ${failedCount}개 (총 ${totalTime.toFixed(2)}초)`
    );

    // 최종 진행률 전송
    if (onProgress) {
      const finalProgress: CrawlProgress = {
        currentUrl: '',
        totalUrls: urls.length,
        completedUrls: successCount,
        failedUrls: failedCount,
        progress: 100,
        stage: 'completed',
        message: `완료: ${successCount}개 성공, ${failedCount}개 실패`,
        estimatedTimeRemaining: 0,
        averageTimePerUrl: completedTimes.length > 0
          ? completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length
          : 0,
        memoryUsage: memoryMonitor.getCurrentMemory()?.heapUsed
          ? memoryMonitor.getCurrentMemory()!.heapUsed / (1024 * 1024)
          : undefined,
        cacheHitRate:
          this.cacheHits + this.cacheMisses > 0
            ? (this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100
            : undefined,
      };

      onProgress({
        type: 'progress',
        message: `완료: ${successCount}개 성공, ${failedCount}개 실패`,
        current: urls.length,
        total: urls.length,
        progress: finalProgress,
      });
    }

    return sortedResults;
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
    // 캐시 정리
    cacheManager.cleanup();
  }

  /**
   * 통계 가져오기
   */
  getStats(): {
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
    averageProcessingTime: number;
    memoryStats: ReturnType<typeof cacheManager.getStats>;
  } {
    const totalCacheRequests = this.cacheHits + this.cacheMisses;
    const cacheHitRate =
      totalCacheRequests > 0 ? (this.cacheHits / totalCacheRequests) * 100 : 0;

    const averageProcessingTime =
      this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
        : 0;

    return {
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate,
      averageProcessingTime,
      memoryStats: cacheManager.getStats(),
    };
  }

  /**
   * 통계 리셋
   */
  resetStats(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.processingTimes = [];
  }
}

// 싱글톤 인스턴스
export const crawlerEngine = new CrawlerEngine();
