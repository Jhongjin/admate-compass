-- 메모리 부족 문제 해결 (2025-09-20)
-- maintenance_work_mem 증가 및 함수 최적화

-- 1. maintenance_work_mem 증가 (세션 레벨)
SET maintenance_work_mem = '64MB';

-- 2. 기존 함수들 완전 삭제 (메모리 절약)
DROP FUNCTION IF EXISTS search_documents(vector(1024), float, int);
DROP FUNCTION IF EXISTS search_documents(TEXT, float, int);
DROP FUNCTION IF EXISTS search_documents(anyelement, float, int);
DROP FUNCTION IF EXISTS search_documents_by_text(TEXT, float, int);
DROP FUNCTION IF EXISTS search_documents_simple(TEXT, float, int);
DROP FUNCTION IF EXISTS test_search_documents(TEXT, float, int);
DROP FUNCTION IF EXISTS match_document_chunks(vector(1024), float, int);
DROP FUNCTION IF EXISTS match_documents(vector(1024), float, int);

-- 3. 최적화된 search_documents 함수 생성 (메모리 효율적)
CREATE OR REPLACE FUNCTION search_documents(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    chunk_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity float,
    document_id TEXT,
    title TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dc.chunk_id,
        dc.content,
        dc.metadata,
        1 - (dc.embedding <=> query_embedding) as similarity,
        dc.document_id,
        d.title
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 4. 인덱스 최적화 (메모리 효율적)
DROP INDEX IF EXISTS idx_document_chunks_embedding;
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 50); -- lists 수를 줄여서 메모리 사용량 감소

-- 5. 함수 권한 설정
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int) TO anon;

-- 6. 간단한 텍스트 검색 함수 (메모리 효율적)
CREATE OR REPLACE FUNCTION search_documents_by_text(
    query_text TEXT,
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 5
)
RETURNS TABLE (
    chunk_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity float,
    document_id TEXT,
    title TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    query_embedding vector(1024);
BEGIN
    -- 간단한 테스트용 임베딩 생성
    query_embedding := ARRAY_FILL(0.1, ARRAY[1024])::vector(1024);
    
    RETURN QUERY
    SELECT 
        dc.chunk_id,
        dc.content,
        dc.metadata,
        1 - (dc.embedding <=> query_embedding) as similarity,
        dc.document_id,
        d.title
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 7. 간단한 검색 함수 권한 설정
GRANT EXECUTE ON FUNCTION search_documents_by_text(TEXT, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION search_documents_by_text(TEXT, float, int) TO anon;
