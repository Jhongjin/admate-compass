-- 모든 문서와 청크 데이터 삭제
-- 테스트를 위해 데이터베이스를 깨끗한 상태로 초기화

-- 1. document_chunks 테이블의 모든 데이터 삭제
DELETE FROM document_chunks;

-- 2. documents 테이블의 모든 데이터 삭제
DELETE FROM documents;

-- 3. document_metadata 테이블의 모든 데이터 삭제 (존재하는 경우)
DELETE FROM document_metadata;

-- 4. 삭제 확인을 위한 카운트
SELECT 
  'documents' as table_name, 
  COUNT(*) as remaining_count 
FROM documents
UNION ALL
SELECT 
  'document_chunks' as table_name, 
  COUNT(*) as remaining_count 
FROM document_chunks
UNION ALL
SELECT 
  'document_metadata' as table_name, 
  COUNT(*) as remaining_count 
FROM document_metadata;

