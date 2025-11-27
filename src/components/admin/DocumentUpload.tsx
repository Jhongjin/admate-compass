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

interface DocumentFile {
  id: string;
  name: string;
  size: number;
  type: string;
  status: "pending" | "uploading" | "indexing" | "success" | "error";
  progress: number;
  error?: string;
}

interface DocumentUploadProps {
  onUpload?: (files: File[]) => void;
  onDocumentListRefresh?: () => void;
}

export default function DocumentUpload({ onUpload, onDocumentListRefresh }: DocumentUploadProps) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [urls, setUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  // File 객체를 별도로 관리하는 Map
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const [duplicateFile, setDuplicateFile] = useState<{
    file: File;
    existingDocument: any;
    existingDocumentId: string;
  } | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<any[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const { toast } = useToast();

  // 업로드된 문서 목록 가져오기
  const fetchUploadedDocuments = useCallback(async () => {
    try {
      setIsLoadingDocuments(true);
      console.log('📋 업로드된 문서 목록 가져오기 시작');
      
      const response = await fetchWithTimeout('/api/admin/upload-new', {
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
      console.log('📋 문서 목록 조회 성공:', result);
      
      if (result.success && result.data?.documents) {
        setUploadedDocuments(result.data.documents);
        console.log(`📋 ${result.data.documents.length}개 문서 로드 완료`);
      }
    } catch (error) {
      console.error('❌ 문서 목록 조회 오류:', error);
      toast({
        title: "문서 목록 조회 실패",
        description: "업로드된 문서 목록을 가져오는데 실패했습니다.",
        variant: "destructive"
      });
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [toast]);

  // 컴포넌트 마운트 시 문서 목록 로드
  useEffect(() => {
    fetchUploadedDocuments();
  }, [fetchUploadedDocuments]);

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
      const validTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
      ];
      const validExtensions = ['.pdf', '.docx', '.txt'];
      
      return validTypes.includes(file.type) || 
             validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    });

    if (validFiles.length !== selectedFiles.length) {
      toast({
        title: "지원하지 않는 파일 형식",
        description: "PDF(.pdf), Word(.docx), 텍스트(.txt) 파일만 업로드 가능합니다.",
        variant: "destructive",
      });
    }

    const newFiles: DocumentFile[] = validFiles.map((file, index) => {
      const fileId = `file-${Date.now()}-${index}`;
      // File 객체를 Map에 저장
      fileMapRef.current.set(fileId, file);
      
      return {
        id: fileId,
        name: file.name, // 원본 파일명 유지 (서버에서 디코딩 처리)
        size: file.size,
        type: file.type,
        status: "pending" as const,
        progress: 0,
      };
    });

    console.log('생성된 DocumentFile 객체들:', newFiles.map(f => ({ id: f.id, name: f.name })));

    setFiles(prev => [...prev, ...newFiles]);
  };


  const handleFileRemove = (fileId: string) => {
    // Map에서도 File 객체 제거
    fileMapRef.current.delete(fileId);
    setFiles(prev => prev.filter(file => file.id !== fileId));
  };

  const uploadAndIndexDocument = async (file: File, fileId: string) => {
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

      // Base64 인코딩을 사용하여 파일 전송 (PDF 등 바이너리 파일 지원)
      let base64Content;
      console.log(`📁 파일 처리 시작: ${file.name} (${file.type}, ${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      
      if (file.type === 'application/pdf' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        console.log(`📄 ${file.type.includes('pdf') ? 'PDF' : 'DOCX'} 파일 Base64 인코딩 시작...`);
        // PDF/DOCX 파일은 ArrayBuffer로 읽어서 Base64 인코딩 (바이너리 데이터 보존)
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // 바이너리 데이터를 올바르게 Base64로 인코딩
        let binaryString = '';
        const chunkSize = 8192; // 8KB 청크
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.slice(i, i + chunkSize);
          binaryString += String.fromCharCode.apply(null, Array.from(chunk));
        }
        base64Content = btoa(binaryString);
        console.log(`✅ ${file.type.includes('pdf') ? 'PDF' : 'DOCX'} Base64 인코딩 완료: ${base64Content.length} 문자`);
        
        // Base64 인코딩 검증
        const testDecode = atob(base64Content);
        const isValidBase64 = testDecode.length === file.size;
        console.log(`🔍 Base64 검증: 원본 크기 ${file.size}, 디코딩 크기 ${testDecode.length}, 유효성 ${isValidBase64}`);
        
        if (!isValidBase64) {
          throw new Error(`Base64 인코딩 실패: 크기 불일치 (원본: ${file.size}, 디코딩: ${testDecode.length})`);
        }
      } else {
        console.log('📄 텍스트 파일 Base64 인코딩 시작...');
        // 텍스트 파일은 기존 방식 사용
        const fileContent = await file.text();
        base64Content = btoa(unescape(encodeURIComponent(fileContent)));
        console.log(`✅ 텍스트 Base64 인코딩 완료: ${base64Content.length} 문자`);
      }
      
      const requestBody = {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        fileContent: base64Content,
        type: 'file'
      };

      console.log('Base64 인코딩 완료, JSON 요청 전송');

      const response = await fetchWithTimeout('/api/admin/upload-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        cache: 'no-cache',
        mode: 'cors',
        credentials: 'same-origin'
      });

      console.log('📡 API 응답 상태:', response.status);
      console.log('📡 API 응답 헤더:', Object.fromEntries(response.headers.entries()));

      let result;
      let responseText = '';
      try {
        responseText = await response.text();
        console.log('📡 서버 응답 텍스트 길이:', responseText.length);
        console.log('📡 서버 응답 텍스트 (처음 500자):', responseText.substring(0, 500));
        
        if (!responseText) {
          throw new Error('서버에서 빈 응답을 받았습니다.');
        }
        
        result = JSON.parse(responseText);
        console.log('✅ JSON 파싱 성공:', {
          success: result.success,
          error: result.error,
          data: result.data ? '데이터 있음' : '데이터 없음',
          message: result.message || result.data?.message
        });
      } catch (parseError) {
        console.error('❌ JSON 파싱 오류:', parseError);
        console.error('❌ 응답 상태:', response.status, response.statusText);
        console.error('❌ 응답 헤더:', Object.fromEntries(response.headers.entries()));
        console.error('❌ 응답 텍스트:', responseText || '응답 텍스트 없음');
        
        throw new Error(`서버 응답 처리 오류: ${parseError instanceof Error ? parseError.message : '알 수 없는 오류'}`);
      }

      // 409 Conflict (중복 파일) 처리 - 정상적인 중복 파일 감지
      if (response.status === 409 && result.error === 'DUPLICATE_FILE') {
        console.info('✅ 중복 파일 감지 (정상 처리):', file.name);
        console.info('📋 중복 파일 정보:', {
          fileName: result.data?.fileName,
          existingDocumentId: result.data?.existingDocument?.id,
          message: result.data?.message
        });
        
        // existingDocument가 존재하는지 확인
        if (result.data?.existingDocument) {
          setDuplicateFile({
            file,
            existingDocument: result.data.existingDocument,
            existingDocumentId: result.data.existingDocument.id
          });
          setShowDuplicateDialog(true);
          
          // 파일 상태를 대기로 변경
          setFiles(prev => prev.map(f => 
            f.id === fileId ? { ...f, status: "pending", progress: 0 } : f
          ));
          return; // 중복 파일 처리 시 정상 종료
        } else {
          console.error('❌ 중복 파일 응답에 existingDocument가 없습니다:', result);
          throw new Error('중복 파일 정보를 받을 수 없습니다.');
        }
      }

      // 기타 오류 처리
      if (!response.ok) {
        const errorMessage = result.error || `서버 오류 (${response.status})`;
        console.error('서버 오류 응답:', errorMessage);
        throw new Error(errorMessage);
      }

      // RAG 처리 결과 확인
      console.log('🔍 RAG 처리 결과 확인:', {
        success: result.success,
        data: result.data,
        status: result.data?.status
      });
      
      if (!result.success || result.data?.status === 'failed') {
        const errorMessage = result.data?.message || 'RAG 처리 중 오류가 발생했습니다.';
        console.error('❌ RAG 처리 실패:', errorMessage);
        console.error('❌ 전체 응답:', result);
        throw new Error(errorMessage);
      }

      // 2단계: 인덱싱 진행
      setFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, status: "indexing", progress: 60 } : f
      ));

      // 3단계: 완료
      setFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, status: "success", progress: 100 } : f
      ));

      console.log(`파일 처리 완료: ${file.name}`);
      
      // 성공 토스트 표시
      toast({
        title: "업로드 완료",
        description: `${file.name} 파일이 성공적으로 업로드되고 인덱싱되었습니다.`,
      });

      // 부모 컴포넌트에 업로드 완료 알림
      if (onUpload) {
        onUpload([file]);
      }
      
      // 부모 컴포넌트의 문서 목록 새로고침
      if (onDocumentListRefresh) {
        setTimeout(() => {
          console.log("🔄 DocumentUpload: 부모 컴포넌트 문서 목록 새로고침 요청");
          onDocumentListRefresh();
        }, 1000); // 1초 후 문서 목록 새로고침
      }
      
      // 파일 리스트 새로고침
      setTimeout(() => {
        fetchUploadedDocuments();
      }, 1000); // 1초 후 문서 목록 새로고침

    } catch (error) {
      console.error(`파일 처리 오류 (${file.name}):`, error);
      setFiles(prev => prev.map(f => 
        f.id === fileId ? { 
          ...f, 
          status: "error", 
          error: error instanceof Error ? error.message : "알 수 없는 오류"
        } : f
      ));
      throw error; // 상위에서 처리하도록
    }
  };

  const uploadAndIndexUrl = async (url: string) => {
    try {
      const response = await fetchWithTimeout('/api/admin/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, type: 'url' }),
      });

      if (!response.ok) {
        throw new Error('URL 처리 실패');
      }

      toast({
        title: "URL 처리 완료",
        description: `${url} URL이 성공적으로 처리되고 인덱싱되었습니다.`,
      });

    } catch (error) {
      toast({
        title: "URL 처리 실패",
        description: `${url} URL 처리 중 오류가 발생했습니다.`,
        variant: "destructive",
      });
    }
  };

  // 중복 파일 덮어쓰기 처리
  const handleOverwriteFile = async () => {
    if (!duplicateFile) return;

    try {
      console.log('덮어쓰기 요청 시작:', {
        fileName: duplicateFile.file.name,
        existingDocumentId: duplicateFile.existingDocumentId
      });

      // Base64 인코딩을 사용하여 파일 전송 (PDF 등 바이너리 파일 지원)
      let base64Content;
      if (duplicateFile.file.type === 'application/pdf') {
        // PDF 파일은 ArrayBuffer로 읽어서 Base64 인코딩 (스택 오버플로우 방지)
        const arrayBuffer = await duplicateFile.file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // 큰 파일의 경우 스택 오버플로우를 방지하기 위해 청크 단위로 처리
        let binaryString = '';
        const chunkSize = 8192; // 8KB 청크
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.slice(i, i + chunkSize);
          binaryString += String.fromCharCode.apply(null, Array.from(chunk));
        }
        base64Content = btoa(binaryString);
      } else {
        // 텍스트 파일은 기존 방식 사용
        const fileContent = await duplicateFile.file.text();
        base64Content = btoa(unescape(encodeURIComponent(fileContent)));
      }
      
      const requestBody = {
        fileName: duplicateFile.file.name,
        fileSize: duplicateFile.file.size,
        fileType: duplicateFile.file.type,
        fileContent: base64Content,
        duplicateAction: 'overwrite'
      };

      console.log('덮어쓰기 Base64 인코딩 완료, JSON 요청 전송');

      const response = await fetchWithTimeout('/api/admin/upload-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        cache: 'no-cache',
        mode: 'cors',
        credentials: 'same-origin'
      });

      console.log('덮어쓰기 응답 상태:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('덮어쓰기 실패 응답:', errorText);
        throw new Error(`파일 덮어쓰기 실패 (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log('덮어쓰기 성공:', result);

      // 파일 상태를 성공으로 변경 (더 정확한 매칭)
      setFiles(prev => prev.map(f => {
        if (f.name === duplicateFile.file.name && f.size === duplicateFile.file.size) {
          console.log('덮어쓰기 성공 - 파일 상태 업데이트:', f.name);
          return { ...f, status: "success", progress: 100 };
        }
        return f;
      }));

      toast({
        title: "덮어쓰기 완료",
        description: `${duplicateFile.file.name} 파일이 성공적으로 덮어쓰기되었습니다.`,
      });

      setShowDuplicateDialog(false);
      setDuplicateFile(null);

      // 문서 목록 새로고침
      setTimeout(() => {
        fetchUploadedDocuments();
      }, 1000);

    } catch (error) {
      toast({
        title: "덮어쓰기 실패",
        description: `${duplicateFile.file.name} 파일 덮어쓰기 중 오류가 발생했습니다.`,
        variant: "destructive",
      });
    }
  };

  // 중복 파일 건너뛰기 처리
  const handleSkipFile = () => {
    if (!duplicateFile) return;

    console.log('건너뛰기 처리 시작:', duplicateFile.file.name);

    // 파일을 목록에서 제거 (더 정확한 매칭)
    setFiles(prev => {
      const filtered = prev.filter(f => {
        // 파일명과 크기를 모두 확인하여 정확한 파일 식별
        return !(f.name === duplicateFile.file.name && f.size === duplicateFile.file.size);
      });
      console.log('건너뛰기 후 남은 파일 수:', filtered.length);
      return filtered;
    });

    // Map에서도 File 객체 제거
    const fileToRemove = Array.from(fileMapRef.current.entries()).find(([id, file]) => 
      file.name === duplicateFile.file.name && file.size === duplicateFile.file.size
    );
    if (fileToRemove) {
      fileMapRef.current.delete(fileToRemove[0]);
      console.log('Map에서 파일 제거 완료:', fileToRemove[0]);
    }

    toast({
      title: "파일 건너뛰기",
      description: `${duplicateFile.file.name} 파일을 건너뛰었습니다.`,
    });

    setShowDuplicateDialog(false);
    setDuplicateFile(null);
  };

  const handleSubmit = async () => {
    if (files.length === 0 && urls.length === 0) return;

    setIsUploading(true);

    try {
      // 파일 업로드 및 인덱싱 - 순차적으로 처리하여 중복 파일 처리 문제 해결
      const pendingFiles = files.filter(file => file.status === "pending");
      
      for (const file of pendingFiles) {
        try {
          console.log(`파일 처리 시작: ${file.name}`, { fileId: file.id });
          
          // Map에서 실제 File 객체 찾기
          const actualFile = findActualFile(file.id);
          if (actualFile) {
            console.log(`파일 찾음: ${file.name}`);
            await uploadAndIndexDocument(actualFile, file.id);
            // 중복 파일 처리 시에도 정상적으로 계속 진행
          } else {
            console.error(`파일을 찾을 수 없음: ${file.name}`);
            setFiles(prev => prev.map(f => 
              f.id === file.id ? { 
                ...f, 
                status: "error", 
                error: "파일을 찾을 수 없습니다"
              } : f
            ));
          }
        } catch (error) {
          // 중복 파일 처리로 인한 정상적인 종료는 에러로 처리하지 않음
          if (error instanceof Error && error.message.includes('중복 파일')) {
            console.log(`중복 파일 처리 완료: ${file.name}`);
            continue;
          }
          
          console.error(`파일 처리 오류 (${file.name}):`, error);
          setFiles(prev => prev.map(f => 
            f.id === file.id ? { 
              ...f, 
              status: "error", 
              error: error instanceof Error ? error.message : "알 수 없는 오류"
            } : f
          ));
        }
      }

      // 성공한 파일들 확인
      const successCount = files.filter(f => f.status === "success").length;
      const errorCount = files.filter(f => f.status === "error").length;

      if (errorCount > 0) {
        toast({
          title: "일부 파일 처리 실패",
          description: `${successCount}개 성공, ${errorCount}개 실패`,
          variant: "destructive",
        });
      } else if (successCount > 0) {
        toast({
          title: "모든 파일 처리 완료",
          description: `${successCount}개 파일이 성공적으로 처리되었습니다.`,
        });
      }

      // 성공 시 상태 초기화
      if (successCount > 0) {
        // 성공한 파일들을 제거하고 Map에서도 제거
        setFiles(prev => {
          const remainingFiles = prev.filter(f => f.status !== "success");
          // Map에서도 성공한 파일들 제거
          prev.forEach(f => {
            if (f.status === "success") {
              fileMapRef.current.delete(f.id);
            }
          });
          return remainingFiles;
        });
        
        // 부모 컴포넌트에 업로드 완료 알림   
        if (onUpload) {
          onUpload([]);
        }
      }

    } catch (error) {
      console.error('일괄 처리 오류:', error);
      toast({
        title: "일괄 처리 실패",
        description: "파일 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // 실제 파일 객체를 찾는 함수
  const findActualFile = (fileId: string): File | null => {
    // Map에서 File 객체 찾기
    const file = fileMapRef.current.get(fileId);
    if (file) {
      console.log(`Map에서 파일 찾음: ${file.name}`);
      return file;
    }
    
    // 백업: 파일 입력 요소에서 찾기
    const fileInput = document.getElementById('file-upload') as HTMLInputElement;
    if (fileInput && fileInput.files) {
      const fileArray = Array.from(fileInput.files);
      const foundFile = fileArray.find(f => f.name === fileId);
      if (foundFile) {
        console.log(`파일 입력에서 파일 찾음: ${foundFile.name}`);
        return foundFile;
      }
    }
    
    console.error(`파일을 찾을 수 없음: ${fileId}`);
    return null;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getStatusIcon = (status: DocumentFile["status"]) => {
    switch (status) {
      case "pending":
        return <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-pulse" />;
      case "uploading":
        return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      case "indexing":
        return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />;
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case "error":
        return <AlertCircle className="w-4 h-4 text-red-400" />;
    }
  };

  const getStatusText = (status: DocumentFile["status"]) => {
    switch (status) {
      case "pending":
        return "대기 중";
      case "uploading":
        return "업로드 중";
      case "indexing":
        return "인덱싱 중";
      case "success":
        return "완료";
      case "error":
        return "오류";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className="w-full bg-gray-800/80 backdrop-blur-sm border-gray-700/50 shadow-lg hover:shadow-xl transition-all duration-300">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center space-x-3 text-white">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-semibold">문서 업로드 및 인덱싱</span>
              <p className="text-sm text-gray-400 font-normal">새로운 문서를 시스템에 추가하고 AI가 학습할 수 있도록 인덱싱합니다</p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* File Upload */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <File className="w-5 h-5 text-blue-400" />
              <Label htmlFor="file-upload" className="text-white font-medium">파일 업로드</Label>
            </div>
            <motion.div 
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 ${
                dragActive 
                  ? 'border-blue-400 bg-blue-500/10 shadow-lg scale-[1.02]' 
                  : 'border-gray-600 hover:border-gray-500 hover:bg-gray-700/30'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <motion.div
                animate={{ 
                  scale: dragActive ? 1.1 : 1,
                  rotate: dragActive ? [0, -5, 5, 0] : 0
                }}
                transition={{ duration: 0.3 }}
              >
                <Upload className={`mx-auto h-16 w-16 ${dragActive ? 'text-blue-400' : 'text-gray-500'}`} />
              </motion.div>
              <div className="mt-6">
                <Label htmlFor="file-upload" className="cursor-pointer group">
                  <motion.span 
                    className="text-blue-400 hover:text-blue-300 font-semibold text-lg group-hover:underline"
                    whileHover={{ scale: 1.05 }}
                  >
                    파일 선택
                  </motion.span>
                  <span className="text-gray-400 ml-2">또는 드래그 앤 드롭</span>
                </Label>
                <Input
                  id="file-upload"
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    handleFileSelect(files);
                  }}
                  className="hidden"
                />
              </div>
              <div className="mt-4 flex items-center justify-center space-x-4 text-sm text-gray-400">
                <div className="flex items-center space-x-1">
                  <FileText className="w-4 h-4" />
                  <span>PDF</span>
                </div>
                <div className="flex items-center space-x-1">
                  <FileText className="w-4 h-4" />
                  <span>DOCX</span>
                </div>
                <div className="flex items-center space-x-1">
                  <FileText className="w-4 h-4" />
                  <span>TXT</span>
                </div>
                <span className="text-gray-500">• 최대 20MB</span>
              </div>
            </motion.div>
          </div>


          {/* File List */}
          <AnimatePresence>
            {files.length > 0 && (
              <motion.div 
                className="space-y-3"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex items-center space-x-2">
                  <FileText className="w-5 h-5 text-blue-400" />
                  <Label className="text-white font-medium">업로드 중인 파일</Label>
                  <Badge variant="secondary" className="bg-blue-500/20 text-blue-300 border-blue-500/30">
                    {files.length}개
                  </Badge>
                </div>
                <div className="space-y-3">
                  {files.map((file, index) => (
                    <motion.div 
                      key={file.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.3, delay: index * 0.1 }}
                      className="flex items-center justify-between p-4 bg-gray-700/50 rounded-xl border border-gray-600/50 hover:bg-gray-700/70 transition-all duration-200 group"
                    >
                      <div className="flex items-center space-x-4 flex-1 min-w-0">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
                          <FileText className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{file.name}</p>
                          <div className="flex items-center space-x-3 mt-1">
                            <p className="text-xs text-gray-400">{formatFileSize(file.size)}</p>
                            <div className="flex items-center space-x-2">
                              {getStatusIcon(file.status)}
                              <span className="text-xs text-gray-300">{getStatusText(file.status)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-4">
                        {(file.status === "uploading" || file.status === "indexing") && (
                          <div className="w-24">
                            <Progress 
                              value={file.progress} 
                              className="h-2 bg-gray-600"
                            />
                            <p className="text-xs text-gray-400 mt-1 text-center">{file.progress}%</p>
                          </div>
                        )}
                        
                        {file.status === "error" && (
                          <div className="flex items-center space-x-2 text-red-400 bg-red-500/10 px-3 py-1 rounded-lg">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-xs">{file.error}</span>
                          </div>
                        )}
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleFileRemove(file.id)}
                          className="text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>


          {/* Submit Button */}
          <motion.div 
            className="flex justify-end pt-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Button
              onClick={handleSubmit}
              disabled={files.length === 0 || isUploading}
              className="min-w-[180px] h-12 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  처리 중...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  업로드 및 인덱싱 시작
                </>
              )}
            </Button>
          </motion.div>
        </CardContent>
      </Card>

      {/* 중복 파일 알럿 다이얼로그 */}
      <AlertDialog open={showDuplicateDialog} onOpenChange={setShowDuplicateDialog}>
        <AlertDialogContent className="bg-gray-800 border-gray-600">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              <span>중복 파일 발견</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300">
              <span className="block">
                <strong className="text-white">{duplicateFile?.file.name}</strong> 파일이 이미 존재합니다.
              </span>
              {duplicateFile?.existingDocument && (
                <span className="block bg-gray-700/50 p-3 rounded-lg mt-3">
                  <span className="block text-sm text-gray-300">
                    <strong>기존 파일 정보:</strong>
                  </span>
                  <span className="block text-xs text-gray-400 mt-1">
                    상태: {duplicateFile.existingDocument.status === 'indexed' ? '완료' : (duplicateFile.existingDocument.status || '알 수 없음')}
                  </span>
                  <span className="block text-xs text-gray-400">
                    크기: {(duplicateFile.existingDocument.file_size || duplicateFile.existingDocument.size || 0) > 0 
                      ? formatFileSize(duplicateFile.existingDocument.file_size || duplicateFile.existingDocument.size || 0)
                      : '정보 없음'
                    }
                  </span>
                  <span className="block text-xs text-gray-400">
                    업로드일: {new Date(duplicateFile.existingDocument.created_at).toLocaleString('ko-KR')}
                  </span>
                </span>
              )}
              <span className="block text-sm mt-3">
                기존 파일을 덮어쓰시겠습니까, 아니면 이 파일을 건너뛰시겠습니까?
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="space-x-2">
            <AlertDialogCancel 
              onClick={handleSkipFile}
              className="bg-gray-600 hover:bg-gray-500 text-white border-gray-500"
            >
              건너뛰기
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleOverwriteFile}
              className="bg-red-600 hover:bg-red-500 text-white"
            >
              덮어쓰기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
