-- Auth 사용자 삭제 시 관련 데이터 자동 정리 트리거
-- 실행 날짜: 2025-01-25
-- 목적: Auth 사용자 삭제 시 CASCADE가 제대로 작동하지 않는 문제 해결

-- 1. 현재 외래키 제약조건 확인
SELECT 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
WHERE constraint_type = 'FOREIGN KEY' 
    AND ccu.table_name = 'users'
    AND ccu.table_schema = 'auth';

-- 2. Auth 사용자 삭제 시 관련 데이터 정리 함수 생성
CREATE OR REPLACE FUNCTION cleanup_user_data_on_auth_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- 로그 기록
    RAISE LOG 'Auth 사용자 삭제 감지: %', OLD.id;
    
    -- 1. admin_users 테이블에서 삭제
    DELETE FROM admin_users WHERE user_id = OLD.id;
    RAISE LOG 'Admin 권한 삭제 완료: %', OLD.id;
    
    -- 2. conversations 테이블에서 삭제
    DELETE FROM conversations WHERE user_id = OLD.id;
    RAISE LOG 'Conversations 삭제 완료: %', OLD.id;
    
    -- 3. feedback 테이블에서 삭제
    DELETE FROM feedback WHERE user_id = OLD.id;
    RAISE LOG 'Feedback 삭제 완료: %', OLD.id;
    
    -- 4. profiles 테이블에서 삭제 (CASCADE가 작동하지 않는 경우를 대비)
    DELETE FROM profiles WHERE id = OLD.id;
    RAISE LOG 'Profile 삭제 완료: %', OLD.id;
    
    -- 5. messages 테이블이 존재하는 경우 삭제
    BEGIN
        DELETE FROM messages WHERE user_id = OLD.id;
        RAISE LOG 'Messages 삭제 완료: %', OLD.id;
    EXCEPTION
        WHEN undefined_table THEN
            RAISE LOG 'Messages 테이블이 존재하지 않음: %', OLD.id;
    END;
    
    RETURN OLD;
EXCEPTION
    WHEN OTHERS THEN
        -- 에러 발생 시에도 로그를 남기고 계속 진행
        RAISE LOG '사용자 데이터 정리 중 오류 발생: % - %', OLD.id, SQLERRM;
        RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Auth 사용자 삭제 트리거 생성
DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
CREATE TRIGGER on_auth_user_deleted
    BEFORE DELETE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_user_data_on_auth_delete();

-- 4. 기존 고아 데이터 정리 (woolela@nasmedia.co.kr)
-- 4-1. woolela@nasmedia.co.kr의 고아 데이터 삭제
DELETE FROM admin_users 
WHERE user_id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2' 
   OR email = 'woolela@nasmedia.co.kr';

DELETE FROM profiles 
WHERE id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2' 
   OR email = 'woolela@nasmedia.co.kr';

DELETE FROM conversations 
WHERE user_id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2';

DELETE FROM feedback 
WHERE user_id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2';

-- 4-2. 정리 후 상태 확인
SELECT 'Admin Users' as table_name, COUNT(*) as count 
FROM admin_users 
WHERE user_id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2' 
   OR email = 'woolela@nasmedia.co.kr'

UNION ALL

SELECT 'Profiles' as table_name, COUNT(*) as count 
FROM profiles 
WHERE id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2' 
   OR email = 'woolela@nasmedia.co.kr'

UNION ALL

SELECT 'Conversations' as table_name, COUNT(*) as count 
FROM conversations 
WHERE user_id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2'

UNION ALL

SELECT 'Feedback' as table_name, COUNT(*) as count 
FROM feedback 
WHERE user_id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2';

-- 5. 외래키 제약조건 강화 (이미 CASCADE로 설정되어 있지만 확인)
-- profiles 테이블 외래키 확인 및 재생성
DO $$
BEGIN
    -- 기존 외래키 제약조건 삭제
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
    
    -- CASCADE 삭제로 외래키 제약조건 재생성
    ALTER TABLE profiles 
    ADD CONSTRAINT profiles_id_fkey 
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    
    RAISE NOTICE 'Profiles 테이블 외래키 제약조건 재생성 완료';
END $$;

-- admin_users 테이블 외래키 확인 및 재생성
DO $$
BEGIN
    -- 기존 외래키 제약조건 삭제
    ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_user_id_fkey;
    
    -- CASCADE 삭제로 외래키 제약조건 재생성
    ALTER TABLE admin_users 
    ADD CONSTRAINT admin_users_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    
    RAISE NOTICE 'Admin_users 테이블 외래키 제약조건 재생성 완료';
END $$;

-- conversations 테이블 외래키 확인 및 재생성
DO $$
BEGIN
    -- 기존 외래키 제약조건 삭제
    ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_user_id_fkey;
    
    -- CASCADE 삭제로 외래키 제약조건 재생성
    ALTER TABLE conversations 
    ADD CONSTRAINT conversations_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    
    RAISE NOTICE 'Conversations 테이블 외래키 제약조건 재생성 완료';
END $$;

-- feedback 테이블 외래키 확인 및 재생성
DO $$
BEGIN
    -- 기존 외래키 제약조건 삭제
    ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_user_id_fkey;
    
    -- CASCADE 삭제로 외래키 제약조건 재생성
    ALTER TABLE feedback 
    ADD CONSTRAINT feedback_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    
    RAISE NOTICE 'Feedback 테이블 외래키 제약조건 재생성 완료';
END $$;

-- 6. 최종 상태 확인
SELECT 
    'Migration 완료' as status,
    NOW() as timestamp,
    'Auth 사용자 삭제 시 자동 정리 트리거가 설정되었습니다.' as message;











