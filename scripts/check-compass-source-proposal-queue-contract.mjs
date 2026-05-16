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

for (const token of ["source_proposal_runs", "source_proposal_queue"]) {
  if (!verify.includes(token)) {
    fail(`source proposal queue verify missing ${token}`);
  }
}

for (const token of [
  "COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED",
  "process.env.NODE_ENV === 'production'",
  "source_proposal_runs",
  "source_proposal_queue",
  "would_index: false",
  "would_promote: false",
]) {
  if (!service.includes(token)) {
    fail(`queue service missing ${token}`);
  }
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

if (!process.exitCode) {
  console.log("[check-compass-source-proposal-queue-contract] ok");
}
