-- Phase 1 인프라 완전 확인 쿼리
-- 모든 항목을 한 번에 확인하여 Phase 1 완료 여부를 판단합니다

-- ============================================
-- 종합 확인 결과
-- ============================================
SELECT 
  'Phase 1 인프라 확인 결과' AS check_type,
  CASE 
    WHEN EXISTS (
      SELECT FROM pg_constraint 
      WHERE conrelid = 'public.processing_jobs'::regclass
      AND conname = 'processing_jobs_job_type_check'
      AND pg_get_constraintdef(oid) LIKE '%CHUNK_PROCESS%'
    ) THEN '✅'
    ELSE '❌'
  END AS chunk_process_job_type,
  CASE 
    WHEN EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'document_splits'
    ) THEN '✅'
    ELSE '❌'
  END AS document_splits_table,
  CASE 
    WHEN EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'split_status'
    ) THEN '✅'
    ELSE '❌'
  END AS split_status_column,
  CASE 
    WHEN EXISTS (
      SELECT FROM pg_indexes
      WHERE tablename = 'document_splits'
      AND schemaname = 'public'
      AND indexname = 'idx_document_splits_document_id'
    ) THEN '✅'
    ELSE '❌'
  END AS index_document_id,
  CASE 
    WHEN EXISTS (
      SELECT FROM pg_indexes
      WHERE tablename = 'document_splits'
      AND schemaname = 'public'
      AND indexname = 'idx_document_splits_status'
    ) THEN '✅'
    ELSE '❌'
  END AS index_status;

-- ============================================
-- 상세 확인 1: CHUNK_PROCESS job 타입
-- ============================================
SELECT 
  '1. CHUNK_PROCESS job 타입' AS check_item,
  CASE 
    WHEN EXISTS (
      SELECT FROM pg_constraint 
      WHERE conrelid = 'public.processing_jobs'::regclass
      AND conname = 'processing_jobs_job_type_check'
      AND pg_get_constraintdef(oid) LIKE '%CHUNK_PROCESS%'
    ) THEN '✅ 존재'
    ELSE '❌ 없음 - 마이그레이션 필요'
  END AS status,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.processing_jobs'::regclass
  AND conname = 'processing_jobs_job_type_check';

-- ============================================
-- 상세 확인 2: document_splits 테이블 구조
-- ============================================
SELECT 
  '2. document_splits 테이블 컬럼' AS check_item,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'document_splits'
ORDER BY ordinal_position;

-- ============================================
-- 상세 확인 3: documents.split_status 컬럼
-- ============================================
SELECT 
  '3. documents.split_status 컬럼' AS check_item,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'documents'
  AND column_name = 'split_status';

-- ============================================
-- 상세 확인 4: 인덱스
-- ============================================
SELECT 
  '4. document_splits 인덱스' AS check_item,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'document_splits'
  AND schemaname = 'public'
ORDER BY indexname;

-- ============================================
-- 상세 확인 5: RLS 상태
-- ============================================
SELECT 
  '5. RLS 활성화' AS check_item,
  tablename,
  CASE 
    WHEN rowsecurity THEN '✅ 활성화'
    ELSE '❌ 비활성화'
  END AS rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'document_splits';

