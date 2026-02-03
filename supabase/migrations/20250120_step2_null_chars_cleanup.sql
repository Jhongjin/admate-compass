-- Step 2: null 문자 제거만 (2025-01-20)
-- 두 번째 단계

-- 1. 메모리 및 타임아웃 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '30s'; -- 30초 타임아웃

-- 2. 현재 상태 확인
SELECT 'Starting Step 2: null character cleanup' as status, NOW() as timestamp;

-- 3. documents 테이블 null 문자 제거
UPDATE documents 
SET content = REPLACE(content, '\0', '')
WHERE content LIKE '%\0%';

SELECT 'Documents null characters removed' as status, NOW() as timestamp;

-- 4. document_chunks 테이블 null 문자 제거 (매우 작은 배치)
DO $$
DECLARE
    batch_size INTEGER := 5; -- 매우 작은 배치
    processed INTEGER := 0;
    total_affected INTEGER;
    iteration INTEGER := 0;
    max_iterations INTEGER := 20; -- 최대 20번 반복
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content LIKE '%\0%';
    
    RAISE NOTICE 'Total rows with null characters: %', total_affected;
    
    -- 배치별로 처리
    WHILE processed < total_affected AND iteration < max_iterations LOOP
        iteration := iteration + 1;
        
        UPDATE document_chunks 
        SET content = REPLACE(content, '\0', '')
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content LIKE '%\0%'
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Iteration %: Processed % rows', iteration, processed;
        
        -- 메모리 정리를 위한 대기
        PERFORM pg_sleep(1.0);
        
        -- 진행 상황이 없으면 중단
        IF processed = 0 THEN
            RAISE NOTICE 'No more rows to process, stopping';
            EXIT;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Completed % iterations, processed % total rows', iteration, processed;
END $$;

SELECT 'Document_chunks null characters removed' as status, NOW() as timestamp;

-- 5. 결과 확인
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
