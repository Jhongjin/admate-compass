import { NextRequest, NextResponse } from 'next/server';
import { buildCompassSourceProposalRun } from '@/lib/services/CompassSourceProposalService';
import {
  getCompassSourceProposalQueueState,
  persistCompassSourceProposalRun,
  readCompassSourceProposalQueueSnapshot,
} from '@/lib/services/CompassSourceProposalQueueService';
import { guardProductionAdminSessionRoute } from '@/lib/adminDebugGuard';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const maxSources = Number(searchParams.get('maxSources') || undefined) || undefined;
    const queueLimit = Number(searchParams.get('queueLimit') || undefined) || undefined;
    const proposalRun = await buildCompassSourceProposalRun({
      sourceId: searchParams.get('sourceId') || undefined,
      maxSources,
      fetchPreview: searchParams.get('fetch') === 'true',
    });

    return NextResponse.json({
      success: true,
      data: {
        ...proposalRun,
        queue: getCompassSourceProposalQueueState(),
        queueSnapshot: await readCompassSourceProposalQueueSnapshot(queueLimit),
      },
    });
  } catch (error) {
    console.error('Compass source proposal read failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Compass source proposal status could not be loaded.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const productionGuard = guardProductionAdminSessionRoute();
  if (productionGuard) return productionGuard;

  try {
    const body = await request.json().catch(() => ({}));

    if (body?.dryRun !== true) {
      return NextResponse.json(
        {
          success: false,
          error: 'Source proposal queue writes require dryRun: true.',
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

    return NextResponse.json({
      success: true,
      data: {
        ...proposalRun,
        queue,
      },
    });
  } catch (error) {
    console.error('Compass source proposal queue write failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Compass source proposal queue write failed.',
      },
      { status: 500 },
    );
  }
}
