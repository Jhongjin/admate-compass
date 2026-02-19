-- document_splits 테이블 누락된 컬럼 추가
-- 이 마이그레이션은 document_splits 테이블이 이미 존재하지만 일부 컬럼이 누락된 경우에 사용합니다

-- 누락된 컬럼 추가 (IF NOT EXISTS로 안전하게)
ALTER TABLE IF EXISTS public.document_splits
ADD COLUMN IF NOT EXISTS start_char INTEGER;

ALTER TABLE IF EXISTS public.document_splits
ADD COLUMN IF NOT EXISTS end_char INTEGER;

ALTER TABLE IF EXISTS public.document_splits
ADD COLUMN IF NOT EXISTS page_number INTEGER;

ALTER TABLE IF EXISTS public.document_splits
ADD COLUMN IF NOT EXISTS section_title TEXT;

-- 인덱스가 없으면 생성 (이미 존재하면 무시)
CREATE INDEX IF NOT EXISTS idx_document_splits_document_id ON public.document_splits(document_id);
CREATE INDEX IF NOT EXISTS idx_document_splits_status ON public.document_splits(status);
CREATE INDEX IF NOT EXISTS idx_document_splits_job_id ON public.document_splits(job_id);

-- 주석 추가 (이미 있으면 업데이트)
COMMENT ON TABLE public.document_splits IS '큰 문서를 분할 처리하기 위한 테이블';
COMMENT ON COLUMN public.document_splits.split_index IS '분할 인덱스 (0부터 시작)';
COMMENT ON COLUMN public.document_splits.split_count IS '전체 분할 개수';
COMMENT ON COLUMN public.document_splits.status IS '분할 처리 상태: pending, processing, completed, failed';

