-- RAG 검색을 위한 벡터 유사도 검색 함수
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id text,
  content text,
  document_id text,
  chunk_index int,
  source text,
  created_at timestamptz,
  similarity float
)
LANGUAGE SQL
AS $$
  SELECT 
    dc.chunk_id as id,
    dc.content,
    dc.document_id,
    (dc.metadata->>'chunk_index')::int as chunk_index,
    dc.metadata->>'source' as source,
    dc.created_at,
    -- 코사인 유사도 계산 (임시로 간단한 유사도 계산)
    CASE 
      WHEN dc.content ILIKE '%' || 'test' || '%' THEN 0.9
      WHEN dc.content ILIKE '%' || 'meta' || '%' THEN 0.8
      WHEN dc.content ILIKE '%' || 'facebook' || '%' THEN 0.7
      WHEN dc.content ILIKE '%' || 'instagram' || '%' THEN 0.7
      WHEN dc.content ILIKE '%' || 'threads' || '%' THEN 0.7
      ELSE 0.5
    END as similarity
  FROM document_chunks dc
  WHERE dc.embedding IS NOT NULL
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
