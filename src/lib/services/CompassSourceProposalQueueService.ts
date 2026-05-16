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
  persisted: boolean;
  productionBlocked: boolean;
  runId?: string;
  candidateCount: number;
  reason: string;
}

export function getCompassSourceProposalQueueState() {
  const enabled = process.env.COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED === 'true';
  const productionBlocked = process.env.NODE_ENV === 'production';

  return {
    enabled,
    productionBlocked,
    canPersist: enabled && !productionBlocked,
  };
}

export async function persistCompassSourceProposalRun(
  proposalRun: CompassSourceProposalRun,
  request: CompassSourceProposalQueueRequest = {},
): Promise<CompassSourceProposalQueueResult> {
  const queueState = getCompassSourceProposalQueueState();

  if (!queueState.enabled) {
    return {
      enabled: false,
      persisted: false,
      productionBlocked: queueState.productionBlocked,
      candidateCount: proposalRun.candidates.length,
      reason: 'Queue persistence is disabled unless COMPASS_SOURCE_PROPOSAL_QUEUE_ENABLED=true.',
    };
  }

  if (queueState.productionBlocked) {
    return {
      enabled: true,
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
    persisted: true,
    productionBlocked: false,
    runId: runRow.id,
    candidateCount: proposalRun.candidates.length,
    reason: 'Proposal run persisted to the dry-run queue. No corpus mutation was performed.',
  };
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
