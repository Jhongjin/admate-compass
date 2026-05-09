-- Gate 6D-2 service_role import grant rollback.
-- Run only in Admate-Vision SQL Editor after explicit approval.
-- Scope: compass schema Option B tables only.
-- Gate 5D-3 read/execute grants are intentionally preserved.

revoke insert on
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
from service_role;
