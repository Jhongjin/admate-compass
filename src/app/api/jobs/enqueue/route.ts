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

    // ⚠️ 근본적인 문제: Vercel 서버리스 환경에서 import()로 실행된 함수의 Supabase 쿼리가 멈춤
    // check-crawl-status는 정상 작동하는데, 그것은 실제 HTTP 요청 핸들러로 실행되기 때문
    // processQueue는 import()로 호출되면 비정상적인 실행 컨텍스트에서 실행됨
    // 
    // 해결책: 즉시 트리거를 제거하고 Cron Job에 의존
    // - 작업은 정상적으로 등록됨
    // - Cron Job이 1분마다 /api/jobs/consume를 호출하여 처리
    // - 실제 HTTP 요청 컨텍스트에서 실행되므로 Supabase 쿼리가 정상 작동
    //
    // 즉시 처리가 필요한 경우:
    // - 프론트엔드에서 수동으로 /api/jobs/consume를 호출
    // - 또는 관리자 페이지에서 "1건 처리" 버튼 클릭
    console.log('✅ 작업 등록 완료 (작업 ID: ' + data.id + '). Cron Job이 1분 내에 처리합니다.');

    return NextResponse.json({ success: true, jobId: data.id }, { status: 202 });
  } catch (err) {
    console.error('enqueue API 오류:', err);
    return NextResponse.json(
      { success: false, error: '요청 처리 중 오류가 발생했습니다.', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}





