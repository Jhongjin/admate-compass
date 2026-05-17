import {
  reviewCompassEvidencePackets,
  type CompassEvidenceAgent,
  type CompassEvidencePacket,
  type CompassReviewerOutcome,
  type CompassTeamLeadReview,
} from './CompassEvidenceReviewerService';

export interface CompassAnswerCandidate {
  caseId: string;
  candidateId: string;
  agent: CompassEvidenceAgent;
  answerDraft: string;
  supportingChunkIds: string[];
  limitationNotes: string[];
  confidence: number;
}

export interface CompassTeamLeadAnswerReview {
  outcome: CompassReviewerOutcome;
  canonicalAnswerRoute: '/api/chat-ollama';
  legacyAnswerRoute: '/api/chatbot';
  specialistCandidatesAreDraftsOnly: true;
  teamLeadOwnsFinalAnswer: true;
  finalAnswer: string | null;
  selectedCandidateIds: string[];
  rejectedCandidateIds: string[];
  verifiedSourceIds: string[];
  conflicts: string[];
  reasons: string[];
  evidenceReview: CompassTeamLeadReview;
}

export const COMPASS_ANSWER_CANDIDATE_REVIEW_POLICY = {
  specialistCandidatesAreDraftsOnly: true,
  teamLeadOwnsFinalAnswer: true,
  verifiedEvidenceRequired: true,
  candidateEvidenceIdsMustMatchVerifiedPackets: true,
  conflictReturnsNoData: true,
  noProviderSwitch: true,
} as const;

const MIN_CANDIDATE_CONFIDENCE = 0.64;
const MIN_CANDIDATE_DRAFT_LENGTH = 30;

function normalizeCandidateKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniqueAnswerCandidates(candidates: CompassAnswerCandidate[]): CompassAnswerCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [
      normalizeCandidateKey(candidate.caseId),
      normalizeCandidateKey(candidate.agent),
      normalizeCandidateKey(candidate.candidateId),
      normalizeCandidateKey(candidate.answerDraft),
    ].join('::');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateHasVerifiedSupport(candidate: CompassAnswerCandidate, verifiedChunkIds: Set<string>): boolean {
  return candidate.supportingChunkIds.length > 0
    && candidate.supportingChunkIds.every((chunkId) => verifiedChunkIds.has(chunkId));
}

function isSupportedAnswerCandidate(candidate: CompassAnswerCandidate, verifiedChunkIds: Set<string>): boolean {
  return candidate.confidence >= MIN_CANDIDATE_CONFIDENCE
    && candidate.answerDraft.trim().length >= MIN_CANDIDATE_DRAFT_LENGTH
    && candidateHasVerifiedSupport(candidate, verifiedChunkIds);
}

function buildTeamLeadFinalAnswer(
  candidates: CompassAnswerCandidate[],
  verifiedPackets: CompassEvidencePacket[],
): string {
  const answerDrafts = candidates.map((candidate) => candidate.answerDraft.trim()).join(' ');
  const sourceTitles = Array.from(new Set(
    verifiedPackets.map((packet) => `${packet.vendor}: ${packet.sourceTitle}`),
  ));

  return [
    '확인된 내부 근거 기준 답변입니다.',
    answerDrafts,
    `근거: ${sourceTitles.join(' / ')}`,
  ].join(' ');
}

export function reviewCompassAnswerCandidates(
  packets: CompassEvidencePacket[],
  candidates: CompassAnswerCandidate[],
): CompassTeamLeadAnswerReview {
  const evidenceReview = reviewCompassEvidencePackets(packets);
  const uniqueCandidates = uniqueAnswerCandidates(candidates);
  const verifiedChunkIds = new Set(evidenceReview.verifiedPackets.map((packet) => packet.chunkId));
  const supportedCandidates = evidenceReview.outcome === 'answer'
    ? uniqueCandidates.filter((candidate) => isSupportedAnswerCandidate(candidate, verifiedChunkIds))
    : [];
  const selectedCandidateIds = supportedCandidates.map((candidate) => candidate.candidateId);
  const rejectedCandidateIds = uniqueCandidates
    .filter((candidate) => !selectedCandidateIds.includes(candidate.candidateId))
    .map((candidate) => candidate.candidateId);
  const reasons = [...evidenceReview.reasons];

  if (uniqueCandidates.length === 0) {
    reasons.push('no_answer_candidates');
  }

  if (supportedCandidates.length === 0) {
    reasons.push('no_supported_answer_candidate');
  }

  if (rejectedCandidateIds.length > 0) {
    reasons.push('answer_candidate_rejected');
  }

  const outcome = evidenceReview.outcome === 'answer' && supportedCandidates.length > 0
    ? 'answer'
    : 'noDataFound';

  return {
    outcome,
    canonicalAnswerRoute: evidenceReview.canonicalAnswerRoute,
    legacyAnswerRoute: evidenceReview.legacyAnswerRoute,
    specialistCandidatesAreDraftsOnly: true,
    teamLeadOwnsFinalAnswer: true,
    finalAnswer: outcome === 'answer'
      ? buildTeamLeadFinalAnswer(supportedCandidates, evidenceReview.verifiedPackets)
      : null,
    selectedCandidateIds,
    rejectedCandidateIds,
    verifiedSourceIds: evidenceReview.verifiedPackets.map((packet) => packet.sourceId),
    conflicts: evidenceReview.conflicts,
    reasons,
    evidenceReview,
  };
}
