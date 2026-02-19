-- 안전한 데이터베이스 상태 분석 (2025-01-20)
-- 타임아웃을 방지하기 위한 단계별 분석

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

-- 3. 테이블 크기 및 행 수 확인 (안전한 방식)
-- documents 테이블 정보
SELECT 
  'documents table info' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content_count,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content_count,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as special_chars_count
FROM documents;

-- document_chunks 테이블 정보
SELECT 
  'document_chunks table info' as table_name,
  COUNT(*) as total_rows,
  COUNT(CASE WHEN content IS NULL THEN 1 END) as null_content_count,
  COUNT(CASE WHEN content = '' THEN 1 END) as empty_content_count,
  COUNT(CASE WHEN content ~ '[^\x20-\x7E]' THEN 1 END) as special_chars_count
FROM document_chunks;

-- 4. 인덱스 상태 확인
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY tablename, indexname;

-- 5. 테이블 통계 정보 확인
SELECT 
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
WHERE tablename IN ('documents', 'document_chunks');

-- 6. 깨진 데이터 샘플 확인 (제한된 결과)
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

-- 7. 데이터베이스 연결 및 성능 정보
SELECT 
  'Database performance info' as info,
  datname,
  numbackends as active_connections,
  xact_commit as committed_transactions,
  xact_rollback as rolled_back_transactions
FROM pg_stat_database 
WHERE datname = current_database();
