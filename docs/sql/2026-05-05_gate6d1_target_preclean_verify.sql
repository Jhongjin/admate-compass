-- Gate 6D-1 target preclean verify.
-- Run in Admate-Vision SQL Editor after 2026-05-05_gate6c_target_preclean.sql.
-- SELECT-only. No data mutation.

with option_b_counts as (
  select 'documents' as check_name, count(*)::text as value from compass.documents
  union all select 'document_metadata', count(*)::text from compass.document_metadata
  union all select 'document_chunks', count(*)::text from compass.document_chunks
  union all select 'ollama_document_chunks', count(*)::text from compass.ollama_document_chunks
  union all select 'document_processing_logs', count(*)::text from compass.document_processing_logs
  union all select 'document_chunk_weights', count(*)::text from compass.document_chunk_weights
  union all select 'processing_jobs', count(*)::text from compass.processing_jobs
  union all select 'document_splits', count(*)::text from compass.document_splits
  union all select 'discovered_urls', count(*)::text from compass.discovered_urls
  union all select 'crawl_jobs', count(*)::text from compass.crawl_jobs
  union all select 'processing_metrics', count(*)::text from compass.processing_metrics
  union all select 'url_templates', count(*)::text from compass.url_templates
),
schema_checks as (
  select 'compass_schema_exists' as check_name,
    exists(select 1 from information_schema.schemata where schema_name = 'compass')::text as value
  union all
  select 'search_ollama_documents_function_exists',
    exists(
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'compass'
        and p.proname = 'search_ollama_documents'
        and pg_get_function_identity_arguments(p.oid) = 'query_embedding vector, match_threshold double precision, match_count integer'
    )::text
  union all
  select 'vector_extension_exists',
    exists(select 1 from pg_extension where extname = 'vector')::text
),
grant_checks as (
  select 'service_role_schema_usage' as check_name,
    has_schema_privilege('service_role', 'compass', 'USAGE')::text as value
  union all
  select 'service_role_rpc_execute',
    has_function_privilege(
      'service_role',
      'compass.search_ollama_documents(vector, double precision, integer)',
      'EXECUTE'
    )::text
  union all
  select 'service_role_select_ollama_document_chunks',
    has_table_privilege('service_role', 'compass.ollama_document_chunks', 'SELECT')::text
  union all
  select 'service_role_select_documents',
    has_table_privilege('service_role', 'compass.documents', 'SELECT')::text
  union all
  select 'service_role_select_document_metadata',
    has_table_privilege('service_role', 'compass.document_metadata', 'SELECT')::text
  union all
  select 'service_role_select_document_chunks',
    has_table_privilege('service_role', 'compass.document_chunks', 'SELECT')::text
),
non_target_schema_checks as (
  select 'public_schema_exists' as check_name,
    exists(select 1 from information_schema.schemata where schema_name = 'public')::text as value
  union all
  select 'auth_schema_exists',
    exists(select 1 from information_schema.schemata where schema_name = 'auth')::text
  union all
  select 'openclaw_schema_exists',
    exists(select 1 from information_schema.schemata where schema_name = 'openclaw')::text
  union all
  select 'lens_schema_exists',
    exists(select 1 from information_schema.schemata where schema_name = 'lens')::text
)
select 'row_count' as section, check_name, value from option_b_counts
union all select 'schema_function_vector', check_name, value from schema_checks
union all select 'grant', check_name, value from grant_checks
union all select 'non_target_schema_presence', check_name, value from non_target_schema_checks
order by section, check_name;
