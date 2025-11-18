"use client";

import { useEffect, useMemo, useRef, useState, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import AdminLayout from "@/components/layouts/AdminLayout";
import "@/app/admin/globals.admin.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import type { LucideIcon } from "lucide-react";
import { Check, CheckCircle, Download, FileText, Globe, Loader2, RefreshCw, Search, Upload, XCircle, File, Link2, ArrowUp, ArrowDown, ArrowUpDown, FileSearch, Sparkles, Database, Info, Clock3, AlertTriangle, Settings, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import QueueMonitoringPanel from "@/components/admin/QueueMonitoringPanel";
import { logger } from "@/lib/utils/logger";

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

const normalizeUrlForGrouping = (raw?: string | null): string | null => {
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
};

function AdminDocsPageContent() {
  const router = useRouter();
  const params = useSearchParams();

  // Hydration 오류 방지: 초기값을 항상 동일하게 설정 (기본 벤더 없음)
  const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
  // Hydration 오류 방지: 초기값을 항상 동일하게 설정하고, useEffect에서 localStorage 읽기
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [toolbarRefreshLoading, setToolbarRefreshLoading] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // 클라이언트 마운트 확인 (Hydration 오류 방지)
  useEffect(() => {
    setIsClient(true);
  }, []);

  // 보기 모드 및 필터 설정 localStorage에서 복원 (클라이언트에서만)
  useEffect(() => {
    if (!isClient || typeof window === 'undefined') return;
    
    // 보기 모드 복원 (유효한 값만 허용)
    const savedViewMode = window.localStorage.getItem('adminDocsViewMode');
    if (savedViewMode === 'card' || savedViewMode === 'list') {
      setViewMode(savedViewMode);
    } else if (savedViewMode) {
      // 잘못된 값이 저장되어 있으면 'card'로 초기화하고 localStorage 업데이트
      console.warn(`⚠️ 잘못된 viewMode 값 감지: "${savedViewMode}", 'card'로 초기화합니다.`);
      setViewMode('card');
      window.localStorage.setItem('adminDocsViewMode', 'card');
    }
    
    // 필터 설정 복원
    const savedStatusFilter = window.localStorage.getItem('adminDocsStatusFilter');
    if (savedStatusFilter) {
      setStatusFilter(savedStatusFilter);
    }
    
    const savedTypeFilter = window.localStorage.getItem('adminDocsTypeFilter');
    if (savedTypeFilter) {
      setTypeFilter(savedTypeFilter);
    }
  }, [isClient]);

  // 변경 시 저장
  useEffect(() => {
    if (!isClient || typeof window === 'undefined') return;
    window.localStorage.setItem('adminDocsViewMode', viewMode);
  }, [viewMode, isClient]);

  // 필터 설정 localStorage 저장
  useEffect(() => {
    if (!isClient || typeof window === 'undefined') return;
    window.localStorage.setItem('adminDocsStatusFilter', statusFilter);
  }, [statusFilter, isClient]);

  useEffect(() => {
    if (!isClient || typeof window === 'undefined') return;
    window.localStorage.setItem('adminDocsTypeFilter', typeFilter);
  }, [typeFilter, isClient]);

  // URL 파라미터에서 vendors 읽기 (클라이언트에서만)
  useEffect(() => {
    if (!isClient) return;
    const fromUrl = params.get("vendors");
    if (fromUrl) {
      const vendors = decodeURIComponent(fromUrl).split(",").filter(Boolean);
      if (vendors.length > 0) {
        setSelectedVendors(vendors);
        // 벤더가 변경되면 typeFilter를 'all'로 리셋하여 모든 문서 표시
        if (typeFilter !== 'all') {
          setTypeFilter('all');
        }
      }
    }
  }, [isClient, params]);
  
  // 벤더 변경 시 typeFilter 자동 리셋
  useEffect(() => {
    if (!isClient) return;
    // 벤더가 선택되었고 typeFilter가 'all'이 아니면 리셋
    const currentTypeFilter = typeFilter;
    if (selectedVendors.length > 0 && currentTypeFilter !== 'all') {
      console.log('🔄 벤더 변경 감지, typeFilter를 "all"로 리셋:', { 
        selectedVendors, 
        previousTypeFilter: currentTypeFilter 
      });
      setTypeFilter('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVendors, isClient]);

  useEffect(() => {
    if (!isClient) return;
    const q = selectedVendors.length ? `?vendors=${encodeURIComponent(selectedVendors.join(","))}` : "";
    router.replace(`/admin/docs${q}`);
  }, [selectedVendors, router, isClient]);

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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Left: Upload/Crawl + Queue panel */}
        <div className="space-y-4 sm:space-y-6 lg:col-span-1">
          <UploadAndCrawlTabs vendors={selectedVendors} onVendorsChange={setSelectedVendors} />
          <QueueMiniPanel vendors={selectedVendors} />
          <QueueMonitoringPanel vendors={selectedVendors} defaultOpen={false} />
        </div>

          {/* Right: Document list */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <DocsToolbar 
              vendors={selectedVendors} 
              onStatusFilterChange={setStatusFilter}
              onTypeFilterChange={setTypeFilter}
              statusFilter={statusFilter}
              typeFilter={typeFilter}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              isLoading={toolbarRefreshLoading}
            />
            <DocsTable 
              vendors={selectedVendors} 
              statusFilter={statusFilter}
              typeFilter={typeFilter}
              viewMode={viewMode}
              searchQuery={searchQuery}
              onRefreshStateChange={setToolbarRefreshLoading}
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
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider whitespace-nowrap">Vendor</span>
        <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap overflow-x-auto sm:overflow-x-visible">
          {ALL_VENDORS.map(v => (
            <button
              key={v}
              onClick={() => toggle(v)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                selected.includes(v) 
                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/20" 
                  : "bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
              aria-label={`${v} ${selected.includes(v) ? '선택됨' : '선택 안됨'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {selected.length > 0 && (
        <>
          <Separator orientation="vertical" className="hidden sm:block h-4 bg-gray-600" />
          <Separator orientation="horizontal" className="sm:hidden w-full bg-gray-600" />
          <span className="text-xs text-gray-400 whitespace-nowrap">
            <span className="text-blue-400 font-semibold">{selected.length}</span> selected
          </span>
        </>
      )}
    </div>
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

function UploadAndCrawlTabs({ vendors, onVendorsChange }: { vendors: string[]; onVendorsChange: (v: string[]) => void }) {
  const [isUploading, setUploading] = useState(false);
  const [isCrawling, setCrawling] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadStep, setUploadStep] = useState<UploadStep>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [crawlJobId, setCrawlJobId] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const pollingAbortControllerRef = useRef<AbortController | null>(null);
  const crawlPollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCrawlCancelledRef = useRef(false);
  const [crawlProgressValue, setCrawlProgressValue] = useState(0);
  const [crawlProgressLabel, setCrawlProgressLabel] = useState('');
  const [crawlResult, setCrawlResult] = useState<any>(null);
  // Hydration 오류 방지: 초기값을 항상 동일하게 설정
  const [extractSubPages, setExtractSubPages] = useState(true);
  
  // URL 크롤링 옵션 상태 관리
  type CrawlOptions = {
    domainLimit: boolean;
    respectRobots: boolean;
    maxDepth: string;
  };
  
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    domainLimit: true,
    respectRobots: true,
    maxDepth: '2'
  });
  
  // 클라이언트 마운트 확인 (Hydration 오류 방지)
  const [isClient, setIsClient] = useState(false);
  
  useEffect(() => {
    setIsClient(true);
  }, []);

  // 크롤링 옵션 및 extractSubPages localStorage에서 복원 (클라이언트에서만)
  useEffect(() => {
    if (!isClient || typeof window === 'undefined') return;
    
    // extractSubPages 복원
    const savedExtractSubPages = window.localStorage.getItem('adminDocsExtractSubPages');
    if (savedExtractSubPages !== null) {
      setExtractSubPages(savedExtractSubPages === 'true');
    }
    
    // crawlOptions 복원
    const savedCrawlOptions = window.localStorage.getItem('adminCrawlOptions');
    if (savedCrawlOptions) {
      try {
        const parsed = JSON.parse(savedCrawlOptions) as CrawlOptions;
        setCrawlOptions({
          domainLimit: typeof parsed.domainLimit === 'boolean' ? parsed.domainLimit : true,
          respectRobots: typeof parsed.respectRobots === 'boolean' ? parsed.respectRobots : true,
          maxDepth: typeof parsed.maxDepth === 'string' ? parsed.maxDepth : '2',
        });
      } catch {
        // 파싱 실패 시 기본값 유지
      }
    }
  }, [isClient]);

  // 크롤링 옵션 localStorage 저장
  useEffect(() => {
    if (!isClient || typeof window === 'undefined') return;
    window.localStorage.setItem('adminCrawlOptions', JSON.stringify(crawlOptions));
  }, [crawlOptions, isClient]);

  useEffect(() => {
    if (!isClient || typeof window === 'undefined') return;
    window.localStorage.setItem('adminDocsExtractSubPages', String(extractSubPages));
  }, [extractSubPages, isClient]);

  useEffect(() => {
    if (crawlProgressValue === 100 || crawlResult?.error) {
      const timer = setTimeout(() => {
        setCrawlProgressValue(0);
        setCrawlProgressLabel('');
        setCrawlResult(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [crawlProgressValue, crawlResult]);

  // 크롤링 취소 핸들러
  const handleCancelCrawl = useCallback(async () => {
    if (!crawlJobId) {
      toast.error('취소할 작업이 없습니다', { duration: 3000 });
      return;
    }

    try {
      // 폴링 중지
      if (crawlPollingTimeoutRef.current) {
        clearTimeout(crawlPollingTimeoutRef.current);
        crawlPollingTimeoutRef.current = null;
      }
      isCrawlCancelledRef.current = true;

      // 취소 API 호출
      const response = await fetch('/api/jobs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          jobId: crawlJobId,
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        toast.success('크롤링이 취소되었습니다', { duration: 3000 });
        setCrawlProgressLabel('크롤링이 취소되었습니다.');
        setCrawlProgressValue(0);
        setCrawlResult({ error: '사용자에 의해 취소되었습니다.' });
        setCrawling(false);
        setCrawlJobId(null);
      } else {
        toast.error(result.error || '크롤링 취소에 실패했습니다', { duration: 3000 });
        isCrawlCancelledRef.current = false; // 취소 실패 시 플래그 리셋
      }
    } catch (error) {
      logger.error('크롤링 취소 오류:', error);
      toast.error('크롤링 취소 중 오류가 발생했습니다', { duration: 3000 });
      isCrawlCancelledRef.current = false; // 취소 실패 시 플래그 리셋
    }
  }, [crawlJobId]);

  // 크롤링 진행 상황 폴링 함수
  const pollCrawlStatus = useCallback(async (jobId: string) => {
    const supabaseClient = createClient();
    let pollCount = 0;
    const maxPolls = 120; // 최대 10분 (5초 간격)
    isCrawlCancelledRef.current = false; // 폴링 시작 시 취소 플래그 리셋
    
    const poll = async (): Promise<void> => {
      // 취소되었으면 폴링 중지
      if (isCrawlCancelledRef.current) {
        return;
      }

      pollCount++;
      
      try {
        const { data: job, error } = await supabaseClient
          .from('processing_jobs')
          .select('id, status, result, error, finished_at, started_at')
          .eq('id', jobId)
          .single();

        if (error) {
          logger.error('크롤링 상태 조회 오류:', error);
          if (pollCount >= maxPolls) {
            toast.error('크롤링 상태 확인 시간 초과', { duration: 5000 });
            setCrawling(false);
            setCrawlJobId(null);
            setCrawlProgressLabel('상태 확인 실패');
            setCrawlProgressValue(0);
            return;
          }
          setTimeout(poll, 5000);
          return;
        }

        if (!job) {
          if (pollCount >= maxPolls) {
            toast.error('크롤링 작업을 찾을 수 없습니다', { duration: 5000 });
            setCrawling(false);
            setCrawlJobId(null);
            setCrawlProgressLabel('작업을 찾을 수 없습니다');
            setCrawlProgressValue(0);
            return;
          }
          setTimeout(poll, 5000);
          return;
        }

        if (job.status === 'queued') {
          setCrawlProgressLabel('큐에서 작업 대기 중...');
          setCrawlProgressValue((prev) => Math.min(prev + 5, 45));
        }

        if (job.status === 'processing') {
          const result = job.result as any;
          const progressInfo = result?.subPageProgress;
          
          // 하위 페이지 진행률이 있으면 하위 페이지 처리 중
          if (progressInfo && typeof progressInfo.total === 'number' && progressInfo.total > 0) {
            // 하위 페이지 처리 진행률: 20% (메인 페이지 완료) + (processed/total) * 80%
            const ratio = Math.min(1, progressInfo.processed / progressInfo.total);
            const computed = 20 + ratio * 80;
            setCrawlProgressLabel(`하위 페이지 처리 중... (${progressInfo.processed}/${progressInfo.total})`);
            setCrawlProgressValue((prev) => Math.max(prev, Math.round(Math.min(100, computed))));
          } 
          // documentId가 설정되었으면 메인 페이지 처리 완료, 하위 페이지 대기 중
          else if (result?.documentId) {
            setCrawlProgressLabel('하위 페이지 탐색 중...');
            setCrawlProgressValue((prev) => Math.max(prev, 15));
          }
          // 메인 페이지 처리 중
          else {
            setCrawlProgressLabel('메인 페이지 다운로드 및 청킹 중...');
            // 메인 페이지 처리 진행률: 0-15% (크롤링 0-5%, RAG 처리 5-15%)
            setCrawlProgressValue((prev) => Math.max(prev, Math.min(15, prev + 2)));
          }
        }

        if (job.status === 'completed') {
          const result = job.result as any;
          toast.success('크롤링 완료', {
            description: result?.title ? `${result.title} (청크 ${result.chunkCount || 0}개)` : '문서가 인덱싱되었습니다.',
            duration: 5000,
          });
          
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('docs-refresh'));
          }
          
          setCrawlProgressLabel('크롤링이 완료되었습니다.');
          setCrawlProgressValue(100);
          setCrawlResult(result);
          setCrawling(false);
          setCrawlJobId(null);
          return;
        }

        if (job.status === 'failed') {
          toast.error('크롤링 실패', {
            description: job.error || '알 수 없는 오류가 발생했습니다.',
            duration: 5000,
          });
          setCrawlProgressLabel('크롤링 실패');
          setCrawlProgressValue(100);
          setCrawlResult({ error: job.error });
          setCrawling(false);
          setCrawlJobId(null);
          return;
        }

        if (job.status === 'cancelled') {
          toast.info('크롤링이 취소되었습니다', { duration: 3000 });
          setCrawlProgressLabel('크롤링이 취소되었습니다.');
          setCrawlProgressValue(0);
          setCrawlResult({ error: '작업이 취소되었습니다.' });
          setCrawling(false);
          setCrawlJobId(null);
          return;
        }

        // 취소되었으면 폴링 중지
        if (isCrawlCancelledRef.current) {
          return;
        }

        // 멈춘 작업 감지: processing 상태이지만 started_at이 30분 이상 지난 경우
        // BGE-M3 초기화(최대 90초) + RAG 처리(최대 5분) + 하위 페이지 처리 시간을 고려하여 30분으로 설정
        if (job.status === 'processing' && job.started_at) {
          const startedAt = new Date(job.started_at).getTime();
          const elapsed = Date.now() - startedAt;
          const STUCK_THRESHOLD = 30 * 60 * 1000; // 30분 (BGE-M3 초기화 + RAG 처리 시간 고려)
          
          // 하트비트 확인: result에 최근 업데이트가 있는지 확인
          const result = job.result as any;
          const hasRecentHeartbeat = result?.status && (
            result.status === 'main_page_crawling' ||
            result.status === 'main_page_rag_processing' ||
            result.status === 'main_page_completed' ||
            (result.subPageProgress && result.subPageProgress.processed < result.subPageProgress.total)
          );
          
          // 하트비트가 있으면 진행 중으로 간주 (멈춘 것으로 판단하지 않음)
          if (hasRecentHeartbeat) {
            // 하트비트가 있으면 진행 중이므로 멈춘 것으로 판단하지 않음
            // 단, 1시간 이상 진행 중이면 경고만 표시
            const WARNING_THRESHOLD = 60 * 60 * 1000; // 1시간
            if (elapsed > WARNING_THRESHOLD) {
              console.warn('[CRITICAL] ⚠️ 크롤링 작업이 오래 걸리고 있습니다 (하트비트는 있음):', {
                jobId: job.id,
                status: job.status,
                elapsed: `${Math.round(elapsed / 60000)}분`,
                heartbeatStatus: result?.status,
                subPageProgress: result?.subPageProgress
              });
              // 경고만 표시하고 계속 진행
            }
          } else if (elapsed > STUCK_THRESHOLD) {
            // 하트비트가 없고 30분 이상 지났으면 멈춘 것으로 판단
            console.error('[CRITICAL] ⚠️ 크롤링 작업이 멈춘 것으로 감지됨 (하트비트 없음):', {
              jobId: job.id,
              status: job.status,
              startedAt: job.started_at,
              elapsed: `${Math.round(elapsed / 60000)}분`,
              threshold: `${STUCK_THRESHOLD / 60000}분`,
              hasHeartbeat: hasRecentHeartbeat,
              result: result
            });
            
            toast.error('크롤링 작업이 멈춘 것으로 감지되었습니다', {
              description: `작업이 ${Math.round(elapsed / 60000)}분 동안 진행 중이며 하트비트가 없습니다. 작업을 취소하고 다시 시도해주세요.`,
              duration: 8000,
            });
            
            setCrawlProgressLabel('크롤링 작업이 멈춘 것으로 감지됨');
            setCrawlProgressValue(0);
            setCrawlResult({ error: `작업이 ${Math.round(elapsed / 60000)}분 동안 진행 중이며 하트비트가 없습니다. 작업을 취소하고 다시 시도해주세요.` });
            setCrawling(false);
            setCrawlJobId(null);
            return;
          }
        }
        
        // processing 또는 queued 상태면 계속 폴링
        if (pollCount >= maxPolls) {
          toast.warning('크롤링 처리 시간이 오래 걸리고 있습니다', {
            description: '백그라운드에서 계속 처리 중입니다.',
            duration: 5000,
          });
          setCrawlProgressLabel('크롤링 처리 시간이 지연되고 있습니다.');
          setCrawlProgressValue(90);
          setCrawling(false);
          setCrawlJobId(null);
          return;
        }

        // 취소되었으면 폴링 중지
        if (isCrawlCancelledRef.current) {
          return;
        }

        crawlPollingTimeoutRef.current = setTimeout(poll, 5000);
      } catch (pollError) {
        logger.error('크롤링 상태 폴링 오류:', pollError);
        
        // 취소되었으면 폴링 중지
        if (isCrawlCancelledRef.current) {
          return;
        }

        if (pollCount >= maxPolls) {
          setCrawlProgressLabel('크롤링 상태 확인 중 오류가 발생했습니다.');
          setCrawlProgressValue(0);
          setCrawling(false);
          setCrawlJobId(null);
          return;
        }
        crawlPollingTimeoutRef.current = setTimeout(poll, 5000);
      }
    };

    poll();
  }, []);

  const handleUpload = useCallback(async (files?: File[]) => {
    try {
      const filesToUpload = files || (fileInputRef.current?.files ? Array.from(fileInputRef.current.files) : []);
      if (filesToUpload.length === 0) return;
      
      // 벤더 선택 확인 (업로드 시작 전에 체크)
      if (vendors.length === 0) {
        toast.error('벤더를 선택해주세요', {
          description: '파일 업로드 전에 벤더를 선택해야 합니다.',
          duration: 4000,
        });
        return;
      }
      
      setUploading(true);
      setUploadSuccess(false);
      setUploadError(null);
      
      // 각 파일을 순차적으로 업로드하는 헬퍼 함수
      const uploadSingleFile = async (uploadFile: File, fileIndex: number, totalFiles: number): Promise<void> => {
        // 멀티 파일 업로드 시 진행 상황 표시
        if (totalFiles > 1) {
          toast.info(`파일 업로드 중 (${fileIndex + 1}/${totalFiles})`, {
            description: uploadFile.name,
            duration: 2000,
          });
        }
      
        setUploadStep('uploading');
        setUploadProgress(0);
      
      // 파일 크기 제한 설정 (최대 15MB - 타임아웃 방지)
      const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB (20MB → 15MB로 조정)
      const VERCEL_PAYLOAD_LIMIT = 4 * 1024 * 1024; // 4MB (Vercel payload 제한)
      
      // 파일 크기 초과 검증
      if (uploadFile.size > MAX_FILE_SIZE) {
        const fileSizeMB = (uploadFile.size / (1024 * 1024)).toFixed(2);
        const maxSizeMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
        toast.error('파일 크기 초과', {
          description: `파일 크기가 ${fileSizeMB}MB입니다. 최대 ${maxSizeMB}MB까지 업로드 가능합니다.`,
          duration: 5000,
        });
        setUploadStep('idle');
        setUploadProgress(0);
        throw new Error(`파일 크기가 ${fileSizeMB}MB입니다. 최대 ${maxSizeMB}MB까지 업로드 가능합니다.`);
      }
      
      // 큰 파일 경고 (10MB 이상)
      if (uploadFile.size > 10 * 1024 * 1024) {
        const fileSizeMB = (uploadFile.size / (1024 * 1024)).toFixed(2);
        toast.warning('큰 파일 감지', {
          description: `파일 크기가 ${fileSizeMB}MB입니다. 처리에 시간이 오래 걸릴 수 있습니다 (최대 10분 소요 가능).`,
          duration: 7000,
        });
      }
      
      // 4MB 이상이면 Storage에 직접 업로드 후 큐 등록 (Vercel payload 제한 회피)
      if (uploadFile.size > VERCEL_PAYLOAD_LIMIT) {
        logger.log('📋 대용량 파일 감지 - Storage에 직접 업로드 후 큐 등록:', {
          fileName: uploadFile.name,
          fileSize: uploadFile.size,
          fileSizeMB: (uploadFile.size / (1024 * 1024)).toFixed(2) + 'MB'
        });
        
        setUploadStep('uploading');
        setUploadProgress(10);
        
        // UI 벤더 이름을 DB 값으로 변환 (첫 번째 벤더 사용)
        const dbVendor = convertVendorsToDB(vendors)[0] || "META";
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
        logger.log('✅ 문서 레코드 생성 완료:', documentId);
        
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
        logger.log('✅ Storage 업로드 및 큐 등록 완료:', { jobId: jobData.id, documentId });
        
        // 큐에 등록 후 즉시 큐 워커 트리거 (수동 처리 버튼과 동일한 방식)
        setUploadProgress(70);
        try {
          logger.log('🚀 큐 워커 즉시 트리거 시작...');
          const consumeRes = await fetch('/api/jobs/consume', { method: 'POST' });
          const consumeResult = await consumeRes.json();
          logger.log('✅ 큐 워커 트리거 완료:', consumeResult);
        } catch (consumeError) {
          logger.warn('⚠️ 큐 워커 트리거 실패 (Cron Job이 처리할 수 있음):', consumeError);
          // 에러가 발생해도 폴링은 계속 진행
        }
        
        setUploadProgress(85);
        
        // 큐 상태 폴링 시작
        const pollQueueStatus = async (jobId: string, documentId: string, currentFileIndex: number, totalFilesCount: number): Promise<void> => {
          return new Promise((resolve, reject) => {
            const maxAttempts = 120; // 최대 10분 (5초 간격) - 큰 파일 처리 대응
            let attempts = 0;
            let pollTimeout: NodeJS.Timeout | null = null;
            let isCancelled = false;
            
            // 현재 작업 ID 저장
            setCurrentJobId(jobId);
            setCurrentDocumentId(documentId);
            
            // 취소 핸들러
            const handleCancel = async () => {
              if (isCancelled) return;
              isCancelled = true;
              
              if (pollTimeout) {
                clearTimeout(pollTimeout);
                pollTimeout = null;
              }
              
              try {
                logger.log('🛑 큐 처리 취소 요청:', jobId);
                const cancelRes = await fetch('/api/jobs/action', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ jobId, action: 'cancel' })
                });
                
                const cancelResult = await cancelRes.json();
                if (cancelRes.ok && cancelResult.success) {
                  logger.log('✅ 큐 처리 취소 완료');
                  setUploadStep('idle');
                  setUploadProgress(0);
                  setUploadError('사용자가 큐 처리를 취소했습니다.');
                  setCurrentJobId(null);
                  setCurrentDocumentId(null);
                  
                  toast.warning('큐 처리 취소', {
                    description: '큐 처리가 취소되었습니다.',
                    duration: 3000,
                  });
                  
                  // 문서 상태도 cancelled로 업데이트
                  await supabaseClient
                    .from('documents')
                    .update({ 
                      status: 'failed',
                      updated_at: new Date().toISOString()
                    })
                    .eq('id', documentId);
                  
                  reject(new Error('사용자가 큐 처리를 취소했습니다.'));
                } else {
                  throw new Error(cancelResult.error || '취소 실패');
                }
              } catch (cancelError) {
                logger.error('❌ 큐 처리 취소 실패:', cancelError);
                toast.error('취소 실패', {
                  description: cancelError instanceof Error ? cancelError.message : '큐 처리 취소에 실패했습니다.',
                  duration: 3000,
                });
                // 취소 실패해도 폴링은 계속 진행
                isCancelled = false;
              }
            };
            
            // AbortController에 취소 핸들러 저장
            if (!pollingAbortControllerRef.current) {
              pollingAbortControllerRef.current = new AbortController();
            }
            pollingAbortControllerRef.current.signal.addEventListener('abort', handleCancel);
            
            const poll = async () => {
              if (isCancelled) {
                return;
              }
              
              try {
                attempts++;
                const { data: job, error } = await supabaseClient
                  .from('processing_jobs')
                  .select('status, error, attempts')
                  .eq('id', jobId)
                  .single();
                
                if (error) {
                  logger.error('큐 상태 조회 오류:', error);
                  if (attempts >= maxAttempts) {
                    reject(new Error('큐 상태 확인 시간 초과'));
                    return;
                  }
                  if (!isCancelled) {
                    pollTimeout = setTimeout(poll, 5000);
                  }
                  return;
                }
                
                logger.log(`📊 큐 상태 (${attempts}/${maxAttempts}):`, job);
                
                if (job.status === 'queued') {
                  setUploadStep('saving');
                  setUploadProgress(85 + (attempts / maxAttempts) * 10); // 85-95%
                } else if (job.status === 'processing') {
                  setUploadStep('saving');
                  setUploadProgress(95 + (attempts / maxAttempts) * 3); // 95-98%
                } else if (job.status === 'cancelled') {
                  setUploadStep('idle');
                  setUploadProgress(0);
                  setUploadError('큐 처리가 취소되었습니다.');
                  setCurrentJobId(null);
                  setCurrentDocumentId(null);
                  reject(new Error('큐 처리가 취소되었습니다.'));
                  return;
                } else if (job.status === 'completed') {
                  setUploadStep('completed');
                  setUploadProgress(100);
                  setUploadSuccess(true);
                  logger.log('✅ 큐 처리 완료');
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('docs-refresh'));
                  }
                  // 마지막 파일이 아니면 상태만 초기화하고 계속 진행
                  if (currentFileIndex < totalFilesCount - 1) {
                    setUploadSuccess(false);
                    setUploadStep('idle');
                    setUploadProgress(0);
                    resolve(); // 다음 파일로 진행
                    return;
                  }
                  
                  // 마지막 파일인 경우에만 완전히 종료
                  setSelectedFiles([]);
                  setCurrentJobId(null);
                  setCurrentDocumentId(null);
                  setTimeout(() => {
                    setUploadSuccess(false);
                    setUploadStep('idle');
                    setUploadProgress(0);
                  }, 3000);
                  resolve();
                  return;
                } else if (job.status === 'failed') {
                  setCurrentJobId(null);
                  setCurrentDocumentId(null);
                  reject(new Error(job.error || '큐 처리 실패'));
                  return;
                }
              
              if (attempts < maxAttempts && !isCancelled) {
                pollTimeout = setTimeout(poll, 5000);
              } else {
                // 타임아웃 전에 실제 작업 상태를 한 번 더 확인
                logger.warn('⚠️ 클라이언트 폴링 타임아웃 - 실제 작업 상태 최종 확인 중...');
                const { data: finalJob, error: finalError } = await supabaseClient
                  .from('processing_jobs')
                  .select('status, error, result')
                  .eq('id', jobId)
                  .single();
                
                if (!finalError && finalJob) {
                  // 실제로 완료되었을 수 있음
                  if (finalJob.status === 'completed') {
                    logger.log('✅ 실제로는 이미 완료되었습니다!');
                    setUploadStep('completed');
                    setUploadProgress(100);
                    setUploadSuccess(true);
                    
                    // 마지막 파일이 아니면 상태만 초기화하고 계속 진행
                    if (currentFileIndex < totalFilesCount - 1) {
                      setUploadSuccess(false);
                      setUploadStep('idle');
                      setUploadProgress(0);
                      resolve(); // 다음 파일로 진행
                      return;
                    }
                    
                    // 마지막 파일인 경우에만 완전히 종료
                    setSelectedFiles([]);
                    if (typeof window !== 'undefined') {
                      window.dispatchEvent(new CustomEvent('docs-refresh'));
                    }
                    setTimeout(() => {
                      setUploadSuccess(false);
                      setUploadStep('idle');
                      setUploadProgress(0);
                    }, 3000);
                    resolve();
                    return;
                  }
                  
                  // 이미 실패했을 수도 있음
                  if (finalJob.status === 'failed') {
                    reject(new Error(finalJob.error || '큐 처리 실패'));
                    return;
                  }
                }
                
                // 실제로도 처리 중이면 타임아웃 처리
                logger.warn('⚠️ 큐 처리 시간 초과 - 작업을 failed 상태로 업데이트합니다');
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
                  logger.error('큐 상태 업데이트 실패:', updateError);
                }
                reject(new Error('큐 처리 시간 초과 (10분)'));
              }
            } catch (error) {
              if (isCancelled) {
                return;
              }
              logger.error('폴링 오류:', error);
              setUploadStep('error');
              setUploadError(error instanceof Error ? error.message : String(error));
              setUploadProgress(0);
              setUploading(false);
              setCurrentJobId(null);
              setCurrentDocumentId(null);
              reject(error);
            }
          };
          
          // 초기 폴링 시작
          poll();
          
          // 정리 함수 반환
          return () => {
            if (pollTimeout) {
              clearTimeout(pollTimeout);
            }
            setCurrentJobId(null);
            setCurrentDocumentId(null);
          };
          });
        };
        
        await pollQueueStatus(jobData.id, documentId, fileIndex, totalFiles);
        return; // 이 파일 업로드 완료, 다음 파일로 진행
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
      // UI 벤더 이름을 DB 값으로 변환 (첫 번째 벤더 사용)
      const dbVendor = convertVendorsToDB(vendors)[0] || "META";
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
          logger.error('JSON 파싱 오류:', jsonError, '응답:', responseText.substring(0, 200));
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
        // 413 에러는 특별 처리 (더 명확한 에러 메시지)
        if (res.status === 413) {
          const fileSizeMB = (uploadFile.size / (1024 * 1024)).toFixed(2);
          throw new Error(`파일 크기가 너무 큽니다 (${fileSizeMB}MB). 4MB 이상 파일은 클라이언트에서 직접 Storage에 업로드하거나, 파일을 분할하여 업로드해주세요.`);
        }
        throw new Error(result.error || result.message || responseText || `HTTP ${res.status}: ${res.statusText}`);
      }
      
      // 큐에 등록된 경우 (202 Accepted)
      if (res.status === 202 && result.queued) {
        logger.log('📋 큐에 등록됨:', result);
        setUploadStep('saving');
        setUploadProgress(70);
        
        // 큐에 등록 후 즉시 큐 워커 트리거 (수동 처리 버튼과 동일한 방식)
        try {
          logger.log('🚀 큐 워커 즉시 트리거 시작...');
          const consumeRes = await fetch('/api/jobs/consume', { method: 'POST' });
          const consumeResult = await consumeRes.json();
          logger.log('✅ 큐 워커 트리거 완료:', consumeResult);
          
          if (consumeRes.ok && consumeResult.success) {
            logger.log('✅ 큐 워커 처리 성공:', consumeResult.message || '작업이 처리되었습니다.');
          } else {
            logger.warn('⚠️ 큐 워커 처리 실패:', consumeResult.error || consumeResult.details || '작업 처리 중 오류가 발생했습니다.');
          }
        } catch (consumeError) {
          logger.warn('⚠️ 큐 워커 트리거 실패 (Cron Job이 처리할 수 있음):', consumeError);
          // 에러가 발생해도 폴링은 계속 진행
        }
        
        setUploadProgress(85);
        
        // 큐 상태 폴링
        const pollQueueStatus = async (jobId: string, documentId: string, currentFileIndex: number, totalFilesCount: number): Promise<void> => {
          return new Promise((resolve, reject) => {
            const maxAttempts = 120; // 최대 10분 (5초 간격) - 큰 파일 처리 대응
            let attempts = 0;
            let pollTimeout: NodeJS.Timeout | null = null;
            let isCancelled = false;
            
            // 현재 작업 ID 저장
            setCurrentJobId(jobId);
            setCurrentDocumentId(documentId);
            
            // 취소 핸들러
            const handleCancel = async () => {
              if (isCancelled) return;
              isCancelled = true;
              
              if (pollTimeout) {
                clearTimeout(pollTimeout);
                pollTimeout = null;
              }
              
              try {
                logger.log('🛑 큐 처리 취소 요청:', jobId);
                const cancelRes = await fetch('/api/jobs/action', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ jobId, action: 'cancel' })
                });
                
                const cancelResult = await cancelRes.json();
                if (cancelRes.ok && cancelResult.success) {
                  logger.log('✅ 큐 처리 취소 완료');
                  setUploadStep('idle');
                  setUploadProgress(0);
                  setUploadError('사용자가 큐 처리를 취소했습니다.');
                  setCurrentJobId(null);
                  setCurrentDocumentId(null);
                  
                  toast.warning('큐 처리 취소', {
                    description: '큐 처리가 취소되었습니다.',
                    duration: 3000,
                  });
                  
                  // 문서 상태도 cancelled로 업데이트
                  const supabaseClient = createClient();
                  await supabaseClient
                    .from('documents')
                    .update({ 
                      status: 'failed',
                      updated_at: new Date().toISOString()
                    })
                    .eq('id', documentId);
                  
                  reject(new Error('사용자가 큐 처리를 취소했습니다.'));
                } else {
                  throw new Error(cancelResult.error || '취소 실패');
                }
              } catch (cancelError) {
                logger.error('❌ 큐 처리 취소 실패:', cancelError);
                toast.error('취소 실패', {
                  description: cancelError instanceof Error ? cancelError.message : '큐 처리 취소에 실패했습니다.',
                  duration: 3000,
                });
                // 취소 실패해도 폴링은 계속 진행
                isCancelled = false;
              }
            };
            
            // AbortController에 취소 핸들러 저장
            if (!pollingAbortControllerRef.current) {
              pollingAbortControllerRef.current = new AbortController();
            }
            pollingAbortControllerRef.current.signal.addEventListener('abort', handleCancel);
            
            const poll = async () => {
              if (isCancelled) {
                return;
              }
              
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
                  logger.error('큐 상태 조회 오류:', error);
                  if (attempts >= maxAttempts) {
                    reject(new Error('큐 상태 확인 시간 초과'));
                    return;
                  }
                  if (!isCancelled) {
                    pollTimeout = setTimeout(poll, 5000);
                  }
                  return;
                }
                
                logger.log(`📊 큐 상태 (${attempts}/${maxAttempts}):`, job);
                
                // 상태 업데이트
                if (job.status === 'queued') {
                  setUploadStep('saving');
                  setUploadProgress(90 + (attempts / maxAttempts) * 5); // 90-95%
                } else if (job.status === 'processing') {
                  setUploadStep('saving');
                  setUploadProgress(95 + (attempts / maxAttempts) * 3); // 95-98%
                } else if (job.status === 'cancelled') {
                  setUploadStep('idle');
                  setUploadProgress(0);
                  setUploadError('큐 처리가 취소되었습니다.');
                  setCurrentJobId(null);
                  setCurrentDocumentId(null);
                  reject(new Error('큐 처리가 취소되었습니다.'));
                  return;
                } else if (job.status === 'completed') {
                  setUploadStep('completed');
                  setUploadProgress(100);
                  setUploadSuccess(true);
                  logger.log('✅ 큐 처리 완료');
                  
                  // 문서 목록 새로고침
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('docs-refresh'));
                  }
                  
                  // 마지막 파일이 아니면 상태만 초기화하고 계속 진행
                  if (currentFileIndex < totalFilesCount - 1) {
                    setUploadSuccess(false);
                    setUploadStep('idle');
                    setUploadProgress(0);
                    resolve(); // 다음 파일로 진행
                    return;
                  }
                  
                  // 마지막 파일인 경우에만 완전히 종료
                  setSelectedFiles([]);
                  setCurrentJobId(null);
                  setCurrentDocumentId(null);
                  
                  // 3초 후 상태 초기화
                  setTimeout(() => {
                    setUploadSuccess(false);
                    setUploadStep('idle');
                    setUploadProgress(0);
                  }, 3000);
                  resolve();
                  return;
                } else if (job.status === 'failed') {
                  setCurrentJobId(null);
                  setCurrentDocumentId(null);
                  reject(new Error(job.error || '큐 처리 실패'));
                  return;
                }
                
                // 계속 폴링
                if (attempts < maxAttempts && !isCancelled) {
                  pollTimeout = setTimeout(poll, 5000); // 5초마다 확인
                } else {
                  // 타임아웃 전에 실제 작업 상태를 한 번 더 확인
                  logger.warn('⚠️ 클라이언트 폴링 타임아웃 - 실제 작업 상태 최종 확인 중...');
                  const { data: finalJob, error: finalError } = await supabaseClient
                    .from('processing_jobs')
                    .select('status, error, result')
                    .eq('id', jobId)
                    .single();
                  
                  if (!finalError && finalJob) {
                    // 실제로 완료되었을 수 있음
                    if (finalJob.status === 'completed') {
                      logger.log('✅ 실제로는 이미 완료되었습니다!');
                      setUploadStep('completed');
                      setUploadProgress(100);
                      setUploadSuccess(true);
                      
                      // 마지막 파일이 아니면 상태만 초기화하고 계속 진행
                      if (currentFileIndex < totalFilesCount - 1) {
                        setUploadSuccess(false);
                        setUploadStep('idle');
                        setUploadProgress(0);
                        resolve(); // 다음 파일로 진행
                        return;
                      }
                      
                      // 마지막 파일인 경우에만 완전히 종료
                      setSelectedFiles([]);
                      setCurrentJobId(null);
                      setCurrentDocumentId(null);
                      
                      // 3초 후 상태 초기화
                      setTimeout(() => {
                        setUploadSuccess(false);
                        setUploadStep('idle');
                        setUploadProgress(0);
                      }, 3000);
                      resolve();
                      return;
                    }
                    
                    // 이미 실패했을 수도 있음
                    if (finalJob.status === 'failed') {
                      setCurrentJobId(null);
                      setCurrentDocumentId(null);
                      reject(new Error(finalJob.error || '큐 처리 실패'));
                      return;
                    }
                  }
                  
                  // 실제로도 처리 중이면 타임아웃 처리
                  logger.warn('⚠️ 큐 처리 시간 초과 - 작업을 failed 상태로 업데이트합니다');
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
                    logger.error('큐 상태 업데이트 실패:', updateError);
                  }
                  setCurrentJobId(null);
                  setCurrentDocumentId(null);
                  reject(new Error('큐 처리 시간 초과 (10분)'));
                }
              } catch (error) {
                if (isCancelled) {
                  return;
                }
                logger.error('폴링 오류:', error);
                setUploadStep('error');
                setUploadError(error instanceof Error ? error.message : String(error));
                setUploadProgress(0);
                setUploading(false);
                setCurrentJobId(null);
                setCurrentDocumentId(null);
                reject(error);
              }
            };
            
            // 초기 폴링 시작
            poll();
            
            // 정리 함수 반환
            return () => {
              if (pollTimeout) {
                clearTimeout(pollTimeout);
              }
              setCurrentJobId(null);
              setCurrentDocumentId(null);
            };
          });
        };
        
        if (result.jobId && result.documentId) {
          await pollQueueStatus(result.jobId, result.documentId, fileIndex, totalFiles);
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
      logger.log('✅ 업로드 성공:', result);
      
      // 문서 목록 새로고침 트리거 (전역 이벤트)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('docs-refresh'));
      }
      
      // 마지막 파일이 아니면 상태만 초기화하고 계속 진행
      if (fileIndex < totalFiles - 1) {
        setUploadSuccess(false);
        setUploadStep('idle');
        setUploadProgress(0);
        return; // 다음 파일로 진행
      }
      
      // 마지막 파일인 경우에만 완전히 종료
      setSelectedFiles([]);
      
      // 파일 입력 초기화
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
      // 3초 후 성공 메시지 및 진행 상태 숨김
      setTimeout(() => {
        setUploadSuccess(false);
        setUploadStep('idle');
        setUploadProgress(0);
      }, 3000);
      };
      
      // 모든 파일을 순차적으로 업로드
      const uploadResults: Array<{ fileName: string; success: boolean; error?: string }> = [];
      
      for (let i = 0; i < filesToUpload.length; i++) {
        const uploadFile = filesToUpload[i];
        if (!uploadFile) continue;
        
        try {
        await uploadSingleFile(uploadFile, i, filesToUpload.length);
          uploadResults.push({ fileName: uploadFile.name, success: true });
        } catch (fileError) {
          // 개별 파일 업로드 실패 시에도 다음 파일로 계속 진행
          const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
          logger.error(`파일 업로드 실패 (${uploadFile.name}):`, fileError);
          
          uploadResults.push({ 
            fileName: uploadFile.name, 
            success: false, 
            error: errorMessage 
          });
          
          // 413 에러는 특별 처리 (파일 크기 초과)
          if (errorMessage.includes('413') || errorMessage.includes('Payload Too Large') || errorMessage.includes('파일 크기가 너무 큽니다')) {
            toast.error('파일 크기 초과', {
              description: `${uploadFile.name}: 4MB 이상 파일은 Storage에 직접 업로드됩니다. (현재: ${(uploadFile.size / (1024 * 1024)).toFixed(2)}MB)`,
              duration: 5000,
            });
          } else {
            toast.error('파일 업로드 실패', {
              description: `${uploadFile.name}: ${errorMessage}`,
              duration: 5000,
            });
          }
          
          // 에러 발생 시 상태 초기화 (다음 파일을 위해)
          setUploadStep('idle');
          setUploadProgress(0);
          setUploadError(null);
          
          // 다음 파일로 계속 진행
          continue;
        }
      }
      
      // 모든 파일 처리 완료 후 결과 요약
      const successCount = uploadResults.filter(r => r.success).length;
      const failCount = uploadResults.filter(r => !r.success).length;
      
      if (successCount > 0 && failCount === 0) {
        toast.success('모든 파일 업로드 완료', {
          description: `${successCount}개 파일이 성공적으로 업로드되었습니다.`,
          duration: 3000,
        });
      } else if (successCount > 0 && failCount > 0) {
        toast.warning('일부 파일 업로드 실패', {
          description: `${successCount}개 성공, ${failCount}개 실패`,
          duration: 5000,
        });
      } else if (failCount > 0) {
        toast.error('모든 파일 업로드 실패', {
          description: `${failCount}개 파일 업로드에 실패했습니다.`,
          duration: 5000,
        });
        setUploadStep('error');
        setUploadError(`${failCount}개 파일 업로드 실패`);
      }
    } catch (e) {
      // 예상치 못한 전체 업로드 프로세스 에러
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error("upload error", e);
      setUploadStep('error');
      setUploadError(errorMessage);
      setUploadProgress(0);
      
      toast.error('파일 업로드 실패', {  
        description: errorMessage,
        duration: 5000,
      });
    } finally {
      setUploading(false);
    }
  }, [vendors]);

  // 드래그 앤 드롭 핸들러
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
    
    // 벤더 선택 확인
    if (vendors.length === 0) {
      toast.error('벤더를 선택해주세요', {
        description: '파일 업로드 전에 벤더를 선택해야 합니다.',
        duration: 4000,
      });
      return;
    }
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      // PDF, DOCX, TXT 파일만 필터링
      const validFiles = files.filter(f => {
        const ext = f.name.toLowerCase().split('.').pop();
        return ['pdf', 'docx', 'txt'].includes(ext || '');
      });
      
      if (validFiles.length > 0) {
        setSelectedFiles(validFiles);
        handleUpload(validFiles);
      } else {
        toast.error('지원하지 않는 파일 형식', {
          description: 'PDF, DOCX, TXT 파일만 업로드 가능합니다.',
        });
      }
    }
  }, [handleUpload, vendors]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setSelectedFiles(files);
    }
  }, []);

  const handleCrawl = useCallback(async () => {
    try {
      setCrawling(true);
      setCrawlProgressValue(12);
      setCrawlProgressLabel('작업 준비 중...');
      setCrawlResult(null);
      const urlInput = document.getElementById("seed-url-input") as HTMLInputElement | null;
      const url = urlInput?.value?.trim();
      
      if (!url) {
        toast.error('URL을 입력해주세요', { duration: 3000 });
        setCrawling(false);
        setCrawlProgressValue(0);
        setCrawlProgressLabel('');
        return;
      }

      // 벤더 선택 확인
      if (vendors.length === 0) {
        toast.error('벤더를 선택해주세요', {
          description: 'URL 크롤링 전에 벤더를 선택해야 합니다.',
          duration: 4000,
        });
        setCrawling(false);
        setCrawlProgressValue(0);
        setCrawlProgressLabel('');
        return;
      }

      // URL 유효성 검사
      try {
        new URL(url);
      } catch {
        toast.error('유효한 URL을 입력해주세요', { duration: 3000 });
        setCrawling(false);
        setCrawlProgressValue(0);
        setCrawlProgressLabel('');
        return;
      }

      // UI 벤더 배열을 DB 값 배열로 변환
      const dbVendors = convertVendorsToDB(vendors);
      
      // 디버깅: extractSubPages 값 확인
      logger.log('🔍 크롤링 시작 전 extractSubPages 확인:', {
        extractSubPages,
        extractSubPagesType: typeof extractSubPages,
        crawlOptions,
        url
      });
      
      // extractSubPages를 명시적으로 boolean으로 변환
      // 타입 안전성을 위해 타입 가드 사용
      const extractSubPagesBoolean = extractSubPages === true || String(extractSubPages) === 'true';
      
      const payload = { 
        url, 
        vendors: dbVendors,
        domainLimit: crawlOptions.domainLimit,
        respectRobots: crawlOptions.respectRobots,
        maxDepth: parseInt(crawlOptions.maxDepth, 10),
        extractSubPages: extractSubPagesBoolean, // 명시적으로 boolean으로 변환
      };
      
      logger.log('📤 CRAWL_SEED payload:', {
        ...payload,
        extractSubPagesOriginal: extractSubPages,
        extractSubPagesType: typeof extractSubPages,
        extractSubPagesBoolean,
        extractSubPagesBooleanType: typeof extractSubPagesBoolean
      });
      
      // 큐 등록: jobType CRAWL_SEED
      const response = await fetch("/api/jobs/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobType: "CRAWL_SEED",
          priority: 5,
          payload,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const jobId = result.jobId;
      
      setCrawlProgressValue(15);
      setCrawlProgressLabel('큐에 작업을 등록했습니다. 워커를 호출 중...');
      setCrawlResult(null);
      
      if (jobId) {
        setCrawlJobId(jobId);
        toast.success('크롤링 작업이 큐에 등록되었습니다', { duration: 3000 });
      } else {
        toast.error('작업 ID를 받지 못했습니다', { duration: 3000 });
        setCrawling(false);
        setCrawlProgressLabel('작업 ID 수신 실패');
        setCrawlProgressValue(0);
        return;
      }
      
      // URL 입력 필드 초기화
      if (urlInput) {
        urlInput.value = '';
      }

      // 큐 워커 즉시 트리거 (파일 업로드와 동일한 방식)
      // 참고: 큐 워커 호출 실패는 문제가 되지 않음 (Cron Job이 자동으로 처리)
      try {
        const consumeRes = await fetch('/api/jobs/consume', { method: 'POST' });
        let consumeResult: any = null;
        try {
          consumeResult = await consumeRes.clone().json();
        } catch {
          consumeResult = null;
        }

        if (consumeRes.ok && consumeResult?.success) {
          toast.success('URL 크롤링 작업 처리 시작', {
            description: consumeResult.message || '큐 워커가 작업을 처리 중입니다.',
            duration: 4000,
          });
          setCrawlProgressValue(30);
          setCrawlProgressLabel('큐 워커가 작업을 처리 중입니다. 상태 확인 중...');
          
          // 크롤링 진행 상황 폴링 시작 (isCrawling은 true로 유지)
          pollCrawlStatus(jobId);
          // finally 블록에서 setCrawling(false)를 호출하지 않도록 여기서 return하지 않음
          // 폴링이 완료되면 pollCrawlStatus 내부에서 setCrawling(false) 호출
          return;
        } else {
          // HTTP 405 등의 에러는 정상적인 상황일 수 있음 (Cron Job이 처리)
          // 사용자에게 불필요한 경고를 표시하지 않고 조용히 폴링 시작
          if (consumeRes.status === 405) {
            // 405 에러는 무시 (Cron Job이 자동 처리)
            logger.log('ℹ️ 큐 워커 직접 호출 실패 (정상) - Cron Job이 자동 처리합니다.');
          } else {
            // 다른 에러는 로그만 기록 (사용자에게는 경고 표시하지 않음)
            logger.log('ℹ️ 큐 워커 호출 상태:', {
              status: consumeRes.status,
              error: consumeResult?.error || consumeResult?.details,
              note: 'Cron Job이 자동으로 처리하므로 문제 없습니다.'
            });
          }
          
          setCrawlProgressLabel('크롤링 작업이 큐에 등록되었습니다. 처리 상태 확인 중...');
          setCrawlProgressValue(25);
          
          // 폴백: Cron Job이 처리할 수 있으므로 폴링 시작
          pollCrawlStatus(jobId);
          // 폴링 시작했으므로 isCrawling은 true로 유지
          return;
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('queue-refresh'));
        }

        logger.log('✅ 크롤링 큐 워커 트리거 완료:', consumeResult);
      } catch (consumeError) {
        logger.warn('⚠️ 크롤링 큐 워커 트리거 실패 (Cron Job이 처리할 수 있음):', consumeError);
        toast.info('큐 워커 실행을 곧 자동으로 재시도합니다', {
          description: 'Cron Job이 곧 처리할 예정입니다.',
          duration: 4000,
        });
        setCrawlProgressLabel('Cron Job이 작업을 처리하도록 대기 중입니다...');
        setCrawlProgressValue(20);
        
        // 폴백: Cron Job이 처리할 수 있으므로 폴링 시작
        pollCrawlStatus(jobId);
        // 폴링 시작했으므로 isCrawling은 true로 유지
        return;
      }
    } catch (e) {
      logger.error("crawl enqueue error", e);
      const errorMessage = e instanceof Error ? e.message : '크롤링 작업 등록에 실패했습니다';
      toast.error(errorMessage, { duration: 5000 });
      setCrawlProgressLabel('크롤링 실패');
      setCrawlProgressValue(0);
      setCrawlResult({ error: errorMessage });
      setCrawling(false); // 에러 발생 시에만 false로 설정
    }
    // 성공적으로 폴링이 시작되면 finally에서 setCrawling(false)를 호출하지 않음
  }, [vendors, extractSubPages, crawlOptions, pollCrawlStatus]);

  return (
    <Tabs defaultValue="upload" className="w-full">
      <TabsList className="grid grid-cols-2 w-full bg-gray-800/50 border-gray-700" role="tablist" aria-label="업로드 및 크롤링 탭">
        <TabsTrigger 
          value="upload" 
          className="flex items-center space-x-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
          aria-label="파일 업로드 탭"
        >
          <Upload className="w-4 h-4" aria-hidden="true" />
          <span>파일 업로드</span>
        </TabsTrigger>
        <TabsTrigger 
          value="crawl" 
          className="flex items-center space-x-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"
          aria-label="URL 크롤링 탭"
        >
          <Globe className="w-4 h-4" aria-hidden="true" />
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
            {/* 벤더 선택 (Popover 멀티 선택) */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-primary-enhanced">
                벤더 선택 <span className="text-red-400">*</span>
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between h-10 bg-gray-900/70 border-white/10 text-white hover:bg-gray-800/70"
                  >
                    <span className="text-sm">
                      {vendors.length === 0 
                        ? "벤더를 선택하세요" 
                        : vendors.length === 1
                        ? vendors[0]
                        : `${vendors.length}개 선택됨`}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2 bg-gray-900 border-gray-700" align="start">
                  <div className="space-y-2">
                    {ALL_VENDORS.map((vendor) => (
                      <div key={vendor} className="flex items-center space-x-2">
                        <Checkbox
                          id={`upload-vendor-${vendor}`}
                          checked={vendors.includes(vendor)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              onVendorsChange([...vendors, vendor]);
                            } else {
                              onVendorsChange(vendors.filter(v => v !== vendor));
                            }
                          }}
                        />
                        <Label
                          htmlFor={`upload-vendor-${vendor}`}
                          className="text-sm text-white cursor-pointer flex-1"
                        >
                          {vendor}
                        </Label>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {vendors.length === 0 && (
                <p className="text-xs text-yellow-400">
                  파일 업로드 전에 벤더를 선택해야 합니다.
                </p>
              )}
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
                ${vendors.length === 0 ? 'border-yellow-500/50 bg-yellow-500/5' : ''}
              `}
              onClick={() => {
                if (vendors.length === 0) {
                  toast.error('벤더를 선택해주세요', {
                    description: '파일 업로드 전에 벤더를 선택해야 합니다.',
                    duration: 4000,
                  });
                  return;
                }
                fileInputRef.current?.click();
              }}
            >
              <div className="flex flex-col items-center justify-center gap-3 text-center w-full">
                <Upload className={`w-8 h-8 ${dragActive ? 'text-blue-400' : 'text-gray-400'}`} />
                <div className="w-full">
                  <p className="text-sm text-primary-enhanced font-semibold">
                    파일을 드래그하여 놓거나 클릭하여 선택하세요
                  </p>
                  <p className="text-xs text-muted-enhanced mt-1">
                    PDF, DOCX, TXT 파일 지원 (멀티 파일 선택 가능)
                  </p>
                  <p className="text-xs text-yellow-400 mt-1 font-medium">
                    최대 파일 크기: 15MB
                  </p>
                </div>
                {selectedFiles.length > 0 && (
                  <div className="mt-2 space-y-1 w-full px-2">
                    <p className="text-xs text-blue-300 font-medium">
                      선택된 파일: {selectedFiles.length}개
                    </p>
                    <div className="text-xs text-gray-400 max-h-20 overflow-y-auto w-full overflow-x-hidden">
                      {selectedFiles.map((f, idx) => (
                        <div key={idx} className="truncate w-full text-left">• {f.name}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              {/* 숨겨진 파일 입력 */}
                <input 
                ref={fileInputRef} 
                type="file" 
                onChange={handleFileChange}
                accept=".pdf,.docx,.txt"
                multiple
                className="hidden"
              />
            </div>
            
            <div className="flex items-center gap-3">
              <Button 
                disabled={isUploading || selectedFiles.length === 0 || vendors.length === 0} 
                onClick={() => handleUpload()}
                className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  <div className="flex items-center justify-between gap-2">
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
                    {/* 큐 처리 중일 때만 취소 버튼 표시 */}
                    {uploadStep === 'saving' && currentJobId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          if (!currentJobId || !pollingAbortControllerRef.current) return;
                          
                          try {
                            // AbortController를 통해 취소 핸들러 트리거
                            pollingAbortControllerRef.current.abort();
                          } catch (error) {
                            logger.error('취소 버튼 클릭 오류:', error);
                            toast.error('취소 실패', {
                              description: '큐 처리 취소에 실패했습니다.',
                              duration: 3000,
                            });
                          }
                        }}
                        className="h-7 px-3 text-xs bg-red-500/20 border-red-500/50 text-red-300 hover:bg-red-500/30 hover:text-red-200"
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        취소
                      </Button>
                    )}
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
            {/* 벤더 선택 (Popover 멀티 선택) */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-primary-enhanced">
                벤더 선택 <span className="text-red-400">*</span>
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-between h-10 bg-gray-900/70 border-white/10 text-white hover:bg-gray-800/70"
                  >
                    <span className="text-sm">
                      {vendors.length === 0 
                        ? "벤더를 선택하세요" 
                        : vendors.length === 1
                        ? vendors[0]
                        : `${vendors.length}개 선택됨`}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2 bg-gray-900 border-gray-700" align="start">
                  <div className="space-y-2">
                    {ALL_VENDORS.map((vendor) => (
                      <div key={vendor} className="flex items-center space-x-2">
                        <Checkbox
                          id={`crawl-vendor-${vendor}`}
                          checked={vendors.includes(vendor)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              onVendorsChange([...vendors, vendor]);
                            } else {
                              onVendorsChange(vendors.filter(v => v !== vendor));
                            }
                          }}
                        />
                        <Label
                          htmlFor={`crawl-vendor-${vendor}`}
                          className="text-sm text-white cursor-pointer flex-1"
                        >
                          {vendor}
                        </Label>
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {vendors.length === 0 && (
                <p className="text-xs text-yellow-400">
                  URL 크롤링 전에 벤더를 선택해야 합니다.
                </p>
              )}
            </div>
            <Input 
              id="seed-url-input" 
              placeholder="Seed URL을 입력하세요 (예: https://example.com/policy)" 
              className="h-11 rounded-xl border border-white/10 bg-gray-900/70 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-transparent transition"
            />
            {/* 그리드 헤더 형태 */}
            <div className="hidden sm:grid grid-cols-3 gap-3 px-1 mb-1 text-center">
              <div className="text-[11px] text-secondary-enhanced font-semibold">도메인 한정</div>
              <div className="text-[11px] text-secondary-enhanced font-semibold">robots.txt 준수</div>
              <div className="text-[11px] text-secondary-enhanced font-semibold flex items-center justify-center gap-1">
                최대 심도
                <button
                  type="button"
                  onClick={() => {
                    toast.info('최대 심도', {
                      description: 'Seed URL에서 몇 단계 깊이까지 크롤링할지 설정합니다.\n• 심도 1: Seed URL만\n• 심도 2: Seed URL → 링크된 페이지\n• 심도 3: Seed URL → 링크된 페이지 → 그 페이지의 링크',
                      duration: 5000,
                    });
                  }}
                  className="hover:opacity-70 transition-opacity"
                >
                  <Info className="w-3 h-3 text-gray-400 hover:text-blue-400 cursor-help" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="border border-gray-600 rounded-md px-3 py-4 bg-gray-800/30 flex flex-col items-center justify-center min-h-[64px]">
                <Switch 
                  checked={crawlOptions.domainLimit}
                  onCheckedChange={(checked) => 
                    setCrawlOptions(prev => ({ ...prev, domainLimit: checked }))
                  }
                />
              </div>
              <div className="border border-gray-600 rounded-md px-3 py-4 bg-gray-800/30 flex flex-col items-center justify-center min-h-[64px]">
                <Switch 
                  checked={crawlOptions.respectRobots}
                  onCheckedChange={(checked) => 
                    setCrawlOptions(prev => ({ ...prev, respectRobots: checked }))
                  }
                />
              </div>
              <div className="border border-gray-600 rounded-md px-3 py-4 bg-gray-800/30 flex flex-col items-center justify-center min-h-[64px]">
                <Select 
                  value={crawlOptions.maxDepth}
                  onValueChange={(value) => 
                    setCrawlOptions(prev => ({ ...prev, maxDepth: value }))
                  }
                >
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

            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-950/90 px-5 py-4 flex items-center justify-between shadow-lg">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-purple-500/25 flex items-center justify-center text-purple-200 shadow-inner">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">하위 페이지 자동 추출 (사이트맵 기반)</div>
                  <p className="text-xs text-white/60 mt-1">
                    활성화하면 선택된 URL의 하위 페이지를 사이트맵/링크 기반으로 탐색하여 함께 인덱싱합니다.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={`px-3 py-1 text-xs ${extractSubPages ? 'text-purple-200 border-purple-400/40' : 'text-gray-300 border-gray-500/40'}`}>
                  {extractSubPages ? '활성화' : '비활성화'}
                </Badge>
                <Switch 
                  checked={extractSubPages}
                  onCheckedChange={(checked) => setExtractSubPages(checked as boolean)}
                  className="scale-90"
                />
              </div>
            </div>

            {(crawlJobId || crawlProgressValue > 0 || crawlResult) && (
              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/85 via-gray-900/60 to-gray-950/90 px-5 py-5 space-y-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-white">실시간 크롤링 진행 상태</h4>
                    <p className="text-xs text-white/60 mt-1">큐 작업 상태와 하위 페이지 처리 현황을 확인할 수 있습니다.</p>
                  </div>
                  <Badge variant="outline" className="text-xs text-blue-200 border-blue-400/40 px-3 py-1">
                    {crawlProgressValue}%
                  </Badge>
                </div>
                <Progress value={crawlProgressValue} className="h-2" />
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <Loader2 className={`w-4 h-4 ${crawlProgressValue >= 100 ? 'text-emerald-300' : 'text-blue-300 animate-spin'}`} />
                  <span>{crawlProgressLabel || '대기 중'}</span>
                </div>
                {crawlResult && (
                  <div className="space-y-3 rounded-xl bg-gray-800/40 border border-gray-700/50 p-4">
                    {crawlResult.error ? (
                      <div className="text-sm text-red-300 font-semibold">{crawlResult.error}</div>
                    ) : (
                      <div className="space-y-2 text-sm text-white/80">
                        <div className="font-semibold text-white">{crawlResult.title || '크롤링 결과'}</div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-white/60">
                          <span>주요 URL: <span className="text-blue-200">{crawlResult.url}</span></span>
                          <span>청크 수: <span className="text-emerald-300 font-semibold">{crawlResult.chunkCount ?? 0}</span></span>
                          {crawlResult.subPageCount !== undefined && (
                            <span>하위 페이지: <span className="text-emerald-300 font-semibold">{crawlResult.subPageCount}</span></span>
                          )}
                        </div>
                        {crawlResult.subPages && Array.isArray(crawlResult.subPages) && crawlResult.subPages.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs text-white/60">처리된 하위 페이지 목록</div>
                            <div className="max-h-40 overflow-y-auto space-y-2">
                              {crawlResult.subPages.map((sub: any, idx: number) => (
                                <div
                                  key={sub.url ?? idx}
                                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-gray-900/60 border border-gray-700/60"
                                >
                                  <span className="text-xs text-white/70 truncate flex-1">{sub.url}</span>
                                  <span className={`text-xs font-semibold ${sub.success ? 'text-emerald-300' : 'text-red-300'}`}>
                                    {sub.success ? `${sub.chunkCount ?? 0} chunks` : '실패'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button 
                disabled={isCrawling || vendors.length === 0}
                onClick={handleCrawl}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCrawling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Globe className="w-4 h-4 mr-2" />} 
                크롤 시작
              </Button>
              {isCrawling && crawlJobId && (
                <Button 
                  onClick={handleCancelCrawl}
                  variant="destructive"
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  크롤 취소
                </Button>
              )}
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
  onViewModeChange,
  searchQuery,
  onSearchQueryChange,
  isLoading
}: { 
  vendors: string[];
  statusFilter: string;
  typeFilter: string;
  onStatusFilterChange: (value: string) => void;
  onTypeFilterChange: (value: string) => void;
  viewMode: "card" | "list";
  onViewModeChange: (v: "card" | "list") => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  isLoading?: boolean;
}) {
  const isLoadingState = isLoading ?? false;
  const toolbarButtonClass = "bg-gray-800/50 border-gray-600 text-white hover:bg-gray-700/50";
  const exportButtonClass = "bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700";
  const searchInputClass = "h-11 rounded-xl border border-white/10 bg-gradient-to-r from-gray-900/80 via-gray-900/60 to-gray-900/80 pl-11 pr-4 text-sm text-white placeholder:text-gray-300 placeholder:opacity-80 shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-transparent transition-all";
  const selectTriggerClass = "h-11 rounded-xl border border-white/10 bg-gray-900/70 text-sm text-white hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-transparent transition-all";

  return (
    <Card className="card-enhanced">
      <CardContent className="py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-300/70" />
            <Input 
              className={searchInputClass}
              placeholder="문서 제목, URL, 메타데이터 검색" 
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              aria-label="문서 검색"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Select value={statusFilter} onValueChange={onStatusFilterChange}>
              <SelectTrigger className={selectTriggerClass + " w-full sm:w-auto min-w-[120px]"} aria-label="상태 필터">
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
              <SelectTrigger className={selectTriggerClass + " w-full sm:w-auto min-w-[120px]"} aria-label="유형 필터">
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
              <SelectTrigger className={selectTriggerClass + " w-full sm:w-auto min-w-[120px]"} aria-label="보기 모드">
                <SelectValue placeholder="보기" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="card">카드</SelectItem>
                <SelectItem value="list">리스트</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button 
              variant="outline"
              className={toolbarButtonClass + " flex-1 sm:flex-initial"}
              disabled={isLoadingState}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('docs-refresh-click'));
                  toast.success('문서 목록을 새로 고침했습니다', { duration: 2000 });
                }
              }}
              aria-label="문서 목록 새로고침"
            >
              <RefreshCw className={`w-4 h-4 sm:mr-2 ${isLoadingState ? 'animate-spin' : ''}`} /> 
              <span className="hidden sm:inline">새로고침</span>
            </Button>
            <Button 
              className={exportButtonClass + " flex-1 sm:flex-initial"}
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('docs-export'));
                }
              }}
              aria-label="문서 내보내기"
            >
              <Download className="w-4 h-4 sm:mr-2" /> 
              <span className="hidden sm:inline">내보내기</span>
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
  viewMode,
  searchQuery,
  onRefreshStateChange
}: { 
  vendors: string[];
  statusFilter: string;
  typeFilter: string;
  viewMode: "card" | "list";
  searchQuery: string;
  onRefreshStateChange?: (loading: boolean) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [isClient, setIsClient] = useState(false);
  
  // 클라이언트 마운트 확인 (Hydration 오류 방지)
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  // 컴포넌트 마운트 시 디버그 로그 (개발 모드 전용)
  useEffect(() => {
    if (isClient && typeof window !== 'undefined') {
      logger.log('[그룹화] DocsTable 컴포넌트 마운트됨', {
        timestamp: new Date().toISOString(),
        vendors,
        statusFilter,
        typeFilter,
        viewMode,
        searchQuery
      });
    }
  }, [isClient, vendors, statusFilter, typeFilter, viewMode, searchQuery]);
  
  // 큐 처리 중인 문서 ID 목록 조회
  const { data: queuedDocumentIds } = useQuery({
    queryKey: ["queued-documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("document_id")
        .in("status", ["queued", "processing"]);
      
      if (error) {
        logger.error('큐 문서 조회 오류:', error);
        return [];
      }
      
      return (data || []).map(job => job.document_id);
    },
    refetchInterval: 5000, // 5초마다 큐 상태 확인
  });
  
  const { data, isLoading, refetch: refetchDocuments } = useQuery({
    queryKey: ["admin-docs", vendors, statusFilter, typeFilter, searchQuery],
    queryFn: async () => {
      // 벤더가 선택되지 않았으면 빈 배열 반환
      if (!vendors || vendors.length === 0) {
        return [];
      }
      
      // 디버깅: 모든 문서 조회 (벤더 필터 없이) - RLS 정책 확인용
      const { data: allDocs, error: allDocsError, count: allDocsCount } = await supabase
        .from("documents")
        .select("id,title,source_vendor,status,type", { count: 'exact' })
        .order("updated_at", { ascending: false })
        .limit(20);
      
      console.log('🔍 전체 문서 조회 결과:', {
        count: allDocsCount,
        returned: allDocs?.length || 0,
        error: allDocsError ? {
          message: allDocsError.message,
          code: allDocsError.code,
          details: allDocsError.details,
          hint: allDocsError.hint
        } : null
      });
      
      if (allDocsError) {
        console.error('❌ 모든 문서 조회 오류:', allDocsError);
      } else {
        console.log('🔍 DB의 모든 문서 (최근 20개):', allDocs?.map((d: any) => ({ 
          id: d.id, 
          title: d.title, 
          source_vendor: d.source_vendor,
          source_vendor_type: typeof d.source_vendor,
          status: d.status,
          type: d.type
        })));
        
        // Naver 관련 문서 찾기 (대소문자 구분 없이)
        const naverDocs = allDocs?.filter((d: any) => {
          const vendor = String(d.source_vendor || '').toUpperCase();
          const title = String(d.title || '').toLowerCase();
          return vendor === 'NAVER' || 
                 title.includes('naver') ||
                 title.includes('네이버');
        });
        console.log('🔍 Naver 관련 문서 (필터링 결과):', {
          count: naverDocs?.length || 0,
          docs: naverDocs?.map((d: any) => ({ 
            id: d.id, 
            title: d.title, 
            source_vendor: d.source_vendor,
            status: d.status
          }))
        });
      }
      
      let q = supabase.from("documents").select("id,title,type,status,updated_at,chunk_count,source_vendor,url,main_document_id").order("updated_at", { ascending: false }).limit(60);
      
      // 벤더 필터 (항상 적용)
      const dbVendors = convertVendorsToDB(vendors);
      console.log('🔍 벤더 필터링 디버그:', { 
        selectedVendors: vendors, 
        dbVendors, 
        mapping: vendors.map(v => ({ ui: v, db: VENDOR_TO_DB_MAP[v] }))
      });
      
      if (dbVendors.length > 0) {
        // ENUM 타입 필터링: .in() 메서드 사용
        // ENUM 타입과의 호환성을 위해 명시적으로 배열로 전달
        q = q.in("source_vendor", dbVendors);
        console.log('🔍 쿼리 조건:', { 
          field: 'source_vendor', 
          values: dbVendors, 
          operator: 'IN',
          queryString: `source_vendor IN (${dbVendors.map(v => `'${v}'`).join(', ')})`
        });
      } else {
        // 벤더 변환 실패 시 빈 배열 반환
        console.warn('⚠️ 벤더 변환 실패:', vendors);
        return [];
      }
      
      // 디버깅: 쿼리 실행 전 최종 쿼리 확인
      console.log('🔍 최종 쿼리 조건:', {
        table: 'documents',
        filters: {
          source_vendor: dbVendors,
          status: statusFilter === "all" ? "모든 상태" : statusFilter,
          type: typeFilter === "all" ? "모든 타입" : typeFilter
        },
        limit: 60
      });
      
      // 상태 필터
      if (statusFilter && statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }
      // statusFilter가 "all"일 때는 상태 필터를 적용하지 않음 (모든 상태의 문서 표시)
      
      // 유형 필터는 클라이언트 측에서 처리 (서버 쿼리에서는 제거)
      // 모든 문서를 가져온 후 클라이언트에서 type에 따라 필터링
      // 이렇게 하면 type이 'file'인 문서도 정상적으로 표시됨
      
      const { data: documents, error } = await q;
      
      if (error) {
        console.error('❌ 문서 조회 오류:', error);
        console.error('❌ 쿼리 상세:', {
          table: 'documents',
          filters: {
            source_vendor: dbVendors,
            status: statusFilter === "all" ? "모든 상태" : statusFilter,
            type: typeFilter === "all" ? "모든 타입" : typeFilter
          },
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }
      
      // 클라이언트 측 벤더 필터링 (ENUM 타입 호환성 문제 대응)
      // DB 쿼리에서 필터링이 제대로 작동하지 않을 경우를 대비하여
      let filteredDocuments = documents || [];
      if (dbVendors.length > 0 && filteredDocuments.length > 0) {
        filteredDocuments = filteredDocuments.filter((d: any) => {
          const docVendor = String(d.source_vendor || '').toUpperCase();
          return dbVendors.some(v => String(v).toUpperCase() === docVendor);
        });
        console.log('🔍 클라이언트 측 벤더 필터링 결과:', {
          before: documents?.length || 0,
          after: filteredDocuments.length,
          dbVendors,
          filteredOut: (documents?.length || 0) - filteredDocuments.length
        });
      }
      
      console.log('📊 문서 조회 결과:', { 
        count: filteredDocuments.length, 
        dbVendors,
        selectedVendors: vendors,
        statusFilter,
        typeFilter,
        hasError: !!error,
        documents: filteredDocuments.map((d: any) => ({ 
          id: d.id, 
          title: d.title, 
          source_vendor: d.source_vendor,
          source_vendor_raw: d.source_vendor,
          status: d.status,
          type: d.type
        }))
      });
      
      // 추가 디버깅: 벤더 매칭 확인
      if (filteredDocuments && filteredDocuments.length > 0) {
        const vendorMismatch = filteredDocuments.filter((d: any) => {
          const docVendor = String(d.source_vendor || '').toUpperCase();
          return !dbVendors.some(v => String(v).toUpperCase() === docVendor);
        });
        if (vendorMismatch.length > 0) {
          console.warn('⚠️ 벤더 불일치 문서 발견:', vendorMismatch.map((d: any) => ({
            id: d.id,
            title: d.title,
            source_vendor: d.source_vendor,
            expected: dbVendors
          })));
        }
      }
      
      // 디버깅: 쿼리 결과 확인
      if (typeof window !== 'undefined' && filteredDocuments && filteredDocuments.length > 0) {
        logger.log('[그룹화] 🔍 데이터베이스 쿼리 결과:', {
          totalDocuments: filteredDocuments.length,
          sampleDocument: {
            id: filteredDocuments[0].id,
            type: filteredDocuments[0].type,
            url: filteredDocuments[0].url,
            urlIsNull: filteredDocuments[0].url === null,
            urlIsUndefined: filteredDocuments[0].url === undefined,
            urlValue: String(filteredDocuments[0].url || ''),
            hasUrlField: 'url' in filteredDocuments[0]
          },
          documentsWithUrl: filteredDocuments.filter((d: any) => d.url && d.url !== '').length,
          documentsWithoutUrl: filteredDocuments.filter((d: any) => !d.url || d.url === '').length
        });
      }
      
      // 메인 URL 정보를 processing_jobs에서 가져오기
      // CRAWL_SEED 작업의 document_id가 메인 문서 ID
      const { data: mainUrlMap, error: mainUrlError } = await supabase
        .from("processing_jobs")
        .select("document_id, payload")
        .eq("job_type", "CRAWL_SEED")
        .eq("status", "completed")
        .not("document_id", "is", null);
      
      if (mainUrlError) {
        logger.error('[그룹화] ❌ 메인 URL 조회 실패:', mainUrlError);
      }
      
      // document_id -> 메인 URL 매핑 생성 (정규화 정보 포함)
      const mainUrlById: Record<string, { original: string; normalized: string | null }> = {};
      if (mainUrlMap) {
        for (const job of mainUrlMap) {
          if (!job.document_id || !job.payload) continue;
          try {
            const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
            if (payload?.url) {
              const normalized = normalizeUrlForGrouping(payload.url);
              mainUrlById[job.document_id] = {
                original: payload.url,
                normalized,
              };
            }
          } catch (e) {
            logger.error('[그룹화] ⚠️ payload 파싱 실패:', job.document_id, e);
          }
        }
      }
      
      const mainUrlEntries = Object.entries(mainUrlById).map(([docId, info]) => ({
        docId,
        original: info.original,
        normalized: info.normalized ?? normalizeUrlForGrouping(info.original),
      }));
      
      logger.log('[그룹화] 📊 메인 URL 매핑:', {
        mainUrlMapCount: mainUrlMap?.length || 0,
        mainUrlByIdCount: Object.keys(mainUrlById).length,
        normalizedMainUrlCount: mainUrlEntries.filter((entry) => !!entry.normalized).length,
        sampleMainUrls: mainUrlEntries.slice(0, 3).map((entry) => ({
          docId: entry.docId,
          original: entry.original,
          normalized: entry.normalized,
        })),
      });
      
      // documents에 메인 URL 정보 추가
      const documentsWithMainUrl = (filteredDocuments || []).map((doc: any) => {
        const normalizedUrl = normalizeUrlForGrouping(doc.url);
        
        let matchedEntry: { docId: string; original: string; normalized: string | null } | undefined;
        let bestMatchLength = -1;
        
        for (const entry of mainUrlEntries) {
          const normalizedMain = entry.normalized;
          
          if (doc.id === entry.docId) {
            matchedEntry = entry;
            bestMatchLength = normalizedMain?.length ?? Number.MAX_SAFE_INTEGER;
            break;
          }
          
          if (normalizedUrl && normalizedMain && normalizedUrl.startsWith(normalizedMain)) {
            const candidateLength = normalizedMain.length;
            if (candidateLength > bestMatchLength) {
              matchedEntry = entry;
              bestMatchLength = candidateLength;
            }
          }
        }
        
        if (matchedEntry) {
          const normalizedMain = matchedEntry.normalized;
          const isExact =
            doc.id === matchedEntry.docId ||
            (!!normalizedUrl && !!normalizedMain && normalizedUrl === normalizedMain);
          
          return {
            ...doc,
            mainUrl: matchedEntry.original,
            normalizedUrl,
            normalizedMainUrl: normalizedMain,
            isMainUrl: isExact,
            // main_document_id 필드를 mainDocumentId로 매핑 (URL 매칭보다 우선)
            mainDocumentId: doc.main_document_id !== null && doc.main_document_id !== undefined ? doc.main_document_id : (isExact ? undefined : matchedEntry.docId),
          };
        }
        
        return {
          ...doc,
          normalizedUrl,
          isMainUrl: false,
          // main_document_id 필드를 mainDocumentId로 매핑
          mainDocumentId: doc.main_document_id !== null && doc.main_document_id !== undefined ? doc.main_document_id : undefined,
        };
      });
      
      // 디버깅: 메인 URL 정보가 추가된 문서 통계
      const mainDocsCount = documentsWithMainUrl.filter(d => d.isMainUrl === true).length;
      const subDocsCount = documentsWithMainUrl.filter(d => d.isMainUrl === false && (d.mainUrl || d.normalizedMainUrl || d.mainDocumentId)).length;
      const urlTypeDocs = documentsWithMainUrl.filter(d => d.type === 'url').length;
      const urlTypeWithUrl = documentsWithMainUrl.filter(d => d.type === 'url' && (d.url || d.normalizedUrl)).length;
      
      if (typeof window !== 'undefined') {
        logger.log('[그룹화] 📊 메인 URL 정보 추가 완료:', {
          totalDocuments: documentsWithMainUrl.length,
          mainDocsCount,
          subDocsCount,
          docsWithoutMainUrl: documentsWithMainUrl.length - mainDocsCount - subDocsCount,
          urlTypeDocs,
          urlTypeWithUrl,
          sampleDocs: documentsWithMainUrl.slice(0, 5).map((d: any) => ({
            id: d.id,
            type: d.type,
            typeValue: String(d.type || ''),
            url: d.url,
            urlValue: String(d.url || ''),
            isMainUrl: d.isMainUrl,
            mainUrl: d.mainUrl,
            normalizedUrl: d.normalizedUrl,
            normalizedMainUrl: d.normalizedMainUrl,
            mainDocumentId: d.mainDocumentId,
            typeCheck: d.type === 'url',
            urlCheck: !!(d.url || d.normalizedUrl),
            combinedCheck: d.type === 'url' && !!(d.url || d.normalizedUrl)
          }))
        });
      }
      
      return documentsWithMainUrl;
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

  // 클라이언트 측 유형 필터링 (pdf/docx/txt) + 큐 처리 중 문서 제외 + 검색 필터링
  const filteredData = useMemo(() => {
    let rows = data || [];
    
    console.log('🔍 filteredData 시작:', { 
      originalCount: rows.length, 
      vendors, 
      typeFilter, 
      searchQuery,
      sampleRows: rows.slice(0, 3).map((r: any) => ({ id: r.id, title: r.title, source_vendor: r.source_vendor, status: r.status, chunk_count: r.chunk_count }))
    });
    
    // 유형 필터 (모든 타입을 클라이언트에서 처리)
    if (typeFilter && typeFilter !== "all") {
      const beforeCount = rows.length;
      
      // typeFilter가 'url'일 때 특별 처리:
      // 문서의 실제 type이 'file'이면 필터링하지 않음 (벤더 선택 시 모든 문서 표시)
      // 이는 사용자가 벤더를 선택했을 때 해당 벤더의 모든 문서를 보고 싶어하기 때문
      if (typeFilter === 'url') {
        rows = rows.filter((row: any) => {
          const detectedType = getDocumentFileType(row);
          const actualType = row.type;
          // type이 'url'이거나, 실제 type이 'file'이면 표시 (벤더 필터링 결과 유지)
          return detectedType === 'url' || actualType === 'file';
        });
        console.log('📋 유형 필터 적용 (url - 특별 처리):', { 
          beforeCount, 
          afterCount: rows.length, 
          typeFilter,
          note: 'type이 file인 문서도 포함하여 표시'
        });
      } else {
        // 다른 타입 필터는 정상적으로 처리
        rows = rows.filter((row: any) => {
          const detectedType = getDocumentFileType(row);
          return detectedType === typeFilter;
        });
        console.log('📋 유형 필터 적용:', { beforeCount, afterCount: rows.length, typeFilter });
      }
    }
    
    // 검색 필터 (제목, URL, 메타데이터)
    if (searchQuery && searchQuery.trim()) {
      const beforeCount = rows.length;
      const query = searchQuery.toLowerCase().trim();
      rows = rows.filter((row: any) => {
        const title = (row.title || '').toLowerCase();
        const url = (row.url || '').toLowerCase();
        const id = (row.id || '').toLowerCase();
        const vendor = (row.source_vendor || '').toLowerCase();
        
        return title.includes(query) || 
               url.includes(query) || 
               id.includes(query) ||
               vendor.includes(query);
      });
      console.log('🔎 검색 필터 적용:', { beforeCount, afterCount: rows.length, searchQuery });
    }
    
    // 큐 처리 중인 문서 제외 (chunk_count가 0이고 큐에 등록된 문서)
    const queuedIds = new Set(queuedDocumentIds || []);
    const beforeCount = rows.length;
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
    console.log('📦 큐 필터 적용:', { beforeCount, afterCount: rows.length, queuedIds: Array.from(queuedIds) });
    
    console.log('✅ filteredData 최종 결과:', { 
      finalCount: rows.length,
      finalRows: rows.map((r: any) => ({ id: r.id, title: r.title, source_vendor: r.source_vendor }))
    });
    
    return rows;
  }, [data, typeFilter, queuedDocumentIds, searchQuery, vendors]);

  // 필터된 목록의 총 청크 수
  const totalChunks = useMemo(() => {
    return (filteredData || []).reduce((sum: number, row: any) => sum + (row?.chunk_count ?? 0), 0);
  }, [filteredData]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [detail, setDetail] = useState<any | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [expandedSubPages, setExpandedSubPages] = useState<Record<string, boolean>>({});
  const [subPagesCache, setSubPagesCache] = useState<Record<string, { url: string; title?: string; success: boolean }[]>>({});
  const [loadingSubPages, setLoadingSubPages] = useState<Record<string, boolean>>({});

  // 컴포넌트 마운트 및 데이터 로딩 상태 확인
  useEffect(() => {
    if (typeof window !== 'undefined') {
      logger.log('[그룹화] 🎯 데이터 로딩 상태 (클라이언트):', {
        isLoading,
        dataLength: data?.length,
        dataIsArray: Array.isArray(data),
        dataIsUndefined: data === undefined,
        dataIsNull: data === null,
        dataFirstItem: data?.[0] ? { 
          id: data[0].id, 
          type: data[0].type, 
          url: data[0].url, 
          mainUrl: (data[0] as any).mainUrl, 
          isMainUrl: (data[0] as any).isMainUrl,
          mainDocumentId: (data[0] as any).mainDocumentId
        } : null,
        dataSample: data?.slice(0, 3).map((d: any) => ({
          id: d.id,
          title: d.title?.substring(0, 30),
          url: d.url,
          mainUrl: (d as any).mainUrl,
          isMainUrl: (d as any).isMainUrl
        })),
        timestamp: new Date().toISOString()
      });
    }
  }, [isLoading, data]);

  // 정렬된 데이터 (그룹화 전에 정렬)
  const sortedData = useMemo(() => {
    if (!sortColumn || !filteredData) {
      if (typeof window !== 'undefined') {
        logger.log('[그룹화] 📋 sortedData 생성 (정렬 없음):', { filteredDataLength: filteredData?.length, sortColumn, filteredDataIsArray: Array.isArray(filteredData) });
      }
      return filteredData || [];
    }
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

  // 메인 페이지와 하위 페이지를 그룹화하는 함수 (메인 URL 기준)
  const groupDocumentsByParent = useMemo(() => {
    if (typeof window !== 'undefined') {
      logger.log('[그룹화] 🚀 그룹화 로직 시작 (메인 URL 기준) - 클라이언트:', { 
        sortedDataLength: sortedData?.length, 
        sortedDataIsArray: Array.isArray(sortedData),
        sortedDataType: typeof sortedData,
        sortedDataIsUndefined: sortedData === undefined,
        sortedDataIsNull: sortedData === null,
        sortedDataSample: sortedData?.slice(0, 3).map((d: any) => ({
          id: d.id,
          title: d.title?.substring(0, 30),
          url: d.url,
          mainUrl: (d as any).mainUrl,
          isMainUrl: (d as any).isMainUrl,
          mainDocumentId: (d as any).mainDocumentId
        }))
      });
    }
    const rows = Array.isArray(sortedData) ? sortedData : [];
    if (typeof window !== 'undefined') {
      logger.log('[그룹화] 📊 입력 데이터:', { 
        totalRows: rows.length,
        firstRow: rows[0] ? { 
          id: rows[0].id, 
          type: rows[0].type, 
          typeValue: String(rows[0].type),
          typeIsUndefined: rows[0].type === undefined,
          typeIsNull: rows[0].type === null,
          url: rows[0].url,
          urlValue: String(rows[0].url || ''),
          urlIsUndefined: rows[0].url === undefined,
          urlIsNull: rows[0].url === null,
          normalizedUrl: (rows[0] as any).normalizedUrl,
          normalizedMainUrl: (rows[0] as any).normalizedMainUrl,
          mainUrl: (rows[0] as any).mainUrl,
          isMainUrl: (rows[0] as any).isMainUrl,
          mainDocumentId: (rows[0] as any).mainDocumentId,
        } : null,
        sampleRows: rows.slice(0, 5).map((r: any) => {
          const result = {
            id: r.id,
            type: r.type,
            typeValue: String(r.type || ''),
            url: r.url,
            urlValue: String(r.url || ''),
            normalizedUrl: r.normalizedUrl,
            normalizedMainUrl: r.normalizedMainUrl,
            typeCheck: r.type === 'url',
            urlCheck: !!(r.url || r.normalizedUrl),
            combinedCheck: r.type === 'url' && !!(r.url || r.normalizedUrl),
            isMainUrl: (r as any).isMainUrl,
            mainUrl: (r as any).mainUrl,
            mainDocumentId: (r as any).mainDocumentId,
          };
          // 각 sampleRow를 개별 로그로 출력하여 확실히 확인
          if (typeof window !== 'undefined') {
            logger.log('[그룹화] 📋 sampleRow 상세:', result);
          }
          return result;
        })
      });
    }
    
    const urlDocuments = rows.filter((row: any) => {
      const typeMatch = row.type === 'url';
      const urlExists = !!(row.url || row.normalizedUrl);
      const combined = typeMatch && urlExists;
      if (typeof window !== 'undefined' && !combined && (row.url || row.normalizedUrl)) {
        logger.log('[그룹화] ⚠️ URL 문서 필터링 실패:', {
          id: row.id,
          type: row.type,
          typeValue: String(row.type || ''),
          typeMatch,
          url: row.url,
          normalizedUrl: (row as any).normalizedUrl,
          urlExists,
          combined,
        });
      }
      return combined;
    });
    const nonUrlDocuments = rows.filter((row: any) => row.type !== 'url' || !(row.url || row.normalizedUrl));
    if (typeof window !== 'undefined') {
      logger.log('[그룹화] 📋 필터링 결과:', { 
        urlDocuments: urlDocuments.length, 
        nonUrlDocuments: nonUrlDocuments.length,
        urlDocumentsSample: urlDocuments.slice(0, 3).map((d: any) => ({
          id: d.id,
          type: d.type,
          url: d.url,
          normalizedUrl: d.normalizedUrl,
          mainUrl: d.mainUrl,
          mainDocumentId: d.mainDocumentId,
        })),
        nonUrlDocumentsSample: nonUrlDocuments.slice(0, 3).map((d: any) => ({
          id: d.id,
          type: d.type,
          url: d.url,
        }))
      });
    }
    
    const mainPages: any[] = [];
    const mainDocIds = new Set<string>();
    const mainDocsById: Record<string, any> = {};
    const subPagesByMainId: Record<string, any[]> = {};
    const fallbackSubPagesByKey: Record<string, any[]> = {};
    const rowOrder = new Map<string, number>();
    rows.forEach((row: any, index: number) => {
      if (row?.id) {
        rowOrder.set(row.id, index);
      }
    });
    
    // 1차: 명시적인 메인 문서 수집 (isMainUrl === true 또는 mainDocumentId가 없는 문서)
    urlDocuments.forEach((doc: any) => {
      // mainDocumentId가 명시적으로 없거나 null인 경우만 메인 문서로 처리
      // undefined는 필드가 없는 경우이므로 메인 문서로 처리
      const hasMainDocumentId = doc.mainDocumentId !== undefined && doc.mainDocumentId !== null;
      const isMain = doc.isMainUrl === true || !hasMainDocumentId;
      if (isMain) {
        if (!mainDocIds.has(doc.id)) {
          mainPages.push(doc);
          mainDocIds.add(doc.id);
        }
        mainDocsById[doc.id] = doc;
        if (!subPagesByMainId[doc.id]) {
          subPagesByMainId[doc.id] = [];
        }
        const normalizedSelf = doc.normalizedUrl ?? (doc.url ? normalizeUrlForGrouping(doc.url) : null);
        if (normalizedSelf) {
          fallbackSubPagesByKey[normalizedSelf] = fallbackSubPagesByKey[normalizedSelf] || [];
        }
        if (typeof window !== 'undefined') {
          logger.log('[그룹화] ✅ 메인 페이지 확정:', { 
            title: doc.title, 
            url: doc.url,
            mainUrl: doc.mainUrl,
            normalizedUrl: doc.normalizedUrl,
            normalizedMainUrl: doc.normalizedMainUrl,
            isMainUrl: doc.isMainUrl,
            mainDocumentId: doc.mainDocumentId,
            isMain,
          });
        }
      }
    });
    
    // 2차: 하위 문서 연결 및 추가 메인 문서 판별
    urlDocuments.forEach((doc: any) => {
      // mainDocumentId가 명시적으로 없거나 null인 경우는 메인 문서로 처리했으므로 건너뛰기
      const hasMainDocumentId = doc.mainDocumentId !== undefined && doc.mainDocumentId !== null;
      if (doc.isMainUrl === true || !hasMainDocumentId) return;
      
      const parentId = typeof doc.mainDocumentId === 'string' ? doc.mainDocumentId : undefined;
      const normalizedParentKey = doc.normalizedMainUrl ?? (doc.mainUrl ? normalizeUrlForGrouping(doc.mainUrl) : null);
      const normalizedSelf = doc.normalizedUrl ?? (doc.url ? normalizeUrlForGrouping(doc.url) : null);
      
      // mainDocumentId가 있으면 부모 문서를 찾아서 그룹핑
      if (parentId) {
        // 부모 문서가 이미 mainPages에 있는지 확인
        let parentDoc = mainDocsById[parentId];
        
        // mainPages에 없으면 urlDocuments에서 찾기
        if (!parentDoc) {
          parentDoc = urlDocuments.find((d: any) => d.id === parentId);
          if (parentDoc) {
            // 부모 문서를 mainPages에 추가
            if (!mainDocIds.has(parentDoc.id)) {
              mainPages.push(parentDoc);
              mainDocIds.add(parentDoc.id);
            }
            mainDocsById[parentDoc.id] = parentDoc;
            // subPagesByMainId 초기화 (부모 문서를 찾았으면 반드시 초기화)
            if (!subPagesByMainId[parentDoc.id]) {
              subPagesByMainId[parentDoc.id] = [];
            }
            const parentNormalized = parentDoc.normalizedUrl ?? (parentDoc.url ? normalizeUrlForGrouping(parentDoc.url) : null);
            if (parentNormalized) {
              fallbackSubPagesByKey[parentNormalized] = fallbackSubPagesByKey[parentNormalized] || [];
            }
            if (typeof window !== 'undefined') {
              logger.log('[그룹화] ✅ 부모 문서 발견 및 추가:', { 
                parentTitle: parentDoc.title, 
                parentUrl: parentDoc.url,
                parentId: parentDoc.id,
                childTitle: doc.title,
              });
            }
          } else {
            // 부모 문서를 찾지 못한 경우에도 subPagesByMainId 초기화 (나중에 부모 문서가 로드될 수 있음)
            if (!subPagesByMainId[parentId]) {
              subPagesByMainId[parentId] = [];
            }
            if (typeof window !== 'undefined') {
              logger.log('[그룹화] ⚠️ 부모 문서를 찾지 못함 (임시 그룹 생성):', { 
                parentId,
                childTitle: doc.title,
                childUrl: doc.url,
                note: '부모 문서가 아직 로드되지 않았을 수 있습니다. 임시로 그룹을 생성합니다.'
              });
            }
          }
        }
        
        // subPagesByMainId가 초기화되어 있으면 하위 페이지로 연결
        if (subPagesByMainId[parentId]) {
          subPagesByMainId[parentId].push(doc);
          if (normalizedParentKey) {
            fallbackSubPagesByKey[normalizedParentKey] = fallbackSubPagesByKey[normalizedParentKey] || [];
            fallbackSubPagesByKey[normalizedParentKey].push(doc);
          }
          if (typeof window !== 'undefined') {
            logger.log('[그룹화] ✅ 하위 페이지 연결 (ID 매칭):', { 
              child: doc.title, 
              childUrl: doc.url,
              normalizedChildUrl: normalizedSelf,
              mainDocumentId: parentId,
              normalizedMainUrl: normalizedParentKey,
              parentFound: !!parentDoc,
            });
          }
          return;
        }
      }
      
      if (normalizedParentKey) {
        const matchedMain = mainPages.find((mainDoc: any) => {
          if (!mainDoc) return false;
          const mainNormalized = mainDoc.normalizedUrl ?? (mainDoc.url ? normalizeUrlForGrouping(mainDoc.url) : null);
          return (
            (parentId && mainDoc.id === parentId) ||
            (mainNormalized && normalizedParentKey === mainNormalized) ||
            (mainNormalized && normalizedSelf && normalizedSelf.startsWith(mainNormalized))
          );
        });
        
        if (matchedMain) {
          const targetId = matchedMain.id;
          subPagesByMainId[targetId] = subPagesByMainId[targetId] || [];
          subPagesByMainId[targetId].push(doc);
          fallbackSubPagesByKey[normalizedParentKey] = fallbackSubPagesByKey[normalizedParentKey] || [];
          fallbackSubPagesByKey[normalizedParentKey].push(doc);
          
          if (typeof window !== 'undefined') {
            logger.log('[그룹화] ✅ 하위 페이지 연결 (정규화 매칭):', {
              child: doc.title,
              childUrl: doc.url,
              normalizedChildUrl: normalizedSelf,
              matchedMainTitle: matchedMain.title,
              matchedMainUrl: matchedMain.url,
              normalizedMainUrl: normalizedParentKey,
            });
          }
          return;
        }
      }
      
      if (normalizedSelf) {
        let matched = false;
        for (const candidate of urlDocuments) {
          if (candidate.id === doc.id) continue;
          const candidateNormalized = candidate.normalizedUrl ?? (candidate.url ? normalizeUrlForGrouping(candidate.url) : null);
          if (!candidateNormalized) continue;
          if (normalizedSelf !== candidateNormalized && normalizedSelf.startsWith(candidateNormalized)) {
            const parentCandidateId = candidate.mainDocumentId ?? candidate.id;
            subPagesByMainId[parentCandidateId] = subPagesByMainId[parentCandidateId] || [];
            subPagesByMainId[parentCandidateId].push(doc);
            fallbackSubPagesByKey[candidateNormalized] = fallbackSubPagesByKey[candidateNormalized] || [];
            fallbackSubPagesByKey[candidateNormalized].push(doc);
            matched = true;
            if (typeof window !== 'undefined') {
              logger.log('[그룹화] 🔍 하위 페이지 추론 (경로 기반):', {
                child: doc.title,
                childUrl: doc.url,
                normalizedChildUrl: normalizedSelf,
                parentCandidateTitle: candidate.title,
                parentCandidateUrl: candidate.url,
                parentCandidateNormalized: candidateNormalized,
              });
            }
            break;
          }
        }
        if (matched) {
          return;
        }
      }
      
      if (!mainDocIds.has(doc.id)) {
        mainPages.push(doc);
        mainDocIds.add(doc.id);
        mainDocsById[doc.id] = doc;
        subPagesByMainId[doc.id] = subPagesByMainId[doc.id] || [];
        if (normalizedSelf) {
          fallbackSubPagesByKey[normalizedSelf] = fallbackSubPagesByKey[normalizedSelf] || [];
        }
        if (typeof window !== 'undefined') {
          logger.log('[그룹화] ⚠️ 메인 페이지로 승격 (부모 미발견):', {
            title: doc.title,
            url: doc.url,
            normalizedUrl: normalizedSelf,
            mainUrl: doc.mainUrl,
            normalizedMainUrl: normalizedParentKey,
          });
        }
      }
    });
    
    const groupedDocIds = new Set<string>();
    const grouped: Array<{ isGroup: boolean; mainDoc?: any; subDocs?: any[]; doc?: any }> = [];
    
    // subPagesByMainId에 하위 문서가 있지만 부모 문서가 mainPages에 없는 경우 처리
    Object.keys(subPagesByMainId).forEach((parentId) => {
      if (subPagesByMainId[parentId].length > 0 && !mainDocsById[parentId]) {
        // 부모 문서를 urlDocuments에서 찾기
        const parentDoc = urlDocuments.find((d: any) => d.id === parentId);
        if (parentDoc) {
          // 부모 문서를 mainPages에 추가
          if (!mainDocIds.has(parentDoc.id)) {
            mainPages.push(parentDoc);
            mainDocIds.add(parentDoc.id);
          }
          mainDocsById[parentDoc.id] = parentDoc;
          if (typeof window !== 'undefined') {
            logger.log('[그룹화] ✅ 누락된 부모 문서 발견 및 추가:', { 
              parentTitle: parentDoc.title, 
              parentUrl: parentDoc.url,
              parentId: parentDoc.id,
              subPagesCount: subPagesByMainId[parentId].length,
            });
          }
        } else {
          // 부모 문서를 찾지 못한 경우 로그만 기록 (하위 문서는 나중에 개별 문서로 표시됨)
          if (typeof window !== 'undefined') {
            logger.log('[그룹화] ⚠️ 부모 문서를 찾지 못함 (하위 문서 개별 표시):', { 
              parentId,
              subPagesCount: subPagesByMainId[parentId].length,
              subPagesSample: subPagesByMainId[parentId].slice(0, 3).map((s: any) => s.title),
              note: '부모 문서가 현재 페이지에 없습니다. 하위 문서는 개별 문서로 표시됩니다.'
            });
          }
        }
      }
    });
    
    mainPages.sort((a, b) => {
      const orderA = rowOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const orderB = rowOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
    
    mainPages.forEach((mainDoc) => {
      const normalizedKeys = [
        mainDoc.normalizedMainUrl ?? null,
        mainDoc.normalizedUrl ?? null,
        mainDoc.mainUrl ? normalizeUrlForGrouping(mainDoc.mainUrl) : null,
        mainDoc.url ? normalizeUrlForGrouping(mainDoc.url) : null,
      ].filter(Boolean) as string[];
      
      const combinedSubDocs: any[] = [];
      const directSubDocs = subPagesByMainId[mainDoc.id] || [];
      directSubDocs.forEach((subDoc) => {
        if (!combinedSubDocs.some((existing) => existing.id === subDoc.id)) {
          combinedSubDocs.push(subDoc);
        }
      });
      normalizedKeys.forEach((key) => {
        const fallbackDocs = fallbackSubPagesByKey[key];
        if (fallbackDocs) {
          fallbackDocs.forEach((subDoc) => {
            if (!combinedSubDocs.some((existing) => existing.id === subDoc.id)) {
              combinedSubDocs.push(subDoc);
            }
          });
        }
      });
      
      combinedSubDocs.sort((a, b) => {
        const orderA = rowOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const orderB = rowOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      });
      
      if (combinedSubDocs.length > 0) {
        grouped.push({ isGroup: true, mainDoc, subDocs: combinedSubDocs });
        groupedDocIds.add(mainDoc.id);
        combinedSubDocs.forEach((subDoc) => groupedDocIds.add(subDoc.id));
        if (typeof window !== 'undefined') {
          logger.log('[그룹화] 📦 그룹 생성:', {
            mainTitle: mainDoc.title,
            mainUrl: mainDoc.url,
            normalizedMainUrl: mainDoc.normalizedMainUrl,
            subCount: combinedSubDocs.length,
            subDocsSample: combinedSubDocs.slice(0, 3).map((s: any) => ({
              id: s.id,
              title: s.title?.substring(0, 30),
              url: s.url,
              urlType: typeof s.url,
              hasUrl: 'url' in s,
              urlExists: !!s.url,
              normalizedUrl: s.normalizedUrl,
              mainDocumentId: s.mainDocumentId,
              keys: Object.keys(s),
            })),
          });
        }
      } else {
        grouped.push({ isGroup: false, doc: mainDoc });
        groupedDocIds.add(mainDoc.id);
        if (typeof window !== 'undefined') {
          logger.log('[그룹화] ⚠️ 그룹 생성 실패 - 하위 페이지 없음:', {
            mainTitle: mainDoc.title,
            mainDocUrl: mainDoc.url,
            normalizedMainUrl: mainDoc.normalizedMainUrl,
            knownKeys: normalizedKeys,
          });
        }
      }
    });
    
    urlDocuments.forEach((doc: any) => {
      if (!groupedDocIds.has(doc.id)) {
        grouped.push({ isGroup: false, doc });
        groupedDocIds.add(doc.id);
      }
    });
    
    nonUrlDocuments.forEach((doc: any) => {
      grouped.push({ isGroup: false, doc });
    });
    
    if (typeof window !== 'undefined') {
      const groupCount = grouped.filter((g: any) => g.isGroup).length;
      const totalSubPages = grouped
        .filter((g: any) => g.isGroup)
        .reduce((acc: number, g: any) => acc + (g.subDocs?.length || 0), 0);
      logger.log('[그룹화] 📊 최종 결과:', { 
        totalRows: rows.length, 
        urlDocuments: urlDocuments.length, 
        mainPages: mainPages.length, 
        groupedCount: grouped.length,
        groupsWithSubPages: groupCount,
        totalSubPages,
      });
      if (mainPages.length > 0) {
        logger.log('[그룹화] 메인 페이지 예시:', mainPages.slice(0, 5).map(m => ({ 
          title: m.title, 
          url: m.url,
          normalizedUrl: m.normalizedUrl,
          normalizedMainUrl: m.normalizedMainUrl,
          mainDocumentId: m.mainDocumentId,
        })));
      }
    }
    
    return grouped;
  }, [sortedData]);

  // 렌더링 시 그룹화 결과 로그
  useEffect(() => {
    if (typeof window !== 'undefined') {
      logger.log('[그룹화] 🎨 렌더링 준비:', { 
        groupDocumentsByParentLength: groupDocumentsByParent?.length,
        groupDocumentsByParentIsArray: Array.isArray(groupDocumentsByParent),
        groupsWithSubPages: groupDocumentsByParent?.filter((g: any) => g.isGroup).length,
        sortedDataLength: sortedData?.length,
        filteredDataLength: filteredData?.length
      });
    }
  }, [groupDocumentsByParent, sortedData, filteredData]);

  // 그룹화된 문서 목록에서 펼침/접힘 상태 관리
  // 기본적으로 모든 그룹을 펼쳐진 상태로 시작
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  // 그룹이 생성될 때 자동으로 펼쳐지도록 설정
  useEffect(() => {
    if (groupDocumentsByParent && Array.isArray(groupDocumentsByParent)) {
      const groups = groupDocumentsByParent.filter((g: any) => g.isGroup && g.mainDoc && (g.subDocs?.length || 0) > 0);
      if (groups.length > 0) {
        const defaultExpanded = new Set<string>();
        groups.forEach((g: any) => {
          if (g.mainDoc?.id) {
            defaultExpanded.add(g.mainDoc.id);
          }
        });

        setExpandedGroups((prev) => {
          if (prev.size > 0) {
            return prev;
          }

          if (typeof window !== 'undefined') {
            logger.log('[그룹화] 🔄 expandedGroups 기본값 설정:', {
              defaultExpandedIds: Array.from(defaultExpanded),
            });
          }

          return new Set(defaultExpanded);
        });
      }
    }
  }, [groupDocumentsByParent]);
  
  const toggleGroup = (mainDocId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(mainDocId)) {
        next.delete(mainDocId);
      } else {
        next.add(mainDocId);
      }
      return next;
    });
  };

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
      logger.log('🔄 문서 목록 새로고침 트리거됨');
      refetchDocuments();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('docs-refresh', handler as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('docs-refresh', handler as EventListener);
      }
    };
  }, [refetchDocuments]);

  // 새로고침 버튼 클릭 이벤트 수신
  useEffect(() => {
    const handler = async () => {
      logger.log('🔄 새로고침 버튼 클릭됨');
      if (onRefreshStateChange) {
        onRefreshStateChange(true);
      }
      try {
        await refetchDocuments();
      } finally {
        if (onRefreshStateChange) {
          onRefreshStateChange(false);
        }
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('docs-refresh-click', handler as EventListener);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('docs-refresh-click', handler as EventListener);
      }
    };
  }, [refetchDocuments, onRefreshStateChange]);

  // 페이지 복귀 시 진행 중인 문서 확인 및 알림 (다시보지 않기 옵션 포함)
  useEffect(() => {
    const handleFocus = () => {
      // localStorage에서 "다시보지 않기" 설정 확인
      const dontShowAgain = typeof window !== 'undefined' 
        ? localStorage.getItem('dontShowProcessingToast') === 'true'
        : false;
      
      if (dontShowAgain) {
        // 다시보지 않기 설정이 있으면 알림 표시 안 함 (단, 문서 목록은 새로고침)
        if (data && data.length > 0) {
          const processingDocs = data.filter(
            (doc: any) => doc.status === 'processing' || doc.status === 'pending'
          );
          if (processingDocs.length > 0) {
            refetchDocuments(); // 알림 없이 문서 목록만 새로고침
          }
        }
        return;
      }
      
      // 페이지에 돌아왔을 때 진행 중인 문서 확인
      if (data && data.length > 0) {
        const processingDocs = data.filter(
          (doc: any) => doc.status === 'processing' || doc.status === 'pending'
        );
        if (processingDocs.length > 0) {
          logger.log(`📋 진행 중인 문서 ${processingDocs.length}개 발견`);
          
          // 진행 중인 문서가 있으면 알림 표시 (다시보지 않기 옵션 포함)
          const toastId = toast.info('문서 처리 진행 중', {
            description: (
              <div className="space-y-2">
                <p className="text-sm">{processingDocs.length}개 문서가 처리 중입니다. 문서 처리는 백그라운드에서 계속 진행됩니다.</p>
                <label className="flex items-center space-x-2 cursor-pointer text-xs text-gray-400 hover:text-gray-300">
                  <input
                    type="checkbox"
                    className="w-3 h-3 rounded border-gray-400 text-blue-600 focus:ring-blue-500"
                    onChange={(e) => {
                      if (e.target.checked) {
                        localStorage.setItem('dontShowProcessingToast', 'true');
                        toast.dismiss(toastId);
                      }
                    }}
                  />
                  <span>다시 보지 않기</span>
                </label>
              </div>
            ),
            duration: 7000,
          });
          
          // 자동으로 문서 목록 새로고침
          refetchDocuments();
        }
      }
    };
    
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
      return () => window.removeEventListener('focus', handleFocus);
    }
  }, [data, refetchDocuments]);

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

  // 서브 페이지 정보 조회 함수 (개선: documents 테이블에서 실제 문서 정보도 함께 조회)
  const fetchSubPages = async (documentId: string, documentUrl: string) => {
    // 캐시에 있으면 반환
    if (subPagesCache[documentId]) {
      return subPagesCache[documentId];
    }

    try {
      let subPagesFromJob: Array<{ url: string; title?: string; success: boolean; chunkCount?: number }> = [];

      // 방법 1: document_id로 직접 조회 (가장 정확)
      const { data: jobByDocId, error: errorByDocId } = await supabase
        .from('processing_jobs')
        .select('result, created_at')
        .eq('document_id', documentId)
        .eq('job_type', 'CRAWL_SEED')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!errorByDocId && jobByDocId) {
        const result = jobByDocId.result as any;
        if (result?.subPages && Array.isArray(result.subPages)) {
          subPagesFromJob = result.subPages as Array<{ url: string; title?: string; success: boolean; chunkCount?: number }>;
        }
      }

      // 방법 2: URL로 조회 (fallback)
      if (subPagesFromJob.length === 0) {
        const { data: jobs, error } = await supabase
          .from('processing_jobs')
          .select('result, created_at')
          .eq('job_type', 'CRAWL_SEED')
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(20);

        if (!error && jobs) {
          // 문서 URL과 일치하는 작업 결과 찾기
          for (const job of jobs) {
            const result = job.result as any;
            if (result?.url === documentUrl && result?.subPages && Array.isArray(result.subPages)) {
              subPagesFromJob = result.subPages as Array<{ url: string; title?: string; success: boolean; chunkCount?: number }>;
              break;
            }
          }
        }
      }

      // 하위 페이지 URL 목록 추출
      const subPageUrls = subPagesFromJob
        .filter(sp => sp.success && sp.url)
        .map(sp => sp.url);

      // documents 테이블에서 실제 하위 페이지 문서 정보 조회
      let actualDocuments: Record<string, { id: string; title: string; status: string; chunk_count: number }> = {};
      if (subPageUrls.length > 0) {
        const { data: actualDocs, error: docsError } = await supabase
          .from('documents')
          .select('id, title, status, chunk_count, url')
          .in('url', subPageUrls)
          .eq('type', 'url');

        if (!docsError && actualDocs) {
          actualDocuments = actualDocs.reduce((acc, doc) => {
            if (doc.url) {
              acc[doc.url] = {
                id: doc.id,
                title: doc.title,
                status: doc.status,
                chunk_count: doc.chunk_count || 0,
              };
            }
            return acc;
          }, {} as Record<string, { id: string; title: string; status: string; chunk_count: number }>);
        }
      }

      // 하위 페이지 정보 병합 (job 정보 + 실제 documents 정보)
      const enrichedSubPages = subPagesFromJob.map(sp => {
        const actualDoc = sp.url ? actualDocuments[sp.url] : null;
        return {
          url: sp.url,
          title: actualDoc?.title || sp.title || sp.url,
          success: sp.success,
          chunkCount: actualDoc?.chunk_count || sp.chunkCount || 0,
          documentId: actualDoc?.id,
          status: actualDoc?.status,
          isStored: !!actualDoc, // documents 테이블에 실제로 저장되었는지 여부
        };
      });

      setSubPagesCache(prev => ({ ...prev, [documentId]: enrichedSubPages }));
      return enrichedSubPages;
    } catch (error) {
      logger.error('서브 페이지 조회 오류:', error);
      setSubPagesCache(prev => ({ ...prev, [documentId]: [] }));
      return [];
    }
  };

  // 서브 페이지 확장 토글
  const toggleSubPages = async (documentId: string, documentUrl: string) => {
    const isExpanded = expandedSubPages[documentId];
    setExpandedSubPages(prev => ({ ...prev, [documentId]: !isExpanded }));
    
    // 확장할 때 서브 페이지 정보 조회
    if (!isExpanded && !subPagesCache[documentId]) {
      setLoadingSubPages(prev => ({ ...prev, [documentId]: true }));
      try {
        await fetchSubPages(documentId, documentUrl);
      } finally {
        setLoadingSubPages(prev => ({ ...prev, [documentId]: false }));
      }
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
        .select('id, file_type, type, title, source_vendor, url')
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
          // URL 문서인 경우 reprocess-url API 사용
          if (doc.type === 'url' || doc.url) {
            const res = await fetch('/api/jobs/reprocess-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                documentId: doc.id,
              })
            });
            
            return await res.json();
          }
          
          // 파일 문서인 경우 기존 로직 사용
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
      refetchDocuments();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('docs-refresh'));
      }
    } catch (error) {
      logger.error('일괄 재처리 오류:', error);
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
        logger.warn('청크 삭제 오류:', chunksError);
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
      
      refetchDocuments();
    } catch (error) {
      logger.error('문서 삭제 오류:', error);
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
              variant="outline"
              size="sm"
              className="bg-gray-800/50 border-gray-600 text-white hover:bg-gray-700/50 h-8 px-2" 
              disabled={isLoading}
              onClick={async () => {
                if (onRefreshStateChange) {
                  onRefreshStateChange(true);
                }
                try {
                  await refetchDocuments();
                } finally {
                  if (onRefreshStateChange) {
                    onRefreshStateChange(false);
                  }
                }
              }}
              title="문서 목록 새로고침"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> 
            </Button>
          </div>
        </div>

        {!isClient || isLoading ? (
          <div className="text-sm text-muted-enhanced">불러오는 중...</div>
        ) : (
          <>
            {(!vendors || vendors.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="w-12 h-12 text-yellow-400 mb-4" />
                <p className="text-lg font-semibold text-primary-enhanced mb-2">
                  벤더를 선택해주세요
                </p>
                <p className="text-sm text-secondary-enhanced">
                  문서를 보려면 상단에서 벤더를 선택하세요.
                </p>
              </div>
            ) : (filteredData || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileSearch className="w-12 h-12 text-gray-400 mb-4" />
                <p className="text-lg font-semibold text-primary-enhanced mb-2">
                  문서가 없습니다
                </p>
                <p className="text-sm text-secondary-enhanced">
                  선택한 벤더에 해당하는 문서가 없습니다.
                </p>
              </div>
            ) : viewMode === 'card' ? (
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
                    {/* URL 타입 문서에 서브 페이지 정보 표시 */}
                    {row.type === 'url' && row.url && (
                      <div className="mt-2 border-t border-gray-700/50 pt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSubPages(row.id, row.url);
                          }}
                          className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-400 transition-colors"
                        >
                          {expandedSubPages[row.id] ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronRight className="w-3 h-3" />
                          )}
                          <Link2 className="w-3 h-3" />
                          <span>서브 페이지</span>
                          {subPagesCache[row.id] && (
                            <Badge className="ml-1 bg-blue-500/20 text-blue-300 border-blue-400/30 text-[10px] px-1.5 py-0">
                              {subPagesCache[row.id].filter(p => p.success).length}개
                            </Badge>
                          )}
                        </button>
                        {expandedSubPages[row.id] && (
                          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                            {loadingSubPages[row.id] ? (
                              <div className="flex items-center justify-center gap-2 text-xs text-gray-400 py-3">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>서브 페이지 정보를 불러오는 중...</span>
                              </div>
                            ) : subPagesCache[row.id]?.length > 0 ? (
                              subPagesCache[row.id].map((subPage: any, idx) => (
                                <div
                                  key={idx}
                                  className={`flex items-start gap-2 text-xs p-2 rounded ${
                                    subPage.success && subPage.isStored
                                      ? 'bg-green-500/10 border border-green-500/20'
                                      : subPage.success && !subPage.isStored
                                      ? 'bg-yellow-500/10 border border-yellow-500/20'
                                      : 'bg-red-500/10 border border-red-500/20'
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <a
                                      href={subPage.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="block text-blue-400 hover:text-blue-300 font-medium truncate mb-1"
                                    >
                                      {subPage.title || subPage.url}
                                    </a>
                                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                      {subPage.isStored ? (
                                        <>
                                          <Badge className="bg-green-500/20 text-green-300 border-green-400/30 px-1 py-0 text-[10px]">
                                            저장됨
                                          </Badge>
                                          {subPage.status && (
                                            <Badge className={`${
                                              subPage.status === 'indexed' 
                                                ? 'bg-green-500/20 text-green-300 border-green-400/30'
                                                : subPage.status === 'processing'
                                                ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30'
                                                : 'bg-red-500/20 text-red-300 border-red-400/30'
                                            } px-1 py-0 text-[10px]`}>
                                              {subPage.status}
                                            </Badge>
                                          )}
                                          {subPage.chunkCount > 0 && (
                                            <span className="text-gray-400">
                                              {subPage.chunkCount}개 청크
                                            </span>
                                          )}
                                        </>
                                      ) : subPage.success ? (
                                        <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-400/30 px-1 py-0 text-[10px]">
                                          크롤링 성공 (저장 확인 필요)
                                        </Badge>
                                      ) : (
                                        <Badge className="bg-red-500/20 text-red-300 border-red-400/30 px-1 py-0 text-[10px]">
                                          크롤링 실패
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  {subPage.success && subPage.isStored ? (
                                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                                  ) : subPage.success ? (
                                    <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                                  ) : (
                                    <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                                  )}
                                </div>
                              ))
                            ) : (
                              <div className="text-xs text-gray-500 text-center py-2">
                                서브 페이지가 없거나 아직 크롤링되지 않았습니다.
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <>
                {(!vendors || vendors.length === 0) ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <AlertCircle className="w-12 h-12 text-yellow-400 mb-4" />
                    <p className="text-lg font-semibold text-primary-enhanced mb-2">
                      벤더를 선택해주세요
                    </p>
                    <p className="text-sm text-secondary-enhanced">
                      문서를 보려면 상단에서 벤더를 선택하세요.
                    </p>
                  </div>
                ) : (filteredData || []).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FileSearch className="w-12 h-12 text-gray-400 mb-4" />
                    <p className="text-lg font-semibold text-primary-enhanced mb-2">
                      문서가 없습니다
                    </p>
                    <p className="text-sm text-secondary-enhanced">
                      선택한 벤더에 해당하는 문서가 없습니다.
                    </p>
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
                  {(() => {
                    const isArray = Array.isArray(groupDocumentsByParent);
                    const length = groupDocumentsByParent?.length ?? 0;
                    const groupsCount = groupDocumentsByParent?.filter((g: any) => g.isGroup).length ?? 0;
                    if (typeof window !== 'undefined') {
                      logger.log('[그룹화] 🎨 렌더링 시작 (클라이언트):', { 
                        isArray, 
                        length, 
                        groupsCount,
                        firstGroup: groupDocumentsByParent?.[0] ? {
                          isGroup: groupDocumentsByParent[0].isGroup,
                          mainDoc: groupDocumentsByParent[0].mainDoc ? {
                            id: groupDocumentsByParent[0].mainDoc.id,
                            title: groupDocumentsByParent[0].mainDoc.title?.substring(0, 30),
                            url: groupDocumentsByParent[0].mainDoc.url,
                            mainUrl: (groupDocumentsByParent[0].mainDoc as any).mainUrl,
                            isMainUrl: (groupDocumentsByParent[0].mainDoc as any).isMainUrl
                          } : null,
                          subDocsCount: groupDocumentsByParent[0].subDocs?.length || 0
                        } : null,
                        sampleGroups: groupDocumentsByParent?.slice(0, 3).map((g: any) => ({
                          isGroup: g.isGroup,
                          mainDocId: g.mainDoc?.id,
                          mainDocTitle: g.mainDoc?.title?.substring(0, 30),
                          subDocsCount: g.subDocs?.length || 0
                        }))
                      });
                    }
                    return isArray ? groupDocumentsByParent.map((group, groupIdx) => {
                    if (group.isGroup && group.mainDoc) {
                      // 그룹화된 메인 페이지와 하위 페이지들
                      const mainDoc = group.mainDoc;
                      const subDocs = group.subDocs || [];
                      const isExpanded = expandedGroups.has(mainDoc.id);
                      
                      // 디버깅: 렌더링 시점의 그룹 정보 확인
                      if (typeof window !== 'undefined' && groupIdx === 0) {
                        logger.log('[그룹화] 🎯 그룹 렌더링:', {
                          mainDocId: mainDoc.id,
                          mainDocTitle: mainDoc.title?.substring(0, 50),
                          mainDocUrl: mainDoc.url,
                          subDocsLength: subDocs.length,
                          subDocsSample: subDocs.slice(0, 3).map((s: any) => ({
                            id: s.id,
                            title: s.title?.substring(0, 30),
                            url: s.url
                          })),
                          isExpanded,
                          expandedGroupsSize: expandedGroups.size,
                          expandedGroupsHasMainDoc: expandedGroups.has(mainDoc.id),
                          groupIsGroup: group.isGroup,
                          groupHasMainDoc: !!group.mainDoc,
                          groupSubDocs: group.subDocs?.length || 0
                        });
                      }
                      
                      return (
                        <div key={mainDoc.id}>
                          {/* 메인 페이지 행 */}
                          <div className="grid grid-cols-12 items-center px-4 py-3 hover:bg-gray-800/40">
                            <div className="col-span-7 flex items-center gap-2 min-w-0 pr-2">
                              <Checkbox 
                                checked={!!selected[mainDoc.id]} 
                                onCheckedChange={() => {
                                  const isMainSelected = !!selected[mainDoc.id];
                                  const subDocIds = subDocs.map((sub: any) => sub.id);
                                  
                                  // 부모 선택/해제
                                  toggleSelect(mainDoc.id);
                                  
                                  // 하위 문서들도 함께 선택/해제
                                  if (!isMainSelected) {
                                    // 부모가 선택되지 않았으면 하위 전체 선택
                                    setSelected(prev => {
                                      const newSelected = { ...prev };
                                      subDocIds.forEach(id => {
                                        newSelected[id] = true;
                                      });
                                      return newSelected;
                                    });
                                  } else {
                                    // 부모가 이미 선택되어 있으면 하위 전체 해제
                                    setSelected(prev => {
                                      const newSelected = { ...prev };
                                      subDocIds.forEach(id => {
                                        delete newSelected[id];
                                      });
                                      return newSelected;
                                    });
                                  }
                                }}
                                className="flex-shrink-0"
                              />
                              <button
                                onClick={() => toggleGroup(mainDoc.id)}
                                className="flex-shrink-0 text-gray-400 hover:text-blue-400 transition-colors"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </button>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button onClick={() => setDetail(mainDoc)} className="text-left min-w-0 flex-1">
                                      <span className="text-primary-enhanced font-semibold truncate block">
                                        {mainDoc.title || mainDoc.id}
                                      </span>
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <div className="max-w-[640px] whitespace-pre-wrap break-words text-sm">
                                      {mainDoc.title || mainDoc.id}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                            <div className="col-span-2">
                              <Badge className={`${getTypeBadgeStyle(getDocumentFileType(mainDoc))} font-semibold text-[10px] px-2 py-0.5 inline-flex items-center gap-1 w-fit whitespace-nowrap`}>
                                {getTypeIcon(getDocumentFileType(mainDoc))}
                                {getTypeDisplayName(getDocumentFileType(mainDoc))}
                              </Badge>
                            </div>
                            <div className="col-span-2">
                              <Badge className={`${
                                mainDoc.status === 'indexed' 
                                  ? 'bg-green-500/20 text-green-300 border-green-400/30'
                                  : mainDoc.status === 'processing'
                                  ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30'
                                  : mainDoc.status === 'failed'
                                  ? 'bg-red-500/20 text-red-300 border-red-400/30'
                                  : 'bg-gray-500/20 text-gray-300 border-gray-400/30'
                              } font-semibold w-fit whitespace-nowrap`}>
                                {mainDoc.status}
                              </Badge>
                            </div>
                            <div className="col-span-1 text-right text-[11px] text-muted-enhanced pr-2">
                              {new Date(mainDoc.updated_at).toLocaleString()}
                            </div>
                          </div>
                          
                          {/* 하위 페이지들 (펼쳐진 경우) */}
                          {isExpanded && subDocs.length > 0 && (
                            <div className="bg-gray-800/20 border-t border-gray-700/50">
                              {subDocs.map((subDoc: any) => (
                                <div key={subDoc.id} className="grid grid-cols-12 items-center px-4 py-2 pl-12 hover:bg-gray-800/30 border-b border-gray-700/30 last:border-b-0">
                                  <div className="col-span-7 flex items-center gap-2 min-w-0 pr-2">
                                    <Checkbox 
                                      checked={!!selected[subDoc.id]} 
                                      onCheckedChange={() => toggleSelect(subDoc.id)}
                                      className="flex-shrink-0"
                                    />
                                    <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                                      <div className="w-0.5 h-4 bg-gray-600"></div>
                                    </div>
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button onClick={() => {
                                            if (typeof window !== 'undefined') {
                                              logger.log('[그룹화] 하위 페이지 클릭:', {
                                                subDocId: subDoc.id,
                                                subDocTitle: subDoc.title,
                                                subDocUrl: subDoc.url,
                                                subDocUrlType: typeof subDoc.url,
                                                subDocKeys: Object.keys(subDoc),
                                                hasUrl: 'url' in subDoc,
                                              });
                                            }
                                            setDetail(subDoc);
                                          }} className="text-left min-w-0 flex-1">
                                            <span className="text-secondary-enhanced font-medium truncate block">
                                              {subDoc.title || subDoc.id}
                                            </span>
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <div className="max-w-[640px] whitespace-pre-wrap break-words text-sm">
                                            {subDoc.title || subDoc.id}
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </div>
                                  <div className="col-span-2">
                                    <Badge className={`${getTypeBadgeStyle(getDocumentFileType(subDoc))} font-semibold text-[10px] px-2 py-0.5 inline-flex items-center gap-1 w-fit whitespace-nowrap`}>
                                      {getTypeIcon(getDocumentFileType(subDoc))}
                                      {getTypeDisplayName(getDocumentFileType(subDoc))}
                                    </Badge>
                                  </div>
                                  <div className="col-span-2">
                                    <Badge className={`${
                                      subDoc.status === 'indexed' 
                                        ? 'bg-green-500/20 text-green-300 border-green-400/30'
                                        : subDoc.status === 'processing'
                                        ? 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30'
                                        : subDoc.status === 'failed'
                                        ? 'bg-red-500/20 text-red-300 border-red-400/30'
                                        : 'bg-gray-500/20 text-gray-300 border-gray-400/30'
                                    } font-semibold w-fit whitespace-nowrap`}>
                                      {subDoc.status}
                                    </Badge>
                                  </div>
                                  <div className="col-span-1 text-right text-[11px] text-muted-enhanced pr-2">
                                    {new Date(subDoc.updated_at).toLocaleString()}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    } else if (group.doc) {
                      // 단일 문서 (그룹화되지 않은 문서)
                      const row = group.doc;
                      return (
                        <div key={row.id}>
                          <div className="grid grid-cols-12 items-center px-4 py-3 hover:bg-gray-800/40">
                            <div className="col-span-7 flex items-center gap-2 min-w-0 pr-2">
                              <Checkbox 
                                checked={!!selected[row.id]} 
                                onCheckedChange={() => toggleSelect(row.id)}
                                className="flex-shrink-0"
                              />
                              <div className="flex-shrink-0 w-4"></div>
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
                        </div>
                      );
                    }
                    return null;
                  }) : null;
                  })()}
                </div>
              </div>
                )}
              </>
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
    
    <DocumentDetailDialog detail={detail} onClose={() => setDetail(null)} onRefetch={refetchDocuments} />
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
        const { count } = await q;
        out[s] = count || 0;
      }
      out.processing += out.retrying;
      return out;
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener('queue-refresh', handler);
    return () => window.removeEventListener('queue-refresh', handler);
  }, [refetch]);

  const queued = data?.queued ?? 0;
  const processing = data?.processing ?? 0;
  const failed = data?.failed ?? 0;

  const queueActionClass = "flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700";
  const retryActionClass = "flex-1 bg-gray-800/50 border-gray-600 text-white hover:bg-gray-700/50";

  return (
    <Card className="bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-950/90 border border-white/10 shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <RefreshCw className="w-5 h-5 text-blue-300" />
          처리 큐 (요약)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm text-gray-300 mb-3 font-semibold">
          선택 벤더: <span className="text-blue-300">{vendors.join(", ") || "(없음)"}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MiniStat
            title="대기"
            value={String(queued)}
            accent="bg-blue-500/45"
            icon={Clock3}
          />
          <MiniStat
            title="진행 중"
            value={String(processing)}
            accent="bg-indigo-500/45"
            icon={Loader2}
          />
          <MiniStat
            title="실패"
            value={String(failed)}
            accent="bg-rose-500/45"
            icon={AlertTriangle}
          />
        </div>
        <div className="mt-4 flex flex-col sm:flex-row items-stretch gap-2">
          <Button 
            className={queueActionClass}
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
                
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('docs-refresh'));
                }
              } catch (error) {
                logger.error('큐 처리 오류:', error);
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
                즉시 처리
              </>
            )}
          </Button>
          <Button 
            variant="outline"
            className={retryActionClass}
            disabled={retryingFailed || failed === 0}
            aria-label={failed === 0 ? "실패한 작업이 없습니다" : "실패한 작업 재시도"}
            onClick={async () => {
              if (retryingFailed || failed === 0) return;
              
              setRetryingFailed(true);
              try {
                const { data: failedJobs, error: fetchError } = await supabase
                  .from('processing_jobs')
                  .select('id, attempts, max_attempts')
                  .eq('status', 'failed')
                  .limit(10);
                
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
                
                const retryResults: string[] = [];
                for (const jobItem of failedJobs) {
                  const { error: updateError } = await supabase
                    .from('processing_jobs')
                    .update({ status: 'queued', error: null })
                    .eq('id', jobItem.id);
                  
                  if (updateError) {
                    retryResults.push(`실패 (${jobItem.id})`);
                  } else {
                    retryResults.push(`성공 (${jobItem.id})`);
                  }
                }
                
                toast.success('실패한 작업을 재시작했습니다', {
                  description: retryResults.join(', '),
                  duration: 4000,
                });
                
                refetch();
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('queue-refresh'));
                  window.dispatchEvent(new CustomEvent('docs-refresh'));
                }
              } catch (error) {
                logger.error('재시도 오류:', error);
                toast.error('재시작 실패', {
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
                재시작 중...
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 mr-1" /> 
                실패 재시작
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteAllDocumentsButton() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingStatus, setDeletingStatus] = useState<string | null>(null);

  const handleDeleteAll = async () => {
    try {
      setDeleting(true);
      setDeletingStatus('삭제 중...');
      
      const res = await fetch('/api/admin/delete-all-documents', {
        method: 'DELETE',
      });

      const data = await res.json();

      if (data.success) {
        toast.success('모든 문서 삭제 완료', {
          description: `문서: ${data.deletedCounts?.documents || 0}개, 청크: ${data.deletedCounts?.chunks || 0}개 삭제되었습니다.`,
          duration: 5000,
        });
        setShowConfirm(false);
        // 페이지 새로고침하여 목록 업데이트
        window.location.reload();
      } else {
        toast.error('삭제 실패', {
          description: data.error || '알 수 없는 오류가 발생했습니다.',
          duration: 5000,
        });
      }
    } catch (error) {
      logger.error('삭제 오류:', error);
      toast.error('삭제 오류', {
        description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
        duration: 5000,
      });
    } finally {
      setDeleting(false);
      setDeletingStatus(null);
    }
  };

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => setShowConfirm(true)}
        className="bg-red-600 hover:bg-red-700 text-white"
      >
        <XCircle className="w-4 h-4 mr-2" />
        전체 삭제
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent className="bg-gray-900 border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-400">⚠️ 모든 문서 삭제</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-300">
              이 작업은 <strong className="text-red-400">되돌릴 수 없습니다</strong>.
              <br />
              <br />
              다음 데이터가 모두 삭제됩니다:
              <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
                <li>모든 문서</li>
                <li>모든 청크</li>
                <li>모든 메타데이터</li>
                <li>모든 처리 로그</li>
              </ul>
              <br />
              정말로 모든 문서를 삭제하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700">
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {deletingStatus || '삭제 중...'}
                </>
              ) : (
                '삭제'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MiniStat({ title, value, accent, icon: Icon }: { title: string; value: string; accent: string; icon: LucideIcon }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 shadow-lg bg-gradient-to-br from-slate-900/85 via-slate-900/70 to-slate-950/90 border border-white/10">
      <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-transparent opacity-20" />
      <div className="relative flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/70 font-semibold">{title}</div>
          <div className="mt-2 text-2xl font-bold text-white">{value}</div>
        </div>
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shadow-inner ${accent}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
    </div>
  );
}

function MetricsSummary({ vendors }: { vendors: string[] }) {
  const supabase = useMemo(() => createClient(), []);
  
  const { data, isLoading } = useQuery({
    queryKey: ["documents-summary", vendors],
    queryFn: async () => {
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      
      const { count: totalCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true });
      
      const { count: recentCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', last24h);
      
      const { count: processingCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'processing']);
      
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: failedCount } = await supabase
        .from('documents')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', last7d);
      
      return {
        total: totalCount || 0,
        recent24h: recentCount || 0,
        processing: processingCount || 0,
        failed7d: failedCount || 0,
      };
    },
    refetchInterval: 10000,
  });
  
  const summary = data || { total: 0, recent24h: 0, processing: 0, failed7d: 0 };
  const metrics = [
    {
      title: '총 문서 수',
      value: isLoading ? '-' : summary.total.toLocaleString(),
      icon: FileText,
      accent: 'bg-blue-500/45',
      label: '전체 인덱싱 문서'
    },
    {
      title: '최근 24시간',
      value: isLoading ? '-' : summary.recent24h.toLocaleString(),
      icon: Sparkles,
      accent: 'bg-violet-500/45',
      label: '최근 업로드 수'
    },
    {
      title: '처리 중',
      value: isLoading ? '-' : summary.processing.toLocaleString(),
      icon: RefreshCw,
      accent: 'bg-sky-500/45',
      label: '대기 및 진행 중'
    },
    {
      title: '실패 (7일)',
      value: isLoading ? '-' : summary.failed7d.toLocaleString(),
      icon: XCircle,
      accent: 'bg-rose-500/45',
      label: '최근 7일 실패 문서'
    },
  ];
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {metrics.map((metric) => (
        <Metric key={metric.title} {...metric} />
      ))}
    </div>
  );
}

function Metric({ title, value, icon: Icon, accent, label }: { title: string; value: string; icon: LucideIcon; accent: string; label?: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 shadow-xl bg-gradient-to-br from-slate-900/85 via-slate-900/70 to-slate-950/90 border border-white/10">
      <div className="absolute inset-0 bg-gradient-to-tr from-white/20 via-transparent to-transparent opacity-20" />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-white/70 font-semibold">{title}</div>
          <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
          {label && <div className="mt-1 text-xs text-white/60">{label}</div>}
        </div>
        <div className={`h-12 w-12 rounded-xl flex items-center justify-center shadow-inner ${accent} text-white`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

function DocumentDetailDialog({ detail, onClose, onRefetch }: { detail: any | null; onClose: () => void; onRefetch: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  
  const { data: fullDoc, isLoading: loadingDoc } = useQuery({
    queryKey: ["doc-detail", detail?.id],
    queryFn: async () => {
      if (!detail?.id) return null;
      // main_document_id 컬럼이 없을 수 있으므로 먼저 기본 필드만 조회
      let query = supabase
        .from("documents")
        .select("id, title, type, status, chunk_count, file_size, file_type, created_at, updated_at, document_url, url, size, source_vendor, content")
        .eq("id", detail.id)
        .single();
      
      // main_document_id 컬럼이 있는지 확인 후 추가
      try {
        const { data: testData, error: testError } = await supabase
          .from("documents")
          .select("main_document_id")
          .limit(1);
        
        if (!testError && testData) {
          // main_document_id 컬럼이 존재하면 다시 조회
          query = supabase
            .from("documents")
            .select("id, title, type, status, chunk_count, file_size, file_type, created_at, updated_at, document_url, url, size, source_vendor, main_document_id, content")
            .eq("id", detail.id)
            .single();
        }
      } catch (e) {
        // main_document_id 컬럼이 없으면 기본 필드만 사용
        console.warn('[미리보기] main_document_id 컬럼이 없습니다. 마이그레이션을 실행해주세요.');
      }
      
      const { data, error } = await query;
      
      if (error) {
        // main_document_id 관련 에러인 경우 기본 필드만 다시 시도
        if (error.message?.includes('main_document_id')) {
          console.warn('[미리보기] main_document_id 컬럼이 없어 기본 필드만 조회합니다.');
          const { data: fallbackData, error: fallbackError } = await supabase
            .from("documents")
            .select("id, title, type, status, chunk_count, file_size, file_type, created_at, updated_at, document_url, url, size, source_vendor, content")
            .eq("id", detail.id)
            .single();
          
          if (fallbackError) {
            console.error('[미리보기] fullDoc 조회 오류:', fallbackError);
            return null;
          }
          
          return fallbackData;
        }
        
        console.error('[미리보기] fullDoc 조회 오류:', error);
        return null;
      }
      
      // URL 필드 확인 로그
      if (data && typeof window !== 'undefined') {
        logger.log('[미리보기] fullDoc 조회 결과:', {
          id: data.id,
          title: data.title,
          url: data.url,
          urlType: typeof data.url,
          hasUrl: 'url' in data,
          urlExists: !!data.url,
          keys: Object.keys(data),
          mainDocumentId: (data as any).main_document_id || null,
        });
      }
      
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
        .select("id, document_id, job_type, status, priority, attempts, max_attempts, error, result, payload, created_at, scheduled_at, started_at, finished_at")
        .eq("document_id", detail.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) return [];
      return data || [];
    },
    enabled: !!detail?.id,
  });

  const resolvedDocumentUrl = useMemo(() => {
    if (typeof window !== 'undefined') {
      logger.log('[미리보기] ✅ 상세 데이터 스냅샷:', {
        detailId: detail?.id,
        detailTitle: detail?.title,
        fullDocUrl: fullDoc?.url,
        detailUrl: detail?.url,
        detailUrlType: typeof detail?.url,
        detailUrlExists: 'url' in (detail || {}),
        detailKeys: detail ? Object.keys(detail) : [],
        normalizedFullDocUrl: (fullDoc as any)?.normalizedUrl,
        normalizedDetailUrl: (detail as any)?.normalizedUrl,
        mainUrl: (detail as any)?.mainUrl,
        normalizedMainUrl: (detail as any)?.normalizedMainUrl,
        metadata: metadata,
        jobs,
      });
    }

    const metadataCandidates =
      metadata && typeof metadata === 'object'
        ? [
            (metadata as any)?.source_url,
            (metadata as any)?.original_url,
            (metadata as any)?.url,
            (metadata as any)?.raw_url,
          ]
        : [];

    const docMetadataCandidates =
      (fullDoc as any)?.metadata && typeof (fullDoc as any)?.metadata === 'object'
        ? [
            (fullDoc as any)?.metadata?.source_url,
            (fullDoc as any)?.metadata?.url,
            (fullDoc as any)?.metadata?.original_url,
          ]
        : [];

    const jobCandidates = Array.isArray(jobs)
      ? jobs.flatMap((job: any) => {
          const jobPayload =
            job?.payload && typeof job.payload === 'string'
              ? (() => {
                  try {
                    return JSON.parse(job.payload);
                  } catch {
                    return null;
                  }
                })()
              : job?.payload;

          const payloadUrl = jobPayload && typeof jobPayload === 'object' ? (jobPayload as any)?.url : undefined;

          return [
            job?.result?.url,
            job?.result?.mainUrl,
            job?.result?.documentUrl,
            job?.result?.resolvedUrl,
            job?.result?.sourceUrl,
            payloadUrl,
          ];
        })
      : [];

    const candidateValues: Array<string | null | undefined> = [
      detail?.url, // detail.url을 최우선으로 사용
      fullDoc?.url,
      (detail as any)?.normalizedUrl,
      (fullDoc as any)?.normalizedUrl,
      (detail as any)?.mainUrl,
      (detail as any)?.normalizedMainUrl,
      ...metadataCandidates,
      ...docMetadataCandidates,
      ...jobCandidates,
    ];

    const cleanedCandidates = candidateValues
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim());

    if (typeof window !== 'undefined') {
      logger.log('[미리보기] 후보 URL 목록 (정제 전):', candidateValues);
      logger.log('[미리보기] 후보 URL 목록 (정제 후):', cleanedCandidates);
    }

    const absoluteUrl = cleanedCandidates.find((candidate) => /^https?:\/\//i.test(candidate));
    if (absoluteUrl) {
      if (typeof window !== 'undefined') {
        logger.log('[미리보기] 선택된 URL (절대 경로):', absoluteUrl);
      }
      return absoluteUrl;
    }

    const prefixedUrl = cleanedCandidates.find((candidate) => /^www\./i.test(candidate));
    if (prefixedUrl) {
      const normalized = `https://${prefixedUrl.replace(/^\s*www\./i, 'www.')}`;
      if (typeof window !== 'undefined') {
        logger.log('[미리보기] 선택된 URL (www):', normalized);
      }
      return normalized;
    }

    const protocolRelative = cleanedCandidates.find((candidate) => /^\/\//.test(candidate));
    if (protocolRelative) {
      const normalized = `https:${protocolRelative}`;
      if (typeof window !== 'undefined') {
        logger.log('[미리보기] 선택된 URL (protocol-relative):', normalized);
      }
      return normalized;
    }

    if (typeof window !== 'undefined') {
      logger.log('[미리보기] URL 후보 목록:', cleanedCandidates);
      logger.log('[미리보기] 선택된 URL 없음');
    }

    return null;
  }, [fullDoc, detail, metadata, jobs]);

  useEffect(() => {
    setFallbackUrl(null);

    const fetchFallbackUrl = async () => {
      if (resolvedDocumentUrl || !detail?.id) return;
      try {
        const { data, error } = await supabase
          .from('processing_jobs')
          .select('payload, result')
          .eq('document_id', detail.id)
          .eq('job_type', 'CRAWL_SEED')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          logger.error('[미리보기] Fallback URL 조회 실패:', error);
          return;
        }

        if (data) {
          const payload = typeof data.payload === 'string' ? (() => {
            try {
              return JSON.parse(data.payload);
            } catch {
              return null;
            }
          })() : data.payload;

          const candidateList: Array<string | null | undefined> = [
            payload?.url,
            data.result?.url,
            data.result?.mainUrl,
            data.result?.documentUrl,
            data.result?.resolvedUrl,
            data.result?.sourceUrl,
          ];

          const cleaned = candidateList
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim());

          if (cleaned.length > 0) {
            const absolute = cleaned.find((candidate) => /^https?:\/\//i.test(candidate));
            const withWww = cleaned.find((candidate) => /^www\./i.test(candidate));
            const protocolRelative = cleaned.find((candidate) => /^\/\//.test(candidate));

            const resolved =
              absolute ??
              (withWww ? `https://${withWww.replace(/^\s*www\./i, 'www.')}` : undefined) ??
              (protocolRelative ? `https:${protocolRelative}` : undefined);

            if (resolved) {
              if (typeof window !== 'undefined') {
                logger.log('[미리보기] Fallback URL 선택:', resolved);
              }
              setFallbackUrl(resolved);
            }
          }

          if (typeof window !== 'undefined') {
            logger.log('[미리보기] Fallback 후보 목록:', cleaned);
          }
        }
      } catch (fallbackError) {
        logger.error('[미리보기] Fallback URL 처리 오류:', fallbackError);
      }
    };

    fetchFallbackUrl();
  }, [detail?.id, resolvedDocumentUrl, supabase]);

  const { data: hierarchyStats } = useQuery({
    queryKey: ["doc-hierarchy-stats", detail?.id],
    queryFn: async () => {
      if (!detail?.id) return null;
      
      // 계층 레벨별 통계
      const { data: levelStats, error: levelError } = await supabase
        .from("document_chunks")
        .select("hierarchy_level")
        .eq("document_id", detail.id);
      
      if (levelError || !levelStats) return null;
      
      const levelCounts = levelStats.reduce((acc: Record<string, number>, chunk: any) => {
        const level = chunk.hierarchy_level || 'none';
        acc[level] = (acc[level] || 0) + 1;
        return acc;
      }, {});
      
      // 부모-자식 관계 통계
      const { data: parentChildStats, error: parentError } = await supabase
        .from("document_chunks")
        .select("parent_chunk_id")
        .eq("document_id", detail.id);
      
      if (parentError || !parentChildStats) return { levelCounts, hasHierarchy: false };
      
      const hasParent = parentChildStats.some((chunk: any) => chunk.parent_chunk_id !== null);
      const parentCount = parentChildStats.filter((chunk: any) => chunk.parent_chunk_id !== null).length;
      
      return {
        levelCounts,
        hasHierarchy: hasParent || Object.keys(levelCounts).some(k => k !== 'none'),
        totalChunks: levelStats.length,
        chunksWithParent: parentCount,
        chunksWithoutParent: levelStats.length - parentCount,
      };
    },
    enabled: !!detail?.id && !!((fullDoc as any)?.actualChunkCount) && (fullDoc as any).actualChunkCount > 0,
  });

  const finalDocumentUrl = resolvedDocumentUrl ?? fallbackUrl;

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
                    <div className="text-secondary-enhanced font-semibold flex items-center justify-between">
                      <span>벤더</span>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs">
                            수정
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2 bg-gray-900 border-gray-700" align="end">
                          <div className="space-y-1">
                            {ALL_VENDORS.map((vendor) => {
                              const currentVendor = fullDoc?.source_vendor || detail.source_vendor;
                              const isSelected = VENDOR_TO_DB_MAP[vendor] === currentVendor;
                              return (
                                <label
                                  key={vendor}
                                  className="flex items-center gap-2 p-2 rounded hover:bg-gray-800 cursor-pointer"
                                >
                                  <input
                                    type="radio"
                                    name="vendor"
                                    value={vendor}
                                    checked={isSelected}
                                    onChange={async () => {
                                      const dbVendor = VENDOR_TO_DB_MAP[vendor];
                                      const { error: updateError } = await supabase
                                        .from('documents')
                                        .update({ source_vendor: dbVendor })
                                        .eq('id', detail.id);
                                      
                                      if (updateError) {
                                        toast.error('벤더 수정 실패', {
                                          description: updateError.message
                                        });
                                      } else {
                                        toast.success('벤더 수정 완료', {
                                          description: `${vendor}로 변경되었습니다.`
                                        });
                                        onRefetch();
                                        if (fullDoc) {
                                          fullDoc.source_vendor = dbVendor;
                                        }
                                      }
                                    }}
                                    className="w-4 h-4"
                                  />
                                  <span className={isSelected ? 'text-blue-400 font-semibold' : 'text-white'}>
                                    {vendor}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
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
                      {(fullDoc as any)?.actualChunkCount !== undefined ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span>DB 기록: {fullDoc?.chunk_count || 0}</span>
                            {fullDoc?.chunk_count !== (fullDoc as any).actualChunkCount && (
                              <Badge variant="outline" className="bg-yellow-500/20 text-yellow-300 border-yellow-400/30 text-xs">
                                불일치
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-enhanced">
                            실제 청크: {(fullDoc as any).actualChunkCount}개
                            {(fullDoc as any).chunksWithEmbedding > 0 && (
                              <span className="ml-2">(임베딩: {(fullDoc as any).chunksWithEmbedding}개)</span>
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
                  
                  {/* 계층 구조 정보 */}
                  {hierarchyStats && (
                    <>
                      <div className="col-span-2 space-y-2 mt-4 pt-4 border-t border-gray-700">
                        <div className="text-secondary-enhanced font-semibold flex items-center gap-2">
                          <Database className="w-4 h-4" />
                          계층 구조 정보
                        </div>
                        {hierarchyStats.hasHierarchy ? (
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="space-y-2">
                              <div className="text-xs text-muted-enhanced">계층 레벨별 분포</div>
                              <div className="space-y-1">
                                {Object.entries(hierarchyStats.levelCounts).map(([level, count]) => (
                                  <div key={level} className="flex items-center justify-between">
                                    <span className="text-primary-enhanced">
                                      {level === 'none' ? '계층 없음' : level}
                                    </span>
                                    <Badge variant="outline" className="bg-blue-500/20 text-blue-300 border-blue-400/30">
                                      {count as number}개
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="text-xs text-muted-enhanced">부모-자식 관계</div>
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-primary-enhanced">부모 있는 청크</span>
                                  <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-400/30">
                                    {hierarchyStats.chunksWithParent}개
                                  </Badge>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-primary-enhanced">최상위 청크</span>
                                  <Badge variant="outline" className="bg-purple-500/20 text-purple-300 border-purple-400/30">
                                    {hierarchyStats.chunksWithoutParent}개
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-muted-enhanced">
                            계층 구조가 생성되지 않았습니다. 
                            <br />
                            <span className="text-xs">
                              가능한 원인: 문서가 너무 작거나 구조가 단순함, 청킹 실패
                            </span>
                          </div>
                        )}
                      </div>
                    </>
                  )}
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
                          .select('id, file_type, type, title, source_vendor, url, content')
                          .eq('id', detail.id)
                          .single();
                        
                        if (docError || !docData) {
                          toast.error('문서 정보 조회 실패', {
                            description: docError?.message || '문서를 찾을 수 없습니다.',
                            duration: 5000,
                          });
                          return;
                        }
                        
                        // URL 문서인 경우 reprocess-url API 사용
                        if (docData.type === 'url' || docData.url) {
                          const res = await fetch('/api/jobs/reprocess-url', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              documentId: detail.id,
                            })
                          });
                          
                          const result = await res.json();
                          
                          if (res.ok && result.success) {
                            toast.success('재처리 시작', {
                              description: `URL 문서 재처리가 시작되었습니다. (청크: ${result.chunkCount || 0}개)`,
                              duration: 3000,
                            });
                            onRefetch();
                            if (typeof window !== 'undefined') {
                              window.dispatchEvent(new CustomEvent('docs-refresh'));
                            }
                          } else {
                            toast.error('재처리 실패', {
                              description: result.error || result.details || 'URL 문서 재처리에 실패했습니다.',
                              duration: 5000,
                            });
                          }
                          return;
                        }
                        
                        // 파일 문서인 경우 기존 로직 사용
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
                          logger.warn('기존 청크 삭제 실패 (무시):', deleteChunksError);
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
                        logger.error('재처리 오류:', error);
                        toast.error('재처리 오류', {
                          description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
                          duration: 5000,
                        });
                      }
                    }}
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
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
                  {finalDocumentUrl ? (
                    <a
                      href={finalDocumentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline break-all"
                    >
                      {finalDocumentUrl}
                    </a>
                  ) : (
                    <span className="text-muted-enhanced break-all">
                      {detail?.url || fullDoc?.url || '-'}
                    </span>
                  )}
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
                    logger.warn('청크 삭제 오류:', chunksError);
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
                  logger.error('문서 삭제 오류:', error);
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
