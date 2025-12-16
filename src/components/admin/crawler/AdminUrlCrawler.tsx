'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, CheckCircle, XCircle, Globe, Save, RefreshCw, ExternalLink, Link, AlertTriangle } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion, AnimatePresence } from 'framer-motion';

// --- Interfaces ---

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

// --- Utils ---

const normalizeUrl = (url: string) => {
  try {
    return url.replace(/\/$/, "").trim();
  } catch (e) {
    return url;
  }
};

const VENDOR_OPTIONS = [
  { id: 'META', name: 'Meta' },
  { id: 'NAVER', name: 'Naver' },
  { id: 'KAKAO', name: 'Kakao' },
  { id: 'GOOGLE', name: 'Google' },
  { id: 'OTHER', name: 'Other' },
];


export function AdminUrlCrawler({ onSuccess, defaultVendor }: AdminUrlCrawlerProps) {
  // --- State ---
  const [urls, setUrls] = useState<string>('');
  const [isCrawling, setIsCrawling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [results, setResults] = useState<CrawlResult[]>([]);
  const [environment, setEnvironment] = useState<'local' | 'vercel' | 'unknown'>('unknown');
  const [selectedVendor, setSelectedVendor] = useState<string>(
    defaultVendor && defaultVendor.length > 0 ? defaultVendor[0].toUpperCase() : 'META'
  );

  useEffect(() => {
    if (defaultVendor && defaultVendor.length > 0) {
      const vendor = defaultVendor[0].toUpperCase();
      // Only update if it's a valid vendor or map accordingly
      const validVendor = VENDOR_OPTIONS.find(v => v.id === vendor) ? vendor : 'META';
      setSelectedVendor(validVendor);
    }
  }, [defaultVendor]);
  const [isDragActive, setIsDragActive] = useState(false);

  // Sub-page selection state
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

  const [existingDbMap, setExistingDbMap] = useState<Map<string, string>>(new Map());
  const [statusMessage, setStatusMessage] = useState<string>("크롤링 중...");


  // --- Effects ---

  const fetchExistingUrls = async () => {
    try {
      const response = await fetch('/api/admin/documents/list?type=url', {
        cache: 'no-store',
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache'
        }
      });
      if (response.ok) {
        const data = await response.json();
        const map = new Map<string, string>();
        if (data.documents && Array.isArray(data.documents)) {
          data.documents.forEach((doc: any) => {
            if (doc.url) {
              const normalized = normalizeUrl(doc.url);
              map.set(normalized, doc.url);
            }
          });
        }
        setExistingDbMap(map);
      }
    } catch (error) {
      console.error('Failed to fetch existing URLs:', error);
    }
  };

  useEffect(() => {
    fetchExistingUrls();
    const isVercel = window.location.hostname.includes('vercel.app') || window.location.hostname.includes('vercel.com');
    setEnvironment(isVercel ? 'vercel' : 'local');
  }, []);


  // --- Handlers ---

  const performCrawl = async (urlList: string[], isSubPageCrawl = false) => {
    if (urlList.length === 0) return;

    await fetchExistingUrls();

    setIsCrawling(true);
    setStatusMessage("크롤링 준비 중...");

    if (!isSubPageCrawl) {
      setResults([]);
    }

    try {
      const response = await fetch('/api/crawler-v2/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urlList,
          options: {
            ...options,
            discoverSubPages: isSubPageCrawl ? false : options.discoverSubPages,
          },
        }),
      });

      if (!response.body) throw new Error('ReadableStream not supported');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim() === '') continue;
            try {
              const event = JSON.parse(line);
              if (event.type === 'log') {
                setStatusMessage(event.message);
              } else if (event.type === 'batch_progress') {
                if (event.result) setResults(prev => [...prev, event.result]);
              } else if (event.type === 'done') {
                toast.success(`크롤링 완료: 성공 ${event.summary.success}개`);

                // Discovery Logic
                if (options.discoverSubPages && !isSubPageCrawl && event.results) {
                  const newResults = event.results as CrawlResult[];
                  const allDiscovered: Array<{ url: string; source: string; title?: string; parentUrl?: string }> = [];
                  const existingUrls = new Set([...urlList, ...results.map(r => r.url), ...newResults.map(r => r.url)]);

                  newResults.forEach(result => {
                    if (result.discoveredUrls) {
                      result.discoveredUrls.forEach(d => {
                        if (!existingUrls.has(d.url)) {
                          allDiscovered.push({ url: d.url, source: result.url, title: d.title, parentUrl: result.url });
                          existingUrls.add(d.url);
                        }
                      });
                    }
                  });

                  if (allDiscovered.length > 0) {
                    setDiscoveredUrls(allDiscovered);
                    setSelectedDiscoveredUrls(new Set(allDiscovered.map(d => d.url)));
                    setIsSelectionDialogOpen(true);
                  }
                }
                await fetchExistingUrls();
              } else if (event.type === 'error') {
                toast.error(event.error || '크롤링 중 오류 발생');
              }
            } catch (e) { }
          }
        }
        if (done) break;
      }

    } catch (error) {
      console.error('크롤링 오류:', error);
      toast.error('크롤링 중 오류가 발생했습니다.');
    } finally {
      setIsCrawling(false);
      setStatusMessage("크롤링 중...");
    }
  };

  const handleCrawl = async () => {
    const urlList = urls.split('\n').map(url => url.trim()).filter(url => url.length > 0);
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
    await performCrawl(urlsToCrawl, true);
  };

  const handleSaveToDb = async () => {
    const successfulResults = results.filter(r => r.status === 'success');
    if (successfulResults.length === 0) {
      toast.error('저장할 성공적인 크롤링 결과가 없습니다.');
      return;
    }

    setIsSaving(true);
    await fetchExistingUrls();

    try {
      // Use selected vendor instead of defaultVendor prop
      const vendor = selectedVendor;

      const resultsWithVendor = successfulResults.map(r => {
        const discoveryInfo = discoveredUrls.find(d => normalizeUrl(d.url) === normalizeUrl(r.url));
        let parentUrl = discoveryInfo?.parentUrl || null;

        if (parentUrl) {
          const normalizedParent = normalizeUrl(parentUrl);
          const dbParentUrl = existingDbMap.get(normalizedParent);
          if (dbParentUrl) parentUrl = dbParentUrl;
        } else {
          const currentNormalized = normalizeUrl(r.url);
          let bestParent = null;
          let maxLen = 0;
          for (const [dbNormalized, dbRealUrl] of Array.from(existingDbMap.entries())) {
            if (currentNormalized.startsWith(dbNormalized + '/')) {
              if (dbNormalized.length > maxLen) {
                maxLen = dbNormalized.length;
                bestParent = dbRealUrl;
              }
            }
          }
          if (bestParent) parentUrl = bestParent;
        }

        return {
          ...r,
          vendor,
          metadata: {
            source: 'admin-crawler',
            parentUrl: parentUrl,
            parent_title: parentUrl ? (results.find(res => res.url === parentUrl)?.title || existingDbMap.get(normalizeUrl(parentUrl))) : null,
            is_sub_page: !!parentUrl,
            discovered_at: new Date().toISOString()
          }
        };
      });

      const response = await fetch('/api/admin/save-crawled-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results: resultsWithVendor }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(data.message);
        if (onSuccess) onSuccess();
        setResults([]);
        await fetchExistingUrls();
        setDiscoveredUrls([]);
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

  const toggleSelect = (url: string) => {
    const newSelected = new Set(selectedDiscoveredUrls);
    if (newSelected.has(url)) newSelected.delete(url);
    else newSelected.add(url);
    setSelectedDiscoveredUrls(newSelected);
  };


  return (
    <div className="space-y-8 animate-in fade-in duration-500">

      {/* 1. Input Section (Hero Style) */}
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg blur opacity-20 group-hover:opacity-30 transition duration-1000"></div>
        <div className="relative bg-[#131823] border border-gray-800 rounded-lg p-6 md:p-8">

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Globe className="w-6 h-6 text-blue-400" />
                URL 크롤링
              </h2>
              <p className="text-gray-400 text-sm mt-1">
                웹페이지를 크롤링하여 지식 베이스에 추가합니다.
              </p>
            </div>

            {/* Vendor Selection */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">벤더 선택:</span>
              <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                <SelectTrigger className="w-[140px] bg-black/40 border-white/10 text-white h-9">
                  <SelectValue placeholder="벤더 선택" />
                </SelectTrigger>
                <SelectContent className="bg-[#1e232f] border-gray-700 text-white">
                  {VENDOR_OPTIONS.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id} className="focus:bg-white/10 focus:text-white">
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            className={`
               border-2 border-dashed rounded-xl p-8 transition-all duration-300
               flex flex-col items-center justify-center text-center
               ${isDragActive ? 'border-blue-500 bg-blue-500/5' : 'border-gray-700 hover:border-gray-500 bg-black/20'}
             `}
            onDragEnter={() => setIsDragActive(true)}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragActive(false); }}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full flex items-center justify-center mb-6 shadow-inner shadow-white/5">
              <Link className="w-8 h-8 text-blue-400" />
            </div>

            <div className="w-full max-w-2xl space-y-4">
              <Label htmlFor="urls" className="sr-only">URL 입력</Label>
              <Textarea
                id="urls"
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                placeholder="https://example.com&#10;https://example.org"
                rows={3}
                className="min-h-[100px] text-center bg-transparent border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-lg resize-none placeholder:text-gray-600"
              />
              <p className="text-xs text-gray-500">
                여러 URL을 입력하려면 줄바꿈으로 구분하세요.
              </p>
            </div>

            {/* Options Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 w-full max-w-3xl">
              <div className="flex flex-col gap-2 p-3 rounded-lg bg-white/5 border border-white/5">
                <Label className="text-xs text-gray-400">하위 페이지 발견</Label>
                <div className="flex items-center gap-2 mt-auto">
                  <Checkbox
                    id="discoverSubPages"
                    checked={options.discoverSubPages}
                    onCheckedChange={(c) => setOptions({ ...options, discoverSubPages: !!c })}
                    className="border-gray-500 data-[state=checked]:bg-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-300">사용</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 p-3 rounded-lg bg-white/5 border border-white/5">
                <Label className="text-xs text-gray-400">최대 깊이</Label>
                <Input
                  type="number"
                  min={1} max={5}
                  value={options.maxDepth}
                  onChange={(e) => setOptions({ ...options, maxDepth: parseInt(e.target.value) || 1 })}
                  className="h-7 bg-transparent border-gray-600 text-white text-sm"
                />
              </div>

              <div className="flex flex-col gap-2 p-3 rounded-lg bg-white/5 border border-white/5">
                <Label className="text-xs text-gray-400">최대 페이지 수</Label>
                <Input
                  type="number"
                  min={1} max={300}
                  value={options.maxUrls}
                  onChange={(e) => setOptions({ ...options, maxUrls: parseInt(e.target.value) || 50 })}
                  className="h-7 bg-transparent border-gray-600 text-white text-sm"
                />
              </div>

              <div className="flex flex-col gap-2 p-3 rounded-lg bg-white/5 border border-white/5">
                <Label className="text-xs text-gray-400">타임아웃 (ms)</Label>
                <Input
                  type="number"
                  min={1000} value={options.timeout}
                  onChange={(e) => setOptions({ ...options, timeout: parseInt(e.target.value) || 30000 })}
                  className="h-7 bg-transparent border-gray-600 text-white text-sm"
                />
              </div>
            </div>

            <div className="mt-8 w-full max-w-sm">
              <Button
                onClick={handleCrawl}
                disabled={isCrawling || !urls.trim()}
                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 shadow-lg shadow-blue-900/20"
              >
                {isCrawling ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {statusMessage}
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-5 w-5 fill-white" />
                    크롤링 시작
                  </>
                )}
              </Button>
              {environment === 'local' && (
                <p className="text-[10px] text-yellow-600 mt-2 text-center flex items-center justify-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> 로컬 환경 감지됨
                </p>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* 2. Results Section (Table Style) */}
      <AnimatePresence>
        {results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            <Card className="bg-[#131823] border-gray-800 overflow-hidden">
              <CardHeader className="border-b border-gray-800 bg-gray-900/50 pb-4">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      크롤링 결과 확인
                    </CardTitle>
                    <CardDescription className="text-gray-400 mt-1">
                      총 <span className="text-white font-medium">{results.length}</span>개 페이지 발견
                      (<span className="text-green-400">{results.filter(r => r.status === 'success').length} 성공</span>)
                    </CardDescription>
                  </div>

                  <div className="flex items-center gap-3">
                    {discoveredUrls.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsSelectionDialogOpen(true)}
                        className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                      >
                        하위 페이지 발견 ({discoveredUrls.length})
                      </Button>
                    )}

                    <Button
                      onClick={handleSaveToDb}
                      disabled={isSaving || isCrawling || results.every(r => r.status !== 'success')}
                      className="bg-green-600 hover:bg-green-700 text-white min-w-[140px]"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          저장 중...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          DB에 저장하기
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#1a202e] text-gray-400 font-medium border-b border-gray-800">
                      <tr>
                        <th className="px-6 py-3 w-[50px]">No.</th>
                        <th className="px-6 py-3 w-[80px]">상태</th>
                        <th className="px-6 py-3">페이지 제목 / URL</th>
                        <th className="px-6 py-3 w-[120px]">타입</th>
                        <th className="px-6 py-3 w-[120px] text-right">크기</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {results.map((result, idx) => (
                        <tr key={idx} className="hover:bg-white/5 transition-colors group">
                          <td className="px-6 py-4 text-gray-600 font-mono text-xs">{idx + 1}</td>
                          <td className="px-6 py-4">
                            {result.status === 'success' ? (
                              <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20">성공</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20">실패</Badge>
                            )}
                          </td>
                          <td className="px-6 py-4 max-w-lg">
                            <div className="flex flex-col">
                              <span className="text-white font-medium truncate pr-4" title={result.title}>{result.title || '(No Title)'}</span>
                              <a
                                href={result.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-blue-400 hover:underline hover:text-blue-300 flex items-center gap-1 mt-0.5"
                              >
                                {result.url}
                                <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </a>
                              {result.error && <p className="text-xs text-red-400 mt-1">Error: {result.error}</p>}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-1 rounded bg-gray-800 text-gray-300 text-xs border border-gray-700 capitalize">
                              {result.type}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right text-gray-400 font-mono text-xs">
                            {result.contentLength > 0 ? (result.contentLength / 1024).toFixed(1) + ' KB' : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Sub-page Selection Dialog (Preserved functionality) */}
      <Dialog open={isSelectionDialogOpen} onOpenChange={setIsSelectionDialogOpen}>
        <DialogContent
          className="max-w-3xl bg-[#1e232f] border-gray-700 text-white shadow-2xl"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="border-b border-gray-800 pb-4">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Globe className="w-5 h-5 text-blue-400" />
              추가 하위 페이지 발견됨
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              {discoveredUrls.length}개의 관련 페이지를 추가로 발견했습니다. 크롤링할 페이지를 선택하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <span className="text-blue-400 font-bold">{selectedDiscoveredUrls.size}</span>
                <span className="text-gray-500 text-sm ml-1">개 선택됨</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedDiscoveredUrls.size === discoveredUrls.length) setSelectedDiscoveredUrls(new Set());
                    else setSelectedDiscoveredUrls(new Set(discoveredUrls.map(d => d.url)));
                  }}
                  className="text-xs h-8"
                >
                  {selectedDiscoveredUrls.size === discoveredUrls.length ? "전체 해제" : "전체 선택"}
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[400px] bg-black/20 rounded-md border border-gray-800 p-2">
              <div className="space-y-1">
                {discoveredUrls.map((item, i) => {
                  const isAlreadyCrawled = results.some(r => normalizeUrl(r.url) === normalizeUrl(item.url)) || existingDbMap.has(normalizeUrl(item.url));
                  return (
                    <div key={i}
                      className={`
                             flex items-start gap-3 p-3 rounded-lg transition-colors border
                             ${isAlreadyCrawled ? 'bg-green-500/5 border-green-500/20 opacity-70' : 'border-transparent hover:bg-white/5 hover:border-white/10'}
                           `}
                    >
                      <Checkbox
                        id={`url-${i}`}
                        checked={selectedDiscoveredUrls.has(item.url)}
                        onCheckedChange={() => toggleSelect(item.url)}
                        disabled={isAlreadyCrawled}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <label htmlFor={`url-${i}`} className="cursor-pointer block">
                          <div className="text-sm font-medium text-gray-200 truncate flex items-center gap-2">
                            {item.title || '제목 없음'}
                            {isAlreadyCrawled && <Badge variant="outline" className="text-[10px] h-4 text-green-500 border-green-900 bg-green-500/10">수집됨</Badge>}
                          </div>
                          <div className="text-xs text-blue-400/70 truncate mt-0.5 font-mono">{item.url}</div>
                        </label>
                      </div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-gray-500 hover:text-gray-300">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter className="border-t border-gray-800 pt-4">
            <Button variant="ghost" onClick={() => setIsSelectionDialogOpen(false)} className="text-gray-400">
              닫기
            </Button>
            <Button
              onClick={handleCrawlSelectedSubPages}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              선택한 {selectedDiscoveredUrls.size}개 페이지 크롤링
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
