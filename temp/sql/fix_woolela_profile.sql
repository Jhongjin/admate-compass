-- woolela@nasmedia.co.kr 프로필 생성 쿼리
-- Supabase Dashboard의 SQL Editor에서 실행하세요

-- 1. woolela 사용자 확인
SELECT 
    'Auth 사용자' as type,
    au.id,
    au.email,
    au.created_at,
    au.email_confirmed_at
FROM auth.users au
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 2. 기존 프로필 확인
SELECT 
    '기존 프로필' as type,
    p.id,
    p.email,
    p.name,
    p.created_at
FROM profiles p
WHERE p.email = 'woolela@nasmedia.co.kr';

-- 3. 프로필 생성
INSERT INTO profiles (
    id,
    email,
    name,
    created_at,
    updated_at
) VALUES (
    'f93acd33-61c4-4f22-8766-6adabd5f9f18', -- woolela의 Auth 사용자 ID
    'woolela@nasmedia.co.kr',
    '전홍진',
    NOW(),
    NOW()
);

-- 4. 생성 결과 확인
SELECT 
    '새 프로필' as type,
    p.id,
    p.email,
    p.name,
    p.created_at
FROM profiles p
WHERE p.email = 'woolela@nasmedia.co.kr';

-- 5. 전체 상태 확인
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
