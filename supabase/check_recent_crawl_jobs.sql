-- 최근 크롤링 작업 상태 확인 (최근 10개)
SELECT 
  id,
  status,
  job_type,
  created_at,
  started_at,
  finished_at,
  payload->>'url' as url,
  payload->>'maxDepth' as max_depth,
  payload->>'domainLimit' as domain_limit,
  error,
  result
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
ORDER BY created_at DESC
LIMIT 10;






