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
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlan = async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      const response = await fetch("/api/admin/source-ops", { cache: "no-store" });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "소스 관제 상태를 불러오지 못했습니다.");
      }

      setPlan(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "소스 관제 상태를 불러오지 못했습니다.");
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
