-- RLS 정책 성능 분석 및 최적화 확인 쿼리
-- 작성일: 2025-01-31
-- 목적: RLS 정책 성능 모니터링 및 최적화 포인트 파악

-- 1. 현재 RLS 정책 목록 조회
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 2. RLS가 활성화된 테이블 목록
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = true
ORDER BY tablename;

-- 3. 각 테이블의 RLS 정책 개수
SELECT 
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY policy_count DESC;

-- 4. 복잡한 RLS 정책 식별 (qual 또는 with_check에 함수 호출이 있는 경우)
SELECT 
  schemaname,
  tablename,
  policyname,
  cmd,
  CASE 
    WHEN qual LIKE '%(%' OR qual LIKE '%.%' THEN '복잡한 조건'
    WHEN with_check LIKE '%(%' OR with_check LIKE '%.%' THEN '복잡한 검사'
    ELSE '단순 조건'
  END as complexity,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual LIKE '%(%' OR qual LIKE '%.%' OR with_check LIKE '%(%' OR with_check LIKE '%.%')
ORDER BY tablename, policyname;

-- 5. 인덱스와 호환되지 않을 수 있는 RLS 정책 확인
-- (서브쿼리나 함수 호출이 있는 경우)
SELECT 
  p.tablename,
  p.policyname,
  p.cmd,
  p.qual,
  CASE 
    WHEN p.qual LIKE '%SELECT%' THEN '서브쿼리 포함 가능'
    WHEN p.qual LIKE '%EXISTS%' THEN 'EXISTS 서브쿼리'
    WHEN p.qual LIKE '%IN%' THEN 'IN 서브쿼리'
    ELSE '단순 조건'
  END as potential_issue
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND (p.qual LIKE '%SELECT%' OR p.qual LIKE '%EXISTS%' OR p.qual LIKE '%IN%')
ORDER BY p.tablename, p.policyname;

-- 6. RLS 정책 성능 통계 (PostgreSQL 13+)
-- 실제 사용되는 정책과 사용 빈도 확인
SELECT 
  schemaname,
  tablename,
  policyname,
  total_checks,
  total_checks_time
FROM pg_stat_user_policies
WHERE schemaname = 'public'
ORDER BY total_checks DESC;

-- 7. 인덱스가 있는 컬럼을 사용하는 RLS 정책 확인
-- (성능 최적화 가능한 정책)
SELECT 
  p.tablename,
  p.policyname,
  p.cmd,
  p.qual,
  i.indexname,
  i.indexdef
FROM pg_policies p
LEFT JOIN pg_indexes i ON i.tablename = p.tablename
WHERE p.schemaname = 'public'
  AND p.qual IS NOT NULL
  AND (
    -- 인덱스가 있는 컬럼을 사용하는 정책 식별
    (p.qual LIKE '%document_id%' AND EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE tablename = p.tablename 
      AND indexdef LIKE '%document_id%'
    ))
    OR
    (p.qual LIKE '%user_id%' AND EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE tablename = p.tablename 
      AND indexdef LIKE '%user_id%'
    ))
    OR
    (p.qual LIKE '%status%' AND EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE tablename = p.tablename 
      AND indexdef LIKE '%status%'
    ))
  )
ORDER BY p.tablename, p.policyname;

-- 8. RLS 정책 최적화 권장사항
-- 불필요하거나 중복된 정책 식별
SELECT 
  tablename,
  policyname,
  cmd,
  CASE 
    WHEN cmd = 'ALL' THEN '모든 작업에 적용 (최적화 가능)'
    WHEN cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') THEN '특정 작업만 (최적)'
    ELSE '정상'
  END as optimization_suggestion
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

