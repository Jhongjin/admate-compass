-- 전홍진 사용자 (woolela@nasmedia.co.kr) 추가 - 간단 버전
-- Supabase Dashboard의 SQL Editor에서 실행하세요

-- 1. 기존 woolela 사용자 정리
DELETE FROM auth.users WHERE email = 'woolela@nasmedia.co.kr';
DELETE FROM profiles WHERE email = 'woolela@nasmedia.co.kr';
DELETE FROM admin_users WHERE email = 'woolela@nasmedia.co.kr';

-- 2. 새 woolela 사용자 생성
-- 2-1. 프로필 생성 (임시 ID 사용)
INSERT INTO profiles (
    id,
    email,
    name,
    created_at,
    updated_at
) VALUES (
    gen_random_uuid(), -- 새로운 UUID 생성
    'woolela@nasmedia.co.kr',
    '전홍진',
    NOW(),
    NOW()
);

-- 2-2. 생성된 프로필 ID 확인
SELECT 
    id,
    email,
    name,
    created_at
FROM profiles 
WHERE email = 'woolela@nasmedia.co.kr';

-- 3. 관리자 권한 부여 (위에서 확인한 ID 사용)
-- 주의: 위 쿼리 결과의 ID를 복사하여 아래 쿼리의 'YOUR_PROFILE_ID' 부분을 교체하세요
INSERT INTO admin_users (
    user_id,
    email,
    is_active,
    granted_at
) VALUES (
    'YOUR_PROFILE_ID', -- 위에서 확인한 프로필 ID로 교체
    'woolela@nasmedia.co.kr',
    true,
    NOW()
);

-- 4. 생성 결과 확인
SELECT 
    '프로필' as type,
    p.id,
    p.email,
    p.name,
    p.created_at
FROM profiles p
WHERE p.email = 'woolela@nasmedia.co.kr'

UNION ALL

SELECT 
    '관리자 권한' as type,
    au.user_id,
    au.email,
    '관리자' as name,
    au.granted_at
FROM admin_users au
WHERE au.email = 'woolela@nasmedia.co.kr';
