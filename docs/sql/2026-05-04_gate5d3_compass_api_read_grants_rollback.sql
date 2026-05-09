-- Gate 5D-3 rollback: revoke Admate-Vision compass API read permission grants.
-- Execute in Admate-Vision SQL Editor only if Gate 5D-3 grants must be rolled back.

begin;

revoke select on compass.document_chunks
from service_role;

revoke select on compass.document_metadata
from service_role;

revoke select on compass.documents
from service_role;

revoke select on compass.ollama_document_chunks
from service_role;

revoke execute on function compass.search_ollama_documents(vector, double precision, integer)
from service_role;

revoke usage on schema compass
from service_role;

commit;
