-- Vendor tagging and background processing tables
-- Created at: 2025-10-14

-- 1) Extend documents with source_vendor for multi-vendor support
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS source_vendor TEXT DEFAULT 'META';

-- Optional: constrain to known vendors initially; can be relaxed later
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'vendor_enum'
  ) THEN
    CREATE TYPE vendor_enum AS ENUM ('META', 'NAVER', 'KAKAO', 'GOOGLE', 'OTHER');
  END IF;
END $$;

ALTER TABLE IF EXISTS public.documents
ALTER COLUMN source_vendor TYPE vendor_enum USING (
  CASE
    WHEN source_vendor IN ('META','NAVER','KAKAO','GOOGLE','OTHER') THEN source_vendor::vendor_enum
    ELSE 'OTHER'::vendor_enum
  END
);

CREATE INDEX IF NOT EXISTS idx_documents_source_vendor ON public.documents(source_vendor);

-- 2) Background processing jobs for OCR/Parsing workers
CREATE TABLE IF NOT EXISTS public.processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('OCR','PDF_PARSE','DOCX_PARSE','CRAWL','EMBEDDING')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled','retrying')),
  priority INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  payload JSONB DEFAULT '{}',
  result JSONB,
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_priority ON public.processing_jobs(status, priority DESC, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_document_id ON public.processing_jobs(document_id);

-- RLS enablement
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'processing_jobs' AND policyname = 'Authenticated can manage processing jobs'
  ) THEN
    CREATE POLICY "Authenticated can manage processing jobs" ON public.processing_jobs
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_processing_jobs_updated_at'
  ) THEN
    CREATE TRIGGER trg_processing_jobs_updated_at
    BEFORE UPDATE ON public.processing_jobs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

ANALYZE public.documents;
ANALYZE public.processing_jobs;







