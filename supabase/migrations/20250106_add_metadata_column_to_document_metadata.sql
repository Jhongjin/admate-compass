-- document_metadata 테이블에 metadata 컬럼 추가
ALTER TABLE document_metadata
ADD COLUMN metadata JSONB DEFAULT '{}';

-- 인덱스 추가 (선택적)
CREATE INDEX IF NOT EXISTS idx_document_metadata_metadata ON document_metadata USING GIN (metadata);


