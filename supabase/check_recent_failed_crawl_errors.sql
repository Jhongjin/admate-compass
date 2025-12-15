-- 최근 실패한 CRAWL_SEED 작업의 상세 에러 분석
SELECT 
  id,
  status,
  created_at,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds,
  payload->>'url' as url,
  payload->>'maxDepth' as max_depth,
  payload->>'extractSubPages' as extract_sub_pages,
  payload->>'domainLimit' as domain_limit,
  -- 에러 정보 (여러 소스에서 확인)
  error as error_message,
  result->>'error' as result_error,
  result->>'errorMessage' as result_error_message,
  result->>'errorName' as result_error_name,
  result->>'errorStack' as result_error_stack,
  -- 전체 result 확인
  result::text as result_json
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'failed'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 10;






