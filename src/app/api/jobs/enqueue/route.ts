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
    // Vercel serverless 환경에서는 fetch 대신 import()를 사용하여 직접 함수 호출
    try {
      console.error('[CRITICAL] 🚀 큐 워커 트리거 시작 (작업 ID: ' + data.id + ')');
      
      // Vercel 서버리스 환경에서 import()로 실행된 함수의 Supabase 쿼리가 멈추는 문제
      // 해결책: fetch()를 사용하여 /api/jobs/consume를 직접 호출
      // 이렇게 하면 정상적인 API 요청 컨텍스트에서 실행되므로 Supabase 쿼리가 정상 작동
      // Vercel 환경 변수 우선순위: VERCEL_URL > NEXT_PUBLIC_APP_URL > localhost
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');
      const consumeUrl = new URL('/api/jobs/consume', baseUrl);
      
      // 백그라운드로 실행 (await 없이)
      fetch(consumeUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // CRON_SECRET이 있으면 Authorization 헤더 추가
          ...(process.env.CRON_SECRET ? { 'Authorization': `Bearer ${process.env.CRON_SECRET}` } : {})
        },
        // 중요: signal을 설정하지 않음 (백그라운드 실행이므로)
      })
        .then(async (response) => {
          console.error('[CRITICAL] 📥 processQueue 응답 수신:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok
          });
          
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
            // text 변수를 다시 읽어야 함 (이미 한 번 읽었으므로)
            const responseClone = response.clone();
            const errorText = await responseClone.text();
            console.error('[CRITICAL] ✅ 큐 워커 처리 완료 (JSON 파싱 실패):', {
              status: response.status,
              response: errorText.substring(0, 500),
              parseError: parseError instanceof Error ? parseError.message : String(parseError)
            });
          }
        })
        .catch(err => {
          // 에러 발생해도 무시 (Cron Job이 처리할 수 있음)
          console.error('[CRITICAL] ❌ 큐 워커 트리거 에러:', {
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
            name: err instanceof Error ? err.name : undefined,
            cause: err instanceof Error && 'cause' in err ? err.cause : undefined
          });
        });
      
      console.error('[CRITICAL] ✅ 큐 워커 트리거 완료 (백그라운드 fetch 실행 중)');
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





