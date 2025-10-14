-- woolela@nasmedia.co.kr 완전 정리 SQL
-- Auth 사용자는 이미 삭제되었으므로 Profile과 Admin 권한만 삭제

-- 1. woolela@nasmedia.co.kr의 Admin 권한 삭제
DELETE FROM admin_users 
WHERE user_id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2' 
   OR email = 'woolela@nasmedia.co.kr';

-- 2. woolela@nasmedia.co.kr의 Profile 삭제
DELETE FROM profiles 
WHERE id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2' 
   OR email = 'woolela@nasmedia.co.kr';

-- 3. 관련 데이터 삭제 (혹시 남아있을 수 있는)
DELETE FROM conversations 
WHERE user_id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2';

DELETE FROM feedback 
WHERE user_id = '6e9906b2-6e93-42ed-ad66-d47d626f8fc2';

-- 4. 삭제 후 확인
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
