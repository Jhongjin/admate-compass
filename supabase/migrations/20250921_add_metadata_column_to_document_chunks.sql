-- document_chunks 테이블에 metadata 컬럼 추가
-- 이 컬럼은 청크의 메타데이터 정보를 JSON 형태로 저장합니다

ALTER TABLE document_chunks 
ADD COLUMN metadata JSONB;

-- metadata 컬럼에 대한 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata 
ON document_chunks USING GIN (metadata);

-- 기존 데이터에 대한 기본 metadata 값 설정
UPDATE document_chunks 
SET metadata = jsonb_build_object(
  'document_id', document_id,
  'chunk_index', chunk_id,
  'source', 'legacy_data',
  'created_at', created_at::text
)
WHERE metadata IS NULL;
