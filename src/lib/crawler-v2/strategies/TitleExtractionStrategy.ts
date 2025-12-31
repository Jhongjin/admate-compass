/**
 * 제목 추출 전략 인터페이스
 * 각 벤더별로 독립적인 제목 추출 로직을 구현
 */

import { Page } from 'puppeteer-core';

export interface TitleExtractionResult {
  title: string | null;
  source: string;
  score?: number;
  debugInfo?: any;
}

export interface TitleExtractionStrategy {
  /**
   * 벤더 타입 반환
   */
  getVendorType(): string;

  /**
   * 이 전략이 적용 가능한지 확인
   * @param url 크롤링 대상 URL
   * @param page Puppeteer Page 객체
   */
  canHandle(url: string, page: Page): Promise<boolean>;

  /**
   * 제목 추출 실행
   * @param url 크롤링 대상 URL
   * @param page Puppeteer Page 객체
   * @returns 제목 추출 결과
   */
  extractTitle(url: string, page: Page): Promise<TitleExtractionResult>;
}

