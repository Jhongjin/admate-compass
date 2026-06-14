"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle } from "lucide-react";
import CompassCampaignSurvivorPanel from "./CompassCampaignSurvivorPanel";
import { SiteSwitchDropdown } from "@/components/layouts/SiteSwitchDropdown";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { getCompassCoreProductLoginAction } from "@/lib/auth/coreStartPath";
import { sanitizeCompassNextPath } from "@/lib/auth/safeNext";

const COMPASS_DESK_PATH = "/desk";
const ACCESS_REQUEST_URL = "https://home.admate.ai.kr/access-request?product=compass";
const ADMATE_HOME_URL = "https://home.admate.ai.kr";

const loginErrorMessages: Record<string, string> = {
  account_not_allowed: "요청한 제품 이용 권한을 확인할 수 없습니다.",
  handoff_disabled: "AdMate 로그인 연결이 아직 활성화되지 않았습니다. 담당자에게 문의해주세요.",
  handoff_unavailable: "로그인 연결을 준비할 수 없습니다. 잠시 후 다시 시도해주세요.",
  invalid_credentials: "계정 정보를 확인해주세요.",
  invalid_product: "로그인 대상 제품을 확인할 수 없습니다.",
  missing_credentials: "이메일과 비밀번호를 입력해주세요.",
  origin_not_allowed: "로그인 요청 경로를 확인해주세요.",
  rate_limited: "로그인 요청이 많습니다. 잠시 후 다시 시도해주세요.",
};

const supportedMedia = [
  { id: "meta", name: "Meta" },
  { id: "google", name: "Google" },
  { id: "youtube", name: "YouTube" },
  { id: "naver", name: "Naver" },
  { id: "kakao", name: "Kakao" },
  { id: "gdn", name: "GDN" },
] as const;

const compassHighlights = [
  ["지원 매체", "Meta, Google/YouTube, Naver, Kakao, GDN 등 주요 매체 기준을 함께 확인합니다."],
  ["정책 기준", "공식 정책과 AdMate 확인 기준을 출처 문단과 함께 대조합니다."],
  ["신뢰 신호", "불확실한 조건은 결론과 분리해 추가 확인 필요 항목으로 표시합니다."],
  ["출처 비교", "여러 근거를 나란히 보고 적용 가능한 기준과 예외 조건을 구분합니다."],
] as const;

const previewRows = [
  ["가능한 표현", "정책 기준에 맞는 문구와 표현 범위를 정리합니다."],
  ["주의할 표현", "심사에서 보류될 수 있는 문구와 조건을 구분합니다."],
  ["추가 확인 필요", "업종 허가, 랜딩 고지, 이미지 맥락처럼 더 확인할 정보를 따로 둡니다."],
] as const;

const sourceConfidenceFlow = [
  ["출처 수집", "공식 정책 확인", "질문 조건과 관련된 정책 원문, 도움말, 운영 기준을 먼저 모읍니다."],
  ["기준 대조", "조건 비교", "매체별 표현 기준과 예외 조건을 나란히 보고 차이를 구분합니다."],
  ["확신도 표시", "남은 확인 사항", "근거가 부족한 부분은 결론과 분리해 추가 확인 항목으로 남깁니다."],
] as const;

const mediaScopes = [
  "검색광고",
  "소셜",
  "영상",
  "디스플레이",
  "커머스",
] as const;

const campaignRiskTerms = [
  "SOURCE GAP",
  "POLICY FLAG",
  "UTM GAP",
  "LANDING MISMATCH",
  "BUDGET SPIKE",
  "MISSING EVIDENCE",
  "CLAIM DRIFT",
  "CHANNEL RISK",
  "EXPIRED CLAIM",
] as const;

type HeadlineParticle = {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tone: "ink" | "blue" | "gold";
};

type MediaId = (typeof supportedMedia)[number]["id"];

type CampaignRiskTerm = {
  label: (typeof campaignRiskTerms)[number];
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  lane: number;
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

const normalizeEmailLocalPart = (value: string) =>
  value
    .trim()
    .replace(/\s/g, "")
    .replace(/@nasmedia\.co\.kr$/i, "")
    .replace(/@.*$/g, "");

const getDisplayableAccount = (user: NonNullable<ReturnType<typeof useAuth>["user"]>) => {
  const metadata = user.user_metadata;
  const displayName =
    typeof metadata.display_name === "string"
      ? metadata.display_name
      : typeof metadata.full_name === "string"
        ? metadata.full_name
        : typeof metadata.name === "string"
          ? metadata.name
          : null;

  return {
    label: displayName?.trim() || user.email || user.id,
    email: user.email,
  };
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
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / devicePixelRatio;
      const height = canvas.height / devicePixelRatio;

      context.clearRect(0, 0, width, height);

      for (const particle of particles) {
        const color = particle.tone === "blue" ? "#293B5A" : particle.tone === "gold" ? "#A67B2D" : "#172033";

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
              tone: toneSeed === 0 ? "gold" : toneSeed < 4 ? "blue" : "ink",
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
    <h1 ref={headingRef} className="compass-reactive-headline mt-4 max-w-[660px]">
      <span className="compass-reactive-headline__text">{children}</span>
      <canvas ref={canvasRef} className="compass-reactive-headline__canvas" aria-hidden="true" />
    </h1>
  );
}

function MediaLogo({ id }: { id: MediaId }) {
  if (id === "meta") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
        <path
          d="M4.2 14.3c1.1-3.6 2.7-5.4 4.6-5.4 1.4 0 2.4 1 3.2 2.2.8-1.2 1.8-2.2 3.2-2.2 1.9 0 3.5 1.8 4.6 5.4.6 1.9-.2 3.4-1.7 3.4-1.2 0-2.2-.8-3.5-2.4l-2.6-3.2-2.6 3.2c-1.3 1.6-2.3 2.4-3.5 2.4-1.5 0-2.3-1.5-1.7-3.4Z"
          fill="none"
          stroke="#2764D9"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
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

function CompassCampaignDodgerPanel() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeKeysRef = useRef(new Set<string>());
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [isArmed, setIsArmed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const storedBest = window.sessionStorage.getItem("compass-campaign-dodger-best");
    const parsedBest = storedBest ? Number.parseInt(storedBest, 10) : 0;

    if (Number.isFinite(parsedBest) && parsedBest > 0) {
      setBestScore(parsedBest);
    }

    let terms: CampaignRiskTerm[] = [];
    let frameId = 0;
    let lastTime = performance.now();
    let spawnTimer = 0;
    let scoreValue = 0;
    let bestValue = Number.isFinite(parsedBest) ? parsedBest : 0;
    let lastScoreCommit = 0;
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--compass-font-sans");
    const player = {
      x: 0,
      targetX: 0,
      y: 0,
      width: 54,
      height: 12,
    };

    const getSize = () => {
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      return {
        devicePixelRatio,
        width: canvas.width / devicePixelRatio,
        height: canvas.height / devicePixelRatio,
      };
    };

    const resetRound = () => {
      const { width, height } = getSize();
      terms = [];
      scoreValue = 0;
      spawnTimer = 0.2;
      player.x = width / 2;
      player.targetX = width / 2;
      player.y = height - 28;
      setScore(0);
    };

    const spawnTerm = () => {
      const { width } = getSize();
      const label = campaignRiskTerms[Math.floor(Math.random() * campaignRiskTerms.length)];

      context.save();
      context.font = `800 10px ${fontFamily}`;
      const termWidth = Math.ceil(context.measureText(label).width) + 20;
      context.restore();

      const maxX = Math.max(16, width - termWidth - 16);
      terms.push({
        label,
        x: 16 + Math.random() * Math.max(1, maxX - 16),
        y: -24,
        width: termWidth,
        height: 22,
        speed: 54 + Math.random() * 42 + Math.min(40, scoreValue * 1.4),
        lane: Math.floor(Math.random() * 5),
      });
    };

    const commitScore = () => {
      setScore(scoreValue);

      if (scoreValue > bestValue) {
        bestValue = scoreValue;
        window.sessionStorage.setItem("compass-campaign-dodger-best", String(bestValue));
        setBestScore(bestValue);
      }
    };

    const draw = (focused: boolean) => {
      const { width, height } = getSize();

      context.clearRect(0, 0, width, height);
      context.save();
      context.fillStyle = "rgba(251, 247, 238, 0.68)";
      context.fillRect(0, 0, width, height);

      context.strokeStyle = "rgba(23, 32, 51, 0.07)";
      context.lineWidth = 1;
      for (let lane = 1; lane < 5; lane += 1) {
        const x = (width / 5) * lane;
        context.beginPath();
        context.moveTo(x, 8);
        context.lineTo(x, height - 8);
        context.stroke();
      }

      context.font = `800 10px ${fontFamily}`;
      context.textBaseline = "middle";

      for (const term of terms) {
        const heat = Math.min(1, term.y / Math.max(1, height));
        context.fillStyle = term.lane % 3 === 0 ? "rgba(166, 123, 45, 0.16)" : "rgba(31, 122, 77, 0.13)";
        context.strokeStyle = term.lane % 3 === 0 ? "rgba(166, 123, 45, 0.34)" : "rgba(31, 122, 77, 0.3)";
        context.lineWidth = 1;
        context.beginPath();
        context.roundRect(term.x, term.y, term.width, term.height, 6);
        context.fill();
        context.stroke();
        context.fillStyle = `rgba(23, 32, 51, ${0.72 + heat * 0.18})`;
        context.fillText(term.label, term.x + 10, term.y + term.height / 2);
      }

      context.fillStyle = focused ? "#1F7A4D" : "#172033";
      context.strokeStyle = "rgba(23, 32, 51, 0.28)";
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(player.x - player.width / 2, player.y, player.width, player.height, 6);
      context.fill();
      context.stroke();

      context.fillStyle = "rgba(251, 247, 238, 0.9)";
      context.fillRect(player.x - 12, player.y + 4, 24, 3);

      if (!focused) {
        context.fillStyle = "rgba(251, 247, 238, 0.7)";
        context.fillRect(0, 0, width, height);
        context.beginPath();
        context.arc(width * 0.5, height * 0.54, 30, 0, Math.PI * 2);
        context.strokeStyle = "rgba(31, 122, 77, 0.18)";
        context.stroke();
        context.fillStyle = "rgba(23, 32, 51, 0.58)";
        context.font = `700 10px ${fontFamily}`;
        context.textAlign = "center";
        context.fillText("CLICK TO CHECK", width * 0.5, height * 0.54 + 4);
      }

      context.restore();
    };

    const rebuildCanvas = () => {
      const bounds = canvas.getBoundingClientRect();
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(bounds.width));
      const height = Math.max(1, Math.round(bounds.height));

      canvas.width = Math.ceil(width * devicePixelRatio);
      canvas.height = Math.ceil(height * devicePixelRatio);
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      player.y = height - 28;
      player.x = Math.min(Math.max(player.x || width / 2, player.width / 2 + 8), width - player.width / 2 - 8);
      player.targetX = player.x;
      draw(document.activeElement === panelRef.current);
    };

    const tick = (time: number) => {
      const focused = document.activeElement === panelRef.current;
      const { width, height } = getSize();
      const deltaSeconds = Math.min(0.035, (time - lastTime) / 1000 || 1 / 60);
      lastTime = time;

      if (focused) {
        const keys = activeKeysRef.current;
        const keyDirection = (keys.has("ArrowRight") || keys.has("KeyD") ? 1 : 0) - (keys.has("ArrowLeft") || keys.has("KeyA") ? 1 : 0);
        player.targetX += keyDirection * 260 * deltaSeconds;
        player.targetX = Math.min(Math.max(player.targetX, player.width / 2 + 8), width - player.width / 2 - 8);
        player.x += (player.targetX - player.x) * Math.min(1, 14 * deltaSeconds);

        spawnTimer -= deltaSeconds;
        if (spawnTimer <= 0) {
          spawnTerm();
          spawnTimer = Math.max(0.42, 1.08 - scoreValue * 0.014);
        }

        const playerLeft = player.x - player.width / 2;
        const playerRight = player.x + player.width / 2;
        const playerTop = player.y;
        const playerBottom = player.y + player.height;

        for (const term of terms) {
          term.y += term.speed * deltaSeconds;

          if (
            term.x < playerRight &&
            term.x + term.width > playerLeft &&
            term.y < playerBottom &&
            term.y + term.height > playerTop
          ) {
            commitScore();
            resetRound();
            break;
          }
        }

        const remainingTerms: CampaignRiskTerm[] = [];
        for (const term of terms) {
          if (term.y > height + 12) {
            scoreValue += 1;
          } else {
            remainingTerms.push(term);
          }
        }
        terms = remainingTerms;

        if (scoreValue !== lastScoreCommit && scoreValue % 3 === 0) {
          lastScoreCommit = scoreValue;
          commitScore();
        }
      }

      draw(focused);
      frameId = window.requestAnimationFrame(tick);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      player.targetX = Math.min(Math.max(event.clientX - bounds.left, player.width / 2 + 8), bounds.width - player.width / 2 - 8);
    };

    const handlePointerDown = (event: PointerEvent) => {
      panelRef.current?.focus();
      handlePointerMove(event);
      setIsArmed(true);
    };

    const resizeObserver = new ResizeObserver(rebuildCanvas);

    rebuildCanvas();
    resetRound();
    frameId = window.requestAnimationFrame(tick);
    resizeObserver.observe(canvas);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerDown);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.code === "KeyA" || event.code === "KeyD") {
      event.preventDefault();
      activeKeysRef.current.add(event.code);
      setIsArmed(true);
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    activeKeysRef.current.delete(event.code);
  };

  return (
    <div
      ref={panelRef}
      className="compass-source-material compass-campaign-dodger mt-4 hidden lg:block lg:flex-1"
      tabIndex={0}
      role="application"
      aria-label="Compass campaign term dodger"
      onFocus={() => setIsArmed(true)}
      onBlur={() => {
        activeKeysRef.current.clear();
        setIsArmed(false);
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <canvas ref={canvasRef} className="compass-source-material__canvas" aria-hidden="true" />
      <div className="compass-campaign-dodger__hud" aria-hidden="true">
        <span>TERM DODGER</span>
        <strong>{score.toString().padStart(2, "0")}</strong>
        <em>BEST {bestScore.toString().padStart(2, "0")}</em>
      </div>
      <span className="sr-only">
        {isArmed ? "Campaign term dodger active. Use left and right arrow keys." : "Focus or click to play campaign term dodger."}
      </span>
    </div>
  );
}

export default function HomePage() {
  const { user, loading } = useAuth();
  const coreProductLoginAction = getCompassCoreProductLoginAction();
  const [emailLocalPart, setEmailLocalPart] = useState("");
  const [password, setPassword] = useState("");
  const [formNextPath, setFormNextPath] = useState(COMPASS_DESK_PATH);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loginError = params.get("login_error") || params.get("auth_error");

    setFormNextPath(sanitizeCompassNextPath(params.get("next")));

    if (loginError) {
      setLoginMessage(loginErrorMessages[loginError] ?? "계정 정보를 확인해주세요.");
    }
  }, []);

  if (loading) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#ECEFF2] px-6 text-[#172033]">
        <div className="rounded-[8px] border border-[#D6D2C8] bg-[#FBF7EE] px-6 py-5 text-center shadow-[0_22px_60px_rgba(23,32,51,0.09)]">
          <p className="text-sm font-semibold text-[#5B6472]">Compass 이용 가능 여부를 확인하고 있습니다.</p>
        </div>
      </main>
    );
  }

  const account = user ? getDisplayableAccount(user) : null;

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
      <div className="pointer-events-none absolute inset-x-0 top-16 h-px bg-[#111713]/10" aria-hidden="true" />

      <header className="fixed left-0 right-0 top-0 z-50 border-b border-[#E2E8F0] bg-white/95 text-[#0F172A] backdrop-blur-[14px]">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-2 px-4 py-2 sm:gap-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-3 text-[#0F172A]" aria-label="AdMate Compass home">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[6px] bg-white" aria-hidden="true">
              <img src="/brand/admate-compass-mark.svg" alt="" className="block h-full w-full" />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-lg font-bold leading-5 text-[#0F172A]">AdMate Compass</strong>
              <em className="mt-px hidden text-[10px] font-semibold uppercase not-italic leading-3 tracking-[0.16em] text-[#64748B] sm:block">
                policy evidence desk
              </em>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <SiteSwitchDropdown isAuthenticated={Boolean(user)} />
            <Link
              href="#compass-login"
              className="inline-flex min-h-10 min-w-20 items-center justify-center rounded-[8px] bg-[#111713] px-3.5 py-2 text-[13px] font-extrabold text-white shadow-[0_10px_24px_rgba(17,23,19,0.12)] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#223128] active:scale-[0.98] sm:min-w-24 sm:px-4"
            >
              로그인
            </Link>
          </div>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-[1400px] items-stretch gap-5 px-4 pb-8 pt-24 sm:px-6 sm:pb-12 sm:pt-28 lg:grid-cols-[minmax(0,1.12fr)_390px] lg:px-8">
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
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#68707C]">
                ADMATE COMPASS · 정책 근거 확인
              </p>

              <ReactiveHeadline>광고 정책을 근거와 함께 확인하세요.</ReactiveHeadline>
              <p className="mt-4 max-w-[630px] text-base leading-8 text-[#344052] sm:text-lg">
                Compass는 광고 정책 질문에 필요한 출처와 확인 기준을 모아, 적용 가능한 근거를 빠르게 비교하도록 돕습니다.
              </p>
              <p className="mt-3 max-w-[610px] text-sm leading-7 text-[#68707C]">
                정책 원문, AdMate 확인 기준, 추가 확인이 필요한 조건을 한 화면에서 나눠 볼 수 있습니다.
              </p>
            </div>

            <div className="mt-8 rounded-[10px] border border-[#D9D4C8] bg-white/72 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold text-[#172033]">Compass 확인 기준</p>
                <span className="text-xs font-semibold text-[#1F7A4D]">정확한 근거와 남은 확인 사항을 함께 표시</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {compassHighlights.map(([title, detail]) => (
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
                  질문 조건과 출처를 함께 봅니다
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
                  alt="매체 정책과 출처 문서가 연결된 Compass 화면 예시"
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
                  <p className="text-xs font-bold text-[#BFD8C5]">출처 신뢰도 확인</p>
                  <h3 className="mt-2 text-xl font-semibold leading-tight text-white [text-wrap:balance]">
                    근거별 차이를 비교해 판단합니다
                  </h3>
                  <p className="mt-3 text-xs leading-5 text-white/68">
                    공식 출처와 적용 조건을 나란히 확인하고, 불확실한 부분은 별도로 표시합니다.
                  </p>
                  <div className="compass-review-rail mt-4 grid gap-2 lg:grid-cols-3">
                    {sourceConfidenceFlow.map(([stage, title, detail], index) => (
                      <div key={stage} className="compass-review-step rounded-[7px] border border-white/10 bg-white/[0.06] px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-[#BFD8C5] text-[11px] font-black text-[#172033]">
                            {index + 1}
                          </span>
                          <span className="text-[11px] font-black text-[#BFD8C5]">{stage}</span>
                        </div>
                        <p className="mt-2 text-sm font-bold leading-5 text-white">{title}</p>
                        <p className="mt-1.5 text-xs leading-5 text-white/64">{detail}</p>
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
              <span className="hidden text-xs font-semibold text-[#68707C] sm:inline">외부 이미지 없이 주요 매체를 빠르게 구분합니다</span>
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
            <div className="mt-4 grid gap-2 sm:grid-cols-5">
              {mediaScopes.map((scope) => (
                <span
                  key={scope}
                  className="rounded-[7px] border border-[#E1DED6] bg-white/74 px-3 py-2 text-center text-xs font-bold text-[#5B6472]"
                >
                  {scope}
                </span>
              ))}
            </div>
          </div>
        </motion.section>

        <motion.div
          id="compass-login"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.58, delay: 0.06, ease: [0.32, 0.72, 0, 1] }}
          className="flex h-full scroll-mt-24 flex-col lg:self-stretch"
        >
          <aside className="flex flex-col rounded-[10px] border border-[#D2CEC4] border-t-[5px] border-t-[#1F7A4D] bg-[#FBF7EE] p-5 shadow-[0_28px_80px_rgba(23,32,51,0.11)] sm:p-7">
            {account ? (
              <>
                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#1F7A4D]">ADMATE COMPASS</p>
                  <h2 className="mt-2 text-2xl font-semibold leading-tight text-[#172033]">로그인이 완료되었습니다</h2>
                  <p className="mt-3 text-sm leading-6 text-[#68707C]">
                    Compass 홈에서 필요한 정보를 확인한 뒤 대시보드로 이동할 수 있습니다.
                  </p>
                </div>

                <div className="rounded-[10px] border border-[#D9D4C8] bg-white/76 p-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-[8px] bg-[#E8F3EC] text-[#1F7A4D]">
                      <CheckCircle className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#172033]">인증된 Compass 계정</p>
                      <p className="mt-1 break-words text-sm leading-6 text-[#344052]">{account.label}</p>
                      {account.email && account.email !== account.label && (
                        <p className="mt-1 break-words text-xs leading-5 text-[#68707C]">{account.email}</p>
                      )}
                    </div>
                  </div>
                </div>

                <Link
                  href={formNextPath}
                  className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-[8px] bg-[#172033] px-5 py-3 text-sm font-bold text-white transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#273755] active:scale-[0.98]"
                >
                  Compass 대시보드로 이동
                </Link>
              </>
            ) : (
              <>
                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#1F7A4D]">ADMATE COMPASS</p>
                  <h2 className="mt-2 text-2xl font-semibold leading-tight text-[#172033]">AdMate 계정으로 로그인</h2>
                  <p className="mt-3 text-sm leading-6 text-[#68707C]">
                    회사 이메일로 로그인해 Compass 작업 공간을 이용하세요.
                  </p>
                </div>

                <form className="space-y-4" action={coreProductLoginAction} method="post">
                  <input type="hidden" name="product" value="compass" />
                  <input type="hidden" name="next" value="/" />
                  <div>
                    <Label htmlFor="compass-root-email" className="mb-2 block text-sm font-medium text-[#344052]">
                      이메일
                    </Label>
                    <div className="compass-login-email-field">
                      <input
                        id="compass-root-email"
                        name="email_local_part"
                        type="text"
                        inputMode="email"
                        autoComplete="username"
                        required
                        value={emailLocalPart}
                        onChange={(event) => setEmailLocalPart(normalizeEmailLocalPart(event.target.value))}
                        className="min-w-0 flex-1 bg-[#FFFFFF] px-3 py-2.5 text-sm text-[#0D0D0D] outline-none disabled:cursor-not-allowed disabled:opacity-60"
                        placeholder="name"
                        aria-describedby="compass-root-email-domain"
                      />
                      <span
                        id="compass-root-email-domain"
                        aria-label="고정 이메일 도메인"
                        className="shrink-0 border-l border-[#D8DCCF] bg-[#F8F8F5] px-3 py-2.5 text-sm font-normal text-[#4E5B67]"
                      >
                        @nasmedia.co.kr
                      </span>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="compass-root-password" className="mb-2 block text-sm font-medium text-[#344052]">
                      비밀번호
                    </Label>
                    <input
                      id="compass-root-password"
                      name="password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="비밀번호를 입력하세요"
                      autoComplete="current-password"
                      className="compass-login-password-field w-full rounded-[8px] border border-[#D8DCCF] bg-[#FFFFFF] px-3 py-2.5 text-sm text-[#0D0D0D] outline-none transition-colors placeholder:text-[#9A9A9A] focus:border-[#1F7A4D] disabled:cursor-not-allowed disabled:opacity-60"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    className="inline-flex min-h-12 w-full items-center justify-center rounded-[8px] bg-[#172033] px-5 py-3 text-sm font-bold text-white transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#273755] disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]"
                  >
                    로그인하고 계속
                  </button>

                  {loginMessage && (
                    <div className="rounded-[8px] border border-[#F5C2C7] bg-[#FFF7F7] px-3 py-2 text-sm leading-6 text-[#B42318]" role="status" aria-live="polite">
                      {loginMessage}
                    </div>
                  )}
                </form>
              </>
            )}

            <div className="mt-5 rounded-[10px] border border-[#D9D4C8] bg-white/72 p-4">
              <p className="text-sm font-bold text-[#172033]">Compass 이용 권한이 필요하신가요?</p>
              <p className="mt-2 text-xs leading-5 text-[#68707C]">
                처음 이용하거나 권한이 없는 경우, AdMate 이용 권한을 요청해주세요.
              </p>
              <a
                href={ACCESS_REQUEST_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] border border-[#D8DCCF] bg-white px-4 py-2.5 text-sm font-semibold text-[#344052] transition duration-300 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:bg-[#F8F8F5] active:scale-[0.98]"
              >
                Compass 이용 권한 요청
              </a>

              <a
                href={ADMATE_HOME_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex w-full items-center justify-center px-4 py-2 text-sm font-medium text-[#68707C] transition-colors hover:text-[#172033]"
              >
                AdMate 홈페이지로 이동
              </a>
            </div>
          </aside>

          <CompassCampaignSurvivorPanel />
        </motion.div>
      </section>
    </main>
  );
}
