-- Step 1: NULL 값 정리만 (2025-01-20)
-- 가장 안전한 첫 번째 단계

-- 1. 메모리 및 타임아웃 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '30s'; -- 30초 타임아웃

-- 2. 현재 상태 확인
SELECT 'Starting Step 1: NULL value cleanup' as status, NOW() as timestamp;

-- 3. documents 테이블 NULL 값 정리
UPDATE documents 
SET content = '' 
WHERE content IS NULL;

SELECT 'Documents NULL values cleaned' as status, NOW() as timestamp;

-- 4. document_chunks 테이블 NULL 값 정리
UPDATE document_chunks 
SET content = '' 
WHERE content IS NULL;

SELECT 'Document_chunks NULL values cleaned' as status, NOW() as timestamp;

-- 5. 결과 확인
SELECT 
  'Step 1 results - documents' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content_count
FROM documents;

SELECT 
  'Step 1 results - chunks' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content_count
FROM document_chunks;

SELECT 'Step 1 completed successfully' as status, NOW() as timestamp;
