-- maxDepth 4 크롤링 결과 분석 (수정 버전)
-- 작업 94dbed16-d450-4957-873d-56ba43306811 분석

-- 쿼리 1: 작업 기본 정보 및 상태 확인
SELECT 
  id,
  job_type,
  status,
  document_id,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds,
  error,
  result->>'subPageCount' as sub_page_count,
  result->>'crawlTimeMs' as crawl_time_ms,
  result->>'maxDepth' as max_depth,
  result->>'domainLimit' as domain_limit,
  result->>'extractSubPages' as extract_sub_pages,
  result->>'includeExternal' as include_external,
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_array_length
FROM processing_jobs
WHERE id = '94dbed16-d450-4957-873d-56ba43306811';



