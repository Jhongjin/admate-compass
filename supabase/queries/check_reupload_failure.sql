-- 재업로드 실패 원인 진단 쿼리

-- 1. 최근 실패한 작업 확인
SELECT 
  pj.id as job_id,
  pj.document_id,
  pj.job_type,
  pj.status,
  pj.error,
  pj.attempts,
  pj.max_attempts,
  pj.created_at,
  pj.started_at,
  pj.finished_at,
  pj.scheduled_at,
  d.title,
  d.status as doc_status,
  d.chunk_count,
  d.file_size,
  d.file_type
FROM processing_jobs pj
LEFT JOIN documents d ON d.id = pj.document_id
WHERE pj.status = 'failed'
ORDER BY pj.created_at DESC
LIMIT 5;

-- 2. "Threads 피드 내 광고의 예" 관련 모든 문서 확인
SELECT 
  id,
  title,
  status,
  chunk_count,
  file_size,
  file_type,
  created_at,
  updated_at
FROM documents
WHERE title LIKE '%Threads 피드 내 광고의 예%'
ORDER BY created_at DESC;

-- 3. 큐에 대기 중인 작업 확인
SELECT 
  id,
  document_id,
  job_type,
  status,
  priority,
  scheduled_at,
  created_at,
  payload->>'fileName' as file_name,
  payload->>'fileSize' as file_size
FROM processing_jobs
WHERE status IN ('queued', 'retrying', 'processing')
ORDER BY created_at DESC
LIMIT 10;

-- 4. 동일한 문서 ID로 여러 작업이 있는지 확인
SELECT 
  document_id,
  COUNT(*) as job_count,
  STRING_AGG(status::text, ', ') as statuses,
  STRING_AGG(id::text, ', ') as job_ids
FROM processing_jobs
WHERE document_id IN (
  SELECT id FROM documents 
  WHERE title LIKE '%Threads 피드 내 광고의 예%'
  ORDER BY created_at DESC
  LIMIT 5
)
GROUP BY document_id
HAVING COUNT(*) > 1;

