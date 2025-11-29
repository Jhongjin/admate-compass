import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';
import { ragProcessor, DocumentData } from '@/lib/services/RAGProcessor';
import { simpleTextSplitter, TextSplit } from '@/lib/services/SimpleTextSplitter';
import { sitemapDiscoveryService } from '@/lib/services/SitemapDiscoveryService';
import { PuppeteerCrawlingService } from '@/lib/services/PuppeteerCrawlingService';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 600; // Pro 플랜: 최대 10분 (큰 파일 처리 지원 - 13MB+ 파일 처리 가능)
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
async function downloadFromStorage(supabase: any, bucket: string, path: string, retries: number = 3): Promise<Buffer> {
  const downloadStartMs = Date.now();
  console.log(`📥 Storage 다운로드 시작: ${bucket}/${path} (재시도 ${retries}회)`);
  
  // Storage 다운로드 타임아웃 설정 (90초 - Supabase Gateway Timeout 및 네트워크 지연 대응)
  const DOWNLOAD_TIMEOUT = 90000; // 90초 (504 Gateway Timeout 대응, 큰 파일 다운로드 고려)
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const downloadPromise = (async () => {
        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (error) {
          // Supabase Storage 에러를 더 자세히 로깅
          console.error(`❌ Supabase Storage 에러 (시도 ${attempt}/${retries}):`, {
            error: error.message || error,
            status: error.statusCode || 'unknown',
            originalError: error.originalError || error
          });
          throw error;
        }
        if (!data) {
          throw new Error('Storage에서 데이터를 받지 못했습니다.');
        }
        const arrayBuffer = await data.arrayBuffer();
        return Buffer.from(arrayBuffer);
      })();
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Storage 다운로드 타임아웃 (${DOWNLOAD_TIMEOUT / 1000}초): ${bucket}/${path}`));
        }, DOWNLOAD_TIMEOUT);
      });
      
      const buffer = await Promise.race([downloadPromise, timeoutPromise]);
      const downloadMs = Date.now() - downloadStartMs;
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
      console.log(`✅ Storage 다운로드 완료: ${sizeMB}MB (${downloadMs}ms, 시도 ${attempt}/${retries})`);
      return buffer;
    } catch (error: any) {
      const downloadMs = Date.now() - downloadStartMs;
      const isLastAttempt = attempt === retries;
      const isTimeout = error?.message?.includes('타임아웃') || error?.originalError?.status === 504;
      const isGatewayTimeout = error?.originalError?.status === 504 || error?.status === 504;
      
      console.error(`❌ Storage 다운로드 실패 (시도 ${attempt}/${retries}, ${downloadMs}ms):`, {
        error: error?.message || error,
        status: error?.status || error?.originalError?.status,
        isTimeout,
        isGatewayTimeout,
        isLastAttempt
      });
      
      // 마지막 시도이거나 타임아웃이 아닌 경우 즉시 실패
      if (isLastAttempt) {
        // Gateway Timeout인 경우 더 명확한 에러 메시지
        if (isGatewayTimeout) {
          throw new Error(`Storage 다운로드 실패: Supabase Gateway Timeout (504). 파일이 너무 크거나 네트워크 문제일 수 있습니다. 경로: ${bucket}/${path}`);
        }
        throw error;
      }
      
      // 재시도 전 대기 (지수 백오프)
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ 재시도 전 대기: ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  // 이 코드는 실행되지 않아야 하지만 TypeScript를 위해 필요
  throw new Error('Storage 다운로드 실패: 모든 재시도 실패');
}

async function processPdfBuffer(buffer: Buffer): Promise<string> {
  const pdf = (await import('pdf-parse')).default as any;
  const startMs = Date.now();
  
  // 큰 파일의 경우 옵션 최적화
  const fileSizeMB = buffer.length / (1024 * 1024);
  const options: any = {};
  
  if (fileSizeMB > 10) {
    // 큰 파일은 최대 페이지 수 제한 (메모리 및 시간 절약)
    // pdf-parse는 기본적으로 모든 페이지를 처리하지만, 
    // 매우 큰 파일의 경우 부분 처리 고려
    console.log(`📄 큰 PDF 처리 시작 (${fileSizeMB.toFixed(2)}MB) - 최적화 옵션 적용`);
  }
  
  try {
    // PDF 파싱 타임아웃 설정 (5분)
    // 큰 파일(13MB+) 파싱에 5-8분 소요 가능하므로 타임아웃 설정
    const PDF_PARSE_TIMEOUT = 300000; // 5분
    
    // 경고 메시지 필터링 (TT: undefined function 경고는 무시)
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: any[]) => {
      const message = args.join(' ');
      if (message.includes('TT: undefined function')) {
        // PDF 폰트 경고는 무시 (이미지 기반 PDF에서 흔히 발생)
        warnings.push(message);
      } else {
        originalWarn.apply(console, args);
      }
    };
    
    const parsePromise = pdf(buffer, options);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`PDF 파싱 타임아웃 (${PDF_PARSE_TIMEOUT / 60000}분) - 파일 크기: ${fileSizeMB.toFixed(2)}MB`));
      }, PDF_PARSE_TIMEOUT);
    });
    
    const res = await Promise.race([parsePromise, timeoutPromise]);
    
    // 원래 console.warn 복원
    console.warn = originalWarn;
    
    const parseMs = Date.now() - startMs;
    const textLengthKB = (res.text?.length || 0) / 1024;
    
    // 폰트 경고가 있었는지 확인
    if (warnings.length > 0) {
      console.warn(`⚠️ PDF 폰트 경고 ${warnings.length}건 발생 (이미지 기반 PDF일 수 있음):`, {
        uniqueWarnings: [...new Set(warnings)].slice(0, 3), // 중복 제거 후 최대 3개만 표시
        textLength: res.text?.length || 0,
        pages: res.numpages || 'unknown'
      });
    }
    
    // 텍스트 추출이 매우 짧은 경우 경고 (파일명만 추출된 경우)
    const extractedText = res.text || '';
    if (extractedText.length < 100 && fileSizeMB > 0.1) {
      console.warn(`⚠️ PDF 텍스트 추출이 매우 짧습니다 (${extractedText.length}자). 이미지 기반 PDF이거나 텍스트 추출이 실패했을 수 있습니다.`, {
        fileSizeMB: fileSizeMB.toFixed(2),
        textLength: extractedText.length,
        textPreview: extractedText.substring(0, 200),
        pages: res.numpages || 'unknown',
        note: '이미지 기반 PDF의 경우 OCR이 필요하지만 현재 OCR 기능은 비활성화되어 있습니다.'
      });
    }
    
    console.log(`✅ PDF 파싱 완료:`, {
      fileSizeMB: fileSizeMB.toFixed(2),
      textLengthKB: textLengthKB.toFixed(2),
      pages: res.numpages || 'unknown',
      parseTime: `${parseMs}ms (${(parseMs / 1000).toFixed(1)}초)`,
      throughput: `${(textLengthKB / (parseMs / 1000)).toFixed(2)}KB/s`,
      fontWarnings: warnings.length > 0 ? `${warnings.length}건` : '없음'
    });
    
    return extractedText;
  } catch (error) {
    const parseMs = Date.now() - startMs;
    console.error(`❌ PDF 파싱 실패 (${parseMs}ms):`, error);
    throw error;
  }
}

async function processDocxBuffer(buffer: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default as any;
  const startMs = Date.now();
  const bufferSizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
  
  console.log(`📄 DOCX 파싱 시작: ${bufferSizeMB}MB`);
  
  try {
    // DOCX 파싱 타임아웃 설정 (2분 - 작은 파일은 매우 빠르게 처리되어야 함)
    const DOCX_PARSE_TIMEOUT = 120000; // 2분
    const parsePromise = mammoth.extractRawText({ buffer });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`DOCX 파싱 타임아웃 (${DOCX_PARSE_TIMEOUT / 60000}분) - 파일 크기: ${bufferSizeMB}MB`));
      }, DOCX_PARSE_TIMEOUT);
    });
    
    const res = await Promise.race([parsePromise, timeoutPromise]);
    const parseMs = Date.now() - startMs;
    const extractedText = res.value || '';
    const textLengthKB = (extractedText.length / 1024).toFixed(2);
    
    // 빈 텍스트 체크 및 에러 throw
    if (!extractedText || extractedText.trim().length === 0) {
      const errorMsg = 'DOCX에서 텍스트를 추출할 수 없습니다. 파일이 손상되었거나 텍스트가 없습니다.';
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    console.log(`✅ DOCX 파싱 완료:`, {
      textLengthKB: textLengthKB,
      parseTime: `${parseMs}ms (${(parseMs / 1000).toFixed(1)}초)`,
      throughput: `${(parseFloat(textLengthKB) / (parseMs / 1000)).toFixed(2)}KB/s`,
      bufferSizeMB: bufferSizeMB
    });
    
    return extractedText;
  } catch (error) {
    const parseMs = Date.now() - startMs;
    console.error(`❌ DOCX 파싱 실패 (${parseMs}ms):`, error);
    
    // 에러 발생 시 상세 정보 로깅
    console.error('❌ DOCX 파싱 에러 상세:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      bufferSize: buffer.length,
      bufferSizeMB: bufferSizeMB,
      elapsedTime: `${(parseMs / 1000).toFixed(1)}초`
    });
    
    throw error;
  }
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
export async function processQueue() {
  const supabase = await createPureClient();
  
  // 타임아웃된 작업 감지 및 처리 (2시간 이상 processing 상태)
  // 10시간 지연 문제를 해결하기 위해 타임아웃을 2시간으로 설정
  const TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2시간
  const timeoutThreshold = new Date(Date.now() - TIMEOUT_MS).toISOString();
  
  const { data: stuckJobs, error: stuckError } = await supabase
    .from('processing_jobs')
    .select('id, status, started_at, payload')
    .eq('status', 'processing')
    .lt('started_at', timeoutThreshold);
  
  if (!stuckError && stuckJobs && stuckJobs.length > 0) {
    console.warn(`⚠️ 타임아웃된 작업 감지: ${stuckJobs.length}개 작업이 2시간 이상 진행 중입니다.`, 
      stuckJobs.map(j => ({ id: j.id, url: (j.payload as any)?.url, started_at: j.started_at, elapsedHours: ((Date.now() - new Date(j.started_at).getTime()) / (60 * 60 * 1000)).toFixed(2) })));
    
    // 타임아웃된 작업을 failed로 변경
    const stuckJobIds = stuckJobs.map(j => j.id);
    await supabase
      .from('processing_jobs')
      .update({
        status: 'failed',
        error: '작업 타임아웃: 2시간 이상 진행 중',
        finished_at: new Date().toISOString(),
      })
      .in('id', stuckJobIds);
    
    console.log(`✅ 타임아웃된 ${stuckJobs.length}개 작업을 failed 상태로 변경했습니다.`);
  }
  const queueStartMs = Date.now();
  console.log(`🚀 큐 처리 시작: ${new Date().toISOString()}`);
  
  try {
    const jobStartMs = Date.now();
    // 1) 픽업할 잡 조회 (우선순위 높은 순, 예약시각 이른 순)
    // retrying 상태도 포함하여 재시도 작업 처리
    console.log(`🔍 큐에서 작업 조회 중...`);
    const { data: job, error: pickErr } = await supabase
      .from('processing_jobs')
      .select('id, document_id, job_type, status, attempts, max_attempts, priority, payload')
      .in('status', ['queued', 'retrying']) // retrying 상태도 처리
      .order('priority', { ascending: false })
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    
    const pickMs = Date.now() - jobStartMs;
    console.log(`📋 작업 조회 완료: ${pickMs}ms`, {
      found: !!job,
      jobId: job?.id,
      jobType: job?.job_type,
      documentId: job?.document_id
    });

    if (pickErr) {
      console.error(`❌ 작업 조회 실패:`, pickErr);
      return NextResponse.json({ success: false, error: '잡 조회 실패', details: pickErr.message }, { status: 500 });
    }
    if (!job) {
      const totalMs = Date.now() - queueStartMs;
      console.log(`ℹ️ 대기 중인 작업 없음 (${totalMs}ms)`);
      return NextResponse.json({ success: true, message: '대기 중인 잡이 없습니다.' }, { status: 200 });
    }
    
    console.log(`✅ 작업 선택됨:`, {
      jobId: job.id,
      documentId: job.document_id,
      jobType: job.job_type,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.max_attempts
    });

    // 2) processing 진입(낙관적 업데이트)
    // queued 또는 retrying 상태에서 processing으로 전환
    const { error: toProcessingErr, data: updatedJob } = await supabase
      .from('processing_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', job.id)
      .in('status', ['queued', 'retrying']) // retrying 상태도 처리
      .select('status')
      .single();

    if (toProcessingErr) {
      // 현재 작업 상태 확인 (디버깅용)
      const { data: currentJob } = await supabase
        .from('processing_jobs')
        .select('id, status, job_type, document_id, attempts')
        .eq('id', job.id)
        .maybeSingle();
      
      console.warn('⚠️ processing 전환 실패:', {
        jobId: job.id,
        expectedStatus: ['queued', 'retrying'],
        currentStatus: currentJob?.status,
        jobType: currentJob?.job_type,
        documentId: currentJob?.document_id,
        attempts: currentJob?.attempts,
        error: toProcessingErr.message
      });
      
      // 작업이 이미 processing 상태인 경우 (다른 워커가 처리 중)
      if (currentJob?.status === 'processing') {
        return NextResponse.json({ 
          success: false, 
          error: '작업이 이미 처리 중입니다. 다른 워커가 처리하고 있을 수 있습니다.',
          currentStatus: currentJob.status,
          details: toProcessingErr.message 
        }, { status: 409 });
      }
      
      // 작업이 completed, failed, cancelled 상태인 경우
      if (currentJob && ['completed', 'failed', 'cancelled'].includes(currentJob.status)) {
        return NextResponse.json({ 
          success: false, 
          error: `작업이 이미 ${currentJob.status} 상태입니다. 재처리가 필요하면 새로운 작업을 생성하거나 작업을 삭제하고 다시 시도해주세요.`,
          currentStatus: currentJob.status,
          details: toProcessingErr.message 
        }, { status: 409 });
      }
      
      return NextResponse.json({ 
        success: false, 
        error: 'processing 전환 실패', 
        currentStatus: currentJob?.status || 'unknown',
        details: toProcessingErr.message 
      }, { status: 409 });
    }

    // 취소된 작업인지 확인 (다른 워커가 취소했을 수 있음)
    if (updatedJob?.status === 'cancelled') {
      console.log(`⚠️ 작업이 취소되었습니다: ${job.id}`);
      return NextResponse.json({ success: true, message: '작업이 취소되었습니다.', status: 'cancelled' }, { status: 200 });
    }

    // 3) 실제 처리 로직
    let extractedText = '';
    let dlMs = 0;
    let parseMs = 0;
    let storage = job?.payload?.storage as { bucket: string; path: string; contentType?: string; size?: number } | undefined;
    // 원본 파일명 우선 사용, 없으면 정리된 파일명, 그래도 없으면 document_id
    const originalFileName = (job?.payload?.originalFileName as string) || null;
    const sanitizedFileName = (job?.payload?.sanitizedFileName as string) || (job?.payload?.fileName as string) || null;
    const fileName = originalFileName || sanitizedFileName || job.document_id;
    const fileSize = storage?.size || (job?.payload?.fileSize as number) || 0;
    const isReprocess = job?.payload?.reprocess === true;
    const fileSizeMB = fileSize > 0 ? (fileSize / (1024 * 1024)).toFixed(2) : '0';
    
    // PDF_PARSE/DOCX_PARSE 작업 처리 전에 문서 타입 확인
    if ((job.job_type === 'PDF_PARSE' || job.job_type === 'DOCX_PARSE') && job.document_id) {
      // 문서 타입 확인 (URL 크롤링 문서인지 확인)
      const { data: docCheck, error: docCheckError } = await supabase
        .from('documents')
        .select('type, url, title')
        .eq('id', job.document_id)
        .maybeSingle();
      
      if (!docCheckError && docCheck && (docCheck.type === 'url' || docCheck.url)) {
        // URL 크롤링 문서에 대해 PDF_PARSE/DOCX_PARSE 작업이 생성된 경우
        const errorMessage = `잘못된 작업 타입: 이 문서는 URL 크롤링 문서입니다 (type: ${docCheck.type || 'url'}, title: ${docCheck.title || 'N/A'}). PDF_PARSE/DOCX_PARSE 작업으로는 처리할 수 없습니다. 작업을 자동으로 삭제했습니다. URL 크롤링 작업(CRAWL_SEED)을 생성하거나 문서를 삭제하고 다시 크롤링해주세요.`;
        
        console.error('❌ 잘못된 작업 타입 감지 - 작업 자동 삭제:', {
          jobId: job.id,
          jobType: job.job_type,
          documentId: job.document_id,
          documentType: docCheck.type,
          documentUrl: docCheck.url,
          documentTitle: docCheck.title
        });
        
        // 작업을 자동으로 삭제 (failed 상태로 남겨두지 않음)
        await supabase
          .from('processing_jobs')
          .delete()
          .eq('id', job.id);
        
        console.log(`✅ 잘못된 작업 타입 자동 삭제 완료: ${job.id}`);
        
        return NextResponse.json(
          { 
            success: false, 
            error: errorMessage,
            deleted: true,
            documentType: docCheck.type,
            documentTitle: docCheck.title
          },
          { status: 400 }
        );
      }
    }
    
    // 큰 파일 처리 시작 로그
    if (fileSize > 10 * 1024 * 1024) {
      console.log(`📦 큰 파일 처리 시작: ${fileName} (${fileSizeMB}MB)`);
      console.log(`⏱️ 예상 처리 시간: 3-5분 (큰 파일은 더 오래 걸릴 수 있습니다)`);
    }

    if ((job.job_type === 'PDF_PARSE' || job.job_type === 'DOCX_PARSE')) {
      // 재처리인 경우: Storage 파일이 없으면 Storage에서 파일 찾기 시도
      if (isReprocess && (!storage?.bucket || !storage?.path)) {
        console.log('🔄 재처리 모드: Storage 정보 없음, Storage에서 파일 찾기 시도');
        
        // 문서 정보 조회
        const { data: docData, error: docError } = await supabase
          .from('documents')
          .select('content, title, file_type, file_size, id, type, url')
          .eq('id', job.document_id)
          .single();
        
        if (docError || !docData) {
          throw new Error(`재처리: 문서를 찾을 수 없습니다: ${docError?.message || 'Unknown error'}`);
        }

        // URL 크롤링 문서인 경우 PDF_PARSE/DOCX_PARSE 로직을 건너뛰고 에러 반환
        if (docData.type === 'url' || docData.url) {
          throw new Error(`재처리: 이 문서는 URL 크롤링 문서입니다 (type: ${docData.type || 'url'}). PDF_PARSE/DOCX_PARSE 작업으로는 재처리할 수 없습니다. URL 크롤링 작업을 다시 생성하거나 문서를 삭제하고 다시 크롤링해주세요.`);
        }
        
        // Storage에서 파일 찾기 시도 (문서 ID 기반 경로)
        const STORAGE_BUCKET = 'documents';
        let foundFile: { path: string; size: number } | null = null;
        
        // Storage에서 파일 목록 조회
        try {
          console.log(`🔍 Storage에서 파일 검색 시작: ${STORAGE_BUCKET}/${job.document_id}`);
          const { data: files, error: listError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .list(job.document_id, { 
              limit: 10, 
              sortBy: { column: 'created_at', order: 'desc' },
              search: ''
            });
          
          if (listError) {
            console.error('❌ Storage 목록 조회 에러:', listError);
            // 폴더가 없을 수도 있으므로 에러는 무시하고 계속 진행
          } else if (files && files.length > 0) {
            // job_type에 맞는 파일 우선 찾기, 없으면 다른 타입 파일 찾기
            const jobTypeExtension = job.job_type === 'PDF_PARSE' ? '.pdf' : '.docx';
            const targetFile = files.find(f => 
              f.name.toLowerCase().endsWith(jobTypeExtension)
            ) || files.find(f => 
              f.name.toLowerCase().endsWith('.pdf') || 
              f.name.toLowerCase().endsWith('.docx')
            ) || files[0]; // job_type에 맞는 파일 우선, 없으면 다른 타입, 그래도 없으면 첫 번째 파일
            
            foundFile = {
              path: `${job.document_id}/${targetFile.name}`,
              size: targetFile.metadata?.size || 0
            };
            
            // 실제 파일 확장자 확인 및 경고
            const actualExtension = targetFile.name.toLowerCase().endsWith('.pdf') ? '.pdf' : 
                                   targetFile.name.toLowerCase().endsWith('.docx') ? '.docx' : 'unknown';
            const expectedExtension = jobTypeExtension;
            
            if (actualExtension !== expectedExtension) {
              console.warn(`⚠️ 파일 타입 불일치: job_type=${job.job_type}, 실제 파일=${actualExtension}, 예상=${expectedExtension}`);
            }
            
            console.log(`✅ Storage에서 파일 발견: ${foundFile.path} (${foundFile.size} bytes, 실제 확장자: ${actualExtension})`);
          } else {
            console.warn(`⚠️ Storage에 파일이 없습니다: ${STORAGE_BUCKET}/${job.document_id}`);
          }
        } catch (storageError) {
          console.error('❌ Storage 목록 조회 예외:', storageError);
        }
        
        // Storage에서 파일을 찾았으면 다운로드
        if (foundFile) {
          try {
            const dlStart = Date.now();
            console.log(`⬇️ 재처리: Storage에서 파일 다운로드 시작: ${STORAGE_BUCKET}/${foundFile.path}`);
            const fileBuffer = await downloadFromStorage(supabase, STORAGE_BUCKET, foundFile.path);
            dlMs = Date.now() - dlStart;
            
            if (!fileBuffer || fileBuffer.length === 0) {
              throw new Error(`재처리: Storage에서 다운로드한 파일이 비어있습니다: ${foundFile.path}`);
            }
            
            const downloadedSizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2);
            console.log(`✅ 재처리: 파일 다운로드 완료: ${downloadedSizeMB}MB (${dlMs}ms)`);
            
            // 실제 파일 확장자 확인 (Storage 파일명 기준)
            const actualExtension = foundFile.path.toLowerCase().endsWith('.pdf') ? 'pdf' : 
                                   foundFile.path.toLowerCase().endsWith('.docx') ? 'docx' : 
                                   foundFile.path.toLowerCase().endsWith('.doc') ? 'docx' : 'unknown';
            
            // 실제 파일 타입 (MIME type) 결정
            const actualFileType = actualExtension === 'pdf' ? 'application/pdf' :
                                  actualExtension === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                                  'application/octet-stream';
            
            // 파일 타입에 따라 텍스트 추출 (실제 파일 확장자 우선, 없으면 job_type 사용)
            const fileTypeToUse = actualExtension !== 'unknown' ? actualExtension : 
                                 (job.job_type === 'PDF_PARSE' ? 'pdf' : 'docx');
            
            if (actualExtension !== 'unknown' && actualExtension !== fileTypeToUse && job.job_type) {
              const expectedType = job.job_type === 'PDF_PARSE' ? 'pdf' : 'docx';
              console.warn(`⚠️ 재처리: 파일 타입 불일치 - job_type=${job.job_type}, 실제 파일=${actualExtension}, 실제 파일 타입으로 처리합니다.`);
            }
            
            // file_type을 실제 파일 확장자에 맞게 업데이트 (docData 생성 시 사용)
            if (actualExtension !== 'unknown') {
              if (!storage) {
                // storage가 없으면 새 객체 생성 (필수 속성 포함)
                storage = {
                  bucket: STORAGE_BUCKET,
                  path: foundFile.path
                };
              }
              storage.contentType = actualFileType;
              console.log(`📝 재처리: file_type 업데이트 - ${actualExtension} (${actualFileType})`);
            }
            
            if (fileTypeToUse === 'pdf') {
              const p0 = Date.now();
              try {
                extractedText = await processPdfBuffer(fileBuffer);
                parseMs = Date.now() - p0;
                const textLengthKB = (extractedText.length / 1024).toFixed(2);
                console.log(`✅ 재처리: PDF 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
              } catch (parseError) {
                parseMs = Date.now() - p0;
                const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
                console.error(`❌ 재처리: PDF 파싱 실패 (${parseMs}ms):`, errorMsg);
                throw new Error(`재처리: PDF 파일 파싱 실패: 파일이 손상되었거나 유효한 PDF 파일이 아닙니다. (${errorMsg})`);
              }
            } else if (fileTypeToUse === 'docx') {
              const p0 = Date.now();
              try {
                extractedText = await processDocxBuffer(fileBuffer);
                parseMs = Date.now() - p0;
                const textLengthKB = (extractedText.length / 1024).toFixed(2);
                console.log(`✅ 재처리: DOCX 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
              } catch (parseError) {
                parseMs = Date.now() - p0;
                const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
                console.error(`❌ 재처리: DOCX 파싱 실패 (${parseMs}ms):`, errorMsg);
                throw new Error(`재처리: DOCX 파일 파싱 실패: 파일이 손상되었거나 유효한 DOCX 파일이 아닙니다. (${errorMsg})`);
              }
            } else {
              throw new Error(`재처리: 지원하지 않는 파일 타입입니다. (실제 파일: ${actualExtension}, job_type: ${job.job_type})`);
            }
          } catch (downloadError) {
            console.error('❌ 재처리: Storage 다운로드 실패:', downloadError);
            // Storage 다운로드 실패 시 documents.content에서 텍스트 가져오기 시도
            throw new Error(`재처리: Storage 파일 다운로드 실패. 원본 파일을 다시 업로드해주세요. (${downloadError instanceof Error ? downloadError.message : String(downloadError)})`);
          }
        } else {
          // Storage에서 파일을 찾지 못한 경우
          console.log('🔄 재처리 모드: Storage 파일 없음');
          
          // content가 BINARY_DATA로 시작하는 경우
          if (docData.content && docData.content.startsWith('BINARY_DATA:')) {
            // Storage에서 파일을 다시 한 번 더 시도 (다른 경로 검색)
            console.log('🔍 BINARY_DATA 감지 - Storage 전체 검색 시도');
            
            try {
              // Storage 루트에서 파일 검색 (문서 ID 포함 파일명)
              const { data: allFiles, error: searchError } = await supabase.storage
                .from(STORAGE_BUCKET)
                .list('', { 
                  limit: 100,
                  search: job.document_id
                });
              
              if (!searchError && allFiles && allFiles.length > 0) {
                // 문서 ID가 포함된 파일 찾기
                const matchingFile = allFiles.find(f => 
                  f.name.includes(job.document_id) && 
                  (f.name.toLowerCase().endsWith('.pdf') || f.name.toLowerCase().endsWith('.docx'))
                );
                
                if (matchingFile) {
                  foundFile = {
                    path: matchingFile.name,
                    size: matchingFile.metadata?.size || 0
                  };
                  console.log(`✅ Storage 전체 검색으로 파일 발견: ${foundFile.path}`);
                  
                  // 파일 다운로드 및 텍스트 추출
                  const dlStart = Date.now();
                  const fileBuffer = await downloadFromStorage(supabase, STORAGE_BUCKET, foundFile.path);
                  dlMs = Date.now() - dlStart;
                  
                  if (fileBuffer && fileBuffer.length > 0) {
                    const downloadedSizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2);
                    console.log(`✅ 재처리: 파일 다운로드 완료: ${downloadedSizeMB}MB (${dlMs}ms)`);
                    
                    // 실제 파일 확장자 확인 (Storage 파일명 기준)
                    const actualExtension = foundFile.path.toLowerCase().endsWith('.pdf') ? 'pdf' : 
                                           foundFile.path.toLowerCase().endsWith('.docx') ? 'docx' : 
                                           foundFile.path.toLowerCase().endsWith('.doc') ? 'docx' : 'unknown';
                    
                    // 파일 타입에 따라 텍스트 추출 (실제 파일 확장자 우선, 없으면 job_type 사용)
                    const fileTypeToUse = actualExtension !== 'unknown' ? actualExtension : 
                                         (job.job_type === 'PDF_PARSE' ? 'pdf' : 'docx');
                    
                    if (actualExtension !== 'unknown' && actualExtension !== fileTypeToUse && job.job_type) {
                      const expectedType = job.job_type === 'PDF_PARSE' ? 'pdf' : 'docx';
                      console.warn(`⚠️ 재처리: 파일 타입 불일치 - job_type=${job.job_type}, 실제 파일=${actualExtension}, 실제 파일 타입으로 처리합니다.`);
                    }
                    
                    if (fileTypeToUse === 'pdf') {
                      const p0 = Date.now();
                      try {
                        extractedText = await processPdfBuffer(fileBuffer);
                        parseMs = Date.now() - p0;
                        const textLengthKB = (extractedText.length / 1024).toFixed(2);
                        console.log(`✅ 재처리: PDF 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
                      } catch (parseError) {
                        parseMs = Date.now() - p0;
                        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
                        console.error(`❌ 재처리: PDF 파싱 실패 (${parseMs}ms):`, errorMsg);
                        throw new Error(`재처리: PDF 파일 파싱 실패: 파일이 손상되었거나 유효한 PDF 파일이 아닙니다. (${errorMsg})`);
                      }
                    } else if (fileTypeToUse === 'docx') {
                      const p0 = Date.now();
                      try {
                        extractedText = await processDocxBuffer(fileBuffer);
                        parseMs = Date.now() - p0;
                        const textLengthKB = (extractedText.length / 1024).toFixed(2);
                        console.log(`✅ 재처리: DOCX 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
                      } catch (parseError) {
                        parseMs = Date.now() - p0;
                        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
                        console.error(`❌ 재처리: DOCX 파싱 실패 (${parseMs}ms):`, errorMsg);
                        throw new Error(`재처리: DOCX 파일 파싱 실패: 파일이 손상되었거나 유효한 DOCX 파일이 아닙니다. (${errorMsg})`);
                      }
                    } else {
                      throw new Error(`재처리: 지원하지 않는 파일 타입입니다. (실제 파일: ${actualExtension}, job_type: ${job.job_type})`);
                    }
                  }
                }
              }
            } catch (searchError) {
              console.error('❌ Storage 전체 검색 실패:', searchError);
            }
            
            // 여전히 파일을 찾지 못한 경우
            if (!extractedText || extractedText.length === 0) {
              throw new Error('재처리: 바이너리 데이터는 재처리할 수 없습니다. Storage에서 원본 파일을 찾을 수 없습니다. 원본 파일을 다시 업로드해주세요.');
            }
          } else {
            // BINARY_DATA가 아닌 경우 documents.content에서 텍스트 가져오기
            console.log('🔄 재처리 모드: documents.content에서 텍스트 가져오기');
            extractedText = docData.content || '';
            console.log(`✅ 재처리: documents.content에서 텍스트 가져옴 (${extractedText.length}자)`);
            
            // 재처리 모드에서 텍스트가 비어있으면 에러
            const cleanedLength = (extractedText || '').replace(/\s+/g, ' ').trim().length;
            if (cleanedLength === 0) {
              throw new Error('재처리: documents.content에 텍스트가 없고 Storage에서도 파일을 찾을 수 없습니다. 원본 파일을 다시 업로드해주세요.');
            }
            
            if (cleanedLength < 100) {
              console.warn(`⚠️ 재처리: 텍스트가 매우 짧습니다 (${cleanedLength}자). 청킹 결과가 제한적일 수 있습니다.`);
            }
            
            // 재처리 모드에서는 dlMs와 parseMs는 0으로 유지
          }
        }
      } else {
        // 일반 처리: Storage에서 파일 다운로드
        if (!storage?.bucket || !storage?.path) {
          throw new Error('missing storage location in job payload');
        }
        // 저장소에서 파일 다운로드
        const dlStart = Date.now();
        console.log(`⬇️ Storage에서 파일 다운로드 시작: ${storage.bucket}/${storage.path}`);
        
        let fileBuffer: Buffer;
        try {
          fileBuffer = await downloadFromStorage(supabase, storage.bucket, storage.path);
          dlMs = Date.now() - dlStart;
        } catch (downloadError) {
          dlMs = Date.now() - dlStart;
          const errorMsg = downloadError instanceof Error ? downloadError.message : String(downloadError);
          console.error(`❌ Storage 다운로드 실패 (일반 처리 모드):`, {
            error: errorMsg,
            bucket: storage.bucket,
            path: storage.path,
            fileName: fileName,
            fileSize: fileSize,
            elapsedMs: dlMs,
            note: '일반 처리 모드에서는 Storage 다운로드 실패 시 documents.content로 폴백하지 않습니다. 재처리 모드를 사용하거나 파일을 다시 업로드해주세요.'
          });
          
          // 일반 처리 모드에서는 Storage 다운로드 실패 시 즉시 에러 throw
          // 재처리 모드가 아니므로 documents.content로 폴백하지 않음
          throw new Error(`Storage 다운로드 실패: ${errorMsg}. 일반 처리 모드에서는 Storage에서 파일을 다운로드할 수 없으면 처리를 중단합니다. 재처리 모드를 사용하거나 파일을 다시 업로드해주세요.`);
        }
        
        if (!fileBuffer || fileBuffer.length === 0) {
          throw new Error(`downloaded empty file from storage: ${storage.bucket}/${storage.path}`);
        }
        
        const downloadedSizeMB = (fileBuffer.length / (1024 * 1024)).toFixed(2);
        console.log(`✅ 파일 다운로드 완료: ${downloadedSizeMB}MB (${dlMs}ms)`);
        
        // 큰 파일 처리 시 중간 상태 업데이트 (타임아웃 방지)
        if (fileBuffer.length > 10 * 1024 * 1024) {
          console.log(`📄 큰 파일 텍스트 추출 시작... (${downloadedSizeMB}MB)`);
        }
        
        if (job.job_type === 'PDF_PARSE') {
          const p0 = Date.now();
          extractedText = await processPdfBuffer(fileBuffer);
          parseMs = Date.now() - p0;
          const textLengthKB = (extractedText.length / 1024).toFixed(2);
          console.log(`✅ PDF 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
        }
        if (job.job_type === 'DOCX_PARSE') {
          const p0 = Date.now();
          try {
            extractedText = await processDocxBuffer(fileBuffer);
            parseMs = Date.now() - p0;
            const textLengthKB = (extractedText.length / 1024).toFixed(2);
            console.log(`✅ DOCX 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
          } catch (parseError) {
            parseMs = Date.now() - p0;
            const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
            console.error(`❌ DOCX 파싱 실패 (${parseMs}ms):`, errorMsg);
            throw new Error(`DOCX 파일 파싱 실패: 파일이 손상되었거나 유효한 DOCX 파일이 아닙니다. (${errorMsg})`);
          }
        }
      }

      // 텍스트 추출 결과 검증 및 로깅
      if (!extractedText || typeof extractedText !== 'string') {
        throw new Error(`텍스트 추출 실패: extractedText가 유효하지 않습니다. (${job.job_type})`);
      }
      
      const cleanedLength = extractedText.replace(/\s+/g, ' ').trim().length;
      console.log(`📊 텍스트 추출 검증:`, {
        rawLength: extractedText.length,
        cleanedLength: cleanedLength,
        fileType: job.job_type,
        fileName: fileName,
        textPreview: extractedText.substring(0, 200) // 텍스트 미리보기 추가
      });
      
      // DOCX 텍스트 추출 실패 검증 (빈 텍스트)
      if (cleanedLength === 0 && job.job_type === 'DOCX_PARSE') {
        const errorMsg = 'DOCX에서 텍스트를 추출할 수 없습니다. 파일이 손상되었거나 텍스트가 없습니다.';
        console.error(`❌ ${errorMsg}`, {
          fileName: fileName,
          fileSize: fileSize,
          bufferSize: extractedText.length
        });
        throw new Error(errorMsg);
      }
      
      // DOCX 텍스트가 너무 짧은 경우 경고 (텍스트는 있지만 청킹 결과가 제한적일 수 있음)
      if (cleanedLength > 0 && cleanedLength < 100 && job.job_type === 'DOCX_PARSE') {
        console.warn(`⚠️ DOCX 텍스트가 매우 짧습니다 (${cleanedLength}자). 청킹 결과가 제한적일 수 있습니다.`);
      }
      
      // 텍스트 추출이 너무 적으면 경고 및 처리
      // DOCX의 경우 텍스트가 있어도 OCR로 폴백하지 않도록 수정 (PDF만 OCR 폴백)
      if (cleanedLength < 500 && !isReprocess && storage?.bucket && storage?.path && job.job_type === 'PDF_PARSE') {
        // 텍스트가 매우 짧은 경우 (파일명만 추출된 경우 등)
        const isVeryShort = cleanedLength < 100;
        const textPreview = extractedText.substring(0, 200);
        
        if (isVeryShort) {
          console.error('❌ PDF 텍스트 추출 실패: 이미지 기반 PDF이거나 텍스트 추출이 거의 실패했습니다.', {
            fileName,
            fileSizeMB: fileSizeMB,
            extractedLength: extractedText.length,
            cleanedLength,
            textPreview,
            note: 'OCR 기능이 필요하지만 현재 비활성화되어 있습니다. 이미지 기반 PDF는 텍스트 추출이 제한적입니다.'
          });
        } else {
          console.warn('⚠️ PDF 텍스트 추출이 짧습니다. OCR 폴백을 시도하지만 현재 OCR 기능은 비활성화되어 있습니다.', {
            fileName,
            fileSizeMB: fileSizeMB,
            cleanedLength,
            textPreview
          });
        }
        
        // OCR 폴백 Job 생성 (현재 OCR 기능은 비활성화되어 있지만, 향후 활성화 대비)
        const { error: ocrEnqErr } = await supabase
          .from('processing_jobs')
          .insert({
            document_id: job.document_id,
            job_type: 'OCR',
            status: 'queued',
            priority: Math.max((job.priority || 5) - 1, 1),
            payload: { storage, reason: 'pdf_text_too_short', sourceJobId: job.id, isVeryShort },
            scheduled_at: new Date().toISOString()
          });
        if (ocrEnqErr) {
          console.warn('⚠️ OCR Job 생성 실패 (OCR 기능이 비활성화되어 있을 수 있음):', ocrEnqErr);
        }

        const totalMs = Date.now() - jobStartMs;
        // persist metrics row (재처리 모드가 아니면 fileBuffer가 있음)
        const bytes = storage?.size || 0;
        await supabase
          .from('processing_metrics')
          .insert({
            job_id: job.id,
            document_id: job.document_id,
            bytes: bytes,
            dl_ms: dlMs,
            parse_ms: parseMs,
            total_ms: totalMs,
            text_length: cleanedLength,
            note: isVeryShort ? 'deferred_to_ocr_very_short' : 'deferred_to_ocr'
          });

        const { error: markDone } = await supabase
          .from('processing_jobs')
          .update({ status: 'completed', finished_at: new Date().toISOString(), result: { note: isVeryShort ? 'deferred_to_ocr_very_short' : 'deferred_to_ocr', cleanedLength, dlMs, parseMs, totalMs, bytes, isVeryShort } })
          .eq('id', job.id)
          .eq('status', 'processing');
        if (markDone) throw markDone;
        return NextResponse.json({ success: true, jobId: job.id, status: 'completed', result: { note: isVeryShort ? 'deferred_to_ocr_very_short' : 'deferred_to_ocr', isVeryShort } }, { status: 200 });
      }

      // 표/CSV 정규화 (간단 규칙)
      const normalizedText = normalizeTablesToMarkdown(extractedText);
      const normalizedLengthKB = (normalizedText.length / 1024).toFixed(2);
      console.log(`📝 텍스트 정규화 완료: ${normalizedLengthKB}KB`);
      
      // 텍스트 길이 검증 및 경고
      if (normalizedText.length < 100 && fileSize > 100 * 1024) {
        // 파일 크기는 큰데 텍스트가 매우 짧은 경우 (PDF 파싱 실패 가능성)
        console.error('❌ 텍스트 추출 의심: 파일 크기는 크지만 텍스트가 매우 짧습니다.', {
          fileName,
          fileSizeMB: fileSizeMB,
          extractedLength: extractedText.length,
          normalizedLength: normalizedText.length,
          textPreview: normalizedText.substring(0, 500)
        });
      } else if (normalizedText.length < 1000 && fileSize > 1024 * 1024) {
        // 파일 크기가 1MB 이상인데 텍스트가 1KB 미만인 경우 경고
        console.warn('⚠️ 텍스트 추출 경고: 파일 크기에 비해 텍스트가 짧습니다.', {
          fileName,
          fileSizeMB: fileSizeMB,
          normalizedLength: normalizedText.length,
          normalizedLengthKB,
          textPreview: normalizedText.substring(0, 200)
        });
      }

      // 🔥 Phase 2: 큰 파일 감지 및 분할 처리
      // 파일 크기와 텍스트 길이를 모두 고려하여 큰 파일 판단
      // DOCX 파일은 텍스트 양이 파일 크기보다 클 수 있으므로 파일 크기 기준 우선
      const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
      const LARGE_TEXT_THRESHOLD = 2 * 1024 * 1024; // 2MB 텍스트 (파일 크기와 함께 고려)
      // 파일 크기와 텍스트 길이 모두 큰 경우에만 큰 파일로 분류
      // DOCX 파일의 경우 파일 크기만으로 판단 (텍스트 양이 파일 크기보다 클 수 있음)
      const isLargeFile = job.job_type === 'DOCX_PARSE' 
        ? fileSize > LARGE_FILE_THRESHOLD
        : (fileSize > LARGE_FILE_THRESHOLD && normalizedText.length > LARGE_TEXT_THRESHOLD);
      
      if (isLargeFile) {
        console.log('📦 큰 파일 감지 - 분할 처리 시작:', {
          fileName,
          fileSizeMB: fileSizeMB,
          textLength: normalizedText.length,
          textLengthKB: normalizedLengthKB
        });
        
        try {
          // 1. 텍스트 분할 (500KB 단위 - RAG 품질 유지)
          // 분할 크기는 충분히 크게 유지하여 문맥 보존
          const splits = simpleTextSplitter.splitByFixedSize(normalizedText, {
            maxSize: 500 * 1024 // 500KB (RAG 품질 유지)
          });
          
          const stats = simpleTextSplitter.getSplitStats(splits);
          console.log('✂️ 텍스트 분할 완료:', {
            totalSplits: splits.length,
            avgSizeKB: (stats.avgSizeBytes / 1024).toFixed(2),
            totalSizeKB: (stats.totalSizeBytes / 1024).toFixed(2),
            minSizeKB: (stats.minSizeBytes / 1024).toFixed(2),
            maxSizeKB: (stats.maxSizeBytes / 1024).toFixed(2)
          });
          
          // 2. document_splits 테이블에 분할 저장
          const splitInserts = splits.map((split, idx) => ({
            document_id: job.document_id,
            split_index: idx,
            split_count: splits.length,
            content: split.content,
            start_char: split.startChar,
            end_char: split.endChar,
            status: 'pending'
          }));
          
          const { data: insertedSplits, error: splitInsertError } = await supabase
            .from('document_splits')
            .insert(splitInserts)
            .select('id');
          
          if (splitInsertError) {
            throw new Error(`분할 저장 실패: ${splitInsertError.message}`);
          }
          
          console.log('💾 분할 저장 완료:', insertedSplits?.length || 0, '개');
          
          // 3. 각 분할에 대해 CHUNK_PROCESS job 등록
          const chunkJobs = insertedSplits!.map((split, idx) => ({
            document_id: job.document_id,
            job_type: 'CHUNK_PROCESS',
            status: 'queued',
            priority: 5, // 일반 우선순위
            payload: {
              split_id: split.id,
              split_index: idx,
              original_job_id: job.id,
              original_job_type: job.job_type,
              fileName: fileName,
              fileSize: fileSize
            },
            attempts: 0,
            max_attempts: 3,
            scheduled_at: new Date().toISOString()
          }));
          
          const { data: insertedJobs, error: jobInsertError } = await supabase
            .from('processing_jobs')
            .insert(chunkJobs)
            .select('id');
          
          if (jobInsertError) {
            throw new Error(`CHUNK_PROCESS job 등록 실패: ${jobInsertError.message}`);
          }
          
          console.log('📋 CHUNK_PROCESS job 등록 완료:', insertedJobs?.length || 0, '개');
          
          // 4. documents 테이블 상태 업데이트
          await supabase
            .from('documents')
            .update({
              split_status: {
                total_splits: splits.length,
                completed_splits: 0,
                failed_splits: 0,
                method: 'fixed-size'
              },
              status: 'processing'
            })
            .eq('id', job.document_id);
          
          // 5. 원본 PDF_PARSE/DOCX_PARSE job 완료 처리
          await supabase
            .from('processing_jobs')
            .update({
              status: 'completed',
              finished_at: new Date().toISOString(),
              result: {
                note: 'split_into_chunks',
                total_splits: splits.length,
                fileSize: fileSize,
                textLength: normalizedText.length
              }
            })
            .eq('id', job.id)
            .eq('status', 'processing');
          
          console.log('✅ 큰 파일 분할 완료 - CHUNK_PROCESS job들이 큐에 등록됨');
          
          return NextResponse.json({
            success: true,
            message: `큰 파일을 ${splits.length}개 분할로 처리했습니다.`,
            splits: splits.length
          }, { status: 200 });
          
        } catch (splitError: any) {
          console.error('❌ 큰 파일 분할 실패:', splitError);
          console.error('❌ 분할 실패 상세:', {
            error: splitError instanceof Error ? splitError.message : String(splitError),
            stack: splitError instanceof Error ? splitError.stack : undefined,
            documentId: job.document_id,
            fileName: fileName,
            fileSize: fileSize,
            textLength: normalizedText.length
          });
          
          // 분할 실패 시 기존 방식으로 폴백 (전체 파일 처리 시도)
          console.log('⚠️ 분할 실패 - 기존 방식으로 폴백');
          // 폴백: 분할 없이 전체 파일 처리 계속 진행 (아래 일반 처리 로직 사용)
        }
      }

      // 문서 레코드 불러오기(없을 경우 기본 메타 구성)
      const { data: docs } = await supabase.from('documents').select('id, title, file_size, file_type, created_at, updated_at, source_vendor').eq('id', job.document_id).limit(1);
      const nowIso = new Date().toISOString();
      
      // 재처리인 경우 기존 문서 정보 사용, 아니면 payload에서 가져오기
      const vendor = (job?.payload?.vendor as string) || docs?.[0]?.source_vendor || 'META';
      
      // normalizedText 검증 (DOCX 처리 경로 확인)
      if (!normalizedText || normalizedText.trim().length === 0) {
        const errorMsg = `텍스트 정규화 후 빈 텍스트입니다. 원본 텍스트 길이: ${extractedText.length}자`;
        console.error(`❌ ${errorMsg}`, {
          fileName: fileName,
          fileType: job.job_type,
          extractedTextLength: extractedText.length,
          normalizedTextLength: normalizedText.length
        });
        throw new Error(errorMsg);
      }
      
      // 실제 파일 확장자 확인 (Storage 파일 경로 또는 파일명 기준)
      let actualFileType = storage?.contentType || docs?.[0]?.file_type;
      if (!actualFileType || (isReprocess && storage)) {
        // 재처리 모드에서 Storage 파일 경로 확인
        const storagePath = storage?.path || '';
        if (storagePath.toLowerCase().endsWith('.docx') || storagePath.toLowerCase().endsWith('.doc')) {
          actualFileType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (storagePath.toLowerCase().endsWith('.pdf')) {
          actualFileType = 'application/pdf';
        } else if (fileName.toLowerCase().endsWith('.docx') || fileName.toLowerCase().endsWith('.doc')) {
          actualFileType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (fileName.toLowerCase().endsWith('.pdf')) {
          actualFileType = 'application/pdf';
        } else {
          // 기본값은 job_type 기반
          actualFileType = job.job_type === 'PDF_PARSE' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }
      }
      
      // type도 실제 파일 확장자에 맞게 설정
      const actualType = actualFileType.includes('wordprocessingml') ? 'docx' : 
                        actualFileType.includes('pdf') ? 'pdf' : 
                        (job.job_type === 'PDF_PARSE' ? 'pdf' : 'docx');
      
      if (isReprocess && actualFileType !== (job.job_type === 'PDF_PARSE' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
        console.warn(`⚠️ 재처리: file_type 불일치 감지 - job_type=${job.job_type}, 실제 file_type=${actualFileType}, 실제 타입으로 업데이트합니다.`);
      }
      
      const docData: DocumentData = {
        id: job.document_id,
        title: originalFileName || docs?.[0]?.title || fileName,
        content: normalizedText,
        type: actualType,
        file_size: storage?.size || docs?.[0]?.file_size || 0,
        file_type: actualFileType,
        source_vendor: vendor,
        original_file_name: originalFileName || null,
        sanitized_file_name: sanitizedFileName || null,
        created_at: docs?.[0]?.created_at || nowIso,
        updated_at: nowIso,
      };

      // 큰 파일 처리를 위한 최적화: 타임아웃 전에 중간 상태 업데이트
      const textLengthKB = (docData.content.length / 1024).toFixed(2);
      // DOCX 파일은 파일 크기 기준으로만 판단 (텍스트 양이 파일 크기보다 클 수 있음)
      const isLargeDocument = job.job_type === 'DOCX_PARSE'
        ? fileSize > 10 * 1024 * 1024
        : (docData.content.length > 2 * 1024 * 1024 || fileSize > 10 * 1024 * 1024);
      
      // DOCX 처리 경로 로깅 (디버깅용)
      console.log(`📄 DOCX 처리 준비:`, {
        fileName: fileName,
        contentLength: docData.content.length,
        textLengthKB: textLengthKB,
        isLargeDocument: isLargeDocument,
        willSplit: isLargeFile,
        willProcessNormally: !isLargeFile
      });
      
      if (isLargeDocument) {
        console.log(`🔮 큰 문서 처리 시작: ${textLengthKB}KB 텍스트, ${fileSizeMB}MB 파일`);
        console.log(`⏱️ 타임아웃 전 중간 상태 업데이트를 위해 처리 중...`);
        
        // 큰 파일 처리 시작 전에 processing_jobs 상태를 업데이트하여 타임아웃 방지
        await supabase
          .from('processing_jobs')
          .update({ 
            started_at: new Date().toISOString(),
            // 중간 상태를 나타내는 메타데이터 추가
          })
          .eq('id', job.id)
          .eq('status', 'processing');
      }
      
      // 인코딩/청킹/임베딩/저장 (타임아웃 보호)
      const processStartMs = Date.now();
      // 타임아웃 설정: 파일 크기와 타입에 따라 동적 설정
      // 작은 파일: 2분, 중간 파일: 5분, 큰 파일: 10분
      // DOCX 파일은 파일 크기 기준으로만 판단
      const MAX_PROCESS_TIME = 
        fileSize < 5 * 1024 * 1024 ? 120000 :  // 5MB 미만: 2분
        fileSize < 10 * 1024 * 1024 ? 300000 : // 10MB 미만: 5분
        600000; // 10MB 이상: 10분 (Vercel Pro 최대)
      
      // 전체 처리 시간 측정을 위한 단계별 시간 추적
      const stepTimings = {
        download: dlMs,
        parse: parseMs,
        chunking: 0,
        embedding: 0,
        saving: 0,
        total: 0
      };
      
      // 큰 파일의 경우 타임아웃 전에 중간 상태를 업데이트하는 로직
      let processResult;
      if (isLargeDocument) {
        // 큰 파일은 타임아웃 전에 중간 상태 확인
        const chunkingStartMs = Date.now();
        const processPromise = ragProcessor.processDocument(docData, true /* skipDuplicate */);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            const elapsed = Date.now() - processStartMs;
            reject(new Error(`큐 처리 시간 초과 (${Math.round(MAX_PROCESS_TIME / 60000)}분) - 경과 시간: ${Math.round(elapsed / 1000)}초`));
          }, MAX_PROCESS_TIME);
        });
        
        try {
          processResult = await Promise.race([processPromise, timeoutPromise]) as any;
          
          // 처리 결과에서 단계별 시간 추출 (가능한 경우)
          if (processResult && typeof processResult === 'object' && 'timings' in processResult) {
            stepTimings.chunking = (processResult as any).timings.chunking || 0;
            stepTimings.embedding = (processResult as any).timings.embedding || 0;
            stepTimings.saving = (processResult as any).timings.saving || 0;
          }
        } catch (timeoutError) {
          // 타임아웃 발생 시 진행 상황 상세 로깅
          const elapsed = Date.now() - processStartMs;
          stepTimings.total = elapsed;
          
          console.error('❌ 큰 파일 처리 타임아웃 - 상세 분석:', {
            fileSize: fileSizeMB,
            textLength: docData.content.length,
            textLengthKB: (docData.content.length / 1024).toFixed(2),
            elapsedTime: `${Math.round(elapsed / 1000)}초 (${Math.round(elapsed / 60000)}분)`,
            maxAllowedTime: `${Math.round(MAX_PROCESS_TIME / 60000)}분`,
            stepTimings: {
              download: `${stepTimings.download}ms (${(stepTimings.download / 1000).toFixed(1)}초)`,
              parse: `${stepTimings.parse}ms (${(stepTimings.parse / 1000).toFixed(1)}초)`,
              chunking: `${stepTimings.chunking}ms (${(stepTimings.chunking / 1000).toFixed(1)}초)`,
              embedding: `${stepTimings.embedding}ms (${(stepTimings.embedding / 1000).toFixed(1)}초)`,
              saving: `${stepTimings.saving}ms (${(stepTimings.saving / 1000).toFixed(1)}초)`,
              total: `${stepTimings.total}ms (${(stepTimings.total / 1000).toFixed(1)}초)`
            },
            error: timeoutError instanceof Error ? timeoutError.message : String(timeoutError)
          });
          
          // 재시도 가능 여부 확인
          const currentAttempts = job.attempts || 0;
          const maxAttempts = job.max_attempts || 3;
          
          if (currentAttempts < maxAttempts) {
            // 재시도 가능: retrying 상태로 변경하고 다음 실행 시 재시도
            console.log(`🔄 타임아웃 발생 - 재시도 예약 (${currentAttempts + 1}/${maxAttempts})`);
            await supabase
              .from('processing_jobs')
              .update({
                status: 'retrying',
                attempts: currentAttempts + 1,
                error: `큐 처리 시간 초과 - 재시도 예약 (${currentAttempts + 1}/${maxAttempts})`,
                scheduled_at: new Date(Date.now() + 60000).toISOString() // 1분 후 재시도
              })
              .eq('id', job.id)
              .eq('status', 'processing');
            
            // 문서 상태도 retrying으로 업데이트
            await supabase
              .from('documents')
              .update({
                status: 'pending', // 재시도를 위해 pending으로 복구
                updated_at: new Date().toISOString()
              })
              .eq('id', job.document_id);
            
            return NextResponse.json({
              success: false,
              error: '큐 처리 시간 초과 - 재시도 예약됨',
              retryScheduled: true,
              attempts: currentAttempts + 1,
              maxAttempts
            }, { status: 202 });
          } else {
            // 최대 시도 횟수 초과: failed 상태
            console.error(`❌ 최대 시도 횟수 초과 (${maxAttempts}/${maxAttempts}) - 실패 처리`);
            throw timeoutError;
          }
        }
      } else {
        processResult = await ragProcessor.processDocument(docData, true /* skipDuplicate */);
      }
      
      const processMs = Date.now() - processStartMs;
      stepTimings.total = processMs;
      
      // 상세한 처리 시간 로깅
      if (isLargeDocument) {
        console.log('📊 큰 파일 처리 시간 분석:', {
          fileSize: fileSizeMB,
          textLength: `${(docData.content.length / 1024).toFixed(2)}KB`,
          totalTime: `${(processMs / 1000).toFixed(1)}초 (${(processMs / 60000).toFixed(2)}분)`,
          stepTimings: {
            download: `${stepTimings.download}ms (${(stepTimings.download / 1000).toFixed(1)}초)`,
            parse: `${stepTimings.parse}ms (${(stepTimings.parse / 1000).toFixed(1)}초)`,
            chunking: `${stepTimings.chunking}ms (${(stepTimings.chunking / 1000).toFixed(1)}초)`,
            embedding: `${stepTimings.embedding}ms (${(stepTimings.embedding / 1000).toFixed(1)}초)`,
            saving: `${stepTimings.saving}ms (${(stepTimings.saving / 1000).toFixed(1)}초)`
          },
          chunkCount: processResult?.chunkCount || 0
        });
      }
      
      if (processResult.success) {
        console.log(`✅ 문서 처리 완료: ${processResult.chunkCount}개 청크 생성 (${(processMs / 1000).toFixed(1)}초)`);
      } else {
        console.warn(`⚠️ 문서 처리 실패: ${processResult.error || 'Unknown error'} (${(processMs / 1000).toFixed(1)}초)`);
      }

      // 실제 저장된 청크 개수 재확인 (saveChunksToDatabase에서 이미 업데이트했지만, 큐 워커에서도 확인)
      const { count: actualChunkCount } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', job.document_id);
      
      const finalChunkCount = actualChunkCount || processResult.chunkCount;
      
      // chunk_count가 이미 saveChunksToDatabase에서 업데이트되었지만, 큐 워커에서도 동기화
      // (실제 저장된 개수와 processResult.chunkCount가 다른 경우 대비)
      // 청크 0개인 경우 failed 상태로 설정 (근본 원인 수정)
      const finalStatus = (processResult.success && finalChunkCount > 0) ? 'indexed' : 'failed';
      const { error: docUpdateErr } = await supabase
        .from('documents')
        .update({ 
          status: finalStatus,
          chunk_count: finalChunkCount, 
          updated_at: nowIso 
        })
        .eq('id', job.document_id);
      if (docUpdateErr) throw docUpdateErr;
      
      // 불일치 경고
      if (finalChunkCount !== processResult.chunkCount) {
        console.warn(`⚠️ 청크 개수 불일치 감지: processResult=${processResult.chunkCount}, 실제=${finalChunkCount}`);
      }

      const finishedResult = { note: 'processed', jobType: job.job_type, chunks: processResult.chunkCount };
      const { error: finishErr } = await supabase
        .from('processing_jobs')
        .update({ status: 'completed', finished_at: new Date().toISOString(), result: finishedResult })
        .eq('id', job.id)
        .eq('status', 'processing');
      if (finishErr) throw finishErr;

      return NextResponse.json({ success: true, jobId: job.id, status: 'completed', result: finishedResult }, { status: 200 });
    }

    // 🔥 CRAWL_SEED job 처리
    if (job.job_type === 'CRAWL_SEED') {
      console.log('🌐 CRAWL_SEED job 처리 시작:', {
        jobId: job.id,
        url: job.payload?.url,
        vendors: job.payload?.vendors,
        domainLimit: job.payload?.domainLimit,
        respectRobots: job.payload?.respectRobots,
        maxDepth: job.payload?.maxDepth,
        extractSubPages: job.payload?.extractSubPages,
        payloadType: typeof job.payload?.extractSubPages,
        payloadRaw: job.payload
      });

      const crawlStartMs = Date.now();

      try {
        // payload 유효성 검증
        if (!job.payload || typeof job.payload !== 'object') {
          throw new Error('CRAWL_SEED job payload가 유효하지 않습니다.');
        }

        const url = job.payload?.url as string;
        const vendors = (job.payload?.vendors as string[]) || [];
        const domainLimit = job.payload?.domainLimit as boolean ?? true;
        const respectRobots = job.payload?.respectRobots as boolean ?? true;
        const maxDepthRaw = Number(job.payload?.maxDepth);
        const maxDepth = Number.isFinite(maxDepthRaw) && maxDepthRaw > 0 ? maxDepthRaw : 2;
        // extractSubPages를 명시적으로 boolean으로 변환 (문자열 "true"도 처리)
        const extractSubPagesRaw = job.payload?.extractSubPages;
        const extractSubPages = extractSubPagesRaw === true || extractSubPagesRaw === 'true';

        if (!url || typeof url !== 'string' || url.trim().length === 0) {
          throw new Error(`CRAWL_SEED job payload에 유효한 url이 없습니다. (url: ${url})`);
        }

        let seedUrl: URL;
        try {
          seedUrl = new URL(url);
        } catch {
          throw new Error(`유효하지 않은 URL: ${url}`);
        }

        const dbVendor = vendors[0] || 'META';
        const documentId = job.document_id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        console.error('[CRITICAL] 🔍 CRAWL_SEED 파라미터 확인:', {
          url,
          extractSubPages,
          extractSubPagesRaw,
          extractSubPagesType: typeof extractSubPagesRaw,
          extractSubPagesBoolean: extractSubPages,
          maxDepth,
          domainLimit,
          respectRobots,
          vendors,
          documentId
        });

        const commonHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
        } as Record<string, string>;

        // Puppeteer 서비스 인스턴스 (필요시에만 생성, 상위 스코프에 선언)
        let puppeteerService: PuppeteerCrawlingService | null = null;

        const fetchPageContent = async (targetUrl: string) => {
          console.log('🌍 페이지 다운로드 요청:', targetUrl);
          const response = await fetch(targetUrl, {
            headers: commonHeaders,
            signal: AbortSignal.timeout(30000),
            redirect: 'follow',
          });

          if (!response.ok) {
            let errorBody = '';
            try {
              errorBody = await response.text();
              if (errorBody.length > 500) {
                errorBody = `${errorBody.substring(0, 500)}...`;
              }
            } catch {
              // ignore body read errors
            }
            const errorDetails = errorBody ? `응답: ${errorBody.substring(0, 200)}` : response.statusText;
            throw new Error(`HTTP ${response.status}: ${errorDetails}`);
          }

          const htmlContent = await response.text();

          const lowerHtml = htmlContent.toLowerCase();
          const loginPatterns = [
            '계속하려면 로그인',
            'facebook에 로그인',
            'login to facebook',
            'instagram에 로그인',
            'log in to instagram',
            '로그인하여 계속',
          ];
          const isBlockedByLogin = loginPatterns.some((pattern) => lowerHtml.includes(pattern.toLowerCase()));

          if (isBlockedByLogin && (targetUrl.includes('facebook.com') || targetUrl.includes('instagram.com'))) {
            throw new Error('로그인 페이지가 반환되어 크롤링할 수 없습니다. 공개 접근이 가능한 문서를 사용해 주세요.');
          }

          // Cheerio로 HTML 파싱
          const $ = cheerio.load(htmlContent);
          
          // 정교한 제목 추출 함수 (PuppeteerCrawlingService 로직 기반)
          const extractPageTitle = (): string | null => {
            // 1. h1 태그 (가장 우선)
            const h1Text = $('h1').first().text().trim();
            if (h1Text && h1Text.length >= 2) {
              return h1Text;
            }

            // 2. title 태그
            const titleText = $('title').text().trim();
            if (titleText && titleText.length >= 2) {
              // title 태그에서 불필요한 접미사 제거 (예: " - 사이트명", " | 사이트명")
              const cleanedTitle = titleText
                .replace(/\s*[-|]\s*.*$/, '') // " - 사이트명" 또는 " | 사이트명" 제거
                .replace(/\s*::\s*.*$/, '') // " :: 사이트명" 제거
                .trim();
              if (cleanedTitle && cleanedTitle.length >= 2) {
                return cleanedTitle;
              }
              return titleText;
            }

            // 3. og:title 메타 태그
            const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
            if (ogTitle && ogTitle.length >= 2) {
              return ogTitle;
            }

            // 4. data-testid 기반
            const dataTestIdTitle = $('[data-testid="page-title"]').first().text().trim();
            if (dataTestIdTitle && dataTestIdTitle.length >= 2 && dataTestIdTitle.length <= 100) {
              return dataTestIdTitle;
            }

            // 5. 클래스 기반 셀렉터들 (우선순위 순)
            const classSelectors = [
              'h1.page-title',
              'h1.article-title',
              '.page-title',
              '.article-title',
              '.post-title',
              '.entry-title',
              '.content-title',
              '.main-title',
              'main h1',
              'main h2',
              'article h1',
              'article h2',
              'section:first-of-type h1',
              'section:first-of-type h2',
              'header h1',
              'header h2',
              '.hero h1',
              '.hero h2',
              '.banner h1',
              '.banner h2'
            ];
            
            for (const selector of classSelectors) {
              const text = $(selector).first().text().trim();
              if (text && text.length >= 2 && text.length <= 100) {
                return text;
              }
            }

            // 6. h2 태그 (히어로 영역에 자주 사용)
            const h2Text = $('h2').first().text().trim();
            if (h2Text && h2Text.length >= 2 && h2Text.length <= 100) {
              return h2Text;
            }

            // 7. 상단 영역에서 font-weight: bold이고 큰 텍스트 추출
            // body의 첫 30% 영역에서 큰 텍스트 찾기
            const bodyText = $('body').html() || '';
            const firstThird = bodyText.substring(0, Math.floor(bodyText.length * 0.3));
            const $firstThird = cheerio.load(firstThird);
            
            // 큰 폰트 사이즈나 볼드 스타일을 가진 요소 찾기
            const largeBoldElements = $firstThird('*').filter((_, el) => {
              const $el = $firstThird(el);
              const text = $el.text().trim();
              if (!text || text.length < 2 || text.length > 100) return false;
              
              // 스타일 속성에서 font-size나 font-weight 확인
              const style = $el.attr('style') || '';
              const hasLargeFont = /font-size:\s*([2-9]\d|1\d{2,})px/i.test(style) || 
                                   /font-size:\s*([2-9]|1[0-9]|2[0-9]|3[0-9])rem/i.test(style) ||
                                   /font-size:\s*([2-9]|1[0-9]|2[0-9]|3[0-9])em/i.test(style);
              
              // 태그 이름 확인 (타입 가드 추가)
              const tagName = (el as any).tagName || (el as any).name || '';
              const hasBold = /font-weight:\s*(bold|700|800|900)/i.test(style) ||
                              ['b', 'strong', 'h1', 'h2', 'h3'].includes(tagName.toLowerCase());
              
              return hasLargeFont || hasBold;
            });
            
            if (largeBoldElements.length > 0) {
              const firstLargeBold = largeBoldElements.first().text().trim();
              if (firstLargeBold && firstLargeBold.length >= 2 && firstLargeBold.length <= 100) {
                return firstLargeBold;
              }
            }

            return null;
          };
          
          // 정교한 제목 추출
          let pageTitle = extractPageTitle();
          
          // 제목이 없거나 너무 짧으면 URL pathname에서 추출 (마지막 경로)
          if (!pageTitle || pageTitle.length < 2) {
            try {
              const urlPath = new URL(targetUrl).pathname;
              if (urlPath && urlPath !== '/') {
                const pathParts = urlPath.split('/').filter(p => p);
                if (pathParts.length > 0) {
                  const lastPart = pathParts[pathParts.length - 1];
                  // URL 인코딩된 한글 디코딩 시도
                  try {
                    const decoded = decodeURIComponent(lastPart);
                    pageTitle = decoded.replace(/[-_]/g, ' ').trim();
                  } catch {
                    pageTitle = lastPart.replace(/[-_]/g, ' ').trim();
                  }
                  
                  // 여전히 제목이 없거나 너무 짧으면 전체 URL 사용
                  if (!pageTitle || pageTitle.length < 2) {
                    pageTitle = targetUrl;
                  }
                } else {
                  pageTitle = targetUrl;
                }
              } else {
                pageTitle = targetUrl;
              }
            } catch (urlError) {
              // URL 파싱 실패 시 전체 URL 사용
              pageTitle = targetUrl;
            }
          }
          
          // 제목 정리: 불필요한 공백 제거 및 길이 제한
          if (pageTitle) {
            pageTitle = pageTitle
              .replace(/\s+/g, ' ') // 연속된 공백을 하나로
              .trim()
              .substring(0, 200); // 최대 200자로 제한
          }
          
          // 개선된 텍스트 추출: 구조를 유지하면서 텍스트 추출
          let textContent = '';
          
          // 텍스트 추출 헬퍼 함수: 줄바꿈과 공백을 적절히 유지
          const extractTextWithStructure = ($element: cheerio.Cheerio): string => {
            // 클론 생성 (원본 보존)
            const $clone = $element.clone();
            
            // 스크립트, 스타일, 네비게이션 등 제거
            $clone.find('script, style, nav, footer, header, aside').remove();
            
            // 링크는 텍스트만 표시 (먼저 처리)
            $clone.find('a').each((_, el) => {
              const $el = $(el);
              const href = $el.attr('href');
              const text = $el.text().trim();
              if (text && href && !href.startsWith('#')) {
                // 링크 텍스트만 표시 (URL은 제거하여 가독성 향상)
                $el.replaceWith(` ${text} `);
              } else if (text) {
                $el.replaceWith(` ${text} `);
              } else {
                $el.replaceWith(' ');
              }
            });
            
            // 블록 요소를 줄바꿈으로 변환 (먼저 처리)
            const blockElements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'li', 'td', 'th', 'tr', 'section', 'article', 'main'];
            blockElements.forEach(tag => {
              $clone.find(tag).each((_, el) => {
                const $el = $(el);
                const text = $el.text().trim();
                if (text) {
                  $el.replaceWith(`\n${text}\n`);
                } else {
                  $el.replaceWith('\n');
                }
              });
            });
            
            // <br> 태그는 줄바꿈으로 변환
            $clone.find('br').each((_, el) => {
              $(el).replaceWith('\n');
            });
            
            // 인라인 요소는 공백으로 변환
            $clone.find('span, strong, em, b, i, code').each((_, el) => {
              const $el = $(el);
              const text = $el.text().trim();
              if (text) {
                $el.replaceWith(` ${text} `);
              }
            });
            
            // 최종 텍스트 추출: HTML을 가져와서 남은 태그 제거
            const html = $clone.html() || '';
            
            // 남은 HTML 태그를 공백으로 변환하고 엔티티 디코딩
            let text = html
              .replace(/<[^>]+>/g, ' ') // 모든 태그를 공백으로 변환
              .replace(/&nbsp;/g, ' ') // HTML 엔티티 디코딩
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&apos;/g, "'");
            
            // 연속된 공백을 하나로, 연속된 줄바꿈을 두 개로 제한
            text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
            return text;
          };
          
          // 1. 주요 콘텐츠 영역 우선 추출 (Cheerio 사용)
          const contentSelectors = [
            'main',
            'article',
            '[role="main"]',
            '.content',
            '.main-content',
            '.page-content',
            '#content',
            '#main-content'
          ];
          
          let foundContent = false;
          for (const selector of contentSelectors) {
            const $content = $(selector).first();
            if ($content.length > 0) {
              const extracted = extractTextWithStructure($content.clone());
              
              if (extracted.length > textContent.length) {
                textContent = extracted;
                foundContent = true;
              }
              
              if (textContent.length > 1000) break; // 충분한 콘텐츠를 찾으면 중단
            }
          }
          
          // 2. 주요 콘텐츠 영역을 찾지 못했거나 너무 짧은 경우 body 전체에서 추출
          if (!foundContent || textContent.length < 500) {
            const $body = $('body');
            if ($body.length > 0) {
              const fullText = extractTextWithStructure($body.clone());
              
              // 더 긴 텍스트를 선택
              if (fullText.length > textContent.length) {
                textContent = fullText;
              }
            }
          }

          // 3. 콘텐츠가 충분하지 않은 경우 JavaScript 렌더링 필요 여부 확인
          const hasSubstantialContent = textContent.length > 500;
          const hasEmptyRoot = $('body').children().length === 0 || 
                               ($('#root, #app').length > 0 && $('#root, #app').text().trim().length < 100);
          
          if (!hasSubstantialContent && hasEmptyRoot) {
            console.warn(`⚠️ 정적 HTML로 충분한 콘텐츠를 찾지 못함 (${textContent.length}자). JavaScript 렌더링이 필요할 수 있습니다.`);
            // Puppeteer를 사용한 크롤링은 별도로 처리 (현재는 경고만)
          }

          // 콘텐츠가 짧은 경우 Puppeteer로 재시도 (JavaScript 렌더링 필요할 수 있음)
          if (!textContent || textContent.length < 100) {
            console.warn(`⚠️ Cheerio로 추출한 콘텐츠가 짧습니다 (${textContent.length}자). Puppeteer로 재시도합니다.`);
            
            try {
              // PuppeteerCrawlingService 인스턴스 생성 (한 번만 생성)
              if (!puppeteerService) {
                puppeteerService = new PuppeteerCrawlingService();
              }
              
              const puppeteerResult = await puppeteerService.crawlMetaPage(targetUrl, false, true); // skipUrlCheck=true로 모든 도메인 허용
              
              if (puppeteerResult && puppeteerResult.content && puppeteerResult.content.length >= 100) {
                console.log(`✅ Puppeteer로 콘텐츠 추출 성공: ${puppeteerResult.content.length}자`);
                return {
                  textContent: puppeteerResult.content,
                  pageTitle: puppeteerResult.title,
                  htmlContent: htmlContent // 원본 HTML은 유지
                };
              } else {
                // Puppeteer가 null을 반환하거나 콘텐츠가 짧은 경우
                if (puppeteerResult === null) {
                  console.warn(`⚠️ Puppeteer 초기화 실패로 크롤링 불가, Cheerio 결과 확인 중...`);
              } else {
                console.warn(`⚠️ Puppeteer로도 충분한 콘텐츠를 추출하지 못했습니다 (${puppeteerResult?.content?.length || 0}자)`);
                }
                
                // Puppeteer 실패 시 Cheerio 결과가 있으면 사용 (graceful fallback)
                if (textContent && textContent.length > 0) {
                  console.warn(`⚠️ Puppeteer 실패했지만 Cheerio 결과 사용: ${textContent.length}자`);
                  return {
                    textContent: textContent,
                    pageTitle: pageTitle || '제목 없음',
                    htmlContent: htmlContent
                  };
                }
                
                // Cheerio 결과도 없으면 최소한 빈 문서라도 반환 (에러 대신)
                // 이렇게 하면 작업이 완전히 실패하지 않고, 빈 문서로 저장되어 사용자가 확인할 수 있음
                console.warn(`⚠️ Cheerio와 Puppeteer 모두 실패했지만, 빈 문서로 저장하여 작업을 계속 진행합니다.`);
                return {
                  textContent: '', // 빈 콘텐츠
                  pageTitle: pageTitle || targetUrl, // URL을 제목으로 사용
                  htmlContent: htmlContent || '' // 빈 HTML
                };
              }
            } catch (puppeteerError: any) {
              console.error(`❌ Puppeteer 재시도 실패:`, puppeteerError);
              
              // Puppeteer 실패 시 Cheerio 결과가 있으면 사용 (graceful fallback)
              if (textContent && textContent.length > 0) {
                console.warn(`⚠️ Puppeteer 실패했지만 Cheerio 결과 사용: ${textContent.length}자`);
                return {
                  textContent: textContent,
                  pageTitle: pageTitle || '제목 없음',
                  htmlContent: htmlContent
                };
              }
              
              // Cheerio 결과도 없으면 최소한 빈 문서라도 반환 (에러 대신)
              console.warn(`⚠️ Cheerio와 Puppeteer 모두 실패했지만, 빈 문서로 저장하여 작업을 계속 진행합니다.`);
              return {
                textContent: '', // 빈 콘텐츠
                pageTitle: pageTitle || targetUrl, // URL을 제목으로 사용
                htmlContent: htmlContent || '' // 빈 HTML
              };
            }
          }

          console.log(`📄 추출된 텍스트 길이: ${textContent.length}자 (원본 HTML: ${htmlContent.length}자, Cheerio 사용)`);

          return { textContent, pageTitle, htmlContent };
        };

        const upsertAndProcessDocument = async ({ targetUrl, title, content, documentIdOverride, parentDocumentId }: { targetUrl: string; title: string; content: string; documentIdOverride?: string; parentDocumentId?: string; }) => {
          const nowIso = new Date().toISOString();
          const fileSize = Buffer.byteLength(content, 'utf8');

          // documentIdOverride가 있으면 그것을 우선 사용 (명확한 PK 기준)
          let existingDoc = null;
          let wasExistingDocument = false;
          
          if (documentIdOverride) {
            // documentIdOverride가 있으면 해당 ID로 직접 조회
            const { data: docById, error: docByIdError } = await supabase
              .from('documents')
              .select('id, chunk_count, created_at, url, status')
              .eq('id', documentIdOverride)
              .maybeSingle();
            
            if (docByIdError && docByIdError.code !== 'PGRST116') {
              console.error('❌ documentIdOverride로 문서 조회 실패:', docByIdError);
            }
            
            if (docById) {
              existingDoc = docById;
              wasExistingDocument = true;
              console.log(`[CRITICAL] ✅ documentIdOverride로 문서 찾음: ${documentIdOverride}`);
            }
          }
          
          // documentIdOverride로 찾지 못했거나 없으면 URL 기준으로 조회 (중복 처리 포함)
          if (!existingDoc) {
            // URL 기준으로 조회 시 중복이 있을 수 있으므로 가장 최신 문서만 가져오기
            const { data: docsByUrl, error: docsByUrlError } = await supabase
              .from('documents')
              .select('id, chunk_count, created_at, status')
              .eq('url', targetUrl)
              .order('created_at', { ascending: false })
              .limit(10); // 최대 10개까지 조회해서 중복 확인
            
            if (docsByUrlError && docsByUrlError.code !== 'PGRST116') {
              console.error('❌ URL 기준 문서 조회 실패:', docsByUrlError);
            }
            
            if (docsByUrl && docsByUrl.length > 0) {
              // 가장 최신 문서 사용
              existingDoc = docsByUrl[0];
              wasExistingDocument = true;
              
              // 중복 문서가 있으면 정리 (processing 상태이면서 chunk_count=0인 중복 문서 삭제)
              if (docsByUrl.length > 1) {
                console.warn(`⚠️ URL 중복 문서 발견: ${docsByUrl.length}개, 정리 시작: ${targetUrl}`);
                const duplicateIds = docsByUrl.slice(1).map(d => d.id); // 첫 번째(최신) 제외한 나머지
                
                // 중복 문서 중 processing 상태이면서 chunk_count=0인 것만 삭제
                const { data: duplicatesToDelete } = await supabase
                  .from('documents')
                  .select('id, status, chunk_count')
                  .in('id', duplicateIds)
                  .eq('status', 'processing')
                  .eq('chunk_count', 0);
                
                if (duplicatesToDelete && duplicatesToDelete.length > 0) {
                  const deleteIds = duplicatesToDelete.map(d => d.id);
                  console.log(`[CRITICAL] 🗑️ 중복 문서 삭제: ${deleteIds.length}개 (processing, chunk_count=0)`);
                  
                  // 관련 청크, 메타데이터, 로그도 함께 삭제
                  await supabase.from('document_chunks').delete().in('document_id', deleteIds);
                  await supabase.from('document_metadata').delete().in('document_id', deleteIds);
                  await supabase.from('document_logs').delete().in('document_id', deleteIds);
                  
                  // 문서 삭제
                  const { error: deleteError } = await supabase
                    .from('documents')
                    .delete()
                    .in('id', deleteIds);
                  
                  if (deleteError) {
                    console.error('❌ 중복 문서 삭제 실패:', deleteError);
                  } else {
                    console.log(`[CRITICAL] ✅ 중복 문서 삭제 완료: ${deleteIds.length}개`);
                  }
                }
                
                // 나머지 중복 문서는 failed 상태로 변경 (이미 indexed인 경우는 유지)
                const remainingDuplicates = docsByUrl.slice(1).filter(d => 
                  !duplicatesToDelete?.some(del => del.id === d.id)
                );
                
                if (remainingDuplicates.length > 0) {
                  const remainingIds = remainingDuplicates
                    .filter(d => d.status !== 'indexed') // indexed는 유지
                    .map(d => d.id);
                  
                  if (remainingIds.length > 0) {
                    await supabase
                      .from('documents')
                      .update({ status: 'failed', updated_at: nowIso })
                      .in('id', remainingIds)
                      .neq('status', 'indexed'); // indexed는 변경하지 않음
                    
                    console.log(`[CRITICAL] ⚠️ 중복 문서 failed 상태로 변경: ${remainingIds.length}개`);
                  }
                }
              }
            }
          }

          const resolvedDocumentId = documentIdOverride || existingDoc?.id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

          if (existingDoc?.id && !documentIdOverride) {
            // 기존 문서 업데이트
            await supabase
              .from('documents')
              .update({
                title,
                type: 'url', // URL 크롤링 문서는 항상 'url' 타입으로 설정
                status: 'processing',
                file_size: fileSize,
                file_type: 'text/html',
                source_vendor: dbVendor,
                content,
                url: targetUrl,
                main_document_id: parentDocumentId || null, // 부모 문서 ID 설정
                updated_at: nowIso,
              })
              .eq('id', existingDoc.id);
          } else if (wasExistingDocument && documentIdOverride) {
            // documentIdOverride가 있고 기존 문서가 있는 경우 업데이트
            await supabase
              .from('documents')
              .update({
                title,
                type: 'url',
                status: 'processing',
                file_size: fileSize,
                file_type: 'text/html',
                source_vendor: dbVendor,
                content,
                url: targetUrl,
                main_document_id: parentDocumentId || null,
                updated_at: nowIso,
              })
              .eq('id', documentIdOverride);
          } else if (!wasExistingDocument) {
            // 새 문서 생성
            await supabase
              .from('documents')
              .insert({
                id: resolvedDocumentId,
                title,
                type: 'url',
                status: 'processing',
                chunk_count: 0,
                file_size: fileSize,
                file_type: 'text/html',
                source_vendor: dbVendor,
                content,
                url: targetUrl,
                main_document_id: parentDocumentId || null, // 부모 문서 ID 설정
                created_at: nowIso,
                updated_at: nowIso,
              });
          }

          // 빈 콘텐츠인 경우 RAG 처리 건너뛰고 failed 상태로 표시
          if (!content || content.trim().length === 0) {
            console.warn(`⚠️ 빈 콘텐츠로 인해 RAG 처리를 건너뜁니다. 문서 상태를 'failed'로 설정합니다.`);
            await supabase
              .from('documents')
              .update({
                status: 'failed',
                updated_at: nowIso,
              })
              .eq('id', resolvedDocumentId);
            
            // 작업은 완료로 표시하되, 문서는 failed 상태
            return {
              success: true, // 작업은 완료로 표시
              chunkCount: 0,
              documentId: resolvedDocumentId,
              message: '크롤링된 콘텐츠가 비어있습니다. 페이지가 JavaScript로만 렌더링되거나 접근이 제한되었을 수 있습니다.'
            };
          }

          // RAG 처리 시작 로깅
          const ragProcessStartTime = Date.now();
          console.log(`[CRITICAL] 🚀 RAG 처리 시작: ${title} (콘텐츠 길이: ${content.length}자)`);
          
          // BGE-M3 초기화 진행 상황 DB 업데이트를 위해 jobId 설정
          ragProcessor.setCurrentJobId(job.id);
          console.log(`[CRITICAL] ✅ RAGProcessor에 jobId 설정 완료: ${job.id} (BGE-M3 초기화 하트비트 DB 업데이트 활성화)`);
          
          // RAG 처리 전체에 타임아웃 추가 (60초)
          const ragProcessTimeout = 60000;
          const ragProcessPromise = ragProcessor.processDocument({
            id: resolvedDocumentId,
            title,
            content,
            type: 'url',
            file_size: fileSize,
            file_type: 'text/html',
            url: targetUrl,
            source_vendor: dbVendor,
            created_at: existingDoc?.created_at || nowIso,
            updated_at: nowIso,
          });
          
          const ragProcessTimeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              const elapsed = Date.now() - ragProcessStartTime;
              reject(new Error(`RAG 처리 전체 타임아웃: ${ragProcessTimeout}ms 초과 (경과: ${elapsed}ms)`));
            }, ragProcessTimeout);
          });
          
          let ragResult;
          try {
            ragResult = await Promise.race([ragProcessPromise, ragProcessTimeoutPromise]);
            const ragProcessElapsed = Date.now() - ragProcessStartTime;
            console.log(`[CRITICAL] ✅ RAG 처리 완료: ${title} (소요 시간: ${ragProcessElapsed}ms, 성공: ${ragResult.success}, 청크: ${ragResult.chunkCount}개)`);
          } catch (ragError) {
            const ragProcessElapsed = Date.now() - ragProcessStartTime;
            console.error(`[CRITICAL] ❌ RAG 처리 실패/타임아웃: ${title} (소요 시간: ${ragProcessElapsed}ms)`, ragError);
            
            // 타임아웃 또는 에러 발생 시 즉시 문서 상태를 failed로 업데이트
            try {
              await supabase
                .from('documents')
                .update({ 
                  status: 'failed', 
                  updated_at: new Date().toISOString() 
                })
                .eq('id', resolvedDocumentId)
                .in('status', ['processing', 'indexing']);
              
              console.log(`[CRITICAL] ✅ RAG 처리 실패로 인한 문서 상태 업데이트: ${resolvedDocumentId} -> failed`);
            } catch (updateError) {
              console.warn('[CRITICAL] ⚠️ 문서 상태 업데이트 실패 (계속 진행):', updateError);
            }
            
            // 타임아웃 또는 에러 발생 시 실패 결과 반환
            ragResult = {
              documentId: resolvedDocumentId,
              chunkCount: 0,
              success: false,
              error: ragError instanceof Error ? ragError.message : String(ragError),
            };
          }

          if (ragResult.success) {
            await supabase
              .from('documents')
              .update({
                status: 'indexed',
                chunk_count: ragResult.chunkCount,
                url: targetUrl, // URL 필드도 함께 업데이트 (하위 페이지 URL 보존)
                main_document_id: parentDocumentId || null, // main_document_id 유지 (RAG 처리 후에도 보존)
                updated_at: new Date().toISOString(),
              })
              .eq('id', resolvedDocumentId);
            
            // URL 업데이트 확인 로그
            console.log(`[CRITICAL] ✅ 하위 페이지 URL 업데이트 완료:`, {
              documentId: resolvedDocumentId,
              url: targetUrl,
              parentDocumentId: parentDocumentId || null,
              chunkCount: ragResult.chunkCount
            });
          } else {
            console.warn('⚠️ RAG 처리 실패 - 문서를 제거합니다:', resolvedDocumentId);
            if (!wasExistingDocument) {
              await supabase
                .from('documents')
                .delete()
                .eq('id', resolvedDocumentId);
            } else {
              await supabase
                .from('documents')
                .update({ status: 'failed', updated_at: new Date().toISOString() })
                .eq('id', resolvedDocumentId);
            }
          }

          // jobId 해제 (다음 작업을 위해)
          ragProcessor.setCurrentJobId(null);

          return {
            documentId: resolvedDocumentId,
            chunkCount: ragResult.chunkCount,
            success: ragResult.success,
          };
        };

        console.error('[CRITICAL] 📄 메인 페이지 크롤링 시작:', { url, documentId, extractSubPages, extractSubPagesRaw });
        
        // 메인 페이지 처리 전체 타임아웃: 5분 (크롤링 30초 + RAG 처리 4분 30초)
        const MAIN_PAGE_TIMEOUT = 5 * 60 * 1000; // 5분
        const mainPageStartTime = Date.now();
        
        // 하트비트 업데이트: 메인 페이지 처리 시작 (기존 result 유지)
        try {
          const currentResult = ((job as any).result as any) || {};
          await supabase
            .from('processing_jobs')
            .update({
              result: {
                ...currentResult, // 기존 result 유지
                url: url || currentResult.url,
                documentId: documentId || currentResult.documentId,
                status: 'main_page_crawling',
                message: '메인 페이지 크롤링 중...'
              }
            })
            .eq('id', job.id)
            .neq('status', 'cancelled');
        } catch (heartbeatError) {
          console.warn('[CRITICAL] ⚠️ 하트비트 업데이트 실패 (계속 진행):', heartbeatError);
        }
        
        let mainPage;
        try {
          // 메인 페이지 크롤링 타임아웃: 30초
          const fetchTimeout = 30000;
          const fetchPromise = fetchPageContent(url);
          const fetchTimeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`메인 페이지 크롤링 타임아웃: ${fetchTimeout}ms 초과`));
            }, fetchTimeout);
          });
          mainPage = await Promise.race([fetchPromise, fetchTimeoutPromise]) as Awaited<ReturnType<typeof fetchPageContent>>;
        } catch (fetchError) {
          console.error('[CRITICAL] ❌ 메인 페이지 크롤링 실패:', fetchError);
          // 실패 시 작업 상태 업데이트
          await supabase
            .from('processing_jobs')
            .update({
              status: 'failed',
              finished_at: new Date().toISOString(),
              result: { error: `메인 페이지 크롤링 실패: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}` }
            })
            .eq('id', job.id);
          throw new Error(`메인 페이지 크롤링 실패: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
        }
        
        console.error('[CRITICAL] 📄 메인 페이지 크롤링 완료:', { url, title: mainPage.pageTitle, contentLength: mainPage.textContent.length, htmlLength: mainPage.htmlContent.length });

        // 하트비트 업데이트: 메인 페이지 크롤링 완료, RAG 처리 시작 (기존 result 유지)
        try {
          const currentResult = ((job as any).result as any) || {};
          await supabase
            .from('processing_jobs')
            .update({
              result: {
                ...currentResult, // 기존 result 유지
                url: url || currentResult.url,
                documentId: documentId || currentResult.documentId,
                status: 'main_page_rag_processing',
                message: '메인 페이지 RAG 처리 중... (임베딩 모델 초기화 포함)',
                crawlElapsed: Date.now() - mainPageStartTime
              }
            })
            .eq('id', job.id)
            .neq('status', 'cancelled');
        } catch (heartbeatError) {
          console.warn('[CRITICAL] ⚠️ 하트비트 업데이트 실패 (계속 진행):', heartbeatError);
        }
        
        let mainDocResult;
        try {
          // RAG 처리 타임아웃: 5분 (Vercel Pro 플랜 최대 실행 시간 5분)
          // 정확도가 생명인 서비스이므로 타임아웃을 충분히 길게 설정
          // BGE-M3 초기화: 최대 90초 (콜드 스타트)
          // 청킹: 10초
          // 임베딩 생성: 3분 20초 (BGE-M3 사용 시)
          // 총: 5분 (안전 마진 포함)
          const ragTimeout = 5 * 60 * 1000; // 5분
          const ragStartTime = Date.now();
          
          // RAG 처리 진행 상황 모니터링을 위한 하트비트 (30초마다 업데이트)
          const ragHeartbeatInterval = setInterval(async () => {
            try {
              const elapsed = Date.now() - ragStartTime;
              const elapsedSeconds = (elapsed / 1000).toFixed(1);
              const remainingSeconds = ((ragTimeout - elapsed) / 1000).toFixed(1);
              
              const currentResult = ((job as any).result as any) || {};
              await supabase
                .from('processing_jobs')
                .update({
                  result: {
                    ...currentResult,
                    url: url || currentResult.url,
                    documentId: documentId || currentResult.documentId,
                    status: 'main_page_rag_processing',
                    message: `메인 페이지 RAG 처리 중... (경과: ${elapsedSeconds}초, 남은 시간: ${remainingSeconds}초)`,
                    crawlElapsed: Date.now() - mainPageStartTime,
                    ragElapsed: elapsed
                  }
                })
                .eq('id', job.id)
                .neq('status', 'cancelled');
              
              console.log(`[CRITICAL] 💓 RAG 처리 하트비트: 경과 ${elapsedSeconds}초, 남은 시간 ${remainingSeconds}초`);
            } catch (heartbeatError) {
              console.warn('[CRITICAL] ⚠️ RAG 처리 하트비트 업데이트 실패 (계속 진행):', heartbeatError);
            }
          }, 30000); // 30초마다 하트비트 업데이트
          
          const ragPromise = upsertAndProcessDocument({ targetUrl: url, title: mainPage.pageTitle, content: mainPage.textContent, documentIdOverride: documentId }).finally(() => {
            clearInterval(ragHeartbeatInterval);
          });
          
          const ragTimeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              clearInterval(ragHeartbeatInterval);
              const elapsed = Date.now() - ragStartTime;
              reject(new Error(`메인 페이지 RAG 처리 타임아웃: ${ragTimeout}ms 초과 (경과: ${elapsed}ms)`));
            }, ragTimeout);
          });
          mainDocResult = await Promise.race([ragPromise, ragTimeoutPromise]) as Awaited<ReturnType<typeof upsertAndProcessDocument>>;
        } catch (upsertError) {
          console.error('[CRITICAL] ❌ 메인 문서 처리 실패:', upsertError);
          // 타임아웃 에러인 경우 더 자세한 정보 제공
          const isTimeout = upsertError instanceof Error && upsertError.message.includes('타임아웃');
          if (isTimeout) {
            console.error('[CRITICAL] ⏱️ RAG 처리 타임아웃 발생 - 임베딩 모델 초기화가 오래 걸리고 있을 수 있습니다.');
          }
          // 실패 시 작업 상태 업데이트
          await supabase
            .from('processing_jobs')
            .update({
              status: 'failed',
              finished_at: new Date().toISOString(),
              result: { 
                error: `메인 문서 처리 실패: ${upsertError instanceof Error ? upsertError.message : String(upsertError)}`,
                isTimeout: isTimeout,
                suggestion: isTimeout ? '임베딩 모델 초기화가 오래 걸리고 있습니다. 잠시 후 다시 시도해주세요.' : undefined
              }
            })
            .eq('id', job.id);
          throw new Error(`메인 문서 처리 실패: ${upsertError instanceof Error ? upsertError.message : String(upsertError)}`);
        }
        
        const mainPageElapsed = Date.now() - mainPageStartTime;
        console.error('[CRITICAL] 📄 메인 문서 처리 완료:', { documentId, success: mainDocResult.success, chunkCount: mainDocResult.chunkCount, elapsed: mainPageElapsed });
        
        // 하트비트 업데이트: 메인 페이지 처리 완료 (기존 result 유지)
        try {
          const currentResult = ((job as any).result as any) || {};
          await supabase
            .from('processing_jobs')
            .update({
              result: {
                ...currentResult, // 기존 result 유지
                url: url || currentResult.url,
                documentId: documentId || currentResult.documentId,
                status: 'main_page_completed',
                message: '메인 페이지 처리 완료',
                chunkCount: mainDocResult.chunkCount,
                mainPageElapsed
              }
            })
            .eq('id', job.id)
            .neq('status', 'cancelled');
        } catch (heartbeatError) {
          console.warn('[CRITICAL] ⚠️ 하트비트 업데이트 실패 (계속 진행):', heartbeatError);
        }

        // document_id가 없으면 생성된 documentId로 업데이트
        if (!job.document_id && mainDocResult.documentId) {
          try {
          await supabase
            .from('processing_jobs')
              .update({ document_id: mainDocResult.documentId })
            .eq('id', job.id);
            console.log(`[CRITICAL] ✅ processing_jobs에 document_id 업데이트: ${mainDocResult.documentId}`);
          } catch (updateError) {
            console.warn('[CRITICAL] ⚠️ processing_jobs document_id 업데이트 실패 (계속 진행):', updateError);
          }
        }

        const subPageResults: Array<{ url: string; success: boolean; chunkCount?: number; error?: string; documentId?: string }> = [];

        // extractSubPages 값 재확인 (메인 문서 처리 후)
        const extractSubPagesAfterMain = extractSubPagesRaw === true || extractSubPagesRaw === 'true';
        console.error('[CRITICAL] 🔍 하위 페이지 크롤링 여부 확인 (메인 문서 처리 후):', {
          extractSubPages,
          extractSubPagesAfterMain,
          extractSubPagesRaw,
          extractSubPagesType: typeof extractSubPagesRaw,
          willCrawlSubPages: extractSubPages === true,
          condition: `extractSubPages (${extractSubPages}) === true`,
          url,
          documentId,
          mainDocResult: {
            success: mainDocResult.success,
            chunkCount: mainDocResult.chunkCount
          }
        });

        if (extractSubPages) {
          console.error('[CRITICAL] ✅ 하위 페이지 크롤링 시작 - extractSubPages가 true입니다.');
          try {
            const discoveryOptions = {
              maxDepth: Math.max(1, Math.min(maxDepth, 3)),
              maxUrls: 150, // 하위 페이지 발견 개수 증가 (기존: 50 → 150)
              respectRobotsTxt: respectRobots,
              includeExternal: false,
              allowedDomains: [seedUrl.hostname],
            };

            console.error('[CRITICAL] 🔍 하위 페이지 탐색 옵션:', {
              ...discoveryOptions,
              url,
              documentId
            });
            let discovered: Array<{ url: string; title?: string; source: string; depth: number }> = [];
            try {
              // SitemapDiscoveryService가 Puppeteer 실패 시 fetch fallback을 자동으로 사용
              console.log(`[CRITICAL] 🔍 하위 페이지 탐색 시작: ${url}`);
              const discoveryStartMs = Date.now();
              // 메인 페이지 HTML 재사용하여 중복 요청 방지 및 400 에러 회피
              discovered = await sitemapDiscoveryService.discoverSubPages(url, discoveryOptions, mainPage.htmlContent);
              const discoveryEndMs = Date.now();
              console.log(`[CRITICAL] ✅ 하위 페이지 발견 완료: ${discovered.length}개 (소요 시간: ${discoveryEndMs - discoveryStartMs}ms)`);
              
              // 발견된 페이지 상세 로그
              if (discovered.length > 0) {
                console.log('📋 발견된 하위 페이지 목록:');
                discovered.slice(0, 10).forEach((page, idx) => {
                  console.log(`  ${idx + 1}. ${page.url} (${page.source}, depth: ${page.depth})`);
                });
                if (discovered.length > 10) {
                  console.log(`  ... 외 ${discovered.length - 10}개`);
                }
              } else {
                console.error('[CRITICAL] ⚠️ 하위 페이지가 발견되지 않았습니다. Sitemap 또는 링크 추출이 실패했을 수 있습니다.', {
                  url,
                  documentId,
                  discoveryOptions
                });
              }
            } catch (discoveryError) {
              // 전체 탐색 실패 시에도 메인 페이지는 계속 처리
              console.error('[CRITICAL] ⚠️ 하위 페이지 탐색 중 오류 발생, 메인 페이지만 처리합니다:', {
                error: discoveryError,
                url,
                documentId,
                discoveryOptions
              });
              discovered = [];
            }
            
            // URL과 title 정보를 함께 유지
            const urlToTitleMap = new Map<string, string>();
            const candidateUrlSet = new Set<string>();
            
            discovered.forEach(entry => {
              if (entry.url && entry.url !== url && !entry.url.includes('#')) {
                candidateUrlSet.add(entry.url);
                // 링크 텍스트(메뉴명)가 있으면 저장
                if (entry.title && entry.title.trim().length > 0) {
                  urlToTitleMap.set(entry.url, entry.title.trim());
                }
              }
            });

            const candidateUrls = Array.from(candidateUrlSet).slice(0, 150); // maxUrls와 일치하도록 150개로 증가 (기존: 50)

            console.log(`[CRITICAL] 📄 하위 페이지 후보: ${candidateUrls.length}개 (발견: ${discovered.length}개, 필터링 후: ${candidateUrls.length}개)`, {
              url,
              documentId,
              discoveredUrls: discovered.map(d => d.url).slice(0, 10),
              candidateUrls: candidateUrls.slice(0, 10),
              titleMapSample: Array.from(urlToTitleMap.entries()).slice(0, 5)
            });
            
            if (candidateUrls.length === 0 && discovered.length > 0) {
              console.warn('[CRITICAL] ⚠️ 발견된 하위 페이지가 모두 필터링되었습니다. 필터 조건을 확인해주세요.', {
                url,
                documentId,
                discoveredCount: discovered.length,
                discoveredUrls: discovered.map(d => d.url)
              });
            }
            let processedCount = 0;

            // 병렬 처리: 메모리 최적화를 위해 배치 크기 조정 (150개 페이지 처리 시)
            // 150개 페이지 = 15개 배치 (10개씩) 또는 10개 배치 (15개씩)
            // 메모리 안정성을 위해 8개씩 처리 (기존: 10개)
            const BATCH_SIZE = 8; // 메모리 최적화: 10 → 8로 감소
            
            // 각 하위 페이지의 개별 상태 추적
            const subPageStatusMap = new Map<string, { url: string; title?: string; status: 'pending' | 'processing' | 'completed' | 'failed'; chunkCount?: number; error?: string }>();
            candidateUrls.forEach(subUrl => {
              const linkTitle = urlToTitleMap.get(subUrl);
              subPageStatusMap.set(subUrl, {
                url: subUrl,
                title: linkTitle,
                status: 'pending'
              });
            });
            
            console.log(`[CRITICAL] 🔄 하위 페이지 크롤링 시작: ${candidateUrls.length}개 (병렬 처리: 최대 ${BATCH_SIZE}개 동시)`, {
              url,
              documentId,
              candidateUrls: candidateUrls.slice(0, 5),
              batchSize: BATCH_SIZE,
              totalBatches: Math.ceil(candidateUrls.length / BATCH_SIZE)
            });
            
            // 초기 상태 저장 (모든 하위 페이지를 pending으로 설정)
            try {
              await supabase
                .from('processing_jobs')
                .update({
                  result: {
                    url,
                    documentId,
                    title: mainPage.pageTitle,
                    chunkCount: mainDocResult.chunkCount,
                    subPageProgress: { processed: 0, total: candidateUrls.length },
                    subPages: Array.from(subPageStatusMap.values()),
                  },
                })
                .eq('id', job.id)
                .neq('status', 'cancelled');
            } catch (initError) {
              console.error('[CRITICAL] ⚠️ 초기 상태 업데이트 실패 (계속 진행):', initError);
            }
            
            // 진행 상황 업데이트: 각 배치 완료 시마다 즉시 업데이트
            for (let i = 0; i < candidateUrls.length; i += BATCH_SIZE) {
              // 취소 체크: 배치 처리 전에 작업이 취소되었는지 확인
              const { data: currentJob } = await supabase
                .from('processing_jobs')
                .select('status')
                .eq('id', job.id)
                .single();
              
              if (currentJob?.status === 'cancelled') {
                console.log(`⚠️ 하위 페이지 처리 중 작업이 취소되었습니다: ${job.id}`);
                throw new Error('작업이 취소되었습니다.');
              }
              
              const batch = candidateUrls.slice(i, i + BATCH_SIZE);
              const batchStartTime = Date.now();
              // 타임아웃 강화: 배치당 90초로 단축 (무한 대기 방지)
              const BATCH_TIMEOUT = 90000; // 90초 타임아웃 (각 배치당, 기존: 2분)
              // 개별 페이지 타임아웃: fetch (20초) + RAG (60초) + 여유 (10초) = 90초
              const INDIVIDUAL_PAGE_TIMEOUT = 90000; // 90초 (개별 페이지당 최대 처리 시간, 배치 타임아웃과 동일)
              
              console.log(`[CRITICAL] 🔄 배치 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(candidateUrls.length / BATCH_SIZE)} 시작: ${batch.length}개 페이지 (인덱스 ${i}~${i + batch.length - 1})`);
              
              // 배치 병렬 처리
              const batchPromises = batch.map(async (subUrl) => {
                if (!subUrl) return null;

                try {
                  const linkTitle = urlToTitleMap.get(subUrl); // 링크 텍스트(메뉴명) 가져오기
                  const currentIndex = candidateUrls.indexOf(subUrl) + 1;
                  console.log(`[CRITICAL] 📄 하위 페이지 처리 중 (${currentIndex}/${candidateUrls.length}): ${subUrl}${linkTitle ? ` [링크제목: ${linkTitle}]` : ''}`);
                  
                  // 상태 엔트리 가져오기 (한 번만 선언하고 재사용)
                  const statusEntry = subPageStatusMap.get(subUrl);
                  
                  // 상태를 'processing'으로 업데이트
                  if (statusEntry) {
                    statusEntry.status = 'processing';
                    statusEntry.title = linkTitle || statusEntry.title;
                  }
                  
                  let page;
                  try {
                    // 페이지 다운로드에 타임아웃 추가 (20초로 단축)
                    const fetchTimeout = 20000; // 30초 → 20초로 단축
                    const fetchStartTime = Date.now();
                    const fetchPromise = fetchPageContent(subUrl);
                    const fetchTimeoutPromise = new Promise<never>((_, reject) => {
                      setTimeout(() => {
                        const elapsed = Date.now() - fetchStartTime;
                        reject(new Error(`페이지 다운로드 타임아웃: ${fetchTimeout}ms 초과 (경과: ${elapsed}ms)`));
                      }, fetchTimeout);
                    });
                    page = await Promise.race([fetchPromise, fetchTimeoutPromise]) as Awaited<ReturnType<typeof fetchPageContent>>;
                  } catch (fetchError) {
                    console.error('[CRITICAL] ❌ 하위 페이지 다운로드 실패:', {
                      url: subUrl,
                      error: fetchError,
                      documentId
                    });
                    
                    // 🔥 근본 원인 해결: 다운로드 실패 시 이미 생성된 문서가 있으면 failed로 업데이트
                    try {
                      const { data: failedDoc } = await supabase
                        .from('documents')
                        .select('id, status, chunk_count')
                        .eq('url', subUrl)
                        .eq('type', 'url')
                        .eq('main_document_id', documentId)
                        .eq('status', 'processing')
                        .eq('chunk_count', 0)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .maybeSingle();
                      
                      if (failedDoc) {
                        await supabase
                          .from('documents')
                          .update({ 
                            status: 'failed', 
                            updated_at: new Date().toISOString() 
                          })
                          .eq('id', failedDoc.id)
                          .eq('status', 'processing')
                          .eq('chunk_count', 0);
                        
                        console.log(`[CRITICAL] ✅ 다운로드 실패로 인한 문서 상태 업데이트: ${failedDoc.id} -> failed`);
                      }
                    } catch (docUpdateError) {
                      console.warn(`[CRITICAL] ⚠️ 다운로드 실패 시 문서 상태 업데이트 실패: ${subUrl}`, docUpdateError);
                    }
                    
                    if (statusEntry) {
                      statusEntry.status = 'failed';
                      statusEntry.error = fetchError instanceof Error ? fetchError.message : String(fetchError);
                    }
                    return {
                      url: subUrl,
                      success: false,
                      error: fetchError instanceof Error ? fetchError.message : String(fetchError),
                    };
                  }
                  
                  // 제목 우선순위: 히어로 영역 제목 > 링크 텍스트(메뉴명) > 페이지 제목 > URL 경로
                  // 메인 페이지 제목과 구분되도록 강화된 로직
                  let finalTitle = null;
                  
                  // 0. 히어로 영역 제목 추출 (페이지 HTML에서 직접 추출)
                  let heroTitle = null;
                  try {
                    const $page = cheerio.load(page.htmlContent || '');
                    
                    // h1, h2 태그 우선 확인
                    const h1Text = $page('h1').first().text().trim();
                    const h2Text = $page('h2').first().text().trim();
                    
                    if (h1Text && h1Text.length >= 2 && h1Text.length <= 100 && 
                        h1Text !== mainPage.pageTitle && 
                        !h1Text.toLowerCase().includes('광고주센터') && 
                        !h1Text.toLowerCase().includes('광고주 센터') && 
                        !h1Text.toLowerCase().includes('advertiser center')) {
                      heroTitle = h1Text;
                    } else if (h2Text && h2Text.length >= 2 && h2Text.length <= 100 && 
                               h2Text !== mainPage.pageTitle && 
                               !h2Text.toLowerCase().includes('광고주센터') && 
                               !h2Text.toLowerCase().includes('광고주 센터') && 
                               !h2Text.toLowerCase().includes('advertiser center')) {
                      heroTitle = h2Text;
                    } else {
                      // 상단 영역에서 큰 볼드 텍스트 찾기
                      const heroSelectors = [
                        'main h1', 'main h2',
                        'article h1', 'article h2',
                        'section:first-of-type h1', 'section:first-of-type h2',
                        'header h1', 'header h2',
                        '.hero h1', '.hero h2',
                        '.banner h1', '.banner h2',
                        '.page-title', '.article-title', '.post-title', '.entry-title',
                        'h1.page-title', 'h1.article-title',
                        '.content-title', '.main-title'
                      ];
                      
                      for (const selector of heroSelectors) {
                        const text = $page(selector).first().text().trim();
                        if (text && text.length >= 2 && text.length <= 100 && 
                            text !== mainPage.pageTitle && 
                            !text.toLowerCase().includes('광고주센터') && 
                            !text.toLowerCase().includes('광고주 센터') && 
                            !text.toLowerCase().includes('advertiser center')) {
                          heroTitle = text;
                          break;
                        }
                      }
                    }
                  } catch (heroError) {
                    console.warn(`[CRITICAL] ⚠️ 히어로 제목 추출 실패: ${subUrl}`, heroError);
                  }
                  
                  // 1. 히어로 영역 제목이 있으면 최우선 사용
                  if (heroTitle) {
                    finalTitle = heroTitle;
                    console.log(`[CRITICAL] 📝 하위 페이지 제목 결정 (히어로 영역): ${subUrl} -> "${finalTitle}"`);
                  }
                  // 2. 링크 텍스트가 있고 메인 페이지 제목과 다르면 사용
                  else if (linkTitle && linkTitle.length >= 2 && linkTitle !== mainPage.pageTitle && !linkTitle.toLowerCase().includes('광고주센터') && !linkTitle.toLowerCase().includes('광고주 센터') && !linkTitle.toLowerCase().includes('advertiser center')) {
                    finalTitle = linkTitle;
                    console.log(`[CRITICAL] 📝 하위 페이지 제목 결정 (링크 텍스트): ${subUrl} -> "${finalTitle}"`);
                  }
                  // 3. 페이지 제목이 있고 메인 페이지 제목과 다르면 사용
                  else if (page.pageTitle && page.pageTitle.length >= 2 && page.pageTitle !== mainPage.pageTitle && !page.pageTitle.toLowerCase().includes('광고주센터') && !page.pageTitle.toLowerCase().includes('광고주 센터') && !page.pageTitle.toLowerCase().includes('advertiser center')) {
                    finalTitle = page.pageTitle;
                    console.log(`[CRITICAL] 📝 하위 페이지 제목 결정 (페이지 제목): ${subUrl} -> "${finalTitle}"`);
                  }
                  // 3. URL 경로에서 의미있는 제목 추출
                  else {
                    try {
                      const urlPath = new URL(subUrl).pathname;
                      if (urlPath && urlPath !== '/') {
                        const pathParts = urlPath.split('/').filter(p => p.length > 0);
                        if (pathParts.length > 0) {
                          // 마지막 경로를 제목으로 사용
                          let pathTitle = pathParts[pathParts.length - 1];
                          
                          // URL 디코딩 시도 (한글 경로 지원)
                          try {
                            pathTitle = decodeURIComponent(pathTitle);
                          } catch (e) {
                            // 디코딩 실패 시 원본 사용
                          }
                          
                          // 하이픈/언더스코어를 공백으로 변환하고 단어 첫 글자 대문자화
                          pathTitle = pathTitle
                            .replace(/[-_]/g, ' ')
                            .split(' ')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                            .join(' ')
                            .trim();
                          
                          // 경로 기반 제목이 의미있으면 사용
                          if (pathTitle && pathTitle.length >= 2 && pathTitle !== mainPage.pageTitle) {
                            finalTitle = pathTitle;
                            console.log(`[CRITICAL] 📝 하위 페이지 제목 결정 (URL 경로): ${subUrl} -> "${finalTitle}"`);
                          }
                        }
                      }
                    } catch (urlError) {
                      // URL 파싱 실패 시 무시
                    }
                  }
                  
                  // 4. 최종 제목이 없거나 메인 페이지 제목과 같거나 "광고주센터" 관련이면 URL 경로 기반 제목 생성
                  if (!finalTitle || finalTitle === mainPage.pageTitle || finalTitle.toLowerCase().includes('광고주센터') || finalTitle.toLowerCase().includes('광고주 센터') || finalTitle.toLowerCase().includes('advertiser center')) {
                    try {
                      const urlPath = new URL(subUrl).pathname;
                      if (urlPath && urlPath !== '/') {
                        const pathParts = urlPath.split('/').filter(p => p.length > 0);
                        if (pathParts.length > 0) {
                          let pathTitle = pathParts[pathParts.length - 1];
                          try {
                            pathTitle = decodeURIComponent(pathTitle);
                          } catch (e) {
                            // 디코딩 실패 시 원본 사용
                          }
                          
                          // 경로를 한글로 변환 시도 (일반적인 경로 패턴)
                          const pathTitleMap: Record<string, string> = {
                            'sales': '매출',
                            'offline': '오프라인',
                            'website': '웹사이트',
                            'recommend': '추천',
                            'guarantee': '보장형',
                            'shoppingBlock': '쇼핑블록',
                            'adtips': '광고 팁',
                            'gfa': 'GFA',
                            'sa': '검색광고',
                            'sub': '하위',
                            'intro': '소개',
                            'start': '시작'
                          };
                          
                          // 경로 제목 매핑 시도
                          const lowerPathTitle = pathTitle.toLowerCase();
                          if (pathTitleMap[lowerPathTitle]) {
                            finalTitle = pathTitleMap[lowerPathTitle];
                          } else {
                            // 매핑이 없으면 경로를 제목으로 사용
                            finalTitle = pathTitle
                              .replace(/[-_]/g, ' ')
                              .split(' ')
                              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                              .join(' ')
                              .trim();
                          }
                          
                          // 여전히 제목이 없거나 메인 페이지 제목과 같으면 URL 사용
                          if (!finalTitle || finalTitle.length < 2 || finalTitle === mainPage.pageTitle) {
                            finalTitle = subUrl;
                          }
                        } else {
                          finalTitle = subUrl;
                        }
                      } else {
                        finalTitle = subUrl;
                      }
                    } catch (urlError) {
                      // URL 파싱 실패 시 원본 URL 사용
                      finalTitle = subUrl;
                    }
                  }
                  
                  console.log(`[CRITICAL] 📝 최종 하위 페이지 제목: ${subUrl} -> "${finalTitle}" (원본 페이지 제목: "${page.pageTitle}", 링크 텍스트: "${linkTitle}", 메인 페이지 제목: "${mainPage.pageTitle}")`);
                  
                  let result;
                  let createdDocumentId: string | undefined = undefined;
                  try {
                    // RAG 처리에 타임아웃 추가 (60초로 단축 - 배치 타임아웃 내에 완료되어야 함)
                    const ragTimeout = 60000; // 90초 → 60초로 단축 (배치 타임아웃 90초 내에 완료되어야 함)
                    const ragStartTime = Date.now();
                    const ragPromise = upsertAndProcessDocument({ 
                      targetUrl: subUrl, 
                      title: finalTitle, 
                      content: page.textContent,
                      parentDocumentId: documentId // 부모 문서 ID 전달
                    });
                    const ragTimeoutPromise = new Promise<never>((_, reject) => {
                      setTimeout(() => {
                        const elapsed = Date.now() - ragStartTime;
                        reject(new Error(`RAG 처리 타임아웃: ${ragTimeout}ms 초과 (경과: ${elapsed}ms)`));
                      }, ragTimeout);
                    });
                    result = await Promise.race([ragPromise, ragTimeoutPromise]) as Awaited<ReturnType<typeof upsertAndProcessDocument>>;
                    createdDocumentId = result.documentId;
                  } catch (processError) {
                    console.error('[CRITICAL] ❌ 하위 페이지 RAG 처리 실패:', {
                      url: subUrl,
                      error: processError,
                      documentId
                    });
                    
                    // 타임아웃이나 에러 발생 시 문서 상태를 failed로 업데이트
                    // upsertAndProcessDocument 내부에서 문서가 생성되었을 수 있으므로 확인 후 업데이트
                    try {
                      if (!createdDocumentId) {
                        // documentId를 찾기 위해 URL로 조회
                        const { data: failedDoc } = await supabase
                          .from('documents')
                          .select('id, status, chunk_count')
                          .eq('url', subUrl)
                          .eq('type', 'url')
                          .eq('main_document_id', documentId)
                          .eq('status', 'processing')
                          .eq('chunk_count', 0)
                          .order('created_at', { ascending: false })
                          .limit(1)
                          .maybeSingle();
                        
                        if (failedDoc) {
                          createdDocumentId = failedDoc.id;
                        }
                      }
                      
                      if (createdDocumentId) {
                        // 문서 상태를 failed로 업데이트
                        await supabase
                          .from('documents')
                          .update({ 
                            status: 'failed', 
                            updated_at: new Date().toISOString() 
                          })
                          .eq('id', createdDocumentId)
                          .eq('status', 'processing')
                          .eq('chunk_count', 0);
                        
                        console.log(`[CRITICAL] ✅ 실패한 하위 페이지 문서 상태 업데이트: ${createdDocumentId} -> failed`);
                      }
                    } catch (updateError) {
                      console.warn('[CRITICAL] ⚠️ 실패한 하위 페이지 문서 상태 업데이트 실패:', updateError);
                    }
                    
                    if (statusEntry) {
                      statusEntry.status = 'failed';
                      statusEntry.error = processError instanceof Error ? processError.message : String(processError);
                    }
                    return {
                      url: subUrl,
                      success: false,
                      error: processError instanceof Error ? processError.message : String(processError),
                      documentId: createdDocumentId,
                    };
                  }
                  
                  if (!result.success) {
                    console.warn(`[CRITICAL] ⚠️ 하위 페이지 처리 실패 (성공=false): ${subUrl} [제목: ${finalTitle}]`);
                    
                    // RAG 처리 실패 시 문서 상태를 failed로 업데이트
                    const failedDocId = result.documentId;
                    if (failedDocId) {
                      try {
                        await supabase
                          .from('documents')
                          .update({ 
                            status: 'failed', 
                            updated_at: new Date().toISOString() 
                          })
                          .eq('id', failedDocId)
                          .in('status', ['processing', 'indexing']);
                        
                        console.log(`[CRITICAL] ✅ 실패한 하위 페이지 문서 상태 업데이트: ${failedDocId} -> failed`);
                      } catch (updateError) {
                        console.warn('[CRITICAL] ⚠️ 실패한 하위 페이지 문서 상태 업데이트 실패:', updateError);
                      }
                    }
                    
                    if (statusEntry) {
                      statusEntry.status = 'failed';
                      statusEntry.error = (result as any).error || 'RAG 처리 실패';
                      statusEntry.chunkCount = result.chunkCount || 0;
                    }
                    return {
                      url: subUrl,
                      success: false,
                      error: (result as any).error || 'RAG 처리 실패',
                      chunkCount: result.chunkCount || 0,
                      documentId: result.documentId,
                    };
                  }
                  
                  // 상태를 'completed'로 업데이트
                  if (statusEntry) {
                    statusEntry.status = 'completed';
                    statusEntry.chunkCount = result.chunkCount;
                    statusEntry.title = finalTitle || statusEntry.title;
                  }
                  
                  console.log(`[CRITICAL] ✅ 하위 페이지 처리 완료: ${subUrl} [제목: ${finalTitle}] (청크: ${result.chunkCount}개, 문서 ID: ${result.documentId})`);
                  
                  // 메모리 최적화: 처리 완료된 페이지 데이터 즉시 해제
                  page = null as any;
                  
                  return { url: subUrl, success: result.success, chunkCount: result.chunkCount, documentId: result.documentId };
              } catch (subError) {
                  console.error('[CRITICAL] ❌ 하위 페이지 처리 중 예상치 못한 에러:', {
                  url: subUrl,
                  error: subError,
                  documentId
                });
                  const errorStatusEntry = subPageStatusMap.get(subUrl);
                  if (errorStatusEntry) {
                    errorStatusEntry.status = 'failed';
                    errorStatusEntry.error = subError instanceof Error ? subError.message : String(subError);
                  }
                  return {
                  url: subUrl,
                  success: false,
                  error: subError instanceof Error ? subError.message : String(subError),
                  };
                }
              });

              // 배치 결과 대기 (각 Promise가 실패해도 전체가 실패하지 않도록 처리)
              // 타임아웃 추가: 배치 처리에 시간 제한 설정 - 타임아웃 시 강제 종료
              let batchResults: PromiseSettledResult<any>[];
              
              // 각 Promise에 개별 타임아웃을 적용한 래퍼 생성
              // 타임아웃이 발생하면 즉시 실패로 처리하여 Promise.allSettled가 무한 대기하지 않도록 함
              const wrappedPromises = batchPromises.map((promise, idx) => {
                const subUrl = batch[idx];
                let timeoutId: NodeJS.Timeout | null = null;
                let isResolved = false;
                
                // 타임아웃 Promise 생성 (개별 페이지 타임아웃 사용)
                const timeoutPromise = new Promise<any>((_, reject) => {
                  timeoutId = setTimeout(() => {
                    if (!isResolved) {
                      console.warn(`[CRITICAL] ⏱️ 개별 페이지 타임아웃: ${subUrl} (${INDIVIDUAL_PAGE_TIMEOUT}ms 초과)`);
                      const errorStatusEntry = subPageStatusMap.get(subUrl);
                      if (errorStatusEntry && errorStatusEntry.status === 'processing') {
                        errorStatusEntry.status = 'failed';
                        errorStatusEntry.error = `개별 페이지 타임아웃: ${INDIVIDUAL_PAGE_TIMEOUT}ms 초과`;
                      }
                      reject(new Error(`개별 페이지 타임아웃: ${INDIVIDUAL_PAGE_TIMEOUT}ms 초과`));
                    }
                  }, INDIVIDUAL_PAGE_TIMEOUT);
                });
                
                // Promise.race로 타임아웃 적용
                return Promise.race([
                  promise.then(result => {
                    isResolved = true;
                    // 성공 시 타임아웃 취소
                    if (timeoutId) clearTimeout(timeoutId);
                    return result;
                  }).catch(error => {
                    isResolved = true;
                    // 실패 시 타임아웃 취소
                    if (timeoutId) clearTimeout(timeoutId);
                    throw error;
                  }),
                  timeoutPromise
                ]).catch(error => {
                  // 타임아웃 또는 기타 에러 발생 시 실패 결과 반환
                  isResolved = true;
                  if (timeoutId) clearTimeout(timeoutId);
                  return {
                    url: subUrl,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                  };
                });
              });
              
              // Promise.allSettled에 타임아웃을 적용하여 무한 대기 방지
              // 중요: Promise.allSettled는 내부적으로 무한 대기할 수 있으므로, 
              // 배치 타임아웃을 더 짧게 설정하고 타임아웃 발생 시 즉시 강제 종료
              const allSettledPromise = Promise.allSettled(wrappedPromises);
              const batchStartTimeForTimeout = Date.now();
              
              // 배치 전체 타임아웃: BATCH_TIMEOUT과 동일하게 설정하여 강제 종료 보장
              // 타임아웃 발생 시 즉시 모든 미완료 작업을 실패로 처리하고 Promise.race가 타임아웃 Promise를 선택하도록 보장
              const overallTimeoutPromise = new Promise<PromiseSettledResult<any>[]>((resolve) => {
                const timeoutId = setTimeout(() => {
                  const elapsed = Date.now() - batchStartTimeForTimeout;
                  console.error(`[CRITICAL] ⏱️ 배치 ${Math.floor(i / BATCH_SIZE) + 1} 전체 타임아웃 발생: ${BATCH_TIMEOUT}ms 초과 (경과: ${elapsed}ms) - 미완료 작업을 즉시 실패로 처리`);
                  
                  // 타임아웃 발생 시 모든 미완료 작업을 즉시 실패로 처리
                  const timeoutResults: PromiseSettledResult<any>[] = [];
                  batch.forEach((subUrl) => {
                    const statusEntry = subPageStatusMap.get(subUrl);
                    if (statusEntry && (statusEntry.status === 'processing' || statusEntry.status === 'pending')) {
                      statusEntry.status = 'failed';
                      statusEntry.error = `배치 전체 타임아웃: ${BATCH_TIMEOUT}ms 초과`;
                    }
                    timeoutResults.push({
                      status: 'rejected' as const,
                      reason: new Error(`배치 전체 타임아웃: ${BATCH_TIMEOUT}ms 초과`)
                    } as PromiseRejectedResult);
                  });
                  resolve(timeoutResults);
                }, BATCH_TIMEOUT);
                
                // allSettledPromise가 먼저 완료되면 타임아웃 취소
                allSettledPromise.then(() => {
                  clearTimeout(timeoutId);
                }).catch(() => {
                  clearTimeout(timeoutId);
                });
              });
              
              try {
                // 전체 배치에 대한 타임아웃 적용 (타임아웃 시 즉시 실패 처리)
                // Promise.race는 먼저 완료되는 Promise를 반환하므로, 타임아웃이 발생하면 즉시 타임아웃 결과를 반환
                batchResults = await Promise.race([allSettledPromise, overallTimeoutPromise]);
                
                // 타임아웃이 발생했는지 확인 (배치 타임아웃 메시지가 포함된 결과인지 확인)
                const isTimeoutResult = batchResults.length > 0 && batchResults.every((result) => {
                  if (result.status === 'rejected') {
                    return result.reason instanceof Error && result.reason.message.includes('배치 전체 타임아웃');
                  }
                  return false;
                });
                
                if (isTimeoutResult) {
                  console.error(`[CRITICAL] ⚠️ 배치 ${Math.floor(i / BATCH_SIZE) + 1} 타임아웃으로 인해 모든 작업이 실패 처리되었습니다.`);
                }
              } catch (batchError) {
                console.error(`[CRITICAL] ❌ 배치 ${Math.floor(i / BATCH_SIZE) + 1} 처리 중 예상치 못한 에러:`, batchError);
                // 에러 발생 시 모든 항목을 실패로 처리
                batchResults = batch.map((subUrl) => {
                  const errorStatusEntry = subPageStatusMap.get(subUrl);
                  if (errorStatusEntry && errorStatusEntry.status === 'processing') {
                    errorStatusEntry.status = 'failed';
                    errorStatusEntry.error = batchError instanceof Error ? batchError.message : String(batchError);
                  }
                  return {
                    status: 'rejected' as const,
                    reason: batchError instanceof Error ? batchError : new Error(String(batchError))
                  } as PromiseRejectedResult;
                });
              }
              
              // 타임아웃으로 실패한 항목 확인 및 로깅
              const timedOutCount = batchResults.filter((result, idx) => {
                if (result.status === 'rejected') {
                  const reason = result.reason;
                  return reason instanceof Error && (reason.message.includes('배치 타임아웃') || reason.message.includes('배치 전체 타임아웃'));
                }
                if (result.status === 'fulfilled' && result.value) {
                  const value = result.value as any;
                  return value.error && (value.error.includes('배치 타임아웃') || value.error.includes('배치 전체 타임아웃'));
                }
                return false;
              }).length;
              
              if (timedOutCount > 0) {
                console.warn(`[CRITICAL] ⏱️ 배치 ${Math.floor(i / BATCH_SIZE) + 1} 타임아웃 발생: ${timedOutCount}개 페이지가 타임아웃됨 (${BATCH_TIMEOUT}ms 초과) - 완료된 작업만 처리하고 계속 진행`);
              }
              
              // 배치 결과 처리 및 문서 상태 업데이트
              for (const [idx, settledResult] of batchResults.entries()) {
                const subUrl = batch[idx];
                
                if (settledResult.status === 'fulfilled' && settledResult.value) {
                  subPageResults.push(settledResult.value);
                } else if (settledResult.status === 'rejected') {
                  console.error(`[CRITICAL] ❌ 배치 처리 중 예상치 못한 에러 (하위 페이지 ${idx + 1}):`, {
                    url: subUrl,
                    error: settledResult.reason
                  });
                  
                  // 상태 엔트리 업데이트
                  const errorStatusEntry = subPageStatusMap.get(subUrl);
                  if (errorStatusEntry) {
                    errorStatusEntry.status = 'failed';
                    errorStatusEntry.error = settledResult.reason instanceof Error ? settledResult.reason.message : String(settledResult.reason);
                  }
                  
                  // 🔥 근본 원인 해결: 배치 처리 실패 시 문서 상태를 failed로 업데이트
                  try {
                    // URL과 main_document_id로 문서 찾기
                    const { data: failedDoc } = await supabase
                      .from('documents')
                      .select('id, status, chunk_count')
                      .eq('url', subUrl)
                      .eq('type', 'url')
                      .eq('main_document_id', documentId)
                      .eq('status', 'processing')
                      .eq('chunk_count', 0)
                      .order('created_at', { ascending: false })
                      .limit(1)
                      .maybeSingle();
                    
                    if (failedDoc) {
                      // 문서 상태를 failed로 업데이트
                      await supabase
                        .from('documents')
                        .update({ 
                          status: 'failed', 
                          updated_at: new Date().toISOString() 
                        })
                        .eq('id', failedDoc.id)
                        .eq('status', 'processing')
                        .eq('chunk_count', 0);
                      
                      console.log(`[CRITICAL] ✅ 배치 처리 실패로 인한 문서 상태 업데이트: ${failedDoc.id} -> failed`);
                    }
                  } catch (docUpdateError) {
                    console.warn(`[CRITICAL] ⚠️ 배치 처리 실패 시 문서 상태 업데이트 실패: ${subUrl}`, docUpdateError);
                  }
                  
                  subPageResults.push({
                    url: subUrl,
                    success: false,
                    error: settledResult.reason instanceof Error ? settledResult.reason.message : String(settledResult.reason),
                  });
                }
              }
              
              // 타임아웃 체크 및 배치 완료 로그
              const batchElapsedTime = Date.now() - batchStartTime;
              if (batchElapsedTime > BATCH_TIMEOUT) {
                console.warn(`[CRITICAL] ⏱️ 배치 ${Math.floor(i / BATCH_SIZE) + 1} 처리 시간 초과: ${batchElapsedTime}ms (제한: ${BATCH_TIMEOUT}ms)`);
              }
              processedCount = subPageResults.length; // 실제 처리된 개수로 업데이트
              console.log(`[CRITICAL] 📊 배치 ${Math.floor(i / BATCH_SIZE) + 1} 완료: ${processedCount}/${candidateUrls.length} 처리됨 (소요 시간: ${batchElapsedTime}ms)`);
              
              // 취소 체크: 배치 처리 후에도 취소되었는지 확인
              const { data: currentJobAfterBatch } = await supabase
                .from('processing_jobs')
                .select('status')
                .eq('id', job.id)
                .single();
              
              if (currentJobAfterBatch?.status === 'cancelled') {
                console.log(`⚠️ 배치 처리 중 작업이 취소되었습니다: ${job.id}`);
                throw new Error('작업이 취소되었습니다.');
              }
              
              // 진행 상황 업데이트: 각 배치 완료 시마다 즉시 업데이트 (모든 하위 페이지 상태 포함)
              try {
                const completedCount = Array.from(subPageStatusMap.values()).filter(s => s.status === 'completed').length;
                const failedCount = Array.from(subPageStatusMap.values()).filter(s => s.status === 'failed').length;
                const processingCount = Array.from(subPageStatusMap.values()).filter(s => s.status === 'processing').length;
                const pendingCount = Array.from(subPageStatusMap.values()).filter(s => s.status === 'pending').length;
                
                // processedCount: 완료 + 실패 (실제로 처리 완료된 페이지 수)
                // 이렇게 하면 진행률이 정확하게 표시됩니다 (처리 중인 페이지는 제외)
                const processedCount = completedCount + failedCount;
                
              await supabase
                .from('processing_jobs')
                .update({
                  result: {
                    url,
                    documentId,
                    title: mainPage.pageTitle,
                    chunkCount: mainDocResult.chunkCount,
                      subPageProgress: { 
                        processed: processedCount, 
                        total: candidateUrls.length,
                        completed: completedCount,
                        failed: failedCount,
                        processing: processingCount,
                        pending: pendingCount
                      },
                      subPages: Array.from(subPageStatusMap.values()), // 모든 하위 페이지 상태 저장
                    },
                  })
                  .eq('id', job.id)
                  .neq('status', 'cancelled'); // 취소된 작업은 업데이트하지 않음
                console.log(`[CRITICAL] 📊 진행 상황 업데이트: ${processedCount}/${candidateUrls.length} (${Math.round((processedCount / candidateUrls.length) * 100)}%) - 완료: ${completedCount}, 실패: ${failedCount}, 처리중: ${processingCount}, 대기: ${pendingCount}`);
              } catch (updateError) {
                console.error('[CRITICAL] ⚠️ 진행 상황 업데이트 실패 (계속 진행):', updateError);
              }
            }
            
            // 마지막 진행 상황 업데이트 (모든 배치 완료 후)
            const finalCompletedCount = Array.from(subPageStatusMap.values()).filter(s => s.status === 'completed').length;
            const finalFailedCount = Array.from(subPageStatusMap.values()).filter(s => s.status === 'failed').length;
            const finalProcessingCount = Array.from(subPageStatusMap.values()).filter(s => s.status === 'processing').length;
            const finalPendingCount = Array.from(subPageStatusMap.values()).filter(s => s.status === 'pending').length;
            const finalProcessedCount = finalCompletedCount + finalFailedCount;
            
            if (finalProcessedCount > 0 || candidateUrls.length > 0) {
              await supabase
                .from('processing_jobs')
                .update({
                  result: {
                    url,
                    documentId,
                    title: mainPage.pageTitle,
                    chunkCount: mainDocResult.chunkCount,
                    subPageProgress: { 
                      processed: finalProcessedCount, 
                      total: candidateUrls.length,
                      completed: finalCompletedCount,
                      failed: finalFailedCount,
                      processing: finalProcessingCount,
                      pending: finalPendingCount
                    },
                    subPages: Array.from(subPageStatusMap.values()), // 모든 하위 페이지 상태 저장
                  },
                })
                .eq('id', job.id);
              console.log(`[CRITICAL] 📊 최종 진행 상황 업데이트: ${finalProcessedCount}/${candidateUrls.length} (${Math.round((finalProcessedCount / candidateUrls.length) * 100)}%) - 완료: ${finalCompletedCount}, 실패: ${finalFailedCount}, 처리중: ${finalProcessingCount}, 대기: ${finalPendingCount}`);
            }
          } catch (subDiscoveryError) {
            console.error('❌ 하위 페이지 탐색 실패:', subDiscoveryError);
            subPageResults.push({
              url: url,
              success: false,
              error: subDiscoveryError instanceof Error ? subDiscoveryError.message : String(subDiscoveryError),
            });
          } finally {
            await sitemapDiscoveryService.close().catch(() => {});
            // Puppeteer 서비스 정리
            if (puppeteerService) {
              const service: PuppeteerCrawlingService = puppeteerService;
              await service.close().catch(() => {});
              puppeteerService = null;
            }
          }
        } else {
          console.error('[CRITICAL] ⚠️ 하위 페이지 크롤링 건너뜀 - extractSubPages가 false입니다.', {
            extractSubPages,
            payloadExtractSubPages: job.payload?.extractSubPages,
            url,
            documentId
          });
        }

        // 실패한 하위 페이지 자동 재처리 (해시 모드 활성화 시)
        const failedSubPages = subPageResults.filter((item) => !item.success);
        const reprocessedSubPages: Array<{ url: string; success: boolean; error?: string }> = [];
        
        const isHashEmbeddingEnabled =
          (process.env.USE_HASH_EMBEDDING ?? 'false').toLowerCase() === 'true';
        if (failedSubPages.length > 0 && isHashEmbeddingEnabled) {
          console.log(`[CRITICAL] 🔄 실패한 하위 페이지 자동 재처리 시작: ${failedSubPages.length}개`);
          
          for (const failedPage of failedSubPages) {
            try {
              // 실패한 문서 ID 찾기
              const { data: failedDoc } = await supabase
                .from('documents')
                .select('id, url, content, title, source_vendor, main_document_id, created_at')
                .eq('url', failedPage.url)
                .eq('type', 'url')
                .maybeSingle();
              
              if (failedDoc && failedDoc.content && failedDoc.content.trim().length > 0) {
                // RAG 재처리
                ragProcessor.setCurrentJobId(job.id);
                const reprocessResult = await ragProcessor.processDocument({
                  id: failedDoc.id,
                  title: failedDoc.title,
                  content: failedDoc.content,
                  type: 'url',
                  file_size: Buffer.byteLength(failedDoc.content, 'utf8'),
                  file_type: 'text/html',
                  url: failedPage.url || failedDoc.url || undefined,
                  source_vendor: failedDoc.source_vendor || dbVendor,
                  created_at: (failedDoc as any).created_at || new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
                
                if (reprocessResult.success) {
                  await supabase
                    .from('documents')
                    .update({
                      status: 'indexed',
                      chunk_count: reprocessResult.chunkCount,
                      updated_at: new Date().toISOString(),
                    })
                    .eq('id', failedDoc.id);
                  
                  reprocessedSubPages.push({ url: failedPage.url, success: true });
                  console.log(`[CRITICAL] ✅ 하위 페이지 재처리 성공: ${failedPage.url} (청크: ${reprocessResult.chunkCount}개)`);
                } else {
                  reprocessedSubPages.push({
                    url: failedPage.url,
                    success: false,
                    error: reprocessResult.error || '재처리 실패',
                  });
                  console.warn(`[CRITICAL] ⚠️ 하위 페이지 재처리 실패: ${failedPage.url}`);
                }
              } else {
                reprocessedSubPages.push({
                  url: failedPage.url,
                  success: false,
                  error: '콘텐츠가 없어 재처리 불가',
                });
              }
            } catch (reprocessError) {
              reprocessedSubPages.push({
                url: failedPage.url,
                success: false,
                error: reprocessError instanceof Error ? reprocessError.message : String(reprocessError),
              });
              console.error(`[CRITICAL] ❌ 하위 페이지 재처리 중 에러: ${failedPage.url}`, reprocessError);
            }
          }
          
          console.log(`[CRITICAL] 📊 하위 페이지 재처리 완료: ${reprocessedSubPages.filter(p => p.success).length}/${failedSubPages.length} 성공`);
        }

        const finishedResult = {
          url,
          documentId,
          title: mainPage.pageTitle,
          chunkCount: mainDocResult.chunkCount,
          vendors,
          domainLimit,
          respectRobots,
          maxDepth,
          extractSubPages,
          subPageCount: subPageResults.filter((item) => item.success).length + reprocessedSubPages.filter((p) => p.success).length,
          subPages: subPageResults,
          reprocessedSubPages: reprocessedSubPages.length > 0 ? reprocessedSubPages : undefined,
          crawlTimeMs: Date.now() - crawlStartMs,
        };

        console.log('[CRITICAL] ✅ CRAWL_SEED 작업 완료 - 상태 업데이트 시작:', {
          jobId: job.id,
          documentId,
          title: mainPage.pageTitle,
          chunkCount: mainDocResult.chunkCount,
          crawlTimeMs: finishedResult.crawlTimeMs
        });

        // 🔥 원자적 업데이트: documents 테이블 먼저 업데이트 후 processing_jobs 업데이트
        // 1. 메인 문서 상태 업데이트 (chunk_count > 0이면 무조건 indexed로 업데이트)
        let mainDocUpdated = false;
        if (documentId && mainDocResult.chunkCount > 0) {
          // 먼저 현재 상태 확인 (중복 방지를 위해 maybeSingle 사용)
          const { data: currentDoc, error: currentDocError } = await supabase
            .from('documents')
            .select('id, status, chunk_count')
            .eq('id', documentId)
            .maybeSingle();
          
          if (currentDocError && currentDocError.code !== 'PGRST116') {
            console.error('[CRITICAL] ⚠️ 메인 문서 조회 실패:', {
              documentId,
              error: currentDocError
            });
          }
          
          // 이미 indexed 상태이거나 chunk_count가 이미 설정되어 있으면 성공으로 간주
          if (currentDoc && (currentDoc.status === 'indexed' || (currentDoc.chunk_count && currentDoc.chunk_count > 0))) {
            mainDocUpdated = true;
            console.log('[CRITICAL] ✅ 메인 문서는 이미 indexed 상태:', {
              documentId,
              status: currentDoc.status,
              chunkCount: currentDoc.chunk_count
            });
          } else {
            // status 조건 없이 무조건 업데이트 (chunk_count > 0이면 indexed로)
            const { error: docUpdateError, data: docUpdateData } = await supabase
              .from('documents')
              .update({
                status: 'indexed',
                chunk_count: mainDocResult.chunkCount,
                updated_at: new Date().toISOString()
              })
              .eq('id', documentId)
              .neq('status', 'indexed') // 이미 indexed인 경우는 제외 (불필요한 업데이트 방지)
              .select('id, status, chunk_count')
              .maybeSingle();
            
            if (docUpdateError) {
              console.error('[CRITICAL] ⚠️ 메인 문서 상태 업데이트 실패:', {
                documentId,
                error: docUpdateError
              });
            } else if (docUpdateData) {
              mainDocUpdated = true;
              console.log('[CRITICAL] ✅ 메인 문서 상태 업데이트 완료:', {
                documentId,
                status: `${currentDoc?.status || 'unknown'} -> indexed`,
                chunkCount: mainDocResult.chunkCount,
                updatedDocument: docUpdateData
              });
            } else {
              // 업데이트가 적용되지 않았지만, 다시 확인
              const { data: recheckDoc } = await supabase
                .from('documents')
                .select('id, status, chunk_count')
                .eq('id', documentId)
                .maybeSingle();
              
              if (recheckDoc && (recheckDoc.status === 'indexed' || (recheckDoc.chunk_count && recheckDoc.chunk_count > 0))) {
                mainDocUpdated = true;
                console.log('[CRITICAL] ✅ 메인 문서 상태 재확인: indexed 상태 확인', {
                  documentId,
                  status: recheckDoc.status,
                  chunkCount: recheckDoc.chunk_count
                });
              } else {
                console.warn('[CRITICAL] ⚠️ 메인 문서 상태 업데이트 실패: 업데이트 후에도 indexed 상태가 아님', {
                  documentId,
                  currentStatus: recheckDoc?.status || 'unknown',
                  currentChunkCount: recheckDoc?.chunk_count || 0
                });
              }
            }
          }
        }

        // 2. 성공한 하위 페이지 문서들도 상태 업데이트 (chunk_count > 0이면 무조건 indexed로)
        const successfulSubPages = subPageResults.filter(item => item.success && item.documentId);
        const subPageUpdateResults: Array<{ documentId: string; success: boolean }> = [];
        
        if (successfulSubPages.length > 0) {
          for (const subPage of successfulSubPages) {
            if (subPage.documentId && subPage.chunkCount && subPage.chunkCount > 0) {
              // 먼저 현재 상태 확인 (중복 방지를 위해 maybeSingle 사용)
              const { data: currentSubDoc, error: currentSubDocError } = await supabase
                .from('documents')
                .select('id, status, chunk_count')
                .eq('id', subPage.documentId)
                .maybeSingle();
              
              if (currentSubDocError && currentSubDocError.code !== 'PGRST116') {
                console.error('[CRITICAL] ⚠️ 하위 페이지 문서 조회 실패:', {
                  documentId: subPage.documentId,
                  url: subPage.url,
                  error: currentSubDocError
                });
              }
              
              // 이미 indexed 상태이거나 chunk_count가 이미 설정되어 있으면 성공으로 간주
              if (currentSubDoc && (currentSubDoc.status === 'indexed' || (currentSubDoc.chunk_count && currentSubDoc.chunk_count > 0))) {
                subPageUpdateResults.push({ documentId: subPage.documentId, success: true });
                console.log('[CRITICAL] ✅ 하위 페이지 문서는 이미 indexed 상태:', {
                  documentId: subPage.documentId,
                  url: subPage.url,
                  status: currentSubDoc.status,
                  chunkCount: currentSubDoc.chunk_count
                });
              } else {
                // status 조건 없이 무조건 업데이트 (chunk_count > 0이면 indexed로)
                const { error: subDocUpdateError, data: subDocUpdateData } = await supabase
                  .from('documents')
                  .update({
                    status: 'indexed',
                    chunk_count: subPage.chunkCount,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', subPage.documentId)
                  .neq('status', 'indexed') // 이미 indexed인 경우는 제외
                  .select('id, status, chunk_count')
                  .maybeSingle();
                
                if (subDocUpdateError) {
                  console.error('[CRITICAL] ⚠️ 하위 페이지 문서 상태 업데이트 실패:', {
                    documentId: subPage.documentId,
                    url: subPage.url,
                    error: subDocUpdateError
                  });
                  subPageUpdateResults.push({ documentId: subPage.documentId, success: false });
                } else if (subDocUpdateData) {
                  console.log('[CRITICAL] ✅ 하위 페이지 문서 상태 업데이트 완료:', {
                    documentId: subPage.documentId,
                    url: subPage.url,
                    status: `${currentSubDoc?.status || 'unknown'} -> indexed`,
                    chunkCount: subPage.chunkCount
                  });
                  subPageUpdateResults.push({ documentId: subPage.documentId, success: true });
                } else {
                  // 업데이트가 적용되지 않았지만, 다시 확인
                  const { data: recheckSubDoc } = await supabase
                    .from('documents')
                    .select('id, status, chunk_count')
                    .eq('id', subPage.documentId)
                    .maybeSingle();
                  
                  if (recheckSubDoc && (recheckSubDoc.status === 'indexed' || (recheckSubDoc.chunk_count && recheckSubDoc.chunk_count > 0))) {
                    subPageUpdateResults.push({ documentId: subPage.documentId, success: true });
                    console.log('[CRITICAL] ✅ 하위 페이지 문서 상태 재확인: indexed 상태 확인', {
                      documentId: subPage.documentId,
                      url: subPage.url,
                      status: recheckSubDoc.status,
                      chunkCount: recheckSubDoc.chunk_count
                    });
                  } else {
                    subPageUpdateResults.push({ documentId: subPage.documentId, success: false });
                    console.warn('[CRITICAL] ⚠️ 하위 페이지 문서 상태 업데이트 실패: 업데이트 후에도 indexed 상태가 아님', {
                      documentId: subPage.documentId,
                      url: subPage.url,
                      currentStatus: recheckSubDoc?.status || 'unknown',
                      currentChunkCount: recheckSubDoc?.chunk_count || 0
                    });
                  }
                }
              }
            }
          }
        }

        // 3. 완료/실패 분기 처리
        // 🔥 개선된 원칙: 
        // - 메인 문서가 indexed면 completed
        // - 메인 문서가 실패했지만 하위 페이지가 하나라도 성공했다면 completed (부분 성공)
        // - 메인 문서와 모든 하위 페이지가 실패했을 때만 failed
        
        // 메인 문서 업데이트 성공 여부 확인
        const isMainDocumentIndexed = mainDocUpdated && 
          documentId && 
          mainDocResult.chunkCount > 0;
        
        // 하위 페이지 성공 여부 확인
        const successfulSubPageCount = subPageUpdateResults.filter(r => r.success).length;
        const hasSuccessfulSubPages = successfulSubPageCount > 0;
        
        // 최종 작업 성공 여부: 메인 문서가 indexed이거나 하위 페이지가 하나라도 성공했으면 성공
        const isJobSuccessful = isMainDocumentIndexed || hasSuccessfulSubPages;

        if (!isJobSuccessful) {
          // 메인 문서와 모든 하위 페이지가 실패했을 때만 failed로 처리
          console.error('[CRITICAL] ❌ 메인 문서 및 모든 하위 페이지 인덱싱 실패 - 작업을 failed로 처리', {
            jobId: job.id,
            documentId,
            mainDocUpdated,
            mainDocChunkCount: mainDocResult.chunkCount,
            successfulSubPageCount,
            totalSubPageCount: subPageResults.length
          });

          const { error: failError } = await supabase
            .from('processing_jobs')
            .update({
              status: 'failed',
              error: '메인 문서 및 모든 하위 페이지 인덱싱 실패',
              finished_at: new Date().toISOString(),
              result: {
                error: '메인 문서 및 모든 하위 페이지 인덱싱 실패',
                mainDocUpdated,
                mainDocChunkCount: mainDocResult.chunkCount,
                successfulSubPageCount,
                totalSubPageCount: subPageResults.length
              }
            })
            .eq('id', job.id)
            .in('status', ['processing', 'queued', 'retrying']);

          if (failError) {
            console.error('[CRITICAL] ❌ 작업 failed 상태 업데이트 실패:', failError);
            throw failError;
          }

          // 메인 문서도 failed로 업데이트 (아직 processing 상태인 경우만)
          if (documentId) {
            await supabase
              .from('documents')
              .update({
                status: 'failed',
                updated_at: new Date().toISOString()
              })
              .eq('id', documentId)
              .eq('status', 'processing'); // processing 상태인 경우만 failed로 변경
          }

          return NextResponse.json({
            success: false,
            error: 'CRAWL_SEED 작업 실패: 메인 문서 및 모든 하위 페이지 인덱싱 실패',
            details: {
              mainDocUpdated,
              mainDocChunkCount: mainDocResult.chunkCount,
              successfulSubPageCount,
              totalSubPageCount: subPageResults.length
            }
          }, { status: 500 });
        }
        
        // 작업이 성공한 경우 (메인 문서가 indexed이거나 하위 페이지가 하나라도 성공)
        // 메인 문서가 실패했지만 하위 페이지가 성공한 경우, 메인 문서 상태를 다시 확인하고 필요시 indexed로 업데이트
        if (!isMainDocumentIndexed && hasSuccessfulSubPages) {
          console.log('[CRITICAL] ⚠️ 메인 문서는 실패했지만 하위 페이지가 성공 - 메인 문서 상태 재확인', {
            jobId: job.id,
            documentId,
            mainDocChunkCount: mainDocResult.chunkCount,
            successfulSubPageCount
          });
          
          // 메인 문서의 현재 상태 확인
          if (documentId) {
            const { data: currentMainDoc } = await supabase
              .from('documents')
              .select('id, status, chunk_count')
              .eq('id', documentId)
              .maybeSingle();
            
            // 메인 문서가 processing 상태이고 chunk_count가 0이면, 하위 페이지가 성공했으므로 indexed로 업데이트
            if (currentMainDoc && currentMainDoc.status === 'processing' && currentMainDoc.chunk_count === 0) {
              // 하위 페이지의 총 청크 수를 메인 문서의 chunk_count로 설정
              const totalSubPageChunks = subPageResults
                .filter(item => item.success && item.chunkCount)
                .reduce((sum, item) => sum + (item.chunkCount || 0), 0);
              
              if (totalSubPageChunks > 0) {
                const { error: mainDocUpdateError } = await supabase
                  .from('documents')
                  .update({
                    status: 'indexed',
                    chunk_count: totalSubPageChunks,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', documentId)
                  .eq('status', 'processing');
                
                if (!mainDocUpdateError) {
                  console.log('[CRITICAL] ✅ 메인 문서 상태 업데이트 완료 (하위 페이지 성공 기반):', {
                    documentId,
                    status: 'processing -> indexed',
                    chunkCount: totalSubPageChunks
                  });
                } else {
                  console.warn('[CRITICAL] ⚠️ 메인 문서 상태 업데이트 실패 (하위 페이지 성공 기반):', mainDocUpdateError);
                }
              }
            }
          }
        }

        // 4. processing_jobs 업데이트 (메인 문서가 indexed인 경우만 completed)
        const finalDocumentStatus = 'indexed';
        const jobUpdateData: any = {
          status: 'completed',
          finished_at: new Date().toISOString(),
          result: {
            ...finishedResult,
            documentsUpdated: {
              main: mainDocUpdated,
              subPages: subPageUpdateResults.filter(r => r.success).length,
              totalSubPages: subPageUpdateResults.length
            },
            finalDocumentStatus,
            verifiedAt: new Date().toISOString()
          },
        };
        
        // document_id가 없었던 경우 설정
        if (!job.document_id && documentId) {
          jobUpdateData.document_id = documentId;
        }

        const { error: updateError, data: updateData } = await supabase
          .from('processing_jobs')
          .update(jobUpdateData)
          .eq('id', job.id)
          .in('status', ['processing', 'queued', 'retrying']) // 여러 상태에서 완료로 변경 가능
          .select('id, status, document_id, finished_at');

        if (updateError) {
          console.error('[CRITICAL] ❌ 작업 상태 업데이트 실패:', {
            jobId: job.id,
            error: updateError
          });
          throw updateError;
        }

        if (!updateData || updateData.length === 0) {
          // 현재 상태 확인
          const { data: currentJob } = await supabase
            .from('processing_jobs')
            .select('status, document_id, finished_at')
            .eq('id', job.id)
            .single();
          
          console.warn('[CRITICAL] ⚠️ 작업 상태 업데이트 실패: 이미 다른 상태이거나 취소됨', {
            jobId: job.id,
            currentStatus: currentJob?.status || 'unknown',
            currentDocumentId: currentJob?.document_id || 'none',
            currentFinishedAt: currentJob?.finished_at || 'none'
          });
        } else {
          console.log('[CRITICAL] ✅ 작업 상태 업데이트 완료:', {
            jobId: job.id,
            updatedRows: updateData.length,
            status: 'completed',
            documentId: updateData[0]?.document_id || documentId || 'none',
            finishedAt: updateData[0]?.finished_at || 'none',
            documentsUpdated: {
              main: mainDocUpdated,
              subPages: subPageUpdateResults.filter(r => r.success).length
            }
          });
        }

        return NextResponse.json({ 
          success: true, 
          message: 'CRAWL_SEED 작업 완료', 
          result: finishedResult 
        }, { status: 200 });
      } catch (crawlError) {
        console.error('❌ CRAWL_SEED 처리 오류:', crawlError);
        const errorMessage = crawlError instanceof Error ? crawlError.message : String(crawlError);
        
        // 실패 시 documents 테이블도 함께 업데이트
        const documentId = job.document_id || (job.payload as any)?.documentId;
        if (documentId) {
          const { error: docFailError } = await supabase
            .from('documents')
            .update({
              status: 'failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', documentId)
            .eq('status', 'processing');
          
          if (docFailError) {
            console.error('[CRITICAL] ⚠️ 문서 실패 상태 업데이트 실패:', {
              documentId,
              error: docFailError
            });
          } else {
            console.log('[CRITICAL] ✅ 문서 실패 상태 업데이트 완료:', {
              documentId,
              status: 'processing -> failed'
            });
          }
        }
        
        await supabase
          .from('processing_jobs')
          .update({
            status: 'failed',
            error: errorMessage,
            finished_at: new Date().toISOString(),
            result: { error: errorMessage },
          })
          .eq('id', job.id);

        return NextResponse.json({ 
          success: false, 
          error: 'CRAWL_SEED 처리 실패', 
          details: errorMessage 
        }, { status: 500 });
      }
    }

    // 🔥 Phase 2: CHUNK_PROCESS job 처리
    if (job.job_type === 'CHUNK_PROCESS') {
      console.log('🔧 CHUNK_PROCESS job 처리 시작:', {
        jobId: job.id,
        documentId: job.document_id,
        splitIndex: job.payload?.split_index
      });
      
      try {
        const splitId = job.payload?.split_id as string;
        const splitIndex = job.payload?.split_index as number;
        let splitContent = job.payload?.content as string;
        
        if (!splitId) {
          throw new Error('CHUNK_PROCESS job payload에 split_id가 없습니다.');
        }
        
        // payload에 content가 없으면 document_splits에서 조회
        if (!splitContent) {
          const { data: splitData, error: splitFetchError } = await supabase
            .from('document_splits')
            .select('content')
            .eq('id', splitId)
            .single();
          
          if (splitFetchError || !splitData) {
            throw new Error(`분할 콘텐츠 조회 실패: ${splitFetchError?.message || '분할 데이터 없음'}`);
          }
          
          splitContent = splitData.content;
        }
        
        if (!splitContent || splitContent.length === 0) {
          throw new Error('CHUNK_PROCESS job payload에 content가 없거나 비어있습니다.');
        }
        
        // 1. document_splits 상태를 processing으로 업데이트
        await supabase
          .from('document_splits')
          .update({
            status: 'processing',
            job_id: job.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', splitId)
          .eq('status', 'pending');
        
        // 2. 문서 정보 조회
        const { data: doc, error: docError } = await supabase
          .from('documents')
          .select('id, title, type, created_at, updated_at, source_vendor')
          .eq('id', job.document_id)
          .single();
        
        if (docError || !doc) {
          throw new Error(`문서 조회 실패: ${docError?.message || '문서 없음'}`);
        }
        
        // 3. DocumentData 준비 (분할 콘텐츠만 포함)
        const docData: DocumentData = {
          id: doc.id,
          title: `${doc.title} (분할 ${splitIndex + 1})`,
          content: splitContent,
          type: doc.type || 'pdf',
          file_size: Buffer.byteLength(splitContent, 'utf8'),
          file_type: doc.type === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          source_vendor: doc.source_vendor || 'META',
          created_at: doc.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        // 4. RAG 처리 (청킹, 임베딩, 저장)
        const processStartMs = Date.now();
        const result = await ragProcessor.processDocument(docData, true);
        const processMs = Date.now() - processStartMs;
        
        if (!result.success) {
          throw new Error(`RAG 처리 실패: ${result.error || '알 수 없는 오류'}`);
        }
        
        console.log('✅ 분할 처리 완료:', {
          splitIndex,
          chunkCount: result.chunkCount,
          processTimeMs: processMs
        });
        
        // 5. document_splits 상태를 completed로 업데이트
        await supabase
          .from('document_splits')
          .update({
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', splitId)
          .eq('status', 'processing');
        
        // 6. 문서 전체 완료 여부 확인
        const { count: completedCount, error: countError } = await supabase
          .from('document_splits')
          .select('*', { count: 'exact', head: true })
          .eq('document_id', job.document_id)
          .eq('status', 'completed');
        
        const { count: totalCount } = await supabase
          .from('document_splits')
          .select('*', { count: 'exact', head: true })
          .eq('document_id', job.document_id);
        
        if (countError) {
          console.warn('⚠️ 분할 완료 수 조회 실패:', countError);
        }
        
        // 7. 모든 분할 완료 시 문서 상태 업데이트
        if (completedCount === totalCount && totalCount! > 0) {
          // 전체 청크 수 조회
          const { count: totalChunks } = await supabase
            .from('document_chunks')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', job.document_id);
          
          await supabase
            .from('documents')
            .update({
              status: 'indexed',
              chunk_count: totalChunks || 0,
              split_status: {
                total_splits: totalCount,
                completed_splits: completedCount,
                failed_splits: 0,
                method: 'fixed-size'
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', job.document_id);
          
          console.log('🎉 모든 분할 처리 완료 - 문서 인덱싱 완료:', {
            documentId: job.document_id,
            totalSplits: totalCount,
            totalChunks: totalChunks || 0
          });
        } else {
          // 부분 완료 상태 업데이트
          const { count: failedCount } = await supabase
            .from('document_splits')
            .select('*', { count: 'exact', head: true })
            .eq('document_id', job.document_id)
            .eq('status', 'failed');
          
          await supabase
            .from('documents')
            .update({
              split_status: {
                total_splits: totalCount,
                completed_splits: completedCount,
                failed_splits: failedCount || 0,
                method: 'fixed-size'
              }
            })
            .eq('id', job.document_id);
        }
        
        // 8. CHUNK_PROCESS job 완료 처리
        await supabase
          .from('processing_jobs')
          .update({
            status: 'completed',
            finished_at: new Date().toISOString(),
            result: {
              note: 'chunk_process_completed',
              split_index: splitIndex,
              chunk_count: result.chunkCount,
              process_time_ms: processMs
            }
          })
          .eq('id', job.id)
          .eq('status', 'processing');
        
        return NextResponse.json({
          success: true,
          message: `분할 ${splitIndex + 1} 처리 완료`,
          chunkCount: result.chunkCount
        }, { status: 200 });
        
      } catch (error: any) {
        console.error('❌ CHUNK_PROCESS 처리 실패:', error);
        
        // document_splits 상태를 failed로 업데이트
        const splitId = job.payload?.split_id as string;
        if (splitId) {
          await supabase
            .from('document_splits')
            .update({
              status: 'failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', splitId);
        }
        
        // documents.split_status 업데이트 (failed_splits 증가)
        const { count: failedCount } = await supabase
          .from('document_splits')
          .select('*', { count: 'exact', head: true })
          .eq('document_id', job.document_id)
          .eq('status', 'failed');
        
        const { count: totalCount } = await supabase
          .from('document_splits')
          .select('*', { count: 'exact', head: true })
          .eq('document_id', job.document_id);
        
        await supabase
          .from('documents')
          .update({
            split_status: {
              total_splits: totalCount,
              failed_splits: failedCount,
              method: 'fixed-size'
            }
          })
          .eq('id', job.document_id);
        
        // job 실패 처리 (재시도 로직은 기존과 동일)
        throw error;
      }
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
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      // 처리 중인 job 조회 (lastJob 대신 현재 처리 중인 job 사용)
      const { data: processingJob } = await supabase
        .from('processing_jobs')
        .select('id, document_id, status, payload')
        .eq('status', 'processing')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      // 에러 로그에 파일 정보 포함
      const fileSize = (processingJob?.payload as any)?.fileSize || (processingJob?.payload as any)?.storage?.size || 0;
      const fileName = (processingJob?.payload as any)?.fileName || 'unknown';
      const fileSizeMB = fileSize > 0 ? (fileSize / (1024 * 1024)).toFixed(2) : 'unknown';
      
      console.error('❌ 큐 처리 실패:', {
        jobId: processingJob?.id,
        documentId: processingJob?.document_id,
        fileName,
        fileSizeMB: `${fileSizeMB}MB`,
        error: message,
        stack: errorStack,
      });
      
      if (processingJob?.id) {
        // processing_jobs 상태를 failed로 업데이트 (에러 메시지에 파일 정보 포함)
        const errorMessage = fileSizeMB !== 'unknown' 
          ? `${message} (파일: ${fileName}, 크기: ${fileSizeMB}MB)`
          : message;
          
        await supabase
          .from('processing_jobs')
          .update({ 
            status: 'failed', 
            error: errorMessage, 
            finished_at: new Date().toISOString() 
          })
          .eq('id', processingJob.id)
          .eq('status', 'processing');
        
        // documents 테이블도 failed 상태로 업데이트
        if (processingJob.document_id) {
          await supabase
            .from('documents')
            .update({ 
              status: 'failed',
              updated_at: new Date().toISOString()
            })
            .eq('id', processingJob.document_id);
        }
      }
    } catch (recoveryError) {
      // ignore secondary errors
      console.error('❌ 실패 상태 업데이트 오류:', recoveryError);
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

/**
 * OPTIONS 핸들러 (CORS / Preflight 대응)
 */
export async function OPTIONS() {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  });
  
  return new NextResponse(null, {
    status: 204,
    headers,
  });
}



