-- woolela@nasmedia.co.kr 현재 ID 확인
SELECT 'Auth Users' as table_name, id, email, created_at FROM auth.users WHERE email = 'woolela@nasmedia.co.kr'
UNION ALL
SELECT 'Profiles' as table_name, id, email, created_at FROM profiles WHERE email = 'woolela@nasmedia.co.kr'
UNION ALL
SELECT 'Admin Users' as table_name, user_id as id, email, granted_at FROM admin_users WHERE email = 'woolela@nasmedia.co.kr';

