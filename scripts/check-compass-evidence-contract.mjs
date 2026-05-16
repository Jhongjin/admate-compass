import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const fixturePath = process.argv[2] || path.join(root, 'docs/rag/compass-evidence-contract-fixtures.json')

const allowedDecisions = new Set(['verified', 'weak', 'rejected'])
const allowedRetrievalMethods = new Set(['vector', 'keyword', 'hybrid', 'fallback'])
const allowedAgents = new Set(['agent1', 'agent2'])
const placeholderPattern = /서버리스 환경에서 (크롤링|처리)할 수 없습니다|관리자에게 문의|PDF 처리 중 오류|DOCX 파일은 서버리스/i
const sensitivePattern = /\b(token|access_token|refresh_token|id_token|api[_-]?key|secret|password|cookie|session)\s*[:=]/i

function fail(message) {
  console.error(`[check-compass-evidence-contract] ${message}`)
  process.exitCode = 1
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`)
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`)
}

if (!fs.existsSync(fixturePath)) {
  fail(`fixture file not found: ${fixturePath}`)
  process.exit()
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

assertNonEmptyString(fixture.fixturePack, 'fixturePack')
if (fixture.mode !== 'local_contract_only') fail('mode must be local_contract_only')

for (const [key, value] of Object.entries(fixture.sideEffects || {})) {
  assertBoolean(value, `sideEffects.${key}`)
  if (value !== false) fail(`sideEffects.${key} must be false`)
}

for (const role of ['teamLead', 'agent1', 'agent2']) {
  if (!fixture.roles?.[role]) fail(`missing roles.${role}`)
  assertNonEmptyString(fixture.roles?.[role]?.responsibility, `roles.${role}.responsibility`)
}

for (const [key, value] of Object.entries(fixture.answerPolicy || {})) {
  assertBoolean(value, `answerPolicy.${key}`)
  if (value !== true) fail(`answerPolicy.${key} must be true`)
}

if (!Array.isArray(fixture.packets) || fixture.packets.length === 0) {
  fail('packets must be a non-empty array')
}

const decisionCounts = new Map()
let hasPlaceholderRejected = false
let hasVendorConflictRejected = false

for (const [index, packet] of (fixture.packets || []).entries()) {
  const prefix = `packets[${index}]`
  for (const field of [
    'caseId',
    'agent',
    'claim',
    'sourceId',
    'documentId',
    'documentTitle',
    'excerpt',
    'retrievalMethod',
    'corpus',
    'score',
    'evidenceDecision',
  ]) {
    if (field === 'score') continue
    assertNonEmptyString(packet[field], `${prefix}.${field}`)
  }

  if (!allowedAgents.has(packet.agent)) fail(`${prefix}.agent must be agent1 or agent2`)
  if (!allowedRetrievalMethods.has(packet.retrievalMethod)) fail(`${prefix}.retrievalMethod is not allowed`)
  if (!allowedDecisions.has(packet.evidenceDecision)) fail(`${prefix}.evidenceDecision is not allowed`)

  const score = Number(packet.score)
  if (!Number.isFinite(score) || score < 0 || score > 1) fail(`${prefix}.score must be 0..1`)

  if (!Array.isArray(packet.evidenceDecisionReason) || packet.evidenceDecisionReason.length === 0) {
    fail(`${prefix}.evidenceDecisionReason must be a non-empty array`)
  }
  for (const [reasonIndex, reason] of (packet.evidenceDecisionReason || []).entries()) {
    assertNonEmptyString(reason, `${prefix}.evidenceDecisionReason[${reasonIndex}]`)
  }

  const searchableText = [
    packet.claim,
    packet.sourceId,
    packet.documentId,
    packet.documentTitle,
    packet.sourceUrl,
    packet.excerpt,
  ].filter(Boolean).join('\n')
  if (sensitivePattern.test(searchableText)) fail(`${prefix} appears to contain a secret-like value`)

  decisionCounts.set(packet.evidenceDecision, (decisionCounts.get(packet.evidenceDecision) || 0) + 1)

  if (packet.evidenceDecision === 'verified') {
    assertNonEmptyString(packet.sourceUrl, `${prefix}.sourceUrl`)
    assertNonEmptyString(packet.updatedAt, `${prefix}.updatedAt`)
    if (packet.retrievalMethod === 'fallback') fail(`${prefix} verified packet must not use fallback retrieval`)
    if (packet.corpus === 'placeholder') fail(`${prefix} verified packet must not use placeholder corpus`)
    if (packet.excerpt.length < 30) fail(`${prefix}.excerpt is too short for verified evidence`)
    if (!packet.evidenceDecisionReason.includes('source_quality_complete')) {
      fail(`${prefix} verified packet must include source_quality_complete reason`)
    }
  }

  if (packet.evidenceDecision !== 'rejected' && placeholderPattern.test(packet.excerpt)) {
    fail(`${prefix} placeholder content must be rejected`)
  }

  if (packet.evidenceDecision === 'rejected' && placeholderPattern.test(packet.excerpt)) {
    hasPlaceholderRejected = true
    if (!packet.evidenceDecisionReason.includes('placeholder_content')) {
      fail(`${prefix} rejected placeholder must include placeholder_content reason`)
    }
  }

  if (packet.evidenceDecision === 'rejected' && packet.evidenceDecisionReason.includes('vendor_mismatch')) {
    hasVendorConflictRejected = true
  }
}

const expectedSummary = fixture.expectedSummary || {}
for (const decision of ['verified', 'weak', 'rejected']) {
  if (Number(expectedSummary[decision]) !== decisionCounts.get(decision)) {
    fail(`expectedSummary.${decision} does not match packet count`)
  }
}

if (expectedSummary.placeholderRejected !== hasPlaceholderRejected) {
  fail('expectedSummary.placeholderRejected does not match packets')
}

if (expectedSummary.vendorConflictRejected !== hasVendorConflictRejected) {
  fail('expectedSummary.vendorConflictRejected does not match packets')
}

if (!process.exitCode) console.log('[check-compass-evidence-contract] ok')
