-- documents 테이블에 metadata 컬럼 추가
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- metadata 컬럼에 인덱스 추가 (성능 최적화 및 검색 지원)
CREATE INDEX IF NOT EXISTS idx_documents_metadata 
ON documents USING GIN (metadata);

-- 기존 데이터가 있다면 기본값으로 업데이트 (NULL인 경우만)
UPDATE documents 
SET metadata = '{}' 
WHERE metadata IS NULL;

-- 코멘트 추가
COMMENT ON COLUMN documents.metadata IS 'URL 그룹화 정보(parentUrl, is_sub_page 등) 및 추가 메타데이터 저장';
