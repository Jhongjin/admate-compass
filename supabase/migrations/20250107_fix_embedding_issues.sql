-- Comprehensive fix for embedding issues
-- This migration addresses zero-length embeddings and format issues

-- 1. First, let's check if we have any problematic embeddings
DO $$
DECLARE
    problematic_count INTEGER;
    total_count INTEGER;
BEGIN
    -- Count problematic embeddings
    SELECT COUNT(*) INTO problematic_count 
    FROM document_chunks 
    WHERE embedding IS NULL 
       OR embedding = '[]'::jsonb 
       OR (embedding::text = '[]')
       OR (embedding::text LIKE '%[]%');
    
    -- Count total embeddings
    SELECT COUNT(*) INTO total_count FROM document_chunks;
    
    RAISE NOTICE 'Total chunks: %, Problematic chunks: %', total_count, problematic_count;
    
    -- If we have problematic embeddings, we need to handle them
    IF problematic_count > 0 THEN
        RAISE NOTICE 'Found % problematic embeddings that need to be fixed', problematic_count;
    END IF;
END $$;

-- 2. Create a function to validate embedding format
CREATE OR REPLACE FUNCTION validate_embedding(embedding_data anyelement)
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if it's a valid vector with 1024 dimensions
    IF embedding_data IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Try to cast to vector and check dimension
    BEGIN
        IF array_length(embedding_data::vector, 1) = 1024 THEN
            RETURN TRUE;
        ELSE
            RETURN FALSE;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            RETURN FALSE;
    END;
END;
$$ LANGUAGE plpgsql;

-- 3. Add a constraint to ensure embeddings are valid vectors with 1024 dimensions
-- First, let's add a check constraint
ALTER TABLE document_chunks 
ADD CONSTRAINT check_embedding_valid 
CHECK (
    embedding IS NULL OR 
    (embedding IS NOT NULL AND array_length(embedding::vector, 1) = 1024)
);

-- 4. Create a function to clean up problematic embeddings
CREATE OR REPLACE FUNCTION cleanup_problematic_embeddings()
RETURNS TABLE (
    chunk_id TEXT,
    action TEXT,
    details TEXT
) AS $$
DECLARE
    chunk_record RECORD;
    embedding_array REAL[];
    i INTEGER;
BEGIN
    -- Loop through all chunks with problematic embeddings
    FOR chunk_record IN 
        SELECT id, chunk_id, content, embedding, metadata
        FROM document_chunks 
        WHERE embedding IS NULL 
           OR embedding = '[]'::jsonb 
           OR (embedding::text = '[]')
           OR (embedding::text LIKE '%[]%')
           OR NOT validate_embedding(embedding)
    LOOP
        -- Try to fix the embedding if it's a string representation
        IF chunk_record.embedding IS NOT NULL THEN
            BEGIN
                -- Try to parse as JSON array
                embedding_array := chunk_record.embedding::jsonb::real[];
                
                -- Check if it's a valid 1024-dimensional array
                IF array_length(embedding_array, 1) = 1024 THEN
                    -- Update with the parsed array
                    UPDATE document_chunks 
                    SET embedding = embedding_array::vector(1024)
                    WHERE id = chunk_record.id;
                    
                    chunk_id := chunk_record.chunk_id;
                    action := 'FIXED';
                    details := 'Converted string to valid vector';
                    RETURN NEXT;
                ELSE
                    -- Mark for regeneration
                    UPDATE document_chunks 
                    SET embedding = NULL,
                        metadata = metadata || '{"needs_regeneration": true, "original_issue": "invalid_dimension"}'::jsonb
                    WHERE id = chunk_record.id;
                    
                    chunk_id := chunk_record.chunk_id;
                    action := 'MARKED_FOR_REGENERATION';
                    details := 'Invalid dimension: ' || array_length(embedding_array, 1);
                    RETURN NEXT;
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    -- Mark for regeneration
                    UPDATE document_chunks 
                    SET embedding = NULL,
                        metadata = metadata || '{"needs_regeneration": true, "original_issue": "parse_error"}'::jsonb
                    WHERE id = chunk_record.id;
                    
                    chunk_id := chunk_record.chunk_id;
                    action := 'MARKED_FOR_REGENERATION';
                    details := 'Parse error: ' || SQLERRM;
                    RETURN NEXT;
            END;
        ELSE
            -- NULL embedding - mark for regeneration
            UPDATE document_chunks 
            SET metadata = metadata || '{"needs_regeneration": true, "original_issue": "null_embedding"}'::jsonb
            WHERE id = chunk_record.id;
            
            chunk_id := chunk_record.chunk_id;
            action := 'MARKED_FOR_REGENERATION';
            details := 'NULL embedding';
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 5. Run the cleanup function
SELECT * FROM cleanup_problematic_embeddings();

-- 6. Create an index for chunks that need regeneration
CREATE INDEX IF NOT EXISTS idx_chunks_needs_regeneration 
ON document_chunks USING GIN ((metadata->'needs_regeneration'));

-- 7. Create a view for monitoring embedding health
CREATE OR REPLACE VIEW embedding_health AS
SELECT 
    COUNT(*) as total_chunks,
    COUNT(embedding) as chunks_with_embeddings,
    COUNT(*) - COUNT(embedding) as chunks_without_embeddings,
    COUNT(CASE WHEN metadata->>'needs_regeneration' = 'true' THEN 1 END) as chunks_needing_regeneration,
    COUNT(CASE WHEN validate_embedding(embedding) THEN 1 END) as valid_embeddings,
    COUNT(CASE WHEN embedding IS NOT NULL AND NOT validate_embedding(embedding) THEN 1 END) as invalid_embeddings
FROM document_chunks;

-- 8. Create a function to get embedding statistics
CREATE OR REPLACE FUNCTION get_embedding_stats()
RETURNS TABLE (
    metric TEXT,
    value BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 'total_chunks'::TEXT, COUNT(*)::BIGINT FROM document_chunks
    UNION ALL
    SELECT 'chunks_with_embeddings'::TEXT, COUNT(embedding)::BIGINT FROM document_chunks
    UNION ALL
    SELECT 'chunks_without_embeddings'::TEXT, (COUNT(*) - COUNT(embedding))::BIGINT FROM document_chunks
    UNION ALL
    SELECT 'chunks_needing_regeneration'::TEXT, COUNT(CASE WHEN metadata->>'needs_regeneration' = 'true' THEN 1 END)::BIGINT FROM document_chunks
    UNION ALL
    SELECT 'valid_embeddings'::TEXT, COUNT(CASE WHEN validate_embedding(embedding) THEN 1 END)::BIGINT FROM document_chunks
    UNION ALL
    SELECT 'invalid_embeddings'::TEXT, COUNT(CASE WHEN embedding IS NOT NULL AND NOT validate_embedding(embedding) THEN 1 END)::BIGINT FROM document_chunks;
END;
$$ LANGUAGE plpgsql;

-- 9. Add a trigger to validate embeddings on insert/update
CREATE OR REPLACE FUNCTION validate_embedding_trigger()
RETURNS TRIGGER AS $$
BEGIN
    -- Only validate if embedding is not NULL
    IF NEW.embedding IS NOT NULL THEN
        -- Check if it's a valid 1024-dimensional vector
        IF NOT validate_embedding(NEW.embedding) THEN
            RAISE EXCEPTION 'Invalid embedding: must be a 1024-dimensional vector';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS validate_embedding_trigger ON document_chunks;
CREATE TRIGGER validate_embedding_trigger
    BEFORE INSERT OR UPDATE ON document_chunks
    FOR EACH ROW
    EXECUTE FUNCTION validate_embedding_trigger();

-- 10. Update the search function to handle the new constraints
CREATE OR REPLACE FUNCTION search_documents(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10
)
RETURNS TABLE (
    chunk_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dc.chunk_id,
        dc.content,
        dc.metadata,
        1 - (dc.embedding <=> query_embedding) as similarity
    FROM document_chunks dc
    WHERE dc.embedding IS NOT NULL 
      AND validate_embedding(dc.embedding)
      AND 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 11. Show final statistics
SELECT 'Migration completed. Current embedding statistics:' as status;
SELECT * FROM get_embedding_stats();
