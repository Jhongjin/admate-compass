-- 임베딩 차원을 1536에서 1024로 변경
-- 기존 데이터가 있는 경우 먼저 삭제

-- 기존 벡터 인덱스 삭제
DROP INDEX IF EXISTS idx_document_chunks_embedding;

-- 기존 임베딩 데이터 삭제 (차원이 맞지 않으므로)
DELETE FROM document_chunks;

-- 임베딩 컬럼을 1024차원으로 변경
ALTER TABLE document_chunks 
ALTER COLUMN embedding TYPE vector(1024);

-- 새로운 벡터 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
ON document_chunks 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 검색 함수도 1024차원으로 업데이트
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
