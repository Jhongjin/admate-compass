-- 최근 CRAWL_SEED 작업 완료 시간 및 생성된 문서 확인
SELECT 
  pj.id as job_id,
  pj.status as job_status,
  pj.created_at as job_created_at,
  pj.started_at as job_started_at,
  pj.finished_at as job_finished_at,
  EXTRACT(EPOCH FROM (pj.finished_at - pj.started_at)) as duration_seconds,
  pj.payload->>'url' as crawl_url,
  pj.result->>'totalDocuments' as result_total_documents,
  pj.result->>'mainDocIndexed' as result_main_doc_indexed,
  pj.result->>'subPageIndexed' as result_sub_page_indexed,
  -- 생성된 문서 수 확인
  COUNT(DISTINCT d.id) as created_documents_count,
  -- 인덱싱된 문서 수 확인
  COUNT(DISTINCT CASE WHEN d.status = 'indexed' THEN d.id END) as indexed_documents_count,
  -- 문서 생성 시간 범위
  MIN(d.created_at) as first_document_created_at,
  MAX(d.created_at) as last_document_created_at,
  MAX(d.updated_at) as last_document_updated_at
FROM processing_jobs pj
LEFT JOIN documents d ON (
  d.id = pj.document_id 
  OR d.main_document_id = pj.document_id
  OR (d.url IS NOT NULL AND d.url LIKE '%' || (pj.payload->>'url') || '%')
)
WHERE pj.job_type = 'CRAWL_SEED'
  AND pj.created_at >= NOW() - INTERVAL '7 days'
GROUP BY pj.id, pj.status, pj.created_at, pj.started_at, pj.finished_at, pj.payload, pj.result
ORDER BY pj.created_at DESC
LIMIT 10;



