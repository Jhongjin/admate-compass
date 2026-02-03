-- CRAWL_SEED job type 지원 및 document_id NULL 허용
-- Created at: 2025-01-31
-- Purpose: URL 크롤링 작업을 위해 document_id를 선택적으로 만들고 CRAWL_SEED job type 추가

-- 1. job_type CHECK 제약조건에 CRAWL_SEED 추가
ALTER TABLE IF EXISTS public.processing_jobs
DROP CONSTRAINT IF EXISTS processing_jobs_job_type_check;

ALTER TABLE IF EXISTS public.processing_jobs
ADD CONSTRAINT processing_jobs_job_type_check 
CHECK (job_type IN ('OCR','PDF_PARSE','DOCX_PARSE','CRAWL','CRAWL_SEED','EMBEDDING','CHUNK_PROCESS'));

-- 2. document_id를 NULL 허용하도록 변경
-- 먼저 외래키 제약조건 제거
ALTER TABLE IF EXISTS public.processing_jobs
DROP CONSTRAINT IF EXISTS processing_jobs_document_id_fkey;

-- document_id 컬럼을 NULL 허용으로 변경
ALTER TABLE IF EXISTS public.processing_jobs
ALTER COLUMN document_id DROP NOT NULL;

-- 외래키 제약조건 재추가 (NULL 허용)
ALTER TABLE IF EXISTS public.processing_jobs
ADD CONSTRAINT processing_jobs_document_id_fkey
FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

-- 주석 추가
COMMENT ON COLUMN public.processing_jobs.document_id IS '문서 ID (CRAWL_SEED의 경우 NULL 허용)';

