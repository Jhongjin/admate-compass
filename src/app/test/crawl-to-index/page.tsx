'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Loader2, 
  Play, 
  CheckCircle, 
  XCircle, 
  Globe,
  RefreshCw,
  FileText,
  Database,
  Sparkles,
  List,
  Clock,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

// URL 타입 선언
declare global {
  interface Window {
    URL: typeof URL;
  }
}

interface JobStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  job_type: string;
  result?: any;
  created_at: string;
  updated_at: string;
}

interface Document {
  id: string;
  title: string;
  type: string;
  status: string;
  chunk_count: number;
  file_size: number;
  created_at: string;
  updated_at?: string;
  url?: string;
  source_vendor?: string;
}

export default function CrawlToIndexTestPage() {
  const [url, setUrl] = useState<string>('https://ads.naver.com/');
  const [isCrawling, setIsCrawling] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobIdReady, setJobIdReady] = useState(false); // 작업 ID가 준비되었는지 (DB 반영 대기)
  const [nullCheckCount, setNullCheckCount] = useState(0); // null 반환 횟수 추적
  const nullCheckCountRef = useRef(0); // ref로도 추적 (query 함수 내에서 사용)
  const [currentStep, setCurrentStep] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [options, setOptions] = useState({
    extractSubPages: true,
    maxDepth: 3,
    respectRobots: true,
    domainLimit: true,
  });
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const queryClient = useQueryClient();

  // 삭제 중 플래그 (자동 새로고침 일시 중지용)
  const [isDeleting, setIsDeleting] = useState(false);
  
  // 작업 완료 토스트 중복 방지 플래그
  const completionToastShownRef = useRef(false);
  
  // 🔥 삭제된 문서 ID 목록 (영구 저장하여 자동 새로고침 시에도 필터링)
  const [deletedDocumentIds, setDeletedDocumentIds] = useState<Set<string>>(new Set());
  
  // 문서 목록 조회 (3초마다 자동 새로고침, 삭제 중일 때는 중지)
  const { data: documentsData, refetch: refetchDocuments } = useQuery({
    queryKey: ['test-documents'],
    queryFn: async () => {
      // 🔥 캐시 버스팅을 위한 타임스탬프 추가
      const cacheBuster = Date.now();
      const res = await fetch(`/api/admin/upload-new?limit=200&status=indexed&_t=${cacheBuster}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        }
      });
      if (!res.ok) throw new Error('Failed to fetch documents');
      const data = await res.json();
      
      // 상세 디버깅 로그
      const documents = data?.data?.documents || [];
      console.log('📥 문서 목록 조회:', {
        success: data?.success,
        total: documents.length,
        response_structure: {
          has_data: !!data?.data,
          has_documents: !!data?.data?.documents,
          is_array: Array.isArray(documents),
          documents_type: typeof documents
        },
        documents: documents.slice(0, 5).map((d: Document) => ({
          id: d.id?.substring(0, 8),
          title: d.title,
          url: d.url,
          status: d.status,
          chunk_count: d.chunk_count,
          type: d.type
        })),
        all_documents_urls: documents.map((d: Document) => d.url).filter(Boolean)
      });
      
      return data;
    },
    refetchInterval: isDeleting ? false : 3000, // 삭제 중일 때는 자동 새로고침 중지
  });

  const supabase = createClient();

  // 인덱싱된 문서 목록 (필터링 없이 모든 문서 표시 - 크롤링 테스트 목적)
  // maxDepth와 상관없이 크롤된 모든 페이지 리스트를 보여줌
  // 🔥 삭제된 문서는 항상 필터링하여 표시하지 않음
  const recentDocuments = React.useMemo(() => {
    const allDocs = documentsData?.data?.documents || [];
    
    // 🔥 삭제된 문서 ID로 필터링 (백엔드에서 삭제된 문서 제외)
    const filteredDocs = allDocs.filter((doc: Document) => {
      return !deletedDocumentIds.has(doc.id);
    });
    
    // 백엔드 처리 상태 진단
    console.log('📋 [백엔드 진단] 전체 문서 수:', allDocs.length, {
      documentsData_exists: !!documentsData,
      data_exists: !!documentsData?.data,
      documents_array: Array.isArray(allDocs),
      response_success: documentsData?.success,
      삭제된_문서_ID_수: deletedDocumentIds.size,
      필터링_후_문서_수: filteredDocs.length,
      first_doc: filteredDocs[0] ? {
        id: filteredDocs[0].id?.substring(0, 8),
        url: filteredDocs[0].url,
        title: filteredDocs[0].title,
        status: filteredDocs[0].status,
        chunk_count: filteredDocs[0].chunk_count,
        type: filteredDocs[0].type
      } : null,
      all_urls: filteredDocs.map((d: Document) => d.url).filter(Boolean)
    });
    
    // 백엔드에서 문서가 조회되었는지 확인
    if (filteredDocs.length > 0) {
      console.log('✅ [백엔드 확인] 문서가 정상적으로 조회되었습니다:', {
        총_문서수: filteredDocs.length,
        첫_문서_URL: filteredDocs[0]?.url,
        첫_문서_상태: filteredDocs[0]?.status,
        첫_문서_청크수: filteredDocs[0]?.chunk_count
      });
    } else if (allDocs.length > 0) {
      console.warn('⚠️ [백엔드 확인] 모든 문서가 삭제되었거나 필터링되었습니다.', {
        전체_문서: allDocs.length,
        삭제된_ID_수: deletedDocumentIds.size
      });
    } else {
      console.warn('⚠️ [백엔드 확인] 조회된 문서가 없습니다. 백엔드에서 인덱싱이 완료되지 않았을 수 있습니다.');
    }
    
    // 크롤링 테스트 목적: 필터링 없이 모든 문서 반환 (단, 삭제된 문서는 제외)
    console.log('📋 [문서 목록] 삭제된 문서 제외 후 표시:', {
      전체_문서: allDocs.length,
      삭제된_문서: deletedDocumentIds.size,
      필터링_후: filteredDocs.length,
      maxDepth: options.maxDepth,
      note: '크롤링 테스트를 위해 모든 문서를 표시하되, 삭제된 문서는 제외합니다.'
    });
    
    // 🔥 중요: documentsData 전체를 의존성으로 추가하여 캐시 업데이트 시 즉시 반영
    // 🔥 삭제된 문서 ID도 의존성에 추가하여 삭제 시 즉시 필터링
    return filteredDocs;
  }, [documentsData, options.maxDepth, deletedDocumentIds]);

  // 도메인별 통계 계산
  const domainStats = React.useMemo(() => {
    if (!recentDocuments.length) return null;

    try {
      const targetUrl = new URL(url);
      const baseDomain = targetUrl.hostname;
      
      // 도메인별 문서 수 집계
      const domainMap = new Map<string, number>();
      let sameDomainCount = 0;
      let subdomainCount = 0;
      let otherDomainCount = 0;

      recentDocuments.forEach((doc: Document) => {
        if (!doc.url) return;
        try {
          const docUrl = new URL(doc.url);
          const docDomain = docUrl.hostname;
          
          const count = domainMap.get(docDomain) || 0;
          domainMap.set(docDomain, count + 1);

          if (docDomain === baseDomain) {
            sameDomainCount++;
          } else if (docDomain.endsWith(`.${baseDomain}`)) {
            subdomainCount++;
          } else {
            otherDomainCount++;
          }
        } catch {
          // URL 파싱 실패 시 무시
        }
      });

      // 도메인 목록을 문서 수 기준으로 정렬
      const domainList = Array.from(domainMap.entries())
        .map(([domain, count]) => ({
          domain,
          count,
          isBaseDomain: domain === baseDomain,
          isSubdomain: domain !== baseDomain && domain.endsWith(`.${baseDomain}`),
          isOtherDomain: domain !== baseDomain && !domain.endsWith(`.${baseDomain}`)
        }))
        .sort((a, b) => b.count - a.count);

      return {
        baseDomain,
        totalDocuments: recentDocuments.length,
        domainList,
        sameDomainCount,
        subdomainCount,
        otherDomainCount,
        domainCount: domainMap.size
      };
    } catch {
      return null;
    }
  }, [recentDocuments, url]);

  // 작업 상태 조회
  const { data: jobStatus, refetch: refetchJob, isLoading: isLoadingJob } = useQuery({
    queryKey: ['job-status', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      
      // Supabase에서 직접 작업 상태 조회
      const { data, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();
      
      if (error) {
        console.error('❌ 작업 상태 조회 실패:', error);
        throw new Error(`Failed to fetch job status: ${error.message}`);
      }
      
      // null인 경우 카운트 증가 (너무 많은 로그 방지)
      if (!data) {
        nullCheckCountRef.current += 1;
        const currentCount = nullCheckCountRef.current;
        // 처음 몇 번만 로그 출력 (너무 많은 경고 방지)
        if (currentCount <= 3) {
          console.log('🔍 작업 상태 조회:', jobId, `(시도 ${currentCount})`);
        }
        // 상태 업데이트는 useEffect에서 처리
        return null;
      }
      
      // 데이터가 있으면 카운트 리셋
      if (nullCheckCountRef.current > 0) {
        nullCheckCountRef.current = 0;
      }
      console.log('📊 작업 상태:', {
        id: data.id,
        status: data.status,
        job_type: data.job_type,
        result: data.result ? Object.keys(data.result) : null
      });
      
      return data as JobStatus | null;
    },
    enabled: !!jobId && jobIdReady, // jobId가 설정되고 준비된 후에만 쿼리 활성화
    refetchInterval: (query) => {
      // 작업이 완료되면 폴링 중지
      const data = query.state.data;
      if (data?.status === 'completed' || data?.status === 'failed') {
        console.log('✅ 작업 완료, 폴링 중지:', data.status);
        return false;
      }
      // null이 계속 반환되는 경우 (10회 이상) 폴링 간격 늘리기
      if (nullCheckCountRef.current >= 10) {
        return 5000; // 5초마다 폴링
      }
      return 2000; // 2초마다 폴링
    },
  });

  // nullCheckCount 동기화 (ref -> state)
  useEffect(() => {
    setNullCheckCount(nullCheckCountRef.current);
  }, [jobStatus]); // jobStatus가 변경될 때마다 동기화

  // 작업 상태에 따른 진행 상황 업데이트
  useEffect(() => {
    if (!jobStatus) {
      if (jobId && jobIdReady && !isLoadingJob) {
        const currentNullCount = nullCheckCountRef.current;
        // null 체크가 여러 번 반복되면 경고 (너무 많은 로그 방지)
        if (currentNullCount >= 5 && currentNullCount % 5 === 0) {
          console.warn('⚠️ 작업 ID가 있지만 상태를 조회할 수 없습니다:', jobId, `(시도 ${currentNullCount}회)`);
        }
        // 작업이 완료되어 삭제되었을 수 있음 - 문서 목록으로 확인
        if (recentDocuments.length > 0) {
          console.log('✅ 작업이 완료된 것으로 보입니다. 문서 목록에', recentDocuments.length, '개 문서가 있습니다.');
          setCurrentStep(`인덱싱 완료! (${recentDocuments.length}개 문서)`);
          setProgress(100);
          setIsCrawling(false);
          // 🔥 토스트 중복 방지
          if (!completionToastShownRef.current) {
            toast.success(`크롤링 및 인덱싱이 완료되었습니다! (${recentDocuments.length}개 문서)`);
            completionToastShownRef.current = true;
          }
          // 상태 리셋
          setJobId(null);
          setJobIdReady(false);
          nullCheckCountRef.current = 0;
          setNullCheckCount(0);
        } else if (currentNullCount < 3) {
          // 처음 몇 번은 정상적인 대기 상태
          setCurrentStep('작업 상태 조회 중...');
          setProgress(5);
        } else {
          // 여러 번 null이 반환되면 작업이 빠르게 완료되었거나 처리 중일 수 있음
          setCurrentStep('작업 처리 중... (문서 목록 확인 중)');
          setProgress(10);
        }
      } else if (jobId && !jobIdReady) {
        // 작업 ID는 있지만 아직 준비되지 않음
        setCurrentStep('작업 등록 중...');
        setProgress(2);
      }
      return;
    }

    const status = jobStatus.status;
    const result = jobStatus.result || {};

    console.log('🔄 작업 상태 업데이트:', { status, resultKeys: Object.keys(result) });

    switch (status) {
      case 'pending':
        setCurrentStep('큐에 작업 추가됨 - 대기 중...');
        setProgress(10);
        break;
      case 'processing':
        if (result.status === 'crawling') {
          setCurrentStep('크롤링 중...');
          setProgress(30);
        } else if (result.status === 'main_page_completed') {
          setCurrentStep('메인 페이지 크롤링 완료 - 하위 페이지 처리 중...');
          setProgress(50);
        } else if (result.status === 'rag_processing') {
          setCurrentStep('RAG 처리 중 (청킹 및 임베딩)...');
          setProgress(70);
        } else {
          setCurrentStep('처리 중...');
          setProgress(40);
        }
        break;
      case 'completed':
        setCurrentStep('인덱싱 완료!');
        setProgress(100);
        setIsCrawling(false);
        
        // 🔥 토스트 중복 방지: 이미 표시되었으면 스킵
        if (completionToastShownRef.current) {
          console.log('⚠️ [작업 완료] 토스트가 이미 표시되었습니다. 중복 실행 방지.');
          break;
        }
        
        console.log('✅ [작업 완료] 문서 목록 강제 갱신 시작...');
        
        // 작업 완료 후 문서 목록 강제 갱신 (여러 번 시도)
        const refreshDocuments = async () => {
          // 1. 캐시 무효화
          await queryClient.cancelQueries({ queryKey: ['test-documents'] });
          queryClient.removeQueries({ queryKey: ['test-documents'] });
          queryClient.invalidateQueries({ queryKey: ['test-documents'] });
          
          // 2. 여러 번 refetch 시도 (DB 반영 시간 고려)
          for (let i = 0; i < 5; i++) {
            const delay = i === 0 ? 500 : i * 1000; // 0.5초, 1초, 2초, 3초, 4초
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
              const result = await refetchDocuments();
              const allDocs = result.data?.data?.documents || [];
              
              console.log(`🔄 [작업 완료] Refetch 시도 ${i + 1}/5:`, {
                전체_문서: allDocs.length,
                첫_문서_URL: allDocs[0]?.url || 'N/A',
                첫_문서_상태: allDocs[0]?.status,
                첫_문서_청크수: allDocs[0]?.chunk_count || 0
              });
              
              // 🔥 중요: refetch 결과를 React Query 캐시에 즉시 반영
              if (result.data) {
                queryClient.setQueryData(['test-documents'], result.data);
                queryClient.invalidateQueries({ queryKey: ['test-documents'] }); // 강제 리렌더링
                console.log('✅ [작업 완료] React Query 캐시 업데이트 완료');
              }
              
              if (allDocs.length > 0) {
                // 문서가 조회되면 성공 (토스트는 한 번만 표시)
                console.log('✅ [작업 완료] 문서 목록 갱신 성공:', allDocs.length, '개 문서');
                if (!completionToastShownRef.current) {
                  toast.success(`크롤링 및 인덱싱이 완료되었습니다! (${allDocs.length}개 문서 조회됨)`);
                  completionToastShownRef.current = true;
                }
                break;
              } else if (i === 4) {
                // 마지막 시도에서도 문서가 없으면 백엔드 상태 확인
                console.warn('⚠️ [작업 완료] 모든 refetch 시도 후에도 문서가 없습니다. 백엔드 상태 확인 필요.');
                try {
                  const checkResponse = await fetch('/api/admin/check-processing-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                  });
                  const checkData = await checkResponse.json();
                  console.log('🔍 [백엔드 상태 확인]', {
                    success: checkData.success,
                    processingCount: checkData.data?.processingCount || 0,
                    pendingCount: checkData.data?.pendingCount || 0,
                    synced: checkData.data?.synced || 0,
                    results: checkData.data?.results?.slice(0, 3) || []
                  });
                  
                  if (checkData.data?.synced > 0) {
                    // 동기화가 발생했으면 다시 refetch
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const finalResult = await refetchDocuments();
                    if (finalResult.data) {
                      queryClient.setQueryData(['test-documents'], finalResult.data);
                      queryClient.invalidateQueries({ queryKey: ['test-documents'] });
                    }
                    const finalDocs = finalResult.data?.data?.documents || [];
                    if (finalDocs.length > 0 && !completionToastShownRef.current) {
                      toast.success(`크롤링 및 인덱싱이 완료되었습니다! (${finalDocs.length}개 문서 조회됨, 상태 동기화 완료)`);
                      completionToastShownRef.current = true;
                    }
                  } else if (!completionToastShownRef.current) {
                    // 문서가 없어도 작업 완료 토스트 표시 (한 번만)
                    toast.warning('크롤링이 완료되었지만 문서가 조회되지 않습니다. 잠시 후 다시 확인해주세요.');
                    completionToastShownRef.current = true;
                  }
                } catch (checkError) {
                  console.error('❌ [백엔드 상태 확인 실패]:', checkError);
                }
              }
            } catch (error) {
              console.error(`❌ [작업 완료] Refetch 시도 ${i + 1} 실패:`, error);
            }
          }
        };
        
        refreshDocuments();
        break;
      case 'failed':
        setCurrentStep('처리 실패');
        setProgress(0);
        setIsCrawling(false);
        toast.error('크롤링 또는 인덱싱 중 오류가 발생했습니다.');
        break;
    }
  }, [jobStatus, refetchDocuments, jobId, isLoadingJob, recentDocuments.length]);

  const handleStartCrawl = async () => {
    if (!url.trim()) {
      toast.error('URL을 입력해주세요.');
      return;
    }

    setIsCrawling(true);
    setJobId(null);
    setCurrentStep('작업 시작 중...');
    setProgress(0);

    try {
      // 큐에 작업 추가
      const response = await fetch('/api/jobs/enqueue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jobType: 'CRAWL_SEED',
          payload: {
            url: url.trim(),
            extractSubPages: options.extractSubPages,
            maxDepth: options.maxDepth,
            respectRobots: options.respectRobots,
            domainLimit: options.domainLimit,
          },
        }),
      });

      const data = await response.json();

      console.log('📋 작업 추가 응답:', data);

      if (data.success && data.jobId) {
        console.log('✅ 작업 ID 설정:', data.jobId);
        setJobId(data.jobId);
        nullCheckCountRef.current = 0; // 카운트 리셋
        setNullCheckCount(0);
        completionToastShownRef.current = false; // 🔥 새 작업 시작 시 토스트 플래그 리셋
        setDeletedDocumentIds(new Set()); // 🔥 새 작업 시작 시 삭제 ID 목록 초기화
        // DB 반영을 위한 짧은 지연 후 쿼리 활성화
        setTimeout(() => {
          setJobIdReady(true);
          console.log('✅ 작업 상태 조회 시작');
        }, 500); // 500ms 지연으로 DB 반영 시간 확보
        toast.success('크롤링 작업이 큐에 추가되었습니다.');
      } else {
        console.error('❌ 작업 추가 실패:', data);
        throw new Error(data.error || '작업 추가 실패');
      }
    } catch (error) {
      console.error('크롤링 시작 오류:', error);
      toast.error('크롤링 시작 중 오류가 발생했습니다.');
      setIsCrawling(false);
      setCurrentStep('');
      setProgress(0);
    }
  };

  const handleStop = () => {
    setIsCrawling(false);
    setJobId(null);
    setJobIdReady(false);
    nullCheckCountRef.current = 0;
    setNullCheckCount(0);
    setCurrentStep('');
    setProgress(0);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const handleDeleteDomainDocuments = async () => {
    if (!url.trim()) {
      toast.error('URL을 입력해주세요.');
      return;
    }

    try {
      const targetUrl = new URL(url.trim());
      const domain = targetUrl.hostname;

      if (!confirm(`${domain} 도메인의 모든 문서를 삭제하시겠습니까?`)) {
        return;
      }

      // 삭제 시작 플래그 설정 (자동 새로고침 중지)
      setIsDeleting(true);

      // 삭제 전 문서 수 및 삭제될 문서 ID 목록 확인
      const beforeDeleteCount = recentDocuments.length;
      const deletedDocumentIds = new Set(recentDocuments.map((doc: Document) => doc.id));
      console.log(`🗑️ 삭제 전 문서 수: ${beforeDeleteCount}개`, {
        삭제될_문서_ID: Array.from(deletedDocumentIds).slice(0, 5)
      });

      toast.info('도메인 문서 삭제 중...');
      
      const response = await fetch('/api/admin/delete-domain-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domain }),
      });

      const data = await response.json();
      console.log('🗑️ 삭제 API 응답:', data);

      if (data.success) {
        const deletedCount = data.deleted?.documents || 0;
        const verifiedCount = data.deleted?.verified || deletedCount;
        const remainingCount = data.deleted?.remaining || 0;
        const verified = data.verified !== false;
        
        console.log(`🗑️ 삭제 완료:`, {
          삭제_요청: deletedCount,
          검증_삭제: verifiedCount,
          남은_문서: remainingCount,
          검증_성공: verified,
          삭제된_문서_ID: data.deletedDocuments?.map((d: any) => d.id.substring(0, 8)) || []
        });
        
        // 백엔드에서 실제로 삭제된 문서 ID 목록 저장
        const backendDeletedIds = new Set<string>(
          (data.deletedDocuments || [])
            .map((d: any) => d.id as string)
            .filter((id: string): id is string => typeof id === 'string' && id.length > 0)
        );
        
        // 🔥 삭제된 문서 ID를 상태에 영구 저장 (자동 새로고침 시에도 필터링)
        setDeletedDocumentIds(prev => {
          const newSet = new Set(prev);
          backendDeletedIds.forEach((id: string) => newSet.add(id));
          console.log('🗑️ [삭제 ID 저장] 삭제된 문서 ID 목록 업데이트:', {
            기존_삭제_ID_수: prev.size,
            새로_추가된_ID_수: backendDeletedIds.size,
            총_삭제_ID_수: newSet.size
          });
          return newSet;
        });
        
        // React Query 캐시 완전히 제거 및 무효화
        await queryClient.cancelQueries({ queryKey: ['test-documents'] });
        queryClient.removeQueries({ queryKey: ['test-documents'] });
        queryClient.clear(); // 모든 쿼리 캐시 클리어
        
        // 즉시 refetch 실행 (캐시 없이, 필터링 없이)
        const refetchWithRetry = async (retries = 10) => {
          for (let i = 0; i < retries; i++) {
            const delay = i === 0 ? 500 : i * 1000; // 첫 번째는 0.5초, 이후 1초씩 증가
            await new Promise(resolve => setTimeout(resolve, delay));
            
            try {
              // 강제로 새로고침 (캐시 무시, 타임스탬프 추가하여 캐시 버스팅)
              const cacheBuster = Date.now();
              const result = await queryClient.fetchQuery({
                queryKey: ['test-documents'],
                queryFn: async () => {
                  const res = await fetch(`/api/admin/upload-new?limit=200&status=indexed&_t=${cacheBuster}`, {
                    cache: 'no-store',
                    headers: {
                      'Cache-Control': 'no-cache, no-store, must-revalidate',
                      'Pragma': 'no-cache',
                      'Expires': '0',
                    }
                  });
                  if (!res.ok) throw new Error('Failed to fetch documents');
                  return res.json();
                },
              });
              
              const allDocs = result?.data?.documents || [];
              
              // 🔥 삭제된 문서 ID로 필터링 (상태에 저장된 삭제 ID 사용)
              const currentDeletedIds = deletedDocumentIds.size > 0 ? deletedDocumentIds : backendDeletedIds;
              const finalDocs = allDocs.filter((doc: Document) => {
                return !currentDeletedIds.has(doc.id);
              });
              
              const afterDeleteCount = finalDocs.length;
              
              console.log(`🔄 [삭제 후 Refetch] 시도 ${i + 1}/${retries}:`, {
                전체_문서: allDocs.length,
                삭제_ID_필터링_후: finalDocs.length,
                삭제_전: beforeDeleteCount,
                차이: beforeDeleteCount - afterDeleteCount,
                백엔드_삭제_ID_수: backendDeletedIds.size,
                상태_삭제_ID_수: deletedDocumentIds.size,
                백엔드_검증: verified,
                백엔드_남은_문서: remainingCount
              });
              
              // 삭제가 확인되면 중단
              if (afterDeleteCount === 0 || afterDeleteCount < beforeDeleteCount) {
                console.log(`✅ 문서 삭제 확인됨: ${beforeDeleteCount}개 → ${afterDeleteCount}개`);
                
                // 필터링된 결과로 상태 업데이트
                const filteredResult = {
                  ...result,
                  data: {
                    ...result.data,
                    documents: finalDocs,
                    total: finalDocs.length
                  }
                };
                
                // 🔥 UI 즉시 업데이트를 위해 필터링된 상태 강제 갱신
                queryClient.setQueryData(['test-documents'], filteredResult);
                
                // 🔥 추가: 캐시 무효화 및 강제 리렌더링
                queryClient.invalidateQueries({ queryKey: ['test-documents'] });
                
                // 🔥 추가: 최종 확인을 위해 한 번 더 refetch (DB 반영 시간 고려)
                setTimeout(async () => {
                  try {
                    const finalCacheBuster = Date.now();
                    const finalRefetch = await queryClient.fetchQuery({
                      queryKey: ['test-documents'],
                      queryFn: async () => {
                        const res = await fetch(`/api/admin/upload-new?limit=200&status=indexed&_t=${finalCacheBuster}`, {
                          cache: 'no-store',
                          headers: {
                            'Cache-Control': 'no-cache, no-store, must-revalidate',
                            'Pragma': 'no-cache',
                            'Expires': '0',
                          }
                        });
                        if (!res.ok) throw new Error('Failed to fetch documents');
                        return res.json();
                      },
                    });
                    
                    const finalAllDocs = finalRefetch?.data?.documents || [];
                    // 🔥 상태에 저장된 삭제 ID로 필터링
                    const finalFilteredDocs = finalAllDocs.filter((doc: Document) => {
                      return !deletedDocumentIds.has(doc.id);
                    });
                    
                    console.log(`🔄 [최종 확인] Refetch 결과:`, {
                      전체_문서: finalAllDocs.length,
                      필터링_후: finalFilteredDocs.length,
                      삭제_ID_수: backendDeletedIds.size
                    });
                    
                    // 최종 필터링된 결과로 캐시 업데이트
                    const finalFilteredResult = {
                      ...finalRefetch,
                      data: {
                        ...finalRefetch.data,
                        documents: finalFilteredDocs,
                        total: finalFilteredDocs.length
                      }
                    };
                    
                    queryClient.setQueryData(['test-documents'], finalFilteredResult);
                    queryClient.invalidateQueries({ queryKey: ['test-documents'] });
                  } catch (finalError) {
                    console.error('❌ 최종 refetch 실패:', finalError);
                  }
                }, 2000); // 2초 후 최종 확인
                
                // 검증 메시지
                if (!verified || remainingCount > 0) {
                  toast.warning(`${deletedCount}개 문서 삭제 요청됨 (백엔드 검증: ${remainingCount}개 문서가 여전히 존재할 수 있음)`);
                } else if (afterDeleteCount === 0) {
                  toast.success(`모든 문서가 삭제되었습니다. (${deletedCount}개 삭제됨)`);
                } else {
                  toast.success(`${deletedCount}개 문서가 삭제되었습니다. (${afterDeleteCount}개 남음)`);
                }
                
                // 삭제 완료 플래그 해제 (자동 새로고침 재개)
                setIsDeleting(false);
                break;
              }
              
              // 마지막 시도에서도 삭제가 확인되지 않으면 경고
              if (i === retries - 1 && afterDeleteCount >= beforeDeleteCount) {
                console.error(`❌ 삭제 확인 실패: 문서가 여전히 ${afterDeleteCount}개 존재합니다.`, {
                  백엔드_삭제_ID: Array.from(backendDeletedIds).slice(0, 5),
                  남은_문서_ID: finalDocs.slice(0, 5).map((d: Document) => d.id.substring(0, 8)),
                  백엔드_검증: verified,
                  백엔드_남은_문서: remainingCount
                });
                toast.error(`문서 삭제가 완전히 반영되지 않았습니다. (${afterDeleteCount}개 문서 남음, 백엔드 검증: ${remainingCount}개)`);
                setIsDeleting(false);
              }
            } catch (refetchError) {
              console.error(`❌ Refetch 시도 ${i + 1} 실패:`, refetchError);
              if (i === retries - 1) {
                setIsDeleting(false);
              }
            }
          }
        };
        
        await refetchWithRetry();
        
        // 삭제 완료 후 백엔드 검증 API 호출
        setTimeout(async () => {
          try {
            console.log('🔍 [삭제 후 검증] 백엔드 검증 API 호출...');
            const verifyResponse = await fetch('/api/admin/verify-document-deletion', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ domain }),
            });
            const verifyData = await verifyResponse.json();
            
            if (verifyData.success) {
              const remainingInBackend = verifyData.data?.total || 0;
              console.log(`🔍 [삭제 후 검증] 백엔드 남은 문서: ${remainingInBackend}개`);
              
              if (remainingInBackend > 0) {
                console.warn(`⚠️ [삭제 후 검증] 백엔드에 여전히 ${remainingInBackend}개 문서가 존재합니다.`);
                toast.warning(`백엔드 검증: ${remainingInBackend}개 문서가 여전히 존재합니다.`);
              } else {
                console.log(`✅ [삭제 후 검증] 백엔드에서 모든 문서가 삭제되었습니다.`);
              }
            }
          } catch (verifyError) {
            console.error('❌ [삭제 후 검증] 검증 API 호출 실패:', verifyError);
          }
        }, 2000);
        
        // 삭제 완료 후 추가로 한 번 더 강제 새로고침 (5초 후)
        setTimeout(async () => {
          console.log('🔄 [삭제 완료] 최종 새로고침 실행...');
          await queryClient.cancelQueries({ queryKey: ['test-documents'] });
          queryClient.invalidateQueries({ queryKey: ['test-documents'] });
          await refetchDocuments();
          setIsDeleting(false);
        }, 5000);
      } else {
        setIsDeleting(false);
        throw new Error(data.error || '문서 삭제 실패');
      }
    } catch (error) {
      console.error('도메인 문서 삭제 오류:', error);
      toast.error('도메인 문서 삭제 중 오류가 발생했습니다.');
      setIsDeleting(false);
    }
  };

  // 작업이 완료되었는지 문서 목록으로 확인 (null 상태가 지속될 때)
  useEffect(() => {
    const currentNullCount = nullCheckCountRef.current;
    if (jobId && jobIdReady && !jobStatus && recentDocuments.length > 0 && !isLoadingJob && currentNullCount >= 3) {
      // 작업 레코드가 없지만 문서가 인덱싱되어 있고, 여러 번 null이 반환되었으면 완료된 것으로 간주
      const timeoutId = setTimeout(() => {
        console.log('✅ 작업 완료 확인: 문서 목록에', recentDocuments.length, '개 문서가 인덱싱되어 있습니다.');
        setCurrentStep(`인덱싱 완료! (${recentDocuments.length}개 문서)`);
        setProgress(100);
        setIsCrawling(false);
        setJobId(null);
        setJobIdReady(false);
        nullCheckCountRef.current = 0;
        setNullCheckCount(0);
        // 🔥 토스트 중복 방지
        if (!completionToastShownRef.current) {
          toast.success(`크롤링 및 인덱싱이 완료되었습니다! (${recentDocuments.length}개 문서)`);
          completionToastShownRef.current = true;
        }
      }, 3000); // 3초 후 확인 (작업 레코드 정리 시간 고려)

      return () => clearTimeout(timeoutId);
    }
  }, [jobId, jobIdReady, jobStatus, recentDocuments.length, isLoadingJob]);

  // 작업 결과 요약
  const jobSummary = jobStatus?.result || {};

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            크롤링 → 인덱싱 통합 테스트
          </CardTitle>
          <CardDescription>
            크롤링부터 인덱싱 완료 후 문서 목록 업데이트까지 전체 프로세스를 테스트합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* URL 입력 */}
          <div className="space-y-2">
            <Label htmlFor="url">크롤링할 URL</Label>
            <Input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={isCrawling}
            />
          </div>

          {/* 옵션 설정 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="extractSubPages">하위 페이지 추출</Label>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="extractSubPages"
                  checked={options.extractSubPages}
                  onChange={(e) => setOptions({ ...options, extractSubPages: e.target.checked })}
                  disabled={isCrawling}
                  className="w-4 h-4"
                />
                <span className="text-sm text-muted-foreground">
                  {options.extractSubPages ? '활성화' : '비활성화'}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxDepth">최대 깊이 (1-4)</Label>
              <Input
                id="maxDepth"
                type="number"
                min="1"
                max="4"
                value={options.maxDepth}
                onChange={(e) => setOptions({ ...options, maxDepth: parseInt(e.target.value) || 3 })}
                disabled={isCrawling}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="respectRobots">robots.txt 존중</Label>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="respectRobots"
                  checked={options.respectRobots}
                  onChange={(e) => setOptions({ ...options, respectRobots: e.target.checked })}
                  disabled={isCrawling}
                  className="w-4 h-4"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="domainLimit">도메인 제한</Label>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="domainLimit"
                  checked={options.domainLimit}
                  onChange={(e) => setOptions({ ...options, domainLimit: e.target.checked })}
                  disabled={isCrawling}
                  className="w-4 h-4"
                />
              </div>
            </div>
          </div>

          {/* 시작 버튼 및 도메인 문서 삭제 */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button
                onClick={handleStartCrawl}
                disabled={isCrawling}
                className="flex-1"
              >
                {isCrawling ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    처리 중...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    크롤링 시작
                  </>
                )}
              </Button>
              {isCrawling && (
                <Button
                  onClick={handleStop}
                  variant="outline"
                >
                  중지
                </Button>
              )}
              {!isCrawling && (
                <Button
                  onClick={handleDeleteDomainDocuments}
                variant="destructive"
                disabled={!url.trim()}
              >
                <XCircle className="mr-2 h-4 w-4" />
                도메인 문서 삭제
              </Button>
            )}
            </div>
            
            {/* 크롤링 상태 확인 버튼 */}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={async () => {
                try {
                const targetUrl = new URL(url);
                const domain = targetUrl.hostname;
                
                // 크롤링 작업 상태 확인
                const statusResponse = await fetch('/api/admin/check-crawl-status', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ domain, jobId: jobId || undefined }),
                });
                
                const statusData = await statusResponse.json();
                
                if (statusData.success) {
                  const { latestJob, summary, domainStats, jobs, dbVerification } = statusData.data;
                  console.log('🔍 [크롤링 상태 확인]:', statusData.data);
                  
                  // 상세 정보를 콘솔에 출력
                  if (jobs && jobs.length > 0) {
                    console.log('📋 [작업 상세 정보]:', jobs.map((j: any) => ({
                      jobId: j.jobId,
                      status: j.status,
                      startedAt: j.startedAt,
                      finishedAt: j.finishedAt,
                      subPagesCount: j.result?.subPagesCount || 0,
                      totalChunks: j.result?.totalChunks || 0,
                      documentsCount: j.documents?.length || 0
                    })));
                  }
                  
                  // 🔥 DB 저장 확인 결과 콘솔 출력
                  if (dbVerification) {
                    console.log('💾 [DB 저장 확인 결과]:', {
                      확인된_문서_수: dbVerification.sampleDocumentsChecked,
                      실제_청크_수: dbVerification.actualChunksInDB,
                      DB_청크_수: dbVerification.dbChunksCount,
                      청크_일치: dbVerification.chunksMatch,
                      임베딩_수: dbVerification.embeddingsCount,
                      확인_상태: dbVerification.verificationStatus,
                      샘플_URL: dbVerification.sampleUrls
                    });
                  }
                  
                  let message = '';
                  if (latestJob) {
                    message = `작업 상태: ${latestJob.status}`;
                    if (latestJob.isCompleted) {
                      const finishedAt = latestJob.finishedAt ? new Date(latestJob.finishedAt).toLocaleString('ko-KR') : '';
                      message += ` ✅ 완료`;
                      if (finishedAt) message += ` (${finishedAt})`;
                      const result = latestJob.result as any;
                      if (result?.subPagesCount) message += `\n하위 페이지: ${result.subPagesCount}개`;
                      if (result?.totalChunks) message += `\n총 청크: ${result.totalChunks}개`;
                    } else if (latestJob.isProcessing) {
                      message += ` ⏳ 처리 중...`;
                    } else if (latestJob.isFailed) {
                      message += ` ❌ 실패`;
                    }
                  }
                  
                  if (summary) {
                    message += `\n\n작업 통계: 완료 ${summary.completed}개, 처리중 ${summary.processing}개, 실패 ${summary.failed}개`;
                  }
                  
                  if (domainStats) {
                    message += `\n\n도메인 문서 (${domain}):`;
                    message += `\n- 총 ${domainStats.total}개`;
                    message += `\n- 인덱싱됨: ${domainStats.indexed}개 ✅`;
                    message += `\n- 처리중: ${domainStats.processing}개 ⏳`;
                    message += `\n- 실패: ${domainStats.failed}개 ❌`;
                    message += `\n- 대기중: ${domainStats.pending}개`;
                    if (domainStats.totalChunks > 0) {
                      message += `\n- 총 청크: ${domainStats.totalChunks}개`;
                    }
                  }
                  
                  // 🔥 DB 저장 확인 결과 추가
                  if (dbVerification) {
                    message += `\n\n💾 DB 저장 확인:`;
                    message += `\n- 확인된 문서: ${dbVerification.sampleDocumentsChecked}개`;
                    message += `\n- 실제 청크 (DB): ${dbVerification.actualChunksInDB}개`;
                    message += `\n- 임베딩 벡터: ${dbVerification.embeddingsCount}개`;
                    if (dbVerification.verificationStatus === 'verified') {
                      message += `\n- 상태: ✅ DB에 정상 저장됨`;
                    } else {
                      message += `\n- 상태: ⚠️ 저장 불완전 (청크: ${dbVerification.actualChunksInDB}개, 임베딩: ${dbVerification.embeddingsCount}개)`;
                    }
                  }
                  
                  toast.info(message, { duration: 12000 });
                } else {
                  toast.error(`상태 확인 실패: ${statusData.error || '알 수 없는 오류'}`);
                }
              } catch (error) {
                console.error('크롤링 상태 확인 오류:', error);
                toast.error('크롤링 상태 확인 중 오류가 발생했습니다.');
              }
            }}
          >
            <Database className="h-4 w-4 mr-2" />
            크롤링 상태 확인
          </Button>
          </div>

          {/* 진행 상황 */}
          {isCrawling && (
            <Card className="bg-muted/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  진행 상황
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{currentStep}</span>
                    <span className="font-medium">{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>

                {jobStatus && (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={jobStatus.status === 'completed' ? 'default' : 'secondary'}>
                        {jobStatus.status}
                      </Badge>
                      <span className="text-muted-foreground">
                        작업 ID: {jobStatus.id.substring(0, 8)}...
                      </span>
                    </div>

                    {jobSummary.chunkCount && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        <span>청크 수: {jobSummary.chunkCount}개</span>
                      </div>
                    )}

                    {jobSummary.subPageCount !== undefined && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Globe className="h-4 w-4" />
                        <span>하위 페이지: {jobSummary.subPageCount}개</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* 도메인 통계 */}
      {domainStats && (
        <Card className="bg-blue-50 dark:bg-blue-950/20">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Globe className="h-5 w-5" />
              도메인 분포 통계 (maxDepth {options.maxDepth})
            </CardTitle>
            <CardDescription>
              크롤링된 문서의 도메인별 분포를 확인합니다
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 전체 통계 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">전체 문서</div>
                <div className="text-2xl font-bold">{domainStats.totalDocuments}개</div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">기본 도메인</div>
                <div className="text-2xl font-bold text-green-600">{domainStats.sameDomainCount}개</div>
                <div className="text-xs text-muted-foreground">{domainStats.baseDomain}</div>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">하위 도메인</div>
                <div className="text-2xl font-bold text-blue-600">{domainStats.subdomainCount}개</div>
                {domainStats.subdomainCount > 0 && (
                  <div className="text-xs text-green-600">✅ 정상 (maxDepth 3)</div>
                )}
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">다른 도메인</div>
                <div className="text-2xl font-bold text-red-600">{domainStats.otherDomainCount}개</div>
                {domainStats.otherDomainCount > 0 && options.maxDepth < 4 && (
                  <div className="text-xs text-red-600">⚠️ 예상과 다름 (maxDepth 3)</div>
                )}
                {domainStats.otherDomainCount > 0 && options.maxDepth >= 4 && (
                  <div className="text-xs text-green-600">✅ 정상 (maxDepth 4)</div>
                )}
              </div>
            </div>

            {/* 도메인별 상세 목록 */}
            <div className="space-y-2">
              <div className="text-sm font-semibold">도메인별 문서 수 ({domainStats.domainCount}개 도메인)</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {domainStats.domainList.map((item) => (
                  <div
                    key={item.domain}
                    className="flex items-center justify-between p-2 rounded-md bg-background border text-sm"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {item.isBaseDomain && (
                        <Badge variant="default" className="text-xs">기본</Badge>
                      )}
                      {item.isSubdomain && (
                        <Badge variant="secondary" className="text-xs">하위</Badge>
                      )}
                      {item.isOtherDomain && (
                        <Badge variant="destructive" className="text-xs">외부</Badge>
                      )}
                      <span className="font-mono text-xs truncate">{item.domain}</span>
                    </div>
                    <span className="font-semibold ml-2">{item.count}개</span>
                  </div>
                ))}
              </div>
            </div>

            {/* maxDepth별 검증 메시지 */}
            <div className="p-3 rounded-md bg-muted space-y-1">
              {options.maxDepth === 3 && (
                <>
                  <div className="text-sm font-semibold">maxDepth 3 검증:</div>
                  <div className="text-xs space-y-1">
                    {domainStats.subdomainCount > 0 ? (
                      <div className="text-green-600">✅ 하위 도메인 포함됨 (정상)</div>
                    ) : (
                      <div className="text-yellow-600">⚠️ 하위 도메인 없음</div>
                    )}
                    {domainStats.otherDomainCount === 0 ? (
                      <div className="text-green-600">✅ 다른 도메인 제외됨 (정상)</div>
                    ) : (
                      <div className="text-red-600">❌ 다른 도메인 포함됨 (비정상)</div>
                    )}
                  </div>
                </>
              )}
              {options.maxDepth === 4 && (
                <>
                  <div className="text-sm font-semibold">maxDepth 4 검증:</div>
                  <div className="text-xs space-y-1">
                    {domainStats.otherDomainCount > 0 ? (
                      <div className="text-green-600">✅ 다른 도메인 포함됨 (정상)</div>
                    ) : (
                      <div className="text-yellow-600">⚠️ 다른 도메인 없음 (외부 링크가 없을 수 있음)</div>
                    )}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 문서 목록 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <List className="h-5 w-5" />
                인덱싱된 문서 목록
              </CardTitle>
              <CardDescription>
                크롤링 및 인덱싱이 완료된 문서가 자동으로 표시됩니다 (3초마다 자동 새로고침)
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const targetUrl = new URL(url);
                    const domain = targetUrl.hostname;
                    
                    // 크롤링 작업 상태 확인
                    const statusResponse = await fetch('/api/admin/check-crawl-status', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ domain, jobId: jobId || undefined }),
                    });
                    
                    const statusData = await statusResponse.json();
                    
                    if (statusData.success) {
                      const { latestJob, summary, domainStats, jobs } = statusData.data;
                      console.log('🔍 [크롤링 상태 확인]:', statusData.data);
                      
                      // 상세 정보를 콘솔에 출력
                      if (jobs && jobs.length > 0) {
                        console.log('📋 [작업 상세 정보]:', jobs.map((j: any) => ({
                          jobId: j.jobId,
                          status: j.status,
                          startedAt: j.startedAt,
                          finishedAt: j.finishedAt,
                          subPagesCount: j.result?.subPagesCount || 0,
                          totalChunks: j.result?.totalChunks || 0,
                          documentsCount: j.documents?.length || 0
                        })));
                      }
                      
                      let message = '';
                      if (latestJob) {
                        message = `작업 상태: ${latestJob.status}`;
                        if (latestJob.isCompleted) {
                          const finishedAt = latestJob.finishedAt ? new Date(latestJob.finishedAt).toLocaleString('ko-KR') : '';
                          message += ` ✅ 완료`;
                          if (finishedAt) message += ` (${finishedAt})`;
                          const result = latestJob.result as any;
                          if (result?.subPagesCount) message += `\n하위 페이지: ${result.subPagesCount}개`;
                          if (result?.totalChunks) message += `\n총 청크: ${result.totalChunks}개`;
                        } else if (latestJob.isProcessing) {
                          message += ` ⏳ 처리 중...`;
                        } else if (latestJob.isFailed) {
                          message += ` ❌ 실패`;
                        }
                      }
                      
                      if (summary) {
                        message += `\n\n작업 통계: 완료 ${summary.completed}개, 처리중 ${summary.processing}개, 실패 ${summary.failed}개`;
                      }
                      
                      if (domainStats) {
                        message += `\n\n도메인 문서 (${domain}):`;
                        message += `\n- 총 ${domainStats.total}개`;
                        message += `\n- 인덱싱됨: ${domainStats.indexed}개 ✅`;
                        message += `\n- 처리중: ${domainStats.processing}개 ⏳`;
                        message += `\n- 실패: ${domainStats.failed}개 ❌`;
                        message += `\n- 대기중: ${domainStats.pending}개`;
                        if (domainStats.totalChunks > 0) {
                          message += `\n- 총 청크: ${domainStats.totalChunks}개`;
                        }
                      }
                      
                      toast.info(message, { duration: 10000 });
                    } else {
                      toast.error(`상태 확인 실패: ${statusData.error || '알 수 없는 오류'}`);
                    }
                    
                    // 문서 삭제 확인도 함께 수행
                    const response = await fetch('/api/admin/verify-document-deletion', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ domain }),
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                      console.log('🔍 [백엔드 데이터 확인]:', data.data);
                    }
                  } catch (error) {
                    console.error('백엔드 데이터 확인 오류:', error);
                    toast.error('백엔드 데이터 확인 중 오류가 발생했습니다.');
                  }
                }}
              >
                <Database className="h-4 w-4 mr-2" />
                크롤링 상태 확인
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchDocuments()}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                새로고침
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {documentsData?.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : recentDocuments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                아직 인덱싱된 문서가 없습니다.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                크롤링을 시작하면 완료된 문서가 여기에 표시됩니다.
              </p>
              {/* 디버깅 정보 */}
              {documentsData?.data?.documents && documentsData.data.documents.length > 0 && (
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md text-left max-w-md">
                  <p className="text-xs font-semibold text-blue-800 dark:text-blue-200 mb-2">
                    📊 크롤링 테스트 정보:
                  </p>
                  <div className="space-y-1 text-xs text-blue-700 dark:text-blue-300">
                    <p>전체 문서: {documentsData.data.documents.length}개</p>
                    <p>표시된 문서: {recentDocuments.length}개</p>
                    <p>대상 도메인: {url ? new URL(url).hostname : 'N/A'}</p>
                    <p>maxDepth: {options.maxDepth}</p>
                    <p className="mt-2 font-semibold">첫 번째 문서 정보:</p>
                    <p className="pl-2">- URL: {documentsData.data.documents[0]?.url || 'N/A (URL 없음)'}</p>
                    <p className="pl-2">- 제목: {documentsData.data.documents[0]?.title?.substring(0, 40) || 'N/A'}</p>
                    <p className="pl-2">- 상태: {documentsData.data.documents[0]?.status || 'N/A'}</p>
                    <p className="pl-2">- 청크 수: {documentsData.data.documents[0]?.chunk_count || 0}개</p>
                    {documentsData.data.documents[0]?.url && (
                      <p className="pl-2">- 도메인: {(() => {
                        try {
                          return new URL(documentsData.data.documents[0].url).hostname;
                        } catch {
                          return '파싱 실패';
                        }
                      })()}</p>
                    )}
                  </div>
                  <div className="mt-3 p-2 bg-blue-100 dark:bg-blue-900/30 rounded text-xs">
                    <p className="font-semibold text-blue-800 dark:text-blue-200 mb-1">
                      ℹ️ 크롤링 테스트 모드:
                    </p>
                    <p className="text-blue-700 dark:text-blue-300">
                      maxDepth와 상관없이 크롤된 모든 문서를 표시합니다.
                    </p>
                    <p className="text-blue-700 dark:text-blue-300 mt-1">
                      크롤링이 정상적으로 수행되었는지 확인할 수 있습니다.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                총 {recentDocuments.length}개 문서 (최근 인덱싱된 문서)
              </div>
              <div className="space-y-2">
                {recentDocuments.slice(0, 20).map((doc: Document) => (
                  <Card key={doc.id} className="border-l-4 border-l-green-500">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <h3 className="font-semibold">{doc.title}</h3>
                          </div>
                          {doc.url && (
                            <p className="text-sm text-muted-foreground break-all">
                              {doc.url}
                            </p>
                          )}
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              청크: {doc.chunk_count}개
                            </span>
                            <span className="flex items-center gap-1">
                              <Database className="h-3 w-3" />
                              상태: {doc.status}
                            </span>
                            {doc.source_vendor && (
                              <Badge variant="outline">{doc.source_vendor}</Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge variant={doc.status === 'indexed' ? 'default' : 'secondary'}>
                            {doc.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(doc.created_at).toLocaleString('ko-KR')}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {recentDocuments.length > 20 && (
                <div className="text-center text-sm text-muted-foreground">
                  ... 외 {recentDocuments.length - 20}개 문서
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 프로세스 플로우 설명 */}
      <Card className="bg-blue-50 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            프로세스 플로우
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <strong>크롤링 시작</strong> - URL을 큐에 추가하고 크롤링 시작
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <strong>콘텐츠 추출</strong> - 웹페이지에서 텍스트 및 메타데이터 추출
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <strong>청킹</strong> - 텍스트를 의미 있는 청크로 분할
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold">
                4
              </div>
              <div>
                <strong>임베딩 생성</strong> - 각 청크에 대한 벡터 임베딩 생성
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center font-bold">
                5
              </div>
              <div>
                <strong>인덱싱 완료</strong> - 벡터 데이터베이스에 저장 및 문서 목록 업데이트
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

