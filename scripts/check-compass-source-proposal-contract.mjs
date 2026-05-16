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
const reviewService = read("src/lib/services/CompassSourceProposalReviewService.ts");
const route = read("src/app/api/admin/source-ops/proposals/route.ts");
const page = read("src/app/admin/source-ops/page.tsx");

for (const token of [
  "proposal-only",
  "dryRun: true",
  "mutationEnabled: false",
  "wouldIndex: false",
  "wouldPromote: false",
  "COMPASS_SOURCE_PROPOSAL_FETCH_ENABLED",
  "COMPASS_SOURCE_PROPOSAL_MIN_PREVIEW_CHARS",
  "isAllowedPolicyHost",
  "validateExtractedPreview",
  "Preview fetch produced too little readable policy content",
  "Preview fetch lacks enough readable policy signal",
]) {
  if (!service.includes(token)) {
    fail(`proposal safety contract missing ${token}`);
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

if (!page.includes("/api/admin/source-ops/proposals?maxSources=7") || page.includes("fetch=true")) {
  fail("source ops page must fetch proposal preview through GET without enabling network fetch");
}

if (!page.includes("queueSnapshot") || !page.includes("queue {proposalRun.queueSnapshot.readStatus}")) {
  fail("source ops page must render read-only proposal queue status");
}

if (page.includes("fetch(\"/api/admin/source-ops/proposals\",") || page.includes("method: \"POST\"") || page.includes("method: 'POST'")) {
  fail("source ops page must not expose proposal queue/apply POST actions");
}

if (!process.exitCode) {
  console.log("[check-compass-source-proposal-contract] ok");
}
