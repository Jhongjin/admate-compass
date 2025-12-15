# maxDepth 3, 도메인 제한 해제 크롤링 결과 분석

## 문제 상황

- **크롤링된 문서 수**: 29개 (상대적으로 적음)
- **하위 도메인**: 0개로 표시됨
- **의문점**:
  1. 실제로 하위 도메인이 0개인가?
  2. 프론트엔드/백엔드 동기화 문제인가?
  3. maxDepth 3, 도메인 제한 해제 로직이 정상 작동했는가?

## 분석 방법

### 1. 백엔드 DB 직접 확인

`supabase/analyze_maxdepth3_crawl.sql` 파일의 쿼리를 실행하여:

1. **작업 상태 확인**: 최근 CRAWL_SEED 작업의 상태, 에러, 결과 확인
2. **도메인 분포 확인**: 실제 크롤링된 문서의 도메인별 분포
3. **하위 도메인 확인**: `ads.naver.com`의 하위 도메인이 실제로 있는지 확인
4. **타임아웃 여부**: 타임아웃으로 인해 중단되었는지 확인

### 2. 크롤링 로직 검증

#### maxDepth 3, domainLimit false일 때의 로직:

```typescript
// UrlDiscovery.ts - filterAndSort 메서드
if (maxDepth >= 3) {
  if (config.domainLimit === true) {
    // domainLimit이 true면 하위 도메인도 제외 (같은 도메인만)
    return false;
  } else {
    // domainLimit이 false면 하위 도메인 허용
    if (!this.isSubdomain(urlDomain, baseDomain)) {
      return false;
    }
  }
}
```

**예상 동작**:
- `ads.naver.com`과 정확히 같은 도메인: ✅ 허용
- `sub.ads.naver.com` (하위 도메인): ✅ 허용
- `naver.com` (상위 도메인): ❌ 제외
- `other.com` (다른 도메인): ❌ 제외

### 3. 하위 도메인 0개인 이유 분석

#### 가능한 원인:

1. **실제로 하위 도메인이 없음**
   - `ads.naver.com` 내부에서 발견된 모든 URL이 `ads.naver.com` 도메인
   - 사이트맵이나 페이지 링크에 하위 도메인 URL이 없음

2. **프론트엔드 계산 로직 문제**
   ```typescript
   // page.tsx - domainStats 계산
   if (docDomain === baseDomain) {
     sameDomainCount++;
   } else if (docDomain.endsWith(`.${baseDomain}`)) {
     subdomainCount++;
   }
   ```
   - 이 로직은 정상적으로 보임
   - `sub.ads.naver.com.endsWith('.ads.naver.com')` → `true`

3. **백엔드 필터링 문제**
   - 크롤링 중 하위 도메인 URL이 필터링되었을 가능성
   - `isSubdomain` 체크가 제대로 작동하지 않았을 가능성

## 확인 사항

### SQL 쿼리 실행 결과 확인:

1. **도메인별 문서 분포** (쿼리 3번)
   - `ads.naver.com`: 기본 도메인 문서 수
   - `*.ads.naver.com`: 하위 도메인 문서 수
   - 기타 도메인: 다른 도메인 문서 수

2. **하위 도메인 상세 확인** (쿼리 4번)
   - 실제 hostname 목록 확인
   - 하위 도메인이 있는지 확인

3. **작업 결과 확인** (쿼리 5번)
   - 발견된 URL 수 (`subPageCount`)
   - 타임아웃 여부
   - 부분 성공 여부

## 예상 결과

### 시나리오 1: 정상 작동 (하위 도메인 실제로 없음)
- 도메인 분포: `ads.naver.com`만 존재
- 하위 도메인: 실제로 0개
- **결론**: 로직 정상, 사이트에 하위 도메인 없음

### 시나리오 2: 필터링 문제
- 도메인 분포: `ads.naver.com`만 존재하지만, 작업 결과에는 하위 도메인 URL이 발견됨
- 하위 도메인: 필터링되어 제외됨
- **결론**: 백엔드 필터링 로직 문제

### 시나리오 3: 타임아웃으로 인한 부분 크롤링
- 작업 상태: `completed` (부분 성공) 또는 `failed`
- 타임아웃 플래그: `true`
- 인덱싱된 문서 수: 29개 (전체보다 적음)
- **결론**: 타임아웃으로 인해 일부만 크롤링됨

## 다음 단계

1. **SQL 쿼리 실행**: `supabase/analyze_maxdepth3_crawl.sql` 실행
2. **결과 분석**: 도메인 분포, 하위 도메인 존재 여부 확인
3. **로직 검증**: 필요시 백엔드 필터링 로직 수정
4. **타임아웃 개선**: 타임아웃 발생 시 더 많은 페이지 크롤링 가능하도록 개선






