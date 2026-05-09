-- Gate 5C target-side read-only verification.
-- Run this in the Admate-Vision project SQL Editor after approved sample INSERT execution.

select 'ollama_document_chunks_total' as check_name, count(*)::text as value
from compass.ollama_document_chunks
union all
select 'ollama_document_chunks_embedding_non_null', count(*)::text
from compass.ollama_document_chunks
where embedding is not null
union all
select
  'ollama_embedding_dims_min_max',
  coalesce(min(vector_dims(embedding))::text, 'null') || ',' || coalesce(max(vector_dims(embedding))::text, 'null')
from compass.ollama_document_chunks
where embedding is not null
union all
select 'linked_to_existing_documents', count(*)::text
from compass.ollama_document_chunks oc
join compass.documents d on d.id = oc.document_id
union all
select 'rpc_result_count', count(*)::text
from compass.search_ollama_documents(
  array_fill(0.001::float4, array[1024])::vector,
  0.001,
  5
);

select
  oc.document_id,
  count(*) as ollama_chunk_count,
  case when d.id is null then false else true end as linked_to_compass_documents
from compass.ollama_document_chunks oc
left join compass.documents d on d.id = oc.document_id
group by oc.document_id, d.id
order by ollama_chunk_count desc, oc.document_id;
