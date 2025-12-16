-- maxDepth 3, 도메인 제한 해제 크롤링 결과 분석
-- 작업 ID: b379f7bf-e11b-4518-82a5-4cbe5595aaaf
-- 도메인: ads.naver.com
-- maxDepth: 3
-- domainLimit: false

-- 1. 최근 작업 상태 확인 (가장 최근 CRAWL_SEED 작업)
SELECT 
  id,
  job_type,
  status,
  document_id,
  started_at,
  finished_at,
  created_at,
  updated_at,
  error,
  result->>'subPageCount' as sub_page_count,
  result->>'crawlTimeMs' as crawl_time_ms,
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_array_length
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND document_id IN (
    SELECT id FROM documents WHERE url ILIKE '%ads.naver.com%' ORDER BY created_at DESC LIMIT 1
  )
ORDER BY created_at DESC
LIMIT 5;

-- 2. 최근 크롤링된 문서 통계 (작업 시작 시간 이후)
WITH recent_job AS (
  SELECT 
    id,
    document_id,
    created_at as job_started_at,
    finished_at as job_finished_at,
    status as job_status
  FROM processing_jobs
  WHERE job_type = 'CRAWL_SEED'
    AND created_at >= NOW() - INTERVAL '1 hour'
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT 
  COUNT(*) as total_documents,
  COUNT(CASE WHEN status = 'indexed' THEN 1 END) as indexed_count,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
  SUM(chunk_count) as total_chunks,
  MIN(created_at) as first_document_created,
  MAX(created_at) as last_document_created
FROM documents d
CROSS JOIN recent_job rj
WHERE d.url ILIKE '%ads.naver.com%'
  AND d.created_at >= rj.job_started_at;

-- 3. 도메인별 문서 분포 (실제 크롤링된 도메인 확인)
WITH recent_job AS (
  SELECT 
    id,
    document_id,
    created_at as job_started_at
  FROM processing_jobs
  WHERE job_type = 'CRAWL_SEED'
    AND created_at >= NOW() - INTERVAL '1 hour'
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT 
  CASE 
    WHEN url LIKE 'https://ads.naver.com%' OR url LIKE 'http://ads.naver.com%' 
    THEN 'ads.naver.com'
    WHEN url LIKE '%ads.naver.com%' 
    THEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1')
    ELSE 'unknown'
  END as domain,
  COUNT(*) as document_count,
  COUNT(CASE WHEN status = 'indexed' THEN 1 END) as indexed_count,
  SUM(chunk_count) as total_chunks
FROM documents d
CROSS JOIN recent_job rj
WHERE d.url ILIKE '%ads.naver.com%'
  AND d.created_at >= rj.job_started_at
GROUP BY 
  CASE 
    WHEN url LIKE 'https://ads.naver.com%' OR url LIKE 'http://ads.naver.com%' 
    THEN 'ads.naver.com'
    WHEN url LIKE '%ads.naver.com%' 
    THEN REGEXP_REPLACE(url, '^https?://([^/]+).*', '\1')
    ELSE 'unknown'
  END
ORDER BY document_count DESC;

-- 4. 하위 도메인 확인 (ads.naver.com의 하위 도메인)
WITH recent_job AS (
  SELECT 
    id,
    document_id,
    created_at as job_started_at
  FROM processing_jobs
  WHERE job_type = 'CRAWL_SEED'
    AND created_at >= NOW() - INTERVAL '1 hour'
  ORDER BY created_at DESC
  LIMIT 1
),
domain_extracted AS (
  SELECT 
    d.id,
    d.url,
    d.status,
    d.chunk_count,
    REGEXP_REPLACE(d.url, '^https?://([^/]+).*', '\1') as hostname
  FROM documents d
  CROSS JOIN recent_job rj
  WHERE d.url ILIKE '%ads.naver.com%'
    AND d.created_at >= rj.job_started_at
)
SELECT 
  hostname,
  COUNT(*) as count,
  COUNT(CASE WHEN status = 'indexed' THEN 1 END) as indexed_count,
  CASE 
    WHEN hostname = 'ads.naver.com' THEN '기본 도메인'
    WHEN hostname LIKE '%.ads.naver.com' THEN '하위 도메인'
    ELSE '다른 도메인'
  END as domain_type
FROM domain_extracted
GROUP BY hostname
ORDER BY count DESC;

-- 5. 작업 결과에서 발견된 URL 수 확인
SELECT 
  id,
  job_type,
  status,
  result->>'subPageCount' as sub_page_count_from_result,
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_array_length,
  result->>'subPageCount' as sub_page_count,
  result->>'crawlTimeMs' as crawl_time_ms,
  result->>'timeout' as timeout_flag,
  result->>'partialSuccess' as partial_success,
  result->'subPages' as sub_pages_sample
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 1;

-- 6. 실제 인덱싱된 문서 URL 샘플 (도메인 확인용)
SELECT 
  id,
  url,
  title,
  status,
  chunk_count,
  created_at
FROM documents
WHERE url ILIKE '%ads.naver.com%'
  AND status = 'indexed'
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 30;

-- 7. 타임아웃 여부 확인
SELECT 
  id,
  status,
  error,
  result->>'timeout' as timeout_flag,
  result->>'partialSuccess' as partial_success,
  result->>'indexedCount' as indexed_count_on_timeout,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds
FROM processing_jobs
WHERE job_type = 'CRAWL_SEED'
  AND created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 1;








