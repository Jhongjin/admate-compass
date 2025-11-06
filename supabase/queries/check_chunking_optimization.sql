-- 특정 문서의 청킹 최적화 확인 쿼리
-- '2025_Introduction_to_Meta_Meta_기본소개서_external.pdf' 파일의 청킹 상태 확인

-- 1. 문서 기본 정보
SELECT 
  id,
  title,
  type,
  status,
  chunk_count as db_chunk_count,
  file_size,
  file_type,
  LENGTH(content) as content_length,
  created_at,
  updated_at
FROM documents
WHERE title LIKE '%2025_Introduction_to_Meta_Meta_기본소개서_external%'
   OR title LIKE '%2025_Introduc%'
ORDER BY created_at DESC
LIMIT 5;

-- 2. 실제 청크 수 확인
SELECT 
  d.id as document_id,
  d.title,
  d.chunk_count as db_chunk_count,
  COUNT(dc.chunk_id) as actual_chunk_count,
  COUNT(dc.chunk_id) FILTER (WHERE dc.embedding IS NOT NULL) as chunks_with_embedding,
  AVG(LENGTH(dc.content)) as avg_chunk_size,
  MIN(LENGTH(dc.content)) as min_chunk_size,
  MAX(LENGTH(dc.content)) as max_chunk_size,
  SUM(LENGTH(dc.content)) as total_chunk_content_length,
  d.content_length as document_content_length,
  CASE 
    WHEN COUNT(dc.chunk_id) = 0 THEN '❌ 청크 없음'
    WHEN COUNT(dc.chunk_id) = 1 AND d.content_length > 10000 THEN '⚠️ 청크 1개 (의심)'
    WHEN COUNT(dc.chunk_id) < 10 AND d.content_length > 100000 THEN '⚠️ 청크 수 부족 (의심)'
    WHEN d.chunk_count != COUNT(dc.chunk_id) THEN '⚠️ DB 기록과 실제 불일치'
    ELSE '✅ 정상'
  END as chunk_status
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.title LIKE '%2025_Introduction_to_Meta_Meta_기본소개서_external%'
   OR d.title LIKE '%2025_Introduc%'
GROUP BY d.id, d.title, d.chunk_count, d.content_length
ORDER BY d.created_at DESC
LIMIT 5;

-- 3. 청크 상세 정보 (첫 10개)
SELECT 
  dc.chunk_id,
  dc.document_id,
  LENGTH(dc.content) as chunk_size,
  dc.content::text as chunk_preview,
  dc.metadata->>'chunk_type' as chunk_type,
  dc.metadata->>'section_title' as section_title,
  dc.hierarchy_level,
  dc.parent_chunk_id,
  CASE WHEN dc.embedding IS NOT NULL THEN '✅' ELSE '❌' END as has_embedding
FROM document_chunks dc
WHERE dc.document_id IN (
  SELECT id FROM documents 
  WHERE title LIKE '%2025_Introduction_to_Meta_Meta_기본소개서_external%'
     OR title LIKE '%2025_Introduc%'
  ORDER BY created_at DESC LIMIT 1
)
ORDER BY dc.metadata->>'chunk_index'::int NULLS LAST
LIMIT 10;

-- 4. 청킹 전략 분석 (내용 길이 기반)
SELECT 
  d.id,
  d.title,
  LENGTH(d.content) as content_length,
  CASE 
    WHEN LENGTH(d.content) < 1000 THEN '매우 작음 (<1KB)'
    WHEN LENGTH(d.content) < 10000 THEN '작음 (<10KB)'
    WHEN LENGTH(d.content) < 100000 THEN '보통 (<100KB)'
    WHEN LENGTH(d.content) < 1000000 THEN '큼 (<1MB)'
    WHEN LENGTH(d.content) < 1500000 THEN '매우 큼 (<1.5MB)'
    ELSE '거대함 (>=1.5MB)'
  END as size_category,
  CASE 
    WHEN LENGTH(d.content) < 1000 THEN 50
    WHEN LENGTH(d.content) < 10000 THEN 100
    WHEN LENGTH(d.content) < 100000 THEN 200
    ELSE 500
  END as expected_max_chunks,
  COUNT(dc.chunk_id) as actual_chunks,
  CASE 
    WHEN COUNT(dc.chunk_id) = 0 THEN '❌ 청킹 실패'
    WHEN COUNT(dc.chunk_id) = 1 AND LENGTH(d.content) > 10000 THEN '⚠️ 청킹 부족 (1개만 생성)'
    WHEN COUNT(dc.chunk_id) < 10 AND LENGTH(d.content) > 100000 THEN '⚠️ 청킹 부족 (10개 미만)'
    ELSE '✅ 정상'
  END as optimization_status
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.title LIKE '%2025_Introduction_to_Meta_Meta_기본소개서_external%'
   OR d.title LIKE '%2025_Introduc%'
GROUP BY d.id, d.title, d.content
ORDER BY d.created_at DESC
LIMIT 5;

