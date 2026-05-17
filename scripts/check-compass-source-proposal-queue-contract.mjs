#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(`[check-compass-source-proposal-queue-contract] ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    fail(`missing ${relativePath}`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

const sql = read("docs/sql/2026-05-16_compass_source_proposal_queue.sql").toLowerCase();
const rollback = read("docs/sql/2026-05-16_compass_source_proposal_queue_rollback.sql").toLowerCase();
const verify = read("docs/sql/2026-05-16_compass_source_proposal_queue_verify.sql").toLowerCase();
const service = read("src/lib/services/CompassSourceProposalQueueService.ts");
const route = read("src/app/api/admin/source-ops/proposals/route.ts");
const tableReferenceCheck = read("scripts/check-compass-table-references.mjs");
const reviewApplyPlan = read("docs/tasks/2026-05-17_compass_source_proposal_review_apply_contract_plan_v1.md");

for (const token of [
  "create table if not exists compass.source_proposal_runs",
  "create table if not exists compass.source_proposal_queue",
  "check (dry_run = true)",
  "check (mutation_enabled = false)",
  "check (would_index = false)",
  "check (would_promote = false)",
  "grant select, insert on compass.source_proposal_runs to service_role",
  "grant select, insert, update on compass.source_proposal_queue to service_role",
]) {
  if (!sql.includes(token)) {
    fail(`source proposal queue SQL missing ${token}`);
  }
}

for (const forbiddenGrant of [" to anon", " to authenticated"]) {
  if (sql.includes(forbiddenGrant)) {
    fail(`source proposal queue SQL must not grant access${forbiddenGrant}`);
  }
}

for (const token of [
  "drop table if exists compass.source_proposal_queue",
  "drop table if exists compass.source_proposal_runs",
]) {
  if (!rollback.includes(token)) {
    fail(`source proposal queue rollback missing ${token}`);
  }
}

for (const token of [
  "source_proposal_runs",
  "source_proposal_queue",
  "pg_indexes",
  "information_schema.triggers",
  "information_schema.role_table_grants",
]) {
  if (!verify.includes(token)) {
    fail(`source proposal queue verify missing ${token}`);
  }
}

for (const token of [
  "COMPASS_SOURCE_PROPOSAL_QUEUE_READ_ENABLED",
  "COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED",
  "process.env.NODE_ENV === 'production'",
  "readEnabled",
  "writeEnabled",
  "source_proposal_runs",
  "source_proposal_queue",
  "readCompassSourceProposalQueueSnapshot",
  "readStatus: 'disabled'",
  "readStatus: 'unavailable'",
  "readStatus: 'ready'",
  "pendingCandidates",
  "reviewStatusCounts",
  "riskLevelCounts",
  "readQueueReviewStatusCounts",
  "readQueueRiskLevelCounts",
  "recentCandidates",
  "runId",
  "canonicalUrl",
  "contentPreview",
  "contentLength",
  "fetchedAt",
  "sourceStatus",
  "would_index: false",
  "would_promote: false",
]) {
  if (!service.includes(token)) {
    fail(`queue service missing ${token}`);
  }
}

if (!route.includes("queueSnapshot") || !route.includes("readCompassSourceProposalQueueSnapshot")) {
  fail("proposal route must expose queue readback without enabling persistence");
}

if (!route.includes("queueLimit") || !route.includes("readCompassSourceProposalQueueSnapshot(queueLimit)")) {
  fail("proposal route must expose bounded queueLimit for read-only queue inventory");
}

if (!route.includes("guardProductionAdminSessionRoute")) {
  fail("proposal queue POST must be production-session guarded");
}

if (!route.includes("dryRun !== true")) {
  fail("proposal queue POST must reject non-dry-run writes");
}

for (const forbidden of [
  "DocumentIndexingService",
  "documentIndexingService",
  "VectorStorageService",
  "vectorStorageService",
  "saveChunks",
  "saveDocument(",
  "updateDocumentStatus",
  "deleteDocument",
]) {
  if (service.includes(forbidden) || route.includes(forbidden)) {
    fail(`queue path must not import or call corpus mutation API: ${forbidden}`);
  }
}

for (const token of ["source_proposal_runs", "source_proposal_queue"]) {
  if (!tableReferenceCheck.includes(`"${token}"`)) {
    fail(`table reference checker missing ${token}`);
  }
}

for (const token of [
  "docs and guard only",
  "does not yet have an",
  "`dry_run=true`",
  "`mutation_enabled=false`",
  "`would_index=false`",
  "`would_promote=false`",
  "`review_status` is limited",
  "authenticated admin or internal worker authority",
  "required review reason",
  "immutable review audit trail",
  "idempotency key and apply lock",
  "Do not skip from proposal queue directly to corpus promotion",
  "approve or reject buttons on `/admin/source-ops`",
  "`POST` apply controls from the source ops page",
  "direct writes to `documents`, `document_chunks`, `ollama_document_chunks`, or",
  "Production persistence remains blocked",
]) {
  if (!reviewApplyPlan.includes(token)) {
    fail(`source proposal review/apply plan missing ${token}`);
  }
}

if (!process.exitCode) {
  console.log("[check-compass-source-proposal-queue-contract] ok");
}
