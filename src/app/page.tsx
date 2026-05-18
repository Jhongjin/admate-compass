"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle,
  GitBranch,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const COMPASS_DESK_PATH = "/desk";
const LOGIN_URL = `/login?next=${encodeURIComponent(COMPASS_DESK_PATH)}`;
const ACCESS_REQUEST_URL = "https://sentinel.admate.ai.kr/access-request?product=compass";

const evidenceFlow = [
  {
    label: "질문 정리",
    title: "조건 분리",
    detail: "플랫폼, 업종, 소재 표현을 먼저 나눕니다.",
  },
  {
    label: "출처 확인",
    title: "원문 고정",
    detail: "대표 URL과 발췌 문단을 함께 확인합니다.",
  },
  {
    label: "답변 준비",
    title: "충돌 표시",
    detail: "확실하지 않은 내용은 답변과 분리합니다.",
  },
] as const;

const sourceRows = [
  { source: "Official policy", status: "원문 확인", tone: "bg-[#1F7A4D]" },
  { source: "Extracted clause", status: "문단 연결", tone: "bg-[#C99A38]" },
  { source: "Conflict note", status: "보류 분리", tone: "bg-[#B95C47]" },
  { source: "Answer draft", status: "근거 첨부", tone: "bg-[#24313A]" },
] as const;

const deskStates = [
  ["열리는 화면", "정책 질문과 출처 패널"],
  ["먼저 보는 것", "원문, 발췌, 보류 사유"],
  ["계정 확인", "AdMate 계정"],
] as const;

const principles = [
  "출처 있는 답변",
  "조건 분리",
  "보류 표시",
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
        <div className="rounded-[10px] border border-[#C8D6CD] bg-[#FFFDF7] px-6 py-5 text-center shadow-[0_22px_60px_rgba(17,28,24,0.09)]">
          <p className="text-sm font-semibold text-[#5E6B63]">Compass 접근 상태를 확인하고 있습니다.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#EEF2ED] font-sans text-[#101820]">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.62]"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(rgba(16,24,32,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(16,24,32,0.035) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
          maskImage: "linear-gradient(to bottom, black, transparent 84%)",
        }}
      />
      <div
        className="pointer-events-none absolute -right-52 top-28 h-[32rem] w-[64rem] rounded-full border border-[#7AA78F]/30 bg-[#DDECE4]/35"
        aria-hidden="true"
        style={{ transform: "rotate(-13deg)" }}
      />
      <div
        className="pointer-events-none absolute -left-44 bottom-[-18rem] h-[32rem] w-[46rem] rounded-full border border-[#C9A24E]/18 bg-[#F7E8BA]/18"
        aria-hidden="true"
        style={{ transform: "rotate(18deg)" }}
      />

      <header className="relative border-b border-[#D8DED5] bg-[#FBFBF7]/94">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img src="/admate-logo.png" alt="AdMate" className="h-12 w-auto sm:h-14" />
            <span className="hidden text-sm font-semibold text-[#5E6B63] sm:inline">Compass</span>
          </div>
          <Link
            href={LOGIN_URL}
            className="inline-flex min-h-10 items-center justify-center rounded-[8px] bg-[#101820] px-4 py-2 text-sm font-bold text-white transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#24313A] active:scale-[0.98]"
          >
            로그인
          </Link>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-[1400px] gap-5 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1.12fr)_410px] lg:px-8">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.58, ease: [0.32, 0.72, 0, 1] }}
          className="relative overflow-hidden rounded-[10px] border border-[#C8D6CD] border-t-[5px] border-t-[#101820] bg-[#FFFDF7] p-5 shadow-[0_28px_80px_rgba(17,28,24,0.1)] sm:p-8 lg:p-10"
        >
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "linear-gradient(113deg, transparent 0 57%, rgba(31,122,77,0.08) 57% 57.7%, transparent 57.7% 100%), radial-gradient(circle at 82% 22%, rgba(31,122,77,0.12), transparent 18rem)",
            }}
          />

          <div className="relative grid gap-9 xl:grid-cols-[minmax(0,0.93fr)_minmax(330px,0.74fr)] xl:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex min-h-7 items-center rounded-[8px] border border-[#9AB9A3] bg-[#EAF5EE] px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1F7A4D]">
                  compass.admate.ai.kr
                </span>
                <span className="inline-flex min-h-7 items-center rounded-[8px] border border-[#D8C58F] bg-[#FFF4CF] px-3 text-[11px] font-semibold text-[#72591A]">
                  정책 출처 확인
                </span>
              </div>

              <h1 className="mt-8 max-w-3xl text-[clamp(2.25rem,4.7vw,4.8rem)] font-bold leading-[1.03] tracking-normal text-[#101820]">
                답하기 전에,
                <br />
                출처를 먼저 펼칩니다.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-[#34423A] sm:text-lg">
                Compass는 광고 정책 질문을 원문, 발췌, 충돌 여부로 나누어 확인하는 정책 확인 화면입니다.
              </p>
              <p className="mt-3 max-w-xl text-sm leading-7 text-[#6A756D]">
                로그인 전에는 질문 기록과 정책 문서를 불러오지 않습니다. AdMate 계정 확인 후 Compass Desk로 이동합니다.
              </p>

              <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-3">
                {evidenceFlow.map((item) => (
                  <article key={item.label} className="rounded-[8px] border border-[#D7E0D8] bg-white/72 p-3 sm:p-4">
                    <p className="text-[11px] font-bold text-[#1F7A4D]">{item.label}</p>
                    <h2 className="mt-2 text-base font-bold text-[#101820] sm:mt-3 sm:text-lg">{item.title}</h2>
                    <p className="mt-2 hidden text-xs leading-5 text-[#6A756D] sm:block">{item.detail}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-[10px] border border-[#C8D6CD] bg-[#F7F6EF]/90 p-4 shadow-[0_18px_46px_rgba(17,28,24,0.08)]">
              <div className="flex items-center justify-between gap-3 border-b border-[#D9DED7] pb-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#6A756D]">source map</p>
                  <h2 className="mt-1 text-lg font-bold text-[#101820]">근거 흐름 예시</h2>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-[8px] border border-[#BED2C2] bg-[#EAF5EE] text-[#1F7A4D]">
                  <GitBranch className="h-5 w-5" aria-hidden="true" />
                </div>
              </div>

              <div className="mt-4 rounded-[8px] border border-[#D9DED7] bg-white p-3">
                <div className="flex items-center gap-2 rounded-[8px] border border-[#D7E0D8] bg-[#FBFAF4] px-3 py-3">
                  <Search className="h-4 w-4 flex-none text-[#1F7A4D]" aria-hidden="true" />
                  <span className="truncate text-sm font-semibold text-[#34423A]">업종과 소재 조건을 입력합니다</span>
                </div>

                <div className="mt-4 grid gap-3">
                  {sourceRows.map((row, index) => (
                    <div key={row.source} className="grid grid-cols-[2.2rem_minmax(0,1fr)_5.5rem] items-center gap-3">
                      <span className="text-xs font-bold text-[#6A756D]">0{index + 1}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${row.tone}`} aria-hidden="true" />
                          <span className="truncate text-sm font-bold text-[#101820]">{row.source}</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E8E5D9]">
                          <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${88 - index * 13}%` }} />
                        </div>
                      </div>
                      <span className="rounded-[8px] border border-[#D7E0D8] bg-[#FBFAF4] px-2 py-1 text-center text-[11px] font-semibold text-[#34423A]">
                        {row.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {["질문", "원문", "검토"].map((label, index) => (
                  <div key={label} className="rounded-[8px] border border-[#D7E0D8] bg-white px-3 py-3">
                    <p className="text-[11px] font-bold text-[#1F7A4D]">0{index + 1}</p>
                    <p className="mt-2 text-sm font-bold text-[#101820]">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </motion.section>

        <motion.aside
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.58, delay: 0.06, ease: [0.32, 0.72, 0, 1] }}
          className="rounded-[10px] border border-[#C8D6CD] border-t-[5px] border-t-[#1F7A4D] bg-[#FFFDF7] p-5 shadow-[0_28px_80px_rgba(17,28,24,0.1)] sm:p-7"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6A756D]">로그인 후 이동</p>
              <h2 className="mt-2 text-2xl font-bold leading-tight text-[#101820]">Compass Desk 열기</h2>
              <p className="mt-3 text-sm leading-6 text-[#6A756D]">
                정책 질문과 출처 확인 화면으로 이동합니다.
              </p>
            </div>
            <div className="grid h-12 w-12 flex-none place-items-center rounded-[8px] border border-[#BED2C2] bg-[#EAF5EE] text-[#1F7A4D]">
              <Search className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>

          <div className="mt-7 grid overflow-hidden rounded-[8px] border border-[#C8D6CD] bg-[#D8E0DA]">
            {deskStates.map(([label, value]) => (
              <div key={label} className="border-b border-[#D8E0DA] bg-[#FFFDF7] px-4 py-3 last:border-b-0">
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#6A756D]">{label}</span>
                <strong className="mt-2 block text-base font-bold text-[#101820]">{value}</strong>
              </div>
            ))}
          </div>

          <Link
            href={LOGIN_URL}
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[#101820] px-5 py-3 text-sm font-bold text-white transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#24313A] active:scale-[0.98]"
          >
            AdMate 계정으로 계속
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>

          <div className="mt-5 rounded-[10px] border border-[#E3DBC4] bg-[#F8F3E6] p-4">
            <p className="text-sm font-bold text-[#101820]">접근 권한이 없다면 AdMate 가입 요청</p>
            <p className="mt-2 text-xs leading-5 text-[#6A756D]">
              Compass 사용 권한은 AdMate 가입 요청을 통해 확인합니다.
            </p>
            <a
              href={ACCESS_REQUEST_URL}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border border-[#D8DCCF] bg-white px-4 py-2.5 text-sm font-bold text-[#34423A] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:border-[#9AB9A3] hover:bg-white active:scale-[0.98]"
            >
              AdMate 가입 요청
            </a>
          </div>

          <div className="mt-5 rounded-[10px] border border-[#26342E] bg-[#121C1F] p-4 text-white">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[#8FD7B8]" aria-hidden="true" />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/42">운영 원칙</p>
                <h3 className="text-lg font-bold">근거 중심 답변</h3>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {principles.map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-[8px] border border-white/8 bg-white/[0.04] px-3 py-2">
                  <CheckCircle className="h-4 w-4 flex-none text-[#8FD7B8]" aria-hidden="true" />
                  <p className="text-sm font-semibold text-white/70">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-4 text-xs leading-5 text-[#6A756D]">
            로그인된 사용자는 이 화면을 건너뛰고 Compass Desk로 바로 이동합니다.
          </p>
        </motion.aside>
      </section>
    </main>
  );
}
