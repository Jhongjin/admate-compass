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

  // 작업 상태 조회
  const { data: jobStatus, refetch: refetchJob } = useQuery({
    queryKey: ['job-status', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      // Supabase에서 직접 작업 상태 조회
      const { data, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();
      
      if (error) throw new Error(`Failed to fetch job status: ${error.message}`);
      return data as JobStatus | null;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      // 작업이 완료되면 폴링 중지
      const data = query.state.data;
      if (data?.status === 'completed' || data?.status === 'failed') {
        return false;
      }
      return 2000; // 2초마다 폴링
    },
  });

  // 작업 상태에 따른 진행 상황 업데이트
  useEffect(() => {
    if (!jobStatus) return;

    const status = jobStatus.status;
    const result = jobStatus.result || {};

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
  }, [jobStatus, refetchDocuments]);

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

      if (data.success && data.jobId) {
        setJobId(data.jobId);
        toast.success('크롤링 작업이 큐에 추가되었습니다.');
      } else {
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
    setCurrentStep('');
    setProgress(0);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // 최근 인덱싱된 문서 필터링 (현재 작업과 관련된 문서)
  const recentDocuments = documentsData?.data?.documents?.filter((doc: Document) => {
    if (!jobId) return false;
    // URL이 일치하는 문서 찾기
    return doc.url && doc.url.includes(new URL(url).hostname);
  }) || [];

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

          {/* 시작 버튼 */}
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

