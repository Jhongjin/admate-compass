"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, Link, X, CheckCircle, AlertCircle, AlertTriangle, Plus, File, Globe, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { fetchWithTimeout } from "@/lib/utils/fetchWithTimeout";

// UI 벤더 이름을 DB ENUM 값으로 변환하는 매핑
const VENDOR_TO_DB_MAP: Record<string, string> = {
  "Meta": "META",
  "Naver": "NAVER",
  "Kakao": "KAKAO",
  "Google": "GOOGLE",
  "X(Twitter)": "OTHER", // X/Twitter는 OTHER로 매핑
};

// 벤더 정규화 함수
function normalizeVendorForDB(vendor: string | undefined | null): string {
  if (!vendor) return 'META';
  
  // 매핑 테이블에서 찾기
  if (VENDOR_TO_DB_MAP[vendor]) {
    return VENDOR_TO_DB_MAP[vendor];
  }
  
  // 대문자로 변환하여 직접 매칭 시도
  const upperVendor = vendor.toUpperCase();
  if (['META', 'NAVER', 'KAKAO', 'GOOGLE', 'OTHER'].includes(upperVendor)) {
    return upperVendor;
  }
  
  // X(Twitter) 관련 처리
  if (upperVendor === 'X(TWITTER)' || upperVendor === 'TWITTER' || upperVendor === 'X') {
    return 'OTHER';
  }
  
  // 기본값
  return 'META';
}

interface DocumentFile {
  id: string;
  name: string;
  size: number;
  type: string;
  status: "pending" | "uploading" | "processing" | "success" | "error";
  progress: number;
  error?: string;
}

interface UploadedDocument {
  id: string;
  title: string;
  type: string;
  status: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  url?: string;
}

interface NewDocumentUploadProps {
  onUpload?: (files: File[]) => void;
  vendor?: string;
  hideList?: boolean;
}

export default function NewDocumentUpload({ onUpload, vendor, hideList = false }: NewDocumentUploadProps) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [duplicateFile, setDuplicateFile] = useState<{
    file: File;
    existingDocument: any;
    existingDocumentId: string;
  } | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const { toast } = useToast();

  // File 객체를 별도로 관리하는 Map
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 업로드된 문서 목록 가져오기
  const fetchUploadedDocuments = useCallback(async () => {
    try {
      setIsLoadingDocuments(true);
      console.log('📋 업로드된 문서 목록 가져오기 시작', { vendor });

      // vendor가 있으면 정규화하여 쿼리 파라미터에 추가
      const normalizedVendor = vendor ? normalizeVendorForDB(vendor) : null;
      const url = normalizedVendor
        ? `/api/admin/upload-new?vendor=${encodeURIComponent(normalizedVendor)}`
        : '/api/admin/upload-new';
      
      console.log('📋 문서 목록 조회 URL:', { vendorOriginal: vendor, vendorNormalized: normalizedVendor, url });

      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-cache'
      });

      if (!response.ok) {
        throw new Error(`문서 목록 조회 실패: ${response.status}`);
      }

      const result = await response.json();
      console.log('📋 문서 목록 조회 성공:', {
        success: result.success,
        documentCount: result.data?.documents?.length || 0,
        totalCount: result.data?.totalCount || 0,
        documents: result.data?.documents?.map((d: any) => ({
          id: d.id,
          title: d.title,
          vendor: d.source_vendor,
          status: d.status,
          chunkCount: d.chunk_count
        }))
      });

      if (result.success && result.data?.documents) {
        setUploadedDocuments(result.data.documents);
        console.log(`📋 ${result.data.documents.length}개 문서 로드 완료 (벤더: ${normalizedVendor || '전체'})`);
      } else {
        console.warn('⚠️ 문서 목록 조회 결과가 비정상적:', result);
        setUploadedDocuments([]);
      }
    } catch (error) {
      console.error('❌ 문서 목록 조회 오류:', error);
      toast({
        title: "문서 목록 조회 실패",
        description: "업로드된 문서 목록을 가져오는데 실패했습니다.",
        variant: "destructive"
      });
      setUploadedDocuments([]);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [toast, vendor]);

  // 컴포넌트 마운트 시 및 vendor 변경 시 문서 목록 로드
  useEffect(() => {
    fetchUploadedDocuments();
  }, [fetchUploadedDocuments, vendor]);

  // 파일 드래그 앤 드롭 핸들러
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      handleFileSelect(droppedFiles);
    }
  }, []);

  const handleFileSelect = (selectedFiles: File[]) => {
    console.log('선택된 파일들:', selectedFiles.map(f => ({ name: f.name, size: f.size, type: f.type })));

    const validFiles = selectedFiles.filter(file => {
      // PDF, DOCX, 텍스트 파일 허용
      const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      const isValidType = validTypes.includes(file.type) || ['.pdf', '.docx', '.txt'].includes(`.${fileExtension}`);

      // 파일 크기 제한 (20MB)
      const maxFileSize = parseInt(process.env.NEXT_PUBLIC_MAX_FILE_SIZE || '52428800'); // 50MB
      const isValidSize = file.size <= maxFileSize;

      if (!isValidType) {
        toast({
          title: "지원하지 않는 파일 형식",
          description: `${file.name} 파일은 PDF, DOCX, TXT 형식만 지원합니다.`,
          variant: "destructive",
        });
      }
      if (!isValidSize) {
        toast({
          title: "파일 크기 초과",
          description: `${file.name} 파일은 ${Math.round(maxFileSize / 1024 / 1024)}MB를 초과할 수 없습니다. 최대 50MB까지 업로드 가능합니다.`,
          variant: "destructive",
        });
      }
      return isValidType && isValidSize;
    });

    if (validFiles.length > 0) {
      const newFiles: DocumentFile[] = validFiles.map(file => {
        const fileId = `${file.name}-${file.size}-${Date.now()}`;
        fileMapRef.current.set(fileId, file); // 실제 File 객체 저장
        return {
          id: fileId,
          name: file.name,
          size: file.size,
          type: file.type,
          status: "pending",
          progress: 0,
        };
      });
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const handleFileRemove = (fileId: string) => {
    setFiles(prev => prev.filter(file => file.id !== fileId));
    fileMapRef.current.delete(fileId); // Map에서도 제거
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files ? Array.from(event.target.files) : [];
    if (selected.length) {
      handleFileSelect(selected);
      event.target.value = "";
    }
  };

  const triggerFileDialog = () => {
    fileInputRef.current?.click();
  };

  // 적응형 폴링 함수: 작업 상태를 확인하고 완료될 때까지 폴링
  const pollJobStatus = async (jobId: string, documentId: string, fileId: string, fileName: string) => {
    const MAX_POLL_ATTEMPTS = 120; // 최대 10분 (5초 * 120)
    const INITIAL_POLL_INTERVAL = 2000; // 초기 2초
    const MAX_POLL_INTERVAL = 5000; // 최대 5초
    const MIN_POLL_INTERVAL = 2000; // 최소 2초

    let pollInterval = INITIAL_POLL_INTERVAL;
    let attempts = 0;
    let lastStatus = 'queued';

    const poll = async (): Promise<void> => {
      if (attempts >= MAX_POLL_ATTEMPTS) {
        console.error('⏱️ 폴링 타임아웃:', { jobId, documentId, attempts });
        setFiles(prev => prev.map(f =>
          f.id === fileId ? {
            ...f,
            status: "error",
            error: '처리 시간이 초과되었습니다. 나중에 다시 확인해주세요.'
          } : f
        ));
        toast({
          title: "처리 타임아웃",
          description: `${fileName} 파일 처리가 시간 초과되었습니다.`,
          variant: "destructive"
        });
        return;
      }

      attempts++;

      try {
        // Supabase에서 작업 상태 확인
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        // 작업 상태 확인
        const { data: job, error: jobError } = await supabase
          .from('processing_jobs')
          .select('status, error, result')
          .eq('id', jobId)
          .single();

        if (jobError) {
          console.error('❌ 작업 상태 조회 실패:', jobError);
          // 에러가 있어도 계속 폴링 (일시적 오류일 수 있음)
        }

        // 문서 상태 확인 (작업이 완료되었을 수 있음)
        const { data: document, error: docError } = await supabase
          .from('documents')
          .select('status, chunk_count')
          .eq('id', documentId)
          .single();

        if (docError && docError.code !== 'PGRST116') {
          console.error('❌ 문서 상태 조회 실패:', docError);
        }

        const currentStatus = job?.status || document?.status || 'unknown';

        // 상태 변경 감지 시 폴링 간격 조정
        if (currentStatus !== lastStatus) {
          console.log(`📊 상태 변경: ${lastStatus} → ${currentStatus}`);
          lastStatus = currentStatus;

          // 처리 중이면 폴링 간격 증가 (처리 시간이 길어질 수 있음)
          if (currentStatus === 'processing') {
            pollInterval = Math.min(pollInterval + 500, MAX_POLL_INTERVAL);
          } else {
            // 대기 중이면 폴링 간격 감소 (빠르게 시작될 수 있음)
            pollInterval = Math.max(pollInterval - 500, MIN_POLL_INTERVAL);
          }
        }

        // 진행률 업데이트 (상태에 따라)
        if (currentStatus === 'processing') {
          const progress = Math.min(30 + (attempts * 0.5), 90);
          setFiles(prev => prev.map(f =>
            f.id === fileId ? { ...f, status: "processing", progress } : f
          ));
        }

        // 완료 확인
        if (currentStatus === 'completed' || document?.status === 'indexed') {
          // 폴링 완료 후 문서 목록 새로고침
          console.log('🔄 폴링 완료 - 문서 목록 새로고침 예약');
          setTimeout(() => {
            fetchUploadedDocuments();
          }, 1000);
          
          // 추가로 3초 후에도 새로고침 (DB 동기화 대기)
          setTimeout(() => {
            console.log('🔄 폴링 완료 - 지연 문서 목록 새로고침');
            fetchUploadedDocuments();
          }, 3000);
          console.log('✅ 작업 완료:', { jobId, documentId, chunkCount: document?.chunk_count });

          setFiles(prev => prev.map(f =>
            f.id === fileId ? { ...f, status: "success", progress: 100 } : f
          ));

          toast({
            title: "처리 완료",
            description: `${fileName} 파일이 성공적으로 처리되었습니다.`,
          });

          // 문서 목록 새로고침
          setTimeout(() => {
            fetchUploadedDocuments();
          }, 1000);

          // 완료된 파일을 3초 후 업로드 리스트에서 제거
          setTimeout(() => {
            setFiles(prev => prev.filter(f => f.id !== fileId));
            console.log(`✅ 완료된 파일 제거: ${fileName}`);
          }, 3000);

          return;
        }

        // 실패 확인
        if (currentStatus === 'failed') {
          const errorMessage = job?.error || '처리 중 오류가 발생했습니다.';
          console.error('❌ 작업 실패:', { jobId, error: errorMessage });

          setFiles(prev => prev.map(f =>
            f.id === fileId ? {
              ...f,
              status: "error",
              error: errorMessage
            } : f
          ));

          toast({
            title: "처리 실패",
            description: `${fileName} 파일 처리 중 오류가 발생했습니다.`,
            variant: "destructive"
          });

          return;
        }

        // 다음 폴링 예약
        setTimeout(poll, pollInterval);

      } catch (error) {
        console.error('❌ 폴링 오류:', error);
        // 오류가 있어도 계속 폴링 (일시적 오류일 수 있음)
        setTimeout(poll, pollInterval);
      }
    };

    // 첫 폴링 시작
    setTimeout(poll, pollInterval);
  };

  const uploadAndIndexDocument = async (file: File, fileId: string, duplicateAction?: 'overwrite' | 'skip') => {
    try {
      // 1단계: 파일 업로드
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, status: "uploading", progress: 10 } : f
      ));

      console.log('파일 업로드 요청 시작:', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
      });

      // Base64 인코딩을 사용하여 파일 전송
      // PDF/DOCX는 바이너리 파일이므로 arrayBuffer 사용 (file.text()는 텍스트 파일에만 작동)
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // 브라우저 환경에서 Uint8Array를 Base64로 변환 (청크 단위로 처리하여 메모리 효율성 향상)
      let base64Content = '';
      const chunkSize = 8192; // 8KB 청크로 처리
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.slice(i, i + chunkSize);
        // Uint8Array를 문자열로 변환 후 Base64 인코딩
        const binaryString = Array.from(chunk, byte => String.fromCharCode(byte)).join('');
        base64Content += btoa(binaryString);
      }

      // 벤더 정규화 (UI 이름 -> DB ENUM 값)
      const normalizedVendor = normalizeVendorForDB(vendor);
      
      const requestBody = {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        fileContent: base64Content,
        type: 'file',
        vendor: normalizedVendor, // 정규화된 벤더 값 전달
        duplicateAction: duplicateAction // 중복 처리 옵션 (overwrite | skip)
      };
      
      console.log('📤 파일 업로드 요청:', {
        fileName: file.name,
        vendorOriginal: vendor,
        vendorNormalized: normalizedVendor,
        vendorProp: vendor
      });

      console.log('Base64 인코딩 완료, JSON 요청 전송');

      // 타임아웃 설정 (파일 크기에 따라 조정)
      // 작은 파일(<5MB): 60초, 중간 파일(5-15MB): 120초, 큰 파일(>15MB): 180초
      const fileSizeMB = file.size / (1024 * 1024);
      let timeout = 60000; // 기본 60초
      if (fileSizeMB > 15) {
        timeout = 180000; // 180초 (3분)
      } else if (fileSizeMB > 5) {
        timeout = 120000; // 120초 (2분)
      }
      
      console.log('⏱️ 타임아웃 설정:', { fileSizeMB: fileSizeMB.toFixed(2), timeoutMs: timeout, timeoutSec: timeout / 1000 });
      
      const response = await fetchWithTimeout('/api/admin/upload-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        cache: 'no-cache',
        mode: 'cors',
        credentials: 'same-origin',
      }, timeout);
      console.log('응답 상태:', response.status);
      console.log('응답 Content-Type:', response.headers.get('content-type'));

      let result;
      try {
        const contentType = response.headers.get('content-type') || '';
        
        // Content-Type 확인
        if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
          const responseText = await response.text();
          console.error('❌ JSON이 아닌 응답 수신:', {
            contentType,
            status: response.status,
            responsePreview: responseText.substring(0, 200)
          });
          
          // HTML 에러 페이지인 경우 (Vercel 타임아웃 등)
          if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
            throw new Error('요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.');
          }
          
          throw new Error(`서버가 예상치 못한 형식의 응답을 반환했습니다 (${contentType}). 상태: ${response.status}`);
        }

        const responseText = await response.text();
        console.log('서버 응답 텍스트 (처음 500자):', responseText.substring(0, 500));

        if (!responseText || responseText.trim() === '') {
          throw new Error('서버에서 빈 응답을 받았습니다.');
        }

        // JSON 파싱 시도
        try {
          result = JSON.parse(responseText);
          console.log('JSON 파싱 성공:', {
            success: result.success,
            hasError: !!result.error,
            hasData: !!result.data
          });
        } catch (jsonError) {
          console.error('❌ JSON 파싱 실패:', {
            error: jsonError instanceof Error ? jsonError.message : String(jsonError),
            responsePreview: responseText.substring(0, 500),
            contentType
          });
          
          // HTML 에러 페이지인 경우
          if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
            throw new Error('요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.');
          }
          
          throw new Error(`서버 응답을 파싱할 수 없습니다: ${jsonError instanceof Error ? jsonError.message : '알 수 없는 오류'}`);
        }
      } catch (parseError) {
        console.error('❌ 응답 처리 오류:', parseError);
        throw parseError instanceof Error ? parseError : new Error('서버 응답 처리 중 알 수 없는 오류가 발생했습니다.');
      }

      // 중복 파일 처리 (409 Conflict)
      if (response.status === 409 && result.error === 'DUPLICATE_FILE') {
        console.log('⚠️ 중복 파일 감지:', {
          fileName: file.name,
          existingDocument: result.data?.existingDocument
        });
        
        // 중복 파일 정보 저장 및 다이얼로그 표시
        setDuplicateFile({
          file: file,
          existingDocument: result.data?.existingDocument,
          existingDocumentId: result.data?.existingDocument?.id
        });
        setShowDuplicateDialog(true);
        
        // 파일 상태를 대기로 변경
        setFiles(prev => prev.map(f =>
          f.id === fileId ? { ...f, status: "pending", progress: 0 } : f
        ));
        
        return; // 다이얼로그에서 사용자 선택 대기
      }

      // 오류 처리
      if (!response.ok) {
        const errorMessage = result.error || `서버 오류 (${response.status})`;
        console.error('서버 오류 응답:', errorMessage);
        throw new Error(errorMessage);
      }

      // 백엔드 처리 확인 로직 추가
      if (result.data?.documentId) {
        console.log('✅ 백엔드 처리 확인:', {
          documentId: result.data.documentId,
          status: result.data.status,
          chunkCount: result.data.chunkCount,
          message: result.data.message
        });
      }

      // 큐로 오프로딩된 경우 폴링 시작
      if (result.queued && result.jobId && result.documentId) {
        console.log('📋 큐로 오프로딩됨, 폴링 시작:', { jobId: result.jobId, documentId: result.documentId });

        setFiles(prev => prev.map(f =>
          f.id === fileId ? { ...f, status: "processing", progress: 30 } : f
        ));

        // 적응형 폴링 시작
        await pollJobStatus(result.jobId, result.documentId, fileId, file.name);
        return; // 폴링이 완료되면 함수 종료
      }

      // RAG 처리 결과 확인
      if (!result.success || result.data?.status === 'failed') {
        const errorMessage = result.data?.message || 'RAG 처리 중 오류가 발생했습니다.';
        console.error('RAG 처리 실패:', errorMessage);
        throw new Error(errorMessage);
      }

      // 2단계: 처리 진행
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, status: "processing", progress: 60 } : f
      ));

      // 3단계: 완료
      setFiles(prev => prev.map(f =>
        f.id === fileId ? { ...f, status: "success", progress: 100 } : f
      ));

      console.log(`파일 처리 완료: ${file.name}`);

      // 성공 토스트 표시
      toast({
        title: "업로드 완료",
        description: `${file.name} 파일이 성공적으로 업로드되고 처리되었습니다.`,
      });

      // 문서 목록 새로고침 (업로드 완료 후 즉시 + 지연)
      console.log('🔄 문서 목록 새로고침 예약:', { vendor, documentId: result.data?.documentId || 'unknown' });
      
      // 즉시 새로고침 시도
      fetchUploadedDocuments();
      
      // 추가로 2초 후에도 새로고침 (DB 동기화 대기)
      setTimeout(() => {
        console.log('🔄 문서 목록 지연 새로고침 실행');
        fetchUploadedDocuments();
      }, 2000);

      // 완료된 파일을 3초 후 업로드 리스트에서 제거
      setTimeout(() => {
        setFiles(prev => prev.filter(f => f.id !== fileId));
        console.log(`✅ 완료된 파일 제거: ${file.name}`);
      }, 3000);

    } catch (error) {
      console.error('파일 처리 오류:', error);

      // 타임아웃 오류 감지
      const isTimeoutError = error instanceof Error && (
        error.name === 'AbortError' ||
        error.message.includes('timeout') ||
        error.message.includes('Request timeout')
      );

      const errorMessage = isTimeoutError
        ? '파일 처리 시간이 초과되었습니다. 파일 크기를 줄이거나 나중에 다시 시도해주세요.'
        : error instanceof Error ? error.message : '알 수 없는 오류';

      setFiles(prev => prev.map(f =>
        f.id === fileId ? {
          ...f,
          status: "error",
          progress: 0,
          error: errorMessage
        } : f
      ));

      toast({
        title: isTimeoutError ? "업로드 타임아웃" : "업로드 실패",
        description: `${file.name} 파일 처리 중 오류가 발생했습니다: ${errorMessage}`,
        variant: "destructive"
      });
    }
  };

  const handleBatchUpload = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    console.log(`배치 업로드 시작: ${files.length}개 파일`);

    try {
      // 모든 파일을 병렬로 처리
      const uploadPromises = files
        .filter(file => file.status === "pending")
        .map(file => {
          const actualFile = fileMapRef.current.get(file.id);
          if (actualFile) {
            return uploadAndIndexDocument(actualFile, file.id);
          }
          return Promise.resolve();
        });

      await Promise.all(uploadPromises);

      console.log('배치 업로드 완료');

      // 부모 컴포넌트에 업로드 완료 알림
      if (onUpload) {
        const uploadedFiles = files
          .filter(f => f.status === "success")
          .map(f => fileMapRef.current.get(f.id))
          .filter(Boolean) as File[];
        onUpload(uploadedFiles);
      }

    } catch (error) {
      console.error('배치 업로드 오류:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUrlAdd = () => {
    const urlInput = document.getElementById('url-input') as HTMLInputElement;
    const url = urlInput?.value.trim();

    if (url && !urls.includes(url)) {
      setUrls(prev => [...prev, url]);
      urlInput.value = '';
    }
  };

  const handleUrlRemove = (url: string) => {
    setUrls(prev => prev.filter(u => u !== url));
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      case "processing":
        return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      case "uploading":
        return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "success": return "완료";
      case "error": return "오류";
      case "processing": return "처리중";
      case "uploading": return "업로드중";
      default: return "대기";
    }
  };

  return (
    <motion.div
      className="space-y-8"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* 문서 관리 안내 */}
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-bold text-white">문서 관리</h2>
        <p className="text-gray-400 max-w-2xl mx-auto">
          정책 문서와 가이드라인을 업로드하고 관리하여 AI 챗봇의 지식 베이스를 확장하세요.
        </p>
        <p className="text-sm text-gray-500">
          문서 업로드 후 자동으로 인덱싱됩니다. 처리 상태를 실시간으로 확인할 수 있습니다.
        </p>
      </div>

      {/* 파일 업로드 영역 */}
      <Card className="bg-gradient-to-b from-[#12172a] to-[#0b0f17] border border-white/10 shadow-[0_20px_60px_rgba(5,9,20,0.55)]">
        <CardContent className="space-y-6 pt-8">
          <div
            className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${dragActive
              ? 'border-blue-400 bg-blue-500/5'
              : 'border-white/10 bg-[#0B0F17]'
              }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={triggerFileDialog}
          >
            <div className="flex flex-col items-center space-y-3">
              <Upload className="w-14 h-14 text-blue-300" />
              <p className="text-xl font-semibold text-white">파일을 드래그하여 놓거나 클릭하여 선택하세요</p>
              <p className="text-gray-300 text-sm">PDF, DOCX, TXT 파일 지원 (멀티 파일 선택 가능)</p>
              <p className="text-sm font-semibold text-amber-300">최대 파일 크기: 15MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleInputChange}
              onClick={(e) => {
                // input 클릭 시 이벤트 전파 중지 (div의 onClick과 중복 방지)
                e.stopPropagation();
              }}
            />
          </div>

          {/* File List */}
          <AnimatePresence>
            {files.length > 0 && (
              <motion.div
                className="space-y-3"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <h3 className="text-white font-medium">업로드 중인 파일 {files.length}개</h3>
                {files.map((file) => (
                  <motion.div
                    key={file.id}
                    className="bg-gray-700/50 border border-gray-600 rounded-lg p-4"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {getStatusIcon(file.status)}
                        <div>
                          <p className="text-white font-medium">{file.name}</p>
                          <p className="text-gray-400 text-sm">
                            {Math.round(file.size / 1024)}KB • {getStatusText(file.status)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {file.status === "error" && file.error && (
                          <div className="text-red-400 text-xs max-w-xs truncate">
                            {file.error}
                          </div>
                        )}
                        <Button
                          onClick={() => handleFileRemove(file.id)}
                          variant="ghost"
                          size="sm"
                          className="text-gray-400 hover:text-red-400"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    {file.status === "uploading" || file.status === "processing" ? (
                      <Progress value={file.progress} className="mt-2" />
                    ) : null}
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* 업로드 버튼 */}
          <div className="space-y-2">
            <Button
              onClick={handleBatchUpload}
              disabled={isUploading || files.length === 0}
              className="w-full h-12 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-semibold"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  업로드 중...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  업로드
                </>
              )}
            </Button>
            <p className="text-center text-xs text-gray-400">
              10MB 이상 PDF/DOCX는 자동으로 큐로 오프로드됩니다.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 업로드된 문서 목록 */}
      {!hideList && (
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center space-x-2">
                <FileText className="w-5 h-5 text-green-400" />
                <span>업로드된 파일</span>
                <Badge variant="secondary" className="bg-green-500/20 text-green-300 border-green-500/30">
                  {uploadedDocuments.length}개
                </Badge>
              </CardTitle>
              <Button
                onClick={fetchUploadedDocuments}
                disabled={isLoadingDocuments}
                variant="outline"
                size="sm"
                className="bg-gray-700 hover:bg-gray-600 text-white border-gray-500"
              >
                {isLoadingDocuments ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "새로고침"
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingDocuments ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-gray-400" />
                <p className="text-gray-400">문서 목록을 불러오는 중...</p>
              </div>
            ) : uploadedDocuments.length > 0 ? (
              <div className="space-y-2">
                {uploadedDocuments.map((doc) => (
                  <div key={doc.id} className="bg-gray-700/50 border border-gray-600 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <FileText className="w-5 h-5 text-blue-400" />
                        <div>
                          <p className="text-white font-medium">{doc.title}</p>
                          <div className="flex items-center space-x-4 text-sm text-gray-400">
                            <span>유형: {doc.type?.toUpperCase() || 'UNKNOWN'}</span>
                            <span>상태: {doc.status === 'completed' ? '완료' : doc.status === 'processing' ? '처리중' : '대기'}</span>
                            <span>청크: {doc.chunk_count || 0}개</span>
                            <span>크기: {doc.url ? 'URL' : 'N/A'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge
                          variant={doc.status === 'completed' ? 'default' : 'secondary'}
                          className={doc.status === 'completed' ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'}
                        >
                          {doc.status === 'completed' ? '완료' : doc.status === 'processing' ? '처리중' : '대기'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>업로드된 문서가 없습니다.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
