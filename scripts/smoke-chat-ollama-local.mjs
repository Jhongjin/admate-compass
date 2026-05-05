#!/usr/bin/env node

const endpoint = process.env.CHAT_OLLAMA_SMOKE_URL || "http://127.0.0.1:3000/api/chat-ollama";
const message = process.env.CHAT_OLLAMA_SMOKE_QUERY || "광고 심사 기준은 무엇인가요?";

function fail(message, details) {
  console.error(`[smoke:chat-ollama] ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ message, conversationHistory: [] }),
});

let payload;
try {
  payload = await response.json();
} catch (error) {
  fail(`response must be JSON; status=${response.status}`, error instanceof Error ? error.message : String(error));
}

if (!response.ok) {
  fail(`request failed; status=${response.status}`, JSON.stringify({
    hasResponse: !!payload.response,
    error: payload.error || payload.message || null,
  }));
}

assertObject(payload, "payload");
assertObject(payload.response, "payload.response");

const responseBody = payload.response;
const sources = Array.isArray(responseBody.sources) ? responseBody.sources : null;

if (responseBody.error === true) {
  fail("payload.response.error must not be true");
}

if (responseBody.noDataFound === true) {
  fail("payload.response.noDataFound must not be true");
}

if (typeof responseBody.message !== "string") {
  fail("payload.response.message must be a string");
}

if (typeof responseBody.content !== "string") {
  fail("payload.response.content must be a string");
}

if (!sources) {
  fail("payload.response.sources must be an array");
}

if (sources.length === 0) {
  fail("payload.response.sources must include at least one RAG source");
}

if (typeof payload.confidence !== "number") {
  fail("payload.confidence must be a number");
}

if (typeof payload.processingTime !== "number") {
  fail("payload.processingTime must be a number");
}

if (typeof payload.model !== "string") {
  fail("payload.model must be a string");
}

const sourceSummary = sources.slice(0, 3).map((source) => ({
  hasId: typeof source?.id === "string" && source.id.length > 0,
  hasTitle: typeof source?.title === "string" && source.title.length > 0,
  hasExcerpt: typeof source?.excerpt === "string" && source.excerpt.length > 0,
  similarityType: typeof source?.similarity,
  retrievalMethod: source?.retrievalMethod || null,
  hasSourceQuality: !!source?.sourceQuality,
}));

for (const [index, source] of sources.entries()) {
  if (source?.sourceQuality?.isFallback === true || source?.retrievalMethod === "fallback") {
    fail(`payload.response.sources[${index}] must not be fallback-only`);
  }
}

console.log(JSON.stringify({
  ok: true,
  endpoint,
  schema: process.env.COMPASS_DB_SCHEMA || "(default)",
  noDataFound: responseBody.noDataFound === true,
  sourcesCount: sources.length,
  confidence: payload.confidence,
  model: payload.model,
  sourceSummary,
}, null, 2));
