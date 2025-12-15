'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, CheckCircle, XCircle, Globe, Save, RefreshCw } from 'lucide-react';
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

interface AdminUrlCrawlerProps {
  onSuccess?: () => void;
  defaultVendor?: string[];
}

export function AdminUrlCrawler({ onSuccess, defaultVendor }: AdminUrlCrawlerProps) {
  const [urls, setUrls] = useState<string>('https://example.com');
  const [isCrawling, setIsCrawling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [results, setResults] = useState<CrawlResult[]>([]);
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

      const data = await response.json();

      if (data.success) {
        setResults(data.data.results);
        toast.success(`크롤링 완료: 성공 ${data.data.summary.success}개, 실패 ${data.data.summary.failed}개`);
      } else {
        toast.error(data.error || '크롤링 실패');
      }
    } catch (error) {
      console.error('크롤링 오류:', error);
      toast.error('크롤링 중 오류가 발생했습니다.');
    } finally {
      setIsCrawling(false);
    }
  };

  const handleSaveToDb = async () => {
    const successfulResults = results.filter(r => r.status === 'success');
    
    if (successfulResults.length === 0) {
      toast.error('저장할 성공적인 크롤링 결과가 없습니다.');
      return;
    }

    setIsSaving(true);

    try {
        // 현재 선택된 벤더가 있으면 첫 번째 벤더를 사용, 없으면 META
        const vendor = defaultVendor && defaultVendor.length > 0 ? defaultVendor[0] : 'META';
        
        // 결과에 벤더 정보 추가
        const resultsWithVendor = successfulResults.map(r => ({
            ...r,
            vendor
        }));

      const response = await fetch('/api/admin/save-crawled-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          results: resultsWithVendor,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(data.message);
        if (onSuccess) onSuccess();
      } else {
        toast.error(data.error || '저장 실패');
      }
    } catch (error) {
      console.error('저장 오류:', error);
      toast.error('저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-[#131823] border-white/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Globe className="h-5 w-5 text-blue-400" />
            URL 크롤러 (V2)
          </CardTitle>
          <CardDescription className="text-gray-400">
            Railway 기반의 개선된 크롤링 시스템을 사용하여 웹페이지를 수집합니다.
          </CardDescription>
          {environment === 'local' && (
            <div className="mt-2 p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-md">
              <p className="text-sm text-yellow-500">
                <strong>⚠️ 로컬 환경 감지</strong>
              </p>
              <p className="text-xs text-yellow-600/80 mt-1">
                로컬 환경에서는 Chrome 설정이 필요할 수 있습니다.
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="urls" className="text-gray-300">크롤링할 URL (한 줄에 하나씩)</Label>
            <Textarea
              id="urls"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://example.com&#10;https://example.org"
              rows={5}
              className="font-mono text-sm bg-black/20 border-white/10 text-gray-200 focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    id="discoverSubPages"
                    checked={options.discoverSubPages}
                    onChange={(e) => setOptions({ ...options, discoverSubPages: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-600 bg-black/20 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                />
                <Label htmlFor="discoverSubPages" className="text-gray-300 cursor-pointer">하위 페이지 발견</Label>
              </div>
            </div>
            {/* 다른 옵션들도 필요하면 추가 */}
          </div>
          
          <div className="grid grid-cols-3 gap-4">
             <div className="space-y-2">
              <Label htmlFor="maxDepth" className="text-gray-300">최대 깊이</Label>
              <Input
                id="maxDepth"
                type="number"
                min="1"
                max="4"
                value={options.maxDepth}
                onChange={(e) => setOptions({ ...options, maxDepth: parseInt(e.target.value) || 2 })}
                className="bg-black/20 border-white/10 text-gray-200"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxUrls" className="text-gray-300">최대 URL 수</Label>
              <Input
                id="maxUrls"
                type="number"
                min="1"
                max="200"
                value={options.maxUrls}
                onChange={(e) => setOptions({ ...options, maxUrls: parseInt(e.target.value) || 50 })}
                className="bg-black/20 border-white/10 text-gray-200"
              />
            </div>
             <div className="space-y-2">
              <Label htmlFor="timeout" className="text-gray-300">타임아웃 (ms)</Label>
              <Input
                id="timeout"
                type="number"
                min="5000"
                max="60000"
                value={options.timeout}
                onChange={(e) => setOptions({ ...options, timeout: parseInt(e.target.value) || 30000 })}
                className="bg-black/20 border-white/10 text-gray-200"
              />
            </div>
          </div>

          <Button
            onClick={handleCrawl}
            disabled={isCrawling}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
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
        <Card className="bg-[#131823] border-white/5">
          <CardHeader>
            <div className="flex items-center justify-between">
                <div>
                    <CardTitle className="text-white">크롤링 결과</CardTitle>
                    <CardDescription className="text-gray-400">
                    총 {results.length}개 중 성공 {results.filter(r => r.status === 'success').length}개
                    </CardDescription>
                </div>
                {results.some(r => r.status === 'success') && (
                    <Button 
                        onClick={handleSaveToDb} 
                        disabled={isSaving}
                        className="bg-green-600 hover:bg-green-700 text-white"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                저장 중...
                            </>
                        ) : (
                            <>
                                <Save className="mr-2 h-4 w-4" />
                                결과값 DB 저장
                            </>
                        )}
                    </Button>
                )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {results.map((result, index) => (
              <Card key={index} className="border-l-4 border-l-blue-500 bg-black/20 border-y-0 border-r-0">
                <CardHeader className="pb-3 px-4 pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2 text-gray-200">
                        {result.status === 'success' ? (
                          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                        )}
                        <span className="truncate">{result.title}</span>
                      </CardTitle>
                      <CardDescription className="mt-1 break-all text-xs text-blue-400">
                        {result.url}
                      </CardDescription>
                    </div>
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <Badge variant={result.status === 'success' ? 'default' : 'destructive'} className="justify-center">
                        {result.status}
                      </Badge>
                      <Badge variant="outline" className="border-white/10 text-gray-400 justify-center">{result.type}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500">
                      콘텐츠 길이: {result.contentLength.toLocaleString()}자
                    </div>
                    {/* 내용 미리보기는 너무 길 수 있으므로 생략하거나 필요한 경우 추가 */}
                    {result.error && (
                      <div className="text-xs text-red-400 bg-red-900/10 p-2 rounded-md border border-red-900/20">
                        {result.error}
                      </div>
                    )}
                    {result.discoveredUrls && result.discoveredUrls.length > 0 && (
                      <div className="text-xs text-gray-400">
                        <div className="font-semibold mb-1">
                          발견된 하위 페이지: {result.discoveredUrls.length}개
                        </div>
                        <div className="pl-2 border-l border-white/10">
                           {result.discoveredUrls.slice(0, 5).map((u, i) => (
                               <div key={i} className="truncate">• {u.url}</div>
                           ))}
                           {result.discoveredUrls.length > 5 && <div>... 외 {result.discoveredUrls.length - 5}개</div>}
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
