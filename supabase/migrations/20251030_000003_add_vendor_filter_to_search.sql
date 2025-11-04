-- 벤더 필터 지원을 위한 search_documents 함수 수정
-- Created: 2025-10-30

-- 1) source_vendor 컬럼이 없으면 추가 (안전장치)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'documents' 
    AND column_name = 'source_vendor'
  ) THEN
    ALTER TABLE public.documents ADD COLUMN source_vendor TEXT DEFAULT 'META';
    CREATE INDEX IF NOT EXISTS idx_documents_source_vendor ON public.documents(source_vendor);
  END IF;
END $$;

-- 2) 기존 함수 삭제 (벤더 필터 없는 버전)
DROP FUNCTION IF EXISTS search_documents(vector(1024), float, int);

-- 3) 벤더 필터 지원 함수 생성
CREATE OR REPLACE FUNCTION search_documents(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    vendor_filter TEXT[] DEFAULT NULL
)
RETURNS TABLE (
    chunk_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity float,
    document_id TEXT,
    title TEXT,
    source_vendor TEXT
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
        d.title,
        COALESCE(d.source_vendor::TEXT, 'META') as source_vendor
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
      AND d.status = 'indexed'
      AND (vendor_filter IS NULL OR COALESCE(d.source_vendor::TEXT, 'META') = ANY(vendor_filter))
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int, TEXT[]) TO anon;

-- 복합 인덱스 추가 (성능 최적화) - source_vendor 컬럼이 있을 때만
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'documents' 
    AND column_name = 'source_vendor'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_documents_vendor_status 
    ON documents(source_vendor, status) 
    WHERE status = 'indexed';
  END IF;
END $$;

-- 벤더별 검색 성능 향상을 위한 통계 업데이트
ANALYZE documents;
ANALYZE document_chunks;
