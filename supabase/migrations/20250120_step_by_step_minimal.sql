-- 단계별 최소 작업 (2025-01-20)
-- 각 단계를 완전히 분리하여 타임아웃 방지

-- ========================================
-- STEP 1: NULL 값 정리만
-- ========================================

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '10s'; -- 10초 타임아웃

-- 2. documents 테이블 NULL 값 정리
UPDATE documents 
SET content = '' 
WHERE content IS NULL;

SELECT 'Step 1: Documents NULL values cleaned' as status, NOW() as timestamp;

-- 3. document_chunks 테이블 NULL 값 정리
UPDATE document_chunks 
SET content = '' 
WHERE content IS NULL;

SELECT 'Step 1: Document_chunks NULL values cleaned' as status, NOW() as timestamp;

-- 4. Step 1 결과 확인
SELECT 
  'Step 1 results - documents' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content
FROM documents;

SELECT 
  'Step 1 results - chunks' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content
FROM document_chunks;

SELECT 'Step 1 completed successfully' as status, NOW() as timestamp;
