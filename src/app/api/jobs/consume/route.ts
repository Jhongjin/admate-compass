import { NextRequest, NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';
import { ragProcessor, DocumentData } from '@/lib/services/RAGProcessor';

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
async function downloadFromStorage(supabase: any, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
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
    const res = await pdf(buffer, options);
    const parseMs = Date.now() - startMs;
    const textLengthKB = (res.text?.length || 0) / 1024;
    
    console.log(`✅ PDF 파싱 완료:`, {
      fileSizeMB: fileSizeMB.toFixed(2),
      textLengthKB: textLengthKB.toFixed(2),
      pages: res.numpages || 'unknown',
      parseTime: `${parseMs}ms (${(parseMs / 1000).toFixed(1)}초)`,
      throughput: `${(textLengthKB / (parseMs / 1000)).toFixed(2)}KB/s`
    });
    
    return res.text || '';
  } catch (error) {
    const parseMs = Date.now() - startMs;
    console.error(`❌ PDF 파싱 실패 (${parseMs}ms):`, error);
    throw error;
  }
}

async function processDocxBuffer(buffer: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default as any;
  const startMs = Date.now();
  
  try {
    // DOCX 텍스트 추출 (extractRawText는 텍스트만 추출)
    const res = await mammoth.extractRawText({ buffer });
    const parseMs = Date.now() - startMs;
    const extractedText = res.value || '';
    const textLengthKB = (extractedText.length / 1024).toFixed(2);
    
    // 빈 텍스트 체크 및 경고
    if (!extractedText || extractedText.trim().length === 0) {
      console.warn('⚠️ DOCX에서 텍스트를 추출할 수 없습니다. 빈 텍스트 반환');
      return '';
    }
    
    console.log(`✅ DOCX 파싱 완료:`, {
      textLengthKB: textLengthKB,
      parseTime: `${parseMs}ms (${(parseMs / 1000).toFixed(1)}초)`,
      throughput: `${(parseFloat(textLengthKB) / (parseMs / 1000)).toFixed(2)}KB/s`
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
      bufferSizeMB: (buffer.length / (1024 * 1024)).toFixed(2)
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
async function processQueue() {
  const supabase = await createPureClient();
  try {
    const jobStartMs = Date.now();
    // 1) 픽업할 잡 조회 (우선순위 높은 순, 예약시각 이른 순)
    // retrying 상태도 포함하여 재시도 작업 처리
    const { data: job, error: pickErr } = await supabase
      .from('processing_jobs')
      .select('id, document_id, job_type, status, attempts, max_attempts, priority, payload')
      .in('status', ['queued', 'retrying']) // retrying 상태도 처리
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
    const storage = job?.payload?.storage as { bucket: string; path: string; contentType?: string; size?: number } | undefined;
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
            // PDF 또는 DOCX 파일 찾기
            const targetFile = files.find(f => 
              f.name.toLowerCase().endsWith('.pdf') || 
              f.name.toLowerCase().endsWith('.docx')
            ) || files[0]; // PDF/DOCX가 없으면 첫 번째 파일
            
            foundFile = {
              path: `${job.document_id}/${targetFile.name}`,
              size: targetFile.metadata?.size || 0
            };
            console.log(`✅ Storage에서 파일 발견: ${foundFile.path} (${foundFile.size} bytes)`);
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
            
            // 파일 타입에 따라 텍스트 추출
            if (job.job_type === 'PDF_PARSE') {
              const p0 = Date.now();
              extractedText = await processPdfBuffer(fileBuffer);
              parseMs = Date.now() - p0;
              const textLengthKB = (extractedText.length / 1024).toFixed(2);
              console.log(`✅ 재처리: PDF 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
            } else if (job.job_type === 'DOCX_PARSE') {
              const p0 = Date.now();
              extractedText = await processDocxBuffer(fileBuffer);
              parseMs = Date.now() - p0;
              const textLengthKB = (extractedText.length / 1024).toFixed(2);
              console.log(`✅ 재처리: DOCX 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
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
                    
                    if (job.job_type === 'PDF_PARSE') {
                      const p0 = Date.now();
                      extractedText = await processPdfBuffer(fileBuffer);
                      parseMs = Date.now() - p0;
                      const textLengthKB = (extractedText.length / 1024).toFixed(2);
                      console.log(`✅ 재처리: PDF 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
                    } else if (job.job_type === 'DOCX_PARSE') {
                      const p0 = Date.now();
                      extractedText = await processDocxBuffer(fileBuffer);
                      parseMs = Date.now() - p0;
                      const textLengthKB = (extractedText.length / 1024).toFixed(2);
                      console.log(`✅ 재처리: DOCX 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
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
        const fileBuffer = await downloadFromStorage(supabase, storage.bucket, storage.path);
        dlMs = Date.now() - dlStart;
        
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
          extractedText = await processDocxBuffer(fileBuffer);
          parseMs = Date.now() - p0;
          const textLengthKB = (extractedText.length / 1024).toFixed(2);
          console.log(`✅ DOCX 텍스트 추출 완료: ${textLengthKB}KB (${parseMs}ms)`);
        }
      }

      // 텍스트 추출 결과 검증 및 로깅
      const cleanedLength = (extractedText || '').replace(/\s+/g, ' ').trim().length;
      console.log(`📊 텍스트 추출 검증:`, {
        rawLength: extractedText.length,
        cleanedLength: cleanedLength,
        fileType: job.job_type,
        fileName: fileName
      });
      
      // 텍스트 추출이 너무 적으면 OCR로 폴백 Job 생성 (재처리 모드가 아니고 Storage가 있는 경우만)
      // DOCX의 경우 텍스트가 있어도 OCR로 폴백하지 않도록 수정 (PDF만 OCR 폴백)
      if (cleanedLength < 500 && !isReprocess && storage?.bucket && storage?.path && job.job_type === 'PDF_PARSE') {
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
            note: 'deferred_to_ocr'
          });

        const { error: markDone } = await supabase
          .from('processing_jobs')
          .update({ status: 'completed', finished_at: new Date().toISOString(), result: { note: 'deferred_to_ocr', cleanedLength, dlMs, parseMs, totalMs, bytes } })
          .eq('id', job.id)
          .eq('status', 'processing');
        if (markDone) throw markDone;
        return NextResponse.json({ success: true, jobId: job.id, status: 'completed', result: { note: 'deferred_to_ocr' } }, { status: 200 });
      }

      // 표/CSV 정규화 (간단 규칙)
      const normalizedText = normalizeTablesToMarkdown(extractedText);
      const normalizedLengthKB = (normalizedText.length / 1024).toFixed(2);
      console.log(`📝 텍스트 정규화 완료: ${normalizedLengthKB}KB`);

      // 문서 레코드 불러오기(없을 경우 기본 메타 구성)
      const { data: docs } = await supabase.from('documents').select('id, title, file_size, file_type, created_at, updated_at, source_vendor').eq('id', job.document_id).limit(1);
      const nowIso = new Date().toISOString();
      
      // 재처리인 경우 기존 문서 정보 사용, 아니면 payload에서 가져오기
      const vendor = (job?.payload?.vendor as string) || docs?.[0]?.source_vendor || 'META';
      
      const docData: DocumentData = {
        id: job.document_id,
        title: docs?.[0]?.title || fileName,
        content: normalizedText,
        type: job.job_type === 'PDF_PARSE' ? 'pdf' : 'docx',
        file_size: storage?.size || docs?.[0]?.file_size || 0,
        file_type: storage?.contentType || docs?.[0]?.file_type || (job.job_type === 'PDF_PARSE' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        source_vendor: vendor,
        created_at: docs?.[0]?.created_at || nowIso,
        updated_at: nowIso,
      };

      // 큰 파일 처리를 위한 최적화: 타임아웃 전에 중간 상태 업데이트
      const textLengthKB = (docData.content.length / 1024).toFixed(2);
      const isLargeDocument = docData.content.length > 500 * 1024 || fileSize > 10 * 1024 * 1024;
      
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
      // 타임아웃을 더 여유있게 설정: 8분 (10분 타임아웃의 80%)
      // 재시도 로직이 있으므로 더 짧게 설정하여 빠른 재시도 가능
      const MAX_PROCESS_TIME = 480000; // 8분 (9분 → 8분으로 감소)
      
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
      const { error: docUpdateErr } = await supabase
        .from('documents')
        .update({ 
          status: processResult.success ? 'indexed' : 'failed', 
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



