# MaxDepth 2 vs 3 크롤링 결과 차이 분석

## 문제 상황
- **maxDepth 2**: 36개 문서 크롤링됨
- **maxDepth 3**: 23개 문서 크롤링됨 (도메인 제한 체크 해제)
- **예상**: maxDepth가 더 깊으면 더 많은 문서가 크롤링되어야 함

## 원인 분석

### 1. 깊이 계산 로직 (`calculateDepth`)

```typescript
// url-utils.ts:103-131
export function calculateDepth(seedUrl: string, currentUrl: string): number {
  const seedPath = seedObj.pathname.split('/').filter(p => p);
  const currentPath = currentObj.pathname.split('/').filter(p => p);
  
  // 공통 경로 찾기
  let commonLength = 0;
  for (let i = 0; i < Math.min(seedPath.length, currentPath.length); i++) {
    if (seedPath[i] === currentPath[i]) {
      commonLength++;
    } else {
      break;
    }
  }
  
  // 깊이는 현재 경로 길이 - 공통 경로 길이
  return Math.max(1, currentPath.length - commonLength + 1);
}
```

**예시:**
- 시드: `https://ads.naver.com/` (경로: `[]`)
- URL 1: `https://ads.naver.com/help` (경로: `['help']`)
  - 공통: `0`, 깊이: `1 - 0 + 1 = 2` ✅
- URL 2: `https://ads.naver.com/help/call` (경로: `['help', 'call']`)
  - 공통: `1` (help), 깊이: `2 - 1 + 1 = 2` ✅
- URL 3: `https://ads.naver.com/sub/insight/adtips` (경로: `['sub', 'insight', 'adtips']`)
  - 공통: `0`, 깊이: `3 - 0 + 1 = 4` ❌ (maxDepth 3에서 제외됨!)

### 2. 필터링 로직 문제

**`discoverFromLinks` (240-274번 라인):**
```typescript
// 깊이 계산
const depth = calculateDepth(baseUrl, normalizedUrl);

// 깊이 제한 확인
if (maxDepth && depth > maxDepth) {
  if (maxDepth < 4 || depth !== 999) {
    return false;  // ❌ 깊이 4인 URL이 maxDepth 3에서 제외됨!
  }
}
```

**문제점:**
- `https://ads.naver.com/sub/insight/adtips` 같은 경로는 깊이 4로 계산됨
- maxDepth 3일 때 깊이 4인 URL은 모두 제외됨
- maxDepth 2일 때는 깊이 3 이상이 제외되므로, 깊이 4인 URL도 제외됨
- **하지만** maxDepth 2일 때는 다른 필터링 로직이 작동하여 더 많은 URL이 포함될 수 있음

### 3. 도메인 제한 로직 차이

**maxDepth 3 + domainLimit: false일 때:**
```typescript
// UrlDiscovery.ts:347-357
} else if (maxDepth >= 3) {
  if (config.domainLimit === true) {
    return false;  // 같은 도메인만
  } else {
    // domainLimit이 false면 하위 도메인 허용
    if (!this.isSubdomain(urlDomain, baseDomain)) {
      return false;  // 하위 도메인이 아니면 제외
    }
  }
}
```

**문제:**
- `ads.naver.com`에는 하위 도메인이 없음
- `domainLimit: false`여도 하위 도메인 체크에서 걸려서 제외될 수 있음
- 하지만 실제로는 같은 도메인이므로 `urlDomain !== baseDomain` 조건에서 걸리지 않음

### 4. 실제 원인 추정

**가장 가능성 높은 원인:**

1. **깊이 계산 방식의 문제:**
   - 시드 URL이 `/` (루트)일 때, 경로가 다른 URL들은 공통 경로가 0
   - 예: `/sub/insight/adtips` → 깊이 4
   - maxDepth 3에서 깊이 4인 URL들이 제외됨

2. **maxDepth 2일 때는:**
   - 깊이 3 이상이 제외되지만
   - 다른 필터링 조건(우선순위, 정렬 등)으로 인해 일부 URL이 포함될 수 있음

3. **사이트맵 vs 링크 발견 차이:**
   - 사이트맵에서는 깊이 필터링이 다르게 작동할 수 있음
   - 링크 발견에서는 더 엄격한 필터링이 적용될 수 있음

## 해결 방안

### 방안 1: 깊이 계산 로직 수정

**현재 문제:**
- 시드가 루트(`/`)일 때, 모든 하위 경로의 공통 경로가 0
- 깊이가 실제 경로 깊이보다 크게 계산됨

**수정안:**
```typescript
export function calculateDepth(seedUrl: string, currentUrl: string): number {
  const seedObj = new URL(seedUrl);
  const currentObj = new URL(currentUrl);
  
  if (seedObj.hostname !== currentObj.hostname) {
    return 999;
  }
  
  const seedPath = seedObj.pathname.split('/').filter(p => p);
  const currentPath = currentObj.pathname.split('/').filter(p => p);
  
  // 시드가 루트인 경우, 현재 경로의 깊이를 직접 반환
  if (seedPath.length === 0) {
    return currentPath.length;
  }
  
  // 공통 경로 찾기
  let commonLength = 0;
  for (let i = 0; i < Math.min(seedPath.length, currentPath.length); i++) {
    if (seedPath[i] === currentPath[i]) {
      commonLength++;
    } else {
      break;
    }
  }
  
  // 깊이는 현재 경로 길이 - 공통 경로 길이
  return Math.max(1, currentPath.length - commonLength + 1);
}
```

### 방안 2: 필터링 로직 개선

**현재:**
```typescript
if (maxDepth && depth > maxDepth) {
  return false;
}
```

**개선안:**
```typescript
// maxDepth는 "최대 허용 깊이"이므로, depth <= maxDepth인 경우만 허용
if (maxDepth && depth > maxDepth) {
  // 단, maxDepth 4일 때는 다른 도메인(999)도 허용
  if (maxDepth < 4 || depth !== 999) {
    return false;
  }
}
```

## 즉시 확인 사항

1. **실제 크롤링된 URL 목록 비교:**
   - maxDepth 2: 어떤 URL들이 크롤링되었는지
   - maxDepth 3: 어떤 URL들이 크롤링되었는지
   - 차이점 확인

2. **깊이 계산 결과 확인:**
   - 각 URL의 실제 깊이 값 확인
   - maxDepth 3에서 제외된 URL들의 깊이 확인

3. **필터링 로그 확인:**
   - Vercel 로그에서 필터링된 URL 수 확인
   - 사이트맵 vs 링크 발견 결과 비교








