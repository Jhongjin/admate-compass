import type { CompassPolicySource, CompassSourceOpsItem } from './CompassSourceOpsService';

type ProposalStatus = 'candidate_ready' | 'fetch_disabled' | 'fetch_failed' | 'blocked';

export interface CompassSourceProposalReviewInput {
  source: CompassPolicySource;
  status: ProposalStatus;
  sourceStatus?: CompassSourceOpsItem['status'];
  allowedHost: boolean;
  headingCount: number;
  contentLength?: number;
}

export interface CompassSourceProposalReview {
  classifier: 'deterministic-policy-review-v1';
  llmUsed: false;
  relevanceLevel: 'high' | 'medium' | 'low' | 'blocked';
  relevanceScore: number;
  signals: string[];
  diffSummary: string;
  recommendation: string;
  needsHumanReview: true;
  mutationEnabled: false;
}

export type CompassSourceProposalRejectionActorType = 'admin' | 'internal_worker';
export type CompassSourceProposalApprovalActorType = 'admin' | 'internal_worker';

export type CompassSourceProposalRejectionReasonCode =
  | 'duplicate_coverage'
  | 'source_blocked'
  | 'low_policy_signal'
  | 'fetch_unavailable'
  | 'out_of_scope'
  | 'superseded_source';

export type CompassSourceProposalApprovalReasonCode =
  | 'official_policy_source'
  | 'fills_policy_gap'
  | 'stale_source_refresh'
  | 'high_confidence_candidate'
  | 'manual_review_passed';

export interface CompassSourceProposalRejectionActorInput {
  actorType: CompassSourceProposalRejectionActorType;
  actorId: string;
  displayName?: string;
}

export interface CompassSourceProposalApprovalActorInput {
  actorType: CompassSourceProposalApprovalActorType;
  actorId: string;
  displayName?: string;
}

export interface CompassSourceProposalRejectionReasonInput {
  code: CompassSourceProposalRejectionReasonCode;
  summary: string;
}

export interface CompassSourceProposalApprovalReasonInput {
  code: CompassSourceProposalApprovalReasonCode;
  summary: string;
}

export interface CompassSourceProposalRejectionDecisionInput {
  proposalId: string;
  source: CompassPolicySource;
  actor: CompassSourceProposalRejectionActorInput;
  reason: CompassSourceProposalRejectionReasonInput;
  decidedAt: string;
  reviewSnapshotHash: string;
  idempotencyKey: string;
}

export interface CompassSourceProposalApprovalDecisionInput {
  proposalId: string;
  source: CompassPolicySource;
  actor: CompassSourceProposalApprovalActorInput;
  reason: CompassSourceProposalApprovalReasonInput;
  decidedAt: string;
  reviewSnapshotHash: string;
  idempotencyKey: string;
}

export interface CompassSourceProposalRejectionDecision {
  contract: 'compass-source-proposal-rejection-decision-v1';
  decision: 'reject';
  mutationEnabled: false;
  llmUsed: false;
  noCorpusMutation: true;
  noApplyAction: true;
  actor: {
    actorType: CompassSourceProposalRejectionActorType;
    actorId: string;
    displayName?: string;
  };
  reason: {
    code: CompassSourceProposalRejectionReasonCode;
    summary: string;
  };
  audit: {
    proposalId: string;
    sourceId: string;
    sourceHost: string;
    decidedAt: string;
    reviewSnapshotHash: string;
    idempotencyKey: string;
    decisionFingerprint: string;
  };
  expectations: {
    requiresCurrentSnapshot: true;
    expectedSnapshotHash: string;
    idempotentBy: ['proposalId', 'decision', 'idempotencyKey'];
    noCorpusMutation: true;
    noApplyAction: true;
  };
}

export interface CompassSourceProposalApprovalDecision {
  contract: 'compass-source-proposal-approval-decision-v1';
  decision: 'approve';
  mutationEnabled: false;
  llmUsed: false;
  noCorpusMutation: true;
  noApplyAction: true;
  actor: {
    actorType: CompassSourceProposalApprovalActorType;
    actorId: string;
    displayName?: string;
  };
  reason: {
    code: CompassSourceProposalApprovalReasonCode;
    summary: string;
  };
  audit: {
    proposalId: string;
    sourceId: string;
    sourceHost: string;
    decidedAt: string;
    reviewSnapshotHash: string;
    idempotencyKey: string;
    decisionFingerprint: string;
  };
  expectations: {
    requiresCurrentSnapshot: true;
    expectedSnapshotHash: string;
    idempotentBy: ['proposalId', 'decision', 'idempotencyKey'];
    noCorpusMutation: true;
    noApplyAction: true;
    approvedForApplyReviewOnly: true;
  };
}

export type CompassSourceProposalReviewDecision =
  | CompassSourceProposalRejectionDecision
  | CompassSourceProposalApprovalDecision;

export type CompassSourceProposalReviewDecisionSnapshotConflictClassification =
  | 'accepted_current_snapshot'
  | 'duplicate_idempotent_replay'
  | 'snapshot_conflict'
  | 'idempotency_conflict'
  | 'malformed_decision_envelope';

export interface CompassSourceProposalReviewDecisionSnapshotConflictInput {
  decisionEnvelope: unknown;
  currentReviewSnapshotHash: string;
  priorDecisionEnvelope?: unknown;
}

export interface CompassSourceProposalReviewDecisionSnapshotConflictResult {
  contract: 'compass-source-proposal-review-decision-snapshot-conflict-contract-v1';
  classification: CompassSourceProposalReviewDecisionSnapshotConflictClassification;
  mutationEnabled: false;
  llmUsed: false;
  noCorpusMutation: true;
  noApplyAction: true;
  decision?: 'approve' | 'reject';
  proposalId?: string;
  sourceId?: string;
  idempotencyKey?: string;
  expectedSnapshotHash?: string;
  currentReviewSnapshotHash?: string;
}

export function reviewCompassSourceProposalCandidate(
  input: CompassSourceProposalReviewInput,
): CompassSourceProposalReview {
  const signals: string[] = [];

  if (!input.allowedHost || input.status === 'blocked') {
    return buildReview({
      relevanceScore: 0,
      relevanceLevel: 'blocked',
      signals: ['host_not_allowlisted'],
      diffSummary: 'Candidate is blocked because the source host is not in the Compass policy allowlist.',
      recommendation: 'Reject this candidate unless the official source registry is updated through a separate review.',
    });
  }

  signals.push('official_host_allowlisted');
  signals.push(`${input.source.vendor.toLowerCase()}_source`);
  signals.push(`${input.source.sourceType}_source`);
  signals.push(input.source.discoveryMode);

  let relevanceScore = input.source.priority === 'core' ? 55 : 42;

  if (input.source.sourceType === 'policy') relevanceScore += 18;
  if (input.source.sourceType === 'help') relevanceScore += 10;
  if (input.source.discoveryMode === 'exact_url') relevanceScore += 10;
  if (input.status === 'candidate_ready') relevanceScore += 8;
  if (input.status === 'fetch_failed') relevanceScore -= 12;
  if (input.headingCount > 0) relevanceScore += 5;
  if ((input.contentLength || 0) > 500) relevanceScore += 5;

  if (input.sourceStatus === 'candidate_only') {
    relevanceScore += 10;
    signals.push('corpus_gap');
  } else if (input.sourceStatus === 'stale') {
    relevanceScore += 8;
    signals.push('stale_corpus_match');
  } else if (input.sourceStatus === 'unavailable') {
    relevanceScore += 4;
    signals.push('unindexed_match');
  } else if (input.sourceStatus === 'indexed') {
    relevanceScore -= 8;
    signals.push('existing_indexed_coverage');
  }

  relevanceScore = Math.max(0, Math.min(100, relevanceScore));
  const relevanceLevel = scoreToLevel(relevanceScore);

  return buildReview({
    relevanceScore,
    relevanceLevel,
    signals,
    diffSummary: buildDiffSummary(input),
    recommendation: buildRecommendation(input, relevanceLevel),
  });
}

export function buildCompassSourceProposalRejectionDecision(
  input: CompassSourceProposalRejectionDecisionInput,
): CompassSourceProposalRejectionDecision {
  const proposalId = sanitizeAuditValue(input.proposalId, 'proposalId', 'Rejection decision');
  const actorId = sanitizeAuditValue(input.actor.actorId, 'actorId', 'Rejection decision');
  const displayName = sanitizeOptionalAuditValue(input.actor.displayName);
  const reasonSummary = sanitizeAuditValue(input.reason.summary, 'reason.summary', 'Rejection decision');
  const reviewSnapshotHash = sanitizeAuditValue(input.reviewSnapshotHash, 'reviewSnapshotHash', 'Rejection decision');
  const idempotencyKey = sanitizeAuditValue(input.idempotencyKey, 'idempotencyKey', 'Rejection decision');
  const decidedAt = normalizeIsoTimestamp(input.decidedAt, 'Rejection decision');
  const sourceId = sanitizeAuditValue(input.source.id, 'source.id', 'Rejection decision');
  const sourceHost = getSourceHost(input.source.url, 'Rejection decision');

  if (input.actor.actorType !== 'admin' && input.actor.actorType !== 'internal_worker') {
    throw new Error('Rejection decision actorType must be admin or internal_worker.');
  }

  if (!isKnownRejectionReasonCode(input.reason.code)) {
    throw new Error('Rejection decision reason code is not allowlisted.');
  }

  const decisionFingerprint = stableDecisionFingerprint('reject', [
    'reject',
    proposalId,
    sourceId,
    input.actor.actorType,
    actorId,
    input.reason.code,
    reasonSummary,
    decidedAt,
    reviewSnapshotHash,
    idempotencyKey,
  ]);

  return {
    contract: 'compass-source-proposal-rejection-decision-v1',
    decision: 'reject',
    mutationEnabled: false,
    llmUsed: false,
    noCorpusMutation: true,
    noApplyAction: true,
    actor: {
      actorType: input.actor.actorType,
      actorId,
      ...(displayName ? { displayName } : {}),
    },
    reason: {
      code: input.reason.code,
      summary: reasonSummary,
    },
    audit: {
      proposalId,
      sourceId,
      sourceHost,
      decidedAt,
      reviewSnapshotHash,
      idempotencyKey,
      decisionFingerprint,
    },
    expectations: {
      requiresCurrentSnapshot: true,
      expectedSnapshotHash: reviewSnapshotHash,
      idempotentBy: ['proposalId', 'decision', 'idempotencyKey'],
      noCorpusMutation: true,
      noApplyAction: true,
    },
  };
}

export function classifyCompassSourceProposalReviewDecisionSnapshotConflict(
  input: CompassSourceProposalReviewDecisionSnapshotConflictInput,
): CompassSourceProposalReviewDecisionSnapshotConflictResult {
  const currentReviewSnapshotHash = sanitizeOptionalAuditValue(input.currentReviewSnapshotHash);
  const decisionEnvelope = parseCompassSourceProposalReviewDecisionEnvelope(input.decisionEnvelope);

  if (!currentReviewSnapshotHash || !decisionEnvelope) {
    return buildSnapshotConflictResult('malformed_decision_envelope', {
      currentReviewSnapshotHash,
    });
  }

  const baseResult = {
    decision: decisionEnvelope.decision,
    proposalId: decisionEnvelope.audit.proposalId,
    sourceId: decisionEnvelope.audit.sourceId,
    idempotencyKey: decisionEnvelope.audit.idempotencyKey,
    expectedSnapshotHash: decisionEnvelope.expectations.expectedSnapshotHash,
    currentReviewSnapshotHash,
  };

  const priorDecisionEnvelope = parseCompassSourceProposalReviewDecisionEnvelope(input.priorDecisionEnvelope);

  if (input.priorDecisionEnvelope !== undefined && !priorDecisionEnvelope) {
    return buildSnapshotConflictResult('malformed_decision_envelope', baseResult);
  }

  if (priorDecisionEnvelope && hasIdempotencyKeyReuseConflict(decisionEnvelope, priorDecisionEnvelope)) {
    return buildSnapshotConflictResult('idempotency_conflict', baseResult);
  }

  if (priorDecisionEnvelope && areSameDecisionReplay(decisionEnvelope, priorDecisionEnvelope)) {
    return buildSnapshotConflictResult('duplicate_idempotent_replay', baseResult);
  }

  if (decisionEnvelope.expectations.expectedSnapshotHash !== currentReviewSnapshotHash) {
    return buildSnapshotConflictResult('snapshot_conflict', baseResult);
  }

  return buildSnapshotConflictResult('accepted_current_snapshot', baseResult);
}

export function buildCompassSourceProposalApprovalDecision(
  input: CompassSourceProposalApprovalDecisionInput,
): CompassSourceProposalApprovalDecision {
  const proposalId = sanitizeAuditValue(input.proposalId, 'proposalId', 'Approval decision');
  const actorId = sanitizeAuditValue(input.actor.actorId, 'actorId', 'Approval decision');
  const displayName = sanitizeOptionalAuditValue(input.actor.displayName);
  const reasonSummary = sanitizeAuditValue(input.reason.summary, 'reason.summary', 'Approval decision');
  const reviewSnapshotHash = sanitizeAuditValue(input.reviewSnapshotHash, 'reviewSnapshotHash', 'Approval decision');
  const idempotencyKey = sanitizeAuditValue(input.idempotencyKey, 'idempotencyKey', 'Approval decision');
  const decidedAt = normalizeIsoTimestamp(input.decidedAt, 'Approval decision');
  const sourceId = sanitizeAuditValue(input.source.id, 'source.id', 'Approval decision');
  const sourceHost = getSourceHost(input.source.url, 'Approval decision');

  if (input.actor.actorType !== 'admin' && input.actor.actorType !== 'internal_worker') {
    throw new Error('Approval decision actorType must be admin or internal_worker.');
  }

  if (!isKnownApprovalReasonCode(input.reason.code)) {
    throw new Error('Approval decision reason code is not allowlisted.');
  }

  const decisionFingerprint = stableDecisionFingerprint('approve', [
    'approve',
    proposalId,
    sourceId,
    input.actor.actorType,
    actorId,
    input.reason.code,
    reasonSummary,
    decidedAt,
    reviewSnapshotHash,
    idempotencyKey,
  ]);

  return {
    contract: 'compass-source-proposal-approval-decision-v1',
    decision: 'approve',
    mutationEnabled: false,
    llmUsed: false,
    noCorpusMutation: true,
    noApplyAction: true,
    actor: {
      actorType: input.actor.actorType,
      actorId,
      ...(displayName ? { displayName } : {}),
    },
    reason: {
      code: input.reason.code,
      summary: reasonSummary,
    },
    audit: {
      proposalId,
      sourceId,
      sourceHost,
      decidedAt,
      reviewSnapshotHash,
      idempotencyKey,
      decisionFingerprint,
    },
    expectations: {
      requiresCurrentSnapshot: true,
      expectedSnapshotHash: reviewSnapshotHash,
      idempotentBy: ['proposalId', 'decision', 'idempotencyKey'],
      noCorpusMutation: true,
      noApplyAction: true,
      approvedForApplyReviewOnly: true,
    },
  };
}

export function parseCompassSourceProposalReviewDecisionEnvelope(
  value: unknown,
): CompassSourceProposalReviewDecision | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const envelope = value as Partial<CompassSourceProposalReviewDecision>;
  const audit = envelope.audit;
  const expectations = envelope.expectations;

  if (
    envelope.mutationEnabled !== false
    || envelope.llmUsed !== false
    || envelope.noCorpusMutation !== true
    || envelope.noApplyAction !== true
  ) {
    return undefined;
  }
  if (envelope.decision !== 'reject' && envelope.decision !== 'approve') return undefined;
  if (envelope.decision === 'reject' && envelope.contract !== 'compass-source-proposal-rejection-decision-v1') {
    return undefined;
  }
  if (envelope.decision === 'approve' && envelope.contract !== 'compass-source-proposal-approval-decision-v1') {
    return undefined;
  }
  if (!audit || typeof audit !== 'object' || !expectations || typeof expectations !== 'object') return undefined;
  if (
    !isNonEmptyString(audit.proposalId)
    || !isNonEmptyString(audit.sourceId)
    || !isNonEmptyString(audit.sourceHost)
    || !isNonEmptyString(audit.decidedAt)
    || !isNonEmptyString(audit.reviewSnapshotHash)
    || !isNonEmptyString(audit.idempotencyKey)
    || !isNonEmptyString(audit.decisionFingerprint)
  ) {
    return undefined;
  }
  if (!isDecisionFingerprintForDecision(envelope.decision, audit.decisionFingerprint)) return undefined;
  if (expectations.requiresCurrentSnapshot !== true) return undefined;
  if (expectations.expectedSnapshotHash !== audit.reviewSnapshotHash) return undefined;
  if (!Array.isArray(expectations.idempotentBy)) return undefined;
  if (expectations.idempotentBy.join('\u001f') !== 'proposalId\u001fdecision\u001fidempotencyKey') return undefined;
  if (expectations.noCorpusMutation !== true || expectations.noApplyAction !== true) return undefined;
  const approvalExpectation = expectations as { approvedForApplyReviewOnly?: unknown };
  if (envelope.decision === 'approve' && approvalExpectation.approvedForApplyReviewOnly !== true) return undefined;
  if (envelope.decision === 'reject' && 'approvedForApplyReviewOnly' in approvalExpectation) return undefined;

  return envelope as CompassSourceProposalReviewDecision;
}

function buildSnapshotConflictResult(
  classification: CompassSourceProposalReviewDecisionSnapshotConflictClassification,
  details: Partial<CompassSourceProposalReviewDecisionSnapshotConflictResult> = {},
): CompassSourceProposalReviewDecisionSnapshotConflictResult {
  return {
    contract: 'compass-source-proposal-review-decision-snapshot-conflict-contract-v1',
    classification,
    mutationEnabled: false,
    llmUsed: false,
    noCorpusMutation: true,
    noApplyAction: true,
    ...details,
  };
}

function hasIdempotencyKeyReuseConflict(
  decisionEnvelope: CompassSourceProposalReviewDecision,
  priorDecisionEnvelope: CompassSourceProposalReviewDecision,
): boolean {
  if (decisionEnvelope.audit.idempotencyKey !== priorDecisionEnvelope.audit.idempotencyKey) return false;

  return (
    decisionEnvelope.audit.proposalId !== priorDecisionEnvelope.audit.proposalId
    || decisionEnvelope.audit.sourceId !== priorDecisionEnvelope.audit.sourceId
    || decisionEnvelope.decision !== priorDecisionEnvelope.decision
    || decisionEnvelope.audit.decisionFingerprint !== priorDecisionEnvelope.audit.decisionFingerprint
  );
}

function areSameDecisionReplay(
  decisionEnvelope: CompassSourceProposalReviewDecision,
  priorDecisionEnvelope: CompassSourceProposalReviewDecision,
): boolean {
  return (
    decisionEnvelope.audit.idempotencyKey === priorDecisionEnvelope.audit.idempotencyKey
    && decisionEnvelope.audit.proposalId === priorDecisionEnvelope.audit.proposalId
    && decisionEnvelope.audit.sourceId === priorDecisionEnvelope.audit.sourceId
    && decisionEnvelope.decision === priorDecisionEnvelope.decision
    && decisionEnvelope.audit.decisionFingerprint === priorDecisionEnvelope.audit.decisionFingerprint
  );
}

function scoreToLevel(score: number): CompassSourceProposalReview['relevanceLevel'] {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function buildDiffSummary(input: CompassSourceProposalReviewInput): string {
  if (input.sourceStatus === 'candidate_only') {
    return 'No indexed corpus match is visible for this source. Treat it as a new source coverage candidate.';
  }

  if (input.sourceStatus === 'stale') {
    return 'The corpus has a matching source, but it is older than the recommended refresh cadence.';
  }

  if (input.sourceStatus === 'unavailable') {
    return 'A matching document exists, but it is not indexed. Review extraction and chunking before promotion.';
  }

  if (input.sourceStatus === 'indexed') {
    return 'The corpus already has indexed coverage. Keep this source on watch and compare future snapshots for changes.';
  }

  return 'Source state is unknown. Keep this candidate in review until source coverage is confirmed.';
}

function buildRecommendation(
  input: CompassSourceProposalReviewInput,
  relevanceLevel: CompassSourceProposalReview['relevanceLevel'],
): string {
  if (input.status === 'fetch_failed') {
    return 'Retry preview extraction later or inspect source access rules before queueing for review.';
  }

  if (relevanceLevel === 'high') {
    return 'Prioritize this candidate for backend extraction proposal review. Do not promote it without approval.';
  }

  if (relevanceLevel === 'medium') {
    return 'Keep this candidate in the proposal queue and compare it against existing indexed coverage.';
  }

  return 'Defer this candidate unless a user question or policy gap requires it.';
}

function buildReview(
  review: Omit<CompassSourceProposalReview, 'classifier' | 'llmUsed' | 'needsHumanReview' | 'mutationEnabled'>,
): CompassSourceProposalReview {
  return {
    classifier: 'deterministic-policy-review-v1',
    llmUsed: false,
    needsHumanReview: true,
    mutationEnabled: false,
    ...review,
  };
}

function isKnownRejectionReasonCode(value: string): value is CompassSourceProposalRejectionReasonCode {
  return [
    'duplicate_coverage',
    'source_blocked',
    'low_policy_signal',
    'fetch_unavailable',
    'out_of_scope',
    'superseded_source',
  ].includes(value);
}

function isKnownApprovalReasonCode(value: string): value is CompassSourceProposalApprovalReasonCode {
  return [
    'official_policy_source',
    'fills_policy_gap',
    'stale_source_refresh',
    'high_confidence_candidate',
    'manual_review_passed',
  ].includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDecisionFingerprintForDecision(decision: 'approve' | 'reject', value: string): boolean {
  return decision === 'approve'
    ? /^approve_[0-9a-f]{8}$/.test(value)
    : /^reject_[0-9a-f]{8}$/.test(value);
}

function sanitizeAuditValue(value: string, fieldName: string, context: string): string {
  const sanitized = sanitizeOptionalAuditValue(value);
  if (!sanitized) {
    throw new Error(`${context} ${fieldName} is required.`);
  }
  return sanitized;
}

function sanitizeOptionalAuditValue(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined;

  const sanitized = value
    .trim()
    .replace(/\bbearer\s+[^\s,;]+/gi, '[redacted]')
    .replace(/(?:bearer|token|secret|apikey|api_key|password)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/g, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{12,}/gi, '[redacted]')
    .slice(0, 240);

  return sanitized || undefined;
}

function normalizeIsoTimestamp(value: string, context: string): string {
  const sanitized = sanitizeAuditValue(value, 'decidedAt', context);
  const date = new Date(sanitized);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${context} decidedAt must be an ISO timestamp.`);
  }

  return date.toISOString();
}

function getSourceHost(sourceUrl: string, context: string): string {
  try {
    return new URL(sourceUrl).host.toLowerCase();
  } catch {
    throw new Error(`${context} source.url must be a valid URL.`);
  }
}

function stableDecisionFingerprint(prefix: 'reject' | 'approve', parts: string[]): string {
  let hash = 2166136261;
  const input = parts.join('\u001f');

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
