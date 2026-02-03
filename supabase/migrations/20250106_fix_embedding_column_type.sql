-- Fix embedding column type from text to vector (Memory-optimized version)
-- This migration converts the embedding column from text to vector type in small batches

-- First, add a new column with vector type
ALTER TABLE document_chunks 
ADD COLUMN embedding_vector vector(1024);

-- Copy data in small batches to avoid memory issues
-- Process 100 records at a time
DO $$
DECLARE
    batch_size INTEGER := 100;
    offset_val INTEGER := 0;
    total_count INTEGER;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO total_count FROM document_chunks WHERE embedding IS NOT NULL;
    
    RAISE NOTICE 'Total records to process: %', total_count;
    
    -- Process in batches
    WHILE offset_val < total_count LOOP
        RAISE NOTICE 'Processing batch: % to %', offset_val + 1, LEAST(offset_val + batch_size, total_count);
        
        UPDATE document_chunks 
        SET embedding_vector = embedding::vector
        WHERE embedding IS NOT NULL 
        AND embedding_vector IS NULL
        AND id IN (
            SELECT id FROM document_chunks 
            WHERE embedding IS NOT NULL 
            ORDER BY id 
            LIMIT batch_size OFFSET offset_val
        );
        
        offset_val := offset_val + batch_size;
        
        -- Small delay to prevent overwhelming the system
        PERFORM pg_sleep(0.1);
    END LOOP;
    
    RAISE NOTICE 'Batch processing completed';
END $$;

-- Drop the old text column
ALTER TABLE document_chunks 
DROP COLUMN embedding;

-- Rename the new column to the original name
ALTER TABLE document_chunks 
RENAME COLUMN embedding_vector TO embedding;

-- Add index for vector similarity search (after data migration)
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx 
ON document_chunks USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
