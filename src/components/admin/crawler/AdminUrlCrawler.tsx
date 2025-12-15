'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, CheckCircle, XCircle, Globe, Save, RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

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

  // Sub-page selection state
  /* Updated state to include title and parentUrl */
  const [discoveredUrls, setDiscoveredUrls] = useState<Array<{ url: string; source: string; title?: string; parentUrl?: string }>>([]);
  const [selectedDiscoveredUrls, setSelectedDiscoveredUrls] = useState<Set<string>>(new Set());
  const [isSelectionDialogOpen, setIsSelectionDialogOpen] = useState(false);

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

  const performCrawl = async (urlList: string[], isSubPageCrawl = false) => {
    if (urlList.length === 0) return;

    setIsCrawling(true);
    if (!isSubPageCrawl) {
      setResults([]); // Clear results only for new main crawl
    }

    try {
      const response = await fetch('/api/crawler-v2/crawl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urls: urlList,
          options: {
            ...options,
            discoverSubPages: isSubPageCrawl ? false : options.discoverSubPages,
          },
        }),
      });

      const data = await response.json();

      if (data.success) {
        const newResults = data.data.results as CrawlResult[];

        if (isSubPageCrawl) {
          setResults(prev => [...prev, ...newResults]);
          toast.success(`추가 크롤링 완료: ${newResults.length}개`);
        } else {
          setResults(newResults);
          toast.success(`크롤링 완료: 성공 ${data.data.summary.success}개, 실패 ${data.data.summary.failed}개`);

          // Check for discovered sub-pages if option enabled
          if (options.discoverSubPages) {
            const allDiscovered: Array<{ url: string; source: string; title?: string; parentUrl?: string }> = [];
            const existingUrls = new Set([...urlList, ...newResults.map(r => r.url)]);

            newResults.forEach(result => {
              if (result.discoveredUrls && result.discoveredUrls.length > 0) {
                result.discoveredUrls.forEach(d => {
                  if (!existingUrls.has(d.url)) {
                    // source maps to d.source (method), and we add parentUrl which is the current result.url
                    allDiscovered.push({ url: d.url, source: result.url, title: d.title, parentUrl: result.url });
                    existingUrls.add(d.url); // Prevent duplicates
                  }
                });
              }
            });

            if (allDiscovered.length > 0) {
              setDiscoveredUrls(allDiscovered);
              // Select all by default
              setSelectedDiscoveredUrls(new Set(allDiscovered.map(d => d.url)));
              setIsSelectionDialogOpen(true);
            }
          }
        }
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

  const handleCrawl = async () => {
    const urlList = urls
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    if (urlList.length === 0) {
      toast.error('URL을 입력해주세요.');
      return;
    }

    await performCrawl(urlList);
  };

  const handleCrawlSelectedSubPages = async () => {
    const urlsToCrawl = Array.from(selectedDiscoveredUrls);
    setIsSelectionDialogOpen(false);

    if (urlsToCrawl.length === 0) return;

    // Disable discovery for sub-pages to prevent infinite loop (or use depth control)
    // For now, we just crawl the selected ones without further deep discovery popup
    // But we might want to keep options as is.
    // Let's keep options same but maybe we should not trigger popup again recursively for V1.
    // Or just let it trigger if user wants deep crawling. 
    // Current logic: performCrawl checks options.discoverSubPages. 
    // If we want to avoid recursive popups, we should temporarily disable it or pass a flag.
    // Let's passed modified options or just handle it. 
    // Actually, performCrawl logic for popup is inside `else` block of `isSubPageCrawl`.
    // So if `isSubPageCrawl` is true, popup won't trigger. Correct.

    await performCrawl(urlsToCrawl, true);
  };

  const handleSaveToDb = async () => {
    const successfulResults = results.filter(r => r.status === 'success');

    if (successfulResults.length === 0) {
      toast.error('저장할 성공적인 크롤링 결과가 없습니다.');
      return;
    }

    setIsSaving(true);

    try {
      const vendor = defaultVendor && defaultVendor.length > 0 ? defaultVendor[0] : 'META';

      const normalizeUrl = (url: string) => {
        try {
          return url.replace(/\/$/, "").trim();
        } catch (e) {
          return url;
        }
      };

      const resultsWithVendor = successfulResults.map(r => {
        // Find if this URL was discovered from another URL (is it a sub-page?)
        // We use discoveredUrls state to find the parent with normalization
        const discoveryInfo = discoveredUrls.find(d => normalizeUrl(d.url) === normalizeUrl(r.url));

        return {
          ...r,
          vendor,
          metadata: {
            source: 'admin-crawler',
            parentUrl: discoveryInfo?.parentUrl || null, // Use parentUrl from discoveryInfo
            parent_title: discoveryInfo?.parentUrl ? (results.find(res => res.url === discoveryInfo.parentUrl)?.title) : null,
            is_sub_page: !!discoveryInfo?.parentUrl,
            discovered_at: new Date().toISOString()
          }
        };
      });

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
        setResults([]); // Clear results after successful save
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

  const toggleSelectAll = () => {
    if (selectedDiscoveredUrls.size === discoveredUrls.length) {
      setSelectedDiscoveredUrls(new Set());
    } else {
      setSelectedDiscoveredUrls(new Set(discoveredUrls.map(d => d.url)));
    }
  };

  const toggleSelect = (url: string) => {
    const newSelected = new Set(selectedDiscoveredUrls);
    if (newSelected.has(url)) {
      newSelected.delete(url);
    } else {
      newSelected.add(url);
    }
    setSelectedDiscoveredUrls(newSelected);
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

      <Dialog open={isSelectionDialogOpen} onOpenChange={setIsSelectionDialogOpen}>
        <DialogContent className="max-w-2xl bg-[#1e232f] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>하위 페이지 발견 ({discoveredUrls.length}개)</DialogTitle>
            <DialogDescription className="text-gray-400">
              추가로 크롤링할 하위 페이지를 선택해주세요. 제목을 클릭하여 수정할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center justify-between mb-2 px-1 gap-2 flex-wrap">
              <Label className="text-sm text-gray-300">
                {selectedDiscoveredUrls.size}개 선택됨
              </Label>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // Select all except those already in results (crawled)
                    const existingUrls = new Set(results.map(r => r.url));
                    const newSelection = new Set(
                      discoveredUrls
                        .filter(d => !existingUrls.has(d.url))
                        .map(d => d.url)
                    );
                    setSelectedDiscoveredUrls(newSelection);
                  }}
                  className="text-xs text-blue-400 hover:text-blue-300 hover:bg-white/5"
                >
                  미수집 전체 선택
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedDiscoveredUrls.size === discoveredUrls.length) {
                      setSelectedDiscoveredUrls(new Set());
                    } else {
                      setSelectedDiscoveredUrls(new Set(discoveredUrls.map(d => d.url)));
                    }
                  }}
                  className="text-xs text-gray-400 hover:text-white hover:bg-white/5"
                >
                  {selectedDiscoveredUrls.size === discoveredUrls.length ? "전체 해제" : "전체 선택"}
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[300px] border border-white/10 rounded-md p-4">
              <div className="space-y-3">
                {discoveredUrls.map((item, index) => {
                  // Check if this URL is already in the main results
                  const isAlreadyCrawled = results.some(r => r.url === item.url);

                  return (
                    <div key={index} className={`flex items-start gap-3 p-2 rounded-md transition-colors ${isAlreadyCrawled ? 'bg-green-900/10 border border-green-900/20' : 'hover:bg-white/5'}`}>
                      <Checkbox
                        id={`url-${index}`}
                        checked={selectedDiscoveredUrls.has(item.url)}
                        onCheckedChange={() => toggleSelect(item.url)}
                        className="mt-2"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-blue-400 text-[10px] mt-1">●</span>
                          <Input
                            value={item.title || ''}
                            onChange={(e) => {
                              const newTitle = e.target.value;
                              setDiscoveredUrls(prev => prev.map((p, i) => i === index ? { ...p, title: newTitle } : p));
                            }}
                            className="h-7 text-sm font-semibold text-gray-200 bg-transparent border-transparent hover:border-white/10 focus:border-blue-500 focus:bg-black/20 p-1 px-2 w-full transition-all"
                            placeholder="제목을 입력하세요"
                          />
                        </div>
                        <div className="flex items-center gap-2 px-1">
                          <Label htmlFor={`url-${index}`} className="text-xs text-blue-300/80 cursor-pointer break-all block leading-tight hover:text-blue-300">
                            {item.url}
                          </Label>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                            title="새 탭에서 열기"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          {isAlreadyCrawled && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1 text-green-400 border-green-900/30 bg-green-900/10 ml-auto">
                              이미 수집됨
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSelectionDialogOpen(false)} className="border-white/10 text-gray-300 hover:bg-white/5">
              취소
            </Button>
            <Button onClick={handleCrawlSelectedSubPages} className="bg-blue-600 hover:bg-blue-700 text-white">
              선택한 페이지 크롤링 ({selectedDiscoveredUrls.size}개)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
