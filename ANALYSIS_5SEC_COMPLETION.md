# 작업 5초 완료 원인 분석

## 문제 상황

**작업 ID**: `b379f7bf-e11b-4518-82a5-4cbe5595aaaf`
- **상태**: `completed`
- **실행 시간**: 5.173초 (비정상적으로 짧음)
- **에러**: `NULL`
- **타임아웃 플래그**: `NULL`
- **인덱싱된 문서 수**: `NULL`

## 가능한 원인

### 1. `extractSubPages`가 `false`로 전달됨

코드 로직:
```typescript
if (extractSubPages) {
  // 하위 페이지 크롤링
} else {
  console.log('[CRITICAL] ℹ️ 하위 페이지 크롤링 건너뜀 - extractSubPages가 false입니다.');
  subPageResults = [];
}
```

**확인 방법**: 작업 결과의 `result` JSON에서 `extractSubPages` 값 확인

### 2. 하위 페이지 탐색 실패

코드 로직:
```typescript
try {
  discovered = await sitemapDiscoveryService.discoverSubPages(url, discoveryOptions, mainPage.htmlContent);
} catch (discoveryError) {
  console.error('[CRITICAL] ⚠️ 하위 페이지 탐색 중 오류 발생, 메인 페이지만 처리합니다:');
  discovered = [];
}
```

**확인 방법**: 
- Vercel 로그에서 `[CRITICAL] ⚠️ 하위 페이지 탐색 중 오류 발생` 메시지 확인
- 작업 결과의 `result->>'subPageCount'` 확인

### 3. 발견된 URL이 모두 필터링됨

코드 로직:
```typescript
if (candidateUrls.length === 0 && discovered.length > 0) {
  console.warn('[CRITICAL] ⚠️ 발견된 하위 페이지가 모두 필터링되었습니다.');
}
```

**확인 방법**:
- 작업 결과의 `result->'subPages'` 배열 확인
- `discovered.length` vs `candidateUrls.length` 비교

### 4. 메인 페이지만 처리하고 완료

가능한 시나리오:
- 메인 페이지 처리: ~2-3초
- 하위 페이지 탐색 실패 또는 건너뜀: 즉시 완료
- 총 실행 시간: ~5초

## 확인 사항

### SQL 쿼리 실행 (`supabase/deep_analysis_job_b379f7bf.sql`)

1. **작업 결과 JSON 확인** (쿼리 1번)
   - `result->>'subPageCount'`: 발견된 하위 페이지 수
   - `result->>'crawlTimeMs'`: 실제 크롤링 시간
   - `result->'subPages'`: 하위 페이지 상세 정보

2. **실제 인덱싱된 문서 확인** (쿼리 3번)
   - 작업 시작/종료 시간 사이에 생성된 문서 수
   - 메인 문서 + 하위 페이지 문서

3. **발견된 URL vs 인덱싱된 문서 비교** (쿼리 5번)
   - 작업 결과의 `subPageCount` vs 실제 인덱싱된 문서 수
   - 인덱싱 성공률

### Vercel 로그 확인

다음 로그 메시지들을 확인:

1. **하위 페이지 크롤링 시작 여부**
   ```
   [CRITICAL] ✅ 하위 페이지 크롤링 시작 - extractSubPages가 true입니다.
   ```
   또는
   ```
   [CRITICAL] ℹ️ 하위 페이지 크롤링 건너뜀 - extractSubPages가 false입니다.
   ```

2. **하위 페이지 탐색 결과**
   ```
   [CRITICAL] ✅ 하위 페이지 발견 완료: X개
   ```
   또는
   ```
   [CRITICAL] ⚠️ 하위 페이지 탐색 중 오류 발생
   ```

3. **필터링 경고**
   ```
   [CRITICAL] ⚠️ 발견된 하위 페이지가 모두 필터링되었습니다.
   ```

## 예상 결과

### 시나리오 A: `extractSubPages`가 `false`
- 작업 결과: `subPageCount: 0` 또는 `NULL`
- 실제 문서: 메인 문서 1개만
- **결론**: 프론트엔드에서 `extractSubPages`가 제대로 전달되지 않음

### 시나리오 B: 하위 페이지 탐색 실패
- 작업 결과: `subPageCount: 0`, 에러 메시지 포함
- 실제 문서: 메인 문서 1개만
- Vercel 로그: `[CRITICAL] ⚠️ 하위 페이지 탐색 중 오류 발생`
- **결론**: SitemapDiscoveryService 실패

### 시나리오 C: 모든 URL 필터링됨
- 작업 결과: `subPageCount: X` (X > 0), `candidateUrls.length: 0`
- 실제 문서: 메인 문서 1개만
- Vercel 로그: `[CRITICAL] ⚠️ 발견된 하위 페이지가 모두 필터링되었습니다.`
- **결론**: 필터링 로직 문제 (maxDepth, domainLimit 설정)

## 다음 단계

1. **SQL 쿼리 실행**: `supabase/deep_analysis_job_b379f7bf.sql` 실행
2. **Vercel 로그 확인**: 위의 로그 메시지 확인
3. **원인 파악**: 시나리오 A/B/C 중 어느 것인지 확인
4. **수정**: 원인에 따라 코드 수정








