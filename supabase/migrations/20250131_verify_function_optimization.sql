-- 검색 함수 최적화 상태 확인 쿼리
-- 마이그레이션 실행 전/후 상태 확인용

-- 1. 함수 존재 및 파라미터 확인
SELECT 
  proname as function_name,
  CASE 
    WHEN provolatile = 'i' THEN 'IMMUTABLE'
    WHEN provolatile = 's' THEN 'STABLE'
    WHEN provolatile = 'v' THEN 'VOLATILE'
    ELSE 'UNKNOWN'
  END as volatility,
  proisstrict as is_strict,
  pronargs as parameter_count,
  pg_get_function_arguments(oid) as parameters,
  pg_get_functiondef(oid) as function_definition
FROM pg_proc 
WHERE proname = 'search_documents'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY proname;

-- 2. 함수 시그니처별 상세 정보
SELECT 
  p.proname as function_name,
  CASE 
    WHEN p.provolatile = 'i' THEN 'IMMUTABLE'
    WHEN p.provolatile = 's' THEN 'STABLE'
    WHEN p.provolatile = 'v' THEN 'VOLATILE'
    ELSE 'UNKNOWN'
  END as volatility,
  p.proisstrict as is_strict,
  pg_catalog.pg_get_function_result(p.oid) as return_type,
  pg_catalog.pg_get_function_arguments(p.oid) as arguments
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'search_documents';

-- 3. 함수 정의 전체 확인
SELECT pg_get_functiondef(oid) as full_definition
FROM pg_proc
WHERE proname = 'search_documents'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
LIMIT 1;

