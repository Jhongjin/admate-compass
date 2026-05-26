#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()

function fail(message) {
  console.error(`[check-compass-source-proposal-review-decision-contract] ${message}`)
  process.exitCode = 1
}

function read(relativePath) {
  const fullPath = path.join(root, relativePath)
  if (!fs.existsSync(fullPath)) {
    fail(`missing ${relativePath}`)
    return ''
  }
  return fs.readFileSync(fullPath, 'utf8')
}

const servicePath = 'src/lib/services/CompassSourceProposalReviewService.ts'
const fixturePath = 'docs/rag/compass-source-proposal-review-decision-contract-fixtures.json'
const serviceText = read(servicePath)
const fixtureText = read(fixturePath)
const packageJson = JSON.parse(read('package.json') || '{}')

function loadReviewServiceForFixtureGate() {
  const transpiled = ts.transpileModule(serviceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: path.join(root, servicePath),
  })

  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    console,
    Date,
    Error,
    Math,
    Number,
    String,
    URL,
    require(specifier) {
      throw new Error(`Unexpected fixture gate import: ${specifier}`)
    },
  }

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: path.join(root, servicePath),
  })

  const buildDecision = module.exports.buildCompassSourceProposalRejectionDecision
  if (typeof buildDecision !== 'function') {
    throw new Error('buildCompassSourceProposalRejectionDecision export was not found')
  }

  return { buildDecision }
}

function assertJsonEquals(actual, expected, label) {
  const actualSerialized = JSON.stringify(actual)
  const expectedSerialized = JSON.stringify(expected)
  if (actualSerialized !== expectedSerialized) {
    fail(`${label} mismatch: expected ${expectedSerialized}, got ${actualSerialized}`)
  }
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const next = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    next[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(base?.[key] || {}, value)
      : value
  }
  return next
}

function visitValues(value, visitor, pathParts = []) {
  visitor(value, pathParts)

  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitValues(entry, visitor, [...pathParts, String(index)]))
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      visitValues(entry, visitor, [...pathParts, key])
    }
  }
}

function assertNoSecretLikeOutput(decision, label) {
  const forbiddenPatterns = [
    [/raw-secret-value/i, 'raw-secret-value'],
    [/should-not-leak/i, 'should-not-leak'],
    [/\b(?:bearer|token|secret|apikey|api_key|password)\s*[:=]\s*[^\s,;]+/i, 'secret assignment'],
    [/sk-[A-Za-z0-9_-]{12,}/i, 'sk-* token'],
    [/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/, 'jwt-like token'],
  ]

  visitValues(decision, (value, pathParts) => {
    if (typeof value !== 'string') return
    for (const [pattern, description] of forbiddenPatterns) {
      if (pattern.test(value)) {
        fail(`${label}.${pathParts.join('.')} leaks ${description}`)
      }
    }
  })
}

function assertRejectOnlyEnvelope(decision, label) {
  if (decision.contract !== 'compass-source-proposal-rejection-decision-v1') {
    fail(`${label} must use the rejection decision contract`)
  }
  if (decision.decision !== 'reject') {
    fail(`${label} must be rejection-only`)
  }
  if (decision.mutationEnabled !== false || decision.llmUsed !== false) {
    fail(`${label} must keep mutationEnabled=false and llmUsed=false`)
  }
  if (decision.expectations?.requiresCurrentSnapshot !== true) {
    fail(`${label} must require the current review snapshot`)
  }
  if (decision.expectations?.expectedSnapshotHash !== decision.audit?.reviewSnapshotHash) {
    fail(`${label} expectedSnapshotHash must mirror audit.reviewSnapshotHash`)
  }
  assertJsonEquals(
    decision.expectations?.idempotentBy,
    ['proposalId', 'decision', 'idempotencyKey'],
    `${label}.expectations.idempotentBy`,
  )
  if (decision.expectations?.noCorpusMutation !== true || decision.expectations?.noApplyAction !== true) {
    fail(`${label} must explicitly block corpus mutation and apply action`)
  }
  if (!/^reject_[0-9a-f]{8}$/.test(decision.audit?.decisionFingerprint || '')) {
    fail(`${label} audit.decisionFingerprint must be a stable rejection fingerprint`)
  }

  const forbiddenKeys = new Set([
    'approve',
    'approved',
    'approval',
    'apply',
    'applyPlan',
    'applyTarget',
    'corpusWrite',
    'corpusMutation',
    'wouldIndex',
    'wouldPromote',
    'promote',
    'promotion',
  ])

  visitValues(decision, (value, pathParts) => {
    const key = pathParts[pathParts.length - 1]
    if (forbiddenKeys.has(key)) {
      fail(`${label} must not expose approve/apply/corpus mutation field ${pathParts.join('.')}`)
    }
  })
}

for (const token of [
  'buildCompassSourceProposalRejectionDecision',
  'compass-source-proposal-rejection-decision-v1',
  "decision: 'reject'",
  'mutationEnabled: false',
  'llmUsed: false',
  'requiresCurrentSnapshot: true',
  "idempotentBy: ['proposalId', 'decision', 'idempotencyKey']",
  'noCorpusMutation: true',
  'noApplyAction: true',
  'sanitizeAuditValue',
  'stableDecisionFingerprint',
]) {
  if (!serviceText.includes(token)) {
    fail(`review service rejection contract missing ${token}`)
  }
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
  'console.log',
  'console.error',
]) {
  if (serviceText.includes(forbidden)) {
    fail(`review decision service logic must stay pure and non-logging: ${forbidden}`)
  }
}

let fixtures
try {
  fixtures = JSON.parse(fixtureText)
} catch (error) {
  fail(`fixture JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
  fixtures = {}
}

if (fixtures.fixturePack !== 'compass-source-proposal-review-decision-contract-v1') {
  fail('fixturePack must be compass-source-proposal-review-decision-contract-v1')
}
if (fixtures.mode !== 'local_contract_only') {
  fail('fixture mode must be local_contract_only')
}
for (const [key, value] of Object.entries(fixtures.sideEffects || {})) {
  if (value !== false) fail(`fixture sideEffects.${key} must be false`)
}

let buildDecision
try {
  ;({ buildDecision } = loadReviewServiceForFixtureGate())
} catch (error) {
  fail(`review decision fixture evaluation failed: ${error instanceof Error ? error.message : String(error)}`)
}

const validCases = Array.isArray(fixtures.validCases) ? fixtures.validCases : []
if (validCases.length < 2) {
  fail('review decision fixture pack must include at least two valid rejection cases')
}

const caseIds = new Set()
for (const [index, testCase] of validCases.entries()) {
  const label = `validCases[${index}] ${testCase.id || 'unknown'}`
  if (!testCase.id || !testCase.input || !testCase.expected) {
    fail(`${label} must include id, input, and expected`)
    continue
  }
  if (caseIds.has(testCase.id)) fail(`${label}.id must be unique`)
  caseIds.add(testCase.id)

  let first
  let second
  try {
    first = buildDecision(testCase.input)
    second = buildDecision(testCase.input)
  } catch (error) {
    fail(`${label} unexpectedly threw: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }

  assertJsonEquals(first, second, `${label} deterministic repeat`)
  assertJsonEquals(first, testCase.expected, `${label} expected decision`)
  assertRejectOnlyEnvelope(first, label)
  assertNoSecretLikeOutput(first, label)
}

const invalidCases = Array.isArray(fixtures.invalidCases) ? fixtures.invalidCases : []
if (invalidCases.length < 3) {
  fail('review decision fixture pack must include validation rejection cases')
}

const baseInput = validCases[0]?.input
for (const [index, testCase] of invalidCases.entries()) {
  const label = `invalidCases[${index}] ${testCase.id || 'unknown'}`
  if (!testCase.id || !testCase.inputPatch || !testCase.expectedErrorIncludes) {
    fail(`${label} must include id, inputPatch, and expectedErrorIncludes`)
    continue
  }

  try {
    buildDecision(deepMerge(baseInput, testCase.inputPatch))
    fail(`${label} should have failed validation`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(testCase.expectedErrorIncludes)) {
      fail(`${label} expected error including "${testCase.expectedErrorIncludes}", got "${message}"`)
    }
  }
}

if (
  packageJson.scripts?.['check:compass-source-proposal-review-decision-contract']
  !== 'node scripts/check-compass-source-proposal-review-decision-contract.mjs'
) {
  fail('package script check:compass-source-proposal-review-decision-contract is missing or changed')
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-source-proposal-review-decision-contract')) {
  fail('verify:harness must include check:compass-source-proposal-review-decision-contract')
}

if (!process.exitCode) {
  console.log('[check-compass-source-proposal-review-decision-contract] ok')
}
