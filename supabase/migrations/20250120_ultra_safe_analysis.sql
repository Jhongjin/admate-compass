-- 초안전한 데이터베이스 상태 분석 (2025-01-20)
-- 최소한의 쿼리로 기본 정보만 확인

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '300s';

-- 2. PostgreSQL 버전 확인
SELECT 'PostgreSQL version' as info, version() as version_string;

-- 3. 현재 데이터베이스 이름
SELECT 'Current database' as info, current_database() as database_name;

-- 4. documents 테이블 기본 정보
SELECT 
  'documents table' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content
FROM documents;

-- 5. document_chunks 테이블 기본 정보
SELECT 
  'document_chunks table' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content
FROM document_chunks;

-- 6. 깨진 데이터 개수 확인 (간단한 방식)
SELECT 
  'documents with special chars' as info,
  COUNT(*) as count
FROM documents
WHERE content ~ '[^\x20-\x7E]';

SELECT 
  'document_chunks with special chars' as info,
  COUNT(*) as count
FROM document_chunks
WHERE content ~ '[^\x20-\x7E]';

-- 7. 샘플 데이터 확인 (최소한)
SELECT 
  'documents sample' as source,
  id,
  LEFT(title, 30) as title_preview
FROM documents
LIMIT 2;

SELECT 
  'document_chunks sample' as source,
  chunk_id,
  LEFT(content, 50) as content_preview
FROM document_chunks
LIMIT 2;

-- 8. 메모리 설정 확인
SELECT 
  'Memory settings' as info,
  name, 
  setting, 
  unit
FROM pg_settings 
WHERE name IN ('maintenance_work_mem', 'work_mem', 'statement_timeout');

SELECT 'Analysis completed successfully' as status, NOW() as timestamp;
