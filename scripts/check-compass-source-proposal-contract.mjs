#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(`[check-compass-source-proposal-contract] ${message}`);
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

const service = read("src/lib/services/CompassSourceProposalService.ts");
const parserService = read("src/lib/services/CompassSourcePreviewParser.ts");
const reviewService = read("src/lib/services/CompassSourceProposalReviewService.ts");
const route = read("src/app/api/admin/source-ops/proposals/route.ts");
const page = read("src/app/admin/source-ops/page.tsx");
const packageJson = JSON.parse(read("package.json") || "{}");

for (const token of [
  "proposal-only",
  "dryRun: true",
  "mutationEnabled: false",
  "wouldIndex: false",
  "wouldPromote: false",
  "COMPASS_SOURCE_PROPOSAL_FETCH_ENABLED",
  "COMPASS_SOURCE_PROPOSAL_MIN_PREVIEW_CHARS",
  "isAllowedPolicyHost",
  "CompassSourcePreviewParser",
  "extractCompassSourcePreview",
  "Preview fetch produced too little readable policy content",
  "Preview fetch lacks enough readable policy signal",
].filter(Boolean)) {
  const source = token === "CompassSourcePreviewParser" || token === "extractCompassSourcePreview"
    ? service
    : `${service}\n${parserService}`;
  if (!source.includes(token)) {
    fail(`proposal safety contract missing ${token}`);
  }
}

for (const token of [
  "extractCompassSourcePreview",
  "validateCompassSourcePreview",
]) {
  if (!parserService.includes(token)) {
    fail(`preview parser missing ${token}`);
  }
}

for (const forbidden of [
  "function extractPreview",
  "function validateExtractedPreview",
  "function removePageChrome",
  "function stripTags",
  "function decodeEntities",
  "function matchFirst",
]) {
  if (service.includes(forbidden)) {
    fail(`proposal service must not keep duplicate preview parser helper ${forbidden}`);
  }
}

for (const forbidden of [
  "fetch(",
  "process.env",
  "createClient",
  "createCompassServiceClient",
  "supabase",
  "DocumentIndexingService",
  "VectorStorageService",
  "EmbeddingService",
  "CompassAnswerLlmService",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "chat.completions",
  "node:fs",
]) {
  if (parserService.includes(forbidden)) {
    fail(`preview parser must remain pure and must not include ${forbidden}`);
  }
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
    fail(`proposal path must not import or call corpus mutation API: ${forbidden}`);
  }
}

if (!route.includes("buildCompassSourceProposalRun")) {
  fail("proposal route must use CompassSourceProposalService");
}

for (const token of [
  "process.env.NODE_ENV === 'production'",
  "const fetchPreview",
  "fetchPreview,",
]) {
  if (!route.includes(token)) {
    fail(`proposal GET route must keep production fetch preview disabled via ${token}`);
  }
}

if (!route.includes("readCompassSourceProposalQueueSnapshot") || !route.includes("queueSnapshot")) {
  fail("proposal route must expose read-only proposal queue snapshot");
}

for (const token of [
  "deterministic-policy-review-v1",
  "llmUsed: false",
  "needsHumanReview: true",
  "mutationEnabled: false",
  "diffSummary",
  "relevanceScore",
]) {
  if (!reviewService.includes(token)) {
    fail(`proposal review contract missing ${token}`);
  }
}

for (const forbidden of [
  "CompassAnswerLlmService",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "openrouter",
  "generateContent",
  "chat.completions",
  "embeddingService",
  "EmbeddingService",
]) {
  if (reviewService.includes(forbidden) || service.includes(forbidden) || route.includes(forbidden)) {
    fail(`proposal review path must not use LLM or embedding providers: ${forbidden}`);
  }
}

if (!page.includes("/api/admin/source-ops/proposals?maxSources=7&queueLimit=20") || page.includes("fetch=true")) {
  fail("source ops page must fetch proposal preview through GET without enabling network fetch");
}

if (
  !page.includes("queueSnapshot")
  || (
    !page.includes("queue {proposalRun.queueSnapshot.readStatus}")
    && !page.includes("queueReadStatusLabel(proposalRun.queueSnapshot.readStatus)")
  )
) {
  fail("source ops page must render read-only proposal queue status");
}

for (const token of [
  "QueueReadOnlySummary",
  "검토 상태 분포",
  "위험도 분포",
]) {
  if (!page.includes(token)) {
    fail(`source ops page must render read-only proposal queue summary token: ${token}`);
  }
}

for (const token of [
  "ReadOnlyQueueInventory",
  "승인 기능 준비중",
]) {
  if (!page.includes(token)) {
    fail(`source ops page must render read-only proposal inventory token: ${token}`);
  }
}

if (!page.includes("읽기 전용 큐") && !page.includes("읽기 전용 대기열")) {
  fail("source ops page must render read-only proposal inventory token: 읽기 전용 큐/대기열");
}

if (!page.includes("read-only") && !page.includes("ReadOnlyQueueInventory")) {
  fail("source ops page must render read-only proposal inventory token: read-only");
}

if (
  !page.includes("승인/반려와 색인은 별도 게이트")
  && !page.includes("승인/반려와 검색 반영은 별도 승인 단계")
) {
  fail("source ops page must render read-only proposal inventory token: 승인/반려와 색인/검색 반영 게이트");
}

if (page.includes("fetch(\"/api/admin/source-ops/proposals\",") || page.includes("method: \"POST\"") || page.includes("method: 'POST'")) {
  fail("source ops page must not expose proposal queue/apply POST actions");
}

if (packageJson.scripts?.["check:compass-source-preview-parser"] !== "node scripts/check-compass-source-preview-parser-fixtures.mjs") {
  fail("package script check:compass-source-preview-parser is missing or changed");
}

if (!String(packageJson.scripts?.["verify:harness"] || "").includes("check:compass-source-preview-parser")) {
  fail("verify:harness must include check:compass-source-preview-parser");
}

if (!process.exitCode) {
  console.log("[check-compass-source-proposal-contract] ok");
}
