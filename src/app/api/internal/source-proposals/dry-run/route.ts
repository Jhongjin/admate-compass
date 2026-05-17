import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { buildCompassSourceProposalRun } from '@/lib/services/CompassSourceProposalService';
import {
  persistCompassSourceProposalRun,
  readCompassSourceProposalQueueSnapshot,
} from '@/lib/services/CompassSourceProposalQueueService';

export const dynamic = 'force-dynamic';

function noStoreJson(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

function isWorkerEnabled(): boolean {
  return process.env.COMPASS_SOURCE_PROPOSAL_WORKER_ENABLED === 'true';
}

function productionDisabledResponse() {
  return noStoreJson(
    {
      success: false,
      error: 'Not found',
      code: 'SOURCE_PROPOSAL_WORKER_DISABLED',
    },
    404,
  );
}

function resolveExpectedWorkerKey(): string {
  return process.env.COMPASS_SOURCE_PROPOSAL_WORKER_KEY || process.env.CRON_SECRET || '';
}

function hasWorkerAccess(request: NextRequest): boolean {
  const expected = resolveExpectedWorkerKey();
  const authorization = request.headers.get('authorization') || '';
  const provided = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length).trim()
    : '';

  if (!expected || !provided) return false;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return productionDisabledResponse();
  }

  if (!isWorkerEnabled()) {
    return noStoreJson(
      {
        success: false,
        error: 'Source proposal worker is disabled.',
        code: 'SOURCE_PROPOSAL_WORKER_NOT_ENABLED',
      },
      404,
    );
  }

  if (!hasWorkerAccess(request)) {
    return noStoreJson(
      {
        success: false,
        error: 'Worker authentication required.',
      },
      401,
    );
  }

  const body = await request.json().catch(() => ({}));

  if (body?.dryRun !== true) {
    return NextResponse.json(
      {
        success: false,
        error: 'Source proposal worker only accepts dryRun: true.',
      },
      { status: 409 },
    );
  }

  const maxSources = Number(body?.maxSources || undefined) || undefined;
  const proposalRun = await buildCompassSourceProposalRun({
    sourceId: typeof body?.sourceId === 'string' ? body.sourceId : undefined,
    maxSources,
    fetchPreview: body?.fetch === true,
  });
  const queue = await persistCompassSourceProposalRun(proposalRun, {
    requestedSourceId: typeof body?.sourceId === 'string' ? body.sourceId : undefined,
    maxSources,
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        mode: proposalRun.mode,
        dryRun: proposalRun.dryRun,
        mutationEnabled: proposalRun.mutationEnabled,
        fetchEnabled: proposalRun.fetchEnabled,
        generatedAt: proposalRun.generatedAt,
        candidateCount: proposalRun.candidates.length,
        safetyNotes: proposalRun.safetyNotes,
        queue,
        queueSnapshot: await readCompassSourceProposalQueueSnapshot(),
      },
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  );
}

