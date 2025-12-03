/**
 * 브라우저 관리자
 * Puppeteer 브라우저 인스턴스의 생명주기 관리
 */

import puppeteerCore, { Browser, Page } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { existsSync } from 'fs';
import { join } from 'path';
import type { BrowserConfig } from '../types';

export class BrowserManager {
  private browser: Browser | null = null;
  private isInitializing = false;
  private initPromise: Promise<Browser> | null = null;

  /**
   * 브라우저 초기화
   */
  async initialize(config: BrowserConfig = {}): Promise<Browser> {
    // 이미 초기화 중이면 기다림
    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    // 이미 초기화되어 있으면 반환
    if (this.browser) {
      try {
        // 연결 상태 확인
        await this.browser.version();
        return this.browser;
      } catch {
        // 연결이 끊어진 경우 재초기화
        this.browser = null;
      }
    }

    this.isInitializing = true;
    this.initPromise = this.doInitialize(config);
    
    try {
      this.browser = await this.initPromise;
      return this.browser;
    } finally {
      this.isInitializing = false;
      this.initPromise = null;
    }
  }

  /**
   * Chrome 실행 파일 경로 찾기
   */
  private findChromeExecutable(): string | null {
    // 1. 환경 변수에서 확인
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
    if (envPath && existsSync(envPath)) {
      return envPath;
    }

    // 2. Windows 일반 경로 확인
    if (process.platform === 'win32') {
      const windowsPaths: string[] = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ];

      // 사용자별 설치 경로
      if (process.env.LOCALAPPDATA) {
        windowsPaths.push(join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      }

      // Program Files 경로
      if (process.env.PROGRAMFILES) {
        windowsPaths.push(join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      }

      // Program Files (x86) 경로
      if (process.env['PROGRAMFILES(X86)']) {
        windowsPaths.push(join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'));
      }

      for (const path of windowsPaths) {
        if (path && existsSync(path)) {
          return path;
        }
      }
    }

    // 3. macOS 경로 확인
    if (process.platform === 'darwin') {
      const macPaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      ];

      for (const path of macPaths) {
        if (existsSync(path)) {
          return path;
        }
      }
    }

    // 4. Linux 경로 확인
    if (process.platform === 'linux') {
      const linuxPaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ];

      for (const path of linuxPaths) {
        if (existsSync(path)) {
          return path;
        }
      }
    }

    return null;
  }

  /**
   * 실제 초기화 로직
   */
  private async doInitialize(config: BrowserConfig): Promise<Browser> {
    const isVercel = process.env.VERCEL === '1';
    const headless = config.headless !== false;
    const width = config.width || 1920;
    const height = config.height || 1080;

    console.log(`🔧 브라우저 초기화 시작 (환경: ${isVercel ? 'Vercel' : '로컬'}, 헤드리스: ${headless})`);

    try {
      if (isVercel) {
        // Vercel 환경: @sparticuz/chromium 사용
        const executablePath = await chromium.executablePath();
        
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

        this.browser = await puppeteerCore.launch({
          args: chromiumArgs,
          defaultViewport: { width, height },
          executablePath,
          headless,
        });

        console.log('✅ 브라우저 초기화 완료 (Vercel 환경)');
      } else {
        // 로컬 환경: 개발/테스트 목적이므로 간단한 안내만 제공
        // 실제 프로덕션은 Vercel에서 실행되므로 로컬 Chrome 설정은 선택사항
        const isWindows = process.platform === 'win32';
        
        // 실행 파일 경로 찾기 시도
        const executablePath = this.findChromeExecutable();
        
        if (!executablePath || !existsSync(executablePath)) {
          // 로컬 환경에서 Chrome을 찾을 수 없는 경우 안내 메시지
          const errorMessage = 
            '⚠️ 로컬 환경에서 Chrome을 찾을 수 없습니다.\n\n' +
            '📌 참고사항:\n' +
            '• 실제 프로덕션 환경(Vercel)에서는 자동으로 Chromium이 제공됩니다.\n' +
            '• 로컬 테스트가 필요한 경우:\n' +
            '  1. Chrome 브라우저를 설치하거나\n' +
            '  2. 환경 변수 PUPPETEER_EXECUTABLE_PATH에 Chrome 경로를 설정하세요\n' +
            '  3. 또는 Vercel에 배포하여 테스트하세요 (권장)\n\n' +
            '🔗 Vercel 배포 후 테스트:\n' +
            '• Vercel에 배포하면 자동으로 Chromium이 제공됩니다\n' +
            '• 배포 후 https://your-app.vercel.app/test/crawler-v2 에서 테스트하세요';
          
          throw new Error(errorMessage);
        }

        // Chrome을 찾은 경우에만 실행 시도
        const defaultArgs = [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          ...(isWindows ? ['--disable-gpu', '--disable-software-rasterizer'] : []),
        ];

        const launchOptions: any = {
          headless,
          args: config.args || defaultArgs,
          ignoreDefaultArgs: ['--enable-automation'],
          executablePath,
          defaultViewport: { width, height },
        };

        console.log(`🔧 로컬 환경: Chrome 실행 파일 경로: ${executablePath}`);

        try {
          this.browser = await puppeteerCore.launch(launchOptions);
          console.log('✅ 브라우저 초기화 완료 (로컬 환경)');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(
            `로컬 환경에서 Chrome 실행 실패: ${errorMessage}\n\n` +
            '💡 해결 방법:\n' +
            '• Vercel에 배포하여 테스트하는 것을 권장합니다 (자동 Chromium 제공)\n' +
            '• 로컬 테스트가 필요한 경우 Chrome 설치 및 환경 변수 설정을 확인하세요'
          );
        }

        console.log(`✅ 브라우저 초기화 완료 (로컬 환경, 경로: ${executablePath})`);
      }

      return this.browser;
    } catch (error) {
      console.error('❌ 브라우저 초기화 실패:', error);
      
      // 더 자세한 에러 메시지 제공
      let errorMessage = '브라우저 초기화 실패';
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // Windows에서 흔한 에러에 대한 해결 방법 제시
        if (errorMessage.includes('Failed to launch') || errorMessage.includes('Code: 1')) {
          const executablePath = this.findChromeExecutable();
          errorMessage += `\n\n해결 방법:\n`;
          errorMessage += `1. Chrome이 올바르게 설치되어 있는지 확인하세요.\n`;
          if (executablePath) {
            errorMessage += `2. 발견된 Chrome 경로: ${executablePath}\n`;
            errorMessage += `3. 해당 경로의 파일이 존재하고 실행 가능한지 확인하세요.\n`;
          } else {
            errorMessage += `2. Chrome 실행 파일을 찾을 수 없습니다.\n`;
            errorMessage += `3. 환경 변수 PUPPETEER_EXECUTABLE_PATH에 Chrome 경로를 설정하세요.\n`;
          }
          errorMessage += `4. Windows 방화벽이나 안티바이러스가 Chrome 실행을 차단하지 않는지 확인하세요.\n`;
          errorMessage += `5. 관리자 권한으로 실행해보세요.\n`;
        }
      } else {
        errorMessage = String(error);
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * 새 페이지 생성
   */
  async createPage(): Promise<Page> {
    if (!this.browser) {
      throw new Error('브라우저가 초기화되지 않았습니다.');
    }

    try {
      const page = await this.browser.newPage();
      
      // 기본 설정
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1920, height: 1080 });

      return page;
    } catch (error) {
      // 페이지 생성 실패 시 브라우저 재초기화 시도
      console.warn('⚠️ 페이지 생성 실패, 브라우저 재초기화 시도...');
      this.browser = null;
      await this.initialize();
      
      // 재초기화 후 브라우저 확인
      if (!this.browser) {
        throw new Error('브라우저 재초기화 실패');
      }
      
      const page = await this.browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
      await page.setViewport({ width: 1920, height: 1080 });
      
      return page;
    }
  }

  /**
   * 브라우저 종료
   */
  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        console.log('🔒 브라우저 종료 완료');
      } catch (error) {
        console.warn('⚠️ 브라우저 종료 중 오류:', error);
      } finally {
        this.browser = null;
      }
    }
  }

  /**
   * 브라우저 상태 확인
   */
  async isHealthy(): Promise<boolean> {
    if (!this.browser) {
      return false;
    }

    try {
      await this.browser.version();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 브라우저 인스턴스 가져오기
   */
  getBrowser(): Browser | null {
    return this.browser;
  }
}

// 싱글톤 인스턴스
export const browserManager = new BrowserManager();

