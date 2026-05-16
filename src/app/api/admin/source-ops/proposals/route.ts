import { NextRequest, NextResponse } from 'next/server';
import { buildCompassSourceProposalRun } from '@/lib/services/CompassSourceProposalService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const maxSources = Number(searchParams.get('maxSources') || undefined) || undefined;
    const proposalRun = await buildCompassSourceProposalRun({
      sourceId: searchParams.get('sourceId') || undefined,
      maxSources,
      fetchPreview: searchParams.get('fetch') === 'true',
    });

    return NextResponse.json({
      success: true,
      data: proposalRun,
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
