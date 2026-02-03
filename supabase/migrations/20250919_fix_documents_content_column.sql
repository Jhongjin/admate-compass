-- Fix documents table content column to allow NULL values
-- This migration fixes the NOT NULL constraint issue on the content column

-- Make content column nullable
ALTER TABLE documents 
ALTER COLUMN content DROP NOT NULL;

-- Add default value for content column
ALTER TABLE documents 
ALTER COLUMN content SET DEFAULT '';

-- Update existing NULL content values to empty string
UPDATE documents 
SET content = '' 
WHERE content IS NULL;

-- Also make file_size and file_type nullable if they exist
ALTER TABLE documents 
ALTER COLUMN file_size DROP NOT NULL;

ALTER TABLE documents 
ALTER COLUMN file_type DROP NOT NULL;

-- Set default values
ALTER TABLE documents 
ALTER COLUMN file_size SET DEFAULT 0;

ALTER TABLE documents 
ALTER COLUMN file_type SET DEFAULT '';

-- Update existing NULL values
UPDATE documents 
SET file_size = 0 
WHERE file_size IS NULL;

UPDATE documents 
SET file_type = '' 
WHERE file_type IS NULL;


