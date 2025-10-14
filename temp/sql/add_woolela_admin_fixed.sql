-- woolela@nasmedia.co.kr을 관리자로 변경하는 SQL 쿼리 (수정된 버전)
-- 실행 날짜: 2025-09-25
-- 목적: woolela@nasmedia.co.kr 사용자를 admin_users 테이블에 추가

-- 1. woolela@nasmedia.co.kr 사용자 ID 확인
SELECT 
    id,
    email,
    created_at,
    email_confirmed_at
FROM auth.users 
WHERE email = 'woolela@nasmedia.co.kr';

-- 2. 현재 admin_users 테이블 상태 확인
SELECT 
    id,
    user_id,
    email,
    is_active,
    created_at
FROM admin_users 
WHERE email = 'woolela@nasmedia.co.kr';

-- 3. woolela@nasmedia.co.kr을 관리자로 추가 (단계별 실행)
-- 3-1. 먼저 사용자 ID를 변수로 저장
DO $$
DECLARE
    woolela_user_id UUID;
BEGIN
    -- 사용자 ID 조회
    SELECT id INTO woolela_user_id 
    FROM auth.users 
    WHERE email = 'woolela@nasmedia.co.kr';
    
    -- 사용자가 존재하는 경우에만 관리자 권한 부여
    IF woolela_user_id IS NOT NULL THEN
        -- 관리자 권한 추가 (중복 시 업데이트)
        INSERT INTO admin_users (user_id, email, is_active, granted_at, created_at, updated_at)
        VALUES (woolela_user_id, 'woolela@nasmedia.co.kr', true, NOW(), NOW(), NOW())
        ON CONFLICT (email) 
        DO UPDATE SET
            is_active = true,
            updated_at = NOW();
            
        RAISE NOTICE 'woolela@nasmedia.co.kr 관리자 권한이 부여되었습니다. User ID: %', woolela_user_id;
    ELSE
        RAISE NOTICE 'woolela@nasmedia.co.kr 사용자를 찾을 수 없습니다.';
    END IF;
END $$;

-- 4. 관리자 권한 추가 후 상태 확인
SELECT 
    au.id as auth_user_id,
    au.email as auth_email,
    au.email_confirmed_at,
    admin_au.user_id,
    admin_au.email as admin_email,
    admin_au.is_active as admin_active,
    admin_au.created_at as admin_created_at
FROM auth.users au
LEFT JOIN admin_users admin_au ON admin_au.user_id = au.id
WHERE au.email = 'woolela@nasmedia.co.kr';

-- 5. 최종 확인 - 관리자 권한이 정상적으로 부여되었는지 확인
SELECT 
    'woolela@nasmedia.co.kr 관리자 권한 부여 완료' as status,
    NOW() as timestamp,
    'admin_users 테이블에 추가되었습니다.' as message;
