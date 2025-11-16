# 성능 모니터링 가이드

## 📊 React DevTools Profiler 사용법

### 설치
1. Chrome/Edge 브라우저에 React Developer Tools 확장 프로그램 설치
2. 개발 모드에서만 Profiler 탭이 활성화됩니다

### 사용 방법

#### 1. 프로파일링 시작
1. React DevTools 열기 (F12 → Components 탭)
2. Profiler 탭으로 이동
3. "Record" 버튼 클릭
4. 페이지에서 작업 수행 (스크롤, 클릭, 입력 등)
5. "Stop" 버튼 클릭

#### 2. 주요 메트릭 확인
- **Render time**: 각 컴포넌트의 렌더링 시간
- **Why did this render?**: 리렌더링 원인 분석
- **Flamegraph**: 시간별 렌더링 트리
- **Ranked**: 렌더링 시간이 긴 컴포넌트 순위

#### 3. 최적화 포인트 확인
- 렌더링 시간이 16ms 이상인 컴포넌트 확인
- 불필요한 리렌더링 발생 컴포넌트 확인
- `useMemo`, `useCallback` 적용 필요 여부 판단

### 예시: 메인 페이지 프로파일링

```typescript
// 성능 측정이 필요한 컴포넌트
// 1. VendorBanner - 애니메이션 성능
// 2. 통계 카드 - 데이터 로딩 시 리렌더링
// 3. 성능 지표 테이블 - 데이터 업데이트 시 리렌더링
```

## 🔍 Vercel Analytics 모니터링

### 자동 수집 메트릭
- **Web Vitals**: LCP, FID, CLS, TTFB
- **페이지 뷰**: 각 페이지 방문 수
- **함수 실행 시간**: API 라우트 성능
- **에러 로그**: 런타임 에러 추적

### 확인 방법
1. Vercel Dashboard → 프로젝트 선택
2. Analytics 탭 클릭
3. 실시간 및 과거 데이터 확인

### 주요 지표
- **LCP (Largest Contentful Paint)**: < 2.5초 권장
- **FID (First Input Delay)**: < 100ms 권장
- **CLS (Cumulative Layout Shift)**: < 0.1 권장
- **TTFB (Time to First Byte)**: < 800ms 권장

## ⚡ Speed Insights 사용법

### 자동 수집
- Vercel Speed Insights는 자동으로 Web Vitals를 수집합니다
- 별도 설정 없이 `@vercel/speed-insights` 패키지만 설치하면 됩니다

### 확인 방법
1. Vercel Dashboard → 프로젝트 선택
2. Speed Insights 탭 클릭
3. 실시간 성능 데이터 확인

## 🛠️ 수동 성능 측정

### React Profiler API 사용

```typescript
import { Profiler } from 'react';

function onRenderCallback(
  id: string,
  phase: 'mount' | 'update',
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number
) {
  console.log('Component:', id);
  console.log('Phase:', phase);
  console.log('Actual duration:', actualDuration);
  console.log('Base duration:', baseDuration);
}

// 사용 예시
<Profiler id="HomePage" onRender={onRenderCallback}>
  <HomePage />
</Profiler>
```

### Performance API 사용

```typescript
// 페이지 로드 시간 측정
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    const perfData = window.performance.timing;
    const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
    console.log('Page Load Time:', pageLoadTime, 'ms');
  });
}

// 특정 작업 시간 측정
const startTime = performance.now();
// 작업 수행
const endTime = performance.now();
console.log('Task duration:', endTime - startTime, 'ms');
```

## 📈 최적화 체크리스트

### 렌더링 최적화
- [ ] 불필요한 리렌더링 제거 (`React.memo`, `useMemo`, `useCallback`)
- [ ] 큰 리스트는 가상화 (`react-window`, `react-virtual`)
- [ ] 이미지 최적화 (Next.js Image 컴포넌트 사용)
- [ ] 코드 스플리팅 (동적 import)

### 네트워크 최적화
- [ ] API 응답 캐싱 (React Query `staleTime` 설정)
- [ ] 정적 자산 CDN 활용
- [ ] Gzip/Brotli 압축 활성화
- [ ] HTTP/2 또는 HTTP/3 사용

### 번들 최적화
- [ ] Tree shaking 활성화
- [ ] 불필요한 의존성 제거
- [ ] 동적 import로 코드 스플리팅
- [ ] 번들 크기 분석 (`@next/bundle-analyzer`)

## 🎯 성능 목표

### Core Web Vitals
- **LCP**: < 2.5초
- **FID**: < 100ms
- **CLS**: < 0.1

### 사용자 경험
- **TTI (Time to Interactive)**: < 3.5초
- **FCP (First Contentful Paint)**: < 1.8초
- **페이지 로드 시간**: < 3초

## 📝 정기 모니터링

### 주간 체크
1. Vercel Analytics에서 Web Vitals 확인
2. 에러 로그 확인 및 해결
3. 느린 API 엔드포인트 확인

### 월간 체크
1. React DevTools Profiler로 전체 페이지 분석
2. 번들 크기 추이 확인
3. 사용자 피드백 기반 성능 개선

---

**참고**: 성능 모니터링은 지속적인 프로세스입니다. 정기적으로 확인하고 개선하세요.




