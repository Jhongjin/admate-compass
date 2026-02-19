-- 간단한 search_documents 함수 수정
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 기존 함수 삭제
DROP FUNCTION IF EXISTS search_documents(vector, float, int);

-- JSON 문자열을 파싱하는 개선된 벡터 검색 함수
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
DECLARE
  chunk_record RECORD;
  parsed_embedding vector(768);
  similarity_score float;
BEGIN
  -- document_chunks 테이블을 순회하면서 각 청크의 임베딩을 파싱
  FOR chunk_record IN 
    SELECT dc.chunk_id, dc.content, dc.metadata, dc.embedding
    FROM document_chunks dc
  LOOP
    BEGIN
      -- JSON 문자열을 vector로 변환
      IF chunk_record.embedding::text LIKE '[%' THEN
        -- JSON 배열 문자열인 경우
        parsed_embedding := chunk_record.embedding::text::vector;
      ELSE
        -- 이미 vector 타입인 경우
        parsed_embedding := chunk_record.embedding::vector;
      END IF;
      
      -- 유사도 계산
      similarity_score := 1 - (parsed_embedding <=> query_embedding);
      
      -- 임계값을 넘는 경우 결과에 추가
      IF similarity_score > match_threshold THEN
        chunk_id := chunk_record.chunk_id;
        content := chunk_record.content;
        metadata := chunk_record.metadata;
        similarity := similarity_score;
        RETURN NEXT;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      -- 파싱 오류가 발생한 경우 해당 청크를 건너뛰기
      CONTINUE;
    END;
  END LOOP;
  
  -- 유사도 순으로 정렬하고 제한
  RETURN QUERY
  SELECT * FROM (
    SELECT chunk_id, content, metadata, similarity
    FROM search_documents(query_embedding, match_threshold, match_count)
  ) subquery
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- 벡터 인덱스 재생성
DROP INDEX IF EXISTS idx_document_chunks_embedding;
CREATE INDEX idx_document_chunks_embedding ON document_chunks 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- 통계 업데이트
ANALYZE document_chunks;

-- 테스트 쿼리
SELECT 'search_documents 함수가 성공적으로 수정되었습니다.' as status;
