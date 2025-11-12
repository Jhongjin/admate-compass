-- URL 크롤링 문서의 url 필드가 누락된 경우 수정
-- processing_jobs의 CRAWL_SEED 작업에서 URL 정보를 가져와서 documents 테이블의 url 필드를 업데이트

-- 1. 메인 문서의 URL 업데이트 (CRAWL_SEED 작업의 document_id와 일치하는 문서)
UPDATE documents d
SET url = (
  SELECT payload->>'url'
  FROM processing_jobs pj
  WHERE pj.job_type = 'CRAWL_SEED'
    AND pj.document_id = d.id
    AND pj.status = 'completed'
    AND pj.payload->>'url' IS NOT NULL
  LIMIT 1
)
WHERE d.type = 'url'
  AND (d.url IS NULL OR d.url = '')
  AND EXISTS (
    SELECT 1
    FROM processing_jobs pj
    WHERE pj.job_type = 'CRAWL_SEED'
      AND pj.document_id = d.id
      AND pj.status = 'completed'
      AND pj.payload->>'url' IS NOT NULL
  );

-- 2. 하위 페이지의 URL 업데이트 (문서 제목이나 다른 정보로 추론 불가능하므로, 
--    실제로는 크롤링 시 저장되어야 함)
--    하지만 이미 저장된 문서 중에서 url이 없는 경우, 
--    같은 도메인의 다른 문서들과 비교하여 추론할 수 없으므로
--    이 쿼리는 메인 문서만 업데이트합니다.

-- 3. 결과 확인
SELECT 
  '업데이트 결과' as info,
  COUNT(*) FILTER (WHERE type = 'url' AND url IS NOT NULL AND url != '') as url_docs_with_url,
  COUNT(*) FILTER (WHERE type = 'url' AND (url IS NULL OR url = '')) as url_docs_without_url,
  COUNT(*) FILTER (WHERE type = 'url') as total_url_docs
FROM documents
WHERE updated_at >= NOW() - INTERVAL '1 day';



