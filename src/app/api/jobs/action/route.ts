import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type ActionBody = {
  jobId: string;
  action: 'retry' | 'cancel' | 'reprocess' | 'delete';
  jobIds?: string[]; // 일괄 삭제용
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ActionBody;
    if (!body?.action) {
      return NextResponse.json({ success: false, error: 'action 필수' }, { status: 400 });
    }
    
    // delete 액션은 jobIds로 일괄 삭제 가능, 다른 액션은 jobId 필수
    if (body.action !== 'delete' && !body?.jobId) {
      return NextResponse.json({ success: false, error: 'jobId 필수' }, { status: 400 });
    }
    
    // delete 액션은 jobId 또는 jobIds 중 하나는 필수
    if (body.action === 'delete' && !body?.jobId && (!body?.jobIds || body.jobIds.length === 0)) {
      return NextResponse.json({ success: false, error: 'jobId 또는 jobIds 필수' }, { status: 400 });
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

    if (body.action === 'delete') {
      // 단일 삭제 또는 일괄 삭제
      const jobIds = body.jobIds && body.jobIds.length > 0 ? body.jobIds : [body.jobId];
      
      // 삭제 가능한 상태만 삭제 (queued, failed, cancelled, retrying)
      const { error } = await supabase
        .from('processing_jobs')
        .delete()
        .in('id', jobIds)
        .in('status', ['queued', 'failed', 'cancelled', 'retrying']);
      
      if (error) throw error;
      
      const deletedCount = jobIds.length;
      return NextResponse.json({ 
        success: true, 
        deleted: deletedCount,
        message: `${deletedCount}개 작업이 삭제되었습니다.`
      }, { status: 200 });
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


