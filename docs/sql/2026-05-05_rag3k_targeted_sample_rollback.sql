-- Gate RAG-3K: targeted sample rollback.
-- Do not run unless rollback is explicitly approved.
-- Scope: only RAG-3K rows in compass.ollama_document_chunks.
-- This does not delete original six rows or RAG-3F rows.

delete from compass.ollama_document_chunks
where metadata->>'rag_gate' = 'RAG-3K'
   or chunk_id like 'rag3j_%';
