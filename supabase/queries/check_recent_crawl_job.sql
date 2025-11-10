-- 최근 CRAWL_SEED 작업의 하위 페이지 크롤링 상태 확인
-- 메인 문서 ID: doc_1762755021768_p0xcheb

-- 1. 최근 CRAWL_SEED 작업 조회
SELECT 
  pj.id as job_id,
  pj.document_id,
  pj.job_type,
  pj.status,
  pj.created_at,
  pj.finished_at,
  pj.result->>'url' as crawl_url,
  pj.result->>'title' as crawl_title,
  pj.result->>'extractSubPages' as extract_sub_pages,
  pj.result->>'subPageCount' as sub_page_count,
  pj.result->>'maxDepth' as max_depth,
  jsonb_array_length(pj.result->'subPages') as sub_pages_array_length,
  pj.result->'subPages' as sub_pages_json
FROM processing_jobs pj
WHERE pj.job_type = 'CRAWL_SEED'
  AND (
    pj.document_id = 'doc_1762755021768_p0xcheb'
    OR pj.result->>'documentId' = 'doc_1762755021768_p0xcheb'
    OR pj.result->>'url' = 'https://developers.facebook.com/docs/marketing-api'
  )
ORDER BY pj.created_at DESC
LIMIT 5;

-- 2. 하위 페이지 상세 정보 (최근 작업 기준)
WITH recent_job AS (
  SELECT 
    pj.id as job_id,
    pj.document_id,
    pj.result->>'url' as crawl_url,
    pj.result->>'subPageCount' as sub_page_count,
    pj.result->'subPages' as sub_pages_json
  FROM processing_jobs pj
  WHERE pj.job_type = 'CRAWL_SEED'
    AND (
      pj.document_id = 'doc_1762755021768_p0xcheb'
      OR pj.result->>'documentId' = 'doc_1762755021768_p0xcheb'
      OR pj.result->>'url' = 'https://developers.facebook.com/docs/marketing-api'
    )
  ORDER BY pj.created_at DESC
  LIMIT 1
),
sub_page_details AS (
  SELECT 
    rj.job_id,
    rj.crawl_url as main_url,
    rj.sub_page_count,
    jsonb_array_elements(rj.sub_pages_json) as sub_page_info
  FROM recent_job rj
  WHERE rj.sub_pages_json IS NOT NULL
    AND jsonb_typeof(rj.sub_pages_json) = 'array'
)
SELECT 
  spd.main_url,
  spd.sub_page_count,
  spd.sub_page_info->>'url' as sub_page_url,
  spd.sub_page_info->>'success' as sub_page_success,
  spd.sub_page_info->>'title' as sub_page_title,
  spd.sub_page_info->>'chunkCount' as sub_page_chunk_count,
  spd.sub_page_info->>'error' as sub_page_error,
  -- documents 테이블에서 실제 저장 여부 확인
  d.id as actual_document_id,
  d.title as actual_document_title,
  d.status as actual_document_status,
  d.chunk_count as actual_chunk_count,
  CASE 
    WHEN d.id IS NOT NULL THEN '✅ 저장됨'
    WHEN spd.sub_page_info->>'success' = 'true' THEN '⚠️ 성공했지만 저장 안됨'
    ELSE '❌ 크롤링 실패'
  END as storage_status
FROM sub_page_details spd
LEFT JOIN documents d ON d.url = spd.sub_page_info->>'url' AND d.type = 'url'
ORDER BY 
  CASE spd.sub_page_info->>'success' 
    WHEN 'true' THEN 1 
    ELSE 2 
  END,
  spd.sub_page_info->>'url';

-- 3. 전체 URL 타입 문서 목록 (하위 페이지 포함)
SELECT 
  id,
  title,
  url,
  status,
  chunk_count,
  created_at,
  updated_at,
  CASE 
    WHEN url = 'https://developers.facebook.com/docs/marketing-api' THEN '메인 문서'
    WHEN url LIKE '%developers.facebook.com/docs/marketing-api%' THEN '하위 페이지'
    ELSE '기타'
  END as document_type
FROM documents
WHERE type = 'url'
  AND (
    url = 'https://developers.facebook.com/docs/marketing-api'
    OR url LIKE '%developers.facebook.com/docs/marketing-api%'
  )
ORDER BY 
  CASE 
    WHEN url = 'https://developers.facebook.com/docs/marketing-api' THEN 1
    ELSE 2
  END,
  created_at DESC;

