-- documents 테이블에 url 컬럼 추가
ALTER TABLE documents ADD COLUMN IF NOT EXISTS url TEXT;

-- url 컬럼에 대한 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(url);

-- 기존 데이터가 있다면 url 컬럼을 업데이트 (필요시)
-- UPDATE documents SET url = 'unknown' WHERE url IS NULL;

-- 통계 업데이트
ANALYZE documents;

