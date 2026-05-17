import { buildCompassSourceProposalRun } from './CompassSourceProposalService';
import {
  persistCompassSourceProposalRun,
  readCompassSourceProposalQueueSnapshot,
  type CompassSourceProposalQueueResult,
  type CompassSourceProposalQueueSnapshot,
} from './CompassSourceProposalQueueService';

export interface CompassSourceProposalWorkerDryRunRequest {
  sourceId?: string;
  maxSources?: number;
  fetchPreview?: boolean;
}

export interface CompassSourceProposalWorkerDryRunResult {
  mode: 'proposal-only';
  dryRun: true;
  mutationEnabled: false;
  fetchEnabled: boolean;
  generatedAt: string;
  candidateCount: number;
  safetyNotes: string[];
  queue: CompassSourceProposalQueueResult;
  queueSnapshot: CompassSourceProposalQueueSnapshot;
}

export async function runCompassSourceProposalWorkerDryRun(
  request: CompassSourceProposalWorkerDryRunRequest = {},
): Promise<CompassSourceProposalWorkerDryRunResult> {
  const proposalRun = await buildCompassSourceProposalRun({
    sourceId: request.sourceId,
    maxSources: request.maxSources,
    fetchPreview: request.fetchPreview,
  });
  const queue = await persistCompassSourceProposalRun(proposalRun, {
    requestedSourceId: request.sourceId,
    maxSources: request.maxSources,
  });

  return {
    mode: proposalRun.mode,
    dryRun: proposalRun.dryRun,
    mutationEnabled: proposalRun.mutationEnabled,
    fetchEnabled: proposalRun.fetchEnabled,
    generatedAt: proposalRun.generatedAt,
    candidateCount: proposalRun.candidates.length,
    safetyNotes: proposalRun.safetyNotes,
    queue,
    queueSnapshot: await readCompassSourceProposalQueueSnapshot(),
  };
}
