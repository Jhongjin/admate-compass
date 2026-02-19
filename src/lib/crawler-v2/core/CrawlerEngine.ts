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

    // 페이지 생성 (모바일 폴백 옵션 포함)
    const isMetaDomain = url.includes('facebook.com') || url.includes('instagram.com');
    const page = await browserManager.createPage({
      url,
      isMobile: isMetaDomain // Meta 도메인은 기본적으로 모바일 UA 사용
    });

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
      type: 'log' | 'batch_progress' | 'progress' | 'queue_info' | 'warning';
      message: string;
      current?: number;
      total?: number;
      result?: CrawlResult;
      progress?: CrawlProgress;
      jobIds?: string[];
      safeCrawlableCount?: number;
      discoveredCount?: number;
    }) => void
  ): Promise<CrawlResult[]> {
    const functionStartTime = Date.now(); // 함수 시작 시간 기록
    const TOTAL_MAX_TIME = 5 * 60 * 1000; // 전체 최대 시간: 5분 (300초)

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
      // 1. Pagination 기반 하위 페이지 발견
      if (onProgress) {
        onProgress({ type: 'log', message: '🔍 Pagination 페이지 발견 시작...' });
      }
      const discoveredUrls = await urlDiscovery.discoverPaginationPages(baseUrl, config, onProgress);

      if (onProgress) {
        onProgress({
          type: 'log',
          message: `✅ Pagination 발견 완료: ${discoveredUrls.length}개 URL 발견`
        });
      }

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

      // 페이지 발견 직후 타임아웃 위험 체크 및 경고 전송 (배치 크롤링 시작 전)
      const elapsedForDiscovery = Date.now() - functionStartTime;
      const SAFETY_MARGIN = 30 * 1000; // 30초 여유
      const MAX_EXECUTION_TIME = Math.max(60 * 1000, TOTAL_MAX_TIME - elapsedForDiscovery - SAFETY_MARGIN);
      const AVG_CRAWL_TIME_PER_URL = 15; // 초
      const CONCURRENCY = Math.min(config.concurrency || 3, 3);
      const EFFECTIVE_CRAWL_TIME = AVG_CRAWL_TIME_PER_URL / CONCURRENCY;
      const safeCrawlableCount = Math.floor((MAX_EXECUTION_TIME / 1000) / EFFECTIVE_CRAWL_TIME);
      const urlsToCrawl = discoveredUrls.map(u => u.url);

      // 타임아웃 위험 경고 (페이지 발견 직후 즉시 전송)
      // 경고 조건: 발견된 URL이 100개 이상이거나, 안정적 크롤링 가능 개수보다 많은 경우
      const shouldWarn = discoveredUrls.length >= QUEUE_THRESHOLD || urlsToCrawl.length > safeCrawlableCount;

      if (shouldWarn) {
        console.log(`⚠️ [Pagination Mode] 경고 조건 충족: 발견=${urlsToCrawl.length}개, 안정적=${safeCrawlableCount}개, 남은시간=${Math.round(MAX_EXECUTION_TIME / 1000)}초`);

        // 경고 메시지 생성
        let warningMessage: string;
        let warningLevel: 'critical' | 'warning' = 'warning';

        if (MAX_EXECUTION_TIME < 30 * 1000) {
          // 남은 시간이 30초 미만인 경우 (매우 위험)
          warningLevel = 'critical';
          warningMessage = `⚠️ 타임아웃 경고: 발견된 URL이 ${urlsToCrawl.length}개로 많아 Vercel 타임아웃(5분)에 걸릴 가능성이 매우 높습니다. 안정적으로 크롤링하려면 약 ${safeCrawlableCount}개 이내로 제한하는 것을 강력히 권장합니다. 계속 진행하면 일부만 처리되고 타임아웃될 수 있습니다.`;
        } else if (urlsToCrawl.length > safeCrawlableCount * 2) {
          // 안정적 개수보다 2배 이상 많은 경우 (위험)
          warningLevel = 'critical';
          warningMessage = `⚠️ 타임아웃 경고: 발견된 URL이 ${urlsToCrawl.length}개로 많아 Vercel 타임아웃(5분)에 걸릴 가능성이 매우 높습니다. 안정적으로 크롤링하려면 약 ${safeCrawlableCount}개 이내로 제한하는 것을 강력히 권장합니다. 현재 설정으로는 일부만 처리되고 타임아웃될 수 있습니다.`;
        } else if (urlsToCrawl.length > safeCrawlableCount * 1.5) {
          // 안정적 개수보다 1.5배 이상 많은 경우 (주의)
          warningMessage = `⚠️ 타임아웃 위험: 발견된 URL이 ${urlsToCrawl.length}개로 많습니다. 안정적으로 크롤링하려면 약 ${safeCrawlableCount}개 이내로 제한하는 것을 권장합니다. 현재 설정으로는 일부만 처리되고 타임아웃될 수 있습니다.`;
        } else {
          // 안정적 개수보다 많지만 1.5배 이하인 경우 (경고)
          warningMessage = `⚠️ 타임아웃 주의: 발견된 URL이 ${urlsToCrawl.length}개로 많습니다. 안정적으로 크롤링하려면 약 ${safeCrawlableCount}개 이내로 제한하는 것을 권장합니다.`;
        }

        // 경고 메시지 전송 (항상 전송)
        if (onProgress) {
          console.log(`📤 [Pagination Mode] 경고 메시지 전송 시도: ${warningMessage.substring(0, 50)}...`);
          onProgress({
            type: 'warning',
            message: warningMessage,
            discoveredCount: urlsToCrawl.length,
            safeCrawlableCount: safeCrawlableCount,
          });
          console.log(`✅ [Pagination Mode] 경고 메시지 전송 완료`);

          // 추가로 log 타입으로도 전송하여 확실히 전달
          onProgress({
            type: 'log',
            message: warningMessage,
          });
        } else {
          console.warn(`⚠️ [Pagination Mode] onProgress 콜백이 없어 경고 메시지를 전송할 수 없습니다.`);
        }
      } else {
        console.log(`✅ [Pagination Mode] 경고 조건 미충족: 발견=${urlsToCrawl.length}개, 안정적=${safeCrawlableCount}개`);
      }

      // 2. 발견된 URL이 임계값 이상이면 배치 크롤링으로 처리
      // 참고: 큐 시스템(CRAWL_SEED)은 seed URL을 재귀적으로 크롤링하는 방식이므로,
      // 이미 추출된 개별 FAQ 링크에는 적합하지 않습니다.
      // 대신 배치 크롤링을 사용하여 타임아웃 없이 처리합니다.
      if (discoveredUrls.length >= QUEUE_THRESHOLD) {
        console.log(`📦 [Pagination Mode] 발견된 URL이 ${discoveredUrls.length}개로 많아 배치 크롤링으로 처리합니다.`);
        console.log(`⏱️ [Pagination Mode] 타임아웃 정보: 페이지 발견 ${Math.round(elapsedForDiscovery / 1000)}초 소요, 남은 시간 ${Math.round(MAX_EXECUTION_TIME / 1000)}초 (전체: ${Math.round(TOTAL_MAX_TIME / 1000)}초)`);
        console.log(`📊 [Pagination Mode] 안정적 크롤링 가능 개수: ${safeCrawlableCount}개 (현재: ${urlsToCrawl.length}개)`);

        if (onProgress) {
          onProgress({
            type: 'log',
            message: `⚠️ 발견된 URL이 ${discoveredUrls.length}개로 많습니다 (임계값: ${QUEUE_THRESHOLD}개). 배치 크롤링으로 처리합니다...`,
          });
        }

        // 배치 크롤링으로 처리 (타임아웃 방지를 위해 작은 배치로 나누어 처리)
        const startTime = Date.now(); // 배치 크롤링 시작 시간
        const BATCH_SIZE = 20; // 한 번에 처리할 URL 수 (타임아웃 방지를 위해 적절히 설정)

        if (onProgress) {
          onProgress({
            type: 'log',
            message: `${urlsToCrawl.length}개 FAQ 링크를 배치 크롤링으로 처리합니다 (${BATCH_SIZE}개씩 배치 처리, 타임아웃 방지)...`,
            current: 0,
            total: urlsToCrawl.length,
          });
        }

        // 타임아웃 체크가 포함된 배치 크롤링 실행
        const results: CrawlResult[] = [];
        const processedUrls = new Set<string>();
        let currentIndex = 0;
        let batchNumber = 0;

        while (currentIndex < urlsToCrawl.length) {
          // 타임아웃 체크 (매 배치 시작 전)
          const elapsed = Date.now() - startTime;
          if (elapsed >= MAX_EXECUTION_TIME) {
            console.warn(`⏰ [Pagination Mode] 타임아웃 임박 (${Math.round(elapsed / 1000)}초 경과). 남은 ${urlsToCrawl.length - currentIndex}개 작업을 큐로 이관합니다.`);

            const remainingUrls = urlsToCrawl.slice(currentIndex);

            if (onProgress) {
              onProgress({
                type: 'log',
                message: `⏰ 타임아웃 임박 (${Math.round(elapsed / 1000)}초 경과). 남은 ${remainingUrls.length}개 작업을 백그라운드 큐로 이관합니다...`,
              });
            }

            // 남은 URL들을 백그라운드 큐로 이관
            const jobIds = await this.enqueueOverflowUrls(remainingUrls, config);

            if (onProgress) {
              onProgress({
                type: 'queue_info',
                message: `✅ 남은 ${remainingUrls.length}개 작업이 백그라운드 큐로 성공적으로 이관되었습니다.`,
                current: results.length,
                total: urlsToCrawl.length,
                jobIds: jobIds,
              });
            }
            break;
          }

          // 다음 배치 추출
          const batch = urlsToCrawl.slice(currentIndex, currentIndex + BATCH_SIZE);
          const remainingTime = MAX_EXECUTION_TIME - elapsed;
          batchNumber++;

          if (onProgress) {
            onProgress({
              type: 'log',
              message: `배치 ${batchNumber} 처리 중: ${batch.length}개 URL (${results.length}/${urlsToCrawl.length} 완료, 남은 시간: ${Math.round(remainingTime / 1000)}초)`,
              current: results.length,
              total: urlsToCrawl.length,
            });
          }

          // 배치 크롤링 실행 (개별 URL을 직접 처리하여 이중 배치 방지)
          try {
            const batchStartTime = Date.now();
            const concurrency = Math.min(config.concurrency || 3, 3); // 병렬 처리 수 제한
            const batchResults: CrawlResult[] = [];

            // 배치를 concurrency 크기의 작은 청크로 나누어 병렬 처리
            for (let i = 0; i < batch.length; i += concurrency) {
              // 타임아웃 재확인 (각 청크 처리 전)
              const elapsed = Date.now() - startTime;
              if (elapsed >= MAX_EXECUTION_TIME) {
                console.warn(`⏰ [Pagination Mode] 타임아웃 임박 (${Math.round(elapsed / 1000)}초 경과). 배치 ${batchNumber} 중단.`);
                break;
              }

              const chunk = batch.slice(i, i + concurrency);
              const chunkPromises = chunk.map(url => this.crawlUrl(url, {
                ...config,
                timeout: Math.min(config.timeout || 30000, MAX_EXECUTION_TIME - elapsed - 5000),
              }));

              const chunkResults = await Promise.all(chunkPromises);

              // 결과 추가
              for (const result of chunkResults) {
                if (!processedUrls.has(result.url)) {
                  batchResults.push(result);
                  processedUrls.add(result.url);

                  if (onProgress) {
                    onProgress({
                      type: 'batch_progress',
                      message: `배치 ${batchNumber}: ${result.url} 완료`,
                      current: results.length + batchResults.length,
                      total: urlsToCrawl.length,
                      result: result,
                    });
                  }
                }
              }
            }

            results.push(...batchResults);
            currentIndex += batch.length;

            const batchElapsed = (Date.now() - batchStartTime) / 1000;
            console.log(`✅ [Pagination Mode] 배치 ${batchNumber} 완료: ${batchResults.length}개 (${batchElapsed.toFixed(1)}초)`);

          } catch (batchError) {
            console.error(`❌ [Pagination Mode] 배치 ${batchNumber} 처리 중 오류:`, batchError);
            currentIndex += batch.length; // 오류 발생 시에도 다음 배치를 위해 인덱스 증가
          }
        }

        return results;
      } else {
        // 3. 발견된 URL이 적으면 직접 크롤링
        console.log(`🚀 [Pagination Mode] 발견된 URL이 ${urlsToCrawl.length}개로 적어 직접 크롤링을 수행합니다.`);

        if (onProgress) {
          onProgress({
            type: 'log',
            message: `${urlsToCrawl.length}개 FAQ 링크 크롤링 시작...`,
          });
        }

        const results = await this.crawlUrls(urlsToCrawl, config, onProgress);
        return results;
      }
    } catch (error) {
      console.error('❌ [Pagination Mode] 오류 발생:', error);
      if (onProgress) {
        onProgress({
          type: 'log',
          message: `Pagination 크롤링 중 오류: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return [];
    }
  }

  /**
   * 여러 URL 크롤링 (진행률 콜백 포함)
   */
  async crawlUrls(
    urls: string[],
    options: Partial<CrawlOptions> = {},
    onProgress?: (data: {
      type: 'progress' | 'log' | 'batch_progress';
      message: string;
      current?: number;
      total?: number;
      result?: CrawlResult;
      progress?: CrawlProgress;
    }) => void
  ): Promise<CrawlResult[]> {
    const config: CrawlOptions = {
      discoverSubPages: false,
      concurrency: 3,
      ...options,
    };

    const total = urls.length;
    let completed = 0;
    let failed = 0;
    const results: CrawlResult[] = [];
    const startTime = Date.now();
    const completedTimes: number[] = [];

    // 배치 처리 (concurrency 기준)
    for (let i = 0; i < urls.length; i += config.concurrency!) {
      const batch = urls.slice(i, i + config.concurrency!);

      if (onProgress) {
        onProgress({
          type: 'log',
          message: `${i + 1}~${Math.min(i + config.concurrency!, total)}번째 URL 처리 중...`,
          current: completed + failed,
          total,
        });
      }

      const batchPromises = batch.map((url) => this.crawlUrl(url, config));
      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        results.push(result);
        if (result.status === 'success') {
          completed++;
          completedTimes.push((Date.now() - startTime) / 1000);
        } else {
          failed++;
        }

        // 상세 진행률 전송
        if (onProgress) {
          const progress: CrawlProgress = {
            totalUrls: total,
            completedUrls: completed,
            failedUrls: failed,
            currentUrl: result.url,
            progress: Math.round(((completed + failed) / total) * 100),
            stage: 'crawling',
            estimatedTimeRemaining: this.calculateETA(
              total,
              completed + failed,
              completedTimes
            ),
          };

          onProgress({
            type: 'progress',
            message: `${result.url} ${result.status === 'success' ? '완료' : '실패'}`,
            progress,
          });

          onProgress({
            type: 'batch_progress',
            message: result.title,
            current: completed + failed,
            total,
            result,
          });
        }
      }
    }

    return results;
  }

  /**
   * 타임아웃으로 처리하지 못한 URL들을 백그라운드 큐로 이관
   */
  private async enqueueOverflowUrls(urls: string[], options: Partial<CrawlOptions>): Promise<string[]> {
    try {
      console.log(`📦 [CrawlerEngine] ${urls.length}개 URL 백그라운드 큐 이관 시도...`);

      const supabase = await createPureClient();
      const jobIds: string[] = [];

      // 한 번에 너무 많은 작업을 insert하면 오류가 발생할 수 있으므로 배치 처리 (chunk size: 50)
      const chunkSize = 50;
      for (let i = 0; i < urls.length; i += chunkSize) {
        const chunk = urls.slice(i, i + chunkSize);
        const inserts = chunk.map(url => ({
          job_type: 'CRAWL_V2',
          status: 'queued',
          priority: 5,
          payload: {
            url,
            options: {
              ...options,
              paginationMode: false, // 개별 URL 크롤링이므로 paginationMode 해제
              discoverSubPages: false, // 연쇄 폭발 방지
            },
            source: 'overflow',
            enqueued_at: new Date().toISOString(),
          },
          scheduled_at: new Date().toISOString(),
          attempts: 0,
          max_attempts: 3,
        }));

        const { data, error } = await supabase
          .from('processing_jobs')
          .insert(inserts)
          .select('id');

        if (error) {
          console.error(`❌ [CrawlerEngine] 큐 이관 중 오류 (index ${i}):`, error);
          continue;
        }

        if (data) {
          jobIds.push(...data.map(item => item.id));
        }
      }

      console.log(`✅ [CrawlerEngine] ${jobIds.length}/${urls.length}개 작업 큐 이관 완료`);
      return jobIds;
    } catch (error) {
      console.error('❌ [CrawlerEngine] enqueueOverflowUrls 예외 발생:', error);
      return [];
    }
  }

  /**
   * 문서 타입 결정
   */
  private determineDocumentType(url: string): CrawlResult['type'] {
    const path = url.toLowerCase();
    if (path.includes('policy') || path.includes('terms')) return 'policy';
    if (path.includes('help') || path.includes('faq')) return 'help';
    if (path.includes('guide') || path.includes('howto')) return 'guide';
    return 'general';
  }

  /**
   * ETA 계산
   */
  private calculateETA(
    total: number,
    current: number,
    completedTimes: number[]
  ): number {
    if (current === 0 || completedTimes.length === 0) return 0;

    // 최근 5개 처리 시간의 평균으로 계산
    const recentTimes = completedTimes.slice(-5);
    const avgTimePerUrl =
      recentTimes.length > 1
        ? (recentTimes[recentTimes.length - 1] - recentTimes[0]) /
        (recentTimes.length - 1)
        : completedTimes[completedTimes.length - 1] / current;

    return Math.round(avgTimePerUrl * (total - current));
  }

  /**
   * 통계 정보 반환
   */
  getStats() {
    const avgTime =
      this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) /
        this.processingTimes.length
        : 0;

    const totalRequests = this.cacheHits + this.cacheMisses;
    const cacheHitRate =
      totalRequests > 0 ? (this.cacheHits / totalRequests) * 100 : 0;

    return {
      averageProcessingTime: avgTime,
      cacheHitRate,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      memoryStats: memoryMonitor.getMemoryStats(),
    };
  }

  /**
   * 엔진 정리
   */
  async cleanup() {
    await browserManager.cleanup();
    cacheManager.cleanup();
  }

  /**
   * 통계 초기화
   */
  resetStats() {
    this.processingTimes = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}

export const crawlerEngine = new CrawlerEngine();
