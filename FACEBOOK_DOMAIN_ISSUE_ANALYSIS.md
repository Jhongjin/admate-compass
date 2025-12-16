# Facebook 도메인 필터링 문제 분석

## 문제 상황

- **크롤링 URL**: `https://ko-kr.facebook.com/business`
- **maxDepth**: 3
- **domainLimit**: true (체크됨)
- **결과**:
  - 기본 도메인 (`ko-kr.facebook.com`): 0개
  - 하위 도메인: 0개
  - 다른 도메인 (`www.facebook.com`): 32개 ❌

## 원인 분석

### 1. 도메인 필터링 로직

`isSubdomain` 함수:
```typescript
private isSubdomain(subDomain: string, baseDomain: string): boolean {
  if (subDomain === baseDomain) {
    return false;
  }
  return subDomain.endsWith(`.${baseDomain}`);
}
```

**문제**: `www.facebook.com`은 `ko-kr.facebook.com`의 하위 도메인이 아닙니다.
- `www.facebook.com.endsWith(".ko-kr.facebook.com")` → `false` ✅ (올바름)

### 2. 필터링 로직 흐름

`filterAndSortPages` 함수에서:
```typescript
if (urlDomain !== baseDomain) {
  if (config.maxDepth >= 3) {
    if (config.domainLimit === true) {
      // domainLimit이 true면 하위 도메인도 제외 (같은 도메인만)
      filteredOut.push({ url: page.url, reason: `도메인 제한 활성화: ${urlDomain} !== ${baseDomain}` });
      return; // 제외됨 ✅
    }
  }
}
```

**예상 동작**: `domainLimit=true`일 때 `www.facebook.com`은 필터링되어야 함.

### 3. 가능한 원인

1. **크롤링 중 필터링이 적용되지 않음**: 
   - `discoverSubPages` 또는 `discoverSubPagesWithDepth`에서 필터링이 제대로 작동하지 않았을 수 있음
   - BFS 탐색 중 `isValidUrl` 체크가 누락되었을 수 있음

2. **Facebook 리다이렉트**:
   - `ko-kr.facebook.com`에서 크롤링을 시작했지만, Facebook이 내부적으로 `www.facebook.com`으로 리다이렉트
   - 리다이렉트된 URL이 필터링되지 않고 크롤링됨

3. **링크 추출 시점의 문제**:
   - Puppeteer로 링크를 추출할 때 `www.facebook.com` 링크가 발견됨
   - 이 링크들이 `isValidUrl` 체크를 통과했을 수 있음

## 해결 방안

### 1. 로그 확인 필요
- Vercel 로그에서 다음을 확인:
  - `[CRITICAL] ⚠️ 필터링된 URL 샘플` 로그
  - `www.facebook.com` URL이 필터링되었는지 확인
  - BFS 탐색 중 `isValidUrl` 체크가 제대로 작동했는지 확인

### 2. 필터링 강화
- `isValidUrl` 함수에서 `domainLimit=true`일 때 더 엄격한 체크
- Facebook 같은 경우, `ko-kr.facebook.com`과 `www.facebook.com`은 완전히 다른 도메인으로 처리

### 3. 프론트엔드 표시 개선
- 자동 새로고침 간격 조정 (3초 → 1초)
- 작업 완료 후 즉시 refetch (현재 3초 대기 → 1초로 단축)

## 다음 단계

1. Vercel 로그 확인하여 필터링 로그 분석
2. `isValidUrl` 함수에 더 상세한 로그 추가
3. Facebook 도메인 처리 로직 개선








