"use client";

import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Globe,
  Lock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

type SourceStatus = "indexed" | "candidate_only" | "stale" | "unavailable";

interface SourceOpsItem {
  id: string;
  vendor: "META" | "KAKAO" | "NAVER" | "GOOGLE";
  label: string;
  url: string;
  sourceType: "policy" | "help" | "entrypoint";
  priority: "core" | "support";
  cadenceDays: number;
  discoveryMode: "exact_url" | "domain_discovery";
  status: SourceStatus;
  matchedDocuments: number;
  indexedDocuments: number;
  totalChunks: number;
  latestDocumentAt?: string;
  matchedDocumentTitles: string[];
  recommendation: string;
}

interface SourceOpsPlan {
  mode: "review-only";
  collectionOwner: "backend-agent";
  manualCollectionRecommended: false;
  mutationEnabled: false;
  scheduleRecommendation: string;
  safetyNotes: string[];
  sources: SourceOpsItem[];
  summary: {
    totalSources: number;
    indexedSources: number;
    staleSources: number;
    candidateOnlySources: number;
    unavailableSources: number;
  };
  generatedAt: string;
}

interface ProposalReview {
  classifier: "deterministic-policy-review-v1";
  llmUsed: false;
  relevanceLevel: "high" | "medium" | "low" | "blocked";
  relevanceScore: number;
  signals: string[];
  diffSummary: string;
  recommendation: string;
  needsHumanReview: true;
  mutationEnabled: false;
}

interface ProposalCandidate {
  id: string;
  sourceId: string;
  vendor: SourceOpsItem["vendor"];
  label: string;
  url: string;
  host: string;
  status: "candidate_ready" | "fetch_disabled" | "fetch_failed" | "blocked";
  reason: string;
  sourceStatus?: SourceStatus;
  riskLevel: "low" | "medium" | "high";
  wouldFetch: boolean;
  wouldIndex: false;
  wouldPromote: false;
  review: ProposalReview;
}

interface ProposalRun {
  mode: "proposal-only";
  dryRun: true;
  mutationEnabled: false;
  fetchEnabled: boolean;
  collectionOwner: "backend-agent";
  generatedAt: string;
  candidates: ProposalCandidate[];
  safetyNotes: string[];
  queue?: {
    enabled: boolean;
    productionBlocked: boolean;
    canPersist?: boolean;
  };
}

const statusLabels: Record<SourceStatus, string> = {
  indexed: "색인됨",
  stale: "갱신 필요",
  candidate_only: "후보",
  unavailable: "미색인",
};

const vendorAccent: Record<SourceOpsItem["vendor"], string> = {
  META: "border-sky-400/40 bg-sky-500/10 text-sky-100",
  KAKAO: "border-yellow-400/40 bg-yellow-500/10 text-yellow-100",
  NAVER: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
  GOOGLE: "border-blue-400/40 bg-blue-500/10 text-blue-100",
};

export default function SourceOpsPage() {
  const [plan, setPlan] = useState<SourceOpsPlan | null>(null);
  const [proposalRun, setProposalRun] = useState<ProposalRun | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalError, setProposalError] = useState<string | null>(null);

  const loadPlan = async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      setProposalError(null);
      const [response, proposalResponse] = await Promise.all([
        fetch("/api/admin/source-ops", { cache: "no-store" }),
        fetch("/api/admin/source-ops/proposals?maxSources=7", { cache: "no-store" }),
      ]);
      const payload = await response.json();
      const proposalPayload = await proposalResponse.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "소스 관제 상태를 불러오지 못했습니다.");
      }

      setPlan(payload.data);

      if (proposalResponse.ok && proposalPayload.success) {
        setProposalRun(proposalPayload.data);
      } else {
        setProposalRun(null);
        setProposalError(proposalPayload.error || "후보 프리뷰를 불러오지 못했습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "소스 관제 상태를 불러오지 못했습니다.");
      setProposalRun(null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadPlan();
  }, []);

  const coverage = useMemo(() => {
    if (!plan || plan.summary.totalSources === 0) return 0;
    return Math.round((plan.summary.indexedSources / plan.summary.totalSources) * 100);
  }, [plan]);

  if (isLoading) {
    return (
      <AdminLayout currentPage="source-ops">
        <div className="space-y-6">
          <Skeleton className="h-28 w-full bg-white/10" />
          <Skeleton className="h-80 w-full bg-white/10" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout currentPage="source-ops">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Badge className="mb-3 border-cyan-400/30 bg-cyan-500/10 text-cyan-100">
              backend source watch
            </Badge>
            <h1 className="text-3xl font-bold text-white">Compass 소스 관제</h1>
            <p className="mt-2 max-w-3xl text-sm text-gray-300">
              매체별 정책 URL과 문서 상태를 확인하는 읽기 전용 화면입니다. 수집과 청킹은 백엔드 에이전트가 후보를 만들고,
              운영자는 여기서 상태와 갱신 필요 여부를 확인하는 구조로 둡니다.
            </p>
          </div>
          <Button
            onClick={loadPlan}
            disabled={isRefreshing}
            className="bg-white text-gray-950 hover:bg-gray-200"
          >
            {isRefreshing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            새로고침
          </Button>
        </div>

        {error && (
          <Alert className="border-red-500/30 bg-red-950/40 text-red-100">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>소스 관제 오류</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {proposalError && (
          <Alert className="border-amber-500/30 bg-amber-950/30 text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>후보 프리뷰 오류</AlertTitle>
            <AlertDescription>{proposalError}</AlertDescription>
          </Alert>
        )}

        {plan && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <Card className="border-white/10 bg-white/5 text-white">
                <CardHeader className="pb-2">
                  <CardDescription className="text-gray-400">정책 소스</CardDescription>
                  <CardTitle className="text-3xl">{plan.summary.totalSources}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-gray-300">등록된 매체별 관제 후보</CardContent>
              </Card>
              <Card className="border-white/10 bg-white/5 text-white">
                <CardHeader className="pb-2">
                  <CardDescription className="text-gray-400">색인 커버리지</CardDescription>
                  <CardTitle className="text-3xl">{coverage}%</CardTitle>
                </CardHeader>
                <CardContent>
                  <Progress value={coverage} className="h-2" />
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-white/5 text-white">
                <CardHeader className="pb-2">
                  <CardDescription className="text-gray-400">갱신 필요</CardDescription>
                  <CardTitle className="text-3xl">{plan.summary.staleSources}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-gray-300">권장 주기 초과 소스</CardContent>
              </Card>
              <Card className="border-white/10 bg-white/5 text-white">
                <CardHeader className="pb-2">
                  <CardDescription className="text-gray-400">실행 모드</CardDescription>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Lock className="h-4 w-4 text-emerald-300" />
                    review-only
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-gray-300">크롤링/청킹/임베딩 실행 없음</CardContent>
              </Card>
            </div>

            <Alert className="border-emerald-500/30 bg-emerald-950/30 text-emerald-50">
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>운영 권장안</AlertTitle>
              <AlertDescription>{plan.scheduleRecommendation}</AlertDescription>
            </Alert>

            {proposalRun && (
              <Card className="border-cyan-400/20 bg-cyan-950/10 text-white">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Bot className="h-5 w-5 text-cyan-300" />
                        수집 후보 프리뷰
                      </CardTitle>
                      <CardDescription className="mt-2 text-gray-300">
                        DB 저장 없이 후보의 관련성, 차이 요약, 검토 우선순위를 미리 계산합니다.
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className="border-emerald-400/30 bg-emerald-500/10 text-emerald-100">
                        {proposalRun.mode}
                      </Badge>
                      <Badge className="border-white/20 bg-white/5 text-gray-200">
                        queue {proposalRun.queue?.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-white/10 hover:bg-transparent">
                          <TableHead className="text-gray-300">소스</TableHead>
                          <TableHead className="text-gray-300">관련성</TableHead>
                          <TableHead className="text-gray-300">차이 요약</TableHead>
                          <TableHead className="text-gray-300">안전</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {proposalRun.candidates.map((candidate) => (
                          <TableRow key={candidate.id} className="border-white/10 align-top">
                            <TableCell className="min-w-[180px]">
                              <div className="flex flex-col gap-1">
                                <div className="flex flex-wrap gap-2">
                                  <Badge variant="outline" className={vendorAccent[candidate.vendor]}>
                                    {candidate.vendor}
                                  </Badge>
                                  <Badge variant="outline" className={riskClassName(candidate.riskLevel)}>
                                    {candidate.riskLevel}
                                  </Badge>
                                </div>
                                <span className="font-medium text-white">{candidate.label}</span>
                                <span className="max-w-xs break-all text-xs text-gray-500">{candidate.url}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-2">
                                <Badge className={reviewClassName(candidate.review.relevanceLevel)}>
                                  {candidate.review.relevanceLevel} · {candidate.review.relevanceScore}
                                </Badge>
                                <span className="text-xs text-gray-400">
                                  {candidate.review.signals.slice(0, 3).join(" · ")}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-xl text-sm text-gray-300">
                              <p>{candidate.review.diffSummary}</p>
                              <p className="mt-2 text-xs text-cyan-100">{candidate.review.recommendation}</p>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-2">
                                <Badge className="bg-emerald-500/15 text-emerald-100">
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                  no apply
                                </Badge>
                                <span className="text-xs text-gray-500">
                                  index {String(candidate.wouldIndex)} · promote {String(candidate.wouldPromote)}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {plan.sources.map((source) => (
                <Card key={source.id} className="border-white/10 bg-gray-950/80 text-white">
                  <CardHeader className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={vendorAccent[source.vendor]}>
                        {source.vendor}
                      </Badge>
                      <Badge variant="outline" className="border-white/20 text-gray-200">
                        {sourceTypeLabel(source.sourceType)}
                      </Badge>
                      <Badge variant="outline" className={statusClassName(source.status)}>
                        {statusLabels[source.status]}
                      </Badge>
                    </div>
                    <div>
                      <CardTitle className="text-xl">{source.label}</CardTitle>
                      <CardDescription className="mt-1 break-all text-gray-400">
                        {source.url}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <Metric label="문서" value={source.matchedDocuments} />
                      <Metric label="색인" value={source.indexedDocuments} />
                      <Metric label="청크" value={source.totalChunks} />
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-gray-300">
                      <div className="mb-2 flex items-center gap-2 text-gray-100">
                        <Bot className="h-4 w-4 text-cyan-300" />
                        백엔드 판단
                      </div>
                      {source.recommendation}
                    </div>

                    {source.matchedDocumentTitles.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.18em] text-gray-500">matched documents</p>
                        {source.matchedDocumentTitles.map((title) => (
                          <p key={title} className="truncate text-sm text-gray-300">{title}</p>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>주기 {source.cadenceDays}일 · {source.discoveryMode === "exact_url" ? "정확 URL" : "도메인 탐색"}</span>
                      <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-200 hover:text-cyan-100">
                        원본 열기 <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="border-white/10 bg-white/5 text-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-cyan-300" />
                  안전 경계
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="text-gray-300">항목</TableHead>
                      <TableHead className="text-gray-300">상태</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.safetyNotes.map((note) => (
                      <TableRow key={note} className="border-white/10">
                        <TableCell className="text-gray-300">{note}</TableCell>
                        <TableCell>
                          <Badge className="bg-emerald-500/15 text-emerald-100">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            enforced
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function sourceTypeLabel(type: SourceOpsItem["sourceType"]) {
  if (type === "policy") return "정책";
  if (type === "help") return "도움말";
  return "진입점";
}

function statusClassName(status: SourceStatus) {
  if (status === "indexed") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
  if (status === "stale") return "border-amber-400/40 bg-amber-500/10 text-amber-100";
  if (status === "unavailable") return "border-red-400/40 bg-red-500/10 text-red-100";
  return "border-gray-400/40 bg-gray-500/10 text-gray-100";
}

function riskClassName(risk: ProposalCandidate["riskLevel"]) {
  if (risk === "high") return "border-red-400/40 bg-red-500/10 text-red-100";
  if (risk === "medium") return "border-amber-400/40 bg-amber-500/10 text-amber-100";
  return "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";
}

function reviewClassName(level: ProposalReview["relevanceLevel"]) {
  if (level === "high") return "bg-cyan-500/15 text-cyan-100";
  if (level === "medium") return "bg-amber-500/15 text-amber-100";
  if (level === "blocked") return "bg-red-500/15 text-red-100";
  return "bg-white/10 text-gray-200";
}
