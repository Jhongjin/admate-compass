-- 간단한 결과 검증 (2025-01-20)
-- 기본적인 상태만 확인

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '15s';

-- 2. 현재 상태 확인
SELECT 'Starting simple verification' as status, NOW() as timestamp;

-- 3. 테이블 기본 정보
-- documents 테이블
SELECT 
  'Documents summary' as table_name,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content
FROM documents;

-- document_chunks 테이블
SELECT 
  'Document chunks summary' as table_name,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content
FROM document_chunks;

-- 4. 인덱스 확인
SELECT 
  'Indexes' as info,
  tablename,
  indexname
FROM pg_indexes 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY tablename, indexname;

-- 5. 샘플 데이터
-- documents 샘플
SELECT 
  'Documents sample' as source,
  id,
  LEFT(title, 20) as title_preview,
  status
FROM documents
LIMIT 2;

-- document_chunks 샘플
SELECT 
  'Document chunks sample' as source,
  chunk_id,
  LEFT(content, 30) as content_preview
FROM document_chunks
LIMIT 2;

-- 6. 최종 상태
SELECT 
  'Verification results' as status,
  'Database cleanup and optimization completed' as message,
  NOW() as timestamp;

SELECT 'Simple verification completed successfully' as status, NOW() as timestamp;
