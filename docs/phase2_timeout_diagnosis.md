# Phase 2 타임아웃 문제 진단 가이드

**문제**: Phase 2 구현 후에도 여전히 타임아웃 에러 발생

---

## 🔍 진단 절차

### 1단계: 분할 발생 여부 확인

큰 파일 업로드 후 다음 SQL 실행:

```sql
-- 분할 발생 여부 확인
SELECT 
  d.id,
  d.title,
  d.file_size / (1024 * 1024) as file_size_mb,
  LENGTH(d.content) / 1024 as text_length_kb,
  d.status,
  d.split_status,
  COUNT(ds.id) as split_count
FROM documents d
LEFT JOIN document_splits ds ON d.id = ds.document_id
WHERE d.id = 'YOUR_DOCUMENT_ID'
GROUP BY d.id, d.title, d.file_size, d.content, d.status, d.split_status;
```

**예상 결과**:
- ✅ `split_status IS NOT NULL`: 분할 발생
- ❌ `split_status IS NULL`: 분할 미발생

---

### 2단계: 분할 미발생 원인 분석

#### 원인 1: 파일 크기 조건 미충족
- **조건**: `fileSize > 10MB` 또는 `normalizedText.length > 500KB`
- **확인**: 실제 파일 크기와 추출된 텍스트 길이 확인

```sql
SELECT 
  id,
  title,
  file_size / (1024 * 1024) as file_size_mb,
  LENGTH(content) / 1024 as text_length_kb,
  CASE 
    WHEN file_size > 10 * 1024 * 1024 THEN '✅ 파일 크기 조건 충족'
    WHEN LENGTH(content) > 500 * 1024 THEN '✅ 텍스트 길이 조건 충족'
    ELSE '❌ 분할 조건 미충족'
  END as condition_check
FROM documents
WHERE id = 'YOUR_DOCUMENT_ID';
```

**해결책**: 
- 파일 크기가 10MB 이상이지만 텍스트 추출이 실패한 경우 → PDF 파싱 문제
- 텍스트가 500KB 미만인 경우 → 분할 조건 조정 필요

---

#### 원인 2: 텍스트 추출 실패
- PDF 파싱이 실패하여 `normalizedText`가 비어있거나 매우 작음
- **확인**: `documents.content` 확인

```sql
SELECT 
  id,
  title,
  file_size,
  LENGTH(content) as content_length,
  CASE 
    WHEN content IS NULL THEN '❌ 텍스트 없음'
    WHEN LENGTH(content) = 0 THEN '❌ 빈 텍스트'
    WHEN LENGTH(content) < 100 THEN '⚠️ 텍스트 매우 짧음'
    ELSE '✅ 텍스트 정상'
  END as content_check
FROM documents
WHERE id = 'YOUR_DOCUMENT_ID';
```

**해결책**: PDF 파싱 로직 개선 또는 OCR 처리

---

### 3단계: CHUNK_PROCESS job 확인

분할이 발생했다면:

```sql
-- CHUNK_PROCESS job 상태 확인
SELECT 
  pj.id,
  pj.document_id,
  pj.status,
  pj.attempts,
  pj.payload->>'split_index' as split_index,
  pj.started_at,
  pj.finished_at,
  pj.error
FROM processing_jobs pj
WHERE pj.job_type = 'CHUNK_PROCESS'
  AND pj.document_id = 'YOUR_DOCUMENT_ID'
ORDER BY CAST(pj.payload->>'split_index' AS INTEGER);
```

**예상 결과**:
- ✅ `status = 'queued'`: 큐에 등록됨 (처리 대기 중)
- ✅ `status = 'processing'`: 처리 중
- ✅ `status = 'completed'`: 처리 완료
- ❌ `status = 'failed'`: 처리 실패 (에러 확인 필요)

---

### 4단계: CHUNK_PROCESS 처리 중 타임아웃 확인

각 분할(500KB) 처리 중에도 타임아웃 발생 가능:

**원인**:
- 500KB 텍스트를 청킹 + 임베딩 + 저장하는데 8분 이상 소요
- `RAGProcessor.processDocument` 내부 타임아웃 (8분) 발생

**확인**:
```sql
-- 실패한 CHUNK_PROCESS job 확인
SELECT 
  pj.id,
  pj.document_id,
  pj.payload->>'split_index' as split_index,
  pj.error,
  pj.attempts,
  EXTRACT(EPOCH FROM (pj.finished_at - pj.started_at)) as process_time_seconds
FROM processing_jobs pj
WHERE pj.job_type = 'CHUNK_PROCESS'
  AND pj.status = 'failed'
  AND pj.error LIKE '%타임아웃%'
ORDER BY pj.created_at DESC;
```

---

## 🔧 해결 방안

### 방안 1: 분할 크기 축소

현재 500KB 분할이 여전히 크다면 더 작게 분할:

**수정 위치**: `src/app/api/jobs/consume/route.ts`

```typescript
// 현재: 500KB
const splits = simpleTextSplitter.splitByFixedSize(normalizedText, {
  maxSize: 500 * 1024 // 500KB
});

// 수정: 200KB 또는 300KB로 축소
const splits = simpleTextSplitter.splitByFixedSize(normalizedText, {
  maxSize: 200 * 1024 // 200KB
});
```

**장점**: 각 분할 처리 시간 단축
**단점**: 분할 수 증가, 전체 처리 시간 증가 가능

---

### 방안 2: CHUNK_PROCESS 타임아웃 조정

각 분할 처리에 더 짧은 타임아웃 설정:

**수정 위치**: `src/lib/services/RAGProcessor.ts`

```typescript
// CHUNK_PROCESS는 분할된 작은 텍스트이므로 타임아웃을 더 짧게
const timeoutMs = isLargeFile ? 300000 : 120000; // 5분 (500KB 분할용)
```

**또는**: `src/app/api/jobs/consume/route.ts`에서 직접 타임아웃 처리

---

### 방안 3: 분할 조건 완화

더 작은 파일도 분할 처리:

**수정 위치**: `src/app/api/jobs/consume/route.ts`

```typescript
// 현재: 10MB 또는 500KB 텍스트
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
const LARGE_TEXT_THRESHOLD = 500 * 1024; // 500KB

// 수정: 5MB 또는 300KB 텍스트
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB
const LARGE_TEXT_THRESHOLD = 300 * 1024; // 300KB
```

---

### 방안 4: 배치 처리 최적화

각 분할의 청킹/임베딩/저장 최적화:

**수정 위치**: `src/lib/services/RAGProcessor.ts`

- 배치 크기 조정
- 배치 간 지연 시간 조정
- 병렬 처리 (가능한 경우)

---

## 📊 종합 진단 쿼리

한 번에 모든 상태 확인:

```sql
-- 파일: supabase/queries/diagnose_split_timeout.sql
-- 실행하여 전체 상태 확인
```

---

## ✅ 권장 조치 순서

1. **진단**: `diagnose_split_timeout.sql` 실행하여 원인 파악
2. **분할 미발생**: 분할 조건 확인 및 조정
3. **CHUNK_PROCESS 실패**: 분할 크기 축소 또는 타임아웃 조정
4. **재테스트**: 수정 후 다시 큰 파일 업로드 테스트

---

**다음 단계**: 진단 결과를 공유해주시면 구체적인 수정 방안을 제시하겠습니다.

