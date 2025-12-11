-- 최근 실패한 작업의 상세 에러 메시지 확인
SELECT 
  id,
  status,
  payload->>'url' as payload_url,
  payload->>'maxDepth' as payload_max_depth,
  payload->>'domainLimit' as payload_domain_limit,
  error,
  result->>'error' as result_error,
  result,
  created_at,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'failed'
  AND (
    payload->>'url' LIKE '%ko-kr.facebook.com%'
    OR created_at >= NOW() - INTERVAL '2 hours'
  )
ORDER BY created_at DESC
LIMIT 3;




