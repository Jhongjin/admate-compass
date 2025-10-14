-- Service Role Key 권한 테스트
-- 1. Auth 사용자 목록 조회 테스트
SELECT COUNT(*) as auth_users_count FROM auth.users;

-- 2. Profiles 테이블 조회 테스트  
SELECT COUNT(*) as profiles_count FROM profiles;

-- 3. Admin Users 테이블 조회 테스트
SELECT COUNT(*) as admin_users_count FROM admin_users;

-- 4. 특정 사용자 삭제 테스트 (실제 삭제하지 않음)
-- DELETE FROM profiles WHERE email = 'test@example.com';
-- DELETE FROM auth.users WHERE email = 'test@example.com';

