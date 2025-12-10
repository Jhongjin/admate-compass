-- 작업 b379f7bf-e11b-4518-82a5-4cbe5595aaaf 상세 분석
-- 실행 시간 5초로 완료된 것으로 기록되었지만, 실제로는 문제가 있을 수 있음

-- 1. 작업 상세 정보 및 결과 확인
SELECT 
  id,
  job_type,
  status,
  document_id,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds,
  error,
  result,
  result->>'subPageCount' as sub_page_count,
  result->>'crawlTimeMs' as crawl_time_ms,
  result->>'timeout' as timeout_flag,
  result->>'partialSuccess' as partial_success,
  result->>'indexedCount' as indexed_count,
  result->>'subPages' as sub_pages_json,
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_array_length
FROM processing_jobs
WHERE id = 'b379f7bf-e11b-4518-82a5-4cbe5595aaaf';

-- 2. 해당 작업과 연결된 문서 확인
SELECT 
  d.id,
  d.url,
  d.title,
  d.status,
  d.chunk_count,
  d.type,
  d.main_document_id,
  d.created_at,
  d.updated_at,
  COUNT(dc.id) as actual_chunks,
  COUNT(CASE WHEN dc.embedding IS NOT NULL THEN 1 END) as embeddings_count
FROM documents d
LEFT JOIN document_chunks dc ON dc.document_id = d.id
WHERE d.id = (
  SELECT document_id FROM processing_jobs WHERE id = 'b379f7bf-e11b-4518-82a5-4cbe5595aaaf'
)
GROUP BY d.id, d.url, d.title, d.status, d.chunk_count, d.type, d.main_document_id, d.created_at, d.updated_at;

-- 3. 작업 시작 시간 이후 생성된 모든 ads.naver.com 문서 확인
SELECT 
  d.id,
  d.url,
  d.title,
  d.status,
  d.chunk_count,
  d.type,
  d.main_document_id,
  d.created_at,
  COUNT(dc.id) as actual_chunks,
  COUNT(CASE WHEN dc.embedding IS NOT NULL THEN 1 END) as embeddings_count
FROM documents d
LEFT JOIN document_chunks dc ON dc.document_id = d.id
WHERE d.url ILIKE '%ads.naver.com%'
  AND d.created_at >= '2025-12-05 02:21:43'  -- 작업 시작 시간
  AND d.created_at <= '2025-12-05 02:21:50'  -- 작업 종료 시간 + 여유
GROUP BY d.id, d.url, d.title, d.status, d.chunk_count, d.type, d.main_document_id, d.created_at
ORDER BY d.created_at DESC;

-- 4. 작업 결과에서 하위 페이지 상세 확인
SELECT 
  id,
  result->'subPages' as sub_pages_full,
  jsonb_array_elements(result->'subPages') as sub_page_item
FROM processing_jobs
WHERE id = 'b379f7bf-e11b-4518-82a5-4cbe5595aaaf'
  AND result->'subPages' IS NOT NULL;

-- 5. 작업 결과에서 발견된 URL 수 vs 실제 인덱싱된 문서 수 비교
WITH job_result AS (
  SELECT 
    id,
    document_id,
    result->>'subPageCount' as sub_page_count_str,
    jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_array_length,
    result->'subPages' as sub_pages_json
  FROM processing_jobs
  WHERE id = 'b379f7bf-e11b-4518-82a5-4cbe5595aaaf'
),
indexed_docs AS (
  SELECT 
    COUNT(*) as total_indexed,
    COUNT(CASE WHEN main_document_id IS NULL THEN 1 END) as main_docs,
    COUNT(CASE WHEN main_document_id IS NOT NULL THEN 1 END) as sub_docs
  FROM documents
  WHERE url ILIKE '%ads.naver.com%'
    AND created_at >= '2025-12-05 02:21:43'
    AND created_at <= '2025-12-05 02:21:50'
    AND status = 'indexed'
)
SELECT 
  jr.sub_page_count_str,
  jr.sub_pages_array_length,
  id.total_indexed,
  id.main_docs,
  id.sub_docs,
  CASE 
    WHEN jr.sub_pages_array_length::int > 0 THEN 
      ROUND((id.total_indexed::numeric / jr.sub_pages_array_length::numeric) * 100, 2)
    ELSE NULL
  END as indexing_percentage
FROM job_result jr
CROSS JOIN indexed_docs id;

-- 6. 작업이 너무 빨리 완료된 원인 분석
-- 5초만에 완료된 것은 비정상적 - 에러가 발생했거나 크롤링이 실제로 시작되지 않았을 수 있음
SELECT 
  id,
  status,
  error,
  result->>'error' as result_error,
  result->>'subPageCount' as sub_page_count,
  result->>'crawlTimeMs' as crawl_time_ms,
  CASE 
    WHEN result->>'subPageCount' IS NULL OR result->>'subPageCount' = '0' THEN '하위 페이지 없음'
    WHEN result->>'error' IS NOT NULL THEN '에러 발생'
    WHEN EXTRACT(EPOCH FROM (finished_at - started_at)) < 10 THEN '너무 빠른 완료 (의심)'
    ELSE '정상'
  END as analysis
FROM processing_jobs
WHERE id = 'b379f7bf-e11b-4518-82a5-4cbe5595aaaf';

-- 7. 작업 로그 확인 (가능한 경우)
-- Vercel 로그에서 확인해야 하지만, 작업 시작/종료 시간을 기준으로 문서 생성 시간 확인
SELECT 
  '작업 시작' as event,
  '2025-12-05 02:21:43.438+00'::timestamptz as timestamp
UNION ALL
SELECT 
  '작업 종료' as event,
  '2025-12-05 02:21:48.611+00'::timestamptz as timestamp
UNION ALL
SELECT 
  '문서 생성' as event,
  created_at as timestamp
FROM documents
WHERE url ILIKE '%ads.naver.com%'
  AND created_at >= '2025-12-05 02:21:43'
  AND created_at <= '2025-12-05 02:21:50'
ORDER BY timestamp;



