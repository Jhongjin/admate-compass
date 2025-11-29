/**
 * 새로운 문서 업로드 API
 * 간단하고 안정적인 RAG 파이프라인 기반
 * 파일 중복 처리 로직 포함
 */

import { NextRequest, NextResponse } from 'next/server';
import { newDocumentProcessor } from '@/lib/services/NewDocumentProcessor';
import { ragProcessor, DocumentData, RAGProcessor } from '@/lib/services/RAGProcessor';
import { createPureClient } from '@/lib/supabase/server';

// Vercel 설정 - 서버 안정성 개선
export const runtime = 'nodejs';
export const maxDuration = 600; // Pro 플랜: 600초 타임아웃 (10분 - 대용량 파일 처리 지원)
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 하드코딩된 메모리 저장소 (개발 환경용)
interface Document {
  id: string;
  title: string;
  type: string;
  status: string;
  content: string;
  chunk_count: number;
  file_size: number;
  file_type: string;
  created_at: string;
  updated_at: string;
}

// 메모리에 문서 저장
let documents: Document[] = [];

const STORAGE_BUCKET = 'documents';

// URL 정규화 함수 (그룹핑용)
function normalizeUrlForGrouping(raw?: string | null): string | null {
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    const origin = `${parsed.protocol}//${parsed.host}`;
    const cleanedPath = parsed.pathname.replace(/\/+$/, "");
    const finalPath = cleanedPath === "" ? "/" : `${cleanedPath}/`;
    return `${origin}${finalPath}`;
  } catch {
    const sanitized = raw.split(/[?#]/)[0]?.trim();
    if (!sanitized) {
      return null;
    }
    const trimmed = sanitized.replace(/\/+$/, "");
    if (trimmed === "") {
      return "/";
    }
    return `${trimmed}/`;
  }
}

function sanitizeFileName(name: string) {
  // NFC 정규화 후, 전 세계 문자(특히 한글 자모 포함)와 안전한 특수문자만 허용
  return name
    .trim()
    .normalize('NFC')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}0-9._-]+/gu, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);
}

async function uploadToStorage(file: File, docId: string, cleanFileName: string) {
  const supabase = await createPureClient();
  if (!supabase) throw new Error('Supabase 클라이언트를 생성할 수 없습니다.');
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const safeName = sanitizeFileName(cleanFileName || `file_${Date.now()}`);
  const ext = safeName.split('.').pop()?.toLowerCase() || 'bin';
  const path = `${docId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, {
    contentType: file.type || `application/octet-stream`,
    upsert: true,
  });
  if (upErr) {
    console.error('❌ Storage 업로드 오류:', {
      bucket: STORAGE_BUCKET,
      path,
      error: upErr.message || upErr.name || upErr
    });
    throw new Error(`STORAGE_UPLOAD_FAILED:${upErr.message || upErr}`);
  }
  return { bucket: STORAGE_BUCKET, path, contentType: file.type, size: file.size, ext };
}

/**
 * 큐 워커를 즉시 트리거하는 함수
 * processQueue를 백그라운드로 실행 (await 없이)
 * Vercel serverless 환경에서 응답 반환 후에도 실행되도록 보장
 */
function triggerQueueWorker(): void {
  console.log('🚀 큐 워커 즉시 트리거 시작 (백그라운드 실행)...');
  
  // processQueue를 백그라운드로 실행 (await 없이)
  import('@/app/api/jobs/consume/route')
    .then(({ processQueue }) => {
      console.log('📦 processQueue import 완료, 실행 시작...');
      return processQueue();
    })
    .then(result => {
      if (result instanceof Response) {
        return result.text().then(text => {
          try {
            const json = JSON.parse(text);
            console.log('✅ 큐 워커 처리 완료:', {
              status: result.status,
              success: json.success,
              message: json.message,
              jobId: json.jobId
            });
          } catch {
            console.log('✅ 큐 워커 처리 완료:', {
              status: result.status,
              response: text.substring(0, 200)
            });
          }
        });
      } else {
        console.log('✅ 큐 워커 처리 완료:', result);
      }
    })
    .catch(err => {
      // 에러 발생해도 무시 (Cron Job이 처리할 수 있음)
      console.error('❌ 큐 워커 트리거 에러:', {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
    });
  
  console.log('✅ 큐 워커 트리거 완료 (백그라운드 실행 중)');
}

async function enqueueProcessingJob(params: { documentId: string; jobType: 'PDF_PARSE' | 'DOCX_PARSE' | 'OCR' | 'CRAWL' | 'EMBEDDING'; priority?: number; payload?: Record<string, unknown> }) {
  const supabase = await createPureClient();
  if (!supabase) throw new Error('Supabase 클라이언트를 생성할 수 없습니다.');
  // 문서 stub 생성 (없으면)
  const vendor = (params.payload as any)?.vendor || 'META';
  const originalFileName = (params.payload as any)?.originalFileName || null;
  const sanitizedFileName = (params.payload as any)?.sanitizedFileName || (params.payload as any)?.fileName || null;
  const displayTitle = originalFileName || sanitizedFileName || params.documentId;
  const { error: insertDocErr } = await supabase
    .from('documents')
    .upsert({
      id: params.documentId,
      title: displayTitle,
      original_file_name: originalFileName,
      sanitized_file_name: sanitizedFileName,
      // documents.type 은 CHECK (IN ('file','url')) 제약이 있으므로 반드시 'file' 로 기록
      type: 'file',
      status: 'processing',
      chunk_count: 0,
      source_vendor: vendor, // 벤더 정보 저장
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  if (insertDocErr) {
    console.error('❌ documents upsert 실패:', JSON.stringify(insertDocErr));
    throw new Error(insertDocErr.message || 'documents upsert failed');
  }

  // 메타데이터 테이블에도 기록 (존재하는 경우)
  const fileSize = (params.payload as any)?.fileSize ?? 0;
  const fileType = (params.payload as any)?.fileType ?? 'unknown';
  try {
    const { error: metaErr } = await supabase
      .from('document_metadata')
      .upsert({
        id: params.documentId,
        title: displayTitle,
        original_file_name: originalFileName,
        type: ((params.jobType === 'PDF_PARSE') ? 'pdf' : (params.jobType === 'DOCX_PARSE' ? 'docx' : 'file')),
        size: fileSize,
        uploaded_at: new Date().toISOString(),
        processed_at: null,
        status: 'pending',
        chunk_count: 0,
        embedding_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    if (metaErr) {
      console.error('❌ document_metadata upsert 실패:', JSON.stringify(metaErr));
    }
  } catch (e) {
    console.warn('document_metadata upsert 경고:', e);
  }
  const { data, error } = await supabase
    .from('processing_jobs')
    .insert({
      document_id: params.documentId,
      job_type: params.jobType,
      status: 'queued',
      priority: params.priority ?? 5,
      payload: params.payload ?? {},
      attempts: 0,
      max_attempts: 3,
      scheduled_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    console.error('❌ processing_jobs insert 실패:', JSON.stringify(error));
    throw new Error(error.message || 'processing_jobs insert failed');
  }
  return data.id as string;
}

    /**
     * 파일명 중복 검사 (Supabase 기반, 폴백 포함)
     */
    async function checkDuplicateFile(fileName: string): Promise<{ isDuplicate: boolean; existingDocument?: Document }> {
      try {
        console.log('🔍 파일명 중복 검사 시작:', fileName);

        const supabase = await createPureClient();
        
        // Supabase URL이 더미인지 확인
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        console.log('🔍 Supabase 환경변수 체크:', {
          supabaseUrl: supabaseUrl ? '설정됨' : '없음',
          isDummy: supabaseUrl?.includes('dummy') || supabaseUrl === 'https://dummy.supabase.co'
        });
        
        if (!supabase) {
          console.error('❌ Supabase 클라이언트 생성 실패');
          throw new Error('Supabase 클라이언트를 생성할 수 없습니다.');
        }

        // Supabase에서 파일명으로 검색 (파일 업로드 문서만)
        const { data, error } = await supabase
          .from('documents')
          .select('id, title, created_at, file_size, chunk_count, status')
          .eq('title', fileName)
          .in('type', ['pdf', 'docx', 'txt']) // 파일 업로드 문서만 검사
          .limit(1);

        if (error) {
          console.error('❌ Supabase 중복 검사 오류:', error);
          throw new Error(`중복 검사 실패: ${error.message}`);
        }

        const isDuplicate = data && data.length > 0;
        const existingDocument = isDuplicate ? {
          id: data[0].id,
          title: data[0].title,
          type: 'file', // 기본값 설정
          content: '', // 기본값 설정
          file_type: 'unknown', // 기본값 설정
          created_at: data[0].created_at,
          updated_at: data[0].created_at, // created_at과 동일하게 설정
          file_size: data[0].file_size || 0,
          chunk_count: data[0].chunk_count || 0,
          status: data[0].status || 'indexed'
        } : undefined;

        console.log('📋 중복 검사 결과 (Supabase):', {
          fileName,
          isDuplicate,
          existingDocumentId: existingDocument?.id,
          totalDocuments: data?.length || 0
        });

        return { isDuplicate, existingDocument };
      } catch (error) {
        console.error('❌ 중복 검사 중 오류:', error);
        throw error;
      }
    }

/**
 * 기존 문서 삭제 (덮어쓰기용 - Supabase 기반)
 */
async function deleteExistingDocument(documentId: string): Promise<boolean> {
  try {
    console.log('🗑️ 기존 문서 삭제 시작 (Supabase):', documentId);

    const supabase = await createPureClient();
    if (!supabase) {
      console.warn('⚠️ Supabase 연결 없음. 메모리 기반으로 폴백');
      const initialLength = documents.length;
      documents = documents.filter(doc => doc.id !== documentId);
      return documents.length < initialLength;
    }

    // Supabase에서 문서 및 관련 청크 삭제
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId);

    if (chunksError) {
      console.error('❌ 청크 삭제 오류:', chunksError);
    }

    const { error: docError } = await supabase
      .from('documents')
      .delete()
      .eq('id', documentId);

    if (docError) {
      console.error('❌ 문서 삭제 오류:', docError);
      return false;
    }

    // 메모리에서도 제거
    const initialLength = documents.length;
    documents = documents.filter(doc => doc.id !== documentId);

    console.log('✅ 기존 문서 삭제 완료 (Supabase):', documentId);
    console.log('📊 남은 문서 수:', documents.length);
    return true;
  } catch (error) {
    console.error('❌ 문서 삭제 중 오류:', error);
    return false;
  }
}

/**
 * 파일 확장자에 따른 타입 결정
 */
function getFileTypeFromExtension(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'pdf';
    case 'docx':
      return 'docx';
    case 'doc':
      return 'docx'; // DOC도 DOCX로 처리
    case 'txt':
      return 'txt';
    case 'md':
      return 'txt'; // Markdown도 TXT로 처리
    default:
      return 'file';
  }
}

/**
 * 파일 업로드 및 처리
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🚀 새로운 문서 업로드 API 시작 (메모리 저장)');

    const contentType = request.headers.get('content-type');
    console.log('📋 Content-Type:', contentType);

    // FormData 처리
    if (contentType?.includes('multipart/form-data')) {
      // BUGFIX: Vercel payload 제한(4.5MB) 초과 방지
      // Content-Length 헤더를 먼저 확인하여 4MB 이상이면 FormData 파싱 전에 큐로 오프로드
      const contentLength = request.headers.get('content-length');
      const VERCEL_PAYLOAD_LIMIT = 4 * 1024 * 1024; // 4MB (안전 마진 포함)
      
      if (contentLength && parseInt(contentLength) > VERCEL_PAYLOAD_LIMIT) {
        console.log('⚠️ Vercel payload 제한 초과 감지 - 스트리밍 방식으로 처리:', {
          contentLength: parseInt(contentLength),
          contentLengthMB: (parseInt(contentLength) / (1024 * 1024)).toFixed(2) + 'MB',
          limit: VERCEL_PAYLOAD_LIMIT,
          limitMB: (VERCEL_PAYLOAD_LIMIT / (1024 * 1024)).toFixed(2) + 'MB'
        });
        
        // FormData를 스트리밍으로 읽어서 파일 정보만 추출
        // 주의: 이 방법은 파일명과 벤더 정보만 추출하고, 파일 본문은 Storage에 직접 업로드해야 함
        // 하지만 FormData 스트리밍 파싱은 복잡하므로, 클라이언트 측에서 4MB 이상 파일은 다른 엔드포인트로 보내도록 안내
        return NextResponse.json(
          {
            success: false,
            error: `파일 크기가 너무 큽니다 (${(parseInt(contentLength) / (1024 * 1024)).toFixed(2)}MB). 4MB 이상 파일은 클라이언트에서 직접 Storage에 업로드하거나, 파일을 분할하여 업로드해주세요.`,
            contentLength: parseInt(contentLength),
            limit: VERCEL_PAYLOAD_LIMIT,
            code: 'FUNCTION_PAYLOAD_TOO_LARGE'
          },
          { status: 413 } // 413 Payload Too Large
        );
      }
      
      const formData = await request.formData();
      const file = formData.get('file') as File;
      const vendor = formData.get('vendor') as string | null; // 벤더 정보 받기
      
      if (!file) {
        return NextResponse.json(
          { success: false, error: '파일이 제공되지 않았습니다.' },
          { status: 400 }
        );
      }

      // 파일 크기 검사 (20MB 제한 - 더 안정적인 처리)
      const maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '20971520'); // 20MB (30MB → 20MB로 조정)
      if (file.size > maxFileSize) {
        console.error('❌ 파일 크기 초과:', {
          fileName: file.name,
          fileSize: file.size,
          maxSize: maxFileSize
        });
        return NextResponse.json(
          {
            success: false,
            error: `파일 크기가 ${Math.round(maxFileSize / 1024 / 1024)}MB를 초과합니다. 최대 15MB까지 업로드 가능합니다. (큰 파일은 처리 시간이 오래 걸려 타임아웃될 수 있습니다)`,
            fileSize: file.size,
            maxSize: maxFileSize
          },
          { status: 400 }
        );
      }
      
      // 파일명 정리 (확장자 중복 제거)
      const originalFileName = (file.name || '').trim() || `file_${Date.now()}`;
      let cleanFileName = originalFileName;
      
      // 확장자 중복 제거 (여러 번 반복 가능)
      while (cleanFileName.toLowerCase().match(/\.(pdf|docx|txt)\.\1$/i)) {
        cleanFileName = cleanFileName.replace(/\.(pdf|docx|txt)\.\1$/i, '.$1');
      }
      
      console.log('📁 파일명 정리:', {
        original: file.name,
        cleaned: cleanFileName,
        hasDuplicateExtension: file.name !== cleanFileName
      });

      const sanitizedFileName = sanitizeFileName(cleanFileName || `file_${Date.now()}`);

      // BUGFIX: 4MB 이상 파일은 FormData 파싱 후에도 즉시 큐로 오프로드 (Vercel payload 제한 방지)
      const VERCEL_SAFE_LIMIT = 3.5 * 1024 * 1024; // 3.5MB (안전 마진)
      if (file.size > VERCEL_SAFE_LIMIT) {
        console.log('📋 Vercel payload 제한 고려 - 큐로 오프로딩:', {
          fileName: file.name,
          fileSize: file.size,
          fileSizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB',
          safeLimit: VERCEL_SAFE_LIMIT,
          safeLimitMB: (VERCEL_SAFE_LIMIT / (1024 * 1024)).toFixed(2) + 'MB'
        });
        
        // PDF/DOCX 모두 큐로 오프로드
        const documentId = `doc_${Date.now()}`;
        const normalizedVendor = vendor ? vendor.toUpperCase() : 'META';
        
        // 파일을 Storage에 업로드
        let storageInfo;
          try {
            storageInfo = await uploadToStorage(file, documentId, sanitizedFileName);
          console.log('✅ Storage 업로드 완료:', storageInfo);
        } catch (storageError) {
          console.error('❌ Storage 업로드 실패:', storageError);
          return NextResponse.json(
            {
              success: false,
              error: `Storage 업로드 실패: ${storageError instanceof Error ? storageError.message : String(storageError)}`,
              code: 'STORAGE_UPLOAD_FAILED'
            },
            { status: 500 }
          );
        }
        
        // 파일 타입에 따라 jobType 결정
        const fileType = file.type || '';
        const fileName = file.name.toLowerCase();
        let jobType: 'PDF_PARSE' | 'DOCX_PARSE' = 'PDF_PARSE';
        
        if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            fileName.endsWith('.docx') ||
            fileName.endsWith('.doc') ||
            (fileType === 'application/octet-stream' && (fileName.includes('docx') || fileName.endsWith('.d')))) {
          jobType = 'DOCX_PARSE';
        }
        
        const jobId = await enqueueProcessingJob({
          documentId,
          jobType,
          priority: 7,
          payload: {
            fileName: sanitizedFileName,
            originalFileName: originalFileName,
            sanitizedFileName: sanitizedFileName,
            fileSize: file.size,
            fileType: file.type,
            storage: storageInfo,
            vendor: normalizedVendor
          }
        });
        
        console.log('✅ 큐 등록 완료 (Vercel payload 제한 회피):', { jobId, documentId, vendor: normalizedVendor });
        
        // 큐에 등록 후 즉시 큐 워커 트리거
        triggerQueueWorker();
        
        return NextResponse.json({
          success: true,
          queued: true,
          jobId,
          documentId,
          message: '파일이 큐로 오프로드되어 백그라운드에서 처리됩니다.'
        }, { status: 202 });
      }

      console.log('📁 파일 업로드 시작:', {
        fileName: cleanFileName,
        fileSize: file.size,
        fileType: file.type
      });

      try {
        // 파일 내용 읽기 및 서버사이드 텍스트 추출
        let fileContent;
        let extractedText = '';
        let originalBinaryData: string | undefined;
        
        console.log('🔍 파일 처리 시작:', file.name);
      
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        // 대용량/서버리스 제약 시 큐 오프로딩
        if (file.size > 10 * 1024 * 1024) {
          console.log('📋 대용량 파일 감지 - 큐로 오프로딩:', {
            fileName: cleanFileName,
            fileSize: file.size,
            fileSizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB'
          });
          
          const documentId = `doc_${Date.now()}`;
          
          // 벤더 정보 정규화
          const vendor = formData.get('vendor') as string | null;
          const normalizedVendor = vendor ? vendor.toUpperCase() : 'META';
          
          // 원본을 Storage에 업로드
          let storageInfo;
          try {
            storageInfo = await uploadToStorage(file, documentId, sanitizedFileName);
            console.log('✅ Storage 업로드 완료:', storageInfo);
          } catch (storageError) {
            console.error('❌ Storage 업로드 실패:', storageError);
            // Storage 업로드 실패 시에도 큐에 등록 (벤더 정보 포함)
          }
          
          const jobId = await enqueueProcessingJob({
            documentId,
            jobType: 'PDF_PARSE',
            priority: 7,
            payload: { 
              fileName: sanitizedFileName,
              originalFileName: originalFileName,
              sanitizedFileName: sanitizedFileName,
              fileSize: file.size, 
              fileType: file.type, 
              storage: storageInfo,
              vendor: normalizedVendor // 벤더 정보 추가
            }
          });
          
          console.log('✅ 큐 등록 완료:', { jobId, documentId, vendor: normalizedVendor });
          
          // 큐에 등록 후 즉시 큐 워커 트리거 (응답 반환 전에 호출하여 실행 보장)
          triggerQueueWorker();
          
          // 응답 반환 (큐 워커는 백그라운드에서 계속 실행)
          return NextResponse.json({ 
            success: true, 
            queued: true, 
            jobId, 
            documentId, 
            message: '대용량 PDF는 백그라운드에서 처리됩니다.' 
          }, { status: 202 });
        }
        // PDF 파일은 바이너리로 저장 (텍스트 추출 비활성화)
        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);
        
        // PDF 파일 무결성 검증
        const pdfSignature = fileBuffer.slice(0, 4).toString();
        const isValidPdf = pdfSignature === '%PDF';
        
        // 대용량 파일 경고 (10MB 이상)
        if (file.size > 10 * 1024 * 1024) {
          console.log('⚠️ 대용량 PDF 파일 감지:', {
            fileName: file.name,
            fileSize: file.size,
            fileSizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB'
          });
        }
        
        if (!isValidPdf) {
          console.error('❌ PDF 파일 무결성 검증 실패:', {
            fileName: file.name,
            fileSize: file.size,
            pdfSignature: pdfSignature,
            expectedSignature: '%PDF'
          });
          return NextResponse.json(
            { 
              success: false, 
              error: `PDF 파일이 손상되었습니다. 파일을 다시 업로드해주세요.`,
              fileName: file.name
            },
            { status: 400 }
          );
        }
        
        originalBinaryData = fileBuffer.toString('base64');
        
        // Pro 플랜에서 PDF 텍스트 추출 활성화
        console.log('📄 PDF 텍스트 추출 시작 (Pro 플랜 활성화)...');
        try {
          // pdf-parse를 동적 import로 사용 (extract-pdf API와 동일한 방식)
          const pdfPromise = (async () => {
            const pdf = (await import('pdf-parse')).default;
            // Buffer를 직접 전달 (파일 경로가 아닌)
            return await pdf(fileBuffer);
          })();
          
          // 타임아웃 설정 (Pro 플랜: 300초 중 60초 할당)
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('PDF extraction timeout')), 60000)
          );
          
          const pdfData: any = await Promise.race([pdfPromise, timeoutPromise]);
          
          extractedText = pdfData.text || '';
          fileContent = extractedText; // 텍스트로 저장
          
          console.log(`✅ PDF 텍스트 추출 완료:`, {
            fileName: file.name,
            extractedTextLength: extractedText.length,
            pages: pdfData.numpages,
            hasText: extractedText.length > 0
          });
          
          // 텍스트가 없으면 경고
          if (!extractedText || extractedText.trim().length === 0) {
            console.warn('⚠️ PDF에서 텍스트를 추출할 수 없습니다. 바이너리로 저장합니다.');
            fileContent = `BINARY_DATA:${originalBinaryData}`;
            extractedText = '';
          }
        } catch (pdfError: any) {
          console.error('❌ PDF 텍스트 추출 실패, 바이너리로 저장:', {
            error: pdfError?.message || pdfError,
            code: pdfError?.code,
            fileName: file.name
          });
          // 에러 발생 시 바이너리로 저장
          fileContent = `BINARY_DATA:${originalBinaryData}`;
          extractedText = '';
        }
        
        console.log(`📄 PDF 파일 처리 완료:`, {
          fileName: file.name,
          fileSize: file.size,
          binaryDataLength: originalBinaryData.length,
          textLength: extractedText.length,
          pdfSignature: pdfSignature,
          isValidPdf: isValidPdf,
          hasExtractedText: extractedText.length > 0
        });
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
                 file.name.toLowerCase().endsWith('.docx') ||
                 // 확장자가 잘못된 경우 MIME 타입으로 확인
                 (file.type === 'application/octet-stream' && 
                  (file.name.toLowerCase().includes('docx') || 
                   file.name.toLowerCase().endsWith('.d') ||
                   file.name.toLowerCase().endsWith('.doc')))) {
        // 작은 DOCX 파일(5MB 이하)은 즉시 처리, 큰 파일은 큐로 오프로딩
        const SMALL_DOCX_THRESHOLD = 5 * 1024 * 1024; // 5MB
        
        if (file.size <= SMALL_DOCX_THRESHOLD) {
          // 작은 DOCX 파일 즉시 처리
          console.log('📄 작은 DOCX 파일 즉시 처리:', {
            fileName: cleanFileName,
            fileSize: file.size,
            fileSizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB'
          });
          
          try {
            // DOCX 텍스트 추출 API 호출
            const extractFormData = new FormData();
            extractFormData.append('file', file);
            
            const extractResponse = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/extract-docx`, {
              method: 'POST',
              body: extractFormData
            });
            
            if (!extractResponse.ok) {
              throw new Error(`DOCX 텍스트 추출 실패: ${extractResponse.status}`);
            }
            
            const extractResult = await extractResponse.json();
            
            if (!extractResult.success || !extractResult.text) {
              throw new Error('DOCX에서 텍스트를 추출할 수 없습니다.');
            }
            
            extractedText = extractResult.text;
            fileContent = extractedText;
            
            // 원본 바이너리 데이터 저장 (다운로드용)
            const arrayBuffer = await file.arrayBuffer();
            originalBinaryData = Buffer.from(arrayBuffer).toString('base64');
            
            console.log(`✅ DOCX 텍스트 추출 완료:`, {
              fileName: file.name,
              extractedTextLength: extractedText.length,
              hasText: extractedText.length > 0
            });
          } catch (docxError: any) {
            console.error('❌ DOCX 텍스트 추출 실패, 큐로 오프로딩:', {
              error: docxError?.message || docxError,
              fileName: file.name
            });
            
            // 추출 실패 시 큐로 오프로딩
            const documentId = `doc_${Date.now()}`;
            const storageInfo = await uploadToStorage(file, documentId, sanitizedFileName);
            const jobId = await enqueueProcessingJob({
              documentId,
              jobType: 'DOCX_PARSE',
              priority: 7,
              payload: { 
                fileName: sanitizedFileName,
                originalFileName: originalFileName,
                sanitizedFileName: sanitizedFileName,
                fileSize: file.size, 
                fileType: file.type, 
                storage: storageInfo 
              }
            });
            
            triggerQueueWorker();
            return NextResponse.json({ success: true, queued: true, jobId, documentId, message: 'DOCX 파일은 백그라운드에서 처리됩니다.' }, { status: 202 });
          }
        } else {
          // 큰 DOCX 파일은 큐로 오프로딩
          console.log('📋 큰 DOCX 파일 감지 - 큐로 오프로딩:', {
            fileName: cleanFileName,
            fileSize: file.size,
            fileSizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB'
          });
          
        const documentId = `doc_${Date.now()}`;
        const storageInfo = await uploadToStorage(file, documentId, sanitizedFileName);
        const jobId = await enqueueProcessingJob({
          documentId,
          jobType: 'DOCX_PARSE',
          priority: 7,
          payload: { 
            fileName: sanitizedFileName,
            originalFileName: originalFileName,
            sanitizedFileName: sanitizedFileName,
            fileSize: file.size, 
            fileType: file.type, 
            storage: storageInfo 
          }
        });
        
        console.log('✅ DOCX 큐 등록 완료:', { jobId, documentId });
        
        // 큐에 등록 후 즉시 큐 워커 트리거 (응답 반환 전에 호출하여 실행 보장)
        triggerQueueWorker();
        
        // 응답 반환 (큐 워커는 백그라운드에서 계속 실행)
          return NextResponse.json({ success: true, queued: true, jobId, documentId, message: '큰 DOCX 파일은 백그라운드에서 처리됩니다.' }, { status: 202 });
        }
        
        /* 기존 바이너리 처리 로직 제거 - 큐에서 텍스트 추출 수행 */
        /*
        // DOCX 파일 바이너리 처리 (완전히 새로운 방식)
        console.log('📄 DOCX 파일 바이너리 처리 시작:', {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type
        });
        
        // 1. ArrayBuffer로 읽기
        const arrayBuffer = await file.arrayBuffer();
        console.log('📦 ArrayBuffer 크기:', arrayBuffer.byteLength);
        
        // 2. Uint8Array로 변환 (바이너리 데이터 보존)
        const uint8Array = new Uint8Array(arrayBuffer);
        console.log('📦 Uint8Array 크기:', uint8Array.length);
        
        // 3. Buffer로 변환 (Node.js Buffer 사용)
        const fileBuffer = Buffer.from(uint8Array);
        console.log('📦 Buffer 크기:', fileBuffer.length);
        
        // 4. DOCX 파일 무결성 검증
        const zipSignature = Array.from(fileBuffer.slice(0, 4))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        const isValidDocx = zipSignature === '504b0304';
        
        console.log('📦 DOCX 무결성 검증:', {
          zipSignature: zipSignature,
          expectedSignature: '504b0304',
          isValidDocx: isValidDocx
        });
        
        if (!isValidDocx) {
          console.error('❌ DOCX 파일 무결성 검증 실패');
          return NextResponse.json(
            { 
              success: false, 
              error: `DOCX 파일이 손상되었습니다. 파일을 다시 업로드해주세요.`,
              fileName: file.name
            },
            { status: 400 }
          );
        }
        
        // 5. Base64 인코딩 (바이너리 데이터 직접 처리)
        originalBinaryData = fileBuffer.toString('base64');
        fileContent = `BINARY_DATA:${originalBinaryData}`;
        extractedText = ''; // 텍스트 추출 비활성화
        
        // 6. Base64 인코딩 검증
        const testDecode = Buffer.from(originalBinaryData, 'base64');
        const isValidBase64 = testDecode.length === file.size;
        
        console.log('📦 Base64 인코딩 검증:', {
          originalSize: file.size,
          decodedSize: testDecode.length,
          base64Length: originalBinaryData.length,
          isValidBase64: isValidBase64
        });
        
        if (!isValidBase64) {
          console.error('❌ Base64 인코딩 검증 실패');
          return NextResponse.json(
            { 
              success: false, 
              error: `파일 인코딩 중 오류가 발생했습니다.`,
              fileName: file.name
            },
            { status: 400 }
          );
        }
        
        console.log(`✅ DOCX 파일 바이너리 저장 완료:`, {
          fileName: file.name,
          fileSize: file.size,
          binaryDataLength: originalBinaryData.length,
          zipSignature: zipSignature,
          isValidDocx: isValidDocx,
          isValidBase64: isValidBase64
        });
        */
      } else {
        // TXT 파일은 기존 방식 사용하되 인코딩 처리 개선
        const textContent = await file.text();
        
        // 통합된 인코딩 처리 적용
        const { processTextEncoding } = await import('@/lib/utils/textEncoding');
        const encodingResult = processTextEncoding(textContent, { strictMode: true });
        
        extractedText = encodingResult.cleanedText;
        fileContent = extractedText;
        
        console.log(`📄 TXT 텍스트 처리 결과:`, {
          fileName: file.name,
          originalLength: textContent.length,
          cleanedLength: extractedText.length,
          encoding: encodingResult.encoding,
          hasIssues: encodingResult.hasIssues,
          issues: encodingResult.issues
        });
      }
      
      // 추출된 텍스트 사용 (서버사이드 처리 결과)
      let processedContent = fileContent;

      // 벤더 정보 정규화 (대문자로 변환, 기본값: META)
      const normalizedVendor = vendor ? vendor.toUpperCase() : 'META';
      console.log('🏷️ 벤더 정보:', { original: vendor, normalized: normalizedVendor });
      
      // 문서 생성
      const documentId = `doc_${Date.now()}`;
      const documentData: DocumentData = {
        id: documentId,
        title: originalFileName || cleanFileName, // 원본 파일명 우선 사용
        content: processedContent,
        type: getFileTypeFromExtension(cleanFileName), // 정리된 파일명으로 타입 결정
        file_size: file.size,
        file_type: file.type,
        source_vendor: normalizedVendor, // 벤더 정보 추가
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        original_file_name: originalFileName,
        sanitized_file_name: sanitizedFileName,
      };

      // RAG 처리 (청킹 + 임베딩 + 저장)
      console.log('🔄 RAG 처리 시작...', {
        documentId,
        fileName: cleanFileName,
        fileSize: file.size,
        fileType: file.type,
        hasOriginalBinaryData: !!originalBinaryData,
        originalBinaryDataLength: originalBinaryData?.length || 0,
        originalBinaryDataStart: originalBinaryData?.substring(0, 50) || 'N/A'
      });
      
      // 대용량 파일 처리 시 타임아웃 증가
      const isLargeFile = file.size > 10 * 1024 * 1024; // 10MB 이상
      if (isLargeFile) {
        console.log('⚠️ 대용량 파일 RAG 처리 - 타임아웃 증가 적용');
      }
      
      let ragResult;
      try {
        // 중복 검사 활성화 (skipDuplicate: false)
        ragResult = await ragProcessor.processDocument(documentData, false, originalBinaryData);
        console.log('✅ RAG 처리 완료:', {
          success: ragResult.success,
          chunkCount: ragResult.chunkCount,
          error: ragResult.success ? null : 'RAG 처리 실패'
        });
        
        if (!ragResult.success) {
          // 중복 문서인 경우 다른 에러 메시지
          const isDuplicate = (ragResult as any).error === 'duplicate';
          if (isDuplicate) {
            console.warn('⚠️ 중복 문서 업로드 시도:', cleanFileName);
            return NextResponse.json(
              { 
                success: false, 
                error: '이미 동일한 이름의 문서가 존재합니다. 다른 이름으로 업로드하거나 기존 문서를 삭제 후 다시 시도해주세요.',
                fileName: cleanFileName,
                isDuplicate: true
              },
              { status: 409 } // 409 Conflict
            );
          }
          
          // RAG 처리 실패 시 에러 메시지 전달
          const errorMessage = (ragResult as any).error || '문서 처리 중 오류가 발생했습니다.';
          console.error('❌ RAG 처리 실패:', errorMessage);
          return NextResponse.json(
            { 
              success: false, 
              error: errorMessage,
              fileName: cleanFileName
            },
            { status: 500 }
          );
        }
      } catch (ragError) {
        console.error('❌ RAG 처리 중 예외 발생:', ragError);
        return NextResponse.json(
          { 
            success: false, 
            error: `문서 처리 중 예외가 발생했습니다: ${ragError instanceof Error ? ragError.message : String(ragError)}`,
            fileName: cleanFileName
          },
          { status: 500 }
        );
      }
      
      // Supabase에 저장되므로 메모리 배열 추가 불필요
      
      console.log('✅ 파일 업로드 및 RAG 처리 완료:', {
        documentId,
        fileName: file.name,
        fileSize: file.size,
        chunkCount: ragResult.chunkCount,
        success: ragResult.success,
        totalDocuments: documents.length
      });

      return NextResponse.json({
        success: true,
        data: {
          documentId: documentId,
          message: ragResult.success 
            ? `파일이 성공적으로 업로드되고 ${ragResult.chunkCount}개 청크로 처리되었습니다.`
            : '파일 업로드는 성공했지만 RAG 처리 중 오류가 발생했습니다.',
          status: ragResult.success ? 'completed' : 'failed',
          chunkCount: ragResult.chunkCount
        }
      });

    } catch (error) {
      const message = (error && typeof error === 'object') ? (error as any).message || JSON.stringify(error) : String(error);
      console.error('❌ 파일 업로드 중 오류 발생:', {
        fileName: file.name,
        error: message,
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return NextResponse.json(
        { 
          success: false, 
          error: `파일 업로드 중 오류가 발생했습니다: ${message}`,
          fileName: file.name
        },
        { status: 500 }
      );
    }
    }

    // JSON 요청 처리 (Base64 파일)
    if (contentType?.includes('application/json')) {
      let body;
      try {
        const text = await request.text();
        if (!text || text.trim() === '') {
          return NextResponse.json(
            { success: false, error: '요청 본문이 비어있습니다.' },
            { status: 400 }
          );
        }
        body = JSON.parse(text);
      } catch (error) {
        console.error('❌ JSON 파싱 오류:', error);
        return NextResponse.json(
          { success: false, error: '잘못된 JSON 형식입니다.' },
          { status: 400 }
        );
      }
      
      const { fileName, fileSize, fileType, fileContent, duplicateAction } = body;

      console.log('📋 업로드 요청 정보:', { fileName, fileSize, fileType, duplicateAction });

      if (!fileContent || !fileName) {
        return NextResponse.json(
          { success: false, error: '파일 내용과 파일명이 필요합니다.' },
          { status: 400 }
        );
      }

      // 파일 크기 검사 (20MB 제한 - 더 안정적인 처리)
      const maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '20971520'); // 20MB (30MB → 20MB로 조정)
      if (fileSize > maxFileSize) {
        return NextResponse.json(
          { 
            success: false, 
            error: `파일 크기가 ${Math.round(maxFileSize / 1024 / 1024)}MB를 초과합니다. 최대 15MB까지 업로드 가능합니다. (큰 파일은 처리 시간이 오래 걸려 타임아웃될 수 있습니다)`,
            fileSize: fileSize,
            maxSize: maxFileSize
          },
          { status: 400 }
        );
      }

      // 파일명 중복 검사
      console.log('🔍 중복 검사 시작:', fileName);
      const { isDuplicate, existingDocument } = await checkDuplicateFile(fileName);
      console.log('🔍 중복 검사 완료:', { isDuplicate, existingDocumentId: existingDocument?.id });
      
      if (isDuplicate && !duplicateAction) {
        return NextResponse.json({
          success: false,
          error: 'DUPLICATE_FILE',
          data: {
            fileName,
            existingDocument: {
              id: existingDocument?.id,
              title: existingDocument?.title,
              created_at: existingDocument?.created_at,
              file_size: existingDocument?.file_size,
              chunk_count: existingDocument?.chunk_count,
              status: existingDocument?.status || 'indexed'
            },
            message: `'${fileName}' 파일이 이미 존재합니다. 어떻게 처리하시겠습니까?`
          }
        }, { status: 409 }); // Conflict
      }

      // 중복 처리 로직
      if (isDuplicate && duplicateAction) {
        if (duplicateAction === 'skip') {
          // 건너뛰기 시에는 아무것도 하지 않음 (RAG 처리 완전 건너뛰기)
          console.log('📝 건너뛰기 처리: 파일 업로드 및 RAG 처리 완전 취소', fileName);
          return NextResponse.json({
            success: false,
            error: 'FILE_SKIPPED',
            message: `'${fileName}' 파일을 건너뛰었습니다.`
          }, { status: 200 });
        }
        
        if (duplicateAction === 'overwrite' && existingDocument) {
          console.log('🔄 덮어쓰기 모드: 기존 문서 삭제 중...');
          const deleteSuccess = await deleteExistingDocument(existingDocument.id);
          
          if (!deleteSuccess) {
            return NextResponse.json({
              success: false,
              error: 'DELETE_FAILED',
              message: '기존 문서 삭제에 실패했습니다.'
            }, { status: 500 });
          }
          
          console.log('✅ 기존 문서 삭제 완료, 새 문서 업로드 진행...');
        }
      }

      // Base64 디코딩 및 서버사이드 텍스트 추출
      let decodedContent;
      let extractedText = '';
      let originalBinaryData = null; // 원본 바이너리 데이터 저장용
      
      try {
        // Base64 디코딩
        const base64Data = fileContent;
        const fileBuffer = Buffer.from(base64Data, 'base64');
        
      // 원본 바이너리 데이터 저장 (다운로드용) - 항상 보장
      originalBinaryData = base64Data;
      console.log('💾 원본 바이너리 데이터 설정:', {
        fileName,
        dataSize: base64Data.length,
        hasData: !!originalBinaryData,
        base64DataStart: base64Data.substring(0, 50),
        base64DataEnd: base64Data.substring(base64Data.length - 50)
      });
      
      // 안전장치: originalBinaryData가 없으면 오류
      if (!originalBinaryData) {
        console.error('❌ originalBinaryData 설정 실패:', {
          fileName,
          base64DataLength: base64Data?.length || 0,
          hasBase64Data: !!base64Data
        });
        throw new Error('원본 바이너리 데이터 설정 실패');
      }
        
        // 파일 확장자에 따른 서버사이드 처리
        const fileExtension = fileName.toLowerCase().split('.').pop();
        
        if (fileExtension === 'pdf' || fileExtension === 'docx') {
          // PDF/DOCX 텍스트 추출 비활성화 - 원본 바이너리 데이터만 저장
          console.log(`📄 ${fileExtension.toUpperCase()} 텍스트 추출 비활성화: ${fileName}`);
          console.log(`📄 원본 바이너리 데이터만 저장하여 다운로드 가능`);
          
          // 텍스트 추출 없이 플레이스홀더 텍스트 생성
          extractedText = `${fileExtension.toUpperCase()} 문서: ${fileName}\n\n텍스트 추출이 비활성화되었습니다.\n원본 파일은 정상적으로 저장되었으며, 다운로드 시 원본 파일을 받을 수 있습니다.\n\n파일 크기: ${fileBuffer.length} bytes\n저장 시간: ${new Date().toLocaleString('ko-KR')}`;
          decodedContent = extractedText;
          
          // 원본 바이너리 데이터는 이미 설정됨
          console.log(`📄 ${fileExtension.toUpperCase()} 플레이스홀더 텍스트 생성:`, {
            fileName,
            extractedLength: extractedText.length,
            hasOriginalBinaryData: !!originalBinaryData,
            originalBinaryDataLength: originalBinaryData?.length || 0,
            originalBinaryDataStart: originalBinaryData?.substring(0, 50) || 'N/A'
          });
          
          // 안전장치: originalBinaryData가 없으면 다시 설정
          if (!originalBinaryData) {
            originalBinaryData = base64Data;
            console.log('🔄 originalBinaryData 재설정:', {
              fileName,
              dataSize: base64Data.length
            });
          }
        } else {
          // TXT 파일은 기본 디코딩
          decodedContent = fileBuffer.toString('utf-8');
          
          // 통합된 인코딩 처리 적용
          const { processTextEncoding } = await import('@/lib/utils/textEncoding');
          const encodingResult = processTextEncoding(decodedContent, { strictMode: true });
          
          extractedText = encodingResult.cleanedText;
          decodedContent = extractedText;
          
          // TXT 파일도 원본 바이너리 데이터 저장 (이미 설정됨)
          console.log(`📄 TXT 파일 처리 완료:`, {
            fileName,
            extractedLength: extractedText.length,
            hasOriginalBinaryData: !!originalBinaryData,
            originalBinaryDataLength: originalBinaryData?.length || 0
          });
          
          console.log(`📄 Base64 TXT 텍스트 처리 결과:`, {
            fileName,
            originalLength: fileBuffer.length,
            cleanedLength: extractedText.length,
            encoding: encodingResult.encoding,
            hasIssues: encodingResult.hasIssues,
            issues: encodingResult.issues
          });
        }
      } catch (error) {
        console.error('Base64 디코딩 및 텍스트 추출 오류:', error);
        return NextResponse.json(
          { success: false, error: '파일 처리에 실패했습니다.' },
          { status: 400 }
        );
      }
      
      // 문서 생성
      const documentId = `doc_${Date.now()}`;
      const documentData: DocumentData = {
        id: documentId,
        title: fileName,
        content: decodedContent,
        type: getFileTypeFromExtension(fileName),
        file_size: fileSize,
        file_type: fileType,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // RAG 처리 (청킹 + 임베딩 + 저장)
      console.log('🔄 RAG 처리 시작 (Base64)...');
      const ragResult = await ragProcessor.processDocument(documentData, false, originalBinaryData);
      console.log('✅ RAG 처리 완료 (Base64):', ragResult);
      
      // Supabase에 저장되므로 메모리 배열 추가 불필요
      
      console.log('✅ Base64 파일 업로드 및 RAG 처리 완료:', {
        documentId,
        fileName,
        fileSize,
        chunkCount: ragResult.chunkCount,
        success: ragResult.success,
        totalDocuments: documents.length
      });

      return NextResponse.json({
        success: true,
        data: {
          documentId: documentId,
          message: ragResult.success 
            ? `파일이 성공적으로 업로드되고 ${ragResult.chunkCount}개 청크로 처리되었습니다.`
            : '파일 업로드는 성공했지만 RAG 처리 중 오류가 발생했습니다.',
          status: ragResult.success ? 'completed' : 'failed',
          chunkCount: ragResult.chunkCount
        }
      });
    }

    return NextResponse.json(
      { success: false, error: '지원하지 않는 Content-Type입니다.' },
      { status: 400 }
    );

  } catch (error) {
    console.error('❌ 업로드 API 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : '파일 업로드 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * 문서 목록 조회
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const vendor = searchParams.get('vendor'); // 벤더 필터 추가

    console.log('📋 문서 목록 조회 (Supabase 기반):', { limit, offset, status, type, vendor });

    // Supabase 클라이언트 생성
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false },
        db: { schema: 'public' },
        global: {
          fetch: (url, options = {}) => {
            return fetch(url, {
              ...options,
              signal: AbortSignal.timeout(30000) // 30초 타임아웃
            });
          }
        }
      }
    );

    // "처리중 0개 청크" 상태인 문서 자동 정리 (백그라운드)
    // 관련 processing_jobs가 없는 경우 failed로 변경 또는 삭제
    try {
      const { data: stuckDocs } = await supabase
        .from('documents')
        .select('id, status, chunk_count, main_document_id, created_at')
        .eq('status', 'processing')
        .eq('chunk_count', 0)
        .limit(200); // 더 많이 처리
      
      if (stuckDocs && stuckDocs.length > 0) {
        const stuckDocIds = stuckDocs.map(d => d.id);
        
        // 관련 processing_jobs 확인 (document_id와 URL 모두 확인)
        // 1. document_id로 확인
        const { data: relatedJobsByDocId } = await supabase
          .from('processing_jobs')
          .select('document_id, status, job_type, payload, result')
          .in('document_id', stuckDocIds)
          .in('status', ['queued', 'processing', 'retrying']);
        
        // 2. URL로도 확인 (하위 페이지의 경우 URL이 다를 수 있음)
        const stuckDocUrls = stuckDocs
          .filter(doc => doc.id) // id가 있는 문서만
          .map(doc => {
            // documents 테이블에서 URL 조회
            return doc.id;
          });
        
        // 모든 CRAWL_SEED 작업 조회하여 URL 매칭
        const { data: allCrawlJobs } = await supabase
          .from('processing_jobs')
          .select('id, document_id, status, payload, result')
          .eq('job_type', 'CRAWL_SEED')
          .in('status', ['queued', 'processing', 'retrying'])
          .limit(1000);
        
        // document_id로 활성 작업이 있는 문서 ID 수집
        const activeJobDocIds = new Set((relatedJobsByDocId || []).map(j => j.document_id));
        
        // URL로도 확인 (payload나 result에 URL이 있을 수 있음)
        const activeJobUrls = new Set<string>();
        (allCrawlJobs || []).forEach(job => {
          const jobUrl = (job.payload as any)?.url || (job.result as any)?.url;
          if (jobUrl) {
            activeJobUrls.add(jobUrl);
          }
        });
        
        // stuckDocs의 URL을 조회하여 매칭
        const { data: stuckDocsWithUrls } = await supabase
          .from('documents')
          .select('id, url')
          .in('id', stuckDocIds);
        
        const stuckDocUrlMap = new Map<string, string>();
        (stuckDocsWithUrls || []).forEach(doc => {
          if (doc.url) {
            stuckDocUrlMap.set(doc.id, doc.url);
          }
        });
        
        // 관련 job이 없는 문서들 (document_id와 URL 모두 확인)
        const orphanedDocs = stuckDocs.filter(doc => {
          // document_id로 활성 작업이 있으면 제외
          if (activeJobDocIds.has(doc.id)) {
            return false;
          }
          
          // URL로도 확인
          const docUrl = stuckDocUrlMap.get(doc.id);
          if (docUrl && activeJobUrls.has(docUrl)) {
            return false;
          }
          
          return true;
        });
        
        if (orphanedDocs.length > 0) {
          const orphanedDocIds = orphanedDocs.map(d => d.id);
          
          // 하위 페이지인 경우 (main_document_id가 있는 경우) 삭제
          const subPageIds = orphanedDocs
            .filter(doc => doc.main_document_id)
            .map(doc => doc.id);
          
          // 메인 문서인 경우 failed로 변경
          const mainDocIds = orphanedDocs
            .filter(doc => !doc.main_document_id)
            .map(doc => doc.id);
          
          // 하위 페이지 삭제
          if (subPageIds.length > 0) {
            // 관련 데이터 먼저 삭제
            await supabase.from('document_chunks').delete().in('document_id', subPageIds);
            await supabase.from('document_metadata').delete().in('document_id', subPageIds);
            await supabase.from('document_logs').delete().in('document_id', subPageIds);
            
            const { error: deleteError } = await supabase
              .from('documents')
              .delete()
              .in('id', subPageIds);
            
            if (!deleteError) {
              console.log(`✅ "처리중 0개 청크" 하위 페이지 ${subPageIds.length}개 삭제 완료`);
            } else {
              console.warn('⚠️ 하위 페이지 삭제 실패:', deleteError);
            }
          }
          
          // 메인 문서 failed로 변경
          if (mainDocIds.length > 0) {
            const { error: failError } = await supabase
              .from('documents')
              .update({ status: 'failed', updated_at: new Date().toISOString() })
              .in('id', mainDocIds)
              .eq('status', 'processing')
              .eq('chunk_count', 0);
            
            if (!failError) {
              console.log(`✅ "처리중 0개 청크" 메인 문서 ${mainDocIds.length}개 failed로 변경 완료`);
            } else {
              console.warn('⚠️ 메인 문서 failed 변경 실패:', failError);
            }
          }
        }
      }
    } catch (cleanupError) {
      // 정리 실패해도 문서 목록 조회는 계속 진행
      console.warn('⚠️ "처리중 0개 청크" 문서 자동 정리 중 오류 (무시):', cleanupError);
    }

    // 메인 문서 상태 동기화: 하위 페이지가 완료되었는데 메인 문서가 처리중인 경우
    try {
      // 메인 문서가 processing 상태인 문서 조회 (chunk_count는 0이거나 이미 설정된 경우 모두 포함)
      const { data: processingMainDocs } = await supabase
        .from('documents')
        .select('id, url, status, chunk_count, main_document_id')
        .eq('type', 'url')
        .eq('status', 'processing')
        .is('main_document_id', null) // 메인 문서만 (main_document_id가 null)
        .limit(100);
      
      if (processingMainDocs && processingMainDocs.length > 0) {
        console.log(`🔍 메인 문서 상태 동기화 시작: ${processingMainDocs.length}개 문서 확인`);
        
        for (const mainDoc of processingMainDocs) {
          // 이 메인 문서의 하위 페이지 조회
          const { data: subPages } = await supabase
            .from('documents')
            .select('id, status, chunk_count')
            .eq('type', 'url')
            .eq('main_document_id', mainDoc.id)
            .in('status', ['indexed', 'completed']);
          
          if (subPages && subPages.length > 0) {
            // 완료된 하위 페이지가 있는 경우
            const totalSubPageChunks = subPages.reduce((sum, sub) => sum + (sub.chunk_count || 0), 0);
            const allSubPagesCompleted = subPages.every(sub => 
              sub.status === 'indexed' || sub.status === 'completed'
            );
            
            // 하위 페이지가 모두 완료되었거나, 완료된 하위 페이지가 있고 총 청크 수가 0보다 큰 경우
            if (totalSubPageChunks > 0 && (allSubPagesCompleted || subPages.length > 0)) {
              // 메인 문서를 indexed로 업데이트 (chunk_count도 함께 업데이트)
              // 상태 조건만 확인 (chunk_count는 이미 설정되어 있을 수 있음)
              const { error: syncError } = await supabase
                .from('documents')
                .update({
                  status: 'indexed',
                  chunk_count: totalSubPageChunks,
                  updated_at: new Date().toISOString()
                })
                .eq('id', mainDoc.id)
                .in('status', ['processing', 'indexing']); // processing 또는 indexing 상태 모두 처리
              
              if (!syncError) {
                console.log(`✅ 메인 문서 상태 동기화 완료: ${mainDoc.id} (하위 페이지 ${subPages.length}개 완료, 총 ${totalSubPageChunks}개 청크, 모두 완료: ${allSubPagesCompleted})`);
              } else {
                console.warn(`⚠️ 메인 문서 상태 동기화 실패: ${mainDoc.id}`, syncError);
              }
            }
          }
        }
      }
    } catch (syncError) {
      // 동기화 실패해도 문서 목록 조회는 계속 진행
      console.warn('⚠️ 메인 문서 상태 동기화 중 오류 (무시):', syncError);
    }

    // Supabase에서 문서 목록 조회 (최적화)
    let query = supabase
      .from('documents')
      .select('id, title, type, status, chunk_count, file_size, file_type, created_at, updated_at, document_url, url, size, source_vendor, main_document_id')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // 필터 적용
    if (status) {
      query = query.eq('status', status);
    }

    if (type) {
      query = query.eq('type', type);
    }

    // 벤더 필터 적용
    if (vendor) {
      const normalizedVendor = vendor.toUpperCase();
      query = query.eq('source_vendor', normalizedVendor);
      console.log('🏷️ 벤더 필터 적용:', normalizedVendor);
    }

    const { data: documents, error: documentsError } = await query;

    if (documentsError) {
      console.error('❌ 문서 조회 오류:', documentsError);
      throw new Error(`문서 조회 실패: ${documentsError.message}`);
    }

    // main_document_id를 mainDocumentId로 매핑 (클라이언트 호환성)
    // 부모 문서 ID로 부모 문서 URL 조회 (normalizedMainUrl 계산용)
    const parentDocumentIds = [...new Set(documents?.filter((d: any) => d.main_document_id).map((d: any) => d.main_document_id) || [])];
    const parentDocumentsMap = new Map<string, any>();
    
    if (parentDocumentIds.length > 0) {
      const { data: parentDocs } = await supabase
        .from('documents')
        .select('id, url')
        .in('id', parentDocumentIds);
      
      parentDocs?.forEach((parent: any) => {
        parentDocumentsMap.set(parent.id, parent);
      });
    }
    
    // 각 문서의 URL에 대한 최신 processing_jobs 정보 조회
    const documentUrls = (documents || [])
      .filter((doc: any) => doc.url)
      .map((doc: any) => doc.url);
    
    let jobStatusMap: Record<string, any> = {};
    if (documentUrls.length > 0) {
      // 각 URL에 대한 최신 CRAWL_SEED 작업 조회
      const { data: jobs, error: jobsError } = await supabase
        .from('processing_jobs')
        .select('id, status, started_at, finished_at, result, payload, created_at')
        .eq('job_type', 'CRAWL_SEED')
        .in('status', ['queued', 'retrying', 'processing', 'completed', 'failed'])
        .order('created_at', { ascending: false })
        .limit(1000);
      
      if (!jobsError && jobs) {
        // URL별로 가장 최신 작업만 선택
        const urlToLatestJob = new Map<string, any>();
        jobs.forEach(job => {
          const jobUrl = (job.payload as any)?.url || (job.result as any)?.url;
          if (jobUrl && !urlToLatestJob.has(jobUrl)) {
            urlToLatestJob.set(jobUrl, job);
          }
        });
        
        // Map을 Record로 변환
        urlToLatestJob.forEach((job, url) => {
          jobStatusMap[url] = {
            id: job.id,
            status: job.status,
            started_at: job.started_at,
            finished_at: job.finished_at,
            created_at: job.created_at
          };
        });
      }
    }

    const mappedDocuments = documents?.map((doc: any) => {
      const parentDoc = doc.main_document_id ? parentDocumentsMap.get(doc.main_document_id) : null;
      const parentUrl = parentDoc?.url || null;
      
      // 이 문서의 URL에 대한 크롤링 작업 상태
      const jobStatus = doc.url ? jobStatusMap[doc.url] : null;
      
      return {
        ...doc,
        // DocumentGroupingService에서 사용할 mainDocumentId 필드
        // null도 유효한 값이므로 명시적으로 전달 (undefined는 제외)
        mainDocumentId: doc.main_document_id !== null && doc.main_document_id !== undefined ? doc.main_document_id : undefined,
        // 그룹핑을 위한 정규화된 URL 계산
        normalizedUrl: doc.url ? normalizeUrlForGrouping(doc.url) : null,
        normalizedMainUrl: parentUrl ? normalizeUrlForGrouping(parentUrl) : null,
        isMainUrl: !doc.main_document_id, // main_document_id가 없으면 메인 페이지
        // 크롤링 작업 상태 정보 추가
        crawlJobStatus: jobStatus ? {
          status: jobStatus.status, // 'queued' | 'retrying' | 'processing' | 'completed' | 'failed'
          started_at: jobStatus.started_at,
          finished_at: jobStatus.finished_at,
          created_at: jobStatus.created_at
        } : null
      };
    }) || [];

    console.log('📊 Supabase 쿼리 결과:', {
      documents: mappedDocuments,
      documentsLength: mappedDocuments?.length,
      firstDocument: mappedDocuments?.[0],
      error: documentsError
    });

    // 전체 문서 수 조회 (통계용)
    let countQuery = supabase
      .from('documents')
      .select('*', { count: 'exact', head: true });

    if (status) {
      countQuery = countQuery.eq('status', status);
    }

    if (type) {
      countQuery = countQuery.eq('type', type);
    }

    // 벤더 필터 적용 (통계 조회에도)
    if (vendor) {
      const normalizedVendor = vendor.toUpperCase();
      countQuery = countQuery.eq('source_vendor', normalizedVendor);
    }

    const { count: totalCount, error: countError } = await countQuery;

    if (countError) {
      console.error('❌ 문서 수 조회 오류:', countError);
    }

    // 통계 계산 (실제 문서 데이터 기반)
    const fileDocuments = mappedDocuments?.filter(doc => ['pdf', 'docx', 'txt'].includes(doc.type)) || [];
    const urlDocuments = mappedDocuments?.filter(doc => doc.type === 'url') || [];
    
    const stats = {
      // 전체 통계 (기존 호환성 유지)
      totalDocuments: totalCount || 0,
      completedDocuments: mappedDocuments?.filter(doc => doc.status === 'indexed' || doc.status === 'completed').length || 0,
      totalChunks: mappedDocuments?.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0) || 0,
      pendingDocuments: mappedDocuments?.filter(doc => doc.status === 'processing').length || 0,
      failedDocuments: mappedDocuments?.filter(doc => doc.status === 'failed').length || 0,
      
      // 파일 문서 통계 (PDF, DOCX, TXT)
      fileStats: {
        totalDocuments: fileDocuments.length,
        completedDocuments: fileDocuments.filter(doc => doc.status === 'indexed' || doc.status === 'completed').length,
        totalChunks: fileDocuments.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0),
        pendingDocuments: fileDocuments.filter(doc => doc.status === 'processing').length,
        failedDocuments: fileDocuments.filter(doc => doc.status === 'failed').length,
      },
      
      // URL 문서 통계
      urlStats: {
        totalDocuments: urlDocuments.length,
        completedDocuments: urlDocuments.filter(doc => doc.status === 'indexed' || doc.status === 'completed').length,
        totalChunks: urlDocuments.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0),
        pendingDocuments: urlDocuments.filter(doc => doc.status === 'processing').length,
        failedDocuments: urlDocuments.filter(doc => doc.status === 'failed').length,
      }
    };

    console.log('📊 문서 목록 조회 완료 (Supabase):', {
      documentsCount: mappedDocuments?.length || 0,
      totalDocuments: totalCount || 0,
      stats: stats
    });

    // mappedDocuments 배열이 null이거나 undefined인 경우 빈 배열로 처리
    const safeDocuments = mappedDocuments || [];
    
    // content 필드를 제거하여 응답 크기를 줄이고 직렬화 문제를 방지
    // 그룹핑을 위한 필드들도 포함
    const documentsForResponse = safeDocuments.map(doc => ({
      id: doc.id,
      title: doc.title,
      type: doc.type,
      status: doc.status,
      chunk_count: doc.chunk_count,
      file_size: doc.file_size,
      file_type: doc.file_type,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      document_url: doc.document_url,
      url: doc.url || null, // URL 필드 명시적 포함 (하위 페이지 URL 표시를 위해 필수)
      size: doc.size,
      source_vendor: doc.source_vendor || 'META', // 벤더 정보 포함
      // 그룹핑을 위한 필드들
      mainDocumentId: doc.mainDocumentId || null,
      normalizedUrl: doc.normalizedUrl || null,
      normalizedMainUrl: doc.normalizedMainUrl || null,
      isMainUrl: doc.isMainUrl || false
      // content 필드는 제외 (너무 크고 UI에서 사용하지 않음)
    }));
    
    // 그룹핑 디버깅: mainDocumentId가 있는 문서 통계
    const docsWithMainId = documentsForResponse.filter((d: any) => d.mainDocumentId);
    const mainDocs = documentsForResponse.filter((d: any) => d.isMainUrl === true);
    
    // mainDocumentId 필드 확인을 위한 상세 로그
    const sampleDocsWithMainId = docsWithMainId.slice(0, 5).map((d: any) => ({
      id: d.id,
      title: d.title?.substring(0, 30),
      mainDocumentId: d.mainDocumentId,
      mainDocumentIdType: typeof d.mainDocumentId,
      mainDocumentIdIsNull: d.mainDocumentId === null,
      mainDocumentIdIsUndefined: d.mainDocumentId === undefined,
      isMainUrl: d.isMainUrl,
    }));
    
    console.log('📤 API 응답 전송:', {
      success: true,
      documentsCount: documentsForResponse.length,
      docsWithMainDocumentId: docsWithMainId.length,
      mainDocsCount: mainDocs.length,
      sampleWithMainId: sampleDocsWithMainId,
      firstDocument: documentsForResponse[0] ? {
        id: documentsForResponse[0].id,
        title: documentsForResponse[0].title?.substring(0, 30),
        mainDocumentId: documentsForResponse[0].mainDocumentId,
        mainDocumentIdType: typeof documentsForResponse[0].mainDocumentId,
        hasMainDocumentId: 'mainDocumentId' in documentsForResponse[0],
      } : null,
      stats: stats
    });

    const response = NextResponse.json({
      success: true,
      data: {
        documents: documentsForResponse,
        stats: stats,
        pagination: {
          limit,
          offset,
          total: totalCount || 0
        }
      }
    });

    // Pro 플랜 최적화: Edge 캐싱 헤더 추가 (읽기 전용 API)
    // 5분간 캐시, 10분간 stale-while-revalidate 허용
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    return response;

  } catch (error) {
    console.error('❌ 문서 목록 조회 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '문서 목록 조회 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : JSON.stringify(error)
      },
      { status: 500 }
    );
  }
}

/**
 * 파일 덮어쓰기 처리
 */
export async function PUT(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type');
    
    if (contentType?.includes('multipart/form-data')) {
      return await handleFileOverwrite(request);
    } else {
      return NextResponse.json(
        { 
          success: false,
          error: '지원하지 않는 Content-Type입니다.' 
        },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('❌ 파일 덮어쓰기 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '파일 덮어쓰기 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * 파일 덮어쓰기 처리 함수
 */
async function handleFileOverwrite(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const fileName = formData.get('fileName') as string;
    const existingDocumentId = formData.get('documentId') as string;

    if (!file || !fileName || !existingDocumentId) {
      return NextResponse.json(
        { 
          success: false,
          error: '파일, 파일명, 문서 ID가 모두 필요합니다.' 
        },
        { status: 400 }
      );
    }

    // 파일 내용 읽기 (텍스트 파일만)
    let fileContent;
    
    // 텍스트 파일만 처리 (PDF/DOCX는 위에서 이미 처리됨)
    fileContent = await file.text();
    console.log('📄 텍스트 파일 처리:', {
      fileName,
      fileType: file.type,
      fileSize: file.size
    });
    
    // 문서 업데이트
    const documentId = existingDocumentId;
    const documentData: DocumentData = {
      id: documentId,
      title: fileName,
      content: fileContent,
      type: 'file',
      file_size: file.size,
      file_type: file.type,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // RAG 처리 (청킹 + 임베딩 + 저장)
    console.log('🔄 파일 덮어쓰기 RAG 처리 시작...');
    const ragResult = await ragProcessor.processDocument(documentData);

    // 메모리 저장소 업데이트
    const documentIndex = documents.findIndex(doc => doc.id === documentId);
    if (documentIndex !== -1) {
      documents[documentIndex] = {
        id: documentId,
        title: fileName,
        type: getFileTypeFromExtension(fileName),
        status: ragResult.success ? 'completed' : 'failed',
        content: fileContent.substring(0, 1000),
        chunk_count: ragResult.chunkCount,
        file_size: file.size,
        file_type: file.type,
        created_at: documents[documentIndex].created_at,
        updated_at: new Date().toISOString()
      };
    }
    
    console.log(`✅ 파일 덮어쓰기 완료: ${fileName} -> ${documentId}`);

    return NextResponse.json({
      success: true,
      message: '파일이 성공적으로 덮어쓰기되었습니다.',
      data: {
        documentId: documentId,
        message: ragResult.success 
          ? `파일이 성공적으로 덮어쓰기되고 ${ragResult.chunkCount}개 청크로 처리되었습니다.`
          : '파일 덮어쓰기는 성공했지만 RAG 처리 중 오류가 발생했습니다.',
        status: ragResult.success ? 'completed' : 'failed',
        chunkCount: ragResult.chunkCount
      }
    });

  } catch (error) {
    console.error('❌ 파일 덮어쓰기 처리 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '파일 덮어쓰기 처리 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * 문서 삭제
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get('documentId');
    const url = searchParams.get('url');

    if (!documentId && !url) {
      return NextResponse.json(
        { 
          success: false,
          error: '문서 ID 또는 URL이 제공되지 않았습니다.' 
        },
        { status: 400 }
      );
    }

    console.log('🗑️ 문서 삭제 요청:', { documentId, url });

    // Supabase 클라이언트 생성
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let targetDocumentId = documentId;

    // URL이 제공된 경우, URL로 문서 ID를 찾기
    if (url && !documentId) {
      const { data: documents, error: findError } = await supabase
        .from('documents')
        .select('id, title, url')
        .eq('url', url)
        .limit(1);

      if (findError) {
        throw new Error(`문서 검색 실패: ${findError.message}`);
      }

      if (!documents || documents.length === 0) {
        return NextResponse.json(
          { 
            success: false,
            error: '해당 URL과 일치하는 문서를 찾을 수 없습니다.' 
          },
          { status: 404 }
        );
      }

      targetDocumentId = documents[0].id;
    }

    // 문서와 관련된 모든 청크 삭제
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', targetDocumentId);

    if (chunksError) {
      console.warn('청크 삭제 실패:', chunksError);
    }

    // 문서 삭제
    const { error: documentError } = await supabase
      .from('documents')
      .delete()
      .eq('id', targetDocumentId);

    if (documentError) {
      throw new Error(`문서 삭제 실패: ${documentError.message}`);
    }

    // 메모리에서도 삭제
    documents = documents.filter(doc => doc.id !== targetDocumentId);

    console.log(`✅ 문서 삭제 완료: ${targetDocumentId}`);

    return NextResponse.json({
      success: true,
      message: '문서와 관련된 모든 데이터가 성공적으로 삭제되었습니다.',
      data: {
        deletedChunks: 0, // 실제로는 삭제된 청크 수를 반환해야 함
        deletedEmbeddings: 0
      }
    });

  } catch (error) {
    console.error('❌ 문서 삭제 오류:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '문서 삭제 중 오류가 발생했습니다.',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}