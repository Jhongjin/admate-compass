import { NextResponse } from 'next/server';
import { buildCompassSourceOpsPlan } from '@/lib/services/CompassSourceOpsService';

export async function GET() {
  try {
    const plan = await buildCompassSourceOpsPlan();
    return NextResponse.json({
      success: true,
      data: plan,
    });
  } catch (error) {
    console.error('Compass source ops read failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Compass source ops status could not be loaded.',
      },
      { status: 500 },
    );
  }
}
