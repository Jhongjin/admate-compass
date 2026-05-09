-- Gate 6A source precheck for Admate_AI_Bot.
-- Run in Admate_AI_Bot SQL Editor.
-- SELECT-only: no data or schema changes.

with option_b_tables(table_name) as (
  values
    ('documents'),
    ('document_metadata'),
    ('document_chunks'),
    ('ollama_document_chunks'),
    ('document_processing_logs'),
    ('document_chunk_weights'),
    ('processing_jobs'),
    ('document_splits'),
    ('discovered_urls'),
    ('crawl_jobs'),
    ('processing_metrics'),
    ('url_templates')
),
source_columns as (
  select
    table_name,
    array_agg(column_name order by ordinal_position) as columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name in (select table_name from option_b_tables)
  group by table_name
),
expected_columns(table_name, columns) as (
  values
    ('documents', array['id','title','content','type','document_url','created_at','updated_at','chunk_count','status','url','size','file_size','file_type','source_vendor','split_status','main_document_id','original_file_name','sanitized_file_name','metadata']),
    ('document_metadata', array['id','title','type','size','uploaded_at','processed_at','status','chunk_count','embedding_count','metadata','created_at','updated_at','original_file_name']),
    ('document_chunks', array['id','document_id','chunk_id','content','embedding','created_at','metadata','parent_chunk_id','hierarchy_level']),
    ('ollama_document_chunks', array['id','document_id','chunk_id','content','embedding','metadata','created_at','updated_at']),
    ('document_processing_logs', array['id','document_id','step','status','message','error','metadata','created_at']),
    ('document_chunk_weights', array['id','document_id','chunk_id','positive_feedback_count','negative_feedback_count','weight_score','last_updated','created_at']),
    ('processing_jobs', array['id','document_id','job_type','status','priority','attempts','max_attempts','error','payload','result','scheduled_at','started_at','finished_at','created_at','updated_at']),
    ('document_splits', array['id','document_id','split_index','split_count','content','start_char','end_char','page_number','section_title','status','job_id','created_at','updated_at']),
    ('discovered_urls', array['id','job_id','url','title','depth','parent_url','path','source','selected','created_at','updated_at']),
    ('crawl_jobs', array['id','url','status','pages_crawled','created_at','updated_at']),
    ('processing_metrics', array['id','job_id','document_id','bytes','dl_ms','parse_ms','ocr_ms','emb_ms','total_ms','text_length','chunks','note','created_at']),
    ('url_templates', array['id','name','urls','vendor','created_at','updated_at'])
),
compatibility as (
  select
    e.table_name,
    coalesce(s.columns, array[]::text[]) as source_columns,
    e.columns as target_columns,
    array(select unnest(e.columns) except select unnest(coalesce(s.columns, array[]::text[]))) as missing_in_source,
    array(select unnest(coalesce(s.columns, array[]::text[])) except select unnest(e.columns)) as extra_in_source
  from expected_columns e
  left join source_columns s on s.table_name = e.table_name
)
select 'row_count' as section, 'documents' as check_name, count(*)::text as value
from public.documents
union all
select 'row_count', 'document_metadata', count(*)::text from public.document_metadata
union all
select 'row_count', 'document_chunks', count(*)::text from public.document_chunks
union all
select 'row_count', 'ollama_document_chunks', count(*)::text from public.ollama_document_chunks
union all
select 'row_count', 'document_processing_logs', count(*)::text from public.document_processing_logs
union all
select 'row_count', 'document_chunk_weights', count(*)::text from public.document_chunk_weights
union all
select 'row_count', 'processing_jobs', count(*)::text from public.processing_jobs
union all
select 'row_count', 'document_splits', count(*)::text from public.document_splits
union all
select 'row_count', 'discovered_urls', count(*)::text from public.discovered_urls
union all
select 'row_count', 'crawl_jobs', count(*)::text from public.crawl_jobs
union all
select 'row_count', 'processing_metrics', count(*)::text from public.processing_metrics
union all
select 'row_count', 'url_templates', count(*)::text from public.url_templates
union all
select 'embedding', 'document_chunks_embedding_non_null', count(*)::text
from public.document_chunks
where embedding is not null
union all
select 'embedding', 'ollama_document_chunks_embedding_non_null', count(*)::text
from public.ollama_document_chunks
where embedding is not null
union all
select 'embedding', 'document_chunks_embedding_dims_min_max',
  coalesce(min(vector_dims(embedding))::text, 'null') || ',' || coalesce(max(vector_dims(embedding))::text, 'null')
from public.document_chunks
where embedding is not null
union all
select 'embedding', 'ollama_document_chunks_embedding_dims_min_max',
  coalesce(min(vector_dims(embedding))::text, 'null') || ',' || coalesce(max(vector_dims(embedding))::text, 'null')
from public.ollama_document_chunks
where embedding is not null
union all
select 'link_quality', 'document_chunks_linked_to_documents',
  count(d.id)::text || '/' || count(*)::text
from public.document_chunks c
left join public.documents d on d.id = c.document_id
union all
select 'link_quality', 'ollama_document_chunks_linked_to_documents',
  count(d.id)::text || '/' || count(*)::text
from public.ollama_document_chunks c
left join public.documents d on d.id = c.document_id
union all
select 'link_quality', 'document_metadata_linked_to_documents',
  count(d.id)::text || '/' || count(*)::text
from public.document_metadata m
left join public.documents d on d.id = m.id
union all
select 'link_quality', 'processing_jobs_linked_to_documents',
  count(d.id)::text || '/' || count(p.document_id)::text
from public.processing_jobs p
left join public.documents d on d.id = p.document_id
where p.document_id is not null
union all
select 'link_quality', 'document_splits_linked_to_documents',
  count(d.id)::text || '/' || count(*)::text
from public.document_splits s
left join public.documents d on d.id = s.document_id
union all
select 'link_quality', 'document_splits_linked_to_processing_jobs',
  count(p.id)::text || '/' || count(s.job_id)::text
from public.document_splits s
left join public.processing_jobs p on p.id = s.job_id
where s.job_id is not null
union all
select 'link_quality', 'discovered_urls_linked_to_processing_jobs',
  count(p.id)::text || '/' || count(u.job_id)::text
from public.discovered_urls u
left join public.processing_jobs p on p.id = u.job_id
where u.job_id is not null
union all
select 'metadata_quality', 'documents_metadata_title_present',
  count(*) filter (where metadata ? 'title' or title is not null)::text || '/' || count(*)::text
from public.documents
union all
select 'metadata_quality', 'documents_metadata_source_url_present',
  count(*) filter (where metadata ? 'source_url' or url is not null or document_url is not null)::text || '/' || count(*)::text
from public.documents
union all
select 'metadata_quality', 'documents_metadata_document_url_present',
  count(*) filter (where metadata ? 'document_url' or document_url is not null)::text || '/' || count(*)::text
from public.documents
union all
select 'metadata_quality', 'ollama_metadata_title_present',
  count(*) filter (where metadata ? 'title')::text || '/' || count(*)::text
from public.ollama_document_chunks
union all
select 'metadata_quality', 'ollama_metadata_source_url_present',
  count(*) filter (where metadata ? 'source_url' or metadata ? 'document_url')::text || '/' || count(*)::text
from public.ollama_document_chunks
union all
select 'duplicate_candidates', 'document_chunks_duplicate_document_chunk',
  count(*)::text
from (
  select document_id, chunk_id
  from public.document_chunks
  group by document_id, chunk_id
  having count(*) > 1
) dup
union all
select 'duplicate_candidates', 'ollama_chunks_duplicate_document_chunk',
  count(*)::text
from (
  select document_id, chunk_id
  from public.ollama_document_chunks
  group by document_id, chunk_id
  having count(*) > 1
) dup
union all
select 'schema_compatibility', table_name,
  jsonb_build_object(
    'missing_in_source', missing_in_source,
    'extra_in_source', extra_in_source
  )::text
from compatibility
order by section, check_name;
