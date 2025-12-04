# 크롤링 완료되지 않는 문제 분석 (maxDepth 2)

## 문제 현상

- 작업 상태가 `processing`에서 멈춤
- 작업 ID: `cd29e2a6-b86a-4570-81b8-59797a70ce47`
- maxDepth: 2
- 문서 1개만 인덱싱됨 (PDF 파일)
- 진행률: 약 40%에서 멈춤

## 코드 분석 결과

### 작업 완료 조건

작업이 `completed` 상태로 변경되려면 다음 조건을 모두 만족해야 합니다:

1. **메인 페이지 크롤링 완료**
   - `mainDocResult.success === true`
   - `mainDocResult.chunkCount > 0`

2. **하위 페이지 크롤링 완료** (extractSubPages가 true인 경우)
   - 하위 페이지 발견 및 크롤링 완료
   - 모든 하위 페이지 처리 완료 (completed 또는 failed)

3. **작업 상태 업데이트 성공**
   - `processing_jobs` 테이블 업데이트 성공
   - 상태가 `processing`, `queued`, `retrying` 중 하나여야 함

### 작업 완료 로직 위치

**파일**: `src/app/api/jobs/consume/route.ts`

**완료 로직 시작**: 4152줄
```typescript
// 4. processing_jobs 업데이트 (메인 문서가 indexed인 경우만 completed)
const finalDocumentStatus = 'indexed';
const jobUpdateData: any = {
  status: 'completed',
  finished_at: new Date().toISOString(),
  result: {
    ...finishedResult,
    documentsUpdated: {
      main: mainDocUpdated,
      subPages: subPageUpdateResults.filter(r => r.success).length,
      totalSubPages: subPageUpdateResults.length
    },
    finalDocumentStatus,
    verifiedAt: new Date().toISOString()
  },
};
```

**상태 업데이트**: 4174-4215줄
```typescript
const { error: updateError, data: updateData } = await supabase
  .from('processing_jobs')
  .update(jobUpdateData)
  .eq('id', job.id)
  .in('status', ['processing', 'queued', 'retrying'])
  .select('id, status, document_id, finished_at');

if (!updateData || updateData.length === 0) {
  // 작업 상태 업데이트 실패: 이미 다른 상태이거나 취소됨
  console.warn('[CRITICAL] ⚠️ 작업 상태 업데이트 실패...');
}
```

## 가능한 원인 분석

### 원인 1: 하위 페이지 크롤링이 완료되지 않음

**증상:**
- `extractSubPages: true`인데 하위 페이지가 발견되지 않음
- 하위 페이지가 발견되었지만 처리 중 멈춤
- 하위 페이지 처리 중 에러 발생

**코드 위치**: 2573-3593줄
```typescript
if (extractSubPages) {
  // 하위 페이지 크롤링 시작
  const discovered = await sitemapDiscoveryService.discoverSubPages(...);
  
  // 하위 페이지 병렬 처리
  for (const batch of batches) {
    await Promise.all(batch.map(async (subUrl) => {
      // 각 하위 페이지 크롤링 및 인덱싱
    }));
  }
}
```

**maxDepth 2일 때 문제:**
- maxDepth 2는 같은 도메인만 허용
- 하위 페이지가 발견되지 않을 수 있음
- 발견된 하위 페이지가 필터링되어 처리할 페이지가 없을 수 있음

**확인 방법:**
- 콘솔 로그에서 `[CRITICAL] 🔍 하위 페이지 탐색 옵션:` 확인
- `[CRITICAL] 📄 하위 페이지 후보:` 로그 확인
- `[CRITICAL] 📊 진행 상황 업데이트:` 로그 확인

### 원인 2: 작업 상태 업데이트 실패

**증상:**
- 작업이 이미 다른 상태로 변경됨
- 데이터베이스 업데이트 실패
- 트랜잭션 충돌

**코드 위치**: 4174-4215줄
```typescript
const { error: updateError, data: updateData } = await supabase
  .from('processing_jobs')
  .update(jobUpdateData)
  .eq('id', job.id)
  .in('status', ['processing', 'queued', 'retrying'])
  .select('id, status, document_id, finished_at');

if (!updateData || updateData.length === 0) {
  // 작업 상태 업데이트 실패
  console.warn('[CRITICAL] ⚠️ 작업 상태 업데이트 실패...');
}
```

**확인 방법:**
- 콘솔 로그에서 `[CRITICAL] ⚠️ 작업 상태 업데이트 실패` 확인
- 데이터베이스에서 작업 상태 직접 확인

### 원인 3: 에러 발생 후 처리되지 않음

**증상:**
- 에러가 발생했지만 catch 블록에서 처리되지 않음
- 에러 로그가 출력되지 않음
- 작업이 무한 대기 상태

**코드 위치**: 4222-4248줄
```typescript
} catch (crawlError) {
  console.error('❌ CRAWL_SEED 처리 오류:', crawlError);
  // 에러 처리 로직
}
```

**확인 방법:**
- 콘솔 로그에서 `❌ CRAWL_SEED 처리 오류:` 확인
- 에러 스택 트레이스 확인

### 원인 4: 큐 처리 로직이 실행되지 않음

**증상:**
- 큐 처리 API가 호출되지 않음
- 큐 처리 중 타임아웃 발생
- 큐 처리 중 에러 발생

**확인 방법:**
- Vercel 로그에서 큐 처리 API 호출 확인
- 큐 처리 API 응답 확인

## 해결 방안

### 방안 1: 하위 페이지 크롤링 완료 확인 강화

**문제:**
- 하위 페이지가 없을 때 작업이 완료되지 않음
- 하위 페이지 처리 중 에러 발생 시 작업이 멈춤

**해결:**
```typescript
// 하위 페이지가 없을 때도 작업 완료 처리
if (candidateUrls.length === 0) {
  console.log('[CRITICAL] ✅ 하위 페이지가 없으므로 작업 완료 처리');
  // 작업 완료 로직 실행
}
```

### 방안 2: 작업 상태 업데이트 재시도 로직 추가

**문제:**
- 작업 상태 업데이트가 실패하면 작업이 멈춤

**해결:**
```typescript
// 작업 상태 업데이트 재시도 로직
let retryCount = 0;
const maxRetries = 3;

while (retryCount < maxRetries) {
  const { error, data } = await supabase
    .from('processing_jobs')
    .update(jobUpdateData)
    .eq('id', job.id)
    .in('status', ['processing', 'queued', 'retrying'])
    .select('id, status');
  
  if (data && data.length > 0) {
    break; // 성공
  }
  
  retryCount++;
  await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
}
```

### 방안 3: 타임아웃 처리 추가

**문제:**
- 작업이 무한 대기 상태

**해결:**
```typescript
// 작업 타임아웃 설정
const JOB_TIMEOUT = 30 * 60 * 1000; // 30분
const jobStartTime = new Date(job.created_at).getTime();
const currentTime = Date.now();

if (currentTime - jobStartTime > JOB_TIMEOUT) {
  // 작업 타임아웃 처리
  await supabase
    .from('processing_jobs')
    .update({ status: 'failed', finished_at: new Date().toISOString() })
    .eq('id', job.id);
  throw new Error('작업 타임아웃');
}
```

### 방안 4: 작업 완료 조건 완화

**문제:**
- 하위 페이지가 없을 때도 작업이 완료되지 않음

**해결:**
```typescript
// 하위 페이지가 없거나 모든 하위 페이지가 처리 완료되면 작업 완료
const allSubPagesProcessed = 
  candidateUrls.length === 0 || 
  Array.from(subPageStatusMap.values()).every(s => 
    s.status === 'completed' || s.status === 'failed'
  );

if (allSubPagesProcessed) {
  // 작업 완료 처리
}
```

## 권장 해결 순서

1. **즉시 확인**: Vercel 로그에서 에러 메시지 확인
2. **하위 페이지 크롤링 확인**: 콘솔 로그에서 하위 페이지 발견 여부 확인
3. **작업 상태 확인**: 데이터베이스에서 작업 상태 직접 확인
4. **에러 처리 강화**: 에러 발생 시 작업 상태를 `failed`로 변경
5. **타임아웃 처리 추가**: 무한 대기 방지

## 디버깅 체크리스트

- [ ] Vercel 로그에서 `[CRITICAL]` 로그 확인
- [ ] 하위 페이지 발견 로그 확인 (`[CRITICAL] 🔍 하위 페이지 탐색 옵션:`)
- [ ] 하위 페이지 후보 로그 확인 (`[CRITICAL] 📄 하위 페이지 후보:`)
- [ ] 진행 상황 업데이트 로그 확인 (`[CRITICAL] 📊 진행 상황 업데이트:`)
- [ ] 작업 상태 업데이트 로그 확인 (`[CRITICAL] ✅ 작업 상태 업데이트 완료:`)
- [ ] 에러 로그 확인 (`❌ CRAWL_SEED 처리 오류:`)
- [ ] 데이터베이스에서 작업 상태 직접 확인

