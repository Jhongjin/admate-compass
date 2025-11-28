"use client";

import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Loader2,
  AlertCircle,
  Globe,
  CheckCircle2,
  X,
  ExternalLink,
  Pencil,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface DiscoveredUrlItem {
  url: string;
  title?: string;
  depth: number;
  parentUrl?: string;
  path: string[];
  source: string;
  isAlreadyCrawled?: boolean;
  existingDocumentId?: string;
}

interface UrlDiscoveryPanelProps {
  discoveredUrls: DiscoveredUrlItem[];
  selectedUrls: Set<string>;
  onSelectionChange: (url: string, selected: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  totalCount?: number;
  byDepth?: Record<number, number>;
  onUpdateTitle?: (url: string, title: string) => void;
}

export function UrlDiscoveryPanel({
  discoveredUrls,
  selectedUrls,
  onSelectionChange,
  onSelectAll,
  onDeselectAll,
  onConfirm,
  onCancel,
  isLoading = false,
  totalCount = 0,
  byDepth = {},
  onUpdateTitle,
}: UrlDiscoveryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDepth, setFilterDepth] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editedTitles, setEditedTitles] = useState<Record<string, string>>({});
  const [groupedByParent, setGroupedByParent] = useState<Record<string, DiscoveredUrlItem[]>>({});

  // 검색 및 필터링
  const filteredUrls = useMemo(() => {
    return discoveredUrls.filter((item) => {
      // Depth 필터
      if (filterDepth !== null && item.depth !== filterDepth) {
        return false;
      }
      // 검색 필터
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          item.url.toLowerCase().includes(query) ||
          item.title?.toLowerCase().includes(query) ||
          false
        );
      }
      return true;
    });
  }, [discoveredUrls, searchQuery, filterDepth]);

  const selectedCount = selectedUrls.size;
  const filteredSelectedCount = filteredUrls.filter((item) =>
    selectedUrls.has(item.url)
  ).length;
  const allFilteredSelected = filteredUrls.length > 0 && filteredSelectedCount === filteredUrls.length;
  const someFilteredSelected = filteredSelectedCount > 0 && filteredSelectedCount < filteredUrls.length;

  // 메인 페이지별로 그룹화
  useEffect(() => {
    const grouped: Record<string, DiscoveredUrlItem[]> = {};
    discoveredUrls.forEach((item) => {
      const parentKey = item.parentUrl || '기타';
      if (!grouped[parentKey]) {
        grouped[parentKey] = [];
      }
      grouped[parentKey].push(item);
    });
    setGroupedByParent(grouped);
  }, [discoveredUrls]);

  // 제목 편집 핸들러
  const handleTitleEdit = (url: string, currentTitle: string) => {
    setEditingTitle(url);
    setEditedTitles(prev => ({ ...prev, [url]: currentTitle }));
  };

  const handleTitleSave = (url: string) => {
    const newTitle = editedTitles[url];
    if (onUpdateTitle && newTitle) {
      onUpdateTitle(url, newTitle);
    }
    setEditingTitle(null);
  };

  const handleTitleCancel = () => {
    setEditingTitle(null);
  };

  // 표시할 제목 가져오기
  const getDisplayTitle = (item: DiscoveredUrlItem) => {
    return editedTitles[item.url] || item.title || item.url;
  };

  // URL 아이템 렌더링 함수
  const renderUrlItem = (item: DiscoveredUrlItem) => {
    const isSelected = selectedUrls.has(item.url);
    const isAlreadyCrawled = item.isAlreadyCrawled === true;
    return (
      <div
        key={item.url}
        className={cn(
          "group flex items-start gap-3 p-3 rounded-md border transition-all relative z-10",
          isSelected
            ? "bg-blue-900/40 border-blue-500/70 shadow-md"
            : isAlreadyCrawled
            ? "bg-amber-900/15 border-amber-600/50"
            : "bg-gray-800/40 border-gray-700/60 hover:border-gray-600 hover:bg-gray-800/60"
        )}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked) =>
            onSelectionChange(item.url, checked === true)
          }
          className="mt-0.5"
          disabled={isAlreadyCrawled}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                {editingTitle === item.url ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editedTitles[item.url] || item.title || item.url}
                      onChange={(e) => setEditedTitles(prev => ({ ...prev, [item.url]: e.target.value }))}
                      className="h-7 text-sm bg-gray-800/50 border-gray-600 text-white"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleTitleSave(item.url);
                        } else if (e.key === 'Escape') {
                          handleTitleCancel();
                        }
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTitleSave(item.url)}
                      className="h-7 w-7 p-0 text-green-400 hover:text-green-300"
                    >
                      <Save className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleTitleCancel}
                      className="h-7 w-7 p-0 text-gray-400 hover:text-gray-300"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-1">
                    <h3 className="text-sm font-semibold text-white line-clamp-1 flex-1">
                      {getDisplayTitle(item)}
                    </h3>
                    {onUpdateTitle && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTitleEdit(item.url, item.title || item.url)}
                        className="h-6 w-6 p-0 text-gray-400 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                )}
                {isAlreadyCrawled && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 bg-amber-900/50 border-amber-500/50 text-amber-200"
                  >
                    크롤됨
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 bg-gray-700/50 border-gray-600/50 text-gray-300"
                >
                  D{item.depth}
                </Badge>
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 break-all flex items-center gap-1 mb-1 line-clamp-1"
                onClick={(e) => e.stopPropagation()}
              >
                {item.url}
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
              {item.path.length > 1 && (
                <p className="text-[10px] text-gray-500 line-clamp-1">
                  {item.path.slice(0, 2).join(" → ")}
                  {item.path.length > 2 && " → ..."}
                </p>
              )}
            </div>
            <Badge
              variant="outline"
              className="text-[10px] shrink-0 px-1.5 py-0 bg-gray-700/50 border-gray-600/50 text-gray-300"
            >
              {item.source}
            </Badge>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full max-h-full bg-[#0B0F17] text-white overflow-hidden relative">
      {/* Background Effects - gemini_pro_theme 스타일 */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] animate-pulse delay-1000" />
      </div>
      {/* 헤더 - 고정 */}
      <div className="flex-shrink-0 p-5 border-b border-white/10 bg-[#0B0F17]/80 backdrop-blur-md relative z-10">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-1">
            <Globe className="w-5 h-5 text-blue-400" />
            하위 페이지 선택
          </h2>
          <p className="text-sm text-gray-400">
            크롤링할 페이지를 선택하세요. 총 <span className="text-blue-400 font-semibold">{totalCount}</span>개 페이지가 발견되었습니다.
          </p>
        </div>

        {/* 필터 및 검색 */}
        <div className="space-y-2">
          {/* Depth 필터 */}
          {Object.keys(byDepth).length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400">Depth:</span>
              {Object.entries(byDepth)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([depth, count]) => {
                  const isActive = filterDepth === Number(depth);
                  return (
                    <Button
                      key={depth}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => setFilterDepth(isActive ? null : Number(depth))}
                      className={cn(
                        "h-7 text-xs px-3",
                        isActive
                          ? "bg-blue-600 hover:bg-blue-700 text-white"
                          : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"
                      )}
                    >
                      Depth {depth} ({count})
                    </Button>
                  );
                })}
            </div>
          )}

          {/* 검색 */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="URL 또는 제목으로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-gray-800 border-gray-600 text-white placeholder:text-gray-500 text-sm"
            />
          </div>
        </div>
      </div>

      {/* 선택 액션 - 고정 */}
      <div className="flex-shrink-0 px-5 py-2.5 border-b border-white/10 bg-[#0B0F17]/60 backdrop-blur-sm relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={allFilteredSelected ? onDeselectAll : onSelectAll}
              disabled={filteredUrls.length === 0}
              className="h-7 text-xs px-3 bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600"
            >
              {allFilteredSelected ? "전체 해제" : "전체 선택"}
            </Button>
            <span className="text-xs text-gray-300">
              <span className="text-blue-400 font-semibold">{selectedCount}</span>개 선택됨
              {filteredUrls.length > 0 && ` (표시: ${filteredSelectedCount}개)`}
            </span>
          </div>
        </div>
      </div>

      {/* URL 목록 - 스크롤 가능 */}
      <div className="flex-1 min-h-0 overflow-hidden relative z-10">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-4">
            {filteredUrls.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <AlertCircle className="w-10 h-10 text-gray-500 mb-3" />
                <p className="text-gray-400">표시할 페이지가 없습니다.</p>
                {searchQuery && (
                  <p className="text-xs text-gray-500 mt-1">검색어를 변경해보세요.</p>
                )}
              </div>
            ) : Object.keys(groupedByParent).length > 1 ? (
              // 그룹화된 표시 (메인 페이지별로)
              Object.entries(groupedByParent).map(([parentUrl, items]) => {
                const filteredGroupItems = items.filter(item => {
                  if (filterDepth !== null && item.depth !== filterDepth) return false;
                  if (searchQuery) {
                    const query = searchQuery.toLowerCase();
                    return item.url.toLowerCase().includes(query) || item.title?.toLowerCase().includes(query) || false;
                  }
                  return true;
                });
                
                if (filteredGroupItems.length === 0) return null;
                
                return (
                  <div key={parentUrl} className="space-y-2">
                    <div className="flex items-center gap-2 px-2 py-1 bg-blue-500/10 border border-blue-500/30 rounded-md">
                      <Globe className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-semibold text-blue-300 truncate">{parentUrl}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-500/20 border-blue-500/50 text-blue-200">
                        {filteredGroupItems.length}개
                      </Badge>
                    </div>
                    <div className="space-y-2 pl-4">
                      {filteredGroupItems.map((item) => {
                        return renderUrlItem(item);
                      })}
                    </div>
                  </div>
                );
              })
            ) : (
              // 단순 리스트 표시
              filteredUrls.map((item) => {
                return renderUrlItem(item);
              })
            )}
          </div>
        </ScrollArea>
      </div>

      {/* 프로세싱 바 - 로딩 중일 때만 표시 */}
      {isLoading && (
        <div className="flex-shrink-0 px-5 py-3 border-t border-white/10 bg-[#0B0F17]/80 backdrop-blur-sm relative z-10">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            <div className="flex-1">
              <div className="h-2 bg-gray-800/50 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 animate-pulse" style={{ width: '60%' }} />
              </div>
            </div>
            <span className="text-xs text-gray-400">크롤링 진행 중...</span>
          </div>
        </div>
      )}

      {/* 하단 액션 버튼 - 고정 */}
      <div className="flex-shrink-0 px-5 py-4 border-t border-white/10 bg-[#0B0F17]/90 backdrop-blur-md sticky bottom-0 z-10">
        <div className="flex items-center justify-between">
          <div className="text-sm">
            {selectedCount > 0 ? (
              <span className="text-blue-400 font-semibold">
                총 {selectedCount}개 선택됨
              </span>
            ) : (
              <span className="text-gray-400">페이지를 선택해주세요</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
              className="h-9 px-4 bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600 text-sm"
            >
              <X className="w-4 h-4 mr-1.5" />
              취소
            </Button>
            <Button
              onClick={onConfirm}
              disabled={selectedCount === 0 || isLoading}
              className="h-9 px-5 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-lg text-sm min-w-[120px]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  처리 중
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-1.5" />
                  크롤 시작 ({selectedCount})
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
