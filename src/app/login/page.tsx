"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ExternalLink, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

const ACCESS_REQUEST_URL = "https://sentinel.admate.ai.kr/access-request?product=compass";
const ADMATE_HOME_URL = "https://home.admate.ai.kr";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, signIn } = useAuth();
  const [emailLocalPart, setEmailLocalPart] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const safeNext = useMemo(
    () => sanitizeCompassNextPath(searchParams?.get("next")),
    [searchParams],
  );

  useEffect(() => {
    if (!loading && user) {
      router.replace(safeNext);
    }
  }, [loading, router, safeNext, user]);

  const normalizeEmailLocalPart = (value: string) =>
    value
      .trim()
      .replace(/\s/g, "")
      .replace(/@nasmedia\.co\.kr$/i, "")
      .replace(/@.*$/g, "");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    const normalizedEmailLocalPart = normalizeEmailLocalPart(emailLocalPart);

    if (!normalizedEmailLocalPart || !password) {
      setMessage("이메일과 비밀번호를 입력해주세요.");
      return;
    }

    const normalizedEmail = `${normalizedEmailLocalPart}@nasmedia.co.kr`;
    setEmailLocalPart(normalizedEmailLocalPart);
    setIsSubmitting(true);

    try {
      const { error } = await signIn(normalizedEmail, password);

      if (error) {
        setMessage(error.message);
        return;
      }

      router.replace(safeNext);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인 중 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F4F5F0] text-[#111713]">
      <header className="border-b border-[#D8DCCF] bg-[#FBFBF7]/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="block" aria-label="AdMate Compass home">
            <img src="/admate-logo.png" alt="AdMate" className="h-12 w-auto sm:h-14" />
          </Link>
          <Link
            href="/"
            className="whitespace-nowrap rounded-lg border border-[#C6D9CB] bg-[#EDF7EF] px-3 py-2 text-sm font-medium text-[#1F7A4D] transition-colors hover:bg-[#E3F1E7]"
          >
            Compass 홈
          </Link>
        </div>
      </header>

      <main className="px-4 pb-16 pt-10 sm:px-6 md:pt-20">
        <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div className="space-y-6 text-[#111713]">
            <div className="inline-flex items-center gap-2 rounded-md border border-[#C6D9CB] bg-[#EDF7EF] px-3 py-1 text-sm text-[#1F7A4D]">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              compass.admate.ai.kr
            </div>
            <div className="space-y-4">
              <h1 className="font-nanum text-3xl font-semibold leading-tight tracking-normal">
                AdMate Compass 정책 확인
              </h1>
              <p className="max-w-2xl font-nanum text-lg leading-8 text-[#34423A]">
                정책 검색과 근거 문서 확인을 위해 AdMate 계정으로 로그인하세요.
              </p>
              <p className="max-w-2xl text-sm leading-7 text-[#667066]">
                로그인 후 요청하신 Compass 화면으로 돌아갑니다. 사용 권한이 필요하다면 AdMate 이용 권한을 요청해 주세요.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-[#D6D8CD] bg-white p-5 shadow-sm md:p-8">
            <div className="mb-6 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
                <LockKeyhole className="h-5 w-5 text-[#1F7A4D]" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[#0D0D0D]">AdMate 계정으로 계속</h2>
                <p className="mt-1 text-sm leading-6 text-[#5E5E5E]">
                  Compass 정책 검색과 근거 문서 확인을 위해 로그인합니다.
                </p>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold text-[#303030]">
                  이메일
                </Label>
                <div className="flex flex-col overflow-hidden rounded-lg border border-[#D8D8D8] bg-white transition-colors focus-within:border-[#1F7A4D] focus-within:ring-2 focus-within:ring-[#E7F4EA] sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A8A8A]" />
                    <input
                      id="email"
                      type="text"
                      inputMode="email"
                      value={emailLocalPart}
                      onChange={(event) => setEmailLocalPart(normalizeEmailLocalPart(event.target.value))}
                      placeholder="name"
                      autoComplete="username"
                      className="h-10 w-full min-w-0 bg-transparent pl-10 pr-3 text-sm text-[#0D0D0D] outline-none placeholder:text-[#9A9A9A] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isSubmitting}
                      aria-describedby="email-domain"
                      required
                    />
                  </div>
                  <span
                    id="email-domain"
                    className="border-t border-[#E5E5E5] bg-[#EDF7EF] px-3 py-2.5 text-sm font-bold text-[#4B6556] sm:border-l sm:border-t-0"
                  >
                    @nasmedia.co.kr
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-semibold text-[#303030]">
                  비밀번호
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  autoComplete="current-password"
                  className="border-[#D8D8D8] bg-white text-[#0D0D0D] placeholder:text-[#9A9A9A]"
                  disabled={isSubmitting}
                  required
                />
              </div>

              {message && (
                <div className="rounded-lg border border-[#F5C2C7] bg-[#FFF7F7] px-3 py-2 text-sm leading-6 text-[#B42318]">
                  {message}
                </div>
              )}

              <Button
                type="submit"
                className="h-11 w-full gap-2 rounded-lg bg-[#0D0D0D] text-white hover:bg-[#303030]"
                disabled={isSubmitting}
              >
                {isSubmitting ? "로그인 중..." : "로그인"}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </form>

            <div className="mt-6 grid gap-3 border-t border-[#E5E5E5] pt-5 text-sm">
              <a
                href={ACCESS_REQUEST_URL}
                className="inline-flex items-center justify-between gap-3 rounded-lg border border-[#E9D59B] bg-[#FFF8E6] px-4 py-3 font-medium text-[#8A6418] transition-colors hover:bg-[#FFF3CF]"
              >
                <span className="min-w-0 break-words">AdMate 이용 권한 요청</span>
                <ExternalLink className="h-4 w-4 flex-none" aria-hidden="true" />
              </a>
              <Link
                href={ADMATE_HOME_URL}
                className="inline-flex items-center justify-center rounded-lg border border-[#E5E5E5] px-4 py-3 font-medium text-[#303030] transition-colors hover:bg-[#F7F7F7]"
              >
                AdMate 홈페이지로 이동
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F4F5F0] text-[#111713]">Loading...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
