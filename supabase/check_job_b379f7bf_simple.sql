-- 작업 b379f7bf-e11b-4518-82a5-4cbe5595aaaf 간단 확인 쿼리
-- 각 쿼리를 개별적으로 실행하세요

-- 1. 작업 기본 정보
SELECT 
  id,
  job_type,
  status,
  document_id,
  started_at,
  finished_at,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds,
  error
FROM processing_jobs
WHERE id = 'b379f7bf-e11b-4518-82a5-4cbe5595aaaf';

-- 2. 작업 결과 JSON 확인
SELECT 
  result->>'subPageCount' as sub_page_count,
  result->>'crawlTimeMs' as crawl_time_ms,
  result->>'timeout' as timeout_flag,
  result->>'partialSuccess' as partial_success,
  jsonb_array_length(COALESCE(result->'subPages', '[]'::jsonb)) as sub_pages_array_length
FROM processing_jobs
WHERE id = 'b379f7bf-e11b-4518-82a5-4cbe5595aaaf';

-- 3. 작업 시간대에 생성된 문서 확인
SELECT 
  id,
  url,
  title,
  status,
  chunk_count,
  created_at
FROM documents
WHERE url ILIKE '%ads.naver.com%'
  AND created_at >= '2025-12-05 02:21:43'
  AND created_at <= '2025-12-05 02:21:50'
ORDER BY created_at DESC;

-- 4. 문서 생성 시간 순서 확인
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






