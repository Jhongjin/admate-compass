#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const runEndpoint = args.has("--run");
const sourceOnly = args.has("--source-only");
const diagnostics = args.has("--diagnostics");
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
const vendorTerms = {
  META: ["meta", "facebook", "페이스북", "instagram", "인스타그램", "릴스", "reels"],
  KAKAO: ["kakao", "카카오", "카카오톡", "톡채널", "비즈보드", "모먼트"],
  NAVER: ["naver", "네이버", "검색광고", "쇼핑검색", "파워링크", "브랜드검색"],
  GOOGLE: ["google", "구글", "youtube", "유튜브", "gdn", "google ads", "display"],
};
const topicTerms = {
  review: ["심사", "승인", "반려", "집행 기준", "준수사항"],
  youth: ["청소년", "유해", "성인", "연령"],
  false_claim: ["허위", "과장", "오인", "기만"],
  price: ["가격", "할인", "할인율"],
  event: ["이벤트", "경품", "참여", "당첨"],
  rights: ["상표", "저작권", "초상권", "권리"],
  hate: ["혐오", "차별", "비하"],
  gambling: ["도박", "사행"],
  spec: ["사이즈", "크기", "파일", "형식", "스펙", "동영상", "이미지", "카루셀"],
};

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

function detectVendors(text) {
  const normalized = normalizeText(text);
  return Object.entries(vendorTerms)
    .filter(([, terms]) => terms.some((term) => normalized.includes(normalizeText(term))))
    .map(([vendor]) => vendor);
}

function detectTopics(text) {
  const normalized = normalizeText(text);
  return Object.entries(topicTerms)
    .filter(([, terms]) => terms.some((term) => normalized.includes(normalizeText(term))))
    .map(([topic]) => topic);
}

function extractKeywords(query) {
  const stopwords = new Set([
    "무엇인가요", "무엇", "어떤", "있는", "없는", "해주세요", "알려줘", "기준은", "기준",
    "관련", "대한", "그리고", "또는", "가능한가요", "되나요", "경우", "알려", "줘",
    "the", "and", "for", "with", "what", "how",
  ]);
  return Array.from(new Set(
    String(query || "")
      .split(/[\s,./?!"'()[\]{}:;|<>]+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length >= 2 && !stopwords.has(word))
  )).slice(0, 8);
}

function detectQueryIntent(query) {
  const normalized = normalizeText(query);
  const adPolicyTerms = [
    "광고", "정책", "심사", "소재", "매체", "캠페인", "타겟", "집행", "승인", "반려",
    "meta", "facebook", "페이스북", "instagram", "인스타그램", "kakao", "카카오",
    "naver", "네이버", "google", "구글", "youtube", "유튜브", "gdn",
  ].filter((term) => normalized.includes(normalizeText(term)));
  const outOfScopeTerms = [
    "날씨", "기온", "우산", "미세먼지", "김치찌개", "레시피", "요리", "맛집",
    "주식", "코인", "환율", "연예", "영화 추천", "건강 상담", "진단", "치료",
  ].filter((term) => normalized.includes(normalizeText(term)));
  return {
    vendors: detectVendors(query),
    topics: detectTopics(query),
    keywords: extractKeywords(query),
    adPolicyTerms,
    outOfScopeTerms,
    isOutOfScope: outOfScopeTerms.length > 0 && adPolicyTerms.length === 0,
  };
}

function collectResponseFailures(fixture, payload) {
  const failures = [];
  const response = payload?.response;
  if (!response || typeof response !== "object") {
    return ["response must be an object"];
  }

  const sources = Array.isArray(response.sources) ? response.sources : [];
  const responseText = normalizeText([
    sourceOnly ? "" : response.message,
    sourceOnly ? "" : response.content,
    sourceBlob(sources),
  ].join(" "));

  const noDataFound = response.noDataFound === true;
  if (noDataFound !== fixture.expectNoDataFound) {
    failures.push(`expected noDataFound=${fixture.expectNoDataFound}, received ${noDataFound}`);
  }

  if (sources.length < fixture.minSources) {
    failures.push(`expected at least ${fixture.minSources} source(s), received ${sources.length}`);
  }

  const confidence = Number(payload.confidence);
  if (!Number.isFinite(confidence) || confidence < fixture.minConfidence) {
    failures.push(`confidence ${payload.confidence} below minimum ${fixture.minConfidence}`);
  }

  for (const term of fixture.mustContain) {
    if (!responseText.includes(normalizeText(term))) {
      failures.push(`missing required term "${term}"`);
    }
  }

  for (const term of fixture.mustNotContain) {
    if (term && responseText.includes(normalizeText(term))) {
      failures.push(`contains forbidden term "${term}"`);
    }
  }

  if (!hasExpectedTitle(sourceBlob(sources), fixture.expectedSourceTitle)) {
    failures.push("sources do not match expected title hints");
  }

  if (fixture.requireSourceQuality) {
    for (const [index, source] of sources.entries()) {
      if (!source?.sourceQuality || typeof source.sourceQuality !== "object") {
        failures.push(`source[${index}] missing sourceQuality`);
      }
      if (source?.sourceQuality?.isFallback === true || source?.retrievalMethod === "fallback") {
        failures.push(`source[${index}] must not be fallback evidence`);
      }
    }
  }

  if (fixture.requireRetrievalMethods?.length > 0) {
    const methods = new Set(sources.map((source) => source?.retrievalMethod).filter(Boolean));
    const matched = fixture.requireRetrievalMethods.some((method) => methods.has(method));
    if (!matched) {
      failures.push(`expected one of retrieval methods ${fixture.requireRetrievalMethods.join(", ")}, received ${Array.from(methods).join(", ") || "(none)"}`);
    }
  }

  const duplicateTitleCount = countDuplicateTitles(sources);
  if (fixture.maxDuplicateTitles > 0 && duplicateTitleCount > fixture.maxDuplicateTitles) {
    failures.push(`duplicate title count ${duplicateTitleCount} exceeds ${fixture.maxDuplicateTitles}`);
  }

  const distinctTitleCount = countDistinctTitles(sources);
  if (distinctTitleCount < fixture.minDistinctTitles) {
    failures.push(`distinct title count ${distinctTitleCount} below ${fixture.minDistinctTitles}`);
  }

  return failures;
}

function validateResponseAgainstFixture(fixture, payload) {
  for (const failure of collectResponseFailures(fixture, payload)) {
    fail(`${fixture.id}: ${failure}`);
  }
}

function summarizeSource(source, index) {
  return {
    rank: index + 1,
    id: source?.id,
    title: source?.title,
    originalTitle: source?.originalTitle,
    documentId: source?.documentId,
    chunkId: source?.chunkId,
    sourceVendor: source?.sourceVendor || source?.sourceQuality?.sourceVendor || "UNKNOWN",
    corpus: source?.corpus,
    retrievalMethod: source?.retrievalMethod,
    evidenceType: source?.evidenceType,
    hybridScore: source?.hybridScore,
    vectorScore: source?.vectorScore,
    keywordScore: source?.keywordScore,
    lexicalOverlap: source?.lexicalOverlap,
    vendorMatch: source?.vendorMatch,
    vendorMismatch: source?.vendorMismatch,
    rankReason: source?.rankReason || [],
    sourceQuality: source?.sourceQuality,
  };
}

function buildDiagnostic(fixture, payload) {
  const response = payload?.response || {};
  const sources = Array.isArray(response.sources) ? response.sources : [];
  const queryIntent = detectQueryIntent(fixture.question);
  const expectedVendor = fixture.expectedVendor;
  const explicitVendors = queryIntent.vendors;
  return {
    fixtureId: fixture.id,
    question: fixture.question,
    expectedVendor,
    queryIntent,
    fixtureAmbiguity: expectedVendor !== "ANY"
      && expectedVendor !== "NONE"
      && !explicitVendors.includes(expectedVendor),
    response: {
      noDataFound: response.noDataFound === true,
      schema: response.schema,
      confidence: payload?.confidence,
      sourcesCount: sources.length,
      model: payload?.model,
    },
    finalSources: sources.map(summarizeSource),
    failures: collectResponseFailures(fixture, payload),
  };
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
const diagnosticResults = [];

if (runEndpoint) {
  for (const fixture of selectedFixtures) {
    const payload = await callChatEndpoint(fixture);
    if (payload) {
      if (diagnostics) diagnosticResults.push(buildDiagnostic(fixture, payload));
      validateResponseAgainstFixture(fixture, payload);
    }
  }
}

if (diagnostics) {
  const passCount = diagnosticResults.filter((result) => result.failures.length === 0).length;
  console.log(JSON.stringify({
    ok: process.exitCode ? false : true,
    mode: runEndpoint ? "endpoint-diagnostics" : "fixture-schema-diagnostics",
    sourceOnly,
    fixtureCount: fixtures.length,
    evaluatedCount: selectedFixtures.length,
    passCount,
    failCount: diagnosticResults.length - passCount,
    results: diagnosticResults,
  }, null, 2));
}

if (!process.exitCode) {
  console.log(JSON.stringify({
    ok: true,
    mode: runEndpoint ? "endpoint" : "fixture-schema",
    sourceOnly,
    diagnostics,
    fixtureCount: fixtures.length,
    evaluatedCount: selectedFixtures.length,
  }, null, 2));
}
