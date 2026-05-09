-- Gate RAG-3F: sample import rollback SQL.
-- STATUS: PREPARED ONLY. Do not execute unless rollback is explicitly approved.
-- Scope: only rows created by RAG-3F. Existing original rows must remain.

delete from compass.ollama_document_chunks
where metadata->>'rag_gate' = 'RAG-3F'
   or chunk_id like 'rag3d_%';

-- Optional post-rollback verification:
-- select count(*) as remaining_rag3f_rows
-- from compass.ollama_document_chunks
-- where metadata->>'rag_gate' = 'RAG-3F'
--    or chunk_id like 'rag3d_%';
