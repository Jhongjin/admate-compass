-- 초간단 search_documents 함수 수정
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 기존 함수 삭제
DROP FUNCTION IF EXISTS search_documents(vector, float, int);

-- 가장 간단한 벡터 검색 함수
CREATE OR REPLACE FUNCTION search_documents(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.1,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  chunk_id TEXT,
  content TEXT,
  metadata JSONB,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dc.chunk_id,
    dc.content,
    dc.metadata,
    1 - (dc.embedding::vector <=> query_embedding) as similarity
  FROM document_chunks dc
  WHERE 1 - (dc.embedding::vector <=> query_embedding) > match_threshold
  ORDER BY dc.embedding::vector <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 테스트 쿼리
SELECT '초간단 search_documents 함수가 생성되었습니다.' as status;
