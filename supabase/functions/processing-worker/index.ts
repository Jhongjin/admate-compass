// Supabase Edge Function (Deno) - processing worker stub
// - Picks one queued job from public.processing_jobs
// - Moves to processing, simulates handling by jobType, then completes
// - Use for early integration tests; replace handlers with real logic later

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type JobType = 'OCR' | 'PDF_PARSE' | 'DOCX_PARSE' | 'CRAWL' | 'EMBEDDING';

function getSupabase() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function pickQueuedJob(supabase: any) {
  const { data, error } = await supabase
    .from('processing_jobs')
    .select('id, document_id, job_type, status, attempts, max_attempts, priority, payload')
    .eq('status', 'queued')
    .order('priority', { ascending: false })
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function moveToProcessing(supabase: any, jobId: string) {
  const { error } = await supabase
    .from('processing_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'queued');
  if (error) throw error;
}

async function completeJob(supabase: any, jobId: string, result: unknown) {
  const { error } = await supabase
    .from('processing_jobs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), result })
    .eq('id', jobId)
    .eq('status', 'processing');
  if (error) throw error;
}

async function failOrRetryJob(supabase: any, job: any, errorMessage: string) {
  const attempts = (job.attempts ?? 0) + 1;
  const canRetry = attempts < (job.max_attempts ?? 3);
  const status = canRetry ? 'retrying' : 'failed';
  const backoffMs = Math.min(60000, 1000 * Math.pow(2, attempts));
  const scheduledAt = canRetry ? new Date(Date.now() + backoffMs).toISOString() : new Date().toISOString();
  const { error } = await supabase
    .from('processing_jobs')
    .update({ status, attempts, error: errorMessage, scheduled_at: scheduledAt, finished_at: new Date().toISOString() })
    .eq('id', job.id);
  if (error) throw error;
}

async function handleJobByType(jobType: JobType, job: any) {
  // 간단 처리 스켈레톤: 문서 상태를 업데이트하고 결과 메시지 반환
  const supabase = getSupabase();
  // 현재는 실제 파일 접근/추출 경로가 없으므로 상태만 정리
  const baseResult: any = { jobType, payload: job.payload ?? {} };

  switch (jobType) {
    case 'PDF_PARSE':
    case 'DOCX_PARSE': {
      // 저장소 정보가 있으면 로깅 (추후 실제 다운로드/추출 연결 포인트)
      const storage = job?.payload?.storage;
      if (storage?.bucket && storage?.path) {
        console.log('storage source:', storage.bucket, storage.path, storage.contentType, storage.size);
      }
      // 문서 상태 갱신 (completed) 및 기본 메시지
      const { error } = await supabase
        .from('documents')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', job.document_id);
      if (error) throw error;
      return { ...baseResult, note: 'parsed (skeleton) - connect real extraction next' };
    }
    case 'OCR': {
      const { error } = await supabase
        .from('documents')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', job.document_id);
      if (error) throw error;
      return { ...baseResult, note: 'ocr (skeleton)' };
    }
    case 'CRAWL':
    case 'EMBEDDING':
    default:
      await new Promise((r) => setTimeout(r, 300));
      return { ...baseResult, note: 'no-op (skeleton)' };
  }
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405 });
    }

    const supabase = getSupabase();
    const job = await pickQueuedJob(supabase);
    if (!job) {
      return new Response(JSON.stringify({ success: true, message: 'no queued jobs' }), { status: 200 });
    }

    await moveToProcessing(supabase, job.id);

    try {
      const result = await handleJobByType(job.job_type as JobType, job);
      await completeJob(supabase, job.id, result);
      return new Response(JSON.stringify({ success: true, jobId: job.id, status: 'completed' }), { status: 200 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await failOrRetryJob(supabase, job, msg);
      return new Response(JSON.stringify({ success: false, jobId: job.id, status: 'failed_or_retry', error: msg }), { status: 200 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: msg }), { status: 500 });
  }
}

// Serve function
// deno-lint-ignore no-unused-vars
serve(handler);


