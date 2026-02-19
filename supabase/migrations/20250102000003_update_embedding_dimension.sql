-- BGE-M3 모델에 맞게 벡터 차원을 1024로 업데이트
-- OpenAI text-embedding-3-small (1536) -> BGE-M3 (1024)

-- 기존 테이블 삭제 (데이터 손실 주의)
DROP TABLE IF EXISTS document_chunks CASCADE;

-- 새로운 document_chunks 테이블 생성 (1024차원)
CREATE TABLE IF NOT EXISTS document_chunks (
    id SERIAL PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024), -- BGE-M3 차원
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 고유 제약 조건
    UNIQUE(document_id, chunk_id)
);

-- 벡터 검색을 위한 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
ON document_chunks 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 문서 ID로 청크 검색을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id 
ON document_chunks(document_id);

-- RLS 활성화
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- 관리자만 모든 문서 청크에 접근 가능하도록 정책 설정
CREATE POLICY "Admin can manage all document chunks" ON document_chunks
    FOR ALL USING (auth.role() = 'authenticated');

-- 벡터 유사도 검색을 위한 함수 생성 (1024차원)
CREATE OR REPLACE FUNCTION search_documents(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.7,
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

-- 인덱스 성능 최적화를 위한 통계 업데이트
ANALYZE document_chunks;

