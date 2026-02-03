-- document_splits 테이블 컬럼 확인 및 누락된 컬럼 체크

-- 현재 컬럼 확인
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default,
  ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'document_splits'
ORDER BY ordinal_position;

-- 필수 컬럼 목록 (9개)
-- 1. id (uuid, PRIMARY KEY)
-- 2. document_id (text, NOT NULL)
-- 3. split_index (integer, NOT NULL)
-- 4. split_count (integer, NOT NULL)
-- 5. content (text, NOT NULL)
-- 6. start_char (integer)
-- 7. end_char (integer)
-- 8. page_number (integer)
-- 9. section_title (text)
-- 10. status (text, NOT NULL)
-- 11. job_id (uuid)
-- 12. created_at (timestamptz)
-- 13. updated_at (timestamptz)

-- 실제로는 13개 컬럼이 필요 (id 포함)

-- 누락된 컬럼 확인
SELECT 
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'id') = 0 THEN '❌ id 누락'
    ELSE '✅ id 존재'
  END AS id_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'document_id') = 0 THEN '❌ document_id 누락'
    ELSE '✅ document_id 존재'
  END AS document_id_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'split_index') = 0 THEN '❌ split_index 누락'
    ELSE '✅ split_index 존재'
  END AS split_index_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'split_count') = 0 THEN '❌ split_count 누락'
    ELSE '✅ split_count 존재'
  END AS split_count_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'content') = 0 THEN '❌ content 누락'
    ELSE '✅ content 존재'
  END AS content_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'start_char') = 0 THEN '❌ start_char 누락'
    ELSE '✅ start_char 존재'
  END AS start_char_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'end_char') = 0 THEN '❌ end_char 누락'
    ELSE '✅ end_char 존재'
  END AS end_char_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'page_number') = 0 THEN '❌ page_number 누락'
    ELSE '✅ page_number 존재'
  END AS page_number_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'section_title') = 0 THEN '❌ section_title 누락'
    ELSE '✅ section_title 존재'
  END AS section_title_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'status') = 0 THEN '❌ status 누락'
    ELSE '✅ status 존재'
  END AS status_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'job_id') = 0 THEN '❌ job_id 누락'
    ELSE '✅ job_id 존재'
  END AS job_id_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'created_at') = 0 THEN '❌ created_at 누락'
    ELSE '✅ created_at 존재'
  END AS created_at_check,
  CASE 
    WHEN COUNT(*) FILTER (WHERE column_name = 'updated_at') = 0 THEN '❌ updated_at 누락'
    ELSE '✅ updated_at 존재'
  END AS updated_at_check,
  COUNT(*) AS total_columns
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'document_splits';

