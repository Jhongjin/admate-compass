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
import { createPureClient } from '@/lib/supabase/server';

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
        const scrollWaitTime = isNaverAds ? 8000 : 2000; // FAQ 페이지는 8초로 증가
        await new Promise(resolve => setTimeout(resolve, scrollWaitTime));

        // 네이버 광고 FAQ 페이지의 경우 추가로 DOM 변경 감지 대기
        if (isNaverAds && url.includes('/help/faq/')) {
          try {
            console.log('⏳ [CrawlerEngine] FAQ 페이지 DOM 안정화 대기 중...');
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
   * Pagination 모드 크롤링
   * 
   * @param baseUrl 부모 페이지 URL
   * @param options 크롤링 옵션
   * @param onProgress 진행률 콜백
   * @returns 크롤링 결과 배열 (큐 시스템 사용 시 빈 배열 반환)
   */
  async crawlWithPagination(
    baseUrl: string,
    options: Partial<CrawlOptions> = {},
    onProgress?: (data: {
      type: 'log' | 'batch_progress' | 'progress' | 'queue_info';
      message: string;
      current?: number;
      total?: number;
      result?: CrawlResult;
      progress?: CrawlProgress;
      jobIds?: string[];
    }) => void
  ): Promise<CrawlResult[]> {
    const config: CrawlOptions = {
      discoverSubPages: false, // Pagination 모드에서는 하위 페이지 발견 비활성화
      timeout: 30000,
      waitTime: 1000,
      useCache: true,
      cacheTTL: 24 * 60 * 60,
      maxRetries: 3,
      retryDelay: 1000,
      concurrency: 5, // Pagination 모드에서 많은 URL 처리 시 속도 향상
      enableMemoryMonitoring: true,
      maxUrls: 10000, // Pagination 모드에서는 충분히 큰 값으로 설정 (모든 FAQ 크롤링)
      ...options,
    };

    // 큐 시스템 사용 임계값 (100개 이상이면 큐 시스템 사용)
    const QUEUE_THRESHOLD = 100;

    console.log(`🕷️ [Pagination Mode] 크롤링 시작: ${baseUrl}`);

    try {
      // 1. Pagination 페이지 발견
      if (onProgress) {
        onProgress({
          type: 'log',
          message: `Pagination 페이지 발견 중...`,
        });
      }

      const discoveredUrls = await urlDiscovery.discoverPaginationPages(baseUrl, config);

      if (discoveredUrls.length === 0) {
        console.warn(`⚠️ [Pagination Mode] Pagination 페이지를 찾을 수 없습니다`);
        if (onProgress) {
          onProgress({
            type: 'log',
            message: `Pagination 페이지를 찾을 수 없습니다`,
          });
        }
        return [];
      }

      console.log(`✅ [Pagination Mode] ${discoveredUrls.length}개 페이지 발견`);

      // 2. 발견된 URL이 임계값 이상이면 큐 시스템으로 전환
      if (discoveredUrls.length >= QUEUE_THRESHOLD) {
        console.log(`📦 [Pagination Mode] 발견된 URL이 ${discoveredUrls.length}개로 많아 큐 시스템으로 전환합니다.`);
        
        if (onProgress) {
          onProgress({
            type: 'log',
            message: `⚠️ 발견된 URL이 ${discoveredUrls.length}개로 많습니다 (임계값: ${QUEUE_THRESHOLD}개). 큐 시스템으로 전환합니다...`,
          });
        }

        try {
          const supabase = await createPureClient();
          const urlsToCrawl = discoveredUrls.map(u => u.url);
          const jobIds: string[] = [];
          let enqueuedCount = 0;
          const totalUrls = urlsToCrawl.length;

          // 각 URL을 큐에 등록
          for (const url of urlsToCrawl) {
            try {
              // 중복 방지: 같은 URL이 대기 또는 처리 중이면 기존 레코드 반환
              const { data: existing } = await supabase
                .from('processing_jobs')
                .select('id')
                .eq('job_type', 'CRAWL_SEED')
                .eq('status', 'queued')
                .contains('payload', { url })
                .maybeSingle();

              if (existing) {
                jobIds.push(existing.id);
                enqueuedCount++;
                continue;
              }

              // 새 작업 등록
              const { data, error } = await supabase
                .from('processing_jobs')
                .insert({
                  document_id: null,
                  job_type: 'CRAWL_SEED',
                  status: 'queued',
                  priority: 5,
                  payload: {
                    url,
                    vendors: ['NAVER'], // 기본 벤더
                    domainLimit: config.domainLimit !== false,
                    respectRobots: config.respectRobots !== false,
                    maxDepth: 1, // Pagination 모드에서는 단일 페이지만 크롤링
                    extractSubPages: false,
                    forceCrawl: false,
                    deepCrawlTimeout: false,
                    retryOn429: true,
                  },
                  attempts: 0,
                  max_attempts: 3,
                  scheduled_at: new Date().toISOString(),
                })
                .select('id')
                .single();

              if (error) {
                console.error(`❌ [Pagination Mode] 큐 등록 실패 (${url}):`, error);
                continue;
              }

              if (data) {
                jobIds.push(data.id);
                enqueuedCount++;
              }

              // 진행률 업데이트 (10개마다)
              if (enqueuedCount % 10 === 0 && onProgress) {
                onProgress({
                  type: 'log',
                  message: `큐 등록 진행 중: ${enqueuedCount}/${totalUrls}개 완료...`,
                  current: enqueuedCount,
                  total: totalUrls,
                });
              }
            } catch (urlError) {
              console.error(`❌ [Pagination Mode] URL 큐 등록 오류 (${url}):`, urlError);
              continue;
            }
          }

          console.log(`✅ [Pagination Mode] 큐 시스템 등록 완료: ${enqueuedCount}개 작업 등록됨`);

          if (onProgress) {
            onProgress({
              type: 'queue_info',
              message: `✅ 큐 시스템 등록 완료: ${enqueuedCount}개 작업이 큐에 등록되었습니다. 백그라운드에서 자동으로 처리됩니다.`,
              current: enqueuedCount,
              total: totalUrls,
              jobIds,
            });
          }

          // 큐 시스템 사용 시 빈 배열 반환 (실제 크롤링은 큐에서 처리)
          return [];
        } catch (queueError) {
          console.error(`❌ [Pagination Mode] 큐 시스템 등록 실패:`, queueError);
          
          if (onProgress) {
            onProgress({
              type: 'log',
              message: `⚠️ 큐 시스템 등록 실패. 직접 크롤링 모드로 전환합니다...`,
            });
          }

          // 큐 시스템 등록 실패 시 직접 크롤링으로 폴백
          // (타임아웃이 발생할 수 있지만 시도)
        }
      }

      // 3. 발견된 URL이 임계값 미만이면 직접 크롤링
      if (onProgress) {
        onProgress({
          type: 'log',
          message: `${discoveredUrls.length}개 페이지 발견, 직접 크롤링 시작...`,
        });
      }

      const urlsToCrawl = discoveredUrls.map(u => u.url);
      const results = await this.crawlUrls(urlsToCrawl, config, onProgress);

      console.log(`✅ [Pagination Mode] 크롤링 완료: ${results.length}개 결과`);

      return results;
    } catch (error) {
      console.error(`❌ [Pagination Mode] 크롤링 실패:`, error);
      if (onProgress) {
        onProgress({
          type: 'log',
          message: `크롤링 실패: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return [];
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
      concurrency: 5, // 기본 병렬 처리 수 (Pagination 모드에서 많은 URL 처리 시 속도 향상)
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
    let batchIndex = 0;
    for (const batch of batches) {
      batchIndex++;
      console.log(`📦 [배치 크롤링] 배치 ${batchIndex}/${batches.length} 처리 중 (${batch.length}개 URL)`);
      
      await Promise.all(
        batch.map((url, batchIndex) => {
          const globalIndex = urls.indexOf(url);
          return processUrl(url, globalIndex);
        })
      );

      const completedSoFar = results.filter(r => r && (r.status === 'success' || r.status === 'failed')).length;
      console.log(`📊 [배치 크롤링] 진행 상황: ${completedSoFar}/${urls.length} 완료 (${((completedSoFar / urls.length) * 100).toFixed(1)}%)`);

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
