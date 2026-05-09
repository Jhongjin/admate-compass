-- Gate 6D-2A service_role import grant verify.
-- Run in Admate-Vision SQL Editor after 2026-05-05_gate6d2_service_role_import_grants.sql.
-- SELECT-only. No data mutation.

with grant_checks as (
  select 'documents' as table_name,
    has_table_privilege('service_role', 'compass.documents', 'INSERT')::text as insert_grant,
    (select count(*)::text from compass.documents) as row_count
  union all select 'document_metadata',
    has_table_privilege('service_role', 'compass.document_metadata', 'INSERT')::text,
    (select count(*)::text from compass.document_metadata)
  union all select 'document_chunks',
    has_table_privilege('service_role', 'compass.document_chunks', 'INSERT')::text,
    (select count(*)::text from compass.document_chunks)
  union all select 'ollama_document_chunks',
    has_table_privilege('service_role', 'compass.ollama_document_chunks', 'INSERT')::text,
    (select count(*)::text from compass.ollama_document_chunks)
  union all select 'document_processing_logs',
    has_table_privilege('service_role', 'compass.document_processing_logs', 'INSERT')::text,
    (select count(*)::text from compass.document_processing_logs)
  union all select 'document_chunk_weights',
    has_table_privilege('service_role', 'compass.document_chunk_weights', 'INSERT')::text,
    (select count(*)::text from compass.document_chunk_weights)
  union all select 'processing_jobs',
    has_table_privilege('service_role', 'compass.processing_jobs', 'INSERT')::text,
    (select count(*)::text from compass.processing_jobs)
  union all select 'document_splits',
    has_table_privilege('service_role', 'compass.document_splits', 'INSERT')::text,
    (select count(*)::text from compass.document_splits)
  union all select 'discovered_urls',
    has_table_privilege('service_role', 'compass.discovered_urls', 'INSERT')::text,
    (select count(*)::text from compass.discovered_urls)
  union all select 'crawl_jobs',
    has_table_privilege('service_role', 'compass.crawl_jobs', 'INSERT')::text,
    (select count(*)::text from compass.crawl_jobs)
  union all select 'processing_metrics',
    has_table_privilege('service_role', 'compass.processing_metrics', 'INSERT')::text,
    (select count(*)::text from compass.processing_metrics)
  union all select 'url_templates',
    has_table_privilege('service_role', 'compass.url_templates', 'INSERT')::text,
    (select count(*)::text from compass.url_templates)
)
select table_name, insert_grant, row_count
from grant_checks
order by table_name;
