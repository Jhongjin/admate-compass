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
const requiredFixtureSideEffects = ['db', 'network', 'llm', 'embedding', 'corpusMutation', 'cron', 'apply']
const vendorHostAllowlist = {
  meta: ['facebook.com', 'instagram.com', 'meta.com'],
  google: ['support.google.com', 'ads.google.com', 'youtube.com'],
  naver: ['ads.naver.com', 'searchad.naver.com', 'help.naver.com'],
  kakao: ['business.kakao.com', 'kakao.com'],
}
const internalNamePattern = /\b(retrievalMethod|sourceQuality|ollama_document_chunks|document_chunks|documents|embedding|hybridScore|vectorScore|keywordScore|RAGSearchService|DocumentIndexingService|VectorStorageService)\b/i

function fail(message) {
  console.error(`[check-rag-source-quality] ${message}`)
  process.exitCode = 1
}

function isAllowedHost(hostname, allowedHosts) {
  const normalizedHost = normalizeHostname(hostname)
  return allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = normalizeHostname(allowedHost)
    return normalizedHost === normalizedAllowedHost || normalizedHost.endsWith(`.${normalizedAllowedHost}`)
  })
}

function isPrivateOrInternalHost(hostname) {
  const host = normalizeHostname(hostname).replace(/^\[|\]$/g, '')

  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.corp')) return true
  if (host === 'metadata.google.internal') return true
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true

  const ipv4Parts = host.split('.').map((part) => Number(part))
  if (ipv4Parts.length === 4 && ipv4Parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = ipv4Parts
    if (first === 0 || first === 10 || first === 127) return true
    if (first === 169 && second === 254) return true
    if (first === 172 && second >= 16 && second <= 31) return true
    if (first === 192 && second === 168) return true
    if (first === 100 && second >= 64 && second <= 127) return true
    if (first === 198 && (second === 18 || second === 19)) return true
    if (first >= 224) return true
  }

  return false
}

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/\.$/, '')
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url
  } catch {
    return null
  }
}

function isUrlLikeReference(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(String(value || '').trim())
}

function pushInternalLeakError(errors, source, index, fields) {
  for (const field of fields) {
    if (typeof source[field] === 'string' && internalNamePattern.test(source[field])) {
      errors.push(`source[${index}].${field} exposes internal source implementation names`)
    }
  }
}

function validateSourceUrlField(errors, source, index, field) {
  if (!source[field]) return
  if (field === 'sourceReference' && !isUrlLikeReference(source[field])) return

  const parsedUrl = parseHttpUrl(source[field])
  if (!parsedUrl) {
    errors.push(`source[${index}].${field} must be a valid http(s) URL`)
    return
  }

  if (isPrivateOrInternalHost(parsedUrl.hostname)) {
    errors.push(`source[${index}].${field} must not point to private or internal hosts`)
  }

  const allowedHosts = vendorHostAllowlist[source.vendorScope]
  if (allowedHosts && !isAllowedHost(parsedUrl.hostname, allowedHosts)) {
    const fieldLabel = field === 'url' ? 'URL' : 'sourceReference'
    errors.push(`source[${index}].vendorScope ${source.vendorScope} ${fieldLabel} host mismatch: ${parsedUrl.hostname}`)
  }
}

function validateResponseEnvelope(data, label) {
  const errors = []
  const response = data.response || data
  const confidenceHolder = data.response ? data : response
  const expectedMetadata = data.expectedMetadata || response.expectedMetadata || {}

  for (const field of requiredResponseFields) {
    if (response[field] === undefined || response[field] === null || response[field] === '') {
      errors.push(`${label} missing response field ${field}`)
    }
  }

  if (typeof response.message === 'string' && internalNamePattern.test(response.message)) {
    errors.push(`${label} response.message exposes internal source implementation names`)
  }

  if (!Array.isArray(response.sources)) {
    errors.push(`${label} sources must be an array`)
  } else {
    const titleCounts = new Map()
    for (const [index, source] of response.sources.entries()) {
      for (const field of requiredSourceFields) {
        if (source[field] === undefined || source[field] === null || source[field] === '') {
          errors.push(`${label} source[${index}] missing ${field}`)
        }
      }

      const titleKey = String(source.title || '').trim().toLowerCase()
      titleCounts.set(titleKey, (titleCounts.get(titleKey) || 0) + 1)

      if (!source.url && !source.sourceReference) errors.push(`${label} source[${index}] missing url or sourceReference`)
      if (!source.sourceType) errors.push(`${label} source[${index}] missing sourceType`)
      else if (!allowedSourceTypes.has(source.sourceType)) errors.push(`${label} source[${index}].sourceType is not allowlisted`)
      if (!source.vendorScope) errors.push(`${label} source[${index}] missing vendorScope`)
      else if (!allowedVendorScopes.has(source.vendorScope)) errors.push(`${label} source[${index}].vendorScope is not allowlisted`)
      if (expectedMetadata.vendorScope && source.vendorScope !== expectedMetadata.vendorScope) {
        errors.push(`${label} source[${index}].vendorScope must be ${expectedMetadata.vendorScope}`)
      }

      pushInternalLeakError(errors, source, index, ['title', 'excerpt', 'sourceLabel', 'sourceType', 'url', 'sourceReference'])
      validateSourceUrlField(errors, source, index, 'url')
      validateSourceUrlField(errors, source, index, 'sourceReference')

      if (source.similarity !== undefined) {
        const similarity = Number(source.similarity)
        if (!Number.isFinite(similarity) || similarity < 0 || similarity > 1) {
          errors.push(`${label} source[${index}].similarity must be 0..1`)
        }
      }

      for (const field of ['score', 'hybridScore', 'vectorScore', 'keywordScore']) {
        if (source[field] !== undefined) {
          const value = Number(source[field])
          if (!Number.isFinite(value) || value < 0 || value > 1) {
            errors.push(`${label} source[${index}].${field} must be 0..1`)
          }
        }
      }

      if (!source.retrievalMethod) errors.push(`${label} source[${index}] missing retrievalMethod`)
      if (source.retrievalMethod === 'fallback') errors.push(`${label} source[${index}] must not be fallback-only`)
      if (source.evidenceType && source.evidenceType === 'fallback') errors.push(`${label} source[${index}] must not use fallback evidence`)
      if (!source.sourceQuality || typeof source.sourceQuality !== 'object') {
        errors.push(`${label} source[${index}] missing sourceQuality`)
      } else {
        if (source.sourceQuality.isFallback === true) {
          errors.push(`${label} source[${index}].sourceQuality.isFallback must not be true`)
        }
        if (source.sourceQuality.qualityScore !== undefined) {
          const qualityScore = Number(source.sourceQuality.qualityScore)
          if (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 1) {
            errors.push(`${label} source[${index}].sourceQuality.qualityScore must be 0..1`)
          }
        }
        if (source.url && source.sourceQuality.hasUrl === false) {
          errors.push(`${label} source[${index}].sourceQuality.hasUrl conflicts with source.url`)
        }
        if (source.excerpt && source.sourceQuality.hasExcerpt === false) {
          errors.push(`${label} source[${index}].sourceQuality.hasExcerpt conflicts with source.excerpt`)
        }
      }
    }

    const maxDuplicateTitleCount = Number(expectedMetadata.maxDuplicateTitleCount || 1)
    for (const [title, count] of titleCounts.entries()) {
      if (count > maxDuplicateTitleCount) errors.push(`${label} duplicate source title exceeds limit: ${title}`)
    }
  }

  const confidence = Number(confidenceHolder.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    errors.push(`${label} confidence must be 0..100`)
  }

  return errors
}

function validateFixtureSuite(data) {
  if (data.fixturePack !== 'rag-source-quality-v2') {
    fail('fixture suite must declare fixturePack rag-source-quality-v2')
  }
  if (data.mode !== 'checker_only') {
    fail('fixture suite must stay checker_only')
  }
  for (const key of requiredFixtureSideEffects) {
    if (data.sideEffects?.[key] !== false) {
      fail(`fixture suite sideEffects.${key} must be false`)
    }
  }

  if (!Array.isArray(data.fixtures)) {
    fail('fixture suite must include fixtures array')
    return
  }

  const ids = new Set()
  let expectedPass = 0
  let expectedFail = 0

  for (const [index, fixture] of data.fixtures.entries()) {
    const id = fixture.id || `fixtures[${index}]`
    const label = `fixtures[${index}] ${id}`
    if (ids.has(id)) fail(`${label}.id must be unique`)
    ids.add(id)

    const errors = validateResponseEnvelope(fixture, label)
    if (fixture.expectedValid === true) {
      expectedPass += 1
      if (errors.length > 0) {
        for (const error of errors) fail(error)
      }
      continue
    }

    if (fixture.expectedValid === false) {
      expectedFail += 1
      if (errors.length === 0) fail(`${label} expected validation failure but passed`)
      for (const fragment of fixture.expectedFailureFragments || []) {
        if (!errors.some((error) => error.includes(fragment))) {
          fail(`${label} expected failure containing ${fragment}`)
        }
      }
      continue
    }

    fail(`${label} must declare expectedValid true or false`)
  }

  if (expectedPass < 1) fail('fixture suite must include at least one expectedValid case')
  if (expectedFail < 3) fail('fixture suite must include at least three expected invalid cases')
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

if (Array.isArray(data.fixtures)) {
  validateFixtureSuite(data)
} else {
  const errors = validateResponseEnvelope(data, 'response')
  for (const error of errors) fail(error)
}

if (!process.exitCode) console.log('[check-rag-source-quality] ok')
