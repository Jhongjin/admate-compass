-- Gate RAG-3F: sample import verify SQL.
-- SELECT-only. Run after Gate RAG-3G import approval/execution.

with rag3f as (
  select *
  from compass.ollama_document_chunks
  where metadata->>'rag_gate' = 'RAG-3F'
     or chunk_id like 'rag3d_%'
), original as (
  select *
  from compass.ollama_document_chunks
  where coalesce(metadata->>'rag_gate', '') <> 'RAG-3F'
    and chunk_id not like 'rag3d_%'
), checks as (
  select 'ollama_document_chunks_total' as check_name, count(*)::text as value from compass.ollama_document_chunks
  union all
  select 'rag3f_rows', count(*)::text from rag3f
  union all
  select 'original_rows_preserved_min_6', count(*)::text from original
  union all
  select 'rag3f_embedding_non_null', count(*) filter (where embedding is not null)::text from rag3f
  union all
  select 'rag3f_embedding_dim_min_max', concat(min(vector_dims(embedding)), ',', max(vector_dims(embedding))) from rag3f where embedding is not null
  union all
  select 'rag3f_duplicate_chunk_id_count', count(*)::text from (select chunk_id from compass.ollama_document_chunks group by chunk_id having count(*) > 1) d
  union all
  select 'rag3f_existing_original_6_preserved', (count(*) >= 6)::text from original
), vendor_counts as (
  select concat('rag3f_vendor_', coalesce(metadata->>'source_vendor', 'UNKNOWN')) as check_name, count(*)::text as value
  from rag3f
  group by coalesce(metadata->>'source_vendor', 'UNKNOWN')
), fixture_counts as (
  select concat('rag3f_fixture_', fixture_id) as check_name, count(*)::text as value
  from rag3f
  cross join lateral jsonb_array_elements_text(coalesce(metadata->'fixture_matches', '[]'::jsonb)) as fixture_id
  group by fixture_id
), rpc_smoke as (
  select 'rag3f_rpc_self_match_count' as check_name, count(*)::text as value
  from compass.search_ollama_documents(
    (select embedding from rag3f where embedding is not null limit 1),
    0.1,
    5
  )
)
select * from checks
union all select * from vendor_counts
union all select * from fixture_counts
union all select * from rpc_smoke
order by check_name;
