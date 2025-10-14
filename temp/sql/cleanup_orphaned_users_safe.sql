-- 고아 사용자 정리 - 안전 버전
-- Supabase Dashboard의 SQL Editor에서 실행하세요
-- 테이블 존재 여부를 확인하고 안전하게 삭제합니다

-- 1. 현재 고아 사용자 확인
SELECT 
    '고아 Auth 사용자' as type,
    au.id,
    au.email,
    au.created_at
FROM auth.users au
LEFT JOIN profiles p ON au.id = p.id
WHERE p.id IS NULL

UNION ALL

SELECT 
    '고아 프로필' as type,
    p.id,
    p.email,
    p.created_at
FROM profiles p
LEFT JOIN auth.users au ON p.id = au.id
WHERE au.id IS NULL;

-- 2. 존재하는 테이블 확인
SELECT 
    table_name,
    '존재함' as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('conversations', 'feedback', 'messages', 'admin_users', 'profiles')
ORDER BY table_name;

-- 3. 고아 사용자의 관련 데이터 삭제 (안전한 방식)
-- conversations 테이블이 존재하는 경우에만 삭제
DELETE FROM conversations 
WHERE EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'conversations'
)
AND user_id IN (
    SELECT au.id
    FROM auth.users au
    LEFT JOIN profiles p ON au.id = p.id
    WHERE p.id IS NULL
);

-- feedback 테이블이 존재하는 경우에만 삭제
DELETE FROM feedback 
WHERE EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'feedback'
)
AND user_id IN (
    SELECT au.id
    FROM auth.users au
    LEFT JOIN profiles p ON au.id = p.id
    WHERE p.id IS NULL
);

-- admin_users 테이블이 존재하는 경우에만 삭제
DELETE FROM admin_users 
WHERE EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'admin_users'
)
AND user_id IN (
    SELECT au.id
    FROM auth.users au
    LEFT JOIN profiles p ON au.id = p.id
    WHERE p.id IS NULL
);

-- 4. 고아 프로필 삭제
DELETE FROM profiles 
WHERE id IN (
    SELECT p.id
    FROM profiles p
    LEFT JOIN auth.users au ON p.id = au.id
    WHERE au.id IS NULL
);

-- 5. 고아 Auth 사용자 삭제 (Supabase Dashboard에서만 실행 가능)
-- 주의: 이 쿼리는 Supabase Dashboard의 SQL Editor에서 실행해야 합니다
DELETE FROM auth.users 
WHERE id IN (
    SELECT au.id
    FROM auth.users au
    LEFT JOIN profiles p ON au.id = p.id
    WHERE p.id IS NULL
);

-- 6. 정리 후 확인
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
