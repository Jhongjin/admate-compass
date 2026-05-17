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

for (const relativePath of [
  'src/lib/services/CompassSourceProposalService.ts',
  'src/lib/services/CompassSourceProposalWorkerService.ts',
  'src/lib/services/DocumentIndexingService.ts',
  'src/lib/services/DocumentProcessingService.ts',
  'src/lib/services/VectorStorageService.ts',
  'src/app/api/internal/source-proposals/dry-run/route.ts',
  'src/app/api/admin/source-ops/proposals/route.ts',
  'src/app/api/admin/upload/[documentId]/reindex/route.ts',
  'src/app/api/admin/direct-process/route.ts',
  'src/app/api/admin/simple-index/route.ts',
]) {
  const text = read(relativePath)
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
    allowedHosts: input.allowedHosts,
  })

  assertNoRawHtml(result, label)
  assertNoSecretLikeText(result, label)

  if (!String(result.contentHash || '').startsWith('fnv1a:')) {
    fail(`${label}.contentHash must use deterministic sanitized hash prefix`)
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
      const actual = JSON.stringify(result.headings)
      const wanted = JSON.stringify(expected.headings)
      if (actual !== wanted) fail(`${label}.headings mismatch`)
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
    for (const reason of expected.reasonsInclude || []) {
      assertArrayIncludes(result.rejectionReasons, reason, `${label}.rejectionReasons`)
    }
    if (expected.contentText !== undefined && result.contentText !== expected.contentText) {
      fail(`${label}.contentText must be ${JSON.stringify(expected.contentText)}`)
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
