#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

const DEFAULT_ENDPOINT = "http://127.0.0.1:3000/api/internal/source-proposals/dry-run";
const endpoint = process.env.COMPASS_SOURCE_PROPOSAL_WORKER_SMOKE_URL || DEFAULT_ENDPOINT;
const smokeEnv = process.env.COMPASS_SOURCE_PROPOSAL_WORKER_SMOKE_ENV;
const workerKey = process.env.COMPASS_SOURCE_PROPOSAL_WORKER_KEY;

function fail(message) {
  console.error(`[smoke:compass-source-proposal-worker] ${message}`);
  process.exit(1);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}`);
  }
}

function requireNonProduction() {
  if (process.env.NODE_ENV === "production") {
    fail("Refusing to run with NODE_ENV=production.");
  }

  if (process.env.VERCEL_ENV === "production") {
    fail("Refusing to run with VERCEL_ENV=production.");
  }

  if (smokeEnv !== "local" && smokeEnv !== "staging") {
    fail("COMPASS_SOURCE_PROPOSAL_WORKER_SMOKE_ENV must be local or staging.");
  }
}

function requireWorkerKey() {
  if (!workerKey) {
    fail("COMPASS_SOURCE_PROPOSAL_WORKER_KEY is required for this smoke.");
  }
}

function requireServiceReadEnv() {
  const missing = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    fail(`Compass service readback environment is required when a run id is returned. Missing: ${missing.join(", ")}.`);
  }
}

function getCompassDbSchema() {
  const schema = process.env.COMPASS_DB_SCHEMA?.trim() || (process.env.NODE_ENV === "production" ? "compass" : "public");
  if (schema !== "public" && schema !== "compass") {
    fail("COMPASS_DB_SCHEMA must be public or compass for this smoke.");
  }
  return schema;
}

function createCompassServiceClient() {
  requireServiceReadEnv();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: getCompassDbSchema() },
    auth: { persistSession: false },
  });
}

function parseEndpointUrl() {
  try {
    return new URL(endpoint);
  } catch {
    fail("COMPASS_SOURCE_PROPOSAL_WORKER_SMOKE_URL must be a valid URL.");
  }
}

function requireSafeEndpoint() {
  const endpointUrl = parseEndpointUrl();
  const hostname = endpointUrl.hostname.toLowerCase();

  if (smokeEnv === "local" && hostname !== "localhost" && hostname !== "127.0.0.1") {
    fail("Local worker smoke must target localhost or 127.0.0.1.");
  }

  const isAdmateHost = hostname === "admate.ai.kr" || hostname.endsWith(".admate.ai.kr");
  const hasNonProductionHint = /(^|[.-])(staging|preview|dev|test|local)([.-]|$)/.test(hostname);

  if (smokeEnv === "staging" && isAdmateHost && !hasNonProductionHint) {
    fail("Refusing to run staging smoke against a production-like AdMate host.");
  }

  return endpointUrl;
}

async function readPersistedRun(runId, expectedCandidateCount) {
  const supabase = createCompassServiceClient();
  const { data: runRow, error: runError } = await supabase
    .from("source_proposal_runs")
    .select("id,dry_run,mutation_enabled,fetch_enabled,status,candidate_count")
    .eq("id", runId)
    .single();

  if (runError || !runRow) {
    fail("Persisted proposal run row was not readable in the configured local/staging Compass schema.");
  }

  assertEqual(runRow.dry_run, true, "source_proposal_runs.dry_run");
  assertEqual(runRow.mutation_enabled, false, "source_proposal_runs.mutation_enabled");
  assertEqual(runRow.fetch_enabled, false, "source_proposal_runs.fetch_enabled");
  assertEqual(runRow.status, "completed", "source_proposal_runs.status");
  assertEqual(Number(runRow.candidate_count || 0), expectedCandidateCount, "source_proposal_runs.candidate_count");

  const { data: candidateRows, error: candidateError, count } = await supabase
    .from("source_proposal_queue")
    .select("id,run_id,review_status,would_index,would_promote", { count: "exact" })
    .eq("run_id", runId);

  if (candidateError || !Array.isArray(candidateRows)) {
    fail("Persisted proposal queue rows were not readable in the configured local/staging Compass schema.");
  }

  assertEqual(Number(count || 0), expectedCandidateCount, "source_proposal_queue run candidate count");

  for (const [index, row] of candidateRows.entries()) {
    assertEqual(row.run_id, runId, `source_proposal_queue[${index}].run_id`);
    assertEqual(row.would_index, false, `source_proposal_queue[${index}].would_index`);
    assertEqual(row.would_promote, false, `source_proposal_queue[${index}].would_promote`);
    assertEqual(row.review_status, "pending", `source_proposal_queue[${index}].review_status`);
  }

  return {
    pendingCount: candidateRows.filter((row) => row.review_status === "pending").length,
  };
}

requireNonProduction();
requireWorkerKey();
const endpointUrl = requireSafeEndpoint();

const response = await fetch(endpointUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${workerKey}`,
  },
  body: JSON.stringify({ dryRun: true, maxSources: 1, fetch: false }),
});

let payload;
try {
  payload = await response.json();
} catch {
  fail(`response must be JSON; status=${response.status}`);
}

if (!response.ok) {
  fail(`request failed; status=${response.status}; code=${payload?.code || "unknown"}`);
}

assertObject(payload, "payload");
assertEqual(payload.success, true, "payload.success");
assertObject(payload.data, "payload.data");

const data = payload.data;
assertEqual(data.dryRun, true, "payload.data.dryRun");
assertEqual(data.mutationEnabled, false, "payload.data.mutationEnabled");
assertEqual(data.fetchEnabled, false, "payload.data.fetchEnabled");

if (typeof data.candidateCount !== "number") {
  fail("payload.data.candidateCount must be a number");
}

assertObject(data.queue, "payload.data.queue");
assertEqual(data.queue.enabled, true, "payload.data.queue.enabled");
assertEqual(data.queue.persisted, true, "payload.data.queue.persisted");
assertEqual(data.queue.productionBlocked, false, "payload.data.queue.productionBlocked");
assertEqual(Number(data.queue.candidateCount || 0), data.candidateCount, "payload.data.queue.candidateCount");

assertObject(data.queueSnapshot, "payload.data.queueSnapshot");
assertEqual(data.queueSnapshot.enabled, true, "payload.data.queueSnapshot.enabled");
assertEqual(data.queueSnapshot.canPersist, true, "payload.data.queueSnapshot.canPersist");
assertEqual(data.queueSnapshot.productionBlocked, false, "payload.data.queueSnapshot.productionBlocked");
assertEqual(data.queueSnapshot.readStatus, "ready", "payload.data.queueSnapshot.readStatus");

let pendingCount = Number(data.queueSnapshot.pendingCandidates || 0);
if (data.queue.runId) {
  const readback = await readPersistedRun(String(data.queue.runId), data.candidateCount);
  pendingCount = readback.pendingCount;
}

console.log(JSON.stringify({
  ok: true,
  endpointHost: endpointUrl.host,
  schema: process.env.COMPASS_DB_SCHEMA || null,
  runId: data.queue.runId || null,
  candidateCount: data.candidateCount,
  pendingCount,
}, null, 2));
