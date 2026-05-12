#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(root, "docs/rag/compass-qa-evidence-prompt-visible-fixtures.json");

const allowedStates = new Set(["source-found", "noData", "generation-limited", "error"]);
const allowedVerdicts = new Set(["pass", "fail", "blocked"]);
const allowedCaptureSurfaces = new Set([
  "sanitized_screenshot",
  "sanitized_screenshot_and_shape",
  "sanitized_shape_only",
  "checklist_entry",
]);
const allowedViewportClasses = new Set(["desktop", "tablet", "mobile", "small-mobile", "not_applicable"]);
const operationalBooleanFlags = [
  "productionApiCalled",
  "browserUsed",
  "sessionMaterialUsed",
  "ragSearchExecuted",
  "dbTouched",
];
const allowedResponseShapeKeys = new Set([
  "httpStatus",
  "ok",
  "noDataFound",
  "sourceCount",
  "generationLimited",
  "errorFlag",
]);
const forbiddenResponseShapeKeys = [
  /^(rawPayload|rawProvider|rawResponse|sources|sourceDocuments|documents)$/i,
  /(token|cookie|session|credential|secret|password|authorization|bearer|apiKey|privateKey)/i,
  /(code_hash|codeHash|source_run_hash|fingerprint)/i,
];

const guardedTextPatterns = [
  /\braw\s+(provider|payload|source|response)\b/i,
  /\b(cookie|token|credential|secret|signedUrl|apiKey|privateKey|authorization|bearer|password)\b/i,
  /\b(source_run_hash|fingerprint)\b/i,
  /\b(SUPABASE|GEMINI|ANTHROPIC|OPENAI)\b/i,
  /\.env\b/i,
];

function fail(message) {
  console.error(`[check-compass-qa-evidence-prompt-visible] ${message}`);
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

function collectDisplayStrings(value, strings = []) {
  if (typeof value === "string") {
    strings.push(value);
    return strings;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectDisplayStrings(item, strings);
    return strings;
  }

  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "expectedHiddenText" || key === "forbiddenEvidenceText") continue;
      collectDisplayStrings(item, strings);
    }
  }

  return strings;
}

function validateContract(contract) {
  if (!isPlainObject(contract)) {
    fail("contract must be an object");
    return;
  }

  assertString(contract.name, "contract.name");
  assertString(contract.version, "contract.version");
  if (contract.mode !== "offline_static_evidence_contract") {
    fail("contract.mode must be offline_static_evidence_contract");
  }

  for (const flag of operationalBooleanFlags) {
    assertBoolean(contract[flag], `contract.${flag}`);
    if (contract[flag] !== false) fail(`contract.${flag} must be false`);
  }
}

function validateResponseShape(record) {
  if (record.sanitizedResponseShape === undefined) return;

  const shape = record.sanitizedResponseShape;
  const label = `${record.id}.sanitizedResponseShape`;
  if (!isPlainObject(shape)) {
    fail(`${label} must be an object when present`);
    return;
  }

  for (const [key, value] of Object.entries(shape)) {
    if (!allowedResponseShapeKeys.has(key)) {
      fail(`${label}.${key} is not an allowlisted sanitized response field`);
    }
    for (const pattern of forbiddenResponseShapeKeys) {
      if (pattern.test(key)) fail(`${label}.${key} exposes forbidden response metadata`);
    }
    if (Array.isArray(value) || isPlainObject(value)) {
      fail(`${label}.${key} must be a scalar sanitized value`);
    }
    if (typeof value === "string") {
      for (const pattern of guardedTextPatterns) {
        if (pattern.test(value)) fail(`${label}.${key} exposes guarded text`);
      }
    }
  }

  if (!Number.isInteger(shape.httpStatus) || shape.httpStatus < 100 || shape.httpStatus > 599) {
    fail(`${label}.httpStatus must be an HTTP status integer`);
  }
  assertBoolean(shape.ok, `${label}.ok`);
  assertBoolean(shape.noDataFound, `${label}.noDataFound`);
  if (!Number.isInteger(shape.sourceCount) || shape.sourceCount < 0 || shape.sourceCount > 3) {
    fail(`${label}.sourceCount must be an integer from 0 to 3`);
  }
  assertBoolean(shape.generationLimited, `${label}.generationLimited`);
  assertBoolean(shape.errorFlag, `${label}.errorFlag`);

  if (record.expectedState === "noData") {
    if (shape.noDataFound !== true) fail(`${label}.noDataFound must be true for noData`);
    if (shape.sourceCount !== 0) fail(`${label}.sourceCount must be 0 for noData`);
  }

  if (record.expectedState === "source-found" || record.expectedState === "generation-limited") {
    if (shape.noDataFound !== false) fail(`${label}.noDataFound must be false for source-bearing states`);
    if (shape.sourceCount < 1) fail(`${label}.sourceCount must be >= 1 for source-bearing states`);
  }

  if (record.expectedState === "generation-limited" && shape.generationLimited !== true) {
    fail(`${label}.generationLimited must be true for generation-limited`);
  }
}

function validateEvidenceCapture(record) {
  const capture = record.evidenceCapture;
  const label = `${record.id}.evidenceCapture`;
  if (!isPlainObject(capture)) {
    fail(`${label} must be an object`);
    return;
  }

  assertBoolean(capture.promptVisible, `${label}.promptVisible`);
  assertBoolean(capture.resultLinkedToPrompt, `${label}.resultLinkedToPrompt`);
  assertBoolean(capture.terminalStateVisible, `${label}.terminalStateVisible`);
  assertString(capture.promptVisibilityAssertion, `${label}.promptVisibilityAssertion`);
  assertString(capture.captureSurface, `${label}.captureSurface`);
  assertString(capture.viewportClass, `${label}.viewportClass`);
  assertString(capture.evidenceLabel, `${label}.evidenceLabel`);

  if (!allowedCaptureSurfaces.has(capture.captureSurface)) {
    fail(`${label}.captureSurface must be one of ${Array.from(allowedCaptureSurfaces).join(", ")}`);
  }

  if (!allowedViewportClasses.has(capture.viewportClass)) {
    fail(`${label}.viewportClass must be one of ${Array.from(allowedViewportClasses).join(", ")}`);
  }

  if (record.resultVerdict === "pass" || record.resultVerdict === "fail") {
    if (capture.promptVisible !== true) {
      fail(`${record.id}: pass/fail QA evidence requires promptVisible=true`);
    }
    if (capture.resultLinkedToPrompt !== true) {
      fail(`${record.id}: pass/fail QA evidence requires resultLinkedToPrompt=true`);
    }
    if (capture.terminalStateVisible !== true) {
      fail(`${record.id}: pass/fail QA evidence requires terminalStateVisible=true`);
    }
  }

  if (capture.promptVisible === false) {
    if (record.resultVerdict !== "blocked") {
      fail(`${record.id}: prompt-hidden evidence must be blocked`);
    }
    if (record.blockReason !== "prompt_not_visible") {
      fail(`${record.id}: prompt-hidden evidence must use blockReason=prompt_not_visible`);
    }
  }
}

function validateDisplaySafety(record, forbiddenEvidenceText) {
  const displayText = collectDisplayStrings({
    fixtureId: record.fixtureId,
    prompt: record.prompt,
    expectedState: record.expectedState,
    resultVerdict: record.resultVerdict,
    evidenceCapture: record.evidenceCapture,
    sanitizedResponseShape: record.sanitizedResponseShape,
    expectedVisibleText: record.expectedVisibleText,
    blockReason: record.blockReason,
    notes: record.notes,
  }).join("\n");

  for (const required of record.expectedVisibleText || []) {
    if (!includesText(displayText, required)) {
      fail(`${record.id}: display text missing expected fragment "${required}"`);
    }
  }

  for (const hidden of record.expectedHiddenText || []) {
    if (includesText(displayText, hidden)) {
      fail(`${record.id}: display text includes expected hidden fragment "${hidden}"`);
    }
  }

  for (const forbidden of forbiddenEvidenceText || []) {
    if (includesText(displayText, forbidden)) {
      fail(`${record.id}: display text exposes forbidden evidence text "${forbidden}"`);
    }
  }

  for (const pattern of guardedTextPatterns) {
    if (pattern.test(displayText)) {
      fail(`${record.id}: display text exposes guarded pattern ${pattern}`);
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
assertStringArray(payload.forbiddenEvidenceText, "forbiddenEvidenceText", 1);

if (!Array.isArray(payload.records)) {
  fail("records must be an array");
  process.exit();
}

if (payload.records.length < 4) {
  fail("records must include source-found, noData, generation-limited, and blocked examples");
}

const ids = new Set();
const states = new Map();
const verdicts = new Map();
let promptVisiblePassFailRecords = 0;
let blockedPromptHiddenRecords = 0;
let shapeRecords = 0;

for (const [index, record] of payload.records.entries()) {
  const label = `records[${index}]`;
  if (!isPlainObject(record)) {
    fail(`${label} must be an object`);
    continue;
  }

  if (assertString(record.id, `${label}.id`)) {
    if (ids.has(record.id)) fail(`${label}.id must be unique: ${record.id}`);
    ids.add(record.id);
  }
  assertString(record.fixtureId, `${label}.fixtureId`);
  assertString(record.prompt, `${label}.prompt`);
  if (!allowedStates.has(record.expectedState)) {
    fail(`${label}.expectedState must be one of ${Array.from(allowedStates).join(", ")}`);
  }
  if (!allowedVerdicts.has(record.resultVerdict)) {
    fail(`${label}.resultVerdict must be one of ${Array.from(allowedVerdicts).join(", ")}`);
  }
  assertStringArray(record.expectedVisibleText, `${label}.expectedVisibleText`, 1);
  assertStringArray(record.expectedHiddenText, `${label}.expectedHiddenText`, 1);
  assertString(record.notes, `${label}.notes`);

  validateEvidenceCapture(record);
  validateResponseShape(record);
  validateDisplaySafety(record, payload.forbiddenEvidenceText || []);

  states.set(record.expectedState, (states.get(record.expectedState) || 0) + 1);
  verdicts.set(record.resultVerdict, (verdicts.get(record.resultVerdict) || 0) + 1);
  if ((record.resultVerdict === "pass" || record.resultVerdict === "fail") && record.evidenceCapture?.promptVisible) {
    promptVisiblePassFailRecords += 1;
  }
  if (record.resultVerdict === "blocked" && record.evidenceCapture?.promptVisible === false) {
    blockedPromptHiddenRecords += 1;
  }
  if (record.sanitizedResponseShape) shapeRecords += 1;
}

for (const state of ["source-found", "noData", "generation-limited"]) {
  if (!states.has(state)) fail(`missing required expectedState: ${state}`);
}

if (promptVisiblePassFailRecords < 3) {
  fail("expected at least three prompt-visible pass/fail evidence examples");
}

if (blockedPromptHiddenRecords < 1) {
  fail("expected at least one blocked prompt-hidden evidence example");
}

if (shapeRecords < 2) {
  fail("expected at least two optional sanitized response shape examples");
}

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    mode: "compass-qa-evidence-prompt-visible-contract",
    recordCount: payload.records.length,
    expectedStates: Object.fromEntries(states),
    verdicts: Object.fromEntries(verdicts),
    promptVisiblePassFailRecords,
    blockedPromptHiddenRecords,
    sanitizedResponseShapeRecords: shapeRecords,
    productionApiCalled: false,
    browserUsed: false,
    sessionMaterialUsed: false,
    ragSearchExecuted: false,
    dbTouched: false,
  }, null, 2));
}
