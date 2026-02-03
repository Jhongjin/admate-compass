-- Step 1: 기존 인덱스 삭제만 (2025-01-20)
-- 첫 번째 단계 - 기존 인덱스 삭제

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '10s'; -- 10초 타임아웃

-- 2. 현재 상태 확인
SELECT 'Starting Step 1: Drop existing indexes' as status, NOW() as timestamp;

-- 3. 기존 인덱스 삭제
DROP INDEX IF EXISTS idx_document_chunks_embedding;
DROP INDEX IF EXISTS idx_document_chunks_document_id;
DROP INDEX IF EXISTS idx_document_chunks_chunk_id;
DROP INDEX IF EXISTS idx_documents_status;
DROP INDEX IF EXISTS idx_documents_type;

-- 4. Step 1 결과 확인
SELECT 
  'Step 1 results - remaining indexes' as status,
  schemaname,
  tablename,
  indexname
FROM pg_indexes 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY schemaname, tablename, indexname;

SELECT 'Step 1 completed successfully' as status, NOW() as timestamp;
