-- Step 2: null 문자 제거만 (2025-01-20)
-- 두 번째 단계 - null 문자만 제거

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '10s'; -- 10초 타임아웃

-- 2. documents 테이블 null 문자 제거
UPDATE documents 
SET content = REPLACE(content, '\0', '')
WHERE content LIKE '%\0%';

SELECT 'Step 2: Documents null characters removed' as status, NOW() as timestamp;

-- 3. document_chunks 테이블 null 문자 제거 (1개씩만)
UPDATE document_chunks 
SET content = REPLACE(content, '\0', '')
WHERE chunk_id IN (
    SELECT chunk_id 
    FROM document_chunks 
    WHERE content LIKE '%\0%'
    LIMIT 1  -- 1개만 처리
);

SELECT 'Step 2: Document_chunks null characters removed (1 row)' as status, NOW() as timestamp;

-- 4. Step 2 결과 확인
SELECT 
  'Step 2 results - documents' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content LIKE '%\0%' THEN 1 END) as null_char_count
FROM documents;

SELECT 
  'Step 2 results - chunks' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content LIKE '%\0%' THEN 1 END) as null_char_count
FROM document_chunks;

SELECT 'Step 2 completed successfully' as status, NOW() as timestamp;
