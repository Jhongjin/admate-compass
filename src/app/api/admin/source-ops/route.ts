import { NextRequest, NextResponse } from 'next/server';
import { guardCompassProductAdminSessionRoute } from '@/lib/adminProductSessionGuard';
import { buildCompassSourceOpsPlan } from '@/lib/services/CompassSourceOpsService';

export async function GET(request: NextRequest) {
  const sessionGuard = guardCompassProductAdminSessionRoute(request);
  if (sessionGuard) return sessionGuard;

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
