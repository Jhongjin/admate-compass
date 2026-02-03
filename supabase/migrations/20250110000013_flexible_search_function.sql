-- 유연한 search_documents 함수 (JavaScript 배열 처리 개선)
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 기존 함수 삭제
DROP FUNCTION IF EXISTS search_documents(real[], float, int);

-- JavaScript 배열을 더 잘 처리하는 벡터 검색 함수
CREATE OR REPLACE FUNCTION search_documents(
  query_embedding anyelement,
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
  query_text text;
BEGIN
  -- 입력된 임베딩을 텍스트로 변환
  query_text := query_embedding::text;
  
  -- 벡터로 변환 시도
  BEGIN
    -- JSON 배열 형태인 경우
    IF query_text LIKE '[%' THEN
      parsed_query_vector := query_text::vector(768);
    -- PostgreSQL 배열 형태인 경우
    ELSE
      parsed_query_vector := query_embedding::vector(768);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- 변환 실패 시 오류 발생
    RAISE EXCEPTION 'Failed to parse query embedding: %', SQLERRM;
  END;

  -- 벡터 검색 실행
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
SELECT '유연한 search_documents 함수가 생성되었습니다.' as status;
