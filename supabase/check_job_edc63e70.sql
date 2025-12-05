-- 작업 edc63e70-3311-4cb6-acf8-0aee54371e4c 분석
-- maxDepth 3, 도메인 제한 해제 상태에서 하위 도메인 0개 문제 분석

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
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_array_length
FROM processing_jobs
WHERE id = 'edc63e70-3311-4cb6-acf8-0aee54371e4c';

-- 2. 작업이 진행 중인지 확인 (가장 최근 CRAWL_SEED 작업)
SELECT 
  id,
  status,
  started_at,
  finished_at,
  CASE 
    WHEN finished_at IS NULL AND started_at IS NOT NULL THEN '진행 중'
    WHEN finished_at IS NOT NULL THEN '완료'
    ELSE '대기 중'
  END as job_state,
  EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - COALESCE(started_at, created_at))) as elapsed_seconds
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 5;

-- 3. 작업 시작 시간 이후 생성된 모든 ads.naver.com 문서 확인
SELECT 
  d.id,
  d.url,
  d.title,
  d.status,
  d.chunk_count,
  d.created_at,
  REGEXP_REPLACE(d.url, '^https?://([^/]+).*', '\1') as hostname,
  CASE 
    WHEN REGEXP_REPLACE(d.url, '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(d.url, '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END as domain_type
FROM documents d
WHERE d.url ILIKE '%ads.naver.com%'
  AND d.created_at >= (
    SELECT COALESCE(started_at, created_at) FROM processing_jobs 
    WHERE id = 'edc63e70-3311-4cb6-acf8-0aee54371e4c'
  )
ORDER BY d.created_at DESC
LIMIT 50;

-- 4. 작업 결과에서 발견된 하위 페이지 URL 확인 (도메인 분석)
-- 작업이 완료된 후에만 실행 가능
WITH sub_pages AS (
  SELECT 
    jsonb_array_elements(result->'subPages') as sub_page
  FROM processing_jobs
  WHERE id = 'edc63e70-3311-4cb6-acf8-0aee54371e4c'
    AND result->'subPages' IS NOT NULL
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
FROM sub_pages
ORDER BY domain_type, url
LIMIT 50;

-- 5. 실제 인덱싱된 문서의 도메인 분포
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
    WHERE id = 'edc63e70-3311-4cb6-acf8-0aee54371e4c'
  )
GROUP BY 
  REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1'),
  CASE 
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') = 'ads.naver.com' THEN '기본 도메인'
    WHEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1') LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END
ORDER BY document_count DESC;

