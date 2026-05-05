-- Gate RAG-3K: targeted sample verify.
-- Run in Admate-Vision SQL Editor after the RAG-3K insert.
-- SELECT-only. Do not execute INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER.

with rag3k as (
  select *
  from compass.ollama_document_chunks
  where metadata->>'rag_gate' = 'RAG-3K'
     or chunk_id like 'rag3j_%'
),
rag3f as (
  select *
  from compass.ollama_document_chunks
  where metadata->>'rag_gate' = 'RAG-3F'
     or chunk_id like 'rag3d_%'
),
original_rows as (
  select *
  from compass.ollama_document_chunks
  where coalesce(metadata->>'rag_gate', '') not in ('RAG-3F', 'RAG-3K')
    and chunk_id not like 'rag3d_%'
    and chunk_id not like 'rag3j_%'
),
duplicate_rag3k as (
  select chunk_id, count(*) as count
  from rag3k
  group by chunk_id
  having count(*) > 1
),
rpc_smoke as (
  select count(*) as result_count
  from compass.search_ollama_documents(
    (select embedding from rag3k where embedding is not null limit 1),
    0.1::double precision,
    5
  )
)
select 'ollama_document_chunks_total' as check_name, count(*)::text as value from compass.ollama_document_chunks
union all
select 'rag3k_rows', count(*)::text from rag3k
union all
select 'rag3f_rows_preserved', count(*)::text from rag3f
union all
select 'original_rows_preserved', count(*)::text from original_rows
union all
select 'rag3k_embedding_non_null', count(*) filter (where embedding is not null)::text from rag3k
union all
select 'rag3k_embedding_dim_min_max', concat(min(vector_dims(embedding)), '/', max(vector_dims(embedding))) from rag3k where embedding is not null
union all
select 'rag3k_duplicate_chunk_id_count', count(*)::text from duplicate_rag3k
union all
select 'rag3k_price_discount_count', count(*)::text from rag3k where metadata->>'topic_target' = 'price_discount'
union all
select 'rag3k_gambling_policy_count', count(*)::text from rag3k where metadata->>'topic_target' = 'gambling_policy'
union all
select 'rag3k_rpc_self_match_count', result_count::text from rpc_smoke
order by check_name;

-- Optional detail preview (SELECT-only):
-- select
--   metadata->>'topic_target' as topic_target,
--   metadata->>'source_vendor' as source_vendor,
--   metadata->>'canonical_title' as canonical_title,
--   metadata->>'source_title' as source_title,
--   chunk_id,
--   vector_dims(embedding) as embedding_dim
-- from rag3k
-- order by topic_target, source_vendor, chunk_id;
