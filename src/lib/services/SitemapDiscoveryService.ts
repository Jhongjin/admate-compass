import puppeteer, { Browser, Page } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import * as cheerio from 'cheerio';
import { parseStringPromise } from 'xml2js';

export interface DiscoveredUrl {
  url: string;
  title?: string;
  lastModified?: string;
  priority?: number;
  source: 'sitemap' | 'robots' | 'links' | 'pattern';
  depth: number;
}

export interface DiscoveryOptions {
  maxDepth: number;
  maxUrls: number;
  respectRobotsTxt: boolean;
  includeExternal: boolean;
  allowedDomains?: string[];
}

export class SitemapDiscoveryService {
  private browser: Browser | null = null;
  private defaultOptions: DiscoveryOptions = {
    maxDepth: 3,
    maxUrls: 100,
    respectRobotsTxt: true,
    includeExternal: false,
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
            defaultViewport: chromium.defaultViewport,
            executablePath: executablePath,
            headless: chromium.headless,
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
    options: Partial<DiscoveryOptions> = {}
  ): Promise<DiscoveredUrl[]> {
    const config = { ...this.defaultOptions, ...options };

    // Puppeteer 초기화 시도 (실패해도 계속 진행)
    // initialize()는 내부에서 에러를 throw하지 않으므로 try-catch는 사실상 불필요하지만, 안전을 위해 유지
    if (!this.browser) {
      await this.initialize();
    }

    console.log(`🔍 하위 페이지 발견 시작: ${baseUrl}`);
    console.log(`📋 설정:`, config);

    const discoveredUrls = new Set<string>();
    const discoveredPages: DiscoveredUrl[] = [];
    const baseDomain = this.extractDomain(baseUrl);

    try {
      // 1. Sitemap.xml에서 URL 발견 (Puppeteer 불필요)
      const sitemapUrls = await this.discoverFromSitemap(baseUrl, config);
      sitemapUrls.forEach(url => {
        if (!discoveredUrls.has(url.url)) {
          discoveredUrls.add(url.url);
          discoveredPages.push(url);
        }
      });

      console.log(`📄 Sitemap에서 발견: ${sitemapUrls.length}개`);

      // 2. 페이지 링크에서 URL 발견 (Puppeteer 우선, 실패 시 fetch fallback)
      const linkUrls = await this.discoverFromLinks(baseUrl, config);
      linkUrls.forEach(url => {
        if (!discoveredUrls.has(url.url)) {
          discoveredUrls.add(url.url);
          discoveredPages.push(url);
        }
      });

      console.log(`🔗 링크에서 발견: ${linkUrls.length}개`);

      // 3. 결과 필터링 및 정렬
      const filteredPages = this.filterAndSortPages(discoveredPages, baseDomain, config);
      
      console.log(`✅ 최종 발견된 하위 페이지: ${filteredPages.length}개`);
      return filteredPages.slice(0, config.maxUrls);

    } catch (error) {
      console.error('❌ 하위 페이지 발견 실패:', error);
      // 일부 실패해도 발견된 URL은 반환
      return discoveredPages.slice(0, config.maxUrls);
    }
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
      console.log(`🤖 robots.txt 확인: ${robotsUrl}`);

      const robotsResponse = await fetch(robotsUrl);
      if (robotsResponse.ok) {
        const robotsText = await robotsResponse.text();
        const sitemapMatches = robotsText.match(/Sitemap:\s*(.+)/gi);
        
        if (sitemapMatches) {
          for (const match of sitemapMatches) {
            const sitemapUrl = match.replace(/Sitemap:\s*/i, '').trim();
            console.log(`📄 Sitemap 발견: ${sitemapUrl}`);
            
            const sitemapUrls = await this.parseSitemap(sitemapUrl, baseDomain, config);
            discoveredUrls.push(...sitemapUrls);
          }
        }
      }

      // 기본 sitemap.xml 시도
      const defaultSitemapUrl = `${this.getBaseUrl(baseUrl)}/sitemap.xml`;
      console.log(`📄 기본 sitemap.xml 시도: ${defaultSitemapUrl}`);
      
      const sitemapUrls = await this.parseSitemap(defaultSitemapUrl, baseDomain, config);
      discoveredUrls.push(...sitemapUrls);

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

      const xmlContent = await response.text();
      const result = await parseStringPromise(xmlContent);
      
      const discoveredUrls: DiscoveredUrl[] = [];
      
      // sitemapindex인 경우
      if (result.sitemapindex) {
        const sitemaps = result.sitemapindex.sitemap || [];
        for (const sitemap of sitemaps) {
          const subSitemapUrl = sitemap.loc[0];
          const subUrls = await this.parseSitemap(subSitemapUrl, baseDomain, config);
          discoveredUrls.push(...subUrls);
        }
      }
      
      // urlset인 경우
      if (result.urlset) {
        const urls = result.urlset.url || [];
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
          }
        }
      }

      console.log(`📄 Sitemap 파싱 완료: ${sitemapUrl} - ${discoveredUrls.length}개 URL`);
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
    config: DiscoveryOptions
  ): Promise<DiscoveredUrl[]> {
    const discoveredUrls: DiscoveredUrl[] = [];
    const baseDomain = this.extractDomain(baseUrl);

    // 1단계: Fetch + Cheerio로 빠르게 시도 (정적 HTML)
    try {
      const response = await fetch(baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000), // 10초 타임아웃
      });

      if (response.ok) {
        const htmlContent = await response.text();
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

            // 같은 도메인이고 다른 경로인 경우만 포함
            if (urlDomain === baseDomain && 
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
        
        console.log(`📊 링크 추출 통계 (Cheerio): 총 ${totalLinks}개 → 유효 ${validLinks}개 → 최종 ${discoveredUrls.length}개 (필터링: ${filteredLinks}개)`);

        // 콘텐츠가 충분한지 확인 (정적 HTML로 충분한 경우)
        const bodyText = $('body').text().trim();
        const hasSubstantialContent = bodyText.length > 500; // 500자 이상의 텍스트가 있으면 정적 HTML로 판단
        
        if (hasSubstantialContent && discoveredUrls.length > 0) {
          console.log(`🔗 페이지 링크에서 발견 (Cheerio): ${discoveredUrls.length}개`);
          return discoveredUrls;
        } else {
          console.log(`⚠️ Cheerio로 충분한 콘텐츠를 찾지 못함 (텍스트: ${bodyText.length}자, 링크: ${discoveredUrls.length}개), Puppeteer 시도`);
        }
      }
    } catch (fetchError) {
      console.warn('⚠️ Fetch + Cheerio 실패, Puppeteer 시도:', fetchError);
    }

    // 2단계: Puppeteer 사용 (JavaScript 렌더링이 필요한 경우)
    try {
      if (!this.browser) {
        await this.initialize();
      }

      if (this.browser) {
        const page = await this.browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        await page.goto(baseUrl, { 
          waitUntil: 'networkidle2',
          timeout: 30000 
        });

        // 페이지가 완전히 로드될 때까지 대기 (waitForTimeout 대체)
        await new Promise(resolve => setTimeout(resolve, 2000)); // JavaScript 실행 대기

        // 페이지에서 링크 추출
        const links = await page.evaluate((baseDomain) => {
          const linkElements = document.querySelectorAll('a[href]');
          const links: Array<{url: string, title: string}> = [];
          
          linkElements.forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;
            
            try {
              const fullUrl = new URL(href, window.location.href).href;
              const urlDomain = new URL(fullUrl).hostname;
              
              // 같은 도메인이고 다른 경로인 경우만 포함
              // 쿼리 파라미터는 허용 (정규화는 서버 측에서 수행)
              if (urlDomain === baseDomain && 
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
        }, baseDomain);

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

        await page.close();
        console.log(`🔗 페이지 링크에서 발견 (Puppeteer 추가): 총 ${discoveredUrls.length}개`);
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
   * URL 유효성 검사
   */
  private isValidUrl(url: string, baseDomain: string, config: DiscoveryOptions): boolean {
    try {
      const urlObj = new URL(url);
      const urlDomain = urlObj.hostname;
      
      // 같은 도메인인지 확인
      if (urlDomain !== baseDomain) {
        return config.includeExternal;
      }
      
      // 허용된 도메인 목록 확인
      if (config.allowedDomains && !config.allowedDomains.includes(urlDomain)) {
        return false;
      }
      
      // 불필요한 확장자 제외
      const excludedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.xml'];
      const hasExcludedExtension = excludedExtensions.some(ext => url.toLowerCase().includes(ext));
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
    const filteredPages = uniquePages.filter(page => 
      this.isValidUrl(page.url, baseDomain, config)
    );
    
    console.log(`📊 도메인 필터링: ${beforeDomainFilter}개 → ${filteredPages.length}개 (제외: ${beforeDomainFilter - filteredPages.length}개)`);
    
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
    
    return filteredPages;
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
