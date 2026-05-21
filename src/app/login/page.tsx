"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tone: "ink" | "green" | "gold";
};

const HEADLINE_PARTICLE_GAP = 5;
const HEADLINE_POINTER_RADIUS = 78;
const HEADLINE_MAX_PARTICLES = 1250;

const getLineHeight = (computedStyle: CSSStyleDeclaration, fontSize: number) => {
  const parsedLineHeight = Number.parseFloat(computedStyle.lineHeight);

  return Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.25;
};

const getWrappedLines = (
  text: string,
  maxWidth: number,
  context: CanvasRenderingContext2D,
) => {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (currentLine && context.measureText(nextLine).width > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
};

function ReactiveHeadline({ children }: { children: string }) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const heading = headingRef.current;
    const canvas = canvasRef.current;

    if (!heading || !canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: 0, y: 0, active: false };
    let particles: HeadlineParticle[] = [];
    let frameId = 0;
    let isReducedMotion = reducedMotionQuery.matches;
    let tick = 0;

    const drawParticles = (motionEnabled: boolean) => {
      const width = canvas.width / Math.min(window.devicePixelRatio || 1, 2);
      const height = canvas.height / Math.min(window.devicePixelRatio || 1, 2);

      context.clearRect(0, 0, width, height);

      for (const particle of particles) {
        const color = particle.tone === "green" ? "#1F7A4D" : particle.tone === "gold" ? "#D99A20" : "#111713";

        context.beginPath();
        context.fillStyle = color;
        context.globalAlpha = particle.tone === "ink" ? 0.44 : 0.66;
        const wave = motionEnabled
          ? Math.sin((tick + particle.baseX * 0.12 + particle.baseY * 0.08) * 0.08) * 0.45
          : 0;
        const drift = motionEnabled ? Math.cos((tick + particle.baseY * 0.11) * 0.07) * 0.28 : 0;
        const radius = motionEnabled
          ? 1.02 + (Math.sin(tick * 0.08 + particle.baseX * 0.03) + 1) * 0.08
          : 1;
        context.arc(particle.x + wave, particle.y + drift, radius, 0, Math.PI * 2);
        context.fill();
      }

      context.globalAlpha = 1;
    };

    const buildParticles = () => {
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const bounds = heading.getBoundingClientRect();
      const computedStyle = getComputedStyle(heading);
      const width = Math.max(1, Math.ceil(bounds.width));
      const height = Math.max(1, Math.ceil(bounds.height));
      const scanCanvas = document.createElement("canvas");
      const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });

      if (!scanContext) {
        return;
      }

      canvas.width = Math.ceil(width * devicePixelRatio);
      canvas.height = Math.ceil(height * devicePixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      scanCanvas.width = width;
      scanCanvas.height = height;
      scanContext.clearRect(0, 0, width, height);
      scanContext.fillStyle = "#000";
      scanContext.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} / ${computedStyle.lineHeight} ${computedStyle.fontFamily}`;
      scanContext.letterSpacing = computedStyle.letterSpacing;
      scanContext.textBaseline = "top";

      const fontSize = Number.parseFloat(computedStyle.fontSize);
      const lineHeight = getLineHeight(computedStyle, fontSize);
      const lines = getWrappedLines(children, width, scanContext);

      lines.forEach((line, index) => {
        scanContext.fillText(line, 0, index * lineHeight);
      });

      const imageData = scanContext.getImageData(0, 0, width, height).data;
      const nextParticles: HeadlineParticle[] = [];

      for (let y = 0; y < height; y += HEADLINE_PARTICLE_GAP) {
        for (let x = 0; x < width; x += HEADLINE_PARTICLE_GAP) {
          const alpha = imageData[(y * width + x) * 4 + 3];

          if (alpha > 80) {
            const toneSeed = (x * 13 + y * 7) % 19;
            nextParticles.push({
              baseX: x,
              baseY: y,
              x,
              y,
              vx: 0,
              vy: 0,
              tone: toneSeed === 0 ? "gold" : toneSeed < 4 ? "green" : "ink",
            });
          }
        }
      }

      particles =
        nextParticles.length > HEADLINE_MAX_PARTICLES
          ? nextParticles.filter((_, index) => index % Math.ceil(nextParticles.length / HEADLINE_MAX_PARTICLES) === 0)
          : nextParticles;

      drawParticles(!isReducedMotion);
    };

    const animate = () => {
      tick += 1;

      for (const particle of particles) {
        if (pointer.active) {
          const dx = particle.x - pointer.x;
          const dy = particle.y - pointer.y;
          const distance = Math.hypot(dx, dy);

          if (distance > 0 && distance < HEADLINE_POINTER_RADIUS) {
            const force = (1 - distance / HEADLINE_POINTER_RADIUS) * 2.1;
            particle.vx += (dx / distance) * force;
            particle.vy += (dy / distance) * force;
          }
        }

        particle.vx += (particle.baseX - particle.x) * 0.075;
        particle.vy += (particle.baseY - particle.y) * 0.075;
        particle.vx *= 0.82;
        particle.vy *= 0.82;
        particle.x += particle.vx;
        particle.y += particle.vy;
      }

      drawParticles(true);
      frameId = window.requestAnimationFrame(animate);
    };

    const startAnimation = () => {
      window.cancelAnimationFrame(frameId);

      if (!isReducedMotion) {
        frameId = window.requestAnimationFrame(animate);
        return;
      }

      for (const particle of particles) {
        particle.x = particle.baseX;
        particle.y = particle.baseY;
        particle.vx = 0;
        particle.vy = 0;
      }

      drawParticles(false);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
      pointer.active = true;
    };

    const handlePointerLeave = () => {
      pointer.active = false;
    };

    const handleMotionPreferenceChange = (event: MediaQueryListEvent) => {
      isReducedMotion = event.matches;
      startAnimation();
    };

    const resizeObserver = new ResizeObserver(() => {
      buildParticles();
      startAnimation();
    });

    buildParticles();
    startAnimation();
    resizeObserver.observe(heading);
    heading.addEventListener("pointermove", handlePointerMove);
    heading.addEventListener("pointerleave", handlePointerLeave);
    reducedMotionQuery.addEventListener("change", handleMotionPreferenceChange);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      heading.removeEventListener("pointermove", handlePointerMove);
      heading.removeEventListener("pointerleave", handlePointerLeave);
      reducedMotionQuery.removeEventListener("change", handleMotionPreferenceChange);
    };
  }, [children]);

  return (
    <h1 ref={headingRef} className="compass-reactive-headline mt-4">
      <span className="compass-reactive-headline__text">{children}</span>
      <canvas ref={canvasRef} className="compass-reactive-headline__canvas" aria-hidden="true" />
    </h1>
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
        <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-2 px-4 py-2 sm:min-h-16 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="AdMate Compass home">
            <img src="/brand/admate-compass-mark.svg" alt="" className="h-9 w-9 rounded-md" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-lg font-bold leading-5 text-[#111713]">AdMate Compass</span>
              <span className="hidden text-[10px] font-semibold uppercase leading-3 tracking-[0.16em] text-[#667066] sm:block">
                정책 출처 확인
              </span>
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-10 items-center whitespace-nowrap rounded-lg border border-[#C6D9CB] bg-[#EDF7EF] px-3 py-2 text-sm font-medium text-[#1F7A4D] transition-colors hover:bg-[#E3F1E7]"
          >
            Compass 홈
          </Link>
        </div>
      </header>

      <main className="px-4 pb-16 pt-10 sm:px-6 md:pt-20">
        <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_420px] lg:items-start">
          <div className="rounded-lg border border-[#D6D8CD] border-t-4 border-t-[#111713] bg-white p-6 text-[#111713] shadow-sm md:p-8">
            <div className="compass-gate-pill-row" aria-label="Compass 서비스 정보">
              <span>COMPASS.ADMATE.AI.KR</span>
              <span>정책 기준 확인</span>
            </div>
            <div className="mt-4 space-y-4">
              <ReactiveHeadline>정책 기준을 근거와 함께 확인합니다</ReactiveHeadline>
              <p className="compass-gate-copy max-w-2xl text-sm leading-6 text-[#34423A]">
                질문 조건에 맞는 공식 정책과 출처를 모아, 적용 가능한 기준과 추가 확인 사항을 구분합니다.
              </p>
            </div>

            <div className="mt-8 grid gap-3">
              {compassIntroItems.map((item) => (
                <article key={item.label} className="rounded-lg border border-[#D8DCCF] bg-[#FBFBF7] p-4">
                  <div className="flex gap-4">
                    <span className="mt-0.5 text-xs font-black text-[#1F7A4D]">{item.label}</span>
                    <div>
                      <strong className="block text-sm font-semibold leading-6 text-[#111713]">{item.title}</strong>
                      <p className="compass-gate-copy mt-1 text-sm leading-6 text-[#667066]">{item.detail}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#D6D8CD] border-t-4 border-t-[#1F7A4D] bg-white p-5 shadow-sm md:p-8">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#667066]">AdMate Compass</p>
              <h2 className="mt-2 text-xl font-semibold text-[#0D0D0D]">AdMate 계정으로 로그인</h2>
              <p className="mt-2 text-xs leading-5 text-[#667066]">
                회사 이메일로 로그인해 Compass 작업 공간을 이용하세요.
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <Label htmlFor="email" className="mb-2 block text-sm font-medium text-[#34423A]">
                  이메일
                </Label>
                <div className="compass-login-email-field">
                  <input
                    id="email"
                    type="text"
                    inputMode="email"
                    autoComplete="username"
                    required
                    value={emailLocalPart}
                    onChange={(event) => setEmailLocalPart(normalizeEmailLocalPart(event.target.value))}
                    className="min-h-11 min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-[#0D0D0D] outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="name"
                    aria-describedby="email-domain"
                    disabled={isSubmitting}
                  />
                  <span
                    id="email-domain"
                    aria-label="고정 이메일 도메인"
                    className="min-h-11 shrink-0 border-l border-[#D8DCCF] bg-[#EDF7EF] px-3 py-2.5 text-sm font-bold text-[#4B6556]"
                  >
                    @nasmedia.co.kr
                  </span>
                </div>
              </div>

              <div>
                <Label htmlFor="password" className="mb-2 block text-sm font-medium text-[#34423A]">
                  비밀번호
                </Label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  autoComplete="current-password"
                  className="compass-login-password-field min-h-11 w-full rounded-lg border border-[#D8DCCF] bg-white px-3 py-2.5 text-sm text-[#0D0D0D] outline-none transition-colors placeholder:text-[#9A9A9A] focus:border-[#1F7A4D] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSubmitting}
                  required
                />
              </div>

              {message && (
                <div className="rounded-lg border border-[#F5C2C7] bg-[#FFF7F7] px-3 py-2 text-sm leading-6 text-[#B42318]">
                  {message}
                </div>
              )}

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center rounded-lg bg-[#0D0D0D] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
              >
                {isSubmitting ? "로그인 중..." : "로그인하고 계속"}
              </button>
            </form>

            <div className="mt-6">
              <div className="space-y-3 rounded-lg border border-[#D8DCCF] bg-[#F4F5F0] p-4">
                <p className="text-sm font-medium text-[#111713]">Compass 이용 권한이 필요하신가요?</p>
                <p className="text-xs leading-5 text-[#667066]">
                  처음 이용하거나 권한이 없는 경우, AdMate 이용 권한을 요청해주세요.
                </p>
                <a
                  href={ACCESS_REQUEST_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-full items-center justify-center rounded-lg border border-[#D8DCCF] bg-white px-4 py-2.5 text-sm font-semibold text-[#34423A] transition-colors hover:bg-[#FBFBF7]"
                >
                  Compass 이용 권한 요청
                </a>
              </div>
              <Link
                href={ADMATE_HOME_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex w-full items-center justify-center px-4 py-2 text-sm font-medium text-[#667066] transition-colors hover:text-[#111713]"
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
