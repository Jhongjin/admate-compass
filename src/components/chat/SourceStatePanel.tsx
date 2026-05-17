"use client";

import { useId, useState } from "react";
import { AlertCircle, BookOpen, CheckCircle2, ChevronDown, ChevronUp, Download, ExternalLink, FileText, Fingerprint, Link2, Search, ShieldCheck } from "lucide-react";
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
  onPromptSelect?: (question: string) => void;
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
  onPromptSelect,
}: SourceStatePanelProps) {
  const [cardsVisible, setCardsVisible] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const sourceListId = useId();
  const hasSources = sources.length > 0;
  const isLimited = state === "generation-limited";
  const isNoData = state === "noData";
  const isError = state === "error";
  const isInitial = state === "initial-empty";
  const heading = isLimited ? "생성 답변 제한" : hasSources ? "근거 문서" : "근거 문서 없음";
  const stateDescription = isLimited
    ? "답변 문장은 제한되었지만, 검색된 근거와 인용 후보는 검토할 수 있습니다."
    : hasSources
      ? "질문에 연결된 출처를 확인하고 최종 판단 전 원문과 인용 후보를 대조합니다."
      : "현재 상태에서 표시할 출처가 없습니다.";
  const noDataPromptChips = [
    "플랫폼과 업종을 포함해서 다시 검토해줘",
    "소재 표현과 랜딩 조건 기준으로 찾아줘",
    "공식 정책 근거가 있는 항목만 좁혀줘",
  ];

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

  const getSourceExcerptId = (source: ChatSource, index: number) =>
    `${sourceListId}-excerpt-${index}-${source.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const getSourceKindLabel = (source: ChatSource) => {
    if (source.sourceType === "file") return "파일 근거";
    if (source.sourceType === "url" || source.url) return "URL 근거";
    return "색인 근거";
  };

  const getSourceAccessLabel = (source: ChatSource) => {
    if (source.url) return "원문 확인 가능";
    if (source.excerpt) return "원문 일부 확인";
    return "원문 대조 필요";
  };

  const getSourceDeskLabel = (source: ChatSource) => {
    if (source.sourceType === "document") return "정책 문서";
    if (source.sourceType === "file") return "업로드 문서";
    return "Compass 정책 보드";
  };

  const getSourceVendorLabel = (source: ChatSource) => {
    const text = `${source.title || ""} ${source.url || ""}`.toLowerCase();
    if (text.includes("meta") || text.includes("facebook") || text.includes("instagram")) return "Meta";
    if (text.includes("google") || text.includes("youtube")) return "Google";
    if (text.includes("naver")) return "Naver";
    if (text.includes("kakao")) return "Kakao";
    return "매체 미확인";
  };

  const getSourceIntegrityLabel = (source: ChatSource) => {
    if (source.url && source.excerpt) return "원문+발췌";
    if (source.url) return "원문 링크";
    if (source.excerpt) return "발췌 있음";
    return "대조 필요";
  };

  const sourceLedger = {
    total: sources.length,
    urlCount: sources.filter((source) => Boolean(source.url)).length,
    excerptCount: sources.filter((source) => Boolean(source.excerpt)).length,
    vendorCount: new Set(
      sources
        .map(getSourceVendorLabel)
        .filter((label) => label !== "매체 미확인")
    ).size,
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
      <div className="flex flex-col items-center justify-center py-10 text-center sm:py-16">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
          <BookOpen className="h-8 w-8 text-[#1F7A4D]" />
        </div>
        <h3 className="mb-2 text-base font-semibold text-[#111713]">정책 검토를 시작해보세요</h3>
        <p className="max-w-sm text-sm leading-relaxed text-[#5F6C62]">
          질문을 시작하면 근거 문서가 여기에 표시됩니다. 플랫폼, 정책 항목, 소재 유형을 함께 입력하면 더 정확합니다.
        </p>
      </div>
    );
  }

  if (isNoData || isError) {
    return (
      <Card className="w-full rounded-lg border-[#D6D8CD] bg-white shadow-sm">
        <CardHeader className="p-4 pb-2">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#758070]">
            검토 결과
          </div>
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
          {isNoData && (
            <div className="grid gap-2 rounded-md border border-[#E9D59B] bg-[#FFF8E6] p-3 text-xs leading-5 text-[#6B5316]">
              <div className="font-semibold text-[#111713]">다시 검토할 때 포함하면 좋은 정보</div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-md border border-[#E9D59B] bg-white px-2 py-1">플랫폼</span>
                <span className="rounded-md border border-[#E9D59B] bg-white px-2 py-1">업종/상품</span>
                <span className="rounded-md border border-[#E9D59B] bg-white px-2 py-1">소재 표현</span>
                <span className="rounded-md border border-[#E9D59B] bg-white px-2 py-1">랜딩 페이지 조건</span>
              </div>
            </div>
          )}
          {isNoData && (
            <div className="grid gap-2 rounded-md border border-[#D8DCCF] bg-[#FBFBF7] p-3 text-xs leading-5 text-[#5F6C62]">
              <div className="font-semibold text-[#111713]">바로 좁혀볼 질문</div>
              <div className="flex flex-wrap gap-1.5">
                {noDataPromptChips.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => onPromptSelect?.(prompt)}
                    disabled={!onPromptSelect}
                    className="rounded-md border border-[#D8DCCF] bg-white px-2.5 py-1.5 text-left text-[11px] font-medium text-[#34423A] transition-colors hover:border-[#B9C9BB] hover:bg-[#EDF7EF] disabled:cursor-default disabled:opacity-80"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
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
                담당자 문의
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full rounded-lg border-[#D6D8CD] bg-white shadow-sm">
      <CardHeader className={compact ? "p-3 pb-2" : "p-4 pb-3"}>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#758070]">
          근거 검토
        </div>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#111713]">
          <ShieldCheck className="h-4 w-4 text-[#1F7A4D]" />
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
        <p className="line-clamp-2 text-xs leading-5 text-[#5F6C62]">
          {stateDescription}
        </p>
        {userQuestion && !compact && (
          <p className="line-clamp-2 text-xs leading-5 text-[#777777]">
            질문: {userQuestion}
          </p>
        )}
        {hasSources && (
          <div className="mt-3 rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#758070]">
              <Fingerprint className="h-3.5 w-3.5 text-[#1F7A4D]" />
              근거 원장
            </div>
            <div className={`grid gap-1.5 text-[11px] ${compact ? "grid-cols-2" : "grid-cols-4"}`}>
              <div className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1.5">
                <span className="block font-semibold text-[#111713]">{sourceLedger.total}</span>
                출처
              </div>
              <div className="rounded-md border border-[#C6D9CB] bg-white px-2 py-1.5">
                <span className="block font-semibold text-[#1F7A4D]">{sourceLedger.urlCount}</span>
                원문 링크
              </div>
              <div className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1.5">
                <span className="block font-semibold text-[#111713]">{sourceLedger.excerptCount}</span>
                발췌 있음
              </div>
              <div className="rounded-md border border-[#E9D59B] bg-white px-2 py-1.5">
                <span className="block font-semibold text-[#8A6418]">{sourceLedger.vendorCount}</span>
                매체 신호
              </div>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className={compact ? "space-y-2 p-3 pt-0" : "space-y-3 p-4 pt-0"}>
        {isLimited && (
          <div className={`${compact ? "p-2.5" : "p-3"} rounded-md border border-amber-200 bg-amber-50 text-xs leading-5 text-amber-900`}>
            답변 생성은 일시적으로 제한되었지만, 확인된 근거 문서는 아래에서 계속 확인할 수 있습니다. 원문 대조 후 운영 판단에 사용해 주세요.
          </div>
        )}

        {hasSources && !compact && (
          <div className="grid gap-2 rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] p-3 text-xs text-[#5F6C62]">
            <div className="font-semibold text-[#111713]">운영 검토 기준</div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">출처 제목 확인</span>
              <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">원문 일부 대조</span>
              <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">인용 후보 선별</span>
              <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1">최종 판단 전 원문 확인</span>
            </div>
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCardsVisible((visible) => !visible)}
          aria-expanded={cardsVisible}
          aria-controls={sourceListId}
          className="h-9 w-full justify-between rounded-lg border border-[#C6D9CB] bg-white px-3 text-xs font-medium text-[#1F7A4D] shadow-sm transition-colors hover:bg-[#EDF7EF] hover:text-[#176B42]"
        >
          <span className="flex items-center">
            <FileText className="mr-2 h-4 w-4" />
            근거 문서 {sources.length}개 보기
          </span>
          {cardsVisible ? <ChevronUp className="ml-2 h-3.5 w-3.5" /> : <ChevronDown className="ml-2 h-3.5 w-3.5" />}
        </Button>

        {cardsVisible && (
          <div id={sourceListId} role="list" aria-label="근거 문서 목록" className="space-y-3">
            {sources.slice(0, compact ? 3 : 6).map((source, index) => {
              const isExpanded = expandedIds.has(source.id);
              const title = source.title?.replace(/_chunk_\d+/g, `_page_${index + 1}`) || `근거 문서 ${index + 1}`;
              const sourceExcerptId = getSourceExcerptId(source, index);

              return (
                <div key={`${source.id}-${index}`} role="listitem" className={`${compact ? "p-2.5" : "p-3"} rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] transition-colors hover:border-[#B9C9BB]`}>
                  <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
                    <div className={`${compact ? "h-6 w-6" : "h-7 w-7"} flex flex-none items-center justify-center rounded-md border border-[#C6D9CB] bg-[#EDF7EF] text-xs font-semibold text-[#1F7A4D]`}>
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`${compact ? "mb-0.5" : "mb-1"} text-[11px] font-semibold uppercase tracking-[0.12em] text-[#758070]`}>
                        인용 후보 {index + 1}
                      </div>
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
                              {source.sourceType === "file" ? <Download className="h-4 w-4" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
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
                            aria-expanded={isExpanded}
                            aria-controls={sourceExcerptId}
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                          </Button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="rounded-md border-[#D8DCCF] bg-white px-2 py-0.5 text-[11px] text-[#34423A]">
                          <Fingerprint className="mr-1 h-3 w-3 text-[#758070]" />
                          {getSourceVendorLabel(source)}
                        </Badge>
                        <Badge variant="outline" className="rounded-md border-[#C6D9CB] bg-[#EDF7EF] px-2 py-0.5 text-[11px] text-[#1F7A4D]">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          {getSourceKindLabel(source)}
                        </Badge>
                        <Badge variant="outline" className="rounded-md border-[#D8DCCF] bg-white px-2 py-0.5 text-[11px] text-[#5F6C62]">
                          <Link2 className="mr-1 h-3 w-3" />
                          {getSourceAccessLabel(source)}
                        </Badge>
                        <Badge variant="outline" className="rounded-md border-[#E9D59B] bg-[#FFF8E6] px-2 py-0.5 text-[11px] text-[#8A6418]">
                          {getSourceDeskLabel(source)}
                        </Badge>
                        <Badge variant="outline" className="rounded-md border-[#D8DCCF] bg-white px-2 py-0.5 text-[11px] text-[#5F6C62]">
                          {getSourceIntegrityLabel(source)}
                        </Badge>
                      </div>

                      <p id={sourceExcerptId} className={`${isExpanded ? "" : compact ? "line-clamp-2" : "line-clamp-3"} mt-2 break-words text-xs leading-5 text-[#5F6C62]`}>
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
