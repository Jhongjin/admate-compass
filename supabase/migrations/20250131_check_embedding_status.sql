-- embedding 컬럼 및 인덱스 상태 확인 쿼리
-- 마이그레이션 실행 전/후 상태 확인용

-- 1. embedding 컬럼 타입 확인
SELECT 
  column_name,
  data_type,
  udt_name,
  character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'document_chunks'
  AND column_name = 'embedding';

-- 2. 모든 인덱스 확인 (벡터 인덱스 포함)
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'document_chunks'
  AND schemaname = 'public'
ORDER BY indexname;

-- 3. 벡터 관련 인덱스만 확인
SELECT 
  i.schemaname,
  i.tablename,
  i.indexname,
  am.amname as index_type, -- 'hnsw' 또는 'ivfflat'
  pg_size_pretty(pg_relation_size(c.oid)) as index_size
FROM pg_indexes i
JOIN pg_class c ON c.relname = i.indexname
JOIN pg_am am ON am.oid = c.relam
WHERE i.tablename = 'document_chunks'
  AND i.schemaname = 'public'
  AND (i.indexname LIKE '%embedding%' OR am.amname IN ('hnsw', 'ivfflat'))
ORDER BY i.indexname;

-- 4. embedding 데이터 샘플 확인 (타입 확인용)
SELECT 
  chunk_id,
  pg_typeof(embedding) as embedding_type,
  CASE 
    WHEN pg_typeof(embedding) = 'vector'::regtype THEN 'vector 타입'
    ELSE pg_typeof(embedding)::text
  END as type_description,
  CASE 
    WHEN embedding IS NOT NULL THEN '데이터 있음'
    ELSE 'NULL'
  END as data_status
FROM document_chunks
LIMIT 5;

-- 5. pgvector 확장 설치 확인
SELECT 
  extname,
  extversion
FROM pg_extension
WHERE extname = 'vector';

