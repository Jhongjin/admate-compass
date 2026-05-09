-- Gate 6C sequence reset after confirmed local runner import.
-- Run only in Admate-Vision SQL Editor after import succeeds.
-- Scope: compass schema Option B identity/serial tables only.

select setval(
  pg_get_serial_sequence('compass.ollama_document_chunks', 'id'),
  coalesce((select max(id) from compass.ollama_document_chunks), 1),
  (select count(*) > 0 from compass.ollama_document_chunks)
);

select setval(
  pg_get_serial_sequence('compass.document_processing_logs', 'id'),
  coalesce((select max(id) from compass.document_processing_logs), 1),
  (select count(*) > 0 from compass.document_processing_logs)
);

select setval(
  pg_get_serial_sequence('compass.document_chunk_weights', 'id'),
  coalesce((select max(id) from compass.document_chunk_weights), 1),
  (select count(*) > 0 from compass.document_chunk_weights)
);

select setval(
  pg_get_serial_sequence('compass.url_templates', 'id'),
  coalesce((select max(id) from compass.url_templates), 1),
  (select count(*) > 0 from compass.url_templates)
);
