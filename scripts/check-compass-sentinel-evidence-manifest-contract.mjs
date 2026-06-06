#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const packagePath = path.join(root, 'package.json')
const modulePath = path.join(root, 'src', 'lib', 'services', 'CompassSentinelEvidenceManifestService.ts')
const defaultFixture = path.join(root, 'docs', 'rag', 'compass-sentinel-evidence-manifest-fixtures.json')
const input = process.argv[2] || defaultFixture

const contractVersion = 'compass-sentinel-evidence-manifest-v1'
const allowedEvidenceStatuses = new Set([
  'verified_evidence_present',
  'weak_or_missing_evidence',
  'conflict_or_unsafe_evidence',
])
const allowedReviewStatuses = new Set(['accepted', 'review_needed', 'blocked'])
const allowedAnswerDispositions = new Set(['answer_ready', 'no_data_found'])
const requiredSafetyFlags = [
  'localOnly',
  'sanitizedOnly',
  'reportOnly',
  'noDbRead',
  'noDbWrite',
  'noProviderCall',
  'noAuthHandoff',
  'noSentinelIngestCall',
  'noStorageAccess',
  'noPersistence',
  'noApplyOrPromote',
  'noLiveIngest',
]
const requiredSafetyFlagSet = new Set(requiredSafetyFlags)
const allowedTopLevelKeys = new Set([
  'contractVersion',
  'evidenceStatus',
  'reviewStatus',
  'answerDisposition',
  'evidenceCounts',
  'candidateDraftCounts',
  'reasonCodes',
  'operatorSafeSummary',
  'flags',
])
const allowedSanitizedKeys = new Set([
  ...allowedTopLevelKeys,
  ...requiredSafetyFlags,
  'verified',
  'weak',
  'rejected',
  'total',
  'selected',
])
const forbiddenKeyPatterns = [
  /(^|[_-])url($|[_-])/i,
  /uri/i,
  /href/i,
  /host(name)?/i,
  /path/i,
  /bucket/i,
  /storage/i,
  /signed/i,
  /account/i,
  /campaign/i,
  /provider(?!call$)/i,
  /(^|[_-])ad[_-]?id($|[_-])/i,
  /(^|[_-])id($|[_-])/i,
  /document/i,
  /chunk/i,
  /candidate[_-]?id/i,
  /hash/i,
  /diagnostic/i,
  /runtime/i,
  /payload/i,
  /raw/i,
  /dump/i,
  /secret/i,
  /token/i,
  /cookie/i,
  /session/i,
  /credential/i,
  /password/i,
  /auth(?!handoff$)/i,
]
const forbiddenValuePatterns = [
  /\b[a-z][a-z0-9+.-]*:\/\//i,
  /\b(?:https?|ftp|file|s3|gs|blob|data|chrome|edge|about|javascript):/i,
  /\/\/[a-z0-9.-]+\.[a-z]{2,}/i,
  /\b[a-z0-9.-]+\.(?:com|net|org|io|co|kr|dev|app|cloud|storage|local)\b/i,
  /(?:^|[\s"'(])(?:[a-z]:\\|\\\\|\/(?:users|var|tmp|mnt|home|app|storage|bucket)\b)/i,
  /(?:^|[\s"'(])\.\.?[\\/][^\s"']+/i,
  /\b(?:sourceUrl|sourceId|documentId|chunkId|candidateId)\b/i,
  /\b(?:url|uri|href|path|hash|payload|raw|dump|secret|token|session|cookie|credential|password)\b/i,
  /\b(?:account|campaign|provider|ad)[_-]?(?:id|key)\b/i,
  /\b(?:acct|camp|ad|creative|provider)[_-]?[a-z0-9]{6,}\b/i,
  /\b(?:meta|facebook|google|kakao|naver|tiktok|amazon|line|xandr)\b/i,
  /\b\d{7,}\b/,
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i,
]
const forbiddenModuleSnippets = [
  'fetch(',
  'createClient',
  'createServerClient',
  'createCompassServiceClient',
  'supabase',
  'process.env',
  'localStorage',
  'sessionStorage',
  'document.cookie',
  'insert(',
  'upsert(',
  'update(',
  'delete(',
  'sourceUrl',
  'sourceId',
  'documentId',
  'chunkId',
  'candidateId',
  'rawPayload',
  'payload',
]

function fail(message) {
  console.error(`[check-compass-sentinel-evidence-manifest-contract] ${message}`)
  process.exitCode = 1
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/')
}

function readText(file) {
  if (!fs.existsSync(file)) {
    fail(`missing ${relative(file)}`)
    return ''
  }
  return fs.readFileSync(file, 'utf8')
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function validateNoUnsafeKey(key, label) {
  if (!allowedSanitizedKeys.has(key) && forbiddenKeyPatterns.some((pattern) => pattern.test(key))) {
    fail(`${label}: forbidden raw or sensitive field key ${key}`)
  }
}

function validateNoUnsafeString(value, label) {
  for (const pattern of forbiddenValuePatterns) {
    if (pattern.test(value)) {
      fail(`${label}: unsafe raw string matched ${pattern}`)
    }
  }
}

function scanSanitizedValue(value, label) {
  if (typeof value === 'string') {
    validateNoUnsafeString(value, label)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSanitizedValue(item, `${label}[${index}]`))
    return
  }

  if (isPlainObject(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      validateNoUnsafeKey(key, label)
      scanSanitizedValue(nestedValue, `${label}.${key}`)
    }
  }
}

function validateCounts(counts, label, keys) {
  if (!isPlainObject(counts)) {
    fail(`${label} must be an object`)
    return
  }

  const countKeys = Object.keys(counts)
  if (countKeys.length !== keys.length) fail(`${label} has unexpected count keys`)
  for (const key of countKeys) {
    if (!keys.includes(key)) fail(`${label} has unexpected count key ${key}`)
  }
  for (const key of keys) {
    if (!isNonNegativeInteger(counts[key])) fail(`${label}.${key} must be a non-negative integer`)
  }
}

function validateManifest(manifest, label) {
  if (!isPlainObject(manifest)) {
    fail(`${label}: manifest must be an object`)
    return
  }

  for (const key of Object.keys(manifest)) {
    if (!allowedTopLevelKeys.has(key)) fail(`${label}: unexpected field ${key}`)
    validateNoUnsafeKey(key, label)
  }
  if (Object.keys(manifest).length !== allowedTopLevelKeys.size) {
    fail(`${label}: manifest must use exactly the allowed top-level keys`)
  }

  if (manifest.contractVersion !== contractVersion) {
    fail(`${label}: contractVersion must be ${contractVersion}`)
  }
  if (!allowedEvidenceStatuses.has(manifest.evidenceStatus)) {
    fail(`${label}: invalid evidenceStatus ${manifest.evidenceStatus}`)
  }
  if (!allowedReviewStatuses.has(manifest.reviewStatus)) {
    fail(`${label}: invalid reviewStatus ${manifest.reviewStatus}`)
  }
  if (!allowedAnswerDispositions.has(manifest.answerDisposition)) {
    fail(`${label}: invalid answerDisposition ${manifest.answerDisposition}`)
  }

  validateCounts(manifest.evidenceCounts, `${label}.evidenceCounts`, ['verified', 'weak', 'rejected'])
  validateCounts(manifest.candidateDraftCounts, `${label}.candidateDraftCounts`, ['total', 'selected', 'rejected'])
  if (isPlainObject(manifest.candidateDraftCounts)) {
    const total = manifest.candidateDraftCounts.total
    const selected = manifest.candidateDraftCounts.selected
    const rejected = manifest.candidateDraftCounts.rejected
    if (total !== selected + rejected) {
      fail(`${label}.candidateDraftCounts.total must equal selected plus rejected`)
    }
  }

  if (!Array.isArray(manifest.reasonCodes) || manifest.reasonCodes.length === 0) {
    fail(`${label}: reasonCodes must be a non-empty array`)
  } else {
    for (const [index, reasonCode] of manifest.reasonCodes.entries()) {
      if (!isNonEmptyString(reasonCode)) {
        fail(`${label}: reasonCodes[${index}] must be a non-empty string`)
      }
    }
  }
  if (!isNonEmptyString(manifest.operatorSafeSummary)) {
    fail(`${label}: operatorSafeSummary must be present`)
  }
  if (/\{[\s\S]*\}|\[[\s\S]*\]|stack trace|exception|headers|raw dump|diagnostic/i.test(manifest.operatorSafeSummary || '')) {
    fail(`${label}: operatorSafeSummary looks like a raw diagnostic dump`)
  }
  if (!isPlainObject(manifest.flags)) {
    fail(`${label}: flags must be an object`)
  } else {
    for (const key of Object.keys(manifest.flags)) {
      if (!requiredSafetyFlagSet.has(key)) fail(`${label}: unexpected safety flag ${key}`)
    }
    for (const flag of requiredSafetyFlags) {
      if (manifest.flags[flag] !== true) {
        fail(`${label}: safety flag ${flag} must be present and true`)
      }
    }
    if (Object.keys(manifest.flags).length !== requiredSafetyFlags.length) {
      fail(`${label}: flags must use exactly the required safety flags`)
    }
  }

  scanSanitizedValue(manifest, label)
}

function loadModule(source) {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: modulePath,
  })
  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    Set,
    Object,
    Array,
    Number,
    String,
    Boolean,
    console,
    require(specifier) {
      throw new Error(`Unexpected import from Compass Sentinel manifest module: ${specifier}`)
    },
  }
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: modulePath })
  return module.exports
}

function validateModule() {
  const source = readText(modulePath)
  if (!source) return null

  for (const snippet of [
    'CompassSentinelEvidenceManifest',
    'COMPASS_SENTINEL_EVIDENCE_MANIFEST_CONTRACT_VERSION',
    'COMPASS_SENTINEL_EVIDENCE_REQUIRED_FLAGS',
    'buildCompassSentinelEvidenceManifest',
    'buildCompassSentinelEvidenceManifestFromObservations',
    'isCompassSentinelEvidenceManifest',
    ...requiredSafetyFlags,
  ]) {
    if (!source.includes(snippet)) fail(`${relative(modulePath)} missing ${snippet}`)
  }

  for (const snippet of forbiddenModuleSnippets) {
    if (source.includes(snippet)) {
      fail(`${relative(modulePath)} must remain local-only and sanitized: ${snippet}`)
    }
  }

  try {
    return loadModule(source)
  } catch (error) {
    fail(`module load failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function validatePackageScript() {
  const pkg = JSON.parse(readText(packagePath) || '{}')
  const script = pkg.scripts?.['check:compass-sentinel-evidence-manifest']
  if (script !== 'node scripts/check-compass-sentinel-evidence-manifest-contract.mjs') {
    fail('package script check:compass-sentinel-evidence-manifest is missing or changed')
  }
  if (!String(pkg.scripts?.['verify:harness'] || '').includes('check:compass-sentinel-evidence-manifest')) {
    fail('verify:harness must include check:compass-sentinel-evidence-manifest')
  }
}

let parsed
try {
  parsed = JSON.parse(readText(input))
} catch (error) {
  fail(`manifest JSON parse failed: ${error instanceof Error ? error.message : String(error)}`)
}

const moduleExports = validateModule()

if (parsed !== undefined) {
  const records = Array.isArray(parsed) ? parsed : [parsed]
  if (records.length < 4) fail('manifest fixture must include accepted, weak, conflict, and review-needed records')
  let accepted = false
  let weakBlocked = false
  let conflictBlocked = false
  let reviewNeeded = false

  for (const [index, manifest] of records.entries()) {
    const label = `record ${index + 1}`
    validateManifest(manifest, label)
    if (moduleExports?.isCompassSentinelEvidenceManifest?.(manifest) !== true) {
      fail(`${label}: TypeScript manifest guard rejected fixture`)
    }
    accepted = accepted || manifest.reviewStatus === 'accepted'
    weakBlocked = weakBlocked || (
      manifest.evidenceStatus === 'weak_or_missing_evidence'
      && manifest.reviewStatus === 'blocked'
    )
    conflictBlocked = conflictBlocked || (
      manifest.evidenceStatus === 'conflict_or_unsafe_evidence'
      && manifest.reviewStatus === 'blocked'
    )
    reviewNeeded = reviewNeeded || manifest.reviewStatus === 'review_needed'
  }

  if (!accepted) fail('fixture pack missing accepted manifest')
  if (!weakBlocked) fail('fixture pack missing weak blocked manifest')
  if (!conflictBlocked) fail('fixture pack missing conflict blocked manifest')
  if (!reviewNeeded) fail('fixture pack missing review-needed manifest')
}

if (moduleExports?.buildCompassSentinelEvidenceManifestFromObservations) {
  const sample = moduleExports.buildCompassSentinelEvidenceManifestFromObservations({
    evidence: [
      { decision: 'verified', reasonCodes: ['source_quality_complete'] },
      { decision: 'verified', reasonCodes: ['verified_evidence_available'] },
    ],
    candidateDrafts: [
      { decision: 'selected', reasonCodes: ['supported_candidate_draft_available'] },
    ],
    operatorSafeSummary: 'Local sanitized evidence review is accepted for Sentinel display.',
  })
  validateManifest(sample, 'generated sample')
}

validatePackageScript()

if (!process.exitCode) {
  const count = Array.isArray(parsed) ? parsed.length : 1
  console.log(
    `[check-compass-sentinel-evidence-manifest-contract] ok (${count} manifest${count === 1 ? '' : 's'})`,
  )
}
