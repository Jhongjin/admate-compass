-- woolela@nasmedia.co.kr 중복 문제 디버깅
-- Supabase Dashboard의 SQL Editor에서 실행하세요

-- 1. Auth 사용자 확인
SELECT 
    'Auth 사용자' as type,
    au.id,
    au.email,
    au.created_at,
    au.email_confirmed_at
FROM auth.users au
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 2. 프로필 확인 (모든 woolela 관련)
SELECT 
    '프로필' as type,
    p.id,
    p.email,
    p.name,
    p.created_at,
    p.updated_at
FROM profiles p
WHERE p.email = 'woolela@nasmedia.co.kr';

-- 3. ID 매칭 확인
SELECT 
    'ID 매칭' as type,
    au.id as auth_id,
    p.id as profile_id,
    CASE 
        WHEN au.id = p.id THEN '일치'
        ELSE '불일치'
    END as match_status,
    au.email
FROM auth.users au
LEFT JOIN profiles p ON au.email = p.email
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 4. 모든 woolela 관련 데이터 확인
SELECT 
    '전체 woolela 데이터' as type,
    'auth.users' as table_name,
    au.id,
    au.email,
    au.created_at
FROM auth.users au
WHERE au.email LIKE '%woolela%'

UNION ALL

SELECT 
    '전체 woolela 데이터' as type,
    'profiles' as table_name,
    p.id,
    p.email,
    p.created_at
FROM profiles p
WHERE p.email LIKE '%woolela%'

UNION ALL

SELECT 
    '전체 woolela 데이터' as type,
    'admin_users' as table_name,
    au.user_id,
    au.email,
    au.granted_at
FROM admin_users au
WHERE au.email LIKE '%woolela%';
