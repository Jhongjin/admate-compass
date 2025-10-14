-- woolela@nasmedia.co.kr 중복 문제 해결
-- Supabase Dashboard의 SQL Editor에서 실행하세요

-- 1. 현재 상태 확인
SELECT 
    '현재 상태' as type,
    au.id as auth_id,
    p.id as profile_id,
    au.email,
    CASE 
        WHEN au.id = p.id THEN 'ID 일치'
        ELSE 'ID 불일치'
    END as status
FROM auth.users au
LEFT JOIN profiles p ON au.email = p.email
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 2. 해결 방법: 기존 프로필 삭제 후 새로 생성
-- 2-1. 기존 프로필 삭제
DELETE FROM profiles WHERE email = 'woolela@nasmedia.co.kr';

-- 2-2. 새 프로필 생성
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

-- 3. 결과 확인
SELECT 
    '수정 후 상태' as type,
    au.id as auth_id,
    p.id as profile_id,
    au.email,
    p.name,
    CASE 
        WHEN au.id = p.id THEN 'ID 일치 - 정상'
        ELSE 'ID 불일치 - 문제 있음'
    END as status
FROM auth.users au
LEFT JOIN profiles p ON au.email = p.email
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 4. 전체 상태 확인
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
