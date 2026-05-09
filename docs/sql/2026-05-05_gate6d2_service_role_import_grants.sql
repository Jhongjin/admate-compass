-- Gate 6D-2 service_role import grants.
-- Run only in Admate-Vision SQL Editor after explicit approval.
-- Scope: compass schema Option B tables only.
-- Purpose: allow local runner batch inserts through Supabase Data API.

grant insert on
  compass.documents,
  compass.document_metadata,
  compass.document_chunks,
  compass.ollama_document_chunks,
  compass.document_processing_logs,
  compass.document_chunk_weights,
  compass.processing_jobs,
  compass.document_splits,
  compass.discovered_urls,
  compass.crawl_jobs,
  compass.processing_metrics,
  compass.url_templates
to service_role;
