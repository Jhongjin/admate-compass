# Pagination 자동 감지 및 크롤링 기능 구현 계획

## 요구사항 분석

### 현재 상황
- `ads.naver.com`을 maxDepth Max로 크롤링해도 전체 페이지가 크롤링되지 않음
- `https://ads.naver.com/help/faq?categorySeq=136` 같은 페이지를 하나씩 수동으로 크롤링 중
- 각 카테고리 페이지에는 pagination이 존재 (예: 1~35페이지)

### 원하는 기능
1. **부모 페이지 등록**: `https://ads.naver.com/help/faq?categorySeq=136` 같은 부모 페이지를 등록
2. **Pagination 자동 감지**: 해당 페이지에서 pagination 요소를 찾아 마지막 페이지 번호 추출
3. **자동 URL 생성**: 각 페이지의 URL을 자동으로 생성 (예: `?categorySeq=136&page=2`, `?categorySeq=136&page=3` ...)
4. **각 페이지 크롤링**: 생성된 각 페이지를 크롤링 (하위 페이지의 하위 페이지는 제외)

## 구현 계획

### 1. Pagination 감지 유틸리티 생성

**파일**: `src/lib/crawler-v2/utils/pagination-utils.ts`

```typescript
export interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  pageUrlPattern: string; // 예: "?categorySeq=136&page={page}"
  baseUrl: string;
}

/**
 * 페이지에서 pagination 정보 추출
 */
export async function detectPagination(
  page: Page,
  baseUrl: string
): Promise<PaginationInfo | null> {
  // 1. Pagination 요소 찾기
  // - "이전 페이지 1 2 3 4 5 다음 페이지" 같은 패턴
  // - 마지막 페이지 번호 추출
  
  // 2. URL 패턴 분석
  // - 현재 URL의 쿼리 파라미터 확인
  // - page, p, pageNum 등의 파라미터 패턴 감지
  
  // 3. PaginationInfo 반환
}
```

### 2. Naver Ads FAQ Pagination 전략

**파일**: `src/lib/crawler-v2/strategies/NaverAdsPaginationStrategy.ts`

```typescript
export class NaverAdsPaginationStrategy {
  /**
   * Naver Ads FAQ 페이지의 pagination 감지
   * 
   * 예상 패턴:
   * - URL: https://ads.naver.com/help/faq?categorySeq=136
   * - Pagination: "이전 페이지 1 2 3 4 5 다음 페이지" 또는 "1/35"
   * - URL 패턴: ?categorySeq=136&page=2 또는 ?categorySeq=136&p=2
   */
  async detectPagination(page: Page, url: string): Promise<PaginationInfo | null> {
    // Naver Ads FAQ 특화 pagination 감지 로직
  }
  
  /**
   * 페이지 URL 목록 생성
   */
  generatePageUrls(baseUrl: string, totalPages: number): string[] {
    // 1~totalPages까지의 URL 생성
  }
}
```

### 3. UrlDiscovery에 Pagination 지원 추가

**파일**: `src/lib/crawler-v2/discovery/UrlDiscovery.ts`

```typescript
export class UrlDiscovery {
  /**
   * Pagination 기반 하위 페이지 발견
   * 
   * @param baseUrl 부모 페이지 URL (예: https://ads.naver.com/help/faq?categorySeq=136)
   * @param options 크롤링 옵션
   * @returns 발견된 페이지 URL 목록
   */
  async discoverPaginationPages(
    baseUrl: string,
    options: Partial<CrawlOptions> = {}
  ): Promise<DiscoveredUrl[]> {
    // 1. 부모 페이지 크롤링
    // 2. Pagination 감지
    // 3. 각 페이지 URL 생성
    // 4. DiscoveredUrl 배열 반환
  }
}
```

### 4. 크롤러 엔진에 Pagination 모드 추가

**파일**: `src/lib/crawler-v2/core/CrawlerEngine.ts`

```typescript
export class CrawlerEngine {
  /**
   * Pagination 모드 크롤링
   * 
   * @param baseUrl 부모 페이지 URL
   * @param options 크롤링 옵션
   */
  async crawlWithPagination(
    baseUrl: string,
    options: Partial<CrawlOptions> = {}
  ): Promise<CrawlResult[]> {
    // 1. Pagination 페이지 발견
    // 2. 각 페이지 크롤링 (병렬 처리)
    // 3. 결과 반환
  }
}
```

### 5. API 엔드포인트 수정

**파일**: `src/app/api/crawler-v2/crawl/route.ts`

```typescript
// 새로운 옵션 추가
interface CrawlRequest {
  urls: string[];
  maxDepth?: number | 'MAX';
  discoverSubPages?: boolean;
  paginationMode?: boolean; // 새로 추가
  // ...
}

// paginationMode가 true일 때
if (paginationMode) {
  // Pagination 기반 크롤링 실행
  results = await crawlerEngine.crawlWithPagination(url, options);
}
```

## 구현 단계

### Phase 1: Pagination 감지 로직 구현
1. `pagination-utils.ts` 생성
2. 기본 pagination 패턴 감지 (숫자, "이전/다음" 버튼 등)
3. Naver Ads FAQ 특화 전략 구현

### Phase 2: URL 생성 로직 구현
1. URL 패턴 분석 (쿼리 파라미터 추출)
2. 페이지 번호별 URL 생성 함수
3. URL 유효성 검증

### Phase 3: 크롤러 통합
1. `UrlDiscovery`에 pagination 메서드 추가
2. `CrawlerEngine`에 pagination 모드 추가
3. API 엔드포인트 수정

### Phase 4: UI 개선
1. 크롤링 UI에 "Pagination 모드" 옵션 추가
2. 부모 페이지만 입력하면 자동으로 모든 페이지 크롤링

## 예상 동작

### 입력
```
URL: https://ads.naver.com/help/faq?categorySeq=136
옵션: paginationMode: true
```

### 처리 과정
1. 부모 페이지 크롤링: `https://ads.naver.com/help/faq?categorySeq=136`
2. Pagination 감지: "1/35" 또는 "이전 페이지 1 2 3 4 5 다음 페이지" 발견
3. 마지막 페이지 번호 추출: 35
4. URL 패턴 분석: `?categorySeq=136&page={page}` 또는 `?categorySeq=136&p={page}`
5. URL 생성:
   - `https://ads.naver.com/help/faq?categorySeq=136&page=1`
   - `https://ads.naver.com/help/faq?categorySeq=136&page=2`
   - ...
   - `https://ads.naver.com/help/faq?categorySeq=136&page=35`
6. 각 페이지 크롤링 (병렬 처리)

### 출력
- 35개의 크롤링 결과 반환
- 각 결과는 해당 페이지의 제목과 콘텐츠 포함

## 기술적 고려사항

### 1. Pagination 패턴 다양성
- 숫자 기반: "1 2 3 4 5"
- 범위 표시: "1/35", "Page 1 of 35"
- 버튼 기반: "이전 페이지", "다음 페이지"
- 무한 스크롤: JavaScript로 동적 로드

### 2. URL 패턴 다양성
- 쿼리 파라미터: `?page=2`, `?p=2`, `?pageNum=2`
- 경로 기반: `/page/2`, `/2`
- 조합: `?categorySeq=136&page=2`

### 3. 성능 최적화
- 병렬 크롤링: 여러 페이지 동시 처리
- 캐싱: 이미 크롤링한 페이지는 재사용
- 배치 처리: 너무 많은 페이지는 배치로 나눠 처리

## 테스트 시나리오

1. **기본 Pagination 감지**
   - `https://ads.naver.com/help/faq?categorySeq=136` 입력
   - 35개 페이지 자동 발견 및 크롤링 확인

2. **다양한 Pagination 패턴**
   - 다른 카테고리 페이지 테스트
   - 다양한 URL 패턴 테스트

3. **에러 처리**
   - Pagination이 없는 페이지 처리
   - 잘못된 URL 패턴 처리
   - 네트워크 오류 처리

## 다음 단계

1. 사용자 확인 후 구현 시작
2. Phase 1부터 순차적으로 구현
3. 각 단계별 테스트 및 검증
4. UI 통합 및 배포

