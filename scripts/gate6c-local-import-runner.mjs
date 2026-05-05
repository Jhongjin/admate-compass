#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_SCHEMA = "compass";
const DEFAULT_BATCH_SIZE = 250;
const DOWNLOADS = "C:/Users/Administrator/Downloads";

const BLOCKED_NAMES = [
  "ad_policies",
  "profiles",
  "admin_users",
  "conversations",
  "feedback",
  "api_usage_logs",
  "log_alerts",
  "auth.users",
  "openclaw.",
  "lens.",
];

const IMPORT_PLAN = [
  {
    table: "documents",
    sourceKind: "core-json",
    file: path.join(DOWNLOADS, "gate6b_raw_01_core.csv.csv"),
    section: "documents",
    expectedRows: 4969,
    headers: ["section", "source_id", "row_data"],
  },
  {
    table: "document_metadata",
    sourceKind: "core-json",
    file: path.join(DOWNLOADS, "gate6b_raw_01_core.csv.csv"),
    section: "document_metadata",
    expectedRows: 4924,
    headers: ["section", "source_id", "row_data"],
  },
  {
    table: "document_chunks",
    sourceKind: "table-csv",
    file: path.join(DOWNLOADS, "document_chunks_rows.csv"),
    expectedRows: 38973,
    headers: ["id", "document_id", "chunk_id", "content", "embedding", "created_at", "metadata", "parent_chunk_id", "hierarchy_level"],
  },
  {
    table: "ollama_document_chunks",
    sourceKind: "table-csv",
    file: path.join(DOWNLOADS, "ollama_document_chunks_rows.csv"),
    expectedRows: 6,
    headers: ["id", "document_id", "chunk_id", "content", "embedding", "metadata", "created_at", "updated_at"],
  },
  {
    table: "processing_jobs",
    sourceKind: "table-csv",
    file: path.join(DOWNLOADS, "processing_jobs_rows.csv"),
    expectedRows: 5190,
    headers: ["id", "document_id", "job_type", "status", "priority", "attempts", "max_attempts", "error", "payload", "result", "scheduled_at", "started_at", "finished_at", "created_at", "updated_at"],
  },
  {
    table: "document_splits",
    sourceKind: "empty",
    expectedRows: 0,
    headers: [],
  },
  {
    table: "discovered_urls",
    sourceKind: "empty",
    expectedRows: 0,
    headers: [],
  },
  {
    table: "document_processing_logs",
    sourceKind: "table-csv",
    file: path.join(DOWNLOADS, "document_processing_logs_rows.csv"),
    expectedRows: 4,
    headers: ["id", "document_id", "step", "status", "message", "error", "metadata", "created_at"],
  },
  {
    table: "document_chunk_weights",
    sourceKind: "empty",
    expectedRows: 0,
    headers: [],
  },
  {
    table: "crawl_jobs",
    sourceKind: "table-csv",
    file: path.join(DOWNLOADS, "crawl_jobs_rows.csv"),
    expectedRows: 2,
    headers: ["id", "url", "status", "pages_crawled", "created_at", "updated_at"],
  },
  {
    table: "processing_metrics",
    sourceKind: "empty",
    expectedRows: 0,
    headers: [],
  },
  {
    table: "url_templates",
    sourceKind: "table-csv",
    file: path.join(DOWNLOADS, "url_templates_rows.csv"),
    expectedRows: 16,
    headers: ["id", "name", "urls", "created_at", "updated_at", "vendor"],
  },
];

const JSON_COLUMNS = new Set(["metadata", "payload", "result", "path"]);
const NUMBER_COLUMNS = new Set([
  "id",
  "chunk_id",
  "chunk_count",
  "embedding_count",
  "size",
  "file_size",
  "priority",
  "attempts",
  "max_attempts",
  "split_index",
  "split_count",
  "start_char",
  "end_char",
  "page_number",
  "depth",
  "pages_crawled",
  "bytes",
  "dl_ms",
  "parse_ms",
  "ocr_ms",
  "emb_ms",
  "total_ms",
  "text_length",
  "chunks",
  "positive_feedback_count",
  "negative_feedback_count",
]);
const BOOLEAN_COLUMNS = new Set(["selected"]);
const TARGET_VENDOR_VALUES = new Set(["META", "GOOGLE", "NAVER", "KAKAO", "X", "TIKTOK"]);

const args = new Set(process.argv.slice(2));
const confirm = args.has("--confirm");
const dryRun = !confirm;
const batchSize = readNumberArg("--batch-size", DEFAULT_BATCH_SIZE);
const limitRows = readNumberArg("--limit-rows", null);
const onlyTable = readStringArg("--only", null);

function readNumberArg(name, fallback) {
  const prefix = `${name}=`;
  const raw = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const parsed = Number(raw.slice(prefix.length));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`Invalid ${name}; expected positive integer.`);
  }
  return parsed;
}

function readStringArg(name, fallback) {
  const prefix = `${name}=`;
  const raw = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = raw.slice(prefix.length).trim();
  return value || fallback;
}

function fail(message, details) {
  console.error(`[gate6c-runner] ${message}`);
  if (details) console.error(details);
  process.exit(1);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

function assertNoBlockedNames() {
  const names = IMPORT_PLAN.map((item) => item.table).join("\n").toLowerCase();
  for (const blocked of BLOCKED_NAMES) {
    if (names.includes(blocked.toLowerCase())) {
      fail(`Blocked object found in import plan: ${blocked}`);
    }
  }
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function parseCsvRecord(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

async function* readCsvRows(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let record = "";
  let inQuotes = false;
  let header = null;

  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i += 1) {
      const char = chunk[i];
      record += char;

      if (char === '"') {
        if (inQuotes && chunk[i + 1] === '"') {
          record += chunk[i + 1];
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      }

      if (!inQuotes && char === "\n") {
        const line = record.replace(/\r?\n$/, "");
        record = "";
        if (!line) continue;
        if (!header) {
          header = parseCsvRecord(line);
          yield { type: "header", header };
        } else {
          const values = parseCsvRecord(line);
          const row = {};
          header.forEach((key, index) => {
            row[key] = values[index] ?? "";
          });
          yield { type: "row", row };
        }
      }
    }
  }

  if (record.trim().length > 0) {
    if (!header) {
      yield { type: "header", header: parseCsvRecord(record) };
    } else {
      const values = parseCsvRecord(record);
      const row = {};
      header.forEach((key, index) => {
        row[key] = values[index] ?? "";
      });
      yield { type: "row", row };
    }
  }
}

function tableCsvToRecord(row) {
  const record = {};
  for (const [key, value] of Object.entries(row)) {
    record[key] = normalizeValue(key, value);
  }
  return record;
}

function normalizeValue(key, value) {
  if (value === "" || value === undefined) return null;
  if (JSON_COLUMNS.has(key)) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (NUMBER_COLUMNS.has(key) && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (BOOLEAN_COLUMNS.has(key)) {
    return value === "true";
  }
  if (key === "urls") {
    return parsePgTextArray(value);
  }
  if (key === "vendor") {
    return TARGET_VENDOR_VALUES.has(value) ? value : null;
  }
  return value;
}

function parsePgTextArray(value) {
  if (!value) return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (!value.startsWith("{") || !value.endsWith("}")) return value;
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => item.replace(/^"|"$/g, "").replace(/\\"/g, '"'));
}

async function makeSupabaseClient() {
  if (dryRun) return null;

  const migrationEnv = parseEnvFile(path.join(process.cwd(), ".env.migration"));
  const localEnv = parseEnvFile(path.join(process.cwd(), ".env.local"));
  const env = { ...localEnv, ...migrationEnv, ...process.env };

  const url = env.TARGET_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.TARGET_SUPABASE_SERVICE_ROLE_KEY || env.TARGET_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    fail("Target Supabase URL/service key is not configured in environment files.");
  }

  return createClient(url, key, {
    db: { schema: TARGET_SCHEMA },
    auth: { persistSession: false },
  });
}

async function validateAndMaybeImport(planItem, supabase) {
  if (planItem.sourceKind === "empty") {
    return { table: planItem.table, rows: 0, bytes: 0, batches: 0, status: "empty" };
  }

  if (!fs.existsSync(planItem.file)) {
    fail(`Missing CSV file for ${planItem.table}: ${planItem.file}`);
  }

  const stats = fs.statSync(planItem.file);
  let headerSeen = false;
  let rows = 0;
  let matchedRows = 0;
  let batch = [];
  let batches = 0;

  for await (const event of readCsvRows(planItem.file)) {
    if (event.type === "header") {
      headerSeen = true;
      if (!arraysEqual(event.header, planItem.headers)) {
        fail(`Header mismatch for ${planItem.table}`, JSON.stringify({ expected: planItem.headers, actual: event.header }));
      }
      continue;
    }

    rows += 1;
    if (limitRows && rows > limitRows) break;

    let record = null;
    if (planItem.sourceKind === "core-json") {
      if (event.row.section !== planItem.section) continue;
      matchedRows += 1;
      record = JSON.parse(event.row.row_data);
    } else {
      matchedRows += 1;
      record = tableCsvToRecord(event.row);
    }

    if (!dryRun) {
      batch.push(record);
      if (batch.length >= batchSize) {
        batches += 1;
        await insertBatch(supabase, planItem.table, batch, batches);
        batch = [];
      }
    }
  }

  if (!headerSeen) {
    fail(`No header found for ${planItem.table}`);
  }

  if (!dryRun && batch.length > 0) {
    batches += 1;
    await insertBatch(supabase, planItem.table, batch, batches);
  }

  if (!limitRows && matchedRows !== planItem.expectedRows) {
    fail(`Row count mismatch for ${planItem.table}`, JSON.stringify({ expected: planItem.expectedRows, actual: matchedRows }));
  }

  return { table: planItem.table, rows: matchedRows, bytes: stats.size, batches, status: dryRun ? "dry-run" : "imported" };
}

async function insertBatch(supabase, table, batch, batchNumber) {
  const { error } = await supabase.from(table).insert(batch);
  if (error) {
    fail(`Import failed at ${table} batch ${batchNumber}`, JSON.stringify({ code: error.code, message: error.message }));
  }
}

async function main() {
  assertNoBlockedNames();
  console.log(`[gate6c-runner] mode=${dryRun ? "dry-run" : "CONFIRMED WRITE"}`);
  console.log(`[gate6c-runner] schema=${TARGET_SCHEMA}`);
  console.log(`[gate6c-runner] batchSize=${batchSize}`);
  if (limitRows) console.log(`[gate6c-runner] limitRows=${limitRows}`);
  if (onlyTable) console.log(`[gate6c-runner] only=${onlyTable}`);

  const supabase = await makeSupabaseClient();
  const summary = [];

  const plan = onlyTable ? IMPORT_PLAN.filter((item) => item.table === onlyTable) : IMPORT_PLAN;
  if (onlyTable && plan.length !== 1) {
    fail(`Unknown --only table: ${onlyTable}`);
  }

  for (const planItem of plan) {
    const result = await validateAndMaybeImport(planItem, supabase);
    summary.push(result);
    console.log(`[gate6c-runner] ${result.table}: rows=${result.rows} bytes=${result.bytes} status=${result.status}`);
  }

  console.log(JSON.stringify({ ok: true, dryRun, summary }, null, 2));
}

main().catch((error) => {
  fail("Unexpected runner error", error instanceof Error ? error.message : String(error));
});
