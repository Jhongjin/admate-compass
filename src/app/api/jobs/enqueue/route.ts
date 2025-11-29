import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

type EnqueueBody = {
  documentId?: string | null;
  jobType: 'OCR' | 'PDF_PARSE' | 'DOCX_PARSE' | 'CRAWL' | 'CRAWL_SEED' | 'EMBEDDING' | 'CHUNK_PROCESS';
  priority?: number;
  payload?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as EnqueueBody;
    if (!body?.jobType) {
      return NextResponse.json({ success: false, error: 'jobType은 필수입니다.' }, { status: 400 });
    }

    // CRAWL_SEED는 documentId가 없을 수 있음
    const requiresDocumentId = !['CRAWL_SEED'].includes(body.jobType);
    if (requiresDocumentId && !body?.documentId) {
      return NextResponse.json({ success: false, error: 'documentId는 필수입니다.' }, { status: 400 });
    }

    const priority = typeof body.priority === 'number' ? Math.min(Math.max(body.priority, 1), 10) : 5;
    const payload = body.payload ?? {};

    const supabase = await createPureClient();

    // PDF_PARSE/DOCX_PARSE 작업 생성 전에 문서 타입 확인 (URL 문서 방지)
    if ((body.jobType === 'PDF_PARSE' || body.jobType === 'DOCX_PARSE') && body.documentId) {
      const { data: docCheck, error: docCheckError } = await supabase
        .from('documents')
        .select('type, url, title')
        .eq('id', body.documentId)
        .maybeSingle();

      if (!docCheckError && docCheck && (docCheck.type === 'url' || docCheck.url)) {
        return NextResponse.json(
          {
            success: false,
            error: `이 문서는 URL 크롤링 문서입니다 (type: ${docCheck.type}, title: ${docCheck.title || 'N/A'}). PDF_PARSE/DOCX_PARSE 작업으로는 처리할 수 없습니다. URL 문서 재처리는 /api/jobs/reprocess-url API를 사용하세요.`,
            documentType: docCheck.type,
            documentTitle: docCheck.title,
            suggestion: 'Use /api/jobs/reprocess-url for URL documents',
          },
          { status: 400 }
        );
      }
    }

    // 중복 방지: 같은 문서/타입이 대기 또는 처리 중이면 기존 레코드 반환
    // CRAWL_SEED의 경우 documentId가 없으므로 payload의 url로 중복 체크
    let existing = null;
    if (body.documentId) {
      // 🔥 PGRST116 오류 해결: .maybeSingle() 제거하고 리스트로 조회 후 메모리에서 비교
      const { data: potentialDuplicates, error: existingError } = await supabase
        .from('processing_jobs')
        .select('id, status')
        .eq('document_id', body.documentId)
        .eq('job_type', body.jobType)
        .in('status', ['queued', 'processing', 'retrying'])
        .order('created_at', { ascending: false }) // 최신순 정렬
        .limit(10);

      if (existingError) {
        console.error('중복 조회 오류:', existingError);
      }

      // 메모리에서 가장 최신 작업 선택
      if (potentialDuplicates && potentialDuplicates.length > 0) {
        existing = potentialDuplicates[0]; // 정렬된 첫 번째 항목이 가장 최신
      }
    } else if (body.jobType === 'CRAWL_SEED' && payload.url) {
      // CRAWL_SEED의 경우 같은 URL이 이미 큐에 있으면 중복으로 간주
      // .maybeSingle() 대신 리스트로 조회하여 PGRST116 오류 방지
      const { data: potentialDuplicates, error: existingError } = await supabase
        .from('processing_jobs')
        .select('id, status, payload')
        .eq('job_type', body.jobType)
        .is('document_id', null)
        .in('status', ['queued', 'processing', 'retrying'])
        .order('created_at', { ascending: false })
        .limit(10);

      if (existingError) {
        console.error('중복 조회 오류:', existingError);
      }

      // payload.url이 같은 작업 찾기
      if (potentialDuplicates && potentialDuplicates.length > 0) {
        const matchingJob = potentialDuplicates.find(j => (j.payload as any)?.url === payload.url);
        if (matchingJob) {
          existing = matchingJob;
        }
      }
    }

    if (existing) {
      return NextResponse.json({ success: true, jobId: existing.id, status: existing.status }, { status: 202 });
    }

    const { data, error } = await supabase
      .from('processing_jobs')
      .insert({
        document_id: body.documentId || null,
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





