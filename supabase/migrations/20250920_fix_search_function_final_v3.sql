-- 최종 검색 함수 수정 v3 (2025-09-20)
-- 함수 오버로딩 문제 완전 해결

-- 1. 기존 모든 search_documents 함수 완전 삭제
DROP FUNCTION IF EXISTS search_documents(vector(1024), float, int);
DROP FUNCTION IF EXISTS search_documents(TEXT, float, int);
DROP FUNCTION IF EXISTS search_documents(anyelement, float, int);
DROP FUNCTION IF EXISTS search_documents_by_text(TEXT, float, int);
DROP FUNCTION IF EXISTS search_documents_simple(TEXT, float, int);
DROP FUNCTION IF EXISTS test_search_documents(TEXT, float, int);
DROP FUNCTION IF EXISTS match_document_chunks(vector(1024), float, int);
DROP FUNCTION IF EXISTS match_documents(vector(1024), float, int);

-- 2. 새로운 search_documents 함수 생성 (단일 함수)
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

-- 3. 인덱스 최적화
DROP INDEX IF EXISTS idx_document_chunks_embedding;
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- 4. 함수 권한 설정
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int) TO anon;

-- 5. 테스트용 간단한 검색 함수 (텍스트 입력 지원)
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
    -- 간단한 테스트용 임베딩 생성 (실제로는 RAGProcessor에서 생성)
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

-- 6. 간단한 검색 함수 권한 설정
GRANT EXECUTE ON FUNCTION search_documents_by_text(TEXT, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION search_documents_by_text(TEXT, float, int) TO anon;
