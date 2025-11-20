"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronRight,
  ChevronDown,
  Globe,
  CheckCircle2,
  Circle,
  Search,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface DiscoveredUrlItem {
  url: string;
  title?: string;
  depth: number;
  parentUrl?: string;
  path: string[];
  source: string;
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
}: UrlDiscoveryPanelProps) {
  const [expandedDepths, setExpandedDepths] = useState<Set<number>>(new Set([1, 2]));
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDepth, setFilterDepth] = useState<number | null>(null);

  // Depth별로 그룹화
  const urlsByDepth = useMemo(() => {
    const grouped: Record<number, DiscoveredUrlItem[]> = {};
    for (const item of discoveredUrls) {
      if (!grouped[item.depth]) {
        grouped[item.depth] = [];
      }
      grouped[item.depth].push(item);
    }
    return grouped;
  }, [discoveredUrls]);

  // 검색 및 필터링
  const filteredUrlsByDepth = useMemo(() => {
    const filtered: Record<number, DiscoveredUrlItem[]> = {};
    for (const [depth, urls] of Object.entries(urlsByDepth)) {
      const depthNum = Number(depth);
      if (filterDepth !== null && depthNum !== filterDepth) {
        continue;
      }
      filtered[depthNum] = urls.filter((item) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
          item.url.toLowerCase().includes(query) ||
          item.title?.toLowerCase().includes(query) ||
          false
        );
      });
    }
    return filtered;
  }, [urlsByDepth, searchQuery, filterDepth]);

  const toggleDepth = (depth: number) => {
    setExpandedDepths((prev) => {
      const next = new Set(prev);
      if (next.has(depth)) {
        next.delete(depth);
      } else {
        next.add(depth);
      }
      return next;
    });
  };

  const selectedCount = selectedUrls.size;
  const allSelected = discoveredUrls.length > 0 && selectedCount === discoveredUrls.length;
  const someSelected = selectedCount > 0 && selectedCount < discoveredUrls.length;

  return (
    <Card className="w-full max-w-4xl mx-auto bg-gray-900/50 border-gray-700">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-primary-enhanced">
          <Globe className="w-5 h-5" />
          발견된 페이지 목록
        </CardTitle>
        <CardDescription className="text-muted-enhanced">
          크롤링할 페이지를 선택하세요. 총 {totalCount}개 페이지가 발견되었습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 통계 및 필터 */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-enhanced">Depth별:</span>
          {Object.entries(byDepth)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([depth, count]) => (
              <Badge
                key={depth}
                variant={filterDepth === Number(depth) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() =>
                  setFilterDepth(filterDepth === Number(depth) ? null : Number(depth))
                }
              >
                Depth {depth}: {count}개
              </Badge>
            ))}
          {filterDepth !== null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilterDepth(null)}
              className="h-6 text-xs"
            >
              필터 해제
            </Button>
          )}
        </div>

        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-enhanced" />
          <Input
            placeholder="URL 또는 제목으로 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-gray-800/30 border-gray-600 text-primary-enhanced"
          />
        </div>

        {/* 선택 액션 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={allSelected ? onDeselectAll : onSelectAll}
              disabled={discoveredUrls.length === 0}
            >
              {allSelected ? "모두 해제" : "모두 선택"}
            </Button>
            <span className="text-sm text-muted-enhanced">
              {selectedCount}개 선택됨
            </span>
          </div>
        </div>

        <Separator className="bg-gray-700" />

        {/* URL 목록 */}
        <ScrollArea className="h-[500px] w-full rounded-md border border-gray-700 bg-gray-800/20">
          <div className="p-4 space-y-2">
            {Object.entries(filteredUrlsByDepth)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([depth, urls]) => {
                const depthNum = Number(depth);
                const isExpanded = expandedDepths.has(depthNum);
                const depthSelectedCount = urls.filter((item) =>
                  selectedUrls.has(item.url)
                ).length;
                const depthAllSelected = urls.length > 0 && depthSelectedCount === urls.length;

                return (
                  <div key={depth} className="space-y-1">
                    {/* Depth 헤더 */}
                    <div
                      className="flex items-center gap-2 p-2 rounded-md bg-gray-800/40 hover:bg-gray-800/60 cursor-pointer transition-colors"
                      onClick={() => toggleDepth(depthNum)}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-enhanced" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-enhanced" />
                      )}
                      <Badge variant="outline" className="text-xs">
                        Depth {depth}
                      </Badge>
                      <span className="text-sm text-muted-enhanced flex-1">
                        {urls.length}개 페이지
                      </span>
                      {depthSelectedCount > 0 && (
                        <span className="text-xs text-blue-400">
                          {depthSelectedCount}개 선택됨
                        </span>
                      )}
                      <Checkbox
                        checked={depthAllSelected}
                        onCheckedChange={(checked) => {
                          for (const item of urls) {
                            onSelectionChange(item.url, checked === true);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    {/* Depth 내 URL 목록 */}
                    {isExpanded && (
                      <div className="ml-6 space-y-1">
                        {urls.length === 0 ? (
                          <div className="p-2 text-sm text-muted-enhanced">
                            검색 결과가 없습니다.
                          </div>
                        ) : (
                          urls.map((item) => {
                            const isSelected = selectedUrls.has(item.url);
                            return (
                              <div
                                key={item.url}
                                className={cn(
                                  "flex items-start gap-2 p-2 rounded-md transition-colors",
                                  isSelected
                                    ? "bg-blue-900/20 border border-blue-700/40"
                                    : "bg-gray-800/20 hover:bg-gray-800/40 border border-transparent"
                                )}
                              >
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={(checked) =>
                                    onSelectionChange(item.url, checked === true)
                                  }
                                  className="mt-1"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      {item.title ? (
                                        <div className="text-sm font-medium text-primary-enhanced truncate">
                                          {item.title}
                                        </div>
                                      ) : null}
                                      <div className="text-xs text-muted-enhanced truncate mt-0.5">
                                        {item.url}
                                      </div>
                                      {item.path.length > 1 && (
                                        <div className="text-xs text-gray-500 mt-1">
                                          경로: {item.path.slice(0, 3).join(" → ")}
                                          {item.path.length > 3 && " → ..."}
                                        </div>
                                      )}
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className="text-xs shrink-0"
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
                    )}
                  </div>
                );
              })}

            {Object.keys(filteredUrlsByDepth).length === 0 && (
              <div className="p-8 text-center text-muted-enhanced">
                <AlertCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>표시할 페이지가 없습니다.</p>
                {searchQuery && (
                  <p className="text-xs mt-2">검색어를 변경해보세요.</p>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 하단 액션 */}
        <Separator className="bg-gray-700" />
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-enhanced">
            {selectedCount > 0 ? (
              <span className="text-blue-400">
                {selectedCount}개 페이지가 선택되었습니다.
              </span>
            ) : (
              <span>페이지를 선택해주세요.</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel} disabled={isLoading}>
              취소
            </Button>
            <Button
              onClick={onConfirm}
              disabled={selectedCount === 0 || isLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  처리 중...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  선택한 페이지만 크롤 ({selectedCount}개)
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

