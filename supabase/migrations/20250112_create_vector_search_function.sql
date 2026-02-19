-- 벡터 검색 함수 생성
CREATE OR REPLACE FUNCTION search_similar_chunks(
  query_text TEXT,
  match_threshold FLOAT DEFAULT 0.1,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id TEXT,
  content TEXT,
  metadata JSONB,
  document_id TEXT,
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE SQL
AS $$
  SELECT 
    dc.chunk_id,
    dc.content,
    dc.metadata,
    dc.document_id,
    dc.created_at,
    -- 간단한 텍스트 유사도 계산 (임시)
    CASE 
      WHEN dc.content ILIKE '%' || query_text || '%' THEN 0.8
      WHEN dc.content ILIKE '%' || split_part(query_text, ' ', 1) || '%' THEN 0.6
      WHEN dc.content ILIKE '%' || split_part(query_text, ' ', 2) || '%' THEN 0.4
      ELSE 0.2
    END as similarity
  FROM document_chunks dc
  WHERE 
    dc.content ILIKE '%' || query_text || '%'
    OR dc.content ILIKE '%' || split_part(query_text, ' ', 1) || '%'
    OR dc.content ILIKE '%' || split_part(query_text, ' ', 2) || '%'
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
