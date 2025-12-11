-- 작업 94dbed16-d450-4957-873d-56ba43306811의 result JSONB 전체 구조 확인

-- 1. result JSONB 전체 확인
SELECT 
  id,
  status,
  result,
  jsonb_pretty(result) as result_pretty
FROM processing_jobs
WHERE id = '94dbed16-d450-4957-873d-56ba43306811';

-- 2. result의 모든 키 확인
SELECT 
  id,
  jsonb_object_keys(result) as result_keys
FROM processing_jobs
WHERE id = '94dbed16-d450-4957-873d-56ba43306811'
  AND result IS NOT NULL;

-- 3. result의 주요 필드 확인 (다양한 키 이름 시도)
SELECT 
  id,
  result->>'maxDepth' as max_depth_1,
  result->>'max_depth' as max_depth_2,
  result->>'maxdepth' as max_depth_3,
  result->>'subPageCount' as sub_page_count_1,
  result->>'sub_page_count' as sub_page_count_2,
  result->>'subPageCount' as sub_page_count_3,
  result->>'crawlTimeMs' as crawl_time_ms_1,
  result->>'crawl_time_ms' as crawl_time_ms_2,
  result->>'includeExternal' as include_external_1,
  result->>'include_external' as include_external_2,
  result->>'domainLimit' as domain_limit_1,
  result->>'domain_limit' as domain_limit_2,
  result->'subPages' as sub_pages_array,
  jsonb_typeof(result->'subPages') as sub_pages_type,
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_length
FROM processing_jobs
WHERE id = '94dbed16-d450-4957-873d-56ba43306811';

-- 4. payload에서 maxDepth 확인 (작업 시작 시 전달된 값)
SELECT 
  id,
  payload->>'maxDepth' as payload_max_depth,
  payload->>'domainLimit' as payload_domain_limit,
  payload->>'extractSubPages' as payload_extract_sub_pages,
  payload->>'url' as payload_url,
  payload
FROM processing_jobs
WHERE id = '94dbed16-d450-4957-873d-56ba43306811';

-- 5. result와 payload 비교
SELECT 
  id,
  payload->>'maxDepth' as payload_max_depth,
  result->>'maxDepth' as result_max_depth,
  payload->>'domainLimit' as payload_domain_limit,
  result->>'domainLimit' as result_domain_limit,
  CASE 
    WHEN payload->>'maxDepth' = result->>'maxDepth' THEN '일치'
    ELSE '불일치'
  END as max_depth_match
FROM processing_jobs
WHERE id = '94dbed16-d450-4957-873d-56ba43306811';




