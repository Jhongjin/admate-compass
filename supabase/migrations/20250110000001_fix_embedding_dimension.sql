-- 임베딩 차원 수정 (1024 → 1536)
-- 기존 데이터를 백업하고 새로 생성

-- 1. 기존 데이터 백업
CREATE TABLE IF NOT EXISTS document_chunks_backup AS 
SELECT * FROM document_chunks;

-- 2. 기존 테이블 삭제
DROP TABLE IF EXISTS document_chunks CASCADE;

-- 3. 새 테이블 생성 (1536차원)
CREATE TABLE document_chunks (
    id SERIAL PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- 1536차원으로 변경
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 고유 제약 조건
    UNIQUE(document_id, chunk_id)
);

-- 4. 벡터 검색을 위한 인덱스 생성
CREATE INDEX idx_document_chunks_embedding 
ON document_chunks 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 5. 문서 ID로 청크 검색을 위한 인덱스
CREATE INDEX idx_document_chunks_document_id 
ON document_chunks(document_id);

-- 6. RLS 활성화
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- 7. 정책 설정
CREATE POLICY "Admin can manage all document chunks" ON document_chunks
    FOR ALL USING (auth.role() = 'authenticated');

-- 8. 통계 업데이트
ANALYZE document_chunks;
