"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CheckCircle,
  FileSearch,
  Home,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const COMPASS_DESK_PATH = "/desk";
const LOGIN_URL = `/login?next=${encodeURIComponent(COMPASS_DESK_PATH)}`;
const ACCESS_REQUEST_URL = "https://sentinel.admate.ai.kr/access-request?product=compass";
const ADMATE_HOME_URL = "https://home.admate.ai.kr";

const policySignals = [
  { label: "질문 범위", value: "플랫폼 / 상품", detail: "매체와 소재 조건을 먼저 나눕니다." },
  { label: "근거 기준", value: "원문 / 발췌", detail: "대표 출처와 문서 구간을 함께 봅니다." },
  { label: "검토 경계", value: "충돌 / 보류", detail: "확인되지 않은 답변은 분리합니다." },
] as const;

const sourceLanes = [
  { label: "Meta", value: "랜딩 / 소재", detail: "원문 링크와 발췌 기준 확인" },
  { label: "Google/YouTube", value: "제한 소재", detail: "정책 링크와 근거 문단 확인" },
  { label: "Naver", value: "심사 기준", detail: "운영정책과 문서 구간 확인" },
  { label: "Kakao", value: "업종 제한", detail: "업종별 제한과 예외 기준 확인" },
] as const;

const reviewSteps = [
  { label: "01", value: "질문 조건 정리", detail: "플랫폼, 업종, 소재 표현을 분리합니다." },
  { label: "02", value: "근거 원문 확인", detail: "대표 URL과 발췌 문단을 함께 고정합니다." },
  { label: "03", value: "충돌과 보류 표시", detail: "답변 전 확인이 필요한 범위를 분리합니다." },
] as const;

const guardrails = [
  "확인된 근거가 있을 때 출처를 함께 표시합니다.",
  "근거가 부족한 질문은 답변보다 보류 상태를 먼저 보여줍니다.",
  "플랫폼, 업종, 소재 조건을 섞지 않고 나누어 판단합니다.",
] as const;

export default function HomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace(COMPASS_DESK_PATH);
    }
  }, [loading, router, user]);

  if (loading || user) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#EEF2ED] px-6 text-[#101820]">
        <div className="rounded-[12px] border border-[#CBD6CD] bg-[#FBFAF4] px-6 py-5 text-center shadow-[0_22px_60px_rgba(20,32,28,0.09)]">
          <p className="text-sm font-semibold text-[#667066]">Compass 접근 상태를 확인하고 있습니다.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#EEF2ED] text-[#101820]">
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
      <div
        className="pointer-events-none absolute -right-40 top-28 h-[28rem] w-[56rem] rounded-full border border-[#9AB9A3]/35 bg-[#EAF5EE]/35"
        aria-hidden="true"
        style={{ transform: "rotate(-14deg)" }}
      />

      <header className="relative border-b border-[#D8DCCF] bg-[#FBFBF7]/92">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img src="/admate-logo.png" alt="AdMate" className="h-12 w-auto sm:h-14" />
            <span className="hidden text-sm font-semibold text-[#667066] sm:inline">Compass</span>
          </div>
          <Link
            href={LOGIN_URL}
            className="inline-flex min-h-10 items-center justify-center rounded-[10px] bg-[#101820] px-4 py-2 text-sm font-bold text-white transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#26342E] active:scale-[0.98]"
          >
            로그인
          </Link>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-[1400px] gap-5 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1.08fr)_430px] lg:px-8">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.58, ease: [0.32, 0.72, 0, 1] }}
          className="relative overflow-hidden rounded-[12px] border border-[#CBD6CD] border-t-[#101820] border-t-[5px] bg-[#FBFAF4] p-5 shadow-[0_28px_80px_rgba(20,32,28,0.1)] sm:p-8"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            aria-hidden="true"
            style={{
              background:
                "linear-gradient(115deg, transparent 0 58%, rgba(31,122,77,0.08) 58% 58.7%, transparent 58.7% 100%), linear-gradient(180deg, rgba(255,255,255,0.86), rgba(234,242,235,0.46))",
            }}
          />

          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-7 items-center rounded-[8px] border border-[#9AB9A3] bg-[#EAF5EE] px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1F7A4D]">
                compass.admate.ai.kr
              </span>
              <span className="inline-flex min-h-7 items-center rounded-[8px] border border-[#D6CCB0] bg-[#FFF7DA] px-3 text-[11px] font-semibold text-[#72591A]">
                정책 근거 확인
              </span>
            </div>

            <div className="mt-8 grid gap-7 lg:grid-cols-[minmax(0,1fr)_9rem] lg:items-start">
              <div>
                <h1 className="max-w-4xl text-[clamp(2.15rem,4.4vw,4.65rem)] font-extrabold leading-[1.06] tracking-[0] text-[#101820]">
                  정책 판단 전에 근거부터 고정합니다.
                </h1>
                <p className="mt-5 max-w-3xl text-base leading-8 text-[#34423A] sm:text-lg">
                  Compass는 광고 플랫폼 정책 질문을 답변, 출처, 검토 경계로 나누어 최종 판단을 더 쉽게 만듭니다.
                </p>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-[#637168]">
                  질문은 로그인 후 Compass Desk에서 실행됩니다. 로그인 전에는 정책 답변과 근거 문서를 호출하지 않습니다.
                </p>
              </div>

              <div className="hidden aspect-square place-items-center rounded-full border border-[#9AB9A3]/45 bg-white/35 text-center text-[#1F7A4D] lg:grid">
                <div>
                  <strong className="block text-3xl font-black leading-none">AC</strong>
                  <span className="mt-2 block text-[10px] font-black uppercase tracking-[0.14em] text-[#667066]">Compass</span>
                </div>
              </div>
            </div>

            <div className="mt-8 grid overflow-hidden rounded-[10px] border border-[#CBD6CD] bg-[#D5DED8] sm:grid-cols-3">
              {policySignals.map((signal) => (
                <article key={signal.label} className="min-w-0 border-b border-[#D5DED8] bg-[#FFFDF7]/92 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.1em] text-[#667066]">{signal.label}</p>
                  <strong className="mt-2 block text-base font-extrabold text-[#101820]">{signal.value}</strong>
                  <span className="mt-2 block text-xs leading-5 text-[#667066]">{signal.detail}</span>
                </article>
              ))}
            </div>

            <div className="mt-6 grid gap-4 rounded-[12px] border border-[#D9E1DA] bg-white/56 p-4 md:grid-cols-[0.74fr_1fr]">
              <div className="grid content-center">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#477C63]">검토 화면 미리보기</p>
                <h2 className="mt-3 text-2xl font-extrabold leading-tight text-[#101820] sm:text-3xl">
                  질문을 바로 던지기보다, 조건과 근거를 먼저 나눕니다.
                </h2>
                <p className="mt-4 text-sm leading-7 text-[#667066]">
                  플랫폼, 업종, 소재 표현, 랜딩 조건을 분리한 뒤 확인 가능한 원문과 발췌를 함께 봅니다.
                </p>
              </div>
              <div className="rounded-[10px] border border-[#CBD6CD] bg-[#FFFDF7] p-3">
                <div className="grid gap-2">
                  {reviewSteps.map((step) => (
                    <div key={step.label} className="grid grid-cols-[2.6rem_minmax(0,1fr)] gap-3 rounded-[8px] border border-[#D9E1DA] bg-white px-3 py-3">
                      <span className="text-xs font-black text-[#1F7A4D]">{step.label}</span>
                      <span>
                        <strong className="block text-sm font-extrabold text-[#101820]">{step.value}</strong>
                        <span className="mt-1 block text-xs leading-5 text-[#667066]">{step.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {sourceLanes.map((lane) => (
                <article key={lane.label} className="rounded-[10px] border border-[#D9E1DA] bg-[#FFFDF7]/88 p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#477C63]">{lane.label}</p>
                  <strong className="mt-4 block text-lg font-extrabold text-[#101820]">{lane.value}</strong>
                  <span className="mt-2 block text-sm leading-6 text-[#667066]">{lane.detail}</span>
                </article>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.aside
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.58, delay: 0.06, ease: [0.32, 0.72, 0, 1] }}
          className="rounded-[12px] border border-[#CBD6CD] border-t-[#1F7A4D] border-t-[5px] bg-[#FFFDF7] p-5 shadow-[0_28px_80px_rgba(20,32,28,0.1)] sm:p-7"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667066]">로그인 후 이동</p>
              <h2 className="mt-2 text-2xl font-extrabold leading-tight text-[#101820]">Compass Desk 열기</h2>
              <p className="mt-3 text-sm leading-6 text-[#667066]">
                정책 질문, 답변 근거, 출처 패널을 한 화면에서 확인합니다.
              </p>
            </div>
            <div className="grid h-12 w-12 flex-none place-items-center rounded-[10px] border border-[#BED2C2] bg-[#EAF5EE] text-[#1F7A4D]">
              <Search className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>

          <div className="mt-7 grid overflow-hidden rounded-[10px] border border-[#CBD6CD] bg-[#D5DED8]">
            {[
              ["로그인 상태", "확인 필요"],
              ["사용 범위", "정책 답변과 근거 원문"],
              ["계정 확인", "AdMate 계정"],
            ].map(([label, value]) => (
              <div key={label} className="bg-[#FFFDF7] px-4 py-4">
                <span className="text-[11px] font-black uppercase tracking-[0.1em] text-[#667066]">{label}</span>
                <strong className="mt-2 block text-base font-extrabold text-[#101820]">{value}</strong>
              </div>
            ))}
          </div>

          <Link
            href={LOGIN_URL}
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#101820] px-5 py-3 text-sm font-bold text-white transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#26342E] active:scale-[0.98]"
          >
            AdMate 계정으로 계속
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>

          <div className="mt-5 rounded-[12px] border border-[#E4E0D2] bg-[#F7F5EE] p-4">
            <p className="text-sm font-extrabold text-[#101820]">접근 권한이 없다면 AdMate 가입 요청</p>
            <p className="mt-2 text-xs leading-5 text-[#667066]">
              Compass 사용 권한은 AdMate 가입 요청을 통해 확인합니다.
            </p>
            <a
              href={ACCESS_REQUEST_URL}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[10px] border border-[#D8DCCF] bg-white px-4 py-2.5 text-sm font-bold text-[#34423A] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:border-[#9AB9A3] hover:bg-white active:scale-[0.98]"
            >
              AdMate 가입 요청
            </a>
            <a
              href={ADMATE_HOME_URL}
              className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-[10px] px-4 py-2 text-sm font-semibold text-[#667066] transition-colors hover:text-[#101820]"
            >
              AdMate 홈페이지로 이동
            </a>
          </div>

          <div className="mt-5 rounded-[12px] border border-[#26342E] bg-[#121C1F] p-4 text-white">
            <div className="mb-4 flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[#8FD7B8]" aria-hidden="true" />
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-white/42">운영 원칙</p>
                <h3 className="text-lg font-extrabold">근거 중심 답변</h3>
              </div>
            </div>
            <div className="grid gap-2">
              {guardrails.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-[8px] border border-white/8 bg-white/[0.04] p-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 flex-none text-[#8FD7B8]" aria-hidden="true" />
                  <p className="text-sm leading-6 text-white/68">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-2 rounded-[12px] border border-[#D9E1DA] bg-white/72 p-4">
            <div className="flex items-center gap-3">
              <LockKeyhole className="h-4 w-4 text-[#1F7A4D]" aria-hidden="true" />
              <p className="text-xs leading-5 text-[#667066]">로그인된 사용자는 이 화면을 건너뛰고 Compass Desk로 바로 이동합니다.</p>
            </div>
            <div className="flex items-center gap-3">
              <BookOpen className="h-4 w-4 text-[#1F7A4D]" aria-hidden="true" />
              <p className="text-xs leading-5 text-[#667066]">질문과 답변 기록은 로그인 후 작업 화면에서 확인합니다.</p>
            </div>
            <div className="flex items-center gap-3">
              <FileSearch className="h-4 w-4 text-[#1F7A4D]" aria-hidden="true" />
              <p className="text-xs leading-5 text-[#667066]">출처 원문과 발췌는 답변과 함께 표시됩니다.</p>
            </div>
          </div>
        </motion.aside>
      </section>

      <section className="relative mx-auto grid max-w-[1400px] gap-3 px-4 pb-14 sm:px-6 md:grid-cols-2 lg:px-8">
        <a href={ACCESS_REQUEST_URL} className="group block">
          <article className="flex min-h-[112px] items-center justify-between gap-4 rounded-[12px] border border-[#D6B854] bg-[#FFF7DA] p-5 text-[#101820] shadow-[0_18px_48px_rgba(20,32,28,0.08)] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5">
            <div>
              <h3 className="text-base font-extrabold">AdMate 가입 요청</h3>
              <p className="mt-2 text-sm leading-6 text-[#72591A]">Compass 사용 권한을 요청합니다.</p>
            </div>
            <ArrowRight className="h-4 w-4 text-[#9A6A15] transition group-hover:translate-x-1" aria-hidden="true" />
          </article>
        </a>

        <a href={ADMATE_HOME_URL} className="group block">
          <article className="flex min-h-[112px] items-center justify-between gap-4 rounded-[12px] border border-[#CBD6CD] bg-[#FBFAF4] p-5 text-[#101820] shadow-[0_18px_48px_rgba(20,32,28,0.08)] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5">
            <div className="flex items-start gap-3">
              <Home className="mt-0.5 h-5 w-5 text-[#1F7A4D]" aria-hidden="true" />
              <div>
                <h3 className="text-base font-extrabold">AdMate 홈페이지로 이동</h3>
                <p className="mt-2 text-sm leading-6 text-[#637168]">AdMate 제품군 안내 화면으로 돌아갑니다.</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-[#1F7A4D] transition group-hover:translate-x-1" aria-hidden="true" />
          </article>
        </a>
      </section>
    </main>
  );
}
