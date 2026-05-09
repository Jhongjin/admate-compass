-- Gate 6C target verify after confirmed local runner import.
-- SELECT-only. Do not print embedding values.

with counts as (
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
embedding_checks as (
  select 'document_chunks_embedding_non_null' as check_name, count(*)::text as value
  from compass.document_chunks
  where embedding is not null
  union all
  select 'document_chunks_embedding_dims_min_max',
    coalesce(min(vector_dims(embedding))::text, 'null') || ',' || coalesce(max(vector_dims(embedding))::text, 'null')
  from compass.document_chunks
  where embedding is not null
  union all
  select 'ollama_document_chunks_embedding_non_null', count(*)::text
  from compass.ollama_document_chunks
  where embedding is not null
  union all
  select 'ollama_document_chunks_embedding_dims_min_max',
    coalesce(min(vector_dims(embedding))::text, 'null') || ',' || coalesce(max(vector_dims(embedding))::text, 'null')
  from compass.ollama_document_chunks
  where embedding is not null
),
link_checks as (
  select 'document_metadata_linked_to_documents' as check_name,
    count(d.id)::text || '/' || count(m.id)::text as value
  from compass.document_metadata m
  left join compass.documents d on d.id = m.id
  union all
  select 'document_chunks_linked_to_documents',
    count(d.id)::text || '/' || count(c.id)::text
  from compass.document_chunks c
  left join compass.documents d on d.id = c.document_id
  union all
  select 'ollama_document_chunks_linked_to_documents',
    count(d.id)::text || '/' || count(o.id)::text
  from compass.ollama_document_chunks o
  left join compass.documents d on d.id = o.document_id
  union all
  select 'processing_jobs_linked_to_documents',
    count(d.id)::text || '/' || count(p.id)::text
  from compass.processing_jobs p
  left join compass.documents d on d.id = p.document_id
),
duplicate_checks as (
  select 'document_chunks_duplicate_document_chunk' as check_name, count(*)::text as value
  from (
    select document_id, chunk_id
    from compass.document_chunks
    group by document_id, chunk_id
    having count(*) > 1
  ) x
  union all
  select 'ollama_chunks_duplicate_document_chunk', count(*)::text
  from (
    select document_id, chunk_id
    from compass.ollama_document_chunks
    group by document_id, chunk_id
    having count(*) > 1
  ) x
),
rpc_smoke as (
  select 'rpc_result_count' as check_name, count(*)::text as value
  from compass.search_ollama_documents(
    (select embedding from compass.ollama_document_chunks where embedding is not null limit 1),
    0.1,
    5
  )
)
select 'row_count' as section, check_name, value from counts
union all select 'embedding', check_name, value from embedding_checks
union all select 'link_quality', check_name, value from link_checks
union all select 'duplicate_candidates', check_name, value from duplicate_checks
union all select 'rpc_smoke', check_name, value from rpc_smoke
order by section, check_name;
