-- 데이터베이스 테이블 구조 확인
-- Supabase Dashboard의 SQL Editor에서 실행하세요

-- 1. 모든 테이블 목록 확인
SELECT 
    schemaname,
    tablename,
    tableowner
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- 2. 사용자 관련 테이블 확인
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
AND table_name IN ('profiles', 'admin_users', 'conversations', 'feedback', 'messages')
ORDER BY table_name, ordinal_position;

-- 3. 외래키 제약조건 확인
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_schema = 'public'
AND (tc.table_name IN ('profiles', 'admin_users', 'conversations', 'feedback', 'messages')
     OR ccu.table_name = 'profiles')
ORDER BY tc.table_name;
