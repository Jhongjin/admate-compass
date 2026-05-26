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

  const buildRejectionDecision = module.exports.buildCompassSourceProposalRejectionDecision
  const buildApprovalDecision = module.exports.buildCompassSourceProposalApprovalDecision
  const classifySnapshotConflict = module.exports.classifyCompassSourceProposalReviewDecisionSnapshotConflict
  if (typeof buildRejectionDecision !== 'function') {
    throw new Error('buildCompassSourceProposalRejectionDecision export was not found')
  }
  if (typeof buildApprovalDecision !== 'function') {
    throw new Error('buildCompassSourceProposalApprovalDecision export was not found')
  }
  if (typeof classifySnapshotConflict !== 'function') {
    throw new Error('classifyCompassSourceProposalReviewDecisionSnapshotConflict export was not found')
  }

  return { buildRejectionDecision, buildApprovalDecision, classifySnapshotConflict }
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
  if (
    decision.mutationEnabled !== false
    || decision.llmUsed !== false
    || decision.noCorpusMutation !== true
    || decision.noApplyAction !== true
  ) {
    fail(`${label} must keep mutationEnabled=false, llmUsed=false, noCorpusMutation=true, and noApplyAction=true`)
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

function assertApprovalReviewOnlyEnvelope(decision, label) {
  if (decision.contract !== 'compass-source-proposal-approval-decision-v1') {
    fail(`${label} must use the approval decision contract`)
  }
  if (decision.decision !== 'approve') {
    fail(`${label} must be an approval decision`)
  }
  if (
    decision.mutationEnabled !== false
    || decision.llmUsed !== false
    || decision.noCorpusMutation !== true
    || decision.noApplyAction !== true
  ) {
    fail(`${label} must keep mutationEnabled=false, llmUsed=false, noCorpusMutation=true, and noApplyAction=true`)
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
  if (decision.expectations?.approvedForApplyReviewOnly !== true) {
    fail(`${label} must remain approved for later apply review only`)
  }
  if (!/^approve_[0-9a-f]{8}$/.test(decision.audit?.decisionFingerprint || '')) {
    fail(`${label} audit.decisionFingerprint must be a stable approval fingerprint`)
  }

  const forbiddenKeys = new Set([
    'applyPlan',
    'applyTarget',
    'applyAction',
    'corpusWrite',
    'corpusMutation',
    'documentWrite',
    'documentChunkWrite',
    'embeddingWrite',
    'wouldIndex',
    'wouldPromote',
    'promote',
    'promotion',
  ])

  visitValues(decision, (value, pathParts) => {
    const key = pathParts[pathParts.length - 1]
    if (forbiddenKeys.has(key)) {
      fail(`${label} must not expose apply/corpus mutation field ${pathParts.join('.')}`)
    }
  })
}

for (const token of [
  'buildCompassSourceProposalRejectionDecision',
  'buildCompassSourceProposalApprovalDecision',
  'classifyCompassSourceProposalReviewDecisionSnapshotConflict',
  'compass-source-proposal-rejection-decision-v1',
  'compass-source-proposal-approval-decision-v1',
  'compass-source-proposal-review-decision-snapshot-conflict-contract-v1',
  "decision: 'reject'",
  "decision: 'approve'",
  'accepted_current_snapshot',
  'duplicate_idempotent_replay',
  'snapshot_conflict',
  'idempotency_conflict',
  'malformed_decision_envelope',
  'mutationEnabled: false',
  'llmUsed: false',
  'noCorpusMutation: true',
  'noApplyAction: true',
  'requiresCurrentSnapshot: true',
  "idempotentBy: ['proposalId', 'decision', 'idempotencyKey']",
  'noCorpusMutation: true',
  'noApplyAction: true',
  'approvedForApplyReviewOnly: true',
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

let buildRejectionDecision
let buildApprovalDecision
let classifySnapshotConflict
try {
  ;({ buildRejectionDecision, buildApprovalDecision, classifySnapshotConflict } = loadReviewServiceForFixtureGate())
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
    first = buildRejectionDecision(testCase.input)
    second = buildRejectionDecision(testCase.input)
  } catch (error) {
    fail(`${label} unexpectedly threw: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }

  assertJsonEquals(first, second, `${label} deterministic repeat`)
  assertJsonEquals(first, testCase.expected, `${label} expected decision`)
  assertRejectOnlyEnvelope(first, label)
  assertNoSecretLikeOutput(first, label)
}

const validApprovalCases = Array.isArray(fixtures.validApprovalCases) ? fixtures.validApprovalCases : []
if (validApprovalCases.length < 2) {
  fail('review decision fixture pack must include at least two valid approval cases')
}

for (const [index, testCase] of validApprovalCases.entries()) {
  const label = `validApprovalCases[${index}] ${testCase.id || 'unknown'}`
  if (!testCase.id || !testCase.input || !testCase.expected) {
    fail(`${label} must include id, input, and expected`)
    continue
  }
  if (caseIds.has(testCase.id)) fail(`${label}.id must be unique`)
  caseIds.add(testCase.id)

  let first
  let second
  try {
    first = buildApprovalDecision(testCase.input)
    second = buildApprovalDecision(testCase.input)
  } catch (error) {
    fail(`${label} unexpectedly threw: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }

  assertJsonEquals(first, second, `${label} deterministic repeat`)
  assertJsonEquals(first, testCase.expected, `${label} expected decision`)
  assertApprovalReviewOnlyEnvelope(first, label)
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
    buildRejectionDecision(deepMerge(baseInput, testCase.inputPatch))
    fail(`${label} should have failed validation`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(testCase.expectedErrorIncludes)) {
      fail(`${label} expected error including "${testCase.expectedErrorIncludes}", got "${message}"`)
    }
  }
}

const invalidApprovalCases = Array.isArray(fixtures.invalidApprovalCases) ? fixtures.invalidApprovalCases : []
if (invalidApprovalCases.length < 3) {
  fail('review decision fixture pack must include validation approval cases')
}

const baseApprovalInput = validApprovalCases[0]?.input
for (const [index, testCase] of invalidApprovalCases.entries()) {
  const label = `invalidApprovalCases[${index}] ${testCase.id || 'unknown'}`
  if (!testCase.id || !testCase.inputPatch || !testCase.expectedErrorIncludes) {
    fail(`${label} must include id, inputPatch, and expectedErrorIncludes`)
    continue
  }

  try {
    buildApprovalDecision(deepMerge(baseApprovalInput, testCase.inputPatch))
    fail(`${label} should have failed validation`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(testCase.expectedErrorIncludes)) {
      fail(`${label} expected error including "${testCase.expectedErrorIncludes}", got "${message}"`)
    }
  }
}

const snapshotConflictCases = Array.isArray(fixtures.snapshotConflictCases) ? fixtures.snapshotConflictCases : []
if (snapshotConflictCases.length < 6) {
  fail('review decision fixture pack must include snapshot conflict classification cases')
}

const decisionById = new Map()
for (const testCase of [...validCases, ...validApprovalCases]) {
  if (testCase?.id && testCase.expected) decisionById.set(testCase.id, testCase.expected)
}

function resolveDecisionFixture(reference, label) {
  if (reference === undefined) return undefined
  if (reference && typeof reference === 'object' && !Array.isArray(reference)) return reference
  if (typeof reference !== 'string') {
    fail(`${label} must reference a fixture id or inline decision envelope`)
    return undefined
  }
  const decision = decisionById.get(reference)
  if (!decision) fail(`${label} references unknown decision fixture ${reference}`)
  return decision
}

function assertSnapshotConflictResult(result, expected, label) {
  assertJsonEquals(result, expected, label)
  if (result.contract !== 'compass-source-proposal-review-decision-snapshot-conflict-contract-v1') {
    fail(`${label} must use snapshot conflict contract v1`)
  }
  if (
    ![
      'accepted_current_snapshot',
      'duplicate_idempotent_replay',
      'snapshot_conflict',
      'idempotency_conflict',
      'malformed_decision_envelope',
    ].includes(result.classification)
  ) {
    fail(`${label} has unknown classification ${result.classification}`)
  }
  if (
    result.mutationEnabled !== false
    || result.llmUsed !== false
    || result.noCorpusMutation !== true
    || result.noApplyAction !== true
  ) {
    fail(`${label} must remain a local non-mutating checker`)
  }
}

for (const [index, testCase] of snapshotConflictCases.entries()) {
  const label = `snapshotConflictCases[${index}] ${testCase.id || 'unknown'}`
  if (!testCase.id || !testCase.input || !testCase.expected) {
    fail(`${label} must include id, input, and expected`)
    continue
  }
  if (caseIds.has(testCase.id)) fail(`${label}.id must be unique`)
  caseIds.add(testCase.id)

  const decisionEnvelope = resolveDecisionFixture(testCase.input.decisionRef, `${label}.input.decisionRef`)
    ?? testCase.input.decisionEnvelope
  const priorDecisionEnvelope = resolveDecisionFixture(testCase.input.priorDecisionRef, `${label}.input.priorDecisionRef`)
    ?? testCase.input.priorDecisionEnvelope

  let result
  try {
    result = classifySnapshotConflict({
      decisionEnvelope,
      currentReviewSnapshotHash: testCase.input.currentReviewSnapshotHash,
      ...(testCase.input.hasOwnProperty('priorDecisionRef') || testCase.input.hasOwnProperty('priorDecisionEnvelope')
        ? { priorDecisionEnvelope }
        : {}),
    })
  } catch (error) {
    fail(`${label} should classify without throwing: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }

  assertSnapshotConflictResult(result, testCase.expected, label)
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
