-- Add file_size column to documents table
-- This migration adds the missing 'file_size' column that is required by RAGProcessor.ts

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Add comment to the column
COMMENT ON COLUMN documents.file_size IS 'File size in bytes for file type documents';

-- Update existing documents with file_size 0 if file_size is NULL
UPDATE documents 
SET file_size = 0 
WHERE file_size IS NULL;

-- Make file_size column NOT NULL with default value 0
ALTER TABLE documents 
ALTER COLUMN file_size SET NOT NULL,
ALTER COLUMN file_size SET DEFAULT 0;

-- Also add file_type column if it doesn't exist
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS file_type TEXT;

-- Add comment to the file_type column
COMMENT ON COLUMN documents.file_type IS 'MIME type of the file (e.g., application/pdf, text/plain)';

-- Also add content column if it doesn't exist (for storing file content)
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS content TEXT;

-- Add comment to the content column
COMMENT ON COLUMN documents.content IS 'File content or URL content for documents';


