-- 최종 결과 검증 (2025-01-20)
-- 전체적인 데이터베이스 상태와 성능 확인

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '30s';

-- 2. 현재 상태 확인
SELECT 'Starting final verification' as status, NOW() as timestamp;

-- 3. PostgreSQL 버전 및 기본 정보
SELECT 'PostgreSQL version' as info, version() as version_string;
SELECT 'Current database' as info, current_database() as database_name;

-- 4. 테이블 기본 정보 확인
-- documents 테이블 정보
SELECT 
  'Documents table summary' as table_name,
  COUNT(*) as total_documents,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as special_chars,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_docs
FROM documents;

-- document_chunks 테이블 정보
SELECT 
  'Document chunks table summary' as table_name,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as special_chars
FROM document_chunks;

-- 5. 인덱스 상태 확인
SELECT 
  'Current indexes' as info,
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY schemaname, tablename, indexname;

-- 6. 테이블 크기 정보
SELECT 
  'Table sizes' as info,
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY schemaname, tablename;

-- 7. 샘플 데이터 확인
-- documents 테이블 샘플
SELECT 
  'Documents sample' as source,
  id,
  LEFT(title, 30) as title_preview,
  status,
  type
FROM documents
LIMIT 3;

-- document_chunks 테이블 샘플
SELECT 
  'Document chunks sample' as source,
  chunk_id,
  LEFT(content, 50) as content_preview
FROM document_chunks
LIMIT 3;

-- 8. 메모리 설정 확인
SELECT 
  'Current memory settings' as info,
  name, 
  setting, 
  unit
FROM pg_settings 
WHERE name IN ('maintenance_work_mem', 'work_mem', 'statement_timeout', 'shared_buffers');

-- 9. 데이터베이스 성능 정보
SELECT 
  'Database performance' as info,
  datname,
  numbackends as active_connections,
  xact_commit as committed_transactions,
  xact_rollback as rolled_back_transactions
FROM pg_stat_database 
WHERE datname = current_database();

-- 10. 최종 검증 결과
SELECT 
  'Final verification results' as status,
  CASE 
    WHEN (SELECT COUNT(*) FROM documents) > 0 THEN 'Documents table has data'
    ELSE 'Documents table is empty'
  END as documents_status,
  CASE 
    WHEN (SELECT COUNT(*) FROM document_chunks) > 0 THEN 'Document chunks table has data'
    ELSE 'Document chunks table is empty'
  END as chunks_status,
  CASE 
    WHEN (SELECT COUNT(*) FROM pg_indexes WHERE tablename IN ('documents', 'document_chunks')) > 0 THEN 'Indexes are present'
    ELSE 'No indexes found'
  END as indexes_status;

SELECT 'Final verification completed successfully' as status, NOW() as timestamp;
