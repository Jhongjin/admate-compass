-- Fix embedding column type from text to vector (Memory-optimized batch version)
-- This migration converts the embedding column from text to vector type in small batches

-- Step 1: Add new vector column
ALTER TABLE document_chunks 
ADD COLUMN embedding_vector vector(1024);

-- Step 2: Process first 100 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    ORDER BY id 
    LIMIT 100
);

-- Step 3: Process next 100 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 100
);

-- Step 4: Process next 100 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 100
);

-- Step 5: Process next 100 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 100
);

-- Step 6: Process next 100 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 100
);

-- Step 7: Process next 100 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 100
);

-- Step 8: Process next 100 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 100
);

-- Step 9: Process next 100 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 100
);

-- Step 10: Process next 100 records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL
AND id IN (
    SELECT id FROM document_chunks 
    WHERE embedding IS NOT NULL 
    AND embedding_vector IS NULL
    ORDER BY id 
    LIMIT 100
);

-- Step 11: Process remaining records
UPDATE document_chunks 
SET embedding_vector = embedding::vector
WHERE embedding IS NOT NULL 
AND embedding_vector IS NULL;

-- Step 12: Drop the old text column
ALTER TABLE document_chunks 
DROP COLUMN embedding;

-- Step 13: Rename the new column to the original name
ALTER TABLE document_chunks 
RENAME COLUMN embedding_vector TO embedding;

-- Step 14: Add index for vector similarity search
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx 
ON document_chunks USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

