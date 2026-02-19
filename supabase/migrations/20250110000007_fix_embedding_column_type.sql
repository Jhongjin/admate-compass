-- 임베딩 컬럼 타입을 vector(768)로 변환
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 임시 테이블 생성 (새로운 스키마로)
CREATE TABLE document_chunks_new (
  id SERIAL PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_id TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. 기존 데이터를 새 테이블로 마이그레이션
INSERT INTO document_chunks_new (document_id, chunk_id, content, embedding, metadata, created_at)
SELECT 
  chunk_id::text as document_id,
  chunk_id,
  content,
  -- JSON 문자열을 vector로 변환
  CASE 
    WHEN embedding::text LIKE '[%' THEN 
      embedding::text::vector
    ELSE 
      embedding::vector
  END as embedding,
  metadata,
  created_at
FROM document_chunks;

-- 3. 기존 테이블 백업
CREATE TABLE document_chunks_backup AS
SELECT * FROM document_chunks;

-- 4. 기존 테이블 삭제
DROP TABLE document_chunks;

-- 5. 새 테이블을 원래 이름으로 변경
ALTER TABLE document_chunks_new RENAME TO document_chunks;

-- 6. 벡터 인덱스 생성
CREATE INDEX idx_document_chunks_embedding ON document_chunks 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- 7. 통계 업데이트
ANALYZE document_chunks;

-- 8. search_documents 함수 재생성
DROP FUNCTION IF EXISTS search_documents(vector, float, int);

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

-- 9. 테스트 쿼리
SELECT '임베딩 컬럼 타입이 성공적으로 vector(768)로 변환되었습니다.' as status;
