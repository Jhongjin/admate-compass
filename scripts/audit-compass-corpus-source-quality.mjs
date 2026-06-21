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

const VENDOR_SOURCE_POLICIES = {
  META: {
    officialHosts: ["facebook.com", "business.facebook.com", "transparency.meta.com"],
    contentHints: ["meta", "facebook", "instagram", "메타", "페이스북", "인스타그램"],
  },
  KAKAO: {
    officialHosts: ["kakaobusiness.gitbook.io", "business.kakao.com", "kakao.com"],
    contentHints: ["kakao", "카카오", "카카오톡", "카카오모먼트", "비즈보드"],
  },
  NAVER: {
    officialHosts: ["ads.naver.com", "searchad.naver.com", "saedu.naver.com", "naver.com"],
    contentHints: ["naver", "네이버", "검색광고", "쇼핑검색", "파워링크", "브랜드검색"],
  },
  GOOGLE: {
    officialHosts: ["support.google.com", "ads.google.com", "business.google.com", "google.com"],
    contentHints: ["google", "구글", "google ads", "youtube", "유튜브"],
  },
};

const OFFICIAL_HOSTS = new Set(Object.values(VENDOR_SOURCE_POLICIES).flatMap((policy) => policy.officialHosts));

const STATIC_SEED_PATTERNS = [
  /static[_\s-]?seed/i,
  /synthetic[_\s-]?seed/i,
  /manual[_\s-]?seed/i,
  /seeded/i,
  /fallback/i,
];

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

function normalizeVendor(value) {
  const text = asText(value).toUpperCase();
  if (["META", "KAKAO", "NAVER", "GOOGLE"].includes(text)) return text;
  const inferred = inferVendor(text);
  return inferred === "UNKNOWN" ? "" : inferred;
}

function readSourceVendor(metadata, parent = {}) {
  return normalizeVendor(firstText(
    metadata.source_vendor,
    metadata.sourceVendor,
    metadata.vendor,
    metadata.platform,
    parent.source_vendor,
    parent.vendor,
    parent.platform,
  ));
}

function readSourceKind(metadata, parent = {}) {
  return firstText(
    metadata.source_kind,
    metadata.sourceKind,
    metadata.source_type,
    metadata.sourceType,
    metadata.kind,
    parent.source_kind,
    parent.sourceKind,
    parent.type,
  );
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

function hostMatchesPolicy(host, policy) {
  if (!host || !policy) return false;
  const normalizedHost = host.toLowerCase();
  return policy.officialHosts.some((allowedHost) => (
    normalizedHost === allowedHost || normalizedHost.endsWith(`.${allowedHost}`)
  ));
}

function vendorFromHost(host) {
  for (const [vendor, policy] of Object.entries(VENDOR_SOURCE_POLICIES)) {
    if (hostMatchesPolicy(host, policy)) return vendor;
  }
  return "UNKNOWN";
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

function isStaticSeedLike(metadata, parent, sourceTitle, sourceUrl) {
  const text = [
    metadata.rag_gate,
    metadata.source_kind,
    metadata.sourceKind,
    metadata.source,
    metadata.canonical_title,
    metadata.document_id,
    parent.type,
    parent.status,
    sourceTitle,
    sourceUrl,
  ].map(asText).join(" ");
  return STATIC_SEED_PATTERNS.some((pattern) => pattern.test(text));
}

function isFallbackLike(metadata, parent, content) {
  const text = [
    metadata.type,
    metadata.source_kind,
    metadata.sourceKind,
    metadata.evidenceDecision,
    metadata.retrievalMethod,
    parent.type,
    parent.status,
    content.slice(0, 500),
  ].map(asText).join(" ");
  return /fallback|placeholder|no[_\s-]?data|not[_\s-]?available|수집할 수 없습니다|관리자가 별도로 처리/i.test(text);
}

function issueSeverity(issue) {
  if ([
    "likely_placeholder_url_content",
    "source_vendor_mismatch",
    "source_vendor_content_mismatch",
    "host_vendor_mismatch",
    "non_official_host",
    "source_kind_fallback",
  ].includes(issue)) return "high";
  if ([
    "missing_source_vendor",
    "missing_source_kind",
    "missing_source_url",
    "possible_vendor_mismatch",
    "source_kind_static_seed",
    "duplicate_fingerprint",
  ].includes(issue)) return "medium";
  return "low";
}

function quarantineRecommendations(issues) {
  const severityRank = { low: 1, medium: 2, high: 3 };
  const severity = issues
    .map(issueSeverity)
    .sort((a, b) => severityRank[b] - severityRank[a])[0] || "none";

  if (severity === "high") {
    return {
      severity,
      quarantineReason: "retrieval_blocker",
      recommendedAction: "quarantine_before_reindex",
    };
  }
  if (severity === "medium") {
    return {
      severity,
      quarantineReason: "metadata_repair_required",
      recommendedAction: "repair_metadata_then_reaudit",
    };
  }
  if (issues.length > 0) {
    return {
      severity,
      quarantineReason: "quality_review",
      recommendedAction: "review_sample",
    };
  }
  return {
    severity,
    quarantineReason: "none",
    recommendedAction: "keep",
  };
}

function auditChunk(tableName, row, parentDocument, duplicateCount) {
  const metadata = toRecord(row.metadata);
  const content = asText(row.content);
  const parent = toRecord(parentDocument);
  const sourceUrl = firstText(readSourceUrl(metadata), parent.url);
  const sourceTitle = firstText(readSourceTitle(metadata), parent.title);
  const chunkingStrategy = readChunkingStrategy(metadata);
  const signalScore = readSignalScore(metadata);
  const declaredVendor = readSourceVendor(metadata, parent);
  const sourceKind = readSourceKind(metadata, parent);
  const host = hostFromUrl(sourceUrl);
  const hostVendor = vendorFromHost(host);
  const inferredVendor = inferVendor([sourceUrl, sourceTitle, content.slice(0, 900)].join(" "));
  const sourceVendor = declaredVendor || hostVendor || inferVendor([sourceUrl, sourceTitle].join(" "));
  const contentVendor = inferVendor(content.slice(0, 900));
  const issues = [];

  if (!sourceUrl) issues.push("missing_source_url");
  if (!sourceTitle) issues.push("missing_source_title");
  if (!declaredVendor) issues.push("missing_source_vendor");
  if (!sourceKind) issues.push("missing_source_kind");
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
  if (sourceTitle && !isPolicyTitle(sourceTitle) && /정책|심사|검수|등록|policy|review|standard/i.test([sourceKind, sourceTitle, content.slice(0, 500)].join(" "))) {
    issues.push("suspicious_source_title");
  }
  if (declaredVendor && hostVendor !== "UNKNOWN" && declaredVendor !== hostVendor) {
    issues.push("host_vendor_mismatch");
  }
  const declaredPolicy = declaredVendor ? VENDOR_SOURCE_POLICIES[declaredVendor] : null;
  if (sourceUrl && declaredVendor && !hostMatchesPolicy(host, declaredPolicy)) {
    issues.push("non_official_host");
  }
  if (declaredVendor && inferredVendor !== "UNKNOWN" && inferredVendor !== declaredVendor) {
    issues.push("source_vendor_mismatch");
  }
  if (declaredVendor && contentVendor !== "UNKNOWN" && contentVendor !== declaredVendor) {
    issues.push("source_vendor_content_mismatch");
  }
  if (sourceVendor !== "UNKNOWN" && contentVendor !== "UNKNOWN" && sourceVendor !== contentVendor) {
    issues.push("possible_vendor_mismatch");
  }
  if (isStaticSeedLike(metadata, parent, sourceTitle, sourceUrl)) issues.push("source_kind_static_seed");
  if (isFallbackLike(metadata, parent, content)) issues.push("source_kind_fallback");
  if (duplicateCount > 1) issues.push("duplicate_fingerprint");
  const recommendation = quarantineRecommendations(issues);

  return {
    tableName,
    rowToken: hashToken(`${tableName}:${row.id || row.chunk_id || row.document_id}`),
    chunkToken: hashToken(row.chunk_id || row.id || row.document_id),
    documentToken: hashToken(row.document_id || ""),
    contentFingerprint: contentFingerprint(content),
    host,
    declaredVendor: declaredVendor || "UNKNOWN",
    inferredVendor,
    hostVendor,
    sourceKind: sourceKind || "UNKNOWN",
    sourceVendor,
    parentStatus: asText(parent.status),
    parentType: asText(parent.type),
    signalScore,
    contentLengthBucket: bucketContentLength(content.length),
    issues,
    severity: recommendation.severity,
    quarantineReason: recommendation.quarantineReason,
    recommendedAction: recommendation.recommendedAction,
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
  const vendorIssueCounts = {};
  const quarantineActionCounts = {};

  for (const result of audited) {
    const vendor = result.declaredVendor || result.inferredVendor || result.hostVendor || "UNKNOWN";
    if (!vendorIssueCounts[vendor]) vendorIssueCounts[vendor] = {};
    for (const issue of result.issues) {
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
      vendorIssueCounts[vendor][issue] = (vendorIssueCounts[vendor][issue] || 0) + 1;
    }
    quarantineActionCounts[result.recommendedAction] = (quarantineActionCounts[result.recommendedAction] || 0) + 1;
  }

  return {
    tableName,
    sampledRows: rows.length,
    issueCounts,
    vendorIssueCounts,
    quarantineRecommendations: quarantineActionCounts,
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
