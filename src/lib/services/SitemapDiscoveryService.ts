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

    // maxDepth 3 이상일 때는 BFS depth 탐색 사용 (더 많은 URL 발견 가능)
    if (config.maxDepth >= 3) {
      console.error(`[CRITICAL] 🔍 maxDepth ${config.maxDepth} 감지: BFS depth 탐색 사용`);
      const depthAwareResults = await this.discoverSubPagesWithDepth(baseUrl, config, preloadedHtml);
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
    const maxProcessed = config.maxUrls * 3; // 최대 처리 개수 제한 (무한 루프 방지)

    const startTime = Date.now();
    const timeout = config.timeout || 120000;

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
        continue;
      }

      processedCount++;

      try {
        // 현재 페이지에서 링크 추출
        const nextDepth = current.depth + 1;
        const linkUrls = await this.discoverFromLinks(current.url, config, current.depth === 0 ? preloadedHtml : undefined);

        for (const linkUrl of linkUrls) {
          const normalized = this.normalizeUrl(linkUrl.url);

          // 이미 방문했거나 유효하지 않은 URL은 건너뛰기
          if (visitedUrls.has(normalized) || !this.isValidUrl(linkUrl.url, baseDomain, config)) {
            continue;
          }

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
    const filteredPages = this.filterAndSortPages(discoveredPages, baseDomain, config) as DepthAwareDiscoveredUrl[];

    console.error(`[CRITICAL] ✅ BFS depth 탐색 완료: 총 ${filteredPages.length}개 발견 (처리: ${processedCount}개)`);
    console.error(`[CRITICAL] 📊 Depth별 통계:`, this.getDepthStatistics(filteredPages));

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
              const sitemapUrls = await this.parseSitemap(sitemapUrl, baseDomain, config);
              discoveredUrls.push(...sitemapUrls);
              console.error(`[CRITICAL] ✅ Sitemap 처리 완료: ${sitemapUrl} - ${sitemapUrls.length}개 URL 발견`);
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

      // 기본 sitemap.xml 시도
      const defaultSitemapUrl = `${this.getBaseUrl(baseUrl)}/sitemap.xml`;
      console.error(`[CRITICAL] 📄 기본 sitemap.xml 시도: ${defaultSitemapUrl}`);

      try {
        const sitemapUrls = await this.parseSitemap(defaultSitemapUrl, baseDomain, config);
        discoveredUrls.push(...sitemapUrls);
        console.error(`[CRITICAL] ✅ 기본 sitemap.xml 처리 완료: ${sitemapUrls.length}개 URL 발견`);
      } catch (sitemapError) {
        console.error(`[CRITICAL] ❌ 기본 sitemap.xml 처리 실패 (계속 진행):`, sitemapError);
        // 기본 sitemap 실패해도 계속 진행
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
      const isGzip = sitemapUrl.endsWith('.gz') || contentType.includes('gzip') || contentType.includes('application/gzip');

      if (isGzip) {
        console.log(`[CRITICAL] 📦 Gzip 압축 파일 감지: ${sitemapUrl} (Content-Type: ${contentType})`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        try {
          const decompressed = gunzipSync(buffer);
          xmlContent = decompressed.toString('utf-8');
          console.log(`[CRITICAL] ✅ Gzip 압축 해제 완료: ${sitemapUrl} (${xmlContent.length}자)`);
        } catch (gzipError) {
          console.error(`[CRITICAL] ❌ Gzip 압축 해제 실패: ${sitemapUrl}`, gzipError);
          return [];
        }
      } else {
        xmlContent = await response.text();
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

      // XML 전처리: 잘못된 속성 형식 수정
      // "Attribute without value" 오류 방지를 위해 속성 정규화
      let normalizedXml = xmlContent
        // 잘못된 속성 형식 수정 (attr > → attr="")
        .replace(/(\w+)\s+>/g, '$1="">')
        // 따옴표 없는 속성 값 수정 (attr=value → attr="value")
        .replace(/(\w+)=([^"'\s>]+)(?=\s|\/?>)/g, (match, attr, value) => {
          // 이미 따옴표가 있으면 그대로 유지
          if (value.startsWith('"') || value.startsWith("'")) {
            return match;
          }
          // 특수 문자나 공백이 있으면 따옴표 추가
          if (value.includes(' ') || value.includes('=') || value.includes('>')) {
            return `${attr}="${value}"`;
          }
          return match;
        })
        // 잘못된 XML 문자 제거 (제어 문자 등)
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
        // CDATA 섹션 보존
        .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '<![CDATA[$1]]>');

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
      if (result.sitemapindex) {
        const sitemaps = result.sitemapindex.sitemap || [];
        sitemapIndexCount = sitemaps.length;
        console.error(`[CRITICAL] 📋 Sitemap Index 발견: ${sitemapIndexCount}개 하위 sitemap`);
        for (const sitemap of sitemaps) {
          const subSitemapUrl = sitemap.loc[0];
          console.error(`[CRITICAL] 📄 하위 Sitemap 처리: ${subSitemapUrl}`);
          const subUrls = await this.parseSitemap(subSitemapUrl, baseDomain, config);
          discoveredUrls.push(...subUrls);
          console.error(`[CRITICAL] ✅ 하위 Sitemap 처리 완료: ${subSitemapUrl} - ${subUrls.length}개 URL`);
        }
      }

      // urlset인 경우
      if (result.urlset) {
        const urls = result.urlset.url || [];
        urlsetCount = urls.length;
        console.error(`[CRITICAL] 📋 URL Set 발견: ${urlsetCount}개 URL`);
        for (const url of urls) {
          const urlString = url.loc[0];
          const lastmod = url.lastmod ? url.lastmod[0] : undefined;
          const priority = url.priority ? parseFloat(url.priority[0]) : undefined;

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

      if (!result.sitemapindex && !result.urlset) {
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

            // maxDepth 4일 때는 모든 도메인 허용, 그 외에는 같은 도메인만 체크
            const isSameDomain = urlDomain === baseDomain;
            let isAllowedDomain = false;
            if (config.maxDepth >= 4) {
              // maxDepth 4: 모든 도메인 허용
              isAllowedDomain = true;
            } else if (config.maxDepth >= 3) {
              // maxDepth 3: domainLimit에 따라 다름
              if (config.domainLimit === true) {
                // domainLimit이 true면 하위 도메인도 제외 (같은 도메인만)
                isAllowedDomain = isSameDomain;
              } else {
                // domainLimit이 false면 하위 도메인 허용
                isAllowedDomain = isSameDomain || this.isSubdomain(urlDomain, baseDomain);
              }
            } else {
              // maxDepth 1-2: 정확히 같은 도메인만 허용
              isAllowedDomain = isSameDomain;
            }

            if (isAllowedDomain &&
              normalizedUrl !== baseUrl &&
              !normalizedUrl.includes('#')) {
              validLinks++;
              if (this.isValidUrl(normalizedUrl, baseDomain, config)) {
                discoveredUrls.push({
                  url: normalizedUrl,
                  title: $(element).text().trim() || undefined,
                  source: 'links',
                  depth: 1
                });
              } else {
                filteredLinks++;
              }
            }
          } catch (e) {
            // URL 파싱 실패 시 무시
          }
        });

        console.error(`[CRITICAL] 📊 링크 추출 통계 (Cheerio): 총 ${totalLinks}개 → 유효 ${validLinks}개 → 최종 ${discoveredUrls.length}개 (필터링: ${filteredLinks}개)`);

        // 콘텐츠가 충분한지 확인 (정적 HTML로 충분한 경우)
        const bodyText = $('body').text().trim();
        const hasSubstantialContent = bodyText.length > 500; // 500자 이상의 텍스트가 있으면 정적 HTML로 판단

        if (hasSubstantialContent && discoveredUrls.length > 0) {
          console.error(`[CRITICAL] 🔗 페이지 링크에서 발견 (Cheerio): ${discoveredUrls.length}개`);
          return discoveredUrls;
        } else {
          console.error(`[CRITICAL] ⚠️ Cheerio로 충분한 콘텐츠를 찾지 못함 (텍스트: ${bodyText.length}자, 링크: ${discoveredUrls.length}개), Puppeteer 시도`);
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
              timeout: 25000 // 페이지 로드 타임아웃 25초
            });

            // 페이지가 완전히 로드될 때까지 대기 (waitForTimeout 대체)
            await new Promise(resolve => setTimeout(resolve, 2000)); // JavaScript 실행 대기

            // 페이지에서 링크 추출 (maxDepth 4일 때는 모든 도메인 허용)
            const links = await page.evaluate((baseDomain, maxDepth) => {
              const linkElements = document.querySelectorAll('a[href]');
              const links: Array<{ url: string, title: string }> = [];

              // 하위 도메인 체크 함수
              const isSubdomain = (subDomain: string, baseDomain: string): boolean => {
                if (subDomain === baseDomain) return false;
                return subDomain.endsWith(`.${baseDomain}`);
              };

              linkElements.forEach(link => {
                const href = link.getAttribute('href');
                if (!href) return;

                try {
                  const fullUrl = new URL(href, window.location.href).href;
                  const urlDomain = new URL(fullUrl).hostname;

                  // maxDepth 4일 때는 모든 도메인 허용, 그 외에는 같은 도메인/하위 도메인만
                  const isSameDomain = urlDomain === baseDomain;
                  let isAllowedDomain = false;
                  if (maxDepth >= 4) {
                    // maxDepth 4: 모든 도메인 허용
                    isAllowedDomain = true;
                  } else if (maxDepth >= 3) {
                    // maxDepth 3: domainLimit 확인 필요 (Puppeteer 내부에서는 domainLimit을 직접 확인할 수 없으므로, 하위 도메인 허용)
                    // 실제 필터링은 isValidUrl에서 수행됨
                    isAllowedDomain = isSameDomain || isSubdomain(urlDomain, baseDomain);
                  } else {
                    // maxDepth 1-2: 정확히 같은 도메인만 허용
                    isAllowedDomain = isSameDomain;
                  }

                  if (isAllowedDomain &&
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
            }, baseDomain, config.maxDepth);

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
   * URL 유효성 검사
   */
  private isValidUrl(url: string, baseDomain: string, config: DiscoveryOptions): boolean {
    try {
      const urlObj = new URL(url);
      const urlDomain = urlObj.hostname;

      // maxDepth에 따른 도메인 필터링
      // maxDepth 1-2: 정확히 같은 도메인만 허용
      // maxDepth 3: domainLimit에 따라 다름 (true: 같은 도메인만, false: 하위 도메인 포함)
      // maxDepth 4: 모든 도메인 허용 (includeExternal과 관계없이)
      if (urlDomain !== baseDomain) {
        if (config.maxDepth >= 4) {
          // maxDepth 4: 모든 도메인 허용 (includeExternal과 관계없이)
          return true;
        } else if (config.maxDepth >= 3) {
          // maxDepth 3: domainLimit에 따라 다름
          if (config.domainLimit === true) {
            // domainLimit이 true면 하위 도메인도 제외 (같은 도메인만)
            return false;
          } else {
            // domainLimit이 false면 하위 도메인 허용
            if (this.isSubdomain(urlDomain, baseDomain)) {
              // 하위 도메인은 허용
            } else {
              // 하위 도메인이 아니면 제외
              return false;
            }
          }
        } else {
          // maxDepth 1-2: 정확히 같은 도메인만 허용
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

        // maxDepth에 따른 도메인 필터링
        // maxDepth 1-2: 정확히 같은 도메인만 허용
        // maxDepth 3: domainLimit에 따라 다름 (true: 같은 도메인만, false: 하위 도메인 포함)
        // maxDepth 4: 모든 도메인 허용 (includeExternal과 관계없이)
        if (urlDomain !== baseDomain) {
          if (config.maxDepth >= 4) {
            // maxDepth 4: 모든 도메인 허용 (includeExternal과 관계없이)
            // 허용됨 - 계속 진행
          } else if (config.maxDepth >= 3) {
            // maxDepth 3: domainLimit에 따라 다름
            if (config.domainLimit === true) {
              // domainLimit이 true면 하위 도메인도 제외 (같은 도메인만)
              filteredOut.push({ url: page.url, reason: `도메인 제한 활성화: ${urlDomain} !== ${baseDomain}` });
              return;
            } else {
              // domainLimit이 false면 하위 도메인 허용
              if (!this.isSubdomain(urlDomain, baseDomain)) {
                filteredOut.push({ url: page.url, reason: `도메인 불일치 (하위 도메인 아님): ${urlDomain} !== ${baseDomain}` });
                return;
              }
            }
          } else {
            // maxDepth 1-2: 정확히 같은 도메인만 허용
            filteredOut.push({ url: page.url, reason: `도메인 불일치: ${urlDomain} !== ${baseDomain}` });
            return;
          }
        }

        // allowedDomains 체크 (maxDepth 4가 아닌 경우)
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

    // 우선순위별 정렬 (sitemap > links > pattern)
    const sourcePriority = { sitemap: 1, robots: 1, links: 2, pattern: 3 };
    filteredPages.sort((a, b) => {
      const priorityA = sourcePriority[a.source] || 4;
      const priorityB = sourcePriority[b.source] || 4;

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // 같은 소스인 경우 priority 값으로 정렬
      if (a.priority && b.priority) {
        return b.priority - a.priority;
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

