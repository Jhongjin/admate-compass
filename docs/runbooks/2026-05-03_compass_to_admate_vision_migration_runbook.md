# AdMate Compass to Admate-Vision Migration Runbook

작성일: 2026-05-03
상태: Preflight plan only. Do not run migration or data import without separate approval.

## 1. Purpose

Admate_AI_Bot Supabase의 Compass 문서/RAG 인덱스 기능을 Admate-Vision Supabase로 안전하게 이식한다.

이번 migration은 전체 `public` schema 복제가 아니다. 대상 Admate-Vision에는 이미 Openclaw/Lens 테이블과 운영 정책이 있으므로, Compass 관련 객체는 `compass` schema 안에만 생성하고 이식한다.

## 2. Scope

Source:

- Supabase project: `Admate_AI_Bot`
- Role: 현재 AdMate Compass 문서/RAG 데이터의 원본

Target:

- Supabase project: `Admate-Vision`
- Target schema: `compass`
- `public`, `auth`, Openclaw/Lens 관련 table, policy, function, trigger는 수정하지 않는다.

Explicitly excluded from first migration:

- `auth.users`
- `profiles`
- `admin_users`
- `conversations`
- `feedback`
- `api_usage_logs`
- `log_alerts`

No public compatibility view/function will be created.

## 3. Required Tools

### Option 1: PostgreSQL CLI

Required locally or in a controlled migration runner:

- `psql`
- `pg_dump`
- `pg_restore` if using custom dump format

Final direction: use PostgreSQL CLI first. `psql` + `pg_dump` is the preferred execution path because it is repeatable, auditable, and can be reviewed before data is applied. `pg_restore` remains available for custom-format backups and inspection, but direct `public` to `compass` schema remapping is safer with reviewed plain SQL or explicit `psql` copy/import commands.

Connection strings must be loaded from `.env.migration`; never paste them into chat or commit them.

### Option 2: Supabase Dashboard + Node Script

Use Supabase SQL Editor for schema-only SQL review/application and a local Node script for controlled data copy.

This path is fallback only. It can work when PostgreSQL CLI tools are unavailable, but it is easier to introduce copy-order mistakes. It should be used only after the schema runbook and smoke plan are confirmed.

## 4. `.env.migration` Format

Create this file locally only. Do not commit it.

```dotenv
SOURCE_DB_URL=
TARGET_DB_URL=
```

Rules:

- Do not print either value.
- Do not paste either value into chat.
- Do not store service role keys in this file unless a separate migration script explicitly requires them.
- Before running any DB command, verify the file with `npm run check:migration-env`.

## 5. Pre-Run Checks

Run these checks manually against source and target before any schema or data operation. Keep outputs in a private migration note; do not expose credentials.

### 5.1 Source extension and embedding dimensions

Source `Admate_AI_Bot`:

```sql
select extname, extversion
from pg_extension
where extname in ('vector', 'uuid-ossp', 'pgcrypto')
order by extname;

select 'ollama_document_chunks' as table_name, vector_dims(embedding) as dimensions, count(*) as row_count
from public.ollama_document_chunks
where embedding is not null
group by vector_dims(embedding)
order by dimensions;

select 'document_chunks' as table_name, vector_dims(embedding) as dimensions, count(*) as row_count
from public.document_chunks
where embedding is not null
group by vector_dims(embedding)
order by dimensions;

```

Gate 3 Dashboard preflight confirmed:

- `public.document_chunks.embedding = vector(1024)`
- `public.ollama_document_chunks.embedding = vector(1024)`
- `public.ad_policies.embedding = vector(1536)`

`ad_policies` is excluded from v1 because its dimension differs and it is outside the approved first migration scope. Stop if any imported v1 vector table differs from `vector(1024)`.

### 5.2 Target schema collision check

Target `Admate-Vision`:

```sql
select schema_name
from information_schema.schemata
where schema_name in ('compass', 'public', 'auth');

select table_schema, table_name
from information_schema.tables
where table_schema = 'compass'
order by table_name;

select routine_schema, routine_name
from information_schema.routines
where routine_schema = 'compass'
order by routine_name;
```

Stop if `compass` already contains non-empty production objects that have not been reviewed.

### 5.3 Target public/Openclaw/Lens snapshot

Target `Admate-Vision`:

```sql
select schemaname, relname as table_name, n_live_tup as estimated_rows
from pg_stat_user_tables
where schemaname in ('public', 'openclaw', 'lens')
order by schemaname, relname;
```

This is a non-mutating snapshot to confirm the migration does not need to touch existing target schemas.

### 5.4 Migration files and local checks

From the repository:

```bash
npm run verify:migration
npm run type-check
npm run build
```

## 6. Schema Application Order

Apply only after separate approval.

1. Confirm `.env.migration` readiness without printing values.
2. Confirm source embedding dimension and target `compass` collision status.
3. Review `docs/sql/2026-05-03_compass_schema_v1.sql`.
4. Replace candidate vector dimensions only if source confirms a different dimension.
5. Apply schema SQL to target `Admate-Vision`.
6. Confirm all objects were created under `compass` only.
7. Confirm no `public` compatibility view/function was created.

Validation SQL after schema apply:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'compass'
order by table_name;

select routine_schema, routine_name
from information_schema.routines
where routine_schema = 'compass'
order by routine_name;

select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'documents',
    'document_metadata',
    'document_chunks',
    'ollama_document_chunks',
    'document_processing_logs',
    'url_templates'
  )
order by table_name;
```

The final query is for awareness only. It must not be used to create or modify public objects.

## 7. Data Import Scope Options

### Option A: RAG minimal

Includes:

- `compass.ollama_document_chunks`
- `compass.search_ollama_documents`
- Vector extension
- Minimal `compass.documents` metadata only if the UI or source rendering requires it

Pros:

- Smallest blast radius
- Fastest copy and rollback
- Good for validating answer generation and source citation contract

Cons:

- Does not preserve full document management state
- Admin upload/indexing/status screens may be incomplete
- Future repair/reindex flows need more tables later

Use when the immediate goal is only RAG answer serving.

### Option B: Document management full

Includes:

- `compass.documents`
- `compass.document_metadata`
- `compass.document_chunks`
- `compass.ollama_document_chunks`
- `compass.document_processing_logs`
- `compass.document_chunk_weights`
- `compass.processing_jobs`
- `compass.document_splits`
- `compass.discovered_urls`
- `compass.crawl_jobs`
- `compass.processing_metrics`
- `compass.url_templates`

Pros:

- Preserves Compass as a document/RAG product, not only a search endpoint
- Supports upload, indexing, processing status, reindexing, and admin visibility
- Avoids a second near-term migration for document management tables

Cons:

- Larger copy scope
- More FK ordering and row count validation required
- More smoke tests needed before production switch

Final selected path: Option B. `ad_policies` is excluded from the first migration. Compass currently includes document upload, management, indexing, and status surfaces, so RAG-only migration would be operationally incomplete.

## 8. Data Import Order

Apply only after schema is present and source/target checks pass.

1. Parent/core tables:
   - `documents`
   - `crawl_jobs`
2. Metadata and chunks:
   - `document_metadata`
   - `document_chunks`
   - `ollama_document_chunks`
   - `document_chunk_weights`
3. Processing pipeline:
   - `processing_jobs`
   - `document_splits`
   - `discovered_urls`
   - `document_processing_logs`
   - `processing_metrics`
4. Templates:
   - `url_templates`
5. Excluded from first import:
   - `ad_policies`

Recommended validation after each group:

```sql
select 'documents' as table_name, count(*) from compass.documents
union all select 'document_metadata', count(*) from compass.document_metadata
union all select 'document_chunks', count(*) from compass.document_chunks
union all select 'ollama_document_chunks', count(*) from compass.ollama_document_chunks
union all select 'processing_jobs', count(*) from compass.processing_jobs
union all select 'document_splits', count(*) from compass.document_splits
union all select 'discovered_urls', count(*) from compass.discovered_urls
union all select 'url_templates', count(*) from compass.url_templates;
```

## 9. Smoke Test Order

Run smoke tests before production traffic points to `compass`.

1. Static repository checks:
   - `npm run verify:migration`
   - `npm run type-check`
   - `npm run build`
2. DB object smoke:
   - `compass` schema exists
   - target tables exist
   - `compass.search_ollama_documents` exists
   - vector dimensions match source
3. Data smoke:
   - row counts match expected source scope
   - a small sample document has metadata and chunks
   - a small sample vector query returns rows
4. Application smoke with `COMPASS_DB_SCHEMA=compass` in local/staging:
   - `/chat-ollama?q=...` returns response contract fields
   - `sources` remains an array
   - `confidence` remains present
   - `processingTime`, `model`, `isLLMGenerated` remain present
   - document search works
   - admin document status screen loads for admin user
5. Link and safety smoke:
   - no `guide.admate.ai.kr` new UI links
   - no `vercel.app` production links
   - no secret or connection string output in logs

## 10. Residual Public Reference Classification

The static checker originally reported 44 schema review references. The must-fix operational paths below have been converted to the Compass schema-aware helper. The current expected state is 28 review/warn references in debug/repair/test/legacy paths only.

### Must fix before enabling `COMPASS_DB_SCHEMA=compass`

Actual or likely operational paths:

- `src/app/api/download/[documentId]/route.ts`
- `src/app/api/related-questions/route.ts`
- `src/app/api/health/route.ts`

Admin document operations that should be fixed before using target Compass admin features:

- `src/app/api/admin/document-actions/route.ts`
- `src/app/api/admin/upload/[documentId]/reindex/route.ts`
- `src/app/api/admin/monitoring/route.ts`
- `src/app/api/admin/simple-index/route.ts`
- `src/app/api/admin/sync-status/route.ts`
- `src/app/api/admin/clean-titles/route.ts`

Current status: complete. `npm run check:compass-table-references` must fail if any of these files regresses to direct unqualified Compass table access without the schema-aware helper.

### Can fix after migration, before exposing repair/debug tools

Admin/debug/repair/test paths:

- `src/app/api/admin/check-schema/route.ts`
- `src/app/api/admin/debug-db/route.ts`
- `src/app/api/admin/direct-process/route.ts`
- `src/app/api/admin/test-filter/route.ts`
- `src/app/api/check-data-integrity/route.ts`
- `src/app/api/check-embedding-dimension/route.ts`
- `src/app/api/check-real-embedding-dimension/route.ts`
- `src/app/api/check-table-constraints/route.ts`
- `src/app/api/debug-database-state/route.ts`
- `src/app/api/debug-embedding-data/route.ts`
- `src/app/api/fix-embedding-dimension/route.ts`
- `src/app/api/fix-orphaned-chunks/route.ts`
- `src/app/api/force-regenerate-embeddings/route.ts`
- `src/app/api/regenerate-embeddings/route.ts`
- `src/app/api/test-rpc-direct/route.ts`
- `src/app/api/test-rpc-function/route.ts`

### Legacy script paths

Can be migrated or retired after production path is stable:

- `src/scripts/migrate-file-data.ts`
- `src/scripts/sync-document-status.ts`

## 11. Production Transition Plan

Recommended sequence:

1. Keep production default as `COMPASS_DB_SCHEMA=public` or unset.
2. Apply target `compass` schema only after approval.
3. Import approved data scope.
4. Run DB smoke with sample rows.
5. Run local/staging app with `COMPASS_DB_SCHEMA=compass`.
6. Confirm all must-fix operational references from section 10 are schema-aware.
7. Run app smoke again.
8. Enable `COMPASS_DB_SCHEMA=compass` in production only after staging/local smoke passes.

Rollback switch:

- Set `COMPASS_DB_SCHEMA=public` or remove `COMPASS_DB_SCHEMA`.
- Redeploy/restart the app.
- This reverts the application read/write target to the existing production-compatible behavior.

Database rollback should be separate from app rollback. Do not drop `compass` schema unless the migration is explicitly abandoned and the rollback SQL has been approved.

## 12. Rollback Procedure

Application rollback:

1. Set `COMPASS_DB_SCHEMA=public` or unset it.
2. Redeploy/restart.
3. Confirm `/chat-ollama?q=...` works against the previous schema target.

Database rollback, only with explicit approval:

1. Confirm no production traffic is using `compass`.
2. Confirm exported backup exists if imported data must be preserved.
3. Review `docs/sql/2026-05-03_compass_schema_v1_rollback.sql`.
4. Run rollback SQL against target.
5. Confirm only `compass` schema was dropped.

## 13. Stop Conditions

Stop immediately if any condition appears:

- Source `document_chunks` or `ollama_document_chunks` dimensions differ from `vector(1024)`.
- Target `compass` schema already contains unreviewed objects.
- Target `vector` extension creation is not approved for Gate 4.
- Any planned SQL touches `public`, `auth`, Openclaw, or Lens schemas.
- Migration plan includes excluded tables.
- `.env.migration` is missing required keys.
- Any command/log prints connection strings, passwords, tokens, or service role keys.
- Row counts differ unexpectedly after import.
- RAG response contract loses `sources`, `confidence`, `processingTime`, `model`, or `isLLMGenerated`.
- Production app fails when switching back to `COMPASS_DB_SCHEMA=public`.

## 14. Decisions Needed Before Actual Migration

1. Confirm source embedding dimension for every imported vector table.
2. Confirm target `compass` schema is empty or safe to replace.
3. Confirm final import scope: Option B, `ad_policies` excluded.
4. Approve `create extension if not exists vector` in Gate 4 because target preflight reported `vector_extension = missing`.
5. Confirm PostgreSQL CLI execution path or explicitly approve fallback.
6. Prepare `.env.migration` locally and verify only key presence.
7. Select a small sample row set for smoke testing.
8. Approve local/staging `COMPASS_DB_SCHEMA=compass` smoke before production switch.

## 15. PostgreSQL Tool Readiness

Do not install tools until approved.

Check whether tools exist:

```powershell
Get-Command psql -ErrorAction SilentlyContinue
Get-Command pg_dump -ErrorAction SilentlyContinue
Get-Command pg_restore -ErrorAction SilentlyContinue
```

Expected current state on this PC: not installed or not on `PATH`.

Installation options:

- PostgreSQL official installer: install client tools only if available in the installer options, then add `bin` directory to `PATH`.
- PostgreSQL portable ZIP: extract a trusted PostgreSQL binary package and use its `bin` path only for the migration session.
- Supabase CLI alternative: not preferred for this migration because the runbook uses direct PostgreSQL dump/import commands.
- Remote controlled runner: use a secured machine that already has PostgreSQL client tools installed.

Before any DB command is run:

```powershell
npm run check:migration-env
```

This only prints true/false readiness and never prints connection string values.

## 16. Command Templates

These are templates only. Do not run without explicit approval. They assume PowerShell and `.env.migration`.

Load `.env.migration` into process environment without printing values:

```powershell
Get-Content .env.migration | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
```

### 16.1 Source embedding dimension check

```powershell
psql "$env:SOURCE_DB_URL" -v ON_ERROR_STOP=1 -c "
select extname, extversion
from pg_extension
where extname in ('vector', 'uuid-ossp', 'pgcrypto')
order by extname;

select 'ollama_document_chunks' as table_name, vector_dims(embedding) as dimensions, count(*) as row_count
from public.ollama_document_chunks
where embedding is not null
group by vector_dims(embedding)
order by dimensions;

select 'document_chunks' as table_name, vector_dims(embedding) as dimensions, count(*) as row_count
from public.document_chunks
where embedding is not null
group by vector_dims(embedding)
order by dimensions;
"
```

Stop if `ollama_document_chunks` or `document_chunks` dimensions do not match the schema SQL.

### 16.2 Target compass schema existence/collision check

```powershell
psql "$env:TARGET_DB_URL" -v ON_ERROR_STOP=1 -c "
select schema_name
from information_schema.schemata
where schema_name = 'compass';

select table_schema, table_name
from information_schema.tables
where table_schema = 'compass'
order by table_name;

select routine_schema, routine_name
from information_schema.routines
where routine_schema = 'compass'
order by routine_name;
"
```

### 16.3 Target public/openclaw/lens snapshot

```powershell
psql "$env:TARGET_DB_URL" -v ON_ERROR_STOP=1 -c "
select schemaname, relname as table_name, n_live_tup as estimated_rows
from pg_stat_user_tables
where schemaname in ('public', 'openclaw', 'lens')
order by schemaname, relname;
"
```

### 16.4 Apply schema SQL

Only after embedding dimension and target collision checks pass:

```powershell
psql "$env:TARGET_DB_URL" -v ON_ERROR_STOP=1 -f docs/sql/2026-05-03_compass_schema_v1.sql
```

### 16.5 Option B data-only export/import

First migration excludes `ad_policies`.

Preferred reviewed plain SQL flow:

```powershell
New-Item -ItemType Directory -Force -Path .migration-work | Out-Null

pg_dump "$env:SOURCE_DB_URL" `
  --data-only `
  --column-inserts `
  --table=public.documents `
  --table=public.crawl_jobs `
  --table=public.document_metadata `
  --table=public.document_chunks `
  --table=public.ollama_document_chunks `
  --table=public.document_chunk_weights `
  --table=public.processing_jobs `
  --table=public.document_splits `
  --table=public.discovered_urls `
  --table=public.document_processing_logs `
  --table=public.processing_metrics `
  --table=public.url_templates `
  --file=.migration-work/compass_option_b_public_data.sql
```

Review that the dump contains only approved tables, then rewrite only approved `public` table qualifiers to `compass` in a generated copy:

```powershell
$approvedTables = 'documents|crawl_jobs|document_metadata|document_chunks|ollama_document_chunks|document_chunk_weights|processing_jobs|document_splits|discovered_urls|document_processing_logs|processing_metrics|url_templates'
$dump = Get-Content .migration-work/compass_option_b_public_data.sql -Raw
$rewritten = $dump -replace "public\.($approvedTables)", 'compass.$1'
Set-Content .migration-work/compass_option_b_compass_data.sql $rewritten
Select-String -Path .migration-work/compass_option_b_compass_data.sql -Pattern 'public\.|auth\.|profiles|admin_users|conversations|feedback|api_usage_logs|log_alerts|ad_policies'
```

The final `Select-String` should return no matches. If it returns matches, stop and review.

Import:

```powershell
psql "$env:TARGET_DB_URL" -v ON_ERROR_STOP=1 -f .migration-work/compass_option_b_compass_data.sql
```

`pg_restore` note: use custom-format dumps for backup/list/inspection when needed, but do not rely on `pg_restore` to remap source `public` objects into target `compass` unless a separately reviewed remap strategy is approved.

### 16.6 Sequence reset after import

Run after data import if integer sequence-backed tables were imported:

```powershell
psql "$env:TARGET_DB_URL" -v ON_ERROR_STOP=1 -c "
select setval(pg_get_serial_sequence('compass.document_processing_logs', 'id'), coalesce((select max(id) from compass.document_processing_logs), 1), true);
select setval(pg_get_serial_sequence('compass.document_chunk_weights', 'id'), coalesce((select max(id) from compass.document_chunk_weights), 1), true);
select setval(pg_get_serial_sequence('compass.ollama_document_chunks', 'id'), coalesce((select max(id) from compass.ollama_document_chunks), 1), true);
"
```

If any table has no sequence in the final schema, that statement should be removed before execution.

### 16.7 Index/vector maintenance

After full import:

```powershell
psql "$env:TARGET_DB_URL" -v ON_ERROR_STOP=1 -c "
analyze compass.documents;
analyze compass.document_metadata;
analyze compass.document_chunks;
analyze compass.ollama_document_chunks;
analyze compass.processing_jobs;
analyze compass.document_splits;
analyze compass.discovered_urls;
analyze compass.url_templates;
"
```

If vector indexes are rebuilt manually, choose `ivfflat` `lists` only after row count is known. A conservative starting point is to use the migration SQL default first, then tune after measuring query latency. Stop if embedding dimension mismatch appears at index creation or insert time.

### 16.8 `compass.search_ollama_documents` smoke

Use a query term known to exist in the sample or imported dataset:

```powershell
psql "$env:TARGET_DB_URL" -v ON_ERROR_STOP=1 -c "
select id, document_id, left(content, 120) as preview, similarity
from compass.search_ollama_documents(
  'REPLACE_WITH_TEST_QUERY',
  null,
  5,
  0.1
);
"
```

Expected: returns rows for known data and does not error. Do not use this to judge answer quality; it only checks RPC shape and vector/search availability.

### 16.9 Compass app smoke

Local/staging only:

```powershell
$env:COMPASS_DB_SCHEMA='compass'
npm run type-check
npm run build
npm run verify:migration
```

Then test:

- Root page loads.
- `/chat-ollama?q=REPLACE_WITH_TEST_QUERY` returns the existing response contract.
- `sources`, `confidence`, `processingTime`, `model`, `isLLMGenerated` are present where expected.
- Admin document screens load for admin users.

Production `COMPASS_DB_SCHEMA=compass` must be enabled only after this smoke passes.

### 16.10 Rollback commands

Application rollback:

```powershell
$env:COMPASS_DB_SCHEMA='public'
# Redeploy or restart the app through the approved hosting workflow.
```

Database rollback, only if explicitly approved:

```powershell
psql "$env:TARGET_DB_URL" -v ON_ERROR_STOP=1 -f docs/sql/2026-05-03_compass_schema_v1_rollback.sql
```

## 17. Sample Row Smoke Plan

Recommended before full import if the control tower wants a smaller live proof:

1. Pick one source `documents.id` that has related `document_metadata`, `document_chunks`, and `ollama_document_chunks`.
2. Export/import only that document and related rows into `compass`.
3. Preserve FK order:
   - `documents`
   - `document_metadata`
   - `document_chunks`
   - `ollama_document_chunks`
   - `document_chunk_weights` if rows exist for the sampled document/chunks
   - `processing_jobs`, `document_splits`, `discovered_urls`, `document_processing_logs`, `processing_metrics` only if the sampled document needs processing-history smoke
4. Run sequence reset for any sequence-backed table touched by the sample.
5. Run `analyze` on touched tables.
6. Run `compass.search_ollama_documents` with a term that exists in the sample content.
7. Run local/staging app with `COMPASS_DB_SCHEMA=compass`.

Sample export can be done with `psql` `\copy` queries into local files, then `\copy compass.<table>` into target. This is more manual than full `pg_dump`, but safer for a tiny smoke because it avoids importing unrelated rows.

Stop if:

- The selected sample has orphan chunks or missing metadata.
- Any FK insert fails.
- Any vector insert fails because of dimension mismatch.
- Search RPC returns shape errors.

## 18. Sequence, Index, and Vector Notes

- Sequence reset is required after importing explicit IDs into sequence-backed tables.
- UUID primary keys do not need sequence reset.
- `document_chunks.id` is text in the current design and does not need sequence reset.
- `ollama_document_chunks.id`, `document_processing_logs.id`, and `document_chunk_weights.id` should be reviewed for sequence reset.
- Run `analyze` after import so planner statistics reflect imported rows.
- Vector index creation can fail if any embedding dimension differs from the column definition.
- `ivfflat` `lists` should not be over-tuned before actual row counts are known. Start conservative, measure, then tune.
- If dimensions differ between `document_chunks` and `ollama_document_chunks`, stop and revise schema SQL before any target import.

## 19. Final Approval Checklist

The user/control tower must explicitly approve each item before execution:

1. `.env.migration` prepared locally.
2. PostgreSQL client tools installation or approved runner selected.
3. Embedding dimension check approved.
4. Target `compass` collision check approved.
5. Target public/openclaw/lens snapshot approved.
6. Schema SQL application approved.
7. Sample import approved, if using sample smoke.
8. Full Option B import approved.
9. Sequence reset and analyze approved.
10. Local/staging `COMPASS_DB_SCHEMA=compass` app smoke approved.
11. Production `COMPASS_DB_SCHEMA=compass` switch approved.
12. Rollback procedure approved.
