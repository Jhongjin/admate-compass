import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ragServicePath = path.join(root, "src/lib/services/RAGSearchService.ts");
const compassAnswerRoutePath = path.join(root, "src/app/api/compass-answer/route.ts");
const compassAnswerHandlerPath = path.join(root, "src/lib/server/compassAnswerHandler.ts");

function fail(message) {
  console.error(`[smoke-compass-rag-contract] ${message}`);
  process.exitCode = 1;
}

for (const file of [ragServicePath, compassAnswerRoutePath, compassAnswerHandlerPath]) {
  if (!fs.existsSync(file)) {
    fail(`missing required file: ${path.relative(root, file)}`);
  }
}

if (process.exitCode) {
  process.exit();
}

const ragService = fs.readFileSync(ragServicePath, "utf8");
const compassAnswerRoute = fs.readFileSync(compassAnswerRoutePath, "utf8");
const compassAnswerHandler = fs.readFileSync(compassAnswerHandlerPath, "utf8");

const ragContractFields = [
  "sources: SearchResult[]",
  "confidence: number",
  "processingTime: number",
  "model: string",
  "isLLMGenerated?: boolean",
];

for (const field of ragContractFields) {
  if (!ragService.includes(field)) {
    fail(`RAG ChatResponse contract missing field: ${field}`);
  }
}

const routeContractFragments = [
  "sources",
  "confidence",
  "processingTime",
  "model",
  "noDataFound",
  "showContactOption",
];

for (const fragment of routeContractFragments) {
  if (!compassAnswerHandler.includes(fragment)) {
    fail(`compass answer handler response contract missing fragment: ${fragment}`);
  }
}

if (!compassAnswerRoute.includes("export { POST } from '@/lib/server/compassAnswerHandler'")) {
  fail("compass answer route must alias the canonical answer handler");
}

if (!ragService.includes("search_ollama_documents")) {
  fail("RAG service no longer calls search_ollama_documents");
}

if (!ragService.includes("ollama_document_chunks")) {
  fail("RAG fallback path no longer references ollama_document_chunks");
}

if (!ragService.includes("createCompassServiceClient")) {
  fail("RAG service is not using Compass schema-aware client");
}

if (!process.exitCode) {
  console.log("[smoke-compass-rag-contract] ok");
}
