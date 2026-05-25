#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const parserPath = path.join(root, 'src/lib/services/CompassSourcePreviewParser.ts')
const proposalServicePath = path.join(root, 'src/lib/services/CompassSourceProposalService.ts')
const queueServicePath = path.join(root, 'src/lib/services/CompassSourceProposalQueueService.ts')
const fixturePath = path.join(root, 'docs/rag/compass-source-preview-parser-fixtures.json')
const indexingServicePath = path.join(root, 'src/lib/services/DocumentIndexingService.ts')
const processingServicePath = path.join(root, 'src/lib/services/DocumentProcessingService.ts')

function fail(message) {
  console.error(`[check-compass-source-preview-parser-fixtures] ${message}`)
  process.exitCode = 1
}

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing ${path.relative(root, filePath)}`)
    return ''
  }
  return fs.readFileSync(filePath, 'utf8')
}

function assertIncludes(value, expected, label) {
  if (!String(value || '').includes(expected)) {
    fail(`${label} must include ${expected}`)
  }
}

function assertExcludes(value, forbidden, label) {
  if (String(value || '').includes(forbidden)) {
    fail(`${label} must not include ${forbidden}`)
  }
}

function assertNoRawHtml(value, label) {
  const serialized = JSON.stringify(value)
  if (/<\/?(?:html|head|body|script|style|nav|header|footer|main|article|section|div|span|p|h[1-6]|meta|link)\b/i.test(serialized)) {
    fail(`${label} must not expose raw HTML tags`)
  }
  if (/__NEXT_DATA__|window\.__/i.test(serialized)) {
    fail(`${label} must not expose raw crawler chrome or script data`)
  }
}

function assertNoSecretLikeText(value, label) {
  const serialized = JSON.stringify(value)
  const secretPatterns = [
    /\bauthorization\s*:\s*bearer\s+[a-z0-9._~+/=_-]{10,}/i,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?id|credential|secret)\s*[:=]\s*["']?[a-z0-9._~+/=_-]{10,}/i,
    /\bcookie\s*[:=]\s*["']?[^;\s]{10,}/i,
    /\beyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i,
    /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/i,
    /\bX-Amz-Signature=/i,
  ]

  if (secretPatterns.some((pattern) => pattern.test(serialized))) {
    fail(`${label} must not expose secret-like text`)
  }
}

const SECRET_LIKE_QUERY_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session(?:[_-]?id)?|credential|cookie|secret|signature|x-amz-signature)/i

function assertPublicUrlSafe(value, label) {
  const urlValue = String(value || '')
  if (!urlValue) {
    fail(`${label} must include a safe canonical URL`)
    return
  }

  let parsed
  try {
    parsed = new URL(urlValue)
  } catch {
    fail(`${label} must be a valid URL`)
    return
  }

  if (parsed.protocol !== 'https:') {
    fail(`${label} must not expose unsupported URL schemes`)
  }
  if (isPrivateOrInternalHost(parsed.hostname)) {
    fail(`${label} must not expose private/internal hosts`)
  }

  for (const [key, val] of parsed.searchParams.entries()) {
    if (SECRET_LIKE_QUERY_KEY_PATTERN.test(key) && String(val || '').trim()) {
      fail(`${label} must not expose secret-like query values`)
    }
  }
}

function assertPreviewPublicEnvelopeSafe(preview, label) {
  const publicEnvelope = {
    title: preview.title,
    canonicalUrl: preview.canonicalUrl,
    headings: preview.headings,
    contentPreview: preview.contentPreview,
  }

  assertNoRawHtml(publicEnvelope, label)
  assertNoSecretLikeText(publicEnvelope, label)
  assertPublicUrlSafe(preview.canonicalUrl, `${label}.canonicalUrl`)
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

const parserText = read(parserPath)
const proposalServiceText = read(proposalServicePath)
const queueServiceText = read(queueServicePath)
const fixtureText = read(fixturePath)
const indexingServiceText = read(indexingServicePath)
const processingServiceText = read(processingServicePath)

for (const token of [
  'CompassSourcePreview',
  'extractCompassSourcePreview',
  'validateCompassSourcePreview',
  'validateCompassSourcePreviewSafety',
  'Preview fetch produced too little readable policy content.',
  'Preview fetch lacks enough readable policy signal for Compass review.',
  'Preview fetch failed public-envelope safety check',
  'DEFAULT_ALLOWED_POLICY_HOSTS',
  'secret_like_text',
  'raw_html_detected',
  'private_or_internal_url',
  'canonical_url_not_allowlisted',
]) {
  if (!parserText.includes(token)) fail(`parser missing ${token}`)
}

for (const forbidden of [
  'fetch(',
  'process.env',
  'createClient',
  'createCompassServiceClient',
  'supabase',
  'DocumentIndexingService',
  'VectorStorageService',
  'EmbeddingService',
  'CompassAnswerLlmService',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  'chat.completions',
  'node:fs',
]) {
  if (parserText.includes(forbidden)) {
    fail(`parser must remain pure and must not include ${forbidden}`)
  }
}

for (const token of [
  'raw_candidate: candidate',
  'canonical_url: candidate.canonicalUrl || null',
  'title: candidate.title || null',
  'content_preview: candidate.contentPreview || null',
]) {
  if (!queueServiceText.includes(token)) {
    fail(`proposal queue must persist only sanitized parser candidate fields: ${token}`)
  }
}

for (const forbidden of [
  'rawHtml',
  'raw_html',
  'sourceHtml',
]) {
  if (queueServiceText.includes(forbidden)) {
    fail(`proposal queue raw_candidate must not preserve parser source HTML field ${forbidden}`)
  }
}

for (const token of [
  'CompassSourcePreviewParser',
  'extractCompassSourcePreview',
  'minPreviewChars: MIN_PREVIEW_CHARS',
]) {
  if (!proposalServiceText.includes(token)) {
    fail(`source proposal service must use preview parser token ${token}`)
  }
}

for (const forbidden of [
  'function extractPreview',
  'function validateExtractedPreview',
  'function removePageChrome',
  'function stripTags',
  'function decodeEntities',
  'function matchFirst',
]) {
  if (proposalServiceText.includes(forbidden)) {
    fail(`source proposal service must not keep duplicate parser helper ${forbidden}`)
  }
}

for (const [label, text] of [
  ['DocumentIndexingService', indexingServiceText],
  ['DocumentProcessingService', processingServiceText],
]) {
  if (text.includes('CompassSourcePreviewParser') || text.includes('extractCompassSourcePreview')) {
    fail(`${label} must not use proposal preview parser before URL indexing is approved`)
  }
}

let fixture
try {
  fixture = JSON.parse(fixtureText)
} catch (error) {
  fail(`fixture JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
}

if (fixture.fixturePack !== 'compass-source-preview-parser-v1') {
  fail('fixturePack must be compass-source-preview-parser-v1')
}
if (fixture.mode !== 'local_contract_only') {
  fail('mode must be local_contract_only')
}

for (const [key, value] of Object.entries(fixture.sideEffects || {})) {
  if (value !== false) fail(`sideEffects.${key} must be false`)
}

let parser
try {
  const transpiled = ts.transpileModule(parserText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: parserPath,
  })
  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    console,
    URL,
    Date,
    Error,
    String,
    Array,
    Set,
    RegExp,
    Number,
    parseInt,
    decodeURI,
    decodeURIComponent,
  }
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: parserPath })
  parser = module.exports
} catch (error) {
  fail(`parser transpile/evaluation failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (typeof parser?.extractCompassSourcePreview !== 'function') {
  fail('parser export extractCompassSourcePreview must be a function')
}

let successCases = 0
let errorCases = 0
const fixtureIds = new Set()

for (const [index, testCase] of (fixture.fixtures || []).entries()) {
  const label = `fixtures[${index}] ${testCase.id || 'unknown'}`

  if (!testCase.id || !testCase.finalUrl || !testCase.html) {
    fail(`${label} must include id, finalUrl, and html`)
    continue
  }
  if (fixtureIds.has(testCase.id)) {
    fail(`${label}.id must be unique`)
  }
  fixtureIds.add(testCase.id)

  try {
    const preview = parser.extractCompassSourcePreview(testCase.html, testCase.finalUrl, {
      fetchedAt: testCase.fetchedAt,
      minPreviewChars: testCase.minPreviewChars,
    })

    if (testCase.expectedErrorIncludes) {
      fail(`${label} expected an error but parser returned a preview`)
      continue
    }

    successCases += 1
    const expected = testCase.expected || {}

    assertPreviewPublicEnvelopeSafe(preview, label)

    if (expected.title && preview.title !== expected.title) {
      fail(`${label} title mismatch`)
    }
    if (expected.canonicalUrl && preview.canonicalUrl !== expected.canonicalUrl) {
      fail(`${label} canonicalUrl mismatch`)
    }
    if (Array.isArray(expected.headings)) {
      const actual = JSON.stringify(preview.headings)
      const wanted = JSON.stringify(expected.headings)
      if (actual !== wanted) fail(`${label} headings mismatch`)
    }
    for (const token of expected.contentPreviewIncludes || []) {
      assertIncludes(preview.contentPreview, token, `${label}.contentPreview`)
    }
    for (const token of expected.contentPreviewExcludes || []) {
      assertExcludes(preview.contentPreview, token, `${label}.contentPreview`)
    }
    if (expected.contentLengthEqualsPreviewLength && preview.contentLength !== preview.contentPreview.length) {
      fail(`${label} contentLength must match contentPreview.length`)
    }
    if (testCase.fetchedAt && preview.fetchedAt !== testCase.fetchedAt) {
      fail(`${label} fetchedAt should be deterministic from fixture`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!testCase.expectedErrorIncludes) {
      fail(`${label} unexpected parser error: ${message}`)
      continue
    }

    errorCases += 1
    assertNoRawHtml(message, `${label}.error`)
    assertNoSecretLikeText(message, `${label}.error`)
    if (!message.includes(testCase.expectedErrorIncludes)) {
      fail(`${label} error message must include ${testCase.expectedErrorIncludes}`)
    }
  }
}

if (successCases < 2) fail('expected at least two successful parser fixtures')
if (errorCases < 6) fail('expected at least six parser error fixtures')

for (const requiredId of [
  'rejects-secret-like-title-before-queue',
  'rejects-escaped-raw-html-content-before-queue',
  'rejects-private-internal-final-url-before-queue',
  'rejects-canonical-url-outside-allowlist-before-queue',
]) {
  if (!fixtureIds.has(requiredId)) fail(`fixture pack missing ${requiredId}`)
}

if (!process.exitCode) {
  console.log('[check-compass-source-preview-parser-fixtures] ok')
}
