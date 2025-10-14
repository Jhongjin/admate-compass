-- woolela@nasmedia.co.kr 관리자 권한 추가
-- Supabase Dashboard의 SQL Editor에서 실행하세요

-- 1. 현재 woolela 상태 확인
SELECT 
    'Auth 사용자' as type,
    au.id,
    au.email,
    au.created_at
FROM auth.users au
WHERE au.email = 'woolela@nasmedia.co.kr'

UNION ALL

SELECT 
    '프로필' as type,
    p.id,
    p.email,
    p.created_at
FROM profiles p
WHERE p.email = 'woolela@nasmedia.co.kr'

UNION ALL

SELECT 
    '관리자 권한' as type,
    au.user_id,
    au.email,
    au.granted_at
FROM admin_users au
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 2. woolela의 Auth 사용자 ID 확인
SELECT 
    au.id as auth_user_id,
    au.email,
    p.id as profile_id,
    CASE 
        WHEN au.id = p.id THEN 'ID 일치'
        ELSE 'ID 불일치'
    END as id_match_status
FROM auth.users au
LEFT JOIN profiles p ON au.email = p.email
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 3. 관리자 권한 추가 (프로필 ID 사용)
INSERT INTO admin_users (
    user_id,
    email,
    is_active,
    granted_at
) VALUES (
    (SELECT id FROM profiles WHERE email = 'woolela@nasmedia.co.kr'),
    'woolela@nasmedia.co.kr',
    true,
    NOW()
);

-- 4. 결과 확인
SELECT 
    '추가된 관리자 권한' as type,
    au.user_id,
    au.email,
    au.is_active,
    au.granted_at
FROM admin_users au
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 5. 전체 관리자 목록 확인
SELECT 
    '전체 관리자' as type,
    au.user_id,
    au.email,
    au.is_active,
    au.granted_at
FROM admin_users au
WHERE au.is_active = true
ORDER BY au.granted_at;
