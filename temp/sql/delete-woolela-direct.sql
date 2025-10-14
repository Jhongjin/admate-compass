-- woolela@nasmedia.co.kr 직접 삭제
-- 1. 관리자 권한 삭제 (있다면)
DELETE FROM admin_users WHERE email = 'woolela@nasmedia.co.kr';

-- 2. 프로필 삭제
DELETE FROM profiles WHERE email = 'woolela@nasmedia.co.kr';

-- 3. Auth 사용자 삭제
DELETE FROM auth.users WHERE email = 'woolela@nasmedia.co.kr';

