-- Original filename support for uploaded documents
DO $$
BEGIN
    -- documents.original_file_name
    ALTER TABLE IF EXISTS public.documents
        ADD COLUMN IF NOT EXISTS original_file_name TEXT;
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
    -- documents.sanitized_file_name
    ALTER TABLE IF EXISTS public.documents
        ADD COLUMN IF NOT EXISTS sanitized_file_name TEXT;
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

DO $$
BEGIN
    -- document_metadata.original_file_name
    ALTER TABLE IF EXISTS public.document_metadata
        ADD COLUMN IF NOT EXISTS original_file_name TEXT;
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

