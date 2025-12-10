-- 최근 인덱싱된 문서 확인 (최근 1시간)
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
    WHEN url IS NULL THEN 'URL 없음 (파일 업로드 문서)'
    WHEN url LIKE '%facebook.com%' THEN 'Facebook 문서'
    WHEN url LIKE '%instagram.com%' THEN 'Instagram 문서'
    ELSE '기타'
  END as document_category
FROM documents
WHERE created_at >= NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 20;

-- 최근 인덱싱된 문서 통계
SELECT
  COUNT(*) as total_documents,
  COUNT(CASE WHEN status = 'indexed' THEN 1 END) as indexed_count,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
  COUNT(CASE WHEN url IS NULL THEN 1 END) as no_url_count,
  COUNT(CASE WHEN url LIKE '%facebook.com%' OR url LIKE '%instagram.com%' THEN 1 END) as meta_documents_count
FROM documents
WHERE created_at >= NOW() - INTERVAL '1 hour';

-- URL이 없는 문서 (파일 업로드 문서)
SELECT
  id,
  title,
  type,
  status,
  chunk_count,
  created_at
FROM documents
WHERE created_at >= NOW() - INTERVAL '1 hour'
  AND url IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- Facebook 관련 문서
SELECT
  id,
  title,
  url,
  type,
  status,
  chunk_count,
  created_at
FROM documents
WHERE created_at >= NOW() - INTERVAL '1 hour'
  AND (url LIKE '%facebook.com%' OR url LIKE '%instagram.com%')
ORDER BY created_at DESC
LIMIT 10;



