export const COMPASS_SENTINEL_EVIDENCE_MANIFEST_CONTRACT_VERSION =
  'compass-sentinel-evidence-manifest-v1';

export type CompassSentinelEvidenceStatus =
  | 'verified_evidence_present'
  | 'weak_or_missing_evidence'
  | 'conflict_or_unsafe_evidence';

export type CompassSentinelReviewStatus =
  | 'accepted'
  | 'review_needed'
  | 'blocked';

export type CompassSentinelAnswerDisposition =
  | 'answer_ready'
  | 'no_data_found';

export type CompassSentinelEvidenceCounts = {
  verified: number;
  weak: number;
  rejected: number;
};

export type CompassSentinelCandidateDraftCounts = {
  total: number;
  selected: number;
  rejected: number;
};

export type CompassSentinelEvidenceManifestSafetyFlags = {
  localOnly: true;
  sanitizedOnly: true;
  reportOnly: true;
  noDbRead: true;
  noDbWrite: true;
  noProviderCall: true;
  noAuthHandoff: true;
  noSentinelIngestCall: true;
  noStorageAccess: true;
  noPersistence: true;
  noApplyOrPromote: true;
  noLiveIngest: true;
};

export type CompassSentinelEvidenceManifest = {
  contractVersion: typeof COMPASS_SENTINEL_EVIDENCE_MANIFEST_CONTRACT_VERSION;
  evidenceStatus: CompassSentinelEvidenceStatus;
  reviewStatus: CompassSentinelReviewStatus;
  answerDisposition: CompassSentinelAnswerDisposition;
  evidenceCounts: CompassSentinelEvidenceCounts;
  candidateDraftCounts: CompassSentinelCandidateDraftCounts;
  reasonCodes: string[];
  operatorSafeSummary: string;
  flags: CompassSentinelEvidenceManifestSafetyFlags;
};

export const COMPASS_SENTINEL_EVIDENCE_REQUIRED_FLAGS: CompassSentinelEvidenceManifestSafetyFlags = {
  localOnly: true,
  sanitizedOnly: true,
  reportOnly: true,
  noDbRead: true,
  noDbWrite: true,
  noProviderCall: true,
  noAuthHandoff: true,
  noSentinelIngestCall: true,
  noStorageAccess: true,
  noPersistence: true,
  noApplyOrPromote: true,
  noLiveIngest: true,
};

export type CompassSentinelEvidenceDecision = keyof CompassSentinelEvidenceCounts;
export type CompassSentinelCandidateDraftDecision = 'selected' | 'rejected';

export type CompassSentinelEvidenceObservation = {
  decision: CompassSentinelEvidenceDecision;
  reasonCodes: string[];
};

export type CompassSentinelCandidateDraftObservation = {
  decision: CompassSentinelCandidateDraftDecision;
  reasonCodes: string[];
};

const allowedEvidenceStatuses = new Set<CompassSentinelEvidenceStatus>([
  'verified_evidence_present',
  'weak_or_missing_evidence',
  'conflict_or_unsafe_evidence',
]);

const allowedReviewStatuses = new Set<CompassSentinelReviewStatus>([
  'accepted',
  'review_needed',
  'blocked',
]);

const allowedAnswerDispositions = new Set<CompassSentinelAnswerDisposition>([
  'answer_ready',
  'no_data_found',
]);

const requiredSafetyFlagKeys = [
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
] as const;

const requiredSafetyFlagKeySet = new Set<string>(requiredSafetyFlagKeys);

export function buildCompassSentinelEvidenceManifest(
  manifest: Omit<CompassSentinelEvidenceManifest, 'contractVersion' | 'flags'> & {
    flags?: CompassSentinelEvidenceManifestSafetyFlags;
  },
): CompassSentinelEvidenceManifest {
  return {
    ...manifest,
    contractVersion: COMPASS_SENTINEL_EVIDENCE_MANIFEST_CONTRACT_VERSION,
    flags: manifest.flags ?? COMPASS_SENTINEL_EVIDENCE_REQUIRED_FLAGS,
  };
}

export function buildCompassSentinelEvidenceManifestFromObservations(params: {
  evidence: CompassSentinelEvidenceObservation[];
  candidateDrafts: CompassSentinelCandidateDraftObservation[];
  operatorSafeSummary: string;
}): CompassSentinelEvidenceManifest {
  const evidenceCounts = countEvidence(params.evidence);
  const candidateDraftCounts = countCandidateDrafts(params.candidateDrafts);
  const reasonCodes = collectReasonCodes(params.evidence, params.candidateDrafts);
  const hasConflictOrUnsafeEvidence = reasonCodes.some((code) => (
    code === 'vendor_mismatch'
      || code === 'placeholder_content'
      || code === 'unsafe_evidence_rejected'
  ));
  const answerReady = evidenceCounts.verified > 0
    && candidateDraftCounts.selected > 0
    && !hasConflictOrUnsafeEvidence;

  return buildCompassSentinelEvidenceManifest({
    evidenceStatus: hasConflictOrUnsafeEvidence
      ? 'conflict_or_unsafe_evidence'
      : evidenceCounts.verified > 0
        ? 'verified_evidence_present'
        : 'weak_or_missing_evidence',
    reviewStatus: answerReady
      ? 'accepted'
      : hasConflictOrUnsafeEvidence || evidenceCounts.verified === 0
        ? 'blocked'
        : 'review_needed',
    answerDisposition: answerReady ? 'answer_ready' : 'no_data_found',
    evidenceCounts,
    candidateDraftCounts,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ['local_manifest_reviewed'],
    operatorSafeSummary: params.operatorSafeSummary,
  });
}

export function isCompassSentinelEvidenceManifest(
  value: unknown,
): value is CompassSentinelEvidenceManifest {
  if (!isRecord(value)) return false;

  return (
    Object.keys(value).length === 9
    && value.contractVersion === COMPASS_SENTINEL_EVIDENCE_MANIFEST_CONTRACT_VERSION
    && typeof value.evidenceStatus === 'string'
    && allowedEvidenceStatuses.has(value.evidenceStatus as CompassSentinelEvidenceStatus)
    && typeof value.reviewStatus === 'string'
    && allowedReviewStatuses.has(value.reviewStatus as CompassSentinelReviewStatus)
    && typeof value.answerDisposition === 'string'
    && allowedAnswerDispositions.has(value.answerDisposition as CompassSentinelAnswerDisposition)
    && hasEvidenceCounts(value.evidenceCounts)
    && hasCandidateDraftCounts(value.candidateDraftCounts)
    && Array.isArray(value.reasonCodes)
    && value.reasonCodes.length > 0
    && value.reasonCodes.every((code) => typeof code === 'string' && code.trim().length > 0)
    && typeof value.operatorSafeSummary === 'string'
    && value.operatorSafeSummary.trim().length > 0
    && hasRequiredSafetyFlags(value.flags)
  );
}

function countEvidence(
  observations: CompassSentinelEvidenceObservation[],
): CompassSentinelEvidenceCounts {
  return observations.reduce<CompassSentinelEvidenceCounts>((counts, observation) => {
    counts[observation.decision] += 1;
    return counts;
  }, {
    verified: 0,
    weak: 0,
    rejected: 0,
  });
}

function countCandidateDrafts(
  observations: CompassSentinelCandidateDraftObservation[],
): CompassSentinelCandidateDraftCounts {
  return observations.reduce<CompassSentinelCandidateDraftCounts>((counts, observation) => {
    counts.total += 1;
    counts[observation.decision] += 1;
    return counts;
  }, {
    total: 0,
    selected: 0,
    rejected: 0,
  });
}

function collectReasonCodes(
  evidence: CompassSentinelEvidenceObservation[],
  candidateDrafts: CompassSentinelCandidateDraftObservation[],
): string[] {
  const reasonCodes = new Set<string>();

  for (const item of [...evidence, ...candidateDrafts]) {
    for (const reasonCode of item.reasonCodes) {
      if (reasonCode.trim()) reasonCodes.add(reasonCode);
    }
  }

  return Array.from(reasonCodes);
}

function hasEvidenceCounts(value: unknown): value is CompassSentinelEvidenceCounts {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);

  return keys.length === 3
    && isNonNegativeInteger(value.verified)
    && isNonNegativeInteger(value.weak)
    && isNonNegativeInteger(value.rejected);
}

function hasCandidateDraftCounts(value: unknown): value is CompassSentinelCandidateDraftCounts {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);

  return keys.length === 3
    && isNonNegativeInteger(value.total)
    && isNonNegativeInteger(value.selected)
    && isNonNegativeInteger(value.rejected)
    && value.total === value.selected + value.rejected;
}

function hasRequiredSafetyFlags(value: unknown): value is CompassSentinelEvidenceManifestSafetyFlags {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);

  return keys.length === requiredSafetyFlagKeys.length
    && keys.every((key) => requiredSafetyFlagKeySet.has(key))
    && requiredSafetyFlagKeys.every((key) => value[key] === true);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
