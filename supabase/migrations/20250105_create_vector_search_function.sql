-- 벡터 유사도 검색을 위한 함수 생성
CREATE OR REPLACE FUNCTION match_documents (
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  content text,
  similarity float,
  document_id uuid,
  document_title text,
  document_url text,
  chunk_index int,
  metadata jsonb
)
LANGUAGE sql STABLE
AS $$
  SELECT
    dc.id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    d.id AS document_id,
    d.title AS document_title,
    d.url AS document_url,
    dc.chunk_index,
    dc.metadata
  FROM document_chunks dc
  JOIN documents d ON dc.document_id = d.id
  WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

