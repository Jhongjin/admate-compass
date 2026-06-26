-- Phase 0: document_chunks vector search RPC for Compass RAG.
-- Keeps the existing ollama_document_chunks path available behind COMPASS_SEARCH_SOURCE=ollama.

create index if not exists idx_compass_document_chunks_embedding
on compass.document_chunks
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

create or replace function compass.search_documents(
  query_embedding vector(1024),
  match_threshold double precision default 0.001,
  match_count int default 5,
  vendor_filter text default null
)
returns table (
  id text,
  chunk_id text,
  document_id text,
  content text,
  metadata jsonb,
  similarity double precision,
  embedding vector(1024)
)
language plpgsql
stable
as $$
begin
  return query
  select
    dc.id,
    dc.chunk_id::text as chunk_id,
    dc.document_id,
    dc.content,
    coalesce(dc.metadata, '{}'::jsonb) as metadata,
    1 - (dc.embedding <=> query_embedding) as similarity,
    dc.embedding
  from compass.document_chunks dc
  where dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) > match_threshold
    and (
      vendor_filter is null
      or vendor_filter = ''
      or upper(coalesce(
        dc.metadata->>'source_vendor',
        dc.metadata->>'sourceVendor',
        dc.metadata->>'vendor',
        ''
      )) = upper(vendor_filter)
    )
  order by dc.embedding <=> query_embedding
  limit match_count;
end;
$$;

grant execute on function compass.search_documents(vector, double precision, int, text)
to anon, authenticated, service_role;

grant select on compass.document_chunks
to anon, authenticated, service_role;
