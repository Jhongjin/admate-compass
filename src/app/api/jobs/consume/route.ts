import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';
import { ragProcessor, DocumentData } from '@/lib/services/RAGProcessor';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * CRON_SECRET 검증 함수
 * Vercel Cron Jobs는 Authorization 헤더에 Bearer 토큰을 포함합니다
 */
function verifyCronSecret(request: NextRequest): boolean {
  // CRON_SECRET이 설정되지 않은 경우 개발 환경에서는 허용
  if (!process.env.CRON_SECRET) {
    console.warn('⚠️ CRON_SECRET이 설정되지 않았습니다. 개발 환경에서는 허용됩니다.');
    return true;
  }

  const authHeader = request.headers.get('authorization');
  const expectedToken = `Bearer ${process.env.CRON_SECRET}`;
  
  if (authHeader !== expectedToken) {
    console.warn('❌ CRON_SECRET 검증 실패:', {
      received: authHeader ? 'present' : 'missing',
      expected: 'Bearer [CRON_SECRET]'
    });
    return false;
  }

  return true;
}

// 테스트용 간단 Consumer: queued 상태 1건을 processing → completed 처리
async function downloadFromStorage(supabase: any, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function processPdfBuffer(buffer: Buffer): Promise<string> {
  const pdf = (await import('pdf-parse')).default as any;
  const res = await pdf(buffer);
  return res.text || '';
}

async function processDocxBuffer(buffer: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default as any;
  const res = await mammoth.extractRawText({ buffer });
  return res.value || '';
}

async function ocrPdfWithTesseract(buffer: Buffer): Promise<string> {
  // OCR 기능은 현재 비활성화됨 (필요시 패키지 설치 필요: canvas, pdfjs-dist, tesseract.js)
  // 서버리스 환경에서 바이너리 의존성으로 인한 빌드 문제 방지
  throw new Error('OCR 기능은 현재 비활성화되어 있습니다. 텍스트 추출이 실패한 경우 다른 방법을 사용해주세요.');
  
  /* OCR 구현 코드 (주석 처리)
  // Lazy imports to keep cold start small
  const { createCanvas } = await import('canvas');
  // pdfjs-dist legacy build works better on Node
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
  const Tesseract = (await import('tesseract.js')).default as any;

  // Provide fetch/data/worker to pdfjs
  // @ts-ignore
  const loadingTask = (pdfjs as any).getDocument({ data: buffer });
  const pdf = await loadingTask.promise;

  // Tunables via env (with safe defaults)
  const MAX_PAGES = Math.max(1, Math.min(parseInt(process.env.OCR_MAX_PAGES || '10'), 50));
  const SCALE = Math.min(Math.max(parseFloat(process.env.OCR_SCALE || '1.8'), 1.0), 3.0);
  const CONCURRENCY = Math.max(1, Math.min(parseInt(process.env.OCR_CONCURRENCY || '2'), 6));
  const MIN_TEXT_TO_STOP = Math.max(500, parseInt(process.env.OCR_MIN_TEXT || '3000'));

  const pageCount = Math.min(pdf.numPages, MAX_PAGES);
  let out = '';
  let nextPage = 1;
  let stop = false;

  async function worker() {
    while (!stop) {
      const i = nextPage++;
      if (i > pageCount) return;
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      const renderContext = { canvasContext: context, viewport } as any;
      await page.render(renderContext).promise;
      const img = canvas.toBuffer('image/png');
      const lang = process.env.TESSERACT_LANG || 'kor+eng';
      const { data } = await Tesseract.recognize(img, lang, { logger: () => {} });
      if (data?.text) out += '\n\n' + data.text;
      if (out.replace(/\s+/g, ' ').trim().length >= MIN_TEXT_TO_STOP) {
        stop = true;
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);
  return out;
  */
}

function normalizeTablesToMarkdown(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    // detect potential table block: consecutive lines containing delimiters
    const block: string[] = [];
    let j = i;
    while (j < lines.length) {
      const line = lines[j];
      const isTabley = /\t|\s{2,}|,|\|/.test(line) && line.trim().length > 0;
      if (!isTabley) break;
      block.push(line);
      j++;
      if (block.length >= 50) break; // safety limit
    }
    if (block.length >= 2) {
      // convert block to markdown table taking first line as header
      const splitRow = (row: string) => row
        .replace(/\|/g, '|')
        .split(/\t|\s{2,}|,|\|/)
        .map((c) => c.trim())
        .filter(Boolean);
      const header = splitRow(block[0]);
      const rows = block.slice(1).map(splitRow);
      if (header.length >= 2) {
        out.push('');
        out.push(`| ${header.join(' | ')} |`);
        out.push(`| ${header.map(() => '---').join(' | ')} |`);
        for (const r of rows) {
          const padded = [...r];
          while (padded.length < header.length) padded.push('');
          out.push(`| ${padded.slice(0, header.length).join(' | ')} |`);
        }
        out.push('');
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join('\n');
}

/**
 * 큐 처리 핵심 로직 (GET/POST 공통)
 */
async function processQueue() {
  const supabase = await createPureClient();
  try {
    const jobStartMs = Date.now();
    // 1) 픽업할 잡 조회 (우선순위 높은 순, 예약시각 이른 순)
    const { data: job, error: pickErr } = await supabase
      .from('processing_jobs')
      .select('id, document_id, job_type, status, attempts, max_attempts, priority, payload')
      .eq('status', 'queued')
      .order('priority', { ascending: false })
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (pickErr) {
      return NextResponse.json({ success: false, error: '잡 조회 실패', details: pickErr.message }, { status: 500 });
    }
    if (!job) {
      return NextResponse.json({ success: true, message: '대기 중인 잡이 없습니다.' }, { status: 200 });
    }

    // 2) processing 진입(낙관적 업데이트)
    const { error: toProcessingErr } = await supabase
      .from('processing_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'queued');

    if (toProcessingErr) {
      return NextResponse.json({ success: false, error: 'processing 전환 실패', details: toProcessingErr.message }, { status: 409 });
    }

    // 3) 실제 처리 로직
    let extractedText = '';
    const storage = job?.payload?.storage as { bucket: string; path: string; contentType?: string; size?: number } | undefined;
    const fileName = (job?.payload?.fileName as string) || job.document_id;

    if ((job.job_type === 'PDF_PARSE' || job.job_type === 'DOCX_PARSE')) {
      if (!storage?.bucket || !storage?.path) {
        throw new Error('missing storage location in job payload');
      }
      // 저장소에서 파일 다운로드
      const dlStart = Date.now();
      const fileBuffer = await downloadFromStorage(supabase, storage.bucket, storage.path);
      const dlMs = Date.now() - dlStart;
      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error(`downloaded empty file from storage: ${storage.bucket}/${storage.path}`);
      }
      let parseMs = 0;
      if (job.job_type === 'PDF_PARSE') {
        const p0 = Date.now();
        extractedText = await processPdfBuffer(fileBuffer);
        parseMs = Date.now() - p0;
      }
      if (job.job_type === 'DOCX_PARSE') {
        const p0 = Date.now();
        extractedText = await processDocxBuffer(fileBuffer);
        parseMs = Date.now() - p0;
      }

      // 텍스트 추출이 너무 적으면 OCR로 폴백 Job 생성
      const cleanedLength = (extractedText || '').replace(/\s+/g, ' ').trim().length;
      if (cleanedLength < 500) {
        const { error: ocrEnqErr } = await supabase
          .from('processing_jobs')
          .insert({
            document_id: job.document_id,
            job_type: 'OCR',
            status: 'queued',
            priority: Math.max((job.priority || 5) - 1, 1),
            payload: { storage, reason: 'pdf_text_too_short', sourceJobId: job.id },
            scheduled_at: new Date().toISOString()
          });
        if (ocrEnqErr) throw ocrEnqErr;

        const totalMs = Date.now() - jobStartMs;
        // persist metrics row
        await supabase
          .from('processing_metrics')
          .insert({
            job_id: job.id,
            document_id: job.document_id,
            bytes: fileBuffer.length,
            dl_ms: dlMs,
            parse_ms: parseMs,
            total_ms: totalMs,
            text_length: cleanedLength,
            note: 'deferred_to_ocr'
          });

        const { error: markDone } = await supabase
          .from('processing_jobs')
          .update({ status: 'completed', finished_at: new Date().toISOString(), result: { note: 'deferred_to_ocr', cleanedLength, dlMs, parseMs, totalMs, bytes: fileBuffer.length } })
          .eq('id', job.id)
          .eq('status', 'processing');
        if (markDone) throw markDone;
        return NextResponse.json({ success: true, jobId: job.id, status: 'completed', result: { note: 'deferred_to_ocr' } }, { status: 200 });
      }

      // 표/CSV 정규화 (간단 규칙)
      const normalizedText = normalizeTablesToMarkdown(extractedText);

      // 문서 레코드 불러오기(없을 경우 기본 메타 구성)
      const { data: docs } = await supabase.from('documents').select('id, title, file_size, file_type, created_at, updated_at').eq('id', job.document_id).limit(1);
      const nowIso = new Date().toISOString();
      const docData: DocumentData = {
        id: job.document_id,
        title: docs?.[0]?.title || fileName,
        content: normalizedText,
        type: job.job_type === 'PDF_PARSE' ? 'pdf' : 'docx',
        file_size: storage?.size || docs?.[0]?.file_size || fileBuffer.length,
        file_type: storage?.contentType || docs?.[0]?.file_type || (job.job_type === 'PDF_PARSE' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        created_at: docs?.[0]?.created_at || nowIso,
        updated_at: nowIso,
      };

      // 인코딩/청킹/임베딩/저장
      const processResult = await ragProcessor.processDocument(docData, true /* skipDuplicate */);

      // 처리 결과 반영
      const { error: docUpdateErr } = await supabase
        .from('documents')
        .update({ status: processResult.success ? 'indexed' : 'failed', chunk_count: processResult.chunkCount, updated_at: nowIso })
        .eq('id', job.document_id);
      if (docUpdateErr) throw docUpdateErr;

      const finishedResult = { note: 'processed', jobType: job.job_type, chunks: processResult.chunkCount };
      const { error: finishErr } = await supabase
        .from('processing_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString(), result: finishedResult })
        .eq('id', job.id)
        .eq('status', 'processing');
      if (finishErr) throw finishErr;

      return NextResponse.json({ success: true, jobId: job.id, status: 'completed', result: finishedResult }, { status: 200 });
    }

    // OCR 처리 분기
    if (job.job_type === 'OCR') {
      const storage = job?.payload?.storage as { bucket: string; path: string } | undefined;
      if (!storage?.bucket || !storage?.path) {
        throw new Error('missing storage for OCR job');
      }
      const dlStart = Date.now();
      const fileBuffer = await downloadFromStorage(supabase, storage.bucket, storage.path);
      const dlMs = Date.now() - dlStart;
      const ocrStart = Date.now();
      const ocrText = await ocrPdfWithTesseract(fileBuffer);
      const ocrMs = Date.now() - ocrStart;
      const normalizedText = normalizeTablesToMarkdown(ocrText || '');
      const { data: docs } = await supabase.from('documents').select('id, title, created_at').eq('id', job.document_id).limit(1);
      const nowIso = new Date().toISOString();
      const docData: DocumentData = {
        id: job.document_id,
        title: docs?.[0]?.title || job.document_id,
        content: normalizedText,
        type: 'pdf',
        file_size: fileBuffer.length,
        file_type: 'application/pdf',
        created_at: docs?.[0]?.created_at || nowIso,
        updated_at: nowIso,
      };
      const embStart = Date.now();
      const result = await ragProcessor.processDocument(docData, true);
      const embMs = Date.now() - embStart;
      const totalMs = Date.now() - jobStartMs;
      await supabase
        .from('documents')
        .update({ status: result.success ? 'indexed' : 'failed', chunk_count: result.chunkCount, updated_at: nowIso })
        .eq('id', job.document_id);
      await supabase
        .from('processing_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString(), result: { note: 'ocr_completed', chunks: result.chunkCount, bytes: fileBuffer.length, dlMs, ocrMs, embMs, totalMs, textLength: (normalizedText||'').length } })
        .eq('id', job.id)
        .eq('status', 'processing');

      // metrics row
      await supabase
        .from('processing_metrics')
        .insert({
          job_id: job.id,
          document_id: job.document_id,
          bytes: fileBuffer.length,
          dl_ms: dlMs,
          ocr_ms: ocrMs,
          emb_ms: embMs,
          total_ms: totalMs,
          text_length: (normalizedText||'').length,
          chunks: result.chunkCount,
          note: 'ocr_completed'
        });
      return NextResponse.json({ success: true, jobId: job.id, status: 'completed' }, { status: 200 });
    }

    // 비해당 타입은 기존과 동일하게 완료 처리
    const simulatedResult = { note: 'no-op', jobType: job.job_type };
    const { error: finishErr } = await supabase
      .from('processing_jobs')
      .update({ status: 'completed', finished_at: new Date().toISOString(), result: simulatedResult })
      .eq('id', job.id)
      .eq('status', 'processing');
    if (finishErr) throw finishErr;
    return NextResponse.json({ success: true, jobId: job.id, status: 'completed', result: simulatedResult }, { status: 200 });
  } catch (err) {
    try {
      // 실패 시 상태를 failed로 기록하여 stuck 방지
      const message = err instanceof Error ? err.message : String(err);
      const { data: lastJob } = await supabase
        .from('processing_jobs')
        .select('id, status')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastJob?.id) {
        await supabase
          .from('processing_jobs')
          .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
          .eq('id', lastJob.id)
          .eq('status', 'processing');
      }
    } catch (_) {
      // ignore secondary errors
    }
    return NextResponse.json(
      { success: false, error: 'Consumer 처리 오류', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * GET 핸들러 (Vercel Cron Jobs가 사용)
 */
export async function GET(request: NextRequest) {
  // CRON_SECRET 검증
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // 큐 처리 실행
  return processQueue();
}

/**
 * POST 핸들러 (수동 호출 또는 외부 서비스용)
 */
export async function POST(request: NextRequest) {
  // CRON_SECRET 검증 (POST 요청의 경우 선택적 - 수동 호출 허용)
  // Authorization 헤더가 있는 경우에만 검증
  const authHeader = request.headers.get('authorization');
  if (authHeader && !verifyCronSecret(request)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // 큐 처리 실행
  return processQueue();
}



