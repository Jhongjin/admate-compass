-- Simple step-by-step migration to fix embedding column type
-- This avoids memory issues by processing in very small batches

-- Step 1: Add new vector column
ALTER TABLE document_chunks 
ADD COLUMN embedding_vector vector(1024);

-- Step 2: Process first 50 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    ORDER BY id 
    LIMIT 50
);

-- Step 3: Process next 50 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 50
);

-- Step 4: Process next 50 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 50
);

-- Step 5: Process remaining records in batches of 25
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 25
);

-- Repeat the above UPDATE statement multiple times until all records are processed
-- You can run this migration multiple times if needed

