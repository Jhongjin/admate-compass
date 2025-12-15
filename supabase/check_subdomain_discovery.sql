-- 하위 도메인 발견 여부 확인 쿼리
-- 작업 결과에서 실제로 발견된 URL의 hostname을 확인하여 하위 도메인이 있는지 확인

-- 1. 가장 최근 CRAWL_SEED 작업 찾기
SELECT 
  id,
  status,
  started_at,
  finished_at,
  result->>'maxDepth' as max_depth,
  result->>'domainLimit' as domain_limit,
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_count
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 1;

-- 2. 작업 결과에서 발견된 모든 URL의 hostname 추출 (하위 도메인 확인)
-- 위 쿼리에서 찾은 작업 ID를 아래에 입력하세요
WITH job_data AS (
  SELECT 
    id,
    result->'subPages' as sub_pages
  FROM processing_jobs
  WHERE id = 'edc63e70-3311-4cb6-acf8-0aee54371e4c' -- 작업 ID를 여기에 입력
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
  COUNT(CASE WHEN sub_page->>'status' = 'failed' THEN 1 END) as failed_count
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
  WHERE id = 'edc63e70-3311-4cb6-acf8-0aee54371e4c' -- 작업 ID를 여기에 입력
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

-- 4. 실제 인덱싱된 문서의 hostname 분포 (최근 1시간)
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
  AND created_at >= NOW() - INTERVAL '1 hour'
GROUP BY 
  REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1'),
  CASE 
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END
ORDER BY document_count DESC;






