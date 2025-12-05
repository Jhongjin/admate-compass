-- 크롤링 데이터 DB 저장 확인 쿼리
-- 작업 ID: 463e9e8b-6d6c-4ac4-9df8-d42915551f99
-- 도메인: ads.naver.com
-- maxDepth: 2

-- 1. 작업 상태 확인
SELECT 
  id,
  job_type,
  status,
  document_id,
  started_at,
  finished_at,
  created_at,
  updated_at,
  result
FROM processing_jobs
WHERE id = '463e9e8b-6d6c-4ac4-9df8-d42915551f99'
  AND job_type = 'CRAWL_SEED'
ORDER BY created_at DESC;

-- 2. 도메인별 문서 확인 (ads.naver.com)
SELECT 
  id,
  title,
  url,
  status,
  chunk_count,
  type,
  created_at,
  updated_at
FROM documents
WHERE url ILIKE '%ads.naver.com%'
ORDER BY created_at DESC
LIMIT 50;

-- 3. 도메인별 문서 통계
SELECT 
  status,
  COUNT(*) as count,
  SUM(chunk_count) as total_chunks
FROM documents
WHERE url ILIKE '%ads.naver.com%'
GROUP BY status
ORDER BY status;

-- 4. 실제 청크 수 확인 (샘플 문서 5개)
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
    WHEN sd.chunk_count = COUNT(dc.id) THEN '일치'
    ELSE '불일치'
  END as chunk_match
FROM sample_docs sd
LEFT JOIN document_chunks dc ON dc.document_id = sd.id
GROUP BY sd.id, sd.url, sd.chunk_count
ORDER BY sd.id;

-- 5. 전체 청크 및 임베딩 통계
SELECT 
  COUNT(DISTINCT dc.document_id) as documents_with_chunks,
  COUNT(dc.id) as total_chunks,
  COUNT(CASE WHEN dc.embedding IS NOT NULL THEN 1 END) as chunks_with_embeddings,
  COUNT(CASE WHEN dc.embedding IS NULL THEN 1 END) as chunks_without_embeddings
FROM document_chunks dc
INNER JOIN documents d ON d.id = dc.document_id
WHERE d.url ILIKE '%ads.naver.com%';

-- 6. 작업과 연결된 문서 확인
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

