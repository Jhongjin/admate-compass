-- Gate 6A source export generator 02: document_chunks.
-- Run in Admate_AI_Bot SQL Editor.
-- SELECT-only generator: copy exported sql_statement rows for later target import review.

select
  'document_chunks' as section,
  id as source_id,
  format(
    'insert into __TARGET_SCHEMA__.document_chunks (id, document_id, chunk_id, content, embedding, created_at, metadata, parent_chunk_id, hierarchy_level) values (%L, %L, %s, %L, %s, %L::timestamptz, %s::jsonb, %L, %L) on conflict (id) do nothing;',
    id,
    document_id,
    chunk_id,
    content,
    case when embedding is null then 'null' else quote_literal(embedding::text) || '::vector' end,
    created_at,
    quote_literal(coalesce(metadata, '{}'::jsonb)::text),
    parent_chunk_id,
    hierarchy_level
  ) as sql_statement
from public.document_chunks
order by id;
