import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';
import { ragProcessor, DocumentData } from '@/lib/services/RAGProcessor';
import { simpleTextSplitter, TextSplit } from '@/lib/services/SimpleTextSplitter';
import { sitemapDiscoveryService } from '@/lib/services/SitemapDiscoveryService';
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
  
  // Storage 다운로드 타임아웃 설정 (60초 - Supabase Gateway Timeout 대응)
  const DOWNLOAD_TIMEOUT = 60000; // 60초 (504 Gateway Timeout 대응)
  
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
    const { error: toProcessingErr } = await supabase
      .from('processing_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', job.id)
      .in('status', ['queued', 'retrying']); // retrying 상태도 처리

    if (toProcessingErr) {
      return NextResponse.json({ success: false, error: 'processing 전환 실패', details: toProcessingErr.message }, { status: 409 });
    }

    // 3) 실제 처리 로직
    let extractedText = '';
    let dlMs = 0;
    let parseMs = 0;
    let storage = job?.payload?.storage as { bucket: string; path: string; contentType?: string; size?: number } | undefined;
    const fileName = (job?.payload?.fileName as string) || job.document_id;
    const fileSize = storage?.size || (job?.payload?.fileSize as number) || 0;
    const isReprocess = job?.payload?.reprocess === true;
    const fileSizeMB = fileSize > 0 ? (fileSize / (1024 * 1024)).toFixed(2) : '0';
    
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
          .select('content, title, file_type, file_size, id')
          .eq('id', job.document_id)
          .single();
        
        if (docError || !docData) {
          throw new Error(`재처리: 문서를 찾을 수 없습니다: ${docError?.message || 'Unknown error'}`);
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
        title: docs?.[0]?.title || fileName,
        content: normalizedText,
        type: actualType,
        file_size: storage?.size || docs?.[0]?.file_size || 0,
        file_type: actualFileType,
        source_vendor: vendor,
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
        extractSubPages: job.payload?.extractSubPages
      });

      const crawlStartMs = Date.now();

      try {
        const url = job.payload?.url as string;
        const vendors = (job.payload?.vendors as string[]) || [];
        const domainLimit = job.payload?.domainLimit as boolean ?? true;
        const respectRobots = job.payload?.respectRobots as boolean ?? true;
        const maxDepthRaw = Number(job.payload?.maxDepth);
        const maxDepth = Number.isFinite(maxDepthRaw) && maxDepthRaw > 0 ? maxDepthRaw : 2;
        const extractSubPages = job.payload?.extractSubPages === true;

        if (!url) {
          throw new Error('CRAWL_SEED job payload에 url이 없습니다.');
        }

        let seedUrl: URL;
        try {
          seedUrl = new URL(url);
        } catch {
          throw new Error(`유효하지 않은 URL: ${url}`);
        }

        const dbVendor = vendors[0] || 'META';
        const documentId = job.document_id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

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
          
          // 제목 추출
          const titleMatch = $('title').text() || htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
          const pageTitle = titleMatch ? titleMatch.trim() : new URL(targetUrl).pathname || targetUrl;
          
          // 개선된 텍스트 추출: 구조를 유지하면서 텍스트 추출
          let textContent = '';
          
          // 텍스트 추출 헬퍼 함수: 줄바꿈과 공백을 적절히 유지
          const extractTextWithStructure = ($element: cheerio.Cheerio): string => {
            // 클론 생성 (원본 보존)
            const $clone = $element.clone();
            
            // 스크립트, 스타일, 네비게이션 등 제거
            $clone.find('script, style, nav, footer, header, aside').remove();
            
            // 링크는 텍스트와 URL을 함께 표시 (먼저 처리)
            $clone.find('a').each((_, el) => {
              const $el = $(el);
              const href = $el.attr('href');
              const text = $el.text().trim();
              if (text && href && !href.startsWith('#')) {
                // 절대 URL로 변환
                try {
                  const absoluteUrl = new URL(href, targetUrl).href;
                  $el.replaceWith(`${text} (${absoluteUrl})`);
                } catch {
                  $el.replaceWith(text);
                }
              } else if (text) {
                $el.replaceWith(text);
              } else {
                $el.replaceWith('');
              }
            });
            
            // 블록 요소 앞뒤에 줄바꿈 추가
            const blockElements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'li', 'td', 'th', 'tr'];
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
            
            // 최종 텍스트 추출 및 정리
            let text = $clone.text();
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

          if (!textContent || textContent.length < 100) {
            throw new Error('크롤링된 콘텐츠가 너무 짧거나 비어있습니다. 접근 권한 또는 공개 여부를 확인해주세요.');
          }

          console.log(`📄 추출된 텍스트 길이: ${textContent.length}자 (원본 HTML: ${htmlContent.length}자, Cheerio 사용)`);

          return { textContent, pageTitle };
        };

        const upsertAndProcessDocument = async ({ targetUrl, title, content, documentIdOverride }: { targetUrl: string; title: string; content: string; documentIdOverride?: string; }) => {
          const nowIso = new Date().toISOString();
          const fileSize = Buffer.byteLength(content, 'utf8');

          const { data: existingDoc, error: existingError } = await supabase
            .from('documents')
            .select('id, chunk_count, created_at')
            .eq('url', targetUrl)
            .maybeSingle();

          if (existingError) {
            console.error('❌ 기존 문서 조회 실패:', existingError);
          }

          const wasExistingDocument = !!existingDoc;
          const resolvedDocumentId = documentIdOverride || existingDoc?.id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

          if (existingDoc?.id && !documentIdOverride) {
            await supabase
              .from('documents')
              .update({
                title,
                status: 'processing',
                file_size: fileSize,
                file_type: 'text/html',
                source_vendor: dbVendor,
                content,
                url: targetUrl,
                updated_at: nowIso,
              })
              .eq('id', existingDoc.id);
          } else if (!wasExistingDocument) {
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
                created_at: nowIso,
                updated_at: nowIso,
              });
          }

          const ragResult = await ragProcessor.processDocument({
            id: resolvedDocumentId,
            title,
            content,
            type: 'url',
            file_size: fileSize,
            file_type: 'text/html',
            source_vendor: dbVendor,
            created_at: existingDoc?.created_at || nowIso,
            updated_at: nowIso,
          });

          if (ragResult.success) {
            await supabase
              .from('documents')
              .update({
                status: 'indexed',
                chunk_count: ragResult.chunkCount,
                updated_at: new Date().toISOString(),
              })
              .eq('id', resolvedDocumentId);
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

          return {
            documentId: resolvedDocumentId,
            chunkCount: ragResult.chunkCount,
            success: ragResult.success,
          };
        };

        const mainPage = await fetchPageContent(url);
        const mainDocResult = await upsertAndProcessDocument({ targetUrl: url, title: mainPage.pageTitle, content: mainPage.textContent, documentIdOverride: documentId });

        if (!job.document_id) {
          await supabase
            .from('processing_jobs')
            .update({ document_id: documentId })
            .eq('id', job.id);
        }

        const subPageResults: Array<{ url: string; success: boolean; chunkCount?: number; error?: string }> = [];

        if (extractSubPages) {
          try {
            const discoveryOptions = {
              maxDepth: Math.max(1, Math.min(maxDepth, 3)),
              maxUrls: 50, // 하위 페이지 발견 개수 증가 (기존: 12)
              respectRobotsTxt: respectRobots,
              includeExternal: false,
              allowedDomains: [seedUrl.hostname],
            };

            console.log('🔍 하위 페이지 탐색 옵션:', discoveryOptions);
            let discovered: Array<{ url: string; title?: string; source: string; depth: number }> = [];
            try {
              // SitemapDiscoveryService가 Puppeteer 실패 시 fetch fallback을 자동으로 사용
              console.log(`🔍 하위 페이지 탐색 시작: ${url}`);
              discovered = await sitemapDiscoveryService.discoverSubPages(url, discoveryOptions);
              console.log(`✅ 하위 페이지 발견 완료: ${discovered.length}개 (Sitemap + fetch fallback 사용)`);
              
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
                console.log('⚠️ 하위 페이지가 발견되지 않았습니다. Sitemap 또는 링크 추출이 실패했을 수 있습니다.');
              }
            } catch (discoveryError) {
              // 전체 탐색 실패 시에도 메인 페이지는 계속 처리
              console.warn('⚠️ 하위 페이지 탐색 중 오류 발생, 메인 페이지만 처리합니다:', discoveryError);
              discovered = [];
            }
            
            const candidateUrls = Array.from(new Set(
              discovered
                .map((entry) => entry.url)
                .filter((entryUrl) => entryUrl && entryUrl !== url && !entryUrl.includes('#'))
            )).slice(0, 30); // 처리할 하위 페이지 개수 증가 (기존: 8)

            console.log(`📄 하위 페이지 후보: ${candidateUrls.length}개 (발견: ${discovered.length}개, 필터링 후: ${candidateUrls.length}개)`);
            
            if (candidateUrls.length === 0 && discovered.length > 0) {
              console.warn('⚠️ 발견된 하위 페이지가 모두 필터링되었습니다. 필터 조건을 확인해주세요.');
            }
            let processedCount = 0;

            for (const subUrl of candidateUrls) {
              if (!subUrl) continue;

              try {
                const page = await fetchPageContent(subUrl);
                const result = await upsertAndProcessDocument({ targetUrl: subUrl, title: page.pageTitle, content: page.textContent });
                subPageResults.push({ url: subUrl, success: result.success, chunkCount: result.chunkCount });
              } catch (subError) {
                console.error('❌ 하위 페이지 처리 실패:', subError);
                subPageResults.push({
                  url: subUrl,
                  success: false,
                  error: subError instanceof Error ? subError.message : String(subError),
                });
              }

              processedCount += 1;
              await supabase
                .from('processing_jobs')
                .update({
                  result: {
                    url,
                    documentId,
                    title: mainPage.pageTitle,
                    chunkCount: mainDocResult.chunkCount,
                    subPageProgress: { processed: processedCount, total: candidateUrls.length },
                    subPages: subPageResults.slice(-3),
                  },
                })
                .eq('id', job.id);
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
          }
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
          subPageCount: subPageResults.filter((item) => item.success).length,
          subPages: subPageResults,
          crawlTimeMs: Date.now() - crawlStartMs,
        };

        await supabase
          .from('processing_jobs')
          .update({
            status: 'completed',
            finished_at: new Date().toISOString(),
            result: finishedResult,
          })
          .eq('id', job.id);

        return NextResponse.json({ 
          success: true, 
          message: 'CRAWL_SEED 작업 완료', 
          result: finishedResult 
        }, { status: 200 });
      } catch (crawlError) {
        console.error('❌ CRAWL_SEED 처리 오류:', crawlError);
        const errorMessage = crawlError instanceof Error ? crawlError.message : String(crawlError);
        
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



