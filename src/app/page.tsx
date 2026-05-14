"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CheckCircle,
  Clock,
  Database,
  FileSearch,
  History,
  Home,
  LockKeyhole,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import MainLayout from "@/components/layouts/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useLatestUpdate } from "@/hooks/useDashboardStats";

const ACCESS_REQUEST_URL = "https://sentinel.admate.ai.kr/access-request";
const ADMATE_HOME_URL = "https://home.admate.ai.kr";

const platformCategories = [
  {
    name: "Meta",
    description: "Facebook, Instagram 광고 정책과 소재 가이드",
    preset: "Meta 광고 정책에서 랜딩 URL과 소재 표현 기준을 근거 문서와 함께 확인해줘",
  },
  {
    name: "Google/YouTube",
    description: "Google Ads, YouTube 광고 정책과 제한 소재 기준",
    preset: "Google과 YouTube 광고 정책에서 제한 소재와 랜딩 기준을 근거 문서와 함께 확인해줘",
  },
  {
    name: "Naver",
    description: "네이버 광고 운영정책과 심사 기준",
    preset: "Naver 광고 운영정책에서 소재 심사 기준을 근거 문서와 함께 확인해줘",
  },
  {
    name: "Kakao",
    description: "카카오 광고 정책과 업종별 제한 기준",
    preset: "Kakao 광고 정책에서 업종 제한과 소재 심사 기준을 근거 문서와 함께 확인해줘",
  },
  {
    name: "Expansion",
    description: "TikTok, X 등 확장 플랫폼 정책 확인",
    preset: "확장 광고 플랫폼의 광고 정책에서 확인해야 할 제한 기준을 근거 문서와 함께 정리해줘",
  },
];

const deskSignals = [
  { label: "Query", value: "정책 질문 접수", icon: MessageSquare },
  { label: "Evidence", value: "문서 근거 대조", icon: BookOpen },
  { label: "Decision", value: "심사 리스크 분리", icon: ShieldCheck },
];

const evidenceLanes = [
  { label: "Source", value: "플랫폼 정책 원문", tone: "text-[#1F7A4D]" },
  { label: "Coverage", value: "근거 충분", tone: "text-[#176B42]" },
  { label: "Boundary", value: "답변 범위 표시", tone: "text-[#8A6418]" },
];

const primaryActions = [
  {
    title: "정책 질문",
    description: "플랫폼 정책과 심사 기준을 자연어로 확인합니다.",
    href: "/chat-ollama",
    icon: MessageSquare,
  },
  {
    title: "근거 검색",
    description: "답변에 연결된 문서와 출처를 함께 검토합니다.",
    href: "/chat-ollama?q=%EA%B4%91%EA%B3%A0%20%ED%94%8C%EB%9E%AB%ED%8F%BC%20%EC%A0%95%EC%B1%85%EA%B3%BC%20%EA%B7%BC%EA%B1%B0%20%EB%AC%B8%EC%84%9C%EB%A5%BC%20%EA%B2%80%EC%83%89%ED%95%B4%EC%A4%98",
    icon: FileSearch,
  },
  {
    title: "질문 이력",
    description: "이전 질문과 답변 흐름을 다시 확인합니다.",
    href: "/history",
    icon: History,
  },
];

export default function HomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: latestUpdate, isLoading: updateLoading, error: updateError } = useLatestUpdate();
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      inputRef.current?.focus();
      return;
    }

    router.push(`/chat-ollama?q=${encodeURIComponent(trimmedQuestion)}`);
  };

  const applyPlatformPreset = (preset: string) => {
    setQuestion(preset);
    inputRef.current?.focus();
  };

  return (
    <MainLayout>
      <div className="min-h-screen bg-[#F4F5F0] pt-28 pb-14 text-[#111713]">
        <section className="mx-auto max-w-7xl px-4 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr] lg:items-stretch"
          >
            <div className="rounded-lg border border-[#D6D8CD] bg-[#FBFBF7] p-5 shadow-sm sm:p-7">
              <Badge className="mb-5 rounded-md border-[#B9D7C4] bg-[#EAF5EE] px-3 py-1 text-[#176B42] hover:bg-[#EAF5EE]">
                Policy Evidence Desk
              </Badge>
              <div className="max-w-3xl space-y-4">
                <h1 className="font-nanum text-3xl font-bold leading-tight text-[#111713] sm:text-5xl">
                  AdMate Compass
                </h1>
                <p className="font-nanum text-lg leading-8 text-[#34423A] sm:text-xl">
                  광고 심사 질문을 근거 문서와 함께 판정하는 정책 인텔리전스 데스크입니다.
                </p>
                <p className="font-nanum text-sm leading-7 text-[#5F6C62]">
                  플랫폼별 정책 원문, 출처 상태, 답변 범위를 한 화면에 묶어 광고 운영자가 반복 확인하는 기준을 빠르게 고정합니다.
                </p>
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {deskSignals.map((signal) => {
                  const Icon = signal.icon;
                  return (
                    <div key={signal.label} className="rounded-lg border border-[#E0E2D9] bg-white px-4 py-3">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#6D756C]">
                        <Icon className="h-4 w-4 text-[#1F7A4D]" />
                        {signal.label}
                      </div>
                      <p className="mt-2 font-nanum text-sm font-semibold text-[#172018]">{signal.value}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-[#D6D8CD] bg-[#FFFFFF] p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-nanum text-xl font-bold text-[#111713]">정책 조회</h2>
                  <p className="mt-2 font-nanum text-sm leading-6 text-[#667066]">
                    질문을 보내면 답변과 근거 패널이 함께 열립니다.
                  </p>
                </div>
                <div className="rounded-lg border border-[#C6D9CB] bg-[#EDF7EF] p-3 text-[#1F7A4D]">
                  <Search className="h-5 w-5" />
                </div>
              </div>

              <form onSubmit={submitQuestion} className="space-y-4">
                <div className="relative">
                  <Input
                    ref={inputRef}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="예: Meta 광고 랜딩 URL 정책에서 확인해야 할 기준은?"
                    className="h-14 rounded-lg border-[#D4D8CE] bg-[#FBFBF7] pr-14 text-base text-[#111713] placeholder:text-[#8B9388] focus:border-[#1F7A4D] focus:ring-[#E7F4EA]"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="absolute right-2 top-2 h-10 w-10 rounded-lg bg-[#111713] text-white hover:bg-[#243028]"
                    aria-label="정책 질문 제출"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>

                {!user && (
                  <div className="flex items-start gap-2 rounded-lg border border-[#E6C36A] bg-[#FFF7DA] p-3 text-sm text-[#6B5315]">
                    <LockKeyhole className="mt-0.5 h-4 w-4 flex-none" />
                    <p>답변 생성 화면에서 로그인이 필요할 수 있습니다. 접근 권한은 Sentinel에서 요청합니다.</p>
                  </div>
                )}
              </form>

              <div className="mt-5 grid gap-2">
                {platformCategories.slice(0, 3).map((category) => (
                  <button
                    key={category.name}
                    type="button"
                    onClick={() => applyPlatformPreset(category.preset)}
                    className="flex items-center justify-between rounded-lg border border-[#E0E2D9] bg-[#FBFBF7] px-4 py-3 text-left transition hover:border-[#9AB9A3] hover:bg-[#F0F7F2]"
                  >
                    <span className="font-nanum text-sm font-semibold text-[#172018]">{category.name}</span>
                    <ArrowRight className="h-4 w-4 text-[#5C695F]" />
                  </button>
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-[#E0E2D9] bg-[#FBFBF7] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="font-nanum text-sm font-bold text-[#172018]">Evidence queue</p>
                  <span className="rounded-md border border-[#D8DCCF] bg-white px-2 py-1 text-[11px] font-semibold text-[#6D756C]">
                    Review ready
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {evidenceLanes.map((lane) => (
                    <div key={lane.label} className="rounded-md border border-[#E6E8DF] bg-white px-3 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7A8379]">{lane.label}</p>
                      <p className={`mt-1 font-nanum text-sm font-bold ${lane.tone}`}>{lane.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section className="mx-auto mt-5 grid max-w-7xl grid-cols-1 gap-3 px-4 sm:px-6 md:grid-cols-3">
          {primaryActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.title} href={action.href}>
                <Card className="h-full rounded-lg border-[#D6D8CD] bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#9AB9A3]">
                  <CardContent className="flex h-full items-start gap-4 p-5">
                    <div className="rounded-lg border border-[#DFE5DA] bg-[#F2F7EE] p-3 text-[#1F7A4D]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-nanum text-base font-bold text-[#111713]">{action.title}</h3>
                      <p className="mt-2 font-nanum text-sm leading-6 text-[#667066]">{action.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>

        <section className="mx-auto mt-5 grid max-w-7xl grid-cols-1 gap-3 px-4 sm:px-6 md:grid-cols-2">
          <a href={ACCESS_REQUEST_URL} target="_blank" rel="noopener noreferrer">
            <Card className="h-full rounded-lg border-[#D6D8CD] bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#D8B45F]">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg border border-[#E9D59B] bg-[#FFF8E6] p-3 text-[#8A6418]">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-nanum text-base font-bold text-[#111713]">접근 요청</h3>
                    <p className="mt-2 font-nanum text-sm text-[#667066]">Sentinel에서 Compass 접근 권한을 요청합니다.</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#5C695F]" />
              </CardContent>
            </Card>
          </a>

          <a href={ADMATE_HOME_URL} target="_blank" rel="noopener noreferrer">
            <Card className="h-full rounded-lg border-[#D6D8CD] bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#9AB9A3]">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg border border-[#DFE5DA] bg-[#F2F7EE] p-3 text-[#1F7A4D]">
                    <Home className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-nanum text-base font-bold text-[#111713]">AdMate 홈</h3>
                    <p className="mt-2 font-nanum text-sm text-[#667066]">AdMate 제품군 연결 관문으로 이동합니다.</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-[#5C695F]" />
              </CardContent>
            </Card>
          </a>
        </section>

        <section className="mx-auto mt-10 max-w-7xl px-4 sm:px-6">
          <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <h2 className="font-nanum text-2xl font-bold text-[#111713]">정책 범위</h2>
              <p className="mt-2 font-nanum text-sm text-[#667066]">
                플랫폼별 프리셋을 선택해 질문을 빠르게 구성합니다.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {platformCategories.map((category) => (
              <button
                key={category.name}
                type="button"
                onClick={() => applyPlatformPreset(category.preset)}
                className="rounded-lg border border-[#D6D8CD] bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#9AB9A3] hover:bg-[#FBFBF7]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-nanum text-base font-bold text-[#111713]">{category.name}</span>
                  <Search className="h-4 w-4 text-[#1F7A4D]" />
                </div>
                <p className="mt-3 font-nanum text-sm leading-6 text-[#667066]">{category.description}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-10 grid max-w-7xl grid-cols-1 gap-4 px-4 sm:px-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="rounded-lg border-[#D6D8CD] bg-white shadow-sm">
            <CardContent className="p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-lg border border-[#DFE5DA] bg-[#F2F7EE] p-3 text-[#1F7A4D]">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-nanum text-xl font-bold text-[#111713]">최근 업데이트</h2>
                  <p className="font-nanum text-sm text-[#667066]">현재 색인 업데이트 신호를 표시합니다.</p>
                </div>
              </div>

              {updateLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-2/3 bg-[#E4E6DE]" />
                  <Skeleton className="h-4 w-full bg-[#E4E6DE]" />
                  <Skeleton className="h-4 w-4/5 bg-[#E4E6DE]" />
                </div>
              ) : updateError ? (
                <p className="font-nanum text-sm leading-6 text-[#667066]">
                  최근 업데이트 정보를 불러오지 못했습니다. 정책 검색은 채팅 데스크에서 계속 사용할 수 있습니다.
                </p>
              ) : latestUpdate?.hasUpdates ? (
                <div className="space-y-3">
                  <p className="font-nanum text-sm leading-6 text-[#34423A]">{latestUpdate.message}</p>
                  <p className="font-nanum text-xs text-[#6D756C]">기준: {latestUpdate.displayDate}</p>
                </div>
              ) : (
                <p className="font-nanum text-sm leading-6 text-[#667066]">
                  표시할 최근 업데이트가 없습니다. 문서 업데이트 데이터가 수집되면 이 영역에 표시됩니다.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg border-[#D6D8CD] bg-white shadow-sm">
            <CardContent className="p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-lg border border-[#DFE5DA] bg-[#F2F7EE] p-3 text-[#1F7A4D]">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-nanum text-xl font-bold text-[#111713]">운영 원칙</h2>
                  <p className="font-nanum text-sm text-[#667066]">답변과 근거를 분리해 검토합니다.</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  "확인된 근거가 있으면 출처를 보존",
                  "생성 제한 상태에서도 근거 패널 유지",
                  "범위 밖 질문은 noData로 분리",
                  "운영 화면은 권한 확인 후 접근",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2 rounded-lg border border-[#E0E2D9] bg-[#FBFBF7] p-3">
                    <CheckCircle className="mt-0.5 h-4 w-4 flex-none text-[#1F7A4D]" />
                    <p className="font-nanum text-sm leading-6 text-[#34423A]">{item}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </MainLayout>
  );
}
