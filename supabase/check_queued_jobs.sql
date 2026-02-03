-- queued 상태인 작업 확인
SELECT 
  id,
  job_type,
  status,
  payload->>'url' as payload_url,
  payload->>'maxDepth' as payload_max_depth,
  payload->>'domainLimit' as payload_domain_limit,
  created_at,
  scheduled_at,
  priority
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status IN ('queued', 'retrying')
ORDER BY priority DESC, scheduled_at ASC
LIMIT 10;

-- 최근 실패한 작업의 상세 에러 확인
SELECT 
  id,
  status,
  payload->>'url' as payload_url,
  error,
  result->>'error' as result_error,
  created_at,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'failed'
  AND payload->>'url' LIKE '%ko-kr.facebook.com%'
ORDER BY created_at DESC
LIMIT 1;








