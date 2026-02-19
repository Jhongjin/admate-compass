-- 문서 관리 및 벡터 검색을 위한 테이블 생성
-- pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 문서 메타데이터 테이블
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('file', 'url')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'indexed', 'failed')),
    chunk_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 문서 청크 및 임베딩 테이블 (pgvector 사용)
CREATE TABLE IF NOT EXISTS document_chunks (
    id SERIAL PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536), -- OpenAI text-embedding-3-small 차원
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 고유 제약 조건
    UNIQUE(document_id, chunk_id)
);

-- 문서 메타데이터 테이블 (추가 정보 저장용)
CREATE TABLE IF NOT EXISTS document_metadata (
    id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('pdf', 'docx', 'txt', 'url')),
    size BIGINT NOT NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    chunk_count INTEGER DEFAULT 0,
    embedding_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 문서 처리 로그 테이블
CREATE TABLE IF NOT EXISTS document_processing_logs (
    id SERIAL PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    step TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
    message TEXT,
    error TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 벡터 검색을 위한 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
ON document_chunks 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 문서 ID로 청크 검색을 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id 
ON document_chunks(document_id);

-- RLS (Row Level Security) 활성화 (idempotent)
DO $$ 
BEGIN
    -- documents 테이블 RLS 활성화
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'documents' 
        AND n.nspname = 'public'
        AND c.relrowsecurity = true
    ) THEN
        ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
    END IF;

    -- document_chunks 테이블 RLS 활성화
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'document_chunks' 
        AND n.nspname = 'public'
        AND c.relrowsecurity = true
    ) THEN
        ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
    END IF;

    -- document_metadata 테이블 RLS 활성화
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'document_metadata' 
        AND n.nspname = 'public'
        AND c.relrowsecurity = true
    ) THEN
        ALTER TABLE document_metadata ENABLE ROW LEVEL SECURITY;
    END IF;

    -- document_processing_logs 테이블 RLS 활성화
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'document_processing_logs' 
        AND n.nspname = 'public'
        AND c.relrowsecurity = true
    ) THEN
        ALTER TABLE document_processing_logs ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- 관리자만 모든 문서에 접근 가능하도록 정책 설정 (idempotent)
DO $$ 
BEGIN
    -- documents 테이블 정책
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'documents' 
        AND policyname = 'Admin can manage all documents'
    ) THEN
        CREATE POLICY "Admin can manage all documents" ON documents
            FOR ALL USING (auth.role() = 'authenticated');
    END IF;

    -- document_chunks 테이블 정책
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'document_chunks' 
        AND policyname = 'Admin can manage all document chunks'
    ) THEN
        CREATE POLICY "Admin can manage all document chunks" ON document_chunks
            FOR ALL USING (auth.role() = 'authenticated');
    END IF;

    -- document_metadata 테이블 정책
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'document_metadata' 
        AND policyname = 'Admin can manage all document metadata'
    ) THEN
        CREATE POLICY "Admin can manage all document metadata" ON document_metadata
            FOR ALL USING (auth.role() = 'authenticated');
    END IF;

    -- document_processing_logs 테이블 정책
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'document_processing_logs' 
        AND policyname = 'Admin can manage all processing logs'
    ) THEN
        CREATE POLICY "Admin can manage all processing logs" ON document_processing_logs
            FOR ALL USING (auth.role() = 'authenticated');
    END IF;
END $$;

-- 벡터 유사도 검색을 위한 함수 생성
CREATE OR REPLACE FUNCTION search_documents(
    query_embedding vector(1536),
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

-- 문서 통계를 위한 뷰 생성
CREATE OR REPLACE VIEW document_stats AS
SELECT 
    d.id,
    d.title,
    d.type,
    d.status,
    d.chunk_count,
    d.created_at,
    dm.size,
    dm.uploaded_at,
    dm.processed_at,
    dm.embedding_count
FROM documents d
LEFT JOIN document_metadata dm ON d.id = dm.id;

-- updated_at 자동 업데이트를 위한 트리거 함수 생성
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 각 테이블에 updated_at 트리거 추가 (idempotent)
DO $$ 
BEGIN
    -- documents 테이블 트리거
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'update_documents_updated_at'
    ) THEN
        CREATE TRIGGER update_documents_updated_at
            BEFORE UPDATE ON documents
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;

    -- document_metadata 테이블 트리거
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'update_document_metadata_updated_at'
    ) THEN
        CREATE TRIGGER update_document_metadata_updated_at
            BEFORE UPDATE ON document_metadata
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- 인덱스 성능 최적화를 위한 통계 업데이트
ANALYZE documents;
ANALYZE document_chunks;
ANALYZE document_metadata;
ANALYZE document_processing_logs;