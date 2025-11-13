-- documents 테이블의 type과 url 값 확인
-- 그룹화 문제 디버깅용

SELECT 
  id,
  title,
  type,
  type::text as type_text,
  url,
  url::text as url_text,
  status,
  updated_at,
  CASE 
    WHEN type = 'url' THEN '✅ URL 타입'
    WHEN type = 'file' THEN '📄 FILE 타입'
    ELSE '❓ 알 수 없음: ' || COALESCE(type::text, 'NULL')
  END as type_status,
  CASE 
    WHEN url IS NOT NULL AND url != '' THEN '✅ URL 있음'
    ELSE '❌ URL 없음'
  END as url_status,
  CASE 
    WHEN type = 'url' AND url IS NOT NULL AND url != '' THEN '✅ URL 문서'
    ELSE '❌ URL 문서 아님'
  END as is_url_document
FROM documents
WHERE updated_at >= NOW() - INTERVAL '1 day'
ORDER BY updated_at DESC
LIMIT 30;

-- 통계
SELECT 
  type,
  COUNT(*) as count,
  COUNT(CASE WHEN url IS NOT NULL AND url != '' THEN 1 END) as with_url,
  COUNT(CASE WHEN url IS NULL OR url = '' THEN 1 END) as without_url
FROM documents
WHERE updated_at >= NOW() - INTERVAL '1 day'
GROUP BY type;




