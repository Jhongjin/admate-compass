'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, CheckCircle, XCircle, Globe, Save, RefreshCw, ExternalLink, Link, AlertTriangle, Pencil, Check, X, CheckCircle2, Trash2 } from 'lucide-react';
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
import { normalizeUrl as normalizeUrlUtil } from '@/lib/crawler-v2/utils/url-utils';

// --- Interfaces ---

interface CrawlResult {
  url: string;
  title: string;
  content: string;
  contentLength: number;
  type: 'policy' | 'help' | 'guide' | 'general';
  lastUpdated: string;
  status: 'success' | 'failed' | 'partial' | 'processing';
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
  onVendorChange?: (vendors: string[]) => void;
}

// --- Utils ---

const normalizeUrl = (url: string) => {
  try {
    // crawler-v2의 normalizeUrl 사용 (프래그먼트 제거, 슬래시 정리 등)
    return normalizeUrlUtil(url);
  } catch (e) {
    // fallback: 기본 정규화
    try {
      return url.replace(/\/$/, "").trim().toLowerCase();
    } catch {
      return url;
    }
  }
};

// 문서 관리 페이지와 동일한 벤더 목록
const ALL_VENDORS = ["Meta", "Naver", "Kakao", "Google", "X(Twitter)"] as const;

// UI 벤더 이름을 DB ENUM 값으로 변환하는 매핑 (문서 관리 페이지와 동일)
const VENDOR_TO_DB_MAP: Record<string, string> = {
  "Meta": "META",
  "Naver": "NAVER",
  "Kakao": "KAKAO",
  "Google": "GOOGLE",
  "X(Twitter)": "OTHER",
};

// DB ENUM 값을 UI 벤더 이름으로 변환하는 역매핑
const DB_TO_VENDOR_MAP: Record<string, string> = {
  "META": "Meta",
  "NAVER": "Naver",
  "KAKAO": "Kakao",
  "GOOGLE": "Google",
  "OTHER": "X(Twitter)",
};

// 에러 메시지를 사용자 친화적인 한글로 변환
const translateError = (error: string): string => {
  const errorLower = error.toLowerCase();
  
  if (errorLower.includes('navigating frame was detached') || errorLower.includes('frame was detached')) {
    return '페이지 로딩 중 연결이 끊어졌습니다';
  }
  if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
    return '요청 시간이 초과되었습니다';
  }
  if (errorLower.includes('network') || errorLower.includes('failed to fetch')) {
    return '네트워크 연결 오류가 발생했습니다';
  }
  if (errorLower.includes('navigation') || errorLower.includes('navigation timeout')) {
    return '페이지 이동 중 시간이 초과되었습니다';
  }
  if (errorLower.includes('target closed') || errorLower.includes('browser closed')) {
    return '브라우저가 닫혔습니다';
  }
  if (errorLower.includes('protocol error') || errorLower.includes('session closed')) {
    return '브라우저 세션이 종료되었습니다';
  }
  if (errorLower.includes('net::err') || errorLower.includes('dns')) {
    return '인터넷 연결 문제가 발생했습니다';
  }
  if (errorLower.includes('403') || errorLower.includes('forbidden')) {
    return '접근이 거부되었습니다 (403)';
  }
  if (errorLower.includes('404') || errorLower.includes('not found')) {
    return '페이지를 찾을 수 없습니다 (404)';
  }
  if (errorLower.includes('500') || errorLower.includes('internal server error')) {
    return '서버 오류가 발생했습니다 (500)';
  }
  
  // 기본값: 원본 에러 메시지 반환 (한글이거나 짧은 경우)
  return error.length > 50 ? '크롤링 중 오류가 발생했습니다' : error;
};

export function AdminUrlCrawler({ onSuccess, defaultVendor, onVendorChange }: AdminUrlCrawlerProps) {
  // --- State ---
  const [urls, setUrls] = useState<string>('');
  const [isCrawling, setIsCrawling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [results, setResults] = useState<CrawlResult[]>([]);
  const [environment, setEnvironment] = useState<'local' | 'vercel' | 'unknown'>('unknown');
  
  // 벤더를 배열로 관리 (문서 관리 페이지와 동일한 패턴)
  const [selectedVendors, setSelectedVendors] = useState<string[]>(() => {
    if (defaultVendor && defaultVendor.length > 0) {
      // UI 벤더 이름으로 변환
      return defaultVendor.map(v => {
        // 이미 UI 벤더 이름인 경우
        if (ALL_VENDORS.includes(v as any)) {
          return v;
        }
        // DB ENUM 값인 경우 UI 이름으로 변환
        if (DB_TO_VENDOR_MAP[v]) {
          return DB_TO_VENDOR_MAP[v];
        }
        // 대문자로 변환해서 매핑 시도
        const upperV = v.toUpperCase();
        if (DB_TO_VENDOR_MAP[upperV]) {
          return DB_TO_VENDOR_MAP[upperV];
        }
        return v;
      });
    }
    return [];
  });

  // vendorSelectValue 계산 (문서 관리 페이지와 동일)
  const vendorSelectValue = selectedVendors.length === 0 
    ? "all" 
    : selectedVendors.length === 1 
      ? selectedVendors[0] 
      : "multiple";

  // 벤더 선택 변경 핸들러 (문서 관리 페이지와 동일)
  const handleVendorSelectChange = (value: string) => {
    if (value === "multiple") return;
    
    let newVendors: string[] = [];
    if (value === "all") {
      newVendors = [];
    } else {
      newVendors = [value];
    }
    
    setSelectedVendors(newVendors);
    
    // 상위 컴포넌트에 변경 사항 전달
    if (onVendorChange) {
      onVendorChange(newVendors);
    }
  };

  // defaultVendor 변경 시 동기화
  useEffect(() => {
    if (defaultVendor) {
      const newVendors = defaultVendor.map(v => {
        if (ALL_VENDORS.includes(v as any)) {
          return v;
        }
        if (DB_TO_VENDOR_MAP[v]) {
          return DB_TO_VENDOR_MAP[v];
        }
        const upperV = v.toUpperCase();
        if (DB_TO_VENDOR_MAP[upperV]) {
          return DB_TO_VENDOR_MAP[upperV];
        }
        return v;
      });
      
      // 배열이 실제로 다를 때만 업데이트
      const currentStr = selectedVendors.sort().join(',');
      const newStr = newVendors.sort().join(',');
      if (currentStr !== newStr) {
        setSelectedVendors(newVendors);
      }
    }
  }, [defaultVendor?.join(',')]);
  const [isDragActive, setIsDragActive] = useState(false);

  // Sub-page selection state
  const [discoveredUrls, setDiscoveredUrls] = useState<Array<{ url: string; source: string; title?: string; parentUrl?: string }>>([]);
  const [selectedDiscoveredUrls, setSelectedDiscoveredUrls] = useState<Set<string>>(new Set());
  const [isSelectionDialogOpen, setIsSelectionDialogOpen] = useState(false);
  const [editingTitleIndex, setEditingTitleIndex] = useState<number | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState<string>('');
  const [seedUrl, setSeedUrl] = useState<string | null>(null); // 원본 시드 URL 저장

  const [options, setOptions] = useState({
    discoverSubPages: false,
    maxDepth: 4 as number | 'MAX', // ads.naver.com 같은 사이트는 깊이 4로 크롤링
    maxUrls: 100, // 더 많은 URL 추출
    respectRobots: true,
    domainLimit: true,
    timeout: 30000,
    waitTime: 1000,
  });

  const [existingDbMap, setExistingDbMap] = useState<Map<string, string>>(new Map());
  const [dialogDbMap, setDialogDbMap] = useState<Map<string, string>>(new Map()); // 다이얼로그 전용 DB Map
  const [statusMessage, setStatusMessage] = useState<string>("크롤링 중...");


  // --- Effects ---

  const fetchExistingUrls = async (): Promise<Map<string, string>> => {
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
          console.log(`[fetchExistingUrls] DB에서 ${data.documents.length}개의 URL 문서를 가져옴`);
          data.documents.forEach((doc: any) => {
            if (doc.url) {
              const normalized = normalizeUrl(doc.url);
              map.set(normalized, doc.url);
              // 디버깅: 처음 5개만 로그
              if (map.size <= 5) {
                console.log(`[fetchExistingUrls] URL 매핑: "${doc.url}" -> "${normalized}"`);
              }
            }
          });
          if (data.documents.length > 5) {
            console.log(`[fetchExistingUrls] ... 외 ${data.documents.length - 5}개 URL 매핑됨`);
          }
        }
        console.log(`[fetchExistingUrls] 총 ${map.size}개의 정규화된 URL이 existingDbMap에 저장됨`);
        setExistingDbMap(map);
        return map;
      } else {
        console.error('[fetchExistingUrls] API 응답 오류:', response.status, response.statusText);
        return new Map();
      }
    } catch (error) {
      console.error('[fetchExistingUrls] Failed to fetch existing URLs:', error);
      return new Map();
    }
  };

  useEffect(() => {
    fetchExistingUrls();
    const isVercel = window.location.hostname.includes('vercel.app') || window.location.hostname.includes('vercel.com');
    setEnvironment(isVercel ? 'vercel' : 'local');
  }, []);

  // 다이얼로그가 열릴 때 DB 동기화
  useEffect(() => {
    if (isSelectionDialogOpen) {
      console.log('[useEffect] 다이얼로그 열림 감지, DB 동기화 시작');
      fetchExistingUrls().then(dbMap => {
        console.log('[useEffect] DB 동기화 완료, dialogDbMap 업데이트');
        setDialogDbMap(new Map(dbMap));
      });
    } else {
      // 다이얼로그가 닫힐 때 dialogDbMap 초기화
      setDialogDbMap(new Map());
    }
  }, [isSelectionDialogOpen]);


  // --- Handlers ---

  const performCrawl = async (urlList: string[], isSubPageCrawl = false, parentSeedUrl: string | null = null) => {
    if (urlList.length === 0) return;

    await fetchExistingUrls();

    setIsCrawling(true);
    setStatusMessage("크롤링 준비 중...");

    if (!isSubPageCrawl) {
      setResults([]);
      // 원본 시드 URL 저장 (첫 번째 URL을 시드로 사용)
      setSeedUrl(urlList[0] || null);
    } else if (parentSeedUrl) {
      // 하위 페이지 크롤링 시 원본 시드 URL 유지
      setSeedUrl(parentSeedUrl);
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
                if (event.result) {
                  // discoveredUrls에서 제목 찾아서 덮어쓰기
                  const discoveryInfo = discoveredUrls.find(d => normalizeUrl(d.url) === normalizeUrl(event.result.url));
                  const resultWithTitle = {
                    ...event.result,
                    title: discoveryInfo?.title || event.result.title // discoveredUrls의 제목 우선 사용
                  };
                  setResults(prev => [...prev, resultWithTitle]);
                }
              } else if (event.type === 'done') {
                toast.success(`크롤링 완료: 성공 ${event.summary.success}개`);

                // Discovery Logic
                if (options.discoverSubPages && !isSubPageCrawl && event.results) {
                  const newResults = event.results as CrawlResult[];
                  console.log(`[Discovery Logic] ====== 하위 페이지 발견 로직 시작 ======`);
                  console.log(`[Discovery Logic] options.discoverSubPages: ${options.discoverSubPages}`);
                  console.log(`[Discovery Logic] isSubPageCrawl: ${isSubPageCrawl}`);
                  console.log(`[Discovery Logic] event.results 길이: ${newResults.length}`);
                  
                  // 각 result의 discoveredUrls 확인
                  newResults.forEach((result, idx) => {
                    console.log(`[Discovery Logic] Result[${idx}]: url=${result.url}, discoveredUrls=${result.discoveredUrls ? result.discoveredUrls.length : 0}개`);
                    if (result.discoveredUrls && result.discoveredUrls.length > 0) {
                      console.log(`[Discovery Logic] Result[${idx}]의 discoveredUrls:`, result.discoveredUrls.slice(0, 3).map(d => d.url));
                    }
                  });
                  
                  const allDiscovered: Array<{ url: string; source: string; title?: string; parentUrl?: string }> = [];
                  // 정규화된 URL로 비교하기 위해 Set 생성 (같은 크롤링 세션 내 중복 제거용)
                  const existingUrlsNormalized = new Set<string>();
                  
                  // 원본 시드 URL 찾기 (urlList의 첫 번째 URL 또는 results에서 시드 URL 찾기)
                  const seedUrlForDiscovery = urlList[0] || seedUrl || null;
                  
                  // 같은 크롤링 세션 내에서만 중복 제거 (DB URL은 필터링하지 않음)
                  [...urlList, ...results.map(r => r.url), ...newResults.map(r => r.url)].forEach(url => {
                    existingUrlsNormalized.add(normalizeUrl(url));
                  });
                  
                  // DB에 있는 URL은 필터링하지 않음 - 사용자가 선택할 수 있도록 모두 표시

                  console.log(`[Discovery Logic] 기존 URL Set 크기: ${existingUrlsNormalized.size}, 시드 URL: ${seedUrlForDiscovery}`);

                  newResults.forEach(result => {
                    if (result.discoveredUrls && result.discoveredUrls.length > 0) {
                      console.log(`[Discovery Logic] 처리 중인 result: ${result.url}, discoveredUrls: ${result.discoveredUrls.length}개`);
                      result.discoveredUrls.forEach(d => {
                        const normalizedDiscoveredUrl = normalizeUrl(d.url);
                        // DB에 이미 있는 URL도 일단 추출 (사용자가 선택할 수 있도록)
                        // 원본 시드 URL을 부모로 설정 (시드 URL이 현재 result.url과 같으면 시드 URL 사용)
                        const parentUrlForDiscovered = (seedUrlForDiscovery && normalizeUrl(result.url) === normalizeUrl(seedUrlForDiscovery)) 
                          ? seedUrlForDiscovery 
                          : result.url;
                        
                        // 중복 체크 (같은 크롤링 세션 내에서만)
                        if (!existingUrlsNormalized.has(normalizedDiscoveredUrl)) {
                          allDiscovered.push({ 
                            url: d.url, 
                            source: result.url, 
                            title: d.title, 
                            parentUrl: parentUrlForDiscovered 
                          });
                          existingUrlsNormalized.add(normalizedDiscoveredUrl);
                          console.log(`[Discovery Logic] 하위 페이지 발견: "${d.url}" -> 부모: "${parentUrlForDiscovered}"`);
                        } else {
                          console.log(`[Discovery Logic] 중복 URL 스킵 (같은 세션 내): "${d.url}" (정규화: "${normalizedDiscoveredUrl}")`);
                        }
                      });
                    } else {
                      console.log(`[Discovery Logic] result에 discoveredUrls가 없음: ${result.url}`);
                    }
                  });

                  console.log(`[Discovery Logic] 총 발견된 하위 페이지: ${allDiscovered.length}개`);
                  if (allDiscovered.length > 0) {
                    console.log(`[Discovery Logic] ${allDiscovered.length}개의 새로운 하위 페이지 발견 - 팝업 표시`);
                    console.log(`[Discovery Logic] 발견된 URL 샘플 (처음 5개):`, allDiscovered.slice(0, 5).map(d => d.url));
                    
                    // 팝업 표시 전에 DB에서 최신 URL 목록 가져오기
                    console.log(`[Discovery Logic] 팝업 표시 전 DB 동기화 시작`);
                    const dbMap = await fetchExistingUrls();
                    console.log(`[Discovery Logic] DB 동기화 완료, DB URL 개수: ${dbMap.size}`);
                    
                    // DB에 있는 URL 확인 로그
                    allDiscovered.slice(0, 5).forEach((item, idx) => {
                      const normalized = normalizeUrl(item.url);
                      const isInDb = dbMap.has(normalized);
                      console.log(`[Discovery Logic] [${idx + 1}] "${item.url}" -> DB에 있음: ${isInDb}`);
                    });
                    
                    setDiscoveredUrls(allDiscovered);
                    setSelectedDiscoveredUrls(new Set(allDiscovered.map(d => d.url)));
                    setIsSelectionDialogOpen(true);
                  } else {
                    console.log(`[Discovery Logic] 발견된 하위 페이지가 없어 팝업을 표시하지 않음`);
                    console.log(`[Discovery Logic] 디버깅 정보:`);
                    console.log(`[Discovery Logic] - newResults.length: ${newResults.length}`);
                    console.log(`[Discovery Logic] - existingUrlsNormalized.size: ${existingUrlsNormalized.size}`);
                    newResults.forEach((result, idx) => {
                      if (result.discoveredUrls && result.discoveredUrls.length > 0) {
                        console.log(`[Discovery Logic] - Result[${idx}]: ${result.url}, discoveredUrls: ${result.discoveredUrls.length}개`);
                        result.discoveredUrls.forEach((d, dIdx) => {
                          const normalized = normalizeUrl(d.url);
                          const exists = existingUrlsNormalized.has(normalized);
                          console.log(`[Discovery Logic]   - [${dIdx}] ${d.url} (정규화: ${normalized}, 기존: ${exists})`);
                        });
                      }
                    });
                  }
                } else {
                  console.log(`[Discovery Logic] 조건 불만족 - discoverSubPages: ${options.discoverSubPages}, isSubPageCrawl: ${isSubPageCrawl}, event.results: ${!!event.results}`);
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
    // 원본 시드 URL 전달 (seedUrl이 있으면 사용, 없으면 discoveredUrls의 첫 번째 parentUrl 사용)
    const parentSeedUrl = seedUrl || discoveredUrls[0]?.parentUrl || null;
    console.log(`[handleCrawlSelectedSubPages] 하위 페이지 크롤링 시작, 부모 시드 URL: ${parentSeedUrl}`);
    await performCrawl(urlsToCrawl, true, parentSeedUrl);
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
      // 선택된 벤더가 없으면 기본값 사용
      const vendor = selectedVendors.length > 0 
        ? VENDOR_TO_DB_MAP[selectedVendors[0]] || 'META'
        : 'META';

      const resultsWithVendor = successfulResults.map(r => {
        const discoveryInfo = discoveredUrls.find(d => normalizeUrl(d.url) === normalizeUrl(r.url));
        let parentUrl = discoveryInfo?.parentUrl || null;
        const normalizedCurrentUrl = normalizeUrl(r.url);
        const normalizedSeedUrl = seedUrl ? normalizeUrl(seedUrl) : null;

        // 시드 URL 자체는 부모를 가지지 않음
        if (normalizedSeedUrl && normalizedCurrentUrl === normalizedSeedUrl) {
          parentUrl = null;
          console.log(`[handleSaveToDb] 시드 URL 자체 "${r.url}"는 부모를 가지지 않음`);
        }
        // 하위 페이지인 경우 원본 시드 URL을 우선적으로 부모로 사용
        else if (seedUrl && normalizedCurrentUrl !== normalizedSeedUrl && (discoveryInfo || results.some(res => normalizeUrl(res.url) === normalizedSeedUrl))) {
          // 원본 시드 URL이 results에 있으면 그것을 부모로 사용
          const seedResult = results.find(res => normalizeUrl(res.url) === normalizedSeedUrl);
          if (seedResult) {
            parentUrl = seedUrl;
            console.log(`[handleSaveToDb] 하위 페이지 "${r.url}"의 부모를 시드 URL "${seedUrl}"로 설정`);
          } else {
            // 시드 URL이 results에 없으면 DB에서 확인
            if (normalizedSeedUrl) {
              const dbSeedUrl = existingDbMap.get(normalizedSeedUrl);
              if (dbSeedUrl) {
                parentUrl = dbSeedUrl;
                console.log(`[handleSaveToDb] 하위 페이지 "${r.url}"의 부모를 DB의 시드 URL "${dbSeedUrl}"로 설정`);
              } else {
                // DB에도 없으면 discoveryInfo의 parentUrl 사용
                if (discoveryInfo?.parentUrl) {
                  const normalizedParent = normalizeUrl(discoveryInfo.parentUrl);
                  const dbParentUrl = existingDbMap.get(normalizedParent);
                  if (dbParentUrl) {
                    parentUrl = dbParentUrl;
                    console.log(`[handleSaveToDb] 하위 페이지 "${r.url}"의 부모를 discoveryInfo의 parentUrl "${dbParentUrl}"로 설정`);
                  }
                }
              }
            }
          }
        } else if (parentUrl) {
          // discoveryInfo의 parentUrl이 있으면 DB에서 확인
          const normalizedParent = normalizeUrl(parentUrl);
          const dbParentUrl = existingDbMap.get(normalizedParent);
          if (dbParentUrl) parentUrl = dbParentUrl;
        } else {
          // 자동 그룹화: 현재 URL이 다른 URL의 하위 경로인지 확인 (시드 URL 제외)
          const currentNormalized = normalizeUrl(r.url);
          let bestParent = null;
          let maxLen = 0;
          for (const [dbNormalized, dbRealUrl] of Array.from(existingDbMap.entries())) {
            // 시드 URL은 부모로 사용하지 않음
            if (normalizedSeedUrl && dbNormalized === normalizedSeedUrl) continue;
            if (currentNormalized.startsWith(dbNormalized + '/')) {
              if (dbNormalized.length > maxLen) {
                maxLen = dbNormalized.length;
                bestParent = dbRealUrl;
              }
            }
          }
          if (bestParent) {
            parentUrl = bestParent;
            console.log(`[handleSaveToDb] 자동 그룹화: "${r.url}"의 부모를 "${bestParent}"로 설정`);
          }
        }

        // 팝업에서 추출된 제목을 우선 사용 (discoveryInfo.title)
        // 없으면 크롤링 결과의 제목 사용
        const finalTitle = discoveryInfo?.title || r.title;
        
        return {
          ...r,
          title: finalTitle, // 팝업에서 추출된 제목으로 덮어쓰기
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
        // 성공한 결과만 제거하고 실패한 결과는 남겨두기
        setResults(prev => prev.filter(r => r.status !== 'success'));
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

  // 실패한 URL 재인덱싱 (다시 크롤링) - 단일 URL만 처리
  const handleRetryFailedUrl = async (url: string) => {
    console.log(`[handleRetryFailedUrl] 실패한 URL 재시도: ${url}`);
    
    // 해당 URL의 결과를 로딩 상태로 변경
    setResults(prev => prev.map(r => 
      r.url === url ? { ...r, status: 'processing' as const } : r
    ));

    try {
      const response = await fetch('/api/crawler-v2/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [url],
          options: {
            ...options,
            discoverSubPages: false, // 재시도 시 하위 페이지 발견 비활성화
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
                if (event.result) {
                  // discoveredUrls에서 제목 찾아서 덮어쓰기
                  const discoveryInfo = discoveredUrls.find(d => normalizeUrl(d.url) === normalizeUrl(event.result.url));
                  const resultWithTitle = {
                    ...event.result,
                    title: discoveryInfo?.title || event.result.title
                  };
                  // 해당 URL의 결과만 업데이트
                  setResults(prev => prev.map(r => 
                    r.url === url ? resultWithTitle : r
                  ));
                }
              } else if (event.type === 'done') {
                if (event.results && event.results.length > 0) {
                  const newResult = event.results[0] as CrawlResult;
                  const discoveryInfo = discoveredUrls.find(d => normalizeUrl(d.url) === normalizeUrl(newResult.url));
                  const resultWithTitle = {
                    ...newResult,
                    title: discoveryInfo?.title || newResult.title
                  };
                  // 해당 URL의 결과만 업데이트
                  setResults(prev => prev.map(r => 
                    r.url === url ? resultWithTitle : r
                  ));
                }
                toast.success(`재시도 완료: ${url}`);
              } else if (event.type === 'error') {
                // 에러 발생 시 실패 상태로 업데이트
                setResults(prev => prev.map(r => 
                  r.url === url ? { ...r, status: 'failed' as const, error: event.error || '크롤링 실패' } : r
                ));
                toast.error(event.error || '재시도 중 오류 발생');
              }
            } catch (e) { }
          }
        }
        if (done) break;
      }
    } catch (error) {
      console.error('재시도 오류:', error);
      // 에러 발생 시 실패 상태로 업데이트
      setResults(prev => prev.map(r => 
        r.url === url ? { ...r, status: 'failed' as const, error: error instanceof Error ? error.message : '크롤링 실패' } : r
      ));
      toast.error('재시도 중 오류가 발생했습니다.');
    }
  };

  // 실패한 결과 전체 삭제
  const handleDeleteAllFailed = () => {
    const failedCount = results.filter(r => r.status !== 'success').length;
    if (failedCount === 0) {
      toast.warning('삭제할 실패한 결과가 없습니다.');
      return;
    }
    
    if (confirm(`실패한 크롤링 결과 ${failedCount}개를 모두 삭제하시겠습니까?`)) {
      setResults(prev => prev.filter(r => r.status === 'success'));
      toast.success('실패한 결과가 삭제되었습니다.');
    }
  };

  const toggleSelect = (url: string) => {
    const newSelected = new Set(selectedDiscoveredUrls);
    if (newSelected.has(url)) newSelected.delete(url);
    else newSelected.add(url);
    setSelectedDiscoveredUrls(newSelected);
  };

  const handleStartEditTitle = (index: number, currentTitle: string) => {
    setEditingTitleIndex(index);
    setEditingTitleValue(currentTitle || '');
  };

  const handleSaveTitle = (index: number) => {
    if (editingTitleIndex === index) {
      const updated = [...discoveredUrls];
      updated[index] = { ...updated[index], title: editingTitleValue.trim() || undefined };
      setDiscoveredUrls(updated);
      setEditingTitleIndex(null);
      setEditingTitleValue('');
    }
  };

  const handleCancelEditTitle = () => {
    setEditingTitleIndex(null);
    setEditingTitleValue('');
  };

  const handleSelectAllExcludingCollected = () => {
    const newSelected = new Set<string>();
    discoveredUrls.forEach(item => {
      const normalizedItemUrl = normalizeUrl(item.url);
      // DB에 저장된 정보만 비교 (다이얼로그 전용 DB Map 사용, 없으면 existingDbMap 사용)
      const isInDb = dialogDbMap.size > 0 
        ? dialogDbMap.has(normalizedItemUrl)
        : existingDbMap.has(normalizedItemUrl);
      if (!isInDb) {
        newSelected.add(item.url);
      }
    });
    setSelectedDiscoveredUrls(newSelected);
  };

  const handleDialogOpenChange = async (open: boolean) => {
    setIsSelectionDialogOpen(open);
    if (open) {
      console.log('[handleDialogOpenChange] 다이얼로그 열림, DB 동기화 시작');
      // 다이얼로그가 열릴 때마다 최신 DB 데이터 가져오기
      const dbMap = await fetchExistingUrls();
      console.log(`[handleDialogOpenChange] DB 동기화 완료, DB URL 개수: ${dbMap.size}`);
      
      // 다이얼로그 전용 DB Map 업데이트 (즉시 반영)
      setDialogDbMap(new Map(dbMap));
      
      // 동기화 후 발견된 URL과 DB 비교 결과 로그
      if (discoveredUrls.length > 0) {
        console.log(`[handleDialogOpenChange] 발견된 URL ${discoveredUrls.length}개와 DB 비교 시작`);
        discoveredUrls.slice(0, 5).forEach((item, i) => {
          const normalized = normalizeUrl(item.url);
          const isInDb = dbMap.has(normalized);
          console.log(`[handleDialogOpenChange] [${i + 1}] "${item.url}" -> 정규화: "${normalized}" -> DB에 있음: ${isInDb}`);
        });
        if (discoveredUrls.length > 5) {
          console.log(`[handleDialogOpenChange] ... 외 ${discoveredUrls.length - 5}개 URL`);
        }
      }
    } else {
      // 다이얼로그가 닫힐 때 dialogDbMap 초기화
      setDialogDbMap(new Map());
    }
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

            {/* Vendor Selection - 문서 관리 페이지와 동일한 패턴 */}
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <span className="hidden sm:inline-block">벤더 선택:</span>
              <Select value={vendorSelectValue} onValueChange={handleVendorSelectChange}>
                <SelectTrigger className="w-[200px] bg-[#0B0F17] border-white/10 text-white h-9">
                  <div className="flex-1 text-left">
                    {vendorSelectValue === "all"
                      ? "전체 벤더"
                      : vendorSelectValue === "multiple"
                        ? `${selectedVendors.length}개 선택됨`
                        : vendorSelectValue}
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                  <SelectItem value="all">전체 벤더</SelectItem>
                  <SelectItem value="multiple" disabled>
                    {selectedVendors.length}개 선택됨
                  </SelectItem>
                  {ALL_VENDORS.map((vendor) => (
                    <SelectItem key={vendor} value={vendor}>
                      {vendor}
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

            <div className="w-full max-w-2xl mx-auto space-y-4">
              <Label htmlFor="urls" className="sr-only">URL 입력</Label>
              <Textarea
                id="urls"
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                placeholder="https://example.com&#10;https://example.org"
                rows={3}
                className="min-h-[100px] w-full text-center bg-transparent border-gray-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-lg resize-none placeholder:text-gray-600"
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
                <Select
                  value={String(options.maxDepth)}
                  onValueChange={(value) => {
                    if (value === 'MAX') {
                      setOptions({ ...options, maxDepth: 'MAX' });
                      return;
                    }
                    const parsed = Number.parseInt(value, 10);
                    setOptions({ ...options, maxDepth: Number.isFinite(parsed) ? parsed : 1 });
                  }}
                >
                  <SelectTrigger className="h-7 bg-transparent border-gray-600 text-white text-sm">
                    <SelectValue placeholder="깊이 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                    <SelectItem value="MAX">Max (재귀)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-gray-500 leading-tight">
                  Max + 하위 페이지 발견 사용 시: 발견된 하위 페이지를 실제로 열어 링크를 추가로 추출합니다.
                </p>
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

                    {results.some(r => r.status !== 'success') && (
                      <Button
                        onClick={handleDeleteAllFailed}
                        disabled={isSaving || isCrawling}
                        variant="outline"
                        className="border-red-500/30 text-red-400 hover:bg-red-500/10 min-w-[120px]"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        실패 항목 삭제
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
                        {results.some(r => r.status !== 'success') && (
                          <th className="px-6 py-3 w-[100px]">작업</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {results.map((result, idx) => (
                        <tr key={idx} className="hover:bg-white/5 transition-colors group">
                          <td className="px-6 py-4 text-gray-600 font-mono text-xs">{idx + 1}</td>
                          <td className="px-6 py-4">
                            {result.status === 'success' ? (
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/10 border border-green-500/20">
                                <CheckCircle2 className="w-4 h-4 text-green-400" />
                              </div>
                            ) : result.status === 'processing' ? (
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20">
                                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                              </div>
                            ) : (
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20">
                                <XCircle className="w-4 h-4 text-red-400" />
                              </div>
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
                              {result.error && (
                                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                  <span>{translateError(result.error)}</span>
                                </p>
                              )}
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
                          {results.some(r => r.status === 'failed') && (
                            <td className="px-6 py-4">
                              {result.status === 'failed' && (
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRetryFailedUrl(result.url)}
                                    disabled={isCrawling}
                                    className="h-7 px-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                    title="재시도"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                  </Button>
                                </div>
                              )}
                            </td>
                          )}
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
      <Dialog open={isSelectionDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="max-w-5xl w-[90vw] bg-[#1e232f] border-gray-700 text-white shadow-2xl"
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
                  onClick={handleSelectAllExcludingCollected}
                  className="text-xs h-8"
                >
                  수집 제외 전체 선택
                </Button>
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

            <ScrollArea className="h-[400px] bg-black/20 rounded-md border border-gray-800 p-3">
              <div className="space-y-2 pr-2">
                {discoveredUrls.map((item, i) => {
                  const normalizedItemUrl = normalizeUrl(item.url);
                  // DB에 저장된 정보만 비교 (다이얼로그 전용 DB Map 사용, 없으면 existingDbMap 사용)
                  const isInDb = dialogDbMap.size > 0 
                    ? dialogDbMap.has(normalizedItemUrl)
                    : existingDbMap.has(normalizedItemUrl);
                  const isAlreadyCrawled = isInDb;
                  
                  // 디버깅: 처음 5개만 상세 로그
                  if (i < 5) {
                    console.log(`[isAlreadyCrawled] URL[${i}]: "${item.url}"`, {
                      normalized: normalizedItemUrl,
                      isInDb,
                      isAlreadyCrawled,
                      dialogDbMapSize: dialogDbMap.size,
                      dialogDbMapHas: dialogDbMap.has(normalizedItemUrl),
                      existingDbMapSize: existingDbMap.size,
                      existingDbMapHas: existingDbMap.has(normalizedItemUrl)
                    });
                  }
                  
                  return (
                    <div key={i}
                      className={`
                             flex items-start gap-3 p-3 rounded-lg transition-colors border group
                             ${isAlreadyCrawled ? 'bg-green-500/5 border-green-500/20 opacity-70' : 'border-gray-700 hover:bg-white/5 hover:border-white/10'}
                           `}
                    >
                      <Checkbox
                        id={`url-${i}`}
                        checked={selectedDiscoveredUrls.has(item.url)}
                        onCheckedChange={() => toggleSelect(item.url)}
                        disabled={isAlreadyCrawled}
                        className="mt-1 flex-shrink-0 border-gray-600 data-[state=checked]:border-blue-500"
                      />
                      <div className="flex-1 min-w-0 pr-3">
                        <label htmlFor={`url-${i}`} className="cursor-pointer block">
                          <div className="text-sm font-medium text-gray-200 mb-1 flex items-center gap-2 flex-wrap">
                            {editingTitleIndex === i ? (
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <Input
                                  value={editingTitleValue}
                                  onChange={(e) => setEditingTitleValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleSaveTitle(i);
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      handleCancelEditTitle();
                                    }
                                  }}
                                  className="h-7 text-sm bg-gray-800 border-gray-600 text-white flex-1 min-w-0"
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-green-400 hover:text-green-300 hover:bg-green-500/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSaveTitle(i);
                                  }}
                                >
                                  <Check className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCancelEditTitle();
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <>
                                <span className="truncate max-w-full">{item.title || '제목 없음'}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-5 w-5 p-0 text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartEditTitle(i, item.title || '');
                                  }}
                                  title="제목 수정"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                {isAlreadyCrawled && (
                                  <Badge variant="outline" className="text-[10px] h-4 text-green-500 border-green-900 bg-green-500/10 flex-shrink-0">
                                    수집됨
                                  </Badge>
                                )}
                              </>
                            )}
                          </div>
                          <div className="text-xs text-blue-400/70 break-all mt-0.5 font-mono">
                            {item.url}
                          </div>
                        </label>
                      </div>
                      <a 
                        href={item.url} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="text-gray-500 hover:text-gray-300 flex-shrink-0 mt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
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
