-- 벡터 검색 함수 성능 최적화
-- 작성일: 2025-01-31
-- 목적: Pro 플랜 리소스를 활용한 검색 함수 성능 개선
-- 변경사항: STABLE 함수 선언, CTE 활용, 쿼리 최적화

-- 1. 기존 함수 백업 (이름 변경)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'search_documents' 
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    DROP FUNCTION IF EXISTS search_documents_backup CASCADE;
    ALTER FUNCTION search_documents(vector(1024), float, int, TEXT[]) 
    RENAME TO search_documents_backup;
    RAISE NOTICE '기존 함수를 search_documents_backup으로 백업했습니다.';
  END IF;
END $$;

-- 2. 최적화된 검색 함수 생성
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
STABLE
STRICT
AS $$
BEGIN
    RETURN QUERY
    WITH vendor_filtered_docs AS (
        -- 벤더 필터링을 먼저 수행 (인덱스 활용)
        SELECT d.id, d.title, COALESCE(d.source_vendor::TEXT, 'META') as source_vendor
        FROM documents d
        WHERE d.status = 'indexed'
          AND (vendor_filter IS NULL OR COALESCE(d.source_vendor::TEXT, 'META') = ANY(vendor_filter))
    ),
    similarity_search AS (
        -- 벡터 유사도 검색 (HNSW 인덱스 활용)
        SELECT 
            dc.chunk_id,
            dc.content,
            dc.metadata,
            dc.document_id,
            1 - (dc.embedding <=> query_embedding) as similarity
        FROM document_chunks dc
        JOIN vendor_filtered_docs vfd ON dc.document_id = vfd.id
        WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
        ORDER BY dc.embedding <=> query_embedding
        LIMIT match_count
    )
    SELECT 
        ss.chunk_id,
        ss.content,
        ss.metadata,
        ss.similarity,
        ss.document_id,
        vfd.title,
        vfd.source_vendor
    FROM similarity_search ss
    JOIN vendor_filtered_docs vfd ON ss.document_id = vfd.id
    ORDER BY ss.similarity DESC;
END;
$$;

-- 3. 함수 권한 설정
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int, TEXT[]) TO anon;
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int, TEXT[]) TO service_role;

-- 4. 함수 설명 추가
COMMENT ON FUNCTION search_documents(vector(1024), float, int, TEXT[]) IS 
'벡터 유사도 검색 함수 (최적화 버전). 
벤더 필터링, 유사도 임계값, 결과 개수를 지정할 수 있습니다.
Pro 플랜 최적화: STABLE 함수, CTE 활용, 인덱스 우선 활용';

-- 5. 성능 테스트 함수 (선택사항)
CREATE OR REPLACE FUNCTION test_search_performance(
    test_query_embedding vector(1024),
    iterations int DEFAULT 10
)
RETURNS TABLE (
    iteration int,
    execution_time_ms numeric,
    result_count int
)
LANGUAGE plpgsql
AS $$
DECLARE
    start_time timestamp;
    end_time timestamp;
    exec_time numeric;
    result_cnt int;
    i int;
BEGIN
    FOR i IN 1..iterations LOOP
        start_time := clock_timestamp();
        
        SELECT COUNT(*) INTO result_cnt
        FROM search_documents(test_query_embedding, 0.7, 10, NULL);
        
        end_time := clock_timestamp();
        exec_time := EXTRACT(EPOCH FROM (end_time - start_time)) * 1000;
        
        RETURN QUERY SELECT i, exec_time, result_cnt;
    END LOOP;
END;
$$;

-- 사용법:
-- 기본 검색: SELECT * FROM search_documents(query_vector, 0.7, 10, NULL);
-- 벤더 필터링: SELECT * FROM search_documents(query_vector, 0.7, 10, ARRAY['META', 'NAVER']);
-- 성능 테스트: SELECT AVG(execution_time_ms) FROM test_search_performance(test_vector, 10);

