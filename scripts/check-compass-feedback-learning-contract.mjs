#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = {
  desk: path.join(root, "src/app/desk/page.tsx"),
  bubble: path.join(root, "src/components/chat/ChatBubble.tsx"),
  feedback: path.join(root, "src/app/api/feedback/route.ts"),
  apiOwner: path.join(root, "src/lib/auth/compassApiOwner.ts"),
  contact: path.join(root, "src/app/api/contact/route.ts"),
  answerHandler: path.join(root, "src/lib/server/compassAnswerHandler.ts"),
  migration: path.join(root, "supabase/migrations/20260615000000_create_compass_feedback_learning_queue.sql"),
  packageJson: path.join(root, "package.json"),
};

function fail(message) {
  console.error(`[check-compass-feedback-learning-contract] ${message}`);
  process.exitCode = 1;
}

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing file: ${path.relative(root, filePath)}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

const desk = read(files.desk);
const bubble = read(files.bubble);
const feedback = read(files.feedback);
const apiOwner = read(files.apiOwner);
const contact = read(files.contact);
const answerHandler = read(files.answerHandler);
const migration = read(files.migration);
const packageJson = JSON.parse(read(files.packageJson) || "{}");

for (const snippet of [
  "resolveCompassApiOwner",
  "learning_feedback",
  "compass-hermes-learning-feedback",
  "directModelUpdate: false",
  "requiresHumanReview: true",
  "reviewPipeline",
  "question: truncate(payload.question)",
  "answer: truncate(payload.answer)",
  "saveLearningCandidateToStorage",
]) {
  if (!feedback.includes(snippet)) fail(`feedback route missing ${snippet}`);
}

for (const snippet of [
  "readCompassProductSessionFromRequest",
  "supabase.auth.getUser",
  "product-session",
  "supabase-auth",
]) {
  if (!apiOwner.includes(snippet)) fail(`api owner helper missing ${snippet}`);
}

for (const snippet of [
  "create table if not exists compass.feedback",
  "create table if not exists compass.learning_feedback",
  "learning_status text not null default 'candidate'",
  "review_pipeline jsonb",
  "unique(owner_subject, message_id)",
]) {
  if (!migration.toLowerCase().includes(snippet)) fail(`migration missing ${snippet}`);
}

for (const snippet of [
  "onContact={shouldOfferContactForMessage(message)",
  "showContactOption={Boolean(message.showContactOption)}",
  "reviewPipeline={message.reviewPipeline}",
  "question: actualQuestion",
  "answer: message.content",
  "sources: message.sources || []",
  "reviewPipeline: message.reviewPipeline",
  "Hermes 학습 후보 큐에 함께 남겼습니다.",
]) {
  if (!desk.includes(snippet)) fail(`desk page missing ${snippet}`);
}

if (desk.includes("showContactOption={false}")) {
  fail("desk page must not hard-disable answer contact option");
}

for (const snippet of [
  "onContact?: () => void",
  "reviewPipeline?: CompassReviewPipeline",
  "Hermes 학습 후보 기록됨",
  "담당자 확인 요청",
  "2단계 검토 완료",
]) {
  if (!bubble.includes(snippet)) fail(`ChatBubble missing ${snippet}`);
}

for (const snippet of [
  "담당자 확인 메일 초안이 생성되었습니다.",
  "Compass AI 답변",
  "확인한 출처",
  "COMPASS_CONTACT_EMAIL",
]) {
  if (!contact.includes(snippet)) fail(`contact route missing ${snippet}`);
}

for (const forbidden of [
  "메일이 성공적으로 발송되었습니다",
  "페이스북 담당팀",
]) {
  if (contact.includes(forbidden) || desk.includes(forbidden)) {
    fail(`contact flow must not imply direct send or Facebook-only ownership: ${forbidden}`);
  }
}

for (const snippet of [
  "function buildReviewPipeline",
  "reviewPipeline: buildReviewPipeline",
  "reviewPipeline,",
  "Compass 답변은 확인된 출처 범위 안에서만 제공",
]) {
  if (!answerHandler.includes(snippet)) fail(`answer handler missing ${snippet}`);
}

if (packageJson.scripts?.["check:compass-feedback-learning-contract"] !== "node scripts/check-compass-feedback-learning-contract.mjs") {
  fail("package script check:compass-feedback-learning-contract is missing or changed");
}

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    mode: "compass-feedback-learning-contract",
    feedbackCandidateQueue: true,
    contactButtonVisibleAfterAnswer: true,
    reviewPipelineVisible: true,
    directModelUpdate: false,
  }, null, 2));
}
