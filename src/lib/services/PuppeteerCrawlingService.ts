/**
 * Puppeteer 기반 크롤링 서비스
 * Facebook/Instagram 등 JavaScript가 필요한 사이트 크롤링
 */

import puppeteerCore, { Browser, Page } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { DocumentIndexingService } from './DocumentIndexingService';

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
      console.log('🚀 Puppeteer 브라우저 초기화 중...');
      
      try {
        // Vercel 환경에서는 chromium을 사용
        const isVercel = process.env.VERCEL === '1';
        let executablePath: string | undefined;
        
        if (isVercel) {
          // Vercel 환경: @sparticuz/chromium 사용 (동적 크롤링 필수)
          try {
            // Chromium 바이너리 경로 가져오기
            // Vercel 서버리스 환경에서는 자동으로 Chromium 바이너리를 포함함
            const executablePath = await chromium.executablePath();
            console.log(`📁 Chromium 실행 경로: ${executablePath}`);
            
            // Chromium args에 필요한 시스템 라이브러리 경로 및 보안 옵션 추가
            // @sparticuz/chromium 최신 버전은 이미 필요한 라이브러리를 포함하고 있음
            const chromiumArgs = [
              ...chromium.args,
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--disable-software-rasterizer',
              '--disable-extensions',
              '--disable-background-networking',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-breakpad',
              '--disable-client-side-phishing-detection',
              '--disable-default-apps',
              '--disable-features=TranslateUI',
              '--disable-hang-monitor',
              '--disable-ipc-flooding-protection',
              '--disable-popup-blocking',
              '--disable-prompt-on-repost',
              '--disable-renderer-backgrounding',
              '--disable-sync',
              '--disable-translate',
              '--metrics-recording-only',
              '--no-first-run',
              '--safebrowsing-disable-auto-update',
              '--enable-automation',
              '--password-store=basic',
              '--use-mock-keychain',
              '--single-process',
            ];
            
            console.log(`🔧 Chromium args 개수: ${chromiumArgs.length}`);
            
            this.browser = await puppeteerCore.launch({
              args: chromiumArgs,
              defaultViewport: {
                width: 1280,
                height: 720,
              },
              executablePath: executablePath,
              headless: true,
            });
            console.log('✅ Puppeteer 브라우저 초기화 완료 (Vercel 환경: @sparticuz/chromium)');
          } catch (chromiumError: any) {
            console.error('❌ @sparticuz/chromium 초기화 실패:', chromiumError.message);
            console.error('❌ Chromium 에러 상세:', chromiumError);
            console.error('❌ 스택 트레이스:', chromiumError.stack);
            // 동적 크롤링이 필수이므로 에러를 throw
            throw new Error(`Chromium 초기화 실패: ${chromiumError.message}. 동적 크롤링을 사용할 수 없습니다. Vercel 빌드 설정을 확인해주세요.`);
          }
        } else {
          // 로컬 환경: 일반 Puppeteer 사용 (동적 크롤링 필수)
          this.browser = await puppeteerCore.launch({
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
          console.log('✅ Puppeteer 브라우저 초기화 완료 (로컬 환경)');
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

      // 실제 브라우저처럼 보이게 설정
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // 뷰포트 설정
      await page.setViewport({ width: 1920, height: 1080 });

      // 페이지 로드 시도 (에러 처리 강화)
      console.log(`📡 페이지 로드 시도: ${url}`);
      let response;
      try {
        response = await page.goto(url, { 
          waitUntil: 'networkidle2',
          timeout: 30000 
        });
      } catch (gotoError: any) {
        // "Navigating frame was detached" 또는 "Connection closed" 오류 처리
        if (gotoError.message?.includes('detached') || gotoError.message?.includes('Connection closed')) {
          console.warn('⚠️ 페이지 로드 중 연결 끊김, 재시도...');
          // 페이지 닫기 시도 (에러 무시)
          try {
            await page.close();
          } catch (closeError) {
            // 무시
          }
          // 브라우저 재초기화
          this.browser = null;
          await this.init();
          if (!this.browser) {
            throw new Error('브라우저 재초기화 실패');
          }
          browser = this.browser;
          // 새 페이지로 재시도
          page = await browser.newPage();
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          await page.setViewport({ width: 1920, height: 1080 });
          response = await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
          });
        } else {
          throw gotoError;
        }
      }

      if (!response) {
        console.error(`❌ 페이지 응답 없음: ${url}`);
        return null;
      }

      console.log(`📄 페이지 응답 상태: ${response.status()} - ${response.statusText()}`);

      if (!response.ok()) {
        console.error(`❌ 페이지 로드 실패: ${url} - HTTP ${response.status()}`);
        return null;
      }

      // 랜덤 대기 (봇 탐지 우회)
      const waitTime = Math.random() * 2000 + 1000;
      console.log(`⏳ 봇 탐지 우회 대기: ${Math.round(waitTime)}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // 제목 추출
      console.log(`📝 제목 추출 중...`);
      const titleResult = await page.evaluate(() => {
        const titleSelectors = [
          'h1',
          'title',
          '[data-testid="page-title"]',
          '.page-title',
          '.article-title'
        ];
        
        for (const selector of titleSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent?.trim()) {
            return element.textContent.trim();
          }
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

      // UTF-8 인코딩 보장
      content = await this.ensureUtf8Encoding(content);

      if (!content || content.length < 100) {
        console.warn(`⚠️ 콘텐츠 부족: ${url} - ${content.length}자`);
        return null;
      }

      // 하위 페이지 발견 (옵션이 활성화된 경우)
      let discoveredUrls: Array<{
        url: string;
        title?: string;
        source: 'sitemap' | 'robots' | 'links' | 'pattern';
        depth: number;
      }> = [];
      if (discoverSubPages) {
        try {
          console.log(`🔍 하위 페이지 발견 시작: ${url} (maxDepth: ${maxDepth})`);
          const { sitemapDiscoveryService } = await import('./SitemapDiscoveryService');
          
          // 성공했던 버전: discoverSubPages 사용 (depth 1만 찾고, 재귀적으로 depth 처리)
          const discovered = await sitemapDiscoveryService.discoverSubPages(url, {
            maxDepth: 1, // 첫 번째 레벨만 찾기
            maxUrls: maxDepth >= 3 ? 50 : 20, // depth 3 이상이면 더 많이 찾기
            respectRobotsTxt: true,
            includeExternal: false,
            allowedDomains: [this.extractDomain(url)]
          }, undefined); // preloadedHtml은 사용하지 않음
          
          // depth 1로 설정 (discoverSubPages는 depth를 반환하지 않으므로 수동 설정)
          discoveredUrls = discovered.map(d => ({
            url: d.url,
            title: d.title,
            source: d.source || 'links',
            depth: 1 // 첫 번째 레벨은 항상 depth 1
          }));
          
          // maxDepth가 2 이상이면, 발견된 URL들에서 다시 링크 찾기 (depth 2)
          if (maxDepth >= 2 && discoveredUrls.length > 0) {
            const depth2Urls: Array<{
              url: string;
              title?: string;
              source: 'sitemap' | 'robots' | 'links' | 'pattern';
              depth: number;
            }> = [];
            
            // depth 2 찾기 (최대 10개만)
            for (const depth1Url of discoveredUrls.slice(0, 10)) {
              try {
                const depth2Discovered = await sitemapDiscoveryService.discoverSubPages(depth1Url.url, {
                  maxDepth: 1,
                  maxUrls: 5,
                  respectRobotsTxt: true,
                  includeExternal: false,
                  allowedDomains: [this.extractDomain(url)]
                });
                
                depth2Discovered.forEach(d => {
                  // 중복 체크
                  if (!discoveredUrls.some(existing => existing.url === d.url)) {
                    depth2Urls.push({
                      url: d.url,
                      title: d.title,
                      source: d.source || 'links',
                      depth: 2
                    });
                  }
                });
              } catch (error) {
                console.error(`❌ Depth 2 탐색 실패: ${depth1Url.url}`, error);
              }
            }
            
            discoveredUrls.push(...depth2Urls);
          }
          
          // maxDepth가 3 이상이면, depth 3 이상은 discoveredUrls에 포함하여 모달에서 선택하도록 함
          // (실제 depth 3 탐색은 하지 않고, depth 2까지만 자동으로 찾음)
          
          console.log(`✅ 발견된 하위 페이지: ${discoveredUrls.length}개 (depth 1: ${discoveredUrls.filter(d => d.depth === 1).length}개, depth 2: ${discoveredUrls.filter(d => d.depth === 2).length}개)`);
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
