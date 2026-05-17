#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function fail(message) {
  console.error(`[check-compass-source-ops-contract] ${message}`);
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

const service = read("src/lib/services/CompassSourceOpsService.ts");
const proposalService = read("src/lib/services/CompassSourceProposalService.ts");
const route = read("src/app/api/admin/source-ops/route.ts");
const proposalRoute = read("src/app/api/admin/source-ops/proposals/route.ts");
const page = read("src/app/admin/source-ops/page.tsx");
const layout = read("src/components/layouts/AdminLayout.tsx");

for (const vendor of ["META", "KAKAO", "NAVER", "GOOGLE"]) {
  if (!service.includes(vendor)) {
    fail(`source registry missing ${vendor}`);
  }
}

for (const token of [
  "review-only",
  "backend-agent",
  "mutationEnabled: false",
  "manualCollectionRecommended: false",
  "proposal queue",
]) {
  if (!service.includes(token)) {
    fail(`source ops safety contract missing ${token}`);
  }
}

if (!route.includes("buildCompassSourceOpsPlan")) {
  fail("source ops API must use CompassSourceOpsService");
}

for (const token of [
  "proposal-only",
  "dryRun: true",
  "mutationEnabled: false",
  "COMPASS_SOURCE_PROPOSAL_FETCH_ENABLED",
  "isAllowedPolicyHost",
]) {
  if (!proposalService.includes(token)) {
    fail(`source proposal service missing ${token}`);
  }
}

if (!proposalRoute.includes("buildCompassSourceProposalRun")) {
  fail("source proposal API must use CompassSourceProposalService");
}

for (const token of ["Compass 소스 관제", "review-only", "크롤링/청킹/임베딩 실행 없음"]) {
  if (!page.includes(token)) {
    fail(`source ops page missing ${token}`);
  }
}

for (const token of [
  "queueSnapshot",
  "queue {proposalRun.queueSnapshot.readStatus}",
  "pending {proposalRun.queueSnapshot.pendingCandidates}",
  "ReadOnlyQueueInventory",
  "AI 제안 소스 검토 인벤토리",
  "승인 기능 준비중",
  "승인/반려/색인/승격 동작을 실행하지 않습니다",
  "/api/admin/source-ops/proposals?maxSources=7&queueLimit=20",
]) {
  if (!page.includes(token)) {
    fail(`source ops page missing queue readback token ${token}`);
  }
}

for (const forbidden of [
  "method: \"POST\"",
  "method: 'POST'",
  "fetch=true",
  "POST /api/admin/source-ops/proposals",
  "POST /api/internal/source-proposals/dry-run",
]) {
  if (page.includes(forbidden)) {
    fail(`source ops page must remain read-only and must not include ${forbidden}`);
  }
}

if (!layout.includes("/admin/source-ops") || !layout.includes("소스 관제")) {
  fail("admin navigation must expose source ops page");
}

if (!process.exitCode) {
  console.log("[check-compass-source-ops-contract] ok");
}
