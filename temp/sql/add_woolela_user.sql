-- 전홍진 사용자 (woolela@nasmedia.co.kr) 추가 쿼리
-- Supabase Dashboard의 SQL Editor에서 실행하세요

-- 1. 기존 woolela 사용자 확인
SELECT 
    '기존 Auth 사용자' as type,
    au.id,
    au.email,
    au.created_at
FROM auth.users au
WHERE au.email = 'woolela@nasmedia.co.kr'

UNION ALL

SELECT 
    '기존 프로필' as type,
    p.id,
    p.email,
    p.created_at
FROM profiles p
WHERE p.email = 'woolela@nasmedia.co.kr'

UNION ALL

SELECT 
    '기존 관리자 권한' as type,
    au.user_id,
    au.email,
    au.granted_at
FROM admin_users au
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 2. 기존 woolela 사용자 정리 (있다면)
-- Auth 사용자 삭제
DELETE FROM auth.users WHERE email = 'woolela@nasmedia.co.kr';

-- 프로필 삭제
DELETE FROM profiles WHERE email = 'woolela@nasmedia.co.kr';

-- 관리자 권한 삭제
DELETE FROM admin_users WHERE email = 'woolela@nasmedia.co.kr';

-- 3. 새 woolela 사용자 생성
-- 3-1. Auth 사용자 생성 (Supabase Dashboard에서 수동으로 진행해야 함)
-- 이 부분은 SQL로 직접 실행할 수 없으며, Supabase Dashboard의 Authentication 섹션에서 수동으로 사용자를 생성해야 합니다.
-- 또는 Supabase Admin API를 사용해야 합니다.

-- 3-2. 프로필 생성 (Auth 사용자 생성 후 실행)
-- 주의: Auth 사용자 ID를 확인한 후 실행하세요
INSERT INTO profiles (
    id,
    email,
    name,
    created_at,
    updated_at
) VALUES (
    'f93acd33-61c4-4f22-8766-6adabd5f9f18', -- Auth 사용자 ID (실제 ID로 변경 필요)
    'woolela@nasmedia.co.kr',
    '전홍진',
    NOW(),
    NOW()
);

-- 3-3. 관리자 권한 부여
INSERT INTO admin_users (
    user_id,
    email,
    is_active,
    granted_at
) VALUES (
    'f93acd33-61c4-4f22-8766-6adabd5f9f18', -- Auth 사용자 ID (실제 ID로 변경 필요)
    'woolela@nasmedia.co.kr',
    true,
    NOW()
);

-- 4. 생성 결과 확인
SELECT 
    '새 Auth 사용자' as type,
    au.id,
    au.email,
    au.created_at
FROM auth.users au
WHERE au.email = 'woolela@nasmedia.co.kr'

UNION ALL

SELECT 
    '새 프로필' as type,
    p.id,
    p.email,
    p.created_at
FROM profiles p
WHERE p.email = 'woolela@nasmedia.co.kr'

UNION ALL

SELECT 
    '새 관리자 권한' as type,
    au.user_id,
    au.email,
    au.granted_at
FROM admin_users au
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 5. 전체 사용자 통계 확인
SELECT 
    'Auth 사용자' as type,
    COUNT(*) as count
FROM auth.users

UNION ALL

SELECT 
    '프로필' as type,
    COUNT(*) as count
FROM profiles

UNION ALL

SELECT 
    '관리자' as type,
    COUNT(*) as count
FROM admin_users
WHERE is_active = true;
