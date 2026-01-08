'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
// import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
// import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
// import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Globe,
  Plus,
  Trash2,
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  ExternalLink,
  Settings,
  Edit,
  Save,
  X,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  RefreshCw,
  BarChart3,
  Layers,
  Link as LinkIcon,
  Eye,
  EyeOff,
  RotateCcw
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';
import { UrlDiscoveryPanel, DiscoveredUrlItem } from './UrlDiscoveryPanel';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { createClient } from '@/lib/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';

// 미리 정의된 URL 템플릿 (대표 도메인만)
const predefinedUrlTemplates = {
  'Facebook Business (한국어)': [
    'https://ko-kr.facebook.com/business'
  ],
  'Instagram Business (한국어)': [
    'https://business.instagram.com/help/ko/'
  ],
  'Meta 개발자 문서 (한국어)': [
    'https://developers.facebook.com/docs/marketing-api/ko/'
  ],
  'Facebook Help (영어)': [
    'https://www.facebook.com/help/'
  ],
  'Facebook Business (영어)': [
    'https://www.facebook.com/business/help/'
  ],
  'Instagram Business (영어)': [
    'https://business.instagram.com/help/'
  ],
  'Meta 개발자 문서 (영어)': [
    'https://developers.facebook.com/docs/marketing-api/'
  ]
};

interface CrawlingProgress {
  url: string;
  status: 'pending' | 'crawling' | 'completed' | 'failed' | 'stabilizing';
  message?: string;
  // 선택된 URL 크롤링(Seed 크롤링) 진행 상황을 위해 사용
  chunkCount?: number;
  discoveredUrls?: Array<{
    url: string;
    title?: string;
    source: 'sitemap' | 'robots' | 'links' | 'pattern';
  }>;
  subPageProgress?: {
    processed: number;
    total: number;
    completed: number;
    failed: number;
  };
  stabilityCheck?: {
    stableCount: number;
    lastDocCount: number;
    expectedDocCount: number | null;
  };
}

const ALL_VENDORS = ["Meta", "Naver", "Kakao", "Google", "X(Twitter)"] as const;

// UI 벤더 이름을 DB ENUM 값으로 변환하는 매핑
const VENDOR_TO_DB_MAP: Record<string, string> = {
  "Meta": "META",
  "Naver": "NAVER",
  "Kakao": "KAKAO",
  "Google": "GOOGLE",
  "X(Twitter)": "OTHER", // X/Twitter는 OTHER로 매핑
};

interface HybridCrawlingManagerProps {
  onCrawlingComplete?: () => void;
  vendors?: string[];
  onVendorsChange?: (vendors: string[]) => void;
}

export default function HybridCrawlingManager({
  onCrawlingComplete,
  vendors = [],
  onVendorsChange
}: HybridCrawlingManagerProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [crawlingMode, setCrawlingMode] = useState<'predefined' | 'custom' | 'hybrid'>('predefined');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [customUrls, setCustomUrls] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlingProgress, setCrawlingProgress] = useState<CrawlingProgress[]>([]);
  const jobIdsRef = useRef<string[]>([]);
  // 🔥 추가: URL별 활성 작업 ID 매핑 (DB 지연 시에도 작업 존재 여부 확인용) - timestamp 추가하여 타임아웃 처리
  const activeJobsMapRef = useRef<Map<string, { id: string; timestamp: number }>>(new Map());
  const [extractSubPages, setExtractSubPages] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateUrls, setTemplateUrls] = useState<{ [key: string]: string[] }>({});
  const [originalTemplateUrls, setOriginalTemplateUrls] = useState<{ [key: string]: string[] }>({});
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateUrls, setNewTemplateUrls] = useState<string[]>(['']);
  const [expandedCategories, setExpandedCategories] = useState<{ [key: string]: boolean }>({});
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // URL 정규화 함수 (끝의 슬래시 제거)
  const normalizeUrl = (url: string) => url.replace(/\/$/, '');
  const [showUrlSelector, setShowUrlSelector] = useState(false);
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);
  const [showDiscoveredUrls, setShowDiscoveredUrls] = useState<{ [key: string]: boolean }>({});
  const [selectedDiscoveredUrls, setSelectedDiscoveredUrls] = useState<{ [key: string]: string[] }>({});

  // 심도 3 이상일 때 하위 페이지 선택 모달 상태
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [allDiscoveredUrls, setAllDiscoveredUrls] = useState<DiscoveredUrlItem[]>([]);
  const [selectedUrlsForCrawling, setSelectedUrlsForCrawling] = useState<Set<string>>(new Set());
  const [pendingCrawlUrls, setPendingCrawlUrls] = useState<string[]>([]);
  const [groupedDiscoveredUrls, setGroupedDiscoveredUrls] = useState<Record<string, DiscoveredUrlItem[]>>({});

  // 하위 페이지 크롤링 진행률 polling을 위한 상태
  const [subPageCrawlJobIds, setSubPageCrawlJobIds] = useState<Map<string, string>>(new Map()); // URL -> jobId 매핑
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const crawlingCompleteTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Advanced Crawl Options
  const [crawlOptions, setCrawlOptions] = useState({
    domainLimit: true,
    respectRobots: true,
    maxDepth: '2',
    forceCrawl: false, // robots.txt 무시
    deepCrawlTimeout: false, // 30분 타임아웃 (기본 15분)
    retryOn429: true, // 429 에러 재시도
    useCrawlerV2: false, // 크롤러 V2 사용 여부
    paginationMode: false, // Pagination 모드
    maxUrls: 500, // 최대 페이지 수
    timeout: 30000, // 타임아웃 (ms)
  });

  // 타임아웃 경고 상태
  const [timeoutWarning, setTimeoutWarning] = useState<{
    show: boolean;
    discoveredCount: number;
    safeCrawlableCount: number;
    message: string;
  } | null>(null);

  const clampDepthValue = (value: string | number) => {
    const numeric = typeof value === 'number' ? value : parseInt(value, 10);
    if (!Number.isFinite(numeric)) {
      return 1;
    }
    return Math.max(1, Math.min(4, numeric));
  };

  // 템플릿 로드
  const loadTemplates = async (vendorFilter?: string) => {
    try {
      console.log('템플릿 로드 시도...', { vendorFilter });

      // 벤더 필터가 있으면 쿼리 파라미터 추가
      const url = vendorFilter
        ? `/api/admin/url-templates?vendor=${encodeURIComponent(vendorFilter)}`
        : '/api/admin/url-templates';

      const response = await fetchWithTimeout(url);
      const data = await response.json();

      console.log('템플릿 로드 응답:', data);

      if (data.success) {
        setTemplateUrls(data.templates);
        setOriginalTemplateUrls(data.templates);
        setTemplatesLoaded(true);
        console.log('템플릿 로드 성공:', Object.keys(data.templates).length, '개');
      } else {
        console.error('템플릿 로드 실패:', data.error);
        // 실패 시 기본 템플릿 사용
        setTemplateUrls(predefinedUrlTemplates);
        setOriginalTemplateUrls(predefinedUrlTemplates);
        setTemplatesLoaded(true);
      }
    } catch (error) {
      console.error('템플릿 로드 오류:', error);
      // 오류 시 기본 템플릿 사용
      setTemplateUrls(predefinedUrlTemplates);
      setOriginalTemplateUrls(predefinedUrlTemplates);
      setTemplatesLoaded(true);
    }
  };

  // 컴포넌트 마운트 시 템플릿 로드
  React.useEffect(() => {
    if (!templatesLoaded) {
      // 벤더가 선택되어 있으면 첫 번째 벤더로 필터링, 없으면 전체 로드
      const dbVendor = vendors.length > 0 ? VENDOR_TO_DB_MAP[vendors[0]] : undefined;
      loadTemplates(dbVendor);
    }
  }, [templatesLoaded]);

  // 벤더 변경 시 템플릿 다시 로드
  React.useEffect(() => {
    if (templatesLoaded) {
      const dbVendor = vendors.length > 0 ? VENDOR_TO_DB_MAP[vendors[0]] : undefined;
      loadTemplates(dbVendor);
      // 선택된 템플릿 초기화
      setSelectedTemplates([]);
    }
  }, [vendors]);

  // 컴포넌트 언마운트 시 타이머 정리
  React.useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (crawlingCompleteTimeoutRef.current) {
        clearTimeout(crawlingCompleteTimeoutRef.current);
        crawlingCompleteTimeoutRef.current = null;
      }
    };
  }, []);

  // 🔥 무한대기 문서 자동 체크 및 해결 (5분마다)
  React.useEffect(() => {
    const autoCheckStuckDocuments = async () => {
      try {
        console.log('🔍 무한대기 문서 자동 체크 시작...');
        const response = await fetch('/api/admin/check-processing-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data.synced > 0) {
            console.log(`✅ 자동 체크: ${result.data.synced}개 무한대기 문서 해결됨`);
            // 동기화된 문서가 있으면 문서 목록 새로고침
            if (onCrawlingComplete) {
              setTimeout(() => {
                onCrawlingComplete();
              }, 500);
            }
            queryClient.invalidateQueries({ queryKey: ['admin-documents'], exact: false });
            queryClient.invalidateQueries({ queryKey: ['documents'], exact: false });
          }
        }
      } catch (error) {
        console.error('자동 상태 체크 오류:', error);
      }
    };

    // 초기 로드 시 즉시 체크
    autoCheckStuckDocuments();

    // 5분마다 자동 체크
    const autoCheckInterval = setInterval(autoCheckStuckDocuments, 5 * 60 * 1000);

    return () => {
      clearInterval(autoCheckInterval);
    };
  }, [onCrawlingComplete, queryClient]);

  // 초기 로드 시 진행 중인 크롤링 작업 자동 감지 및 폴링 시작
  React.useEffect(() => {
    const initializeCrawlingState = async () => {
      try {
        // [NEW] 0단계: 좀비 작업 자동 정리 (타임아웃된 processing 작업 failed로 업데이트)
        try {
          const cleanupResponse = await fetch('/api/admin/cleanup-zombie-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: false })
          });
          if (cleanupResponse.ok) {
            const cleanupData = await cleanupResponse.json();
            console.log('🧹 좀비 작업 정리 결과:', cleanupData);
          }
        } catch (cleanupError) {
          console.warn('⚠️ 좀비 작업 정리 실패 (무시):', cleanupError);
        }
        try {
          await fetch('/api/admin/cleanup-jobs', { method: 'POST' });
          console.log('🧹 좀비 작업 정리 완료');
        } catch (cleanupError) {
          console.error('좀비 작업 정리 실패:', cleanupError);
        }

        // [NEW] 0-1단계: 무한대기 문서 자동 체크 및 해결
        try {
          const checkResponse = await fetch('/api/admin/check-processing-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          if (checkResponse.ok) {
            const checkResult = await checkResponse.json();
            if (checkResult.success && checkResult.data.synced > 0) {
              console.log(`✅ 초기 로드: ${checkResult.data.synced}개 무한대기 문서 해결됨`);
            }
          }
        } catch (checkError) {
          console.error('초기 상태 체크 실패:', checkError);
        }

        // 1단계: processing 상태인 작업 중 실제로 완료된 것 강제 동기화
        const { data: stuckProcessingJobs, error: stuckError } = await supabase
          .from('processing_jobs')
          .select('id, document_id, status, payload, started_at')
          .eq('job_type', 'CRAWL_SEED')
          .eq('status', 'processing')
          .order('created_at', { ascending: false })
          .limit(100);

        if (!stuckError && stuckProcessingJobs && stuckProcessingJobs.length > 0) {
          // 각 작업의 document_id로 documents 테이블 확인
          for (const job of stuckProcessingJobs) {
            if (job.document_id) {
              const { data: document } = await supabase
                .from('documents')
                .select('id, status, chunk_count')
                .eq('id', job.document_id)
                .single();

              // 문서가 indexed 상태이고 chunk_count > 0이면 작업 완료로 간주
              if (document && (document.status === 'indexed' || document.chunk_count > 0)) {
                console.log(`🔧 강제 동기화: 작업 ${job.id}는 실제로 완료되었습니다 (문서 상태: ${document.status}, 청크: ${document.chunk_count})`);

                // processing_jobs를 completed로 업데이트
                await supabase
                  .from('processing_jobs')
                  .update({
                    status: 'completed',
                    finished_at: new Date().toISOString(),
                    result: {
                      note: 'force_synced',
                      chunkCount: document.chunk_count || 0,
                      documentStatus: document.status
                    }
                  })
                  .eq('id', job.id)
                  .eq('status', 'processing');
              }
            }
          }
        }

        // 2단계: 진행 중인 CRAWL_SEED 작업 조회 (cancelled 제외)
        const { data: activeJobs, error } = await supabase
          .from('processing_jobs')
          .select('id, status, result, payload, started_at, finished_at, document_id')
          .eq('job_type', 'CRAWL_SEED')
          .in('status', ['queued', 'processing', 'retrying', 'completed', 'failed'])
          .neq('status', 'cancelled') // cancelled 상태 제외
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) {
          console.error('진행 중인 작업 조회 오류:', error);
          return;
        }

        if (activeJobs && activeJobs.length > 0) {
          // 모든 작업을 상태별로 분류
          const incompleteJobs = activeJobs.filter(j =>
            ['queued', 'processing', 'retrying'].includes(j.status) && !j.finished_at
          );

          // 🔥 completed/failed 작업은 백엔드에서 이미 처리되었으므로 그대로 표시
          const completedJobs = activeJobs.filter(j =>
            j.status === 'completed' && j.finished_at !== null
          );

          const failedJobs = activeJobs.filter(j => j.status === 'failed');

          // 완료된 작업이 있으면 콜백 호출 (문서 목록 새로고침)
          if (completedJobs.length > 0 && onCrawlingComplete) {
            setTimeout(() => {
              onCrawlingComplete();
            }, 1000);
          }

          // 완료되지 않은 작업만 진행 상황에 표시
          if (incompleteJobs.length > 0) {
            // 진행 상황 상태 초기화
            const progressItems: CrawlingProgress[] = incompleteJobs.map(job => {
              const jobUrl = (job.payload as any)?.url;
              const jobResult = job.result as any;
              return {
                url: jobUrl || '알 수 없는 URL',
                status: job.status === 'processing' ? 'crawling' as const : 'pending' as const,
                message: job.status === 'processing' ? '크롤링 중...' : '큐 대기 중...',
                chunkCount: jobResult?.chunkCount || 0
              };
            });

            setCrawlingProgress(progressItems);
            setIsCrawling(true);

            // jobIds 설정
            const jobIds = incompleteJobs.map(j => j.id);
            jobIdsRef.current = jobIds;

            // 폴링 시작 (기존 폴링이 없을 때만)
            if (!pollingIntervalRef.current) {
              pollingIntervalRef.current = setInterval(async () => {
                try {
                  // URL 기반으로 조회
                  const currentUrls = progressItems.map(p => p.url);

                  const { data: jobs, error: jobsError } = await supabase
                    .from('processing_jobs')
                    .select('id, status, result, payload, started_at, finished_at')
                    .eq('job_type', 'CRAWL_SEED')
                    .in('status', ['queued', 'processing', 'retrying', 'completed', 'failed'])
                    .order('created_at', { ascending: false })
                    .limit(100);

                  if (jobsError) {
                    console.error('폴링 중 작업 조회 오류:', jobsError);
                    return;
                  }

                  if (jobs && jobs.length > 0) {
                    // 현재 URL과 매칭되는 작업만 필터링
                    const matchingJobs = jobs.filter(job => {
                      const jobUrl = (job.payload as any)?.url;
                      return jobUrl && currentUrls.includes(jobUrl);
                    });

                    // URL과 jobId 매핑 생성
                    const urlToJobIdMap = new Map<string, string>();
                    matchingJobs.forEach(job => {
                      const jobUrl = (job.payload as any)?.url;
                      if (jobUrl) {
                        urlToJobIdMap.set(jobUrl, job.id);
                      }
                    });

                    // 타임아웃 감지
                    const now = Date.now();
                    const TIMEOUT_MS = 2 * 60 * 60 * 1000;
                    const stuckJobs = matchingJobs.filter(j => {
                      if (j.status === 'processing' && j.started_at) {
                        const elapsed = now - new Date(j.started_at).getTime();
                        return elapsed > TIMEOUT_MS;
                      }
                      return false;
                    });

                    // 진행 상황 업데이트
                    setCrawlingProgress(prev => {
                      const updated = prev.map(p => {
                        const jobId = urlToJobIdMap.get(p.url);
                        if (jobId) {
                          const job = matchingJobs.find(j => j.id === jobId);
                          if (job) {
                            // finished_at이 있으면 완료로 간주
                            if (job.finished_at || job.status === 'completed') {
                              return { ...p, status: 'completed' as const, message: '크롤링 완료', chunkCount: (job.result as any)?.chunkCount || 0 };
                            } else if (job.status === 'failed') {
                              return { ...p, status: 'failed' as const, message: '크롤링 실패' };
                            } else if (job.status === 'processing') {
                              // 🔥 타임아웃 체크: processing 상태인 작업이 타임아웃되었는지 확인
                              if (job.started_at) {
                                const startedAt = new Date(job.started_at).getTime();
                                const now = Date.now();
                                const elapsed = now - startedAt;
                                
                                // deepCrawlTimeout 옵션 확인 (payload에서)
                                const deepCrawlTimeout = (job.payload as any)?.deepCrawlTimeout === true;
                                const timeoutMs = deepCrawlTimeout ? 30 * 60 * 1000 : 15 * 60 * 1000; // 30분 또는 15분
                                const timeoutMinutes = Math.round(timeoutMs / (60 * 1000));
                                
                                if (elapsed > timeoutMs) {
                                  console.log(`[POLL] ⏰ ${p.url}: 타임아웃 감지 (경과: ${Math.round(elapsed / (60 * 1000))}분, 제한: ${timeoutMinutes}분) - 실패 처리`);
                                  return { ...p, status: 'failed' as const, message: `크롤링 타임아웃 (${timeoutMinutes}분 초과)` };
                                }
                                
                                // 타임아웃에 가까워지면 경고 메시지
                                const warningThreshold = timeoutMs * 0.8; // 80% 경과 시 경고
                                if (elapsed > warningThreshold) {
                                  const remainingMinutes = Math.round((timeoutMs - elapsed) / (60 * 1000));
                                  return { ...p, status: 'crawling' as const, message: `크롤링 중... (${remainingMinutes}분 남음)`, chunkCount: (job.result as any)?.chunkCount || 0 };
                                }
                              }
                              
                              // 기존 stuckJobs 체크 (2시간 초과 - 레거시)
                              if (stuckJobs.some(j => j.id === jobId)) {
                                return { ...p, status: 'failed' as const, message: '크롤링 타임아웃 (2시간 초과)' };
                              }
                              return { ...p, status: 'crawling' as const, message: '크롤링 중...', chunkCount: (job.result as any)?.chunkCount || 0 };
                            } else if (job.status === 'queued' || job.status === 'retrying') {
                              return { ...p, status: 'pending' as const, message: '큐 대기 중...' };
                            }
                          }
                        }
                        return p;
                      }).filter((p): p is CrawlingProgress => p !== null);

                      return updated;
                    });

                    // (구) 완료 체크 로직 제거됨 - setCrawlingProgress 내부로 통합됨
                  }
                } catch (pollError) {
                  console.error('폴링 오류:', pollError);
                }
              }, 2000);
            }
          }
        }
      } catch (initError) {
        console.error('초기 크롤링 상태 로드 오류:', initError);
      }
    };

    initializeCrawlingState();

    // 컴포넌트 언마운트 시 폴링 정리
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []); // 빈 의존성 배열: 마운트 시 한 번만 실행

  // URL 삭제 함수
  const handleDeleteUrl = async (url: string) => {
    if (!confirm(`"${url}" URL을 삭제하시겠습니까?`)) {
      return;
    }

    setDeletingUrl(url);
    try {
      // 사용자 정의 URL은 아직 크롤링되지 않은 상태이므로
      // 프론트엔드 상태에서만 제거하면 됩니다

      // URL 목록에서 제거
      setCustomUrls(prev => prev.filter(u => u !== url));
      setSelectedUrls(prev => prev.filter(u => u !== url));

      // 성공 메시지 표시
      toast.success('URL이 목록에서 제거되었습니다.');

    } catch (error) {
      console.error('URL 삭제 오류:', error);
      toast.error(`URL 삭제 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeletingUrl(null);
    }
  };

  // 템플릿 선택 토글
  const toggleTemplate = (templateName: string) => {
    if (selectedTemplates.includes(templateName)) {
      setSelectedTemplates(selectedTemplates.filter(t => t !== templateName));
    } else {
      setSelectedTemplates([...selectedTemplates, templateName]);
    }
  };

  // 사용자 정의 URL 추가
  const addCustomUrl = () => {
    if (newUrl.trim() && !customUrls.includes(newUrl.trim())) {
      setCustomUrls([...customUrls, newUrl.trim()]);
      setNewUrl('');
      toast.success('URL이 추가되었습니다.');
    }
  };

  // 사용자 정의 URL 삭제
  const removeCustomUrl = (index: number) => {
    setCustomUrls(customUrls.filter((_, i) => i !== index));
  };

  // 템플릿 편집 시작
  const startEditingTemplate = (templateName: string) => {
    // 원본 데이터 저장
    setOriginalTemplateUrls(prev => ({
      ...prev,
      [templateName]: [...templateUrls[templateName]]
    }));
    setEditingTemplate(templateName);
  };

  // 템플릿 편집 취소
  const cancelEditingTemplate = () => {
    if (editingTemplate) {
      // 원본 데이터로 복원
      setTemplateUrls(prev => ({
        ...prev,
        [editingTemplate]: [...originalTemplateUrls[editingTemplate]]
      }));
    }
    setEditingTemplate(null);
  };

  // 템플릿 URL 업데이트
  const updateTemplateUrl = (templateName: string, index: number, value: string) => {
    setTemplateUrls(prev => ({
      ...prev,
      [templateName]: prev[templateName].map((url, i) => i === index ? value : url)
    }));
  };

  // 템플릿 URL 추가
  const addTemplateUrl = (templateName: string) => {
    setTemplateUrls(prev => ({
      ...prev,
      [templateName]: [...prev[templateName], '']
    }));
  };

  // 템플릿 URL 삭제
  const removeTemplateUrl = (templateName: string, index: number) => {
    setTemplateUrls(prev => ({
      ...prev,
      [templateName]: prev[templateName].filter((_, i) => i !== index)
    }));
  };

  // 새 템플릿 추가
  const addNewTemplate = async () => {
    if (newTemplateName.trim() && newTemplateUrls.some(url => url.trim())) {
      const validUrls = newTemplateUrls.filter(url => url.trim());
      const templateName = newTemplateName.trim();

      // 현재 선택된 벤더의 DB 값 가져오기 (없으면 META)
      const dbVendor = vendors.length > 0 ? VENDOR_TO_DB_MAP[vendors[0]] : 'META';

      try {
        console.log('새 템플릿 추가 시도:', { name: templateName, urls: validUrls, vendor: dbVendor });

        const response = await fetchWithTimeout('/api/admin/url-templates', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: templateName,
            urls: validUrls,
            vendor: dbVendor
          })
        });

        const data = await response.json();
        console.log('API 응답:', data);

        if (data.success) {
          // 먼저 백엔드에서 최신 데이터를 다시 로드
          await loadTemplates(dbVendor);

          setNewTemplateName('');
          setNewTemplateUrls(['']);
          toast.success('새 템플릿이 추가되었습니다.');
        } else {
          toast.error(data.error || '템플릿 추가에 실패했습니다.');
        }
      } catch (error) {
        console.error('템플릿 추가 오류:', error);
        toast.error('템플릿 추가 중 오류가 발생했습니다.');
      }
    } else {
      toast.error('템플릿 이름과 최소 하나의 URL을 입력해주세요.');
    }
  };

  // 템플릿 저장
  const saveTemplate = async (templateName: string) => {
    // 빈 URL 제거
    const validUrls = templateUrls[templateName].filter(url => url.trim());
    if (validUrls.length === 0) {
      toast.error('최소 하나의 유효한 URL이 필요합니다.');
      return;
    }

    try {
      console.log('템플릿 저장 시도:', { name: templateName, urls: validUrls });

      const response = await fetchWithTimeout('/api/admin/url-templates', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: templateName,
          urls: validUrls
        })
      });

      const data = await response.json();
      console.log('API 응답:', data);

      if (data.success) {
        // 먼저 백엔드에서 최신 데이터를 다시 로드
        await loadTemplates();

        setEditingTemplate(null);
        toast.success('템플릿이 저장되었습니다.');
      } else {
        toast.error(data.error || '템플릿 저장에 실패했습니다.');
      }
    } catch (error) {
      console.error('템플릿 저장 오류:', error);
      toast.error('템플릿 저장 중 오류가 발생했습니다.');
    }
  };

  // 템플릿 삭제
  const deleteTemplate = async (templateName: string) => {
    if (!confirm(`"${templateName}" 템플릿을 삭제하시겠습니까?`)) {
      return;
    }

    try {
      console.log('템플릿 삭제 시도:', templateName);

      const response = await fetchWithTimeout(`/api/admin/url-templates?name=${encodeURIComponent(templateName)}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      console.log('API 응답:', data);

      if (data.success) {
        // 먼저 백엔드에서 최신 데이터를 다시 로드
        await loadTemplates();

        setSelectedTemplates(prev => prev.filter(t => t !== templateName));
        setEditingTemplate(null);
        toast.success('템플릿이 삭제되었습니다.');
      } else {
        toast.error(data.error || '템플릿 삭제에 실패했습니다.');
      }
    } catch (error) {
      console.error('템플릿 삭제 오류:', error);
      toast.error('템플릿 삭제 중 오류가 발생했습니다.');
    }
  };

  // 크롤링 시작
  const handleStartCrawling = async () => {
    const urlsToCrawl: string[] = [];
    const maxDepthValue = clampDepthValue(crawlOptions.maxDepth);

    // 선택된 템플릿에서 URL 추출
    if (crawlingMode !== 'custom') {
      selectedTemplates.forEach(templateName => {
        const urls = templateUrls[templateName] || [];
        urlsToCrawl.push(...urls);
      });
    }

    // 사용자 정의 URL 추가
    if (crawlingMode !== 'predefined') {
      urlsToCrawl.push(...customUrls);

      // [FIX] 입력창에 값이 있으면 자동으로 추가
      if (newUrl && newUrl.trim()) {
        const urlToAdd = newUrl.trim();
        // 중복 체크
        if (!urlsToCrawl.includes(urlToAdd)) {
          urlsToCrawl.push(urlToAdd);
          setCustomUrls(prev => [...prev, urlToAdd]);
          setNewUrl('');
        }
      }
    }

    // 테스트용 공개 URL 추가 (Facebook URL이 실패하는 경우)
    if (urlsToCrawl.length === 0) {
      const testUrls = [
        'https://httpbin.org/html',
        'https://example.com',
        'https://jsonplaceholder.typicode.com/posts/1',
        'https://httpbin.org/json',
        'https://httpbin.org/xml',
        'https://httpbin.org/robots.txt'
      ];
      urlsToCrawl.push(...testUrls);
      toast.info('테스트용 공개 URL로 크롤링을 시작합니다.');
    }

    if (urlsToCrawl.length === 0) {
      toast.error('크롤링할 URL을 선택하거나 입력해주세요.');
      return;
    }

    // 크롤링 시작 전 상태 초기화 및 즉시 크롤링 상태로 설정
    // 프로그레스바가 즉시 보이도록 먼저 설정
    const initialProgress = urlsToCrawl.map(url => ({ url, status: 'pending' as const }));
    setCrawlingProgress(initialProgress);
    setIsCrawling(true);

    // 프로그레스바가 즉시 렌더링되도록 강제 업데이트
    await new Promise(resolve => setTimeout(resolve, 100));

    // 크롤러 V2 사용 여부에 따라 분기
    if (crawlOptions.useCrawlerV2) {
      executeCrawlingV2(urlsToCrawl, maxDepthValue);
    } else {
      executeCrawling();
    }

    async function executeCrawling() {
      try {
        const dbVendor = vendors.length > 0 ? VENDOR_TO_DB_MAP[vendors[0]] || 'META' : 'META';

        // 1. 큐에 작업 등록 (CRAWL_SEED) - 문서 생성은 워커에게 위임 (Test Page 방식)
        console.log(`📋 ${urlsToCrawl.length}개 URL 크롤링 요청 (Async Queue)...`);

        if (extractSubPages) {
          toast.info('하위 페이지 자동 추출이 백그라운드에서 진행됩니다.');
        }

        const jobIds: string[] = [];

        for (const url of urlsToCrawl) {
          try {
            // UI 상태 업데이트
            setCrawlingProgress(prev =>
              prev.map(p =>
                p.url === url ? { ...p, status: 'pending', message: '작업 큐 등록 중...' } : p
              )
            );

            // 문서 ID 없이 URL만으로 작업 등록 (워커가 문서 생성/찾기 수행)
            const enqueueResponse = await fetchWithTimeout('/api/jobs/enqueue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jobType: 'CRAWL_SEED',
                // documentId: ... (생략: 워커가 URL로 찾거나 생성함)
                priority: 5,
                payload: {
                  url: url,
                  // title: ... (생략: 워커가 수집함)
                  vendors: [dbVendor],
                  domainLimit: crawlOptions.domainLimit,
                  respectRobots: crawlOptions.forceCrawl ? false : crawlOptions.respectRobots,
                  maxDepth: clampDepthValue(crawlOptions.maxDepth),
                  extractSubPages: extractSubPages,
                  forceCrawl: crawlOptions.forceCrawl,
                  deepCrawlTimeout: crawlOptions.deepCrawlTimeout,
                  retryOn429: crawlOptions.retryOn429
                }
              }),
            }, 30000);

            if (!enqueueResponse.ok) {
              throw new Error(`작업 등록 실패: ${enqueueResponse.status}`);
            }

            const enqueueResult = await enqueueResponse.json();
            if (enqueueResult.jobId) {
              jobIds.push(enqueueResult.jobId);
              jobIdsRef.current.push(enqueueResult.jobId);
              activeJobsMapRef.current.set(url, { id: enqueueResult.jobId, timestamp: Date.now() }); // 🔥 로컬 매핑 저장 (타임아웃용 timestamp 포함)
              setCrawlingProgress(prev =>
                prev.map(p =>
                  p.url === url ? { ...p, message: '처리 대기 중 (백그라운드)...' } : p
                )
              );
            } else {
              throw new Error(enqueueResult.error || '작업 ID 반환 실패');
            }
          } catch (jobError) {
            console.error(`URL 작업 등록 실패: ${url}`, jobError);
            setCrawlingProgress(prev =>
              prev.map(p =>
                p.url === url
                  ? { ...p, status: 'failed', message: '작업 등록 실패' }
                  : p
              )
            );
          }
        }

        // 2. 작업이 하나라도 등록되었으면 폴링 시작 및 워커 트리거
        if (jobIds.length > 0) {
          toast.success(`${jobIds.length}개 크롤링 작업이 시작되었습니다.`);

          // 큐 워커 트리거
          try {
            fetchWithTimeout('/api/jobs/consume', { method: 'POST' }, 5000).catch(() => { });
          } catch (e) { /* 무시 */ }

          // 폴링 시작 - URL 기반으로 폴링 (문서가 아직 생성 안 됐을 수 있으므로)
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
          }

          pollingIntervalRef.current = setInterval(() => {
            pollCrawlStatusFromJobs(urlsToCrawl);
          }, 2000);

          // 즉시 첫 폴링
          setTimeout(() => pollCrawlStatusFromJobs(urlsToCrawl), 1000);

        } else {
          // 모든 작업 등록 실패 시
          if (urlsToCrawl.length > 0) {
            toast.error('작업 등록에 실패했습니다.');
          }
          setIsCrawling(false);
        }

      } catch (error) {
        console.error('❌ 크롤링 시작 프로세스 오류:', error);
        toast.error(error instanceof Error ? error.message : '크롤링 시작 중 오류가 발생했습니다.');
        setCrawlingProgress(prev =>
          prev.map(p => p.status === 'pending' || p.status === 'crawling'
            ? { ...p, status: 'failed', message: '시작 실패' }
            : p
          )
        );
        setIsCrawling(false);
      }
    }
  };

  // 크롤러 V2를 사용한 크롤링 실행
  async function executeCrawlingV2(urlsToCrawl: string[], maxDepthValue: number) {
    const dbVendor = vendors.length > 0 ? VENDOR_TO_DB_MAP[vendors[0]] || 'META' : 'META';

    try {
      toast.info('🚀 크롤러 V2로 크롤링을 시작합니다.');

      const response = await fetch('/api/crawler-v2/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urlsToCrawl,
          options: {
            discoverSubPages: extractSubPages && !crawlOptions.paginationMode,
            paginationMode: crawlOptions.paginationMode,
            maxDepth: crawlOptions.paginationMode ? 1 : maxDepthValue,
            maxUrls: crawlOptions.maxUrls || 500,
            respectRobots: crawlOptions.forceCrawl ? false : crawlOptions.respectRobots,
            domainLimit: crawlOptions.domainLimit,
            timeout: crawlOptions.timeout || (crawlOptions.deepCrawlTimeout ? 60000 : 30000),
            waitTime: 1000,
          },
        }),
      });

      if (!response.body) {
        throw new Error('응답 스트림이 없습니다.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);

            if (data.type === 'progress') {
              // 진행률 업데이트
              const currentUrl = data.currentUrl || '';
              setCrawlingProgress(prev =>
                prev.map(p => {
                  if (p.url === currentUrl) {
                    return { ...p, status: 'crawling', message: data.message || '처리 중...' };
                  }
                  return p;
                })
              );
            } else if (data.type === 'log') {
              // 로그 메시지 표시
              console.log('📝 크롤러 로그:', data.message);
              // 중요 메시지는 toast로 표시 (심플한 스타일)
              if (data.message.includes('⚠️') || data.message.includes('경고') || data.message.includes('위험')) {
                toast.warning(data.message, { 
                  duration: 6000,
                  className: 'bg-amber-900/20 border-amber-700/30 text-amber-100',
                });
              }
            } else if (data.type === 'warning') {
              // 타임아웃 경고 메시지 (명확한 Alert 박스로 표시)
              const warningMessage = data.message || '타임아웃 위험이 감지되었습니다.';
              const discoveredCount = data.discoveredCount || 0;
              const safeCount = data.safeCrawlableCount || 0;
              
              console.warn('⚠️ 크롤러 경고:', warningMessage);
              
              // Alert 박스로만 표시 (Toast 제거)
              setTimeoutWarning({
                show: true,
                discoveredCount,
                safeCrawlableCount: safeCount,
                message: warningMessage,
              });
            } else if (data.type === 'batch_progress' && data.result) {
              // 개별 URL 완료
              const result = data.result;
              setCrawlingProgress(prev =>
                prev.map(p => {
                  if (p.url === result.url) {
                    return {
                      ...p,
                      status: result.status === 'success' ? 'completed' : 'failed',
                      message: result.status === 'success'
                        ? `${result.contentLength}자 추출 완료`
                        : result.error || '크롤링 실패',
                      discoveredUrls: result.discoveredUrls,
                    };
                  }
                  return p;
                })
              );

              // 성공한 결과를 DB에 저장
              if (result.status === 'success' && result.content) {
                try {
                  await saveV2ResultToDatabase(result, dbVendor);
                } catch (saveError) {
                  console.error('DB 저장 실패:', saveError);
                }
              }
            } else if (data.type === 'done') {
              toast.success(`크롤링 완료: 성공 ${data.summary?.success || 0}개, 실패 ${data.summary?.failed || 0}개`);

              // 완료 후 문서 목록 갱신
              queryClient.invalidateQueries({ queryKey: ['documents'] });
              onCrawlingComplete?.();
            } else if (data.type === 'error') {
              toast.error(data.error || '크롤링 실패');
            }
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }
    } catch (error) {
      console.error('❌ 크롤러 V2 오류:', error);
      toast.error(error instanceof Error ? error.message : '크롤링 중 오류가 발생했습니다.');
      setCrawlingProgress(prev =>
        prev.map(p => p.status === 'pending' || p.status === 'crawling'
          ? { ...p, status: 'failed', message: '크롤링 실패' }
          : p
        )
      );
    } finally {
      setIsCrawling(false);
    }
  }

  // V2 크롤링 결과를 DB에 저장
  async function saveV2ResultToDatabase(result: any, vendor: string) {
    const { data: existingDoc } = await supabase
      .from('documents')
      .select('id')
      .eq('url', result.url)
      .single();

    if (existingDoc) {
      // 기존 문서 업데이트
      await supabase
        .from('documents')
        .update({
          title: result.title,
          content: result.content,
          status: 'indexed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingDoc.id);
    } else {
      // 새 문서 생성
      await supabase
        .from('documents')
        .insert({
          title: result.title,
          url: result.url,
          content: result.content,
          source_type: 'url',
          source_vendor: vendor,
          status: 'indexed',
        });
    }
  }

  // 크롤링 취소 핸들러
  const handleResetCrawling = async () => {
    try {
      // 진행 중인 모든 작업 취소
      const activeJobIds: string[] = [];

      // 폴링 중인 작업 ID 수집
      crawlingProgress.forEach(progress => {
        // progress에서 jobId를 추출할 수 있는 방법이 필요
        // 현재 구조에서는 URL만 있으므로, Supabase에서 해당 URL의 job을 찾아야 함
      });

      // Supabase에서 진행 중인 CRAWL_SEED 작업 조회
      const { data: activeJobs } = await supabase
        .from('processing_jobs')
        .select('id, payload')
        .eq('job_type', 'CRAWL_SEED')
        .in('status', ['queued', 'processing', 'retrying'])
        .order('created_at', { ascending: false })
        .limit(100);

      if (activeJobs && activeJobs.length > 0) {
        // 현재 크롤링 중인 URL과 매칭되는 작업 찾기
        const currentUrls = new Set(crawlingProgress.map(p => p.url));
        const matchingJobs = activeJobs.filter(job => {
          const jobUrl = (job.payload as any)?.url;
          return jobUrl && currentUrls.has(jobUrl);
        });

        // 매칭되는 작업들 취소
        for (const job of matchingJobs) {
          try {
            const cancelRes = await fetchWithTimeout('/api/jobs/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobId: job.id, action: 'cancel' }),
            }, 10000);

            if (cancelRes.ok) {
              const cancelResult = await cancelRes.json();
              if (cancelResult.success) {
                activeJobIds.push(job.id);
              }
            }
          } catch (cancelError) {
            console.error(`작업 취소 실패: ${job.id}`, cancelError);
          }
        }
      }

      // 폴링 중지
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      // 프론트엔드 상태 초기화
      setCrawlingProgress([]);
      setIsCrawling(false);

      if (activeJobIds.length > 0) {
        toast.success(`${activeJobIds.length}개 작업이 취소되었습니다.`);
      } else {
        toast.info('크롤링 상태가 초기화되었습니다.');
      }
    } catch (error) {
      console.error('크롤링 취소 오류:', error);
      toast.error('크롤링 취소 중 오류가 발생했습니다.');
      // 오류 발생 시에도 프론트엔드 상태는 초기화
      setCrawlingProgress([]);
      setIsCrawling(false);
    }
  };

  // 선택된 URL 수 계산
  const getSelectedUrlCount = () => {
    let count = 0;
    if (crawlingMode !== 'custom') {
      selectedTemplates.forEach(templateName => {
        const urls = templateUrls[templateName] || [];
        count += urls.length;
      });
    }
    if (crawlingMode !== 'predefined') {
      count += customUrls.length;
    }
    return count;
  };

  // 발견된 URL 토글
  const toggleDiscoveredUrls = (url: string) => {
    setShowDiscoveredUrls(prev => ({
      ...prev,
      [url]: !prev[url]
    }));
  };

  // 발견된 URL 선택/해제
  const toggleDiscoveredUrlSelection = (parentUrl: string, discoveredUrl: string) => {
    setSelectedDiscoveredUrls(prev => {
      const current = prev[parentUrl] || [];
      const isSelected = current.includes(discoveredUrl);

      if (isSelected) {
        return {
          ...prev,
          [parentUrl]: current.filter(url => url !== discoveredUrl)
        };
      } else {
        return {
          ...prev,
          [parentUrl]: [...current, discoveredUrl]
        };
      }
    });
  };

  // 모든 발견된 URL 선택/해제
  const toggleAllDiscoveredUrls = (parentUrl: string, discoveredUrls: Array<{ url: string; title?: string; source: string }>) => {
    const current = selectedDiscoveredUrls[parentUrl] || [];
    const allSelected = discoveredUrls.every(discovered => current.includes(discovered.url));

    if (allSelected) {
      setSelectedDiscoveredUrls(prev => ({
        ...prev,
        [parentUrl]: []
      }));
    } else {
      setSelectedDiscoveredUrls(prev => ({
        ...prev,
        [parentUrl]: discoveredUrls.map(discovered => discovered.url)
      }));
    }
  };

  // 심도 3 이상 페이지 선택 모달 핸들러
  const handleDiscoveryModalSelectionChange = (url: string, selected: boolean) => {
    setSelectedUrlsForCrawling(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(url);
      } else {
        next.delete(url);
      }
      return next;
    });
  };

  const handleDiscoveryModalSelectAll = () => {
    setSelectedUrlsForCrawling(new Set(allDiscoveredUrls.map(item => item.url)));
  };

  const handleDiscoveryModalDeselectAll = () => {
    setSelectedUrlsForCrawling(new Set());
  };

  // 🔥 완전히 새로운 폴링 로직: jobIds를 직접 추적하고 processing_jobs를 직접 조회
  const pollCrawlStatusFromJobs = useCallback(async (urls: string[]) => {
    if (urls.length === 0) {
      setCrawlingProgress([]);
      setIsCrawling(false);
      jobIdsRef.current = [];
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    try {
      console.log(`[POLL] 🔍 폴링 시작: ${urls.length}개 URL, ${jobIdsRef.current.length}개 jobId`);

      // 1. jobIds로 직접 조회 (가장 확실한 방법)
      let jobs: any[] = [];
      if (jobIdsRef.current.length > 0) {
        const { data: jobsByIds, error: jobsError } = await supabase
          .from('processing_jobs')
          .select('id, status, payload, started_at, finished_at, document_id, result, error, created_at')
          .in('id', jobIdsRef.current)
          .order('created_at', { ascending: false });

        if (!jobsError && jobsByIds) {
          jobs = jobsByIds;
          console.log(`[POLL] ✅ jobIds로 ${jobs.length}개 작업 조회 성공`);
        } else if (jobsError) {
          console.error('[POLL] ❌ jobIds 조회 오류:', jobsError);
        }
      }

      // 2. URL로 documents 조회하여 document_id 가져오기
      const { data: documents, error: docsError } = await supabase
        .from('documents')
        .select('id, url, status, chunk_count')
        .in('url', urls)
        .order('created_at', { ascending: false });

      if (docsError) {
        console.error('[POLL] ❌ 문서 조회 오류:', docsError);
      }

      // URL -> document_id 매핑
      const urlToDocId = new Map<string, string>();
      const urlToDocStatus = new Map<string, { status: string; chunkCount: number }>();

      documents?.forEach(doc => {
        if (doc.url && !urlToDocId.has(doc.url)) {
          urlToDocId.set(doc.url, doc.id);
          urlToDocStatus.set(doc.url, {
            status: doc.status || 'pending',
            chunkCount: doc.chunk_count || 0
          });
        }
      });

      // 3. document_id로도 조회 (jobIds에 없는 경우 대비)
      const docIds = Array.from(urlToDocId.values());
      if (docIds.length > 0) {
        const { data: jobsByDocId, error: jobsByDocIdError } = await supabase
          .from('processing_jobs')
          .select('id, status, payload, started_at, finished_at, document_id, result, error, created_at')
          .eq('job_type', 'CRAWL_SEED')
          .in('document_id', docIds)
          .order('created_at', { ascending: false })
          .limit(100);

        if (!jobsByDocIdError && jobsByDocId) {
          // 중복 제거하면서 추가
          jobsByDocId.forEach(job => {
            if (!jobs.find(j => j.id === job.id)) {
              jobs.push(job);
            }
          });
          console.log(`[POLL] ✅ document_id로 추가 조회: ${jobsByDocId.length}개`);
        }
      }

      // 4. URL별로 가장 최신 작업 선택
      const urlToLatestJob = new Map<string, any>();
      jobs.forEach(job => {
        const jobUrl = (job.payload as any)?.url;
        if (jobUrl) {
          // URL 끝의 슬래시 차이를 무시하고 매칭
          const matchedUrl = urls.find(u => u === jobUrl || normalizeUrl(u) === normalizeUrl(jobUrl));

          if (matchedUrl) {
            const existing = urlToLatestJob.get(matchedUrl);
            if (!existing ||
              (job.created_at && existing.created_at &&
                new Date(job.created_at).getTime() > new Date(existing.created_at).getTime())) {
              urlToLatestJob.set(matchedUrl, job);
            }
          }
        }
      });

      console.log(`[POLL] 📊 URL별 작업 매핑: ${urlToLatestJob.size}개 URL에 작업 매칭됨`);

      // 5. 상태 업데이트 - documents 테이블을 최우선으로 확인 (가장 확실한 방법)
      // 🔥 핵심: processing 작업이 있어도 documents 테이블이 indexed면 그것을 우선함
      const nextProgress: CrawlingProgress[] = await Promise.all(urls.map(async (url) => {
        const job = urlToLatestJob.get(url);
        let docInfo = urlToDocStatus.get(url);

        // 🔥 CRITICAL: processing 작업이 있으면 documents 테이블을 강제로 다시 조회하여 최신 상태 확인
        if (job && (job.status === 'processing' || job.status === 'retrying' || job.status === 'completed' || job.finished_at)) {
          const { data: freshDoc } = await supabase
            .from('documents')
            .select('id, url, status, chunk_count')
            .eq('url', url)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (freshDoc) {
            docInfo = {
              status: freshDoc.status || 'pending',
              chunkCount: freshDoc.chunk_count || 0
            };
            console.log(`[POLL] 🔄 ${url}: documents 테이블 재조회 - status=${docInfo.status}, chunks=${docInfo.chunkCount}`);
          }
        }

        // 🔥 핵심: documents 테이블 상태를 최우선으로 확인 (백엔드에서 이미 indexed로 업데이트되었을 수 있음)
        if (docInfo) {
          const docStatus = docInfo.status;
          const docChunkCount = docInfo.chunkCount || 0;

          // indexed 또는 completed 상태이고 청크가 있으면 완료로 간주 (processing 작업이 있어도 무시)
          if ((docStatus === 'indexed' || docStatus === 'completed') && docChunkCount > 0) {
            console.log(`[POLL] ✅ ${url}: documents 테이블에서 indexed 상태 확인 (청크: ${docChunkCount}) - processing 작업 무시`);
            return {
              url,
              status: 'completed',
              message: `크롤링 완료 (${docChunkCount}개 청크 인덱싱됨)`,
              chunkCount: docChunkCount
            };
          }
          
          // 🔥 indexed/completed 상태인데 청크가 없으면 경고 (인덱싱 실패 가능성)
          if ((docStatus === 'indexed' || docStatus === 'completed') && docChunkCount === 0) {
            console.warn(`[POLL] ⚠️ ${url}: indexed/completed 상태인데 청크가 없음 - 인덱싱 검증 필요`);
            return {
              url,
              status: 'completed',
              message: '크롤링 완료 (인덱싱 검증 필요 - 청크 없음)',
              chunkCount: 0
            };
          }
          
          // 🔥 indexed/completed 상태인데 청크가 없으면 경고 (인덱싱 실패 가능성)
          if ((docStatus === 'indexed' || docStatus === 'completed') && docChunkCount === 0) {
            console.warn(`[POLL] ⚠️ ${url}: indexed/completed 상태인데 청크가 없음 - 인덱싱 검증 필요`);
            return {
              url,
              status: 'completed',
              message: '크롤링 완료 (인덱싱 검증 필요 - 청크 없음)',
              chunkCount: 0
            };
          }

          // failed 상태
          // 🔥 수정: 현재 실행 중인 작업(job)이 있고 그것이 진행 중이면, 문서의 failed 상태는 과거의 기록일 수 있으므로 무시함
          // failed 상태
          // 🔥 수정: 현재 실행 중인 작업(job)이 있고 그것이 진행 중이면, 문서의 failed 상태는 과거의 기록일 수 있으므로 무시함
          if (docStatus === 'failed') {
            // 🔥 수정: completed 상태도 포함하여 처리 (문서 상태가 아직 업데이트되지 않은 경우 대비)
            if (job && (job.status === 'processing' || job.status === 'pending' || job.status === 'queued')) {
              console.log(`[POLL] ⚠️ ${url}: 문서는 failed지만 새로운 작업이 진행 중 (status=${job.status}) - 크롤링 중으로 표시`);
              return {
                url,
                status: 'crawling',
                message: job.status === 'pending' ? '작업 대기 중...' : '크롤링 재시도 중...',
                chunkCount: docChunkCount
              };
            }

            // 🔥 추가: 잡이 존재하는데 위 조건(진행중/완료)에 안 걸렸다면 실패했거나 취소된 것임
            // 이 경우 activeJobsMapRef fallback으로 넘어가지 말고 바로 실패 처리해야 함
            if (job) {
              return {
                url,
                status: 'failed',
                message: job.message || `크롤링 실패 (${job.status})`
              };
            }

            // 🔥 추가: DB에 잡이 안 보이지만(지연) 로컬에는 등록된 경우
            // job이 없을 때만 체크해야 함
            const activeJobInfo = activeJobsMapRef.current.get(url);
            if (activeJobInfo) {
              // 30초 이상 지났는데도 DB에 없으면 실패 처리 (좀비/삭제됨)
              if (Date.now() - activeJobInfo.timestamp > 30000) {
                console.log(`[POLL] ❌ ${url}: 로컬 작업 타임아웃 (30초) - 실패 처리`);
                activeJobsMapRef.current.delete(url);
                return {
                  url,
                  status: 'failed',
                  message: '작업 응답 시간 초과 (30초)'
                };
              }

              console.log(`[POLL] ⚠️ ${url}: 문서는 failed지만 로컬 activeJobsMap에 존재 - 크롤링 중으로 표시`);
              return {
                url,
                status: 'crawling', // pending 대신 crawling으로 표시하여 실패 처리 방지
                message: '작업 초기화 중...',
                chunkCount: docChunkCount
              };
            }

            return {
              url,
              status: 'failed',
              message: '크롤링 실패'
            };
          }

          // processing 상태
          if (docStatus === 'processing') {
            return {
              url,
              status: 'crawling',
              message: '크롤링 중...',
              chunkCount: docChunkCount
            };
          }
        }

        // documents 테이블에 정보가 없거나 pending 상태인 경우, processing_jobs 확인
        if (job) {
          const jobStatus = job.status;
          const result = job.result as any | null;
          // ... (existing logic)
          // (omit for brevity, will match existing code until the next block)

          if (jobStatus === 'completed' || job.finished_at) {
            // ... existing logic
            const finalChunkCount = docInfo?.chunkCount || result?.chunkCount || 0;
            if (finalChunkCount > 0 || docInfo?.status === 'indexed') {
              // 🔥 인덱싱 검증: 청크가 실제로 있는지 확인
              if (finalChunkCount > 0) {
                return { url, status: 'completed', message: `크롤링 완료 (${finalChunkCount}개 청크 인덱싱됨)`, chunkCount: finalChunkCount };
              } else {
                // indexed 상태인데 청크가 없으면 경고
                return { url, status: 'completed', message: '크롤링 완료 (인덱싱 검증 필요 - 청크 없음)', chunkCount: 0 };
              }
            }
            return { url, status: 'crawling', message: '처리 중...', chunkCount: finalChunkCount };
          }

          if (jobStatus === 'failed') {
            return { url, status: 'failed', message: job.error || result?.error || '크롤링 실패' };
          }

          if (jobStatus === 'cancelled') {
            return { url, status: 'failed', message: '사용자에 의해 취소됨' };
          }

          // processing or retrying or pending
          // 🔥 타임아웃 체크: processing 상태인 작업이 타임아웃되었는지 확인
          if (jobStatus === 'processing' && job.started_at) {
            const startedAt = new Date(job.started_at).getTime();
            const now = Date.now();
            const elapsed = now - startedAt;
            
            // deepCrawlTimeout 옵션 확인 (payload에서)
            const deepCrawlTimeout = (job.payload as any)?.deepCrawlTimeout === true;
            const timeoutMs = deepCrawlTimeout ? 30 * 60 * 1000 : 15 * 60 * 1000; // 30분 또는 15분
            const timeoutMinutes = Math.round(timeoutMs / (60 * 1000));
            
            if (elapsed > timeoutMs) {
              console.log(`[POLL] ⏰ ${url}: 타임아웃 감지 (경과: ${Math.round(elapsed / (60 * 1000))}분, 제한: ${timeoutMinutes}분) - 실패 처리`);
              return {
                url,
                status: 'failed',
                message: `크롤링 타임아웃 (${timeoutMinutes}분 초과)`
              };
            }
            
            // 타임아웃에 가까워지면 경고 메시지
            const warningThreshold = timeoutMs * 0.8; // 80% 경과 시 경고
            if (elapsed > warningThreshold) {
              const remainingMinutes = Math.round((timeoutMs - elapsed) / (60 * 1000));
              return {
                url,
                status: 'crawling',
                message: `크롤링 중... (${remainingMinutes}분 남음)`,
                chunkCount: result?.chunkCount || docInfo?.chunkCount || 0
              };
            }
          }
          
          return {
            url,
            status: 'crawling',
            message: jobStatus === 'pending' ? '작업 대기 중...' : '크롤링 중...',
            chunkCount: result?.chunkCount || docInfo?.chunkCount || 0
          };
        }

        // 🔥 job이 DB에서 발견되지 않았지만 로컬에서 방금 등록한 작업인 경우 (DB 지연 대비)
        if (activeJobsMapRef.current.has(url)) {
          console.log(`[POLL] ⏳ ${url}: DB에 작업이 없지만 로컬에 등록됨 - 대기 상태 유지`);
          return {
            url,
            status: 'crawling', // pending 대신 crawling으로 표시하여 실패 처리 방지
            message: '작업 등록 확인 중...'
          };
        }

        // 아무것도 없는 경우
        return {
          url,
          status: 'pending',
          message: '대기 중...'
        };
      }));

      setCrawlingProgress(nextProgress);

      // 6. 완료/활성 작업 카운트
      const activeCount = nextProgress.filter(
        p => p.status === 'crawling' || p.status === 'pending'
      ).length;

      const completedCount = nextProgress.filter(
        p => p.status === 'completed'
      ).length;

      console.log(`[POLL] 📊 상태 요약: 완료 ${completedCount}개, 활성 ${activeCount}개, 전체 ${nextProgress.length}개`);

      // 🔥 완료된 작업이 있으면 즉시 문서 목록 새로고침
      if (completedCount > 0) {
        console.log(`[POLL] 🔄 ${completedCount}개 작업 완료 감지 - 문서 목록 새로고침 시작`);

        // 모든 documents 관련 쿼리 무효화
        queryClient.invalidateQueries({ queryKey: ['admin-documents'], exact: false });
        queryClient.invalidateQueries({ queryKey: ['documents'], exact: false });
        queryClient.invalidateQueries({ queryKey: ['queue-stats'], exact: false });

        // 콜백 호출
        if (onCrawlingComplete) {
          setTimeout(() => {
            console.log('[POLL] 📞 onCrawlingComplete 콜백 호출');
            onCrawlingComplete();
          }, 500);
        }
      }

      // 7. 모든 작업 완료 확인
      if (activeCount === 0) {
        console.log(`[POLL] 🎉 모든 작업 완료 - 폴링 종료`);
        setIsCrawling(false);

        // 완료된 작업은 crawlingProgress에서 제거 (3초 후)
        setTimeout(() => {
          setCrawlingProgress([]);
          jobIdsRef.current = [];
        }, 3000);

        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }

        // 최종 새로고침
        queryClient.invalidateQueries({ queryKey: ['admin-documents'], exact: false });
        queryClient.invalidateQueries({ queryKey: ['documents'], exact: false });
        queryClient.invalidateQueries({ queryKey: ['queue-stats'], exact: false });

        if (onCrawlingComplete) {
          setTimeout(() => {
            console.log('[POLL] 📞 최종 onCrawlingComplete 콜백 호출');
            onCrawlingComplete();
          }, 1000);
        }
      } else {
        setIsCrawling(true);
      }

    } catch (error) {
      console.error('[POLL] ❌ 크롤링 상태 폴링 오류:', error);
    }
  }, [supabase, onCrawlingComplete, queryClient]);

  // 🔥 새로운 handleDiscoveryModalConfirm: 단순하고 명확한 로직
  const handleDiscoveryModalConfirm = async () => {
    if (selectedUrlsForCrawling.size === 0) {
      toast.error('최소 1개 이상의 페이지를 선택해주세요.');
      return;
    }

    const selectedUrlsArray = Array.from(selectedUrlsForCrawling);
    setShowDiscoveryModal(false);

    // 즉시 상태 초기화
    setIsCrawling(true);
    setCrawlingProgress(selectedUrlsArray.map(url => ({ url, status: 'pending' as const, message: '문서 생성 중...' })));

    try {
      // 벤더 정보 가져오기
      const dbVendor = vendors.length > 0 ? VENDOR_TO_DB_MAP[vendors[0]] || 'META' : 'META';

      // allDiscoveredUrls에서 URL -> title 매핑 생성
      const urlToTitleMap = new Map<string, string>();
      allDiscoveredUrls.forEach(item => {
        if (item.url && item.title && item.title !== item.url) {
          urlToTitleMap.set(item.url, item.title);
        }
      });

      // 모달에서 선택한 모든 페이지를 문서 목록에 한번에 추가
      const documentsToCreate = selectedUrlsArray.map(url => ({
        url,
        title: urlToTitleMap.get(url) || url
      }));

      console.log(`📋 모달에서 선택한 ${documentsToCreate.length}개 페이지를 문서 목록에 한번에 추가 시작...`);

      const batchCreateResponse = await fetchWithTimeout('/api/admin/batch-create-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documents: documentsToCreate,
          vendor: dbVendor
        }),
      }, 30000);

      if (!batchCreateResponse.ok) {
        throw new Error(`HTTP ${batchCreateResponse.status}: ${batchCreateResponse.statusText}`);
      }

      const batchCreateResult = await batchCreateResponse.json();
      if (!batchCreateResult.success) {
        throw new Error(batchCreateResult.error || '문서 생성 실패');
      }

      console.log(`✅ ${batchCreateResult.created}개 문서 생성, ${batchCreateResult.updated}개 문서 업데이트 완료`);

      // 🔥 생성된 문서들에 대해 CRAWL_SEED 작업을 큐에 등록
      const createdDocuments = batchCreateResult.documents || [];
      const jobIds: string[] = [];

      for (const doc of createdDocuments) {
        try {
          // 진행 상황 업데이트
          setCrawlingProgress(prev =>
            prev.map(p =>
              p.url === doc.url ? { ...p, message: '큐에 등록 중...' } : p
            )
          );

          const enqueueResponse = await fetchWithTimeout('/api/jobs/enqueue', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jobType: 'CRAWL_SEED',
              documentId: doc.id,
              priority: 5,
              payload: {
                url: doc.url,
                title: doc.title,
                vendors: [dbVendor],
                domainLimit: crawlOptions.domainLimit,
                respectRobots: crawlOptions.respectRobots,
                maxDepth: 1,
                extractSubPages: false
              }
            }),
          }, 30000);

          if (!enqueueResponse.ok) {
            throw new Error(`HTTP ${enqueueResponse.status}: ${enqueueResponse.statusText}`);
          }

          const enqueueResult = await enqueueResponse.json();
          if (enqueueResult.jobId) {
            jobIds.push(enqueueResult.jobId);
            jobIdsRef.current.push(enqueueResult.jobId);
            setCrawlingProgress(prev =>
              prev.map(p =>
                p.url === doc.url ? { ...p, message: '큐에 등록됨, 처리 대기 중...' } : p
              )
            );
          } else {
            throw new Error('작업 ID를 받지 못했습니다.');
          }
        } catch (urlError) {
          console.error(`URL 큐 등록 오류: ${doc.url}`, urlError);
          setCrawlingProgress(prev =>
            prev.map(p =>
              p.url === doc.url
                ? { ...p, status: 'failed' as const, message: urlError instanceof Error ? urlError.message : '큐 등록 실패' }
                : p
            )
          );
        }
      }

      if (jobIds.length > 0) {
        // 상태 업데이트: pending -> queued
        setCrawlingProgress(prev =>
          prev.map(p => ({ ...p, message: '큐에 등록됨, 처리 대기 중...' }))
        );

        // 큐 워커 즉시 트리거
        try {
          await fetchWithTimeout('/api/jobs/consume', { method: 'POST' }, 10000);
        } catch (consumeError) {
          console.warn('큐 워커 트리거 실패 (무시 가능):', consumeError);
        }
      } else {
        toast.error('작업 등록에 실패했습니다.');
        setIsCrawling(false);
        return;
      }

      // 폴링 시작 (2초마다)
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      pollingIntervalRef.current = setInterval(() => {
        pollCrawlStatusFromJobs(selectedUrlsArray);
      }, 2000);

      // 즉시 첫 폴링 실행
      setTimeout(() => {
        pollCrawlStatusFromJobs(selectedUrlsArray);
      }, 1000);

      toast.success(`${selectedUrlsArray.length}개 페이지가 큐에 등록되었습니다.`);

    } catch (error) {
      console.error('❌ 크롤링 시작 오류:', error);
      toast.error(error instanceof Error ? error.message : '크롤링 시작 실패');

      // 오류 발생 시 상태 업데이트
      setCrawlingProgress(prev =>
        prev.map(p => ({
          ...p,
          status: 'failed' as const,
          message: error instanceof Error ? error.message : '크롤링 시작 실패'
        }))
      );
      setIsCrawling(false);

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  };


  const handleDiscoveryModalCancel = () => {
    setShowDiscoveryModal(false);
    setAllDiscoveredUrls([]);
    setSelectedUrlsForCrawling(new Set());
    setIsCrawling(false);
    setCrawlingProgress([]);
  };

  // URL을 도메인별로 그룹화
  const groupUrlsByDomain = (urls: string[]) => {
    const groups: { [key: string]: string[] } = {};
    urls.forEach(url => {
      try {
        const domain = new URL(url).hostname;
        if (!groups[domain]) {
          groups[domain] = [];
        }
        groups[domain].push(url);
      } catch (e) {
        // URL 파싱 실패 시 기본 그룹에 추가
        if (!groups['기타']) {
          groups['기타'] = [];
        }
        groups['기타'].push(url);
      }
    });
    return groups;
  };

  // 카테고리 토글
  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // URL 선택 토글
  const toggleUrlSelection = (url: string) => {
    setSelectedUrls(prev =>
      prev.includes(url)
        ? prev.filter(u => u !== url)
        : [...prev, url]
    );
  };

  // 전체 선택/해제
  const toggleAllTemplates = () => {
    if (selectedTemplates.length === Object.keys(templateUrls).length) {
      setSelectedTemplates([]);
    } else {
      setSelectedTemplates(Object.keys(templateUrls));
    }
  };

  // 도메인별 전체 선택/해제
  const toggleAllUrlsInDomain = (domain: string, urls: string[]) => {
    const domainUrls = urls;
    const allSelected = domainUrls.every(url => selectedUrls.includes(url));

    if (allSelected) {
      setSelectedUrls(prev => prev.filter(url => !domainUrls.includes(url)));
    } else {
      setSelectedUrls(prev => [...new Set([...prev, ...domainUrls])]);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent">
            URL 크롤링 관리자
          </h2>
          <p className="text-gray-400 mt-2">
            미리 정의된 템플릿과 사용자 정의 URL을 조합하여 Meta 공식 사이트를 크롤링합니다.
          </p>
        </div>
        <div className="flex items-center space-x-4">
          {onVendorsChange && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-400">크롤링 벤더:</span>
              <Select
                value={vendors.length === 1 ? vendors[0] : vendors.length > 1 ? "multiple" : "all"}
                onValueChange={(v) => {
                  if (v === "all") {
                    onVendorsChange([]);
                  } else if (v !== "multiple") {
                    onVendorsChange([v]);
                  }
                }}
              >
                <SelectTrigger className="w-[180px] bg-[#0B0F17] border-white/10 text-white">
                  <span className="flex-1 text-left">
                    {vendors.length === 0
                      ? "전체 벤더"
                      : vendors.length === 1
                        ? vendors[0]
                        : `${vendors.length}개 선택됨`}
                  </span>
                </SelectTrigger>
                <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                  <SelectItem value="all">전체 벤더</SelectItem>
                  {ALL_VENDORS.map((vendor) => (
                    <SelectItem key={vendor} value={vendor}>
                      {vendor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Badge variant="outline" className="text-orange-300 border-orange-500/30 px-3 py-1">
            <BarChart3 className="w-3 h-3 mr-1" />
            {getSelectedUrlCount()}개 URL 선택됨
          </Badge>
          <Button
            onClick={() => setShowUrlSelector(!showUrlSelector)}
            variant="outline"
            size="sm"
            className="bg-orange-600/10 border-orange-500/30 text-orange-300 hover:bg-orange-600/20"
          >
            <Filter className="w-4 h-4 mr-2" />
            URL 선택기
          </Button>
        </div>
      </div>

      {/* URL 선택기 드롭다운 */}
      {showUrlSelector && (
        <Card className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm border-gray-700/50 rounded-xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-white">
                <Layers className="w-5 h-5 text-orange-400" />
                크롤링된 URL 선택
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowUrlSelector(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <CardDescription className="text-gray-400">
              도메인별로 그룹화된 크롤링된 URL에서 선택하세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* 검색 */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="URL 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-gray-700/50 border-gray-600 text-white placeholder-gray-400"
                />
              </div>

              {/* 도메인별 URL 그룹 */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {Object.entries(groupUrlsByDomain(Object.values(templateUrls).flat())).map(([domain, urls]) => (
                  <div key={domain} className="border border-gray-600/30 rounded-lg overflow-hidden">
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="ghost"
                        className="flex-1 justify-between p-3 h-auto bg-gray-700/30 hover:bg-gray-700/50 text-left"
                        onClick={() => toggleCategory(domain)}
                      >
                        <div className="flex items-center space-x-3">
                          <Globe className="w-4 h-4 text-orange-400" />
                          <div>
                            <div className="font-medium text-white">{domain}</div>
                            <div className="text-sm text-gray-400">{urls.length}개 URL</div>
                          </div>
                        </div>
                        {expandedCategories[domain] ? (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleAllUrlsInDomain(domain, urls);
                        }}
                        className="text-green-400 hover:text-green-300 hover:bg-green-500/20"
                        title={urls.every(url => selectedUrls.includes(url)) ? "전체 해제" : "전체 선택"}
                      >
                        {urls.every(url => selectedUrls.includes(url)) ? (
                          <X className="w-4 h-4" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    {expandedCategories[domain] && (
                      <div className="border-t border-gray-600/30 bg-gray-800/30">
                        <div className="p-3 space-y-1">
                          {urls.map((url, index) => (
                            <div
                              key={index}
                              className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-colors ${selectedUrls.includes(url)
                                ? 'bg-orange-500/20 border border-orange-500/30'
                                : 'bg-gray-700/20 hover:bg-gray-700/40'
                                }`}
                              onClick={() => toggleUrlSelection(url)}
                            >
                              <Checkbox
                                checked={selectedUrls.includes(url)}
                                onChange={() => toggleUrlSelection(url)}
                              />
                              <LinkIcon className="w-3 h-3 text-gray-400" />
                              <span className="text-sm text-gray-300 truncate flex-1">{url}</span>
                              <ExternalLink className="w-3 h-3 text-gray-500" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* 선택된 URL 요약 */}
              {selectedUrls.length > 0 && (
                <div className="mt-4 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-orange-300">
                      {selectedUrls.length}개 URL 선택됨
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedUrls([])}
                      className="text-orange-300 hover:text-orange-200"
                    >
                      <X className="w-3 h-3 mr-1" />
                      모두 해제
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 크롤링 모드 선택 */}
      <Card className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm border-gray-700/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Settings className="w-5 h-5 text-blue-400" />
            크롤링 모드 선택
          </CardTitle>
          <CardDescription className="text-gray-400">
            크롤링 방식을 선택하여 URL을 관리하세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card
              className={`cursor-pointer transition-all duration-300 rounded-xl group ${crawlingMode === 'predefined'
                ? 'ring-2 ring-blue-500 bg-blue-500/20 border-blue-500/50 shadow-lg shadow-blue-500/20'
                : 'bg-gray-700/60 border-gray-600/70 hover:bg-gray-700/80 hover:border-blue-400/30 hover:shadow-lg hover:shadow-blue-500/10'
                }`}
              onClick={() => setCrawlingMode('predefined')}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center space-x-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${crawlingMode === 'predefined'
                    ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/30'
                    : 'bg-gradient-to-br from-gray-600 to-gray-700 group-hover:from-blue-500 group-hover:to-blue-600'
                    }`}>
                    <Layers className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-white font-semibold group-hover:text-blue-300 transition-colors duration-200">
                      미리 정의된 URL
                    </CardTitle>
                    <CardDescription className="text-white font-medium group-hover:text-blue-100 transition-colors duration-200">
                      검증된 URL 템플릿만 사용
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Badge className="bg-blue-500/20 text-blue-300 border-blue-400/50 text-xs px-2 py-1">
                    안전한 크롤링
                  </Badge>
                  {crawlingMode === 'predefined' && (
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  )}
                </div>
              </CardHeader>
            </Card>

            <Card
              className={`cursor-pointer transition-all duration-300 rounded-xl group ${crawlingMode === 'custom'
                ? 'ring-2 ring-green-500 bg-green-500/20 border-green-500/50 shadow-lg shadow-green-500/20'
                : 'bg-gray-700/60 border-gray-600/70 hover:bg-gray-700/80 hover:border-green-400/30 hover:shadow-lg hover:shadow-green-500/10'
                }`}
              onClick={() => setCrawlingMode('custom')}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center space-x-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${crawlingMode === 'custom'
                    ? 'bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/30'
                    : 'bg-gradient-to-br from-gray-600 to-gray-700 group-hover:from-green-500 group-hover:to-green-600'
                    }`}>
                    <Plus className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-white font-semibold group-hover:text-green-300 transition-colors duration-200">
                      사용자 정의 URL
                    </CardTitle>
                    <CardDescription className="text-white font-medium group-hover:text-green-100 transition-colors duration-200">
                      직접 URL 입력
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Badge className="bg-green-500/20 text-green-300 border-green-400/50 text-xs px-2 py-1">
                    유연한 크롤링
                  </Badge>
                  {crawlingMode === 'custom' && (
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  )}
                </div>
              </CardHeader>
            </Card>

            <Card
              className={`cursor-pointer transition-all duration-300 rounded-xl group ${crawlingMode === 'hybrid'
                ? 'ring-2 ring-purple-500 bg-purple-500/20 border-purple-500/50 shadow-lg shadow-purple-500/20'
                : 'bg-gray-700/60 border-gray-600/70 hover:bg-gray-700/80 hover:border-purple-400/30 hover:shadow-lg hover:shadow-purple-500/10'
                }`}
              onClick={() => setCrawlingMode('hybrid')}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center space-x-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 ${crawlingMode === 'hybrid'
                    ? 'bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg shadow-purple-500/30'
                    : 'bg-gradient-to-br from-gray-600 to-gray-700 group-hover:from-purple-500 group-hover:to-purple-600'
                    }`}>
                    <Globe className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-white font-semibold group-hover:text-purple-300 transition-colors duration-200">
                      하이브리드
                    </CardTitle>
                    <CardDescription className="text-white font-medium group-hover:text-purple-100 transition-colors duration-200">
                      템플릿 + 사용자 정의
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Badge className="bg-purple-500/20 text-purple-300 border-purple-400/50 text-xs px-2 py-1">
                    통합 크롤링
                  </Badge>
                  {crawlingMode === 'hybrid' && (
                    <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                  )}
                </div>
              </CardHeader>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* 미리 정의된 URL 템플릿 선택 */}
      {crawlingMode !== 'custom' && (
        <Card className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm border-gray-700/50 rounded-xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Layers className="w-5 h-5 text-blue-400" />
                  URL 템플릿 관리
                </CardTitle>
                <CardDescription className="text-gray-400">
                  검증된 {vendors.length > 0 ? vendors[0] : 'Meta'} 공식 사이트 템플릿을 선택하고 관리하세요.
                </CardDescription>
              </div>
              <div className="flex items-center space-x-2">
                <Badge variant="outline" className="text-blue-300 border-blue-500/30">
                  {Object.keys(templateUrls).length}개 템플릿
                </Badge>
                <Button
                  onClick={toggleAllTemplates}
                  variant="outline"
                  size="sm"
                  className="bg-green-600/10 hover:bg-green-600/20 text-green-300 border-green-500/30"
                >
                  {selectedTemplates.length === Object.keys(templateUrls).length ? (
                    <>
                      <X className="w-4 h-4 mr-2" />
                      전체 해제
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      전체 선택
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => setNewTemplateName('')}
                  variant="outline"
                  size="sm"
                  className="bg-blue-600/10 hover:bg-blue-600/20 text-blue-300 border-blue-500/30"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  새 템플릿 추가
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(templateUrls).map(([name, urls]) => (
                <Card key={name} className={`relative group transition-all duration-300 rounded-xl ${editingTemplate === name
                  ? 'border-yellow-500/50 bg-yellow-500/10'
                  : selectedTemplates.includes(name)
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-gray-600/50 bg-gray-700/30 hover:bg-gray-700/50'
                  }`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3 flex-1">
                        <Checkbox
                          checked={selectedTemplates.includes(name)}
                          onCheckedChange={() => toggleTemplate(name)}
                          className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                        />
                        <div className="flex-1">
                          <CardTitle className="text-base text-white flex items-center space-x-2">
                            {name}
                            {editingTemplate === name && (
                              <Badge variant="outline" className="text-xs bg-yellow-500/20 text-yellow-300 border-yellow-500/30">
                                편집 중
                              </Badge>
                            )}
                          </CardTitle>
                          <div className="flex items-center space-x-2 mt-1">
                            <Badge variant="secondary" className="text-xs bg-blue-500/20 text-blue-300 border-blue-500/30">
                              {urls.length}개 URL
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditingTemplate(name)}
                          className="h-8 w-8 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/20"
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteTemplate(name)}
                          className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/20"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {editingTemplate === name ? (
                      <div className="space-y-2">
                        {urls.map((url, index) => (
                          <div key={index} className="flex items-center space-x-2">
                            <Input
                              value={url}
                              onChange={(e) => updateTemplateUrl(name, index, e.target.value)}
                              className="text-sm"
                              placeholder="URL 입력"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeTemplateUrl(name, index)}
                              className="h-8 w-8 p-0 text-red-400"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addTemplateUrl(name)}
                            className="text-xs"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            URL 추가
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => saveTemplate(name)}
                            className="text-xs"
                          >
                            <Save className="w-3 h-3 mr-1" />
                            저장
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={cancelEditingTemplate}
                            className="text-xs"
                          >
                            <X className="w-3 h-3 mr-1" />
                            취소
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {urls.map((url, index) => (
                          <div key={index} className="flex items-center space-x-2 text-sm text-gray-600">
                            <Globe className="w-3 h-3" />
                            <span className="truncate">{url}</span>
                            <ExternalLink className="w-3 h-3" />
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* 새 템플릿 추가 폼 */}
            {!editingTemplate && (
              <Card className="mt-4 border-dashed border-2 border-gray-600 rounded-xl">
                <CardContent className="p-4">
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium">템플릿 이름</Label>
                      <Input
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        placeholder="예: Facebook Help (한국어)"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">URL 목록</Label>
                      <div className="space-y-2 mt-1">
                        {newTemplateUrls.map((url, index) => (
                          <div key={index} className="flex items-center space-x-2">
                            <Input
                              value={url}
                              onChange={(e) => {
                                const newUrls = [...newTemplateUrls];
                                newUrls[index] = e.target.value;
                                setNewTemplateUrls(newUrls);
                              }}
                              placeholder="https://example.com"
                              className="text-sm"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const newUrls = newTemplateUrls.filter((_, i) => i !== index);
                                setNewTemplateUrls(newUrls);
                              }}
                              className="h-8 w-8 p-0 text-red-400"
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setNewTemplateUrls([...newTemplateUrls, ''])}
                          className="text-xs"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          URL 추가
                        </Button>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <Button
                        onClick={addNewTemplate}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        <Save className="w-3 h-3 mr-1" />
                        템플릿 추가
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setNewTemplateName('');
                          setNewTemplateUrls(['']);
                        }}
                      >
                        취소
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      {/* 사용자 정의 URL 입력 */}
      {crawlingMode !== 'predefined' && (
        <Card className="rounded-xl">
          <CardHeader>
            <CardTitle>사용자 정의 URL</CardTitle>
            <CardDescription>크롤링하고 싶은 URL을 직접 입력하세요.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex space-x-2">
              <Input
                placeholder="새 URL 입력 (예: https://ko-kr.facebook.com/business)"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    addCustomUrl();
                  }
                }}
              />
              <Button onClick={addCustomUrl} disabled={!newUrl.trim()}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {customUrls.length > 0 && (
              <div className="space-y-3">
                <Separator />
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-gray-300">등록된 URL 목록</h4>
                  <Badge variant="outline" className="text-xs bg-blue-500/20 text-blue-300 border-blue-500/30">
                    {customUrls.length}개 URL
                  </Badge>
                </div>
                <div className="space-y-2">
                  {customUrls.map((url, index) => (
                    <div key={index} className="group flex items-center space-x-3 p-3 bg-gray-700/30 border border-gray-600/50 rounded-lg hover:bg-gray-700/50 transition-colors">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                          <Globe className="w-4 h-4 text-blue-400" />
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-sm font-medium text-white truncate">
                            {url}
                          </span>
                          <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-300 border-green-500/30">
                            대기 중
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-400">
                          크롤링 대기 상태
                        </p>
                      </div>

                      <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteUrl(url)}
                          disabled={deletingUrl === url}
                          className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/20"
                        >
                          {deletingUrl === url ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 타임아웃 경고 Alert */}
      {timeoutWarning?.show && (
        <Alert className="bg-gradient-to-r from-yellow-500/20 via-orange-500/20 to-red-500/20 border-2 border-dashed border-yellow-500/50 text-yellow-100 mb-6 shadow-lg shadow-yellow-500/20">
          <AlertTriangle className="h-6 w-6 text-yellow-400 animate-pulse" />
          <AlertTitle className="text-yellow-200 font-bold text-lg mb-3 flex items-center gap-2">
            <span>⚠️</span>
            <span>타임아웃 위험 경고</span>
          </AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="text-base text-yellow-100/95 font-medium leading-relaxed">
              {timeoutWarning.message}
            </p>
            <div className="mt-4 p-4 bg-black/20 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-yellow-200">발견된 URL:</span>
                <Badge variant="outline" className="bg-yellow-500/30 border-yellow-500/70 text-yellow-100 text-base px-3 py-1 font-bold">
                  {timeoutWarning.discoveredCount}개
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-green-200">안정적 크롤링 가능:</span>
                <Badge variant="outline" className="bg-green-500/30 border-green-500/70 text-green-100 text-base px-3 py-1 font-bold">
                  {timeoutWarning.safeCrawlableCount}개
                </Badge>
              </div>
            </div>
            <p className="text-sm text-yellow-200/80 mt-4 leading-relaxed">
              현재 설정으로는 일부만 처리되고 타임아웃될 수 있습니다. 안정적으로 크롤링하려면 URL 개수를 줄이거나 여러 번에 나누어 크롤링하는 것을 권장합니다.
            </p>
            <div className="flex justify-end mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTimeoutWarning(null)}
                className="border-yellow-500/70 text-yellow-200 hover:bg-yellow-500/30 hover:text-yellow-100 font-medium"
              >
                닫기
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Advanced Crawl Options */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 space-y-6">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-gray-400" />
          고급 크롤링 옵션
        </h3>

        {/* 기본 옵션 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Pagination 모드 */}
          <div className={`flex flex-col gap-3 p-4 rounded-lg border-2 transition-all min-h-[140px] ${
            crawlOptions.paginationMode 
              ? 'bg-gradient-to-br from-purple-500/20 to-purple-600/10 border-purple-500/50 shadow-lg shadow-purple-500/20' 
              : 'bg-white/5 border-white/10'
          }`}>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-purple-300 flex items-center gap-2">
                📄 Pagination 모드
              </Label>
              <Checkbox
                id="paginationMode"
                checked={crawlOptions.paginationMode}
                onCheckedChange={(checked) => {
                  const newPaginationMode = !!checked;
                  setCrawlOptions(prev => ({
                    ...prev,
                    paginationMode: newPaginationMode,
                    ...(newPaginationMode && { maxDepth: '1' }),
                  }));
                  if (newPaginationMode) {
                    setExtractSubPages(false);
                  }
                }}
                className="border-purple-500 data-[state=checked]:bg-purple-500"
              />
            </div>
            <p className="text-xs text-gray-400 leading-relaxed flex-1">
              부모 페이지만 입력하면 자동으로 모든 페이지 크롤링
            </p>
            {crawlOptions.paginationMode && (
              <div className="mt-auto pt-2 border-t border-purple-500/30">
                <p className="text-xs text-purple-300/90 leading-tight flex items-center gap-1">
                  <span>⚠️</span>
                  <span>하위 페이지 발견 및 최대 깊이가 자동으로 비활성화됩니다</span>
                </p>
              </div>
            )}
          </div>

          {/* 하위 페이지 발견 */}
          <div className={`flex flex-col gap-3 p-4 rounded-lg border-2 transition-all min-h-[140px] ${
            !crawlOptions.paginationMode && extractSubPages
              ? 'bg-gradient-to-br from-blue-500/20 to-blue-600/10 border-blue-500/50 shadow-lg shadow-blue-500/20' 
              : 'bg-white/5 border-white/10'
          } ${crawlOptions.paginationMode ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-gray-300">하위 페이지 발견</Label>
              <Checkbox
                id="extractSubPages"
                checked={extractSubPages && !crawlOptions.paginationMode}
                disabled={crawlOptions.paginationMode}
                onCheckedChange={(checked) => {
                  if (!crawlOptions.paginationMode) {
                    setExtractSubPages(!!checked);
                    if (checked) {
                      setCrawlOptions(prev => ({ ...prev, paginationMode: false }));
                    }
                  }
                }}
                className="border-gray-500 data-[state=checked]:bg-blue-500"
              />
            </div>
            <p className="text-xs text-gray-400 leading-relaxed flex-1">
              sitemap.xml 및 링크 분석으로 하위 페이지 자동 추출
            </p>
            {crawlOptions.paginationMode && (
              <div className="mt-auto pt-2 border-t border-gray-700">
                <p className="text-xs text-gray-500 leading-tight">
                  Pagination 모드 사용 시 비활성화
                </p>
              </div>
            )}
          </div>

          {/* 최대 깊이 */}
          <div className={`flex flex-col gap-3 p-4 rounded-lg border-2 transition-all min-h-[140px] ${
            crawlOptions.paginationMode 
              ? 'opacity-50 bg-white/5 border-white/10 cursor-not-allowed' 
              : 'bg-white/5 border-white/10'
          }`}>
            <Label htmlFor="maxDepth" className="text-sm font-semibold text-gray-300">
              최대 깊이
            </Label>
            <Select
              value={crawlOptions.paginationMode ? '1' : crawlOptions.maxDepth}
              onValueChange={(value) => {
                if (!crawlOptions.paginationMode) {
                  setCrawlOptions(prev => ({ ...prev, maxDepth: value }));
                }
              }}
              disabled={crawlOptions.paginationMode}
            >
              <SelectTrigger className="h-10 bg-gray-700/50 border-gray-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="4">4</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400 leading-relaxed mt-auto">
              {crawlOptions.paginationMode 
                ? 'Pagination 모드에서는 깊이 1로 고정'
                : '재귀적으로 크롤링할 최대 깊이'}
            </p>
          </div>

          {/* 최대 페이지 수 */}
          <div className="flex flex-col gap-3 p-4 rounded-lg border-2 border-white/10 bg-white/5 min-h-[140px]">
            <Label htmlFor="maxUrls" className="text-sm font-semibold text-gray-300">
              최대 페이지 수
            </Label>
            <Input
              id="maxUrls"
              type="number"
              min={1}
              max={1000}
              value={crawlOptions.maxUrls}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 500;
                setCrawlOptions(prev => ({ ...prev, maxUrls: Math.min(1000, Math.max(1, value)) }));
              }}
              className="h-10 bg-gray-700/50 border-gray-600 text-white"
            />
            <p className="text-xs text-gray-400 leading-relaxed mt-auto">
              크롤링할 최대 페이지 수 제한
            </p>
          </div>
        </div>

        {/* 고급 옵션 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-gray-700">
          {/* 타임아웃 */}
          <div className="flex flex-col gap-3 p-4 rounded-lg border-2 border-white/10 bg-white/5 min-h-[120px]">
            <Label htmlFor="timeout" className="text-sm font-semibold text-gray-300">
              타임아웃 (ms)
            </Label>
            <Input
              id="timeout"
              type="number"
              min={1000}
              step={1000}
              value={crawlOptions.timeout}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 30000;
                setCrawlOptions(prev => ({ ...prev, timeout: Math.max(1000, value) }));
              }}
              className="h-10 bg-gray-700/50 border-gray-600 text-white"
            />
            <p className="text-xs text-gray-400 leading-relaxed mt-auto">
              페이지 로드 타임아웃 시간
            </p>
          </div>

          {/* 도메인 제한 */}
          <div className={`flex flex-col gap-3 p-4 rounded-lg border-2 transition-all min-h-[120px] ${
            crawlOptions.domainLimit
              ? 'bg-gradient-to-br from-blue-500/20 to-blue-600/10 border-blue-500/50 shadow-lg shadow-blue-500/20'
              : 'bg-white/5 border-white/10'
          }`}>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-gray-300">도메인 제한</Label>
              <Checkbox
                id="domainLimit"
                checked={crawlOptions.domainLimit}
                onCheckedChange={(checked) => setCrawlOptions(prev => ({ ...prev, domainLimit: !!checked }))}
                className="border-gray-500 data-[state=checked]:bg-blue-500"
              />
            </div>
            <p className="text-xs text-gray-400 leading-relaxed flex-1">
              외부 도메인 링크 제외
            </p>
          </div>

          {/* Robots.txt 준수 */}
          <div className={`flex flex-col gap-3 p-4 rounded-lg border-2 transition-all min-h-[120px] ${
            crawlOptions.respectRobots
              ? 'bg-gradient-to-br from-blue-500/20 to-blue-600/10 border-blue-500/50 shadow-lg shadow-blue-500/20'
              : 'bg-white/5 border-white/10'
          }`}>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-gray-300">Robots.txt 준수</Label>
              <Checkbox
                id="respectRobots"
                checked={crawlOptions.respectRobots}
                onCheckedChange={(checked) => setCrawlOptions(prev => ({ ...prev, respectRobots: !!checked }))}
                className="border-gray-500 data-[state=checked]:bg-blue-500"
              />
            </div>
            <p className="text-xs text-gray-400 leading-relaxed flex-1">
              robots.txt 규칙 준수
            </p>
          </div>

          {/* 크롤러 V2 */}
          <div className={`flex flex-col gap-3 p-4 rounded-lg border-2 transition-all min-h-[120px] ${
            crawlOptions.useCrawlerV2
              ? 'bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border-emerald-500/50 shadow-lg shadow-emerald-500/20'
              : 'bg-emerald-500/10 border-emerald-500/20'
          }`}>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                🚀 크롤러 V2
              </Label>
              <Checkbox
                id="useCrawlerV2"
                checked={crawlOptions.useCrawlerV2}
                onCheckedChange={(checked) => setCrawlOptions(prev => ({ ...prev, useCrawlerV2: !!checked }))}
                className="border-emerald-500 data-[state=checked]:bg-emerald-500"
              />
            </div>
            <p className="text-xs text-emerald-400/70 leading-relaxed flex-1">
              개선된 성능 및 안정성
            </p>
          </div>
        </div>

        {/* 추가 고급 옵션 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-gray-700">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="forceCrawl"
              checked={crawlOptions.forceCrawl}
              onCheckedChange={(checked) => setCrawlOptions(prev => ({ ...prev, forceCrawl: !!checked }))}
            />
            <Label htmlFor="forceCrawl" className="text-gray-300 cursor-pointer text-sm">
              강제 크롤 (robots.txt 무시)
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="deepCrawlTimeout"
              checked={crawlOptions.deepCrawlTimeout}
              onCheckedChange={(checked) => setCrawlOptions(prev => ({ ...prev, deepCrawlTimeout: !!checked }))}
            />
            <Label htmlFor="deepCrawlTimeout" className="text-gray-300 cursor-pointer text-sm">
              깊은 크롤 모드 (30분 타임아웃)
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="retryOn429"
              checked={crawlOptions.retryOn429}
              onCheckedChange={(checked) => setCrawlOptions(prev => ({ ...prev, retryOn429: !!checked }))}
            />
            <Label htmlFor="retryOn429" className="text-gray-300 cursor-pointer text-sm">
              429 에러 자동 재시도
            </Label>
          </div>
        </div>
      </div>

      {/* 크롤링 실행 버튼 */}
      <div className="flex justify-center space-x-4">
        <Button
          onClick={handleStartCrawling}
          disabled={isCrawling || (getSelectedUrlCount() === 0 && !newUrl.trim())}
          size="lg"
          className={`w-full max-w-md h-14 text-lg font-semibold transition-all duration-300 ${isCrawling || (getSelectedUrlCount() === 0 && !newUrl.trim())
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
            : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
            }`}
        >
          {isCrawling ? (
            <>
              <Loader2 className="w-5 h-5 mr-3 animate-spin" />
              크롤링 진행 중...
            </>
          ) : (
            <>
              <Play className="w-5 h-5 mr-3" />
              크롤링 시작 ({getSelectedUrlCount()}개 URL)
            </>
          )}
        </Button>



        {/* 크롤링 상태 동기화 버튼 */}
        {(isCrawling || crawlingProgress.some(p => p.status === 'crawling' || p.status === 'pending')) && (
          <>
            <Button
              onClick={async () => {
                // API를 통해 강제 동기화 실행
                try {
                  toast.info('강제 동기화 중...');
                  console.log('🔧 강제 동기화 버튼 클릭됨');

                  const response = await fetch('/api/admin/force-sync-jobs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                  });

                  if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                  }

                  const result = await response.json();
                  console.log('🔧 강제 동기화 결과:', result);

                  if (result.success) {
                    if (result.synced > 0) {
                      toast.success(`동기화 완료: ${result.synced}개 작업 업데이트됨 (전체: ${result.total}개)`);
                      console.log('✅ 동기화된 작업:', result.results);

                      // 결과를 콘솔에 상세 출력 (새로고침 전에 확인 가능하도록)
                      if (result.results && result.results.length > 0) {
                        console.group('📋 강제 동기화 상세 결과');
                        result.results.forEach((r: any) => {
                          const icon = r.status === 'synced' ? '✅' : r.status === 'timeout' ? '⏰' : r.status === 'error' ? '❌' : '⚠️';
                          console.log(`${icon} 작업 ${r.jobId?.substring(0, 8)}...: ${r.status} - ${r.message}`);
                          if (r.title) console.log(`   문서: ${r.title}`);
                          if (r.chunkCount !== undefined) console.log(`   청크: ${r.chunkCount}개`);
                        });
                        console.groupEnd();
                      }

                      // 콘솔 로그 확인을 위해 3초 후 새로고침
                      setTimeout(() => {
                        console.log('🔄 페이지 새로고침 시작...');
                        window.location.reload();
                      }, 3000);
                    } else {
                      toast.warning(`동기화할 작업이 없습니다. (전체: ${result.total}개)`);
                      console.log('⚠️ 동기화 결과:', result.results);

                      // 결과를 콘솔에 출력
                      if (result.results && result.results.length > 0) {
                        console.group('📋 강제 동기화 상세 결과');
                        result.results.forEach((r: any) => {
                          const icon = r.status === 'not_completed' ? '⏳' : r.status === 'not_found' ? '❓' : '⚠️';
                          console.log(`${icon} 작업 ${r.jobId?.substring(0, 8)}...: ${r.status} - ${r.message}`);
                          if (r.title) console.log(`   문서: ${r.title}`);
                          if (r.chunkCount !== undefined) console.log(`   청크: ${r.chunkCount}개`);
                        });
                        console.groupEnd();
                      }
                    }
                  } else {
                    toast.error(`동기화 실패: ${result.error || '알 수 없는 오류'}`);
                    console.error('❌ 동기화 실패:', result);
                  }
                } catch (error) {
                  console.error('❌ 강제 동기화 오류:', error);
                  toast.error(`동기화 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
                }

                // 기존 로직도 실행 (로컬 상태 동기화)
                try {
                  const currentUrls = crawlingProgress.map(p => p.url);
                  if (currentUrls.length === 0) {
                    // 진행 중인 모든 작업 조회
                    const { data: allJobs } = await supabase
                      .from('processing_jobs')
                      .select('id, status, result, payload, started_at, finished_at')
                      .eq('job_type', 'CRAWL_SEED')
                      .in('status', ['queued', 'processing', 'retrying', 'completed', 'failed'])
                      .order('created_at', { ascending: false })
                      .limit(50);

                    if (allJobs && allJobs.length > 0) {
                      const incompleteJobs = allJobs.filter(j =>
                        ['queued', 'processing', 'retrying'].includes(j.status) && !j.finished_at
                      );

                      if (incompleteJobs.length > 0) {
                        const progressItems: CrawlingProgress[] = incompleteJobs.map(job => {
                          const jobUrl = (job.payload as any)?.url;
                          const jobResult = job.result as any;
                          return {
                            url: jobUrl || '알 수 없는 URL',
                            status: job.status === 'processing' ? 'crawling' as const : 'pending' as const,
                            message: job.status === 'processing' ? '크롤링 중...' : '큐 대기 중...',
                            chunkCount: jobResult?.chunkCount || 0
                          };
                        });
                        setCrawlingProgress(progressItems);
                        setIsCrawling(true);
                        jobIdsRef.current = incompleteJobs.map(j => j.id);
                      } else {
                        // 모든 작업이 완료됨
                        setCrawlingProgress([]);
                        setIsCrawling(false);
                        if (onCrawlingComplete) {
                          onCrawlingComplete();
                        }
                      }
                    }
                  } else {
                    // 현재 URL의 실제 상태 확인 및 강제 동기화
                    const { data: jobs } = await supabase
                      .from('processing_jobs')
                      .select('id, status, result, payload, started_at, finished_at, document_id')
                      .eq('job_type', 'CRAWL_SEED')
                      .in('status', ['queued', 'processing', 'retrying', 'completed', 'failed']);

                    if (jobs && jobs.length > 0) {
                      const matchingJobs = jobs.filter(job => {
                        const jobUrl = (job.payload as any)?.url;
                        return jobUrl && currentUrls.includes(jobUrl);
                      });

                      // processing 상태인 작업 중 실제로 완료된 것 강제 동기화
                      for (const job of matchingJobs) {
                        if (job.status === 'processing' && job.document_id && !job.finished_at) {
                          const { data: document } = await supabase
                            .from('documents')
                            .select('id, status, chunk_count')
                            .eq('id', job.document_id)
                            .single();

                          // 문서가 indexed 상태이고 chunk_count > 0이면 작업 완료로 간주
                          if (document && (document.status === 'indexed' || document.chunk_count > 0)) {
                            console.log(`🔧 강제 동기화 버튼: 작업 ${job.id}는 실제로 완료되었습니다`);

                            // processing_jobs를 completed로 업데이트
                            await supabase
                              .from('processing_jobs')
                              .update({
                                status: 'completed',
                                finished_at: new Date().toISOString(),
                                result: {
                                  note: 'force_synced_by_button',
                                  chunkCount: document.chunk_count || 0,
                                  documentStatus: document.status
                                }
                              })
                              .eq('id', job.id)
                              .eq('status', 'processing');

                            // job 상태 업데이트
                            job.status = 'completed';
                            job.finished_at = new Date().toISOString();
                          }
                        }
                      }

                      setCrawlingProgress(prev => {
                        const urlToJobMap = new Map<string, any>();
                        matchingJobs.forEach(job => {
                          const jobUrl = (job.payload as any)?.url;
                          if (jobUrl) {
                            urlToJobMap.set(jobUrl, job);
                          }
                        });

                        const updated = prev.map(p => {
                          const job = urlToJobMap.get(p.url);
                          if (job) {
                            if (job.finished_at || job.status === 'completed') {
                              return { ...p, status: 'completed' as const, message: '크롤링 완료', chunkCount: (job.result as any)?.chunkCount || 0 };
                            } else if (job.status === 'failed') {
                              return { ...p, status: 'failed' as const, message: '크롤링 실패' };
                            } else if (job.status === 'processing') {
                              return { ...p, status: 'crawling' as const, message: '크롤링 중...', chunkCount: (job.result as any)?.chunkCount || 0 };
                            } else if (job.status === 'queued' || job.status === 'retrying') {
                              return { ...p, status: 'pending' as const, message: '큐 대기 중...' };
                            }
                          }
                          return p;
                        });

                        const allCompleted = updated.every(p => p.status === 'completed' || p.status === 'failed');
                        if (allCompleted) {
                          setIsCrawling(false);
                          setTimeout(() => {
                            if (onCrawlingComplete) {
                              onCrawlingComplete();
                            }
                          }, 1000);
                        }

                        return updated;
                      });

                      // 완료된 작업이 있으면 콜백 호출
                      const completedJobs = matchingJobs.filter(j =>
                        j.status === 'completed' || j.finished_at !== null
                      );
                      if (completedJobs.length > 0 && onCrawlingComplete) {
                        onCrawlingComplete();
                      }
                    }
                  }
                  toast.success('상태 동기화 완료');
                } catch (error) {
                  console.error('상태 동기화 오류:', error);
                  toast.error('상태 동기화 실패');
                }
              }}
              variant="outline"
              size="lg"
              className="h-14 px-6 text-white border-gray-500 hover:bg-gray-700 hover:border-gray-400"
            >
              <RefreshCw className="w-5 h-5 mr-3" />
              상태 동기화
            </Button>

            <Button
              onClick={async () => {
                try {
                  toast.info('백엔드 상태 체크 중...');
                  console.log('🔍 백엔드 상태 체크 시작...');

                  const response = await fetch('/api/admin/check-processing-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                  });

                  if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                  }

                  const result = await response.json();
                  console.log('🔍 백엔드 상태 체크 결과:', result);

                  if (result.success) {
                    const { checked, synced, results: checkResults } = result.data;

                    // 동기화된 문서가 있으면 문서 목록 새로고침
                    if (synced > 0) {
                      if (onCrawlingComplete) {
                        setTimeout(() => {
                          onCrawlingComplete();
                        }, 500);
                      }
                      queryClient.invalidateQueries({ queryKey: ['admin-documents'], exact: false });
                      queryClient.invalidateQueries({ queryKey: ['documents'], exact: false });
                    }

                    // 결과 요약
                    const syncedDocs = checkResults.filter((r: any) => r.status === 'synced');
                    const errorDocs = checkResults.filter((r: any) => r.status === 'error');
                    const processingDocs = checkResults.filter((r: any) => r.status === 'processing');

                    let message = `체크 완료: ${checked}개 문서 확인`;
                    if (synced > 0) {
                      message += `, ${synced}개 동기화됨`;
                    }
                    if (errorDocs.length > 0) {
                      message += `, ${errorDocs.length}개 오류`;
                    }
                    if (processingDocs.length > 0) {
                      message += `, ${processingDocs.length}개 처리 중`;
                    }

                    toast.success(message);

                    // 상세 결과를 콘솔에 출력
                    if (syncedDocs.length > 0) {
                      console.log('✅ 동기화된 문서:', syncedDocs.map((r: any) => ({
                        title: r.title,
                        oldStatus: r.currentStatus,
                        newStatus: r.newStatus,
                        message: r.message
                      })));
                    }
                    if (errorDocs.length > 0) {
                      console.error('❌ 오류 문서:', errorDocs.map((r: any) => ({
                        title: r.title,
                        message: r.message
                      })));
                    }
                  } else {
                    toast.error(result.error || '상태 체크 실패');
                  }
                } catch (error) {
                  console.error('❌ 백엔드 상태 체크 오류:', error);
                  toast.error('백엔드 상태 체크 중 오류가 발생했습니다.');
                }
              }}
              variant="outline"
              size="lg"
              className="h-14 px-6 text-white border-blue-500 hover:bg-blue-700/20 hover:border-blue-400"
            >
              <RefreshCw className="w-5 h-5 mr-3" />
              백엔드 상태 체크
            </Button>

            <Button
              onClick={async () => {
                try {
                  const urls = crawlingProgress.map(p => p.url);
                  if (urls.length === 0) {
                    toast.warning('삭제할 진행 중인 문서가 없습니다.');
                    return;
                  }

                  if (!confirm(`진행 중인 문서 ${urls.length}개를 삭제하시겠습니까?\n\n${urls.slice(0, 3).join('\n')}${urls.length > 3 ? `\n... 외 ${urls.length - 3}개` : ''}`)) {
                    return;
                  }

                  toast.info('진행 중인 문서 삭제 중...');
                  console.log('🗑️ 진행 중인 문서 삭제 요청:', urls);

                  const response = await fetch('/api/admin/delete-processing-documents', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ urls, status: 'processing' })
                  });

                  if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                  }

                  const result = await response.json();
                  console.log('🗑️ 삭제 결과:', result);

                  if (result.success) {
                    toast.success(`삭제 완료: ${result.deleted.documents}개 문서, ${result.deleted.jobs}개 작업 삭제됨`);

                    // 진행 상황 초기화
                    setCrawlingProgress([]);
                    setIsCrawling(false);
                    jobIdsRef.current = [];

                    // 폴링 중지
                    if (pollingIntervalRef.current) {
                      clearInterval(pollingIntervalRef.current);
                      pollingIntervalRef.current = null;
                    }

                    // 문서 목록 새로고침
                    if (onCrawlingComplete) {
                      setTimeout(() => {
                        onCrawlingComplete();
                      }, 1000);
                    }

                    // 페이지 새로고침
                    setTimeout(() => {
                      window.location.reload();
                    }, 2000);
                  } else {
                    toast.error(`삭제 실패: ${result.error || '알 수 없는 오류'}`);
                    console.error('❌ 삭제 실패:', result);
                  }
                } catch (error) {
                  console.error('❌ 진행 중인 문서 삭제 오류:', error);
                  toast.error('삭제 중 오류가 발생했습니다.');
                }
              }}
              variant="outline"
              size="lg"
              className="h-14 px-6 text-white border-red-500 hover:bg-red-700/20 hover:border-red-400"
            >
              <Trash2 className="w-5 h-5 mr-3" />
              진행 중인 문서 삭제
            </Button>
          </>
        )}
      </div>

      {/* 크롤링 진행 상황 표시 (버튼 영역 하단으로 이동) */}
      {crawlingProgress.length > 0 && (
        <div className="space-y-4 p-4 bg-gray-800/80 rounded-xl border border-gray-700 shadow-lg mt-4 w-full">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            크롤링 진행 상황
          </h3>
          {crawlingProgress.map((progress, index) => (
            <div key={index} className="space-y-2 bg-gray-700/30 p-3 rounded-lg border border-gray-600/30">
              <div className="flex justify-between items-center text-xs text-gray-400 mb-2">
                <span className="truncate max-w-[70%] font-medium text-white flex items-center gap-2">
                  <Globe className="w-3 h-3 text-blue-400" />
                  {progress.url}
                </span>
                <Badge variant="outline" className={`
                    text-xs px-2 py-0.5 border-none
                    ${progress.status === 'completed' ? 'bg-green-500/20 text-green-300' :
                    progress.status === 'failed' ? 'bg-red-500/20 text-red-300' :
                      progress.status === 'stabilizing' ? 'bg-blue-400/20 text-blue-200' :
                        'bg-blue-500/20 text-blue-300'}
                `}>
                  {progress.status === 'pending' && '대기 중...'}
                  {progress.status === 'crawling' && (
                    progress.subPageProgress
                      ? `하위 페이지:${progress.subPageProgress.processed}/${progress.subPageProgress.total}`
                      : '메인 분석 중...'
                  )}
                  {progress.status === 'stabilizing' && '안정화 중'}
                  {progress.status === 'completed' && '완료됨'}
                  {progress.status === 'failed' && '실패'}
                </Badge>
              </div>

              <Progress
                value={
                  progress.status === 'completed' ? 100 :
                    progress.status === 'failed' ? 100 :
                      progress.status === 'pending' ? 0 :
                        progress.status === 'stabilizing' ? 99 :
                          progress.subPageProgress
                            ? 50 + Math.round((progress.subPageProgress.processed / (progress.subPageProgress.total || 1)) * 40)
                            : 30
                }
                className={`h-2 ${progress.status === 'failed' ? 'bg-red-900/20' :
                  progress.status === 'stabilizing' ? 'bg-blue-900/20 animate-pulse' :
                    'bg-gray-700'
                  }`}
                indicatorClassName={
                  progress.status === 'completed' ? 'bg-green-500' :
                    progress.status === 'failed' ? 'bg-red-500' :
                      progress.status === 'stabilizing' ? 'bg-blue-400' :
                        progress.subPageProgress ? 'bg-blue-500 transition-all duration-300' :
                          'bg-blue-500 animate-pulse'
                }
              />

              {/* 상세 상태 메시지 */}
              <div className="flex justify-between items-center mt-1">
                <p className={`text-xs truncate max-w-[85%] ${progress.status === 'failed' ? 'text-red-400' :
                  progress.status === 'completed' ? 'text-green-400' :
                    'text-gray-400'
                  }`}>
                  {progress.message || (progress.status === 'failed' ? '크롤링 실패' : '처리 중...')}
                </p>
                {progress.status === 'stabilizing' && progress.stabilityCheck && (
                  <span className="text-[10px] text-blue-300/70">
                    Doc: {progress.stabilityCheck.lastDocCount}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 크롤링 진행 상황 섹션 제거 완료 - 이제 문서 목록에서 크롤링 상태를 직접 확인 */}

      {/* 심도 3 이상 하위 페이지 선택 모달 */}
      <Dialog open={showDiscoveryModal} onOpenChange={setShowDiscoveryModal}>
        <DialogContent className="max-w-6xl h-[90vh] max-h-[90vh] overflow-hidden p-0 flex flex-col bg-[#0B0F17] border-white/10">
          <UrlDiscoveryPanel
            discoveredUrls={allDiscoveredUrls}
            selectedUrls={selectedUrlsForCrawling}
            onSelectionChange={handleDiscoveryModalSelectionChange}
            onSelectAll={handleDiscoveryModalSelectAll}
            onDeselectAll={handleDiscoveryModalDeselectAll}
            onConfirm={handleDiscoveryModalConfirm}
            onCancel={handleDiscoveryModalCancel}
            isLoading={isCrawling}
            totalCount={allDiscoveredUrls.length}
            byDepth={allDiscoveredUrls.reduce((acc, item) => {
              acc[item.depth] = (acc[item.depth] || 0) + 1;
              return acc;
            }, {} as Record<number, number>)}
            onUpdateTitle={(url, title) => {
              // 제목 업데이트: allDiscoveredUrls에서 해당 URL의 제목 업데이트
              setAllDiscoveredUrls(prev =>
                prev.map(item =>
                  item.url === url ? { ...item, title } : item
                )
              );
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
