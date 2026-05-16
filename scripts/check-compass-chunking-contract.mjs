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

if (documentProcessingService.includes("이 URL은 서버리스 환경에서 크롤링할 수 없습니다")) {
  fail("DocumentProcessingService must not create placeholder URL content for indexing");
}

if (!/async processUrl[\s\S]*throw new Error/.test(documentProcessingService)) {
  fail("DocumentProcessingService.processUrl must fail closed until a real extractor is wired");
}

if (!process.exitCode) {
  console.log("[check-compass-chunking-contract] ok");
}
