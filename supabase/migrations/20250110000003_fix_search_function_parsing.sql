-- 벡터 검색 함수 수정 (JSON 문자열 파싱 개선)
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 기존 함수 삭제
DROP FUNCTION IF EXISTS search_documents(vector, float, int);

-- 개선된 벡터 검색 함수 생성
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
    1 - (dc.embedding <=> query_embedding) as similarity
  FROM document_chunks dc
  WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 벡터 인덱스 재생성 (768차원에 맞게)
DROP INDEX IF EXISTS idx_document_chunks_embedding;
CREATE INDEX idx_document_chunks_embedding ON document_chunks 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- 통계 업데이트
ANALYZE document_chunks;

-- 테스트 쿼리
SELECT 'search_documents 함수가 성공적으로 수정되었습니다.' as status;
