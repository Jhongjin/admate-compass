-- Gate 6C target preclean for Option B full import.
-- Run only in Admate-Vision SQL Editor after explicit approval.
-- Scope: compass schema Option B tables only.

begin;

truncate table
  compass.document_chunk_weights,
  compass.document_processing_logs,
  compass.processing_metrics,
  compass.discovered_urls,
  compass.document_splits,
  compass.ollama_document_chunks,
  compass.document_chunks,
  compass.document_metadata,
  compass.processing_jobs,
  compass.crawl_jobs,
  compass.url_templates,
  compass.documents
restart identity cascade;

commit;
