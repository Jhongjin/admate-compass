-- maxDepth 4, 도메인 제한 체크 상태 크롤링 결과 분석
-- 작업 16427b29-a9f5-4e30-8efd-e78e57a0a0c9 분석

-- 1. 작업 기본 정보 및 상태 확인
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
WHERE id = '16427b29-a9f5-4e30-8efd-e78e57a0a0c9';

-- 2. 작업 결과에서 발견된 모든 URL의 hostname 분포 확인
WITH job_data AS (
  SELECT 
    id,
    result->'subPages' as sub_pages,
    result->>'maxDepth' as max_depth,
    result->>'domainLimit' as domain_limit,
    result->>'includeExternal' as include_external
  FROM processing_jobs
  WHERE id = '16427b29-a9f5-4e30-8efd-e78e57a0a0c9'
    AND result->'subPages' IS NOT NULL
),
sub_pages_expanded AS (
  SELECT 
    jsonb_array_elements(sub_pages) as sub_page
  FROM job_data
)
SELECT 
  REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') as hostname,
  CASE 
    WHEN REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END as domain_type,
  COUNT(*) as url_count,
  COUNT(CASE WHEN sub_page->>'status' = 'completed' THEN 1 END) as completed_count,
  COUNT(CASE WHEN sub_page->>'status' = 'failed' THEN 1 END) as failed_count,
  COUNT(CASE WHEN sub_page->>'status' = 'processing' THEN 1 END) as processing_count,
  COUNT(CASE WHEN sub_page->>'status' = 'pending' THEN 1 END) as pending_count
FROM sub_pages_expanded
WHERE sub_page->>'url' IS NOT NULL
GROUP BY 
  REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1'),
  CASE 
    WHEN REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END
ORDER BY domain_type, url_count DESC;

-- 3. 실제 인덱싱된 문서의 hostname 분포
SELECT 
  REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') as hostname,
  CASE 
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END as domain_type,
  COUNT(*) as document_count,
  COUNT(CASE WHEN status = 'indexed' THEN 1 END) as indexed_count,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
FROM documents
WHERE url ILIKE '%ads.naver.com%'
  AND created_at >= (
    SELECT COALESCE(started_at, created_at) FROM processing_jobs 
    WHERE id = '16427b29-a9f5-4e30-8efd-e78e57a0a0c9'
  )
GROUP BY 
  REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1'),
  CASE 
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END
ORDER BY document_count DESC;

-- 4. 작업 완료 상태 및 통계
SELECT 
  id,
  status,
  CASE 
    WHEN status = 'completed' AND finished_at IS NOT NULL THEN '정상 완료'
    WHEN status = 'failed' THEN '실패'
    WHEN status = 'processing' AND finished_at IS NULL THEN '진행 중'
    ELSE '알 수 없음'
  END as completion_status,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - COALESCE(started_at, created_at))) as elapsed_seconds,
  result->>'subPageCount' as sub_page_count,
  result->>'maxDepth' as max_depth,
  result->>'domainLimit' as domain_limit
FROM processing_jobs
WHERE id = '16427b29-a9f5-4e30-8efd-e78e57a0a0c9';








