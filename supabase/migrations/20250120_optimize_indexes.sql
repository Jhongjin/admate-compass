-- 인덱스 최적화 (2025-01-20)
-- 타임아웃을 방지하기 위한 안전한 인덱스 최적화

-- 1. 메모리 및 타임아웃 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '300s';

-- 2. 현재 인덱스 상태 확인
SELECT 
  'Current indexes' as info,
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY tablename, indexname;

-- 3. 테이블 통계 확인
SELECT 
  'Table statistics' as info,
  schemaname,
  tablename,
  n_live_tup as live_tuples,
  n_dead_tup as dead_tuples,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables 
WHERE tablename IN ('documents', 'document_chunks');

-- 4. 기존 인덱스 삭제 (안전한 방식)
-- 벡터 인덱스 삭제
DROP INDEX IF EXISTS idx_document_chunks_embedding;

-- 일반 인덱스 삭제
DROP INDEX IF EXISTS idx_document_chunks_document_id;

-- 5. 테이블 정리 (VACUUM)
VACUUM documents;
VACUUM document_chunks;

-- 6. 새로운 인덱스 생성 (최적화된 설정)
-- document_chunks 테이블의 document_id 인덱스
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id 
ON document_chunks(document_id);

-- document_chunks 테이블의 chunk_id 인덱스
CREATE INDEX IF NOT EXISTS idx_document_chunks_chunk_id 
ON document_chunks(chunk_id);

-- documents 테이블의 status 인덱스
CREATE INDEX IF NOT EXISTS idx_documents_status 
ON documents(status);

-- documents 테이블의 type 인덱스
CREATE INDEX IF NOT EXISTS idx_documents_type 
ON documents(type);

-- 7. 벡터 인덱스 생성 (메모리 효율적 설정)
-- embedding 컬럼이 존재하는지 확인
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'document_chunks' 
        AND column_name = 'embedding'
    ) THEN
        -- 벡터 인덱스 생성 (메모리 효율적 설정)
        CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding 
        ON document_chunks USING ivfflat (embedding vector_cosine_ops) 
        WITH (lists = 50); -- lists 수를 줄여서 메모리 사용량 감소
        
        RAISE NOTICE 'Vector index created successfully';
    ELSE
        RAISE NOTICE 'Embedding column does not exist, skipping vector index creation';
    END IF;
END $$;

-- 8. 통계 업데이트
ANALYZE documents;
ANALYZE document_chunks;

-- 9. 인덱스 사용 통계 확인
SELECT 
  'Index usage statistics' as info,
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY tablename, indexname;

-- 10. 최종 인덱스 상태 확인
SELECT 
  'Final indexes' as info,
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY tablename, indexname;

-- 11. 메모리 사용량 확인
SELECT 
  'Memory usage after optimization' as info,
  name, 
  setting, 
  unit 
FROM pg_settings 
WHERE name IN ('maintenance_work_mem', 'work_mem', 'shared_buffers');

SELECT 'Index optimization completed successfully' as status, NOW() as timestamp;
