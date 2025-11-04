import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type ActionBody = {
  jobId: string;
  action: 'retry' | 'cancel' | 'reprocess';
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ActionBody;
    if (!body?.jobId || !body?.action) {
      return NextResponse.json({ success: false, error: 'jobId, action 필수' }, { status: 400 });
    }
    const supabase = await createPureClient();

    if (body.action === 'cancel') {
      const { error } = await supabase
        .from('processing_jobs')
        .update({ status: 'cancelled', finished_at: new Date().toISOString() })
        .eq('id', body.jobId)
        .neq('status', 'completed');
      if (error) throw error;
      return NextResponse.json({ success: true, status: 'cancelled' }, { status: 200 });
    }

    if (body.action === 'retry' || body.action === 'reprocess') {
      // attempts 증가 및 재예약
      const { data, error } = await supabase
        .from('processing_jobs')
        .select('attempts, max_attempts')
        .eq('id', body.jobId)
        .limit(1)
        .maybeSingle();
      if (error) throw error;

      const attempts = (data?.attempts ?? 0) + 1;
      const backoffMs = Math.min(60000, 1000 * Math.pow(2, attempts));
      const scheduledAt = new Date(Date.now() + backoffMs).toISOString();

      const { error: upErr } = await supabase
        .from('processing_jobs')
        .update({ status: 'queued', attempts, scheduled_at: scheduledAt, finished_at: null, started_at: null })
        .eq('id', body.jobId);
      if (upErr) throw upErr;
      return NextResponse.json({ success: true, status: 'queued', attempts }, { status: 200 });
    }

    return NextResponse.json({ success: false, error: '지원하지 않는 action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}


