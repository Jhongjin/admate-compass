#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(`[check-compass-corpus-audit-contract] ${message}`);
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

const audit = read("scripts/audit-compass-corpus-source-quality.mjs");
const packageJson = JSON.parse(read("package.json") || "{}");

for (const token of [
  "read-only-corpus-source-quality-audit",
  "READ_ONLY_TABLES",
  "document_chunks",
  "ollama_document_chunks",
  "source_url",
  "document_url",
  "source_title",
  "chunking_strategy",
  "signal_score",
  "missing_source_url",
  "missing_chunking_strategy",
  "missing_signal_score",
  "likely_placeholder_url_content",
  "likely_page_chrome",
  "weak_policy_title",
  "possible_vendor_mismatch",
  "duplicate_fingerprint",
  "documents",
  "readParentDocuments",
  "chunkToken",
  "documentToken",
  "contentFingerprint",
  "duplicateFingerprintGroups",
  "VENDOR_SOURCE_POLICIES",
  "OFFICIAL_HOSTS",
  "readSourceVendor",
  "readSourceKind",
  "hostMatchesPolicy",
  "vendorFromHost",
  "quarantineRecommendations",
  "vendorIssueCounts",
  "quarantineReason",
  "recommendedAction",
  "severity",
  "rowToken",
  "declaredVendor",
  "inferredVendor",
  "hostVendor",
  "sourceKind",
  "missing_source_vendor",
  "missing_source_kind",
  "host_vendor_mismatch",
  "non_official_host",
  "source_vendor_mismatch",
  "source_vendor_content_mismatch",
  "source_kind_static_seed",
  "source_kind_fallback",
  "suspicious_source_title",
]) {
  if (!audit.includes(token)) {
    fail(`corpus audit script missing ${token}`);
  }
}

for (const forbidden of [
  ".insert(",
  ".upsert(",
  ".delete(",
  "saveChunks",
  "saveDocument(",
  "DocumentIndexingService",
  "VectorStorageService",
  "contentPreview",
  "metadataPreview",
]) {
  if (audit.includes(forbidden)) {
    fail(`corpus audit script must remain read-only/redacted: ${forbidden}`);
  }
}

if (/\.from\([^)]*\)[\s\S]{0,240}\.(insert|update|upsert|delete)\(/.test(audit)) {
  fail("corpus audit script must not mutate Supabase tables");
}

if (!packageJson.scripts?.["audit:compass-corpus-source-quality"]) {
  fail("package.json missing audit:compass-corpus-source-quality");
}

if (!packageJson.scripts?.["check:compass-corpus-audit-contract"]) {
  fail("package.json missing check:compass-corpus-audit-contract");
}

if (!String(packageJson.scripts?.["verify:harness"] || "").includes("check:compass-corpus-audit-contract")) {
  fail("verify:harness must include corpus audit contract check");
}

if (!process.exitCode) {
  console.log("[check-compass-corpus-audit-contract] ok");
}
