# 크롤링 코드 현재 상태 스냅샷

## 📅 기록 일자
2025-12-31

## ⚠️ 중요 참고사항
**이전에 크롤링 관련 코드 개선 시 URL 크롤링이 멈추는 현상이 발생했기 때문에, 개선 작업 전 현재 상태를 상세히 기록합니다.**

---

## 📁 파일 구조

```
src/lib/crawler-v2/
├── core/
│   ├── BrowserManager.ts      # 브라우저 인스턴스 관리
│   ├── ContentExtractor.ts     # 콘텐츠 추출 (제목, 본문)
│   └── CrawlerEngine.ts        # 메인 크롤링 로직
├── discovery/
│   ├── SitemapParser.ts        # 사이트맵 파싱
│   └── UrlDiscovery.ts         # 하위 페이지 발견
├── strategies/
│   ├── TitleStrategyManager.ts # 제목 추출 전략 관리자
│   ├── NaverAdsFAQTitleStrategy.ts
│   └── DefaultTitleStrategy.ts
├── utils/
│   ├── CacheManager.ts         # 캐시 관리
│   ├── MemoryMonitor.ts        # 메모리 모니터링
│   ├── RetryManager.ts         # 재시도 로직
│   └── url-utils.ts            # URL 유틸리티
└── types/
    └── index.ts                 # 타입 정의

src/app/api/
├── crawler-v2/crawl/route.ts   # 크롤링 API 엔드포인트
└── admin/save-crawled-content/route.ts  # 크롤링 결과 저장
```

---

## 🔍 주요 컴포넌트 상세

### 1. CrawlerEngine.ts (메인 크롤링 로직)

#### 핵심 메서드
- `crawlUrl(url, options)`: 단일 URL 크롤링
- `crawlUrls(urls, options, onProgress)`: 배치 크롤링 (병렬 처리)
- `performCrawl(url, config)`: 실제 크롤링 수행

#### 현재 동작 방식
1. **캐시 확인**: `cacheManager.get()` - 24시간 TTL
2. **메모리 모니터링**: `memoryMonitor.checkMemory()`
3. **재시도 로직**: `retryManager.retry()` - 최대 3회
4. **브라우저 초기화**: `browserManager.initialize()`
5. **페이지 로드**: `page.goto()` - `networkidle2` 대기
6. **스크롤**: 3000px까지 스크롤하여 lazy loading 콘텐츠 활성화
7. **대기 시간**:
   - 일반 페이지: 2초
   - Naver Ads: 8초
   - FAQ 페이지: 추가 10초 DOM 안정화 대기
8. **콘텐츠 추출**: `contentExtractor.extractFromPage()`
9. **하위 페이지 발견**: `urlDiscovery.discoverSubPages()` (옵션)
10. **캐시 저장**: `cacheManager.set()`

#### 병렬 처리
- 기본 병렬 처리 수: 3개 (`concurrency: 3`)
- 배치 단위로 순차 처리 (배치 내부는 병렬)
- 배치 간 메모리 정리

#### 타임아웃 설정
- 기본 타임아웃: 30초
- 페이지 로드: `networkidle2` 대기
- FAQ 페이지 DOM 안정화: 10초

#### 에러 처리
- 페이지 닫기 실패 시 "Connection closed", "Target closed" 오류 무시
- 재시도 로직으로 일시적 오류 처리
- 실패 시 빈 결과 반환 (크롤링 중단 방지)

---

### 2. ContentExtractor.ts (콘텐츠 추출)

#### 핵심 메서드
- `extractFromPage(page, url, options)`: 페이지에서 제목과 본문 추출
- `extractTitle(page, html, strategy, url)`: 제목 추출
- `extractContent(page, html, config)`: 본문 추출

#### 제목 추출 전략
1. **벤더별 전략** (우선순위 1)
   - `titleStrategyManager.extractTitle()` 호출
   - Naver Ads FAQ: `NaverAdsFAQTitleStrategy` 사용
   - 실패 시 기본 전략으로 fallback

2. **기존 로직** (fallback)
   - FAQ 페이지: 3초 초기 대기 + 20초 제목 로드 대기
   - 일반 페이지: `waitForPageStabilization()` 사용
   - Naver Ads: 8초 대기 + 3초 추가 대기

#### 본문 추출
- 선택자: `['main', 'article', '.content', '.main-content', '[role="main"]', '.page-content']`
- 제거 선택자: `['script', 'style', 'nav', 'footer', 'header', 'aside']`
- 최소 콘텐츠 길이: 100자

---

### 3. BrowserManager.ts (브라우저 관리)

#### 싱글톤 패턴
- 전역 단일 브라우저 인스턴스 관리
- 초기화 중 중복 요청 방지 (`isInitializing` 플래그)

#### 환경별 처리
- **Vercel**: `@sparticuz/chromium` 사용
- **로컬**: Chrome 실행 파일 자동 탐지

#### 브라우저 설정
- User Agent: Chrome 120.0.0.0
- Viewport: 1920x1080
- Vercel: `--single-process` 모드

#### 에러 처리
- 브라우저 연결 끊김 감지 및 재초기화
- 페이지 생성 실패 시 브라우저 재초기화

---

### 4. UrlDiscovery.ts (하위 페이지 발견)

#### 두 가지 모드
1. **LIMITED 모드** (기본)
   - 사이트맵에서 URL 발견
   - 페이지 링크에서 URL 발견
   - 필터링 및 정렬

2. **MAX 모드** (재귀적)
   - BFS 방식으로 재귀적 탐색
   - 무한 루프 방지: `visited` Set + `maxUrls` + `maxRecursivePages`

#### 필터링
- 도메인 제한 (`domainLimit`)
- robots.txt 준수 (`respectRobots`)
- 최대 URL 수 제한 (`maxUrls`)

---

### 5. API 엔드포인트: `/api/crawler-v2/crawl`

#### 요청 형식
```typescript
POST /api/crawler-v2/crawl
{
  urls: string[],
  options: {
    maxDepth?: number,
    discoverSubPages?: boolean,
    timeout?: number,
    concurrency?: number,
    // ... 기타 옵션
  }
}
```

#### 응답 형식
- **스트리밍 응답**: `application/x-ndjson`
- 진행률 정보 실시간 전송
- 최종 결과 포함

#### 타임아웃
- API 타임아웃: 300초 (5분)
- `maxDuration: 300`

---

## 🔄 크롤링 플로우

### 단일 URL 크롤링 플로우
```
1. 캐시 확인
   ↓ (캐시 없음)
2. 메모리 모니터링
   ↓
3. 재시도 로직 시작
   ↓
4. 브라우저 초기화
   ↓
5. 페이지 생성
   ↓
6. page.goto() (networkidle2 대기)
   ↓
7. 스크롤 (lazy loading 활성화)
   ↓
8. 대기 (페이지 타입별 차등)
   ↓
9. 제목 추출 (벤더별 전략 → fallback)
   ↓
10. 본문 추출
   ↓
11. 하위 페이지 발견 (옵션)
   ↓
12. 캐시 저장
   ↓
13. 결과 반환
```

### 배치 크롤링 플로우
```
1. URL 목록을 배치로 분할 (concurrency 개씩)
   ↓
2. 각 배치 순차 처리
   ├─ 배치 내부: 병렬 처리
   └─ 배치 간: 메모리 정리
   ↓
3. 진행률 실시간 전송
   ↓
4. 최종 결과 반환
```

---

## ⚠️ 현재 알려진 이슈 및 주의사항

### 1. 크롤링 멈춤 현상
- **발생 시점**: 코드 개선 후
- **증상**: URL 크롤링이 중간에 멈춤
- **가능한 원인**:
  - 타임아웃 설정 부족
  - 브라우저 인스턴스 누수
  - 메모리 부족
  - 페이지 닫기 실패로 인한 리소스 누수

### 2. FAQ 페이지 제목 추출
- **현재 상태**: 벤더별 전략으로 처리 중
- **대기 시간**: 총 18초 (3초 초기 + 10초 DOM 안정화 + 5초 추가)
- **주의**: 대기 시간이 길어 크롤링 시간 증가

### 3. 병렬 처리
- **현재 설정**: 3개 동시 처리
- **주의**: 메모리 사용량 증가 가능
- **메모리 모니터링**: 활성화됨

### 4. 캐시 관리
- **TTL**: 24시간
- **주의**: 오래된 캐시로 인한 문제 가능

---

## 📊 현재 설정값

### 타임아웃
- 페이지 로드: 30초
- FAQ DOM 안정화: 10초
- API 전체: 300초

### 대기 시간
- 일반 페이지: 2초
- Naver Ads: 8초
- FAQ 페이지: 추가 5초

### 병렬 처리
- 기본 병렬 수: 3개
- 배치 간 간격: 2초

### 재시도
- 최대 재시도: 3회
- 재시도 지연: 1초

### 캐시
- TTL: 24시간
- 기본 활성화: true

---

## 🔧 개선 작업 시 주의사항

### 1. 크롤링 멈춤 방지
- ✅ 타임아웃 설정 유지 또는 강화
- ✅ 브라우저 인스턴스 정리 확인
- ✅ 페이지 닫기 에러 처리 유지
- ✅ 메모리 모니터링 유지

### 2. 기존 동작 보장
- ✅ 캐시 시스템 유지
- ✅ 재시도 로직 유지
- ✅ 병렬 처리 유지
- ✅ 진행률 전송 유지

### 3. 테스트 필수
- ✅ 단일 URL 크롤링 테스트
- ✅ 배치 크롤링 테스트
- ✅ FAQ 페이지 크롤링 테스트
- ✅ 타임아웃 상황 테스트

---

## 📝 개선 작업 전 체크리스트

- [ ] 현재 코드 백업 완료
- [ ] 현재 동작 상태 확인
- [ ] 테스트 시나리오 준비
- [ ] 롤백 계획 수립
- [ ] 변경 사항 문서화

---

## 🔗 관련 파일 경로

### 핵심 파일
- `src/lib/crawler-v2/core/CrawlerEngine.ts`
- `src/lib/crawler-v2/core/ContentExtractor.ts`
- `src/lib/crawler-v2/core/BrowserManager.ts`
- `src/lib/crawler-v2/discovery/UrlDiscovery.ts`
- `src/app/api/crawler-v2/crawl/route.ts`

### 유틸리티
- `src/lib/crawler-v2/utils/CacheManager.ts`
- `src/lib/crawler-v2/utils/MemoryMonitor.ts`
- `src/lib/crawler-v2/utils/RetryManager.ts`

### 전략
- `src/lib/crawler-v2/strategies/TitleStrategyManager.ts`
- `src/lib/crawler-v2/strategies/NaverAdsFAQTitleStrategy.ts`

---

## 📌 다음 단계

1. **현재 상태 기록 완료** ✅
2. **개선 작업 시작** (이 문서 참조하여 기존 동작 보장)
3. **테스트 및 검증**
4. **문제 발생 시 즉시 롤백**

