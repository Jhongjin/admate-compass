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

const supportedMedia = [
  { id: "meta", name: "Meta" },
  { id: "google", name: "Google" },
  { id: "youtube", name: "YouTube" },
  { id: "naver", name: "Naver" },
  { id: "kakao", name: "Kakao" },
  { id: "gdn", name: "GDN" },
] as const;

const compassSummary = [
  ["매체별 기준", "Meta, Google/YouTube, Naver, Kakao 기준을 나눠 확인합니다."],
  ["소재 조건", "업종, 문구, 이미지, 랜딩 페이지 조건을 함께 봅니다."],
  ["근거 문서", "답변에 참고한 문서와 관련 내용을 함께 표시합니다."],
  ["확인 필요", "조건이 부족하거나 애매한 부분은 따로 표시합니다."],
] as const;

const previewRows = [
  ["가능한 표현", "정책 기준에 맞는 문구와 표현 범위를 정리합니다."],
  ["주의할 표현", "심사에서 보류될 수 있는 문구와 조건을 구분합니다."],
  ["추가 확인 필요", "랜딩 페이지나 업종 정보가 더 필요한 항목을 따로 표시합니다."],
] as const;

type MediaId = (typeof supportedMedia)[number]["id"];

function MediaLogo({ id }: { id: MediaId }) {
  if (id === "meta") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
        <path
          d="M4.2 14.3c1.1-3.6 2.7-5.4 4.6-5.4 1.4 0 2.4 1 3.2 2.2.8-1.2 1.8-2.2 3.2-2.2 1.9 0 3.5 1.8 4.6 5.4.6 1.9-.2 3.4-1.7 3.4-1.2 0-2.2-.8-3.5-2.4l-2.6-3.2-2.6 3.2c-1.3 1.6-2.3 2.4-3.5 2.4-1.5 0-2.3-1.5-1.7-3.4Z"
          fill="none"
          stroke="#2764D9"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (id === "google") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
        <circle cx="12" cy="12" r="9" fill="#F8F6F1" />
        <path d="M12 5.2a6.7 6.7 0 0 1 4.6 1.8l-2 2A3.8 3.8 0 0 0 12 8a4 4 0 0 0 0 8 3.7 3.7 0 0 0 3.8-2.9H12v-2.6h6.6c.1.5.2 1 .2 1.6 0 4-2.7 6.7-6.8 6.7A6.8 6.8 0 1 1 12 5.2Z" fill="#4285F4" />
        <path d="M5.9 8.3 8.2 10A4 4 0 0 1 12 8c1 0 1.9.3 2.6 1l2-2A6.7 6.7 0 0 0 12 5.2a6.8 6.8 0 0 0-6.1 3.1Z" fill="#EA4335" />
        <path d="M12 18.8c1.8 0 3.4-.6 4.6-1.8l-2.2-1.8A4 4 0 0 1 8.2 14l-2.3 1.8a6.8 6.8 0 0 0 6.1 3Z" fill="#34A853" />
        <path d="M8.2 14a4.1 4.1 0 0 1 0-4L5.9 8.3a6.8 6.8 0 0 0 0 7.5L8.2 14Z" fill="#FBBC05" />
      </svg>
    );
  }

  if (id === "youtube") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
        <rect x="3" y="6.5" width="18" height="11" rx="3" fill="#D62828" />
        <path d="M10.6 9.2 15.4 12l-4.8 2.8V9.2Z" fill="#FFFFFF" />
      </svg>
    );
  }

  if (id === "naver") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
        <rect x="4" y="4" width="16" height="16" rx="4" fill="#03C75A" />
        <path d="M8 8h3.1l2.8 4.1V8H16v8h-3.1l-2.8-4.1V16H8V8Z" fill="#FFFFFF" />
      </svg>
    );
  }

  if (id === "kakao") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
        <path d="M12 5.3c5 0 8.7 2.8 8.7 6.4S17 18 12 18c-.8 0-1.6-.1-2.4-.2l-3.1 1.8.8-2.9c-2.4-1.1-4-2.9-4-5 0-3.6 3.7-6.4 8.7-6.4Z" fill="#FEE500" />
        <path d="M8.5 9h1.8v2.2L12.1 9h2.1l-2.2 2.6 2.4 3.4h-2.2l-1.4-2.1-.5.6V15H8.5V9Z" fill="#3A1D1D" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      <rect x="4" y="4" width="7" height="7" rx="2" fill="#172033" />
      <rect x="13" y="4" width="7" height="7" rx="2" fill="#D5B978" />
      <rect x="4" y="13" width="7" height="7" rx="2" fill="#D5B978" />
      <rect x="13" y="13" width="7" height="7" rx="2" fill="#172033" />
    </svg>
  );
}

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
    <main className="compass-gate-copy relative min-h-[100dvh] overflow-hidden bg-[#ECEFF2] font-sans text-[#172033]">
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

          <div className="relative">
            <div className="max-w-[760px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex min-h-7 items-center rounded-[8px] border border-[#AEB8C3] bg-[#EEF2F5] px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#293B5A]">
                  compass.admate.ai.kr
                </span>
                <span className="inline-flex min-h-7 items-center rounded-[8px] border border-[#D5B978] bg-[#FFF3D8] px-3 text-[11px] font-semibold text-[#7A5518]">
                  정책 기준 확인
                </span>
              </div>

              <h1 className="mt-8 max-w-[720px] text-[clamp(2.35rem,4.4vw,4.7rem)] font-semibold leading-[1.06] tracking-normal text-[#172033] [text-wrap:balance]">
                광고 심사 기준을 매체별 근거와 함께 확인하세요.
              </h1>
              <p className="mt-5 max-w-[630px] text-base leading-8 text-[#344052] sm:text-lg">
                Compass는 광고 상품, 소재 문구, 랜딩 조건을 주요 매체 정책 기준에 맞춰 정리합니다.
              </p>
              <p className="mt-3 max-w-[610px] text-sm leading-7 text-[#68707C]">
                답변에는 참고한 문서와 추가 확인이 필요한 조건을 함께 표시합니다.
              </p>
            </div>

            <div className="mt-8 rounded-[10px] border border-[#D9D4C8] bg-white/72 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold text-[#172033]">Compass가 정리하는 내용</p>
                <span className="text-xs font-semibold text-[#7A5518]">질문, 기준, 근거를 한 화면에서 확인</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {compassSummary.map(([title, detail]) => (
                  <div key={title} className="rounded-[8px] border border-[#E1DED6] bg-[#FBF7EE] p-4">
                    <CheckCircle className="h-4 w-4 text-[#A67B2D]" aria-hidden="true" />
                    <p className="mt-3 text-sm font-bold text-[#172033]">{title}</p>
                    <p className="mt-2 text-xs leading-5 text-[#68707C]">{detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-4 rounded-[10px] border border-[#CDD5DD] bg-[#F4F6F7]/92 p-4 shadow-[0_18px_46px_rgba(23,32,51,0.08)] sm:p-5 lg:grid-cols-[minmax(0,0.82fr)_minmax(320px,1fr)]">
              <div className="flex min-h-full flex-col rounded-[8px] bg-[#FBF7EE] p-4">
                <p className="text-sm font-bold text-[#7A5518]">정책 확인 미리보기</p>
                <h2 className="mt-3 max-w-[420px] text-2xl font-semibold leading-tight text-[#172033] [text-wrap:balance]">
                  질문을 기준, 근거, 확인 필요 항목으로 나눠 보여줍니다.
                </h2>
                <div className="mt-5 rounded-[8px] border border-[#D9D4C8] bg-white p-4">
                  <p className="text-xs font-semibold text-[#68707C]">질문 예시</p>
                  <p className="mt-2 text-sm font-bold leading-6 text-[#172033]">
                    건강기능식품 광고 문구를 Meta와 Google 기준으로 확인
                  </p>
                </div>
                <div className="mt-3 grid gap-2">
                  {previewRows.map(([title, detail]) => (
                    <div key={title} className="rounded-[8px] border border-[#E1DED6] bg-white px-4 py-3">
                      <p className="text-sm font-bold text-[#172033]">{title}</p>
                      <p className="mt-1 text-xs leading-5 text-[#68707C]">{detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[8px] border border-[#D8DDE1] bg-white p-3">
                <img
                  src="/compass-policy-map.svg"
                  alt="매체 정책과 근거 문서가 연결된 Compass 화면 예시"
                  className="h-auto w-full rounded-[8px]"
                />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {["질문", "근거", "결과"].map((label) => (
                    <div key={label} className="rounded-[7px] bg-[#172033] px-3 py-2 text-center text-xs font-bold text-white">
                      {label}
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-[8px] bg-[#172033] p-4 text-white">
                  <p className="text-xs font-bold text-[#D5B978]">결과 화면 구성</p>
                  <div className="mt-3 grid gap-2">
                    {["답변 초안", "근거 문서", "확인 필요"].map((label) => (
                      <div key={label} className="flex items-center justify-between rounded-[7px] border border-white/10 bg-white/[0.06] px-3 py-2">
                        <span className="text-xs font-semibold text-white/65">{label}</span>
                        <CheckCircle className="h-3.5 w-3.5 text-[#D5B978]" aria-hidden="true" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="relative mt-8 rounded-[10px] border border-[#D9D4C8] bg-[#F5EFE3]/92 p-4">
            <div className="mb-4 flex items-center justify-between gap-4">
              <p className="text-sm font-bold text-[#7A5518]">지원 매체</p>
              <span className="hidden text-xs font-semibold text-[#68707C] sm:inline">주요 매체 정책 기준을 함께 확인합니다</span>
            </div>
            <div className="compass-media-marquee">
              <div className="compass-media-track">
                {[...supportedMedia, ...supportedMedia].map((media, index) => (
                  <div
                    key={`${media.id}-${index}`}
                    className="mr-3 inline-flex min-h-14 items-center gap-3 rounded-[8px] border border-[#D8DDE1] bg-white px-4 py-3 shadow-[0_10px_24px_rgba(23,32,51,0.05)]"
                    aria-hidden={index >= supportedMedia.length}
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-[8px] bg-[#F8F6F1]">
                      <MediaLogo id={media.id} />
                    </span>
                    <span className="whitespace-nowrap text-sm font-bold text-[#172033]">{media.name}</span>
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
          className="rounded-[10px] border border-[#D2CEC4] border-t-[5px] border-t-[#A67B2D] bg-[#FBF7EE] p-5 shadow-[0_28px_80px_rgba(23,32,51,0.11)] sm:p-7"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.02em] text-[#7A5518]">로그인</p>
              <h2 className="mt-2 text-2xl font-semibold leading-tight text-[#172033]">Compass 정책 확인 화면 열기</h2>
              <p className="mt-3 text-sm leading-6 text-[#68707C]">
                AdMate 계정으로 로그인하면 질문 기록과 검토 내용을 이어서 확인할 수 있습니다.
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
            로그인 후 최근 질문과 정책 문서 내용을 확인할 수 있습니다.
          </p>
        </motion.aside>
      </section>
    </main>
  );
}
