#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const rendererPath = path.join(root, "src/app/dev/chat-ui-state-fixtures/page.tsx");
const fixturePath = path.join(root, "docs/rag/compass-chat-ui-state-contract-fixtures.json");

const requiredRendererSnippets = [
  "process.env.NODE_ENV !== \"development\"",
  "notFound()",
  "fixture.promptExpectation?.userPrompt",
  "{fixture.promptExpectation.userPrompt}",
  "userQuestion={fixture.promptExpectation?.userPrompt}",
  "productionApiCalled === false",
  "ragSearchExecuted === false",
  "browserUsed === false",
  "dbTouched === false",
  "sourceOpenMode=\"noop\"",
];

const forbiddenRendererSnippets = [
  "Fixture review question",
  "fetch(",
  "document.cookie",
  "localStorage",
  "sessionStorage",
  "createClient(",
  "createAdminClient(",
  "RAGSearchService",
];

function fail(message) {
  console.error(`[check-compass-dev-fixture-renderer-prompt-binding] ${message}`);
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

function assertRendererContract(source) {
  for (const snippet of requiredRendererSnippets) {
    if (!source.includes(snippet)) {
      fail(`renderer must include ${snippet}`);
    }
  }

  for (const snippet of forbiddenRendererSnippets) {
    if (source.includes(snippet)) {
      fail(`renderer must not include ${snippet}`);
    }
  }

  if (!source.includes("function FixtureTranscript") || !source.includes("function FixturePanel")) {
    fail("renderer must keep transcript and panel rendering split for prompt binding checks");
  }
}

function assertFixturePromptCoverage(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.fixtures)) {
    fail("fixture payload must contain a fixtures array");
    return { promptBoundFixtures: 0, initialFixtures: 0 };
  }

  let promptBoundFixtures = 0;
  let initialFixtures = 0;

  for (const [index, fixture] of payload.fixtures.entries()) {
    const label = `fixtures[${index}]`;
    if (!isPlainObject(fixture)) {
      fail(`${label} must be an object`);
      continue;
    }

    if (fixture.state === "initial-empty") {
      initialFixtures += 1;
      if (fixture.promptExpectation !== undefined) {
        fail(`${label}.initial-empty must remain prompt-free`);
      }
      continue;
    }

    if (!isPlainObject(fixture.promptExpectation)) {
      fail(`${label}.promptExpectation is required for renderer prompt binding`);
      continue;
    }

    const prompt = fixture.promptExpectation.userPrompt;
    if (typeof prompt !== "string" || prompt.trim().length < 8) {
      fail(`${label}.promptExpectation.userPrompt must be a meaningful string`);
    }
    if (fixture.promptExpectation.promptVisible !== true) {
      fail(`${label}.promptExpectation.promptVisible must be true`);
    }
    if (fixture.promptExpectation.resultLinkedToPrompt !== true) {
      fail(`${label}.promptExpectation.resultLinkedToPrompt must be true`);
    }
    promptBoundFixtures += 1;
  }

  return { promptBoundFixtures, initialFixtures };
}

const rendererSource = readText(rendererPath, "development fixture renderer");
const fixturePayload = readFixturePayload();

assertRendererContract(rendererSource);
const coverage = assertFixturePromptCoverage(fixturePayload);

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    mode: "compass-dev-fixture-renderer-prompt-binding",
    renderer: path.relative(root, rendererPath).replace(/\\/g, "/"),
    fixtureContract: path.relative(root, fixturePath).replace(/\\/g, "/"),
    promptBoundFixtures: coverage.promptBoundFixtures,
    initialFixtures: coverage.initialFixtures,
    productionApiCalled: false,
    browserUsed: false,
    sessionMaterialUsed: false,
    ragSearchExecuted: false,
    dbTouched: false,
  }, null, 2));
}
