-- 임베딩 데이터 형식 수정 (JSON 문자열을 vector 타입으로 변환)
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 임시 테이블 생성
CREATE TEMP TABLE temp_document_chunks AS
SELECT 
  chunk_id,
  content,
  metadata,
  CASE 
    WHEN embedding::text LIKE '[%' THEN 
      -- JSON 배열 문자열을 vector로 변환
      embedding::text::vector
    ELSE 
      -- 이미 vector 타입인 경우
      embedding::vector
  END as embedding,
  created_at
FROM document_chunks;

-- 기존 테이블 백업
CREATE TABLE IF NOT EXISTS document_chunks_backup AS
SELECT * FROM document_chunks;

-- 기존 테이블 삭제
DROP TABLE document_chunks;

-- 새 테이블 생성 (embedding을 vector(768)로)
CREATE TABLE document_chunks (
  id SERIAL PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_id TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 데이터 복원
INSERT INTO document_chunks (document_id, chunk_id, content, embedding, metadata, created_at)
SELECT 
  chunk_id::text as document_id,
  chunk_id,
  content,
  embedding,
  metadata,
  created_at
FROM temp_document_chunks;

-- 벡터 인덱스 생성
CREATE INDEX idx_document_chunks_embedding ON document_chunks 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- 통계 업데이트
ANALYZE document_chunks;

-- 테스트 쿼리
SELECT '임베딩 데이터 형식이 성공적으로 수정되었습니다.' as status;
