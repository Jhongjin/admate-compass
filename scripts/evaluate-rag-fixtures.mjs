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
  process.env.COMPASS_ANSWER_EVAL_ENDPOINT ||
  process.env.COMPASS_ANSWER_SMOKE_URL ||
  process.env.RAG_EVAL_ENDPOINT ||
  process.env.CHAT_OLLAMA_SMOKE_URL ||
  "http://127.0.0.1:3000/api/compass-answer";
const limit = Number(limitArg?.split("=")[1] || process.env.RAG_EVAL_LIMIT || 0);

const allowedRetrievalMethods = new Set(["vector", "keyword", "hybrid", "graph", "fallback"]);
const allowedEvidenceDecisions = new Set(["verified", "weak", "rejected"]);
const allowedVendors = new Set(["ANY", "NONE", "KAKAO", "META", "NAVER", "GOOGLE"]);
const allowedCategories = new Set(["vendor-specific", "generic-policy", "out-of-scope"]);
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

    if (fixture.category && !allowedCategories.has(fixture.category)) {
      fail(`${label}.category must be one of ${Array.from(allowedCategories).join(", ")}`);
    }

    assertArray(fixture.expectedSourceTitle, `${label}.expectedSourceTitle`);
    assertArray(fixture.mustContain, `${label}.mustContain`);
    assertArray(fixture.mustNotContain, `${label}.mustNotContain`);
    if (fixture.sourceMustContain !== undefined) {
      assertArray(fixture.sourceMustContain, `${label}.sourceMustContain`);
    }
    if (fixture.sourceMustNotContain !== undefined) {
      assertArray(fixture.sourceMustNotContain, `${label}.sourceMustNotContain`);
    }
    if (fixture.requiredSourceChunkIds !== undefined) {
      assertArray(fixture.requiredSourceChunkIds, `${label}.requiredSourceChunkIds`);
    }
    if (fixture.requiredCitedSourceChunkIds !== undefined) {
      assertArray(fixture.requiredCitedSourceChunkIds, `${label}.requiredCitedSourceChunkIds`);
    }
    if (fixture.generationMustContain !== undefined) {
      assertArray(fixture.generationMustContain, `${label}.generationMustContain`);
    }
    if (fixture.generationMustNotContain !== undefined) {
      assertArray(fixture.generationMustNotContain, `${label}.generationMustNotContain`);
    }
    if (fixture.conversationHistory !== undefined) {
      assertArray(fixture.conversationHistory, `${label}.conversationHistory`);
      for (const [historyIndex, historyItem] of fixture.conversationHistory.entries()) {
        const historyLabel = `${label}.conversationHistory[${historyIndex}]`;
        if (!historyItem || typeof historyItem !== "object" || Array.isArray(historyItem)) {
          fail(`${historyLabel} must be an object`);
          continue;
        }
        if (historyItem.role !== undefined && typeof historyItem.role !== "string") {
          fail(`${historyLabel}.role must be a string when provided`);
        }
        if (historyItem.content !== undefined && typeof historyItem.content !== "string") {
          fail(`${historyLabel}.content must be a string when provided`);
        }
      }
    }
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

    if (fixture.requireEvidenceDecision !== undefined && typeof fixture.requireEvidenceDecision !== "boolean") {
      fail(`${label}.requireEvidenceDecision must be boolean when provided`);
    }

    if (fixture.allowedEvidenceDecisions !== undefined) {
      if (assertArray(fixture.allowedEvidenceDecisions, `${label}.allowedEvidenceDecisions`)) {
        for (const decision of fixture.allowedEvidenceDecisions) {
          if (!allowedEvidenceDecisions.has(decision)) {
            fail(`${label}.allowedEvidenceDecisions contains invalid decision: ${decision}`);
          }
        }
      }
    }

    if (fixture.forbidRejectedEvidence !== undefined && typeof fixture.forbidRejectedEvidence !== "boolean") {
      fail(`${label}.forbidRejectedEvidence must be boolean when provided`);
    }

    if (fixture.minVerifiedEvidence !== undefined && (!Number.isFinite(Number(fixture.minVerifiedEvidence)) || Number(fixture.minVerifiedEvidence) < 0)) {
      fail(`${label}.minVerifiedEvidence must be a non-negative number when provided`);
    }

    if (fixture.officialSourceHosts !== undefined) {
      assertArray(fixture.officialSourceHosts, `${label}.officialSourceHosts`, 1);
      for (const host of fixture.officialSourceHosts || []) {
        if (typeof host !== "string" || normalizeHostname(host).length === 0) {
          fail(`${label}.officialSourceHosts must contain non-empty host strings`);
        }
      }
    }

    if (fixture.minOfficialSources !== undefined && (!Number.isFinite(Number(fixture.minOfficialSources)) || Number(fixture.minOfficialSources) < 0)) {
      fail(`${label}.minOfficialSources must be a non-negative number when provided`);
    }

    if (fixture.requireGenerationAssertions !== undefined && typeof fixture.requireGenerationAssertions !== "boolean") {
      fail(`${label}.requireGenerationAssertions must be boolean when provided`);
    }

    if (fixture.requireCitationConsistency !== undefined && typeof fixture.requireCitationConsistency !== "boolean") {
      fail(`${label}.requireCitationConsistency must be boolean when provided`);
    }

    if (fixture.requireGenerationAssertions === true && (!Array.isArray(fixture.generationMustContain) || fixture.generationMustContain.length === 0)) {
      fail(`${label}.requireGenerationAssertions requires generationMustContain terms`);
    }
  }
}

function fixtureCategory(fixture) {
  if (fixture.category) return fixture.category;
  if (fixture.expectedVendor === "NONE") return "out-of-scope";
  if (fixture.expectedVendor === "ANY") return "generic-policy";
  return "vendor-specific";
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function sourceBlob(sources) {
  return sources.map((source) => [
    source?.id,
    source?.title,
    source?.originalTitle,
    source?.excerpt,
    source?.documentId,
    source?.chunkId,
    source?.url,
    source?.sourceUrl,
    source?.sourceURL,
    source?.sourceReference,
    source?.sourceLabel,
    source?.corpus,
    source?.sourceType,
    source?.metadata?.source,
    source?.metadata?.source_title,
    source?.metadata?.canonical_title,
    source?.metadata?.source_url,
    source?.metadata?.sourceUrl,
    source?.metadata?.id,
    source?.metadata?.chunkId,
    source?.metadata?.chunk_id,
    source?.metadata?.sourceChunkId,
    source?.metadata?.source_chunk_id,
  ].filter(Boolean).join(" ")).join(" ");
}

function sourceChunkIdCandidates(source) {
  return [
    source?.id,
    source?.chunkId,
    source?.metadata?.id,
    source?.metadata?.chunkId,
    source?.metadata?.chunk_id,
    source?.metadata?.sourceChunkId,
    source?.metadata?.source_chunk_id,
  ].filter((value) => typeof value === "string" && value.trim().length > 0);
}

function collectSourceChunkIds(sources) {
  return new Set(sources.flatMap(sourceChunkIdCandidates).map(normalizeText));
}

function collectCitationNumbers(text) {
  const citations = [];
  const pattern = /\[S(\d+)\]/g;
  let match;
  while ((match = pattern.exec(String(text || ""))) !== null) {
    citations.push(Number(match[1]));
  }
  return citations;
}

function findSourceIndexByChunkId(sources, chunkId) {
  const normalizedChunkId = normalizeText(chunkId);
  return sources.findIndex((source) => (
    sourceChunkIdCandidates(source).some((candidate) => normalizeText(candidate) === normalizedChunkId)
  ));
}

function normalizeHostname(hostname) {
  return String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
}

function parseHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed;
  } catch {
    return null;
  }
}

function sourceUrlCandidates(source) {
  return [
    source?.url,
    source?.sourceUrl,
    source?.sourceURL,
    source?.sourceReference,
    source?.metadata?.url,
    source?.metadata?.source_url,
    source?.metadata?.sourceUrl,
  ].filter((value) => typeof value === "string" && value.trim().length > 0);
}

function hostMatchesAllowed(hostname, allowedHosts) {
  const host = normalizeHostname(hostname);
  return allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = normalizeHostname(allowedHost);
    return host === normalizedAllowedHost || host.endsWith(`.${normalizedAllowedHost}`);
  });
}

function countSourcesWithAllowedHosts(sources, allowedHosts) {
  const normalizedAllowedHosts = allowedHosts.map(normalizeHostname).filter(Boolean);
  if (normalizedAllowedHosts.length === 0) return 0;

  return sources.filter((source) => sourceUrlCandidates(source).some((candidate) => {
    const parsed = parseHttpUrl(candidate);
    return parsed && hostMatchesAllowed(parsed.hostname, normalizedAllowedHosts);
  })).length;
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

function shouldRunGenerationAssertions(payload) {
  const model = String(payload?.model || payload?.response?.model || "");
  if (!model) return false;
  if (model.endsWith("-connection-failed")) return false;
  return ![
    "ollama-connection-failed",
    "vultr-ollama-no-data",
    "compass-answer-no-data",
    "compass-answer-error",
  ].includes(model);
}

function collectResponseFailures(fixture, payload) {
  const sourceFailures = [];
  const generationFailures = [];
  const response = payload?.response;
  if (!response || typeof response !== "object") {
    return {
      sourceFailures: ["response must be an object"],
      generationFailures,
    };
  }

  const sources = Array.isArray(response.sources) ? response.sources : [];
  const sourceText = normalizeText(sourceBlob(sources));
  const generationText = normalizeText([
    response.message,
    response.content,
  ].join(" "));
  const sourceMustContain = fixture.sourceMustContain || fixture.mustContain || [];
  const sourceMustNotContain = fixture.sourceMustNotContain || fixture.mustNotContain || [];
  const generationMustContain = fixture.generationMustContain || [];
  const generationMustNotContain = fixture.generationMustNotContain || [];

  const noDataFound = response.noDataFound === true;
  if (noDataFound !== fixture.expectNoDataFound) {
    sourceFailures.push(`expected noDataFound=${fixture.expectNoDataFound}, received ${noDataFound}`);
  }

  if (sources.length < fixture.minSources) {
    sourceFailures.push(`expected at least ${fixture.minSources} source(s), received ${sources.length}`);
  }

  if (fixture.officialSourceHosts) {
    const minOfficialSources = Number(fixture.minOfficialSources ?? 1);
    const officialSourceCount = countSourcesWithAllowedHosts(sources, fixture.officialSourceHosts);
    if (officialSourceCount < minOfficialSources) {
      sourceFailures.push(`official source count ${officialSourceCount} below minimum ${minOfficialSources} for hosts ${fixture.officialSourceHosts.join(", ")}`);
    }
  }

  if (Number.isInteger(fixture.maxSources) && sources.length > fixture.maxSources) {
    sourceFailures.push(`expected at most ${fixture.maxSources} source(s), received ${sources.length}`);
  }

  if (fixture.expectNoDataFound === true && sources.length > 0) {
    sourceFailures.push(`noDataFound response must not retain sources, received ${sources.length}`);
  }

  const confidence = Number(payload.confidence);
  if (!Number.isFinite(confidence) || confidence < fixture.minConfidence) {
    sourceFailures.push(`confidence ${payload.confidence} below minimum ${fixture.minConfidence}`);
  }

  for (const term of sourceMustContain) {
    if (!sourceText.includes(normalizeText(term))) {
      sourceFailures.push(`source missing required term "${term}"`);
    }
  }

  for (const term of sourceMustNotContain) {
    if (term && sourceText.includes(normalizeText(term))) {
      sourceFailures.push(`source contains forbidden term "${term}"`);
    }
  }

  if (Array.isArray(fixture.requiredSourceChunkIds) && fixture.requiredSourceChunkIds.length > 0) {
    const sourceChunkIds = collectSourceChunkIds(sources);
    for (const chunkId of fixture.requiredSourceChunkIds) {
      if (!sourceChunkIds.has(normalizeText(chunkId))) {
        sourceFailures.push(`source missing required chunk id "${chunkId}"`);
      }
    }
  }

  if (!hasExpectedTitle(sourceBlob(sources), fixture.expectedSourceTitle)) {
    sourceFailures.push("sources do not match expected title hints");
  }

  if (fixture.requireSourceQuality) {
    for (const [index, source] of sources.entries()) {
      if (!source?.sourceQuality || typeof source.sourceQuality !== "object") {
        sourceFailures.push(`source[${index}] missing sourceQuality`);
      }
      if (source?.sourceQuality?.isFallback === true || source?.retrievalMethod === "fallback") {
        sourceFailures.push(`source[${index}] must not be fallback evidence`);
      }
    }
  }

  const requireEvidenceDecision = fixture.requireEvidenceDecision === true || fixture.requireSourceQuality === true;
  const allowedFixtureDecisions = new Set(fixture.allowedEvidenceDecisions || Array.from(allowedEvidenceDecisions));
  const minVerifiedEvidence = Number(fixture.minVerifiedEvidence || 0);
  let verifiedEvidenceCount = 0;

  if (requireEvidenceDecision || minVerifiedEvidence > 0 || fixture.forbidRejectedEvidence === true) {
    for (const [index, source] of sources.entries()) {
      const decision = source?.evidenceDecision;
      if (!allowedEvidenceDecisions.has(decision)) {
        sourceFailures.push(`source[${index}] missing valid evidenceDecision`);
        continue;
      }

      if (!allowedFixtureDecisions.has(decision)) {
        sourceFailures.push(`source[${index}] evidenceDecision ${decision} is not allowed`);
      }

      if (decision === "verified") {
        verifiedEvidenceCount++;
      }

      if ((fixture.forbidRejectedEvidence === true || fixture.requireSourceQuality === true) && decision === "rejected") {
        sourceFailures.push(`source[${index}] must not be rejected evidence`);
      }

      if (source?.sourceQuality?.isFallback === true || source?.retrievalMethod === "fallback") {
        if (decision === "verified") {
          sourceFailures.push(`source[${index}] fallback evidence must not be verified`);
        }
      }

      if (requireEvidenceDecision && !Array.isArray(source?.evidenceDecisionReason)) {
        sourceFailures.push(`source[${index}] missing evidenceDecisionReason`);
      }
    }

    if (verifiedEvidenceCount < minVerifiedEvidence) {
      sourceFailures.push(`verified evidence count ${verifiedEvidenceCount} below minimum ${minVerifiedEvidence}`);
    }
  }

  if (fixture.requireRetrievalMethods?.length > 0) {
    const methods = new Set(sources.map((source) => source?.retrievalMethod).filter(Boolean));
    const matched = fixture.requireRetrievalMethods.some((method) => methods.has(method));
    if (!matched) {
      sourceFailures.push(`expected one of retrieval methods ${fixture.requireRetrievalMethods.join(", ")}, received ${Array.from(methods).join(", ") || "(none)"}`);
    }
  }

  const duplicateTitleCount = countDuplicateTitles(sources);
  if (fixture.maxDuplicateTitles > 0 && duplicateTitleCount > fixture.maxDuplicateTitles) {
    sourceFailures.push(`duplicate title count ${duplicateTitleCount} exceeds ${fixture.maxDuplicateTitles}`);
  }

  const distinctTitleCount = countDistinctTitles(sources);
  if (distinctTitleCount < fixture.minDistinctTitles) {
    sourceFailures.push(`distinct title count ${distinctTitleCount} below ${fixture.minDistinctTitles}`);
  }

  if (!sourceOnly && shouldRunGenerationAssertions(payload)) {
    for (const term of generationMustContain) {
      if (!generationText.includes(normalizeText(term))) {
        generationFailures.push(`answer missing required term "${term}"`);
      }
    }

    for (const term of generationMustNotContain) {
      if (term && generationText.includes(normalizeText(term))) {
        generationFailures.push(`answer contains forbidden term "${term}"`);
      }
    }

    if (fixture.requireCitationConsistency === true) {
      const citations = collectCitationNumbers([
        response.message,
        response.content,
      ].join(" "));
      const citedSourceNumbers = new Set(citations);
      if (citations.length === 0) {
        generationFailures.push("answer must include source citations");
      }
      for (const citation of citations) {
        if (!Number.isInteger(citation) || citation < 1 || citation > sources.length) {
          generationFailures.push(`answer citation [S${citation}] is outside sources length ${sources.length}`);
        }
      }

      for (const chunkId of fixture.requiredCitedSourceChunkIds || []) {
        const sourceIndex = findSourceIndexByChunkId(sources, chunkId);
        if (sourceIndex < 0) {
          sourceFailures.push(`source missing required cited chunk id "${chunkId}"`);
          continue;
        }
        const citationNumber = sourceIndex + 1;
        if (!citedSourceNumbers.has(citationNumber)) {
          generationFailures.push(`required chunk id "${chunkId}" must be cited as [S${citationNumber}]`);
        }
      }
    }
  }

  return { sourceFailures, generationFailures };
}

function validateResponseAgainstFixture(fixture, payload) {
  const { sourceFailures, generationFailures } = collectResponseFailures(fixture, payload);
  for (const failure of sourceFailures) {
    fail(`${fixture.id}: ${failure}`);
  }

  if (fixture.requireGenerationAssertions === true) {
    if (sourceOnly) {
      fail(`${fixture.id}: generation assertions are required but --source-only was used`);
    } else if (!shouldRunGenerationAssertions(payload)) {
      fail(`${fixture.id}: generation assertions were skipped for model ${payload?.model || "(missing)"}`);
    }

    for (const failure of generationFailures) {
      fail(`${fixture.id}: ${failure}`);
    }
  }
}

function summarizeSource(source, index) {
  const sourceQuality = source?.sourceQuality && typeof source.sourceQuality === "object"
    ? {
      ...source.sourceQuality,
      policyTitleMatch: source.sourceQuality.policyTitleMatch ?? source?.policyTitleMatch,
    }
    : source?.sourceQuality;

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
    evidenceDecision: source?.evidenceDecision,
    evidenceDecisionReason: source?.evidenceDecisionReason || [],
    hybridScore: source?.hybridScore,
    vectorScore: source?.vectorScore,
    keywordScore: source?.keywordScore,
    lexicalOverlap: source?.lexicalOverlap,
    vendorMatch: source?.vendorMatch,
    vendorMismatch: source?.vendorMismatch,
    topicExactMatch: source?.topicExactMatch,
    policyTitleMatch: source?.policyTitleMatch ?? source?.sourceQuality?.policyTitleMatch,
    rankReason: source?.rankReason || [],
    sourceQuality,
  };
}

function countEvidenceDecisions(sources) {
  const counts = {
    verified: 0,
    weak: 0,
    rejected: 0,
    missing: 0,
  };

  for (const source of sources) {
    const decision = source?.evidenceDecision;
    if (decision === "verified" || decision === "weak" || decision === "rejected") {
      counts[decision]++;
    } else {
      counts.missing++;
    }
  }

  return counts;
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
    category: fixtureCategory(fixture),
    expectedVendor,
    assertionTypes: {
      sourceOnly: true,
      generation: !sourceOnly && shouldRunGenerationAssertions(payload),
      requiredGeneration: fixture.requireGenerationAssertions === true,
    },
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
      evidenceDecisionCounts: countEvidenceDecisions(sources),
    },
    finalSources: sources.map(summarizeSource),
    ...collectResponseFailures(fixture, payload),
  };
}

async function callCompassAnswerEndpoint(fixture) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "x-compass-answer-cache-bypass": "1",
    },
    body: JSON.stringify({
      message: fixture.question,
      conversationHistory: Array.isArray(fixture.conversationHistory) ? fixture.conversationHistory : [],
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
const minimumFixtureCount = fixtureArg ? 1 : 20;
if (!assertArray(fixtures, "fixtures", minimumFixtureCount)) {
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
    const payload = await callCompassAnswerEndpoint(fixture);
    if (payload) {
      if (diagnostics) diagnosticResults.push(buildDiagnostic(fixture, payload));
      validateResponseAgainstFixture(fixture, payload);
    }
  }
}

if (diagnostics) {
  const passCount = diagnosticResults.filter((result) => result.sourceFailures.length === 0).length;
  const generationFailCount = diagnosticResults.filter((result) => result.generationFailures.length > 0).length;
  console.log(JSON.stringify({
    ok: process.exitCode ? false : true,
    mode: runEndpoint ? "endpoint-diagnostics" : "fixture-schema-diagnostics",
    sourceOnly,
    fixtureCount: fixtures.length,
    evaluatedCount: selectedFixtures.length,
    passCount,
    failCount: diagnosticResults.length - passCount,
    generationFailCount,
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
