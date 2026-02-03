-- 간단한 메모리 설정 수정 (2025-01-20)
-- 구문 오류를 방지하기 위한 최소한의 수정

-- 1. 메모리 설정 증가
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';

-- 2. 현재 메모리 설정 확인
SELECT name, setting, unit, context 
FROM pg_settings 
WHERE name IN ('maintenance_work_mem', 'work_mem', 'shared_buffers');

-- 3. documents 테이블의 content 컬럼 정리 (NULL 값만)
UPDATE documents 
SET content = '' 
WHERE content IS NULL;

-- 4. document_chunks 테이블의 content 컬럼에서 null 문자만 제거
UPDATE document_chunks 
SET content = REPLACE(content, '\0', '')
WHERE content LIKE '%\0%';

-- 5. documents 테이블의 title 컬럼에서 null 문자만 제거
UPDATE documents 
SET title = REPLACE(title, '\0', '')
WHERE title LIKE '%\0%';

-- 6. document_chunks 테이블의 metadata 컬럼에서 null 문자만 제거
UPDATE document_chunks 
SET metadata = jsonb_set(
  metadata, 
  '{source}', 
  to_jsonb(REPLACE(metadata->>'source', '\0', ''))
)
WHERE metadata->>'source' LIKE '%\0%';

-- 7. UTF-8 인코딩 검증 함수 생성
CREATE OR REPLACE FUNCTION is_valid_utf8(text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  -- 간단한 UTF-8 유효성 검사
  RETURN text ~ '^[\x00-\x7F]*$' OR text ~ '^[\x00-\x7F\xC2-\xDF][\x80-\xBF]*$';
END;
$$;

-- 8. 텍스트 정리 함수 생성
CREATE OR REPLACE FUNCTION clean_text_encoding(input_text text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  -- null 문자 제거
  input_text := REPLACE(input_text, '\0', '');
  
  -- 제어 문자 제거 (탭, 줄바꿈, 캐리지 리턴 제외)
  input_text := REGEXP_REPLACE(input_text, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  
  -- 연속된 공백을 하나로 정리
  input_text := REGEXP_REPLACE(input_text, '\s+', ' ', 'g');
  
  -- 앞뒤 공백 제거
  input_text := TRIM(input_text);
  
  RETURN input_text;
END;
$$;

-- 9. 기존 데이터 정리 적용
-- documents 테이블 정리
UPDATE documents 
SET content = clean_text_encoding(content)
WHERE content IS NOT NULL AND content != '';

UPDATE documents 
SET title = clean_text_encoding(title)
WHERE title IS NOT NULL AND title != '';

-- document_chunks 테이블 정리 (작은 배치로)
UPDATE document_chunks 
SET content = clean_text_encoding(content)
WHERE content IS NOT NULL AND content != ''
AND chunk_id IN (
  SELECT chunk_id 
  FROM document_chunks 
  WHERE content IS NOT NULL AND content != ''
  LIMIT 500
);

-- 10. 정리 결과 확인
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

-- 11. 인덱스 재구성
REINDEX TABLE documents;
REINDEX TABLE document_chunks;

-- 12. 통계 업데이트
ANALYZE documents;
ANALYZE document_chunks;

-- 13. 최종 메모리 설정 확인
SELECT 
  'Final memory settings' as info,
  name, 
  setting, 
  unit 
FROM pg_settings 
WHERE name IN ('maintenance_work_mem', 'work_mem', 'shared_buffers');
