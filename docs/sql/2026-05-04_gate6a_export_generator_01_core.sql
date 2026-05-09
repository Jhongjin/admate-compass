-- Gate 6A source export generator 01: documents and document_metadata.
-- Run in Admate_AI_Bot SQL Editor.
-- SELECT-only generator: copy exported sql_statement rows for later target import review.

select
  'documents' as section,
  id as source_id,
  format(
    'insert into __TARGET_SCHEMA__.documents (id, title, content, type, document_url, created_at, updated_at, chunk_count, status, url, size, file_size, file_type, source_vendor, split_status, main_document_id, original_file_name, sanitized_file_name, metadata) values (%L, %L, %L, %L, %L, %L::timestamptz, %L::timestamptz, %s, %L, %L, %s, %s, %L, %L, %s::jsonb, %L, %L, %L, %s::jsonb) on conflict (id) do nothing;',
    id,
    title,
    content,
    type,
    document_url,
    created_at,
    updated_at,
    coalesce(chunk_count, 0),
    status,
    url,
    coalesce(size, 0),
    coalesce(file_size, 0),
    file_type,
    source_vendor,
    case when split_status is null then 'null' else quote_literal(split_status::text) end,
    main_document_id,
    original_file_name,
    sanitized_file_name,
    quote_literal(coalesce(metadata, '{}'::jsonb)::text)
  ) as sql_statement
from public.documents
union all
select
  'document_metadata' as section,
  id as source_id,
  format(
    'insert into __TARGET_SCHEMA__.document_metadata (id, title, type, size, uploaded_at, processed_at, status, chunk_count, embedding_count, metadata, created_at, updated_at, original_file_name) values (%L, %L, %L, %s, %L::timestamptz, %L::timestamptz, %L, %s, %s, %s::jsonb, %L::timestamptz, %L::timestamptz, %L) on conflict (id) do nothing;',
    id,
    title,
    type,
    size,
    uploaded_at,
    processed_at,
    status,
    coalesce(chunk_count, 0),
    coalesce(embedding_count, 0),
    quote_literal(coalesce(metadata, '{}'::jsonb)::text),
    created_at,
    updated_at,
    original_file_name
  ) as sql_statement
from public.document_metadata
order by section, source_id;
