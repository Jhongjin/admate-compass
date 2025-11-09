import puppeteer, { Browser, Page } from 'puppeteer';
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

      console.log('✅ SitemapDiscoveryService 브라우저 초기화 완료');
    } catch (error) {
      console.error('❌ SitemapDiscoveryService 브라우저 초기화 실패:', error);
      throw error;
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
    try {
      if (!this.browser) {
        await this.initialize();
      }
    } catch (initError) {
      console.warn('⚠️ Puppeteer 초기화 실패, fetch fallback만 사용합니다:', initError);
      // 초기화 실패해도 계속 진행 (fetch fallback 사용)
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
   * 페이지 링크에서 URL 발견 (Puppeteer 우선, 실패 시 fetch fallback)
   */
  private async discoverFromLinks(
    baseUrl: string, 
    config: DiscoveryOptions
  ): Promise<DiscoveredUrl[]> {
    const discoveredUrls: DiscoveredUrl[] = [];
    const baseDomain = this.extractDomain(baseUrl);

    // Puppeteer를 사용한 링크 추출 시도
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
              if (urlDomain === baseDomain && 
                  fullUrl !== window.location.href &&
                  !fullUrl.includes('#') && 
                  !fullUrl.includes('?') &&
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

        // 링크를 DiscoveredUrl 형태로 변환
        links.forEach(link => {
          if (this.isValidUrl(link.url, baseDomain, config)) {
            discoveredUrls.push({
              url: link.url,
              title: link.title || undefined,
              source: 'links',
              depth: 1
            });
          }
        });

        await page.close();
        console.log(`🔗 페이지 링크에서 발견 (Puppeteer): ${discoveredUrls.length}개`);
        return discoveredUrls;
      }
    } catch (puppeteerError) {
      // Puppeteer 실패 시 fetch fallback 사용
      if (puppeteerError instanceof Error && puppeteerError.message.includes('Chrome')) {
        console.warn('⚠️ Puppeteer 사용 불가, fetch fallback으로 전환');
      } else {
        console.warn('⚠️ Puppeteer 링크 추출 실패, fetch fallback으로 전환:', puppeteerError);
      }
    }

    // Fetch fallback: HTML을 가져와서 정규식으로 링크 추출
    try {
      const response = await fetch(baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        console.warn(`⚠️ HTML 가져오기 실패: ${baseUrl} - ${response.status}`);
        return discoveredUrls;
      }

      const htmlContent = await response.text();
      const baseUrlObj = new URL(baseUrl);
      const baseOrigin = `${baseUrlObj.protocol}//${baseUrlObj.host}`;

      // 정규식으로 링크 추출
      const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
      const links = new Set<string>();
      
      let match;
      while ((match = linkRegex.exec(htmlContent)) !== null && links.size < 200) {
        const href = match[1].trim();
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
          continue;
        }

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

          // 같은 도메인이고 다른 경로인 경우만 포함
          if (urlDomain === baseDomain && 
              fullUrl !== baseUrl &&
              !fullUrl.includes('#') && 
              !urlObj.search && // 쿼리 파라미터 제외
              this.isValidUrl(fullUrl, baseDomain, config)) {
            links.add(fullUrl);
          }
        } catch (e) {
          // URL 파싱 실패 시 무시
        }
      }

      // DiscoveredUrl 형태로 변환
      links.forEach(url => {
        discoveredUrls.push({
          url,
          source: 'links',
          depth: 1
        });
      });

      console.log(`🔗 페이지 링크에서 발견 (fetch fallback): ${discoveredUrls.length}개`);

    } catch (fetchError) {
      console.error('❌ fetch fallback 링크 추출 실패:', fetchError);
    }

    return discoveredUrls;
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
    // 중복 제거
    const uniquePages = pages.filter((page, index, self) => 
      index === self.findIndex(p => p.url === page.url)
    );
    
    // 도메인 필터링
    const filteredPages = uniquePages.filter(page => 
      this.isValidUrl(page.url, baseDomain, config)
    );
    
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
