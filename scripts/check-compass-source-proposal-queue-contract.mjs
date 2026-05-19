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
const proposalService = read("src/lib/services/CompassSourceProposalService.ts");
const workerService = read("src/lib/services/CompassSourceProposalWorkerService.ts");
const route = read("src/app/api/admin/source-ops/proposals/route.ts");
const workerRoute = read("src/app/api/internal/source-proposals/dry-run/route.ts");
const sourceOpsPage = read("src/app/admin/source-ops/page.tsx");
const tableReferenceCheck = read("scripts/check-compass-table-references.mjs");
const reviewApplyPlan = read("docs/tasks/2026-05-17_compass_source_proposal_review_apply_contract_plan_v1.md");

const proposalBoundaryFiles = [
  ["src/lib/services/CompassSourceProposalService.ts", proposalService],
  ["src/lib/services/CompassSourceProposalQueueService.ts", service],
  ["src/lib/services/CompassSourceProposalWorkerService.ts", workerService],
  ["src/app/api/admin/source-ops/proposals/route.ts", route],
  ["src/app/api/internal/source-proposals/dry-run/route.ts", workerRoute],
  ["src/app/admin/source-ops/page.tsx", sourceOpsPage],
];

const corpusTables = [
  "documents",
  "document_chunks",
  "embeddings",
  "ollama_document_chunks",
];

const writeMethods = [
  "insert",
  "upsert",
  "update",
  "delete",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoCorpusTableWrites(files) {
  for (const [relativePath, text] of files) {
    for (const table of corpusTables) {
      for (const method of writeMethods) {
        const pattern = new RegExp(
          `\\.from\\(\\s*['"\`]${escapeRegExp(table)}['"\`]\\s*\\)[\\s\\S]{0,1200}?\\.${method}\\s*\\(`,
          "m",
        );
        if (pattern.test(text)) {
          fail(`${relativePath} must not ${method} corpus table ${table} from the source proposal boundary`);
        }
      }
    }
  }
}

function assertNoPlaceholderEmbeddingFixtures(files) {
  const forbiddenPatterns = [
    [/dummyChunk\b/i, "dummyChunk"],
    [/dummy\s+chunks/i, "dummy chunks"],
    [/new\s+Array\s*\([^)]*\)\s*\.fill\s*\(\s*0\s*\)/, "new Array(...).fill(0)"],
    [/\bembedding\s*:\s*null\b/, "embedding: null"],
    [/\.is\s*\(\s*['"]embedding['"]\s*,\s*null\s*\)/, ".is('embedding', null)"],
  ];

  for (const [relativePath, text] of files) {
    for (const [pattern, label] of forbiddenPatterns) {
      if (pattern.test(text)) {
        fail(`${relativePath} must not use placeholder embedding fixture pattern: ${label}`);
      }
    }
  }
}

function assertQueueServiceWriteTargetsAreAllowlisted() {
  const allowedWriteTargets = new Set(["source_proposal_runs", "source_proposal_queue"]);
  const fromChainPattern = /\.from\(\s*['"`]([^'"`]+)['"`]\s*\)([\s\S]*?)(?=\n\s*(?:const|let|if|return|throw|try|catch|await|}\)|}\s*$)|$)/g;
  let match;

  while ((match = fromChainPattern.exec(service)) !== null) {
    const [, table, chain] = match;
    const writes = writeMethods.filter((method) => new RegExp(`\\.${method}\\s*\\(`).test(chain));
    if (writes.length > 0 && !allowedWriteTargets.has(table)) {
      fail(`queue service write chain must target only source_proposal_runs/source_proposal_queue, got ${table}`);
    }
  }
}

function assertSourceOpsPageDoesNotExposeApplyActions() {
  const proposalEndpointFetchPattern = /fetch\(\s*["']\/api\/admin\/source-ops\/proposals(?:\?[^"']*)?["']\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  let match;

  while ((match = proposalEndpointFetchPattern.exec(sourceOpsPage)) !== null) {
    const options = match[1];
    if (/\bmethod\s*:\s*["'](?:POST|PATCH|DELETE)["']/.test(options)) {
      fail("source ops page must not call proposals endpoint with POST/PATCH/DELETE");
    }
  }

  const forbiddenButtonActionPattern = /<Button\b[\s\S]{0,500}?(?:approve|reject|apply|promote|승인|반려|적용|승격)[\s\S]{0,500}?<\/Button>/i;
  if (forbiddenButtonActionPattern.test(sourceOpsPage)) {
    fail("source ops page must not render approve/reject/apply/promote proposal buttons");
  }

  const forbiddenHandlerPattern = /\b(?:onClick|onSubmit)\s*=\s*\{[^}]*\b(?:approve|reject|apply|promote)(?:Source|Proposal|Candidate|Run|Queue)?\b[^}]*\}/i;
  if (forbiddenHandlerPattern.test(sourceOpsPage)) {
    fail("source ops page must not wire approve/reject/apply/promote handlers");
  }
}

function assertCompletedStatusDoesNotWriteCorpusSuccess(files) {
  for (const [relativePath, text] of files) {
    for (const table of corpusTables) {
      const pattern = new RegExp(
        `\\.from\\(\\s*['"\`]${escapeRegExp(table)}['"\`]\\s*\\)[\\s\\S]{0,1200}?\\.(?:insert|upsert|update)\\s*\\([\\s\\S]{0,800}?(?:status\\s*:\\s*['"\`]completed['"\`]|indexed_at|embedding_status\\s*:\\s*['"\`](?:completed|success)['"\`])`,
        "m",
      );
      if (pattern.test(text)) {
        fail(`${relativePath} must not couple status completed/index success writes to corpus table ${table}`);
      }
    }
  }
}

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

assertNoCorpusTableWrites(proposalBoundaryFiles);
assertNoPlaceholderEmbeddingFixtures(proposalBoundaryFiles);
assertQueueServiceWriteTargetsAreAllowlisted();
assertSourceOpsPageDoesNotExposeApplyActions();
assertCompletedStatusDoesNotWriteCorpusSuccess(proposalBoundaryFiles);

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
