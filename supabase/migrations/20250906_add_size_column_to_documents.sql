-- Add size column to documents table
-- This migration adds the missing 'size' column that is required for file duplicate checking

ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS size BIGINT;

-- Add comment to the column
COMMENT ON COLUMN documents.size IS 'File size in bytes for file type documents';

-- Update existing documents with size 0 if size is NULL
UPDATE documents 
SET size = 0 
WHERE size IS NULL;

-- Make size column NOT NULL with default value 0
ALTER TABLE documents 
ALTER COLUMN size SET NOT NULL,
ALTER COLUMN size SET DEFAULT 0;


