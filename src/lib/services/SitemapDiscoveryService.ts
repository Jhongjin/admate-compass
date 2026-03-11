import puppeteer, { Browser, Page } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import * as cheerio from 'cheerio';
import { parseStringPromise } from 'xml2js';
import { gunzipSync } from 'zlib';

export interface DiscoveredUrl {
  url: string;
  title?: string;
  lastModified?: string;
  priority?: number;
  source: 'sitemap' | 'robots' | 'links' | 'pattern';
  depth: number;
}

export interface DepthAwareDiscoveredUrl extends DiscoveredUrl {
  parentUrl?: string; // 부모 URL (트리 구조 추적용)
  path: string[]; // seed부터 현재까지 경로
}

export interface DiscoveryOptions {
  maxDepth: number;
  maxUrls: number;
  respectRobotsTxt: boolean;
  includeExternal: boolean;
  allowedDomains?: string[];
  domainLimit?: boolean; // 도메인 제한 (true: 같은 도메인만, false: 하위 도메인 포함)
  timeout?: number; // 타임아웃 (ms)
  strictPathLimit?: boolean; // 입력된 URL의 첫 번째 서브디렉토리 경로 강제 (예: /ko/ 외 배제)
  requiredPathPattern?: string; // 강제할 경로 패턴 (내부용)
}

export class SitemapDiscoveryService {
  private browser: Browser | null = null;
  private defaultOptions: DiscoveryOptions = {
    maxDepth: 3,
    maxUrls: 100,
    respectRobotsTxt: true,
    includeExternal: false,
    timeout: 60000, // 기본 1분 (Vercel 타임아웃 고려하여 단축)
  };

  async initialize(): Promise<void> {
    if (this.browser) return;

    try {
      console.log('🔧 SitemapDiscoveryService 브라우저 초기화 중...');

      // Vercel 환경에서 @sparticuz/chromium 사용
      const isVercel = process.env.VERCEL === '1' || process.env.AWS_LAMBDA_FUNCTION_NAME;

      if (isVercel) {
        // Vercel 환경: @sparticuz/chromium 사용
        try {
          // @sparticuz/chromium의 executablePath()가 실패할 수 있으므로 try-catch
          const executablePath = await chromium.executablePath();

          this.browser = await puppeteer.launch({
            args: chromium.args as string[],
            defaultViewport: {
              width: 1280,
              height: 720,
            },
            executablePath: executablePath,
            headless: true,
          });
          console.log('✅ SitemapDiscoveryService 브라우저 초기화 완료 (Vercel 환경: @sparticuz/chromium)');
        } catch (chromiumError) {
          // @sparticuz/chromium 초기화 실패 시 Puppeteer 없이 진행 (Cheerio만 사용)
          // 이는 정상적인 fallback이므로 에러가 아닙니다
          console.log('ℹ️ @sparticuz/chromium 초기화 실패 (예상된 동작), Cheerio만 사용하여 계속 진행합니다');
          this.browser = null; // 브라우저를 null로 유지하여 Cheerio만 사용
          return; // 에러를 throw하지 않고 정상 종료
        }
      } else {
        // 로컬 환경: 일반 Puppeteer 사용
        this.browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--disable-features=VizDisplayCompositor'
          ],
          ignoreDefaultArgs: ['--enable-automation'],
        });
        console.log('✅ SitemapDiscoveryService 브라우저 초기화 완료 (로컬 환경)');
      }
    } catch (error) {
      // 일반적인 초기화 실패 시에도 에러를 throw하지 않고 Cheerio만 사용
      // 이는 정상적인 fallback이므로 에러가 아닙니다
      console.log('ℹ️ Puppeteer 초기화 실패 (예상된 동작), Cheerio만 사용하여 계속 진행합니다');
      this.browser = null; // 브라우저를 null로 유지하여 Cheerio만 사용
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 SitemapDiscoveryService 브라우저 종료');
    }
  }

  /**
   * 메인 URL에서 하위 페이지들을 발견
   */
  async discoverSubPages(
    baseUrl: string,
    options: Partial<DiscoveryOptions> = {},
    preloadedHtml?: string
  ): Promise<DiscoveredUrl[]> {
    const config = { ...this.defaultOptions, ...options };

    // strictPathLimit 설정 시 첫 번째 서브디렉토리(예: /ko/) 추출
    if (config.strictPathLimit && !config.requiredPathPattern) {
      config.requiredPathPattern = this.extractPathPattern(baseUrl);
      if (config.requiredPathPattern) {
        console.error(`[CRITICAL] 🛡️ 경로 제한 활성화: ${config.requiredPathPattern} 패턴만 허용`);
      }
    }

    // maxDepth 3 이상일 때는 BFS depth 탐색 사용 (더 많은 URL 발견 가능)
    if (config.maxDepth >= 3) {
      console.error(`[CRITICAL] 🔍 maxDepth ${config.maxDepth} 감지: BFS depth 탐색 사용`);
      const isFacebook = baseUrl.includes('facebook.com');
      if (isFacebook) {
        console.error(`[CRITICAL] 🔍 Facebook URL 감지: ${baseUrl}. BFS depth 탐색 사용`);
      }
      const depthAwareResults = await this.discoverSubPagesWithDepth(baseUrl, config, preloadedHtml);
      console.error(`[CRITICAL] ✅ BFS depth 탐색 완료: ${depthAwareResults.length}개 발견`);
      if (isFacebook && depthAwareResults.length === 0) {
        console.error(`[CRITICAL] ⚠️ Facebook URL에서 하위 페이지가 발견되지 않았습니다. 링크 추출 로직을 확인해주세요.`);
      }
      // DepthAwareDiscoveredUrl을 DiscoveredUrl로 변환
      return depthAwareResults.map(item => ({
        url: item.url,
        title: item.title,
        source: item.source || 'bfs',
        depth: item.depth || 1
      }));
    }

    // Puppeteer 초기화 시도 (실패해도 계속 진행)
    // initialize()는 내부에서 에러를 throw하지 않으므로 try-catch는 사실상 불필요하지만, 안전을 위해 유지
    if (!this.browser) {
      await this.initialize();
    }

    console.error(`[CRITICAL] 🔍 하위 페이지 발견 시작: ${baseUrl}`);
    console.error(`[CRITICAL] 📋 설정:`, config);
    if (preloadedHtml) {
      console.error(`[CRITICAL] ✅ 메인 페이지 HTML 재사용 (${preloadedHtml.length}자)`);
    }

    const discoveredUrls = new Set<string>();
    const discoveredPages: DiscoveredUrl[] = [];
    const baseDomain = this.extractDomain(baseUrl);

    try {
      // 1. Sitemap.xml에서 URL 발견 (Puppeteer 불필요)
      console.error(`[CRITICAL] 📄 Sitemap 탐색 시작: ${baseUrl}`);
      const sitemapStartMs = Date.now();
      const sitemapUrls = await this.discoverFromSitemap(baseUrl, config);
      const sitemapEndMs = Date.now();
      sitemapUrls.forEach(url => {
        if (!discoveredUrls.has(url.url)) {
          discoveredUrls.add(url.url);
          discoveredPages.push(url);
        }
      });

      console.error(`[CRITICAL] 📄 Sitemap에서 발견: ${sitemapUrls.length}개 (소요 시간: ${sitemapEndMs - sitemapStartMs}ms)`);

      // 2. 페이지 링크에서 URL 발견 (Puppeteer 우선, 실패 시 fetch fallback)
      console.error(`[CRITICAL] 🔗 링크 탐색 시작: ${baseUrl}`);
      const linkStartMs = Date.now();
      const linkUrls = await this.discoverFromLinks(baseUrl, config, preloadedHtml);
      const linkEndMs = Date.now();
      linkUrls.forEach(url => {
        if (!discoveredUrls.has(url.url)) {
          discoveredUrls.add(url.url);
          discoveredPages.push(url);
        }
      });

      console.error(`[CRITICAL] 🔗 링크에서 발견: ${linkUrls.length}개 (소요 시간: ${linkEndMs - linkStartMs}ms)`);

      // 3. 결과 필터링 및 정렬
      console.error(`[CRITICAL] 🔍 필터링 시작: 총 ${discoveredPages.length}개 발견됨`);
      const filterStartMs = Date.now();
      const filteredPages = this.filterAndSortPages(discoveredPages, baseDomain, config);
      const filterEndMs = Date.now();

      console.error(`[CRITICAL] ✅ 최종 발견된 하위 페이지: ${filteredPages.length}개 (필터링 소요 시간: ${filterEndMs - filterStartMs}ms)`);
      if (filteredPages.length === 0 && discoveredPages.length > 0) {
        console.warn(`[CRITICAL] ⚠️ 발견된 ${discoveredPages.length}개 페이지가 모두 필터링되었습니다. 필터 조건을 확인해주세요.`);
      }
      return filteredPages.slice(0, config.maxUrls);

    } catch (error) {
      console.error('❌ 하위 페이지 발견 실패:', error);
      // 일부 실패해도 발견된 URL은 반환
      return discoveredPages.slice(0, config.maxUrls);
    }
  }

  /**
   * BFS를 사용한 depth 전파 탐색 (새 기능)
   * 깊은 depth까지 탐색하되, 각 URL의 정확한 depth를 추적
   */
  async discoverSubPagesWithDepth(
    baseUrl: string,
    options: Partial<DiscoveryOptions> = {},
    preloadedHtml?: string
  ): Promise<DepthAwareDiscoveredUrl[]> {
    const config = { ...this.defaultOptions, ...options };

    // strictPathLimit 설정 시 첫 번째 서브디렉토리(예: /ko/) 추출
    if (config.strictPathLimit && !config.requiredPathPattern) {
      config.requiredPathPattern = this.extractPathPattern(baseUrl);
      if (config.requiredPathPattern) {
        console.error(`[CRITICAL] 🛡️ BFS 경로 제한 활성화: ${config.requiredPathPattern} 패턴만 허용`);
      }
    }

    if (!this.browser) {
      await this.initialize();
    }

    console.error(`[CRITICAL] 🔍 BFS depth 탐색 시작: ${baseUrl}, maxDepth: ${config.maxDepth}`);
    console.error(`[CRITICAL] 📋 설정:`, config);

    const visitedUrls = new Set<string>(); // 방문한 URL 추적 (중복/루프 방지)
    const discoveredPages: DepthAwareDiscoveredUrl[] = [];
    const baseDomain = this.extractDomain(baseUrl);
    const baseOrigin = this.getBaseUrl(baseUrl);

    // BFS 큐: {url, depth, parentUrl, path}
    interface QueueItem {
      url: string;
      depth: number;
      parentUrl?: string;
      path: string[];
    }

    const queue: QueueItem[] = [{ url: baseUrl, depth: 0, path: [baseUrl] }];
    visitedUrls.add(this.normalizeUrl(baseUrl));
    console.error(`[CRITICAL] 🚀 BFS 큐 초기화: 시작 URL ${baseUrl} 추가 (depth: 0, 큐 크기: ${queue.length})`);

    // Sitemap에서 먼저 발견한 URL들을 큐에 추가 (depth 1로 설정)
    try {
      const sitemapUrls = await this.discoverFromSitemap(baseUrl, config);
      for (const sitemapUrl of sitemapUrls) {
        const normalized = this.normalizeUrl(sitemapUrl.url);
        if (!visitedUrls.has(normalized) && this.isValidUrl(sitemapUrl.url, baseDomain, config)) {
          visitedUrls.add(normalized);
          queue.push({
            url: sitemapUrl.url,
            depth: 1,
            parentUrl: baseUrl,
            path: [baseUrl, sitemapUrl.url],
          });
          discoveredPages.push({
            ...sitemapUrl,
            depth: 1,
            parentUrl: baseUrl,
            path: [baseUrl, sitemapUrl.url],
          });
        }
      }
      console.error(`[CRITICAL] 📄 Sitemap에서 ${sitemapUrls.length}개 발견, 큐에 추가됨`);
    } catch (error) {
      console.error(`[CRITICAL] ⚠️ Sitemap 탐색 실패 (계속 진행):`, error);
    }

    // BFS 루프
    let processedCount = 0;
    // 수집 범위 완전성 확보를 위해 처리 한도 대폭 증가
    const maxProcessed = config.maxDepth >= 4
      ? config.maxUrls * 10 // maxDepth 4: 10배 허용 (대규모 사이트 대응)
      : config.maxUrls * 5;  // maxDepth 1-3: 5배 허용

    const startTime = Date.now();
    // 타임아웃 상향 조정 및 최적화
    const timeout = config.maxDepth >= 4
      ? (config.timeout || 300000)  // maxDepth 4: 5분
      : (config.timeout || 180000);  // maxDepth 1-3: 3분

    while (queue.length > 0 && processedCount < maxProcessed) {
      // 타임아웃 체크
      if (Date.now() - startTime > timeout) {
        console.error(`[CRITICAL] ⚠️ Discovery 타임아웃 (${timeout}ms) 도달, 현재까지 발견된 ${discoveredPages.length}개 URL 반환`);
        break;
      }

      const current = queue.shift();
      if (!current) break;

      // maxDepth 도달 시 더 이상 탐색하지 않음
      if (current.depth >= config.maxDepth) {
        console.error(`[CRITICAL] ⏭️ maxDepth 도달: ${current.url} (depth: ${current.depth}, maxDepth: ${config.maxDepth})`);
        continue;
      }

      processedCount++;
      if (processedCount === 1 || processedCount % 5 === 0) {
        console.error(`[CRITICAL] 🔄 BFS 루프 진행: 처리 ${processedCount}개, 발견 ${discoveredPages.length}개, 큐 ${queue.length}개 (현재: ${current.url}, depth: ${current.depth})`);
      }

      try {
        // 현재 페이지에서 링크 추출
        const nextDepth = current.depth + 1;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c0851aaf-3b55-4357-b1b0-24aecd475e3c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'SitemapDiscoveryService.ts:295', message: 'BFS: discoverFromLinks 호출 전', data: { currentUrl: current.url, currentDepth: current.depth, nextDepth, baseDomain }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
        // #endregion
        const linkUrls = await this.discoverFromLinks(current.url, config, current.depth === 0 ? preloadedHtml : undefined);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/c0851aaf-3b55-4357-b1b0-24aecd475e3c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'SitemapDiscoveryService.ts:297', message: 'BFS: discoverFromLinks 결과', data: { currentUrl: current.url, linkUrlsCount: linkUrls.length, linkUrls: linkUrls.slice(0, 5).map(u => u.url) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
        // #endregion

        let validLinksCount = 0;
        let skippedVisitedCount = 0;
        let skippedInvalidCount = 0;

        for (const linkUrl of linkUrls) {
          const normalized = this.normalizeUrl(linkUrl.url);

          // 이미 방문했거나 유효하지 않은 URL은 건너뛰기
          if (visitedUrls.has(normalized)) {
            skippedVisitedCount++;
            if (skippedVisitedCount <= 5) {
              console.error(`[CRITICAL] ⏭️ 이미 방문한 URL 건너뜀: ${linkUrl.url}`);
            }
            continue;
          }

          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/c0851aaf-3b55-4357-b1b0-24aecd475e3c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'SitemapDiscoveryService.ts:306', message: 'BFS: isValidUrl 호출 전', data: { linkUrl: linkUrl.url, baseDomain, maxDepth: config.maxDepth, domainLimit: config.domainLimit }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
          // #endregion
          const isValid = this.isValidUrl(linkUrl.url, baseDomain, config);
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/c0851aaf-3b55-4357-b1b0-24aecd475e3c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'SitemapDiscoveryService.ts:307', message: 'BFS: isValidUrl 결과', data: { linkUrl: linkUrl.url, isValid, baseDomain, maxDepth: config.maxDepth, domainLimit: config.domainLimit }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'D' }) }).catch(() => { });
          // #endregion
          if (!isValid) {
            skippedInvalidCount++;
            if (skippedInvalidCount <= 5) {
              console.error(`[CRITICAL] ⏭️ 유효하지 않은 URL 건너뜀: ${linkUrl.url} (baseDomain: ${baseDomain}, maxDepth: ${config.maxDepth}, domainLimit: ${config.domainLimit})`);
            }
            continue;
          }

          validLinksCount++;
          visitedUrls.add(normalized);

          // 발견된 URL을 결과에 추가 (depth 재설정)
          const newPath = [...current.path, linkUrl.url];
          discoveredPages.push({
            ...linkUrl,
            depth: nextDepth, // discoverFromLinks가 반환한 depth: 1을 올바른 depth로 재설정
            parentUrl: current.url,
            path: newPath,
          });

          // 다음 depth 탐색을 위해 큐에 추가 (maxDepth까지 포함)
          if (nextDepth <= config.maxDepth) {
            queue.push({
              url: linkUrl.url,
              depth: nextDepth,
              parentUrl: current.url,
              path: newPath,
            });
          }
        }

        if (linkUrls.length > 0) {
          console.error(`[CRITICAL] 📊 BFS 링크 처리 통계 (${current.url}): 총 ${linkUrls.length}개 → 유효 ${validLinksCount}개 (건너뜀: 방문 ${skippedVisitedCount}개, 무효 ${skippedInvalidCount}개)`);
        }

        // 진행 상황 로깅 (매 10개마다)
        if (processedCount % 10 === 0) {
          console.error(`[CRITICAL] 📊 BFS 진행: 처리 ${processedCount}개, 발견 ${discoveredPages.length}개, 큐 ${queue.length}개`);
        }
      } catch (error) {
        console.error(`[CRITICAL] ⚠️ URL 처리 실패 (계속 진행): ${current.url}`, error);
        // 개별 URL 실패해도 계속 진행
      }
    }

    // 결과 필터링 및 정렬
    console.error(`[CRITICAL] 🔍 BFS 루프 종료: 발견 ${discoveredPages.length}개, 처리 ${processedCount}개, 큐 남음 ${queue.length}개`);
    const filteredPages = this.filterAndSortPages(discoveredPages, baseDomain, config) as DepthAwareDiscoveredUrl[];

    console.error(`[CRITICAL] ✅ BFS depth 탐색 완료: 총 ${filteredPages.length}개 발견 (처리: ${processedCount}개, 필터링 전: ${discoveredPages.length}개)`);
    console.error(`[CRITICAL] 📊 Depth별 통계:`, this.getDepthStatistics(filteredPages));

    if (filteredPages.length === 0 && discoveredPages.length > 0) {
      console.error(`[CRITICAL] ⚠️ 발견된 ${discoveredPages.length}개 페이지가 모두 필터링되었습니다. 필터 조건을 확인해주세요.`);
      console.error(`[CRITICAL] 📋 필터링 전 샘플 URL (최대 10개):`, discoveredPages.slice(0, 10).map(p => ({ url: p.url, depth: p.depth, source: p.source })));
    }

    return filteredPages.slice(0, config.maxUrls);
  }

  /**
   * Depth별 통계 계산
   */
  private getDepthStatistics(pages: DepthAwareDiscoveredUrl[]): Record<number, number> {
    const stats: Record<number, number> = {};
    for (const page of pages) {
      stats[page.depth] = (stats[page.depth] || 0) + 1;
    }
    return stats;
  }

  /**
   * Sitemap.xml에서 URL 발견
   */
  private async discoverFromSitemap(
    baseUrl: string,
    config: DiscoveryOptions
  ): Promise<DiscoveredUrl[]> {
    const discoveredUrls: DiscoveredUrl[] = [];
    const baseDomain = this.extractDomain(baseUrl);

    try {
      // robots.txt에서 sitemap 위치 찾기
      const robotsUrl = `${this.getBaseUrl(baseUrl)}/robots.txt`;
      console.error(`[CRITICAL] 🤖 robots.txt 확인 시작: ${robotsUrl}`);

      const robotsResponse = await fetch(robotsUrl);
      console.error(`[CRITICAL] 🤖 robots.txt 응답: ${robotsResponse.status} ${robotsResponse.statusText}`);

      if (robotsResponse.ok) {
        const robotsText = await robotsResponse.text();
        console.error(`[CRITICAL] 🤖 robots.txt 내용 길이: ${robotsText.length}자`);
        const sitemapMatches = robotsText.match(/Sitemap:\s*(.+)/gi);

        if (sitemapMatches && sitemapMatches.length > 0) {
          console.error(`[CRITICAL] 📋 robots.txt에서 ${sitemapMatches.length}개 Sitemap 발견`);
          for (const match of sitemapMatches) {
            const sitemapUrl = match.replace(/Sitemap:\s*/i, '').trim();
            console.error(`[CRITICAL] 📄 Sitemap 처리 시작: ${sitemapUrl}`);

            try {
              const urls = await this.parseSitemap(sitemapUrl, baseDomain, config);
              discoveredUrls.push(...urls);
              console.error(`[CRITICAL] ✅ Sitemap 처리 완료: ${sitemapUrl} - ${urls.length}개 URL 발견`);
            } catch (sitemapError) {
              console.error(`[CRITICAL] ❌ Sitemap 처리 실패 (계속 진행): ${sitemapUrl}`, sitemapError);
              // 개별 sitemap 실패해도 계속 진행
            }
          }
        } else {
          console.error(`[CRITICAL] ⚠️ robots.txt에서 Sitemap을 찾지 못했습니다.`);
        }
      } else {
        console.error(`[CRITICAL] ⚠️ robots.txt 접근 실패: ${robotsResponse.status} ${robotsResponse.statusText}`);
      }

      // 기본 및 대체 sitemap URL 목록 생성
      const baseOrigin = this.getBaseUrl(baseUrl);
      const fallbackUrls = [
        `${baseOrigin}/sitemap.xml`,
        `${baseOrigin}/sitemap_index.xml`,
        `${baseOrigin}/sitemaps.xml`,
      ];

      // 언어 패턴 감지 및 전용 사이트맵 추가
      const pathPattern = this.extractPathPattern(baseUrl);
      if (pathPattern) {
        const lang = pathPattern.replace(/\//g, ''); // /ko/ -> ko
        if (lang) {
          fallbackUrls.push(`${baseOrigin}/${lang}.sitemap.xml`);
          fallbackUrls.push(`${baseOrigin}/${lang}.sitemapindex.xml`);
          fallbackUrls.push(`${baseOrigin}/${lang}-sitemap.xml`);
        }
      }

      // 중복 제거 및 robots.txt에서 이미 처리된 것 제외 (이미 discoveredUrls에 들어감)
      // 정확한 기명칭은 이미 수행된 sitemapUrl을 추적할 필요가 있으나, parseSitemap 내부에서 캐싱되거나 중복 처리가 되어있으므로 일단 진행

      for (const sitemapUrl of Array.from(new Set(fallbackUrls))) {
        console.error(`[CRITICAL] 📄 폴백 Sitemap 처리 시도: ${sitemapUrl}`);
        try {
          const sitemapUrls = await this.parseSitemap(sitemapUrl, baseDomain, config);
          discoveredUrls.push(...sitemapUrls);
          if (sitemapUrls.length > 0) {
            console.error(`[CRITICAL] ✅ 폴백 Sitemap 처리 완료: ${sitemapUrl} - ${sitemapUrls.length}개 URL 발견`);
          }
        } catch (sitemapError) {
          // 개별 실패 무시
        }
      }

      console.error(`[CRITICAL] 📊 Sitemap 탐색 최종 결과: ${discoveredUrls.length}개 URL 발견`);

    } catch (error) {
      console.error('❌ Sitemap 발견 실패:', error);
    }

    return discoveredUrls;
  }

  /**
   * Sitemap XML 파싱
   */
  private async parseSitemap(
    sitemapUrl: string,
    baseDomain: string,
    config: DiscoveryOptions
  ): Promise<DiscoveredUrl[]> {
    try {
      const response = await fetch(sitemapUrl);
      if (!response.ok) {
        console.log(`⚠️ Sitemap 접근 불가: ${sitemapUrl} - ${response.status}`);
        return [];
      }

      // Content-Type 확인
      const contentType = response.headers.get('content-type') || '';
      const isXmlContentType = contentType.includes('xml') || contentType.includes('text/xml') || contentType.includes('application/xml');
      const isHtmlContentType = contentType.includes('html') || contentType.includes('text/html');

      // Gzip 압축 파일 처리
      let xmlContent: string;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Content-Type과 파일 확장자로 gzip 여부 판단
      const isGzipByExtension = sitemapUrl.endsWith('.gz');
      const isGzipByContentType = contentType.includes('gzip') || contentType.includes('application/gzip');

      // 실제 바이너리 내용 확인: gzip magic number (1f 8b) 확인
      const isGzipByMagic = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

      // HTML Content-Type이지만 실제로는 gzip인 경우 처리
      const isHtmlContentTypeButGzip = isHtmlContentType && (isGzipByExtension || isGzipByMagic);

      const isGzip = isGzipByExtension || isGzipByContentType || isGzipByMagic || isHtmlContentTypeButGzip;

      if (isGzip) {
        console.log(`[CRITICAL] 📦 Gzip 압축 파일 감지: ${sitemapUrl} (Content-Type: ${contentType}, 확장자: ${isGzipByExtension}, Magic: ${isGzipByMagic})`);
        try {
          const decompressed = gunzipSync(buffer);
          xmlContent = decompressed.toString('utf-8');
          console.log(`[CRITICAL] ✅ Gzip 압축 해제 완료: ${sitemapUrl} (${xmlContent.length}자)`);
        } catch (gzipError: any) {
          console.error(`[CRITICAL] ❌ Gzip 압축 해제 실패: ${sitemapUrl}`, {
            error: gzipError?.message || String(gzipError),
            bufferLength: buffer.length,
            contentType,
            isGzipByExtension,
            isGzipByMagic,
            firstBytes: buffer.slice(0, 10).toString('hex')
          });

          // gzip 해제 실패 시 일반 텍스트로 시도
          try {
            xmlContent = buffer.toString('utf-8');
            console.log(`[CRITICAL] ⚠️ Gzip 해제 실패, 일반 텍스트로 시도: ${sitemapUrl} (${xmlContent.length}자)`);
          } catch (textError) {
            console.error(`[CRITICAL] ❌ 텍스트 변환도 실패: ${sitemapUrl}`);
            return [];
          }
        }
      } else {
        xmlContent = buffer.toString('utf-8');
        console.log(`[CRITICAL] 📄 콘텐츠 다운로드 완료: ${sitemapUrl} (${xmlContent.length}자, Content-Type: ${contentType})`);
      }

      if (!xmlContent || xmlContent.trim().length === 0) {
        console.warn(`[CRITICAL] ⚠️ 빈 콘텐츠: ${sitemapUrl}`);
        return [];
      }

      // HTML 감지 (Content-Type 또는 내용 기반)
      const trimmedContent = xmlContent.trim();
      const isHtml = isHtmlContentType ||
        trimmedContent.startsWith('<!DOCTYPE html') ||
        trimmedContent.startsWith('<!doctype html') ||
        trimmedContent.startsWith('<html') ||
        trimmedContent.startsWith('<HTML');

      if (isHtml) {
        console.warn(`[CRITICAL] ⚠️ Sitemap이 HTML을 반환했습니다: ${sitemapUrl} (Content-Type: ${contentType})`);
        console.warn(`[CRITICAL] 💡 실제 Sitemap이 없거나 다른 경로에 있을 수 있습니다. 링크 탐색으로 대체합니다.`);
        return [];
      }

      // XML 형식 확인
      if (!isXmlContentType && !trimmedContent.startsWith('<?xml') && !trimmedContent.startsWith('<urlset') && !trimmedContent.startsWith('<sitemapindex')) {
        console.warn(`[CRITICAL] ⚠️ XML 형식이 아닌 것으로 보입니다: ${sitemapUrl} (Content-Type: ${contentType})`);
        console.warn(`[CRITICAL] 💡 링크 탐색으로 대체합니다.`);
        return [];
      }

      // XML 전처리: 제어 문자 제거 및 기본 정규화
      let normalizedXml = xmlContent
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // 제어 문자 제거
        .replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;') // 잘못된 & 문자 수정
        .trim();

      // xml2js 파서 옵션 설정 (엄격한 모드 완화)
      const parseOptions = {
        trim: true,
        explicitArray: false,
        mergeAttrs: true,
        explicitRoot: false,
        ignoreAttrs: false,
        attrkey: '_attr',
        charkey: '_text',
        strict: false, // 엄격한 모드 비활성화 (잘못된 형식 허용)
        normalize: true, // 공백 정규화
        normalizeTags: false,
        explicitChildren: false,
        charsAsChildren: false,
        includeWhiteChars: false,
        async: false,
      };

      const result = await parseStringPromise(normalizedXml, parseOptions);

      const discoveredUrls: DiscoveredUrl[] = [];
      let sitemapIndexCount = 0;
      let urlsetCount = 0;
      let urlsetFilteredCount = 0;

      // sitemapindex인 경우
      // explicitRoot: false이므로 result 자체가 sitemapindex일 수도 있고 속성으로 있을 수도 있음
      const sitemapIndex = result.sitemapindex || result.sitemap_index || result;
      const sitemapItems = sitemapIndex.sitemap || (result.sitemapindex ? result.sitemapindex.sitemap : null);

      if (sitemapItems) {
        const sitemaps = Array.isArray(sitemapItems) ? sitemapItems : [sitemapItems];
        sitemapIndexCount = sitemaps.length;
        console.error(`[CRITICAL] 📋 Sitemap Index 발견: ${sitemapIndexCount}개 하위 sitemap`);
        for (const sitemap of sitemaps) {
          const loc = sitemap.loc;
          const subSitemapUrl = Array.isArray(loc) ? loc[0] : loc;
          if (!subSitemapUrl) continue;

          console.error(`[CRITICAL] 📄 하위 Sitemap 처리: ${subSitemapUrl}`);
          const subUrls = await this.parseSitemap(subSitemapUrl, baseDomain, config);
          discoveredUrls.push(...subUrls);
          console.error(`[CRITICAL] ✅ 하위 Sitemap 처리 완료: ${subSitemapUrl} - ${subUrls.length}개 URL`);
        }
      }

      // urlset인 경우
      // explicitRoot: false이므로 result 자체가 urlset일 수도 있고 속성으로 있을 수도 있음
      const urlSet = result.urlset || result.url_set || result;
      const urlItems = urlSet.url || (result.urlset ? result.urlset.url : null);

      if (urlItems) {
        const urls = Array.isArray(urlItems) ? urlItems : [urlItems];
        urlsetCount = urls.length;
        console.error(`[CRITICAL] 📋 URL Set 발견: ${urlsetCount}개 URL`);
        for (const url of urls) {
          const loc = url.loc;
          const urlString = Array.isArray(loc) ? loc[0] : loc;
          if (!urlString) continue;

          const lastmod = Array.isArray(url.lastmod) ? url.lastmod[0] : url.lastmod;
          const priority = Array.isArray(url.priority) ? parseFloat(url.priority[0]) : (url.priority ? parseFloat(url.priority) : undefined);

          if (this.isValidUrl(urlString, baseDomain, config)) {
            discoveredUrls.push({
              url: urlString,
              lastModified: lastmod,
              priority: priority,
              source: 'sitemap',
              depth: 1
            });
          } else {
            urlsetFilteredCount++;
          }
        }
        console.error(`[CRITICAL] 📊 URL Set 필터링: ${urlsetCount}개 중 ${discoveredUrls.length}개 통과, ${urlsetFilteredCount}개 제외`);
      }

      if (!sitemapItems && !urlItems) {
        console.error(`[CRITICAL] ⚠️ Sitemap 형식 인식 실패: sitemapindex도 urlset도 아님`);
        console.error(`[CRITICAL] 📄 Sitemap 내용 미리보기 (처음 500자): ${xmlContent.substring(0, 500)}`);
      }

      console.error(`[CRITICAL] 📄 Sitemap 파싱 완료: ${sitemapUrl} - ${discoveredUrls.length}개 URL (sitemapindex: ${sitemapIndexCount}개, urlset: ${urlsetCount}개, 필터링: ${urlsetFilteredCount}개)`);
      return discoveredUrls;

    } catch (error) {
      console.error(`❌ Sitemap 파싱 실패: ${sitemapUrl}`, error);
      return [];
    }
  }

  /**
   * 페이지 링크에서 URL 발견 (하이브리드: Cheerio 우선, 필요 시 Puppeteer)
   */
  private async discoverFromLinks(
    baseUrl: string,
    config: DiscoveryOptions,
    preloadedHtml?: string
  ): Promise<DiscoveredUrl[]> {
    const discoveredUrls: DiscoveredUrl[] = [];
    const baseDomain = this.extractDomain(baseUrl);

    // 1단계: 이미 로드된 HTML이 있으면 재사용, 없으면 Fetch + Cheerio로 시도
    try {
      let htmlContent: string;

      if (preloadedHtml) {
        console.error(`[CRITICAL] 🔗 링크 추출 시작 (Cheerio, HTML 재사용): ${baseUrl}`);
        htmlContent = preloadedHtml;
      } else {
        console.error(`[CRITICAL] 🔗 링크 추출 시작 (Cheerio, 새로 요청): ${baseUrl}`);
        const commonHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
        } as Record<string, string>;

        const response = await fetch(baseUrl, {
          headers: commonHeaders,
          redirect: 'follow',
          signal: AbortSignal.timeout(10000), // 10초 타임아웃
        });

        console.error(`[CRITICAL] 🔗 페이지 응답: ${response.status} ${response.statusText}, Content-Type: ${response.headers.get('content-type')}`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        htmlContent = await response.text();
      }

      if (htmlContent) {
        const $ = cheerio.load(htmlContent);
        const baseUrlObj = new URL(baseUrl);
        const baseOrigin = `${baseUrlObj.protocol}//${baseUrlObj.host}`;

        // Cheerio로 링크 추출
        let totalLinks = 0;
        let validLinks = 0;
        let filteredLinks = 0;

        $('a[href]').each((_, element) => {
          const href = $(element).attr('href');
          if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
            return;
          }

          totalLinks++;
          try {
            let fullUrl: string;
            if (href.startsWith('http://') || href.startsWith('https://')) {
              fullUrl = href;
            } else if (href.startsWith('/')) {
              fullUrl = `${baseOrigin}${href}`;
            } else {
              fullUrl = new URL(href, baseUrl).href;
            }

            const urlObj = new URL(fullUrl);
            const urlDomain = urlObj.hostname;

            // 쿼리 파라미터 정규화 (트래킹 파라미터 제거)
            const normalizedUrl = this.normalizeUrl(fullUrl);

            // isValidUrl에서 모든 도메인 필터링을 수행하므로, 여기서는 기본적인 중복/앵커 체크만 수행
            if (normalizedUrl !== baseUrl && !normalizedUrl.includes('#')) {
              validLinks++;
              const isValid = this.isValidUrl(normalizedUrl, baseDomain, config);
              if (isValid) {
                discoveredUrls.push({
                  url: normalizedUrl,
                  title: $(element).text().trim() || undefined,
                  source: 'links',
                  depth: 1
                });
              } else {
                console.error(`[CRITICAL] ⏭️ discoverFromLinks에서 isValidUrl 실패: ${normalizedUrl} (baseDomain: ${baseDomain}, urlDomain: ${urlDomain}, maxDepth: ${config.maxDepth}, domainLimit: ${config.domainLimit})`);
                filteredLinks++;
              }
            } else {
              filteredLinks++;
            }
          } catch (e) {
            // URL 파싱 실패 시 무시
          }
        });

        console.error(`[CRITICAL] 📊 링크 추출 통계 (Cheerio): 총 ${totalLinks}개 → 유효 ${validLinks}개 → 최종 ${discoveredUrls.length}개 (필터링: ${filteredLinks}개)`);

        // 콘텐츠가 충분한지 확인 (정적 HTML로 충분한 경우)
        const bodyText = $('body').text().trim();
        const hasSubstantialContent = bodyText.length > 500; // 500자 이상의 텍스트가 있으면 정적 HTML로 판단

        // maxDepth 4인 경우 또는 발견된 링크가 5개 미만인 경우 Puppeteer도 시도
        // (Facebook 같은 동적 사이트는 Cheerio만으로는 충분한 링크를 찾지 못할 수 있음)
        const shouldTryPuppeteer = config.maxDepth >= 4 || discoveredUrls.length < 5;

        if (hasSubstantialContent && discoveredUrls.length > 0 && !shouldTryPuppeteer) {
          console.error(`[CRITICAL] 🔗 페이지 링크에서 발견 (Cheerio): ${discoveredUrls.length}개`);
          return discoveredUrls;
        } else {
          if (shouldTryPuppeteer) {
            console.error(`[CRITICAL] ⚠️ maxDepth 4이거나 링크가 적음 (${discoveredUrls.length}개), Puppeteer도 시도하여 더 많은 링크 발견 시도`);
          } else {
            console.error(`[CRITICAL] ⚠️ Cheerio로 충분한 콘텐츠를 찾지 못함 (텍스트: ${bodyText.length}자, 링크: ${discoveredUrls.length}개), Puppeteer 시도`);
          }
        }
      }
    } catch (fetchError) {
      console.error(`[CRITICAL] ⚠️ Fetch + Cheerio 실패, Puppeteer 시도:`, fetchError);
    }

    // 2단계: Puppeteer 사용 (JavaScript 렌더링이 필요한 경우)
    try {
      if (!this.browser) {
        await this.initialize();
      }

      if (this.browser) {
        // Puppeteer 작업에 타임아웃 적용 (30초)
        const puppeteerTask = async () => {
          const page = await this.browser!.newPage();
          try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1920, height: 1080 });

            await page.goto(baseUrl, {
              waitUntil: 'networkidle2',
              timeout: 30000 // 페이지 로드 타임아웃 30초로 증가
            });

            // 현재 URL 확인 (로그인 페이지로 리다이렉트되었는지 체크)
            const currentUrl = page.url();
            const isLoginPage = currentUrl.includes('/login') ||
              currentUrl.includes('/signin') ||
              currentUrl.includes('facebook.com/login') ||
              currentUrl.includes('facebook.com/business') && currentUrl.includes('login');

            if (isLoginPage && !baseUrl.includes('/login') && !baseUrl.includes('/signin')) {
              console.error(`[CRITICAL] ⚠️ 로그인 페이지로 리다이렉트됨: ${currentUrl} (원본: ${baseUrl})`);
              // 로그인 페이지로 리다이렉트된 경우에도 일단 링크 추출 시도
              // Facebook의 경우 로그인 페이지에도 일부 링크가 있을 수 있음
            }

            // 페이지가 완전히 로드될 때까지 대기 (JavaScript 실행 대기)
            // maxDepth 4이거나 Facebook 같은 동적 사이트는 더 오래 대기
            // 로그인 페이지로 리다이렉트된 경우에도 충분한 대기 시간 필요
            const isFacebook = baseUrl.includes('facebook.com');
            const waitTime = (config.maxDepth >= 4 || isFacebook) ? 8000 : (isLoginPage ? 5000 : 2000);
            await new Promise(resolve => setTimeout(resolve, waitTime));

            // 추가 스크롤로 lazy-loaded 콘텐츠 로드 시도
            if (config.maxDepth >= 4 || baseUrl.includes('facebook.com')) {
              try {
                await page.evaluate(() => {
                  window.scrollTo(0, document.body.scrollHeight);
                });
                await new Promise(resolve => setTimeout(resolve, 2000));
                await page.evaluate(() => {
                  window.scrollTo(0, 0);
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
              } catch (scrollError) {
                console.error(`[CRITICAL] ⚠️ 스크롤 실패 (계속 진행):`, scrollError);
              }
            }

            // 페이지에서 링크 추출 (maxDepth 4일 때는 모든 도메인 허용)
            // 더 많은 선택자를 사용하여 링크 발견 (Facebook 같은 사이트 대응)
            const links = await page.evaluate((baseDomain, maxDepth, baseUrl) => {
              // 다양한 선택자로 링크 찾기 (Facebook의 다양한 링크 패턴 대응)
              const linkSelectors = [
                'a[href]',
                '[role="link"][href]',
                '[data-href]',
                '[href]', // 모든 href 속성을 가진 요소
                'a[data-testid]', // Facebook의 data-testid를 가진 링크
                'a[aria-label]', // aria-label을 가진 링크
              ];

              const linkElements = new Set<Element>();
              linkSelectors.forEach(selector => {
                try {
                  document.querySelectorAll(selector).forEach(el => linkElements.add(el));
                } catch (e) {
                  // 선택자 오류 무시
                }
              });

              const links: Array<{ url: string, title: string }> = [];

              // 하위 도메인 체크 함수
              const isSubdomain = (subDomain: string, baseDomain: string): boolean => {
                if (subDomain === baseDomain) return false;
                return subDomain.endsWith(`.${baseDomain}`);
              };

              // 루트 도메인 추출 함수 (브라우저 내부에서 사용)
              const extractRootDomain = (domain: string): string => {
                const parts = domain.split('.');
                if (parts.length <= 2) {
                  return domain;
                }
                return parts.slice(-2).join('.');
              };

              // 같은 루트 도메인인지 확인
              const isSameRootDomain = (domain1: string, domain2: string): boolean => {
                if (domain1 === domain2) return true;
                return extractRootDomain(domain1) === extractRootDomain(domain2);
              };

              linkElements.forEach(link => {
                // href 속성 또는 data-href 속성 확인
                let href = link.getAttribute('href') || link.getAttribute('data-href');
                if (!href) return;

                try {
                  const fullUrl = new URL(href, window.location.href).href;
                  const urlDomain = new URL(fullUrl).hostname;

                  // Puppeteer 내부에서는 모든 링크를 수집하고, 나중에 isValidUrl로 필터링
                  // (브라우저 내부에서는 isValidUrl을 직접 호출할 수 없으므로, 여기서는 기본적인 필터링만 수행)
                  // maxDepth 4일 때는 같은 루트 도메인 허용 (나중에 isValidUrl에서 정확히 필터링됨)
                  const isSameDomain = urlDomain === baseDomain;
                  let shouldInclude = false;
                  if (maxDepth >= 4) {
                    // maxDepth 4: 같은 루트 도메인 허용 (나중에 isValidUrl에서 domainLimit에 따라 정확히 필터링됨)
                    shouldInclude = isSameRootDomain(urlDomain, baseDomain);
                  } else if (maxDepth >= 3) {
                    // maxDepth 3: 같은 도메인 또는 하위 도메인 허용
                    shouldInclude = isSameDomain || isSubdomain(urlDomain, baseDomain);
                  } else {
                    // maxDepth 1-2: 정확히 같은 도메인만 허용
                    shouldInclude = isSameDomain;
                  }

                  if (shouldInclude &&
                    fullUrl !== window.location.href &&
                    !fullUrl.includes('#') &&
                    !fullUrl.includes('javascript:') &&
                    !fullUrl.includes('mailto:')) {
                    links.push({
                      url: fullUrl,
                      title: link.textContent?.trim() || ''
                    });
                  }
                } catch (e) {
                  // URL 파싱 실패 시 무시
                }
              });

              return links;
            }, baseDomain, config.maxDepth, baseUrl);

            return links;
          } finally {
            await page.close();
          }
        };

        // 30초 타임아웃으로 Puppeteer 작업 실행
        const links = await Promise.race([
          puppeteerTask(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Puppeteer timeout')), 30000))
        ]) as Array<{ url: string, title: string }>;

        // Puppeteer로 발견한 링크 추가 (중복 제거, URL 정규화)
        const existingUrls = new Set(discoveredUrls.map(u => u.url));
        links.forEach(link => {
          // 쿼리 파라미터 정규화 (트래킹 파라미터 제거)
          const normalizedUrl = this.normalizeUrl(link.url);
          if (!existingUrls.has(normalizedUrl) && this.isValidUrl(normalizedUrl, baseDomain, config)) {
            discoveredUrls.push({
              url: normalizedUrl,
              title: link.title || undefined,
              source: 'links',
              depth: 1
            });
            existingUrls.add(normalizedUrl);
          }
        });

        console.error(`[CRITICAL] 🔗 페이지 링크에서 발견 (Puppeteer 추가): 총 ${discoveredUrls.length}개`);
      }
    } catch (puppeteerError) {
      // Puppeteer 실패 시에도 Cheerio로 발견한 링크는 반환
      // 이는 정상적인 fallback이므로 에러가 아닙니다
      console.log('ℹ️ Puppeteer 사용 불가 (예상된 동작), Cheerio 결과만 사용하여 계속 진행합니다');
    }

    return discoveredUrls;
  }

  /**
   * URL 정규화 (트래킹 파라미터 제거, 중요한 파라미터 유지)
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);

      // 트래킹 파라미터 목록 (제거할 파라미터)
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'ref', 'source', 'campaign_id',
        '_ga', '_gid', 'mc_cid', 'mc_eid'
      ];

      // 중요한 파라미터 목록 (유지할 파라미터)
      const importantParams = ['locale', 'lang', 'language', 'version', 'id'];

      // 쿼리 파라미터 필터링
      const filteredParams = new URLSearchParams();
      urlObj.searchParams.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        // 트래킹 파라미터는 제거
        if (trackingParams.some(tp => lowerKey.startsWith(tp.toLowerCase()))) {
          return;
        }
        // 중요한 파라미터나 기타 파라미터는 유지
        filteredParams.append(key, value);
      });

      // 정규화된 URL 생성
      urlObj.search = filteredParams.toString();
      return urlObj.href;
    } catch (e) {
      // URL 파싱 실패 시 원본 반환
      return url;
    }
  }

  /**
   * 도메인이 하위 도메인인지 확인
   */
  private isSubdomain(subDomain: string, baseDomain: string): boolean {
    if (subDomain === baseDomain) {
      return false;
    }
    return subDomain.endsWith(`.${baseDomain}`);
  }

  /**
   * 루트 도메인 추출 (예: ko-kr.facebook.com → facebook.com)
   */
  private extractRootDomain(domain: string): string {
    const parts = domain.split('.');
    if (parts.length <= 2) {
      return domain;
    }
    // 마지막 2개 부분을 루트 도메인으로 사용 (facebook.com, example.co.kr 등)
    return parts.slice(-2).join('.');
  }

  /**
   * 같은 루트 도메인인지 확인 (예: ko-kr.facebook.com과 www.facebook.com)
   */
  private isSameRootDomain(domain1: string, domain2: string): boolean {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c0851aaf-3b55-4357-b1b0-24aecd475e3c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'SitemapDiscoveryService.ts:1027', message: 'isSameRootDomain 호출', data: { domain1, domain2 }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
    // #endregion
    if (domain1 === domain2) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c0851aaf-3b55-4357-b1b0-24aecd475e3c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'SitemapDiscoveryService.ts:1030', message: 'isSameRootDomain: 같은 도메인', data: { domain1, domain2, result: true }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
      // #endregion
      return true;
    }
    const root1 = this.extractRootDomain(domain1);
    const root2 = this.extractRootDomain(domain2);
    const result = root1 === root2;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/c0851aaf-3b55-4357-b1b0-24aecd475e3c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'SitemapDiscoveryService.ts:1033', message: 'isSameRootDomain: 루트 도메인 비교', data: { domain1, domain2, root1, root2, result }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
    // #endregion
    return result;
  }

  /**
   * URL에서 첫 번째 서브디렉토리 패턴 추출 (예: /ko/)
   */
  private extractPathPattern(urlStr: string): string | undefined {
    try {
      const url = new URL(urlStr);
      const parts = url.pathname.split('/').filter(Boolean);
      return parts.length > 0 ? `/${parts[0]}/` : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * URL 유효성 검사
   */
  private isValidUrl(url: string, baseDomain: string, config: DiscoveryOptions): boolean {
    try {
      const urlObj = new URL(url);
      const urlDomain = urlObj.hostname;

      // 경로 패턴 제한 (strictPathLimit)
      if (config.strictPathLimit && config.requiredPathPattern) {
        const pattern = config.requiredPathPattern;
        const patternWithoutSlash = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
        const pathname = urlObj.pathname;

        // 패턴으로 시작하지 않고, 패턴(슬래시 제외)과도 일치하지 않으면 배제
        if (!pathname.startsWith(pattern) && pathname !== patternWithoutSlash) {
          // 예외: 루트('/')는 일단 허용할지 검토 필요하나, 
          // 사용자의 요청은 "이 패턴과 일치하지 않는 링크는 배제"하는 것이므로 엄격하게 적용
          return false;
        }
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/c0851aaf-3b55-4357-b1b0-24aecd475e3c', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'SitemapDiscoveryService.ts:1040', message: 'isValidUrl 호출', data: { url, urlDomain, baseDomain, maxDepth: config.maxDepth, domainLimit: config.domainLimit }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }) }).catch(() => { });
      // #endregion

      // maxDepth에 따른 도메인 필터링 개선
      // maxDepth 1: 정확히 같은 도메인만 허용
      // maxDepth 2-3: domainLimit=true면 같은 도메인만, false면 하위 도메인 포함
      // maxDepth 4: domainLimit=true면 같은 루트 도메인 허용, false면 모든 도메인 허용
      if (urlDomain !== baseDomain) {
        if (config.maxDepth >= 4) {
          if (config.domainLimit === true) {
            // 루트 도메인이 같으면 허용 (Meta 등 대형 플랫폼 대응)
            return this.isSameRootDomain(urlDomain, baseDomain);
          }
          return true; // 모든 도메인 허용
        } else if (config.maxDepth >= 2) {
          // depth 2 이상부터는 도메인 제한 옵션에 따라 유연하게 처리
          if (config.domainLimit === true) {
            // Meta 계열 서브도메인(ko-kr.facebook.com) 등은 동일 루트인 경우 예외적으로 허용 검토
            // 사용자 요청에 따른 '완전성' 확보를 위해 동일 루트 도메인은 기본 허용 (depth 3 이상)
            if (config.maxDepth >= 3 && this.isSameRootDomain(urlDomain, baseDomain)) {
              return true;
            }
            return false;
          }
          // domainLimit false면 하위 도메인 허용
          return this.isSubdomain(urlDomain, baseDomain);
        } else {
          return false;
        }
      }

      // 허용된 도메인 목록 확인 (maxDepth 4가 아닌 경우)
      if (config.maxDepth < 4 && config.allowedDomains && config.allowedDomains.length > 0) {
        const isAllowed = config.allowedDomains.some(domain =>
          urlDomain === domain ||
          (config.maxDepth >= 3 && this.isSubdomain(urlDomain, domain))
        );
        if (!isAllowed) {
          return false;
        }
      }

      // 불필요한 확장자 제외 (단, sitemap URL은 이미 파싱되어 URL 목록으로 변환되므로 영향 없음)
      const excludedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.xml'];
      const hasExcludedExtension = excludedExtensions.some(ext => {
        // 경로 끝에 확장자가 있는 경우만 제외 (URL 중간에 포함된 것은 허용)
        const pathname = urlObj.pathname.toLowerCase();
        return pathname.endsWith(ext);
      });
      if (hasExcludedExtension) {
        return false;
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 페이지 필터링 및 정렬
   */
  private filterAndSortPages(
    pages: DiscoveredUrl[],
    baseDomain: string,
    config: DiscoveryOptions
  ): DiscoveredUrl[] {
    // URL 정규화 적용 (트래킹 파라미터 제거)
    const normalizedPages = pages.map(page => ({
      ...page,
      url: this.normalizeUrl(page.url)
    }));

    // 중복 제거 (정규화된 URL 기준)
    const uniquePages = normalizedPages.filter((page, index, self) =>
      index === self.findIndex(p => p.url === page.url)
    );

    console.log(`📊 필터링 전: ${pages.length}개 → 정규화 후: ${normalizedPages.length}개 → 중복 제거 후: ${uniquePages.length}개`);

    // 도메인 필터링
    const beforeDomainFilter = uniquePages.length;
    const filteredPages: DiscoveredUrl[] = [];
    const filteredOut: Array<{ url: string, reason: string }> = [];

    uniquePages.forEach(page => {
      try {
        const urlObj = new URL(page.url);
        const urlDomain = urlObj.hostname;

        // maxDepth에 따른 필터링 (isValidUrl과 동기화)
        if (urlDomain !== baseDomain) {
          if (config.maxDepth >= 4) {
            if (config.domainLimit === true && !this.isSameRootDomain(urlDomain, baseDomain)) {
              filteredOut.push({ url: page.url, reason: `도메인 제한 (루트 불일치): ${urlDomain}` });
              return;
            }
          } else if (config.maxDepth >= 3) {
            if (config.domainLimit === true && !this.isSameRootDomain(urlDomain, baseDomain)) {
              filteredOut.push({ url: page.url, reason: `도메인 제한: ${urlDomain}` });
              return;
            }
            if (config.domainLimit === false && !this.isSubdomain(urlDomain, baseDomain)) {
              filteredOut.push({ url: page.url, reason: `하위 도메인 아님: ${urlDomain}` });
              return;
            }
          } else if (config.maxDepth >= 2) {
            if (config.domainLimit === true && urlDomain !== baseDomain) {
              filteredOut.push({ url: page.url, reason: `도메인 불일치: ${urlDomain}` });
              return;
            }
          } else {
            filteredOut.push({ url: page.url, reason: `도메인 불일치 (depth 1): ${urlDomain}` });
            return;
          }
        }

        // allowedDomains 체크 (maxDepth 4 + domainLimit=false일 때는 건너뛰기)
        // maxDepth 4 + domainLimit=true일 때는 이미 루트 도메인 체크를 했으므로 추가 체크 불필요
        // maxDepth 4 + domainLimit=false일 때는 모든 도메인 허용하므로 체크 불필요
        if (config.maxDepth < 4 && config.allowedDomains && config.allowedDomains.length > 0) {
          const isAllowed = config.allowedDomains.some(domain =>
            urlDomain === domain ||
            (config.maxDepth >= 3 && this.isSubdomain(urlDomain, domain))
          );
          if (!isAllowed) {
            filteredOut.push({ url: page.url, reason: `허용되지 않은 도메인: ${urlDomain} not in [${config.allowedDomains.join(', ')}]` });
            return;
          }
        }

        // 확장자 체크
        const excludedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.xml'];
        const pathname = urlObj.pathname.toLowerCase();
        const hasExcludedExtension = excludedExtensions.some(ext => pathname.endsWith(ext));
        if (hasExcludedExtension) {
          filteredOut.push({ url: page.url, reason: `제외된 확장자: ${pathname}` });
          return;
        }

        // 모든 체크 통과
        filteredPages.push(page);
      } catch (e) {
        filteredOut.push({ url: page.url, reason: `URL 파싱 실패: ${e}` });
      }
    });

    console.log(`[CRITICAL] 📊 도메인 필터링: ${beforeDomainFilter}개 → ${filteredPages.length}개 (제외: ${beforeDomainFilter - filteredPages.length}개)`);

    // 필터링된 URL 상세 로그 (처음 10개만)
    if (filteredOut.length > 0) {
      console.error(`[CRITICAL] ⚠️ 필터링된 URL 샘플 (처음 10개):`);
      filteredOut.slice(0, 10).forEach((item, idx) => {
        console.error(`[CRITICAL]   ${idx + 1}. ${item.url.substring(0, 80)}... (이유: ${item.reason})`);
      });
      if (filteredOut.length > 10) {
        console.error(`[CRITICAL]   ... 외 ${filteredOut.length - 10}개`);
      }
    }

    // 우선순위별 정렬 (sitemap > links > pattern) 및 가중치 부여
    const sourcePriority = { sitemap: 1, robots: 1, links: 2, pattern: 3 };

    // 경로 기반 우선순위 계산 (입력된 URL과 경로가 유사할수록 우선순위 높임)
    const baseUrlObj = new URL(this.normalizeUrl(config.allowedDomains?.[0] || 'http://' + baseDomain));
    const basePath = baseUrlObj.pathname.replace(/\/$/, '');

    filteredPages.sort((a, b) => {
      // 1. 소스 우선순위
      const priorityA = sourcePriority[a.source] || 4;
      const priorityB = sourcePriority[b.source] || 4;

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // 2. 경로 유사도 가중치 (고도화: 입력 경로 하위 페이지 우선)
      if (basePath && basePath !== '/') {
        const pathA = new URL(a.url).pathname;
        const pathB = new URL(b.url).pathname;
        const startsWithA = pathA.startsWith(basePath);
        const startsWithB = pathB.startsWith(basePath);

        if (startsWithA && !startsWithB) return -1;
        if (!startsWithA && startsWithB) return 1;
      }

      // 3. 같은 소스인 경우 priority 값으로 정렬
      if (a.priority && b.priority) {
        return b.priority - a.priority;
      }

      // 4. Depth 우선 (낮은 depth 먼저)
      if (a.depth && b.depth && a.depth !== b.depth) {
        return a.depth - b.depth;
      }

      return 0;
    });

    const autoLimit = Math.max(1, config.maxUrls);
    if (filteredPages.length <= autoLimit || config.maxDepth < 3) {
      return filteredPages.slice(0, autoLimit);
    }

    const depth1List = filteredPages.filter(page => page.depth === 1);
    const depth2List = filteredPages.filter(page => page.depth === 2);
    const depth3PlusList = filteredPages.filter(page => page.depth && page.depth >= 3);

    const reserveForDepth3 = Math.min(50, Math.max(10, Math.floor(autoLimit * 0.25)));
    const result: DiscoveredUrl[] = [];

    const consume = (list: DiscoveredUrl[], limit: number) => {
      if (limit <= 0 || list.length === 0) {
        return 0;
      }
      const portion = list.splice(0, limit);
      result.push(...portion);
      return portion.length;
    };

    let depth12Budget = Math.max(0, autoLimit - reserveForDepth3);
    depth12Budget -= consume(depth1List, depth12Budget);
    depth12Budget -= consume(depth2List, depth12Budget);

    consume(depth3PlusList, reserveForDepth3);

    while (result.length < autoLimit && (depth1List.length || depth2List.length || depth3PlusList.length)) {
      const remaining = autoLimit - result.length;
      if (consume(depth1List, remaining)) {
        continue;
      }
      if (consume(depth2List, remaining)) {
        continue;
      }
      consume(depth3PlusList, remaining);
    }

    return result.slice(0, autoLimit);
  }

  /**
   * 도메인 추출
   */
  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  /**
   * 기본 URL 추출 (프로토콜 + 도메인)
   */
  private getBaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.hostname}`;
    } catch (e) {
      return url;
    }
  }
}

// 싱글톤 인스턴스
export const sitemapDiscoveryService = new SitemapDiscoveryService();

