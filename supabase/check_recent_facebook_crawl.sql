-- 최근 ko-kr.facebook.com/business 크롤링 작업 확인
-- maxDepth 4 + domainLimit=true 테스트용

SELECT 
  pj.id as job_id,
  pj.document_id,
  pj.job_type,
  pj.status,
  pj.created_at,
  pj.started_at,
  pj.finished_at,
  pj.payload->>'url' as payload_url,
  pj.payload->>'maxDepth' as payload_max_depth,
  pj.payload->>'domainLimit' as payload_domain_limit,
  pj.payload->>'extractSubPages' as payload_extract_sub_pages,
  pj.result->>'url' as result_url,
  pj.result->>'subPageCount' as result_sub_page_count,
  pj.result->>'maxDepth' as result_max_depth,
  pj.error as error_message,
  -- 전체 payload와 result
  pj.payload as full_payload,
  pj.result as full_result
FROM processing_jobs pj
WHERE pj.job_type = 'CRAWL_SEED'
  AND (
    pj.payload->>'url' LIKE '%ko-kr.facebook.com%'
    OR pj.result->>'url' LIKE '%ko-kr.facebook.com%'
    OR pj.created_at >= NOW() - INTERVAL '1 hour'
  )
ORDER BY pj.created_at DESC
LIMIT 10;

-- 작업 상태별 통계
SELECT 
  pj.status,
  COUNT(*) as count,
  MAX(pj.created_at) as latest_created
FROM processing_jobs pj
WHERE pj.job_type = 'CRAWL_SEED'
  AND pj.created_at >= NOW() - INTERVAL '1 hour'
GROUP BY pj.status
ORDER BY latest_created DESC;








