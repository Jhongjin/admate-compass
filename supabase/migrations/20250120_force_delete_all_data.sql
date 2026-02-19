-- 강제 데이터 전체 삭제 (2025-01-20)
-- 모든 문서, 청크, 메타데이터를 완전히 삭제

-- 1. 메모리 및 타임아웃 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '300s'; -- 5분 타임아웃

-- 2. 현재 상태 확인
SELECT 'Starting force delete all data' as status, NOW() as timestamp;

-- 3. document_chunks 테이블 완전 삭제
DO $$
DECLARE
    deleted_count INTEGER := 0;
    batch_size INTEGER := 1000;
    total_deleted INTEGER := 0;
    iteration INTEGER := 0;
    max_iterations INTEGER := 50; -- 최대 50회 반복
BEGIN
    RAISE NOTICE 'Starting document_chunks deletion...';
    
    WHILE iteration < max_iterations LOOP
        iteration := iteration + 1;
        
        -- 현재 남은 데이터 수 확인
        SELECT COUNT(*) INTO deleted_count FROM document_chunks;
        
        IF deleted_count = 0 THEN
            RAISE NOTICE 'No more chunks to delete, stopping.';
            EXIT;
        END IF;
        
        RAISE NOTICE 'Iteration %: % chunks remaining', iteration, deleted_count;
        
        -- 배치 삭제
        DELETE FROM document_chunks 
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        total_deleted := total_deleted + deleted_count;
        
        RAISE NOTICE 'Iteration %: Deleted % chunks (Total: %)', iteration, deleted_count, total_deleted;
        
        -- 메모리 정리를 위한 잠시 대기
        PERFORM pg_sleep(0.1);
    END LOOP;
    
    RAISE NOTICE 'Document_chunks deletion completed. Total deleted: %', total_deleted;
END $$;

SELECT 'Document_chunks deletion completed' as status, NOW() as timestamp;

-- 4. documents 테이블 삭제
DELETE FROM documents;
SELECT 'Documents deletion completed' as status, NOW() as timestamp;

-- 5. document_metadata 테이블 삭제 (테이블이 존재하는 경우에만)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_metadata') THEN
        DELETE FROM document_metadata;
        RAISE NOTICE 'Document_metadata deletion completed';
    ELSE
        RAISE NOTICE 'Document_metadata table does not exist, skipping';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Document_metadata deletion failed: %', SQLERRM;
END $$;

SELECT 'Document_metadata deletion completed' as status, NOW() as timestamp;

-- 6. 최종 결과 확인
SELECT 
  'Final verification - documents' as status,
  COUNT(*) as total_documents
FROM documents;

SELECT 
  'Final verification - chunks' as status,
  COUNT(*) as total_chunks
FROM document_chunks;

SELECT 
  'Final verification - metadata' as status,
  COUNT(*) as total_metadata
FROM document_metadata;

-- 7. 테이블 통계 업데이트
ANALYZE documents;
ANALYZE document_chunks;
ANALYZE document_metadata;

SELECT 'Force delete all data process completed successfully' as status, NOW() as timestamp;
