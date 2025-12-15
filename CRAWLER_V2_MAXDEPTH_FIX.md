# Crawler V2 MaxDepth 필터링 수정 사항

## 문제점 분석

### 발견된 문제
1. **crawler-v2의 `UrlDiscovery.ts`에서 maxDepth 기반 필터링이 누락됨**
   - `filterAndSort()` 함수에서 maxDepth를 고려하지 않음
   - `discoverFromLinks()` 함수에서 maxDepth를 고려하지 않음
   - `discoverFromSitemap()` 함수에서 maxDepth를 고려하지 않음

2. **maxDepth 4일 때 domainLimit과 관계없이 모든 도메인을 허용해야 함**
   - 기존 로직: domainLimit이 false일 때만 모든 도메인 허용
   - 수정 로직: maxDepth 4일 때는 domainLimit과 관계없이 모든 도메인 허용

## 수정 내용

### 1. `filterAndSort()` 함수 수정
- maxDepth 1-2: 정확히 같은 도메인만 허용
- maxDepth 3: 같은 도메인 + 하위 도메인 허용
- maxDepth 4: 모든 도메인 허용 (domainLimit과 관계없이)

### 2. `discoverFromLinks()` 함수 수정
- 링크 필터링 시 maxDepth 기반 도메인 체크 추가
- maxDepth 4일 때 다른 도메인(999 depth)도 허용

### 3. `discoverFromSitemap()` 함수 수정
- 사이트맵 URL 필터링 시 maxDepth 기반 도메인 체크 추가
- maxDepth 4일 때 모든 도메인 허용

## 예상 결과

### MaxDepth 3
- ✅ 같은 도메인 허용
- ✅ 하위 도메인 허용
- ❌ 다른 도메인 제외
- **예상 발견 개수**: 35개 (하위 도메인 포함)

### MaxDepth 4
- ✅ 같은 도메인 허용
- ✅ 하위 도메인 허용
- ✅ 다른 도메인 허용
- **예상 발견 개수**: 67개 (모든 도메인 포함)

## 테스트 시나리오

### 테스트 1: MaxDepth 3
```
시드 URL: https://ads.naver.com/
예상 결과: ads.naver.com + 하위 도메인만 포함
예상 개수: 35개
```

### 테스트 2: MaxDepth 4
```
시드 URL: https://ads.naver.com/
예상 결과: 모든 도메인 포함
예상 개수: 67개
```

## 변경된 파일

- `src/lib/crawler-v2/discovery/UrlDiscovery.ts`
  - `isSubdomain()` 함수 추가
  - `filterAndSort()` 함수 수정
  - `discoverFromLinks()` 함수 수정
  - `discoverFromSitemap()` 함수 수정






