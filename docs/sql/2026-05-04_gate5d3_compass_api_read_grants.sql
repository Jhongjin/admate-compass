-- Gate 5D-3: Admate-Vision compass API read permission grants.
-- Execute in Admate-Vision SQL Editor only after approval.
-- Scope: RAG smoke read/execute access for the server-side Supabase service role.

begin;

grant usage on schema compass to service_role;

grant execute on function compass.search_ollama_documents(vector, double precision, integer)
to service_role;

grant select on compass.ollama_document_chunks
to service_role;

grant select on compass.documents
to service_role;

grant select on compass.document_metadata
to service_role;

grant select on compass.document_chunks
to service_role;

commit;
