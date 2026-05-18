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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useLatestUpdate } from "@/hooks/useDashboardStats";

const ACCESS_REQUEST_URL = "https://home.admate.ai.kr/access-request?product=compass";
const ADMATE_HOME_URL = "https://home.admate.ai.kr";

const platformCategories = [
  {
    name: "Meta",
    short: "META",
    area: "랜딩/소재",
    coverage: "원문+발췌",
    state: "색인 확인",
    description: "Facebook, Instagram 광고 정책과 소재 가이드",
    preset: "Meta 광고 정책에서 랜딩 URL과 소재 표현 기준을 근거 문서와 함께 확인해줘",
  },
  {
    name: "Google/YouTube",
    short: "GOOG",
    area: "제한 소재",
    coverage: "정책 링크",
    state: "근거 확인",
    description: "Google Ads, YouTube 광고 정책과 제한 소재 기준",
    preset: "Google과 YouTube 광고 정책에서 제한 소재와 랜딩 기준을 근거 문서와 함께 확인해줘",
  },
  {
    name: "Naver",
    short: "NVR",
    area: "심사 기준",
    coverage: "문서 구간",
    state: "검토 가능",
    description: "네이버 광고 운영정책과 심사 기준",
    preset: "Naver 광고 운영정책에서 소재 심사 기준을 근거 문서와 함께 확인해줘",
  },
  {
    name: "Kakao",
    short: "KKO",
    area: "업종 제한",
    coverage: "원문 대조",
    state: "근거 확인",
    description: "카카오 광고 정책과 업종별 제한 기준",
    preset: "Kakao 광고 정책에서 업종 제한과 소재 심사 기준을 근거 문서와 함께 확인해줘",
  },
  {
    name: "Expansion",
    short: "EXP",
    area: "확장 매체",
    coverage: "범위 표시",
    state: "보강 대상",
    description: "TikTok, X 등 확장 플랫폼 정책 확인",
    preset: "확장 광고 플랫폼의 광고 정책에서 확인해야 할 제한 기준을 근거 문서와 함께 정리해줘",
  },
];

const deskSignals = [
  { label: "질문", value: "질문 수신", detail: "정책 문맥 고정", icon: MessageSquare },
  { label: "근거", value: "근거 대조", detail: "원문/출처 검토", icon: BookOpen },
  { label: "검토", value: "팀장 검토", detail: "중복/충돌 분리", icon: ShieldCheck },
];

const evidenceLanes = [
  { label: "원문 링크", value: "보존", detail: "대표 URL 고정", tone: "#1F7A4D" },
  { label: "발췌", value: "문단 단위", detail: "문서 구간 표시", tone: "#9A6A15" },
  { label: "충돌", value: "팀장 검토", detail: "중복/차이 분리", tone: "#304B7A" },
];

const primaryActions = [
  {
    title: "정책 질문",
    description: "플랫폼 정책과 심사 기준을 자연어로 확인합니다.",
    href: "/chat-ollama",
    icon: MessageSquare,
  },
  {
    title: "출처 원장 탐색",
    description: "답변에 연결된 원문 링크와 문서 구간을 함께 검토합니다.",
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

const reviewerRows = [
  { label: "01", value: "검색된 문서 후보", state: "질문 범위와 플랫폼 고정" },
  { label: "02", value: "원문/발췌 대조", state: "대표 출처와 문단 확인" },
  { label: "03", value: "충돌/범위 밖 표시", state: "최종 답변 전 경계 검토" },
];

const guardrails = [
  "확인된 근거가 있으면 출처를 보존",
  "생성 제한 상태에서도 근거 패널 유지",
  "범위 밖 질문은 답변 보류로 분리",
  "운영 화면은 권한 확인 후 접근",
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
      <main className="relative min-h-[100dvh] overflow-x-hidden bg-[#EEF2ED] text-[#101820]">
        <div
          className="pointer-events-none fixed inset-0 opacity-[0.58]"
          aria-hidden="true"
          style={{
            backgroundImage:
              "linear-gradient(rgba(16,24,32,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(16,24,32,0.035) 1px, transparent 1px)",
            backgroundSize: "34px 34px",
            maskImage: "linear-gradient(to bottom, black, transparent 82%)",
          }}
        />

        <section className="relative mx-auto max-w-[1400px] px-4 pb-10 pt-28 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
            className="grid gap-4 lg:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]"
          >
            <section className="relative overflow-hidden rounded-[12px] border border-[#CBD6CD] bg-[#FBFAF4] p-5 shadow-[0_28px_80px_rgba(20,32,28,0.12)] sm:p-7 lg:p-8">
              <div
                className="absolute inset-0 opacity-80"
                aria-hidden="true"
                style={{
                  background:
                    "linear-gradient(115deg, transparent 0 56%, rgba(31,122,77,0.08) 56% 57%, transparent 57% 100%), linear-gradient(180deg, rgba(255,255,255,0.82), rgba(234,242,235,0.48))",
                }}
              />
              <div className="relative grid min-h-[360px] content-between gap-8 lg:min-h-[520px]">
                <div>
                  <div className="mb-5 flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-7 items-center rounded-[8px] border border-[#9AB9A3] bg-[#EAF5EE] px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1F7A4D]">
                      정책 근거 데스크
                    </span>
                    <span className="inline-flex h-7 items-center rounded-[8px] border border-[#D6CCB0] bg-[#FFF7DA] px-3 text-[11px] font-semibold text-[#72591A]">
                      3단계 검토
                    </span>
                  </div>

                  <h1 className="flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-3 text-[clamp(2.6rem,6vw,5.8rem)] font-black leading-[0.94] tracking-[0] text-[#101820]">
                    <span>AdMate</span>
                    <span className="inline-flex items-center rounded-[999px] border border-[#9AB9A3] bg-[#EAF5EE] px-4 py-2 text-[clamp(0.88rem,1.5vw,1.2rem)] font-black leading-none text-[#1F7A4D] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                      출처 검증
                    </span>
                    <span>Compass</span>
                  </h1>
                  <p className="mt-6 max-w-3xl text-lg leading-8 text-[#34423A] sm:text-xl">
                    광고 정책 질문을 근거 원문, 출처 품질, 검토 경계와 함께 판정하는 정책 인텔리전스 데스크입니다.
                  </p>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-[#637168]">
                    운영자는 답변 문장보다 먼저 어떤 문서가 쓰였고, 어떤 범위는 보류됐는지 확인합니다.
                    Compass는 그 판단 순서를 화면 구조로 고정합니다.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {deskSignals.map((signal, index) => {
                    const Icon = signal.icon;
                    return (
                      <motion.article
                        key={signal.label}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.08 * index, ease: [0.32, 0.72, 0, 1] }}
                        className="rounded-[10px] border border-[#D6DDD5] bg-white/72 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] sm:p-4"
                      >
                        <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B786E] sm:text-[11px] sm:tracking-[0.12em]">
                          {signal.label}
                          <Icon className="h-4 w-4 text-[#1F7A4D]" aria-hidden="true" />
                        </div>
                        <strong className="mt-4 block text-sm font-black text-[#101820] sm:mt-5 sm:text-lg">{signal.value}</strong>
                        <span className="mt-1 hidden text-xs font-medium text-[#6B786E] sm:block">{signal.detail}</span>
                      </motion.article>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="rounded-[12px] border border-white/12 bg-[#F7F5EE] p-4 text-[#101820] shadow-[0_30px_90px_rgba(0,0,0,0.24)] sm:p-5">
              <div className="rounded-[10px] border border-[#CBD6CD] bg-[#FFFDF7] p-4 sm:p-5">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#477C63]">근거와 함께 질문</p>
                    <h2 className="mt-2 text-2xl font-black tracking-[0] text-[#101820]">정책 조회</h2>
                    <p className="mt-2 text-sm leading-6 text-[#5D6C63]">
                      질문을 보내면 답변과 근거 패널이 함께 열립니다.
                    </p>
                  </div>
                  <div className="grid h-12 w-12 place-items-center rounded-[10px] border border-[#BED2C2] bg-[#EAF5EE] text-[#1F7A4D]">
                    <Search className="h-5 w-5" aria-hidden="true" />
                  </div>
                </div>

                <form onSubmit={submitQuestion} className="space-y-4">
                  <div className="relative">
                    <Input
                      ref={inputRef}
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="정책 기준을 질문하세요"
                      className="h-14 rounded-[10px] border-[#C9D2CC] bg-[#F7F5EE] pr-14 text-base text-[#101820] placeholder:text-[#7D8B82] focus:border-[#1F7A4D] focus:ring-[#E7F4EA]"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className="absolute right-2 top-2 h-10 w-10 rounded-[8px] bg-[#101820] text-white transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#26342E] active:scale-[0.98]"
                      aria-label="정책 질문 제출"
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>

                  {!user && (
                    <div className="flex items-start gap-2 rounded-[10px] border border-[#E2C46C] bg-[#FFF7DA] p-3 text-sm leading-6 text-[#6B5315]">
                      <LockKeyhole className="mt-1 h-4 w-4 flex-none" aria-hidden="true" />
                      <p>답변 생성 화면에서 로그인이 필요할 수 있습니다. 접근 권한은 AdMate 가입 요청으로 확인합니다.</p>
                    </div>
                  )}
                </form>

                <div className="mt-5 rounded-[10px] border border-[#D9E1DA] bg-[#F3F7F2] p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-[#477C63]">근거 원장 미리보기</p>
                    <span className="rounded-[8px] border border-[#CBD6CD] bg-white px-2 py-1 text-[11px] font-bold text-[#667066]">
                      답변과 함께 표시
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {evidenceLanes.map((lane) => (
                      <div key={lane.label} className="rounded-[8px] border border-[#D9E1DA] bg-white px-3 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7D8B82]">{lane.label}</p>
                        <p className="mt-2 text-sm font-black" style={{ color: lane.tone }}>
                          {lane.value}
                        </p>
                        <p className="mt-1 text-[11px] text-[#667066]">{lane.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 grid gap-2">
                  {platformCategories.slice(0, 3).map((category) => (
                    <button
                      key={category.name}
                      type="button"
                      onClick={() => applyPlatformPreset(category.preset)}
                      className="group grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border border-[#D9E1DA] bg-white px-3 py-3 text-left transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:border-[#9AB9A3] hover:bg-[#F0F7F2]"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-[#101820] text-[10px] font-black text-white">
                        {category.short}
                      </span>
                      <span className="min-w-0">
                        <strong className="block text-sm font-black text-[#172018]">{category.name}</strong>
                        <span className="block text-xs leading-5 text-[#667066]">{category.area} · {category.coverage} · {category.state}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 text-[#5C695F] transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-[10px] border border-[#C9D2CC] bg-[#121C1F] p-4 text-white">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-black">근거 확인 순서</p>
                  <span className="rounded-[8px] border border-white/14 bg-white/8 px-2.5 py-1 text-[11px] font-semibold text-white/62">
                    검토 준비
                  </span>
                </div>
                <div className="grid gap-2">
                  {reviewerRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 rounded-[8px] border border-white/10 bg-white/[0.055] px-3 py-3">
                      <span className="text-xs font-black text-[#8FD7B8]">{row.label}</span>
                      <span className="min-w-0">
                        <strong className="block text-sm font-black text-white">{row.value}</strong>
                        <span className="mt-1 block text-xs leading-5 text-white/48">{row.state}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </motion.div>
        </section>

        <section className="relative mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 pb-8 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
          <div className="rounded-[12px] border border-[#CBD6CD] bg-[#FBFAF4] p-5 shadow-[0_20px_56px_rgba(20,32,28,0.08)]">
            <div className="mb-5 flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-[10px] border border-[#9AB9A3] bg-[#EAF5EE] text-[#1F7A4D]">
                <Database className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#477C63]">출처 장부</p>
                <h2 className="text-xl font-black tracking-[0] text-[#101820]">정책 범위</h2>
              </div>
            </div>
            <div className="grid gap-2">
              {platformCategories.map((category) => (
                <button
                  key={category.name}
                  type="button"
                  onClick={() => applyPlatformPreset(category.preset)}
                  className="group grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border border-[#D9E1DA] bg-white px-3 py-3 text-left transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:border-[#9AB9A3] hover:bg-[#F0F7F2]"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-[8px] border border-[#CBD6CD] bg-[#101820] text-[10px] font-black text-white">
                    {category.short}
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-sm font-black text-[#101820]">{category.name}</strong>
                    <span className="block text-xs leading-5 text-[#667066]">{category.area} · {category.coverage} · {category.state}</span>
                  </span>
                  <Search className="h-4 w-4 text-[#1F7A4D]" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {primaryActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link key={action.title} href={action.href} className="group block h-full">
                  <article className="flex h-full min-h-[210px] flex-col justify-between rounded-[12px] border border-[#CBD6CD] bg-[#F7F5EE] p-5 text-[#101820] shadow-[0_20px_56px_rgba(20,32,28,0.1)] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1">
                    <div>
                      <div className="grid h-11 w-11 place-items-center rounded-[10px] border border-[#C9D2CC] bg-white text-[#1F7A4D]">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <h3 className="mt-6 text-xl font-black tracking-[0]">{action.title}</h3>
                      <p className="mt-3 text-sm leading-6 text-[#667066]">{action.description}</p>
                    </div>
                    <span className="mt-7 inline-flex items-center gap-2 text-sm font-black text-[#101820]">
                      열기
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden="true" />
                    </span>
                  </article>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="relative mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-4 pb-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
          <div className="rounded-[12px] border border-white/10 bg-[#F7F5EE] p-5 text-[#101820] shadow-[0_24px_70px_rgba(0,0,0,0.2)] sm:p-6">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#477C63]">팀장 검토 흐름</p>
                <h2 className="mt-2 text-2xl font-black tracking-[0]">후보 답변을 합치기 전에 충돌을 먼저 봅니다.</h2>
              </div>
              <span className="w-fit rounded-[8px] border border-[#C9D2CC] bg-white px-3 py-1 text-[11px] font-bold text-[#667066]">
                기본 제공자 유지
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              {reviewerRows.map((row, index) => (
                <article key={row.label} className="rounded-[10px] border border-[#D9E1DA] bg-white p-4">
                  <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#7D8B82]">{row.label}</span>
                  <strong className="mt-5 block text-lg font-black text-[#101820]">{row.value}</strong>
                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#E7ECE8]">
                    <div
                      className="h-full rounded-full bg-[#477C63]"
                      style={{ width: `${50 + index * 22}%` }}
                    />
                  </div>
                  <em className="mt-3 block text-xs not-italic text-[#667066]">{row.state}</em>
                </article>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <article className="rounded-[12px] border border-[#26342E] bg-[#101820] p-5 shadow-[0_20px_56px_rgba(20,32,28,0.14)]">
              <div className="mb-5 flex items-center gap-3">
                <Clock className="h-5 w-5 text-[#E7C66A]" aria-hidden="true" />
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/42">문서 업데이트</p>
                  <h2 className="text-xl font-black tracking-[0] text-white">최근 업데이트</h2>
                </div>
              </div>
              {updateLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-2/3 bg-white/12" />
                  <Skeleton className="h-4 w-full bg-white/12" />
                  <Skeleton className="h-4 w-4/5 bg-white/12" />
                </div>
              ) : updateError ? (
                <p className="text-sm leading-6 text-white/58">
                  최근 업데이트 정보를 불러오지 못했습니다. 정책 검색은 채팅 데스크에서 계속 사용할 수 있습니다.
                </p>
              ) : latestUpdate?.hasUpdates ? (
                <div className="space-y-3">
                  <p className="text-sm leading-6 text-white/72">{latestUpdate.message}</p>
                  <p className="text-xs text-white/42">기준: {latestUpdate.displayDate}</p>
                </div>
              ) : (
                <p className="text-sm leading-6 text-white/58">
                  표시할 최근 업데이트가 없습니다. 문서 업데이트 데이터가 수집되면 이 영역에 표시됩니다.
                </p>
              )}
            </article>

            <article className="rounded-[12px] border border-[#26342E] bg-[#101820] p-5 shadow-[0_20px_56px_rgba(20,32,28,0.14)]">
              <div className="mb-5 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-[#8FD7B8]" aria-hidden="true" />
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/42">답변 안전 기준</p>
                  <h2 className="text-xl font-black tracking-[0] text-white">운영 원칙</h2>
                </div>
              </div>
              <div className="grid gap-2">
                {guardrails.map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-[8px] border border-white/8 bg-white/[0.04] p-3">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#8FD7B8]" aria-hidden="true" />
                    <p className="text-sm leading-6 text-white/68">{item}</p>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className="relative mx-auto grid max-w-[1400px] grid-cols-1 gap-3 px-4 pb-16 sm:px-6 md:grid-cols-2 lg:px-8">
          <a href={ACCESS_REQUEST_URL} target="_blank" rel="noopener noreferrer" className="group block">
            <article className="flex min-h-[128px] items-center justify-between gap-4 rounded-[12px] border border-[#D6B854] bg-[#FFF7DA] p-5 text-[#101820] shadow-[0_18px_48px_rgba(20,32,28,0.08)] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5">
              <div className="flex items-start gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-[10px] border border-[#D6B854] bg-white text-[#9A6A15]">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-black">AdMate 가입 요청</h3>
                  <p className="mt-2 text-sm leading-6 text-[#72591A]">Compass 사용 권한은 AdMate 가입 요청으로 확인합니다.</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-[#9A6A15] transition group-hover:translate-x-1" aria-hidden="true" />
            </article>
          </a>

          <a href={ADMATE_HOME_URL} target="_blank" rel="noopener noreferrer" className="group block">
            <article className="flex min-h-[128px] items-center justify-between gap-4 rounded-[12px] border border-[#CBD6CD] bg-[#FBFAF4] p-5 text-[#101820] shadow-[0_18px_48px_rgba(20,32,28,0.08)] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5">
              <div className="flex items-start gap-4">
                <div className="grid h-11 w-11 place-items-center rounded-[10px] border border-[#9AB9A3] bg-[#EAF5EE] text-[#1F7A4D]">
                  <Home className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-base font-black">AdMate 홈</h3>
                  <p className="mt-2 text-sm leading-6 text-[#637168]">AdMate 제품군 연결 관문으로 이동합니다.</p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-[#1F7A4D] transition group-hover:translate-x-1" aria-hidden="true" />
            </article>
          </a>
        </section>
      </main>
    </MainLayout>
  );
}
