#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();

function fail(message) {
  console.error(`[check-compass-chunking-contract] ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    fail(`missing ${relativePath}`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf8");
}

const chunkingService = read("src/lib/services/TextChunkingService.ts");
const vectorStorageService = read("src/lib/services/VectorStorageService.ts");
const indexingService = read("src/lib/services/DocumentIndexingService.ts");
const documentProcessingService = read("src/lib/services/DocumentProcessingService.ts");
const uploadReindexRoute = read("src/app/api/admin/upload/[documentId]/reindex/route.ts");
const directProcessRoute = read("src/app/api/admin/direct-process/route.ts");
const simpleIndexRoute = read("src/app/api/admin/simple-index/route.ts");
const documentActionsRoute = read("src/app/api/admin/document-actions/route.ts");
const extractionPlan = read("docs/tasks/2026-05-17_compass_web_page_extraction_service_contract_plan_v1.md");
const offsetFixtureText = read("docs/rag/compass-chunking-offset-fixtures.json");

function assertArrayEquals(actual, expected, label) {
  const actualSerialized = JSON.stringify(actual);
  const expectedSerialized = JSON.stringify(expected);
  if (actualSerialized !== expectedSerialized) {
    fail(`${label} mismatch: expected ${expectedSerialized}, got ${actualSerialized}`);
  }
}

function loadTextChunkingServiceForFixtureGate(serviceText) {
  const transpiled = ts.transpileModule(serviceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: path.join(root, "src/lib/services/TextChunkingService.ts"),
  });

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    console,
    Error,
    Math,
    String,
    require(specifier) {
      if (specifier === "langchain/text_splitter") {
        return {
          RecursiveCharacterTextSplitter: class RecursiveCharacterTextSplitter {
            constructor(options = {}) {
              this.options = options;
            }

            async createDocuments(texts = [], metadatas = []) {
              return texts.map((pageContent, index) => ({
                pageContent,
                metadata: metadatas[index] || {},
              }));
            }
          },
        };
      }

      throw new Error(`Unexpected fixture gate import: ${specifier}`);
    },
  };

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: path.join(root, "src/lib/services/TextChunkingService.ts"),
  });

  const ServiceConstructor = module.exports.TextChunkingService;
  if (typeof ServiceConstructor !== "function") {
    throw new Error("TextChunkingService export was not found after local evaluation");
  }

  const service = new ServiceConstructor();
  if (typeof service.calculateChunkOffsets !== "function") {
    throw new Error("TextChunkingService.calculateChunkOffsets is not runtime-accessible");
  }

  return service;
}

function assertOffsetFixtures(fixtureText) {
  let service;
  try {
    service = loadTextChunkingServiceForFixtureGate(chunkingService);
  } catch (error) {
    fail(`TextChunkingService fixture evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let fixturePack;
  try {
    fixturePack = JSON.parse(fixtureText);
  } catch (error) {
    fail(`chunk offset fixture JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (fixturePack.fixturePack !== "compass-chunking-offset-v1") {
    fail("chunk offset fixturePack must be compass-chunking-offset-v1");
  }
  if (fixturePack.mode !== "local_contract_only") {
    fail("chunk offset fixture mode must be local_contract_only");
  }

  for (const [key, value] of Object.entries(fixturePack.sideEffects || {})) {
    if (value !== false) fail(`chunk offset fixture sideEffects.${key} must be false`);
  }

  const fixtures = Array.isArray(fixturePack.fixtures) ? fixturePack.fixtures : [];
  if (fixtures.length < 4) {
    fail("chunk offset fixtures must cover repeated and overlapping cases");
  }

  const fixtureIds = new Set();
  for (const [index, testCase] of fixtures.entries()) {
    const label = `chunk offset fixtures[${index}] ${testCase.id || "unknown"}`;

    if (!testCase.id || typeof testCase.sourceText !== "string" || !Array.isArray(testCase.chunkTexts) || !Array.isArray(testCase.expectedOffsets)) {
      fail(`${label} must include id, sourceText, chunkTexts, and expectedOffsets`);
      continue;
    }
    if (fixtureIds.has(testCase.id)) {
      fail(`${label}.id must be unique`);
    }
    fixtureIds.add(testCase.id);
    if (testCase.chunkTexts.length !== testCase.expectedOffsets.length) {
      fail(`${label} chunkTexts and expectedOffsets length mismatch`);
      continue;
    }

    let actualOffsets = [];
    try {
      actualOffsets = service.calculateChunkOffsets(testCase.sourceText, testCase.chunkTexts);
    } catch (error) {
      fail(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    assertArrayEquals(actualOffsets, testCase.expectedOffsets, label);

    for (const [offsetIndex, offset] of actualOffsets.entries()) {
      const chunkText = testCase.chunkTexts[offsetIndex];
      if (testCase.sourceText.slice(offset.startChar, offset.endChar) !== chunkText) {
        fail(`${label}.expectedOffsets[${offsetIndex}] must slice back to the chunk text`);
      }
    }
  }

  for (const requiredId of [
    "repeated-identical-policy-blocks-advance-occurrences",
    "overlapping-repeated-phrases-search-from-next-start",
    "dense-character-overlap-does-not-search-from-previous-end",
    "normalized-policy-copy-repeats-with-overlap",
  ]) {
    if (!fixtureIds.has(requiredId)) fail(`chunk offset fixture pack missing ${requiredId}`);
  }
}

for (const token of [
  "policy-recursive-v2",
  "url-policy-recursive-v2",
  "normalizeTextForChunking",
  "createChunksWithOffsets",
  "calculateChunkOffsets",
  "calculateSignalScore",
  "sourceTitle",
  "sourceUrl",
]) {
  if (!chunkingService.includes(token)) {
    fail(`TextChunkingService missing ${token}`);
  }
}

const langChainOffsetPathCount = (chunkingService.match(/createChunksWithOffsets\(normalizedText,\s*documents\)/g) || []).length;
if (langChainOffsetPathCount < 2) {
  fail("TextChunkingService LangChain chunk paths must assign source-text offsets after splitting");
}

for (const token of [
  "previousStartChar + 1",
  "sourceText.indexOf(chunkText, searchStart)",
  "endChar > sourceText.length",
  "sourceText.slice(startChar, endChar)",
  "sourceSlice !== chunkText",
]) {
  if (!chunkingService.includes(token)) {
    fail(`TextChunkingService chunk offset accuracy guard missing ${token}`);
  }
}

for (const forbidden of [
  "startChar: 0, // LangChain",
  "endChar: doc.pageContent.length",
]) {
  if (chunkingService.includes(forbidden)) {
    fail(`TextChunkingService must not use per-chunk 0..length offsets after LangChain splitting: ${forbidden}`);
  }
}

if (!/case 'url':[\s\S]*chunkKoreanText/.test(chunkingService)) {
  fail("URL chunking must use Korean/policy-aware splitting");
}

for (const token of [
  "source_title",
  "source_url",
  "document_url",
  "chunking_strategy",
  "signal_score",
]) {
  if (!vectorStorageService.includes(token)) {
    fail(`VectorStorageService chunk metadata missing ${token}`);
  }
}

for (const token of [
  "title: koreanTitle",
  "type: 'url'",
]) {
  if (!indexingService.includes(token)) {
    fail(`DocumentIndexingService URL metadata path missing ${token}`);
  }
}

const indexUrlBlock = indexingService.match(/async indexURL[\s\S]*?\/\*\*\s*\n\s*\* 여러 파일을 배치 인덱싱/);
if (!indexUrlBlock || !/saveDocument\(\{[\s\S]*url: url/.test(indexUrlBlock[0])) {
  fail("DocumentIndexingService.indexURL must persist documents.url for URL provenance and duplicate detection");
}

const indexCrawledContentBlock = indexingService.match(/async indexCrawledContent[\s\S]*?\/\*\*\s*\n\s*\* URL을 인덱싱/);
if (!indexCrawledContentBlock) {
  fail("DocumentIndexingService.indexCrawledContent block not found");
}

for (const token of [
  "assertIndexableUrlContent",
  "MIN_URL_CONTENT_CHARS",
  "URL_PLACEHOLDER_PATTERNS",
  "URL crawling is not available",
  "serverless document processing path",
  "이 URL은 서버리스 환경에서 크롤링할 수 없습니다",
  "URL 형태로 저장되었습니다",
  "실제 내용은 관리자가 별도로 처리",
  "관리자에게 문의",
]) {
  if (!indexingService.includes(token)) {
    fail(`DocumentIndexingService URL fail-closed guard missing ${token}`);
  }
}

function assertGuardBeforeChunking(block, label) {
  const guardIndex = block.indexOf("assertIndexableUrlContent");
  const chunkIndex = block.indexOf("chunkDocument");
  if (guardIndex === -1 || chunkIndex === -1 || guardIndex > chunkIndex) {
    fail(`${label} must validate URL content before chunkDocument`);
  }
}

if (indexUrlBlock) assertGuardBeforeChunking(indexUrlBlock[0], "DocumentIndexingService.indexURL");
if (indexCrawledContentBlock) assertGuardBeforeChunking(indexCrawledContentBlock[0], "DocumentIndexingService.indexCrawledContent");

if (documentProcessingService.includes("이 URL은 서버리스 환경에서 크롤링할 수 없습니다")) {
  fail("DocumentProcessingService must not create placeholder URL content for indexing");
}

for (const forbidden of [
  "CompassSourcePreviewParser",
  "extractCompassSourcePreview",
]) {
  if (indexingService.includes(forbidden) || documentProcessingService.includes(forbidden)) {
    fail(`URL indexing/chunking must remain fail-closed and must not use proposal preview parser: ${forbidden}`);
  }
}

const processUrlBlock = documentProcessingService.match(/async processUrl[\s\S]*?\/\*\*\s*\n\s*\* 텍스트 정리/);
if (!processUrlBlock || !processUrlBlock[0].includes("throw new Error")) {
  fail("DocumentProcessingService.processUrl must fail closed until a real extractor is wired");
}

if (processUrlBlock?.[0].includes("return {")) {
  fail("DocumentProcessingService.processUrl must not return indexable URL placeholder content");
}

const failClosedAdminReindexRoutes = [
  ["upload reindex route", uploadReindexRoute, "REINDEX_FAIL_CLOSED"],
  ["direct-process route", directProcessRoute, "DIRECT_DUMMY_INDEXING_DISABLED"],
  ["simple-index route", simpleIndexRoute, "SIMPLE_DUMMY_INDEXING_DISABLED"],
  ["document-actions reindex handler", documentActionsRoute, "DOCUMENT_ACTIONS_REINDEX_FAIL_CLOSED"],
];

for (const [label, routeText, failClosedCode] of failClosedAdminReindexRoutes) {
  if (!routeText.includes(failClosedCode)) {
    fail(`${label} must fail closed with ${failClosedCode}`);
  }
  if (!routeText.includes("guardCompassProductAdminSessionRoute")) {
    fail(`${label} must use product admin session guard`);
  }
}

for (const [label, routeText] of failClosedAdminReindexRoutes) {
  for (const forbidden of [
    "dummyChunks",
    "embedding: null",
    ".from('document_chunks')\n      .delete()",
    ".from('document_chunks')\r\n      .delete()",
    ".from('document_chunks')\n          .insert",
    ".from('document_chunks')\r\n          .insert",
  ]) {
    if (routeText.includes(forbidden)) {
      fail(`${label} must not retain unsafe dummy/null/delete indexing behavior: ${forbidden}`);
    }
  }
}

for (const token of [
  "WebPageExtractionService",
  "not implemented in this gate",
  "`DocumentProcessingService.processUrl` remains fail-closed",
  "`SimpleDocumentProcessingService.processUrlDocument` remains placeholder-only",
  "`HybridCrawlingManager` calls `/api/puppeteer-crawler`",
  "no matching",
  "automated source-watch path",
  "`/api/admin/upload/[documentId]/reindex`",
  "`/api/admin/direct-process`",
  "`/api/admin/simple-index`",
  "canonicalUrl",
  "sourceTitle",
  "contentText",
  "contentHash",
  "extractedAt",
  "sourceQuality",
  "boilerplateRemoved",
  "allowed official policy hosts",
  "robots and rate-limit respect",
  "no raw HTML",
  "no credentials, cookies, sessions, tokens",
  "no direct writes to `documents`, `document_chunks`, `ollama_document_chunks`",
  "no dummy chunks or null-embedding completion",
  "proposal queue first",
  "separate approval/apply",
  "Do not skip from crawler output directly to corpus chunks",
]) {
  if (!extractionPlan.includes(token)) {
    fail(`web page extraction contract plan missing ${token}`);
  }
}

assertOffsetFixtures(offsetFixtureText);

if (!process.exitCode) {
  console.log("[check-compass-chunking-contract] ok");
}
