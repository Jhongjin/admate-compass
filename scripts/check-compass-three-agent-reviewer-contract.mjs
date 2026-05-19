import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const fixturePath = path.join(root, 'docs/rag/compass-three-agent-reviewer-fixtures.json')
const servicePath = path.join(root, 'src/lib/services/CompassEvidenceReviewerService.ts')
const packagePath = path.join(root, 'package.json')

const sensitivePattern = /\b(token|access_token|refresh_token|id_token|api[_-]?key|secret|password|cookie|session)\s*[:=]/i
const allowedAgents = new Set(['policy_evidence_agent', 'media_product_evidence_agent'])
const allowedDecisions = new Set(['verified', 'weak', 'rejected'])
const allowedOutcomes = new Set(['answer', 'noDataFound'])

function fail(message) {
  console.error(`[check-compass-three-agent-reviewer-contract] ${message}`)
  process.exitCode = 1
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`)
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`)
}

function assertNoSensitiveText(value, label) {
  if (sensitivePattern.test(String(value || ''))) fail(`${label} appears to contain secret-like text`)
}

for (const requiredPath of [fixturePath, servicePath, packagePath]) {
  if (!fs.existsSync(requiredPath)) fail(`missing required file: ${path.relative(root, requiredPath)}`)
}

if (process.exitCode) process.exit()

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const serviceText = fs.readFileSync(servicePath, 'utf8')
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

if (fixture.fixturePack !== 'compass-three-agent-reviewer-v1') fail('fixturePack must be compass-three-agent-reviewer-v1')
if (fixture.mode !== 'local_contract_only') fail('mode must be local_contract_only')
if (fixture.canonicalAnswerRoute !== '/api/compass-answer') fail('canonicalAnswerRoute must be /api/compass-answer')
if (fixture.legacyCompatibilityRoute !== '/api/chat-ollama') fail('legacyCompatibilityRoute must be /api/chat-ollama')
if (fixture.legacyAnswerRoute !== '/api/chatbot') fail('legacyAnswerRoute must be /api/chatbot')

for (const [key, value] of Object.entries(fixture.sideEffects || {})) {
  assertBoolean(value, `sideEffects.${key}`)
  if (value !== false) fail(`sideEffects.${key} must be false`)
}

for (const role of ['teamLead', 'agent1', 'agent2']) {
  if (!fixture.roles?.[role]) fail(`missing roles.${role}`)
  assertNonEmptyString(fixture.roles?.[role]?.label, `roles.${role}.label`)
  assertNonEmptyString(fixture.roles?.[role]?.responsibility, `roles.${role}.responsibility`)
}

if (fixture.answerPolicy?.specialistAgentsWriteFinalAnswer !== false) {
  fail('specialistAgentsWriteFinalAnswer must be false')
}

for (const flag of ['teamLeadOwnsFinalAnswer', 'verifiedEvidenceRequired', 'rejectedEvidenceExcluded', 'weakOnlyReturnsNoData']) {
  if (fixture.answerPolicy?.[flag] !== true) fail(`answerPolicy.${flag} must be true`)
}

if (!Array.isArray(fixture.cases) || fixture.cases.length < 3) {
  fail('cases must contain answer, weak-only, and rejection fixtures')
}

let hasAnswerCase = false
let hasWeakOnlyCase = false
let hasVendorConflict = false
let hasPlaceholderRejected = false
let hasStaleSource = false
let hasDedupedEvidence = false

function isCompleteLineage(packet) {
  return Boolean(
    packet.sourceId?.trim()
      && packet.sourceUrl?.trim()
      && packet.sourceTitle?.trim()
      && packet.vendor?.trim()
      && packet.chunkId?.trim()
      && packet.publishedOrFetchedAt?.trim(),
  )
}

function isVerifiedPacket(packet) {
  return packet.evidenceDecision === 'verified'
    && isCompleteLineage(packet)
    && Number(packet.retrievalScore) >= 0.72
    && packet.excerpt.trim().length >= 30
    && packet.reasons.includes('source_quality_complete')
    && !packet.reasons.includes('placeholder_content')
    && !packet.reasons.includes('vendor_mismatch')
    && !packet.reasons.includes('stale_source')
}

function normalizeReviewKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function dedupePackets(packets) {
  const seen = new Set()
  return packets.filter((packet) => {
    const key = [
      normalizeReviewKey(packet.sourceId),
      normalizeReviewKey(packet.chunkId),
      normalizeReviewKey(packet.claim),
    ].join('::')

    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function reviewOutcomeForCase(packets) {
  const dedupedPackets = dedupePackets(packets)
  const verifiedPackets = dedupedPackets.filter(isVerifiedPacket)
  const conflicts = new Set()
  for (const packet of dedupedPackets) {
    for (const conflict of ['vendor_mismatch', 'stale_source', 'placeholder_content']) {
      if (packet.reasons.includes(conflict)) conflicts.add(conflict)
    }
  }
  return {
    outcome: verifiedPackets.length > 0 && conflicts.size === 0 ? 'answer' : 'noDataFound',
    verifiedCount: verifiedPackets.length,
    dedupedCount: dedupedPackets.length,
    conflicts: Array.from(conflicts),
  }
}

for (const [caseIndex, testCase] of (fixture.cases || []).entries()) {
  const casePrefix = `cases[${caseIndex}]`
  assertNonEmptyString(testCase.caseId, `${casePrefix}.caseId`)
  assertNonEmptyString(testCase.question, `${casePrefix}.question`)
  if (!allowedOutcomes.has(testCase.expectedOutcome)) fail(`${casePrefix}.expectedOutcome is not allowed`)
  if (!Array.isArray(testCase.packets) || testCase.packets.length < 2) fail(`${casePrefix}.packets must include both agents`)

  const caseAgents = new Set()
  let verifiedCount = 0
  let weakCount = 0

  for (const [packetIndex, packet] of (testCase.packets || []).entries()) {
    const packetPrefix = `${casePrefix}.packets[${packetIndex}]`
    for (const field of [
      'caseId',
      'agent',
      'claim',
      'sourceId',
      'sourceUrl',
      'sourceTitle',
      'vendor',
      'topic',
      'publishedOrFetchedAt',
      'excerpt',
      'chunkId',
      'evidenceDecision',
    ]) {
      assertNonEmptyString(packet[field], `${packetPrefix}.${field}`)
    }

    if (packet.caseId !== testCase.caseId) fail(`${packetPrefix}.caseId must match parent caseId`)
    if (!allowedAgents.has(packet.agent)) fail(`${packetPrefix}.agent is not allowed`)
    if (!allowedDecisions.has(packet.evidenceDecision)) fail(`${packetPrefix}.evidenceDecision is not allowed`)
    if ('answer' in packet || 'finalAnswer' in packet) fail(`${packetPrefix} must not contain final answer fields`)

    const score = Number(packet.retrievalScore)
    if (!Number.isFinite(score) || score < 0 || score > 1) fail(`${packetPrefix}.retrievalScore must be 0..1`)

    if (!Array.isArray(packet.reasons) || packet.reasons.length === 0) fail(`${packetPrefix}.reasons must be non-empty`)

    const searchableText = [
      packet.claim,
      packet.sourceId,
      packet.sourceUrl,
      packet.sourceTitle,
      packet.excerpt,
      packet.chunkId,
    ].join('\n')
    assertNoSensitiveText(searchableText, packetPrefix)

    caseAgents.add(packet.agent)
    if (packet.evidenceDecision === 'verified') {
      verifiedCount += 1
      if (!packet.reasons.includes('source_quality_complete')) {
        fail(`${packetPrefix} verified packet must include source_quality_complete`)
      }
      if (score < 0.72) fail(`${packetPrefix} verified packet score is too low`)
      if (packet.excerpt.length < 30) fail(`${packetPrefix}.excerpt is too short for verified evidence`)
    }
    if (packet.evidenceDecision === 'weak') weakCount += 1
    if (packet.reasons.includes('vendor_mismatch')) hasVendorConflict = true
    if (packet.reasons.includes('stale_source')) hasStaleSource = true
    if (packet.reasons.includes('placeholder_content')) {
      hasPlaceholderRejected = hasPlaceholderRejected || packet.evidenceDecision === 'rejected'
    }
  }

  if (!caseAgents.has('policy_evidence_agent') || !caseAgents.has('media_product_evidence_agent')) {
    fail(`${casePrefix} must include packets from both specialist agents`)
  }

  if (testCase.expectedOutcome === 'answer') {
    hasAnswerCase = true
    if (verifiedCount === 0) fail(`${casePrefix} answer case must include verified evidence`)
  }

  if (testCase.expectedOutcome === 'noDataFound' && verifiedCount === 0 && weakCount > 0) {
    hasWeakOnlyCase = true
  }

  const review = reviewOutcomeForCase(testCase.packets)
  if (review.outcome !== testCase.expectedOutcome) {
    fail(`${casePrefix}.expectedOutcome does not match Team Lead review outcome`)
  }
  if (review.verifiedCount !== Number(testCase.expectedVerifiedCount)) {
    fail(`${casePrefix}.expectedVerifiedCount does not match Team Lead verified packet count`)
  }
  if (typeof testCase.expectedDedupedPacketCount !== 'undefined') {
    if (review.dedupedCount !== Number(testCase.expectedDedupedPacketCount)) {
      fail(`${casePrefix}.expectedDedupedPacketCount does not match Team Lead deduped packet count`)
    }
  }
  if (review.dedupedCount < testCase.packets.length) {
    hasDedupedEvidence = true
  }
}

for (const requiredText of [
  'CompassEvidencePacket',
  'Team Lead Reviewer',
  'Policy Evidence Agent',
  'Media/Product Evidence Agent',
  'specialistAgentsWriteFinalAnswer: false',
  "canonicalAnswerRoute: '/api/compass-answer'",
  "legacyCompatibilityRoute: '/api/chat-ollama'",
  "legacyAnswerRoute: '/api/chatbot'",
  'reviewCompassEvidencePackets',
  'uniquePackets',
]) {
  if (!serviceText.includes(requiredText)) fail(`reviewer service missing ${requiredText}`)
}

for (const forbiddenText of ['fetch(', 'createClient', 'createCompassServiceClient', 'process.env', 'supabase']) {
  if (serviceText.includes(forbiddenText)) fail(`reviewer service must remain side-effect free and not include ${forbiddenText}`)
}

if (packageJson.scripts?.['check:compass-three-agent-reviewer-contract'] !== 'node scripts/check-compass-three-agent-reviewer-contract.mjs') {
  fail('package script check:compass-three-agent-reviewer-contract is missing or changed')
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-three-agent-reviewer-contract')) {
  fail('verify:harness must include check:compass-three-agent-reviewer-contract')
}

if (!hasAnswerCase) fail('missing answer fixture case')
if (!hasWeakOnlyCase) fail('missing weak-only noDataFound fixture case')
if (!hasVendorConflict) fail('missing vendor_mismatch rejection fixture')
if (!hasPlaceholderRejected) fail('missing rejected placeholder fixture')
if (!hasStaleSource) fail('missing stale_source fixture')
if (!hasDedupedEvidence) fail('missing duplicate evidence dedupe fixture')

if (!process.exitCode) console.log('[check-compass-three-agent-reviewer-contract] ok')
