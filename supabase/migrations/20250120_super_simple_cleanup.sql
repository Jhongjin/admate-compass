-- 초단순 텍스트 정리 (2025-01-20)
-- 타임아웃을 완전히 방지하기 위한 가장 기본적인 작업만

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '15s'; -- 15초 타임아웃

-- 2. 현재 상태 확인
SELECT 'Starting super simple cleanup' as status, NOW() as timestamp;

-- 3. documents 테이블 NULL 값만 정리
UPDATE documents 
SET content = '' 
WHERE content IS NULL;

SELECT 'Documents NULL values cleaned' as status, NOW() as timestamp;

-- 4. document_chunks 테이블 NULL 값만 정리
UPDATE document_chunks 
SET content = '' 
WHERE content IS NULL;

SELECT 'Document_chunks NULL values cleaned' as status, NOW() as timestamp;

-- 5. 기본 결과 확인
SELECT 
  'Simple cleanup - documents' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content
FROM documents;

SELECT 
  'Simple cleanup - chunks' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content
FROM document_chunks;

SELECT 'Super simple cleanup completed' as status, NOW() as timestamp;
