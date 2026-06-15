#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const panelPath = path.join(root, "src/components/chat/SourceStatePanel.tsx");
const fixturePath = path.join(root, "docs/rag/compass-chat-ui-state-contract-fixtures.json");

const requiredPanelSnippets = [
  "const NO_DATA_MESSAGE",
  "현재 Compass 문서에서 확인 가능한 출처를 찾지 못했습니다",
  "플랫폼명, 정책 항목, 소재 유형",
  "const ERROR_MESSAGE",
  "일시적인 서비스 오류로 답변을 만들지 못했습니다",
  "state === \"generation-limited\"",
  "state === \"answer-pending\"",
  "state === \"noData\"",
  "state === \"error\"",
  "state === \"initial-empty\"",
  "const heading = isPending ? \"답변 준비 중\" : isLimited ? \"답변 생성 제한\" : hasSources ? \"확인한 출처\" : \"확인한 출처 없음\"",
  "결과가 도착하면 출처 상태가 여기에 표시됩니다",
  "출처는 찾았지만 답변 문장 생성이 제한되었습니다",
  "확인한 출처 {sources.length}개 보기",
  "sources.slice(0, compact ? 3 : 6)",
  "line-clamp-2 break-words",
  "line-clamp-3",
  "min-w-0 flex-1",
  "flex flex-wrap",
  "sourceOpenMode === \"noop\"",
  "userQuestion && !compact",
  "질문: {userQuestion}",
  "const getSourceVendorLabel",
  "const getSourceIntegrityLabel",
  "const sourceLedger =",
  "확인한 출처",
  "원문 링크",
  "발췌 있음",
  "매체 확인",
  "aria-label={source.sourceType === \"file\" ? \"파일 다운로드\" : \"출처 문서 열기\"}",
  "aria-label={isExpanded ? \"출처 문서 접기\" : \"출처 문서 펼치기\"}",
];

const forbiddenPanelSnippets = [
  "schema=compass",
  "sourcesCount",
  "retrievalMethod",
  "sourceQuality",
  "hybridScore",
  "vectorScore",
  "keywordScore",
  "ollama_document_chunks",
  "RAGSearchService",
  "raw source",
  "raw provider",
  "raw payload",
  "provider payload",
  "stack trace",
  "/api/chat-ollama",
  "token",
  "cookie",
  "credential",
  "secret",
  "signedUrl",
  "apiKey",
  "privateKey",
  "authorization",
  "bearer",
  "password",
  ".env",
  "SUPABASE",
  "GEMINI",
  "ANTHROPIC",
  "OPENAI",
];

const requiredFixtureStates = new Set([
  "source-found",
  "noData",
  "generation-limited",
  "error",
]);

function fail(message) {
  console.error(`[check-compass-source-panel-rendering-contract] ${message}`);
  process.exitCode = 1;
}

function readText(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`missing ${label}: ${path.relative(root, filePath)}`);
    return "";
  }

  return fs.readFileSync(filePath, "utf8");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function includesText(text, fragment) {
  return String(text || "").toLowerCase().includes(String(fragment).toLowerCase());
}

function assertPanelSource(source) {
  for (const snippet of requiredPanelSnippets) {
    if (!source.includes(snippet)) {
      fail(`SourceStatePanel must include rendering contract snippet: ${snippet}`);
    }
  }

  for (const snippet of forbiddenPanelSnippets) {
    if (includesText(source, snippet)) {
      fail(`SourceStatePanel must not expose internal/sensitive fragment: ${snippet}`);
    }
  }

  const noopIndex = source.indexOf("sourceOpenMode === \"noop\"");
  const fetchIndex = source.indexOf("fetch(source.url)");
  const windowOpenIndex = source.indexOf("window.open(source.url");
  if (fetchIndex !== -1 && (noopIndex === -1 || noopIndex > fetchIndex)) {
    fail("sourceOpenMode noop guard must appear before file fetch handling");
  }
  if (windowOpenIndex !== -1 && (noopIndex === -1 || noopIndex > windowOpenIndex)) {
    fail("sourceOpenMode noop guard must appear before URL open handling");
  }
}

function readFixturePayload() {
  const text = readText(fixturePath, "chat UI state fixture contract");
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`fixture JSON must parse: ${error.message}`);
    return null;
  }
}

function assertFixturePairing(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.fixtures)) {
    fail("fixture payload must contain a fixtures array");
    return { fixtureCount: 0, mobileCompactCases: 0, promptLinkedCases: 0 };
  }

  const states = new Set();
  let mobileCompactCases = 0;
  let promptLinkedCases = 0;
  let noDataCases = 0;
  let generationLimitedCases = 0;
  let errorCases = 0;

  for (const [index, fixture] of payload.fixtures.entries()) {
    const label = `fixtures[${index}]`;
    if (!isPlainObject(fixture)) {
      fail(`${label} must be an object`);
      continue;
    }

    states.add(fixture.state);

    const hasSources = Array.isArray(fixture.sources) && fixture.sources.length > 0;
    const panel = fixture.panelExpectation || {};
    const isMobile = fixture.viewportClass === "mobile" || fixture.viewportClass === "small-mobile";

    if (isMobile) {
      mobileCompactCases += 1;
      if (panel.surface !== "compact-panel") fail(`${label}.mobile surface must be compact-panel`);
      if (panel.inputBarNotCovered !== true) fail(`${label}.mobile must assert inputBarNotCovered`);
      if (panel.desktopRightPanelRendered !== false) fail(`${label}.mobile must assert no desktop right panel`);
    }

    if (fixture.state !== "initial-empty") {
      if (fixture.promptExpectation?.promptVisible !== true) fail(`${label}.promptVisible must be true`);
      if (fixture.promptExpectation?.resultLinkedToPrompt !== true) fail(`${label}.resultLinkedToPrompt must be true`);
      promptLinkedCases += 1;
    }

    if (fixture.state === "source-found" && !hasSources) {
      fail(`${label}.source-found must include sources`);
    }

    if (hasSources) {
      if (panel.sourceLedgerVisible !== true) fail(`${label}.source ledger must be visible when sources exist`);
      if (panel.sourceIdentityVisible !== true) fail(`${label}.source identity strip must be visible when sources exist`);
    }

    if (fixture.state === "noData") {
      noDataCases += 1;
      if (hasSources) fail(`${label}.noData must not include sources`);
      if (fixture.message?.noDataFound !== true) fail(`${label}.noData message.noDataFound must be true`);
      if (panel.cardsVisible !== false) fail(`${label}.noData must assert cardsVisible=false`);
    }

    if (fixture.state === "generation-limited") {
      generationLimitedCases += 1;
      if (!hasSources) fail(`${label}.generation-limited must preserve sources`);
      if (panel.limitationBannerVisible !== true) fail(`${label}.generation-limited must assert limitation banner`);
    }

    if (fixture.state === "error") {
      errorCases += 1;
      if (hasSources) fail(`${label}.error must not include sources`);
      if (panel.cardsVisible !== false) fail(`${label}.error must assert cardsVisible=false`);
    }
  }

  for (const state of requiredFixtureStates) {
    if (!states.has(state)) fail(`missing source panel fixture state: ${state}`);
  }
  if (mobileCompactCases < 4) fail("expected at least four mobile compact source panel fixtures");
  if (noDataCases < 2) fail("expected desktop and mobile noData source panel fixtures");
  if (generationLimitedCases < 2) fail("expected desktop and mobile generation-limited fixtures");
  if (errorCases < 2) fail("expected desktop and mobile error fixtures");

  return {
    fixtureCount: payload.fixtures.length,
    mobileCompactCases,
    promptLinkedCases,
    noDataCases,
    generationLimitedCases,
    errorCases,
  };
}

const panelSource = readText(panelPath, "SourceStatePanel");
const fixturePayload = readFixturePayload();

assertPanelSource(panelSource);
const coverage = assertFixturePairing(fixturePayload);

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    mode: "compass-source-panel-rendering-contract",
    component: path.relative(root, panelPath).replace(/\\/g, "/"),
    fixtureContract: path.relative(root, fixturePath).replace(/\\/g, "/"),
    ...coverage,
    productionApiCalled: false,
    browserUsed: false,
    sessionMaterialUsed: false,
    ragSearchExecuted: false,
    dbTouched: false,
  }, null, 2));
}
