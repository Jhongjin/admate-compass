"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ExternalLink, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

const ACCESS_REQUEST_URL = "https://home.admate.ai.kr/access-request?product=compass";
const ADMATE_HOME_URL = "https://home.admate.ai.kr";

const compassIntroItems = [
  {
    label: "01",
    title: "질문 조건에 맞는 공식 정책 수집",
    detail: "플랫폼 정책, 도움말, 운영 기준에서 답변에 필요한 근거를 먼저 모읍니다.",
  },
  {
    label: "02",
    title: "출처와 조건을 함께 대조",
    detail: "충돌하거나 중복되는 근거, 빠진 조건을 다시 확인해 판단 위험을 낮춥니다.",
  },
  {
    label: "03",
    title: "운영 판단에 쓸 답변으로 정리",
    detail: "확인된 내용과 추가 확인이 필요한 부분을 구분해 바로 읽히는 답변으로 제공합니다.",
  },
] as const;

type HeadlineParticle = {
  x: number;
  y: number;
  size: number;
  drift: number;
};

function ReactiveHeadline({ children }: { children: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<HeadlineParticle[]>([]);
  const pointerRef = useRef({ x: 0, y: 0, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frameId = 0;
    let time = 0;

    const createTextLines = (context2d: CanvasRenderingContext2D, maxWidth: number) => {
      const words = children.split(" ");
      const lines: string[] = [];
      let currentLine = "";

      words.forEach((word) => {
        const nextLine = currentLine ? `${currentLine} ${word}` : word;

        if (context2d.measureText(nextLine).width <= maxWidth || !currentLine) {
          currentLine = nextLine;
          return;
        }

        lines.push(currentLine);
        currentLine = word;
      });

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    };

    const buildParticles = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const sampleCanvas = document.createElement("canvas");
      const sampleContext = sampleCanvas.getContext("2d");

      if (!sampleContext) {
        return;
      }

      sampleCanvas.width = Math.max(1, Math.floor(width));
      sampleCanvas.height = Math.max(1, Math.floor(height));
      sampleContext.clearRect(0, 0, width, height);
      sampleContext.font =
        "600 30px Inter, 'Nanum Barun Gothic', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      sampleContext.textBaseline = "top";
      sampleContext.fillStyle = "#111713";

      const lineHeight = 36;
      const lines = createTextLines(sampleContext, width);
      lines.forEach((line, index) => {
        sampleContext.fillText(line, 0, index * lineHeight);
      });

      const imageData = sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
      const particles: HeadlineParticle[] = [];
      const step = width < 420 ? 5 : 4;

      for (let y = 0; y < imageData.height; y += step) {
        for (let x = 0; x < imageData.width; x += step) {
          const alpha = imageData.data[(y * imageData.width + x) * 4 + 3];

          if (alpha > 30) {
            particles.push({
              x,
              y,
              size: alpha > 160 ? 1.45 : 1.05,
              drift: (x * 0.017 + y * 0.031) % Math.PI,
            });
          }
        }
      }

      particlesRef.current = particles;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      buildParticles();
    };

    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const pointer = pointerRef.current;
      const particles = particlesRef.current;

      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(31, 122, 77, 0.62)";

      particles.forEach((particle) => {
        let x = particle.x;
        let y = particle.y;

        if (!prefersReducedMotion) {
          x += Math.sin(time / 34 + particle.drift) * 0.7;
          y += Math.cos(time / 38 + particle.drift) * 0.45;
        }

        if (pointer.active && !prefersReducedMotion) {
          const dx = x - pointer.x;
          const dy = y - pointer.y;
          const distance = Math.hypot(dx, dy);
          const radius = 86;

          if (distance > 0 && distance < radius) {
            const force = (radius - distance) / radius;
            x += (dx / distance) * force * 12;
            y += (dy / distance) * force * 8;
          }
        }

        context.globalAlpha = 0.36 + (particle.size - 1) * 0.22;
        context.beginPath();
        context.arc(x, y, particle.size, 0, Math.PI * 2);
        context.fill();
      });

      if (!prefersReducedMotion) {
        time += 1;
        frameId = window.requestAnimationFrame(draw);
      }
    };

    resize();
    draw();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(frameId);
    };
  }, [children]);

  return (
    <div
      className="compass-reactive-headline relative"
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        pointerRef.current = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          active: true,
        };
      }}
      onPointerLeave={() => {
        pointerRef.current = { x: 0, y: 0, active: false };
      }}
    >
      <h1 className="compass-gate-headline relative z-10">{children}</h1>
      <canvas ref={canvasRef} className="absolute inset-0 z-20 h-full w-full" aria-hidden="true" />
    </div>
  );
}

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
            <img src="/brand/admate-compass-lockup.svg" alt="AdMate Compass" className="h-12 w-auto sm:h-14" />
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
        <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_420px] lg:items-center">
          <div className="rounded-lg border border-[#D6D8CD] border-t-4 border-t-[#111713] bg-white p-6 text-[#111713] shadow-sm md:p-8">
            <div className="inline-flex items-center rounded-md border border-[#C6D9CB] bg-[#EDF7EF] px-3 py-1 text-sm font-semibold text-[#1F7A4D]">
              AdMate Compass
            </div>
            <div className="mt-4 space-y-4">
              <ReactiveHeadline>정책 판단의 근거를 놓치지 않습니다</ReactiveHeadline>
              <p className="compass-gate-copy max-w-2xl text-lg leading-8 text-[#34423A]">
                질문 조건에 맞는 공식 정책과 출처를 모으고, 충돌·중복·누락 근거를 다시 확인해 운영 판단에 쓸 답변으로 정리합니다.
              </p>
            </div>

            <div className="mt-8 grid gap-3">
              {compassIntroItems.map((item) => (
                <article key={item.label} className="rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] p-4">
                  <div className="flex gap-4">
                    <span className="mt-0.5 text-xs font-black text-[#1F7A4D]">{item.label}</span>
                    <div>
                      <strong className="block text-base font-semibold leading-6 text-[#111713]">{item.title}</strong>
                      <p className="compass-gate-copy mt-1 text-sm leading-6 text-[#667066]">{item.detail}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#D6D8CD] border-t-4 border-t-[#1F7A4D] bg-white p-5 shadow-sm md:p-8">
            <div className="mb-6 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#C6D9CB] bg-[#EDF7EF]">
                <LockKeyhole className="h-5 w-5 text-[#1F7A4D]" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-[#0D0D0D]">AdMate 계정으로 로그인</h2>
                <p className="mt-1 text-sm leading-6 text-[#5E5E5E]">
                  회사 이메일로 로그인해 Compass 작업 공간을 이용하세요.
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
