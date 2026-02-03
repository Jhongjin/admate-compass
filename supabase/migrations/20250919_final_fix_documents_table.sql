-- Final fix for documents table schema
-- Add content column and fix all constraints

-- Add content column to documents table
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS content TEXT;

-- Make content column nullable with default empty string
ALTER TABLE documents 
ALTER COLUMN content DROP NOT NULL,
ALTER COLUMN content SET DEFAULT '';

-- Update existing NULL content values
UPDATE documents 
SET content = '' 
WHERE content IS NULL;

-- Add file_size column if it doesn't exist
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0;

-- Add file_type column if it doesn't exist
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT '';

-- Make these columns nullable
ALTER TABLE documents 
ALTER COLUMN file_size DROP NOT NULL,
ALTER COLUMN file_type DROP NOT NULL;

-- Update existing NULL values
UPDATE documents 
SET file_size = 0 
WHERE file_size IS NULL;

UPDATE documents 
SET file_type = '' 
WHERE file_type IS NULL;

-- Add comments
COMMENT ON COLUMN documents.content IS 'File content or URL content for documents';
COMMENT ON COLUMN documents.file_size IS 'File size in bytes for file type documents';
COMMENT ON COLUMN documents.file_type IS 'MIME type of the file (e.g., application/pdf, text/plain)';
