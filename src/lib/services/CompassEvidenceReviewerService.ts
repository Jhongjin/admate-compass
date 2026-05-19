export type CompassEvidenceAgent = 'policy_evidence_agent' | 'media_product_evidence_agent';
export type CompassEvidenceDecision = 'verified' | 'weak' | 'rejected';
export type CompassReviewerOutcome = 'answer' | 'noDataFound';

export interface CompassEvidencePacket {
  caseId: string;
  agent: CompassEvidenceAgent;
  claim: string;
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string;
  vendor: string;
  topic: string;
  publishedOrFetchedAt: string;
  excerpt: string;
  chunkId: string;
  retrievalScore: number;
  evidenceDecision: CompassEvidenceDecision;
  reasons: string[];
}

export interface CompassTeamLeadReview {
  outcome: CompassReviewerOutcome;
  canonicalAnswerRoute: '/api/compass-answer';
  legacyCompatibilityRoute: '/api/chat-ollama';
  legacyAnswerRoute: '/api/chatbot';
  verifiedPackets: CompassEvidencePacket[];
  weakPackets: CompassEvidencePacket[];
  rejectedPackets: CompassEvidencePacket[];
  conflicts: string[];
  reasons: string[];
}

export const COMPASS_ANSWER_ROUTE_POLICY = {
  canonicalAnswerRoute: '/api/compass-answer',
  legacyCompatibilityRoute: '/api/chat-ollama',
  legacyAnswerRoute: '/api/chatbot',
  specialistAgentsWriteFinalAnswer: false,
  teamLeadOwnsFinalAnswer: true,
} as const;

export const COMPASS_REVIEWER_ROLES = {
  teamLead: {
    label: 'Team Lead Reviewer',
    responsibility: 'Deduplicate, reject weak or conflicting evidence, and produce the final answer only from verified packets.',
  },
  agent1: {
    label: 'Policy Evidence Agent',
    responsibility: 'Extract policy, review rule, eligibility, and enforcement evidence as packets only.',
  },
  agent2: {
    label: 'Media/Product Evidence Agent',
    responsibility: 'Extract product, format, placement, setup, and operating-condition evidence as packets only.',
  },
} as const;

const MIN_VERIFIED_EXCERPT_LENGTH = 30;

function hasCompleteLineage(packet: CompassEvidencePacket): boolean {
  return Boolean(
    packet.sourceId.trim()
      && packet.sourceUrl.trim()
      && packet.sourceTitle.trim()
      && packet.vendor.trim()
      && packet.chunkId.trim()
      && packet.publishedOrFetchedAt.trim(),
  );
}

function isVerifiedPacket(packet: CompassEvidencePacket): boolean {
  return packet.evidenceDecision === 'verified'
    && hasCompleteLineage(packet)
    && packet.retrievalScore >= 0.72
    && packet.excerpt.trim().length >= MIN_VERIFIED_EXCERPT_LENGTH
    && packet.reasons.includes('source_quality_complete')
    && !packet.reasons.includes('placeholder_content')
    && !packet.reasons.includes('vendor_mismatch')
    && !packet.reasons.includes('stale_source');
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniquePackets(packets: CompassEvidencePacket[]): CompassEvidencePacket[] {
  const seen = new Set<string>();
  return packets.filter((packet) => {
    const key = [
      normalizeKey(packet.sourceId),
      normalizeKey(packet.chunkId),
      normalizeKey(packet.claim),
    ].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findConflicts(packets: CompassEvidencePacket[]): string[] {
  const conflicts = new Set<string>();

  for (const packet of packets) {
    if (packet.reasons.includes('vendor_mismatch')) {
      conflicts.add('vendor_mismatch');
    }
    if (packet.reasons.includes('stale_source')) {
      conflicts.add('stale_source');
    }
    if (packet.reasons.includes('placeholder_content')) {
      conflicts.add('placeholder_content');
    }
  }

  return Array.from(conflicts);
}

export function reviewCompassEvidencePackets(packets: CompassEvidencePacket[]): CompassTeamLeadReview {
  const dedupedPackets = uniquePackets(packets);
  const verifiedPackets = dedupedPackets.filter(isVerifiedPacket);
  const weakPackets = dedupedPackets.filter((packet) => packet.evidenceDecision === 'weak');
  const rejectedPackets = dedupedPackets.filter((packet) => {
    return packet.evidenceDecision === 'rejected'
      || (packet.evidenceDecision === 'verified' && !isVerifiedPacket(packet));
  });
  const conflicts = findConflicts(dedupedPackets);
  const reasons: string[] = [];

  if (verifiedPackets.length === 0) {
    reasons.push('no_verified_evidence');
  }

  if (conflicts.length > 0) {
    reasons.push('conflict_review_required');
  }

  if (verifiedPackets.length > 0) {
    reasons.push('verified_evidence_available');
  }

  return {
    outcome: verifiedPackets.length > 0 && conflicts.length === 0 ? 'answer' : 'noDataFound',
    canonicalAnswerRoute: COMPASS_ANSWER_ROUTE_POLICY.canonicalAnswerRoute,
    legacyCompatibilityRoute: COMPASS_ANSWER_ROUTE_POLICY.legacyCompatibilityRoute,
    legacyAnswerRoute: COMPASS_ANSWER_ROUTE_POLICY.legacyAnswerRoute,
    verifiedPackets,
    weakPackets,
    rejectedPackets,
    conflicts,
    reasons,
  };
}
