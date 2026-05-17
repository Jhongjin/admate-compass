#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

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
const extractionPlan = read("docs/tasks/2026-05-17_compass_web_page_extraction_service_contract_plan_v1.md");

for (const token of [
  "policy-recursive-v2",
  "url-policy-recursive-v2",
  "normalizeTextForChunking",
  "calculateSignalScore",
  "sourceTitle",
  "sourceUrl",
]) {
  if (!chunkingService.includes(token)) {
    fail(`TextChunkingService missing ${token}`);
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

if (!process.exitCode) {
  console.log("[check-compass-chunking-contract] ok");
}
