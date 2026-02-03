-- 메모리 설정 수정 (2025-01-20) - 수정된 버전
-- maintenance_work_mem 증가로 메모리 부족 오류 해결

-- 1. 현재 메모리 설정 확인
SELECT name, setting, unit, context 
FROM pg_settings 
WHERE name IN ('maintenance_work_mem', 'work_mem', 'shared_buffers');

-- 2. maintenance_work_mem 증가 (세션 레벨)
SET maintenance_work_mem = '64MB';

-- 3. work_mem도 함께 증가 (쿼리 성능 향상)
SET work_mem = '16MB';

-- 4. 기존 텍스트 인코딩 수정을 단계별로 실행
-- 먼저 작은 배치로 처리하여 메모리 사용량 제한

-- 4-1. documents 테이블의 content 컬럼 정리 (작은 배치)
UPDATE documents 
SET content = '' 
WHERE content IS NULL OR content = '';

-- 4-2. document_chunks 테이블의 content 컬럼에서 깨진 문자 정리 (작은 배치)
-- 메모리 사용량을 줄이기 위해 LIMIT 사용
UPDATE document_chunks 
SET content = REGEXP_REPLACE(content, '[^\x00-\x7F]', '', 'g')
WHERE content ~ '[^\x00-\x7F]'
AND chunk_id IN (
  SELECT chunk_id 
  FROM document_chunks 
  WHERE content ~ '[^\x00-\x7F]'
  LIMIT 100
);

-- 4-3. documents 테이블의 title 컬럼에서 깨진 문자 정리
UPDATE documents 
SET title = REGEXP_REPLACE(title, '[^\x00-\x7F]', '', 'g')
WHERE title ~ '[^\x00-\x7F]';

-- 4-4. document_chunks 테이블의 metadata 컬럼에서 깨진 문자 정리 (작은 배치)
UPDATE document_chunks 
SET metadata = jsonb_set(
  metadata, 
  '{source}', 
  to_jsonb(REGEXP_REPLACE(metadata->>'source', '[^\x00-\x7F]', '', 'g'))
)
WHERE metadata->>'source' ~ '[^\x00-\x7F]'
AND chunk_id IN (
  SELECT chunk_id 
  FROM document_chunks 
  WHERE metadata->>'source' ~ '[^\x00-\x7F]'
  LIMIT 50
);

-- 5. UTF-8 인코딩을 위한 데이터베이스 설정 확인
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

-- 7. 깨진 데이터가 있는지 확인하는 쿼리 (제한된 결과) - 수정된 버전
-- documents 테이블 확인
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
LIMIT 5;

-- document_chunks 테이블 확인
SELECT 
  'document_chunks' as table_name,
  chunk_id,
  LEFT(content, 50) as content,
  CASE 
    WHEN content ~ '[^\x00-\x7F]' THEN 'Has non-ASCII characters'
    ELSE 'Clean'
  END as content_status
FROM document_chunks
WHERE content ~ '[^\x00-\x7F]'
LIMIT 5;

-- 8. 인덱스 재구성 (메모리 효율적으로)
-- 큰 테이블의 경우 인덱스를 하나씩 재구성
REINDEX TABLE documents;
REINDEX TABLE document_chunks;

-- 9. 통계 업데이트 (메모리 효율적으로)
ANALYZE documents;
ANALYZE document_chunks;

-- 10. UTF-8 인코딩 검증 함수 생성 (간단한 버전)
CREATE OR REPLACE FUNCTION is_valid_utf8(text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  -- 간단한 UTF-8 유효성 검사
  RETURN text ~ '^[\x00-\x7F]*$' OR text ~ '^[\x00-\x7F\xC2-\xDF][\x80-\xBF]*$';
END;
$$;

-- 11. 텍스트 정리 함수 생성 (메모리 효율적인 버전)
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

-- 12. 기존 데이터 정리 적용 (작은 배치로 처리)
-- documents 테이블 정리
UPDATE documents 
SET content = clean_text_encoding(content),
    title = clean_text_encoding(title)
WHERE content IS NOT NULL OR title IS NOT NULL;

-- document_chunks 테이블 정리 (작은 배치)
UPDATE document_chunks 
SET content = clean_text_encoding(content)
WHERE content IS NOT NULL
AND chunk_id IN (
  SELECT chunk_id 
  FROM document_chunks 
  WHERE content IS NOT NULL
  LIMIT 200
);

-- 13. 정리 결과 확인 (제한된 결과) - 수정된 버전
-- documents 테이블 결과
SELECT 
  'After cleanup - documents' as status,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as documents_with_special_chars
FROM documents;

-- document_chunks 테이블 결과
SELECT 
  'After cleanup - chunks' as status,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as chunks_with_special_chars
FROM document_chunks;

-- 14. 메모리 사용량 확인
SELECT 
  'Memory settings after update' as info,
  name, 
  setting, 
  unit 
FROM pg_settings 
WHERE name IN ('maintenance_work_mem', 'work_mem', 'shared_buffers');
