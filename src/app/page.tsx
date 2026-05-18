"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle, Search } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const COMPASS_DESK_PATH = "/desk";
const LOGIN_URL = `/login?next=${encodeURIComponent(COMPASS_DESK_PATH)}`;
const ACCESS_REQUEST_URL = "https://sentinel.admate.ai.kr/access-request?product=compass";

const supportedMedia = ["Meta", "Google/YouTube", "Naver", "Kakao", "GDN", "YouTube"];

const trustSignals = [
  "공식 정책 문서와 운영 기준을 우선 확인",
  "답변에 사용한 출처와 관련 문단을 함께 표시",
  "조건이 부족하거나 충돌하는 내용은 확인 필요로 분리",
] as const;

const reviewScope = [
  ["매체", "플랫폼별 정책"],
  ["소재", "표현과 랜딩 조건"],
  ["근거", "문서와 판단 기준"],
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
      <main className="grid min-h-[100dvh] place-items-center bg-[#ECEFF2] px-6 text-[#172033]">
        <div className="rounded-[8px] border border-[#D6D2C8] bg-[#FBF7EE] px-6 py-5 text-center shadow-[0_22px_60px_rgba(23,32,51,0.09)]">
          <p className="text-sm font-semibold text-[#5B6472]">Compass 접속 상태를 확인하고 있습니다.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#ECEFF2] font-sans text-[#172033]">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.56]"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(rgba(23,32,51,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(23,32,51,0.035) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
          maskImage: "linear-gradient(to bottom, black, transparent 84%)",
        }}
      />
      <div
        className="pointer-events-none absolute -right-56 top-24 h-[34rem] w-[68rem] rounded-full border border-[#A67B2D]/22 bg-[#F2DFC0]/20"
        aria-hidden="true"
        style={{ transform: "rotate(-12deg)" }}
      />
      <div
        className="pointer-events-none absolute -left-56 bottom-[-18rem] h-[34rem] w-[54rem] rounded-full border border-[#293B5A]/18 bg-[#DDE5ED]/40"
        aria-hidden="true"
        style={{ transform: "rotate(16deg)" }}
      />

      <header className="relative border-b border-[#D8D6CF] bg-[#F8F6F1]/94">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <img src="/admate-logo.png" alt="AdMate" className="h-12 w-auto sm:h-14" />
            <span className="hidden text-sm font-semibold text-[#5B6472] sm:inline">Compass</span>
          </div>
          <Link
            href={LOGIN_URL}
            className="inline-flex min-h-10 items-center justify-center rounded-[8px] bg-[#172033] px-4 py-2 text-sm font-bold text-white transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#273755] active:scale-[0.98]"
          >
            로그인
          </Link>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-[1400px] gap-5 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1.12fr)_390px] lg:px-8">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.58, ease: [0.32, 0.72, 0, 1] }}
          className="relative overflow-hidden rounded-[10px] border border-[#D2CEC4] border-t-[5px] border-t-[#172033] bg-[#FBF7EE] p-5 shadow-[0_28px_80px_rgba(23,32,51,0.11)] sm:p-8 lg:p-10"
        >
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "linear-gradient(112deg, transparent 0 61%, rgba(166,123,45,0.13) 61% 61.42%, transparent 61.42% 100%), radial-gradient(circle at 84% 18%, rgba(41,59,90,0.10), transparent 18rem)",
            }}
          />

          <div className="relative grid gap-8 xl:grid-cols-[minmax(0,0.86fr)_minmax(330px,0.72fr)] xl:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex min-h-7 items-center rounded-[8px] border border-[#AEB8C3] bg-[#EEF2F5] px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#293B5A]">
                  compass.admate.ai.kr
                </span>
                <span className="inline-flex min-h-7 items-center rounded-[8px] border border-[#D5B978] bg-[#FFF3D8] px-3 text-[11px] font-semibold text-[#7A5518]">
                  정책 기준 확인
                </span>
              </div>

              <h1 className="mt-8 max-w-[680px] text-[clamp(2rem,3.2vw,3.35rem)] font-semibold leading-[1.18] tracking-normal text-[#172033] [text-wrap:balance]">
                매체 정책을 근거와 함께 확인하세요.
              </h1>
              <p className="mt-5 max-w-[620px] text-base leading-8 text-[#344052] sm:text-lg">
                Compass는 광고 상품과 소재 조건을 매체별 정책 기준에 맞춰 확인하는 AdMate의 정책 확인 도구입니다.
              </p>
              <p className="mt-3 max-w-[610px] text-sm leading-7 text-[#68707C]">
                지원 매체, 관련 문서, 확인이 필요한 조건을 한 화면에서 비교합니다.
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-[0.92fr_1.08fr]">
                <div className="rounded-[8px] border border-[#D9D4C8] bg-[#F5EFE3]/90 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#7A5518]">지원 매체</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {supportedMedia.map((media) => (
                      <span
                        key={media}
                        className="rounded-[7px] border border-[#D9D4C8] bg-white px-3 py-2 text-sm font-semibold text-[#172033]"
                      >
                        {media}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-[8px] border border-[#CDD5DD] bg-white/72 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#293B5A]">확인 기준</p>
                  <div className="mt-4 grid gap-3">
                    {reviewScope.map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3">
                        <span className="rounded-[6px] bg-[#172033] px-2 py-1 text-center text-xs font-bold text-white">{label}</span>
                        <span className="text-sm font-semibold leading-6 text-[#344052]">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-[8px] border border-[#D9D4C8] bg-white/62 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#7A5518]">신뢰 신호</p>
                <div className="mt-4 grid gap-3">
                  {trustSignals.map((item) => (
                    <div key={item} className="flex items-start gap-3">
                      <CheckCircle className="mt-0.5 h-4 w-4 flex-none text-[#A67B2D]" aria-hidden="true" />
                      <p className="text-sm leading-6 text-[#344052]">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[10px] border border-[#CED6DD] bg-[#F4F6F7]/92 p-4 shadow-[0_18px_46px_rgba(23,32,51,0.08)]">
              <img
                src="/compass-policy-map.svg"
                alt="매체 정책과 근거 문서가 연결된 Compass 화면 예시"
                className="h-auto w-full rounded-[8px]"
              />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-[8px] border border-[#D8DDE1] bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#7A5518]">출처</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-[#172033]">공식 문서 우선</p>
                </div>
                <div className="rounded-[8px] border border-[#D8DDE1] bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#293B5A]">검토</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-[#172033]">보류 조건 분리</p>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.aside
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.58, delay: 0.06, ease: [0.32, 0.72, 0, 1] }}
          className="rounded-[10px] border border-[#D2CEC4] border-t-[5px] border-t-[#A67B2D] bg-[#FBF7EE] p-5 shadow-[0_28px_80px_rgba(23,32,51,0.11)] sm:p-7"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.02em] text-[#7A5518]">로그인</p>
              <h2 className="mt-2 text-2xl font-semibold leading-tight text-[#172033]">Compass로 이동</h2>
              <p className="mt-3 text-sm leading-6 text-[#68707C]">
                AdMate 계정 확인 후 정책 확인 화면으로 이동합니다.
              </p>
            </div>
            <div className="grid h-12 w-12 flex-none place-items-center rounded-[8px] border border-[#D5B978] bg-[#FFF3D8] text-[#7A5518]">
              <Search className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>

          <Link
            href={LOGIN_URL}
            className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[#172033] px-5 py-3 text-sm font-bold text-white transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#273755] active:scale-[0.98]"
          >
            AdMate 계정으로 로그인
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>

          <div className="mt-5 rounded-[10px] border border-[#D9D4C8] bg-white/72 p-4">
            <p className="text-sm font-bold text-[#172033]">아직 권한이 없다면</p>
            <p className="mt-2 text-xs leading-5 text-[#68707C]">
              Compass 사용 권한은 AdMate 가입 요청 후 확인됩니다.
            </p>
            <a
              href={ACCESS_REQUEST_URL}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border border-[#D5B978] bg-[#FFF3D8] px-4 py-2.5 text-sm font-bold text-[#7A5518] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#FFE8B3] active:scale-[0.98]"
            >
              AdMate 가입 요청
            </a>
          </div>

          <p className="mt-5 text-xs leading-5 text-[#68707C]">
            로그인 전에는 질문 기록과 정책 문서 내용이 표시되지 않습니다.
          </p>
        </motion.aside>
      </section>
    </main>
  );
}
