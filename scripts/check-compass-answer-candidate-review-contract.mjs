#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const fixturePath = path.join(root, 'docs/rag/compass-answer-candidate-review-fixtures.json')
const servicePath = path.join(root, 'src/lib/services/CompassAnswerCandidateReviewService.ts')
const evidenceReviewerPath = path.join(root, 'src/lib/services/CompassEvidenceReviewerService.ts')
const packagePath = path.join(root, 'package.json')

const allowedAgents = new Set(['policy_evidence_agent', 'media_product_evidence_agent'])
const allowedDecisions = new Set(['verified', 'weak', 'rejected'])
const allowedOutcomes = new Set(['answer', 'noDataFound'])
const sensitivePattern = /\b(token|access_token|refresh_token|id_token|api[_-]?key|secret|password|cookie|session)\s*[:=]/i

function fail(message) {
  console.error(`[check-compass-answer-candidate-review-contract] ${message}`)
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

function findConflicts(packets) {
  const conflicts = new Set()
  for (const packet of packets) {
    for (const conflict of ['vendor_mismatch', 'stale_source', 'placeholder_content']) {
      if (packet.reasons.includes(conflict)) conflicts.add(conflict)
    }
  }
  return Array.from(conflicts)
}

function reviewEvidencePackets(packets) {
  const dedupedPackets = dedupePackets(packets)
  const verifiedPackets = dedupedPackets.filter(isVerifiedPacket)
  const conflicts = findConflicts(dedupedPackets)
  const reasons = []

  if (verifiedPackets.length === 0) reasons.push('no_verified_evidence')
  if (conflicts.length > 0) reasons.push('conflict_review_required')
  if (verifiedPackets.length > 0) reasons.push('verified_evidence_available')

  return {
    outcome: verifiedPackets.length > 0 && conflicts.length === 0 ? 'answer' : 'noDataFound',
    verifiedPackets,
    conflicts,
    reasons,
  }
}

function uniqueAnswerCandidates(candidates) {
  const seen = new Set()
  return candidates.filter((candidate) => {
    const key = [
      normalizeReviewKey(candidate.caseId),
      normalizeReviewKey(candidate.agent),
      normalizeReviewKey(candidate.candidateId),
      normalizeReviewKey(candidate.answerDraft),
    ].join('::')

    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isSupportedAnswerCandidate(candidate, verifiedChunkIds) {
  return Number(candidate.confidence) >= 0.64
    && candidate.answerDraft.trim().length >= 30
    && candidate.supportingChunkIds.length > 0
    && candidate.supportingChunkIds.every((chunkId) => verifiedChunkIds.has(chunkId))
}

function buildTeamLeadFinalAnswer(candidates, verifiedPackets) {
  const answerDrafts = candidates.map((candidate) => candidate.answerDraft.trim()).join(' ')
  const sourceTitles = Array.from(new Set(verifiedPackets.map((packet) => `${packet.vendor}: ${packet.sourceTitle}`)))
  return [
    '확인된 내부 근거 기준 답변입니다.',
    answerDrafts,
    `근거: ${sourceTitles.join(' / ')}`,
  ].join(' ')
}

function reviewAnswerCandidates(packets, candidates) {
  const evidenceReview = reviewEvidencePackets(packets)
  const uniqueCandidates = uniqueAnswerCandidates(candidates)
  const verifiedChunkIds = new Set(evidenceReview.verifiedPackets.map((packet) => packet.chunkId))
  const selectedCandidates = evidenceReview.outcome === 'answer'
    ? uniqueCandidates.filter((candidate) => isSupportedAnswerCandidate(candidate, verifiedChunkIds))
    : []
  const selectedCandidateIds = selectedCandidates.map((candidate) => candidate.candidateId)
  const rejectedCandidateIds = uniqueCandidates
    .filter((candidate) => !selectedCandidateIds.includes(candidate.candidateId))
    .map((candidate) => candidate.candidateId)
  const reasons = [...evidenceReview.reasons]

  if (uniqueCandidates.length === 0) reasons.push('no_answer_candidates')
  if (selectedCandidates.length === 0) reasons.push('no_supported_answer_candidate')
  if (rejectedCandidateIds.length > 0) reasons.push('answer_candidate_rejected')

  const outcome = evidenceReview.outcome === 'answer' && selectedCandidates.length > 0
    ? 'answer'
    : 'noDataFound'

  return {
    outcome,
    selectedCandidateIds,
    rejectedCandidateIds,
    verifiedSourceIds: evidenceReview.verifiedPackets.map((packet) => packet.sourceId),
    conflicts: evidenceReview.conflicts,
    reasons,
    finalAnswer: outcome === 'answer'
      ? buildTeamLeadFinalAnswer(selectedCandidates, evidenceReview.verifiedPackets)
      : null,
  }
}

for (const requiredPath of [fixturePath, servicePath, evidenceReviewerPath, packagePath]) {
  if (!fs.existsSync(requiredPath)) fail(`missing required file: ${path.relative(root, requiredPath)}`)
}

if (process.exitCode) process.exit()

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const serviceText = fs.readFileSync(servicePath, 'utf8')
const evidenceReviewerText = fs.readFileSync(evidenceReviewerPath, 'utf8')
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

if (fixture.fixturePack !== 'compass-answer-candidate-review-v1') {
  fail('fixturePack must be compass-answer-candidate-review-v1')
}
if (fixture.mode !== 'local_contract_only') fail('mode must be local_contract_only')
if (fixture.canonicalAnswerRoute !== '/api/chat-ollama') fail('canonicalAnswerRoute must be /api/chat-ollama')
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

for (const flag of [
  'specialistCandidatesAreDraftsOnly',
  'teamLeadOwnsFinalAnswer',
  'verifiedEvidenceRequired',
  'candidateEvidenceIdsMustMatchVerifiedPackets',
  'conflictReturnsNoData',
  'weakOnlyReturnsNoData',
  'noProviderSwitch',
]) {
  if (fixture.answerPolicy?.[flag] !== true) fail(`answerPolicy.${flag} must be true`)
}

if (!Array.isArray(fixture.cases) || fixture.cases.length < 4) {
  fail('cases must include answer, weak-only, conflict, and unsupported-candidate fixtures')
}

const requiredCaseIds = new Set([
  'meta-alcohol-answer-candidates-reviewed',
  'kakao-weak-candidates-no-data',
  'meta-vendor-conflict-candidate-rejected',
  'unsupported-candidate-chunk-rejected',
])
const seenCaseIds = new Set()
let hasAnswerCase = false
let hasWeakOnlyCase = false
let hasConflictCase = false
let hasUnsupportedCandidateCase = false

for (const [caseIndex, testCase] of fixture.cases.entries()) {
  const casePrefix = `cases[${caseIndex}]`
  assertNonEmptyString(testCase.caseId, `${casePrefix}.caseId`)
  assertNonEmptyString(testCase.question, `${casePrefix}.question`)
  seenCaseIds.add(testCase.caseId)

  if (!Array.isArray(testCase.packets) || testCase.packets.length < 2) {
    fail(`${casePrefix}.packets must include both specialist agents`)
  }
  if (!Array.isArray(testCase.candidates) || testCase.candidates.length < 2) {
    fail(`${casePrefix}.candidates must include both specialist agents`)
  }

  const packetAgents = new Set()
  for (const [packetIndex, packet] of testCase.packets.entries()) {
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
    const score = Number(packet.retrievalScore)
    if (!Number.isFinite(score) || score < 0 || score > 1) fail(`${packetPrefix}.retrievalScore must be 0..1`)
    if (!Array.isArray(packet.reasons) || packet.reasons.length === 0) fail(`${packetPrefix}.reasons must be non-empty`)
    assertNoSensitiveText([
      packet.claim,
      packet.sourceId,
      packet.sourceUrl,
      packet.sourceTitle,
      packet.excerpt,
      packet.chunkId,
    ].join('\n'), packetPrefix)
    packetAgents.add(packet.agent)
  }

  const candidateAgents = new Set()
  for (const [candidateIndex, candidate] of testCase.candidates.entries()) {
    const candidatePrefix = `${casePrefix}.candidates[${candidateIndex}]`
    for (const field of ['caseId', 'candidateId', 'agent', 'answerDraft']) {
      assertNonEmptyString(candidate[field], `${candidatePrefix}.${field}`)
    }
    if (candidate.caseId !== testCase.caseId) fail(`${candidatePrefix}.caseId must match parent caseId`)
    if (!allowedAgents.has(candidate.agent)) fail(`${candidatePrefix}.agent is not allowed`)
    if ('answer' in candidate || 'finalAnswer' in candidate) {
      fail(`${candidatePrefix} must not contain final answer fields`)
    }
    if ('sourceUrl' in candidate || 'sourceId' in candidate) {
      fail(`${candidatePrefix} must cite chunk ids instead of raw source identity fields`)
    }
    if (!Array.isArray(candidate.supportingChunkIds) || candidate.supportingChunkIds.length === 0) {
      fail(`${candidatePrefix}.supportingChunkIds must be non-empty`)
    }
    if (!Array.isArray(candidate.limitationNotes)) fail(`${candidatePrefix}.limitationNotes must be an array`)
    const confidence = Number(candidate.confidence)
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      fail(`${candidatePrefix}.confidence must be 0..1`)
    }
    assertNoSensitiveText([
      candidate.candidateId,
      candidate.answerDraft,
      ...candidate.supportingChunkIds,
      ...candidate.limitationNotes,
    ].join('\n'), candidatePrefix)
    candidateAgents.add(candidate.agent)
  }

  for (const agent of allowedAgents) {
    if (!packetAgents.has(agent)) fail(`${casePrefix}.packets must include ${agent}`)
    if (!candidateAgents.has(agent)) fail(`${casePrefix}.candidates must include ${agent}`)
  }

  const expectedReview = testCase.expectedReview || {}
  if (!allowedOutcomes.has(expectedReview.outcome)) fail(`${casePrefix}.expectedReview.outcome is not allowed`)

  const review = reviewAnswerCandidates(testCase.packets, testCase.candidates)
  if (review.outcome !== expectedReview.outcome) {
    fail(`${casePrefix}.expectedReview.outcome does not match Team Lead answer review`)
  }
  if (review.selectedCandidateIds.length !== Number(expectedReview.selectedCandidateCount)) {
    fail(`${casePrefix}.expectedReview.selectedCandidateCount does not match review`)
  }
  if (review.rejectedCandidateIds.length !== Number(expectedReview.rejectedCandidateCount)) {
    fail(`${casePrefix}.expectedReview.rejectedCandidateCount does not match review`)
  }

  const expectedSourceIds = expectedReview.verifiedSourceIds || []
  if (JSON.stringify(review.verifiedSourceIds) !== JSON.stringify(expectedSourceIds)) {
    fail(`${casePrefix}.expectedReview.verifiedSourceIds does not match review`)
  }

  for (const expectedConflict of expectedReview.conflicts || []) {
    if (!review.conflicts.includes(expectedConflict)) {
      fail(`${casePrefix}.expectedReview.conflicts missing ${expectedConflict}`)
    }
  }

  for (const expectedReason of expectedReview.requiredReasons || []) {
    if (!review.reasons.includes(expectedReason)) {
      fail(`${casePrefix}.expectedReview.requiredReasons missing ${expectedReason}`)
    }
  }

  for (const expectedText of expectedReview.finalAnswerIncludes || []) {
    if (!review.finalAnswer?.includes(expectedText)) {
      fail(`${casePrefix}.expectedReview.finalAnswerIncludes missing ${expectedText}`)
    }
  }

  if (review.outcome === 'answer') hasAnswerCase = true
  if (testCase.caseId.includes('weak')) hasWeakOnlyCase = review.outcome === 'noDataFound' || hasWeakOnlyCase
  if (review.conflicts.length > 0) hasConflictCase = true
  if (testCase.caseId.includes('unsupported')) {
    hasUnsupportedCandidateCase = review.rejectedCandidateIds.length === testCase.candidates.length
  }
}

for (const caseId of requiredCaseIds) {
  if (!seenCaseIds.has(caseId)) fail(`missing required fixture case: ${caseId}`)
}

for (const requiredText of [
  'CompassAnswerCandidate',
  'CompassTeamLeadAnswerReview',
  'COMPASS_ANSWER_CANDIDATE_REVIEW_POLICY',
  'specialistCandidatesAreDraftsOnly: true',
  'teamLeadOwnsFinalAnswer: true',
  'candidateEvidenceIdsMustMatchVerifiedPackets: true',
  'noProviderSwitch: true',
  'reviewCompassAnswerCandidates',
  'reviewCompassEvidencePackets',
  'supportedCandidates',
  'finalAnswer',
]) {
  if (!serviceText.includes(requiredText)) fail(`answer candidate review service missing ${requiredText}`)
}

if (!evidenceReviewerText.includes('reviewCompassEvidencePackets')) {
  fail('evidence reviewer service must remain the upstream evidence gate')
}

for (const forbiddenText of ['fetch(', 'createClient', 'createCompassServiceClient', 'process.env', 'supabase']) {
  if (serviceText.includes(forbiddenText)) {
    fail(`answer candidate review service must remain side-effect free and not include ${forbiddenText}`)
  }
}

if (packageJson.scripts?.['check:compass-answer-candidate-review-contract'] !== 'node scripts/check-compass-answer-candidate-review-contract.mjs') {
  fail('package script check:compass-answer-candidate-review-contract is missing or changed')
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-answer-candidate-review-contract')) {
  fail('verify:harness must include check:compass-answer-candidate-review-contract')
}

if (!hasAnswerCase) fail('missing answer candidate fixture')
if (!hasWeakOnlyCase) fail('missing weak-only noDataFound candidate fixture')
if (!hasConflictCase) fail('missing conflict noDataFound candidate fixture')
if (!hasUnsupportedCandidateCase) fail('missing unsupported-candidate rejection fixture')

if (!process.exitCode) console.log('[check-compass-answer-candidate-review-contract] ok')
