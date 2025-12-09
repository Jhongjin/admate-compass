# 크롤된 문서 31개 표시 원인 분석

## 📊 상황 요약

- **현상**: 새로 배포 후 크롤 페이지 접속 시 31개 문서가 표시됨
- **전제**: 전 배포 후 새로 크롤을 진행한 적 없음
- **의문**: 이전 크롤 작업이 실제로 완료되었는지, 아니면 계속 처리 중이었는지

---

## 🔍 가능성 분석

### 가능성 1: 백엔드에서 작업이 완료되었으나 프론트엔드에서 표시되지 않음 ⚠️ **가장 가능성 높음**

#### 원인 분석

**1. 프론트엔드 폴링 로직 문제**

```typescript:src/app/test/crawl-to-index/page.tsx
// 작업 상태 조회 (2초마다 폴링)
const { data: jobStatus, refetch: refetchJob } = useQuery({
  queryKey: ['job-status', jobId],
  refetchInterval: (query) => {
    if (data?.status === 'completed' || data?.status === 'failed') {
      return false; // 폴링 중지
    }
    return 2000; // 2초마다 폴링
  },
});
```

**문제점:**
- 작업이 `completed` 상태가 되면 폴링이 중지됨
- 하지만 문서 목록은 별도로 3초마다 조회됨
- 작업 완료 후 문서 목록이 업데이트되기 전에 사용자가 페이지를 떠났을 수 있음

**2. 문서 목록 조회 타이밍 문제**

```typescript:src/app/test/crawl-to-index/page.tsx
// 문서 목록 조회 (3초마다 자동 새로고침)
const { data: documentsData, refetch: refetchDocuments } = useQuery({
  queryKey: ['test-documents'],
  queryFn: async () => {
    const res = await fetch(`/api/admin/upload-new?limit=200&status=indexed&_t=${cacheBuster}`, {
      cache: 'no-store',
    });
    // ...
  },
  refetchInterval: 3000, // 3초마다 새로고침
});
```

**문제점:**
- 문서 목록은 3초마다 조회되지만, 작업 완료 후 즉시 조회되지 않을 수 있음
- 사용자가 페이지를 떠났다가 다시 접속하면 새로 조회됨

**3. 작업 완료 후 문서 목록 업데이트 지연**

백엔드에서 작업이 완료되어도:
- 문서가 `indexed` 상태로 업데이트되는 데 시간이 걸릴 수 있음
- 하위 페이지 크롤링이 완료되어야 메인 문서가 `indexed`로 변경됨
- 프론트엔드가 작업 완료를 감지했지만 문서 목록이 아직 업데이트되지 않았을 수 있음

#### 증거 확인 방법

```sql
-- 최근 CRAWL_SEED 작업 완료 시간 확인
SELECT 
  id,
  status,
  created_at,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds,
  payload->>'url' as url
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'completed'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY finished_at DESC
LIMIT 5;

-- 해당 작업으로 생성된 문서 확인
SELECT 
  id,
  title,
  url,
  status,
  created_at,
  updated_at,
  chunk_count
FROM documents
WHERE (
  url LIKE '%ko-kr.facebook.com%'
  OR main_document_id IN (
    SELECT document_id FROM processing_jobs 
    WHERE job_type = 'CRAWL_SEED' 
      AND status = 'completed'
      AND created_at >= NOW() - INTERVAL '7 days'
  )
)
ORDER BY created_at DESC
LIMIT 50;
```

---

### 가능성 2: 백엔드에서 계속 처리 중이었고 최근에 완료됨

#### 원인 분석

**1. 작업이 오래 걸림**

- Facebook 크롤링은 시간이 오래 걸릴 수 있음
- 하위 페이지 크롤링이 많으면 더 오래 걸림
- 타임아웃이 5분이므로 작업이 완료되기 전에 타임아웃될 수 있음

**2. 부분 성공 처리**

```typescript:src/app/api/jobs/consume/route.ts
// 타임아웃인 경우: 부분 성공 확인
if (isTimeout && documentId) {
  const { data: indexedDocs } = await supabase
    .from('documents')
    .select('id, url, status, chunk_count, main_document_id')
    .or(`id.eq.${documentId},main_document_id.eq.${documentId}`)
    .eq('status', 'indexed')
    .gt('chunk_count', 0);
  
  // 하나라도 성공했다면 completed로 처리 (부분 성공)
  if (indexedCount > 0) {
    // completed로 처리
  }
}
```

**문제점:**
- 타임아웃이 발생해도 부분 성공한 문서가 있으면 `completed`로 처리됨
- 하지만 프론트엔드는 타임아웃 에러를 받아서 실패로 표시했을 수 있음

**3. 작업이 여러 번 재시도됨**

- 작업이 실패하면 재시도될 수 있음
- 재시도 중에 일부 문서는 성공적으로 인덱싱됨
- 최종적으로 작업이 완료되면 모든 문서가 표시됨

#### 증거 확인 방법

```sql
-- 작업 재시도 이력 확인
SELECT 
  id,
  status,
  attempts,
  max_attempts,
  created_at,
  started_at,
  finished_at,
  payload->>'url' as url
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND payload->>'url' LIKE '%ko-kr.facebook.com%'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

---

### 가능성 3: 프론트엔드 캐시 문제

#### 원인 분석

**1. React Query 캐시**

```typescript:src/app/test/crawl-to-index/page.tsx
const { data: documentsData, refetch: refetchDocuments } = useQuery({
  queryKey: ['test-documents'],
  // 캐시 버스팅을 위한 타임스탬프 추가
  queryFn: async () => {
    const cacheBuster = Date.now();
    const res = await fetch(`/api/admin/upload-new?limit=200&status=indexed&_t=${cacheBuster}`, {
      cache: 'no-store',
    });
  },
});
```

**문제점:**
- 캐시 버스팅을 사용하지만, 브라우저 캐시나 네트워크 캐시가 남아있을 수 있음
- 페이지를 새로고침하거나 재접속하면 캐시가 무효화되어 새로 조회됨

**2. 브라우저 캐시**

- 브라우저가 API 응답을 캐시했을 수 있음
- 새로 배포 후 브라우저가 새로 요청하면서 실제 데이터를 받음

---

### 가능성 4: 백엔드 문서 목록 API의 동기화 로직

#### 원인 분석

**1. 실시간 동기화 로직**

```typescript:src/app/api/admin/upload-new/route.ts
// pending 상태 문서와 작업 상태 동기화
if (jobStatus === 'completed' && result?.chunkCount > 0) {
  await supabase
    .from('documents')
    .update({
      status: 'indexed',
      chunk_count: result.chunkCount,
      updated_at: new Date().toISOString()
    })
    .eq('id', doc.id)
    .eq('status', 'pending');
}
```

**문제점:**
- 문서 목록 API가 호출될 때마다 작업 상태를 확인하고 문서 상태를 동기화함
- 이전에는 동기화가 되지 않았지만, 새로 배포 후 API가 호출되면서 동기화됨
- 동기화된 문서들이 목록에 표시됨

**2. 하위 페이지 완료 후 메인 문서 업데이트**

```typescript:src/app/api/admin/upload-new/route.ts
// 하위 페이지가 모두 완료되면 메인 문서도 indexed로 업데이트
if (completedSubPages.length === allSubPages.length && completedSubPages.length > 0) {
  await supabase
    .from('documents')
    .update({
      status: 'indexed',
      chunk_count: totalSubPageChunks,
      updated_at: new Date().toISOString()
    })
    .eq('id', mainDoc.id);
}
```

**문제점:**
- 하위 페이지가 완료되어도 메인 문서가 즉시 업데이트되지 않을 수 있음
- 문서 목록 API가 호출될 때 업데이트됨

---

## 🎯 결론 및 확인 방법

### 가장 가능성 높은 시나리오 ⭐

**시나리오 1: 백엔드 작업 완료 + 프론트엔드 표시 누락 (90% 확률)**

**상세 시나리오:**

1. **이전 크롤 작업이 백엔드에서 성공적으로 완료됨**
   - 작업이 `completed` 상태로 전환됨
   - 문서들이 `indexed` 상태로 저장됨
   - 총 31개 문서가 생성됨

2. **프론트엔드에서 표시되지 않은 이유:**
   
   **A. 작업 완료 감지 실패**
   ```typescript
   // 작업 상태 폴링이 중지되어 완료를 감지하지 못함
   if (data?.status === 'completed' || data?.status === 'failed') {
     return false; // 폴링 중지
   }
   ```
   - 작업이 완료되면 폴링이 중지됨
   - 하지만 문서 목록은 별도로 3초마다 조회됨
   - 작업 완료 후 문서 목록 refetch가 실패했을 수 있음
   
   **B. 문서 목록 조회 타이밍 문제**
   ```typescript
   // 문서 목록은 3초마다 자동 새로고침
   refetchInterval: isDeleting ? false : 3000
   ```
   - 작업 완료 후 문서 목록이 업데이트되기 전에 사용자가 페이지를 떠났을 수 있음
   - 또는 문서 목록 refetch가 실패했을 수 있음
   
   **C. 사용자 페이지 이탈**
   - 작업이 완료되기 전에 사용자가 페이지를 떠남
   - 작업은 백그라운드에서 계속 진행되어 완료됨
   - 사용자가 다시 접속하지 않아서 완료된 문서를 보지 못함

3. **새로 배포 후 페이지 재접속 시:**
   - 페이지가 새로 로드되면서 문서 목록이 새로 조회됨
   - 이미 `indexed` 상태로 저장된 31개 문서가 조회됨
   - 문서 목록에 표시됨

**시나리오 2: 백엔드 작업이 계속 진행 중이었고 최근에 완료됨 (10% 확률)**

1. 이전 크롤 작업이 오래 걸려서 계속 진행 중이었음
2. 최근에 작업이 완료되어 문서들이 `indexed` 상태로 업데이트됨
3. 새로 배포 후 페이지 접속 시 완료된 문서들이 표시됨

### 확인 방법

다음 SQL 쿼리들을 실행하여 정확한 원인을 파악하세요:

**1. 종합 분석 쿼리 (권장)**
```sql
-- supabase/analyze_31_documents_mystery.sql 실행
-- 작업 완료 시간, 문서 생성 시간, 타이밍 분석 포함
```

**2. 최근 CRAWL_SEED 작업 완료 시간 확인**
```sql
-- supabase/check_recent_crawl_completion.sql 실행
```

**3. 최근 Facebook 문서 생성 시간 확인**
```sql
-- supabase/check_recent_facebook_documents.sql 실행
```

**4. 작업 완료 시간과 문서 생성 시간 비교**
```sql
SELECT 
  pj.id as job_id,
  pj.status,
  pj.finished_at as job_finished_at,
  MIN(d.created_at) as first_doc_created,
  MAX(d.updated_at) as last_doc_updated,
  COUNT(d.id) as doc_count,
  -- 작업 완료 전에 생성된 문서 수
  COUNT(CASE WHEN d.created_at < pj.finished_at THEN 1 END) as docs_before_finish,
  -- 작업 완료 후에 생성된 문서 수
  COUNT(CASE WHEN d.created_at >= pj.finished_at THEN 1 END) as docs_after_finish
FROM processing_jobs pj
LEFT JOIN documents d ON (
  d.id = pj.document_id 
  OR d.main_document_id = pj.document_id
)
WHERE pj.job_type = 'CRAWL_SEED'
  AND pj.payload->>'url' LIKE '%ko-kr.facebook.com%'
  AND pj.created_at >= NOW() - INTERVAL '7 days'
  AND pj.finished_at IS NOT NULL
GROUP BY pj.id, pj.status, pj.finished_at
ORDER BY pj.finished_at DESC
LIMIT 5;
```

**확인 포인트:**
- `job_finished_at`: 작업이 언제 완료되었는지
- `first_doc_created`: 첫 문서가 언제 생성되었는지
- `docs_before_finish` vs `docs_after_finish`: 작업 완료 전/후 문서 생성 비율
- 작업 완료 시간이 배포 전인지 배포 후인지 확인

---

## 🔧 개선 방안

### 1. 프론트엔드 폴링 개선

- 작업 완료 후 문서 목록을 즉시 조회
- 작업 완료 감지 시 문서 목록 refetch 강제 실행

### 2. 문서 목록 조회 개선

- 작업 완료 후 문서 목록 조회 간격 단축
- 작업 완료 감지 시 즉시 문서 목록 조회

### 3. 백엔드 동기화 개선

- 작업 완료 시 문서 상태를 즉시 업데이트
- 하위 페이지 완료 시 메인 문서 상태 즉시 업데이트

### 4. 사용자 피드백 개선

- 작업 진행 상황을 더 명확하게 표시
- 작업 완료 후 문서 목록 자동 새로고침

