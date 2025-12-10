# 크롤링 데이터 DB 저장 확인 가이드

## 작업 정보
- **작업 ID**: `463e9e8b-6d6c-4ac4-9df8-d42915551f99`
- **도메인**: `ads.naver.com`
- **maxDepth**: `2`

## Supabase에서 직접 확인하는 방법

### 1. Supabase Dashboard 접속
1. [Supabase Dashboard](https://app.supabase.com) 접속
2. 프로젝트 선택
3. 왼쪽 메뉴에서 **SQL Editor** 클릭

### 2. 확인 쿼리 실행

#### 쿼리 1: 작업 상태 확인
```sql
SELECT 
  id,
  job_type,
  status,
  document_id,
  started_at,
  finished_at,
  created_at,
  updated_at
FROM processing_jobs
WHERE id = '463e9e8b-6d6c-4ac4-9df8-d42915551f99'
  AND job_type = 'CRAWL_SEED';
```

**확인 사항:**
- `status`가 `completed`인지 확인
- `finished_at`이 설정되어 있는지 확인

#### 쿼리 2: 도메인별 문서 목록 확인
```sql
SELECT 
  id,
  title,
  url,
  status,
  chunk_count,
  created_at,
  updated_at
FROM documents
WHERE url ILIKE '%ads.naver.com%'
ORDER BY created_at DESC
LIMIT 50;
```

**확인 사항:**
- 문서가 실제로 저장되어 있는지 확인
- `status`가 `indexed`인 문서 수 확인
- `chunk_count`가 0보다 큰지 확인

#### 쿼리 3: 도메인별 문서 통계
```sql
SELECT 
  status,
  COUNT(*) as count,
  SUM(chunk_count) as total_chunks
FROM documents
WHERE url ILIKE '%ads.naver.com%'
GROUP BY status
ORDER BY status;
```

**확인 사항:**
- `indexed` 상태 문서 수 확인
- 총 청크 수 확인

#### 쿼리 4: 실제 청크 수 확인 (샘플 문서 5개)
```sql
WITH sample_docs AS (
  SELECT id, url, chunk_count
  FROM documents
  WHERE url ILIKE '%ads.naver.com%'
    AND status = 'indexed'
  ORDER BY created_at DESC
  LIMIT 5
)
SELECT 
  sd.id as document_id,
  sd.url,
  sd.chunk_count as db_chunk_count,
  COUNT(dc.id) as actual_chunk_count,
  COUNT(CASE WHEN dc.embedding IS NOT NULL THEN 1 END) as embeddings_count,
  CASE 
    WHEN sd.chunk_count = COUNT(dc.id) THEN '일치 ✅'
    ELSE '불일치 ❌'
  END as chunk_match
FROM sample_docs sd
LEFT JOIN document_chunks dc ON dc.document_id = sd.id
GROUP BY sd.id, sd.url, sd.chunk_count
ORDER BY sd.id;
```

**확인 사항:**
- `db_chunk_count`와 `actual_chunk_count`가 일치하는지 확인
- `embeddings_count`가 0보다 큰지 확인 (임베딩 벡터가 저장되었는지)

#### 쿼리 5: 전체 청크 및 임베딩 통계
```sql
SELECT 
  COUNT(DISTINCT dc.document_id) as documents_with_chunks,
  COUNT(dc.id) as total_chunks,
  COUNT(CASE WHEN dc.embedding IS NOT NULL THEN 1 END) as chunks_with_embeddings,
  COUNT(CASE WHEN dc.embedding IS NULL THEN 1 END) as chunks_without_embeddings
FROM document_chunks dc
INNER JOIN documents d ON d.id = dc.document_id
WHERE d.url ILIKE '%ads.naver.com%';
```

**확인 사항:**
- `total_chunks`가 0보다 큰지 확인
- `chunks_with_embeddings`가 0보다 큰지 확인 (임베딩 벡터가 저장되었는지)

#### 쿼리 6: 작업과 연결된 문서 확인
```sql
SELECT 
  pj.id as job_id,
  pj.status as job_status,
  pj.finished_at as job_finished_at,
  d.id as document_id,
  d.url,
  d.status as document_status,
  d.chunk_count,
  COUNT(dc.id) as actual_chunks
FROM processing_jobs pj
LEFT JOIN documents d ON d.id = pj.document_id
LEFT JOIN document_chunks dc ON dc.document_id = d.id
WHERE pj.id = '463e9e8b-6d6c-4ac4-9df8-d42915551f99'
GROUP BY pj.id, pj.status, pj.finished_at, d.id, d.url, d.status, d.chunk_count;
```

**확인 사항:**
- 작업이 완료되었는지 확인 (`job_status = 'completed'`)
- 문서가 연결되어 있는지 확인
- 실제 청크 수 확인

## 예상 결과

### 정상적인 경우:
- **작업 상태**: `completed`
- **문서 수**: maxDepth 2 기준 약 20-30개 문서
- **문서 상태**: 대부분 `indexed`
- **청크 수**: 문서당 평균 5-20개 청크
- **임베딩 벡터**: 모든 청크에 임베딩 벡터가 저장되어 있음

### 확인 체크리스트:
- [ ] `processing_jobs` 테이블에 작업이 `completed` 상태로 존재
- [ ] `documents` 테이블에 `ads.naver.com` 도메인 문서가 저장됨
- [ ] 문서의 `status`가 `indexed`인 문서가 존재
- [ ] 문서의 `chunk_count`가 0보다 큼
- [ ] `document_chunks` 테이블에 실제 청크가 저장됨
- [ ] `document_chunks` 테이블의 `embedding` 컬럼에 벡터가 저장됨

## 문제가 있는 경우

### 케이스 1: 작업은 완료되었지만 문서가 없음
- `processing_jobs`에서 `status = 'completed'`이지만
- `documents` 테이블에 해당 도메인 문서가 없음
- **원인**: 문서 생성 실패 또는 삭제됨

### 케이스 2: 문서는 있지만 청크가 없음
- `documents` 테이블에 문서가 있지만
- `document_chunks` 테이블에 청크가 없음
- **원인**: RAG 처리 실패 또는 청크 저장 실패

### 케이스 3: 청크는 있지만 임베딩이 없음
- `document_chunks` 테이블에 청크가 있지만
- `embedding` 컬럼이 NULL
- **원인**: 임베딩 생성 실패 또는 저장 실패



