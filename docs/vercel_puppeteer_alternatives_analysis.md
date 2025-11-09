# Vercel에서 Puppeteer 사용 제약 및 대안 분석

## 1. Vercel에서 Puppeteer를 사용할 수 없는 이유

### 주요 제약 사항

#### 1.1 배포 패키지 크기 제한
- **문제**: Puppeteer의 기본 Chromium 바이너리는 약 **170MB**로 매우 큼
- **Vercel 제한**: 서버리스 함수 배포 패키지 크기 제한 (기본적으로 50MB, 최대 250MB)
- **결과**: 전체 Chromium을 포함하면 배포 실패 또는 매우 느린 배포

#### 1.2 실행 시간 제한
- **무료 플랜**: 최대 10초
- **Pro 플랜**: 최대 300초
- **문제**: Puppeteer 초기화 및 페이지 로딩에 시간이 오래 걸림

#### 1.3 메모리 제한
- 서버리스 함수의 메모리 제한
- Chromium은 메모리를 많이 사용

#### 1.4 보안 정책
- Vercel의 보안 정책으로 인해 바이너리 실행이 제한될 수 있음
- 특히 AWS Lambda 기반 환경에서 제약

## 2. 환경 설정 변경으로 사용 가능 여부

### ✅ 가능: `@sparticuz/chromium` + `puppeteer-core` 조합

**해결 방법**:
1. `puppeteer` 대신 `puppeteer-core` 사용 (Chromium 바이너리 제외)
2. `@sparticuz/chromium` 패키지 사용 (경량화된 Chromium 빌드, 약 40-50MB)
3. Vercel 서버리스 환경에 최적화된 설정

**장점**:
- Vercel 환경에서 작동 가능
- 패키지 크기 감소 (170MB → 40-50MB)
- 공식 Vercel 템플릿 제공

**단점**:
- 여전히 상대적으로 큰 패키지
- 초기화 시간이 여전히 느림
- 메모리 사용량이 높음

**참고 자료**:
- [Vercel Puppeteer 템플릿](https://vercel.com/templates/next.js/puppeteer-on-vercel)
- [@sparticuz/chromium GitHub](https://github.com/Sparticuz/chromium)

## 3. Puppeteer 대안 패키지 분석

### 3.1 `@sparticuz/chromium` + `puppeteer-core` (권장)

**평가**: ⭐⭐⭐⭐ (4/5)

**장점**:
- Vercel 환경에서 작동
- Puppeteer API와 호환
- 경량화된 Chromium

**단점**:
- 여전히 큰 패키지
- 초기화 시간 느림

**사용 시나리오**:
- JavaScript 렌더링이 필요한 경우
- 복잡한 동적 콘텐츠 크롤링

### 3.2 Playwright

**평가**: ⭐⭐⭐ (3/5)

**장점**:
- 다양한 브라우저 지원 (Chromium, Firefox, WebKit)
- 더 나은 API
- 더 나은 성능

**단점**:
- Puppeteer와 유사한 제약 사항
- Vercel에서도 추가 설정 필요
- 바이너리 크기 문제 동일

**사용 시나리오**:
- 다양한 브라우저 테스트가 필요한 경우
- 더 나은 API가 필요한 경우

### 3.3 Cheerio + JSDOM

**평가**: ⭐⭐⭐⭐⭐ (5/5) - 정적 HTML의 경우

**장점**:
- 매우 가벼움 (수 MB)
- 빠른 파싱
- 서버리스 환경에 최적
- 메모리 사용량 낮음

**단점**:
- JavaScript 렌더링 불가
- 동적 콘텐츠 처리 불가
- 정적 HTML만 파싱 가능

**사용 시나리오**:
- 정적 HTML 크롤링
- 서버 사이드 렌더링된 페이지
- 현재 구현과 유사한 경우 (fetch + 정규식)

**현재 프로젝트 적합도**: ⭐⭐⭐⭐⭐
- 현재 fetch fallback 방식과 유사
- 더 나은 HTML 파싱 제공

### 3.4 외부 브라우저 서비스

**평가**: ⭐⭐⭐ (3/5)

**옵션**:
- Browserless
- ScrapingBee
- Apify

**장점**:
- Vercel 제약 없음
- 완전한 브라우저 기능
- 확장성

**단점**:
- 추가 비용 (월 $20-100+)
- 외부 의존성
- 네트워크 지연

**사용 시나리오**:
- 대규모 크롤링
- 복잡한 JavaScript 렌더링 필요
- 예산이 충분한 경우

## 4. 현재 프로젝트에 대한 권장 사항

### 현재 상황 분석

**현재 구현**:
- ✅ Fetch + 정규식으로 링크 추출 (fetch fallback)
- ✅ Sitemap.xml 파싱
- ✅ Puppeteer 실패 시 자동 fallback

**장점**:
- Vercel 환경에서 작동
- 추가 비용 없음
- 빠른 응답 시간

**개선 가능한 부분**:
- Cheerio를 사용하여 더 정확한 HTML 파싱
- JSDOM으로 DOM 조작 가능

### 권장 개선 방안

#### 옵션 1: Cheerio 추가 (권장)

```bash
npm install cheerio
npm install --save-dev @types/cheerio
```

**장점**:
- 현재 fetch fallback 방식 개선
- 더 정확한 HTML 파싱
- 가볍고 빠름
- 추가 비용 없음

**구현 예시**:
```typescript
import * as cheerio from 'cheerio';

const $ = cheerio.load(htmlContent);
const links: string[] = [];

$('a[href]').each((_, element) => {
  const href = $(element).attr('href');
  if (href && isValidUrl(href)) {
    links.push(resolveUrl(href, baseUrl));
  }
});
```

#### 옵션 2: `@sparticuz/chromium` 적용 (필요한 경우)

**언제 사용**:
- JavaScript 렌더링이 반드시 필요한 경우
- SPA (Single Page Application) 크롤링

**비용**:
- 패키지 크기 증가 (40-50MB)
- 초기화 시간 증가
- 메모리 사용량 증가

#### 옵션 3: 하이브리드 접근 (최적)

**전략**:
1. 기본: Fetch + Cheerio (정적 HTML)
2. 필요 시: `@sparticuz/chromium` (동적 콘텐츠)
3. Fallback: 현재 방식 유지

## 5. 결론 및 권장 사항

### 현재 프로젝트에 가장 적합한 방법

1. **즉시 적용 가능**: Cheerio 추가
   - 현재 fetch fallback 방식 개선
   - 더 정확한 HTML 파싱
   - 비용 없음, 성능 향상

2. **필요 시 고려**: `@sparticuz/chromium`
   - JavaScript 렌더링이 반드시 필요한 경우만
   - 패키지 크기와 성능 트레이드오프 고려

3. **현재 방식 유지**: Fetch + 정규식
   - 이미 작동하고 있음
   - 추가 의존성 없음
   - Cheerio로 개선 가능

### 최종 권장 사항

**단기 (즉시)**:
- ✅ Cheerio 추가하여 HTML 파싱 개선
- ✅ 현재 fetch fallback 방식 유지

**중기 (필요 시)**:
- `@sparticuz/chromium` 적용 검토
- JavaScript 렌더링이 필요한 페이지만 선택적 사용

**장기 (확장 시)**:
- 외부 브라우저 서비스 고려
- 대규모 크롤링이 필요한 경우

