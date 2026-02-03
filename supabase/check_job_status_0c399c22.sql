-- 작업 ID: 0c399c22-a2f1-4788-879c-694fb585a30d 상태 확인
-- 또는 최근 ko-kr.facebook.com/business 크롤링 작업 확인

-- 1. 특정 작업 ID 확인
SELECT 
  id,
  job_type,
  status,
  document_id,
  created_at,
  started_at,
  finished_at,
  attempts,
  max_attempts,
  priority,
  scheduled_at,
  payload->>'url' as payload_url,
  payload->>'maxDepth' as payload_max_depth,
  payload->>'domainLimit' as payload_domain_limit,
  payload->>'extractSubPages' as payload_extract_sub_pages,
  error as error_message,
  result
FROM processing_jobs
WHERE id = '0c399c22-a2f1-4788-879c-694fb585a30d'
   OR id::text LIKE '0c399c22%';

-- 2. 최근 CRAWL_SEED 작업 전체 상태 확인
SELECT 
  id,
  job_type,
  status,
  document_id,
  created_at,
  started_at,
  finished_at,
  attempts,
  max_attempts,
  priority,
  scheduled_at,
  payload->>'url' as payload_url,
  payload->>'maxDepth' as payload_max_depth,
  payload->>'domainLimit' as payload_domain_limit,
  error as error_message
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND (
    payload->>'url' LIKE '%ko-kr.facebook.com%'
    OR created_at >= NOW() - INTERVAL '1 hour'
  )
ORDER BY created_at DESC
LIMIT 10;

-- 3. 상태별 작업 개수
SELECT 
  status,
  COUNT(*) as count,
  MAX(created_at) as latest_created
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND created_at >= NOW() - INTERVAL '1 hour'
GROUP BY status
ORDER BY latest_created DESC;

-- 4. queued 또는 retrying 상태인 작업 확인
SELECT 
  id,
  job_type,
  status,
  payload->>'url' as payload_url,
  created_at,
  scheduled_at,
  priority
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status IN ('queued', 'retrying')
ORDER BY priority DESC, scheduled_at ASC
LIMIT 10;

-- 5. 실패한 작업의 에러 메시지 상세 확인
SELECT 
  id,
  status,
  payload->>'url' as payload_url,
  payload->>'maxDepth' as payload_max_depth,
  payload->>'domainLimit' as payload_domain_limit,
  error as error_message,
  result->>'error' as result_error,
  created_at,
  started_at,
  finished_at
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'failed'
  AND (
    payload->>'url' LIKE '%ko-kr.facebook.com%'
    OR created_at >= NOW() - INTERVAL '1 hour'
  )
ORDER BY created_at DESC
LIMIT 5;

