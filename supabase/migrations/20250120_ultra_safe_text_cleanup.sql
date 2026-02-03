-- 초안전한 텍스트 정리 (2025-01-20)
-- 타임아웃을 방지하기 위한 매우 작은 배치 처리

-- 1. 메모리 및 타임아웃 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '60s'; -- 1분 타임아웃으로 단축

-- 2. 현재 상태 확인
SELECT 'Starting ultra-safe cleanup process' as status, NOW() as timestamp;

-- 3. Step 1: NULL 값 정리 (가장 안전)
UPDATE documents 
SET content = '' 
WHERE content IS NULL;

UPDATE document_chunks 
SET content = '' 
WHERE content IS NULL;

SELECT 'Step 1 completed: NULL values cleaned' as status, NOW() as timestamp;

-- 4. Step 2: null 문자 제거 (매우 작은 배치)
-- documents 테이블
UPDATE documents 
SET content = REPLACE(content, '\0', '')
WHERE content LIKE '%\0%';

-- document_chunks 테이블 (매우 작은 배치)
DO $$
DECLARE
    batch_size INTEGER := 10; -- 배치 크기를 10으로 줄임
    processed INTEGER := 0;
    total_affected INTEGER;
    iteration INTEGER := 0;
    max_iterations INTEGER := 100; -- 최대 100번 반복으로 제한
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content LIKE '%\0%';
    
    RAISE NOTICE 'Total rows with null characters: %', total_affected;
    
    -- 배치별로 처리 (최대 반복 횟수 제한)
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
        
        -- 메모리 정리를 위한 대기 시간 증가
        PERFORM pg_sleep(0.5);
        
        -- 진행 상황이 없으면 중단
        IF processed = 0 THEN
            RAISE NOTICE 'No more rows to process, stopping';
            EXIT;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Completed % iterations, processed % total rows', iteration, processed;
END $$;

SELECT 'Step 2 completed: null characters removed' as status, NOW() as timestamp;

-- 5. Step 3: 제어 문자 제거 (매우 작은 배치)
-- documents 테이블
UPDATE documents 
SET content = REGEXP_REPLACE(content, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')
WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]';

-- document_chunks 테이블 (매우 작은 배치)
DO $$
DECLARE
    batch_size INTEGER := 10; -- 배치 크기를 10으로 줄임
    processed INTEGER := 0;
    total_affected INTEGER;
    iteration INTEGER := 0;
    max_iterations INTEGER := 100; -- 최대 100번 반복으로 제한
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]';
    
    RAISE NOTICE 'Total rows with control characters: %', total_affected;
    
    -- 배치별로 처리 (최대 반복 횟수 제한)
    WHILE processed < total_affected AND iteration < max_iterations LOOP
        iteration := iteration + 1;
        
        UPDATE document_chunks 
        SET content = REGEXP_REPLACE(content, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Iteration %: Processed % rows', iteration, processed;
        
        -- 메모리 정리를 위한 대기 시간 증가
        PERFORM pg_sleep(0.5);
        
        -- 진행 상황이 없으면 중단
        IF processed = 0 THEN
            RAISE NOTICE 'No more rows to process, stopping';
            EXIT;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Completed % iterations, processed % total rows', iteration, processed;
END $$;

SELECT 'Step 3 completed: control characters removed' as status, NOW() as timestamp;

-- 6. Step 4: 연속된 공백 정리 (매우 작은 배치)
-- documents 테이블
UPDATE documents 
SET content = REGEXP_REPLACE(content, '\s+', ' ', 'g')
WHERE content ~ '\s{2,}';

-- document_chunks 테이블 (매우 작은 배치)
DO $$
DECLARE
    batch_size INTEGER := 10; -- 배치 크기를 10으로 줄임
    processed INTEGER := 0;
    total_affected INTEGER;
    iteration INTEGER := 0;
    max_iterations INTEGER := 100; -- 최대 100번 반복으로 제한
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content ~ '\s{2,}';
    
    RAISE NOTICE 'Total rows with multiple spaces: %', total_affected;
    
    -- 배치별로 처리 (최대 반복 횟수 제한)
    WHILE processed < total_affected AND iteration < max_iterations LOOP
        iteration := iteration + 1;
        
        UPDATE document_chunks 
        SET content = REGEXP_REPLACE(content, '\s+', ' ', 'g')
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content ~ '\s{2,}'
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Iteration %: Processed % rows', iteration, processed;
        
        -- 메모리 정리를 위한 대기 시간 증가
        PERFORM pg_sleep(0.5);
        
        -- 진행 상황이 없으면 중단
        IF processed = 0 THEN
            RAISE NOTICE 'No more rows to process, stopping';
            EXIT;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Completed % iterations, processed % total rows', iteration, processed;
END $$;

SELECT 'Step 4 completed: multiple spaces cleaned' as status, NOW() as timestamp;

-- 7. Step 5: 앞뒤 공백 제거 (매우 작은 배치)
-- documents 테이블
UPDATE documents 
SET content = TRIM(content)
WHERE content IS NOT NULL AND content != '';

-- document_chunks 테이블 (매우 작은 배치)
DO $$
DECLARE
    batch_size INTEGER := 20; -- TRIM은 더 빠르므로 20으로 설정
    processed INTEGER := 0;
    total_affected INTEGER;
    iteration INTEGER := 0;
    max_iterations INTEGER := 50; -- 최대 50번 반복으로 제한
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content IS NOT NULL AND content != '';
    
    RAISE NOTICE 'Total rows to trim: %', total_affected;
    
    -- 배치별로 처리 (최대 반복 횟수 제한)
    WHILE processed < total_affected AND iteration < max_iterations LOOP
        iteration := iteration + 1;
        
        UPDATE document_chunks 
        SET content = TRIM(content)
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content IS NOT NULL AND content != ''
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Iteration %: Processed % rows', iteration, processed;
        
        -- 메모리 정리를 위한 대기 시간 증가
        PERFORM pg_sleep(0.3);
        
        -- 진행 상황이 없으면 중단
        IF processed = 0 THEN
            RAISE NOTICE 'No more rows to process, stopping';
            EXIT;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Completed % iterations, processed % total rows', iteration, processed;
END $$;

SELECT 'Step 5 completed: whitespace trimmed' as status, NOW() as timestamp;

-- 8. 최종 결과 확인
SELECT 
  'Final cleanup - documents' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as documents_with_special_chars,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_documents
FROM documents;

SELECT 
  'Final cleanup - chunks' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as chunks_with_special_chars,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_chunks
FROM document_chunks;

SELECT 'Ultra-safe cleanup process completed successfully' as status, NOW() as timestamp;
