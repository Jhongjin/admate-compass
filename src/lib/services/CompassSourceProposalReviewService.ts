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

export type CompassSourceProposalRejectionReasonCode =
  | 'duplicate_coverage'
  | 'source_blocked'
  | 'low_policy_signal'
  | 'fetch_unavailable'
  | 'out_of_scope'
  | 'superseded_source';

export interface CompassSourceProposalRejectionActorInput {
  actorType: CompassSourceProposalRejectionActorType;
  actorId: string;
  displayName?: string;
}

export interface CompassSourceProposalRejectionReasonInput {
  code: CompassSourceProposalRejectionReasonCode;
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

export interface CompassSourceProposalRejectionDecision {
  contract: 'compass-source-proposal-rejection-decision-v1';
  decision: 'reject';
  mutationEnabled: false;
  llmUsed: false;
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
  const proposalId = sanitizeAuditValue(input.proposalId, 'proposalId');
  const actorId = sanitizeAuditValue(input.actor.actorId, 'actorId');
  const displayName = sanitizeOptionalAuditValue(input.actor.displayName);
  const reasonSummary = sanitizeAuditValue(input.reason.summary, 'reason.summary');
  const reviewSnapshotHash = sanitizeAuditValue(input.reviewSnapshotHash, 'reviewSnapshotHash');
  const idempotencyKey = sanitizeAuditValue(input.idempotencyKey, 'idempotencyKey');
  const decidedAt = normalizeIsoTimestamp(input.decidedAt);
  const sourceHost = getSourceHost(input.source.url);

  if (input.actor.actorType !== 'admin' && input.actor.actorType !== 'internal_worker') {
    throw new Error('Rejection decision actorType must be admin or internal_worker.');
  }

  if (!isKnownRejectionReasonCode(input.reason.code)) {
    throw new Error('Rejection decision reason code is not allowlisted.');
  }

  const decisionFingerprint = stableDecisionFingerprint([
    'reject',
    proposalId,
    input.source.id,
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
      sourceId: sanitizeAuditValue(input.source.id, 'source.id'),
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

function sanitizeAuditValue(value: string, fieldName: string): string {
  const sanitized = sanitizeOptionalAuditValue(value);
  if (!sanitized) {
    throw new Error(`Rejection decision ${fieldName} is required.`);
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

function normalizeIsoTimestamp(value: string): string {
  const sanitized = sanitizeAuditValue(value, 'decidedAt');
  const date = new Date(sanitized);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Rejection decision decidedAt must be an ISO timestamp.');
  }

  return date.toISOString();
}

function getSourceHost(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).host.toLowerCase();
  } catch {
    throw new Error('Rejection decision source.url must be a valid URL.');
  }
}

function stableDecisionFingerprint(parts: string[]): string {
  let hash = 2166136261;
  const input = parts.join('\u001f');

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `reject_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
