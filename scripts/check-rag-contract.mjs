import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const requiredFiles = [
  'src/app/api/chatbot/route.ts',
  'src/app/api/search/route.ts',
  'src/app/api/feedback/route.ts',
  'src/lib/services/RAGSearchService.ts',
  'src/lib/services/DocumentIndexingService.ts',
  'src/lib/services/EmbeddingService.ts',
  'src/lib/services/VectorStorageService.ts',
]

function fail(message) {
  console.error(`[check-rag-contract] ${message}`)
  process.exitCode = 1
}

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) fail(`missing ${file}`)
}

const chatbotPath = path.join(root, 'src/app/api/chatbot/route.ts')
if (fs.existsSync(chatbotPath)) {
  const text = fs.readFileSync(chatbotPath, 'utf8')
  for (const field of ['sources', 'confidence', 'processingTime', 'model', 'isLLMGenerated']) {
    if (!text.includes(field)) fail(`chatbot response contract missing ${field}`)
  }
  if (!text.includes('enrichSearchResults')) fail('chatbot route missing source enrichment step')
}

const searchPath = path.join(root, 'src/app/api/search/route.ts')
if (fs.existsSync(searchPath)) {
  const text = fs.readFileSync(searchPath, 'utf8')
  for (const field of ['matchThreshold', 'matchCount', 'documentTypes', 'totalResults']) {
    if (!text.includes(field)) fail(`search contract missing ${field}`)
  }
}

const ragServicePath = path.join(root, 'src/lib/services/RAGSearchService.ts')
if (fs.existsSync(ragServicePath)) {
  const text = fs.readFileSync(ragServicePath, 'utf8')
  for (const field of ['EvidenceDecision', 'evidenceDecision', 'evidenceDecisionReason', 'decideEvidence', 'placeholder_content']) {
    if (!text.includes(field)) fail(`RAG search evidence contract missing ${field}`)
  }
}

if (!process.exitCode) console.log('[check-rag-contract] ok')
