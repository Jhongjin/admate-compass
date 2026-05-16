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
