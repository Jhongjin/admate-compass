-- 최근 크롤링 작업의 문서 확인
-- 작업 ID: 45893aee-64ef-42d6-a088-6e6730c6aee5

-- 1. 작업 정보 확인
SELECT 
  id,
  status,
  job_type,
  created_at,
  started_at,
  finished_at,
  error,
  result
FROM processing_jobs
WHERE id = '45893aee-64ef-42d6-a088-6e6730c6aee5';

-- 2. 해당 작업과 관련된 문서 확인
SELECT 
  d.id,
  d.title,
  d.url,
  d.type,
  d.status,
  d.chunk_count,
  d.created_at,
  d.updated_at,
  COUNT(dc.id) as actual_chunk_count
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.id IN (
  SELECT document_id 
  FROM processing_jobs 
  WHERE id = '45893aee-64ef-42d6-a088-6e6730c6aee5'
  AND document_id IS NOT NULL
)
OR d.url LIKE '%ads.naver.com%'
OR d.url LIKE '%facebook.com%'
GROUP BY d.id, d.title, d.url, d.type, d.status, d.chunk_count, d.created_at, d.updated_at
ORDER BY d.created_at DESC
LIMIT 20;

-- 3. 최근 인덱싱된 문서 확인 (상태가 indexed인 문서)
SELECT 
  id,
  title,
  url,
  type,
  status,
  chunk_count,
  created_at,
  updated_at
FROM documents
WHERE status = 'indexed'
ORDER BY created_at DESC
LIMIT 10;

-- 4. URL이 null인 문서 확인
SELECT 
  id,
  title,
  url,
  type,
  status,
  chunk_count,
  created_at
FROM documents
WHERE url IS NULL
AND status = 'indexed'
ORDER BY created_at DESC
LIMIT 10;








