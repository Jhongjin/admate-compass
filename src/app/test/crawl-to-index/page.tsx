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
import { useQuery } from '@tanstack/react-query';
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

  // 문서 목록 조회 (3초마다 자동 새로고침)
  const { data: documentsData, refetch: refetchDocuments } = useQuery({
    queryKey: ['test-documents'],
    queryFn: async () => {
      const res = await fetch('/api/admin/upload-new?limit=100&status=indexed');
      if (!res.ok) throw new Error('Failed to fetch documents');
      return res.json();
    },
    refetchInterval: 3000, // 3초마다 자동 새로고침
  });

  const supabase = createClient();

  // 최근 인덱싱된 문서 필터링 (현재 작업과 관련된 문서)
  // jobId가 없어도 URL 기준으로 필터링 (작업 완료 후 jobId가 없을 수 있음)
  const recentDocuments = React.useMemo(() => {
    return documentsData?.data?.documents?.filter((doc: Document) => {
      try {
        if (!doc.url) return false;
        const docUrl = new URL(doc.url);
        const targetUrl = new URL(url);
        // 같은 도메인의 문서만 표시
        return docUrl.hostname === targetUrl.hostname || docUrl.hostname.endsWith(`.${targetUrl.hostname}`);
      } catch {
        return false;
      }
    }) || [];
  }, [documentsData?.data?.documents, url]);

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
          toast.success(`크롤링 및 인덱싱이 완료되었습니다! (${recentDocuments.length}개 문서)`);
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
        toast.success('크롤링 및 인덱싱이 완료되었습니다!');
        refetchDocuments();
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

      toast.info('도메인 문서 삭제 중...');
      
      const response = await fetch('/api/admin/delete-domain-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domain }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`${data.deleted.documents}개 문서가 삭제되었습니다.`);
        refetchDocuments(); // 문서 목록 새로고침
      } else {
        throw new Error(data.error || '문서 삭제 실패');
      }
    } catch (error) {
      console.error('도메인 문서 삭제 오류:', error);
      toast.error('도메인 문서 삭제 중 오류가 발생했습니다.');
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
        toast.success(`크롤링 및 인덱싱이 완료되었습니다! (${recentDocuments.length}개 문서)`);
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchDocuments()}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              새로고침
            </Button>
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

