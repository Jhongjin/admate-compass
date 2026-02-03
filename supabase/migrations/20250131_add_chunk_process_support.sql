-- Phase 1: 인프라 준비 - CHUNK_PROCESS job 타입 및 document_splits 테이블 추가
-- Created at: 2025-01-31

-- 1.1 processing_jobs 테이블에 CHUNK_PROCESS 타입 추가
-- CHECK 제약조건을 수정하여 CHUNK_PROCESS 추가
ALTER TABLE IF EXISTS public.processing_jobs
DROP CONSTRAINT IF EXISTS processing_jobs_job_type_check;

ALTER TABLE IF EXISTS public.processing_jobs
ADD CONSTRAINT processing_jobs_job_type_check 
CHECK (job_type IN ('OCR','PDF_PARSE','DOCX_PARSE','CRAWL','EMBEDDING','CHUNK_PROCESS'));

-- 1.2 문서 분할 상태 추적 테이블 생성
CREATE TABLE IF NOT EXISTS public.document_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  split_index INTEGER NOT NULL,
  split_count INTEGER NOT NULL,
  content TEXT NOT NULL,
  start_char INTEGER,
  end_char INTEGER,
  page_number INTEGER,
  section_title TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  job_id UUID REFERENCES public.processing_jobs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(document_id, split_index)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_document_splits_document_id ON public.document_splits(document_id);
CREATE INDEX IF NOT EXISTS idx_document_splits_status ON public.document_splits(status);
CREATE INDEX IF NOT EXISTS idx_document_splits_job_id ON public.document_splits(job_id);

-- 1.3 documents 테이블에 split_status 컬럼 추가
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS split_status JSONB;

-- split_status 예시: { "total_splits": 5, "completed_splits": 3, "failed_splits": 0, "method": "page" }

-- RLS 활성화
ALTER TABLE public.document_splits ENABLE ROW LEVEL SECURITY;

-- 주석 추가
COMMENT ON TABLE public.document_splits IS '큰 문서를 분할 처리하기 위한 테이블';
COMMENT ON COLUMN public.document_splits.split_index IS '분할 인덱스 (0부터 시작)';
COMMENT ON COLUMN public.document_splits.split_count IS '전체 분할 개수';
COMMENT ON COLUMN public.document_splits.status IS '분할 처리 상태: pending, processing, completed, failed';
COMMENT ON COLUMN public.documents.split_status IS '문서 분할 진행 상황 (JSONB): { total_splits, completed_splits, failed_splits, method }';

