"use client";

import { useState } from "react";
import { AlertCircle, BookOpen, ChevronDown, ChevronUp, Download, ExternalLink, FileText, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChatSource, ChatUiState } from "@/components/chat/chatUiStateTypes";

const NO_DATA_MESSAGE = "현재 Compass 문서에서 확인 가능한 근거를 찾지 못했습니다. 플랫폼명, 정책 항목, 소재 유형을 더 구체적으로 입력해 주세요.";
const ERROR_MESSAGE = "일시적인 서비스 오류로 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";

interface SourceStatePanelProps {
  state: ChatUiState;
  sources: ChatSource[];
  compact?: boolean;
  userQuestion?: string;
  showContactOption?: boolean;
  sourceOpenMode?: "active" | "noop";
  onContact?: () => void;
  onRetry?: () => void;
}

export default function SourceStatePanel({
  state,
  sources,
  compact = false,
  userQuestion,
  showContactOption = false,
  sourceOpenMode = "active",
  onContact,
  onRetry,
}: SourceStatePanelProps) {
  const [cardsVisible, setCardsVisible] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const hasSources = sources.length > 0;
  const isLimited = state === "generation-limited";
  const isNoData = state === "noData";
  const isError = state === "error";
  const isInitial = state === "initial-empty";
  const heading = isLimited ? "생성 답변 제한" : hasSources ? "근거 문서" : "근거 문서 없음";

  const toggleExpanded = (sourceId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  const handleSourceOpen = async (source: ChatSource) => {
    if (!source.url || sourceOpenMode === "noop") return;

    if (source.sourceType === "file") {
      try {
        const response = await fetch(source.url);
        if (!response.ok) throw new Error("download failed");
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = source.title || "compass-source";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
      } catch (downloadError) {
        console.error("근거 문서 다운로드 오류:", downloadError);
        alert("파일을 여는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
      return;
    }

    window.open(source.url, "_blank", "noopener,noreferrer");
  };

  if (isInitial) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
          <BookOpen className="h-8 w-8 text-[#1F7A4D]" />
        </div>
        <h3 className="mb-2 text-base font-semibold text-[#111713]">질문을 시작해보세요</h3>
        <p className="max-w-sm text-sm leading-relaxed text-[#5F6C62]">
          질문을 시작하면 근거 문서가 여기에 표시됩니다.
        </p>
      </div>
    );
  }

  if (isNoData || isError) {
    return (
      <Card className="w-full rounded-lg border-[#D6D8CD] bg-white shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-[#111713]">
            {isError ? <AlertCircle className="h-4 w-4 text-[#D93025]" /> : <Search className="h-4 w-4 text-[#9E5700]" />}
            {heading}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <p className="text-sm leading-6 text-[#5F6C62]">
            {isError ? ERROR_MESSAGE : NO_DATA_MESSAGE}
          </p>
          {isNoData && (
            <div className="rounded-md border border-[#D8DCCF] bg-[#FBFBF7] p-3 text-xs leading-5 text-[#5F6C62]">
              플랫폼명, 정책 항목, 소재 유형을 함께 입력하면 더 좁은 범위로 확인할 수 있습니다.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {isError && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                className="h-9 rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-3 text-xs text-[#1F7A4D] hover:bg-[#E3F1E7]"
              >
                다시 시도
              </Button>
            )}
            {isNoData && showContactOption && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onContact}
                className="h-9 rounded-md border-amber-200 bg-amber-50 px-3 text-xs text-amber-800 hover:bg-amber-100"
              >
                문의
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full rounded-lg border-[#D6D8CD] bg-white shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#111713]">
          <BookOpen className="h-4 w-4 text-[#1F7A4D]" />
          <span>{heading}</span>
          <Badge variant="outline" className="rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-2 py-0.5 text-[11px] text-[#1F7A4D]">
            {sources.length}개
          </Badge>
          {isLimited && (
            <Badge variant="outline" className="rounded-md border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
              생성 답변 제한
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
        {isLimited && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            답변 생성은 일시적으로 제한되었지만, 확인된 근거 문서는 아래에서 계속 확인할 수 있습니다.
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCardsVisible((visible) => !visible)}
          className="h-9 rounded-lg border border-[#C6D9CB] bg-white px-3 text-xs font-medium text-[#1F7A4D] shadow-sm transition-colors hover:bg-[#EDF7EF] hover:text-[#176B42]"
        >
          <FileText className="mr-2 h-4 w-4" />
          근거 문서 {sources.length}개 보기
          {cardsVisible ? <ChevronUp className="ml-2 h-3.5 w-3.5" /> : <ChevronDown className="ml-2 h-3.5 w-3.5" />}
        </Button>

        {cardsVisible && (
          <div className="space-y-3">
            {sources.slice(0, compact ? 3 : 6).map((source, index) => {
              const isExpanded = expandedIds.has(source.id);
              const title = source.title?.replace(/_chunk_\d+/g, `_page_${index + 1}`) || `근거 문서 ${index + 1}`;

              return (
                <div key={`${source.id}-${index}`} className="rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-md border border-[#C6D9CB] bg-[#EDF7EF] text-xs font-semibold text-[#1F7A4D]">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="line-clamp-2 break-words text-sm font-semibold leading-5 text-[#111713]">
                          {title}
                        </h4>
                        <div className="flex flex-none items-center gap-1">
                          {source.url && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 rounded-md p-0 text-[#5F6C62] hover:bg-[#EDF7EF] hover:text-[#1F7A4D]"
                              onClick={() => handleSourceOpen(source)}
                              title={source.sourceType === "file" ? "파일 다운로드" : "열기"}
                              aria-label={source.sourceType === "file" ? "파일 다운로드" : "근거 문서 열기"}
                            >
                              {source.sourceType === "file" ? <Download className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 rounded-md p-0 text-[#5F6C62] hover:bg-[#F0F2EA] hover:text-[#111713]"
                            onClick={() => toggleExpanded(source.id)}
                            title={isExpanded ? "접기" : "펼치기"}
                            aria-label={isExpanded ? "근거 문서 접기" : "근거 문서 펼치기"}
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>

                      <p className={`${isExpanded ? "" : "line-clamp-3"} mt-2 break-words text-xs leading-5 text-[#5F6C62]`}>
                        {source.excerpt || "표시할 원문 일부가 없습니다."}
                      </p>

                      {isExpanded && (
                        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#D8DCCF] pt-3">
                          <Badge variant="outline" className="rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-2 py-0.5 text-[11px] text-[#1F7A4D]">
                            검증 근거
                          </Badge>
                          <Badge variant="outline" className="rounded-md border-[#D8DCCF] bg-white px-2 py-0.5 text-[11px] text-[#5F6C62]">
                            Compass 색인
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
