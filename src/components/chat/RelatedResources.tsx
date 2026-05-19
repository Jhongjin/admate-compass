"use client";

import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp, Download, ExternalLink, FileText, Globe, Search, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SourceQuality {
  hasDocumentId?: boolean;
  hasTitle?: boolean;
  hasUrl?: boolean;
  hasExcerpt?: boolean;
  isFallback?: boolean;
  qualityScore?: number;
  warnings?: string[];
}

interface SourceItem {
  id: string;
  title: string;
  url?: string;
  updatedAt?: string;
  excerpt?: string;
  sourceType?: "file" | "url";
  documentType?: string;
  retrievalMethod?: string;
  corpus?: string;
  evidenceType?: string;
  sourceVendor?: string;
  score?: number;
  hybridScore?: number;
  similarity?: number;
  sourceQuality?: SourceQuality;
}

interface RelatedResourcesProps {
  isLoading?: boolean;
  userQuestion?: string;
  aiResponse?: string;
  sources?: SourceItem[];
  noDataFound?: boolean;
  generationLimited?: boolean;
  compact?: boolean;
}

const getDisplayTitle = (source: SourceItem, index: number) => {
  const cleaned = source.title?.replace(/_chunk_\d+/g, `_page_${index + 1}`).trim();
  return cleaned || `출처 문서 ${index + 1}`;
};

const getEvidenceLabel = (source: SourceItem) => {
  const method = source.retrievalMethod?.toLowerCase() || source.evidenceType?.toLowerCase();

  if (method?.includes("hybrid")) return "의미+문구 일치";
  if (method?.includes("keyword")) return "문구 일치";
  if (method?.includes("vector")) return "의미 유사";

  return "출처 확인";
};

const getAvailabilityLabel = (source: SourceItem) => {
  if (source.url || source.sourceQuality?.hasUrl) return "원문 확인 가능";
  if (source.excerpt || source.sourceQuality?.hasExcerpt) return "원문 일부 확인 가능";

  return "관련 문서";
};

const getCorpusLabel = (source: SourceItem) => {
  const corpus = source.corpus?.toLowerCase();

  if (corpus?.endsWith("_document_chunks")) return "관련 문서";
  if (corpus?.includes("document_chunks")) return "Compass 문서";

  return "Compass 문서";
};

const getScoreLabel = (source: SourceItem) => {
  const rawScore = source.hybridScore ?? source.score ?? source.similarity ?? source.sourceQuality?.qualityScore;

  if (typeof rawScore !== "number" || Number.isNaN(rawScore)) {
    return null;
  }

  const normalized = rawScore > 1 ? rawScore : rawScore * 100;
  return `${Math.round(normalized)}%`;
};

export default function RelatedResources({
  isLoading = false,
  userQuestion,
  sources = [],
  noDataFound = false,
  generationLimited = false,
  compact = false,
}: RelatedResourcesProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const validSources = sources.filter((source) => {
    if (!source || source.sourceQuality?.isFallback) return false;
    return Boolean(source.title || source.excerpt);
  });

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const handleFileDownload = async (source: SourceItem) => {
    if (!source.url) {
      alert("다운로드할 파일의 URL을 찾을 수 없습니다.");
      return;
    }

    try {
      const response = await fetch(source.url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = getDisplayTitle(source, 0);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("파일 다운로드 실패:", error);
      alert("파일 다운로드 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    }
  };

  const handleUrlOpen = (source: SourceItem) => {
    if (!source.url) {
      alert("열 수 있는 원문 URL을 찾을 수 없습니다.");
      return;
    }

    window.open(source.url, "_blank", "noopener,noreferrer");
  };

  if (isLoading) {
    return (
      <Card className="w-full rounded-lg border-[#E5E5E5] bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 text-sm text-[#5E5E5E]">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#D8DED9] border-t-[#1F7A4D]" />
            확인한 출처와 원문 링크를 확인하는 중입니다.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (noDataFound || validSources.length === 0) {
    return (
      <Card className="w-full overflow-hidden rounded-lg border-[#E5E5E5] bg-white shadow-sm">
        <div className="h-1 bg-[#9E5700]" />
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-[#0D0D0D]">
            <Search className="h-4 w-4 text-[#9E5700]" />
            확인한 출처 없음
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <p className="text-sm leading-6 text-[#5E5E5E]">
            현재 Compass 문서 기준으로 확인 가능한 출처를 찾지 못했습니다. 플랫폼명, 정책 항목, 소재 유형을 더 구체적으로 입력해 주세요.
          </p>
          <div className="rounded-md border border-[#E5E5E5] bg-[#F7F7F7] p-3 text-xs leading-5 text-[#5E5E5E]">
            예: "카카오 광고 가격 할인 표시 기준", "Google Ads 도박 정책", "네이버 청소년 유해 콘텐츠 기준"
          </div>
          <div className="grid gap-2 text-xs text-[#5E5E5E] sm:grid-cols-3">
            <div className="rounded-md border border-[#E5E5E5] bg-white px-3 py-2">
              <p className="font-semibold text-[#0D0D0D]">플랫폼</p>
              <p className="mt-1">Meta, Google, 네이버 등</p>
            </div>
            <div className="rounded-md border border-[#E5E5E5] bg-white px-3 py-2">
              <p className="font-semibold text-[#0D0D0D]">정책 항목</p>
              <p className="mt-1">가격, 금융, 청소년, 의료</p>
            </div>
            <div className="rounded-md border border-[#E5E5E5] bg-white px-3 py-2">
              <p className="font-semibold text-[#0D0D0D]">소재 표현</p>
              <p className="mt-1">문구나 랜딩 맥락 포함</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full overflow-hidden rounded-lg border-[#E5E5E5] bg-white shadow-sm">
      <div className="h-1 bg-[#1F7A4D]" />
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#0D0D0D]">
          <BookOpen className="h-4 w-4 text-[#1F7A4D]" />
          <span>확인한 출처</span>
          <Badge variant="outline" className="rounded-md border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
            {validSources.length}개
          </Badge>
          {generationLimited && (
            <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
              답변 정리 제한
            </Badge>
          )}
        </CardTitle>
        {userQuestion && !compact && (
          <p className="line-clamp-2 text-xs leading-5 text-[#777777]">
            질문: {userQuestion}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {generationLimited && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <p className="font-semibold">답변 정리 제한</p>
            <p className="mt-1">
              확인한 출처와 원문 링크는 유지됩니다. 출처를 먼저 확인한 뒤 다시 시도해 주세요.
            </p>
          </div>
        )}

        {validSources.slice(0, compact ? 3 : 6).map((source, index) => {
          const isExpanded = expandedIds.has(source.id);
          const score = getScoreLabel(source);

          return (
            <div key={`${source.id}-${index}`} className="rounded-lg border border-[#D8DCCF] border-l-4 border-l-[#1F7A4D] bg-[#FBFBF7] p-3 transition-colors hover:bg-white">
              <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2 sm:gap-3">
                <div className="flex h-8 w-10 flex-none items-center justify-center rounded-md border border-[#C6D9CB] bg-white text-[10px] font-bold text-[#1F7A4D]">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <h4 className="line-clamp-2 break-words text-sm font-semibold leading-5 text-[#0D0D0D]">
                      {getDisplayTitle(source, index)}
                    </h4>
                    <div className="flex flex-none items-center gap-1 self-start">
                      {source.url && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 rounded-md p-0 text-[#5E5E5E] hover:bg-[#EDF7EF] hover:text-[#1F7A4D]"
                          onClick={() => source.sourceType === "file" ? handleFileDownload(source) : handleUrlOpen(source)}
                          title={source.sourceType === "file" ? "파일 다운로드" : "원문 열기"}
                          aria-label={source.sourceType === "file" ? "출처 문서 파일 다운로드" : "출처 문서 원문 열기"}
                        >
                          {source.sourceType === "file" ? <Download className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 rounded-md p-0 text-[#5E5E5E] hover:bg-[#F4F4F4] hover:text-[#0D0D0D]"
                        onClick={() => toggleExpanded(source.id)}
                        title={isExpanded ? "접기" : "펼치기"}
                        aria-label={isExpanded ? "출처 문서 접기" : "출처 문서 펼치기"}
                      >
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>

                  <p className={`${isExpanded ? "" : "line-clamp-3"} mt-2 break-words border-t border-[#E2E5DA] pt-2 text-xs leading-5 text-[#5E5E5E]`}>
                    {source.excerpt || "표시할 원문 일부가 없습니다."}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-2 py-0.5 text-[11px] text-[#1F7A4D]">
                      {getEvidenceLabel(source)}
                    </Badge>
                    <Badge variant="outline" className="rounded-md border-[#E5E5E5] bg-[#F7F7F7] px-2 py-0.5 text-[11px] text-[#5E5E5E]">
                      {getAvailabilityLabel(source)}
                    </Badge>
                    <Badge variant="outline" className="rounded-md border-[#E5E5E5] bg-white px-2 py-0.5 text-[11px] text-[#5E5E5E]">
                      {getCorpusLabel(source)}
                    </Badge>
                    {score && (
                      <Badge variant="outline" className="rounded-md border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                        관련도 {score}
                      </Badge>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#E5E5E5] pt-3 text-xs text-[#777777]">
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                        정책 출처 확인
                      </span>
                      <span className="inline-flex items-center gap-1">
                        {source.sourceType === "file" ? <FileText className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                        {source.sourceType === "file" ? "파일 기반" : "웹 문서 기반"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
