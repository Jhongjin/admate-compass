-- 텍스트 인코딩 문제 해결 (2025-01-20)
-- 깨진 텍스트 데이터를 정리하고 UTF-8 인코딩을 보장

-- 1. 메모리 설정 증가
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';

-- 2. documents 테이블의 content 컬럼 정리
UPDATE documents 
SET content = '' 
WHERE content IS NULL OR content = '';

-- 3. document_chunks 테이블의 content 컬럼에서 깨진 문자 정리 (배치 처리)
-- 메모리 사용량을 줄이기 위해 작은 배치로 처리
DO $$
DECLARE
    batch_size INTEGER := 100;
    processed INTEGER := 0;
    total_affected INTEGER;
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE content ~ '[^\x00-\x7F]';
    
    RAISE NOTICE 'Total rows to process: %', total_affected;
    
    -- 배치별로 처리
    WHILE processed < total_affected LOOP
        UPDATE document_chunks 
        SET content = REGEXP_REPLACE(content, '[^\x00-\x7F]', '', 'g')
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE content ~ '[^\x00-\x7F]'
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Processed % rows', processed;
        
        -- 메모리 정리를 위한 잠시 대기
        PERFORM pg_sleep(0.1);
    END LOOP;
END $$;

-- 4. documents 테이블의 title 컬럼에서 깨진 문자 정리
UPDATE documents 
SET title = REGEXP_REPLACE(title, '[^\x00-\x7F]', '', 'g')
WHERE title ~ '[^\x00-\x7F]';

-- 5. document_chunks 테이블의 metadata 컬럼에서 깨진 문자 정리 (배치 처리)
DO $$
DECLARE
    batch_size INTEGER := 50;
    processed INTEGER := 0;
    total_affected INTEGER;
BEGIN
    -- 전체 영향을 받을 행 수 확인
    SELECT COUNT(*) INTO total_affected 
    FROM document_chunks 
    WHERE metadata->>'source' ~ '[^\x00-\x7F]';
    
    RAISE NOTICE 'Total metadata rows to process: %', total_affected;
    
    -- 배치별로 처리
    WHILE processed < total_affected LOOP
        UPDATE document_chunks 
        SET metadata = jsonb_set(
            metadata, 
            '{source}', 
            to_jsonb(REGEXP_REPLACE(metadata->>'source', '[^\x00-\x7F]', '', 'g'))
        )
        WHERE chunk_id IN (
            SELECT chunk_id 
            FROM document_chunks 
            WHERE metadata->>'source' ~ '[^\x00-\x7F]'
            LIMIT batch_size
        );
        
        GET DIAGNOSTICS processed = ROW_COUNT;
        RAISE NOTICE 'Processed % metadata rows', processed;
        
        -- 메모리 정리를 위한 잠시 대기
        PERFORM pg_sleep(0.1);
    END LOOP;
END $$;

-- 5. UTF-8 인코딩을 위한 데이터베이스 설정 확인
-- PostgreSQL의 기본 인코딩이 UTF-8인지 확인
SELECT datname, datcollate, datctype 
FROM pg_database 
WHERE datname = current_database();

-- 6. 텍스트 컬럼들의 인코딩 정보 확인
SELECT 
  table_name, 
  column_name, 
  data_type, 
  character_set_name,
  collation_name
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name IN ('documents', 'document_chunks')
  AND data_type = 'text';

-- 7. 깨진 데이터가 있는지 확인하는 쿼리
SELECT 
  'documents' as table_name,
  id,
  title,
  CASE 
    WHEN content ~ '[^\x00-\x7F]' THEN 'Has non-ASCII characters'
    ELSE 'Clean'
  END as content_status
FROM documents
WHERE content ~ '[^\x00-\x7F]'

UNION ALL

SELECT 
  'document_chunks' as table_name,
  chunk_id,
  content,
  CASE 
    WHEN content ~ '[^\x00-\x7F]' THEN 'Has non-ASCII characters'
    ELSE 'Clean'
  END as content_status
FROM document_chunks
WHERE content ~ '[^\x00-\x7F]'
LIMIT 10;

-- 8. 인덱스 재구성 (성능 최적화)
REINDEX TABLE documents;
REINDEX TABLE document_chunks;

-- 9. 통계 업데이트
ANALYZE documents;
ANALYZE document_chunks;

-- 10. UTF-8 인코딩 검증 함수 생성
CREATE OR REPLACE FUNCTION is_valid_utf8(text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  -- UTF-8 유효성 검사
  RETURN text ~ '^[\x00-\x7F]*$' OR text ~ '^[\x00-\x7F\xC2-\xDF][\x80-\xBF]*$';
END;
$$;

-- 11. 텍스트 정리 함수 생성
CREATE OR REPLACE FUNCTION clean_text_encoding(input_text text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  -- null 문자 제거
  input_text := REPLACE(input_text, '\0', '');
  
  -- 제어 문자 제거 (탭, 줄바꿈, 캐리지 리턴 제외)
  input_text := REGEXP_REPLACE(input_text, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  
  -- UTF-8 유효성 검사 후 정리
  IF NOT is_valid_utf8(input_text) THEN
    -- ASCII 문자만 유지
    input_text := REGEXP_REPLACE(input_text, '[^\x20-\x7E]', ' ', 'g');
  END IF;
  
  -- 연속된 공백을 하나로 정리
  input_text := REGEXP_REPLACE(input_text, '\s+', ' ', 'g');
  
  -- 앞뒤 공백 제거
  input_text := TRIM(input_text);
  
  RETURN input_text;
END;
$$;

-- 12. 기존 데이터 정리 적용
UPDATE documents 
SET content = clean_text_encoding(content),
    title = clean_text_encoding(title)
WHERE content IS NOT NULL OR title IS NOT NULL;

UPDATE document_chunks 
SET content = clean_text_encoding(content)
WHERE content IS NOT NULL;

-- 13. 정리 결과 확인
SELECT 
  'After cleanup' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as documents_with_special_chars
FROM documents

UNION ALL

SELECT 
  'After cleanup' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as chunks_with_special_chars
FROM document_chunks;
