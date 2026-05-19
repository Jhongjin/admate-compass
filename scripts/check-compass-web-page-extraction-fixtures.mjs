#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const servicePath = path.join(root, 'src/lib/services/WebPageExtractionService.ts')
const fixturePath = path.join(root, 'docs/rag/compass-web-page-extraction-fixtures.json')

function fail(message) {
  console.error(`[check-compass-web-page-extraction-fixtures] ${message}`)
  process.exitCode = 1
}

function read(relativePath) {
  const fullPath = path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath)
  if (!fs.existsSync(fullPath)) {
    fail(`missing ${path.relative(root, fullPath)}`)
    return ''
  }
  return fs.readFileSync(fullPath, 'utf8')
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

function assertArrayIncludes(actual, expected, label) {
  if (!Array.isArray(actual) || !actual.includes(expected)) {
    fail(`${label} must include ${expected}`)
  }
}

function assertSourceQuality(actual, expected, label) {
  if (!expected) return
  if (!actual || typeof actual !== 'object') {
    fail(`${label}.sourceQuality must be present`)
    return
  }

  for (const key of ['hasTitle', 'hasUrl', 'hasExcerpt', 'linkedToDocument']) {
    if (expected[key] !== undefined && actual[key] !== expected[key]) {
      fail(`${label}.sourceQuality.${key} mismatch`)
    }
  }

  if (expected.qualityScore !== undefined && actual.qualityScore !== expected.qualityScore) {
    fail(`${label}.sourceQuality.qualityScore must be ${expected.qualityScore}`)
  }

  if (expected.minQualityScore !== undefined && Number(actual.qualityScore) < expected.minQualityScore) {
    fail(`${label}.sourceQuality.qualityScore must be at least ${expected.minQualityScore}`)
  }

  if (expected.warningsLength !== undefined) {
    const warningsLength = Array.isArray(actual.warnings) ? actual.warnings.length : -1
    if (warningsLength !== expected.warningsLength) {
      fail(`${label}.sourceQuality.warnings length must be ${expected.warningsLength}`)
    }
  }

  for (const warning of expected.warningsInclude || []) {
    assertArrayIncludes(actual.warnings, warning, `${label}.sourceQuality.warnings`)
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

function assertExactHeadings(actual, expected, label) {
  const actualSerialized = JSON.stringify(Array.isArray(actual) ? actual : [])
  const expectedSerialized = JSON.stringify(expected)
  if (actualSerialized !== expectedSerialized) fail(`${label}.headings mismatch`)
}

function assertRejectedCanonicalUrlIsSafe(value, label) {
  const canonicalUrl = String(value || '')
  if (!canonicalUrl) return

  let parsed
  try {
    parsed = new URL(canonicalUrl)
  } catch {
    fail(`${label}.canonicalUrl must be empty or a valid safe URL`)
    return
  }

  if (parsed.protocol !== 'https:') {
    fail(`${label}.canonicalUrl must not expose unsupported URL schemes`)
  }
  if (isPrivateOrInternalHost(parsed.hostname)) {
    fail(`${label}.canonicalUrl must not expose private/internal hosts`)
  }

  for (const [key, val] of parsed.searchParams.entries()) {
    if (SECRET_LIKE_QUERY_KEY_PATTERN.test(key) && String(val || '').trim()) {
      fail(`${label}.canonicalUrl must not expose secret-like query values`)
    }
  }
}

const SECRET_LIKE_QUERY_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session(?:[_-]?id)?|credential|cookie|secret|signature|x-amz-signature)/i

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

function buildContentHash(value) {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function listSourceFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory)
  if (!fs.existsSync(directory)) {
    fail(`missing ${relativeDirectory}`)
    return []
  }

  const files = []
  const entries = fs.readdirSync(directory, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path.relative(root, fullPath)))
      continue
    }

    if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

function shouldSkipWebPageExtractionWiringScan(fullPath) {
  const relativePath = path.relative(root, fullPath).replace(/\\/g, '/')

  return relativePath === 'src/lib/services/WebPageExtractionService.ts'
    || /(?:^|\/)__tests__\//.test(relativePath)
    || /\.(?:test|spec)\.(?:ts|tsx)$/.test(relativePath)
}

const serviceText = read(servicePath)
const fixtureText = read(fixturePath)
const packageJson = JSON.parse(read('package.json') || '{}')

for (const token of [
  'WebPageExtractionService',
  'extractWebPageForCompass',
  'validateWebPageExtractionSafety',
  'canonicalUrl',
  'sourceTitle',
  'contentText',
  'contentHash',
  'sourceQuality',
  'boilerplateRemoved',
  'policySignals',
  'rejectionReasons',
  'raw_html_too_large',
  'raw_html_detected',
  'secret_like_text',
  'private_or_internal_url',
  'host_not_allowlisted',
  'placeholder_or_low_signal_content',
]) {
  if (!serviceText.includes(token)) fail(`service missing ${token}`)
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
  'documents',
  'document_chunks',
  'ollama_document_chunks',
]) {
  if (serviceText.includes(forbidden)) {
    fail(`service must remain pure and must not include ${forbidden}`)
  }
}

for (const fullPath of [
  ...listSourceFiles('src/app'),
  ...listSourceFiles('src/lib'),
]) {
  if (shouldSkipWebPageExtractionWiringScan(fullPath)) continue

  const relativePath = path.relative(root, fullPath).replace(/\\/g, '/')
  const text = read(fullPath)
  for (const forbidden of [
    'WebPageExtractionService',
    'extractWebPageForCompass',
    'webPageExtractionService',
  ]) {
    if (text.includes(forbidden)) {
      fail(`${relativePath} must not wire WebPageExtractionService before proposal/apply approval`)
    }
  }
}

let fixture
try {
  fixture = JSON.parse(fixtureText)
} catch (error) {
  fail(`fixture JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
}

if (fixture.fixturePack !== 'compass-web-page-extraction-v1') {
  fail('fixturePack must be compass-web-page-extraction-v1')
}
if (fixture.mode !== 'local_contract_only') {
  fail('mode must be local_contract_only')
}

for (const [key, value] of Object.entries(fixture.sideEffects || {})) {
  if (value !== false) fail(`sideEffects.${key} must be false`)
}

let service
try {
  const transpiled = ts.transpileModule(serviceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: servicePath,
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
    Math,
    parseInt,
  }
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: servicePath })
  service = module.exports
} catch (error) {
  fail(`service transpile/evaluation failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (typeof service?.extractWebPageForCompass !== 'function') {
  fail('service export extractWebPageForCompass must be a function')
}
if (typeof service?.validateWebPageExtractionSafety !== 'function') {
  fail('service export validateWebPageExtractionSafety must be a function')
}

const publicEnvelopeSafetyProbe = service.validateWebPageExtractionSafety({
  status: 'accepted',
  rejectionReasons: [],
  contentText: 'safe policy content',
  canonicalUrl: 'https://support.google.com/adspolicy/answer/probe?access_token=REDACTED_SECRET_VALUE',
  sourceTitle: '&lt;div&gt;raw mirrored title&lt;/div&gt;',
  headings: ['Authorization: Bearer REDACTED_SECRET_VALUE'],
})

assertArrayIncludes(publicEnvelopeSafetyProbe, 'secret_like_text', 'validateWebPageExtractionSafety public envelope probe')
assertArrayIncludes(publicEnvelopeSafetyProbe, 'raw_html_detected', 'validateWebPageExtractionSafety public envelope probe')

let acceptedCases = 0
let rejectedCases = 0
const acceptedVendors = new Set()
const fixtureIds = new Set()

for (const [index, testCase] of (fixture.fixtures || []).entries()) {
  const label = `fixtures[${index}] ${testCase.id || 'unknown'}`
  const input = testCase.input || {}

  if (!testCase.id || !input.finalUrl || !input.rawHtml) {
    fail(`${label} must include id, input.finalUrl, and input.rawHtml`)
    continue
  }
  if (fixtureIds.has(testCase.id)) {
    fail(`${label}.id must be unique`)
  }
  fixtureIds.add(testCase.id)

  const result = service.extractWebPageForCompass(input.rawHtml, input.finalUrl, {
    fetchedAt: input.fetchedAt,
    minContentChars: input.minContentChars,
    minPolicySignals: input.minPolicySignals,
    maxRawHtmlBytes: input.maxRawHtmlBytes,
    allowedHosts: input.allowedHosts,
  })

  assertNoRawHtml(result, label)
  assertNoSecretLikeText(result, label)

  if (!String(result.contentHash || '').startsWith('fnv1a:')) {
    fail(`${label}.contentHash must use deterministic sanitized hash prefix`)
  }
  const expectedContentHash = buildContentHash(`${result.canonicalUrl}\n${result.contentText}`)
  if (result.contentHash !== expectedContentHash) {
    fail(`${label}.contentHash must exactly match sanitized canonicalUrl/contentText hash`)
  }
  if (input.fetchedAt && result.extractedAt !== input.fetchedAt) {
    fail(`${label}.extractedAt should be deterministic from fixture`)
  }
  if (!result.sourceQuality || typeof result.sourceQuality !== 'object') {
    fail(`${label}.sourceQuality must be present`)
  } else {
    const qualityScore = Number(result.sourceQuality.qualityScore)
    if (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 1) {
      fail(`${label}.sourceQuality.qualityScore must be 0..1`)
    }
    if (result.sourceQuality.isFallback !== false) {
      fail(`${label}.sourceQuality.isFallback must be false`)
    }
  }

  if (testCase.expected) {
    acceptedCases += 1
    const expected = testCase.expected

    if (result.status !== 'accepted') {
      fail(`${label} expected accepted status but got ${result.status}: ${result.rejectionReasons?.join(', ')}`)
    }
    if (Array.isArray(result.rejectionReasons) && result.rejectionReasons.length !== 0) {
      fail(`${label}.rejectionReasons must be empty for accepted extraction`)
    }
    if (result.sourceQuality?.qualityScore < 0.6) {
      fail(`${label}.sourceQuality.qualityScore must be at least 0.6 for accepted extraction`)
    }
    if (expected.canonicalUrl && result.canonicalUrl !== expected.canonicalUrl) {
      fail(`${label}.canonicalUrl mismatch`)
    }
    if (expected.sourceTitle && result.sourceTitle !== expected.sourceTitle) {
      fail(`${label}.sourceTitle mismatch`)
    }
    if (expected.language && result.language !== expected.language) {
      fail(`${label}.language mismatch`)
    }
    if (expected.boilerplateRemoved !== undefined && result.boilerplateRemoved !== expected.boilerplateRemoved) {
      fail(`${label}.boilerplateRemoved mismatch`)
    }
    if (Array.isArray(expected.headings)) {
      assertExactHeadings(result.headings, expected.headings, label)
    }
    for (const token of expected.boilerplateRemovedTypesIncludes || []) {
      assertArrayIncludes(result.boilerplateRemovedTypes, token, `${label}.boilerplateRemovedTypes`)
    }
    for (const token of expected.policySignalsInclude || []) {
      assertArrayIncludes(result.policySignals, token, `${label}.policySignals`)
      if (token.startsWith('vendor:')) acceptedVendors.add(token)
    }
    for (const token of expected.contentTextIncludes || []) {
      assertIncludes(result.contentText, token, `${label}.contentText`)
    }
    for (const token of expected.contentTextExcludes || []) {
      assertExcludes(result.contentText, token, `${label}.contentText`)
    }
    assertSourceQuality(result.sourceQuality, expected.sourceQuality, label)
  } else if (testCase.expectedRejection) {
    rejectedCases += 1
    const expected = testCase.expectedRejection

    if (result.status !== 'rejected') {
      fail(`${label} expected rejected status but got ${result.status}`)
    }
    assertRejectedCanonicalUrlIsSafe(result.canonicalUrl, label)
    for (const reason of expected.reasonsInclude || []) {
      assertArrayIncludes(result.rejectionReasons, reason, `${label}.rejectionReasons`)
    }
    if (expected.canonicalUrl !== undefined && result.canonicalUrl !== expected.canonicalUrl) {
      fail(`${label}.canonicalUrl must be ${JSON.stringify(expected.canonicalUrl)}`)
    }
    if (expected.contentText !== undefined && result.contentText !== expected.contentText) {
      fail(`${label}.contentText must be ${JSON.stringify(expected.contentText)}`)
    }
    if (expected.sourceTitle !== undefined && result.sourceTitle !== expected.sourceTitle) {
      fail(`${label}.sourceTitle must be ${JSON.stringify(expected.sourceTitle)}`)
    }
    if (Array.isArray(expected.headings)) {
      assertExactHeadings(result.headings, expected.headings, label)
    }
    if (result.sourceQuality?.qualityScore !== 0) {
      fail(`${label}.sourceQuality.qualityScore must be 0 for rejected extraction`)
    }
    assertSourceQuality(result.sourceQuality, expected.sourceQuality, label)
  } else {
    fail(`${label} must include expected or expectedRejection`)
  }
}

if (acceptedCases < 4) fail('expected at least four accepted extraction fixtures')
if (rejectedCases < 6) fail('expected at least six rejected extraction fixtures')
for (const vendorSignal of ['vendor:meta', 'vendor:google', 'vendor:kakao', 'vendor:naver']) {
  if (!acceptedVendors.has(vendorSignal)) {
    fail(`accepted fixtures must cover ${vendorSignal}`)
  }
}
for (const requiredId of [
  'accepted-kakao-korean-policy-source-quality',
  'accepted-naver-relative-canonical-policy-source',
  'rejects-cross-host-canonical-even-when-final-host-allowed',
  'rejects-allowed-host-with-insufficient-policy-signal',
]) {
  if (!fixtureIds.has(requiredId)) fail(`fixture pack missing ${requiredId}`)
}

if (packageJson.scripts?.['check:compass-web-page-extraction'] !== 'node scripts/check-compass-web-page-extraction-fixtures.mjs') {
  fail('package script check:compass-web-page-extraction is missing or changed')
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-web-page-extraction')) {
  fail('verify:harness must include check:compass-web-page-extraction')
}

if (!process.exitCode) {
  console.log('[check-compass-web-page-extraction-fixtures] ok')
}
