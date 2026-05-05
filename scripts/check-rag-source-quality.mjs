import fs from 'node:fs'

const input = process.argv[2] || process.env.RAG_RESPONSE_FILE || ''
const requiredResponseFields = ['message', 'sources']
const requiredSourceFields = ['id', 'title', 'excerpt']

function fail(message) {
  console.error(`[check-rag-source-quality] ${message}`)
  process.exitCode = 1
}

if (!input) {
  console.log('[check-rag-source-quality] skipped (provide response JSON path as argv or RAG_RESPONSE_FILE)')
  process.exit(0)
}

if (!fs.existsSync(input)) {
  fail(`response file not found: ${input}`)
  process.exit()
}

const data = JSON.parse(fs.readFileSync(input, 'utf8'))
const response = data.response || data
const confidenceHolder = data.response ? data : response
for (const field of requiredResponseFields) {
  if (response[field] === undefined || response[field] === null || response[field] === '') fail(`missing response field ${field}`)
}

if (!Array.isArray(response.sources)) fail('sources must be an array')
else {
  for (const [index, source] of response.sources.entries()) {
    for (const field of requiredSourceFields) {
      if (source[field] === undefined || source[field] === null || source[field] === '') fail(`source[${index}] missing ${field}`)
    }
    if (source.similarity !== undefined) {
      const similarity = Number(source.similarity)
      if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) fail(`source[${index}].similarity must be 0..1`)
    }
    for (const field of ['score', 'hybridScore', 'vectorScore', 'keywordScore']) {
      if (source[field] !== undefined) {
        const value = Number(source[field])
        if (!Number.isFinite(value) || value < 0 || value > 1) fail(`source[${index}].${field} must be 0..1`)
      }
    }
    if (!source.retrievalMethod) fail(`source[${index}] missing retrievalMethod`)
    if (source.retrievalMethod === 'fallback') fail(`source[${index}] must not be fallback-only`)
    if (source.evidenceType && source.evidenceType === 'fallback') fail(`source[${index}] must not use fallback evidence`)
    if (!source.sourceQuality || typeof source.sourceQuality !== 'object') fail(`source[${index}] missing sourceQuality`)
    if (source.sourceQuality?.isFallback === true) fail(`source[${index}].sourceQuality.isFallback must not be true`)
    if (source.sourceQuality?.qualityScore !== undefined) {
      const qualityScore = Number(source.sourceQuality.qualityScore)
      if (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 1) fail(`source[${index}].sourceQuality.qualityScore must be 0..1`)
    }
  }
}

const confidence = Number(confidenceHolder.confidence)
if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) fail('confidence must be 0..100')

if (!process.exitCode) console.log('[check-rag-source-quality] ok')
