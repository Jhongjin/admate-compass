#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const runEndpoint = args.has("--run");
const sourceOnly = args.has("--source-only");
const fixtureArg = process.argv.find((arg) => arg.startsWith("--fixtures="));
const endpointArg = process.argv.find((arg) => arg.startsWith("--endpoint="));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));

const fixturePath = path.resolve(
  root,
  fixtureArg?.split("=")[1] || "docs/rag/rag-2-evaluation-fixtures.json",
);
const endpoint =
  endpointArg?.split("=")[1] ||
  process.env.RAG_EVAL_ENDPOINT ||
  process.env.CHAT_OLLAMA_SMOKE_URL ||
  "http://127.0.0.1:3000/api/chat-ollama";
const limit = Number(limitArg?.split("=")[1] || process.env.RAG_EVAL_LIMIT || 0);

const allowedRetrievalMethods = new Set(["vector", "keyword", "hybrid", "fallback"]);
const allowedVendors = new Set(["ANY", "NONE", "KAKAO", "META", "NAVER", "GOOGLE"]);

function fail(message) {
  console.error(`[evaluate-rag-fixtures] ${message}`);
  process.exitCode = 1;
}

function assertArray(value, label, minLength = 0) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
    return false;
  }

  if (value.length < minLength) {
    fail(`${label} must include at least ${minLength} item(s)`);
    return false;
  }

  return true;
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
    return false;
  }

  return true;
}

function validateFixtureSchema(fixtures) {
  const ids = new Set();
  for (const [index, fixture] of fixtures.entries()) {
    const label = `fixture[${index}]`;
    if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
      fail(`${label} must be an object`);
      continue;
    }

    if (assertString(fixture.id, `${label}.id`)) {
      if (ids.has(fixture.id)) fail(`${label}.id must be unique: ${fixture.id}`);
      ids.add(fixture.id);
    }
    assertString(fixture.question, `${label}.question`);

    if (!allowedVendors.has(fixture.expectedVendor)) {
      fail(`${label}.expectedVendor must be one of ${Array.from(allowedVendors).join(", ")}`);
    }

    assertArray(fixture.expectedSourceTitle, `${label}.expectedSourceTitle`);
    assertArray(fixture.mustContain, `${label}.mustContain`);
    assertArray(fixture.mustNotContain, `${label}.mustNotContain`);
    assertArray(fixture.requireRetrievalMethods, `${label}.requireRetrievalMethods`);

    for (const method of fixture.requireRetrievalMethods || []) {
      if (!allowedRetrievalMethods.has(method)) {
        fail(`${label}.requireRetrievalMethods contains invalid method: ${method}`);
      }
    }

    for (const field of ["minSources", "minConfidence", "maxDuplicateTitles", "minDistinctTitles"]) {
      if (!Number.isFinite(Number(fixture[field])) || Number(fixture[field]) < 0) {
        fail(`${label}.${field} must be a non-negative number`);
      }
    }

    if (typeof fixture.expectNoDataFound !== "boolean") {
      fail(`${label}.expectNoDataFound must be boolean`);
    }

    if (typeof fixture.requireSourceQuality !== "boolean") {
      fail(`${label}.requireSourceQuality must be boolean`);
    }
  }
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function sourceBlob(sources) {
  return sources.map((source) => [
    source?.title,
    source?.excerpt,
    source?.documentId,
    source?.chunkId,
    source?.url,
    source?.corpus,
    source?.sourceType,
  ].filter(Boolean).join(" ")).join(" ");
}

function countDuplicateTitles(sources) {
  const counts = new Map();
  for (const source of sources) {
    const title = source?.title || "(missing)";
    counts.set(title, (counts.get(title) || 0) + 1);
  }

  return Math.max(0, ...counts.values());
}

function countDistinctTitles(sources) {
  return new Set(sources.map((source) => source?.title).filter(Boolean)).size;
}

function hasExpectedTitle(sourceText, expectedSourceTitle) {
  if (!expectedSourceTitle || expectedSourceTitle.length === 0) return true;
  const text = normalizeText(sourceText);
  return expectedSourceTitle.some((candidate) => text.includes(normalizeText(candidate)));
}

function validateResponseAgainstFixture(fixture, payload) {
  const response = payload?.response;
  if (!response || typeof response !== "object") {
    fail(`${fixture.id}: response must be an object`);
    return;
  }

  const sources = Array.isArray(response.sources) ? response.sources : [];
  const responseText = normalizeText([
    sourceOnly ? "" : response.message,
    sourceOnly ? "" : response.content,
    sourceBlob(sources),
  ].join(" "));

  const noDataFound = response.noDataFound === true;
  if (noDataFound !== fixture.expectNoDataFound) {
    fail(`${fixture.id}: expected noDataFound=${fixture.expectNoDataFound}, received ${noDataFound}`);
  }

  if (sources.length < fixture.minSources) {
    fail(`${fixture.id}: expected at least ${fixture.minSources} source(s), received ${sources.length}`);
  }

  const confidence = Number(payload.confidence);
  if (!Number.isFinite(confidence) || confidence < fixture.minConfidence) {
    fail(`${fixture.id}: confidence ${payload.confidence} below minimum ${fixture.minConfidence}`);
  }

  for (const term of fixture.mustContain) {
    if (!responseText.includes(normalizeText(term))) {
      fail(`${fixture.id}: missing required term "${term}"`);
    }
  }

  for (const term of fixture.mustNotContain) {
    if (term && responseText.includes(normalizeText(term))) {
      fail(`${fixture.id}: contains forbidden term "${term}"`);
    }
  }

  if (!hasExpectedTitle(sourceBlob(sources), fixture.expectedSourceTitle)) {
    fail(`${fixture.id}: sources do not match expected title hints`);
  }

  if (fixture.requireSourceQuality) {
    for (const [index, source] of sources.entries()) {
      if (!source?.sourceQuality || typeof source.sourceQuality !== "object") {
        fail(`${fixture.id}: source[${index}] missing sourceQuality`);
      }
      if (source?.sourceQuality?.isFallback === true || source?.retrievalMethod === "fallback") {
        fail(`${fixture.id}: source[${index}] must not be fallback evidence`);
      }
    }
  }

  if (fixture.requireRetrievalMethods?.length > 0) {
    const methods = new Set(sources.map((source) => source?.retrievalMethod).filter(Boolean));
    const matched = fixture.requireRetrievalMethods.some((method) => methods.has(method));
    if (!matched) {
      fail(`${fixture.id}: expected one of retrieval methods ${fixture.requireRetrievalMethods.join(", ")}, received ${Array.from(methods).join(", ") || "(none)"}`);
    }
  }

  const duplicateTitleCount = countDuplicateTitles(sources);
  if (fixture.maxDuplicateTitles > 0 && duplicateTitleCount > fixture.maxDuplicateTitles) {
    fail(`${fixture.id}: duplicate title count ${duplicateTitleCount} exceeds ${fixture.maxDuplicateTitles}`);
  }

  const distinctTitleCount = countDistinctTitles(sources);
  if (distinctTitleCount < fixture.minDistinctTitles) {
    fail(`${fixture.id}: distinct title count ${distinctTitleCount} below ${fixture.minDistinctTitles}`);
  }
}

async function callChatEndpoint(fixture) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: fixture.question,
      conversationHistory: [],
    }),
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    fail(`${fixture.id}: response must be JSON; status=${response.status}`);
    return null;
  }

  if (!response.ok) {
    fail(`${fixture.id}: request failed; status=${response.status}`);
  }

  return payload;
}

if (!fs.existsSync(fixturePath)) {
  fail(`fixture file not found: ${path.relative(root, fixturePath)}`);
  process.exit();
}

const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
if (!assertArray(fixtures, "fixtures", 20)) {
  process.exit();
}

validateFixtureSchema(fixtures);

if (process.exitCode) {
  process.exit();
}

const selectedFixtures = limit > 0 ? fixtures.slice(0, limit) : fixtures;

if (runEndpoint) {
  for (const fixture of selectedFixtures) {
    const payload = await callChatEndpoint(fixture);
    if (payload) validateResponseAgainstFixture(fixture, payload);
  }
}

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    mode: runEndpoint ? "endpoint" : "fixture-schema",
    sourceOnly,
    fixtureCount: fixtures.length,
    evaluatedCount: selectedFixtures.length,
  }, null, 2));
}
