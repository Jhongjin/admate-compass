-- maxDepth 4 크롤링 결과 분석
-- 작업 94dbed16-d450-4957-873d-56ba43306811 분석

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
WHERE id = '94dbed16-d450-4957-873d-56ba43306811';

-- 2. 작업 결과에서 발견된 모든 URL의 hostname 분포 확인
WITH job_data AS (
  SELECT 
    id,
    result->'subPages' as sub_pages,
    result->>'maxDepth' as max_depth,
    result->>'domainLimit' as domain_limit,
    result->>'includeExternal' as include_external
  FROM processing_jobs
  WHERE id = '94dbed16-d450-4957-873d-56ba43306811'
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

-- 3. 다른 도메인 URL 샘플 확인 (실제로 다른 도메인이 발견되었는지)
WITH job_data AS (
  SELECT 
    id,
    result->'subPages' as sub_pages
  FROM processing_jobs
  WHERE id = '94dbed16-d450-4957-873d-56ba43306811'
    AND result->'subPages' IS NOT NULL
),
sub_pages_expanded AS (
  SELECT 
    jsonb_array_elements(sub_pages) as sub_page
  FROM job_data
)
SELECT 
  sub_page->>'url' as url,
  REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') as hostname,
  CASE 
    WHEN REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END as domain_type,
  sub_page->>'status' as status,
  sub_page->>'success' as success
FROM sub_pages_expanded
WHERE sub_page->>'url' IS NOT NULL
  AND REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') != 'ads.naver.com'
  AND REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') NOT LIKE '%.ads.naver.com' -- 다른 도메인만
ORDER BY url
LIMIT 20;

-- 4. 모든 발견된 URL의 hostname 목록 (중복 제거)
WITH job_data AS (
  SELECT 
    id,
    result->'subPages' as sub_pages
  FROM processing_jobs
  WHERE id = '94dbed16-d450-4957-873d-56ba43306811'
    AND result->'subPages' IS NOT NULL
),
sub_pages_expanded AS (
  SELECT 
    jsonb_array_elements(sub_pages) as sub_page
  FROM job_data
)
SELECT DISTINCT
  REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') as hostname,
  CASE 
    WHEN REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END as domain_type
FROM sub_pages_expanded
WHERE sub_page->>'url' IS NOT NULL
ORDER BY domain_type, hostname;

-- 5. 실제 인덱싱된 문서의 hostname 분포
SELECT 
  REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') as hostname,
  CASE 
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END as domain_type,
  COUNT(*) as document_count,
  COUNT(CASE WHEN status = 'indexed' THEN 1 END) as indexed_count
FROM documents
WHERE url ILIKE '%ads.naver.com%'
  AND created_at >= (
    SELECT COALESCE(started_at, created_at) FROM processing_jobs 
    WHERE id = '94dbed16-d450-4957-873d-56ba43306811'
  )
GROUP BY 
  REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1'),
  CASE 
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END
ORDER BY document_count DESC;

-- 6. maxDepth 3과 maxDepth 4 비교 (최근 2시간 내 작업)
SELECT 
  id,
  result->>'maxDepth' as max_depth,
  result->>'domainLimit' as domain_limit,
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_count,
  result->>'subPageCount' as sub_page_count,
  started_at,
  finished_at
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'completed'
  AND created_at >= NOW() - INTERVAL '2 hours'
  AND (result->>'maxDepth' = '3' OR result->>'maxDepth' = '4')
ORDER BY created_at DESC;




