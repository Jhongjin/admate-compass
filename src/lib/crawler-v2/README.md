# 크롤러 V2

개선된 크롤링 시스템입니다. 기존 크롤링 코드와 완전히 분리된 새로운 구조로 설계되었습니다.

## 주요 개선 사항

### 1. 아키텍처 개선
- **모듈화**: 각 기능이 명확히 분리된 모듈 구조
- **단일 책임 원칙**: 각 클래스가 하나의 명확한 역할만 수행
- **의존성 관리**: 순환 의존성 제거, 명확한 의존성 방향

### 2. 브라우저 관리 개선
- **싱글톤 패턴**: 브라우저 인스턴스 재사용으로 성능 향상
- **자동 재연결**: 연결 끊김 시 자동으로 재초기화
- **상태 관리**: 브라우저 상태를 명확히 추적

### 3. 에러 처리 개선
- **일관된 에러 처리**: 모든 모듈에서 동일한 에러 처리 전략
- **명확한 에러 메시지**: 디버깅이 쉬운 에러 메시지
- **폴백 메커니즘**: Puppeteer 실패 시 fetch로 자동 폴백

### 4. 코드 품질 개선
- **타입 안정성**: 모든 타입이 명확히 정의됨
- **로깅 정리**: 불필요한 로그 제거, 필요한 로그만 유지
- **코드 중복 제거**: 공통 로직을 유틸리티로 분리

## 폴더 구조

```
src/lib/crawler-v2/
├── core/                    # 핵심 크롤링 로직
│   ├── BrowserManager.ts    # 브라우저 생명주기 관리
│   ├── ContentExtractor.ts  # 콘텐츠 추출
│   └── CrawlerEngine.ts     # 메인 크롤러 엔진
├── discovery/               # URL 발견 로직
│   ├── SitemapParser.ts     # 사이트맵 파싱
│   └── UrlDiscovery.ts      # URL 발견 서비스
├── types/                   # 타입 정의
│   └── index.ts
├── utils/                   # 유틸리티 함수
│   ├── url-utils.ts         # URL 관련 유틸리티
│   └── html-utils.ts        # HTML 관련 유틸리티
├── index.ts                 # 메인 엔트리 포인트
└── README.md                # 이 파일
```

## 사용 방법

### 기본 사용법

```typescript
import { crawlerEngine } from '@/lib/crawler-v2';

// 단일 URL 크롤링
const result = await crawlerEngine.crawlUrl('https://example.com', {
  discoverSubPages: false,
  timeout: 30000,
});

// 여러 URL 배치 크롤링
const results = await crawlerEngine.crawlUrls([
  'https://example.com',
  'https://example.org',
], {
  discoverSubPages: true,
  maxDepth: 2,
  maxUrls: 50,
});

// 브라우저 정리
await crawlerEngine.cleanup();
```

### API 사용법

```typescript
// POST /api/crawler-v2/crawl
const response = await fetch('/api/crawler-v2/crawl', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    urls: ['https://example.com'],
    options: {
      discoverSubPages: true,
      maxDepth: 2,
      maxUrls: 50,
      respectRobots: true,
      domainLimit: true,
      timeout: 30000,
      waitTime: 1000,
    },
  }),
});

const data = await response.json();
```

## 주요 기능

### 1. URL 크롤링
- Puppeteer 기반 동적 크롤링
- 자동 브라우저 관리 및 재연결
- 봇 탐지 우회 (랜덤 대기 시간)

### 2. 콘텐츠 추출
- 다양한 제목 추출 전략 (h1, title, og:title, auto)
- 스마트 콘텐츠 영역 감지
- UTF-8 인코딩 보장

### 3. URL 발견
- 사이트맵 기반 URL 발견
- 페이지 링크 기반 URL 발견
- robots.txt 기반 사이트맵 찾기
- BFS 기반 깊이 탐색

### 4. 필터링 및 정렬
- 도메인 제한
- 깊이 제한
- 우선순위 기반 정렬

## 옵션 설명

### CrawlOptions

```typescript
interface CrawlOptions {
  maxDepth?: number;          // 최대 탐색 깊이 (1-4)
  maxUrls?: number;           // 최대 발견 URL 수
  respectRobots?: boolean;    // robots.txt 존중 여부
  domainLimit?: boolean;      // 도메인 제한 여부
  allowedDomains?: string[];  // 허용된 도메인 목록
  timeout?: number;          // 타임아웃 (ms)
  discoverSubPages?: boolean; // 하위 페이지 발견 여부
  vendor?: string;            // 벤더 정보
  userAgent?: string;         // 사용자 에이전트
  waitTime?: number;         // 대기 시간 (ms)
}
```

## 테스트

### Vercel 배포 후 테스트 (권장)

실제 프로덕션 환경과 동일한 조건에서 테스트할 수 있습니다.

1. **Vercel에 배포**
   ```bash
   # Git에 푸시하면 자동 배포됩니다
   git add .
   git commit -m "크롤러 V2 업데이트"
   git push
   ```

2. **배포 완료 후 테스트**
   - Vercel 대시보드에서 배포 URL 확인
   - `https://your-app.vercel.app/test/crawler-v2` 접속
   - Vercel 환경에서는 자동으로 Chromium이 제공되므로 바로 테스트 가능

### 로컬 테스트 (선택사항)

로컬 환경에서는 Chrome 설치가 필요할 수 있습니다.

1. **개발 서버 실행**
   ```bash
   npm run dev
   ```

2. **브라우저에서 접속**
   - `http://localhost:3000/test/crawler-v2` 접속
   - 로컬 환경 안내 메시지 확인

3. **Chrome 설정 (필요한 경우)**
   - Chrome이 설치되어 있지 않으면 환경 변수 설정:
     ```bash
     # Windows
     set PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
     
     # macOS/Linux
     export PUPPETEER_EXECUTABLE_PATH=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
     ```

**참고**: 로컬 환경에서 Chrome 실행이 실패해도 문제없습니다. 실제 프로덕션은 Vercel에서 실행되므로 Vercel에 배포하여 테스트하는 것을 권장합니다.

## 기존 시스템과의 차이점

### 개선된 점
1. **코드 구조**: 모듈화된 명확한 구조
2. **에러 처리**: 일관된 에러 처리 전략
3. **브라우저 관리**: 싱글톤 패턴으로 성능 향상
4. **타입 안정성**: 모든 타입이 명확히 정의됨
5. **로깅**: 불필요한 로그 제거

### 유지된 기능
1. Puppeteer 기반 동적 크롤링
2. 사이트맵 기반 URL 발견
3. 하위 페이지 탐색
4. UTF-8 인코딩 처리

## 향후 개선 계획

1. 캐싱 시스템 추가
2. 재시도 로직 개선
3. 진행 상황 추적 (WebSocket)
4. 배치 처리 최적화
5. 메모리 사용량 최적화

