"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import AdminLayout from "@/components/layouts/AdminLayout";
import "@/app/admin/globals.admin.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, CheckCircle, Download, FileText, Globe, Loader2, RefreshCw, Search, Upload, XCircle, File, Link2, ArrowUp, ArrowDown, ArrowUpDown, FileSearch, Sparkles, Database } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

const ALL_VENDORS = ["Meta", "Naver", "Kakao", "Google", "X(Twitter)"] as const;

// UI 벤더 이름을 DB ENUM 값으로 변환하는 매핑
const VENDOR_TO_DB_MAP: Record<string, string> = {
  "Meta": "META",
  "Naver": "NAVER",
  "Kakao": "KAKAO",
  "Google": "GOOGLE",
  "X(Twitter)": "OTHER", // X/Twitter는 OTHER로 매핑
};

// DB ENUM 값을 UI 벤더 이름으로 변환하는 역매핑
const DB_TO_VENDOR_MAP: Record<string, string> = {
  "META": "Meta",
  "NAVER": "Naver",
  "KAKAO": "Kakao",
  "GOOGLE": "Google",
  "OTHER": "X(Twitter)",
};

// UI 벤더 배열을 DB 값 배열로 변환
function convertVendorsToDB(vendors: string[]): string[] {
  return vendors.map(v => VENDOR_TO_DB_MAP[v] || "META").filter(Boolean);
}

function AdminDocsPageContent() {
  const router = useRouter();
  const params = useSearchParams();

  const [selectedVendors, setSelectedVendors] = useState<string[]>(() => {
    const fromUrl = params.get("vendors");
    return fromUrl ? decodeURIComponent(fromUrl).split(",").filter(Boolean) : ["Meta"]; // default
  });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  // 보기 모드 로컬 스토리지에서 복원
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('adminDocsViewMode');
    if (saved === 'card' || saved === 'list') {
      setViewMode(saved);
    }
  }, []);
  // 변경 시 저장
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('adminDocsViewMode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    const q = selectedVendors.length ? `?vendors=${encodeURIComponent(selectedVendors.join(","))}` : "";
    router.replace(`/admin/docs${q}`);
  }, [selectedVendors, router]);

  return (
    <AdminLayout currentPage="docs">
      {/* Header */}
      <motion.div 
        className="mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <motion.h1 
              className="text-4xl font-bold bg-gradient-to-r from-white via-blue-100 to-blue-200 bg-clip-text text-transparent mb-2 text-enhanced"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              📄 문서 관리
            </motion.h1>
            <motion.p 
              className="text-secondary-enhanced text-lg"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              업로드 / URL 크롤링 / 벤더별 관리 / 처리 큐 / 메트릭
            </motion.p>
          </div>
        </div>
      </motion.div>

      {/* Vendor scope bar */}
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <VendorScopeBar selected={selectedVendors} onChange={setSelectedVendors} />
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Upload/Crawl + Queue panel */}
        <div className="space-y-6 xl:col-span-1">
          <UploadAndCrawlTabs vendors={selectedVendors} />
          <QueueMiniPanel vendors={selectedVendors} />
        </div>

          {/* Right: Document list */}
          <div className="xl:col-span-2 space-y-6">
            <DocsToolbar 
              vendors={selectedVendors} 
              onStatusFilterChange={setStatusFilter}
              onTypeFilterChange={setTypeFilter}
              statusFilter={statusFilter}
              typeFilter={typeFilter}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
            <DocsTable 
              vendors={selectedVendors} 
              statusFilter={statusFilter}
              typeFilter={typeFilter}
              viewMode={viewMode}
            />
          </div>
      </div>

      {/* Metrics summary */}
      <motion.div
        className="mt-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <MetricsSummary vendors={selectedVendors} />
      </motion.div>
    </AdminLayout>
  );
}

export default function AdminDocsPage() {
  return (
    <Suspense fallback={
      <AdminLayout currentPage="docs">
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      </AdminLayout>
    }>
      <AdminDocsPageContent />
    </Suspense>
  );
}

function VendorScopeBar({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };

  return (
    <Card className="card-enhanced">
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-secondary-enhanced mr-2 font-semibold">벤더 스코프</span>
          {ALL_VENDORS.map(v => (
            <button
              key={v}
              onClick={() => toggle(v)}
              className={`px-3 py-1.5 rounded-full text-sm border transition font-medium ${
                selected.includes(v) 
                  ? "bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-500/30" 
                  : "bg-transparent text-secondary-enhanced border-gray-600 hover:bg-white/10 hover:text-white"
              }`}
            >
              {v}
            </button>
          ))}
          <Separator orientation="vertical" className="mx-2 h-6 bg-gray-700" />
          <Badge variant="secondary" className="bg-blue-500/20 text-blue-300 border-blue-400/30 font-semibold">
            선택 {selected.length}개
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

type UploadStep = 
  | 'idle'
  | 'uploading'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'saving'
  | 'completed'
  | 'error';

function UploadAndCrawlTabs({ vendors }: { vendors: string[] }) {
  const [isUploading, setUploading] = useState(false);
  const [isCrawling, setCrawling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [uploadStep, setUploadStep] = useState<UploadStep>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = async (file?: File) => {
    try {
      const uploadFile = file || (fileInputRef.current?.files?.[0]);
      if (!uploadFile) return;
      
      setUploading(true);
      setUploadSuccess(false);
      setUploadError(null);
      setUploadStep('uploading');
      setUploadProgress(0);
      
      // 파일 크기 제한 설정 (최대 30MB)
      const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB
      const FILE_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB 이상은 큐로 처리
      
      // 파일 크기 초과 검증
      if (uploadFile.size > MAX_FILE_SIZE) {
        const fileSizeMB = (uploadFile.size / (1024 * 1024)).toFixed(2);
        const maxSizeMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
        toast.error('파일 크기 초과', {
          description: `파일 크기가 ${fileSizeMB}MB입니다. 최대 ${maxSizeMB}MB까지 업로드 가능합니다.`,
          duration: 5000,
        });
        setUploading(false);
        setUploadStep('idle');
        setUploadProgress(0);
        return;
      }
      
      // 큰 파일 경고 (20MB 이상)
      if (uploadFile.size > 20 * 1024 * 1024) {
        const fileSizeMB = (uploadFile.size / (1024 * 1024)).toFixed(2);
        toast.warning('큰 파일 감지', {
          description: `파일 크기가 ${fileSizeMB}MB입니다. 처리에 시간이 오래 걸릴 수 있습니다.`,
          duration: 5000,
        });
      }
      
      // 5MB 이상이면 Storage에 직접 업로드 후 큐 등록
      if (uploadFile.size > FILE_SIZE_LIMIT) {
        console.log('📋 대용량 파일 감지 - Storage에 직접 업로드 후 큐 등록:', {
          fileName: uploadFile.name,
          fileSize: uploadFile.size,
          fileSizeMB: (uploadFile.size / (1024 * 1024)).toFixed(2) + 'MB'
        });
        
        setUploadStep('uploading');
        setUploadProgress(10);
        
        // UI 벤더 이름을 DB 값으로 변환
        const dbVendor = convertVendorsToDB([vendors[0] || "Meta"])[0] || "META";
        const documentId = `doc_${Date.now()}`;
        
        // Storage에 직접 업로드
        const supabaseClient = createClient();
        const cleanFileName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
        const storagePath = `${documentId}/${Date.now()}_${cleanFileName}`;
        
        setUploadProgress(20);
        
        const { data: uploadData, error: uploadError } = await supabaseClient.storage
          .from('documents')
          .upload(storagePath, uploadFile, {
            contentType: uploadFile.type || 'application/octet-stream',
            upsert: true,
          });
        
        if (uploadError) {
          throw new Error(`Storage 업로드 실패: ${uploadError.message}`);
        }
        
        setUploadProgress(40);
        setUploadStep('saving');
        
        // 문서 레코드를 먼저 생성 (외래키 제약조건 해결)
        const documentType = uploadFile.type === 'application/pdf' ? 'pdf' : 
                             uploadFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ? 'docx' : 'txt';
        
        const { error: docError } = await supabaseClient
          .from('documents')
          .insert({
            id: documentId,
            title: cleanFileName,
            type: documentType,
            status: 'pending', // documents 테이블은 'pending', 'processing', 'indexed', 'completed', 'failed', 'error'만 허용
            chunk_count: 0,
            file_size: uploadFile.size,
            file_type: uploadFile.type,
            source_vendor: dbVendor,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        
        if (docError) {
          throw new Error(`문서 레코드 생성 실패: ${docError.message}`);
        }
        
        setUploadProgress(50);
        console.log('✅ 문서 레코드 생성 완료:', documentId);
        
        // 큐에 처리 작업 등록 (문서 레코드가 존재하므로 외래키 제약조건 통과)
        const jobType = uploadFile.type === 'application/pdf' 
          ? 'PDF_PARSE' 
          : uploadFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          ? 'DOCX_PARSE'
          : 'PDF_PARSE'; // 기본값
        
        const { data: jobData, error: jobError } = await supabaseClient
          .from('processing_jobs')
          .insert({
            document_id: documentId,
            job_type: jobType,
            status: 'queued',
            priority: 7,
            payload: {
              fileName: cleanFileName,
              fileSize: uploadFile.size,
              fileType: uploadFile.type,
              storage: {
                bucket: 'documents',
                path: storagePath,
                contentType: uploadFile.type,
                size: uploadFile.size,
              },
              vendor: dbVendor,
            },
            scheduled_at: new Date().toISOString(),
            max_attempts: 3,
          })
          .select()
          .single();
        
        if (jobError) {
          throw new Error(`큐 등록 실패: ${jobError.message}`);
        }
        
        setUploadProgress(60);
        console.log('✅ Storage 업로드 및 큐 등록 완료:', { jobId: jobData.id, documentId });
        
        setUploadProgress(85);
        
        // 큐 상태 폴링 시작
        const pollQueueStatus = async (jobId: string, documentId: string) => {
          const maxAttempts = 120; // 최대 10분 (5초 간격) - 큰 파일 처리 대응
          let attempts = 0;
          
          const poll = async () => {
            try {
              attempts++;
              const { data: job, error } = await supabaseClient
                .from('processing_jobs')
                .select('status, error, attempts')
                .eq('id', jobId)
                .single();
              
              if (error) {
                console.error('큐 상태 조회 오류:', error);
                if (attempts >= maxAttempts) {
                  throw new Error('큐 상태 확인 시간 초과');
                }
                setTimeout(poll, 5000);
                return;
              }
              
              console.log(`📊 큐 상태 (${attempts}/${maxAttempts}):`, job);
              
              if (job.status === 'queued') {
                setUploadStep('saving');
                setUploadProgress(85 + (attempts / maxAttempts) * 10); // 85-95%
              } else if (job.status === 'processing') {
                setUploadStep('saving');
                setUploadProgress(95 + (attempts / maxAttempts) * 3); // 95-98%
              } else if (job.status === 'completed') {
                setUploadStep('completed');
                setUploadProgress(100);
                setUploadSuccess(true);
                setSelectedFileName(null);
                console.log('✅ 큐 처리 완료');
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('docs-refresh'));
                }
                setTimeout(() => {
                  setUploadSuccess(false);
                  setUploadStep('idle');
                  setUploadProgress(0);
                }, 3000);
                return;
              } else if (job.status === 'failed') {
                throw new Error(job.error || '큐 처리 실패');
              }
              
              if (attempts < maxAttempts) {
                setTimeout(poll, 5000);
              } else {
                // 타임아웃 전에 실제 작업 상태를 한 번 더 확인
                console.warn('⚠️ 클라이언트 폴링 타임아웃 - 실제 작업 상태 최종 확인 중...');
                const { data: finalJob, error: finalError } = await supabaseClient
                  .from('processing_jobs')
                  .select('status, error, result')
                  .eq('id', jobId)
                  .single();
                
                if (!finalError && finalJob) {
                  // 실제로 완료되었을 수 있음
                  if (finalJob.status === 'completed') {
                    console.log('✅ 실제로는 이미 완료되었습니다!');
                    setUploadStep('completed');
                    setUploadProgress(100);
                    setUploadSuccess(true);
                    setSelectedFileName(null);
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('docs-refresh'));
                    }
                    setTimeout(() => {
                      setUploadSuccess(false);
                      setUploadStep('idle');
                      setUploadProgress(0);
                    }, 3000);
                    return;
                  }
                  
                  // 이미 실패했을 수도 있음
                  if (finalJob.status === 'failed') {
                    throw new Error(finalJob.error || '큐 처리 실패');
                  }
                }
                
                // 실제로도 처리 중이면 타임아웃 처리
                console.warn('⚠️ 큐 처리 시간 초과 - 작업을 failed 상태로 업데이트합니다');
                try {
                  await supabaseClient
                    .from('processing_jobs')
                    .update({ 
                      status: 'failed', 
                      error: '큐 처리 시간 초과 (10분)',
                      finished_at: new Date().toISOString()
                    })
                    .eq('id', jobId)
                    .in('status', ['queued', 'processing']);
                  
                  await supabaseClient
                    .from('documents')
                    .update({ 
                      status: 'failed',
                      updated_at: new Date().toISOString()
                    })
                    .eq('id', documentId);
                } catch (updateError) {
                  console.error('큐 상태 업데이트 실패:', updateError);
                }
                throw new Error('큐 처리 시간 초과 (10분)');
              }
            } catch (error) {
              console.error('폴링 오류:', error);
              setUploadStep('error');
              setUploadError(error instanceof Error ? error.message : String(error));
              setUploadProgress(0);
              setUploading(false);
            }
          };
          poll();
        };
        
        pollQueueStatus(jobData.id, documentId);
        return;
      }
      
      // 5MB 이하 파일은 기존 방식대로 API로 전송
      // 시뮬레이션된 진행 단계 (실제 API 호출 전)
      const simulateProgress = () => {
        const steps: { step: UploadStep; progress: number; delay: number }[] = [
          { step: 'uploading', progress: 10, delay: 300 },
          { step: 'extracting', progress: 30, delay: 500 },
          { step: 'chunking', progress: 50, delay: 800 },
          { step: 'embedding', progress: 70, delay: 1000 },
          { step: 'saving', progress: 90, delay: 500 },
        ];
        
        let currentIndex = 0;
        const processSteps = () => {
          if (currentIndex < steps.length) {
            const { step, progress, delay } = steps[currentIndex];
            setUploadStep(step);
            setUploadProgress(progress);
            currentIndex++;
            setTimeout(processSteps, delay);
          }
        };
        processSteps();
      };
      
      simulateProgress();
      
      const form = new FormData();
      form.append("file", uploadFile);
      // UI 벤더 이름을 DB 값으로 변환
      const dbVendor = convertVendorsToDB([vendors[0] || "Meta"])[0] || "META";
      form.append("vendor", dbVendor);
      
      const res = await fetch("/api/admin/upload-new", { method: "POST", body: form });
      
      // 응답 본문을 먼저 텍스트로 읽기 (한 번만 읽을 수 있음)
      const responseText = await res.text();
      
      // 응답이 JSON인지 확인
      const contentType = res.headers.get('content-type');
      const isJson = contentType?.includes('application/json');
      
      let result: any;
      if (isJson) {
        try {
          result = JSON.parse(responseText);
        } catch (jsonError) {
          // JSON 파싱 실패
          console.error('JSON 파싱 오류:', jsonError, '응답:', responseText.substring(0, 200));
          throw new Error(`서버 응답 파싱 오류: ${responseText.substring(0, 100)}`);
        }
      } else {
        // JSON이 아닌 경우
        if (!res.ok) {
          throw new Error(responseText || `HTTP ${res.status} ${res.statusText}`);
        }
        // 성공 응답이지만 JSON이 아닌 경우
        result = { success: true, message: responseText };
      }
      
      if (!res.ok) {
        throw new Error(result.error || result.message || responseText || `HTTP ${res.status}: ${res.statusText}`);
      }
      
      // 큐에 등록된 경우 (202 Accepted)
      if (res.status === 202 && result.queued) {
        console.log('📋 큐에 등록됨:', result);
        setUploadStep('saving');
        setUploadProgress(85);
        
        // 큐 상태 폴링
        const pollQueueStatus = async (jobId: string, documentId: string) => {
          const maxAttempts = 120; // 최대 10분 (5초 간격) - 큰 파일 처리 대응
          let attempts = 0;
          
          const poll = async () => {
            try {
              attempts++;
              
              // processing_jobs 테이블에서 상태 확인
              const supabaseClient = createClient();
              const { data: job, error } = await supabaseClient
                .from('processing_jobs')
                .select('status, error, attempts')
                .eq('id', jobId)
                .single();
              
              if (error) {
                console.error('큐 상태 조회 오류:', error);
                if (attempts >= maxAttempts) {
                  throw new Error('큐 상태 확인 시간 초과');
                }
                setTimeout(poll, 5000);
                return;
              }
              
              console.log(`📊 큐 상태 (${attempts}/${maxAttempts}):`, job);
              
              // 상태 업데이트
              if (job.status === 'queued') {
                setUploadStep('saving');
                setUploadProgress(90 + (attempts / maxAttempts) * 5); // 90-95%
              } else if (job.status === 'processing') {
                setUploadStep('saving');
                setUploadProgress(95 + (attempts / maxAttempts) * 3); // 95-98%
              } else if (job.status === 'completed') {
                setUploadStep('completed');
                setUploadProgress(100);
                setUploadSuccess(true);
                setSelectedFileName(null);
                console.log('✅ 큐 처리 완료');
                
                // 문서 목록 새로고침
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('docs-refresh'));
                }
                
                // 3초 후 상태 초기화
                setTimeout(() => {
                  setUploadSuccess(false);
                  setUploadStep('idle');
                  setUploadProgress(0);
                }, 3000);
                return;
              } else if (job.status === 'failed') {
                throw new Error(job.error || '큐 처리 실패');
              }
              
              // 계속 폴링
              if (attempts < maxAttempts) {
                setTimeout(poll, 5000); // 5초마다 확인
              } else {
                // 타임아웃 전에 실제 작업 상태를 한 번 더 확인
                console.warn('⚠️ 클라이언트 폴링 타임아웃 - 실제 작업 상태 최종 확인 중...');
                const { data: finalJob, error: finalError } = await supabaseClient
                  .from('processing_jobs')
                  .select('status, error, result')
                  .eq('id', jobId)
                  .single();
                
                if (!finalError && finalJob) {
                  // 실제로 완료되었을 수 있음
                  if (finalJob.status === 'completed') {
                    console.log('✅ 실제로는 이미 완료되었습니다!');
                    setUploadStep('completed');
                    setUploadProgress(100);
                    setUploadSuccess(true);
                    setSelectedFileName(null);
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('docs-refresh'));
                    }
                    setTimeout(() => {
                      setUploadSuccess(false);
                      setUploadStep('idle');
                      setUploadProgress(0);
                    }, 3000);
                    return;
                  }
                  
                  // 이미 실패했을 수도 있음
                  if (finalJob.status === 'failed') {
                    throw new Error(finalJob.error || '큐 처리 실패');
                  }
                }
                
                // 실제로도 처리 중이면 타임아웃 처리
                console.warn('⚠️ 큐 처리 시간 초과 - 작업을 failed 상태로 업데이트합니다');
                try {
                  await supabaseClient
                    .from('processing_jobs')
                    .update({ 
                      status: 'failed', 
                      error: '큐 처리 시간 초과 (10분)',
                      finished_at: new Date().toISOString()
                    })
                    .eq('id', jobId)
                    .in('status', ['queued', 'processing']);
                  
                  // 문서 상태도 failed로 업데이트
                  await supabaseClient
                    .from('documents')
                    .update({ 
                      status: 'failed',
                      updated_at: new Date().toISOString()
                    })
                    .eq('id', documentId);
                } catch (updateError) {
                  console.error('큐 상태 업데이트 실패:', updateError);
                }
                throw new Error('큐 처리 시간 초과 (10분)');
              }
            } catch (error) {
              console.error('폴링 오류:', error);
              setUploadStep('error');
              setUploadError(error instanceof Error ? error.message : String(error));
              setUploadProgress(0);
              setUploading(false);
            }
          };
          
          poll();
        };
        
        if (result.jobId && result.documentId) {
          pollQueueStatus(result.jobId, result.documentId);
        } else {
          // jobId가 없으면 일반 완료로 처리
          setUploadStep('completed');
          setUploadProgress(100);
        }
        return;
      }
      
      // 즉시 처리 완료
      setUploadStep('completed');
      setUploadProgress(100);
      setUploadSuccess(true);
      setSelectedFileName(null);
      console.log('✅ 업로드 성공:', result);
      
      // 파일 입력 초기화
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
      // 문서 목록 새로고침 트리거 (전역 이벤트)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('docs-refresh'));
      }
      
      // 3초 후 성공 메시지 및 진행 상태 숨김
      setTimeout(() => {
        setUploadSuccess(false);
        setUploadStep('idle');
        setUploadProgress(0);
      }, 3000);
    } catch (e) {
      console.error("upload error", e);
      setUploadStep('error');
      const errorMessage = e instanceof Error ? e.message : String(e);
      setUploadError(errorMessage);
      setUploadProgress(0);
      
      // toast 알림 사용 (alert 대신)
      toast.error('파일 업로드 실패', {
        description: errorMessage,
        duration: 5000,
      });
    } finally {
      setUploading(false);
    }
  };

  // 드래그 앤 드롭 핸들러
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFileName(file.name);
      handleUpload(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFileName(e.target.files[0].name);
    }
  };

  const handleCrawl = async () => {
    try {
      setCrawling(true);
      const url = (document.getElementById("seed-url-input") as HTMLInputElement | null)?.value?.trim();
      if (!url) return;
      // UI 벤더 배열을 DB 값 배열로 변환
      const dbVendors = convertVendorsToDB(vendors);
      // 간단 큐 등록: jobType CRAWL_SEED
      await fetch("/api/jobs/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobType: "CRAWL_SEED",
          priority: 5,
          payload: { url, vendors: dbVendors },
        }),
      });
    } catch (e) {
      console.error("crawl enqueue error", e);
    } finally {
      setCrawling(false);
    }
  };

  return (
    <Tabs defaultValue="upload" className="w-full">
      <TabsList className="grid grid-cols-2 w-full bg-gray-800/50 border-gray-700">
        <TabsTrigger 
          value="upload" 
          className="flex items-center space-x-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
        >
          <Upload className="w-4 h-4" />
          <span>파일 업로드</span>
        </TabsTrigger>
        <TabsTrigger 
          value="crawl" 
          className="flex items-center space-x-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
        >
          <Globe className="w-4 h-4" />
          <span>URL 크롤링</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="upload">
        <Card className="card-enhanced">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary-enhanced">
              <Upload className="w-5 h-5" />
              파일 업로드
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-secondary-enhanced font-semibold">
              선택 벤더: <span className="text-blue-300">{vendors.join(", ") || "(없음)"}</span>
            </div>
            
            {/* 드래그 앤 드롭 영역 */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`
                relative border-2 border-dashed rounded-lg p-6 transition-all duration-200
                ${dragActive 
                  ? 'border-blue-500 bg-blue-500/10' 
                  : 'border-gray-600 bg-gray-800/30 hover:border-gray-500 hover:bg-gray-800/50'
                }
                ${isUploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}
              `}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <Upload className={`w-8 h-8 ${dragActive ? 'text-blue-400' : 'text-gray-400'}`} />
                <div>
                  <p className="text-sm text-primary-enhanced font-semibold">
                    파일을 드래그하여 놓거나 클릭하여 선택하세요
                  </p>
                  <p className="text-xs text-muted-enhanced mt-1">
                    PDF, DOCX, TXT 파일 지원
                  </p>
                </div>
                {selectedFileName && (
                  <p className="text-xs text-blue-300 font-medium mt-1">
                    선택된 파일: {selectedFileName}
                  </p>
                )}
              </div>
              
              {/* 숨겨진 파일 입력 */}
              <input 
                ref={fileInputRef} 
                type="file" 
                onChange={handleFileChange}
                accept=".pdf,.docx,.txt"
                className="hidden"
              />
            </div>
            
            <div className="flex items-center gap-3">
              <Button 
                disabled={isUploading || !selectedFileName} 
                onClick={() => handleUpload()}
                className="btn-enhanced flex-1"
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />} 
                업로드
              </Button>
            </div>
            
            {/* 업로드 진행 상태 표시 */}
            {uploadStep !== 'idle' && (
              <div className="mt-4 space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-secondary-enhanced font-semibold">
                      {uploadStep === 'uploading' && '📤 파일 업로드 중...'}
                      {uploadStep === 'extracting' && '📄 텍스트 추출 중...'}
                      {uploadStep === 'chunking' && '✂️ 문서 청킹 중...'}
                      {uploadStep === 'embedding' && '🔮 임베딩 생성 중...'}
                      {uploadStep === 'saving' && '⏳ 큐에서 처리 중...'}
                      {uploadStep === 'completed' && '✅ 처리 완료!'}
                      {uploadStep === 'error' && '❌ 처리 실패'}
                    </span>
                    <span className="text-muted-enhanced">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-300 rounded-full ${
                        uploadStep === 'completed' 
                          ? 'bg-green-500' 
                          : uploadStep === 'error'
                          ? 'bg-red-500'
                          : 'bg-blue-500'
                      }`}
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
                
                {/* 단계별 상세 정보 */}
                {uploadStep !== 'completed' && uploadStep !== 'error' && (
                  <div className="flex items-center gap-2 text-xs text-muted-enhanced">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>
                      {uploadStep === 'uploading' && '서버로 파일 전송 중...'}
                      {uploadStep === 'extracting' && 'PDF/DOCX에서 텍스트 추출 중...'}
                      {uploadStep === 'chunking' && '문서를 의미 단위로 분할 중...'}
                      {uploadStep === 'embedding' && '벡터 임베딩 생성 중...'}
                      {uploadStep === 'saving' && '큐에서 처리 중입니다. 잠시만 기다려주세요...'}
                    </span>
                  </div>
                )}
                
                {/* 에러 메시지 */}
                {uploadStep === 'error' && uploadError && (
                  <div className="p-2 bg-red-500/20 border border-red-400/30 rounded-md">
                    <p className="text-xs text-red-300">{uploadError}</p>
                  </div>
                )}
              </div>
            )}
            
            <p className="text-xs text-muted-enhanced">10MB 이상 PDF/DOCX는 자동으로 큐로 오프로딩됩니다.</p>
            {uploadSuccess && (
              <div className="mt-2 p-2 bg-green-500/20 border border-green-400/30 rounded-md">
                <p className="text-xs text-green-300 font-semibold flex items-center gap-2">
                  <CheckCircle className="w-3 h-3" />
                  파일 업로드 및 처리 완료! 문서 목록이 자동으로 새로고침됩니다.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="crawl">
        <Card className="card-enhanced">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary-enhanced">
              <Globe className="w-5 h-5" />
              URL 크롤링
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-secondary-enhanced font-semibold">
              선택 벤더: <span className="text-blue-300">{vendors.join(", ") || "(없음)"}</span>
            </div>
            <Input 
              id="seed-url-input" 
              placeholder="Seed URL을 입력하세요 (예: https://example.com/policy)" 
              className="bg-gray-800/50 border-gray-600 text-white placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400/20"
            />
            {/* 그리드 헤더 형태 */}
            <div className="hidden sm:grid grid-cols-3 gap-3 px-1 mb-1 text-center">
              <div className="text-[11px] text-secondary-enhanced font-semibold">도메인 한정</div>
              <div className="text-[11px] text-secondary-enhanced font-semibold">robots.txt 준수</div>
              <div className="text-[11px] text-secondary-enhanced font-semibold">최대 심도</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="border border-gray-600 rounded-md px-3 py-4 bg-gray-800/30 flex flex-col items-center justify-center min-h-[64px]">
                <Switch defaultChecked />
              </div>
              <div className="border border-gray-600 rounded-md px-3 py-4 bg-gray-800/30 flex flex-col items-center justify-center min-h-[64px]">
                <Switch defaultChecked />
              </div>
              <div className="border border-gray-600 rounded-md px-3 py-4 bg-gray-800/30 flex flex-col items-center justify-center min-h-[64px]">
                <Select defaultValue="2">
                  <SelectTrigger className="w-24 bg-gray-700 border-gray-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button 
                disabled={isCrawling} 
                onClick={handleCrawl}
                className="btn-enhanced"
              >
                {isCrawling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Globe className="w-4 h-4 mr-2" />} 
                크롤 시작
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className="bg-blue-500/20 text-blue-300 border-blue-400/30">
                      미리보기 0건
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>발견된 링크 미리보기는 크롤 후 표시됩니다.</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function DocsToolbar({ 
  vendors, 
  statusFilter, 
  typeFilter, 
  onStatusFilterChange, 
  onTypeFilterChange,
  viewMode,
  onViewModeChange
}: { 
  vendors: string[];
  statusFilter: string;
  typeFilter: string;
  onStatusFilterChange: (value: string) => void;
  onTypeFilterChange: (value: string) => void;
  viewMode: "card" | "list";
  onViewModeChange: (v: "card" | "list") => void;
}) {
  return (
    <Card className="card-enhanced">
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input 
              className="pl-9 bg-gray-800/50 border-gray-600 text-white placeholder-gray-400 focus:border-blue-400 focus:ring-blue-400/20" 
              placeholder="제목, URL, 메타데이터 검색" 
            />
          </div>
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-36 bg-gray-800/50 border-gray-600 text-white">
              <SelectValue placeholder="상태" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="indexed">indexed</SelectItem>
              <SelectItem value="processing">processing</SelectItem>
              <SelectItem value="failed">failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={onTypeFilterChange}>
            <SelectTrigger className="w-32 bg-gray-800/50 border-gray-600 text-white">
              <SelectValue placeholder="유형" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">모두</SelectItem>
              <SelectItem value="pdf">pdf</SelectItem>
              <SelectItem value="docx">docx</SelectItem>
              <SelectItem value="txt">txt</SelectItem>
              <SelectItem value="url">url</SelectItem>
            </SelectContent>
          </Select>
          <Select value={viewMode} onValueChange={(v) => onViewModeChange(v as any)}>
            <SelectTrigger className="w-32 bg-gray-800/50 border-gray-600 text-white">
              <SelectValue placeholder="보기" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="card">카드</SelectItem>
              <SelectItem value="list">리스트</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <Button 
              variant="secondary" 
              className="bg-gray-700/50 border-gray-600 text-secondary-enhanced hover:bg-gray-700 hover:text-white"
            >
              <RefreshCw className="w-4 h-4 mr-1" /> 
              새로고침
            </Button>
            <Button 
              variant="secondary" 
              className="bg-gray-700/50 border-gray-600 text-secondary-enhanced hover:bg-gray-700 hover:text-white"
              onClick={() => {
                // 내보내기: 전역 이벤트로 전달 → DocsTable에서 처리
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('docs-export'));
                }
              }}
            >
              <Download className="w-4 h-4 mr-1" /> 
              내보내기
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DocsTable({ 
  vendors, 
  statusFilter, 
  typeFilter,
  viewMode
}: { 
  vendors: string[];
  statusFilter: string;
  typeFilter: string;
  viewMode: "card" | "list";
}) {
  const supabase = useMemo(() => createClient(), []);
  
  // 큐 처리 중인 문서 ID 목록 조회
  const { data: queuedDocumentIds } = useQuery({
    queryKey: ["queued-documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("document_id")
        .in("status", ["queued", "processing"]);
      
      if (error) {
        console.error('큐 문서 조회 오류:', error);
        return [];
      }
      
      return (data || []).map(job => job.document_id);
    },
    refetchInterval: 5000, // 5초마다 큐 상태 확인
  });
  
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-docs", vendors, statusFilter, typeFilter],
    queryFn: async () => {
      let q = supabase.from("documents").select("id,title,type,status,updated_at,chunk_count,source_vendor,url").order("updated_at", { ascending: false }).limit(60);
      
      // 벤더 필터
      if (vendors.length) {
        const dbVendors = convertVendorsToDB(vendors);
        q = q.in("source_vendor", dbVendors);
      }
      
      // 상태 필터
      if (statusFilter && statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }
      
      // 유형 필터 (url은 서버 필터, pdf/docx/txt는 클라이언트에서 파일명 확장자로 필터링)
      if (typeFilter && typeFilter !== "all" && typeFilter === "url") {
        q = q.eq("type", "url");
      }
      
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 10000,
  });

  // 문서 유형 추출 및 표시 유틸 - 필터링보다 위에서 선언 (TDZ 방지)
  const getDocumentFileType = (row: any): string => {
    if (row.type === 'url') return 'url';
    const title = row.title || row.id || '';
    const parts = title.toLowerCase().split('.');
    const ext = parts.length > 1 ? parts[parts.length - 1].trim() : '';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'docx' || ext === 'doc') return 'docx';
    if (ext === 'txt' || ext === 'text') return 'txt';
    return 'file';
  };

  const getTypeIcon = (fileType: string) => {
    switch (fileType?.toLowerCase()) {
      case 'pdf':
        return <FileText className="w-3 h-3" />;
      case 'docx':
        return <File className="w-3 h-3" />;
      case 'txt':
        return <FileText className="w-3 h-3" />;
      case 'url':
        return <Globe className="w-3 h-3" />;
      case 'file':
      default:
        return <FileText className="w-3 h-3" />;
    }
  };

  const getTypeBadgeStyle = (fileType: string) => {
    switch (fileType?.toLowerCase()) {
      case 'pdf':
        return 'bg-red-500/20 text-red-300 border-red-400/30';
      case 'docx':
        return 'bg-blue-500/20 text-blue-300 border-blue-400/30';
      case 'txt':
        return 'bg-gray-500/20 text-gray-300 border-gray-400/30';
      case 'url':
        return 'bg-green-500/20 text-green-300 border-green-400/30';
      case 'file':
      default:
        return 'bg-gray-500/20 text-gray-300 border-gray-400/30';
    }
  };

  const getTypeDisplayName = (fileType: string) => {
    const t = fileType?.toLowerCase();
    if (t === 'url') return 'URL';
    return t?.toUpperCase() || 'FILE';
  };

  // 클라이언트 측 유형 필터링 (pdf/docx/txt) + 큐 처리 중 문서 제외
  const filteredData = useMemo(() => {
    let rows = data || [];
    
    // 유형 필터
    if (typeFilter && typeFilter !== "all" && typeFilter !== "url") {
      rows = rows.filter((row: any) => getDocumentFileType(row) === typeFilter);
    }
    
    // 큐 처리 중인 문서 제외 (chunk_count가 0이고 큐에 등록된 문서)
    const queuedIds = new Set(queuedDocumentIds || []);
    rows = rows.filter((row: any) => {
      const isQueued = queuedIds.has(row.id);
      const hasNoChunks = (row.chunk_count || 0) === 0;
      const isProcessing = row.status === 'processing';
      
      // 큐 처리 중이거나 처리 중 상태인데 청크가 없는 경우 제외
      if (isQueued && hasNoChunks) {
        return false; // 큐 처리 중 문서는 목록에서 제외
      }
      
      // processing 상태이지만 청크가 있고 큐에 없는 경우는 정상 문서로 표시
      return true;
    });
    
    return rows;
  }, [data, typeFilter, queuedDocumentIds]);

  // 필터된 목록의 총 청크 수
  const totalChunks = useMemo(() => {
    return (filteredData || []).reduce((sum: number, row: any) => sum + (row?.chunk_count ?? 0), 0);
  }, [filteredData]);

  // CSV 내보내기 헬퍼
  const exportRowsToCSV = (rows: any[]) => {
    const headers = [
      'id','title','file_type','type','source_vendor','status','chunk_count','updated_at'
    ];
    const csv = [
      headers.join(','),
      ...rows.map((r) => {
        const fileType = getDocumentFileType(r);
        const values = [
          r.id,
          (r.title || '').replaceAll('"','""'),
          fileType,
          r.type,
          r.source_vendor || '',
          r.status,
          String(r.chunk_count ?? 0),
          r.updated_at ? new Date(r.updated_at).toISOString() : ''
        ];
        return values.map(v => `"${String(v ?? '')}"`).join(',');
      })
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `documents_export_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Toolbar에서 발생시키는 전역 이벤트 수신 → 현재 필터 결과를 CSV로 내보내기
  useEffect(() => {
    const handler = () => exportRowsToCSV(filteredData);
    if (typeof window !== 'undefined') {
      window.addEventListener('docs-export', handler as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('docs-export', handler as EventListener);
      }
    };
  }, [filteredData]);

  // 업로드 성공 후 문서 목록 새로고침 이벤트 수신
  useEffect(() => {
    const handler = () => {
      console.log('🔄 문서 목록 새로고침 트리거됨');
      refetch();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('docs-refresh', handler as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('docs-refresh', handler as EventListener);
      }
    };
  }, [refetch]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<any | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // 정렬된 데이터
  const sortedData = useMemo(() => {
    if (!sortColumn || !filteredData) return filteredData;
    const sorted = [...filteredData];
    sorted.sort((a, b) => {
      let aVal: any;
      let bVal: any;
      
      switch (sortColumn) {
        case "title":
          aVal = (a.title || a.id || "").toLowerCase();
          bVal = (b.title || b.id || "").toLowerCase();
          break;
        case "type":
          aVal = getDocumentFileType(a).toLowerCase();
          bVal = getDocumentFileType(b).toLowerCase();
          break;
        case "status":
          aVal = (a.status || "").toLowerCase();
          bVal = (b.status || "").toLowerCase();
          break;
        case "updated_at":
          aVal = new Date(a.updated_at || 0).getTime();
          bVal = new Date(b.updated_at || 0).getTime();
          break;
        default:
          return 0;
      }
      
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredData, sortColumn, sortDirection]);

  // 정렬 토글 핸들러
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // 정렬 아이콘 렌더링
  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
    }
    return sortDirection === "asc" 
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const selectedIds = useMemo(() => Object.keys(selected).filter(k => selected[k]), [selected]);
  // 선택된 문서의 총 청크 수 (selected 선언 이후 계산)
  const selectedChunks = useMemo(() => {
    if (!filteredData) return 0;
    return filteredData.reduce((sum: number, row: any) => sum + (selected[row.id] ? (row?.chunk_count ?? 0) : 0), 0);
  }, [filteredData, selected]);
  const allSelected = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return false;
    return filteredData.every((row: any) => selected[row.id]);
  }, [filteredData, selected]);
  const someSelected = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return false;
    return filteredData.some((row: any) => selected[row.id]) && !allSelected;
  }, [filteredData, selected, allSelected]);

  const toggleSelect = (id: string) => setSelected(prev => ({ ...prev, [id]: !prev[id] }));

  const toggleSelectAll = () => {
    if (!filteredData) return;
    if (allSelected) {
      setSelected({});
        } else {
      const newSelected: Record<string, boolean> = {};
      filteredData.forEach((row: any) => {
        newSelected[row.id] = true;
      });
      setSelected(newSelected);
    }
  };

  const handleBulkReprocess = async () => {
    if (!selectedIds.length) {
      toast.info('문서를 선택해주세요', { duration: 3000 });
      return;
    }
    
    try {
      // 각 문서 정보 가져오기
      const { data: docs, error: docsError } = await supabase
        .from('documents')
        .select('id, file_type, type, title, source_vendor')
        .in('id', selectedIds);
      
      if (docsError || !docs || docs.length === 0) {
        toast.error('문서 정보 조회 실패', {
          description: docsError?.message || '선택한 문서를 찾을 수 없습니다.',
          duration: 5000,
        });
        return;
      }
      
      // 각 문서에 대해 재처리 작업 등록
      const results = await Promise.allSettled(
        docs.map(async (doc) => {
          // 파일 타입에 따라 적절한 jobType 결정
          let jobType: 'PDF_PARSE' | 'DOCX_PARSE' = 'PDF_PARSE';
          if (doc.file_type?.includes('docx') || doc.type === 'docx') {
            jobType = 'DOCX_PARSE';
          }
          
          // 기존 청크 삭제
          await supabase
            .from('document_chunks')
            .delete()
            .eq('document_id', doc.id);
          
          // 문서 상태를 pending으로 변경
          await supabase
            .from('documents')
            .update({ 
              status: 'pending',
              chunk_count: 0,
              updated_at: new Date().toISOString()
            })
            .eq('id', doc.id);
          
          // 큐에 재처리 작업 등록
          const res = await fetch('/api/jobs/enqueue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              documentId: doc.id,
              jobType,
              priority: 7,
              payload: {
                fileName: doc.title,
                vendor: doc.source_vendor || 'META',
                reprocess: true
              }
            })
          });
          
          return await res.json();
        })
      );
      
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      const failCount = results.length - successCount;
      
      if (successCount > 0) {
        toast.success('재처리 시작', {
          description: `${successCount}개 문서가 큐에 등록되었습니다.`,
          duration: 3000,
        });
      }
      
      if (failCount > 0) {
        toast.warning('일부 재처리 실패', {
          description: `${failCount}개 문서의 재처리 등록에 실패했습니다.`,
          duration: 5000,
        });
      }
      
      // 문서 목록 새로고침
      refetch();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('docs-refresh'));
      }
    } catch (error) {
      console.error('일괄 재처리 오류:', error);
      toast.error('일괄 재처리 오류', {
        description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
        duration: 5000,
      });
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    setShowDeleteConfirm(true);
  };

  const confirmBulkDelete = async () => {
    if (!selectedIds.length) return;
    
    setDeleting(true);
    try {
      // 삭제 전 청크 개수 확인
      const { count: chunkCount } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .in('document_id', selectedIds);
      const documentCount = selectedIds.length;

      // 문서 및 관련 청크 삭제
      const { error: chunksError } = await supabase
        .from('document_chunks')
        .delete()
        .in('document_id', selectedIds);

      if (chunksError) {
        console.warn('청크 삭제 오류:', chunksError);
      }

      const { error: docError } = await supabase
        .from('documents')
        .delete()
        .in('id', selectedIds);

      if (docError) {
        throw new Error(docError.message);
      }

      setSelected({});
      setShowDeleteConfirm(false);
      
      // 성공 알림
      toast.success('문서 삭제 완료', {
        description: `${documentCount}개 문서와 ${chunkCount}개 청크가 삭제되었습니다.`,
        duration: 3000,
      });
      
      refetch();
    } catch (error) {
      console.error('문서 삭제 오류:', error);
      toast.error('문서 삭제 실패', {
        description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
        duration: 5000,
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
    <Card className="card-enhanced overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary-enhanced">
          <FileText className="w-5 h-5" />
          문서 목록
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Checkbox 
              checked={allSelected}
              indeterminate={someSelected}
              onCheckedChange={toggleSelectAll}
            />
            <div className="text-sm text-secondary-enhanced font-semibold flex items-center gap-2 flex-wrap">
              <span>
                총 {filteredData.length}
              </span>
              <span className="opacity-70">/</span>
              <span>
                선택 {selectedIds.length}
              </span>
              <span className="mx-2">•</span>
              <span>
                총 청크 {totalChunks}
              </span>
              <span className="opacity-70">/</span>
              <span>
                선택 청크 {selectedChunks}
              </span>
            </div>
            {selectedIds.length > 0 && (
              <Badge className="bg-blue-500/20 text-blue-300 border-blue-400/30 font-semibold">
                선택 {selectedIds.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <div className="flex items-center gap-2 mr-2">
                <Button 
                  variant="secondary" 
                  className="bg-blue-600/20 border-blue-500/30 text-blue-300 hover:bg-blue-600/30 hover:text-blue-200" 
                  onClick={handleBulkReprocess}
                >
                  재처리
                </Button>
                <Button 
                  variant="destructive" 
                  className="bg-red-600/20 border-red-500/30 text-red-300 hover:bg-red-600/30 hover:text-red-200"
                  onClick={handleBulkDelete}
                >
                  삭제
                </Button>
              </div>
            )}
            <Button 
              variant="secondary" 
              className="bg-gray-700/50 border-gray-600 text-secondary-enhanced hover:bg-gray-700 hover:text-white" 
              onClick={() => refetch()}
            >
              <RefreshCw className="w-4 h-4 mr-1" /> 
              새로고침
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-enhanced">불러오는 중...</div>
        ) : (
          <>
            {viewMode === 'card' ? (
              <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(filteredData || []).map((row: any) => (
                  <div 
                    key={row.id} 
                    className="border border-gray-600 rounded-xl p-4 bg-gray-800/30 hover:bg-gray-800/50 transition-all cursor-pointer hover:border-blue-500/30 hover:shadow-lg"
                    onClick={() => setDetail(row)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Checkbox 
                          checked={!!selected[row.id]} 
                          onCheckedChange={() => toggleSelect(row.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-shrink-0"
                        />
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetail(row);
                          }} 
                          className="text-left min-w-0 flex-1"
                        >
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-primary-enhanced font-semibold line-clamp-1">
                                  {row.title || row.id}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="max-w-[480px] whitespace-pre-wrap break-words text-sm">
                                  {row.title || row.id}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </button>
                      </div>
                      <Badge className={`${
                        row.status === 'indexed' 
                          ? 'bg-green-500/20 text-green-300 border-green-400/30'
                          : row.status === 'processing'
                          ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30'
                          : row.status === 'failed'
                          ? 'bg-red-500/20 text-red-300 border-red-400/30'
                          : 'bg-gray-500/20 text-gray-300 border-gray-400/30'
                      } font-semibold`}>
                        {row.status}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-secondary-enhanced flex items-center gap-2 flex-wrap">
                      <Badge className={`${getTypeBadgeStyle(getDocumentFileType(row))} font-semibold text-[10px] px-2 py-0.5 flex items-center gap-1`}>
                        {getTypeIcon(getDocumentFileType(row))}
                        {getTypeDisplayName(getDocumentFileType(row))}
                      </Badge>
                      <span>•</span>
                      <span>{row.source_vendor ? (DB_TO_VENDOR_MAP[row.source_vendor] || row.source_vendor) : "-"}</span>
                      <span>•</span>
                      <span>chunks {row.chunk_count ?? 0}</span>
                      {/* 큐 처리 중 표시 */}
                      {(queuedDocumentIds || []).includes(row.id) && (row.chunk_count || 0) === 0 && (
                        <>
                          <span>•</span>
                          <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-400/30 font-semibold text-[10px] px-2 py-0.5">
                            큐 처리 중
                          </Badge>
                        </>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-enhanced">
                      {new Date(row.updated_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-1 rounded-xl border border-gray-700 overflow-hidden">
                <div className="grid grid-cols-12 bg-gray-800/60 text-gray-300 text-xs px-4 py-2">
                  <button 
                    className="col-span-7 flex items-center hover:text-white transition-colors text-left"
                    onClick={() => handleSort("title")}
                  >
                    제목{getSortIcon("title")}
                  </button>
                  <button 
                    className="col-span-2 flex items-center hover:text-white transition-colors text-left"
                    onClick={() => handleSort("type")}
                  >
                    유형{getSortIcon("type")}
                  </button>
                  <button 
                    className="col-span-2 flex items-center hover:text-white transition-colors text-left"
                    onClick={() => handleSort("status")}
                  >
                    상태{getSortIcon("status")}
                  </button>
                  <button 
                    className="col-span-1 flex items-center justify-end hover:text-white transition-colors pr-2"
                    onClick={() => handleSort("updated_at")}
                  >
                    업데이트{getSortIcon("updated_at")}
                  </button>
                </div>
                <div className="divide-y divide-gray-700/60">
                  {(sortedData || []).map((row: any) => (
                    <div key={row.id} className="grid grid-cols-12 items-center px-4 py-3 hover:bg-gray-800/40">
                      <div className="col-span-7 flex items-center gap-2 min-w-0 pr-2">
                        <Checkbox 
                          checked={!!selected[row.id]} 
                          onCheckedChange={() => toggleSelect(row.id)}
                          className="flex-shrink-0"
                        />
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button onClick={() => setDetail(row)} className="text-left min-w-0 flex-1">
                                <span className="text-primary-enhanced font-semibold truncate block">
                                  {row.title || row.id}
                                </span>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="max-w-[640px] whitespace-pre-wrap break-words text-sm">
                                {row.title || row.id}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <div className="col-span-2">
                        <Badge className={`${getTypeBadgeStyle(getDocumentFileType(row))} font-semibold text-[10px] px-2 py-0.5 inline-flex items-center gap-1 w-fit whitespace-nowrap`}>
                          {getTypeIcon(getDocumentFileType(row))}
                          {getTypeDisplayName(getDocumentFileType(row))}
                        </Badge>
                      </div>
                      <div className="col-span-2">
                        <Badge className={`${
                          row.status === 'indexed' 
                            ? 'bg-green-500/20 text-green-300 border-green-400/30'
                            : row.status === 'processing'
                            ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30'
                            : row.status === 'failed'
                            ? 'bg-red-500/20 text-red-300 border-red-400/30'
                            : 'bg-gray-500/20 text-gray-300 border-gray-400/30'
                        } font-semibold w-fit whitespace-nowrap`}>
                          {row.status}
                        </Badge>
                      </div>
                      <div className="col-span-1 text-right text-[11px] text-muted-enhanced pr-2">
                        {new Date(row.updated_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
    
    {/* 일괄 삭제 확인 다이얼로그 */}
    <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>문서 삭제 확인</AlertDialogTitle>
          <AlertDialogDescription>
            선택한 <strong>{selectedIds.length}개 문서</strong>를 삭제하시겠습니까?
            <br /><br />
            이 작업은 되돌릴 수 없으며, 관련된 모든 청크와 임베딩 데이터도 함께 삭제됩니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmBulkDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700"
          >
            {deleting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                삭제 중...
              </>
            ) : (
              '삭제'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    
    <DocumentDetailDialog detail={detail} onClose={() => setDetail(null)} onRefetch={refetch} />
    </>
  );
}

function QueueMiniPanel({ vendors }: { vendors: string[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [processingOne, setProcessingOne] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  
  const { data, refetch } = useQuery({
    queryKey: ["queue-mini", vendors],
    queryFn: async () => {
      const statuses = ["queued", "processing", "failed", "retrying"];
      const out: Record<string, number> = { queued: 0, processing: 0, failed: 0, retrying: 0 };
      for (const s of statuses) {
        let q = supabase.from("processing_jobs").select("id", { count: "exact", head: true }).eq("status", s);
        // vendor 필터링은 현재 processing_jobs 테이블에 vendor 컬럼이 없으므로 제외
        // payload에 vendor 정보가 있지만, JSONB 쿼리는 복잡하므로 전체 조회
        const { count } = await q;
        out[s] = count || 0;
      }
      // retrying도 processing으로 카운트 (사용자에게는 처리 중으로 보임)
      out.processing += out.retrying;
      return out;
    },
    refetchInterval: 5000, // 5초마다 자동 새로고침
  });
  const queued = data?.queued ?? 0;
  const processing = data?.processing ?? 0;
  const failed = data?.failed ?? 0;

  return (
    <Card className="card-enhanced">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary-enhanced">
          <RefreshCw className="w-5 h-5" />
          처리 큐 (요약)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-secondary-enhanced mb-3 font-semibold">
          선택 벤더: <span className="text-blue-300">{vendors.join(", ") || "(없음)"}</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <MiniStat title="Queued" value={String(queued)} color="bg-blue-500/30 border-blue-400/30" />
          <MiniStat title="Processing" value={String(processing)} color="bg-indigo-500/30 border-indigo-400/30" />
          <MiniStat title="Failed" value={String(failed)} color="bg-rose-500/30 border-rose-400/30" />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button 
            variant="secondary" 
            className="bg-gray-700/50 border-gray-600 text-secondary-enhanced hover:bg-gray-700 hover:text-white flex-1"
            disabled={processingOne || queued === 0}
            onClick={async () => {
              if (processingOne || queued === 0) return;
              
              setProcessingOne(true);
              try {
                const res = await fetch('/api/jobs/consume', { method: 'POST' });
                const result = await res.json();
                
                if (res.ok && result.success) {
                  toast.success('큐 처리 완료', {
                    description: result.message || '작업이 처리되었습니다.',
                    duration: 3000,
                  });
                } else {
                  toast.error('큐 처리 실패', {
                    description: result.error || result.details || '작업 처리 중 오류가 발생했습니다.',
                    duration: 5000,
                  });
                }
                
                refetch(); // 큐 상태 새로고침
                // 문서 목록도 새로고침
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('docs-refresh'));
                }
              } catch (error) {
                console.error('큐 처리 오류:', error);
                toast.error('큐 처리 오류', {
                  description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
                  duration: 5000,
                });
              } finally {
                setProcessingOne(false);
              }
            }}
          >
            {processingOne ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                처리 중...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-1" /> 
                1건 처리
              </>
            )}
          </Button>
          <Button 
            variant="secondary" 
            className="bg-gray-700/50 border-gray-600 text-secondary-enhanced hover:bg-gray-700 hover:text-white flex-1"
            disabled={retryingFailed || failed === 0}
            onClick={async () => {
              if (retryingFailed || failed === 0) return;
              
              setRetryingFailed(true);
              try {
                // 실패한 작업들 조회
                const { data: failedJobs, error: fetchError } = await supabase
                  .from('processing_jobs')
                  .select('id, attempts, max_attempts')
                  .eq('status', 'failed')
                  .limit(10); // 최대 10개까지
                
                if (fetchError) {
                  throw new Error(`실패한 작업 조회 실패: ${fetchError.message}`);
                }
                
                if (!failedJobs || failedJobs.length === 0) {
                  toast.info('재시도할 작업이 없습니다', {
                    description: '실패한 작업이 없습니다.',
                    duration: 3000,
                  });
                  return;
                }
                
                // 각 작업을 재시도 큐에 등록
                let successCount = 0;
                let failCount = 0;
                
                for (const job of failedJobs) {
                  const attempts = (job.attempts || 0) + 1;
                  const maxAttempts = job.max_attempts || 3;
                  
                  if (attempts >= maxAttempts) {
                    failCount++;
                    continue; // 최대 시도 횟수 초과
                  }
                  
                  const backoffMs = Math.min(60000, 1000 * Math.pow(2, attempts));
                  const scheduledAt = new Date(Date.now() + backoffMs).toISOString();
                  
                  const { error: updateError } = await supabase
                    .from('processing_jobs')
                    .update({ 
                      status: 'queued', 
                      attempts, 
                      scheduled_at: scheduledAt, 
                      finished_at: null, 
                      started_at: null,
                      error: null
                    })
                    .eq('id', job.id)
                    .eq('status', 'failed');
                  
                  if (updateError) {
                    console.error(`작업 ${job.id} 재시도 실패:`, updateError);
                    failCount++;
                  } else {
                    successCount++;
                  }
                }
                
                if (successCount > 0) {
                  toast.success('재시도 완료', {
                    description: `${successCount}개 작업을 큐에 다시 등록했습니다.`,
                    duration: 3000,
                  });
                }
                
                if (failCount > 0) {
                  toast.warning('일부 재시도 실패', {
                    description: `${failCount}개 작업은 재시도할 수 없습니다 (최대 시도 횟수 초과).`,
                    duration: 5000,
                  });
                }
                
                refetch(); // 큐 상태 새로고침
              } catch (error) {
                console.error('재시도 오류:', error);
                toast.error('재시도 오류', {
                  description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
                  duration: 5000,
                });
              } finally {
                setRetryingFailed(false);
              }
            }}
          >
            {retryingFailed ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                재시도 중...
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 mr-1" /> 
                실패 재시도
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div className={`rounded-xl p-3 border ${color}`}>
      <div className="text-xs text-secondary-enhanced font-semibold">{title}</div>
      <div className="text-xl font-bold text-primary-enhanced mt-1">{value}</div>
    </div>
  );
}

function MetricsSummary({ vendors }: { vendors: string[] }) {
  const { data, isLoading } = useQuery({
    queryKey: ["metrics-summary", vendors],
    queryFn: async () => {
      const hours = 168; // 7일
      const res = await fetch(`/api/admin/metrics?hours=${hours}`);
      if (!res.ok) throw new Error("metrics error");
      return res.json();
    },
  });
  const overall = data?.overall || {};
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card className="card-enhanced">
        <CardContent className="py-4">
          <Metric title="평균 처리(ms)" value={isLoading ? "-" : String(overall.avgTotalMs ?? "-")} />
        </CardContent>
      </Card>
      <Card className="card-enhanced">
        <CardContent className="py-4">
          <Metric title="p95(ms)" value={isLoading ? "-" : String(overall.p95TotalMs ?? "-")} />
        </CardContent>
      </Card>
      <Card className="card-enhanced">
        <CardContent className="py-4">
          <Metric title="p99(ms)" value={isLoading ? "-" : String(overall.p99TotalMs ?? "-")} />
        </CardContent>
      </Card>
      <Card className="card-enhanced">
        <CardContent className="py-4">
          <Metric title="실패율" value={isLoading ? "-" : String(data?.failedRate ?? "-")} />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-secondary-enhanced font-semibold">{title}</div>
      <div className="text-2xl font-bold text-primary-enhanced mt-1">{value}</div>
    </div>
  );
}

function DocumentDetailDialog({ detail, onClose, onRefetch }: { detail: any | null; onClose: () => void; onRefetch: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  const { data: fullDoc, isLoading: loadingDoc } = useQuery({
    queryKey: ["doc-detail", detail?.id],
    queryFn: async () => {
      if (!detail?.id) return null;
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("id", detail.id)
        .single();
      
      // 청크 데이터 확인
      if (data) {
        const { count: actualChunkCount } = await supabase
          .from("document_chunks")
          .select("*", { count: "exact", head: true })
          .eq("document_id", detail.id);
        
        const { count: chunksWithEmbedding } = await supabase
          .from("document_chunks")
          .select("*", { count: "exact", head: true })
          .eq("document_id", detail.id)
          .not("embedding", "is", null);
        
        return {
          ...data,
          actualChunkCount: actualChunkCount || 0,
          chunksWithEmbedding: chunksWithEmbedding || 0,
        };
      }
      if (error) throw error;
      return data;
    },
    enabled: !!detail?.id,
  });

  const { data: metadata } = useQuery({
    queryKey: ["doc-metadata", detail?.id],
    queryFn: async () => {
      if (!detail?.id) return null;
      const { data, error } = await supabase
        .from("document_metadata")
        .select("*")
        .eq("id", detail.id)
        .single();
      if (error && error.code !== 'PGRST116') return null;
      return data;
    },
    enabled: !!detail?.id,
  });

  const { data: chunks } = useQuery({
    queryKey: ["doc-chunks", detail?.id],
    queryFn: async () => {
      if (!detail?.id) return null;
      const { data, error } = await supabase
        .from("document_chunks")
        .select("content, metadata")
        .eq("document_id", detail.id)
        .order("metadata->chunk_index", { ascending: true })
        .limit(5);
      if (error) return [];
      return data || [];
    },
    enabled: !!detail?.id,
  });

  const { data: metrics } = useQuery({
    queryKey: ["doc-metrics", detail?.id],
    queryFn: async () => {
      if (!detail?.id) return null;
      const { data, error } = await supabase
        .from("processing_metrics")
        .select("*")
        .eq("document_id", detail.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return [];
      return data || [];
    },
    enabled: !!detail?.id,
  });

  const { data: jobs } = useQuery({
    queryKey: ["doc-jobs", detail?.id],
    queryFn: async () => {
      if (!detail?.id) return null;
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("id, document_id, job_type, status, priority, attempts, max_attempts, error, result, created_at, scheduled_at, started_at, finished_at")
        .eq("document_id", detail.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return [];
      return data || [];
    },
    enabled: !!detail?.id,
  });

  if (!detail) return null;

  return (
    <Dialog open={!!detail} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-gray-900/95 backdrop-blur-md border-gray-700">
        <DialogHeader>
          <DialogTitle className="truncate text-primary-enhanced">{detail?.title || detail?.id}</DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="metadata" className="w-full">
          <TabsList className="grid grid-cols-3 bg-gray-800/50 border-gray-700">
            <TabsTrigger 
              value="metadata" 
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
            >
              메타데이터
            </TabsTrigger>
            <TabsTrigger 
              value="preview" 
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
            >
              미리보기
            </TabsTrigger>
            <TabsTrigger 
              value="logs" 
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
            >
              처리 로그
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="metadata" className="space-y-4">
            {loadingDoc ? (
              <div className="text-sm text-muted-enhanced">불러오는 중...</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <div className="text-secondary-enhanced font-semibold">문서 ID</div>
                    <div className="font-mono text-xs break-all text-primary-enhanced">{fullDoc?.id || detail.id}</div>
            </div>
                  <div className="space-y-1">
                    <div className="text-secondary-enhanced font-semibold">벤더</div>
                    <div className="text-primary-enhanced">
                      {(fullDoc?.source_vendor || detail.source_vendor) 
                        ? (DB_TO_VENDOR_MAP[fullDoc?.source_vendor || detail.source_vendor] || fullDoc?.source_vendor || detail.source_vendor)
                        : '-'}
          </div>
        </div>
                  <div className="space-y-1">
                    <div className="text-secondary-enhanced font-semibold">유형</div>
                    <div className="text-primary-enhanced">{fullDoc?.type || detail.type}</div>
                      </div>
                  <div className="space-y-1">
                    <div className="text-secondary-enhanced font-semibold">상태</div>
                    <Badge className={`${
                      fullDoc?.status === 'indexed' || detail.status === 'indexed'
                        ? 'bg-green-500/20 text-green-300 border-green-400/30'
                        : fullDoc?.status === 'processing' || detail.status === 'processing'
                        ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30'
                        : fullDoc?.status === 'failed' || detail.status === 'failed'
                        ? 'bg-red-500/20 text-red-300 border-red-400/30'
                        : 'bg-gray-500/20 text-gray-300 border-gray-400/30'
                    } font-semibold`}>
                      {fullDoc?.status || detail.status}
                    </Badge>
                    </div>
                  <div className="space-y-1">
                    <div className="text-secondary-enhanced font-semibold">청크 수</div>
                    <div className="text-primary-enhanced">
                      {fullDoc?.actualChunkCount !== undefined ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span>DB 기록: {fullDoc.chunk_count || 0}</span>
                            {fullDoc.chunk_count !== fullDoc.actualChunkCount && (
                              <Badge variant="outline" className="bg-yellow-500/20 text-yellow-300 border-yellow-400/30 text-xs">
                                불일치
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-enhanced">
                            실제 청크: {fullDoc.actualChunkCount}개
                            {fullDoc.chunksWithEmbedding > 0 && (
                              <span className="ml-2">(임베딩: {fullDoc.chunksWithEmbedding}개)</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span>{fullDoc?.chunk_count || detail.chunk_count || 0}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-secondary-enhanced font-semibold">생성일</div>
                    <div className="text-xs text-primary-enhanced">{fullDoc?.created_at ? new Date(fullDoc.created_at).toLocaleString() : '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-secondary-enhanced font-semibold">수정일</div>
                    <div className="text-xs text-primary-enhanced">{fullDoc?.updated_at ? new Date(fullDoc.updated_at).toLocaleString() : '-'}</div>
          </div>
                  {metadata && (
                    <>
                      <div className="space-y-1">
                        <div className="text-secondary-enhanced font-semibold">파일 크기</div>
                        <div className="text-primary-enhanced">{metadata.size ? `${(metadata.size / 1024).toFixed(2)} KB` : '-'}</div>
          </div>
                      <div className="space-y-1">
                        <div className="text-secondary-enhanced font-semibold">파일 타입</div>
                        <div className="text-primary-enhanced">{metadata.type || '-'}</div>
                      </div>
                    </>
                  )}
                </div>
                <Separator className="bg-gray-700" />
                <div className="flex items-center gap-2">
                      <Button
                    onClick={async () => {
                      try {
                        // 문서 정보 가져오기
                        const { data: docData, error: docError } = await supabase
                          .from('documents')
                          .select('id, file_type, type, title, source_vendor')
                          .eq('id', detail.id)
                          .single();
                        
                        if (docError || !docData) {
                          toast.error('문서 정보 조회 실패', {
                            description: docError?.message || '문서를 찾을 수 없습니다.',
                            duration: 5000,
                          });
                          return;
                        }
                        
                        // 파일 타입에 따라 적절한 jobType 결정
                        let jobType: 'PDF_PARSE' | 'DOCX_PARSE' = 'PDF_PARSE';
                        if (docData.file_type?.includes('docx') || docData.type === 'docx') {
                          jobType = 'DOCX_PARSE';
                        }
                        
                        // 기존 청크 삭제
                        const { error: deleteChunksError } = await supabase
                          .from('document_chunks')
                          .delete()
                          .eq('document_id', detail.id);
                        
                        if (deleteChunksError) {
                          console.warn('기존 청크 삭제 실패 (무시):', deleteChunksError);
                        }
                        
                        // 문서 상태를 pending으로 변경
                        await supabase
                          .from('documents')
                          .update({ 
                            status: 'pending',
                            chunk_count: 0,
                            updated_at: new Date().toISOString()
                          })
                          .eq('id', detail.id);
                        
                        // 큐에 재처리 작업 등록
                        const res = await fetch('/api/jobs/enqueue', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            documentId: detail.id,
                            jobType,
                            priority: 7,
                            payload: {
                              fileName: docData.title,
                              vendor: docData.source_vendor || 'META',
                              reprocess: true
                            }
                          })
                        });
                        
                        const result = await res.json();
                        
                        if (res.ok && result.success) {
                          toast.success('재처리 시작', {
                            description: '문서가 큐에 등록되었습니다. 처리 중입니다...',
                            duration: 3000,
                          });
                          onRefetch();
                          // 문서 목록 새로고침
                          if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('docs-refresh'));
                          }
                        } else {
                          toast.error('재처리 실패', {
                            description: result.error || result.details || '재처리 작업 등록에 실패했습니다.',
                            duration: 5000,
                          });
                        }
                      } catch (error) {
                        console.error('재처리 오류:', error);
                        toast.error('재처리 오류', {
                          description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
                          duration: 5000,
                        });
                      }
                    }}
                    className="btn-enhanced"
                  >
                    재처리
                      </Button>
                  <Button 
                    variant="destructive" 
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deleting}
                    className="bg-red-600/20 border-red-500/30 text-red-300 hover:bg-red-600/30 hover:text-red-200"
                  >
                    {deleting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                    삭제
                  </Button>
                      </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="preview" className="space-y-4">
            {fullDoc?.type === 'url' ? (
              <div className="space-y-2">
                <div className="text-sm text-secondary-enhanced font-semibold">URL</div>
                <div className="p-3 bg-gray-800/30 rounded-lg border border-gray-600">
                  <a href={fullDoc.title || fullDoc.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline break-all">
                    {fullDoc.title || fullDoc.url || '-'}
                  </a>
                      </div>
                      </div>
            ) : (
              <div className="space-y-2">
                <div className="text-sm text-secondary-enhanced font-semibold">문서 내용 미리보기 (최대 5개 청크)</div>
                <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
                  {chunks && chunks.length > 0 ? (
                    chunks.map((chunk: any, i: number) => (
                      <div key={i} className="p-3 bg-gray-800/30 rounded-lg border border-gray-600 text-sm">
                        <div className="text-muted-enhanced text-xs mb-1 font-semibold">청크 {i + 1}</div>
                        <div className="text-primary-enhanced whitespace-pre-wrap line-clamp-10">{chunk.content}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-enhanced">청크 데이터가 없습니다.</div>
                        )}
                      </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs" className="space-y-4">
            <div className="space-y-4">
              <div>
                <div className="text-sm font-bold text-primary-enhanced mb-2">처리 메트릭 ({metrics?.length || 0}건)</div>
                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                  {metrics && metrics.length > 0 ? (
                    metrics.map((m: any, i: number) => (
                      <div key={i} className="p-3 bg-gray-800/30 rounded-lg border border-gray-600 text-xs">
                        <div className="grid grid-cols-4 gap-2">
                          <div className="text-primary-enhanced font-semibold">총 {m.total_ms}ms</div>
                          <div className="text-secondary-enhanced">OCR {m.ocr_ms || 0}ms</div>
                          <div className="text-secondary-enhanced">임베딩 {m.emb_ms || 0}ms</div>
                          <div className="text-secondary-enhanced">{m.chunks || 0} 청크</div>
                      </div>
                        <div className="text-muted-enhanced mt-1">{new Date(m.created_at).toLocaleString()}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-enhanced">메트릭 데이터가 없습니다.</div>
                  )}
                        </div>
                          </div>
              <Separator className="bg-gray-700" />
              <div>
                <div className="text-sm font-bold text-primary-enhanced mb-2">처리 작업 ({jobs?.length || 0}건)</div>
                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                  {jobs && jobs.length > 0 ? (
                    jobs.map((j: any, i: number) => (
                      <div key={i} className={`p-3 rounded-lg border text-xs ${
                        j.status === 'failed' 
                          ? 'bg-red-500/10 border-red-500/30' 
                          : j.status === 'completed'
                          ? 'bg-green-500/10 border-green-500/30'
                          : 'bg-gray-800/30 border-gray-600'
                      }`}>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <div className="text-muted-enhanced">작업 타입</div>
                          <div className="text-primary-enhanced">{j.job_type}</div>
                          <div className="text-muted-enhanced">상태</div>
                          <div className="text-primary-enhanced">
                            <Badge className={`${
                              j.status === 'completed' ? 'bg-green-500/20 text-green-300 border-green-400/30' :
                              j.status === 'failed' ? 'bg-red-500/20 text-red-300 border-red-400/30' :
                              j.status === 'processing' ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30' :
                              j.status === 'queued' ? 'bg-blue-500/20 text-blue-300 border-blue-400/30' :
                              'bg-gray-500/20 text-gray-300 border-gray-400/30'
                            } font-semibold text-xs`}>
                              {j.status}
                            </Badge>
                          </div>
                          <div className="text-muted-enhanced">시도 횟수</div>
                          <div className="text-primary-enhanced">{j.attempts || 0} / {j.max_attempts || 3}</div>
                          <div className="text-muted-enhanced">우선순위</div>
                          <div className="text-primary-enhanced">{j.priority || '-'}</div>
                          <div className="text-muted-enhanced">생성일</div>
                          <div className="text-primary-enhanced">{j.created_at ? new Date(j.created_at).toLocaleString() : '-'}</div>
                          {j.started_at && (
                            <>
                              <div className="text-muted-enhanced">시작일</div>
                              <div className="text-primary-enhanced">{new Date(j.started_at).toLocaleString()}</div>
                            </>
                          )}
                          {j.finished_at && (
                            <>
                              <div className="text-muted-enhanced">완료일</div>
                              <div className="text-primary-enhanced">{new Date(j.finished_at).toLocaleString()}</div>
                            </>
                          )}
                        </div>
                        {j.error && (
                          <div className="mt-2 p-2 bg-red-500/20 border border-red-400/30 rounded text-xs">
                            <div className="text-red-300 font-semibold mb-1">❌ 에러 메시지:</div>
                            <div className="text-red-200 whitespace-pre-wrap break-words">{j.error}</div>
                          </div>
                        )}
                        {j.result && typeof j.result === 'object' && (
                          <div className="mt-2 p-2 bg-blue-500/10 border border-blue-400/20 rounded text-xs">
                            <div className="text-blue-300 font-semibold mb-1">📊 처리 결과:</div>
                            <div className="text-blue-200 font-mono text-[10px] whitespace-pre-wrap break-words">
                              {JSON.stringify(j.result, null, 2)}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-enhanced">작업 이력이 없습니다.</div>
                  )}
                        </div>
            </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
      
      {/* 단일 문서 삭제 확인 다이얼로그 */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문서 삭제 확인</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>"{detail?.title || detail?.id}"</strong> 문서를 삭제하시겠습니까?
              <br /><br />
              이 작업은 되돌릴 수 없으며, 관련된 모든 청크와 임베딩 데이터도 함께 삭제됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!detail?.id) return;
                
                setDeleting(true);
                try {
                  // 삭제 전 청크 개수 확인
                  const { count: chunkCount } = await supabase
                    .from('document_chunks')
                    .select('*', { count: 'exact', head: true })
                    .eq('document_id', detail.id);
                  
                  // 문서 및 관련 청크 삭제
                  const { error: chunksError } = await supabase
                    .from('document_chunks')
                    .delete()
                    .eq('document_id', detail.id);

                  if (chunksError) {
                    console.warn('청크 삭제 오류:', chunksError);
                  }

                  const { error: docError } = await supabase
                    .from('documents')
                    .delete()
                    .eq('id', detail.id);

                  if (docError) {
                    throw new Error(docError.message);
                  }

                  setShowDeleteConfirm(false);
                  
                  // 성공 알림
                  toast.success('문서 삭제 완료', {
                    description: `"${detail?.title || detail?.id}" 문서와 ${chunkCount || 0}개 청크가 삭제되었습니다.`,
                    duration: 3000,
                  });
                  
                  onClose();
                  onRefetch();
                } catch (error) {
                  console.error('문서 삭제 오류:', error);
                  toast.error('문서 삭제 실패', {
                    description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
                    duration: 5000,
                  });
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  삭제 중...
                </>
              ) : (
                '삭제'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
