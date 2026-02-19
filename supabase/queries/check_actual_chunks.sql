-- 실제 DB에 저장된 청크 수 확인
-- 특정 문서의 실제 청크 수와 로그 불일치 확인

SELECT 
  d.id as document_id,
  d.title,
  d.chunk_count as db_recorded_chunk_count,
  COUNT(dc.chunk_id) as actual_chunk_count,
  COUNT(dc.chunk_id) FILTER (WHERE dc.embedding IS NOT NULL) as chunks_with_embedding,
  d.status,
  d.file_size,
  LENGTH(d.content) as content_length,
  d.created_at,
  d.updated_at,
  CASE 
    WHEN d.chunk_count != COUNT(dc.chunk_id) THEN '불일치'
    ELSE '일치'
  END as count_match_status
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.id = 'doc_1762491910669'  -- 최근 처리된 문서 ID
GROUP BY d.id, d.title, d.chunk_count, d.status, d.file_size, d.content, d.created_at, d.updated_at;

-- 상세 청크 정보 (첫 10개)
SELECT 
  chunk_id,
  document_id,
  metadata->>'chunk_index' as chunk_index,
  LENGTH(content) as chunk_length,
  hierarchy_level,
  parent_chunk_id,
  embedding IS NOT NULL as has_embedding,
  created_at
FROM document_chunks
WHERE document_id = 'doc_1762491910669'
ORDER BY (metadata->>'chunk_index')::INTEGER
LIMIT 10;

-- 청크 통계
SELECT 
  COUNT(*) as total_chunks,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) as chunks_with_embedding,
  COUNT(*) FILTER (WHERE hierarchy_level IS NOT NULL) as chunks_with_hierarchy,
  COUNT(*) FILTER (WHERE parent_chunk_id IS NOT NULL) as chunks_with_parent,
  AVG(LENGTH(content)) as avg_chunk_size,
  MIN(LENGTH(content)) as min_chunk_size,
  MAX(LENGTH(content)) as max_chunk_size,
  SUM(LENGTH(content)) as total_content_length
FROM document_chunks
WHERE document_id = 'doc_1762491910669';

