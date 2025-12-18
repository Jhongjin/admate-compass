# 크롤러 V2 마이그레이션 가이드

## 개요

기존 크롤링 시스템(`src/lib/services/PuppeteerCrawlingService.ts` 등)과 완전히 분리된 새로운 크롤링 시스템(`src/lib/crawler-v2/`)이 구현되었습니다.

## 현재 크롤링 기능 정리

### 기존 크롤링 서비스
- `PuppeteerCrawlingService.ts`: Puppeteer 기반 동적 크롤링
- `MetaCrawlingService.ts`: Meta 공식 문서 크롤링 (fetch 기반)
- `AlternativeCrawlingService.ts`: 대안 크롤링 (사용되지 않음)
- `SitemapDiscoveryService.ts`: 사이트맵 기반 URL 발견

### 기존 API 엔드포인트
- `/api/puppeteer-crawl`: Puppeteer 크롤링
- `/api/puppeteer-crawler`: 간단한 Puppeteer 크롤러
- `/api/simple-crawler`: 간단한 fetch 기반 크롤링
- `/api/test-crawler`: 테스트용 크롤링
- `/api/admin/crawl`: 관리자용 크롤링
- `/api/jobs/discover-urls`: URL 탐색

### 기존 UI 컴포넌트
- `HybridCrawlingManager.tsx`: 크롤링 관리 UI

## 새로운 크롤러 V2 구조

### 새로운 서비스
- `src/lib/crawler-v2/core/CrawlerEngine.ts`: 메인 크롤러 엔진
- `src/lib/crawler-v2/core/BrowserManager.ts`: 브라우저 관리
- `src/lib/crawler-v2/core/ContentExtractor.ts`: 콘텐츠 추출
- `src/lib/crawler-v2/discovery/UrlDiscovery.ts`: URL 발견
- `src/lib/crawler-v2/discovery/SitemapParser.ts`: 사이트맵 파싱

### 새로운 API 엔드포인트
- `/api/crawler-v2/crawl`: 크롤러 V2 API

### 새로운 테스트 페이지
- `/test/crawler-v2`: 크롤러 V2 테스트 페이지

## 주요 개선 사항

### 1. 아키텍처
- ✅ 모듈화된 구조
- ✅ 단일 책임 원칙 준수
- ✅ 명확한 의존성 방향

### 2. 브라우저 관리
- ✅ 싱글톤 패턴으로 브라우저 재사용
- ✅ 자동 재연결 로직
- ✅ 상태 관리 개선

### 3. 에러 처리
- ✅ 일관된 에러 처리
- ✅ 명확한 에러 메시지
- ✅ 폴백 메커니즘

### 4. 코드 품질
- ✅ 타입 안정성 향상
- ✅ 로깅 정리
- ✅ 코드 중복 제거

## 마이그레이션 계획

### Phase 1: 병행 운영 (현재)
- 기존 크롤링 시스템 유지
- 새로운 크롤러 V2 테스트 및 검증
- `/test/crawler-v2`에서 테스트

### Phase 2: 점진적 마이그레이션
- 새로운 기능은 크롤러 V2 사용
- 기존 기능은 점진적으로 마이그레이션
- 두 시스템 병행 운영

### Phase 3: 완전 전환
- 모든 기능을 크롤러 V2로 전환
- 기존 크롤링 코드 제거 또는 deprecated 표시
- 문서 업데이트

## 사용 방법

### 크롤러 V2 사용

```typescript
import { crawlerEngine } from '@/lib/crawler-v2';

// 단일 URL 크롤링
const result = await crawlerEngine.crawlUrl('https://example.com');

// 여러 URL 배치 크롤링
const results = await crawlerEngine.crawlUrls(['https://example.com'], {
  discoverSubPages: true,
  maxDepth: 2,
});
```

### API 사용

```bash
curl -X POST http://localhost:3000/api/crawler-v2/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com"],
    "options": {
      "discoverSubPages": true,
      "maxDepth": 2
    }
  }'
```

## 테스트 방법

1. 개발 서버 실행: `npm run dev`
2. 브라우저에서 `/test/crawler-v2` 접속
3. URL 입력 후 크롤링 실행
4. 결과 확인

## 주의사항

- 크롤러 V2는 기존 시스템과 완전히 분리되어 있음
- 기존 코드와 충돌하지 않음
- 로컬 모드에서 먼저 테스트 필요
- 프로덕션 배포 전 충분한 테스트 필요

## 구현 현황 (2025-12-18 업데이트)

### Phase 1: 병행 운영 ✅ 완료
- [x] CrawlerEngine 구현
- [x] BrowserManager 구현
- [x] ContentExtractor 구현
- [x] UrlDiscovery 구현
- [x] SitemapParser 구현
- [x] CacheManager 구현
- [x] RetryManager 구현
- [x] MemoryMonitor 구현
- [x] API 엔드포인트 (`/api/crawler-v2/crawl`)
- [x] 테스트 페이지 (`/test/crawler-v2`) - 스트리밍 응답 처리 수정 완료

### Phase 2: 점진적 마이그레이션 ⏳ 진행 예정
- [ ] 기존 HybridCrawlingManager와 V2 통합
- [ ] 관리자 페이지에서 V2 크롤러 사용 옵션 추가

### Phase 3: 완전 전환 ⏳ 대기
- [ ] 모든 크롤링 기능 V2로 전환
- [ ] 기존 크롤링 코드 deprecated 처리








