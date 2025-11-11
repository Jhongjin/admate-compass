-- 그룹화 문제 디버깅 쿼리
-- 메인 URL과 하위 페이지 관계를 확인합니다.

-- 1. 최근 CRAWL_SEED 작업과 메인 문서 확인
WITH main_crawl_jobs AS (
  SELECT 
    id as job_id,
    document_id as main_document_id,
    payload->>'url' as main_url,
    status,
    created_at,
    finished_at
  FROM processing_jobs
  WHERE job_type = 'CRAWL_SEED'
    AND status = 'completed'
    AND document_id IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 10
),
-- 2. 메인 문서 정보
main_documents AS (
  SELECT 
    d.id,
    d.title,
    d.url,
    d.status,
    d.updated_at,
    mj.main_url as main_url_from_job,
    mj.job_id
  FROM documents d
  INNER JOIN main_crawl_jobs mj ON d.id = mj.main_document_id
  WHERE d.type = 'url'
),
-- 3. 하위 페이지 후보 (같은 도메인, 메인 URL로 시작하는 URL)
sub_page_candidates AS (
  SELECT 
    d.id,
    d.title,
    d.url,
    d.status,
    d.updated_at,
    md.id as potential_main_id,
    md.url as potential_main_url,
    md.main_url_from_job
  FROM documents d
  CROSS JOIN main_documents md
  WHERE d.type = 'url'
    AND d.id != md.id
    AND d.url LIKE md.main_url_from_job || '%'
    AND d.url != md.main_url_from_job
  ORDER BY md.main_url_from_job, d.url
)
-- 4. 결과 출력
SELECT * FROM (
  SELECT 
    '메인 문서' as type,
    md.id as document_id,
    md.title,
    md.url,
    md.main_url_from_job,
    md.status,
    md.updated_at,
    NULL as potential_main_id,
    NULL as potential_main_url,
    1 as sort_order
  FROM main_documents md

  UNION ALL

  SELECT 
    '하위 페이지 후보' as type,
    spc.id as document_id,
    spc.title,
    spc.url,
    NULL as main_url_from_job,
    spc.status,
    spc.updated_at,
    spc.potential_main_id,
    spc.potential_main_url,
    2 as sort_order
  FROM sub_page_candidates spc
) combined_results
ORDER BY 
  sort_order,
  potential_main_url,
  url;

-- 5. 통계 요약
SELECT 
  '통계' as info,
  COUNT(DISTINCT md.id) as main_documents_count,
  COUNT(DISTINCT spc.id) as sub_page_candidates_count,
  COUNT(DISTINCT spc.potential_main_url) as main_urls_with_subpages
FROM main_documents md
LEFT JOIN (
  SELECT DISTINCT 
    d.id,
    md.main_url_from_job as potential_main_url
  FROM documents d
  CROSS JOIN main_documents md
  WHERE d.type = 'url'
    AND d.id != md.id
    AND d.url LIKE md.main_url_from_job || '%'
    AND d.url != md.main_url_from_job
) spc ON md.main_url_from_job = spc.potential_main_url;

