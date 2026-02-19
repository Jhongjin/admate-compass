-- 벡터 인덱스 최적화 마이그레이션
-- 작성일: 2025-01-31
-- 목적: Supabase Pro 플랜의 리소스를 활용하여 벡터 검색 성능 개선
-- 주의: 프로덕션 적용 전 백업 권장

-- 1. 현재 인덱스 상태 확인
DO $$
BEGIN
  RAISE NOTICE '=== 벡터 인덱스 최적화 시작 ===';
  RAISE NOTICE '시작 시간: %', NOW();
END $$;

-- 2. 기존 인덱스 확인 (로그용)
-- 인덱스 크기는 함수에서 확인하므로 여기서는 목록만 표시
SELECT 
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE tablename IN ('document_chunks', 'documents')
  AND schemaname = 'public'
ORDER BY tablename, indexname;

-- 3. embedding 컬럼 타입 확인 및 변환 (필요시)
DO $$
DECLARE
  embedding_type TEXT;
  embedding_udt TEXT;
BEGIN
  -- 현재 embedding 컬럼의 타입 확인 (data_type과 udt_name 모두 확인)
  SELECT data_type, udt_name INTO embedding_type, embedding_udt
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'document_chunks'
    AND column_name = 'embedding';
  
  RAISE NOTICE '현재 embedding 컬럼 타입: data_type=%, udt_name=%', embedding_type, embedding_udt;
  
  -- vector 타입이 이미 설정되어 있는지 확인
  IF embedding_udt = 'vector' THEN
    RAISE NOTICE 'embedding 컬럼이 이미 vector 타입입니다. 인덱스 생성을 진행합니다.';
  ELSIF embedding_type = 'text' OR embedding_type IS NULL THEN
    -- text 타입이면 vector로 변환
    RAISE NOTICE 'embedding 컬럼을 vector(1024)로 변환 중...';
    
    -- 기존 데이터가 있는지 확인
    IF EXISTS (SELECT 1 FROM document_chunks WHERE embedding IS NOT NULL LIMIT 1) THEN
      -- text를 vector로 변환 (JSON 배열 형식 또는 문자열 형식)
      ALTER TABLE document_chunks
      ALTER COLUMN embedding TYPE vector(1024)
      USING CASE
        WHEN embedding::text ~ '^\[.*\]$' THEN embedding::text::vector(1024)
        ELSE NULL
      END;
    ELSE
      -- 데이터가 없으면 직접 타입 변경
      ALTER TABLE document_chunks
      ALTER COLUMN embedding TYPE vector(1024) USING NULL;
    END IF;
    
    RAISE NOTICE 'embedding 컬럼 타입 변환 완료';
  ELSE
    RAISE NOTICE 'embedding 컬럼 타입: % (변환 불필요 또는 확인 필요)', embedding_type;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'embedding 컬럼 타입 확인 중 오류: %', SQLERRM;
    -- 타입 변환 실패해도 계속 진행
END $$;

-- 4. 기존 벡터 인덱스 제거 (필요시 재생성)
DROP INDEX IF EXISTS idx_document_chunks_embedding CASCADE;
DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw CASCADE;
DROP INDEX IF EXISTS idx_document_chunks_embedding_ivfflat CASCADE;

-- 5. embedding 컬럼이 vector 타입인지 최종 확인
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'document_chunks'
      AND column_name = 'embedding'
      AND udt_name = 'vector'
  ) THEN
    RAISE EXCEPTION 'embedding 컬럼이 vector 타입이 아닙니다. 먼저 타입을 변환해야 합니다.';
  END IF;
END $$;

-- 6. HNSW 인덱스 생성 (IVFFlat보다 빠름, Pro 플랜에서 권장)
-- HNSW는 더 많은 메모리를 사용하지만 검색 속도가 훨씬 빠름
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
ON document_chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 5. 문서-벤더-상태 복합 인덱스 생성 (벤더 필터링 성능 개선)
CREATE INDEX IF NOT EXISTS idx_documents_vendor_status_indexed
ON documents(source_vendor, status) 
WHERE status = 'indexed';

-- 6. document_chunks의 document_id 인덱스 확인 및 개선
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id_optimized
ON document_chunks(document_id)
WHERE document_id IS NOT NULL;

-- 7. 메타데이터 인덱스 (벤더 필터링을 위한)
CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata_vendor
ON document_chunks USING GIN (metadata)
WHERE metadata->>'vendor' IS NOT NULL;

-- 8. 통계 업데이트 (쿼리 플래너 최적화를 위해)
ANALYZE document_chunks;
ANALYZE documents;

-- 9. 인덱스 사용 통계 확인 함수 생성
CREATE OR REPLACE FUNCTION get_vector_index_stats()
RETURNS TABLE (
  table_name TEXT,
  index_name TEXT,
  index_size TEXT,
  index_scans BIGINT,
  tuples_read BIGINT,
  tuples_fetched BIGINT
) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.relname::TEXT as table_name,
    i.relname::TEXT as index_name,
    pg_size_pretty(pg_relation_size(i.oid))::TEXT as index_size,
    COALESCE(s.idx_scan, 0)::BIGINT as index_scans,
    COALESCE(s.idx_tup_read, 0)::BIGINT as tuples_read,
    COALESCE(s.idx_tup_fetch, 0)::BIGINT as tuples_fetched
  FROM pg_class i
  JOIN pg_index idx ON i.oid = idx.indexrelid
  JOIN pg_class t ON idx.indrelid = t.oid
  LEFT JOIN pg_stat_user_indexes s ON i.oid = s.indexrelid
  WHERE t.relname IN ('document_chunks', 'documents')
    AND i.relname LIKE '%embedding%'
  ORDER BY t.relname, i.relname;
END;
$$;

-- 10. 완료 로그
DO $$
BEGIN
  RAISE NOTICE '=== 벡터 인덱스 최적화 완료 ===';
  RAISE NOTICE '완료 시간: %', NOW();
  RAISE NOTICE '인덱스 통계 확인: SELECT * FROM get_vector_index_stats();';
END $$;

-- 사용법:
-- 인덱스 통계 확인: SELECT * FROM get_vector_index_stats();
-- 인덱스 크기 확인: SELECT pg_size_pretty(pg_relation_size('idx_document_chunks_embedding_hnsw'));

