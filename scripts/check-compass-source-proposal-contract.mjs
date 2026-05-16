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
const route = read("src/app/api/admin/source-ops/proposals/route.ts");

for (const token of [
  "proposal-only",
  "dryRun: true",
  "mutationEnabled: false",
  "wouldIndex: false",
  "wouldPromote: false",
  "COMPASS_SOURCE_PROPOSAL_FETCH_ENABLED",
  "isAllowedPolicyHost",
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

if (!process.exitCode) {
  console.log("[check-compass-source-proposal-contract] ok");
}
