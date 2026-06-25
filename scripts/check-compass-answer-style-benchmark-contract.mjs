#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const servicePath = path.join(root, "src/lib/services/CompassAnswerLlmService.ts");
const handlerPath = path.join(root, "src/lib/server/compassAnswerHandler.ts");

function fail(message) {
  console.error(`[check-compass-answer-style-benchmark-contract] ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(servicePath)) {
  fail(`missing file: ${path.relative(root, servicePath)}`);
  process.exit(process.exitCode || 1);
}

const source = fs.readFileSync(servicePath, "utf8");
const handlerSource = fs.existsSync(handlerPath) ? fs.readFileSync(handlerPath, "utf8") : "";

const requiredFragments = [
  ["확인된 핵심부터 답변", "ambiguous questions must answer the confirmed core first"],
  ["추가 확인 질문", "ambiguous questions must ask only concrete missing follow-ups"],
  ["수집/색인 보강 필요 범위", "evidence gaps must separate corpus/indexing insufficiency"],
  ["검색된 검증 근거 부족", "evidence gaps must separate retrieval insufficiency"],
  ["질문 범위 밖 세부 조건", "evidence gaps must separate out-of-scope details"],
  ["상품명 또는 상품군 / 언제 쓰는지 / 소재·데이터·규격 확인 / 측정·운영 주의점 / 부족한 범위", "product and creative answers must use an operational structure"],
  ["네이버·카카오 상품 답변", "Naver/Kakao product answers must avoid only broad categories"],
  ["ADVoost 쇼핑", "Naver detailed product names must be preserved when grounded"],
  ["커뮤니케이션 애드", "Naver communication ad product name must be preserved when grounded"],
  ["치지직", "Naver Chzzk product name must be preserved when grounded"],
  ["비즈보드", "Kakao Biz Board product name must be preserved when grounded"],
  ["상품 카탈로그", "Kakao catalog product name must be preserved when grounded"],
  ["키워드광고", "Kakao keyword ad product name must be preserved when grounded"],
  ["브랜드검색", "Kakao brand search product name must be preserved when grounded"],
  ["톡채널검색", "Kakao talk channel search product name must be preserved when grounded"],
  ["보장형/CPT", "Kakao guaranteed/CPT product name must be preserved when grounded"],
  ["근거에 없는 이름은 추가하지 마세요", "detailed product names must stay inside verified evidence"],
  ["고정 대비형 서두", "answers must avoid canned contrast openings"],
  ['"확인 항목", "준비 항목", "운영 기준", "주의사항"', "table headings must use operational nouns instead of vague view labels"],
  ['"...봅니다"/"...봐야 합니다"', "answers must avoid repeated hesitant view predicates"],
  ["확인합니다, 점검합니다, 사용합니다, 준비합니다, 비교합니다, 분리합니다, 선택합니다", "answers must use context-specific action verbs"],
  ["소재/데이터 확인 항목", "style polish must rewrite the repeated material/data table heading"],
  ["심사 확인 항목", "style polish must rewrite vague review table heading"],
  ["CANNED_CONTRAST_OPENING_PATTERN", "generated answers must strip canned contrast openings"],
  ["ACTION_VERB_REPLACEMENTS", "generated answers must normalize repeated view predicates"],
  ["polishCompassAnswerStyle(answer)", "all generated answer providers must apply the style polish"],
];

for (const [fragment, description] of requiredFragments) {
  if (!source.includes(fragment)) {
    fail(`${description}: missing "${fragment}"`);
  }
}

if (!source.includes("If the user question is under-specified, answer the confirmed core first")) {
  fail("system prompt must handle under-specified questions without refusing useful grounded defaults");
}

if (!source.includes("insufficient collected/indexed data")) {
  fail("system prompt must distinguish insufficient collected/indexed data from ordinary retrieval gaps");
}

const stylePolishCalls = [...source.matchAll(/polishCompassAnswerStyle\(answer\)/g)].length;
if (stylePolishCalls < 3) {
  fail("style polish must run for OpenRouter, OpenAI, and Ollama answer providers");
}

if (!handlerSource.includes("polishCompassAnswerStyle")) {
  fail("deterministic answer handler must reuse the same style polish");
}

for (const banned of [
  "네이버 광고 상품은 “검색광고 몇 개”로만 보면 빠집니다",
  "카카오 광고는 “카카오모먼트 하나”로 뭉뚱그리기보다",
  "소재/데이터에서 먼저 볼 것",
]) {
  if (handlerSource.includes(banned)) {
    fail(`deterministic answer template must not include old canned wording: ${banned}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("[check-compass-answer-style-benchmark-contract] answer style benchmark contract passed.");
