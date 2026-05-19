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
const scheduleDoc = read("docs/tasks/2026-05-17_compass_source_ops_agent_schedule_contract_result_v1.md");

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
  "agentAction",
  "reviewUrgency",
  "nextReviewAt",
  "buildAgentAction",
  "queue_exact_url",
  "queue_domain_discovery",
  "review_extraction",
  "refresh_candidate",
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

for (const token of ["Compass 문서 관제", "검토 전용", "수집/문서 구간 생성/검색 반영 실행 없음"]) {
  if (!page.includes(token)) {
    fail(`source ops page missing ${token}`);
  }
}

for (const token of [
  "queueSnapshot",
  "검토 대기열 {queueReadStatusLabel(proposalRun.queueSnapshot.readStatus)}",
  "검토 대기열 확인",
  "대기열 저장",
  "검토 대기 {proposalRun.queueSnapshot.pendingCandidates}",
  "QueueReadOnlySummary",
  "SourceProposalControlLedger",
  "후보 반영 차단 내역",
  "문서 후보 반영 차단 내역",
  "제안 방식",
  "미리보기 · 변경 없음",
  "운영자 검토 전용",
  "반영 기능",
  "문서 반영",
  "문서/문서 구간 저장 없음",
  "검토 상태 분포",
  "위험도 분포",
  "ReadOnlyQueueInventory",
  "문서 후보 검토 목록",
  "승인 기능 준비중",
  "승인/반려/검색 반영 동작을 실행하지 않습니다",
  "/api/admin/source-ops/proposals?maxSources=7&queueLimit=20",
  "수집 점검 일정",
  "SourceAgentSchedule",
  "agentActionLabel",
  "urgencyClassName",
  "formatScheduleDate",
  "즉시 검토",
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

if (!layout.includes("/admin/source-ops") || !layout.includes("문서 관제")) {
  fail("admin navigation must expose source ops page");
}

if (
  !layout.includes("w-full overflow-x-hidden") ||
  !layout.includes("flex-1 min-w-0") ||
  !layout.includes("py-6 min-w-0")
) {
  fail("admin source ops shell must allow table-heavy pages to shrink on mobile");
}

for (const token of [
  "agentAction",
  "nextReviewAt",
  "reviewUrgency",
  "does not add Vercel Cron",
  "does not enable production queue writes",
  "operator-visible mode",
  "read-only",
]) {
  if (!scheduleDoc.includes(token)) {
    fail(`source ops schedule contract doc missing ${token}`);
  }
}

if (!process.exitCode) {
  console.log("[check-compass-source-ops-contract] ok");
}
