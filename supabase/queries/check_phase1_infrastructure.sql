-- Phase 1 인프라 확인 쿼리
-- Supabase SQL Editor에서 실행하여 Phase 1 인프라 준비 상태를 확인하세요

-- ============================================
-- 1.1 CHUNK_PROCESS job 타입 확인
-- ============================================
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.processing_jobs'::regclass
  AND conname = 'processing_jobs_job_type_check';

-- 예상 결과: job_type IN ('OCR','PDF_PARSE','DOCX_PARSE','CRAWL','EMBEDDING','CHUNK_PROCESS')
-- CHUNK_PROCESS가 포함되어 있어야 함

-- ============================================
-- 1.2 document_splits 테이블 존재 확인
-- ============================================
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'document_splits'
) AS table_exists;

-- 예상 결과: true

-- ============================================
-- 1.3 document_splits 테이블 구조 확인
-- ============================================
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'document_splits'
ORDER BY ordinal_position;

-- 필수 컬럼 확인:
-- - id (uuid)
-- - document_id (text)
-- - split_index (integer)
-- - split_count (integer)
-- - content (text)
-- - status (text)
-- - job_id (uuid)
-- - created_at (timestamptz)
-- - updated_at (timestamptz)

-- ============================================
-- 1.4 document_splits CHECK 제약조건 확인
-- ============================================
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.document_splits'::regclass
  AND contype = 'c'; -- CHECK constraint

-- 예상 결과: status IN ('pending', 'processing', 'completed', 'failed')

-- ============================================
-- 1.5 document_splits 인덱스 확인
-- ============================================
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'document_splits'
  AND schemaname = 'public';

-- 필수 인덱스:
-- - idx_document_splits_document_id
-- - idx_document_splits_status
-- - idx_document_splits_job_id (선택)

-- ============================================
-- 1.6 documents.split_status 컬럼 확인
-- ============================================
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'documents'
  AND column_name = 'split_status';

-- 예상 결과: split_status (jsonb)

-- ============================================
-- 1.7 document_splits 외래 키 확인
-- ============================================
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'document_splits';

-- 예상 결과:
-- - document_id -> documents.id
-- - job_id -> processing_jobs.id

-- ============================================
-- 1.8 RLS (Row Level Security) 확인
-- ============================================
SELECT 
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'document_splits';

-- 예상 결과: rowsecurity = true

-- ============================================
-- 종합 확인 결과
-- ============================================
-- 모든 확인 항목이 정상이면 다음 결과를 기대:
-- ✅ CHUNK_PROCESS job 타입 존재
-- ✅ document_splits 테이블 존재
-- ✅ 필수 컬럼 모두 존재
-- ✅ CHECK 제약조건 존재
-- ✅ 필수 인덱스 존재
-- ✅ documents.split_status 컬럼 존재
-- ✅ 외래 키 제약조건 존재
-- ✅ RLS 활성화

