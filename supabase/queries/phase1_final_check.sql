-- Phase 1 최종 확인 쿼리
-- 모든 항목이 완료되었는지 최종 확인합니다

-- ============================================
-- 종합 확인 결과
-- ============================================
SELECT 
  'Phase 1 인프라 완료 확인' AS check_summary,
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
    WHEN (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document_splits') = 13 
    THEN '✅'
    ELSE '❌'
  END AS has_all_columns,
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
    WHEN (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'document_splits' AND schemaname = 'public') >= 3 
    THEN '✅'
    ELSE '❌'
  END AS has_indexes,
  CASE 
    WHEN EXISTS (
      SELECT FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename = 'document_splits'
      AND rowsecurity = true
    ) THEN '✅'
    ELSE '❌'
  END AS rls_enabled;

-- ============================================
-- 상세 확인: 모든 항목 개별 확인
-- ============================================

-- 1. CHUNK_PROCESS job 타입
SELECT 
  '1. CHUNK_PROCESS job 타입' AS check_item,
  CASE 
    WHEN EXISTS (
      SELECT FROM pg_constraint 
      WHERE conrelid = 'public.processing_jobs'::regclass
      AND conname = 'processing_jobs_job_type_check'
      AND pg_get_constraintdef(oid) LIKE '%CHUNK_PROCESS%'
    ) THEN '✅ 완료'
    ELSE '❌ 누락 - 마이그레이션 필요'
  END AS status,
  COALESCE(
    (SELECT pg_get_constraintdef(oid) 
     FROM pg_constraint 
     WHERE conrelid = 'public.processing_jobs'::regclass
     AND conname = 'processing_jobs_job_type_check'),
    '제약조건 없음'
  ) AS constraint_definition;

-- 2. document_splits 테이블 컬럼 수
SELECT 
  '2. document_splits 테이블 컬럼' AS check_item,
  COUNT(*) AS column_count,
  CASE 
    WHEN COUNT(*) = 13 THEN '✅ 완료 (13개)'
    ELSE '❌ 불완전 (' || COUNT(*) || '개)'
  END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'document_splits';

-- 3. documents.split_status 컬럼
SELECT 
  '3. documents.split_status 컬럼' AS check_item,
  CASE 
    WHEN EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'split_status'
    ) THEN '✅ 완료'
    ELSE '❌ 누락 - 마이그레이션 필요'
  END AS status,
  COALESCE(
    (SELECT data_type 
     FROM information_schema.columns
     WHERE table_schema = 'public'
     AND table_name = 'documents'
     AND column_name = 'split_status'),
    '컬럼 없음'
  ) AS data_type;

-- 4. 인덱스 확인
SELECT 
  '4. document_splits 인덱스' AS check_item,
  COUNT(*) AS index_count,
  CASE 
    WHEN COUNT(*) >= 3 THEN '✅ 완료 (' || COUNT(*) || '개)'
    ELSE '❌ 불완전 (' || COUNT(*) || '개)'
  END AS status,
  string_agg(indexname, ', ' ORDER BY indexname) AS index_names
FROM pg_indexes
WHERE tablename = 'document_splits'
  AND schemaname = 'public';

-- 5. RLS 활성화
SELECT 
  '5. RLS 활성화' AS check_item,
  CASE 
    WHEN EXISTS (
      SELECT FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename = 'document_splits'
      AND rowsecurity = true
    ) THEN '✅ 완료'
    ELSE '❌ 비활성화'
  END AS status;

