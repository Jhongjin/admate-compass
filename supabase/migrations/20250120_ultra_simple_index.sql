-- 초단순 인덱스 생성 (2025-01-20)
-- VACUUM 없이 가장 기본적인 인덱스만 생성

-- 1. 메모리 설정
SET maintenance_work_mem = '64MB';
SET work_mem = '16MB';
SET statement_timeout = '15s'; -- 15초 타임아웃

-- 2. 현재 상태 확인
SELECT 'Starting ultra simple index creation' as status, NOW() as timestamp;

-- 3. 기존 인덱스 삭제
DROP INDEX IF EXISTS idx_document_chunks_embedding;
DROP INDEX IF EXISTS idx_document_chunks_document_id;
DROP INDEX IF EXISTS idx_document_chunks_chunk_id;
DROP INDEX IF EXISTS idx_documents_status;
DROP INDEX IF EXISTS idx_documents_type;

SELECT 'Existing indexes dropped' as status, NOW() as timestamp;

-- 4. 새로운 인덱스 생성 (하나씩)
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

-- 5. 통계 업데이트
ANALYZE documents;
ANALYZE document_chunks;

SELECT 'Statistics updated' as status, NOW() as timestamp;

SELECT 'Ultra simple index creation completed successfully' as status, NOW() as timestamp;
