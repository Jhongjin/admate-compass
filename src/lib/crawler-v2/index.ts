/**
 * 크롤러 V2 메인 엔트리 포인트
 * 개선된 크롤링 시스템의 통합 인터페이스
 */

export { crawlerEngine } from './core/CrawlerEngine';
export { browserManager } from './core/BrowserManager';
export { contentExtractor } from './core/ContentExtractor';
export { urlDiscovery } from './discovery/UrlDiscovery';
export { sitemapParser } from './discovery/SitemapParser';

export type {
  CrawlOptions,
  CrawlResult,
  DiscoveredUrl,
  BrowserConfig,
  ContentExtractionOptions,
  CrawlProgress,
  CrawlJobStatus,
  CrawlJob,
  SitemapItem,
  RobotsRule,
} from './types';



