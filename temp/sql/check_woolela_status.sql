-- woolela@nasmedia.co.kr 상태 확인 쿼리
-- Supabase Dashboard의 SQL Editor에서 실행하세요

-- 1. Auth 사용자 확인
SELECT 
    'Auth 사용자' as type,
    au.id,
    au.email,
    au.created_at,
    au.email_confirmed_at,
    au.last_sign_in_at
FROM auth.users au
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 2. 프로필 확인
SELECT 
    '프로필' as type,
    p.id,
    p.email,
    p.name,
    p.created_at,
    p.updated_at
FROM profiles p
WHERE p.email = 'woolela@nasmedia.co.kr';

-- 3. 관리자 권한 확인
SELECT 
    '관리자 권한' as type,
    au.user_id,
    au.email,
    au.is_active,
    au.granted_at
FROM admin_users au
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 4. ID 매칭 확인
SELECT 
    'ID 매칭' as type,
    au.id as auth_id,
    p.id as profile_id,
    CASE 
        WHEN au.id = p.id THEN '일치'
        ELSE '불일치'
    END as match_status
FROM auth.users au
LEFT JOIN profiles p ON au.email = p.email
WHERE au.email = 'woolela@nasmedia.co.kr';
