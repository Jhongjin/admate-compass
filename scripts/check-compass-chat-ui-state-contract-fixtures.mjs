#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(root, "docs/rag/compass-chat-ui-state-contract-fixtures.json");
const devRendererPath = path.join(root, "src/app/dev/chat-ui-state-fixtures/page.tsx");

const allowedStates = new Set([
  "initial-empty",
  "source-found",
  "noData",
  "generation-limited",
  "retrieval-limited",
  "error",
]);

const requiredStates = new Set([
  "initial-empty",
  "source-found",
  "noData",
  "generation-limited",
  "retrieval-limited",
  "error",
]);

const allowedViewportClasses = new Set([
  "desktop-lg",
  "tablet",
  "mobile",
  "small-mobile",
]);

const mobileViewportClasses = new Set(["mobile", "small-mobile"]);

const requiredForbiddenInternalText = [
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

const operationalBooleanFlags = [
  "productionApiCalled",
  "ragSearchExecuted",
  "browserUsed",
  "dbTouched",
];

function fail(message) {
  console.error(`[check-compass-chat-ui-state-contract-fixtures] ${message}`);
  process.exitCode = 1;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
    return false;
  }
  return true;
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    fail(`${label} must be boolean`);
    return false;
  }
  return true;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
    return false;
  }
  return true;
}

function assertStringArray(value, label, minLength = 0) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
    return false;
  }

  if (value.length < minLength) {
    fail(`${label} must include at least ${minLength} item(s)`);
    return false;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      fail(`${label}[${index}] must be a non-empty string`);
    }
  }

  return true;
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function includesText(text, fragment) {
  return normalize(text).includes(normalize(fragment));
}

function collectDisplayStrings(fixture) {
  const strings = [];

  function visit(value) {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (!isPlainObject(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "expectedHiddenText" || key === "notes") continue;
      visit(item);
    }
  }

  visit({
    promptExpectation: fixture.promptExpectation,
    message: fixture.message,
    sources: fixture.sources,
    expectedVisibleText: fixture.expectedVisibleText,
    expectedControls: fixture.expectedControls,
    panelExpectation: fixture.panelExpectation,
  });

  return strings;
}

function validatePromptExpectation(fixture, label) {
  const promptExpectation = fixture.promptExpectation;

  if (fixture.state === "initial-empty") {
    if (promptExpectation !== undefined) {
      fail(`${label}.initial-empty must not include promptExpectation`);
    }
    return;
  }

  if (!isPlainObject(promptExpectation)) {
    fail(`${label}.promptExpectation must be an object for conversational states`);
    return;
  }

  assertString(promptExpectation.userPrompt, `${label}.promptExpectation.userPrompt`);
  assertBoolean(promptExpectation.promptVisible, `${label}.promptExpectation.promptVisible`);
  assertBoolean(promptExpectation.resultLinkedToPrompt, `${label}.promptExpectation.resultLinkedToPrompt`);

  if (promptExpectation.promptVisible !== true) {
    fail(`${label}.promptExpectation.promptVisible must be true`);
  }

  if (promptExpectation.resultLinkedToPrompt !== true) {
    fail(`${label}.promptExpectation.resultLinkedToPrompt must be true`);
  }

  if (includesText(fixture.message?.content, promptExpectation.userPrompt)) {
    fail(`${label}.message.content must not duplicate the user prompt`);
  }
}

function requireHiddenTextCoverage(hiddenText, fixtureLabel, fragments) {
  for (const fragment of fragments) {
    if (!hiddenText.some((item) => includesText(item, fragment))) {
      fail(`${fixtureLabel}.expectedHiddenText must include forbidden fragment "${fragment}"`);
    }
  }
}

function validateContract(contract) {
  if (!isPlainObject(contract)) {
    fail("contract must be an object");
    return;
  }

  assertString(contract.name, "contract.name");
  assertString(contract.version, "contract.version");
  if (contract.syntheticOnly !== true) fail("contract.syntheticOnly must be true");
  if (contract.routeSurface !== "desk") fail("contract.routeSurface must be desk");

  for (const flag of operationalBooleanFlags) {
    assertBoolean(contract[flag], `contract.${flag}`);
    if (contract[flag] !== false) fail(`contract.${flag} must be false`);
  }
}

function validateDevRendererPromptBinding() {
  if (!fs.existsSync(devRendererPath)) {
    fail(`dev renderer not found: ${path.relative(root, devRendererPath)}`);
    return;
  }

  const source = fs.readFileSync(devRendererPath, "utf8");
  if (!source.includes("fixture.promptExpectation?.userPrompt")) {
    fail("dev fixture renderer must read fixture.promptExpectation.userPrompt");
  }
  if (!source.includes("{fixture.promptExpectation.userPrompt}")) {
    fail("dev fixture renderer must render the fixture-specific user prompt");
  }
  if (!source.includes("userQuestion={fixture.promptExpectation?.userPrompt}")) {
    fail("dev fixture renderer must pass the fixture prompt to SourceStatePanel");
  }
  if (source.includes("Fixture review question")) {
    fail("dev fixture renderer must not use the old generic fixture prompt");
  }
}

function validateSource(source, label) {
  if (!isPlainObject(source)) {
    fail(`${label} must be an object`);
    return;
  }

  assertString(source.id, `${label}.id`);
  assertString(source.title, `${label}.title`);
  assertString(source.excerpt, `${label}.excerpt`);

  if (source.url !== undefined) {
    assertString(source.url, `${label}.url`);
    if (!source.url.startsWith("https://example.invalid/")) {
      fail(`${label}.url must use the offline example.invalid domain`);
    }
  }
}

function validateControls(fixture, label) {
  if (!Array.isArray(fixture.expectedControls)) {
    fail(`${label}.expectedControls must be an array`);
    return;
  }

  const controls = new Map();
  for (const [index, control] of fixture.expectedControls.entries()) {
    const controlLabel = `${label}.expectedControls[${index}]`;
    if (!isPlainObject(control)) {
      fail(`${controlLabel} must be an object`);
      continue;
    }
    if (assertString(control.id, `${controlLabel}.id`)) controls.set(control.id, control);
    assertString(control.label, `${controlLabel}.label`);
    assertBoolean(control.available, `${controlLabel}.available`);
  }

  const toggle = controls.get("source-toggle");
  if (!toggle) {
    fail(`${label}.expectedControls must include source-toggle`);
    return;
  }

  if (fixture.sources.length > 0 && toggle.available !== true) {
    fail(`${label}.source-toggle must be available when sources exist`);
  }

  if (fixture.sources.length === 0 && toggle.available !== false) {
    fail(`${label}.source-toggle must be unavailable when sources are empty`);
  }
}

function validatePanelExpectation(fixture, label) {
  const panel = fixture.panelExpectation;
  if (!isPlainObject(panel)) {
    fail(`${label}.panelExpectation must be an object`);
    return;
  }

  if (!["right-panel", "compact-panel"].includes(panel.surface)) {
    fail(`${label}.panelExpectation.surface must be right-panel or compact-panel`);
  }
  assertString(panel.heading, `${label}.panelExpectation.heading`);
  assertNonNegativeInteger(panel.sourceCount, `${label}.panelExpectation.sourceCount`);

  if (panel.sourceCount !== fixture.sources.length) {
    fail(`${label}.panelExpectation.sourceCount must equal sources.length`);
  }

  const isMobile = mobileViewportClasses.has(fixture.viewportClass);
  if (isMobile) {
    if (panel.surface !== "compact-panel") fail(`${label}.mobile surface must be compact-panel`);
    if (panel.compactPanelRendered !== true) fail(`${label}.mobile compactPanelRendered must be true`);
    if (panel.insideChatScrollArea !== true) fail(`${label}.mobile panel must be inside chat scroll area`);
    if (panel.inputBarNotCovered !== true) fail(`${label}.mobile panel must not cover input bar`);
    if (panel.desktopRightPanelRendered !== false) fail(`${label}.mobile desktop right panel must be false`);
  } else {
    if (panel.surface !== "right-panel") fail(`${label}.desktop surface must be right-panel`);
  }
}

function validateStateContract(fixture, label) {
  const sourceCount = fixture.sources.length;
  const expectedVisible = fixture.expectedVisibleText.join("\n");
  const controlsById = new Map(fixture.expectedControls.map((control) => [control.id, control]));

  if (fixture.state === "initial-empty") {
    if (sourceCount !== 0) fail(`${label}.initial-empty must not include sources`);
    if (fixture.panelExpectation.compactPanelRendered !== false) {
      fail(`${label}.initial-empty must not render compact source panel`);
    }
    if (!includesText(expectedVisible, "질문")) fail(`${label}.initial-empty visible copy must invite a question`);
  }

  if (fixture.state === "source-found") {
    if (sourceCount < 1) fail(`${label}.source-found must include at least one source`);
    if (!includesText(expectedVisible, `확인한 출처 ${sourceCount}개 보기`)) {
      fail(`${label}.source-found visible text must include matching source count`);
    }
    if (fixture.panelExpectation.cardsVisible !== true) fail(`${label}.source-found must show source cards`);
    if (fixture.panelExpectation.sourceLedgerVisible !== true) fail(`${label}.source-found must show source ledger`);
    if (fixture.panelExpectation.sourceIdentityVisible !== true) fail(`${label}.source-found must show source identity strip`);
  }

  if (fixture.state === "noData") {
    if (sourceCount !== 0) fail(`${label}.noData must not include sources`);
    if (fixture.message.noDataFound !== true) fail(`${label}.noData message.noDataFound must be true`);
    if (fixture.panelExpectation.cardsVisible !== false) fail(`${label}.noData must not show source cards`);
    if (!includesText(expectedVisible, "확인 가능한 출처")) {
      fail(`${label}.noData must include vendor-neutral noData copy`);
    }
  }

  if (fixture.state === "generation-limited") {
    if (sourceCount < 1) fail(`${label}.generation-limited must preserve sources`);
    if (fixture.panelExpectation.limitationBannerVisible !== true) {
      fail(`${label}.generation-limited must show limitation banner`);
    }
    if (fixture.panelExpectation.sourceLedgerVisible !== true) fail(`${label}.generation-limited must show source ledger`);
    if (fixture.panelExpectation.sourceIdentityVisible !== true) fail(`${label}.generation-limited must show source identity strip`);
    if (!includesText(expectedVisible, "답변 정리 제한")) {
      fail(`${label}.generation-limited must include limited-generation panel heading`);
    }
  }

  if (fixture.state === "retrieval-limited") {
    if (sourceCount !== 0) fail(`${label}.retrieval-limited must not include sources`);
    if (fixture.message.noDataFound !== false) fail(`${label}.retrieval-limited message.noDataFound must be false`);
    if (fixture.panelExpectation.cardsVisible !== false) fail(`${label}.retrieval-limited must not show source cards`);
    if (!includesText(expectedVisible, "출처 검색 제한")) {
      fail(`${label}.retrieval-limited must include retrieval-limited panel heading`);
    }
    if (!includesText(expectedVisible, "자료 없음으로 판단하지 않고")) {
      fail(`${label}.retrieval-limited must distinguish limited retrieval from authoritative noData`);
    }
  }

  if (fixture.state === "error") {
    if (sourceCount !== 0) fail(`${label}.error must not include sources`);
    if (fixture.panelExpectation.cardsVisible !== false) fail(`${label}.error must not show source cards`);
    if (controlsById.get("source-toggle")?.available !== false) {
      fail(`${label}.error source toggle must be unavailable with empty sources`);
    }
    if (!includesText(expectedVisible, "오류")) fail(`${label}.error must include temporary error copy`);
  }
}

function validateDisplayTextSafety(fixture, label, forbiddenInternalText) {
  const displayText = collectDisplayStrings(fixture).join("\n");

  for (const required of fixture.expectedVisibleText) {
    if (!includesText(displayText, required)) {
      fail(`${label} display strings must include expected visible fragment "${required}"`);
    }
  }

  for (const forbidden of forbiddenInternalText) {
    if (includesText(displayText, forbidden)) {
      fail(`${label} display text exposes forbidden internal fragment "${forbidden}"`);
    }
  }

  for (const hidden of fixture.expectedHiddenText) {
    if (includesText(displayText, hidden)) {
      fail(`${label} display text includes expected hidden fragment "${hidden}"`);
    }
  }
}

if (!fs.existsSync(fixturePath)) {
  fail(`fixture file not found: ${path.relative(root, fixturePath)}`);
  process.exit();
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
} catch (error) {
  fail(`fixture file must be valid JSON: ${error.message}`);
  process.exit();
}

if (!isPlainObject(payload)) {
  fail("fixture file must contain an object");
  process.exit();
}

validateContract(payload.contract);
validateDevRendererPromptBinding();
assertStringArray(payload.forbiddenInternalText, "forbiddenInternalText", requiredForbiddenInternalText.length);
requireHiddenTextCoverage(payload.forbiddenInternalText || [], "forbiddenInternalText", requiredForbiddenInternalText);

if (!Array.isArray(payload.fixtures)) {
  fail("fixtures must be an array");
  process.exit();
}

if (payload.fixtures.length < 8) {
  fail("fixtures must include required states plus useful mobile variants");
}

const ids = new Set();
const stateCounts = new Map();
const mobileStateCounts = new Map();
let sourceFoundLongTitleCases = 0;
let generationLimitedSourcePreservationCases = 0;
let promptBoundConversationCases = 0;

for (const [index, fixture] of payload.fixtures.entries()) {
  const label = `fixtures[${index}]`;
  if (!isPlainObject(fixture)) {
    fail(`${label} must be an object`);
    continue;
  }

  if (assertString(fixture.id, `${label}.id`)) {
    if (ids.has(fixture.id)) fail(`${label}.id must be unique: ${fixture.id}`);
    ids.add(fixture.id);
  }

  assertBoolean(fixture.synthetic, `${label}.synthetic`);
  if (fixture.synthetic !== true) fail(`${label}.synthetic must be true`);
  if (fixture.routeSurface !== "desk") fail(`${label}.routeSurface must be desk`);
  if (!allowedViewportClasses.has(fixture.viewportClass)) {
    fail(`${label}.viewportClass must be one of ${Array.from(allowedViewportClasses).join(", ")}`);
  }
  if (!allowedStates.has(fixture.state)) {
    fail(`${label}.state must be one of ${Array.from(allowedStates).join(", ")}`);
  }

  if (!isPlainObject(fixture.message)) {
    fail(`${label}.message must be an object`);
  } else {
    if (!["assistant", "user"].includes(fixture.message.role)) {
      fail(`${label}.message.role must be assistant or user`);
    }
    assertString(fixture.message.content, `${label}.message.content`);
    assertBoolean(fixture.message.noDataFound, `${label}.message.noDataFound`);
    if (!Array.isArray(fixture.message.sources)) {
      fail(`${label}.message.sources must be an array of source ids`);
    }
  }

  if (!Array.isArray(fixture.sources)) {
    fail(`${label}.sources must be an array`);
    fixture.sources = [];
  }

  for (const [sourceIndex, source] of fixture.sources.entries()) {
    validateSource(source, `${label}.sources[${sourceIndex}]`);
  }

  const sourceIds = new Set(fixture.sources.map((source) => source.id));
  for (const [messageSourceIndex, sourceId] of (fixture.message?.sources || []).entries()) {
    if (!sourceIds.has(sourceId)) {
      fail(`${label}.message.sources[${messageSourceIndex}] must reference a fixture source id`);
    }
  }

  assertStringArray(fixture.expectedVisibleText, `${label}.expectedVisibleText`, 1);
  assertStringArray(fixture.expectedHiddenText, `${label}.expectedHiddenText`, 1);
  requireHiddenTextCoverage(fixture.expectedHiddenText || [], label, requiredForbiddenInternalText);
  validateControls(fixture, label);
  validatePanelExpectation(fixture, label);
  validatePromptExpectation(fixture, label);
  validateStateContract(fixture, label);
  validateDisplayTextSafety(fixture, label, payload.forbiddenInternalText || []);
  assertString(fixture.notes, `${label}.notes`);

  stateCounts.set(fixture.state, (stateCounts.get(fixture.state) || 0) + 1);
  if (mobileViewportClasses.has(fixture.viewportClass)) {
    mobileStateCounts.set(fixture.state, (mobileStateCounts.get(fixture.state) || 0) + 1);
  }
  if (fixture.state === "source-found" && fixture.panelExpectation?.longTextWrapRequired) {
    sourceFoundLongTitleCases += 1;
  }
  if (fixture.state === "generation-limited" && fixture.sources.length > 0) {
    generationLimitedSourcePreservationCases += 1;
  }
  if (fixture.state !== "initial-empty" && fixture.promptExpectation?.promptVisible === true) {
    promptBoundConversationCases += 1;
  }
}

for (const state of requiredStates) {
  if (!stateCounts.has(state)) fail(`missing required state: ${state}`);
}

for (const state of ["source-found", "noData", "generation-limited", "retrieval-limited", "error"]) {
  if (!mobileStateCounts.has(state)) fail(`missing mobile fixture for state: ${state}`);
}

if ((stateCounts.get("source-found") || 0) < 3) fail("expected at least three source-found fixtures");
if (sourceFoundLongTitleCases < 1) fail("expected at least one long Korean source title fixture");
if (generationLimitedSourcePreservationCases < 2) {
  fail("expected at least two generation-limited source preservation fixtures");
}
if (promptBoundConversationCases < payload.fixtures.length - (stateCounts.get("initial-empty") || 0)) {
  fail("all conversational fixtures must include prompt-visible binding");
}

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    mode: "compass-chat-ui-state-contract-fixtures",
    fixtureCount: payload.fixtures.length,
    states: Object.fromEntries(stateCounts),
    mobileStates: Object.fromEntries(mobileStateCounts),
    forbiddenInternalTextCount: payload.forbiddenInternalText.length,
    sourceFoundLongTitleCases,
    generationLimitedSourcePreservationCases,
    promptBoundConversationCases,
    productionApiCalled: false,
    ragSearchExecuted: false,
    browserUsed: false,
    dbTouched: false,
  }, null, 2));
}
