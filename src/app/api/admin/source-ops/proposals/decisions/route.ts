import { NextRequest, NextResponse } from 'next/server';
import { guardCompassProductAdminSessionRoute } from '@/lib/adminProductSessionGuard';
import { classifyCompassSourceProposalDecisionLedger } from '@/lib/services/CompassSourceProposalDecisionLedgerService';

const CONTRACT_SAFETY_FLAGS = {
  mutationEnabled: false,
  llmUsed: false,
  noCorpusMutation: true,
  noApplyAction: true,
} as const;

export async function POST(request: NextRequest) {
  const sessionGuard = guardCompassProductAdminSessionRoute(request);
  if (sessionGuard) return sessionGuard;

  const body = await request.json().catch(() => undefined);
  const result = classifyCompassSourceProposalDecisionLedger({
    decisionEnvelope: body && typeof body === 'object' ? body.decisionEnvelope : undefined,
    proposalSnapshot: body && typeof body === 'object' ? body.proposalSnapshot : undefined,
    priorDecisionEnvelope: body && typeof body === 'object' ? body.priorDecisionEnvelope : undefined,
  });

  return NextResponse.json(
    {
      success: result.status === 'accepted_current_snapshot'
        || result.status === 'duplicate_idempotent_replay',
      ...CONTRACT_SAFETY_FLAGS,
      data: result,
    },
    { status: statusToHttpStatus(result.status) },
  );
}

function statusToHttpStatus(status: string): number {
  if (status === 'accepted_current_snapshot' || status === 'duplicate_idempotent_replay') return 200;
  if (status === 'malformed_decision_envelope') return 400;
  if (status === 'unknown_proposal') return 404;
  return 409;
}
