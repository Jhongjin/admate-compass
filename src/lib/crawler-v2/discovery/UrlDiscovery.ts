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
                // maxDepth 3: domainLimit에 따라 다름
                if (config.domainLimit === true) {
                  // domainLimit이 true면 하위 도메인도 제외 (같은 도메인만)
                  continue;
                } else {
                  // domainLimit이 false면 하위 도메인 허용
                  if (!urlDomain.endsWith(`.${baseDomain}`)) {
                    continue;
                  }
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
      let links: Array<{ url: string; text: string }> = [];
      const baseDomain = extractDomain(baseUrl);

      // Puppeteer 사용 시도 (JavaScript 렌더링된 링크 추출)
      const browser = browserManager.getBrowser();
      if (browser) {
        try {
          const page = await browserManager.createPage();
          
          // 네이버 광고 페이지 같은 SPA 사이트를 위한 설정
          const isNaverAds = baseUrl.includes('ads.naver.com');
          const waitTime = isNaverAds ? 5000 : 2000; // 네이버 광고는 더 오래 대기
          
          await page.goto(baseUrl, {
            waitUntil: 'networkidle2',
            timeout: config.timeout || 30000,
          });
          
          // JavaScript 실행 대기 (동적 링크 로딩)
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          // 스크롤하여 lazy loading된 콘텐츠 로드
          await page.evaluate(async () => {
            await new Promise((resolve) => {
              let totalHeight = 0;
              const distance = 100;
              const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                
                if (totalHeight >= scrollHeight) {
                  clearInterval(timer);
                  resolve(null);
                }
              }, 100);
            });
          });
          
          // 추가 대기 (스크롤 후 콘텐츠 로딩)
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // 네비게이션 메뉴 열기 (네이버 광고 페이지의 경우)
          if (isNaverAds) {
            try {
              // 드롭다운 메뉴를 열기 위해 호버 또는 클릭 시도
              await page.evaluate(() => {
                // 네비게이션 메뉴 요소 찾기 및 호버
                const navItems = document.querySelectorAll('nav a, [role="navigation"] a, header a');
                navItems.forEach((item: Element) => {
                  const mouseEvent = new MouseEvent('mouseenter', {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                  });
                  item.dispatchEvent(mouseEvent);
                });
              });
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
              console.warn('⚠️ 네비게이션 메뉴 열기 실패:', e);
            }
          }
          
          // 브라우저에서 직접 링크 추출 (JavaScript 실행 후)
          links = await page.evaluate((baseDomain, maxDepth, baseUrl) => {
            // 다양한 선택자로 링크 찾기 (네이버 광고, Instagram, Facebook 등 다양한 사이트 대응)
            const linkSelectors = [
              'a[href]',
              '[role="link"][href]',
              '[data-href]',
              '[href]', // 모든 href 속성을 가진 요소
              'a[data-testid]',
              'a[aria-label]',
              '[onclick*="location"]', // onclick으로 링크 동작하는 요소
              'nav a[href]', // 네비게이션 링크
              'header a[href]', // 헤더 링크
              'footer a[href]', // 푸터 링크
              '[class*="menu"] a[href]', // 메뉴 클래스를 가진 요소의 링크
              '[class*="nav"] a[href]', // nav 클래스를 가진 요소의 링크
              '[class*="link"] a[href]', // link 클래스를 가진 요소의 링크
              'button[href]', // button 태그에 href가 있는 경우
              '[data-link]', // data-link 속성
              '[data-url]', // data-url 속성
            ];
            
            const linkElements = new Set<Element>();
            linkSelectors.forEach(selector => {
              try {
                document.querySelectorAll(selector).forEach(el => linkElements.add(el));
              } catch (e) {
                // 선택자 오류 무시
              }
            });
            
            const extractedLinks: Array<{ url: string, text: string }> = [];
            const seenUrls = new Set<string>();

            linkElements.forEach(link => {
              // href 속성 또는 data-href, data-link, data-url 속성 확인
              let href = link.getAttribute('href') || 
                        link.getAttribute('data-href') || 
                        link.getAttribute('data-link') || 
                        link.getAttribute('data-url');
              
              // onclick에서 URL 추출 시도
              if (!href) {
                const onclick = link.getAttribute('onclick');
                if (onclick) {
                  const urlMatch = onclick.match(/(?:location\.href|window\.open|location\.assign|router\.push|navigate)\s*\(?\s*['"]([^'"]+)['"]/);
                  if (urlMatch) href = urlMatch[1];
                }
              }
              
              // React Router나 Next.js 같은 클라이언트 사이드 라우팅 처리
              if (!href) {
                const onClick = (link as any).onclick;
                if (onClick) {
                  // 이벤트 리스너에서 URL 추출은 복잡하므로 일단 스킵
                }
              }
              
              if (!href) return;

              try {
                const fullUrl = new URL(href, window.location.href).href;
                const urlDomain = new URL(fullUrl).hostname;
                
                // 중복 제거
                const normalizedUrl = fullUrl.split('#')[0].split('?')[0];
                if (seenUrls.has(normalizedUrl)) return;
                seenUrls.add(normalizedUrl);
                
                // 도메인 필터링 (maxDepth 기반)
                const isSameDomain = urlDomain === baseDomain;
                let shouldInclude = false;
                
                if (maxDepth >= 4) {
                  // maxDepth 4: 모든 도메인 허용
                  shouldInclude = true;
                } else if (maxDepth >= 3) {
                  // maxDepth 3: 같은 도메인 또는 하위 도메인
                  shouldInclude = isSameDomain || urlDomain.endsWith(`.${baseDomain}`);
                } else {
                  // maxDepth 1-2: 정확히 같은 도메인만
                  shouldInclude = isSameDomain;
                }

                if (shouldInclude &&
                    fullUrl !== window.location.href &&
                    !fullUrl.includes('#') &&
                    !fullUrl.includes('javascript:') &&
                    !fullUrl.includes('mailto:')) {
                  
                  // 확장자 필터링 (브라우저 내부에서 미리 필터링)
                  try {
                    const urlObj = new URL(fullUrl);
                    const pathname = urlObj.pathname.toLowerCase();
                    
                    // 정적 리소스 확장자 제외
                    const excludedExtensions = [
                      '.css', '.js', '.json', '.xml', '.pdf',
                      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.webp',
                      '.woff', '.woff2', '.ttf', '.eot', '.otf',
                      '.mp4', '.mp3', '.avi', '.mov', '.wmv',
                      '.zip', '.tar', '.gz', '.rar'
                    ];
                    const hasExcludedExtension = excludedExtensions.some(ext => pathname.endsWith(ext));
                    if (hasExcludedExtension) return;
                    
                    // 정적 리소스 경로 제외
                    const staticResourcePaths = [
                      '/static/', '/_next/static/', '/assets/', '/dist/', '/build/', '/public/',
                      '/css/', '/js/', '/images/', '/img/', '/fonts/', '/media/',
                      '/vendor/', '/lib/', '/node_modules/'
                    ];
                    const isStaticResourcePath = staticResourcePaths.some(path => pathname.includes(path));
                    if (isStaticResourcePath) return;
                    
                    // API 엔드포인트 제외
                    if (pathname.startsWith('/api/') || 
                        pathname.includes('/graphql') || 
                        pathname.includes('/rest/') ||
                        pathname.includes('/ajax/') ||
                        pathname.includes('/endpoint/')) {
                      return;
                    }
                  } catch (e) {
                    // URL 파싱 실패 시 제외
                    return;
                  }
                  
                  // 텍스트 추출
                  let text = link.textContent?.trim() || '';
                  if (!text) {
                    text = link.getAttribute('title') || link.getAttribute('aria-label') || '';
                  }
                  if (!text && link.querySelector('img')) {
                    text = link.querySelector('img')?.getAttribute('alt') || '';
                  }
                  
                  extractedLinks.push({
                    url: fullUrl,
                    text: text.replace(/\s+/g, ' ').trim(),
                  });
                }
              } catch (e) {
                // URL 파싱 실패 시 무시
              }
            });

            // iframe 내부 링크도 추출
            try {
              const iframes = document.querySelectorAll('iframe');
              iframes.forEach(iframe => {
                try {
                  const iframeDoc = (iframe as HTMLIFrameElement).contentDocument || 
                                  ((iframe as HTMLIFrameElement).contentWindow as any)?.document;
                  if (iframeDoc) {
                    const iframeLinks = iframeDoc.querySelectorAll('a[href]');
                    iframeLinks.forEach((iframeLink: Element) => {
                      const iframeHref = iframeLink.getAttribute('href');
                      if (iframeHref) {
                        try {
                          const fullUrl = new URL(iframeHref, window.location.href).href;
                          const urlDomain = new URL(fullUrl).hostname;
                          const normalizedUrl = fullUrl.split('#')[0].split('?')[0];
                          
                          if (!seenUrls.has(normalizedUrl)) {
                            const isSameDomain = urlDomain === baseDomain;
                            let shouldInclude = false;
                            
                            if (maxDepth >= 4) {
                              shouldInclude = true;
                            } else if (maxDepth >= 3) {
                              shouldInclude = isSameDomain || urlDomain.endsWith(`.${baseDomain}`);
                            } else {
                              shouldInclude = isSameDomain;
                            }
                            
                            if (shouldInclude && 
                                fullUrl !== window.location.href &&
                                !fullUrl.includes('#') &&
                                !fullUrl.includes('javascript:') &&
                                !fullUrl.includes('mailto:')) {
                              seenUrls.add(normalizedUrl);
                              extractedLinks.push({
                                url: fullUrl,
                                text: iframeLink.textContent?.trim() || ''
                              });
                            }
                          }
                        } catch (e) {
                          // URL 파싱 실패 시 무시
                        }
                      }
                    });
                  }
                } catch (e) {
                  // iframe 접근 실패 (CORS 등) - 무시
                }
              });
            } catch (e) {
              // iframe 처리 실패 - 무시
            }
            
            return extractedLinks;
          }, baseDomain, config.maxDepth ?? 3, baseUrl);
          
          await page.close();
          console.log(`🔗 Puppeteer에서 발견된 링크: ${links.length}개`);
          if (links.length > 0) {
            console.log(`🔗 발견된 링크 샘플 (처음 5개):`, links.slice(0, 5).map(l => l.url));
          }
        } catch (error) {
          // Puppeteer 실패 시 HTML 파싱으로 폴백
          console.warn('⚠️ Puppeteer로 링크 추출 실패, HTML 파싱으로 폴백:', error);
          try {
            const response = await fetch(baseUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
            });
            if (response.ok) {
              const html = await response.text();
              links = extractLinks(html, baseUrl);
              console.log(`🔗 HTML 파싱에서 발견된 링크: ${links.length}개`);
            }
          } catch (fetchError) {
            console.warn('⚠️ fetch로 HTML 가져오기 실패:', fetchError);
          }
        }
      } else {
        // 브라우저가 없으면 fetch 사용
        const response = await fetch(baseUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        if (response.ok) {
          const html = await response.text();
          links = extractLinks(html, baseUrl);
          console.log(`🔗 HTML 파싱에서 발견된 링크: ${links.length}개`);
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      console.log(`🔗 총 발견된 링크: ${links.length}개`);
      if (links.length === 0) {
        console.warn(`⚠️ 링크가 발견되지 않았습니다. URL: ${baseUrl}`);
      }

      // 링크 필터링 및 정렬 (중요한 링크 우선)
      const filteredLinks = links
        .filter(link => {
          const normalizedUrl = normalizeUrl(link.url);
          
          try {
            const urlObj = new URL(normalizedUrl);
            const pathname = urlObj.pathname.toLowerCase();
            
            // 같은 URL 제외
            if (normalizedUrl === baseUrl || normalizedUrl === normalizeUrl(baseUrl)) {
              return false;
            }

            // 확장자 필터링 (정적 리소스 파일 제외)
            const excludedExtensions = [
              '.css', '.js', '.json', '.xml', '.pdf',
              '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.webp',
              '.woff', '.woff2', '.ttf', '.eot', '.otf',
              '.mp4', '.mp3', '.avi', '.mov', '.wmv',
              '.zip', '.tar', '.gz', '.rar',
              '.exe', '.dmg', '.deb', '.rpm'
            ];
            const hasExcludedExtension = excludedExtensions.some(ext => pathname.endsWith(ext));
            if (hasExcludedExtension) {
              return false;
            }

            // 정적 리소스 경로 필터링
            const staticResourcePaths = [
              '/static/', '/_next/static/', '/assets/', '/dist/', '/build/', '/public/',
              '/css/', '/js/', '/images/', '/img/', '/fonts/', '/media/',
              '/vendor/', '/lib/', '/node_modules/'
            ];
            const isStaticResourcePath = staticResourcePaths.some(path => pathname.includes(path));
            if (isStaticResourcePath) {
              return false;
            }

            // API 엔드포인트 제외 (일반적으로 문서가 아닌 데이터 엔드포인트)
            if (pathname.startsWith('/api/') || 
                pathname.includes('/graphql') || 
                pathname.includes('/rest/') ||
                pathname.includes('/ajax/') ||
                pathname.includes('/endpoint/')) {
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
          } catch (e) {
            // URL 파싱 실패 시 제외
            return false;
          }
        })
        // 우선순위 정렬: 텍스트가 있는 링크 > 깊이 낮은 링크 > 경로 짧은 링크
        .sort((a, b) => {
          const urlA = normalizeUrl(a.url);
          const urlB = normalizeUrl(b.url);
          const depthA = calculateDepth(baseUrl, urlA);
          const depthB = calculateDepth(baseUrl, urlB);
          
          // 1. 텍스트가 있는 링크 우선 (일반적으로 더 중요한 콘텐츠)
          if (a.text && !b.text) return -1;
          if (!a.text && b.text) return 1;
          
          // 2. 깊이가 낮은 링크 우선 (시드 URL에 가까운 페이지)
          if (depthA !== depthB) {
            return depthA - depthB;
          }
          
          // 3. 경로가 짧은 링크 우선 (일반적으로 더 중요한 페이지)
          try {
            const pathA = new URL(urlA).pathname;
            const pathB = new URL(urlB).pathname;
            const pathLengthA = pathA.split('/').filter(p => p).length;
            const pathLengthB = pathB.split('/').filter(p => p).length;
            if (pathLengthA !== pathLengthB) {
              return pathLengthA - pathLengthB;
            }
          } catch (e) {
            // URL 파싱 실패 시 무시
          }
          
          // 4. 쿼리 파라미터가 없는 링크 우선
          const hasQueryA = urlA.includes('?');
          const hasQueryB = urlB.includes('?');
          if (hasQueryA !== hasQueryB) {
            return hasQueryA ? 1 : -1;
          }
          
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

