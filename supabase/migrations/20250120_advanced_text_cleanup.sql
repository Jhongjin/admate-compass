-- 고급 텍스트 정리 (2025-01-20)
-- 깨진 한글 텍스트를 복구하기 위한 추가 정리

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '30s';

-- 2. 현재 상태 확인
SELECT 'Starting advanced text cleanup' as status, NOW() as timestamp;

-- 3. documents 테이블 고급 텍스트 정리
UPDATE documents 
SET content = REGEXP_REPLACE(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(content, '[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]', ' ', 'g'),
      '\s+', ' ', 'g'
    ),
    '^\s+|\s+$', '', 'g'
  ),
  '\0', '', 'g'
)
WHERE content ~ '[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]';

SELECT 'Documents advanced text cleanup completed' as status, NOW() as timestamp;

-- 4. document_chunks 테이블 고급 텍스트 정리 (배치 처리)
DO $$
DECLARE
    batch_size INTEGER := 10;
    processed INTEGER := 0;
    total_affected INTEGER;
    iteration INTEGER := 0;
    max_iterations INTEGER := 50;
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content ~ '[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]';
    
    RAISE NOTICE 'Total rows with special characters: %', total_affected;
    
    -- 배치별로 처리
    WHILE processed < total_affected AND iteration < max_iterations LOOP
        iteration := iteration + 1;
        
        UPDATE document_chunks 
        SET content = REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(content, '[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]', ' ', 'g'),
              '\s+', ' ', 'g'
            ),
            '^\s+|\s+$', '', 'g'
          ),
          '\0', '', 'g'
        )
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content ~ '[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]'
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Iteration %: Processed % rows', iteration, processed;
        
        -- 메모리 정리를 위한 대기
        PERFORM pg_sleep(0.5);
        
        -- 진행 상황이 없으면 중단
        IF processed = 0 THEN
            RAISE NOTICE 'No more rows to process, stopping';
            EXIT;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Completed % iterations, processed % total rows', iteration, processed;
END $$;

SELECT 'Document chunks advanced text cleanup completed' as status, NOW() as timestamp;

-- 5. 최종 결과 확인
SELECT 
  'Advanced cleanup - documents' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]' THEN 1 END) as documents_with_special_chars,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_documents
FROM documents;

SELECT 
  'Advanced cleanup - chunks' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]' THEN 1 END) as chunks_with_special_chars,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_chunks
FROM document_chunks;

-- 6. 샘플 데이터 확인
SELECT 
  'Sample documents after cleanup' as info,
  id,
  LEFT(title, 30) as title_preview,
  LEFT(content, 50) as content_preview
FROM documents
LIMIT 3;

SELECT 
  'Sample chunks after cleanup' as info,
  chunk_id,
  LEFT(content, 50) as content_preview
FROM document_chunks
LIMIT 3;

SELECT 'Advanced text cleanup completed successfully' as status, NOW() as timestamp;
