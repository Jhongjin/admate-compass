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

    // 큐에 등록 후 즉시 큐 워커 트리거 (백그라운드 실행)
    // ⚠️ import() 방식은 Vercel 서버리스에서 Supabase 쿼리가 멈추는 문제가 있음
    // 해결책: 실제 HTTP 요청을 사용하되, VERCEL_URL을 사용하여 외부 요청으로 처리
    try {
      console.error('[CRITICAL] 🚀 큐 워커 트리거 시작 (작업 ID: ' + data.id + ')');
      
      // Vercel 환경에서 실제 HTTP 요청 사용
      // VERCEL_URL이 있으면 외부 URL 사용, 없으면 localhost 사용
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
      const consumeUrl = `${baseUrl}/api/jobs/consume`;
      
      console.error('[CRITICAL] 🔗 HTTP 요청 URL:', {
        url: consumeUrl,
        baseUrl: baseUrl,
        vercelUrl: process.env.VERCEL_URL
      });
      
      // 실제 HTTP 요청 (백그라운드 실행, await 없이)
      // ⚠️ POST 요청은 Authorization 헤더가 없으면 검증하지 않도록 설정됨
      // 하지만 내부 요청이므로 CRON_SECRET을 추가하지 않음 (검증 우회)
      fetch(consumeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
          // ⚠️ Authorization 헤더를 추가하지 않음 (POST는 헤더가 없으면 검증하지 않음)
        },
        // 중요: signal을 설정하지 않음 (백그라운드 실행이므로)
      })
        .then(async (response) => {
          console.error('[CRITICAL] 📥 HTTP 응답 수신:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok
          });
          
          // response body를 읽기 전에 clone (한 번만 읽을 수 있으므로)
          const responseClone = response.clone();
          
          try {
            const text = await response.text();
            const json = JSON.parse(text);
            console.error('[CRITICAL] ✅ 큐 워커 처리 완료:', {
              status: response.status,
              success: json.success,
              message: json.message,
              jobId: json.jobId,
              error: json.error
            });
          } catch (parseError) {
            // clone을 사용하여 다시 읽기
            const errorText = await responseClone.text();
            console.error('[CRITICAL] ✅ 큐 워커 처리 완료 (JSON 파싱 실패):', {
              status: response.status,
              response: errorText.substring(0, 500),
              parseError: parseError instanceof Error ? parseError.message : String(parseError)
            });
          }
        })
        .catch((fetchErr) => {
          console.error('[CRITICAL] ❌ HTTP 요청 에러:', {
            error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
            stack: fetchErr instanceof Error ? fetchErr.stack : undefined,
            name: fetchErr instanceof Error ? fetchErr.name : undefined,
            url: consumeUrl
          });
        });
      
      console.error('[CRITICAL] ✅ 큐 워커 트리거 완료 (백그라운드 HTTP 요청 실행 중)');
    } catch (triggerError) {
      // 트리거 실패해도 작업 등록은 성공했으므로 계속 진행
      console.error('[CRITICAL] ⚠️ 큐 워커 트리거 실패 (작업은 등록됨):', {
        error: triggerError instanceof Error ? triggerError.message : String(triggerError),
        stack: triggerError instanceof Error ? triggerError.stack : undefined
      });
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





