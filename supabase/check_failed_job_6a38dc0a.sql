-- 실패한 크롤링 작업 분석
-- 작업 ID: 6a38dc0a-1a5c-4930-90fe-26225fce85e3

-- 1. 작업 기본 정보 및 상태 확인
SELECT 
  id,
  job_type,
  status,
  document_id,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - COALESCE(started_at, created_at))) as duration_seconds,
  error,
  payload->>'url' as url,
  payload->>'maxDepth' as max_depth,
  payload->>'domainLimit' as domain_limit,
  payload->>'extractSubPages' as extract_sub_pages,
  result->>'error' as result_error,
  result->>'note' as result_note,
  result->>'status' as result_status,
  result->>'message' as result_message
FROM processing_jobs
WHERE id = '6a38dc0a-1a5c-4930-90fe-26225fce85e3';

-- 2. 작업과 연결된 문서 확인
SELECT 
  d.id,
  d.url,
  d.title,
  d.status,
  d.chunk_count,
  d.type,
  d.main_document_id,
  d.created_at,
  d.updated_at
FROM documents d
WHERE d.id = (
  SELECT document_id FROM processing_jobs 
  WHERE id = '6a38dc0a-1a5c-4930-90fe-26225fce85e3'
)
OR d.main_document_id = (
  SELECT document_id FROM processing_jobs 
  WHERE id = '6a38dc0a-1a5c-4930-90fe-26225fce85e3'
)
OR d.url ILIKE '%ko-kr.facebook.com/business%'
ORDER BY d.created_at DESC
LIMIT 20;

-- 3. 최근 실패한 CRAWL_SEED 작업들 확인 (비교용)
SELECT 
  id,
  status,
  error,
  payload->>'url' as url,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - COALESCE(started_at, created_at))) as duration_seconds
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'failed'
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;

-- 4. 작업의 result JSONB 전체 확인
SELECT 
  id,
  status,
  result
FROM processing_jobs
WHERE id = '6a38dc0a-1a5c-4930-90fe-26225fce85e3';






