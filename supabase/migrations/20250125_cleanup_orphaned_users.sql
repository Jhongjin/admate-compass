-- 고아 사용자 정리 마이그레이션
-- 실행 날짜: 2025-01-25
-- 목적: Auth 사용자는 있지만 프로필이 없는 고아 사용자들을 정리

-- 1. 고아 Auth 사용자 확인 쿼리
-- Auth 사용자는 있지만 profiles 테이블에 없는 사용자들을 조회
SELECT 
    au.id,
    au.email,
    au.created_at,
    au.email_confirmed_at,
    au.last_sign_in_at
FROM auth.users au
LEFT JOIN profiles p ON au.id = p.id
WHERE p.id IS NULL;

-- 2. 고아 프로필 확인 쿼리  
-- profiles 테이블에는 있지만 auth.users에 없는 사용자들을 조회
SELECT 
    p.id,
    p.email,
    p.name,
    p.created_at
FROM profiles p
LEFT JOIN auth.users au ON p.id = au.id
WHERE au.id IS NULL;

-- 3. 고아 사용자의 관련 데이터 삭제 (안전한 순서로)
-- 주의: 이 쿼리들은 실제 삭제를 수행합니다. 실행 전에 백업을 권장합니다.

-- 3-1. 고아 Auth 사용자의 관련 데이터 삭제
-- conversations 테이블에서 고아 사용자의 대화 기록 삭제
DELETE FROM conversations 
WHERE user_id IN (
    SELECT au.id
    FROM auth.users au
    LEFT JOIN profiles p ON au.id = p.id
    WHERE p.id IS NULL
);

-- 3-2. feedback 테이블에서 고아 사용자의 피드백 기록 삭제
DELETE FROM feedback 
WHERE user_id IN (
    SELECT au.id
    FROM auth.users au
    LEFT JOIN profiles p ON au.id = p.id
    WHERE p.id IS NULL
);

-- 3-3. messages 테이블에서 고아 사용자의 메시지 기록 삭제
DELETE FROM messages 
WHERE user_id IN (
    SELECT au.id
    FROM auth.users au
    LEFT JOIN profiles p ON au.id = p.id
    WHERE p.id IS NULL
);

-- 3-4. admin_users 테이블에서 고아 사용자의 관리자 권한 삭제
DELETE FROM admin_users 
WHERE user_id IN (
    SELECT au.id
    FROM auth.users au
    LEFT JOIN profiles p ON au.id = p.id
    WHERE p.id IS NULL
);

-- 4. 고아 Auth 사용자 삭제 (Supabase Auth에서)
-- 주의: 이 쿼리는 Supabase Dashboard의 SQL Editor에서 실행해야 합니다.
-- 또는 Supabase Admin API를 사용해야 합니다.

-- 4-1. 고아 Auth 사용자 목록 조회 (삭제 전 확인용)
SELECT 
    au.id,
    au.email,
    '고아 Auth 사용자' as status
FROM auth.users au
LEFT JOIN profiles p ON au.id = p.id
WHERE p.id IS NULL;

-- 4-2. 고아 프로필 삭제
DELETE FROM profiles 
WHERE id IN (
    SELECT p.id
    FROM profiles p
    LEFT JOIN auth.users au ON p.id = au.id
    WHERE au.id IS NULL
);

-- 5. 정리 후 상태 확인 쿼리
-- 5-1. 남은 고아 사용자 확인
SELECT 
    '고아 Auth 사용자' as type,
    COUNT(*) as count
FROM auth.users au
LEFT JOIN profiles p ON au.id = p.id
WHERE p.id IS NULL

UNION ALL

SELECT 
    '고아 프로필' as type,
    COUNT(*) as count
FROM profiles p
LEFT JOIN auth.users au ON p.id = au.id
WHERE au.id IS NULL;

-- 5-2. 전체 사용자 통계
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

-- 6. 특정 사용자 삭제 (예시: test@nasmedia.co.kr)
-- 6-1. 특정 사용자의 관련 데이터 삭제
DELETE FROM conversations WHERE user_id = '0c581eca-cbf6-4164-80fa-33112fb71d4f';
DELETE FROM feedback WHERE user_id = '0c581eca-cbf6-4164-80fa-33112fb71d4f';
DELETE FROM messages WHERE user_id = '0c581eca-cbf6-4164-80fa-33112fb71d4f';
DELETE FROM admin_users WHERE user_id = '0c581eca-cbf6-4164-80fa-33112fb71d4f';

-- 6-2. 특정 사용자 삭제 (Supabase Auth에서)
-- 이 쿼리는 Supabase Dashboard의 SQL Editor에서 실행하거나 Admin API 사용
-- DELETE FROM auth.users WHERE id = '0c581eca-cbf6-4164-80fa-33112fb71d4f';

-- 7. woolela@nasmedia.co.kr 사용자 정리 (예시)
-- 7-1. woolela 사용자의 관련 데이터 삭제
DELETE FROM conversations WHERE user_id = 'f93acd33-61c4-4f22-8766-6adabd5f9f18';
DELETE FROM feedback WHERE user_id = 'f93acd33-61c4-4f22-8766-6adabd5f9f18';
DELETE FROM messages WHERE user_id = 'f93acd33-61c4-4f22-8766-6adabd5f9f18';
DELETE FROM admin_users WHERE user_id = 'f93acd33-61c4-4f22-8766-6adabd5f9f18';

-- 7-2. woolela 사용자 삭제 (Supabase Auth에서)
-- 이 쿼리는 Supabase Dashboard의 SQL Editor에서 실행하거나 Admin API 사용
-- DELETE FROM auth.users WHERE id = 'f93acd33-61c4-4f22-8766-6adabd5f9f18';

-- 8. 실행 순서 안내
/*
실행 순서:
1. 먼저 1번과 2번 쿼리로 고아 사용자를 확인
2. 3번 쿼리들로 관련 데이터 삭제
3. 4번 쿼리로 고아 프로필 삭제
4. Supabase Dashboard에서 고아 Auth 사용자 삭제 (또는 Admin API 사용)
5. 5번 쿼리로 정리 후 상태 확인

주의사항:
- 실행 전에 반드시 데이터베이스 백업을 수행하세요
- Supabase Auth 사용자 삭제는 Dashboard의 SQL Editor에서 실행하거나 Admin API를 사용해야 합니다
- 외래키 제약조건을 고려하여 올바른 순서로 삭제하세요
*/
