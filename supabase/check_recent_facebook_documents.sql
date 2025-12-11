-- 최근 Facebook 관련 문서 생성 시간 확인
SELECT 
  id,
  title,
  url,
  status,
  chunk_count,
  created_at,
  updated_at,
  main_document_id,
  source_vendor,
  EXTRACT(EPOCH FROM (updated_at - created_at)) as processing_duration_seconds
FROM documents
WHERE (
  url LIKE '%facebook.com%' 
  OR url LIKE '%ko-kr.facebook.com%'
  OR title LIKE '%facebook%'
)
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 50;




