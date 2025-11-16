-- 하위 페이지 그룹핑을 위한 main_document_id 컬럼 추가
-- 작성일: 2025-11-16
-- 목적: URL 크롤링 시 하위 페이지가 부모 문서와 연결되도록 함

-- documents 테이블에 main_document_id 컬럼 추가
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS main_document_id TEXT;

-- main_document_id에 대한 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_documents_main_document_id ON documents(main_document_id);

-- main_document_id 외래키 제약조건 추가 (자기 참조)
DO $$
BEGIN
  -- 외래키 제약조건이 없으면 추가
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'documents_main_document_id_fkey'
  ) THEN
    ALTER TABLE documents
    ADD CONSTRAINT documents_main_document_id_fkey
    FOREIGN KEY (main_document_id) 
    REFERENCES documents(id) 
    ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- 제약조건 추가 실패 시 무시 (이미 존재할 수 있음)
    NULL;
END $$;

-- 컬럼 코멘트 추가
COMMENT ON COLUMN documents.main_document_id IS '부모 문서 ID (URL 크롤링 시 하위 페이지가 메인 페이지를 참조)';

