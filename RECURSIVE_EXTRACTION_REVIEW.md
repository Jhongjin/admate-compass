# 재귀적 하위 페이지 링크 추출 방법 검토

## 현재 구조 분석

### 현재 동작 방식
1. **시드 URL 크롤링**: `https://ads.naver.com/` 크롤링
2. **링크 추출**: 시드 URL에서만 링크 추출
3. **필터링**: maxDepth 기준으로 필터링
4. **반환**: 발견된 하위 페이지 목록만 반환 (실제 크롤링 안 함)

### 문제점
- 발견된 하위 페이지(`https://ads.naver.com/start/sales`)를 크롤링하지 않음
- 하위 페이지 내부의 링크를 알 수 없음
- 깊은 구조의 사이트에서 많은 링크를 놓칠 수 있음

---

## 재귀적 추출 방법 검토

### 방법 1: BFS (Breadth-First Search) 방식

#### 개념
```
시드: https://ads.naver.com/ (깊이 0)
  ↓
1단계: 시드에서 링크 추출 (깊이 1)
  - /start
  - /sa
  - /sub
  ↓
2단계: 깊이 1 페이지들 크롤링하여 링크 추출 (깊이 2)
  - /start → /start/sales, /start/offline
  - /sa → /sa/guide, /sa/faq
  - /sub → /sub/guarantee
  ↓
3단계: 깊이 2 페이지들 크롤링하여 링크 추출 (깊이 3)
  - /start/sales → /start/sales/detail
  ...
```

#### 구현 구조
```typescript
async discoverSubPagesRecursive(
  baseUrl: string,
  options: CrawlOptions
): Promise<DiscoveredUrl[]> {
  const queue: Array<{ url: string; depth: number }> = [
    { url: baseUrl, depth: 0 }
  ];
  const discovered = new Set<string>();
  const results: DiscoveredUrl[] = [];
  const maxDepth = options.maxDepth || 3;

  while (queue.length > 0) {
    const { url, depth } = queue.shift()!;
    
    // 깊이 제한 확인
    if (depth >= maxDepth) continue;
    
    // 중복 확인
    const normalized = normalizeUrl(url);
    if (discovered.has(normalized)) continue;
    discovered.add(normalized);
    
    // 페이지 크롤링 및 링크 추출
    const links = await this.discoverFromLinks(url, options);
    
    // 발견된 링크를 큐에 추가 (깊이 +1)
    links.forEach(link => {
      const linkDepth = calculateDepth(baseUrl, link.url);
      if (linkDepth <= maxDepth) {
        queue.push({ url: link.url, depth: linkDepth });
        results.push(link);
      }
    });
  }
  
  return results;
}
```

#### 장점
- ✅ 모든 깊이의 링크를 체계적으로 발견
- ✅ 깊이 제한을 명확하게 적용 가능
- ✅ 중복 방지 용이

#### 단점
- ❌ 시간이 오래 걸림 (각 페이지마다 크롤링 필요)
- ❌ 서버 부하 증가
- ❌ 무한 루프 위험 (순환 링크)
- ❌ 메모리 사용량 증가

---

### 방법 2: DFS (Depth-First Search) 방식

#### 개념
```
시드: https://ads.naver.com/
  ↓
/start 크롤링
  ↓
/start/sales 크롤링
  ↓
/start/sales/detail 크롤링 (maxDepth 도달)
  ↓
백트래킹하여 다른 경로 탐색
```

#### 구현 구조
```typescript
async discoverSubPagesRecursiveDFS(
  baseUrl: string,
  currentUrl: string,
  currentDepth: number,
  options: CrawlOptions,
  discovered: Set<string>,
  results: DiscoveredUrl[]
): Promise<void> {
  if (currentDepth >= options.maxDepth) return;
  
  const normalized = normalizeUrl(currentUrl);
  if (discovered.has(normalized)) return;
  discovered.add(normalized);
  
  // 현재 페이지 크롤링
  const links = await this.discoverFromLinks(currentUrl, options);
  
  // 각 링크에 대해 재귀 호출
  for (const link of links) {
    const linkDepth = calculateDepth(baseUrl, link.url);
    if (linkDepth <= options.maxDepth) {
      results.push(link);
      await this.discoverSubPagesRecursiveDFS(
        baseUrl,
        link.url,
        linkDepth,
        options,
        discovered,
        results
      );
    }
  }
}
```

#### 장점
- ✅ 메모리 효율적 (스택 기반)
- ✅ 깊은 경로를 먼저 탐색

#### 단점
- ❌ 시간이 오래 걸림
- ❌ 순차 처리로 인한 느린 속도
- ❌ 스택 오버플로우 위험 (깊은 재귀)

---

### 방법 3: 병렬 BFS 방식 (권장)

#### 개념
```
시드: https://ads.naver.com/ (깊이 0)
  ↓
1단계: 시드에서 링크 추출 (깊이 1) - 병렬 처리
  [동시에 여러 페이지 크롤링]
  - /start 크롤링
  - /sa 크롤링
  - /sub 크롤링
  ↓
2단계: 깊이 1 페이지들에서 링크 추출 (깊이 2) - 병렬 처리
  [동시에 여러 페이지 크롤링]
  ...
```

#### 구현 구조
```typescript
async discoverSubPagesRecursiveParallel(
  baseUrl: string,
  options: CrawlOptions
): Promise<DiscoveredUrl[]> {
  const discovered = new Set<string>();
  const results: DiscoveredUrl[] = [];
  const maxDepth = options.maxDepth || 3;
  const concurrency = options.concurrency || 3;
  
  // 각 깊이별로 처리
  let currentLevel: Array<{ url: string; depth: number }> = [
    { url: baseUrl, depth: 0 }
  ];
  
  for (let depth = 0; depth < maxDepth; depth++) {
    const nextLevel: Array<{ url: string; depth: number }> = [];
    
    // 현재 레벨의 모든 URL을 병렬로 처리
    const batches = chunkArray(currentLevel, concurrency);
    
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async ({ url }) => {
          const normalized = normalizeUrl(url);
          if (discovered.has(normalized)) return [];
          discovered.add(normalized);
          
          // 페이지 크롤링 및 링크 추출
          const links = await this.discoverFromLinks(url, options);
          
          // 다음 레벨에 추가할 링크 필터링
          const validLinks = links.filter(link => {
            const linkDepth = calculateDepth(baseUrl, link.url);
            return linkDepth === depth + 1; // 정확히 다음 깊이만
          });
          
          results.push(...validLinks);
          
          // 다음 레벨 큐에 추가
          return validLinks.map(link => ({
            url: link.url,
            depth: depth + 1
          }));
        })
      );
      
      // 다음 레벨 큐에 추가
      batchResults.forEach(levelLinks => {
        nextLevel.push(...levelLinks);
      });
    }
    
    currentLevel = nextLevel;
    
    // 다음 레벨이 없으면 종료
    if (currentLevel.length === 0) break;
  }
  
  return results;
}
```

#### 장점
- ✅ 병렬 처리로 속도 향상
- ✅ 깊이별로 체계적 관리
- ✅ 중복 방지
- ✅ 메모리 효율적 (깊이별로 처리)

#### 단점
- ❌ 여전히 시간이 걸림 (각 페이지 크롤링 필요)
- ❌ 서버 부하 증가
- ❌ 구현 복잡도 증가

---

### 방법 4: 하이브리드 방식 (사이트맵 + 재귀)

#### 개념
```
1. 사이트맵에서 가능한 많은 URL 발견
2. 사이트맵에 없는 URL만 재귀적으로 크롤링
3. 두 결과를 병합
```

#### 구현 구조
```typescript
async discoverSubPagesHybrid(
  baseUrl: string,
  options: CrawlOptions
): Promise<DiscoveredUrl[]> {
  // 1. 사이트맵에서 URL 발견
  const sitemapUrls = await this.discoverFromSitemap(baseUrl, options);
  const sitemapUrlSet = new Set(sitemapUrls.map(u => normalizeUrl(u.url)));
  
  // 2. 시드 URL에서 링크 추출
  const seedLinks = await this.discoverFromLinks(baseUrl, options);
  
  // 3. 사이트맵에 없는 URL만 재귀적으로 크롤링
  const recursiveUrls: DiscoveredUrl[] = [];
  const discovered = new Set<string>();
  
  for (const link of seedLinks) {
    const normalized = normalizeUrl(link.url);
    
    // 사이트맵에 있으면 스킵
    if (sitemapUrlSet.has(normalized)) continue;
    
    // 재귀적으로 크롤링 (제한적)
    const subLinks = await this.discoverFromLinksRecursive(
      link.url,
      baseUrl,
      1, // 현재 깊이
      options.maxDepth || 3,
      discovered
    );
    
    recursiveUrls.push(...subLinks);
  }
  
  // 4. 결과 병합
  return [...sitemapUrls, ...recursiveUrls];
}
```

#### 장점
- ✅ 사이트맵 활용으로 효율성 향상
- ✅ 재귀 크롤링은 필요한 경우만 수행
- ✅ 시간 절약

#### 단점
- ❌ 사이트맵이 없거나 불완전한 경우 효과 제한
- ❌ 구현 복잡도 증가

---

## 무한 루프 방지 전략

### 1. 중복 URL 체크
```typescript
const discovered = new Set<string>();

// 정규화된 URL로 중복 체크
const normalized = normalizeUrl(url);
if (discovered.has(normalized)) {
  continue; // 이미 처리한 URL 스킵
}
discovered.add(normalized);
```

### 2. 깊이 제한
```typescript
if (currentDepth >= maxDepth) {
  return; // 최대 깊이 도달 시 중단
}
```

### 3. 순환 링크 감지
```typescript
const visitedInPath = new Set<string>(); // 현재 경로에서 방문한 URL

function isCircular(url: string, path: string[]): boolean {
  return path.includes(normalizeUrl(url));
}
```

### 4. 최대 페이지 수 제한
```typescript
const MAX_PAGES = 1000;
if (discovered.size >= MAX_PAGES) {
  console.warn('최대 페이지 수 도달, 크롤링 중단');
  break;
}
```

---

## 성능 최적화 방안

### 1. 캐싱
```typescript
// 이미 크롤링한 페이지는 캐시에서 링크 정보 가져오기
const cached = cacheManager.get(url);
if (cached && cached.discoveredUrls) {
  return cached.discoveredUrls;
}
```

### 2. 병렬 처리 제한
```typescript
const concurrency = 3; // 동시에 최대 3개 페이지만 크롤링
// 서버 부하 방지
```

### 3. 타임아웃 설정
```typescript
const timeout = 30000; // 페이지당 30초 타임아웃
// 느린 페이지에서 무한 대기 방지
```

### 4. 우선순위 큐
```typescript
// 중요한 페이지(같은 도메인, 짧은 경로)를 먼저 처리
const priorityQueue = new PriorityQueue((a, b) => {
  // 우선순위 계산
  return calculatePriority(a) - calculatePriority(b);
});
```

---

## 구현 시 고려사항

### 1. API 구조 변경
```typescript
// 현재
discoverSubPages(baseUrl, options): Promise<DiscoveredUrl[]>

// 변경 후
discoverSubPagesRecursive(
  baseUrl, 
  options: {
    ...options,
    recursive: true, // 재귀 모드 활성화
    maxRecursiveDepth: 3 // 재귀 깊이 제한
  }
): Promise<DiscoveredUrl[]>
```

### 2. 진행률 표시
```typescript
onProgress?: (progress: {
  currentDepth: number;
  currentUrl: string;
  discoveredCount: number;
  queueSize: number;
}) => void
```

### 3. 에러 처리
```typescript
// 일부 페이지 실패해도 계속 진행
try {
  const links = await this.discoverFromLinks(url, options);
} catch (error) {
  console.warn(`페이지 크롤링 실패: ${url}`, error);
  continue; // 다음 페이지로 진행
}
```

### 4. 메모리 관리
```typescript
// 깊이별로 처리하여 메모리 사용량 제한
// 처리 완료된 깊이는 메모리에서 해제
```

---

## 추천 방안

### 🏆 권장: 병렬 BFS 방식 (방법 3)

**이유**:
1. ✅ 성능: 병렬 처리로 속도 향상
2. ✅ 제어: 깊이별로 명확한 제어 가능
3. ✅ 확장성: concurrency 옵션으로 조절 가능
4. ✅ 안정성: 중복 방지 및 무한 루프 방지 용이

### 구현 우선순위
1. **1단계**: 기본 재귀 구조 구현 (BFS)
2. **2단계**: 병렬 처리 추가
3. **3단계**: 캐싱 및 최적화
4. **4단계**: 하이브리드 방식 (사이트맵 활용)

### 옵션 설계
```typescript
interface CrawlOptions {
  // 기존 옵션
  maxDepth: number;
  discoverSubPages: boolean;
  
  // 새로운 옵션
  recursiveDiscovery?: boolean; // 재귀 모드 활성화
  maxRecursiveDepth?: number; // 재귀 깊이 제한 (maxDepth와 별도)
  recursiveConcurrency?: number; // 재귀 크롤링 병렬 처리 수
  maxRecursivePages?: number; // 최대 재귀 크롤링 페이지 수
}
```

---

## 예상 문제점 및 해결책

### 문제 1: 시간이 너무 오래 걸림
**해결책**:
- 병렬 처리로 속도 향상
- 캐싱 활용
- 타임아웃 설정

### 문제 2: 서버 부하
**해결책**:
- concurrency 제한
- 요청 간격 추가
- robots.txt 준수

### 문제 3: 무한 루프
**해결책**:
- 중복 URL 체크
- 깊이 제한
- 최대 페이지 수 제한

### 문제 4: 메모리 부족
**해결책**:
- 깊이별로 처리 (한 번에 하나의 깊이만)
- 처리 완료된 데이터는 즉시 해제
- 스트리밍 방식으로 결과 반환

---

## 결론

재귀적 하위 페이지 링크 추출은 **기술적으로 가능**하지만, 다음 사항을 고려해야 합니다:

1. **성능**: 각 페이지를 크롤링해야 하므로 시간이 오래 걸림
2. **서버 부하**: 많은 요청으로 인한 서버 부하
3. **구현 복잡도**: 무한 루프 방지, 중복 체크 등 복잡한 로직 필요
4. **사용자 경험**: 진행률 표시 및 취소 기능 필요

**권장 사항**: 
- 기본적으로는 현재 방식 유지 (시드 URL에서만 링크 추출)
- 필요시에만 재귀 모드를 옵션으로 제공
- 사용자가 명시적으로 요청할 때만 활성화

