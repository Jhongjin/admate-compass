-- 단계별 안전한 텍스트 정리 (2025-01-20)
-- 타임아웃을 방지하기 위한 단계별 처리

-- 1. 메모리 및 타임아웃 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '300s';

-- 2. 현재 상태 확인
SELECT 'Starting cleanup process' as status, NOW() as timestamp;

-- 3. Step 1: NULL 값 정리 (가장 안전)
-- documents 테이블
UPDATE documents 
SET content = '' 
WHERE content IS NULL;

-- document_chunks 테이블
UPDATE document_chunks 
SET content = '' 
WHERE content IS NULL;

SELECT 'Step 1 completed: NULL values cleaned' as status, NOW() as timestamp;

-- 4. Step 2: null 문자 제거 (작은 배치)
-- documents 테이블
UPDATE documents 
SET content = REPLACE(content, '\0', '')
WHERE content LIKE '%\0%';

-- document_chunks 테이블 (배치 처리)
DO $$
DECLARE
    batch_size INTEGER := 50;
    processed INTEGER := 0;
    total_affected INTEGER;
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content LIKE '%\0%';
    
    RAISE NOTICE 'Total rows with null characters: %', total_affected;
    
    -- 배치별로 처리
    WHILE processed < total_affected LOOP
        UPDATE document_chunks 
        SET content = REPLACE(content, '\0', '')
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content LIKE '%\0%'
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Processed % rows', processed;
        
        -- 메모리 정리를 위한 잠시 대기
        PERFORM pg_sleep(0.1);
    END LOOP;
END $$;

SELECT 'Step 2 completed: null characters removed' as status, NOW() as timestamp;

-- 5. Step 3: 제어 문자 제거 (작은 배치)
-- documents 테이블
UPDATE documents 
SET content = REGEXP_REPLACE(content, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')
WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]';

-- document_chunks 테이블 (배치 처리)
DO $$
DECLARE
    batch_size INTEGER := 50;
    processed INTEGER := 0;
    total_affected INTEGER;
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]';
    
    RAISE NOTICE 'Total rows with control characters: %', total_affected;
    
    -- 배치별로 처리
    WHILE processed < total_affected LOOP
        UPDATE document_chunks 
        SET content = REGEXP_REPLACE(content, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Processed % rows', processed;
        
        -- 메모리 정리를 위한 잠시 대기
        PERFORM pg_sleep(0.1);
    END LOOP;
END $$;

SELECT 'Step 3 completed: control characters removed' as status, NOW() as timestamp;

-- 6. Step 4: 연속된 공백 정리 (작은 배치)
-- documents 테이블
UPDATE documents 
SET content = REGEXP_REPLACE(content, '\s+', ' ', 'g')
WHERE content ~ '\s{2,}';

-- document_chunks 테이블 (배치 처리)
DO $$
DECLARE
    batch_size INTEGER := 50;
    processed INTEGER := 0;
    total_affected INTEGER;
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content ~ '\s{2,}';
    
    RAISE NOTICE 'Total rows with multiple spaces: %', total_affected;
    
    -- 배치별로 처리
    WHILE processed < total_affected LOOP
        UPDATE document_chunks 
        SET content = REGEXP_REPLACE(content, '\s+', ' ', 'g')
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content ~ '\s{2,}'
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Processed % rows', processed;
        
        -- 메모리 정리를 위한 잠시 대기
        PERFORM pg_sleep(0.1);
    END LOOP;
END $$;

SELECT 'Step 4 completed: multiple spaces cleaned' as status, NOW() as timestamp;

-- 7. Step 5: 앞뒤 공백 제거 (작은 배치)
-- documents 테이블
UPDATE documents 
SET content = TRIM(content)
WHERE content IS NOT NULL AND content != '';

-- document_chunks 테이블 (배치 처리)
DO $$
DECLARE
    batch_size INTEGER := 100;
    processed INTEGER := 0;
    total_affected INTEGER;
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content IS NOT NULL AND content != '';
    
    RAISE NOTICE 'Total rows to trim: %', total_affected;
    
    -- 배치별로 처리
    WHILE processed < total_affected LOOP
        UPDATE document_chunks 
        SET content = TRIM(content)
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content IS NOT NULL AND content != ''
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Processed % rows', processed;
        
        -- 메모리 정리를 위한 잠시 대기
        PERFORM pg_sleep(0.1);
    END LOOP;
END $$;

SELECT 'Step 5 completed: whitespace trimmed' as status, NOW() as timestamp;

-- 8. 최종 결과 확인
-- documents 테이블 결과
SELECT 
  'Final cleanup - documents' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as documents_with_special_chars,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_documents
FROM documents;

-- document_chunks 테이블 결과
SELECT 
  'Final cleanup - chunks' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as chunks_with_special_chars,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_chunks
FROM document_chunks;

-- 9. 인덱스 재구성 (안전한 방식)
REINDEX TABLE documents;
REINDEX TABLE document_chunks;

-- 10. 통계 업데이트
ANALYZE documents;
ANALYZE document_chunks;

-- 11. 최종 메모리 설정 확인
SELECT 
  'Final memory settings' as info,
  name, 
  setting, 
  unit 
FROM pg_settings 
WHERE name IN ('maintenance_work_mem', 'work_mem', 'statement_timeout');

SELECT 'Cleanup process completed successfully' as status, NOW() as timestamp;
