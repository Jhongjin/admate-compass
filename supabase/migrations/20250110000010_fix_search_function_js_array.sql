-- JavaScript 배열을 처리하는 search_documents 함수 수정
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 기존 함수 삭제
DROP FUNCTION IF EXISTS search_documents(vector, float, int);

-- JavaScript 배열을 처리하는 개선된 벡터 검색 함수
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
BEGIN
  -- 입력된 임베딩을 vector(768)로 변환
  BEGIN
    -- JavaScript 배열인 경우 (PostgreSQL array 타입)
    IF pg_typeof(query_embedding) = 'real[]'::regtype OR 
       pg_typeof(query_embedding) = 'double precision[]'::regtype OR
       pg_typeof(query_embedding) = 'numeric[]'::regtype THEN
      parsed_query_vector := query_embedding::vector(768);
    -- JSON 문자열인 경우
    ELSIF pg_typeof(query_embedding) = 'text'::regtype AND query_embedding::text LIKE '[%' THEN
      parsed_query_vector := query_embedding::text::vector(768);
    -- 이미 vector 타입인 경우
    ELSIF pg_typeof(query_embedding) = 'vector'::regtype THEN
      parsed_query_vector := query_embedding::vector(768);
    ELSE
      -- 기타 타입은 텍스트로 변환 후 파싱
      parsed_query_vector := query_embedding::text::vector(768);
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
    1 - (dc.embedding <=> parsed_query_vector) as similarity
  FROM document_chunks dc
  WHERE 1 - (dc.embedding <=> parsed_query_vector) > match_threshold
  ORDER BY dc.embedding <=> parsed_query_vector
  LIMIT match_count;
END;
$$;

-- 테스트 쿼리
SELECT 'JavaScript 배열을 처리하는 search_documents 함수가 생성되었습니다.' as status;
