-- Fix chunk_id column type from integer to text
-- This migration fixes the data type mismatch for chunk_id column

-- First, let's check the current column type
-- ALTER TABLE document_chunks ALTER COLUMN chunk_id TYPE text;

-- Since we can't directly alter the type due to existing data,
-- we'll need to create a new column and migrate data

-- Step 1: Add a new text column
ALTER TABLE document_chunks ADD COLUMN chunk_id_text text;

-- Step 2: Copy data from old column to new column
UPDATE document_chunks SET chunk_id_text = chunk_id::text;

-- Step 3: Drop the old column
ALTER TABLE document_chunks DROP COLUMN chunk_id;

-- Step 4: Rename the new column to the original name
ALTER TABLE document_chunks RENAME COLUMN chunk_id_text TO chunk_id;

-- Step 5: Add any necessary constraints
ALTER TABLE document_chunks ALTER COLUMN chunk_id SET NOT NULL;
