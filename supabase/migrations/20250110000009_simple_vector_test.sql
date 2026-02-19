-- 간단한 벡터 테스트 함수
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 간단한 벡터 차원 확인 함수
CREATE OR REPLACE FUNCTION check_vector_dimensions()
RETURNS TABLE (
  chunk_id text,
  embedding_text text,
  vector_dimension int,
  parse_success boolean,
  error_message text
)
LANGUAGE plpgsql
AS $$
DECLARE
  chunk_record RECORD;
  parsed_vector vector;
  dimension_result int;
  success_flag boolean;
  error_msg text;
BEGIN
  FOR chunk_record IN 
    SELECT dc.chunk_id, dc.embedding::text as embedding_text
    FROM document_chunks dc
    LIMIT 5
  LOOP
    chunk_id := chunk_record.chunk_id;
    embedding_text := substring(chunk_record.embedding_text, 1, 100) || '...';
    
    BEGIN
      -- 벡터로 변환 시도
      parsed_vector := chunk_record.embedding_text::vector;
      dimension_result := array_length(parsed_vector, 1);
      success_flag := true;
      error_msg := null;
      
    EXCEPTION WHEN OTHERS THEN
      dimension_result := 0;
      success_flag := false;
      error_msg := SQLERRM;
    END;
    
    vector_dimension := dimension_result;
    parse_success := success_flag;
    error_message := error_msg;
    
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 테스트 쿼리
SELECT '간단한 벡터 테스트 함수가 생성되었습니다.' as status;
