-- Gate 6A source export generator 04: operational Option B tables.
-- Run in Admate_AI_Bot SQL Editor.
-- SELECT-only generator: copy exported sql_statement rows for later target import review.

select
  'processing_jobs' as section,
  id::text as source_id,
  format(
    'insert into %I.processing_jobs (id, document_id, job_type, status, priority, attempts, max_attempts, error, payload, result, scheduled_at, started_at, finished_at, created_at, updated_at) values (%L::uuid, %L, %L, %L, %s, %s, %s, %L, %s::jsonb, %s::jsonb, %L::timestamptz, %L::timestamptz, %L::timestamptz, %L::timestamptz, %L::timestamptz) on conflict (id) do nothing;',
    '__TARGET_SCHEMA__', id, document_id, job_type, status, priority, attempts, max_attempts, error,
    quote_literal(coalesce(payload, '{}'::jsonb)::text),
    case when result is null then 'null' else quote_literal(result::text) end,
    scheduled_at, started_at, finished_at, created_at, updated_at
  ) as sql_statement
from public.processing_jobs
union all
select
  'document_splits',
  id::text,
  format(
    'insert into %I.document_splits (id, document_id, split_index, split_count, content, start_char, end_char, page_number, section_title, status, job_id, created_at, updated_at) values (%L::uuid, %L, %s, %s, %L, %s, %s, %s, %L, %L, %L::uuid, %L::timestamptz, %L::timestamptz) on conflict (id) do nothing;',
    '__TARGET_SCHEMA__', id, document_id, split_index, split_count, content,
    coalesce(start_char::text, 'null'),
    coalesce(end_char::text, 'null'),
    coalesce(page_number::text, 'null'),
    section_title, status, job_id, created_at, updated_at
  )
from public.document_splits
union all
select
  'discovered_urls',
  id::text,
  format(
    'insert into %I.discovered_urls (id, job_id, url, title, depth, parent_url, path, source, selected, created_at, updated_at) values (%L::uuid, %L::uuid, %L, %L, %s, %L, %s::jsonb, %L, %s, %L::timestamptz, %L::timestamptz) on conflict (id) do nothing;',
    '__TARGET_SCHEMA__', id, job_id, url, title, depth, parent_url,
    quote_literal(coalesce(path, '[]'::jsonb)::text),
    source, coalesce(selected, false), created_at, updated_at
  )
from public.discovered_urls
union all
select
  'document_processing_logs',
  id::text,
  format(
    'insert into %I.document_processing_logs (id, document_id, step, status, message, error, metadata, created_at) values (%s, %L, %L, %L, %L, %L, %s::jsonb, %L::timestamptz) on conflict (id) do nothing;',
    '__TARGET_SCHEMA__', id, document_id, step, status, message, error,
    quote_literal(coalesce(metadata, '{}'::jsonb)::text),
    created_at
  )
from public.document_processing_logs
union all
select
  'document_chunk_weights',
  id::text,
  format(
    'insert into %I.document_chunk_weights (id, document_id, chunk_id, positive_feedback_count, negative_feedback_count, weight_score, last_updated, created_at) values (%s, %L, %L, %s, %s, %s, %L::timestamptz, %L::timestamptz) on conflict (id) do nothing;',
    '__TARGET_SCHEMA__', id, document_id, chunk_id, positive_feedback_count, negative_feedback_count, weight_score, last_updated, created_at
  )
from public.document_chunk_weights
union all
select
  'crawl_jobs',
  id::text,
  format(
    'insert into %I.crawl_jobs (id, url, status, pages_crawled, created_at, updated_at) values (%L::uuid, %L, %L, %s, %L::timestamptz, %L::timestamptz) on conflict (id) do nothing;',
    '__TARGET_SCHEMA__', id, url, status, pages_crawled, created_at, updated_at
  )
from public.crawl_jobs
union all
select
  'processing_metrics',
  id::text,
  format(
    'insert into %I.processing_metrics (id, job_id, document_id, bytes, dl_ms, parse_ms, ocr_ms, emb_ms, total_ms, text_length, chunks, note, created_at) values (%L::uuid, %L::uuid, %L, %s, %s, %s, %s, %s, %s, %s, %s, %L, %L::timestamptz) on conflict (id) do nothing;',
    '__TARGET_SCHEMA__', id, job_id, document_id,
    coalesce(bytes::text, 'null'),
    coalesce(dl_ms::text, 'null'),
    coalesce(parse_ms::text, 'null'),
    coalesce(ocr_ms::text, 'null'),
    coalesce(emb_ms::text, 'null'),
    coalesce(total_ms::text, 'null'),
    coalesce(text_length::text, 'null'),
    coalesce(chunks::text, 'null'),
    note, created_at
  )
from public.processing_metrics
union all
select
  'url_templates',
  id::text,
  format(
    'insert into %I.url_templates (id, name, urls, vendor, created_at, updated_at) values (%s, %L, %L::text[], %L, %L::timestamptz, %L::timestamptz) on conflict (id) do nothing;',
    '__TARGET_SCHEMA__', id, name, urls, vendor::text, created_at, updated_at
  )
from public.url_templates
order by section, source_id;
