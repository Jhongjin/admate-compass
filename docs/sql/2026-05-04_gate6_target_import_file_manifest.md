# Gate 6 Target Import File Manifest

Gate 6 target files are prepared only after Gate 6A source precheck/export CSV results are reviewed.

No Admate-Vision target data changes are approved by this manifest.

Planned target execution order:

1. `2026-05-04_gate6_target_preclean.sql`
2. `2026-05-04_gate6_target_import_01_documents.sql`
3. `2026-05-04_gate6_target_import_02_document_metadata.sql`
4. `2026-05-04_gate6_target_import_03_document_chunks_part_*.sql`
5. `2026-05-04_gate6_target_import_04_ollama_document_chunks_part_*.sql`
6. `2026-05-04_gate6_target_import_05_processing_jobs.sql`
7. `2026-05-04_gate6_target_import_06_document_splits.sql`
8. `2026-05-04_gate6_target_import_07_discovered_urls.sql`
9. `2026-05-04_gate6_target_import_08_document_processing_logs.sql`
10. `2026-05-04_gate6_target_import_09_document_chunk_weights.sql`
11. `2026-05-04_gate6_target_import_10_crawl_jobs.sql`
12. `2026-05-04_gate6_target_import_11_processing_metrics.sql`
13. `2026-05-04_gate6_target_import_12_url_templates.sql`
14. `2026-05-04_gate6_target_sequence_reset.sql`
15. `2026-05-04_gate6_target_analyze.sql`
16. `2026-05-04_gate6_target_verify.sql`
17. `2026-05-04_gate6_target_rollback.sql`

Option B excluded objects remain excluded:

- `ad_policies`
- `profiles`
- `admin_users`
- `conversations`
- `feedback`
- `api_usage_logs`
- `log_alerts`
- `auth.users`
- `public`, `auth`, `openclaw`, `lens` schemas
