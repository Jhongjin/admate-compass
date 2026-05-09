-- Gate 5C source-side export generator.
-- Run this in the Admate_AI_Bot project SQL Editor only.
-- It does not modify data. It emits INSERT statements for Admate-Vision.

with source_rows as (
  select
    document_id,
    chunk_id,
    content,
    embedding,
    metadata,
    created_at,
    updated_at
  from public.ollama_document_chunks
  order by created_at, document_id, chunk_id
  limit 6
),
generated as (
  select
    row_number() over (order by created_at, document_id, chunk_id) as ord,
    'ollama_document_chunks' as section,
    format(
      'insert into %s.%s (document_id, chunk_id, content, embedding, metadata, created_at, updated_at) values (%L, %L, %L, %s, %L::jsonb, %L::timestamptz, %L::timestamptz) on conflict do nothing;',
      'compass',
      'ollama_document_chunks',
      document_id,
      chunk_id,
      content,
      case
        when embedding is null then 'NULL'
        else quote_literal(embedding::text) || '::vector'
      end,
      coalesce(metadata, '{}'::jsonb)::text,
      created_at,
      updated_at
    ) as sql_statement
  from source_rows
)
select section, sql_statement
from generated
order by ord;
