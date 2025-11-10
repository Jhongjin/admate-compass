-- CRAWL_SEED 작업의 payload에서 extractSubPages 값 확인
-- 최근 작업 기준으로 확인

SELECT 
  pj.id as job_id,
  pj.document_id,
  pj.job_type,
  pj.status,
  pj.created_at,
  pj.finished_at,
  -- payload에서 extractSubPages 값 확인
  pj.payload->>'extractSubPages' as payload_extract_sub_pages,
  pj.payload->>'url' as payload_url,
  pj.payload->>'maxDepth' as payload_max_depth,
  pj.payload->>'domainLimit' as payload_domain_limit,
  pj.payload->>'respectRobots' as payload_respect_robots,
  -- result에서 extractSubPages 값 확인 (작업 완료 후 저장된 값)
  pj.result->>'extractSubPages' as result_extract_sub_pages,
  pj.result->>'subPageCount' as result_sub_page_count,
  pj.result->>'url' as result_url,
  -- 전체 payload와 result 확인
  pj.payload as full_payload,
  pj.result as full_result
FROM processing_jobs pj
WHERE pj.job_type = 'CRAWL_SEED'
  AND (
    pj.document_id LIKE 'doc_1762761570%'
    OR pj.result->>'documentId' LIKE 'doc_1762761570%'
    OR pj.result->>'url' LIKE '%developers.facebook.com%'
    OR pj.payload->>'url' LIKE '%developers.facebook.com%'
    OR pj.created_at >= NOW() - INTERVAL '1 hour'
  )
ORDER BY pj.created_at DESC
LIMIT 10;

-- extractSubPages가 false인 최근 작업들 확인
SELECT 
  COUNT(*) as total_crawl_jobs,
  COUNT(*) FILTER (WHERE pj.payload->>'extractSubPages' = 'true') as extract_sub_pages_true,
  COUNT(*) FILTER (WHERE pj.payload->>'extractSubPages' = 'false') as extract_sub_pages_false,
  COUNT(*) FILTER (WHERE pj.payload->>'extractSubPages' IS NULL) as extract_sub_pages_null,
  COUNT(*) FILTER (WHERE pj.result->>'subPageCount' IS NOT NULL AND (pj.result->>'subPageCount')::int > 0) as jobs_with_sub_pages
FROM processing_jobs pj
WHERE pj.job_type = 'CRAWL_SEED'
  AND pj.created_at >= NOW() - INTERVAL '7 days';

