#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()

function fail(message) {
  console.error(`[check-compass-source-proposal-decision-ledger-contract] ${message}`)
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

const servicePath = 'src/lib/services/CompassSourceProposalDecisionLedgerService.ts'
const reviewServicePath = 'src/lib/services/CompassSourceProposalReviewService.ts'
const routePath = 'src/app/api/admin/source-ops/proposals/decisions/route.ts'
const fixturePath = 'docs/rag/compass-source-proposal-decision-ledger-fixtures.json'
const reviewFixturePath = 'docs/rag/compass-source-proposal-review-decision-contract-fixtures.json'

const serviceText = read(servicePath)
const reviewServiceText = read(reviewServicePath)
const routeText = read(routePath)
const fixtureText = read(fixturePath)
const reviewFixtureText = read(reviewFixturePath)
const packageJson = JSON.parse(read('package.json') || '{}')

function loadTsModule(relativePath, sourceText, extraRequire = {}) {
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: path.join(root, relativePath),
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
      if (specifier in extraRequire) return extraRequire[specifier]
      throw new Error(`Unexpected fixture gate import from ${relativePath}: ${specifier}`)
    },
  }

  vm.runInNewContext(transpiled.outputText, sandbox, {
    filename: path.join(root, relativePath),
  })

  return module.exports
}

function assertJsonEquals(actual, expected, label) {
  const actualSerialized = JSON.stringify(actual)
  const expectedSerialized = JSON.stringify(expected)
  if (actualSerialized !== expectedSerialized) {
    fail(`${label} mismatch: expected ${expectedSerialized}, got ${actualSerialized}`)
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(`${label} JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
    return {}
  }
}

function assertSafetyFlags(value, label) {
  if (
    value?.mutationEnabled !== false
    || value?.llmUsed !== false
    || value?.noCorpusMutation !== true
    || value?.noApplyAction !== true
  ) {
    fail(`${label} must include mutationEnabled=false, llmUsed=false, noCorpusMutation=true, noApplyAction=true`)
  }
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

function assertNoSecretLikeOutput(result, label) {
  const forbiddenPatterns = [
    [/raw-secret-value/i, 'raw-secret-value'],
    [/should-not-leak/i, 'should-not-leak'],
    [/\b(?:bearer|token|secret|apikey|api_key|password)\s*[:=]\s*[^\s,;]+/i, 'secret assignment'],
    [/sk-[A-Za-z0-9_-]{12,}/i, 'sk-* token'],
    [/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/, 'jwt-like token'],
  ]

  visitValues(result, (value, pathParts) => {
    if (typeof value !== 'string') return
    for (const [pattern, description] of forbiddenPatterns) {
      if (pattern.test(value)) {
        fail(`${label}.${pathParts.join('.')} leaks ${description}`)
      }
    }
  })
}

for (const token of [
  'classifyCompassSourceProposalDecisionLedger',
  'compass-source-proposal-decision-ledger-v1',
  'accepted_current_snapshot',
  'duplicate_idempotent_replay',
  'snapshot_conflict',
  'idempotency_conflict',
  'malformed_decision_envelope',
  'unknown_proposal',
  'non_pending_proposal',
  'captured_for_later_apply_review',
  'replayed_existing_decision',
  'rejected_without_capture',
  'disabled_contract_only',
  'reviewDecisionCapturedForLaterApplyReviewOnly',
  'approved_for_later_apply_review_only',
  'mutationEnabled: false',
  'llmUsed: false',
  'noCorpusMutation: true',
  'noApplyAction: true',
]) {
  if (!serviceText.includes(token)) {
    fail(`decision ledger service missing ${token}`)
  }
}

for (const token of [
  'parseCompassSourceProposalReviewDecisionEnvelope',
  'noCorpusMutation: true',
  'noApplyAction: true',
]) {
  if (!reviewServiceText.includes(token)) {
    fail(`review decision service missing ledger safety token ${token}`)
  }
}

for (const token of [
  'classifyCompassSourceProposalDecisionLedger',
  'guardCompassProductAdminSessionRoute',
  'decisionEnvelope',
  'proposalSnapshot',
  'priorDecisionEnvelope',
  'mutationEnabled: false',
  'llmUsed: false',
  'noCorpusMutation: true',
  'noApplyAction: true',
  'statusToHttpStatus',
]) {
  if (!routeText.includes(token)) {
    fail(`decision ledger route missing ${token}`)
  }
}

for (const forbidden of [
  'createCompassServiceClient',
  'supabase',
  '.insert(',
  '.upsert(',
  '.update(',
  '.delete(',
  '.from(\'documents\'',
  '.from("documents"',
  '.from(\'document_chunks\'',
  '.from("document_chunks"',
  '.from(\'embeddings\'',
  '.from("embeddings"',
  'DocumentIndexingService',
  'VectorStorageService',
  'EmbeddingService',
  'CompassAnswerLlmService',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  'chat.completions',
  'fetch(',
  'console.log',
  'console.error',
]) {
  if (serviceText.includes(forbidden) || routeText.includes(forbidden)) {
    fail(`decision ledger contract must stay dry-run and non-mutating: ${forbidden}`)
  }
}

const fixtures = parseJson(fixtureText, fixturePath)
const reviewFixtures = parseJson(reviewFixtureText, reviewFixturePath)

if (fixtures.fixturePack !== 'compass-source-proposal-decision-ledger-contract-v1') {
  fail('fixturePack must be compass-source-proposal-decision-ledger-contract-v1')
}
if (fixtures.mode !== 'local_contract_only') {
  fail('fixture mode must be local_contract_only')
}
for (const [key, value] of Object.entries(fixtures.sideEffects || {})) {
  if (value !== false) fail(`fixture sideEffects.${key} must be false`)
}
assertSafetyFlags(fixtures.safetyFlags, 'fixtures.safetyFlags')

let classifyLedger
try {
  const reviewModule = loadTsModule(reviewServicePath, reviewServiceText)
  const ledgerModule = loadTsModule(servicePath, serviceText, {
    './CompassSourceProposalReviewService': reviewModule,
  })
  classifyLedger = ledgerModule.classifyCompassSourceProposalDecisionLedger
  if (typeof classifyLedger !== 'function') {
    throw new Error('classifyCompassSourceProposalDecisionLedger export was not found')
  }
} catch (error) {
  fail(`decision ledger fixture evaluation failed: ${error instanceof Error ? error.message : String(error)}`)
}

const decisionById = new Map()
for (const testCase of [
  ...(Array.isArray(reviewFixtures.validCases) ? reviewFixtures.validCases : []),
  ...(Array.isArray(reviewFixtures.validApprovalCases) ? reviewFixtures.validApprovalCases : []),
]) {
  if (testCase?.id && testCase.expected) {
    assertSafetyFlags(testCase.expected, `review fixture ${testCase.id}`)
    decisionById.set(testCase.id, testCase.expected)
  }
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

const cases = Array.isArray(fixtures.cases) ? fixtures.cases : []
if (cases.length < 7) {
  fail('decision ledger fixture pack must include all status classifications')
}

const expectedStatuses = new Set([
  'accepted_current_snapshot',
  'duplicate_idempotent_replay',
  'snapshot_conflict',
  'idempotency_conflict',
  'malformed_decision_envelope',
  'unknown_proposal',
  'non_pending_proposal',
])
const seenStatuses = new Set()
const caseIds = new Set()

for (const [index, testCase] of cases.entries()) {
  const label = `cases[${index}] ${testCase.id || 'unknown'}`
  if (!testCase.id || !testCase.input || !testCase.expected) {
    fail(`${label} must include id, input, and expected`)
    continue
  }
  if (caseIds.has(testCase.id)) fail(`${label}.id must be unique`)
  caseIds.add(testCase.id)
  seenStatuses.add(testCase.expected.status)
  assertSafetyFlags(testCase.expected, `${label}.expected`)

  const decisionEnvelope = resolveDecisionFixture(testCase.input.decisionRef, `${label}.input.decisionRef`)
    ?? testCase.input.decisionEnvelope
  const priorDecisionEnvelope = resolveDecisionFixture(testCase.input.priorDecisionRef, `${label}.input.priorDecisionRef`)
    ?? testCase.input.priorDecisionEnvelope

  let result
  try {
    result = classifyLedger({
      decisionEnvelope,
      proposalSnapshot: testCase.input.proposalSnapshot,
      ...(testCase.input.hasOwnProperty('priorDecisionRef') || testCase.input.hasOwnProperty('priorDecisionEnvelope')
        ? { priorDecisionEnvelope }
        : {}),
    })
  } catch (error) {
    fail(`${label} should classify without throwing: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }

  assertJsonEquals(result, testCase.expected, label)
  assertSafetyFlags(result, label)
  assertNoSecretLikeOutput(result, label)

  if (result.contract !== 'compass-source-proposal-decision-ledger-v1') {
    fail(`${label} must use decision ledger contract v1`)
  }
  if (!expectedStatuses.has(result.status)) {
    fail(`${label} has unknown status ${result.status}`)
  }
  if (result.status === 'accepted_current_snapshot' && result.ledger?.action !== 'captured_for_later_apply_review') {
    fail(`${label} accepted current snapshot must be captured for later apply review only`)
  }
  if (result.decision === 'approve' && result.approvalScope !== 'approved_for_later_apply_review_only') {
    fail(`${label} approval must be scoped to later apply review only`)
  }
}

for (const status of expectedStatuses) {
  if (!seenStatuses.has(status)) fail(`fixture pack missing status ${status}`)
}

if (
  packageJson.scripts?.['check:compass-source-proposal-decision-ledger-contract']
  !== 'node scripts/check-compass-source-proposal-decision-ledger-contract.mjs'
) {
  fail('package script check:compass-source-proposal-decision-ledger-contract is missing or changed')
}

if (!process.exitCode) {
  console.log('[check-compass-source-proposal-decision-ledger-contract] ok')
}
