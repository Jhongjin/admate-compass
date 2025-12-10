# MaxDepth 필터링 로직 정리

## 개요

크롤링 시 `maxDepth` 값에 따라 도메인 필터링이 다르게 적용됩니다.

## MaxDepth별 필터링 규칙

### MaxDepth 1-2: 정확히 같은 도메인만 허용

**필터링 조건:**
- ✅ `urlDomain === baseDomain` (정확히 같은 도메인)
- ❌ 하위 도메인 제외 (예: `sub.example.com` → `example.com` 불가)
- ❌ 다른 도메인 제외 (예: `other.com` → `example.com` 불가)

**설정:**
- `includeExternal: false`
- `allowedDomains: [baseDomain]`
- `maxUrls`: maxDepth 1일 때 20개, maxDepth 2일 때 50개

**예시:**
```
시드 URL: https://example.com
✅ 허용: https://example.com/page1
❌ 제외: https://sub.example.com/page1 (하위 도메인)
❌ 제외: https://other.com/page1 (다른 도메인)
```

---

### MaxDepth 3: 같은 도메인 + 하위 도메인 허용

**필터링 조건:**
- ✅ `urlDomain === baseDomain` (정확히 같은 도메인)
- ✅ `isSubdomain(urlDomain, baseDomain)` (하위 도메인 허용)
- ❌ 다른 도메인 제외 (예: `other.com` → `example.com` 불가)

**설정:**
- `includeExternal: false`
- `allowedDomains: [baseDomain]` (하위 도메인은 `isValidUrl`에서 체크)
- `maxUrls`: 150개

**예시:**
```
시드 URL: https://example.com
✅ 허용: https://example.com/page1 (같은 도메인)
✅ 허용: https://sub.example.com/page1 (하위 도메인)
✅ 허용: https://www.example.com/page1 (하위 도메인)
❌ 제외: https://other.com/page1 (다른 도메인)
```

**하위 도메인 체크 로직:**
```typescript
isSubdomain(subDomain: string, baseDomain: string): boolean {
  if (subDomain === baseDomain) return false;
  return subDomain.endsWith(`.${baseDomain}`);
}
```

---

### MaxDepth 4: 모든 도메인 허용

**필터링 조건:**
- ✅ `urlDomain === baseDomain` (정확히 같은 도메인)
- ✅ `isSubdomain(urlDomain, baseDomain)` (하위 도메인 허용)
- ✅ 모든 다른 도메인 허용 (예: `other.com` → `example.com` 허용)

**설정:**
- `includeExternal: true` (모든 외부 도메인 허용)
- `allowedDomains: undefined` (도메인 제한 없음)
- `maxUrls`: 200개

**예시:**
```
시드 URL: https://example.com
✅ 허용: https://example.com/page1 (같은 도메인)
✅ 허용: https://sub.example.com/page1 (하위 도메인)
✅ 허용: https://other.com/page1 (다른 도메인)
✅ 허용: https://any-domain.com/page1 (모든 도메인)
```

---

## 공통 필터링 규칙 (모든 MaxDepth)

다음 필터링은 모든 maxDepth에서 공통으로 적용됩니다:

### 1. 확장자 필터링
다음 확장자를 가진 URL은 제외됩니다:
- `.pdf`, `.jpg`, `.jpeg`, `.png`, `.gif`, `.css`, `.js`, `.xml`

### 2. URL 정규화 및 중복 제거
- 트래킹 파라미터 제거 (`utm_source`, `fbclid`, `gclid` 등)
- 정규화된 URL 기준으로 중복 제거

### 3. 우선순위 정렬
발견된 URL은 다음 순서로 정렬됩니다:
1. `sitemap` 또는 `robots` 소스 (우선순위 1)
2. `links` 소스 (우선순위 2)
3. `pattern` 소스 (우선순위 3)

---

## 구현 위치

### 주요 파일

1. **`src/lib/services/SitemapDiscoveryService.ts`**
   - `isSubdomain()`: 하위 도메인 체크 함수
   - `isValidUrl()`: maxDepth 기반 도메인 필터링
   - `filterAndSortPages()`: maxDepth 기반 최종 필터링

2. **`src/lib/services/PuppeteerCrawlingService.ts`**
   - `crawlMetaPage()`: maxDepth에 따른 discovery 옵션 설정

3. **`src/app/api/jobs/consume/route.ts`**
   - `processQueue()`: 큐 처리 시 maxDepth에 따른 discovery 옵션 설정

---

## 로그 확인

필터링 과정은 다음 로그로 확인할 수 있습니다:

```
[CRITICAL] 🔍 하위 페이지 발견 시작: {baseUrl}
[CRITICAL] 📋 설정: {config}
[CRITICAL] 📊 필터링 전: {count}개 → 정규화 후: {count}개 → 중복 제거 후: {count}개
[CRITICAL] 📊 도메인 필터링: {before}개 → {after}개 (제외: {excluded}개)
[CRITICAL] ⚠️ 필터링된 URL 샘플 (처음 10개):
  {url}... (이유: {reason})
[CRITICAL] ✅ 최종 발견된 하위 페이지: {count}개
```

---

## 변경 사항 요약

### 추가된 기능
- ✅ 하위 도메인 체크 함수 (`isSubdomain`)
- ✅ maxDepth 3: 하위 도메인 허용
- ✅ maxDepth 4: 모든 도메인 허용

### 수정된 로직
- ✅ `isValidUrl`: maxDepth 기반 도메인 필터링
- ✅ `filterAndSortPages`: maxDepth 기반 도메인 필터링
- ✅ `PuppeteerCrawlingService`: maxDepth별 옵션 설정
- ✅ `consume/route.ts`: maxDepth별 옵션 설정

---

## 테스트 시나리오

### MaxDepth 1-2 테스트
```
시드: https://example.com
예상 결과: example.com 도메인만 포함, 하위 도메인 제외
```

### MaxDepth 3 테스트
```
시드: https://example.com
예상 결과: example.com + sub.example.com 포함, other.com 제외
```

### MaxDepth 4 테스트
```
시드: https://example.com
예상 결과: 모든 도메인 포함
```



