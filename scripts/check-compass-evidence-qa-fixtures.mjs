#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(root, "docs/rag/compass-evidence-qa-fixtures.json");

const allowedStates = new Set(["source-found", "noData", "generation-limited"]);
const requiredStates = new Set(["source-found", "noData", "generation-limited"]);
const allowedSourceCategories = new Set([
  "first-party-account-data",
  "uploaded-reference",
  "approved-reference",
  "benchmark-note",
  "policy-note",
  "platform-policy",
  "analyst-note",
]);
const allowedReviewStatuses = new Set([
  "accepted",
  "limited",
  "expired",
  "rejected",
  "unavailable",
  "unreviewed",
]);

const guardedDisplayPatterns = [
  /\braw(source|provider|payload|ocr|transcript)\b/i,
  /\b(account|tenant|workspace|advertiser|campaign|creative|audience|trace|job|run|vector|embedding|retrieval|reviewer)Id\b/i,
  /\b(prompt|model|token|cookie|credential|secret|signedUrl|webhook|apiKey|privateKey|authorization|bearer|password)\b/i,
  /\b(retrievalMethod|sourceQuality|hybridScore|vectorScore|keywordScore|sourcesCount|schema=compass|ollama_document_chunks|RAGSearchService)\b/i,
  /\bprivate-dashboard\b/i,
];

function fail(message) {
  console.error(`[check-compass-evidence-qa-fixtures] ${message}`);
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
      if (key === "redactionInput" || key === "expectedExcludedText") continue;
      collectDisplayStrings(item, strings);
    }
  }

  return strings;
}

function validateDisplayTextSafety(fixture) {
  const displayText = collectDisplayStrings({
    requestLabel: fixture.requestLabel,
    answerSummary: fixture.answerSummary,
    sourcePanel: fixture.sourcePanel,
    expectedDisplayText: fixture.expectedDisplayText,
  }).join("\n");

  for (const pattern of guardedDisplayPatterns) {
    if (pattern.test(displayText)) {
      fail(`${fixture.id}: display text exposes guarded pattern ${pattern}`);
    }
  }

  for (const excluded of fixture.expectedExcludedText || []) {
    if (includesText(displayText, excluded)) {
      fail(`${fixture.id}: display text includes excluded text "${excluded}"`);
    }
  }

  for (const required of fixture.expectedDisplayText || []) {
    if (!includesText(displayText, required)) {
      fail(`${fixture.id}: display text missing expected fragment "${required}"`);
    }
  }
}

function validateSourcePanel(fixture) {
  const panel = fixture.sourcePanel;
  const label = `${fixture.id}.sourcePanel`;

  if (!isPlainObject(panel)) {
    fail(`${label} must be an object`);
    return;
  }

  if (!allowedReviewStatuses.has(panel.reviewStatus)) {
    fail(`${label}.reviewStatus must be one of ${Array.from(allowedReviewStatuses).join(", ")}`);
  }

  if (fixture.evidenceState === "source-found") {
    for (const field of ["sourceLabel", "sourceCategory", "freshnessLabel", "reviewStatus", "evidenceRecordLabel"]) {
      assertString(panel[field], `${label}.${field}`);
    }
    if (!allowedSourceCategories.has(panel.sourceCategory)) {
      fail(`${label}.sourceCategory must be allowlisted`);
    }
    assertStringArray(panel.verifiedFacts, `${label}.verifiedFacts`, 1);
    assertString(panel.generatedInterpretation, `${label}.generatedInterpretation`);
    if (panel.reviewStatus !== "accepted") {
      fail(`${label}.reviewStatus must be accepted for source-found`);
    }
    return;
  }

  if (fixture.evidenceState === "noData") {
    assertString(panel.noDataReason, `${label}.noDataReason`);
    assertString(panel.checkedScope, `${label}.checkedScope`);
    if (panel.sourceLabel || panel.evidenceRecordLabel) {
      fail(`${label} must not include source shells when evidenceState=noData`);
    }
    if (!["unavailable", "rejected"].includes(panel.reviewStatus)) {
      fail(`${label}.reviewStatus must be unavailable or rejected for noData`);
    }
    return;
  }

  if (fixture.evidenceState === "generation-limited") {
    for (const field of [
      "sourceLabel",
      "sourceCategory",
      "freshnessLabel",
      "reviewStatus",
      "evidenceRecordLabel",
      "limitationReason",
      "partialSourceSummary",
    ]) {
      assertString(panel[field], `${label}.${field}`);
    }
    if (!allowedSourceCategories.has(panel.sourceCategory)) {
      fail(`${label}.sourceCategory must be allowlisted`);
    }
    assertStringArray(panel.verifiedFacts, `${label}.verifiedFacts`, 1);
    assertString(panel.generatedInterpretation, `${label}.generatedInterpretation`);
    if (!["limited", "expired", "unreviewed"].includes(panel.reviewStatus)) {
      fail(`${label}.reviewStatus must show a limited review state`);
    }
  }
}

function validateRedactionInput(fixture) {
  if (fixture.redactionInput === undefined) return;
  const label = `${fixture.id}.redactionInput`;

  if (!isPlainObject(fixture.redactionInput)) {
    fail(`${label} must be an object when present`);
    return;
  }

  const excludedText = fixture.expectedExcludedText || [];
  for (const [field, value] of Object.entries(fixture.redactionInput)) {
    assertString(field, `${label} field name`);
    assertString(value, `${label}.${field}`);
    if (!excludedText.includes(field)) fail(`${fixture.id}: expectedExcludedText must include redacted field name ${field}`);
    if (!excludedText.includes(value)) fail(`${fixture.id}: expectedExcludedText must include redacted value ${value}`);
  }
}

if (!fs.existsSync(fixturePath)) {
  fail(`fixture file not found: ${path.relative(root, fixturePath)}`);
  process.exit();
}

let fixtures;
try {
  fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
} catch (error) {
  fail(`fixture file must be valid JSON: ${error.message}`);
  process.exit();
}

if (!Array.isArray(fixtures)) {
  fail("fixture file must contain an array");
  process.exit();
}

if (fixtures.length < 8) {
  fail("fixture file must include at least eight Compass evidence QA cases");
}

const ids = new Set();
const stateCounts = new Map();
let redactionCases = 0;
let generationLimitedSourcePreservationCases = 0;

for (const [index, fixture] of fixtures.entries()) {
  const label = `fixture[${index}]`;
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
  assertString(fixture.requestLabel, `${label}.requestLabel`);
  assertString(fixture.answerSummary, `${label}.answerSummary`);
  if (!allowedStates.has(fixture.evidenceState)) {
    fail(`${label}.evidenceState must be one of ${Array.from(allowedStates).join(", ")}`);
  }
  assertStringArray(fixture.expectedDisplayText, `${label}.expectedDisplayText`, 1);
  assertStringArray(fixture.expectedExcludedText, `${label}.expectedExcludedText`, 1);

  stateCounts.set(fixture.evidenceState, (stateCounts.get(fixture.evidenceState) || 0) + 1);
  validateSourcePanel(fixture);
  validateRedactionInput(fixture);
  validateDisplayTextSafety(fixture);

  if (fixture.redactionInput) redactionCases += 1;
  if (fixture.evidenceState === "generation-limited" && fixture.sourcePanel?.sourceLabel) {
    generationLimitedSourcePreservationCases += 1;
  }
}

for (const state of requiredStates) {
  if (!stateCounts.has(state)) fail(`missing required evidenceState: ${state}`);
}

if ((stateCounts.get("source-found") || 0) < 3) fail("expected at least three source-found fixtures");
if ((stateCounts.get("noData") || 0) < 3) fail("expected at least three noData fixtures");
if ((stateCounts.get("generation-limited") || 0) < 2) fail("expected at least two generation-limited fixtures");
if (redactionCases < 1) fail("expected at least one redaction fixture");
if (generationLimitedSourcePreservationCases < 2) {
  fail("expected generation-limited fixtures to preserve available source labels");
}

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    mode: "compass-evidence-qa-fixture-contract",
    fixtureCount: fixtures.length,
    evidenceStates: Object.fromEntries(stateCounts),
    redactionCases,
    generationLimitedSourcePreservationCases,
    ragSearchExecuted: false,
    productionApiCalled: false,
  }, null, 2));
}
