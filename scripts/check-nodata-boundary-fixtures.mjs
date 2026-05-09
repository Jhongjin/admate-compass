#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { detectUnavailablePolicyTarget } from "../src/lib/services/ragNoDataIntentBoundary.mjs";

const root = process.cwd();
const fixturePath = path.join(root, "docs/rag/rag-nodata-boundary-fixtures.json");

const requiredCaseTypes = new Set([
  "clearly-valid-policy",
  "generic-valid-policy",
  "future-impossible-policy",
  "fictional-product-real-platform",
  "fictional-platform",
  "korean-longform-ambiguous-policy",
]);

const allowedBaselineStatuses = new Set([
  "expected-pass",
  "expected-fail-until-logic-patch",
  "unknown-needs-logic-test",
]);

const forbiddenCopyFragments = [
  "retrievalMethod",
  "sourceQuality",
  "ollama_document_chunks",
  "embedding",
  "hybrid score",
  "RAGSearchService",
];

function fail(message) {
  console.error(`[check-nodata-boundary-fixtures] ${message}`);
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

function assertInteger(value, label) {
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

function makeMockSources(count, fixture) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${fixture.id}-source-${index + 1}`,
    title: `Fixture source ${index + 1}`,
    vendor: "AD_POLICY",
    url: `https://example.invalid/${fixture.id}/${index + 1}`,
    excerpt: "Sanitized fixture source for noData boundary contract.",
    retrievalMethod: "hybrid",
    sourceQuality: {
      isFallback: false,
      sourceVendor: "AD_POLICY",
    },
  }));
}

function makeMockResponse(fixture, options = {}) {
  const expected = fixture.expected;
  const generationLimited = options.generationLimited === true;
  const sourceCount = expected.sourcesRetained ? Math.max(expected.minSources, 1) : 0;
  return {
    response: {
      schema: "compass",
      noDataFound: expected.noDataFound,
      message: expected.copyExpectation.sample,
      sources: makeMockSources(sourceCount, fixture),
      sourcesCount: sourceCount,
    },
    model: generationLimited ? "ollama-connection-failed" : "fixture-contract",
  };
}

function validateCopyExpectation(fixture) {
  const copy = fixture.expected?.copyExpectation;
  const label = `${fixture.id}.expected.copyExpectation`;

  if (!isPlainObject(copy)) {
    fail(`${label} must be an object`);
    return;
  }

  assertString(copy.sample, `${label}.sample`);
  assertStringArray(copy.requiredFragments, `${label}.requiredFragments`, 1);
  assertStringArray(copy.forbiddenFragments, `${label}.forbiddenFragments`, 1);

  for (const fragment of copy.requiredFragments || []) {
    if (!includesText(copy.sample, fragment)) {
      fail(`${label}.sample must include required fragment "${fragment}"`);
    }
  }

  for (const fragment of new Set([
    ...forbiddenCopyFragments,
    ...(copy.forbiddenFragments || []),
  ])) {
    if (includesText(copy.sample, fragment)) {
      fail(`${label}.sample must not include internal fragment "${fragment}"`);
    }
  }
}

function validateExpectedContract(fixture) {
  const expected = fixture.expected;
  const label = `${fixture.id}.expected`;
  if (!isPlainObject(expected)) {
    fail(`${label} must be an object`);
    return;
  }

  assertBoolean(expected.noDataFound, `${label}.noDataFound`);
  assertInteger(expected.minSources, `${label}.minSources`);
  assertInteger(expected.maxSources, `${label}.maxSources`);
  assertBoolean(expected.sourcesRetained, `${label}.sourcesRetained`);
  assertBoolean(expected.allowGenerationLimited, `${label}.allowGenerationLimited`);
  assertBoolean(expected.generationLimitedPreservesSources, `${label}.generationLimitedPreservesSources`);
  assertString(expected.sourcePolicy, `${label}.sourcePolicy`);
  assertString(expected.copyClass, `${label}.copyClass`);
  validateCopyExpectation(fixture);

  if (expected.minSources > expected.maxSources) {
    fail(`${label}.minSources must be <= maxSources`);
  }

  if (expected.noDataFound) {
    if (expected.sourcesRetained) fail(`${label}.sourcesRetained must be false when noDataFound=true`);
    if (expected.minSources !== 0) fail(`${label}.minSources must be 0 when noDataFound=true`);
    if (expected.maxSources !== 0) fail(`${label}.maxSources must be 0 when noDataFound=true`);
    if (expected.allowGenerationLimited) fail(`${label}.allowGenerationLimited must be false when noDataFound=true`);
    if (expected.generationLimitedPreservesSources) {
      fail(`${label}.generationLimitedPreservesSources must be false when noDataFound=true`);
    }
  } else {
    if (!expected.sourcesRetained) fail(`${label}.sourcesRetained must be true when noDataFound=false`);
    if (expected.minSources < 1) fail(`${label}.minSources must be >= 1 when noDataFound=false`);
  }
}

function validateBaseline(fixture) {
  const baseline = fixture.currentProductionBaseline;
  const label = `${fixture.id}.currentProductionBaseline`;
  if (!isPlainObject(baseline)) {
    fail(`${label} must be an object`);
    return;
  }

  if (!allowedBaselineStatuses.has(baseline.status)) {
    fail(`${label}.status must be one of ${Array.from(allowedBaselineStatuses).join(", ")}`);
  }
  assertString(baseline.basis, `${label}.basis`);
}

function validateIntentBoundary(fixture) {
  const result = detectUnavailablePolicyTarget(fixture.question, { currentYear: 2026 });
  const label = `${fixture.id}.intentBoundary`;
  const unavailableCaseTypes = new Map([
    ["future-impossible-policy", "future_impossible"],
    ["fictional-platform", "fictional_platform"],
  ]);

  if (unavailableCaseTypes.has(fixture.caseType)) {
    const expectedReason = unavailableCaseTypes.get(fixture.caseType);
    if (!result.isUnavailablePolicyTarget) {
      fail(`${label} must be classified as unavailable policy target`);
    }
    if (result.reason !== expectedReason) {
      fail(`${label} expected reason=${expectedReason}, received ${result.reason || "(none)"}`);
    }
    return;
  }

  if (result.isUnavailablePolicyTarget) {
    fail(`${label} must not be classified as unavailable policy target`);
  }
}

function validateSourcePreservationContract(fixture) {
  const expected = fixture.expected;
  const response = makeMockResponse(fixture);
  const sources = response.response.sources;

  if (response.response.schema !== "compass") {
    fail(`${fixture.id}: mock response must keep schema=compass`);
  }

  if (response.response.noDataFound !== expected.noDataFound) {
    fail(`${fixture.id}: mock response noDataFound mismatch`);
  }

  if (sources.length < expected.minSources || sources.length > expected.maxSources) {
    fail(`${fixture.id}: mock response source count outside expected bounds`);
  }

  if (response.response.sourcesCount !== sources.length) {
    fail(`${fixture.id}: sourcesCount must match sources.length`);
  }

  if (expected.sourcesRetained) {
    for (const [index, source] of sources.entries()) {
      if (source.sourceQuality?.isFallback === true || source.retrievalMethod === "fallback") {
        fail(`${fixture.id}: source[${index}] must not be fallback evidence`);
      }
    }
  }
}

function validateGenerationLimitedContract(fixture) {
  const expected = fixture.expected;
  if (!expected.allowGenerationLimited) return;

  const response = makeMockResponse(fixture, { generationLimited: true });
  const sources = response.response.sources;

  if (response.model !== "ollama-connection-failed") {
    fail(`${fixture.id}: generation-limited mock must use connection-failed model marker`);
  }

  if (response.response.noDataFound) {
    fail(`${fixture.id}: generation-limited valid retrieval must not become noDataFound=true`);
  }

  if (!expected.generationLimitedPreservesSources) {
    fail(`${fixture.id}: valid generation-limited fixture must opt into source preservation`);
  }

  if (sources.length < expected.minSources) {
    fail(`${fixture.id}: generation-limited response must preserve sources`);
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

if (fixtures.length < 6) {
  fail("fixture file must include at least the six NoData-2 boundary fixtures");
}

const ids = new Set();
const caseTypes = new Set();
const baselineCounts = new Map();
let noDataTrueCount = 0;
let noDataFalseCount = 0;
let sourcePreservationCases = 0;
let generationLimitedCases = 0;

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
  assertString(fixture.question, `${label}.question`);
  assertString(fixture.caseType, `${label}.caseType`);
  caseTypes.add(fixture.caseType);

  validateExpectedContract(fixture);
  validateBaseline(fixture);
  validateIntentBoundary(fixture);
  validateSourcePreservationContract(fixture);
  validateGenerationLimitedContract(fixture);

  if (fixture.expected?.noDataFound) noDataTrueCount += 1;
  else noDataFalseCount += 1;
  if (fixture.expected?.sourcesRetained) sourcePreservationCases += 1;
  if (fixture.expected?.allowGenerationLimited) generationLimitedCases += 1;

  const baselineStatus = fixture.currentProductionBaseline?.status || "unknown-needs-logic-test";
  baselineCounts.set(baselineStatus, (baselineCounts.get(baselineStatus) || 0) + 1);
}

for (const caseType of requiredCaseTypes) {
  if (!caseTypes.has(caseType)) {
    fail(`missing required caseType: ${caseType}`);
  }
}

if (sourcePreservationCases < 4) {
  fail("expected at least four source preservation cases");
}

if (generationLimitedCases < 4) {
  fail("expected at least four generation-limited source preservation cases");
}

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    mode: "nodata-boundary-fixture-contract",
    fixtureCount: fixtures.length,
    noDataFoundTrue: noDataTrueCount,
    noDataFoundFalse: noDataFalseCount,
    sourcePreservationCases,
    generationLimitedSourcePreservationCases: generationLimitedCases,
    currentProductionBaseline: Object.fromEntries(baselineCounts),
    intentBoundaryHelperChecked: true,
    ragSearchExecuted: false,
    productionApiCalled: false,
  }, null, 2));
}
