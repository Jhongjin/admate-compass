import { createCompassServiceClient } from '@/lib/supabase/compass';
import type {
  CompassSourceProposalCandidate,
  CompassSourceProposalRun,
} from './CompassSourceProposalService';

export interface CompassSourceProposalQueueRequest {
  requestedSourceId?: string;
  maxSources?: number;
}

export interface CompassSourceProposalQueueResult {
  enabled: boolean;
  readEnabled: boolean;
  writeEnabled: boolean;
  persisted: boolean;
  productionBlocked: boolean;
  runId?: string;
  candidateCount: number;
  reason: string;
}

export interface CompassSourceProposalQueueSnapshot {
  enabled: boolean;
  readEnabled: boolean;
  writeEnabled: boolean;
  productionBlocked: boolean;
  canPersist: boolean;
  readStatus: 'disabled' | 'unavailable' | 'ready';
  pendingCandidates: number;
  reviewStatusCounts: {
    pending: number;
    rejected: number;
    expired: number;
  };
  riskLevelCounts: {
    low: number;
    medium: number;
    high: number;
  };
  latestRun?: {
    id: string;
    status: string;
    candidateCount: number;
    fetchEnabled: boolean;
    createdAt: string;
  };
  recentCandidates: Array<{
    id: string;
    runId: string;
    sourceId: string;
    vendor: string;
    label: string;
    url: string;
    host: string;
    canonicalUrl?: string;
    title?: string;
    contentPreview?: string;
    contentLength?: number;
    fetchedAt?: string;
    sourceStatus?: string;
    reason: string;
    proposalStatus: string;
    reviewStatus: string;
    riskLevel: string;
    createdAt: string;
  }>;
  reason: string;
}

export function getCompassSourceProposalQueueState() {
  const writeEnabled = process.env.COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED === 'true';
  const readEnabled = process.env.COMPASS_SOURCE_PROPOSAL_QUEUE_READ_ENABLED === 'true' || writeEnabled;
  const productionBlocked = process.env.NODE_ENV === 'production';

  return {
    enabled: writeEnabled,
    readEnabled,
    writeEnabled,
    productionBlocked,
    canPersist: writeEnabled && !productionBlocked,
  };
}

const EMPTY_QUEUE_REVIEW_COUNTS = {
  pending: 0,
  rejected: 0,
  expired: 0,
};

const EMPTY_QUEUE_RISK_COUNTS = {
  low: 0,
  medium: 0,
  high: 0,
};

export async function readCompassSourceProposalQueueSnapshot(
  limit = 5,
): Promise<CompassSourceProposalQueueSnapshot> {
  const queueState = getCompassSourceProposalQueueState();
  const base = {
    enabled: queueState.readEnabled,
    readEnabled: queueState.readEnabled,
    writeEnabled: queueState.writeEnabled,
    productionBlocked: queueState.productionBlocked,
    canPersist: queueState.canPersist,
  };

  if (!queueState.readEnabled) {
    return {
      ...base,
      readStatus: 'disabled',
      pendingCandidates: 0,
      reviewStatusCounts: EMPTY_QUEUE_REVIEW_COUNTS,
      riskLevelCounts: EMPTY_QUEUE_RISK_COUNTS,
      recentCandidates: [],
      reason: 'Proposal queue readback is disabled. Enable COMPASS_SOURCE_PROPOSAL_QUEUE_READ_ENABLED=true for read-only status checks.',
    };
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ...base,
      readStatus: 'unavailable',
      pendingCandidates: 0,
      reviewStatusCounts: EMPTY_QUEUE_REVIEW_COUNTS,
      riskLevelCounts: EMPTY_QUEUE_RISK_COUNTS,
      recentCandidates: [],
      reason: 'Proposal queue tables cannot be read because the Compass service database environment is unavailable.',
    };
  }

  try {
    const supabase = createCompassServiceClient();
    const safeLimit = Math.max(1, Math.min(limit, 20));
    const { data: runs, error: runError } = await supabase
      .from('source_proposal_runs')
      .select('id,status,candidate_count,fetch_enabled,created_at')
      .order('created_at', { ascending: false })
      .limit(1);

    if (runError) {
      return {
        ...base,
        readStatus: 'unavailable',
        pendingCandidates: 0,
        reviewStatusCounts: EMPTY_QUEUE_REVIEW_COUNTS,
        riskLevelCounts: EMPTY_QUEUE_RISK_COUNTS,
        recentCandidates: [],
        reason: 'Proposal queue run table is not readable in the current Compass schema.',
      };
    }

    const { data: candidates, error: candidateError, count } = await supabase
      .from('source_proposal_queue')
      .select(
        [
          'id',
          'run_id',
          'source_id',
          'vendor',
          'label',
          'url',
          'host',
          'canonical_url',
          'title',
          'proposal_status',
          'review_status',
          'risk_level',
          'content_preview',
          'content_length',
          'fetched_at',
          'source_status',
          'reason',
          'created_at',
        ].join(','),
        { count: 'exact' },
      )
      .eq('review_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (candidateError) {
      return {
        ...base,
        readStatus: 'unavailable',
        pendingCandidates: 0,
        reviewStatusCounts: EMPTY_QUEUE_REVIEW_COUNTS,
        riskLevelCounts: EMPTY_QUEUE_RISK_COUNTS,
        recentCandidates: [],
        reason: 'Proposal queue candidate table is not readable in the current Compass schema.',
      };
    }

    const latestRunRow = Array.isArray(runs) ? runs[0] : undefined;
    const candidateRows: Array<Record<string, unknown>> = Array.isArray(candidates)
      ? candidates as unknown as Array<Record<string, unknown>>
      : [];
    const [reviewStatusCounts, riskLevelCounts] = await Promise.all([
      readQueueReviewStatusCounts(supabase),
      readQueueRiskLevelCounts(supabase),
    ]);

    return {
      ...base,
      readStatus: 'ready',
      pendingCandidates: count || 0,
      reviewStatusCounts,
      riskLevelCounts,
      latestRun: latestRunRow ? {
        id: String(latestRunRow.id),
        status: String(latestRunRow.status || 'unknown'),
        candidateCount: Number(latestRunRow.candidate_count || 0),
        fetchEnabled: Boolean(latestRunRow.fetch_enabled),
        createdAt: String(latestRunRow.created_at || ''),
      } : undefined,
      recentCandidates: candidateRows.map((candidate) => ({
        id: String(candidate.id),
        runId: String(candidate.run_id),
        sourceId: String(candidate.source_id),
        vendor: String(candidate.vendor),
        label: String(candidate.label),
        url: String(candidate.url || ''),
        host: String(candidate.host || ''),
        canonicalUrl: candidate.canonical_url ? String(candidate.canonical_url) : undefined,
        title: candidate.title ? String(candidate.title) : undefined,
        contentPreview: candidate.content_preview ? String(candidate.content_preview) : undefined,
        contentLength: Number.isFinite(Number(candidate.content_length)) ? Number(candidate.content_length) : undefined,
        fetchedAt: candidate.fetched_at ? String(candidate.fetched_at) : undefined,
        sourceStatus: candidate.source_status ? String(candidate.source_status) : undefined,
        reason: String(candidate.reason || ''),
        proposalStatus: String(candidate.proposal_status),
        reviewStatus: String(candidate.review_status),
        riskLevel: String(candidate.risk_level),
        createdAt: String(candidate.created_at || ''),
      })),
      reason: 'Proposal queue is readable. Rows shown here are proposal-only and are not corpus promotions.',
    };
  } catch {
    return {
      ...base,
      readStatus: 'unavailable',
      pendingCandidates: 0,
      reviewStatusCounts: EMPTY_QUEUE_REVIEW_COUNTS,
      riskLevelCounts: EMPTY_QUEUE_RISK_COUNTS,
      recentCandidates: [],
      reason: 'Proposal queue readback is unavailable in this environment.',
    };
  }
}

export async function persistCompassSourceProposalRun(
  proposalRun: CompassSourceProposalRun,
  request: CompassSourceProposalQueueRequest = {},
): Promise<CompassSourceProposalQueueResult> {
  const queueState = getCompassSourceProposalQueueState();

  if (!queueState.enabled) {
    return {
      enabled: false,
      readEnabled: queueState.readEnabled,
      writeEnabled: queueState.writeEnabled,
      persisted: false,
      productionBlocked: queueState.productionBlocked,
      candidateCount: proposalRun.candidates.length,
      reason: 'Queue persistence is disabled unless COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED=true.',
    };
  }

  if (queueState.productionBlocked) {
    return {
      enabled: true,
      readEnabled: queueState.readEnabled,
      writeEnabled: queueState.writeEnabled,
      persisted: false,
      productionBlocked: true,
      candidateCount: proposalRun.candidates.length,
      reason: 'Queue persistence is blocked in production until an authenticated internal apply path exists.',
    };
  }

  const supabase = createCompassServiceClient();
  const { data: runRow, error: runError } = await supabase
    .from('source_proposal_runs')
    .insert({
      mode: proposalRun.mode,
      dry_run: proposalRun.dryRun,
      mutation_enabled: proposalRun.mutationEnabled,
      fetch_enabled: proposalRun.fetchEnabled,
      requested_source_id: request.requestedSourceId || null,
      max_sources: request.maxSources || null,
      generated_by: proposalRun.collectionOwner,
      status: 'completed',
      candidate_count: proposalRun.candidates.length,
      safety_notes: proposalRun.safetyNotes,
      metadata: {
        generatedAt: proposalRun.generatedAt,
      },
    })
    .select('id')
    .single();

  if (runError || !runRow?.id) {
    throw new Error(`source proposal run queue insert failed: ${runError?.message || 'missing run id'}`);
  }

  if (proposalRun.candidates.length > 0) {
    const { error: candidatesError } = await supabase
      .from('source_proposal_queue')
      .insert(proposalRun.candidates.map((candidate) => toQueueRow(candidate, runRow.id)));

    if (candidatesError) {
      throw new Error(`source proposal candidate queue insert failed: ${candidatesError.message}`);
    }
  }

  return {
    enabled: true,
    readEnabled: queueState.readEnabled,
    writeEnabled: queueState.writeEnabled,
    persisted: true,
    productionBlocked: false,
    runId: runRow.id,
    candidateCount: proposalRun.candidates.length,
    reason: 'Proposal run persisted to the dry-run queue. No corpus mutation was performed.',
  };
}

async function readQueueReviewStatusCounts(supabase: ReturnType<typeof createCompassServiceClient>) {
  const [pending, rejected, expired] = await Promise.all([
    countQueueRows(supabase, 'review_status', 'pending'),
    countQueueRows(supabase, 'review_status', 'rejected'),
    countQueueRows(supabase, 'review_status', 'expired'),
  ]);

  return {
    pending,
    rejected,
    expired,
  };
}

async function readQueueRiskLevelCounts(supabase: ReturnType<typeof createCompassServiceClient>) {
  const [low, medium, high] = await Promise.all([
    countQueueRows(supabase, 'risk_level', 'low'),
    countQueueRows(supabase, 'risk_level', 'medium'),
    countQueueRows(supabase, 'risk_level', 'high'),
  ]);

  return {
    low,
    medium,
    high,
  };
}

async function countQueueRows(
  supabase: ReturnType<typeof createCompassServiceClient>,
  column: 'review_status' | 'risk_level',
  value: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('source_proposal_queue')
    .select('id', { count: 'exact', head: true })
    .eq(column, value);

  if (error) return 0;
  return count || 0;
}

function toQueueRow(candidate: CompassSourceProposalCandidate, runId: string) {
  return {
    run_id: runId,
    source_id: candidate.sourceId,
    vendor: candidate.vendor,
    label: candidate.label,
    url: candidate.url,
    host: candidate.host,
    canonical_url: candidate.canonicalUrl || null,
    title: candidate.title || null,
    proposal_status: candidate.status,
    review_status: 'pending',
    risk_level: candidate.riskLevel,
    headings: candidate.headings,
    content_preview: candidate.contentPreview || null,
    content_length: candidate.contentLength || null,
    fetched_at: candidate.fetchedAt || null,
    source_status: candidate.sourceStatus || null,
    reason: candidate.reason,
    would_fetch: candidate.wouldFetch,
    would_index: false,
    would_promote: false,
    safety: candidate.safety,
    raw_candidate: candidate,
  };
}
