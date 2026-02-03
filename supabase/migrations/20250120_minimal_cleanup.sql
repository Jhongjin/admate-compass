-- 최소한의 텍스트 정리 (2025-01-20)
-- 타임아웃을 완전히 방지하기 위한 최소한의 작업만 수행

-- 1. 메모리 및 타임아웃 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '30s'; -- 30초 타임아웃

-- 2. 현재 상태 확인
SELECT 'Starting minimal cleanup process' as status, NOW() as timestamp;

-- 3. Step 1: NULL 값 정리만 (가장 안전)
UPDATE documents 
SET content = '' 
WHERE content IS NULL;

SELECT 'Documents NULL values cleaned' as status, NOW() as timestamp;

UPDATE document_chunks 
SET content = '' 
WHERE content IS NULL;

SELECT 'Document_chunks NULL values cleaned' as status, NOW() as timestamp;

-- 4. Step 2: null 문자 제거만 (단순한 방식)
UPDATE documents 
SET content = REPLACE(content, '\0', '')
WHERE content LIKE '%\0%';

SELECT 'Documents null characters removed' as status, NOW() as timestamp;

-- document_chunks는 매우 작은 배치로만 처리
UPDATE document_chunks 
SET content = REPLACE(content, '\0', '')
WHERE chunk_id IN (
    SELECT chunk_id 
    FROM document_chunks 
    WHERE content LIKE '%\0%'
    LIMIT 5  -- 5개만 처리
);

SELECT 'Document_chunks null characters removed (5 rows)' as status, NOW() as timestamp;

-- 5. 결과 확인
SELECT 
  'Minimal cleanup - documents' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content,
  COUNT(CASE WHEN content LIKE '%\0%' THEN 1 END) as null_chars
FROM documents;

SELECT 
  'Minimal cleanup - chunks' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content,
  COUNT(CASE WHEN content LIKE '%\0%' THEN 1 END) as null_chars
FROM document_chunks;

SELECT 'Minimal cleanup completed successfully' as status, NOW() as timestamp;
