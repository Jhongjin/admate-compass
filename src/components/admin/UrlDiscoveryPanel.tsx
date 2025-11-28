"use client";

import { useState, useMemo } from "react";
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

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* 헤더 */}
      <div className="flex-shrink-0 p-6 border-b border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Globe className="w-6 h-6 text-blue-400" />
              발견된 페이지 목록
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              크롤링할 페이지를 선택하세요. 총 {totalCount}개 페이지가 발견되었습니다.
            </p>
          </div>
        </div>

        {/* 필터 및 검색 */}
        <div className="space-y-3">
          {/* Depth 필터 */}
          {Object.keys(byDepth).length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-400">Depth별 필터:</span>
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
                        "h-8 text-xs",
                        isActive
                          ? "bg-blue-600 hover:bg-blue-700 text-white"
                          : "bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700"
                      )}
                    >
                      Depth {depth} ({count}개)
                    </Button>
                  );
                })}
            </div>
          )}

          {/* 검색 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="URL 또는 제목으로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-gray-800 border-gray-600 text-white placeholder:text-gray-500"
            />
          </div>
        </div>
      </div>

      {/* 선택 액션 */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={allFilteredSelected ? onDeselectAll : onSelectAll}
              disabled={filteredUrls.length === 0}
              className="h-8 text-xs bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600"
            >
              {allFilteredSelected ? "모두 해제" : "모두 선택"}
            </Button>
            <span className="text-sm text-gray-300">
              {selectedCount}개 선택됨 {filteredUrls.length > 0 && `(표시된 ${filteredSelectedCount}개)`}
            </span>
          </div>
        </div>
      </div>

      {/* URL 목록 */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-2">
          {filteredUrls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="w-12 h-12 text-gray-500 mb-4" />
              <p className="text-gray-400 text-lg">표시할 페이지가 없습니다.</p>
              {searchQuery && (
                <p className="text-sm text-gray-500 mt-2">검색어를 변경해보세요.</p>
              )}
            </div>
          ) : (
            filteredUrls.map((item) => {
              const isSelected = selectedUrls.has(item.url);
              const isAlreadyCrawled = item.isAlreadyCrawled === true;
              return (
                <div
                  key={item.url}
                  className={cn(
                    "flex items-start gap-3 p-4 rounded-lg border transition-all",
                    isSelected
                      ? "bg-blue-900/30 border-blue-500/60 shadow-lg"
                      : isAlreadyCrawled
                      ? "bg-amber-900/10 border-amber-600/40"
                      : "bg-gray-800/50 border-gray-700 hover:border-gray-600 hover:bg-gray-800/70"
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) =>
                      onSelectionChange(item.url, checked === true)
                    }
                    className="mt-1"
                    disabled={isAlreadyCrawled}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base font-semibold text-white truncate">
                            {item.title || item.url}
                          </h3>
                          {isAlreadyCrawled && (
                            <Badge
                              variant="outline"
                              className="text-xs bg-amber-900/50 border-amber-500/50 text-amber-200"
                            >
                              이미 크롤됨
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className="text-xs bg-gray-700 border-gray-600 text-gray-300"
                          >
                            Depth {item.depth}
                          </Badge>
                        </div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-400 hover:text-blue-300 break-all flex items-center gap-1 mb-1"
                        >
                          {item.url}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        {item.path.length > 1 && (
                          <p className="text-xs text-gray-500">
                            경로: {item.path.slice(0, 3).join(" → ")}
                            {item.path.length > 3 && " → ..."}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs shrink-0 bg-gray-700 border-gray-600 text-gray-300"
                      >
                        {item.source}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* 고정된 하단 액션 버튼 */}
      <div className="flex-shrink-0 p-6 border-t border-gray-700 bg-gray-800/80 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-300">
            {selectedCount > 0 ? (
              <span className="text-blue-400 font-semibold">
                {selectedCount}개 페이지가 선택되었습니다.
              </span>
            ) : (
              <span className="text-gray-400">페이지를 선택해주세요.</span>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
              className="h-10 px-6 bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600"
            >
              <X className="w-4 h-4 mr-2" />
              취소
            </Button>
            <Button
              onClick={onConfirm}
              disabled={selectedCount === 0 || isLoading}
              className="h-10 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  처리 중...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  크롤 시작 ({selectedCount}개)
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
