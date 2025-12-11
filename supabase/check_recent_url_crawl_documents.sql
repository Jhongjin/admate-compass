-- 최근 URL 크롤링으로 생성된 문서 확인 (최근 1시간, URL이 있는 문서만)
SELECT
  id,
  title,
  url,
  type,
  status,
  chunk_count,
  created_at,
  updated_at,
  CASE 
    WHEN url LIKE '%facebook.com%' THEN 'Facebook'
    WHEN url LIKE '%instagram.com%' THEN 'Instagram'
    WHEN url LIKE '%naver.com%' THEN 'Naver'
    ELSE '기타'
  END as domain_type
FROM documents
WHERE created_at >= NOW() - INTERVAL '1 hour'
  AND url IS NOT NULL
  AND type = 'url'
ORDER BY created_at DESC
LIMIT 20;

-- 최근 URL 크롤링 문서 통계
SELECT
  COUNT(*) as total_url_documents,
  COUNT(CASE WHEN status = 'indexed' THEN 1 END) as indexed_count,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
  COUNT(CASE WHEN url LIKE '%facebook.com%' OR url LIKE '%instagram.com%' THEN 1 END) as meta_documents_count,
  COUNT(CASE WHEN url LIKE '%naver.com%' THEN 1 END) as naver_documents_count
FROM documents
WHERE created_at >= NOW() - INTERVAL '1 hour'
  AND url IS NOT NULL
  AND type = 'url';

-- Facebook/Instagram 크롤링 문서 상세
SELECT
  id,
  title,
  url,
  status,
  chunk_count,
  created_at,
  EXTRACT(EPOCH FROM (updated_at - created_at)) as processing_seconds
FROM documents
WHERE created_at >= NOW() - INTERVAL '1 hour'
  AND url IS NOT NULL
  AND type = 'url'
  AND (url LIKE '%facebook.com%' OR url LIKE '%instagram.com%' OR url LIKE '%ko-kr.facebook.com%')
ORDER BY created_at DESC
LIMIT 10;




