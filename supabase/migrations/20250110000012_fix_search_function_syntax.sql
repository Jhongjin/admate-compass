-- 문법 오류 수정된 search_documents 함수
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 기존 함수 삭제
DROP FUNCTION IF EXISTS search_documents(real[], float, int);

-- 문법 오류 수정된 벡터 검색 함수
CREATE OR REPLACE FUNCTION search_documents(
  query_embedding real[],
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
DECLARE
  parsed_query_vector vector(768);
BEGIN
  -- real[] 배열을 vector(768)로 변환
  parsed_query_vector := query_embedding::vector(768);

  -- 벡터 검색 실행 (문법 오류 수정)
  RETURN QUERY
  SELECT 
    dc.chunk_id,
    dc.content,
    dc.metadata,
    (1 - (dc.embedding <=> parsed_query_vector))::float as similarity
  FROM document_chunks dc
  WHERE (1 - (dc.embedding <=> parsed_query_vector))::float > match_threshold
  ORDER BY dc.embedding <=> parsed_query_vector
  LIMIT match_count;
END;
$$;

-- 테스트 쿼리
SELECT '문법 오류 수정된 search_documents 함수가 생성되었습니다.' as status;
