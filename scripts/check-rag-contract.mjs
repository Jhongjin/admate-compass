import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const requiredFiles = [
  'src/app/api/chatbot/route.ts',
  'src/app/api/search/route.ts',
  'src/app/api/feedback/route.ts',
  'src/lib/services/RAGSearchService.ts',
  'src/lib/services/CompassAnswerLlmService.ts',
  'scripts/check-compass-chunking-contract.mjs',
  'scripts/check-compass-source-ops-contract.mjs',
  'scripts/check-compass-source-proposal-contract.mjs',
  'scripts/check-compass-source-preview-parser-fixtures.mjs',
  'scripts/check-compass-source-proposal-queue-contract.mjs',
  'src/lib/services/CompassSourceProposalService.ts',
  'src/lib/services/CompassSourcePreviewParser.ts',
  'src/lib/services/CompassSourceProposalReviewService.ts',
  'src/lib/services/CompassSourceProposalQueueService.ts',
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

const answerServicePath = path.join(root, 'src/lib/services/CompassAnswerLlmService.ts')
if (fs.existsSync(answerServicePath)) {
  const text = fs.readFileSync(answerServicePath, 'utf8')
  for (const field of ['CompassAnswerProvider', 'OPENROUTER_API_KEY', 'COMPASS_ANSWER_MODELS', 'generateCompassAnswer', 'provider', 'data_collection']) {
    if (!text.includes(field)) fail(`Compass answer LLM contract missing ${field}`)
  }
}

const chunkingServicePath = path.join(root, 'src/lib/services/TextChunkingService.ts')
if (fs.existsSync(chunkingServicePath)) {
  const text = fs.readFileSync(chunkingServicePath, 'utf8')
  for (const field of ['policy-recursive-v2', 'url-policy-recursive-v2', 'signalScore', 'sourceUrl']) {
    if (!text.includes(field)) fail(`Compass chunking contract missing ${field}`)
  }
}

const sourceOpsServicePath = path.join(root, 'src/lib/services/CompassSourceOpsService.ts')
if (fs.existsSync(sourceOpsServicePath)) {
  const text = fs.readFileSync(sourceOpsServicePath, 'utf8')
  for (const field of ['COMPASS_POLICY_SOURCES', 'backend-agent', 'mutationEnabled: false', 'manualCollectionRecommended: false']) {
    if (!text.includes(field)) fail(`Compass source ops contract missing ${field}`)
  }
}

const sourceProposalServicePath = path.join(root, 'src/lib/services/CompassSourceProposalService.ts')
if (fs.existsSync(sourceProposalServicePath)) {
  const text = fs.readFileSync(sourceProposalServicePath, 'utf8')
  for (const field of ['proposal-only', 'dryRun: true', 'mutationEnabled: false', 'wouldPromote: false', 'COMPASS_SOURCE_PROPOSAL_FETCH_ENABLED', 'extractCompassSourcePreview']) {
    if (!text.includes(field)) fail(`Compass source proposal contract missing ${field}`)
  }
}

const sourcePreviewParserPath = path.join(root, 'src/lib/services/CompassSourcePreviewParser.ts')
if (fs.existsSync(sourcePreviewParserPath)) {
  const text = fs.readFileSync(sourcePreviewParserPath, 'utf8')
  for (const field of ['CompassSourcePreview', 'extractCompassSourcePreview', 'validateCompassSourcePreview']) {
    if (!text.includes(field)) fail(`Compass source preview parser contract missing ${field}`)
  }
}

const sourceProposalQueueServicePath = path.join(root, 'src/lib/services/CompassSourceProposalQueueService.ts')
if (fs.existsSync(sourceProposalQueueServicePath)) {
  const text = fs.readFileSync(sourceProposalQueueServicePath, 'utf8')
  for (const field of ['COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED', 'source_proposal_runs', 'source_proposal_queue', 'would_promote: false']) {
    if (!text.includes(field)) fail(`Compass source proposal queue contract missing ${field}`)
  }
}

const sourceProposalReviewServicePath = path.join(root, 'src/lib/services/CompassSourceProposalReviewService.ts')
if (fs.existsSync(sourceProposalReviewServicePath)) {
  const text = fs.readFileSync(sourceProposalReviewServicePath, 'utf8')
  for (const field of ['deterministic-policy-review-v1', 'llmUsed: false', 'needsHumanReview: true', 'mutationEnabled: false']) {
    if (!text.includes(field)) fail(`Compass source proposal review contract missing ${field}`)
  }
}

if (!process.exitCode) console.log('[check-rag-contract] ok')
