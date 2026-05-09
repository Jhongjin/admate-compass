-- Gate 6A source export generator 03: ollama_document_chunks.
-- Run in Admate_AI_Bot SQL Editor.
-- SELECT-only generator: copy exported sql_statement rows for later target import review.

select
  'ollama_document_chunks' as section,
  id::text as source_id,
  format(
    'insert into __TARGET_SCHEMA__.ollama_document_chunks (id, document_id, chunk_id, content, embedding, metadata, created_at, updated_at) values (%s, %L, %L, %L, %s, %s::jsonb, %L::timestamptz, %L::timestamptz) on conflict (id) do nothing;',
    id,
    document_id,
    chunk_id,
    content,
    case when embedding is null then 'null' else quote_literal(embedding::text) || '::vector' end,
    quote_literal(coalesce(metadata, '{}'::jsonb)::text),
    created_at,
    updated_at
  ) as sql_statement
from public.ollama_document_chunks
order by id;
