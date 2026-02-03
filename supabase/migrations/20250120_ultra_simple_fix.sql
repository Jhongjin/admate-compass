-- 초간단 텍스트 정리 (2025-01-20)
-- 함수 오류를 완전히 피하는 안전한 버전

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

-- 7. 제어 문자 제거 (간단한 방식)
-- documents 테이블
UPDATE documents 
SET content = REGEXP_REPLACE(content, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')
WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]';

UPDATE documents 
SET title = REGEXP_REPLACE(title, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')
WHERE title ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]';

-- document_chunks 테이블 (작은 배치로)
UPDATE document_chunks 
SET content = REGEXP_REPLACE(content, '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')
WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'
AND chunk_id IN (
  SELECT chunk_id 
  FROM document_chunks 
  WHERE content ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'
  LIMIT 200
);

-- 8. 연속된 공백 정리
-- documents 테이블
UPDATE documents 
SET content = REGEXP_REPLACE(content, '\s+', ' ', 'g')
WHERE content ~ '\s{2,}';

UPDATE documents 
SET title = REGEXP_REPLACE(title, '\s+', ' ', 'g')
WHERE title ~ '\s{2,}';

-- document_chunks 테이블 (작은 배치로)
UPDATE document_chunks 
SET content = REGEXP_REPLACE(content, '\s+', ' ', 'g')
WHERE content ~ '\s{2,}'
AND chunk_id IN (
  SELECT chunk_id 
  FROM document_chunks 
  WHERE content ~ '\s{2,}'
  LIMIT 200
);

-- 9. 앞뒤 공백 제거
-- documents 테이블
UPDATE documents 
SET content = TRIM(content)
WHERE content IS NOT NULL AND content != '';

UPDATE documents 
SET title = TRIM(title)
WHERE title IS NOT NULL AND title != '';

-- document_chunks 테이블 (작은 배치로)
UPDATE document_chunks 
SET content = TRIM(content)
WHERE content IS NOT NULL AND content != ''
AND chunk_id IN (
  SELECT chunk_id 
  FROM document_chunks 
  WHERE content IS NOT NULL AND content != ''
  LIMIT 200
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
