/**
 * URL 발견 서비스
 * 사이트맵, robots.txt, 페이지 링크에서 URL 발견
 */

import { browserManager } from '../core/BrowserManager';
import { sitemapParser } from './SitemapParser';
import type { DiscoveredUrl, CrawlOptions } from '../types';
import { extractDomain, getBaseUrl, normalizeUrl, isAllowedDomain, calculateDepth, buildUrlPath } from '../utils/url-utils';
import { extractLinks } from '../utils/html-utils';

export class UrlDiscovery {
  /**
   * 하위 페이지 발견
   */
  async discoverSubPages(
    baseUrl: string,
    options: Partial<CrawlOptions> = {}
  ): Promise<DiscoveredUrl[]> {
    const config: CrawlOptions = {
      maxDepth: 3,
      maxUrls: 100,
      respectRobots: true,
      domainLimit: true,
      timeout: 60000,
      ...options,
    };

    console.log(`🔍 URL 발견 시작: ${baseUrl}`, config);

    const discoveredUrls = new Set<string>();
    const discoveredPages: DiscoveredUrl[] = [];
    const baseDomain = extractDomain(baseUrl);

    try {
      // 1. 사이트맵에서 URL 발견
      const sitemapUrls = await this.discoverFromSitemap(baseUrl, config);
      sitemapUrls.forEach(url => {
        if (!discoveredUrls.has(url.url)) {
          discoveredUrls.add(url.url);
          discoveredPages.push(url);
        }
      });

      // 2. 페이지 링크에서 URL 발견
      const linkUrls = await this.discoverFromLinks(baseUrl, config);
      linkUrls.forEach(url => {
        if (!discoveredUrls.has(url.url)) {
          discoveredUrls.add(url.url);
          discoveredPages.push(url);
        }
      });

      // 3. 필터링 및 정렬
      const filtered = this.filterAndSort(discoveredPages, baseDomain, config);

      console.log(`✅ URL 발견 완료: ${filtered.length}개`);

      return filtered.slice(0, config.maxUrls || 100);
    } catch (error) {
      console.error('❌ URL 발견 실패:', error);
      return discoveredPages.slice(0, config.maxUrls || 100);
    }
  }

  /**
   * 사이트맵에서 URL 발견
   */
  private async discoverFromSitemap(
    baseUrl: string,
    config: CrawlOptions
  ): Promise<DiscoveredUrl[]> {
    const discovered: DiscoveredUrl[] = [];

    try {
      // robots.txt에서 사이트맵 찾기
      const baseOrigin = getBaseUrl(baseUrl);
      const robotsUrl = `${baseOrigin}/robots.txt`;
      const sitemapUrls = await sitemapParser.findSitemapsFromRobots(robotsUrl);

      // 일반적인 사이트맵 URL 추가
      const commonSitemaps = sitemapParser.getSitemapUrls(baseUrl);
      const allSitemapUrls = [...new Set([...sitemapUrls, ...commonSitemaps])];

      // 각 사이트맵 파싱
      for (const sitemapUrl of allSitemapUrls) {
        try {
          const items = await sitemapParser.parseSitemap(sitemapUrl);
          
          for (const item of items) {
            if (!item.loc) continue;

            const normalizedUrl = normalizeUrl(item.loc);
            const depth = calculateDepth(baseUrl, normalizedUrl);

            // 깊이 제한 확인 (999는 다른 도메인을 의미하므로 제외)
            if (config.maxDepth && depth !== 999 && depth > config.maxDepth) {
              continue;
            }

            // 도메인 제한 확인
            if (config.domainLimit && !isAllowedDomain(normalizedUrl, config.allowedDomains)) {
              continue;
            }

            discovered.push({
              url: normalizedUrl,
              source: 'sitemap',
              depth,
              priority: item.priority,
              lastModified: item.lastmod,
              parentUrl: baseUrl,
              path: buildUrlPath(baseUrl, normalizedUrl),
            });
          }
        } catch (error) {
          console.warn(`⚠️ 사이트맵 파싱 실패: ${sitemapUrl}`, error);
        }
      }
    } catch (error) {
      console.warn('⚠️ 사이트맵에서 URL 발견 실패:', error);
    }

    return discovered;
  }

  /**
   * 페이지 링크에서 URL 발견
   */
  private async discoverFromLinks(
    baseUrl: string,
    config: CrawlOptions
  ): Promise<DiscoveredUrl[]> {
    const discovered: DiscoveredUrl[] = [];

    try {
      let html: string;

      // Puppeteer 사용 시도
      const browser = browserManager.getBrowser();
      if (browser) {
        try {
          const page = await browserManager.createPage();
          await page.goto(baseUrl, {
            waitUntil: 'networkidle2',
            timeout: config.timeout || 30000,
          });
          html = await page.content();
          await page.close();
        } catch (error) {
          // Puppeteer 실패 시 fetch 사용
          console.warn('⚠️ Puppeteer로 페이지 로드 실패, fetch로 폴백:', error);
          const response = await fetch(baseUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          html = await response.text();
        }
      } else {
        // 브라우저가 없으면 fetch 사용
        const response = await fetch(baseUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        html = await response.text();
      }

      // HTML에서 링크 추출
      const links = extractLinks(html, baseUrl);

      for (const link of links) {
        const normalizedUrl = normalizeUrl(link.url);
        const depth = calculateDepth(baseUrl, normalizedUrl);

        // 깊이 제한 확인 (999는 다른 도메인을 의미하므로 제외)
        if (config.maxDepth && depth !== 999 && depth > config.maxDepth) {
          continue;
        }

        // 도메인 제한 확인
        if (config.domainLimit && !isAllowedDomain(normalizedUrl, config.allowedDomains)) {
          continue;
        }

        // 같은 URL 제외
        if (normalizedUrl === baseUrl || normalizedUrl === normalizeUrl(baseUrl)) {
          continue;
        }

        discovered.push({
          url: normalizedUrl,
          title: link.text || undefined,
          source: 'links',
          depth,
          parentUrl: baseUrl,
          path: buildUrlPath(baseUrl, normalizedUrl),
        });
      }
    } catch (error) {
      console.warn('⚠️ 링크에서 URL 발견 실패:', error);
    }

    return discovered;
  }

  /**
   * 필터링 및 정렬
   */
  private filterAndSort(
    urls: DiscoveredUrl[],
    baseDomain: string,
    config: CrawlOptions
  ): DiscoveredUrl[] {
    // 필터링
    const filtered = urls.filter(url => {
      // 도메인 확인
      if (config.domainLimit) {
        const urlDomain = extractDomain(url.url);
        if (urlDomain !== baseDomain && !urlDomain.endsWith(`.${baseDomain}`)) {
          return false;
        }
      }

      // 허용된 도메인 확인
      if (config.allowedDomains && config.allowedDomains.length > 0) {
        if (!isAllowedDomain(url.url, config.allowedDomains)) {
          return false;
        }
      }

      return true;
    });

    // 정렬: 우선순위 > 깊이 > URL
    filtered.sort((a, b) => {
      // 우선순위 (sitemap의 경우)
      if (a.priority !== undefined && b.priority !== undefined) {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
      }

      // 깊이
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }

      // URL 알파벳 순
      return a.url.localeCompare(b.url);
    });

    return filtered;
  }
}

// 싱글톤 인스턴스
export const urlDiscovery = new UrlDiscovery();

