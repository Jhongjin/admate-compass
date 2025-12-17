# 크롤링 maxDepth 1~5 페이지 추출 로직 상세 분석

## 개요

이 문서는 크롤러의 `maxDepth`와 `discoverSubPages` 옵션이 어떻게 작동하는지 단계별로 분석합니다.

---

## 핵심 개념

### 1. `discoverSubPages` 옵션

- **`discoverSubPages: false`**: 하위 페이지를 **발견하지 않음**. 시드 URL만 크롤링합니다.
- **`discoverSubPages: true`**: 하위 페이지를 **발견함**. 시드 URL에서 링크를 추출하여 하위 페이지를 찾습니다.

⚠️ **중요**: 하위 페이지 발견은 **시드 URL에서만** 링크를 추출합니다.
- ✅ 시드 URL (`https://ads.naver.com/`)에서 모든 링크 추출
- ❌ 발견된 하위 페이지 (`https://ads.naver.com/start/sales`)를 크롤링해서 그 안의 링크를 추출하지 **않음**
- **maxDepth**는 발견된 링크의 깊이를 필터링하는 기준일 뿐, 재귀적으로 크롤링하는 깊이가 아닙니다

### 2. `maxDepth` 옵션

- **깊이(Depth)**: 시드 URL로부터 얼마나 멀리 떨어진 페이지까지 추출할지 결정합니다.
- **깊이 계산 방식**: `calculateDepth()` 함수 사용
  - 같은 도메인이 아니면: 깊이 **999** (무한대 대신 큰 수)
  - 시드가 루트(`/`)인 경우: 현재 경로의 세그먼트 수
  - 시드가 하위 경로인 경우: 공통 경로를 제외한 상대 깊이

---

## 깊이 계산 예시

### 예시 1: 시드가 루트(`/`)인 경우

```
시드 URL: https://ads.naver.com/
```

| 현재 URL | 경로 세그먼트 | 깊이 | 설명 |
|---------|--------------|------|------|
| `https://ads.naver.com/` | `[]` | 0 (시드 자체) | 시드 URL 자체 |
| `https://ads.naver.com/start` | `['start']` | **1** | 1단계 하위 |
| `https://ads.naver.com/start/sales` | `['start', 'sales']` | **2** | 2단계 하위 |
| `https://ads.naver.com/sub/guarantee` | `['sub', 'guarantee']` | **2** | 2단계 하위 |
| `https://ads.naver.com/sub/insight/detail` | `['sub', 'insight', 'detail']` | **3** | 3단계 하위 |

### 예시 2: 시드가 하위 경로인 경우

```
시드 URL: https://ads.naver.com/start
```

| 현재 URL | 공통 경로 | 상대 경로 | 깊이 | 설명 |
|---------|----------|----------|------|------|
| `https://ads.naver.com/start` | `['start']` | `[]` | 1 (시드 자체) | 시드 URL 자체 |
| `https://ads.naver.com/start/sales` | `['start']` | `['sales']` | **1** | 시드의 1단계 하위 |
| `https://ads.naver.com/start/offline` | `['start']` | `['offline']` | **1** | 시드의 1단계 하위 |
| `https://ads.naver.com/sub/guarantee` | `[]` | `['sub', 'guarantee']` | **2** | 공통 경로 없음, 상대 깊이 2 |
| `https://ads.naver.com/` | `[]` | `[]` | **1** | 루트로 돌아감 |

---

## maxDepth별 추출 범위

### maxDepth = 1

**도메인 제한**: 정확히 **같은 도메인만** 허용
- ✅ `https://ads.naver.com/start` (같은 도메인)
- ❌ `https://help.naver.com/` (다른 도메인)
- ❌ `https://www.naver.com/` (다른 도메인)

**깊이 제한**: 깊이 **1**까지만 추출
- 시드가 루트(`/`)인 경우: `/start`, `/sa` 등 1단계 하위만
- 시드가 하위 경로인 경우: 시드의 직접 하위만

**예시**:
```
시드: https://ads.naver.com/
maxDepth: 1
discoverSubPages: true

추출되는 URL:
✅ https://ads.naver.com/start (깊이 1)
✅ https://ads.naver.com/sa (깊이 1)
✅ https://ads.naver.com/sub (깊이 1)
❌ https://ads.naver.com/start/sales (깊이 2 - 제외)
❌ https://ads.naver.com/sub/guarantee (깊이 2 - 제외)
```

---

### maxDepth = 2

**도메인 제한**: 정확히 **같은 도메인만** 허용
- ✅ `https://ads.naver.com/start` (같은 도메인)
- ❌ `https://help.naver.com/` (다른 도메인)

**깊이 제한**: 깊이 **2**까지만 추출
- 시드가 루트(`/`)인 경우: `/start`, `/start/sales` 등 2단계까지
- 시드가 하위 경로인 경우: 시드의 2단계 하위까지

**예시**:
```
시드: https://ads.naver.com/
maxDepth: 2
discoverSubPages: true

추출되는 URL:
✅ https://ads.naver.com/start (깊이 1)
✅ https://ads.naver.com/start/sales (깊이 2)
✅ https://ads.naver.com/sub/guarantee (깊이 2)
❌ https://ads.naver.com/start/sales/detail (깊이 3 - 제외)
```

---

### maxDepth = 3

**도메인 제한**: `domainLimit` 옵션에 따라 다름
- **`domainLimit: true`**: 정확히 **같은 도메인만** 허용
- **`domainLimit: false`**: 같은 도메인 + **하위 도메인** 허용
  - ✅ `https://ads.naver.com/` (같은 도메인)
  - ✅ `https://sub.ads.naver.com/` (하위 도메인)
  - ❌ `https://help.naver.com/` (다른 도메인)

**깊이 제한**: 깊이 **3**까지만 추출

**예시 1: domainLimit = true**
```
시드: https://ads.naver.com/
maxDepth: 3
domainLimit: true
discoverSubPages: true

추출되는 URL:
✅ https://ads.naver.com/start (깊이 1)
✅ https://ads.naver.com/start/sales (깊이 2)
✅ https://ads.naver.com/start/sales/detail (깊이 3)
❌ https://sub.ads.naver.com/ (하위 도메인 - 제외)
❌ https://help.naver.com/ (다른 도메인 - 제외)
```

**예시 2: domainLimit = false**
```
시드: https://ads.naver.com/
maxDepth: 3
domainLimit: false
discoverSubPages: true

추출되는 URL:
✅ https://ads.naver.com/start (깊이 1)
✅ https://ads.naver.com/start/sales (깊이 2)
✅ https://sub.ads.naver.com/ (하위 도메인 - 허용)
❌ https://help.naver.com/ (다른 도메인 - 제외)
```

---

### maxDepth = 4

**도메인 제한**: **모든 도메인 허용** (`domainLimit` 옵션 무시)
- ✅ `https://ads.naver.com/` (같은 도메인)
- ✅ `https://help.naver.com/` (다른 도메인)
- ✅ `https://www.facebook.com/` (완전히 다른 도메인)

**깊이 제한**: 깊이 **4**까지만 추출 (다른 도메인은 깊이 999이지만 특별 처리)

**특별 처리**:
- 다른 도메인(깊이 999)도 허용되지만, 품질 점수가 매우 낮게 설정됨
- 일부 제외 도메인 목록이 있음 (help.naver.com, nca.naver.com 등)

**예시**:
```
시드: https://ads.naver.com/
maxDepth: 4
discoverSubPages: true

추출되는 URL:
✅ https://ads.naver.com/start (깊이 1, 같은 도메인)
✅ https://ads.naver.com/start/sales/detail/page (깊이 4, 같은 도메인)
✅ https://help.naver.com/ (깊이 999, 다른 도메인 - 허용)
✅ https://www.facebook.com/business (깊이 999, 다른 도메인 - 허용)
❌ https://ads.naver.com/start/sales/detail/page/sub (깊이 5 - 제외)
```

---


---

## discoverSubPages 옵션별 동작

### discoverSubPages: false

**하위 페이지를 발견하지 않음**

```
시드: https://ads.naver.com/
maxDepth: 4
discoverSubPages: false

크롤링되는 URL:
✅ https://ads.naver.com/ (시드 URL만)

하위 페이지 발견: ❌ 없음
팝업 표시: ❌ 없음
```

---

### discoverSubPages: true

**하위 페이지를 발견함**

#### 단계 1: 시드 URL 크롤링
- 시드 URL을 크롤링하여 콘텐츠 추출
- 페이지에서 링크 추출 (Puppeteer 사용)

#### 단계 2: 하위 페이지 발견
- 추출된 링크를 `maxDepth`와 `domainLimit` 기준으로 필터링
- 사이트맵에서도 URL 발견 시도

#### 단계 3: 발견된 URL 표시
- 발견된 하위 페이지를 팝업에 표시
- 사용자가 선택한 URL만 크롤링

**예시**:
```
시드: https://ads.naver.com/
maxDepth: 4
discoverSubPages: true

1단계: 시드 URL 크롤링
✅ https://ads.naver.com/ (크롤링 완료)

2단계: 하위 페이지 발견
🔍 페이지에서 링크 추출
🔍 사이트맵에서 URL 발견
📋 발견된 URL (maxDepth 4 기준):
   - https://ads.naver.com/start (깊이 1)
   - https://ads.naver.com/start/sales (깊이 2)
   - https://ads.naver.com/sub/guarantee (깊이 2)
   - https://help.naver.com/ (깊이 999, 다른 도메인)

3단계: 팝업 표시
💬 "하위 페이지 발견 (4개)" 팝업 표시
👤 사용자가 선택한 URL만 크롤링
```

---

## 실제 크롤링 플로우

### 시나리오 1: discoverSubPages = false

```
1. 사용자가 URL 입력: https://ads.naver.com/
2. performCrawl() 호출
3. API 요청: discoverSubPages: false
4. 크롤러 엔진:
   - 시드 URL만 크롤링
   - discoveredUrls: undefined
5. 결과:
   - results: [시드 URL 크롤링 결과]
   - 팝업: ❌ 표시 안 함
```

### 시나리오 2: discoverSubPages = true, maxDepth = 2

```
1. 사용자가 URL 입력: https://ads.naver.com/
2. performCrawl() 호출
3. API 요청: discoverSubPages: true, maxDepth: 2
4. 크롤러 엔진:
   a. 시드 URL 크롤링
   b. UrlDiscovery.discoverSubPages() 호출
      - 사이트맵에서 URL 발견
      - 페이지 링크에서 URL 발견
      - maxDepth 2 기준 필터링 (같은 도메인만, 깊이 2까지)
   c. discoveredUrls 반환
5. 프론트엔드:
   - event.results[0].discoveredUrls 확인
   - 발견된 URL이 있으면 팝업 표시
6. 사용자가 선택한 URL 크롤링:
   - handleCrawlSelectedSubPages() 호출
   - performCrawl(urlsToCrawl, true, parentSeedUrl)
   - isSubPageCrawl: true → discoverSubPages: false (재귀 방지)
```

### 시나리오 3: discoverSubPages = true, maxDepth = 4

```
1. 사용자가 URL 입력: https://ads.naver.com/
2. performCrawl() 호출
3. API 요청: discoverSubPages: true, maxDepth: 4
4. 크롤러 엔진:
   a. 시드 URL 크롤링
   b. UrlDiscovery.discoverSubPages() 호출
      - 사이트맵에서 URL 발견
      - 페이지 링크에서 URL 발견
      - maxDepth 4 기준 필터링:
        * 모든 도메인 허용
        * 깊이 4까지 허용
        * 다른 도메인은 품질 점수 낮게 설정
   c. discoveredUrls 반환 (더 많은 URL)
5. 프론트엔드:
   - 발견된 URL이 많으면 팝업 표시
6. 사용자가 선택한 URL 크롤링
```

---

## 코드 위치 및 핵심 로직

### 1. 깊이 계산: `src/lib/crawler-v2/utils/url-utils.ts`

```typescript
export function calculateDepth(seedUrl: string, currentUrl: string): number {
  // 같은 도메인이 아니면 깊이 999
  if (seedObj.hostname !== currentObj.hostname) {
    return 999;
  }
  
  // 시드가 루트(/)인 경우: 현재 경로의 세그먼트 수
  if (seedPath.length === 0) {
    return currentPath.length || 1;
  }
  
  // 공통 경로를 제외한 상대 깊이 계산
  return Math.max(1, currentPath.length - commonLength + 1);
}
```

### 2. 도메인 필터링: `src/lib/crawler-v2/discovery/UrlDiscovery.ts`

```typescript
// maxDepth 1-2: 정확히 같은 도메인만 허용
if (maxDepth < 3) {
  if (urlDomain !== baseDomain) {
    return false; // 제외
  }
}
// maxDepth 3: domainLimit에 따라 다름
else if (maxDepth === 3) {
  if (config.domainLimit === true) {
    // 같은 도메인만
    if (urlDomain !== baseDomain) return false;
  } else {
    // 하위 도메인 허용
    if (!urlDomain.endsWith(`.${baseDomain}`)) return false;
  }
}
// maxDepth 4+: 모든 도메인 허용
else if (maxDepth >= 4) {
  // 모든 도메인 허용 (특정 제외 도메인 제외)
}
```

### 3. 깊이 필터링: `src/lib/crawler-v2/discovery/UrlDiscovery.ts`

```typescript
// 깊이 제한 확인
if (maxDepth && depth > maxDepth) {
  // maxDepth 4일 때는 다른 도메인(999)도 허용
  if (maxDepth < 4 || depth !== 999) {
    return false; // 제외
  }
}
```

---

## 요약 테이블

| maxDepth | 도메인 제한 | 깊이 제한 | discoverSubPages: false | discoverSubPages: true |
|----------|------------|----------|------------------------|----------------------|
| **1** | 같은 도메인만 | 깊이 1 | 시드만 크롤링 | 시드 + 깊이 1까지 발견 |
| **2** | 같은 도메인만 | 깊이 2 | 시드만 크롤링 | 시드 + 깊이 2까지 발견 |
| **3** | domainLimit에 따라 다름 | 깊이 3 | 시드만 크롤링 | 시드 + 깊이 3까지 발견 |
| **4** | 모든 도메인 허용 | 깊이 4 | 시드만 크롤링 | 시드 + 깊이 4까지 발견 (다른 도메인 포함) |

---

## 주의사항

1. **재귀 방지**: 하위 페이지 크롤링 시 (`isSubPageCrawl: true`) `discoverSubPages`는 자동으로 `false`로 설정되어 재귀적 하위 페이지 발견을 방지합니다.

2. **캐시 무효화**: `discoverSubPages: true`이고 캐시된 결과에 `discoveredUrls`가 없거나 10개 미만이면 캐시를 무시하고 재크롤링합니다.

3. **품질 점수**: maxDepth 4일 때 다른 도메인 링크는 품질 점수가 -300으로 설정되어 같은 도메인 링크보다 낮은 우선순위를 가집니다.

4. **제외 도메인**: maxDepth 4일 때도 일부 도메인(help.naver.com, nca.naver.com 등)은 명시적으로 제외됩니다.

