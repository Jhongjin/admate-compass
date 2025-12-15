-- 최근 크롤링 작업 상태 확인 (최근 24시간)
SELECT
  id,
  job_type,
  status,
  created_at,
  started_at,
  finished_at,
  payload->>'url' as crawl_url,
  payload->>'maxDepth' as max_depth,
  payload->>'domainLimit' as domain_limit,
  error,
  result->>'totalDocuments' as total_documents,
  result->>'subPageCount' as sub_page_count,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;

-- 최근 크롤링 작업 통계
SELECT
  COUNT(*) as total_jobs,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_count,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
  MAX(created_at) as latest_job_time
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND created_at >= NOW() - INTERVAL '24 hours';

-- 실패한 크롤링 작업 상세 (최근 10개)
SELECT
  id,
  status,
  created_at,
  started_at,
  finished_at,
  payload->>'url' as crawl_url,
  error,
  LEFT(error, 200) as error_preview
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'failed'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 10;

-- 진행 중인 크롤링 작업
SELECT
  id,
  status,
  created_at,
  started_at,
  payload->>'url' as crawl_url,
  EXTRACT(EPOCH FROM (NOW() - started_at)) as running_seconds
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status IN ('pending', 'processing')
ORDER BY created_at DESC
LIMIT 10;






