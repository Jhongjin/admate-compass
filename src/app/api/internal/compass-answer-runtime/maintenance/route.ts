import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runCompassAnswerDurableMaintenance } from '@/lib/server/compassAnswerRuntimeStore';
import { runCompassRetrievalDurableCacheMaintenance } from '@/lib/server/compassRetrievalRuntimeStore';

export const dynamic = 'force-dynamic';

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

function resolveExpectedMaintenanceKey() {
  return process.env.COMPASS_ANSWER_RUNTIME_MAINTENANCE_KEY || process.env.CRON_SECRET || '';
}

function hasMaintenanceAccess(request: NextRequest) {
  const expected = resolveExpectedMaintenanceKey();
  if (!expected && process.env.NODE_ENV !== 'production') return true;

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

export async function GET(request: NextRequest) {
  if (!hasMaintenanceAccess(request)) {
    return noStoreJson(
      {
        success: false,
        error: 'Maintenance authentication required.',
      },
      401,
    );
  }

  const [answerRuntime, retrievalCache] = await Promise.all([
    runCompassAnswerDurableMaintenance(),
    runCompassRetrievalDurableCacheMaintenance(),
  ]);
  const status = answerRuntime.status === 'unavailable' && retrievalCache.status === 'unavailable' ? 503 : 200;

  return noStoreJson(
    {
      success: status < 500,
      data: {
        answerRuntime,
        retrievalCache,
      },
    },
    status,
  );
}
