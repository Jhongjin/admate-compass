/**
 * 크롤러 V2 타입 정의
 * 개선된 크롤링 시스템의 모든 타입 정의
 */

/**
 * 크롤링 옵션
 */
export interface CrawlOptions {
  /** 최대 탐색 깊이 (1-4) */
  maxDepth?: number;
  /**
   * 깊이 모드
   * - 'LIMITED': maxDepth 기반으로 깊이 제한 적용
   * - 'MAX': maxDepth 무시하고(깊이 제한 없음) 재귀적으로 링크를 계속 발견 (단, maxUrls/maxRecursivePages로 상한 적용)
   */
  depthMode?: 'LIMITED' | 'MAX';
  /** 최대 발견 URL 수 */
  maxUrls?: number;
  /** robots.txt 존중 여부 */
  respectRobots?: boolean;
  /** 도메인 제한 여부 */
  domainLimit?: boolean;
  /** 외부 도메인 허용 여부 */
  includeExternal?: boolean;
  /** 허용된 도메인 목록 */
  allowedDomains?: string[];
  /** 타임아웃 (ms) */
  timeout?: number;
  /** 하위 페이지 발견 여부 */
  discoverSubPages?: boolean;
  /** 하위 페이지 발견을 재귀적으로 수행할지 여부 (병렬 BFS). depthMode==='MAX'일 때 자동 true로 취급 가능 */
  recursiveDiscovery?: boolean;
  /** 재귀 탐색 시 최대 방문 페이지 수 (무한 루프/폭발 방지) */
  maxRecursivePages?: number;
  /** 벤더 정보 */
  vendor?: string;
  /** 사용자 에이전트 */
  userAgent?: string;
  /** 대기 시간 (ms) - 봇 탐지 우회용 */
  waitTime?: number;
  /** 캐시 사용 여부 */
  useCache?: boolean;
  /** 캐시 TTL (초) */
  cacheTTL?: number;
  /** 최대 재시도 횟수 */
  maxRetries?: number;
  /** 재시도 지연 시간 (ms) */
  retryDelay?: number;
  /** 병렬 처리 수 (배치 크롤링 시) */
  concurrency?: number;
  /** 메모리 모니터링 활성화 */
  enableMemoryMonitoring?: boolean;
  /** 입력된 URL의 첫 번째 서브디렉토리 경로 강제 (예: /ko/ 외 배제) */
  strictPathLimit?: boolean;
}

/**
 * 크롤링 결과
 */
export interface CrawlResult {
  /** 크롤링된 URL */
  url: string;
  /** 페이지 제목 */
  title: string;
  /** 추출된 콘텐츠 */
  content: string;
  /** 콘텐츠 길이 */
  contentLength: number;
  /** 문서 타입 */
  type: 'policy' | 'help' | 'guide' | 'general';
  /** 마지막 업데이트 시간 */
  lastUpdated: string;
  /** 발견된 하위 URL 목록 */
  discoveredUrls?: DiscoveredUrl[];
  /** 메타데이터 */
  metadata?: Record<string, any>;
  /** 크롤링 상태 */
  status: 'success' | 'failed' | 'partial';
  /** 에러 메시지 (실패 시) */
  error?: string;
}

/**
 * 발견된 URL 정보
 */
export interface DiscoveredUrl {
  /** URL */
  url: string;
  /** 제목 */
  title?: string;
  /** 발견 소스 */
  source: 'sitemap' | 'robots' | 'links' | 'pattern';
  /** 깊이 */
  depth: number;
  /** 부모 URL */
  parentUrl?: string;
  /** 경로 (seed부터 현재까지) */
  path?: string[];
  /** 우선순위 (sitemap의 경우) */
  priority?: number;
  /** 마지막 수정일 (sitemap의 경우) */
  lastModified?: string;
}

/**
 * 브라우저 설정
 */
export interface BrowserConfig {
  /** 헤드리스 모드 */
  headless?: boolean;
  /** 뷰포트 너비 */
  width?: number;
  /** 뷰포트 높이 */
  height?: number;
  /** 사용자 에이전트 */
  userAgent?: string;
  /** 추가 브라우저 인자 */
  args?: string[];
}

/**
 * 콘텐츠 추출 옵션
 */
export interface ContentExtractionOptions {
  /** 제목 추출 전략 */
  titleStrategy?: 'h1' | 'title' | 'og:title' | 'auto';
  /** 콘텐츠 선택자 */
  contentSelectors?: string[];
  /** 제거할 요소 선택자 */
  removeSelectors?: string[];
  /** 최소 콘텐츠 길이 */
  minContentLength?: number;
}

/**
 * 크롤링 진행 상황
 */
export interface CrawlProgress {
  /** 현재 URL */
  currentUrl: string;
  /** 전체 URL 수 */
  totalUrls: number;
  /** 완료된 URL 수 */
  completedUrls: number;
  /** 실패한 URL 수 */
  failedUrls: number;
  /** 진행률 (0-100) */
  progress: number;
  /** 현재 단계 */
  stage: 'discovering' | 'crawling' | 'processing' | 'completed';
  /** 메시지 */
  message?: string;
  /** 예상 남은 시간 (초) */
  estimatedTimeRemaining?: number;
  /** 평균 처리 시간 (초) */
  averageTimePerUrl?: number;
  /** 메모리 사용량 (MB) */
  memoryUsage?: number;
  /** 캐시 히트율 (%) */
  cacheHitRate?: number;
}

/**
 * 크롤링 작업 상태
 */
export type CrawlJobStatus =
  | 'pending'
  | 'discovering'
  | 'crawling'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * 크롤링 작업 정보
 */
export interface CrawlJob {
  /** 작업 ID */
  id: string;
  /** 작업 타입 */
  type: 'single' | 'batch' | 'template';
  /** 상태 */
  status: CrawlJobStatus;
  /** 시작 URL 목록 */
  urls: string[];
  /** 옵션 */
  options: CrawlOptions;
  /** 결과 */
  results?: CrawlResult[];
  /** 진행 상황 */
  progress?: CrawlProgress;
  /** 생성 시간 */
  createdAt: string;
  /** 업데이트 시간 */
  updatedAt: string;
  /** 완료 시간 */
  completedAt?: string;
  /** 에러 */
  error?: string;
}

/**
 * 사이트맵 항목
 */
export interface SitemapItem {
  /** URL */
  loc: string;
  /** 마지막 수정일 */
  lastmod?: string;
  /** 변경 빈도 */
  changefreq?: string;
  /** 우선순위 */
  priority?: number;
}

/**
 * Robots.txt 규칙
 */
export interface RobotsRule {
  /** 사용자 에이전트 */
  userAgent: string;
  /** 허용 경로 */
  allow: string[];
  /** 금지 경로 */
  disallow: string[];
  /** 크롤링 지연 (초) */
  crawlDelay?: number;
}








