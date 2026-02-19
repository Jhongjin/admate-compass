-- 하위 페이지 크롤링 확인 쿼리
-- 특정 메인 문서의 하위 페이지가 실제로 documents 테이블에 저장되었는지 확인

-- 1. 특정 메인 문서의 processing_jobs에서 하위 페이지 정보 조회
WITH main_document AS (
  SELECT 
    id as document_id,
    url as main_url,
    title as main_title
  FROM documents
  WHERE id = 'doc_1762754558369_7zwn0h4'  -- 마케팅 API 문서 ID
),
crawl_jobs AS (
  SELECT 
    pj.id as job_id,
    pj.document_id,
    pj.result->>'url' as crawl_url,
    pj.result->>'subPageCount' as sub_page_count,
    pj.result->'subPages' as sub_pages_json,
    pj.status as job_status,
    pj.created_at as job_created_at
  FROM processing_jobs pj
  INNER JOIN main_document md ON pj.document_id = md.document_id
  WHERE pj.job_type = 'CRAWL_SEED'
    AND pj.status = 'completed'
  ORDER BY pj.created_at DESC
  LIMIT 1
),
sub_page_urls AS (
  SELECT 
    cj.job_id,
    cj.document_id as main_document_id,
    cj.crawl_url,
    cj.sub_page_count,
    jsonb_array_elements(cj.sub_pages_json) as sub_page_info
  FROM crawl_jobs cj
  WHERE cj.sub_pages_json IS NOT NULL
    AND jsonb_typeof(cj.sub_pages_json) = 'array'
),
sub_page_details AS (
  SELECT 
    spu.job_id,
    spu.main_document_id,
    spu.crawl_url,
    spu.sub_page_count,
    spu.sub_page_info->>'url' as sub_page_url,
    spu.sub_page_info->>'success' as sub_page_success,
    spu.sub_page_info->>'title' as sub_page_title,
    spu.sub_page_info->>'chunkCount' as sub_page_chunk_count,
    spu.sub_page_info->>'error' as sub_page_error
  FROM sub_page_urls spu
)
SELECT 
  spd.main_document_id,
  spd.crawl_url as main_url,
  spd.sub_page_count as reported_sub_page_count,
  spd.sub_page_url,
  spd.sub_page_success,
  spd.sub_page_title as reported_title,
  spd.sub_page_chunk_count as reported_chunk_count,
  spd.sub_page_error,
  -- documents 테이블에서 실제 하위 페이지 문서 조회
  d.id as actual_document_id,
  d.title as actual_document_title,
  d.status as actual_document_status,
  d.chunk_count as actual_chunk_count,
  d.url as actual_document_url,
  d.created_at as actual_document_created_at,
  CASE 
    WHEN d.id IS NOT NULL THEN '✅ 저장됨'
    WHEN spd.sub_page_success = 'true' THEN '⚠️ 성공했지만 documents 테이블에 없음'
    ELSE '❌ 실패 또는 미저장'
  END as storage_status
FROM sub_page_details spd
LEFT JOIN documents d ON d.url = spd.sub_page_url
ORDER BY 
  CASE spd.sub_page_success 
    WHEN 'true' THEN 1 
    ELSE 2 
  END,
  spd.sub_page_url;

-- 2. 전체 하위 페이지 통계
SELECT 
  COUNT(*) as total_sub_pages_in_jobs,
  COUNT(*) FILTER (WHERE sub_page_info->>'success' = 'true') as successful_sub_pages,
  COUNT(*) FILTER (WHERE sub_page_info->>'success' = 'false') as failed_sub_pages,
  COUNT(DISTINCT sub_page_info->>'url') as unique_sub_page_urls
FROM (
  SELECT 
    jsonb_array_elements(result->'subPages') as sub_page_info
  FROM processing_jobs
  WHERE job_type = 'CRAWL_SEED'
    AND status = 'completed'
    AND result->'subPages' IS NOT NULL
    AND jsonb_typeof(result->'subPages') = 'array'
) sub_pages;

-- 3. documents 테이블에 저장된 하위 페이지 문서 수 (URL 타입)
SELECT 
  COUNT(*) as total_url_documents,
  COUNT(*) FILTER (WHERE status = 'indexed') as indexed_url_documents,
  COUNT(*) FILTER (WHERE status = 'processing') as processing_url_documents,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_url_documents,
  SUM(chunk_count) as total_chunks_in_url_documents
FROM documents
WHERE type = 'url';

