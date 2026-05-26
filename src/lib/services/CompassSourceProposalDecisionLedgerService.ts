import {
  classifyCompassSourceProposalReviewDecisionSnapshotConflict,
  parseCompassSourceProposalReviewDecisionEnvelope,
  type CompassSourceProposalReviewDecision,
  type CompassSourceProposalReviewDecisionSnapshotConflictClassification,
} from './CompassSourceProposalReviewService';

export type CompassSourceProposalDecisionLedgerStatus =
  | 'accepted_current_snapshot'
  | 'duplicate_idempotent_replay'
  | 'snapshot_conflict'
  | 'idempotency_conflict'
  | 'malformed_decision_envelope'
  | 'unknown_proposal'
  | 'non_pending_proposal';

export interface CompassSourceProposalDecisionLedgerProposalSnapshot {
  proposalId: string;
  sourceId: string;
  currentReviewSnapshotHash: string;
  proposalStatus: string;
  reviewStatus: string;
  queueCandidateId?: string;
  runId?: string;
  sourceHost?: string;
}

export interface CompassSourceProposalDecisionLedgerInput {
  decisionEnvelope: unknown;
  proposalSnapshot?: unknown;
  priorDecisionEnvelope?: unknown;
}

export interface CompassSourceProposalDecisionLedgerResult {
  contract: 'compass-source-proposal-decision-ledger-v1';
  status: CompassSourceProposalDecisionLedgerStatus;
  mutationEnabled: false;
  llmUsed: false;
  noCorpusMutation: true;
  noApplyAction: true;
  ledger: {
    accepted: boolean;
    action: 'captured_for_later_apply_review' | 'replayed_existing_decision' | 'rejected_without_capture';
    persistence: 'disabled_contract_only';
    reviewDecisionCapturedForLaterApplyReviewOnly: boolean;
  };
  reason: string;
  decision?: 'approve' | 'reject';
  proposalId?: string;
  sourceId?: string;
  sourceHost?: string;
  queueCandidateId?: string;
  runId?: string;
  idempotencyKey?: string;
  decisionFingerprint?: string;
  expectedSnapshotHash?: string;
  currentReviewSnapshotHash?: string;
  proposalStatus?: string;
  reviewStatus?: string;
  approvalScope?: 'approved_for_later_apply_review_only';
}

export function classifyCompassSourceProposalDecisionLedger(
  input: CompassSourceProposalDecisionLedgerInput,
): CompassSourceProposalDecisionLedgerResult {
  const decisionEnvelope = parseCompassSourceProposalReviewDecisionEnvelope(input.decisionEnvelope);
  const proposalSnapshot = parseProposalSnapshot(input.proposalSnapshot);
  const priorDecisionEnvelope = input.priorDecisionEnvelope === undefined
    ? undefined
    : parseCompassSourceProposalReviewDecisionEnvelope(input.priorDecisionEnvelope);

  if (!decisionEnvelope || (input.priorDecisionEnvelope !== undefined && !priorDecisionEnvelope)) {
    return buildLedgerResult('malformed_decision_envelope', {
      reason: 'Decision envelope is malformed or does not match the proposal review decision contract.',
      currentReviewSnapshotHash: proposalSnapshot?.currentReviewSnapshotHash,
    });
  }

  const baseDetails = buildDecisionDetails(decisionEnvelope, proposalSnapshot);
  const snapshotClassification = classifySnapshot(decisionEnvelope, proposalSnapshot, priorDecisionEnvelope);

  if (snapshotClassification === 'idempotency_conflict') {
    return buildLedgerResult('idempotency_conflict', {
      ...baseDetails,
      reason: 'Idempotency key was already used for a different proposal decision payload.',
    });
  }

  if (snapshotClassification === 'duplicate_idempotent_replay') {
    return buildLedgerResult('duplicate_idempotent_replay', {
      ...baseDetails,
      reason: 'Exact idempotent replay detected; existing review decision remains captured for later apply review only.',
    });
  }

  if (!proposalSnapshot || proposalSnapshot.proposalId !== decisionEnvelope.audit.proposalId) {
    return buildLedgerResult('unknown_proposal', {
      ...baseDetails,
      reason: 'Decision references a proposal that is not present in the current proposal snapshot fixture.',
    });
  }

  if (proposalSnapshot.sourceId !== decisionEnvelope.audit.sourceId) {
    return buildLedgerResult('unknown_proposal', {
      ...baseDetails,
      reason: 'Decision source does not match the current proposal snapshot fixture.',
    });
  }

  if (proposalSnapshot.reviewStatus !== 'pending') {
    return buildLedgerResult('non_pending_proposal', {
      ...baseDetails,
      reason: 'Decision was not captured because the proposal is no longer pending.',
    });
  }

  if (snapshotClassification === 'snapshot_conflict') {
    return buildLedgerResult('snapshot_conflict', {
      ...baseDetails,
      reason: 'Decision was based on a stale review snapshot and must be reviewed again.',
    });
  }

  if (snapshotClassification === 'malformed_decision_envelope') {
    return buildLedgerResult('malformed_decision_envelope', {
      ...baseDetails,
      reason: 'Decision envelope is malformed or does not match the proposal review decision contract.',
    });
  }

  return buildLedgerResult('accepted_current_snapshot', {
    ...baseDetails,
    reason: decisionEnvelope.decision === 'approve'
      ? 'Approval review decision captured for later apply review only. No apply action was performed.'
      : 'Rejection review decision captured for later apply review only. No apply action was performed.',
  });
}

function classifySnapshot(
  decisionEnvelope: CompassSourceProposalReviewDecision,
  proposalSnapshot: CompassSourceProposalDecisionLedgerProposalSnapshot | undefined,
  priorDecisionEnvelope: CompassSourceProposalReviewDecision | undefined,
): CompassSourceProposalReviewDecisionSnapshotConflictClassification {
  return classifyCompassSourceProposalReviewDecisionSnapshotConflict({
    decisionEnvelope,
    currentReviewSnapshotHash: proposalSnapshot?.currentReviewSnapshotHash
      || decisionEnvelope.expectations.expectedSnapshotHash,
    ...(priorDecisionEnvelope ? { priorDecisionEnvelope } : {}),
  }).classification;
}

function buildDecisionDetails(
  decisionEnvelope: CompassSourceProposalReviewDecision,
  proposalSnapshot: CompassSourceProposalDecisionLedgerProposalSnapshot | undefined,
): Partial<CompassSourceProposalDecisionLedgerResult> {
  return {
    decision: decisionEnvelope.decision,
    proposalId: decisionEnvelope.audit.proposalId,
    sourceId: decisionEnvelope.audit.sourceId,
    sourceHost: decisionEnvelope.audit.sourceHost,
    queueCandidateId: proposalSnapshot?.queueCandidateId,
    runId: proposalSnapshot?.runId,
    idempotencyKey: decisionEnvelope.audit.idempotencyKey,
    decisionFingerprint: decisionEnvelope.audit.decisionFingerprint,
    expectedSnapshotHash: decisionEnvelope.expectations.expectedSnapshotHash,
    currentReviewSnapshotHash: proposalSnapshot?.currentReviewSnapshotHash,
    proposalStatus: proposalSnapshot?.proposalStatus,
    reviewStatus: proposalSnapshot?.reviewStatus,
    ...(decisionEnvelope.decision === 'approve'
      ? { approvalScope: 'approved_for_later_apply_review_only' as const }
      : {}),
  };
}

function buildLedgerResult(
  status: CompassSourceProposalDecisionLedgerStatus,
  details: Partial<CompassSourceProposalDecisionLedgerResult>,
): CompassSourceProposalDecisionLedgerResult {
  const accepted = status === 'accepted_current_snapshot' || status === 'duplicate_idempotent_replay';
  const action = status === 'accepted_current_snapshot'
    ? 'captured_for_later_apply_review'
    : status === 'duplicate_idempotent_replay'
      ? 'replayed_existing_decision'
      : 'rejected_without_capture';

  return {
    contract: 'compass-source-proposal-decision-ledger-v1',
    status,
    mutationEnabled: false,
    llmUsed: false,
    noCorpusMutation: true,
    noApplyAction: true,
    ledger: {
      accepted,
      action,
      persistence: 'disabled_contract_only',
      reviewDecisionCapturedForLaterApplyReviewOnly: accepted,
    },
    reason: details.reason || 'Decision ledger classified the review envelope without mutation.',
    ...details,
  };
}

function parseProposalSnapshot(
  value: unknown,
): CompassSourceProposalDecisionLedgerProposalSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const snapshot = value as Partial<CompassSourceProposalDecisionLedgerProposalSnapshot>;
  const proposalId = sanitizeSnapshotValue(snapshot.proposalId);
  const sourceId = sanitizeSnapshotValue(snapshot.sourceId);
  const currentReviewSnapshotHash = sanitizeSnapshotValue(snapshot.currentReviewSnapshotHash);
  const proposalStatus = sanitizeSnapshotValue(snapshot.proposalStatus);
  const reviewStatus = sanitizeSnapshotValue(snapshot.reviewStatus);

  if (!proposalId || !sourceId || !currentReviewSnapshotHash || !proposalStatus || !reviewStatus) {
    return undefined;
  }

  return {
    proposalId,
    sourceId,
    currentReviewSnapshotHash,
    proposalStatus,
    reviewStatus,
    queueCandidateId: sanitizeSnapshotValue(snapshot.queueCandidateId),
    runId: sanitizeSnapshotValue(snapshot.runId),
    sourceHost: sanitizeSnapshotValue(snapshot.sourceHost),
  };
}

function sanitizeSnapshotValue(value: unknown): string | undefined {
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
