-- pg_net 확장 활성화 (Supabase 권장 방법)
-- pg_net은 Supabase에서 Edge Functions를 호출하는 데 권장되는 확장입니다
-- Created: 2025-02-02

-- pg_net 확장 활성화
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 주석 추가
COMMENT ON EXTENSION pg_net IS 
  'Supabase에서 Edge Functions를 호출하기 위한 네트워크 확장. HTTP 요청을 비동기로 처리합니다.';

