"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Clock, Database, FileSearch, History, Home, LockKeyhole, MessageSquare, Search, Send, Settings, ShieldCheck } from "lucide-react";
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
    description: "Facebook, Instagram 광고 정책과 가이드",
    preset: "Meta 광고 정책과 가이드에서 확인해야 할 주요 사항을 검색해줘",
  },
  {
    name: "Google/YouTube",
    description: "Google Ads, YouTube 광고 정책",
    preset: "Google과 YouTube 광고 정책 및 가이드를 검색해줘",
  },
  {
    name: "Naver",
    description: "네이버 광고 심사와 운영 가이드",
    preset: "Naver 광고 정책과 심사 가이드를 검색해줘",
  },
  {
    name: "Kakao",
    description: "카카오 광고 정책과 소재 기준",
    preset: "Kakao 광고 정책과 소재 심사 기준을 검색해줘",
  },
  {
    name: "X/TikTok",
    description: "X, TikTok 등 확장 플랫폼 정책",
    preset: "X와 TikTok 광고 정책에서 확인할 내용을 검색해줘",
  },
];

const primaryActions = [
  {
    title: "정책 질문하기",
    description: "정책과 가이드에 대해 자연어로 질문합니다.",
    href: "/chat-ollama",
    icon: MessageSquare,
  },
  {
    title: "문서 검색",
    description: "RAG 기반 검색으로 관련 문서와 출처를 확인합니다.",
    href: "/chat-ollama?q=%EA%B4%91%EA%B3%A0%20%ED%94%8C%EB%9E%AB%ED%8F%BC%20%EC%A0%95%EC%B1%85%EA%B3%BC%20%EA%B0%80%EC%9D%B4%EB%93%9C%EB%A5%BC%20%EB%AC%B8%EC%84%9C%EC%97%90%EC%84%9C%20%EA%B2%80%EC%83%89%ED%95%B4%EC%A4%98",
    icon: FileSearch,
  },
  {
    title: "질문 히스토리",
    description: "이전 질문과 답변 이력을 다시 확인합니다.",
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
      <div className="min-h-screen pt-28 pb-16">
        <section className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            <div className="space-y-5">
              <Badge className="border-white/20 bg-white/10 text-blue-100 hover:bg-white/10">
                compass.admate.ai.kr
              </Badge>
              <div className="space-y-4">
                <h1 className="font-nanum text-4xl font-bold leading-tight text-white md:text-6xl">
                  AdMate Compass
                </h1>
                <p className="max-w-3xl font-nanum text-xl leading-relaxed text-blue-100 md:text-2xl">
                  광고 플랫폼 정책과 가이드를 검색하고 답하는 Policy Intelligence Agent
                </p>
                <p className="max-w-3xl font-nanum text-base leading-7 text-gray-300">
                  Meta, Google/YouTube, Naver, Kakao 등 광고 운영에 필요한 정책과 가이드를
                  RAG 기반 답변으로 확인합니다. 답변은 기존 출처와 근거 표시 흐름을 그대로 사용합니다.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => inputRef.current?.focus()}
                className="h-12 rounded-lg bg-blue-600 px-5 text-white hover:bg-blue-700"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                정책 질문하기
              </Button>
              <Link href={primaryActions[1].href}>
                <Button
                  variant="outline"
                  className="h-12 rounded-lg border-white/30 bg-white/5 px-5 text-white hover:bg-white/10"
                >
                  <FileSearch className="mr-2 h-4 w-4" />
                  문서 검색하기
                </Button>
              </Link>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Card className="border-white/15 bg-slate-950/70 shadow-2xl backdrop-blur">
              <CardContent className="p-6">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-nanum text-2xl font-bold text-white">바로 질문하기</h2>
                    <p className="mt-2 font-nanum text-sm text-gray-300">
                      질문을 입력하면 기존 Compass 채팅 화면으로 이동해 답변을 생성합니다.
                    </p>
                  </div>
                  <div className="rounded-lg border border-blue-400/30 bg-blue-500/15 p-3 text-blue-100">
                    <Search className="h-5 w-5" />
                  </div>
                </div>

                <form onSubmit={submitQuestion} className="space-y-4">
                  <div className="relative">
                    <Input
                      ref={inputRef}
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="예: Meta 랜딩 URL 정책에서 확인해야 할 기준은?"
                      className="h-14 rounded-lg border-white/20 bg-white/10 pl-4 pr-14 text-base text-white placeholder:text-gray-400"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className="absolute right-2 top-2 h-10 w-10 rounded-lg bg-blue-600 hover:bg-blue-700"
                      aria-label="정책 질문 제출"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  {!user && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-300/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                      <LockKeyhole className="mt-0.5 h-4 w-4 flex-none" />
                      <p>답변 생성 화면에서 로그인이 필요할 수 있습니다. 접근 권한이 없으면 Sentinel에서 요청하세요.</p>
                    </div>
                  )}
                </form>
              </CardContent>
            </Card>
          </motion.div>
        </section>

        <section className="mx-auto mt-10 grid max-w-7xl grid-cols-1 gap-4 px-6 md:grid-cols-3">
          {primaryActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.title} href={action.href}>
                <Card className="h-full border-white/15 bg-white/[0.08] transition hover:-translate-y-1 hover:bg-white/[0.12]">
                  <CardContent className="flex h-full items-start gap-4 p-5">
                    <div className="rounded-lg border border-white/15 bg-white/10 p-3 text-blue-100">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-nanum text-lg font-bold text-white">{action.title}</h3>
                      <p className="mt-2 font-nanum text-sm leading-6 text-gray-300">{action.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </section>

        <section className="mx-auto mt-5 grid max-w-7xl grid-cols-1 gap-4 px-6 md:grid-cols-2">
          <a href={ACCESS_REQUEST_URL} target="_blank" rel="noopener noreferrer">
            <Card className="h-full border-white/15 bg-white/[0.08] transition hover:-translate-y-1 hover:bg-white/[0.12]">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg border border-white/15 bg-white/10 p-3 text-blue-100">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-nanum text-lg font-bold text-white">접근 요청</h3>
                    <p className="mt-2 font-nanum text-sm text-gray-300">Sentinel에서 Compass 접근 권한을 요청합니다.</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-300" />
              </CardContent>
            </Card>
          </a>

          <a href={ADMATE_HOME_URL} target="_blank" rel="noopener noreferrer">
            <Card className="h-full border-white/15 bg-white/[0.08] transition hover:-translate-y-1 hover:bg-white/[0.12]">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg border border-white/15 bg-white/10 p-3 text-blue-100">
                    <Home className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-nanum text-lg font-bold text-white">AdMate 홈</h3>
                    <p className="mt-2 font-nanum text-sm text-gray-300">AdMate 전체 제품과 연결 관문으로 이동합니다.</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-300" />
              </CardContent>
            </Card>
          </a>
        </section>

        <section className="mx-auto mt-14 max-w-7xl px-6">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-nanum text-2xl font-bold text-white">정책/플랫폼 카테고리</h2>
              <p className="mt-2 font-nanum text-sm text-gray-300">카테고리를 선택하면 질문 입력창에 검색 프리셋이 채워집니다.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            {platformCategories.map((category) => (
              <button
                key={category.name}
                type="button"
                onClick={() => applyPlatformPreset(category.preset)}
                className="rounded-lg border border-white/15 bg-slate-950/45 p-4 text-left transition hover:-translate-y-1 hover:border-blue-300/50 hover:bg-white/10"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-nanum text-base font-bold text-white">{category.name}</span>
                  <Search className="h-4 w-4 text-blue-200" />
                </div>
                <p className="mt-3 font-nanum text-sm leading-6 text-gray-300">{category.description}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="mx-auto mt-14 grid max-w-7xl grid-cols-1 gap-5 px-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-white/15 bg-slate-950/50">
            <CardContent className="p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-lg border border-white/15 bg-white/10 p-3 text-blue-100">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-nanum text-xl font-bold text-white">최근 업데이트</h2>
                  <p className="font-nanum text-sm text-gray-300">현재 repo에서 확인 가능한 업데이트 정보만 표시합니다.</p>
                </div>
              </div>

              {updateLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-2/3 bg-white/10" />
                  <Skeleton className="h-4 w-full bg-white/10" />
                  <Skeleton className="h-4 w-4/5 bg-white/10" />
                </div>
              ) : updateError ? (
                <p className="font-nanum text-sm leading-6 text-gray-300">
                  최근 업데이트 정보를 불러오지 못했습니다. 정책 검색 기능은 기존 채팅 흐름에서 계속 사용할 수 있습니다.
                </p>
              ) : latestUpdate?.hasUpdates ? (
                <div className="space-y-3">
                  <p className="font-nanum text-sm leading-6 text-gray-200">{latestUpdate.message}</p>
                  <p className="font-nanum text-xs text-gray-400">기준: {latestUpdate.displayDate}</p>
                </div>
              ) : (
                <p className="font-nanum text-sm leading-6 text-gray-300">
                  표시할 최근 업데이트가 없습니다. 문서 업데이트 데이터가 수집되면 이 영역에 표시됩니다.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/15 bg-slate-950/50">
            <CardContent className="p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-lg border border-white/15 bg-white/10 p-3 text-blue-100">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-nanum text-xl font-bold text-white">관리자 영역</h2>
                  <p className="font-nanum text-sm text-gray-300">
                    관리자 도구는 공개 루트에서 직접 호출하지 않으며, 권한 확인은 각 관리자 화면에서 진행합니다.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-white/15 bg-white/5 p-4">
                <div className="flex items-start gap-3">
                  <Settings className="mt-0.5 h-5 w-5 flex-none text-gray-300" />
                  <div className="space-y-2">
                    <p className="font-nanum text-sm leading-6 text-gray-300">
                      관리자 문서 관리, 모니터링, 사용자/로그 관리는 로그인 후 각 관리자 화면에서 확인합니다.
                    </p>
                    <p className="font-nanum text-xs leading-5 text-gray-400">
                      공개 landing에서는 정책 검색 진입과 제품 안내만 노출하고, 관리자 상태 점검은 별도 운영 화면으로 분리합니다.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </MainLayout>
  );
}
