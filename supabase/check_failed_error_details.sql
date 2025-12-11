-- 실패한 작업의 에러 메시지 상세 확인 (인코딩 문제 해결)
SELECT 
  id,
  status,
  created_at,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds,
  payload->>'url' as url,
  payload->>'maxDepth' as max_depth,
  payload->>'domainLimit' as domain_limit,
  -- 에러 메시지 (텍스트로 변환)
  error::text as error_text,
  -- result에서 에러 추출
  result->>'error' as result_error,
  result->>'errorMessage' as result_error_message,
  result->>'errorName' as result_error_name,
  result->>'errorStack' as result_error_stack,
  -- 전체 result (JSONB)
  result::text as result_text
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'failed'
  AND payload->>'url' LIKE '%ko-kr.facebook.com%'
ORDER BY created_at DESC
LIMIT 1;




