-- 고아 사용자 정리 - 간단 버전
-- Supabase Dashboard의 SQL Editor에서 실행하세요

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

-- 2. 고아 사용자의 관련 데이터 삭제
-- 주의: 존재하는 테이블만 삭제합니다

-- conversations 삭제 (테이블이 존재하는 경우)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'conversations') THEN
        DELETE FROM conversations 
        WHERE user_id IN (
            SELECT au.id
            FROM auth.users au
            LEFT JOIN profiles p ON au.id = p.id
            WHERE p.id IS NULL
        );
        RAISE NOTICE 'conversations 테이블에서 고아 사용자 데이터 삭제 완료';
    ELSE
        RAISE NOTICE 'conversations 테이블이 존재하지 않습니다';
    END IF;
END $$;

-- feedback 삭제 (테이블이 존재하는 경우)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'feedback') THEN
        DELETE FROM feedback 
        WHERE user_id IN (
            SELECT au.id
            FROM auth.users au
            LEFT JOIN profiles p ON au.id = p.id
            WHERE p.id IS NULL
        );
        RAISE NOTICE 'feedback 테이블에서 고아 사용자 데이터 삭제 완료';
    ELSE
        RAISE NOTICE 'feedback 테이블이 존재하지 않습니다';
    END IF;
END $$;

-- messages 삭제 (테이블이 존재하는 경우)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
        DELETE FROM messages 
        WHERE user_id IN (
            SELECT au.id
            FROM auth.users au
            LEFT JOIN profiles p ON au.id = p.id
            WHERE p.id IS NULL
        );
        RAISE NOTICE 'messages 테이블에서 고아 사용자 데이터 삭제 완료';
    ELSE
        RAISE NOTICE 'messages 테이블이 존재하지 않습니다';
    END IF;
END $$;

-- admin_users 삭제 (테이블이 존재하는 경우)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_users') THEN
        DELETE FROM admin_users 
        WHERE user_id IN (
            SELECT au.id
            FROM auth.users au
            LEFT JOIN profiles p ON au.id = p.id
            WHERE p.id IS NULL
        );
        RAISE NOTICE 'admin_users 테이블에서 고아 사용자 데이터 삭제 완료';
    ELSE
        RAISE NOTICE 'admin_users 테이블이 존재하지 않습니다';
    END IF;
END $$;

-- 3. 고아 프로필 삭제
DELETE FROM profiles 
WHERE id IN (
    SELECT p.id
    FROM profiles p
    LEFT JOIN auth.users au ON p.id = au.id
    WHERE au.id IS NULL
);

-- 4. 고아 Auth 사용자 삭제 (Supabase Dashboard에서만 실행 가능)
-- 주의: 이 쿼리는 Supabase Dashboard의 SQL Editor에서 실행해야 합니다
DELETE FROM auth.users 
WHERE id IN (
    SELECT au.id
    FROM auth.users au
    LEFT JOIN profiles p ON au.id = p.id
    WHERE p.id IS NULL
);

-- 5. 정리 후 확인
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
