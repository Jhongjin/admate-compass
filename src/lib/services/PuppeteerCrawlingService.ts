/**
 * Puppeteer 기반 크롤링 서비스
 * Facebook/Instagram 등 JavaScript가 필요한 사이트 크롤링
 */

import puppeteerCore, { Browser, Page, HTTPResponse } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { DocumentIndexingService } from './DocumentIndexingService';
import fs from 'fs';
import path from 'path';

export interface CrawledDocumentData {
  id: string;
  url: string;
  title: string;
  content: string;
  type: 'policy' | 'help' | 'guide' | 'general';
  lastUpdated: string;
  contentLength: number;
  discoveredUrls?: Array<{
    url: string;
    title?: string;
    source: 'sitemap' | 'robots' | 'links' | 'pattern';
    depth: number;
  }>;
  error?: string;
}

export class PuppeteerCrawlingService {
  private browser: Browser | null = null;
  private documentIndexingService: DocumentIndexingService;

  constructor() {
    this.documentIndexingService = new DocumentIndexingService();
  }

  /**
   * 통합된 텍스트 인코딩 처리 함수
   */
  private async ensureUtf8Encoding(text: string): Promise<string> {
    try {
      // 통합된 인코딩 처리 유틸리티 사용
      const { processTextEncoding } = await import('../utils/textEncoding');
      const result = processTextEncoding(text, {
        strictMode: true,
        preserveOriginal: false
      });

      console.log(`🔧 URL 텍스트 인코딩 처리:`, {
        originalLength: text.length,
        cleanedLength: result.cleanedText.length,
        encoding: result.encoding,
        hasIssues: result.hasIssues,
        issues: result.issues
      });

      return result.cleanedText;
    } catch (error) {
      console.warn('⚠️ 통합 인코딩 처리 실패, 기본 처리 사용:', error);
      // 기본 처리로 폴백
      return text.replace(/\0/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    }
  }

  /**
   * 허용된 Meta URL 목록
   */
  getMetaUrls(): string[] {
    return [
      // Meta/Facebook/Instagram 공식 문서만 포함
      'https://www.facebook.com/policies/ads/',
      'https://developers.facebook.com/docs/marketing-api/',
      'https://business.instagram.com/help/',
      'https://www.facebook.com/business/help/',
      'https://www.facebook.com/business/help/164749007013531',

      // 추가 Meta 공식 문서들
      'https://www.facebook.com/policies/ads/prohibited_content/',
      'https://www.facebook.com/policies/ads/restricted_content/',
      'https://developers.facebook.com/docs/marketing-api/overview/',
      'https://business.instagram.com/help/instagram-business/',

      // Facebook Help 추가
      'https://www.facebook.com/help/',
    ];
  }

  /**
   * URL 허용 여부 확인
   */
  private isAllowedUrl(url: string): boolean {
    const allowedDomains = [
      'facebook.com',
      'business.facebook.com',
      'developers.facebook.com',
      'business.instagram.com',
      'help.instagram.com'
    ];

    try {
      const urlObj = new URL(url);
      return allowedDomains.some(domain =>
        urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`)
      );
    } catch (e) {
      return false;
    }
  }

  /**
   * 문서 타입 결정
   */
  private determineDocumentType(url: string): 'policy' | 'help' | 'guide' | 'general' {
    if (url.includes('/policies/')) return 'policy';
    if (url.includes('/help/')) return 'help';
    if (url.includes('/docs/')) return 'guide';
    return 'general';
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

  async init(): Promise<void> {
    if (!this.browser) {
      console.log('🚀 Puppeteer 브라우저 초기화 중... (Version: 2024-03-18-V2)');

      try {
        // Vercel 환경인지 확인
        // VERCEL=1 이 있어도 실제 환경이 Windows이면 로컬 브라우저 선호
        const isWindows = process.platform === 'win32';
        const vercelEnv = process.env.VERCEL;
        const isVercel = vercelEnv === '1' && !isWindows;

        console.log(`🔍 [DIAGNOSTIC] OS Platform: ${process.platform}`);
        console.log(`🔍 [DIAGNOSTIC] VERCEL Env: ${vercelEnv}`);
        console.log(`🔍 [DIAGNOSTIC] Is Vercel Detection: ${isVercel}`);
        console.log(`🔍 [DIAGNOSTIC] Is Windows: ${isWindows}`);

        let executablePath: string | undefined;

        if (isVercel) {
          console.log('🚀 [DIAGNOSTIC] Using VERCEL mode (Linux/sparticuz-chromium)');
          // Vercel 서버리스 환경 (Linux): @sparticuz/chromium 사용
          try {
            executablePath = await chromium.executablePath();
            console.log(`📁 Vercel Chromium 실행 경로: ${executablePath}`);

            const chromiumArgs = [
              ...chromium.args,
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--disable-blink-features=AutomationControlled',
              '--disable-web-security',
            ];

            this.browser = await puppeteerCore.launch({
              args: chromiumArgs,
              defaultViewport: { width: 1280, height: 720 },
              executablePath: executablePath,
              headless: true,
            });
            console.log('✅ Puppeteer 브라우저 초기화 완료 (@sparticuz/chromium)');
          } catch (chromiumError: any) {
            console.error('❌ @sparticuz/chromium 초기화 실패:', chromiumError.message);
            throw new Error(`Chromium 초기화 실패: ${chromiumError.message}. Vercel 설정을 확인해주세요.`);
          }
        } else {
          // 로컬 환경 (Windows/Mac/Linux): 시스템 브라우저 사용
          console.log(`💻 로컬 환경 브라우저 검색 중 (Platform: ${process.platform})...`);

          if (isWindows) {
            const winPaths = [
              'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
              'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
              'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
              'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            ];

            console.log(`🔍 [DIAGNOSTIC] Checking Windows paths: ${winPaths.length} locations`);
            for (const p of winPaths) {
              const exists = fs.existsSync(p);
              console.log(`🔍 [DIAGNOSTIC] Path: ${p} - Exists: ${exists}`);
              if (exists) {
                executablePath = p;
                break;
              }
            }
          } else if (process.platform === 'darwin') {
            const macPaths = [
              '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            ];
            for (const p of macPaths) {
              if (fs.existsSync(p)) {
                executablePath = p;
                break;
              }
            }
          }

          if (!executablePath) {
            console.warn('⚠️ 시스템 브라우저를 찾을 수 없습니다. puppeteer-core가 기본 경로를 시도합니다.');
          } else {
            console.log(`✅ 브라우저 발견: ${executablePath}`);
          }

          console.log(`🚀 [DIAGNOSTIC] Launching with executablePath: ${executablePath || 'default'}`);
          this.browser = await puppeteerCore.launch({
            executablePath: executablePath,
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-blink-features=AutomationControlled',
              '--disable-web-security',
            ],
          });
          console.log(`✅ Puppeteer 브라우저 초기화 완료 (로컬 환경: ${executablePath || 'default'})`);
        }
      } catch (error: any) {
        console.error('❌ Puppeteer 브라우저 초기화 실패:', error.message);
        throw error;
      }
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Puppeteer 브라우저 종료');
    }
  }

  async crawlMetaPage(url: string, discoverSubPages: boolean = false, skipUrlCheck: boolean = false, maxDepth: number = 2): Promise<CrawledDocumentData | null> {
    // URL 필터링 적용 (skipUrlCheck가 true이면 체크 건너뛰기)
    if (!skipUrlCheck && !this.isAllowedUrl(url)) {
      console.log(`🚫 크롤링 차단: ${url}`);
      return null;
    }

    // 브라우저 초기화 시도 (동적 크롤링 필수)
    if (!this.browser) {
      await this.init(); // 실패 시 에러 throw
    }

    // 브라우저가 여전히 null이면 크롤링 불가
    if (!this.browser) {
      throw new Error('Puppeteer 브라우저를 사용할 수 없습니다. 동적 크롤링이 필수입니다.');
    }

    // 브라우저 연결 상태 확인 및 재초기화
    let browser: Browser = this.browser!;
    try {
      const pages = await browser.pages();
      // 연결 테스트
      await browser.version();
    } catch (browserError) {
      console.warn('⚠️ 브라우저 연결 끊김 감지, 재초기화 시도...');
      this.browser = null;
      await this.init();
      if (!this.browser) {
        throw new Error('브라우저 재초기화 실패');
      }
      browser = this.browser;
    }

    let page: Page;
    try {
      page = await browser.newPage();
    } catch (pageError) {
      console.warn('⚠️ 새 페이지 생성 실패, 브라우저 재초기화 시도...');
      this.browser = null;
      await this.init();
      if (!this.browser) {
        throw new Error('브라우저 재초기화 실패');
      }
      browser = this.browser;
      page = await browser.newPage();
    }

    try {
      console.log(`🔍 Meta 페이지 크롤링 시작: ${url}`);

      // 실제 브라우저처럼 보이게 설정 (Chrome 131 - Windows)
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
      await page.setUserAgent(userAgent);

      // ✅ Stealth: navigator.webdriver 프로퍼티 삭제
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });
      });

      // 뷰포트 설정
      await page.setViewport({ width: 1920, height: 1080 });

      // 🔥 Stealth: 추가 헤더 설정 (리얼 유저 흉내)
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-User': '?1',
        'Sec-Fetch-Dest': 'document'
      });

      // 페이지 로드 시도 (Meta 전용 backoff + 모바일 fallback + 긴 타임아웃)
      console.log(`📡 페이지 로드 시도: ${url}`);
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      let response: HTTPResponse | null = null;

      const isMetaDomain = url.includes('facebook.com') || url.includes('instagram.com');
      const waitUntilOption = isMetaDomain ? 'domcontentloaded' : 'networkidle2'; // Meta는 domcontentloaded 후 특정 요소 대기로 변경
      const timeoutMs = isMetaDomain ? 60000 : 60000; // 타임아웃 현실화
      const backoff = [5000, 10000]; // 리트라이 간격 조정

      const toMobileUrl = (targetUrl: string) => {
        try {
          const u = new URL(targetUrl);
          if (u.hostname.startsWith('www.facebook.com')) u.hostname = 'm.facebook.com';
          else if (u.hostname === 'facebook.com') u.hostname = 'm.facebook.com';
          else if (u.hostname.endsWith('instagram.com') && !u.hostname.startsWith('m.')) u.hostname = 'm.instagram.com';
          return u.toString();
        } catch {
          return targetUrl;
        }
      };

      const visitWithRetries = async (targetUrl: string) => {
        for (let attempt = 0; attempt < backoff.length; attempt++) {
          try {
            response = await page.goto(targetUrl, { waitUntil: waitUntilOption, timeout: timeoutMs });
            const status = response?.status() || 0;

            if ([401, 403, 429].includes(status)) {
              console.warn(`⚠️ 상태코드 ${status} - 백오프 후 재시도 (${attempt + 1}/${backoff.length})`);
              await sleep(backoff[attempt]);
              continue;
            }

            if (!response || !response.ok()) {
              console.warn(`⚠️ 응답 실패(${status}), 재시도 (${attempt + 1}/${backoff.length})`);
              await sleep(backoff[attempt]);
              continue;
            }

            return;
          } catch (navError: any) {
            const msg = navError.message || String(navError);
            console.warn(`⚠️ 네비게이션 오류 (${attempt + 1}/${backoff.length}): ${msg}`);
            await sleep(backoff[attempt]);
            if (attempt === backoff.length - 1) {
              throw navError;
            }
          }
        }
      };

      // 1차: 원본 URL
      await visitWithRetries(url);

      // 2차: 모바일 도메인 fallback (Meta 전용)
      const isResponseOk = (res: HTTPResponse | null) => !!res && res.ok();

      if (!isResponseOk(response) && isMetaDomain) {
        const mobileUrl = toMobileUrl(url);
        if (mobileUrl !== url) {
          console.warn(`⚠️ 모바일 도메인으로 재시도: ${mobileUrl}`);
          await page.close().catch(() => { });
          page = await browser.newPage();
          await page.setUserAgent(userAgent);
          await page.setViewport({ width: 1920, height: 1080 });
          await visitWithRetries(mobileUrl);
        }
      }

      if (!response) {
        console.error(`❌ 페이지 응답 없음: ${url}`);
        return null;
      }

      const finalResponse = response as HTTPResponse;

      console.log(`📄 페이지 응답 상태: ${finalResponse.status()} - ${finalResponse.statusText()}`);

      // 🔥 실제 페이지 URL 확인 (리다이렉트 여부 확인)
      const actualUrl = page.url();
      console.log(`🔍 실제 페이지 URL: ${actualUrl} (원본: ${url})`);
      if (actualUrl !== url) {
        console.warn(`⚠️ URL 리다이렉트 감지: ${url} → ${actualUrl}`);
      }

      if (!finalResponse.ok()) {
        console.error(`❌ 페이지 로드 실패: ${url} - HTTP ${finalResponse.status()}`);
        return null;
      }

      // 봇 탐지 우회 대기
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 🔥 핵심 콘텐츠 로드 대기 (Meta Ads Guide 특화)
      if (isMetaDomain) {
        console.log(`⏳ Meta 핵심 콘텐츠 요소 대기...`);
        try {
          await page.waitForSelector('main, article, .content, [role="main"]', { timeout: 15000 });
        } catch (e) {
          console.warn('⚠️ 핵심 콘텐츠 요소 대기 타임아웃, 계속 진행함');
        }
      }

      // 🔥 쿠키 배너 클릭 시도 (공용 selector)
      try {
        const cookieBannerSelectors = [
          'button[id*="cookie"]',
          'button[class*="cookie"]',
          'button[id*="accept"]',
          'button[class*="accept"]',
          '[data-testid*="cookie"]',
          '[data-testid*="accept"]',
          '#cookie-banner button',
          '.cookie-banner button',
        ];

        let cookieClicked = false;

        // CSS selector 시도
        for (const selector of cookieBannerSelectors) {
          if (cookieClicked) break;
          try {
            const cookieButton = await page.$(selector);
            if (cookieButton) {
              const isVisible = await cookieButton.evaluate((el) => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
              });

              if (isVisible) {
                await cookieButton.click();
                console.log(`✅ 쿠키 배너 클릭 성공: ${selector}`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // 클릭 후 대기
                cookieClicked = true;
                break; // 성공 시 종료
              }
            }
          } catch (selectorError) {
            // selector 실패 시 다음 selector 시도
            continue;
          }
        }

        // 텍스트 기반 selector 시도 - CSS selector로 실패한 경우에만
        if (!cookieClicked) {
          try {
            const clicked = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
              const acceptTexts = ['Accept', '수락', '동의', 'accept', 'ACCEPT'];

              for (const btn of buttons) {
                const text = btn.textContent?.toLowerCase() || '';
                if (acceptTexts.some(acceptText => text.includes(acceptText.toLowerCase()))) {
                  const style = window.getComputedStyle(btn);
                  const isVisible = style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0';

                  if (isVisible) {
                    (btn as HTMLElement).click();
                    return true;
                  }
                }
              }
              return false;
            });

            if (clicked) {
              console.log(`✅ 쿠키 배너 클릭 성공 (텍스트 기반)`);
              await new Promise(resolve => setTimeout(resolve, 1000)); // 클릭 후 대기
              cookieClicked = true;
            }
          } catch (textError) {
            // 텍스트 기반 클릭 실패 시 무시하고 계속 진행
          }
        }
      } catch (cookieError) {
        console.warn('⚠️ 쿠키 배너 클릭 실패 (무시하고 계속 진행):', cookieError);
      }

      // 🔥 Facebook/Instagram 페이지의 경우 추가 대기 및 스크롤 (JavaScript 콘텐츠 로드 유도)
      if (url.includes('facebook.com') || url.includes('instagram.com')) {
        console.log(`⏳ Facebook/Instagram 페이지 추가 대기 및 스크롤...`);

        // 🔥 로그인 페이지 감지 (URL 또는 페이지 내용 확인)
        const currentUrl = page.url();
        const isLoginPage = currentUrl.includes('/login') ||
          currentUrl.includes('/signin') ||
          currentUrl.includes('facebook.com/login') ||
          currentUrl.includes('instagram.com/accounts/login');

        if (isLoginPage) {
          console.warn(`⚠️ 로그인 페이지로 리다이렉트됨: ${currentUrl}`);
          // 로그인 페이지에서도 메타 정보나 기본 콘텐츠는 추출 가능하므로 계속 진행
        }

        // 추가 대기 (JavaScript 콘텐츠 로드 시간 확보) - 5초로 증가
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 🔥 특정 요소가 로드될 때까지 대기 (Facebook 페이지의 메인 콘텐츠 영역)
        try {
          await page.waitForSelector('main, article, [role="main"], .content, body', { timeout: 10000 }).catch(() => {
            console.warn('⚠️ 메인 콘텐츠 영역 대기 타임아웃 (계속 진행)');
          });
        } catch (waitError) {
          console.warn('⚠️ 요소 대기 실패 (계속 진행):', waitError);
        }

        // 스크롤을 통해 콘텐츠 로드 유도 (Lazy loading 콘텐츠 활성화)
        try {
          await page.evaluate(async () => {
            await new Promise<void>((resolve) => {
              let totalHeight = 0;
              const distance = 200; // 스크롤 거리 증가
              const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                // 최대 3000px 스크롤 또는 페이지 끝까지
                if (totalHeight >= scrollHeight || totalHeight >= 3000) {
                  clearInterval(timer);
                  resolve();
                }
              }, 150); // 스크롤 간격 증가
            });
          });
          console.log(`✅ 스크롤 완료, 추가 대기...`);
          // 스크롤 후 추가 대기 (콘텐츠 로드 시간) - 3초로 증가
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (scrollError) {
          console.warn(`⚠️ 스크롤 실패 (무시):`, scrollError);
        }
      }

      // 제목 추출 (우선순위: h1 > title > og:title > data-testid > class 기반 > pathname)
      console.log(`📝 제목 추출 중...`);
      const titleResult = await page.evaluate(() => {
        // 1. h1 태그 (가장 우선)
        const h1Element = document.querySelector('h1');
        if (h1Element && h1Element.textContent?.trim()) {
          return h1Element.textContent.trim();
        }

        // 2. title 태그
        const titleElement = document.querySelector('title');
        if (titleElement && titleElement.textContent?.trim()) {
          return titleElement.textContent.trim();
        }

        // 3. og:title 메타 태그
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.getAttribute('content')?.trim()) {
          return ogTitle.getAttribute('content')!.trim();
        }

        // 4. data-testid 기반
        const dataTestIdTitle = document.querySelector('[data-testid="page-title"]');
        if (dataTestIdTitle && dataTestIdTitle.textContent?.trim()) {
          return dataTestIdTitle.textContent.trim();
        }

        // 5. 클래스 기반 셀렉터들
        const classSelectors = [
          '.page-title',
          '.article-title',
          '.post-title',
          '.entry-title',
          'h1.page-title',
          'h1.article-title',
          '.content-title',
          '.main-title'
        ];
        for (const selector of classSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent?.trim()) {
            return element.textContent.trim();
          }
        }

        // 6. URL pathname에서 추출 (마지막 경로)
        try {
          const urlPath = window.location.pathname;
          if (urlPath && urlPath !== '/') {
            const pathParts = urlPath.split('/').filter(p => p);
            if (pathParts.length > 0) {
              const lastPart = pathParts[pathParts.length - 1];
              // URL 인코딩된 한글 디코딩 시도
              try {
                return decodeURIComponent(lastPart).replace(/[-_]/g, ' ');
              } catch {
                return lastPart.replace(/[-_]/g, ' ');
              }
            }
          }
        } catch (e) {
          // URL 파싱 실패 시 무시
        }

        return null;
      });
      let title: string | null = titleResult as string | null;

      console.log(`📝 추출된 제목: ${title || '없음'}`);

      // 제목 UTF-8 인코딩 보장
      if (title) {
        title = await this.ensureUtf8Encoding(title);
      }

      // 콘텐츠 추출
      console.log(`📄 콘텐츠 추출 중...`);
      const contentResult = await page.evaluate(() => {
        // 불필요한 요소 제거
        const elementsToRemove = document.querySelectorAll('script, style, nav, footer, header, aside');
        elementsToRemove.forEach(el => el.remove());

        // 콘텐츠 영역 찾기
        const contentSelectors = [
          'main',
          'article',
          '.content',
          '.main-content',
          '[role="main"]',
          '.page-content'
        ];

        let contentElement = null;
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            contentElement = element;
            break;
          }
        }

        if (!contentElement) {
          contentElement = document.body;
        }

        if (contentElement) {
          // 위키백과 관련 링크 제거
          const wikiLinks = contentElement.querySelectorAll('a[href*="wikipedia"], a[href*="wiki"]');
          wikiLinks.forEach(link => link.remove());

          const text = contentElement.textContent || '';
          return text.replace(/\s+/g, ' ').trim();
        }

        return '';
      });
      let content: string = contentResult as string;

      console.log(`📄 추출된 콘텐츠 길이: ${content.length}자`);

      // 🔥 콘텐츠 미리보기 로깅 (디버깅용)
      if (content.length > 0) {
        const preview = content.substring(0, 500);
        console.log(`📄 콘텐츠 미리보기 (처음 500자):`, preview);
      } else {
        console.warn(`⚠️ 추출된 콘텐츠가 비어있습니다.`);
      }

      // UTF-8 인코딩 보장
      content = await this.ensureUtf8Encoding(content);

      // 🔥 Facebook/Instagram 페이지의 경우 콘텐츠 길이 기준 완화 (로그인 페이지에서도 일부 콘텐츠 추출 가능)
      const minContentLength = (url.includes('facebook.com') || url.includes('instagram.com')) ? 30 : 100; // 50자에서 30자로 더 완화

      if (!content || content.length < minContentLength) {
        console.warn(`⚠️ 콘텐츠 부족: ${url} - ${content.length}자 (최소 요구: ${minContentLength}자)`);

        // 🔥 Facebook/Instagram 페이지의 경우 로그인 페이지에서도 링크나 메타 정보는 추출 가능
        if (url.includes('facebook.com') || url.includes('instagram.com')) {
          console.log(`⚠️ Facebook/Instagram 페이지: 링크, 메타 정보, 모든 텍스트 추출 시도...`);

          // 🔥 더 공격적인 콘텐츠 추출 (로그인 페이지에서도 가능한 모든 정보)
          const enhancedContent = await page.evaluate(() => {
            // 모든 텍스트 추출 (body 전체)
            const allText = document.body.textContent || '';

            // 모든 링크 추출
            const links = Array.from(document.querySelectorAll('a[href]'));
            const linkTexts = links
              .map(link => {
                const href = link.getAttribute('href');
                const text = link.textContent?.trim() || '';
                if (href) {
                  // 상대 경로를 절대 경로로 변환
                  try {
                    const absoluteUrl = new URL(href, window.location.href).href;
                    return `${text || '링크'}: ${absoluteUrl}`;
                  } catch {
                    return href.startsWith('http') ? `${text || '링크'}: ${href}` : null;
                  }
                }
                return null;
              })
              .filter(Boolean)
              .join('\n');

            // 메타 정보 추출
            const metaTags = Array.from(document.querySelectorAll('meta[name], meta[property]'));
            const metaInfo = metaTags
              .map(meta => {
                const name = meta.getAttribute('name') || meta.getAttribute('property');
                const content = meta.getAttribute('content');
                return name && content ? `${name}: ${content}` : null;
              })
              .filter(Boolean)
              .join('\n');

            // 제목 정보
            const title = document.title || '';

            return {
              allText: allText.replace(/\s+/g, ' ').trim(),
              links: linkTexts,
              meta: metaInfo,
              title: title
            };
          });

          // 추출된 정보를 결합
          const parts: string[] = [];
          if (enhancedContent.allText && enhancedContent.allText.length > 0) {
            parts.push(enhancedContent.allText);
          }
          if (enhancedContent.title && enhancedContent.title.length > 0) {
            parts.push(`제목: ${enhancedContent.title}`);
          }
          if (enhancedContent.meta && enhancedContent.meta.length > 0) {
            parts.push(`메타 정보:\n${enhancedContent.meta}`);
          }
          if (enhancedContent.links && enhancedContent.links.length > 0) {
            parts.push(`발견된 링크:\n${enhancedContent.links}`);
          }

          if (parts.length > 0) {
            content = parts.join('\n\n');
            console.log(`✅ 향상된 콘텐츠 추출 완료: ${content.length}자`);
          }
        }

        // 최종 콘텐츠 길이 확인 (Facebook/Instagram은 30자 이상이면 허용)
        if (!content || content.length < minContentLength) {
          console.error(`❌ 최종 콘텐츠 부족: ${url} - ${content?.length || 0}자 (최소 요구: ${minContentLength}자)`);
          console.error(`❌ 최종 콘텐츠 미리보기:`, content?.substring(0, 500) || 'N/A');
          console.error(`❌ 페이지 URL 확인:`, page.url());
          console.error(`❌ 페이지 제목:`, title || '없음');

          // 🔥 페이지가 로그인 페이지인지 확인
          const pageInfo = await page.evaluate(() => {
            const bodyText = document.body.textContent || '';
            const loginIndicators = [
              '로그인',
              'login',
              'sign in',
              '계정',
              'account',
              'password',
              '비밀번호'
            ];
            const isLoginPage = loginIndicators.some(indicator =>
              bodyText.toLowerCase().includes(indicator.toLowerCase())
            ) && bodyText.length < 500;

            // 페이지의 모든 링크 추출
            const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
              href: a.getAttribute('href'),
              text: a.textContent?.trim() || ''
            })).filter(l => l.href && l.href.startsWith('http'));

            return {
              isLoginPage,
              bodyTextLength: bodyText.length,
              bodyTextPreview: bodyText.substring(0, 300),
              linksCount: links.length,
              links: links.slice(0, 10) // 처음 10개만
            };
          });

          console.error(`❌ 페이지 분석 결과:`, JSON.stringify(pageInfo, null, 2));

          // 🔥 콘텐츠가 부족하더라도 링크가 있으면 최소한의 정보로 처리 시도
          if (pageInfo.linksCount > 0 && content && content.length >= 10) {
            console.warn(`⚠️ 콘텐츠가 부족하지만 링크가 ${pageInfo.linksCount}개 발견됨. 최소 정보로 처리 시도...`);
            // 최소한의 콘텐츠라도 반환 (링크 정보 포함)
            const enhancedContent = content + '\n\n발견된 링크:\n' + pageInfo.links.map(l => `${l.text}: ${l.href}`).join('\n');
            return {
              id: `crawled_${Date.now()}`,
              url: actualUrl || url,
              type: 'general' as const,
              lastUpdated: new Date().toISOString(),
              contentLength: enhancedContent.length,
              content: enhancedContent,
              title: title || 'Facebook Business'
            };
          }

          return null;
        }
      }

      // 하위 페이지 발견 (옵션이 활성화된 경우)
      let discoveredUrls: Array<{
        url: string;
        title?: string;
        source: 'sitemap' | 'robots' | 'links' | 'pattern';
        depth: number;
        parentUrl?: string;
        path?: string[];
      }> = [];
      if (discoverSubPages) {
        try {
          console.log(`🔍 하위 페이지 발견 시작: ${url} (maxDepth: ${maxDepth})`);
          const { sitemapDiscoveryService } = await import('./SitemapDiscoveryService');

          // maxDepth에 따른 필터링 옵션 설정
          // maxDepth 1-2: 정확히 같은 도메인만 허용
          // maxDepth 3: 같은 도메인 + 하위 도메인 허용
          // maxDepth 4: 모든 도메인 허용 (includeExternal: true)
          const baseDomain = this.extractDomain(url);
          let discoveryOptions: any;

          if (maxDepth >= 4) {
            // maxDepth 4: 모든 도메인 허용
            discoveryOptions = {
              maxDepth: maxDepth,
              maxUrls: 200,
              respectRobotsTxt: true,
              includeExternal: true, // 모든 외부 도메인 허용
              allowedDomains: undefined // allowedDomains 제한 없음
            };
            console.log(`🔍 maxDepth 4 모드: 모든 도메인 허용 (includeExternal: true)`);
          } else if (maxDepth >= 3) {
            // maxDepth 3: 같은 도메인 + 하위 도메인 허용
            discoveryOptions = {
              maxDepth: maxDepth,
              maxUrls: 150,
              respectRobotsTxt: true,
              includeExternal: false,
              allowedDomains: [baseDomain] // 하위 도메인은 isValidUrl에서 체크
            };
            console.log(`🔍 maxDepth 3 모드: 같은 도메인 + 하위 도메인 허용`);
          } else {
            // maxDepth 1-2: 정확히 같은 도메인만 허용
            discoveryOptions = {
              maxDepth: maxDepth,
              maxUrls: maxDepth >= 2 ? 50 : 20,
              respectRobotsTxt: true,
              includeExternal: false,
              allowedDomains: [baseDomain]
            };
            console.log(`🔍 maxDepth ${maxDepth} 모드: 정확히 같은 도메인만 허용`);
          }

          const discovered = await sitemapDiscoveryService.discoverSubPages(url, discoveryOptions, undefined);

          // depth 설정: maxDepth에 따라 depth 분배
          if (maxDepth >= 3) {
            const depth2Quota = Math.floor(discovered.length * 0.3); // 30%를 depth 2로
            discoveredUrls = discovered.map((d, index) => ({
              url: d.url,
              title: d.title,
              source: d.source || 'links',
              depth: index < depth2Quota ? 2 : 3,
              path: [url, d.url]
            }));

            const depth2Count = discoveredUrls.filter(d => d.depth === 2).length;
            const depth3Count = discoveredUrls.filter(d => d.depth >= 3).length;
            console.log(`✅ maxDepth ${maxDepth} 탐색 완료: ${discoveredUrls.length}개 발견 (depth 2: ${depth2Count}개, depth ≥3: ${depth3Count}개)`);
          } else {
            discoveredUrls = discovered.map((d) => ({
              url: d.url,
              title: d.title,
              source: d.source || 'links',
              depth: maxDepth >= 2 ? 2 : 1,
              path: [url, d.url]
            }));

            console.log(`✅ maxDepth ${maxDepth} 탐색 완료: ${discoveredUrls.length}개 발견 (depth: ${maxDepth >= 2 ? 2 : 1})`);
          }
        } catch (error) {
          console.error('❌ 하위 페이지 발견 실패:', error);
        }
      }

      const crawledDocument: CrawledDocumentData = {
        id: `crawled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: title || url,
        content,
        url,
        type: this.determineDocumentType(url),
        lastUpdated: new Date().toISOString(),
        contentLength: content.length,
        discoveredUrls: discoveredUrls.length > 0 ? discoveredUrls : undefined
      };

      console.log(`✅ Meta 페이지 크롤링 성공: ${url} - ${content.length}자`);

      return crawledDocument;

    } catch (error) {
      console.error(`❌ Meta 페이지 크롤링 실패: ${url}`, error);
      // 브라우저 연결 오류인 경우 재초기화
      if (error instanceof Error && (
        error.message.includes('Connection closed') ||
        error.message.includes('detached') ||
        error.message.includes('Target closed')
      )) {
        console.warn('⚠️ 브라우저 연결 오류 감지, 재초기화...');
        this.browser = null;
      }
      return null;
    } finally {
      // 페이지 닫기 (에러 처리 강화)
      if (page) {
        try {
          await page.close();
        } catch (closeError: any) {
          // "Connection closed" 오류는 무시 (이미 연결이 끊어진 상태)
          if (!closeError.message?.includes('Connection closed') && !closeError.message?.includes('Target closed')) {
            console.error('페이지 닫기 실패:', closeError);
          }
        }
      }
    }
  }


  async crawlAllMetaDocuments(): Promise<CrawledDocumentData[]> {
    const urls = [
      'https://ko-kr.facebook.com/business',
      'https://business.instagram.com/help/ko/',
      'https://www.facebook.com/help/',
      'https://www.facebook.com/business/help/',
      'https://business.instagram.com/help/',
      'https://developers.facebook.com/docs/marketing-api'
    ];

    const documents: CrawledDocumentData[] = [];

    console.log(`Meta 문서 크롤링 시작: ${urls.length}개 URL`);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      try {
        const document = await this.crawlMetaPage(url);
        if (document) {
          documents.push(document);
          console.log(`✅ 성공 (${i + 1}/${urls.length}): ${document.title}`);

          // 크롤링 성공 시 즉시 인덱싱 시도
          try {
            console.log(`📚 인덱싱 시작: ${document.title}`);

            // 메타데이터 생성
            const metadata = {
              source: document.url,
              title: document.title,
              type: document.type,
              lastUpdated: document.lastUpdated,
              contentLength: document.contentLength,
              crawledAt: new Date().toISOString()
            };

            console.log(`🔄 인덱싱 시작: ${document.title}`);
            await this.documentIndexingService.indexCrawledContent(
              document.url,
              document.content,
              document.title,
              metadata
            );
            console.log(`✅ 인덱싱 완료: ${document.title}`);
          } catch (indexError) {
            console.error(`❌ 인덱싱 실패: ${document.title}`, indexError);
          }
        } else {
          console.log(`❌ 실패 (${i + 1}/${urls.length}): ${url}`);
        }
      } catch (error) {
        console.error(`❌ 크롤링 오류 (${i + 1}/${urls.length}): ${url}`, error);
      }

      // 요청 간격 (서버 부하 방지)
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`🎯 Meta 문서 크롤링 완료: ${documents.length}개 성공`);
    return documents;
  }
}

export const puppeteerCrawlingService = new PuppeteerCrawlingService();
