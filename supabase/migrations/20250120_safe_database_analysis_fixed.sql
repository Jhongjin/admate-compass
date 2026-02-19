-- 안전한 데이터베이스 상태 분석 (수정된 버전) (2025-01-20)
-- PostgreSQL 버전 호환성 문제 해결

-- 1. 메모리 설정 확인 및 최적화
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '300s'; -- 5분 타임아웃 설정

-- 2. 현재 메모리 설정 확인
SELECT 
  'Current memory settings' as info,
  name, 
  setting, 
  unit,
  context
FROM pg_settings 
WHERE name IN ('maintenance_work_mem', 'work_mem', 'shared_buffers', 'statement_timeout');

-- 3. 테이블 존재 여부 확인
SELECT 
  'Table existence check' as info,
  table_name,
  CASE 
    WHEN table_name = 'documents' THEN 
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'documents')
    WHEN table_name = 'document_chunks' THEN 
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'document_chunks')
  END as exists
FROM (VALUES ('documents'), ('document_chunks')) AS t(table_name);

-- 4. documents 테이블 정보 (안전한 방식)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'documents') THEN
        -- documents 테이블이 존재하는 경우에만 실행
        RAISE NOTICE 'Documents table exists, analyzing...';
    ELSE
        RAISE NOTICE 'Documents table does not exist';
    END IF;
END $$;

-- documents 테이블 기본 정보
SELECT 
  'documents table info' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content_count,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content_count,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as special_chars_count
FROM documents;

-- 5. document_chunks 테이블 정보 (안전한 방식)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_chunks') THEN
        -- document_chunks 테이블이 존재하는 경우에만 실행
        RAISE NOTICE 'Document_chunks table exists, analyzing...';
    ELSE
        RAISE NOTICE 'Document_chunks table does not exist';
    END IF;
END $$;

-- document_chunks 테이블 기본 정보
SELECT 
  'document_chunks table info' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content_count,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content_count,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as special_chars_count
FROM document_chunks;

-- 6. 인덱스 상태 확인 (안전한 방식)
SELECT 
  'Index information' as info,
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY schemaname, tablename, indexname;

-- 7. 테이블 통계 정보 확인 (안전한 방식)
SELECT 
  'Table statistics' as info,
  schemaname,
  tablename,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes,
  n_live_tup as live_tuples,
  n_dead_tup as dead_tuples,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY schemaname, tablename;

-- 8. 깨진 데이터 샘플 확인 (제한된 결과)
-- documents 테이블 샘플
SELECT 
  'documents sample' as source,
  id,
  LEFT(title, 50) as title_preview,
  LEFT(content, 100) as content_preview,
  CASE 
    WHEN content ~ '[^\x20-\x7E]' THEN 'Has special chars'
    ELSE 'Clean'
  END as status
FROM documents
WHERE content ~ '[^\x20-\x7E]'
LIMIT 3;

-- document_chunks 테이블 샘플
SELECT 
  'document_chunks sample' as source,
  chunk_id,
  LEFT(content, 100) as content_preview,
  CASE 
    WHEN content ~ '[^\x20-\x7E]' THEN 'Has special chars'
    ELSE 'Clean'
  END as status
FROM document_chunks
WHERE content ~ '[^\x20-\x7E]'
LIMIT 3;

-- 9. 데이터베이스 연결 및 성능 정보
SELECT 
  'Database performance info' as info,
  datname,
  numbackends as active_connections,
  xact_commit as committed_transactions,
  xact_rollback as rolled_back_transactions
FROM pg_stat_database 
WHERE datname = current_database();

-- 10. PostgreSQL 버전 정보
SELECT 
  'PostgreSQL version' as info,
  version() as version_string;

-- 11. 현재 데이터베이스 크기
SELECT 
  'Database size' as info,
  pg_size_pretty(pg_database_size(current_database())) as database_size;

-- 12. 테이블 크기 정보
SELECT 
  'Table sizes' as info,
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY schemaname, tablename;
