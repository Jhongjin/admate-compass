-- Step 2: 새 인덱스 생성만 (2025-01-20)
-- 두 번째 단계 - 새 인덱스 생성

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '10s'; -- 10초 타임아웃

-- 2. 현재 상태 확인
SELECT 'Starting Step 2: Create new indexes' as status, NOW() as timestamp;

-- 3. 새로운 인덱스 생성 (하나씩)
-- document_chunks 테이블의 document_id 인덱스
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id 
ON document_chunks(document_id);

SELECT 'Document chunks document_id index created' as status, NOW() as timestamp;

-- document_chunks 테이블의 chunk_id 인덱스
CREATE INDEX IF NOT EXISTS idx_document_chunks_chunk_id 
ON document_chunks(chunk_id);

SELECT 'Document chunks chunk_id index created' as status, NOW() as timestamp;

-- documents 테이블의 status 인덱스
CREATE INDEX IF NOT EXISTS idx_documents_status 
ON documents(status);

SELECT 'Documents status index created' as status, NOW() as timestamp;

-- documents 테이블의 type 인덱스
CREATE INDEX IF NOT EXISTS idx_documents_type 
ON documents(type);

SELECT 'Documents type index created' as status, NOW() as timestamp;

-- 4. 통계 업데이트
ANALYZE documents;
ANALYZE document_chunks;

SELECT 'Statistics updated' as status, NOW() as timestamp;

-- 5. Step 2 결과 확인
SELECT 
  'Step 2 results - new indexes' as status,
  schemaname,
  tablename,
  indexname
FROM pg_indexes 
WHERE tablename IN ('documents', 'document_chunks')
ORDER BY schemaname, tablename, indexname;

SELECT 'Step 2 completed successfully' as status, NOW() as timestamp;
