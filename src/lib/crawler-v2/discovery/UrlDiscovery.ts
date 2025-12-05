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
      console.log(`📋 사이트맵에서 발견: ${sitemapUrls.length}개`);
      sitemapUrls.forEach(url => {
        if (!discoveredUrls.has(url.url)) {
          discoveredUrls.add(url.url);
          discoveredPages.push(url);
        }
      });

      // 2. 페이지 링크에서 URL 발견
      const linkUrls = await this.discoverFromLinks(baseUrl, config);
      console.log(`🔗 링크에서 발견: ${linkUrls.length}개`);
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
      let totalSitemapUrls = 0;
      for (const sitemapUrl of allSitemapUrls) {
        try {
          const items = await sitemapParser.parseSitemap(sitemapUrl);
          totalSitemapUrls += items.length;
          
          for (const item of items) {
            if (!item.loc) continue;

            const normalizedUrl = normalizeUrl(item.loc);
            const depth = calculateDepth(baseUrl, normalizedUrl);

            // 도메인 제한 확인 (maxDepth 기반)
            const urlDomain = extractDomain(normalizedUrl);
            const baseDomain = extractDomain(baseUrl);
            
            if (urlDomain !== baseDomain) {
              const maxDepth = config.maxDepth ?? 3; // 기본값 3
              if (maxDepth >= 4) {
                // maxDepth 4: 모든 도메인 허용 (domainLimit과 관계없이)
                // 모든 도메인 허용
              } else if (maxDepth >= 3) {
                // maxDepth 3: 같은 도메인 + 하위 도메인 허용
                if (!urlDomain.endsWith(`.${baseDomain}`)) {
                  continue;
                }
              } else {
                // maxDepth 1-2: 정확히 같은 도메인만 허용
                if (config.domainLimit !== false) {
                  continue;
                }
              }
            }

            // 허용된 도메인 확인 (maxDepth 4가 아닌 경우)
            const maxDepthForCheck = config.maxDepth ?? 3; // 기본값 3
            if (maxDepthForCheck < 4 && config.domainLimit && config.allowedDomains && config.allowedDomains.length > 0) {
              if (!isAllowedDomain(normalizedUrl, config.allowedDomains)) {
                continue;
              }
            }

            // 깊이 제한 확인
            // maxDepth 4일 때는 다른 도메인(999)도 허용
            if (maxDepthForCheck && depth > maxDepthForCheck) {
              if (maxDepthForCheck < 4 || depth !== 999) {
                continue;
              }
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
      
      if (totalSitemapUrls > 0) {
        console.log(`✅ 사이트맵에서 총 ${totalSitemapUrls}개 URL 발견`);
      }
      
      if (totalSitemapUrls > 0) {
        console.log(`✅ 사이트맵에서 총 ${totalSitemapUrls}개 URL 발견`);
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
      
      console.log(`🔗 발견된 링크: ${links.length}개`);

      // 링크 필터링 및 정렬 (중요한 링크 우선)
      const filteredLinks = links
        .filter(link => {
          const normalizedUrl = normalizeUrl(link.url);
          
          // 같은 URL 제외
          if (normalizedUrl === baseUrl || normalizedUrl === normalizeUrl(baseUrl)) {
            return false;
          }

          // 도메인 제한 확인 (maxDepth 기반)
          const urlDomain = extractDomain(normalizedUrl);
          const baseDomain = extractDomain(baseUrl);
          
          if (urlDomain !== baseDomain) {
            const maxDepth = config.maxDepth ?? 3; // 기본값 3
            if (maxDepth >= 4) {
              // maxDepth 4: 모든 도메인 허용 (domainLimit과 관계없이)
              // 모든 도메인 허용
            } else if (maxDepth >= 3) {
              // maxDepth 3: domainLimit에 따라 다름
              if (config.domainLimit === true) {
                // domainLimit이 true면 하위 도메인도 제외 (같은 도메인만)
                return false;
              } else {
                // domainLimit이 false면 하위 도메인 허용
                if (!urlDomain.endsWith(`.${baseDomain}`)) {
                  return false;
                }
              }
            } else {
              // maxDepth 1-2: 정확히 같은 도메인만 허용
              return false;
            }
          }

          // 허용된 도메인 확인 (maxDepth 4가 아닌 경우)
          const maxDepth = config.maxDepth ?? 3; // 기본값 3
          if (maxDepth < 4 && config.domainLimit && config.allowedDomains && config.allowedDomains.length > 0) {
            if (!isAllowedDomain(normalizedUrl, config.allowedDomains)) {
              return false;
            }
          }

          // 깊이 계산
          const depth = calculateDepth(baseUrl, normalizedUrl);
          
          // 깊이 제한 확인
          // maxDepth 4일 때는 다른 도메인(999)도 허용
          if (maxDepth && depth > maxDepth) {
            if (maxDepth < 4 || depth !== 999) {
              return false;
            }
          }

          return true;
        })
        // 우선순위 정렬: 깊이 2 > 깊이 3 > 기타, 텍스트가 있는 링크 우선
        .sort((a, b) => {
          const depthA = calculateDepth(baseUrl, normalizeUrl(a.url));
          const depthB = calculateDepth(baseUrl, normalizeUrl(b.url));
          
          if (depthA !== depthB) {
            return depthA - depthB; // 깊이가 낮은 것 우선
          }
          
          // 텍스트가 있는 링크 우선
          if (a.text && !b.text) return -1;
          if (!a.text && b.text) return 1;
          
          return 0;
        });

      for (const link of filteredLinks) {
        const normalizedUrl = normalizeUrl(link.url);
        const depth = calculateDepth(baseUrl, normalizedUrl);

        discovered.push({
          url: normalizedUrl,
          title: link.text || undefined,
          source: 'links',
          depth,
          parentUrl: baseUrl,
          path: buildUrlPath(baseUrl, normalizedUrl),
        });
      }
      
      console.log(`✅ 필터링된 링크: ${discovered.length}개`);
    } catch (error) {
      console.warn('⚠️ 링크에서 URL 발견 실패:', error);
    }

    return discovered;
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
   * 필터링 및 정렬
   */
  private filterAndSort(
    urls: DiscoveredUrl[],
    baseDomain: string,
    config: CrawlOptions
  ): DiscoveredUrl[] {
    // 필터링
    const filtered = urls.filter(url => {
      const urlDomain = extractDomain(url.url);
      
      // maxDepth에 따른 도메인 필터링
      // maxDepth 1-2: 정확히 같은 도메인만 허용
      // maxDepth 3: domainLimit에 따라 다름 (true: 같은 도메인만, false: 하위 도메인 포함)
      // maxDepth 4: 모든 도메인 허용 (domainLimit과 관계없이)
      if (urlDomain !== baseDomain) {
        const maxDepth = config.maxDepth ?? 3; // 기본값 3
        if (maxDepth >= 4) {
          // maxDepth 4: 모든 도메인 허용 (domainLimit과 관계없이)
          // 모든 도메인 허용
        } else if (maxDepth >= 3) {
          // maxDepth 3: domainLimit에 따라 다름
          if (config.domainLimit === true) {
            // domainLimit이 true면 하위 도메인도 제외 (같은 도메인만)
            return false;
          } else {
            // domainLimit이 false면 하위 도메인 허용
            if (!this.isSubdomain(urlDomain, baseDomain)) {
              return false;
            }
          }
        } else {
          // maxDepth 1-2: 정확히 같은 도메인만 허용
          return false;
        }
      }

      // 허용된 도메인 확인 (maxDepth 4가 아닌 경우)
      const maxDepth = config.maxDepth ?? 3; // 기본값 3
      if (maxDepth < 4 && config.allowedDomains && config.allowedDomains.length > 0) {
        const isAllowed = config.allowedDomains.some(domain => 
          urlDomain === domain || 
          (maxDepth >= 3 && this.isSubdomain(urlDomain, domain))
        );
        if (!isAllowed) {
          return false;
        }
      }

      // 깊이 필터링 추가 (discoverFromLinks에서 이미 필터링했지만, 사이트맵 URL은 여기서 필터링)
      const maxDepthForFilter = config.maxDepth ?? 3;
      if (maxDepthForFilter && url.depth > maxDepthForFilter) {
        // maxDepth 4일 때는 다른 도메인(999)도 허용
        if (maxDepthForFilter < 4 || url.depth !== 999) {
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

