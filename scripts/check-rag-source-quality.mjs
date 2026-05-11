import fs from 'node:fs'

const input = process.argv[2] || process.env.RAG_RESPONSE_FILE || ''
const requiredResponseFields = ['message', 'sources']
const requiredSourceFields = ['id', 'title', 'excerpt']
const allowedSourceTypes = new Set([
  'policy-note',
  'platform-policy',
  'approved-reference',
  'analyst-note',
  'benchmark-note',
  'uploaded-reference',
  'unknown-reviewed-source',
])
const allowedVendorScopes = new Set(['meta', 'google', 'naver', 'kakao', 'multi-platform', 'generic'])
const internalNamePattern = /\b(retrievalMethod|sourceQuality|ollama_document_chunks|embedding|hybridScore|vectorScore|keywordScore|RAGSearchService)\b/i

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
const expectedMetadata = data.expectedMetadata || response.expectedMetadata || {}
for (const field of requiredResponseFields) {
  if (response[field] === undefined || response[field] === null || response[field] === '') fail(`missing response field ${field}`)
}

if (typeof response.message === 'string' && internalNamePattern.test(response.message)) fail('response.message exposes internal source implementation names')

if (!Array.isArray(response.sources)) fail('sources must be an array')
else {
  const titleCounts = new Map()
  for (const [index, source] of response.sources.entries()) {
    for (const field of requiredSourceFields) {
      if (source[field] === undefined || source[field] === null || source[field] === '') fail(`source[${index}] missing ${field}`)
    }
    const titleKey = String(source.title).trim().toLowerCase()
    titleCounts.set(titleKey, (titleCounts.get(titleKey) || 0) + 1)
    if (!source.url && !source.sourceReference) fail(`source[${index}] missing url or sourceReference`)
    if (!source.sourceType) fail(`source[${index}] missing sourceType`)
    else if (!allowedSourceTypes.has(source.sourceType)) fail(`source[${index}].sourceType is not allowlisted`)
    if (!source.vendorScope) fail(`source[${index}] missing vendorScope`)
    else if (!allowedVendorScopes.has(source.vendorScope)) fail(`source[${index}].vendorScope is not allowlisted`)
    if (expectedMetadata.vendorScope && source.vendorScope !== expectedMetadata.vendorScope) fail(`source[${index}].vendorScope must be ${expectedMetadata.vendorScope}`)
    for (const field of ['title', 'excerpt', 'sourceLabel', 'sourceType']) {
      if (typeof source[field] === 'string' && internalNamePattern.test(source[field])) fail(`source[${index}].${field} exposes internal source implementation names`)
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
  const maxDuplicateTitleCount = Number(expectedMetadata.maxDuplicateTitleCount || 1)
  for (const [title, count] of titleCounts.entries()) {
    if (count > maxDuplicateTitleCount) fail(`duplicate source title exceeds limit: ${title}`)
  }
}

const confidence = Number(confidenceHolder.confidence)
if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) fail('confidence must be 0..100')

if (!process.exitCode) console.log('[check-rag-source-quality] ok')
