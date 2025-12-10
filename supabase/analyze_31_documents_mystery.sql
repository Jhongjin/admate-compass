-- 31개 문서 표시 원인 분석 쿼리
-- 이전 크롤 작업이 실제로 완료되었는지, 언제 완료되었는지 확인

-- 1. 최근 CRAWL_SEED 작업 완료 시간 및 생성된 문서 수
WITH job_docs AS (
  SELECT 
    pj.id as job_id,
    pj.status as job_status,
    pj.created_at as job_created_at,
    pj.started_at as job_started_at,
    pj.finished_at as job_finished_at,
    EXTRACT(EPOCH FROM (pj.finished_at - pj.started_at)) as duration_seconds,
    pj.payload->>'url' as crawl_url,
    pj.document_id as main_document_id,
    -- 생성된 문서 수
    COUNT(DISTINCT d.id) as total_documents,
    -- 인덱싱된 문서 수
    COUNT(DISTINCT CASE WHEN d.status = 'indexed' THEN d.id END) as indexed_documents,
    -- 문서 생성 시간 범위
    MIN(d.created_at) as first_doc_created_at,
    MAX(d.created_at) as last_doc_created_at,
    MAX(d.updated_at) as last_doc_updated_at
  FROM processing_jobs pj
  LEFT JOIN documents d ON (
    d.id = pj.document_id 
    OR d.main_document_id = pj.document_id
    OR (d.url IS NOT NULL AND pj.payload->>'url' IS NOT NULL AND d.url LIKE '%' || (pj.payload->>'url') || '%')
  )
  WHERE pj.job_type = 'CRAWL_SEED'
    AND pj.created_at >= NOW() - INTERVAL '7 days'
  GROUP BY pj.id, pj.status, pj.created_at, pj.started_at, pj.finished_at, pj.payload, pj.document_id
)
SELECT 
  job_id,
  job_status,
  crawl_url,
  job_created_at,
  job_started_at,
  job_finished_at,
  duration_seconds,
  total_documents,
  indexed_documents,
  first_doc_created_at,
  last_doc_created_at,
  last_doc_updated_at,
  -- 작업 완료 후 문서 생성까지 걸린 시간
  EXTRACT(EPOCH FROM (first_doc_created_at - job_finished_at)) as doc_creation_delay_seconds,
  -- 마지막 문서 업데이트까지 걸린 시간
  EXTRACT(EPOCH FROM (last_doc_updated_at - job_finished_at)) as doc_update_delay_seconds
FROM job_docs
ORDER BY job_finished_at DESC NULLS LAST, job_created_at DESC
LIMIT 10;

-- 2. Facebook 관련 문서 생성 시간 분포
SELECT 
  DATE_TRUNC('hour', created_at) as created_hour,
  COUNT(*) as doc_count,
  COUNT(CASE WHEN status = 'indexed' THEN 1 END) as indexed_count,
  MIN(created_at) as first_created,
  MAX(created_at) as last_created
FROM documents
WHERE (
  url LIKE '%facebook.com%' 
  OR url LIKE '%ko-kr.facebook.com%'
)
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY created_hour DESC
LIMIT 20;

-- 3. 작업 완료 시간과 문서 생성 시간 비교 (타이밍 분석)
SELECT 
  pj.id as job_id,
  pj.status,
  pj.finished_at as job_finished_at,
  COUNT(DISTINCT d.id) as doc_count,
  MIN(d.created_at) as first_doc_created,
  MAX(d.created_at) as last_doc_created,
  MAX(d.updated_at) as last_doc_updated,
  -- 작업 완료 전에 생성된 문서 수
  COUNT(DISTINCT CASE WHEN d.created_at < pj.finished_at THEN d.id END) as docs_created_before_finish,
  -- 작업 완료 후에 생성된 문서 수
  COUNT(DISTINCT CASE WHEN d.created_at >= pj.finished_at THEN d.id END) as docs_created_after_finish,
  -- 작업 완료 후에 업데이트된 문서 수
  COUNT(DISTINCT CASE WHEN d.updated_at >= pj.finished_at THEN d.id END) as docs_updated_after_finish
FROM processing_jobs pj
LEFT JOIN documents d ON (
  d.id = pj.document_id 
  OR d.main_document_id = pj.document_id
  OR (d.url IS NOT NULL AND pj.payload->>'url' IS NOT NULL AND d.url LIKE '%' || (pj.payload->>'url') || '%')
)
WHERE pj.job_type = 'CRAWL_SEED'
  AND pj.payload->>'url' LIKE '%ko-kr.facebook.com%'
  AND pj.created_at >= NOW() - INTERVAL '7 days'
  AND pj.finished_at IS NOT NULL
GROUP BY pj.id, pj.status, pj.finished_at
ORDER BY pj.finished_at DESC
LIMIT 5;



