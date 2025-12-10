-- 최신 크롤링 작업에서 하위 도메인 발견 여부 확인
-- 작업 결과에서 실제로 발견된 URL의 hostname을 확인

-- 1. 가장 최근 완료된 CRAWL_SEED 작업 찾기
SELECT 
  id,
  status,
  started_at,
  finished_at,
  result->>'maxDepth' as max_depth,
  result->>'domainLimit' as domain_limit,
  result->>'extractSubPages' as extract_sub_pages,
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_count
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND status = 'completed'
  AND created_at >= NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC
LIMIT 1;

-- 2. 위 쿼리에서 찾은 작업 ID를 사용하여 발견된 URL의 hostname 분포 확인
-- 작업 ID를 아래에 입력하세요 (예: 'edc63e70-3311-4cb6-acf8-0aee54371e4c')
WITH job_data AS (
  SELECT 
    id,
    result->'subPages' as sub_pages,
    result->>'maxDepth' as max_depth,
    result->>'domainLimit' as domain_limit
  FROM processing_jobs
  WHERE id = (
    SELECT id FROM processing_jobs
    WHERE job_type = 'CRAWL_SEED'
      AND status = 'completed'
      AND created_at >= NOW() - INTERVAL '2 hours'
    ORDER BY created_at DESC
    LIMIT 1
  )
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

-- 3. 하위 도메인 URL 샘플 확인 (실제로 하위 도메인이 발견되었는지)
WITH job_data AS (
  SELECT 
    id,
    result->'subPages' as sub_pages
  FROM processing_jobs
  WHERE id = (
    SELECT id FROM processing_jobs
    WHERE job_type = 'CRAWL_SEED'
      AND status = 'completed'
      AND created_at >= NOW() - INTERVAL '2 hours'
    ORDER BY created_at DESC
    LIMIT 1
  )
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
  AND REGEXP_REPLACE(sub_page->>'url', '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' -- 하위 도메인만
ORDER BY url
LIMIT 20;

-- 4. 모든 발견된 URL의 hostname 목록 (중복 제거)
WITH job_data AS (
  SELECT 
    id,
    result->'subPages' as sub_pages
  FROM processing_jobs
  WHERE id = (
    SELECT id FROM processing_jobs
    WHERE job_type = 'CRAWL_SEED'
      AND status = 'completed'
      AND created_at >= NOW() - INTERVAL '2 hours'
    ORDER BY created_at DESC
    LIMIT 1
  )
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

-- 5. 실제 인덱싱된 문서의 hostname 분포 (최근 2시간)
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
  AND created_at >= NOW() - INTERVAL '2 hours'
GROUP BY 
  REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1'),
  CASE 
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END
ORDER BY document_count DESC;



