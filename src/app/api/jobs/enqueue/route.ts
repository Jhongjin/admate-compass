import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type EnqueueBody = {
  documentId: string;
  jobType: 'OCR' | 'PDF_PARSE' | 'DOCX_PARSE' | 'CRAWL' | 'EMBEDDING';
  priority?: number;
  payload?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EnqueueBody;
    if (!body?.documentId || !body?.jobType) {
      return NextResponse.json({ success: false, error: 'documentId와 jobType은 필수입니다.' }, { status: 400 });
    }

    const priority = typeof body.priority === 'number' ? Math.min(Math.max(body.priority, 1), 10) : 5;
    const payload = body.payload ?? {};

    const supabase = await createPureClient();

    // 중복 방지: 같은 문서/타입이 대기 또는 처리 중이면 기존 레코드 반환
    const { data: existing, error: existingError } = await supabase
      .from('processing_jobs')
      .select('id, status')
      .eq('document_id', body.documentId)
      .eq('job_type', body.jobType)
      .in('status', ['queued', 'processing', 'retrying'])
      .limit(1)
      .maybeSingle();

    if (existingError) {
      console.error('중복 조회 오류:', existingError);
    }

    if (existing) {
      return NextResponse.json({ success: true, jobId: existing.id, status: existing.status }, { status: 202 });
    }

    const { data, error } = await supabase
      .from('processing_jobs')
      .insert({
        document_id: body.documentId,
        job_type: body.jobType,
        status: 'queued',
        priority,
        payload,
        attempts: 0,
        max_attempts: 3,
        scheduled_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('큐 등록 오류:', error);
      return NextResponse.json({ success: false, error: '큐 등록 실패', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, jobId: data.id }, { status: 202 });
  } catch (err) {
    console.error('enqueue API 오류:', err);
    return NextResponse.json(
      { success: false, error: '요청 처리 중 오류가 발생했습니다.', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}





