'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, Play, CheckCircle, XCircle, Globe } from 'lucide-react';
import { toast } from 'sonner';

interface CrawlResult {
  url: string;
  title: string;
  content: string;
  contentLength: number;
  type: 'policy' | 'help' | 'guide' | 'general';
  lastUpdated: string;
  status: 'success' | 'failed' | 'partial';
  error?: string;
  discoveredUrls?: Array<{
    url: string;
    title?: string;
    source: string;
    depth: number;
  }>;
}

interface CrawlProgress {
  progress: number;
  completedUrls: number;
  totalUrls: number;
  currentUrl?: string;
  message?: string;
}

export default function CrawlerV2TestPage() {
  const [urls, setUrls] = useState<string>('https://example.com');
  const [isCrawling, setIsCrawling] = useState(false);
  const [results, setResults] = useState<CrawlResult[]>([]);
  const [progressInfo, setProgressInfo] = useState<CrawlProgress | null>(null);
  const [environment, setEnvironment] = useState<'local' | 'vercel' | 'unknown'>('unknown');
  const [options, setOptions] = useState({
    discoverSubPages: false,
    maxDepth: 2,
    maxUrls: 50,
    respectRobots: true,
    domainLimit: true,
    timeout: 30000,
    waitTime: 1000,
  });

  // 환경 감지
  React.useEffect(() => {
    const isVercel = window.location.hostname.includes('vercel.app') || 
                     window.location.hostname.includes('vercel.com');
    setEnvironment(isVercel ? 'vercel' : 'local');
  }, []);

  const handleCrawl = async () => {
    const urlList = urls
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    if (urlList.length === 0) {
      toast.error('URL을 입력해주세요.');
      return;
    }

    setIsCrawling(true);
    setResults([]);
    setProgressInfo({ progress: 0, completedUrls: 0, totalUrls: urlList.length });

    try {
      const response = await fetch('/api/crawler-v2/crawl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urls: urlList,
          options,
        }),
      });

      if (!response.body) {
        throw new Error('응답 스트림이 없습니다.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const collectedResults: CrawlResult[] = [];

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
              setProgressInfo({
                progress: data.progress || 0,
                completedUrls: data.completedUrls || 0,
                totalUrls: data.totalUrls || urlList.length,
                currentUrl: data.currentUrl,
                message: data.message,
              });
            } else if (data.type === 'batch_progress' && data.result) {
              collectedResults.push(data.result);
              setResults([...collectedResults]);
            } else if (data.type === 'done') {
              if (data.results) {
                setResults(data.results);
              }
              toast.success(`크롤링 완료: 성공 ${data.summary?.success || 0}개, 실패 ${data.summary?.failed || 0}개`);
            } else if (data.type === 'error') {
              toast.error(data.error || '크롤링 실패');
            }
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }
    } catch (error) {
      console.error('크롤링 오류:', error);
      toast.error('크롤링 중 오류가 발생했습니다.');
    } finally {
      setIsCrawling(false);
      setProgressInfo(null);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            크롤러 V2 테스트
          </CardTitle>
          <CardDescription>
            개선된 크롤링 시스템 테스트 페이지
          </CardDescription>
          {environment === 'local' && (
            <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-sm text-yellow-800">
                <strong>⚠️ 로컬 환경 감지</strong>
              </p>
              <p className="text-xs text-yellow-700 mt-1">
                로컬 환경에서는 Chrome 설정이 필요할 수 있습니다. 실제 프로덕션 테스트는 Vercel에 배포 후 진행하는 것을 권장합니다.
              </p>
            </div>
          )}
          {environment === 'vercel' && (
            <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">
                <strong>✅ Vercel 환경 감지</strong>
              </p>
              <p className="text-xs text-green-700 mt-1">
                Vercel 환경에서는 자동으로 Chromium이 제공됩니다. 크롤링을 바로 테스트할 수 있습니다.
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="urls">크롤링할 URL (한 줄에 하나씩)</Label>
            <Textarea
              id="urls"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://example.com&#10;https://example.org"
              rows={5}
              className="font-mono text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="discoverSubPages">하위 페이지 발견</Label>
              <input
                type="checkbox"
                id="discoverSubPages"
                checked={options.discoverSubPages}
                onChange={(e) => setOptions({ ...options, discoverSubPages: e.target.checked })}
                className="ml-2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxDepth">최대 깊이</Label>
              <Input
                id="maxDepth"
                type="number"
                min="1"
                max="4"
                value={options.maxDepth}
                onChange={(e) => setOptions({ ...options, maxDepth: parseInt(e.target.value) || 2 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxUrls">최대 URL 수</Label>
              <Input
                id="maxUrls"
                type="number"
                min="1"
                max="200"
                value={options.maxUrls}
                onChange={(e) => setOptions({ ...options, maxUrls: parseInt(e.target.value) || 50 })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeout">타임아웃 (ms)</Label>
              <Input
                id="timeout"
                type="number"
                min="5000"
                max="60000"
                value={options.timeout}
                onChange={(e) => setOptions({ ...options, timeout: parseInt(e.target.value) || 30000 })}
              />
            </div>
          </div>

          {progressInfo && (
            <div className="space-y-2 p-4 bg-muted rounded-md">
              <div className="flex justify-between text-sm">
                <span>진행률: {progressInfo.progress.toFixed(1)}%</span>
                <span>{progressInfo.completedUrls}/{progressInfo.totalUrls}</span>
              </div>
              <Progress value={progressInfo.progress} className="h-2" />
              {progressInfo.currentUrl && (
                <p className="text-xs text-muted-foreground truncate">
                  처리 중: {progressInfo.currentUrl}
                </p>
              )}
            </div>
          )}

          <Button
            onClick={handleCrawl}
            disabled={isCrawling}
            className="w-full"
          >
            {isCrawling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                크롤링 중...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                크롤링 시작
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>크롤링 결과</CardTitle>
            <CardDescription>
              총 {results.length}개 중 성공 {results.filter(r => r.status === 'success').length}개
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {results.map((result, index) => (
              <Card key={index} className="border-l-4 border-l-blue-500">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        {result.status === 'success' ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )}
                        {result.title}
                      </CardTitle>
                      <CardDescription className="mt-1 break-all">
                        {result.url}
                      </CardDescription>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Badge variant={result.status === 'success' ? 'default' : 'destructive'}>
                        {result.status}
                      </Badge>
                      <Badge variant="outline">{result.type}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">
                      콘텐츠 길이: {result.contentLength.toLocaleString()}자
                    </div>
                    {result.content && (
                      <div className="text-sm bg-muted p-3 rounded-md max-h-40 overflow-y-auto">
                        {result.content.substring(0, 500)}
                        {result.content.length > 500 && '...'}
                      </div>
                    )}
                    {result.error && (
                      <div className="text-sm text-red-500 bg-red-50 p-3 rounded-md">
                        {result.error}
                      </div>
                    )}
                    {result.discoveredUrls && result.discoveredUrls.length > 0 && (
                      <div className="text-sm">
                        <div className="font-semibold mb-2">
                          발견된 하위 페이지: {result.discoveredUrls.length}개
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {result.discoveredUrls.slice(0, 10).map((url, i) => (
                            <div key={i} className="text-xs text-muted-foreground break-all">
                              • {url.url} (depth: {url.depth}, source: {url.source})
                            </div>
                          ))}
                          {result.discoveredUrls.length > 10 && (
                            <div className="text-xs text-muted-foreground">
                              ... 외 {result.discoveredUrls.length - 10}개
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

