#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const READ_ONLY_TABLES = [
  {
    name: "document_chunks",
    select: "id,document_id,chunk_id,content,metadata,created_at",
  },
  {
    name: "ollama_document_chunks",
    select: "chunk_id,document_id,content,metadata,updated_at",
  },
];

const ALLOWED_SCHEMAS = new Set(["public", "compass"]);
const DEFAULT_LIMIT = 200;
const LOW_SIGNAL_THRESHOLD = 0.25;

const PLACEHOLDER_PATTERNS = [
  /URL crawling is not available/i,
  /serverless document processing path/i,
  /이 URL은 서버리스 환경에서 크롤링할 수 없습니다/,
  /URL 형태로 저장되었습니다/,
  /실제 내용은 관리자가 별도로 처리/,
  /관리자에게 문의/,
];

const PAGE_CHROME_PATTERNS = [
  /__NEXT_DATA__/i,
  /\bcookie\b/i,
  /privacy settings/i,
  /\blogin\b/i,
  /\bsign up\b/i,
  /회원가입/,
  /로그인/,
  /메뉴/,
];

const VENDOR_TERMS = {
  META: ["meta", "facebook", "instagram", "페이스북", "인스타그램", "메타"],
  KAKAO: ["kakao", "카카오", "카카오톡", "모먼트"],
  NAVER: ["naver", "네이버", "검색광고", "파워링크"],
  GOOGLE: ["google", "구글", "youtube", "유튜브", "adspolicy"],
};

function getLimit() {
  const value = Number(process.env.COMPASS_CORPUS_AUDIT_LIMIT || DEFAULT_LIMIT);
  return Math.max(1, Math.min(Number.isFinite(value) ? value : DEFAULT_LIMIT, 1000));
}

function getSchema() {
  const fallback = process.env.NODE_ENV === "production" ? "compass" : "public";
  const configured = String(process.env.COMPASS_DB_SCHEMA || fallback).trim();
  return ALLOWED_SCHEMAS.has(configured) ? configured : fallback;
}

function createAuditClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) return null;

  return createClient(supabaseUrl, supabaseKey, {
    db: { schema: getSchema() },
    auth: { persistSession: false },
  });
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asText(value) {
  return String(value || "").trim();
}

function firstText(...values) {
  return values.map(asText).find(Boolean) || "";
}

function readSourceUrl(metadata) {
  return firstText(metadata.source_url, metadata.document_url, metadata.url, metadata.sourceUrl);
}

function readSourceTitle(metadata) {
  return firstText(metadata.source_title, metadata.canonical_title, metadata.title, metadata.source, metadata.sourceTitle);
}

function readChunkingStrategy(metadata) {
  return firstText(metadata.chunking_strategy, metadata.chunkingStrategy);
}

function readSignalScore(metadata) {
  const value = metadata.signal_score ?? metadata.signalScore;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeFingerprintText(value) {
  return asText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[0-9a-f]{24,}/g, "{hash}")
    .slice(0, 1800);
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function inferVendor(text) {
  const normalized = text.toLowerCase();
  for (const [vendor, terms] of Object.entries(VENDOR_TERMS)) {
    if (terms.some((term) => normalized.includes(term.toLowerCase()))) return vendor;
  }
  return "UNKNOWN";
}

function hashToken(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function contentFingerprint(content) {
  return hashToken(normalizeFingerprintText(content));
}

function isPolicyTitle(value) {
  const normalized = asText(value).toLowerCase();
  return [
    "policy",
    "policies",
    "advertising standards",
    "help",
    "support",
    "광고",
    "정책",
    "심사",
    "도움말",
    "가이드",
  ].some((term) => normalized.includes(term));
}

function auditChunk(tableName, row, parentDocument, duplicateCount) {
  const metadata = toRecord(row.metadata);
  const content = asText(row.content);
  const parent = toRecord(parentDocument);
  const sourceUrl = firstText(readSourceUrl(metadata), parent.url);
  const sourceTitle = firstText(readSourceTitle(metadata), parent.title);
  const chunkingStrategy = readChunkingStrategy(metadata);
  const signalScore = readSignalScore(metadata);
  const sourceVendor = inferVendor([sourceUrl, sourceTitle].join(" "));
  const contentVendor = inferVendor(content.slice(0, 900));
  const issues = [];

  if (!sourceUrl) issues.push("missing_source_url");
  if (!sourceTitle) issues.push("missing_source_title");
  if (!chunkingStrategy) issues.push("missing_chunking_strategy");
  if (signalScore === null) issues.push("missing_signal_score");
  if (signalScore !== null && signalScore < LOW_SIGNAL_THRESHOLD) issues.push("low_signal_score");
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(content))) {
    issues.push("likely_placeholder_url_content");
  }
  if (PAGE_CHROME_PATTERNS.filter((pattern) => pattern.test(content)).length >= 3) {
    issues.push("likely_page_chrome");
  }
  if (sourceTitle && !isPolicyTitle(sourceTitle)) issues.push("weak_policy_title");
  if (sourceVendor !== "UNKNOWN" && contentVendor !== "UNKNOWN" && sourceVendor !== contentVendor) {
    issues.push("possible_vendor_mismatch");
  }
  if (duplicateCount > 1) issues.push("duplicate_fingerprint");

  return {
    tableName,
    chunkToken: hashToken(row.chunk_id || row.id || row.document_id),
    documentToken: hashToken(row.document_id || ""),
    contentFingerprint: contentFingerprint(content),
    host: hostFromUrl(sourceUrl),
    sourceVendor,
    parentStatus: asText(parent.status),
    parentType: asText(parent.type),
    signalScore,
    contentLengthBucket: bucketContentLength(content.length),
    issues,
  };
}

function bucketContentLength(length) {
  if (length < 160) return "tiny";
  if (length < 500) return "short";
  if (length < 1200) return "medium";
  return "long";
}

function summarizeTable(tableName, rows, parentDocuments) {
  const parentById = new Map(parentDocuments.map((document) => [String(document.id), document]));
  const fingerprintCounts = new Map();

  for (const row of rows) {
    const fingerprint = contentFingerprint(row.content);
    fingerprintCounts.set(fingerprint, (fingerprintCounts.get(fingerprint) || 0) + 1);
  }

  const audited = rows.map((row) => {
    const fingerprint = contentFingerprint(row.content);
    return auditChunk(tableName, row, parentById.get(String(row.document_id)), fingerprintCounts.get(fingerprint) || 0);
  });
  const issueCounts = {};

  for (const result of audited) {
    for (const issue of result.issues) {
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    }
  }

  return {
    tableName,
    sampledRows: rows.length,
    issueCounts,
    duplicateFingerprintGroups: Array.from(fingerprintCounts.values()).filter((count) => count > 1).length,
    issueSamples: audited
      .filter((result) => result.issues.length > 0)
      .slice(0, 12),
  };
}

async function readParentDocuments(client, rows) {
  const documentIds = [...new Set(rows.map((row) => asText(row.document_id)).filter(Boolean))].slice(0, 1000);
  if (documentIds.length === 0) return [];

  const { data, error } = await client
    .from("documents")
    .select("id,title,url,type,status,chunk_count,created_at,updated_at")
    .in("id", documentIds);

  if (error) return [];
  return Array.isArray(data) ? data : [];
}

async function readTable(client, table, limit) {
  const { data, error } = await client
    .from(table.name)
    .select(table.select)
    .limit(limit);

  if (error) {
    return {
      tableName: table.name,
      sampledRows: 0,
      readError: "table_unavailable",
      issueCounts: {},
      issueSamples: [],
    };
  }

  const rows = Array.isArray(data) ? data : [];
  const parentDocuments = await readParentDocuments(client, rows);
  return summarizeTable(table.name, rows, parentDocuments);
}

async function main() {
  const client = createAuditClient();

  if (!client) {
    console.log(JSON.stringify({
      ok: true,
      mode: "read-only-corpus-source-quality-audit",
      readOnly: true,
      dbRead: false,
      reason: "Compass Supabase environment is unavailable, so the corpus audit was skipped.",
      tables: READ_ONLY_TABLES.map((table) => table.name),
    }, null, 2));
    return;
  }

  const limit = getLimit();
  const tables = [];

  for (const table of READ_ONLY_TABLES) {
    tables.push(await readTable(client, table, limit));
  }

  console.log(JSON.stringify({
    ok: true,
    mode: "read-only-corpus-source-quality-audit",
    readOnly: true,
    dbRead: true,
    schema: getSchema(),
    limit,
    tables,
  }, null, 2));
}

main().catch((error) => {
  console.error("[audit-compass-corpus-source-quality] failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
