-- Gate 5C source-side read-only precheck.
-- Run this in the Admate_AI_Bot project SQL Editor only.

select 'source_count' as check_name, count(*)::text as value
from public.ollama_document_chunks
union all
select 'non_null_embedding_count', count(*)::text
from public.ollama_document_chunks
where embedding is not null
union all
select
  'embedding_dims_min_max',
  coalesce(min(vector_dims(embedding))::text, 'null') || ',' || coalesce(max(vector_dims(embedding))::text, 'null')
from public.ollama_document_chunks
where embedding is not null
union all
select 'distinct_document_ids', count(distinct document_id)::text
from public.ollama_document_chunks;

select document_id, count(*) as row_count
from public.ollama_document_chunks
group by document_id
order by row_count desc, document_id
limit 20;
