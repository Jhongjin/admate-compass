-- woolela@nasmedia.co.kr 중복 이메일 문제 해결
-- Supabase Dashboard의 SQL Editor에서 실행하세요

-- 1. 현재 상태 확인
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
WHERE p.email = 'woolela@nasmedia.co.kr';

-- 2. 해결 방법 1: 기존 프로필의 ID를 Auth 사용자 ID로 업데이트
-- 주의: 이 방법은 기존 프로필의 ID를 변경합니다
UPDATE profiles 
SET id = 'f93acd33-61c4-4f22-8766-6adabd5f9f18'  -- woolela의 Auth 사용자 ID
WHERE email = 'woolela@nasmedia.co.kr'
AND id != 'f93acd33-61c4-4f22-8766-6adabd5f9f18';

-- 3. 해결 방법 2: 기존 프로필 삭제 후 새로 생성 (방법 1이 실패한 경우)
-- 주의: 이 방법은 기존 프로필을 삭제합니다
/*
DELETE FROM profiles WHERE email = 'woolela@nasmedia.co.kr';

INSERT INTO profiles (
    id,
    email,
    name,
    created_at,
    updated_at
) VALUES (
    'f93acd33-61c4-4f22-8766-6adabd5f9f18',
    'woolela@nasmedia.co.kr',
    '전홍진',
    NOW(),
    NOW()
);
*/

-- 4. 해결 방법 3: 기존 프로필의 이름 업데이트 (ID가 이미 일치하는 경우)
UPDATE profiles 
SET name = '전홍진',
    updated_at = NOW()
WHERE email = 'woolela@nasmedia.co.kr'
AND id = 'f93acd33-61c4-4f22-8766-6adabd5f9f18';

-- 5. 결과 확인
SELECT 
    '수정된 프로필' as type,
    p.id,
    p.email,
    p.name,
    p.created_at,
    p.updated_at
FROM profiles p
WHERE p.email = 'woolela@nasmedia.co.kr';

-- 6. 전체 상태 확인
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
