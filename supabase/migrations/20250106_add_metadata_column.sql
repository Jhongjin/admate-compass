-- document_metadata 테이블에 metadata 컬럼 추가
ALTER TABLE document_metadata 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- metadata 컬럼에 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_document_metadata_metadata 
ON document_metadata USING GIN (metadata);

-- 기존 데이터에 빈 metadata 객체 추가
UPDATE document_metadata 
SET metadata = '{}' 
WHERE metadata IS NULL;


