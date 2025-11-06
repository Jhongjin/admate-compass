# Phase 2 고정 크기 분할 시스템 테스트 가이드

**목적**: Phase 2 구현이 정상적으로 작동하는지 검증

---

## 📋 테스트 전 확인사항

### 1. Phase 1 인프라 확인
다음 SQL로 Phase 1이 완료되었는지 확인:

```sql
SELECT 
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'document_splits') > 0 AS has_table,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document_splits') = 13 AS has_all_columns,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'split_status') > 0 AS has_split_status,
  (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'document_splits' AND schemaname = 'public') >= 3 AS has_indexes,
  (SELECT COUNT(*) FROM pg_constraint WHERE conrelid = 'public.processing_jobs'::regclass AND conname = 'processing_jobs_job_type_check' AND pg_get_constraintdef(oid) LIKE '%CHUNK_PROCESS%') > 0 AS has_chunk_process;
```

**모든 값이 `true`여야 합니다.**

---

## 🧪 테스트 시나리오

### 시나리오 1: 작은 파일 테스트 (10MB 이하)

**목적**: 작은 파일은 기존 로직대로 처리되는지 확인

**테스트 파일**: 5MB 이하 PDF 또는 DOCX

**예상 결과**:
- 분할 로직이 실행되지 않음
- 기존 방식대로 처리됨
- `document_splits` 테이블에 데이터 없음
- `documents.split_status`가 `null`

**확인 방법**:
1. 파일 업로드
2. 처리 완료 대기
3. 다음 SQL 실행:
```sql
-- 분할이 발생하지 않았는지 확인
SELECT COUNT(*) as split_count
FROM document_splits
WHERE document_id = 'YOUR_DOCUMENT_ID';

-- split_status가 null인지 확인
SELECT split_status
FROM documents
WHERE id = 'YOUR_DOCUMENT_ID';
```

---

### 시나리오 2: 큰 파일 테스트 (10MB 이상)

**목적**: 큰 파일이 분할 처리되는지 확인

**테스트 파일**: 10MB 이상 PDF 또는 DOCX (또는 500KB 이상 텍스트)

**예상 결과**:
- 분할 감지 로그 확인
- `document_splits` 테이블에 분할 저장
- `CHUNK_PROCESS` job 등록
- 각 분할이 순차적으로 처리
- 모든 분할 완료 시 문서 상태 `indexed`

**확인 방법**:

#### 2.1 분할 감지 확인
업로드 후 로그에서 다음 메시지 확인:
```
📦 큰 파일 감지 - 분할 처리 시작
✂️ 텍스트 분할 완료
💾 분할 저장 완료
📋 CHUNK_PROCESS job 등록 완료
```

#### 2.2 document_splits 테이블 확인
```sql
-- 분할 개수 및 상태 확인
SELECT 
  split_index,
  split_count,
  status,
  LENGTH(content) as content_length,
  start_char,
  end_char,
  created_at
FROM document_splits
WHERE document_id = 'YOUR_DOCUMENT_ID'
ORDER BY split_index;
```

**예상 결과**: 여러 개의 분할이 `pending` 또는 `processing` 상태

#### 2.3 CHUNK_PROCESS job 확인
```sql
-- CHUNK_PROCESS job 상태 확인
SELECT 
  id,
  document_id,
  status,
  attempts,
  payload->>'split_index' as split_index,
  started_at,
  finished_at,
  result
FROM processing_jobs
WHERE job_type = 'CHUNK_PROCESS'
  AND document_id = 'YOUR_DOCUMENT_ID'
ORDER BY CAST(payload->>'split_index' AS INTEGER);
```

**예상 결과**: 여러 개의 `CHUNK_PROCESS` job이 `queued` 또는 `processing` 상태

#### 2.4 분할 처리 진행 상황 확인
```sql
-- 분할 처리 진행률 확인
SELECT 
  d.id,
  d.title,
  d.status,
  d.split_status,
  COUNT(ds.id) FILTER (WHERE ds.status = 'completed') as completed_splits,
  COUNT(ds.id) FILTER (WHERE ds.status = 'failed') as failed_splits,
  COUNT(ds.id) as total_splits
FROM documents d
LEFT JOIN document_splits ds ON d.id = ds.document_id
WHERE d.split_status IS NOT NULL
GROUP BY d.id, d.title, d.status, d.split_status;
```

**예상 결과**: `completed_splits`가 점진적으로 증가

#### 2.5 최종 완료 확인
모든 분할 처리 완료 후:
```sql
-- 문서 상태 확인
SELECT 
  id,
  title,
  status,
  chunk_count,
  split_status
FROM documents
WHERE id = 'YOUR_DOCUMENT_ID';
```

**예상 결과**:
- `status`: `indexed`
- `chunk_count`: 0보다 큰 값
- `split_status.completed_splits`: `split_status.total_splits`와 동일

---

### 시나리오 3: 부분 실패 시나리오

**목적**: 일부 분할 실패 시 나머지 처리 계속되는지 확인

**테스트 방법**: 
1. 큰 파일 업로드
2. 처리 중 일부 분할에서 에러 발생 시뮬레이션 (선택사항)
3. 나머지 분할이 계속 처리되는지 확인

**확인 방법**:
```sql
-- 실패한 분할과 성공한 분할 확인
SELECT 
  split_index,
  status,
  updated_at
FROM document_splits
WHERE document_id = 'YOUR_DOCUMENT_ID'
ORDER BY split_index;
```

**예상 결과**: 일부는 `failed`, 나머지는 `completed` 상태

---

### 시나리오 4: 재시도 로직 확인

**목적**: `CHUNK_PROCESS` job 실패 시 재시도되는지 확인

**확인 방법**:
```sql
-- 재시도된 job 확인
SELECT 
  id,
  status,
  attempts,
  max_attempts,
  error,
  scheduled_at
FROM processing_jobs
WHERE job_type = 'CHUNK_PROCESS'
  AND attempts > 0
ORDER BY created_at DESC
LIMIT 10;
```

---

## 📊 종합 확인 쿼리

다음 SQL로 전체 상태를 한 번에 확인:

```sql
-- Phase 2 분할 처리 상태 종합 확인
SELECT 
  d.id,
  d.title,
  d.status as document_status,
  d.chunk_count,
  d.split_status->>'total_splits' as total_splits,
  d.split_status->>'completed_splits' as completed_splits,
  d.split_status->>'failed_splits' as failed_splits,
  d.split_status->>'method' as split_method,
  COUNT(DISTINCT ds.id) as actual_split_count,
  COUNT(DISTINCT ds.id) FILTER (WHERE ds.status = 'completed') as actual_completed,
  COUNT(DISTINCT ds.id) FILTER (WHERE ds.status = 'failed') as actual_failed,
  COUNT(DISTINCT pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS') as chunk_process_jobs,
  COUNT(DISTINCT pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS' AND pj.status = 'completed') as completed_jobs
FROM documents d
LEFT JOIN document_splits ds ON d.id = ds.document_id
LEFT JOIN processing_jobs pj ON d.id = pj.document_id AND pj.job_type = 'CHUNK_PROCESS'
WHERE d.split_status IS NOT NULL
GROUP BY d.id, d.title, d.status, d.chunk_count, d.split_status
ORDER BY d.updated_at DESC;
```

---

## 🔍 로그 확인 포인트

### 큰 파일 분할 시작
```
📦 큰 파일 감지 - 분할 처리 시작
```

### 텍스트 분할 완료
```
✂️ 텍스트 분할 완료: { totalSplits, avgSizeKB, ... }
```

### 분할 저장 완료
```
💾 분할 저장 완료: N개
```

### CHUNK_PROCESS job 등록
```
📋 CHUNK_PROCESS job 등록 완료: N개
```

### 각 분할 처리 시작
```
🔧 CHUNK_PROCESS job 처리 시작
```

### 각 분할 처리 완료
```
✅ 분할 처리 완료: { splitIndex, chunkCount, processTimeMs }
```

### 모든 분할 완료
```
🎉 모든 분할 처리 완료 - 문서 인덱싱 완료
```

---

## ⚠️ 문제 해결

### 문제 1: 분할이 발생하지 않음

**원인**: 파일 크기가 임계값 이하

**확인 방법**:
```sql
-- 파일 크기 확인
SELECT 
  id,
  title,
  file_size,
  LENGTH(content) as text_length
FROM documents
WHERE id = 'YOUR_DOCUMENT_ID';
```

**해결**: 10MB 이상 파일 또는 500KB 이상 텍스트 사용

---

### 문제 2: CHUNK_PROCESS job이 처리되지 않음

**확인 방법**:
```sql
-- 큐에 대기 중인 job 확인
SELECT 
  id,
  status,
  attempts,
  scheduled_at,
  created_at
FROM processing_jobs
WHERE job_type = 'CHUNK_PROCESS'
  AND status = 'queued'
ORDER BY scheduled_at ASC;
```

**해결**: 큐 워커가 실행 중인지 확인 (Cron Job 또는 수동 호출)

---

### 문제 3: 분할 처리 실패

**확인 방법**:
```sql
-- 실패한 분할 확인
SELECT 
  ds.split_index,
  ds.status,
  pj.error,
  pj.attempts,
  pj.max_attempts
FROM document_splits ds
LEFT JOIN processing_jobs pj ON ds.job_id = pj.id
WHERE ds.document_id = 'YOUR_DOCUMENT_ID'
  AND ds.status = 'failed';
```

**해결**: 에러 로그 확인 및 재시도 로직 확인

---

## ✅ 성공 기준

### Phase 2 구현이 성공한 경우:

1. ✅ 큰 파일(10MB+) 업로드 시 분할 감지
2. ✅ `document_splits` 테이블에 분할 저장
3. ✅ `CHUNK_PROCESS` job 등록
4. ✅ 각 분할이 순차적으로 처리
5. ✅ 모든 분할 완료 시 문서 상태 `indexed`
6. ✅ `chunk_count`가 정상적으로 업데이트
7. ✅ 작은 파일은 기존 방식대로 처리

---

## 📝 테스트 체크리스트

- [ ] Phase 1 인프라 확인 완료
- [ ] 작은 파일 테스트 (분할 없음 확인)
- [ ] 큰 파일 테스트 (분할 발생 확인)
- [ ] `document_splits` 테이블에 분할 저장 확인
- [ ] `CHUNK_PROCESS` job 등록 확인
- [ ] 각 분할 처리 확인
- [ ] 전체 완료 시 문서 상태 확인
- [ ] 로그 확인 (에러 없음)

---

## 🚀 빠른 테스트 방법

1. **큰 파일 업로드** (10MB 이상)
2. **로그 확인**: 분할 감지 메시지 확인
3. **SQL 실행**: 종합 확인 쿼리 실행
4. **상태 확인**: 분할 진행 상황 확인
5. **완료 확인**: 모든 분할 완료 후 문서 상태 확인

---

**테스트 완료 후 결과를 알려주시면 다음 단계를 안내하겠습니다!**

