-- 벡터 파싱 테스트 함수 생성
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 벡터 파싱 테스트 함수
CREATE OR REPLACE FUNCTION test_vector_parsing(test_embedding anyelement)
RETURNS TABLE (
  input_type text,
  parsed_type text,
  dimension int,
  sample_values float[]
)
LANGUAGE plpgsql
AS $$
DECLARE
  parsed_vector vector;
  vector_array float[];
BEGIN
  -- 입력 타입 확인
  input_type := pg_typeof(test_embedding)::text;
  
  -- 벡터로 파싱 시도
  BEGIN
    IF test_embedding::text LIKE '[%' THEN
      -- JSON 문자열인 경우
      parsed_vector := test_embedding::text::vector;
      parsed_type := 'JSON string to vector';
    ELSE
      -- 이미 vector 타입인 경우
      parsed_vector := test_embedding::vector;
      parsed_type := 'Direct vector';
    END IF;
    
    -- 차원 확인
    dimension := array_length(parsed_vector, 1);
    
    -- 샘플 값 추출 (처음 5개)
    vector_array := parsed_vector[1:5];
    
  EXCEPTION WHEN OTHERS THEN
    parsed_type := 'Parse Error: ' || SQLERRM;
    dimension := 0;
    vector_array := ARRAY[]::float[];
  END;
  
  RETURN QUERY
  SELECT 
    input_type,
    parsed_type,
    dimension,
    vector_array;
END;
$$;

-- 벡터 차원 확인 함수
CREATE OR REPLACE FUNCTION check_embedding_dimensions()
RETURNS TABLE (
  chunk_id text,
  embedding_type text,
  dimension int,
  sample_values float[]
)
LANGUAGE plpgsql
AS $$
DECLARE
  chunk_record RECORD;
  parsed_vector vector;
  vector_array float[];
BEGIN
  FOR chunk_record IN 
    SELECT dc.chunk_id, dc.embedding
    FROM document_chunks dc
    LIMIT 5
  LOOP
    BEGIN
      -- 임베딩 타입 확인
      embedding_type := pg_typeof(chunk_record.embedding)::text;
      
      -- 벡터로 변환
      IF chunk_record.embedding::text LIKE '[%' THEN
        parsed_vector := chunk_record.embedding::text::vector;
      ELSE
        parsed_vector := chunk_record.embedding::vector;
      END IF;
      
      -- 차원 확인
      dimension := array_length(parsed_vector, 1);
      
      -- 샘플 값 추출
      vector_array := parsed_vector[1:5];
      
    EXCEPTION WHEN OTHERS THEN
      embedding_type := 'Error: ' || SQLERRM;
      dimension := 0;
      vector_array := ARRAY[]::float[];
    END;
    
    chunk_id := chunk_record.chunk_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 테스트 쿼리
SELECT '벡터 테스트 함수가 생성되었습니다.' as status;
