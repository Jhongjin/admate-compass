"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";

type GamePhase = "ready" | "playing" | "paused" | "over";
type PickupKind = "clear" | "heart" | "shield";

type StageConfig = {
  name: string;
  color: string;
  spawnInterval: number;
  baseSpeed: number;
  speedVariance: number;
  doubleChance: number;
  tripleChance: number;
  swayChance: number;
  shieldDrop: boolean;
  shieldDropInterval: number;
  freeShields: number;
  scoreThreshold: number;
};

type Keys = {
  left: boolean;
  right: boolean;
  up: boolean;
};

type Player = {
  facing: 1 | -1;
  groundY: number;
  height: number;
  hitTimer: number;
  isHit: boolean;
  jumpPower: number;
  onGround: boolean;
  speed: number;
  vx: number;
  vy: number;
  width: number;
  x: number;
  y: number;
};

type RiskObject = {
  height: number;
  label: string;
  phase: number;
  sway: number;
  vx: number;
  vy: number;
  width: number;
  x: number;
  y: number;
};

type Pickup = {
  kind: PickupKind;
  height: number;
  label: string;
  vy: number;
  width: number;
  x: number;
  y: number;
};

type Particle = {
  color: string;
  life: number;
  maxLife: number;
  size: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
};

type Star = {
  alpha: number;
  phase: number;
  size: number;
  x: number;
  y: number;
};

type GameState = {
  best: number;
  combo: number;
  comboText: string;
  comboTimer: number;
  dodged: number;
  gameOverComment: string;
  heartClock: number;
  keys: Keys;
  lives: number;
  maxCombo: number;
  maxLives: number;
  maxShields: number;
  noticeColor: string;
  noticeText: string;
  noticeTimer: number;
  particles: Particle[];
  phase: GamePhase;
  pickups: Pickup[];
  player: Player;
  pointerActive: boolean;
  pointerX: number;
  risks: RiskObject[];
  score: number;
  scoreClock: number;
  shakeTimer: number;
  shieldClock: number;
  shields: number;
  spawnClock: number;
  stage: number;
  stageText: string;
  stageTimer: number;
  stars: Star[];
  time: number;
};

type HudState = {
  best: number;
  combo: number;
  lives: number;
  phase: GamePhase;
  score: number;
  shields: number;
  stage: string;
};

const GAME_WIDTH = 400;
const GAME_HEIGHT = 600;
const GROUND_Y = GAME_HEIGHT - 60;

const STAGES: StageConfig[] = [
  {
    name: "STAGE 1",
    color: "#4aa3df",
    spawnInterval: 34,
    baseSpeed: 3.4,
    speedVariance: 1.8,
    doubleChance: 0.22,
    tripleChance: 0,
    swayChance: 0.12,
    shieldDrop: false,
    shieldDropInterval: 9999,
    freeShields: 0,
    scoreThreshold: 0,
  },
  {
    name: "STAGE 2",
    color: "#2d9f68",
    spawnInterval: 28,
    baseSpeed: 4.1,
    speedVariance: 2.2,
    doubleChance: 0.34,
    tripleChance: 0.08,
    swayChance: 0.22,
    shieldDrop: true,
    shieldDropInterval: 560,
    freeShields: 1,
    scoreThreshold: 55,
  },
  {
    name: "STAGE 3",
    color: "#c88a18",
    spawnInterval: 23,
    baseSpeed: 4.9,
    speedVariance: 2.7,
    doubleChance: 0.46,
    tripleChance: 0.18,
    swayChance: 0.34,
    shieldDrop: true,
    shieldDropInterval: 500,
    freeShields: 1,
    scoreThreshold: 150,
  },
  {
    name: "STAGE 4",
    color: "#ba4a3a",
    spawnInterval: 18,
    baseSpeed: 5.8,
    speedVariance: 3.2,
    doubleChance: 0.54,
    tripleChance: 0.28,
    swayChance: 0.44,
    shieldDrop: true,
    shieldDropInterval: 430,
    freeShields: 1,
    scoreThreshold: 310,
  },
  {
    name: "STAGE 5",
    color: "#8a5ab8",
    spawnInterval: 14,
    baseSpeed: 6.7,
    speedVariance: 3.8,
    doubleChance: 0.62,
    tripleChance: 0.4,
    swayChance: 0.56,
    shieldDrop: true,
    shieldDropInterval: 380,
    freeShields: 1,
    scoreThreshold: 520,
  },
];

const RISK_TERMS = [
  "SOURCE GAP",
  "POLICY FLAG",
  "UTM GAP",
  "LANDING MISMATCH",
  "BUDGET SPIKE",
  "MISSING EVIDENCE",
  "CLAIM DRIFT",
  "CHANNEL RISK",
  "EXPIRED CLAIM",
  "CREATIVE RISK",
  "LOW TRUST",
  "TARGET GAP",
] as const;

const GAME_OVER_COMMENTS = [
  { max: 80, lines: ["검증 기준이 너무 빨리 무너졌습니다.", "출처 확인 전에 위험 신호가 쌓였습니다."] },
  { max: 220, lines: ["흐름은 잡혔지만 아직 위험 신호가 많습니다.", "정책 신호를 더 오래 피해보세요."] },
  { max: 520, lines: ["운영 감각이 꽤 좋습니다.", "위험 신호를 잘 걸러냈습니다."] },
  { max: Infinity, lines: ["거의 운영 관제실 수준입니다.", "신뢰 흐름을 오래 지켜냈습니다."] },
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function choose<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

function getRandomComment(score: number) {
  const bucket = GAME_OVER_COMMENTS.find((item) => score < item.max) ?? GAME_OVER_COMMENTS[0];
  return choose(bucket.lines);
}

function createParticle(x: number, y: number, color = "#d9a63b"): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = 80 + Math.random() * 170;

  return {
    color,
    life: 0,
    maxLife: 0.48 + Math.random() * 0.36,
    size: 2 + Math.random() * 3,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 70,
    x,
    y,
  };
}

function createStars() {
  return Array.from({ length: 56 }, () => ({
    alpha: 0.25 + Math.random() * 0.55,
    phase: Math.random() * Math.PI * 2,
    size: 1 + Math.random() * 1.8,
    x: Math.random() * GAME_WIDTH,
    y: Math.random() * (GAME_HEIGHT * 0.62),
  }));
}

function createGame(best: number): GameState {
  return {
    best,
    combo: 0,
    comboText: "",
    comboTimer: 0,
    dodged: 0,
    gameOverComment: "",
    heartClock: 0,
    keys: { left: false, right: false, up: false },
    lives: 3,
    maxCombo: 0,
    maxLives: 5,
    maxShields: 3,
    noticeColor: "#ffffff",
    noticeText: "",
    noticeTimer: 0,
    particles: [],
    phase: "ready",
    pickups: [],
    player: {
      facing: 1,
      groundY: GROUND_Y,
      height: 42,
      hitTimer: 0,
      isHit: false,
      jumpPower: -11,
      onGround: true,
      speed: 5,
      vx: 0,
      vy: 0,
      width: 28,
      x: GAME_WIDTH / 2,
      y: GROUND_Y,
    },
    pointerActive: false,
    pointerX: GAME_WIDTH / 2,
    risks: [],
    score: 0,
    scoreClock: 0,
    shakeTimer: 0,
    shieldClock: 0,
    shields: 0,
    spawnClock: 0,
    stage: 0,
    stageText: STAGES[0]?.name ?? "STAGE 1",
    stageTimer: 80,
    stars: createStars(),
    time: 0,
  };
}

function restartGame(game: GameState) {
  const next = createGame(game.best);
  Object.assign(game, next, { phase: "playing" as GamePhase });
}

function getStage(game: GameState) {
  return STAGES[game.stage] ?? STAGES[0];
}

function updateStage(game: GameState) {
  let nextStage = 0;

  for (let index = STAGES.length - 1; index >= 0; index -= 1) {
    if (game.score >= STAGES[index].scoreThreshold) {
      nextStage = index;
      break;
    }
  }

  if (nextStage !== game.stage) {
    game.stage = nextStage;
    game.stageText = STAGES[nextStage].name;
    game.stageTimer = 95;
    game.shields = clamp(game.shields + STAGES[nextStage].freeShields, 0, game.maxShields);
    game.noticeText = "CHECK LEVEL UP";
    game.noticeColor = STAGES[nextStage].color;
    game.noticeTimer = 70;
  }
}

function getRiskWords(label: string) {
  return label.split(/\s+/).filter(Boolean);
}

function measureRiskBox(label: string) {
  const words = getRiskWords(label);
  const rows = Math.max(...words.map((word) => word.length), 4);
  const width = clamp(words.length * 15 + 16, 34, 58);
  const height = clamp(rows * 9 + 24, 58, 118);

  return { height, width };
}

function spawnRisk(game: GameState, offsetX = 0) {
  const stage = getStage(game);
  const label = choose(RISK_TERMS);
  const box = measureRiskBox(label);
  const x = clamp(Math.random() * (GAME_WIDTH - box.width - 24) + 12 + offsetX, 10, GAME_WIDTH - box.width - 10);
  const speed = (stage.baseSpeed + Math.random() * stage.speedVariance) * 48;
  const sway = Math.random() < stage.swayChance ? (Math.random() > 0.5 ? 1 : -1) * (22 + Math.random() * 24) : 0;

  game.risks.push({
    height: box.height,
    label,
    phase: Math.random() * Math.PI * 2,
    sway,
    vx: 0,
    vy: speed,
    width: box.width,
    x,
    y: -box.height - 8,
  });
}

function spawnPickup(game: GameState, kind: PickupKind) {
  const label = kind === "clear" ? "CLEAR" : kind === "heart" ? "LIFE" : "SHIELD";
  const width = kind === "clear" ? 64 : 58;

  game.pickups.push({
    kind,
    height: 24,
    label,
    vy: kind === "clear" ? 150 : 126,
    width,
    x: Math.random() * (GAME_WIDTH - width - 36) + 18,
    y: -30,
  });
}

function updatePlayer(game: GameState, frameScale: number) {
  const player = game.player;
  const pointerDirection =
    game.pointerActive && Math.abs(game.pointerX - player.x) > 8
      ? game.pointerX > player.x
        ? 1
        : -1
      : 0;
  const keyDirection = (game.keys.right ? 1 : 0) - (game.keys.left ? 1 : 0);
  const direction = keyDirection || pointerDirection;

  player.vx = direction * player.speed;

  if (direction < 0) {
    player.facing = -1;
  } else if (direction > 0) {
    player.facing = 1;
  }

  if (game.keys.up && player.onGround) {
    player.vy = player.jumpPower;
    player.onGround = false;
  }

  player.vy += 0.55 * frameScale;
  player.x += player.vx * frameScale;
  player.y += player.vy * frameScale;
  player.x = clamp(player.x, 17, GAME_WIDTH - 17);

  if (player.y >= player.groundY) {
    player.y = player.groundY;
    player.vy = 0;
    player.onGround = true;
  }

  if (player.hitTimer > 0) {
    player.hitTimer -= frameScale;
    if (player.hitTimer <= 0) {
      player.hitTimer = 0;
      player.isHit = false;
    }
  }
}

function playerBounds(player: Player) {
  return {
    h: player.height,
    w: player.width,
    x: player.x - player.width / 2,
    y: player.y - player.height + 8,
  };
}

function intersects(a: { h: number; w: number; x: number; y: number }, b: { h: number; w: number; x: number; y: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function burst(game: GameState, x: number, y: number, color = "#ba4a3a", count = 12) {
  for (let index = 0; index < count; index += 1) {
    game.particles.push(createParticle(x, y, color));
  }
}

function updateGame(game: GameState, deltaSeconds: number) {
  const frameScale = clamp(deltaSeconds * 60, 0.4, 2.1);
  const stage = getStage(game);

  game.time += frameScale;
  game.scoreClock += deltaSeconds;
  game.spawnClock += frameScale;
  game.heartClock += frameScale;
  game.shieldClock += frameScale;

  while (game.scoreClock >= 0.16) {
    game.score += 1;
    game.scoreClock -= 0.16;
  }

  updateStage(game);
  updatePlayer(game, frameScale);

  if (game.spawnClock >= stage.spawnInterval) {
    game.spawnClock = 0;
    spawnRisk(game);

    if (Math.random() < stage.doubleChance) {
      spawnRisk(game, Math.random() > 0.5 ? 48 : -48);
    }

    if (Math.random() < stage.tripleChance) {
      spawnRisk(game, Math.random() > 0.5 ? 110 : -110);
    }

    if (Math.random() < 0.045) {
      spawnPickup(game, "clear");
    }
  }

  if (game.heartClock >= 760) {
    game.heartClock = 0;
    if (Math.random() < 0.14 && game.lives < game.maxLives) {
      spawnPickup(game, "heart");
    }
  }

  if (stage.shieldDrop && game.shieldClock >= stage.shieldDropInterval) {
    game.shieldClock = 0;
    if (game.shields < game.maxShields) {
      spawnPickup(game, "shield");
    }
  }

  const playerBox = playerBounds(game.player);

  for (let index = game.risks.length - 1; index >= 0; index -= 1) {
    const risk = game.risks[index];
    risk.phase += deltaSeconds * 4;
    risk.x += Math.sin(risk.phase) * risk.sway * deltaSeconds;
    risk.y += risk.vy * deltaSeconds;

    if (risk.y > GAME_HEIGHT + 30) {
      game.risks.splice(index, 1);
      game.dodged += 1;
      game.combo += 1;
      game.maxCombo = Math.max(game.maxCombo, game.combo);
      game.score += 2;

      if (game.combo > 0 && game.combo % 10 === 0) {
        game.comboText = `${game.combo} CLEAN`;
        game.comboTimer = 60;
      }
      continue;
    }

    if (
      !game.player.isHit &&
      intersects(playerBox, { h: risk.height, w: risk.width, x: risk.x, y: risk.y })
    ) {
      game.risks.splice(index, 1);
      game.combo = 0;
      game.player.isHit = true;
      game.player.hitTimer = 42;
      game.shakeTimer = 14;
      burst(game, risk.x + risk.width / 2, risk.y + risk.height / 2);

      if (game.shields > 0) {
        game.shields -= 1;
        game.noticeText = "SHIELD USED";
        game.noticeColor = "#4aa3df";
        game.noticeTimer = 58;
      } else {
        game.lives -= 1;
        game.noticeText = "TRUST HIT";
        game.noticeColor = "#ba4a3a";
        game.noticeTimer = 58;

        if (game.lives <= 0) {
          game.phase = "over";
          game.best = Math.max(game.best, game.score);
          game.gameOverComment = getRandomComment(game.score);
          return;
        }
      }
    }
  }

  for (let index = game.pickups.length - 1; index >= 0; index -= 1) {
    const pickup = game.pickups[index];
    pickup.y += pickup.vy * deltaSeconds;

    if (pickup.y > GAME_HEIGHT + 28) {
      game.pickups.splice(index, 1);
      continue;
    }

    if (intersects(playerBox, { h: pickup.height, w: pickup.width, x: pickup.x, y: pickup.y })) {
      game.pickups.splice(index, 1);

      if (pickup.kind === "clear") {
        const cleared = game.risks.length;
        for (const risk of game.risks) {
          burst(game, risk.x + risk.width / 2, risk.y + risk.height / 2, "#d9a63b", 5);
        }
        game.risks = [];
        game.score += cleared * 4;
        game.noticeText = `CLEAR ${cleared}`;
        game.noticeColor = "#d9a63b";
      } else if (pickup.kind === "heart") {
        game.lives = clamp(game.lives + 1, 0, game.maxLives);
        game.noticeText = "LIFE +1";
        game.noticeColor = "#de4960";
      } else {
        game.shields = clamp(game.shields + 1, 0, game.maxShields);
        game.noticeText = "SHIELD +1";
        game.noticeColor = "#4aa3df";
      }

      game.noticeTimer = 70;
      burst(game, pickup.x + pickup.width / 2, pickup.y + pickup.height / 2, game.noticeColor, 14);
    }
  }

  for (let index = game.particles.length - 1; index >= 0; index -= 1) {
    const particle = game.particles[index];
    particle.life += deltaSeconds;
    particle.vy += 300 * deltaSeconds;
    particle.x += particle.vx * deltaSeconds;
    particle.y += particle.vy * deltaSeconds;

    if (particle.life >= particle.maxLife) {
      game.particles.splice(index, 1);
    }
  }

  if (game.comboTimer > 0) game.comboTimer -= frameScale;
  if (game.stageTimer > 0) game.stageTimer -= frameScale;
  if (game.noticeTimer > 0) game.noticeTimer -= frameScale;
  if (game.shakeTimer > 0) game.shakeTimer -= frameScale;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawBackground(context: CanvasRenderingContext2D, game: GameState) {
  const stage = getStage(game);
  const progress = (game.score % 900) / 900;
  const isDay = progress > 0.2 && progress < 0.72;
  const sky = context.createLinearGradient(0, 0, 0, GAME_HEIGHT);

  if (isDay) {
    sky.addColorStop(0, "#75b8dc");
    sky.addColorStop(1, "#f3c67b");
  } else if (progress < 0.2) {
    sky.addColorStop(0, "#12142a");
    sky.addColorStop(1, "#2c1a4d");
  } else {
    sky.addColorStop(0, "#071022");
    sky.addColorStop(1, "#17213d");
  }

  context.fillStyle = sky;
  context.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  if (!isDay) {
    for (const star of game.stars) {
      const alpha = star.alpha * (0.55 + Math.sin(game.time * 0.04 + star.phase) * 0.25);
      context.fillStyle = `rgba(255, 255, 255, ${clamp(alpha, 0.08, 0.9)})`;
      context.fillRect(star.x, star.y, star.size, star.size);
    }
  }

  const orbit = (game.time * 0.00055 + progress) % 1;
  const bodyX = -30 + (GAME_WIDTH + 60) * orbit;
  const bodyY = GAME_HEIGHT + 40 - (GAME_HEIGHT - 70) * Math.sin(Math.PI * orbit);

  context.save();
  context.shadowBlur = 22;
  context.shadowColor = isDay ? "rgba(255, 221, 87, 0.55)" : "rgba(210, 226, 245, 0.36)";
  context.fillStyle = isDay ? "#ffdd57" : "#d8e3ef";
  context.beginPath();
  context.arc(bodyX, bodyY, isDay ? 27 : 22, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.fillStyle = isDay ? "#284d33" : "#172238";
  context.fillRect(0, GAME_HEIGHT - 35, GAME_WIDTH, 35);
  context.strokeStyle = stage.color;
  context.globalAlpha = 0.55;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, GAME_HEIGHT - 35);
  context.lineTo(GAME_WIDTH, GAME_HEIGHT - 35);
  context.stroke();
  context.globalAlpha = 1;
}

function drawRisk(context: CanvasRenderingContext2D, risk: RiskObject) {
  const warning = risk.label.includes("POLICY") || risk.label.includes("MISSING") || risk.label.includes("EXPIRED");
  const words = getRiskWords(risk.label);
  const columnGap = words.length > 1 ? 12 : 0;
  const totalColumnsWidth = words.length * 9 + Math.max(0, words.length - 1) * columnGap;

  context.save();
  context.translate(risk.x + risk.width / 2, risk.y + risk.height / 2);
  context.rotate(Math.sin(risk.phase) * 0.025);
  roundedRect(context, -risk.width / 2, -risk.height / 2, risk.width, risk.height, 10);
  context.fillStyle = warning ? "rgba(186, 74, 58, 0.92)" : "rgba(25, 34, 53, 0.9)";
  context.fill();
  context.strokeStyle = warning ? "rgba(255, 226, 202, 0.9)" : "rgba(220, 228, 224, 0.7)";
  context.lineWidth = 1;
  context.stroke();

  context.fillStyle = warning ? "rgba(255, 226, 202, 0.92)" : "rgba(220, 228, 224, 0.78)";
  roundedRect(context, -risk.width / 2 + 5, -risk.height / 2 + 5, risk.width - 10, 4, 2);
  context.fill();

  context.fillStyle = "#fffdf7";
  context.font = "800 8.5px Geist, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const word = words[wordIndex];
    const characters = Array.from(word);
    const x = -totalColumnsWidth / 2 + wordIndex * (9 + columnGap) + 4.5;
    const lineHeight = 8.7;
    const startY = -(characters.length - 1) * lineHeight * 0.5 + 5;

    for (let characterIndex = 0; characterIndex < characters.length; characterIndex += 1) {
      context.fillText(characters[characterIndex], x, startY + characterIndex * lineHeight);
    }
  }

  context.restore();
}

function drawPickup(context: CanvasRenderingContext2D, pickup: Pickup) {
  const color = pickup.kind === "clear" ? "#d9a63b" : pickup.kind === "heart" ? "#de4960" : "#4aa3df";

  context.save();
  roundedRect(context, pickup.x, pickup.y, pickup.width, pickup.height, 8);
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 12;
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = "rgba(255, 255, 255, 0.8)";
  context.stroke();
  context.fillStyle = "#fffdf7";
  context.font = "800 10px Geist, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(pickup.label, pickup.x + pickup.width / 2, pickup.y + pickup.height / 2 + 1);
  context.restore();
}

function drawPlayer(context: CanvasRenderingContext2D, game: GameState) {
  const player = game.player;

  if (player.isHit && Math.floor(player.hitTimer / 4) % 2 === 0) {
    return;
  }

  context.save();
  context.translate(player.x, player.y);
  context.fillStyle = "rgba(0, 0, 0, 0.22)";
  context.beginPath();
  context.ellipse(0, 23, 16, 4, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = "#f4f5f0";
  context.lineCap = "round";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, -8);
  context.lineTo(0, 8);
  context.stroke();
  context.beginPath();
  context.moveTo(0, 8);
  context.lineTo(-8, 21);
  context.moveTo(0, 8);
  context.lineTo(8, 21);
  context.stroke();
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(0, -3);
  context.lineTo(-11, 4);
  context.moveTo(0, -3);
  context.lineTo(11, 4);
  context.stroke();

  context.fillStyle = "#f4f5f0";
  context.beginPath();
  context.arc(0, -15, 8, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#16213e";
  context.beginPath();
  context.arc(player.facing * 3, -16, 1.5, 0, Math.PI * 2);
  context.fill();

  if (game.shields > 0) {
    const pulse = 0.38 + Math.sin(game.time * 0.09) * 0.12;
    context.strokeStyle = `rgba(74, 163, 223, ${pulse})`;
    context.lineWidth = 2.5;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.arc(0, 0, 26, 0, Math.PI * 2);
    context.stroke();
  }

  context.restore();
}

function drawHud(context: CanvasRenderingContext2D, game: GameState) {
  const stage = getStage(game);

  context.fillStyle = "#ba4a3a";
  context.font = "700 12px Geist, Arial, sans-serif";
  context.textAlign = "left";
  context.fillText("SCORE", 12, 24);
  context.fillStyle = "#fffdf7";
  context.font = "800 22px Geist, Arial, sans-serif";
  context.fillText(String(game.score), 12, 48);

  context.textAlign = "center";
  context.fillStyle = stage.color;
  context.font = "800 11px Geist, Arial, sans-serif";
  context.fillText(stage.name, GAME_WIDTH / 2, 24);

  for (let index = 0; index < game.maxLives; index += 1) {
    context.fillStyle = index < game.lives ? "#de4960" : "rgba(255, 255, 255, 0.18)";
    context.beginPath();
    context.arc(GAME_WIDTH - 18 - index * 18, 18, 6, 0, Math.PI * 2);
    context.fill();
  }

  for (let index = 0; index < game.maxShields; index += 1) {
    context.strokeStyle = index < game.shields ? "#4aa3df" : "rgba(255, 255, 255, 0.18)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(GAME_WIDTH - 18 - index * 18, 40, 6, 0, Math.PI * 2);
    context.stroke();
  }

  if (game.comboTimer > 0) {
    context.save();
    context.globalAlpha = clamp(game.comboTimer / 22, 0, 1);
    context.fillStyle = "#d9a63b";
    context.font = "900 18px Geist, Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(game.comboText, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 56);
    context.restore();
  }

  if (game.stageTimer > 0) {
    context.save();
    context.globalAlpha = clamp(game.stageTimer / 28, 0, 1);
    context.fillStyle = stage.color;
    context.font = "900 24px Geist, Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(game.stageText, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 12);
    context.restore();
  }

  if (game.noticeTimer > 0) {
    context.save();
    context.globalAlpha = clamp(game.noticeTimer / 20, 0, 1);
    context.fillStyle = game.noticeColor;
    context.shadowColor = game.noticeColor;
    context.shadowBlur = 12;
    context.font = "800 14px Geist, Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(game.noticeText, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 36);
    context.restore();
  }
}

function drawGame(context: CanvasRenderingContext2D, game: GameState, canvasWidth: number, canvasHeight: number) {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = "#101726";
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const scale = Math.min(canvasWidth / GAME_WIDTH, canvasHeight / GAME_HEIGHT);
  const offsetX = (canvasWidth - GAME_WIDTH * scale) / 2;
  const offsetY = (canvasHeight - GAME_HEIGHT * scale) / 2;

  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);

  if (game.shakeTimer > 0) {
    const power = game.shakeTimer * 0.16;
    context.translate((Math.random() - 0.5) * power, (Math.random() - 0.5) * power);
  }

  roundedRect(context, 0, 0, GAME_WIDTH, GAME_HEIGHT, 12);
  context.clip();
  drawBackground(context, game);
  game.pickups.forEach((pickup) => drawPickup(context, pickup));
  game.risks.forEach((risk) => drawRisk(context, risk));

  for (const particle of game.particles) {
    const alpha = 1 - particle.life / particle.maxLife;
    context.globalAlpha = clamp(alpha, 0, 1);
    context.fillStyle = particle.color;
    context.beginPath();
    context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    context.fill();
  }

  context.globalAlpha = 1;
  drawPlayer(context, game);
  drawHud(context, game);
  context.restore();
}

function readBestScore() {
  if (typeof window === "undefined") return 0;
  const stored = window.localStorage.getItem("compass-campaign-survivor-best");
  const parsed = stored ? Number.parseInt(stored, 10) : 0;

  return Number.isFinite(parsed) ? parsed : 0;
}

function writeBestScore(score: number) {
  window.localStorage.setItem("compass-campaign-survivor-best", String(score));
}

function getVirtualPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.min(bounds.width / GAME_WIDTH, bounds.height / GAME_HEIGHT);
  const offsetX = (bounds.width - GAME_WIDTH * scale) / 2;
  const offsetY = (bounds.height - GAME_HEIGHT * scale) / 2;

  return {
    x: clamp((clientX - bounds.left - offsetX) / scale, 0, GAME_WIDTH),
    y: clamp((clientY - bounds.top - offsetY) / scale, 0, GAME_HEIGHT),
  };
}

export default function CompassCampaignSurvivorPanel() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const phaseRef = useRef<GamePhase>("ready");
  const [phase, setPhaseState] = useState<GamePhase>("ready");
  const [hud, setHud] = useState<HudState>({
    best: 0,
    combo: 0,
    lives: 3,
    phase: "ready",
    score: 0,
    shields: 0,
    stage: STAGES[0]?.name ?? "STAGE 1",
  });

  const setPhase = (next: GamePhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  const syncHud = () => {
    const game = gameRef.current;
    if (!game) return;

    setHud({
      best: game.best,
      combo: game.combo,
      lives: game.lives,
      phase: game.phase,
      score: game.score,
      shields: game.shields,
      stage: getStage(game).name,
    });
  };

  const startRound = () => {
    const game = gameRef.current;
    if (!game) return;

    restartGame(game);
    setPhase("playing");
    syncHud();
    window.requestAnimationFrame(() => panelRef.current?.focus());
  };

  const togglePause = () => {
    const game = gameRef.current;
    if (!game || game.phase === "ready" || game.phase === "over") return;

    const next = game.phase === "paused" ? "playing" : "paused";
    game.phase = next;
    setPhase(next);
    syncHud();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const game = createGame(readBestScore());
    let frameId = 0;
    let lastTime = performance.now();
    let lastHudSync = 0;

    gameRef.current = game;
    setHud((current) => ({ ...current, best: game.best }));

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(bounds.width * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(bounds.height * devicePixelRatio));
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      drawGame(context, game, bounds.width, bounds.height);
    };

    const loop = (time: number) => {
      const bounds = canvas.getBoundingClientRect();
      const deltaSeconds = clamp((time - lastTime) / 1000, 1 / 120, 1 / 20);
      lastTime = time;

      if (game.phase === "playing") {
        updateGame(game, deltaSeconds);

        const nextPhase = game.phase as GamePhase;

        if (nextPhase === "over") {
          writeBestScore(game.best);
          setPhase("over");
        }
      }

      drawGame(context, game, bounds.width, bounds.height);

      if (time - lastHudSync > 110) {
        lastHudSync = time;
        syncHud();
      }

      frameId = window.requestAnimationFrame(loop);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const activeGame = gameRef.current;
      const activeCanvas = canvasRef.current;
      if (!activeGame || !activeCanvas) return;

      const point = getVirtualPoint(activeCanvas, event.clientX, event.clientY);
      activeGame.pointerX = point.x;
    };

    const handlePointerDown = (event: PointerEvent) => {
      const activeGame = gameRef.current;
      const activeCanvas = canvasRef.current;
      if (!activeGame || !activeCanvas) return;

      panelRef.current?.focus();
      const point = getVirtualPoint(activeCanvas, event.clientX, event.clientY);
      activeGame.pointerActive = true;
      activeGame.pointerX = point.x;

      if (point.y < GAME_HEIGHT * 0.48) {
        activeGame.keys.up = true;
      }
    };

    const handlePointerUp = () => {
      const activeGame = gameRef.current;
      if (!activeGame) return;

      activeGame.pointerActive = false;
      activeGame.keys.up = false;
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    frameId = window.requestAnimationFrame(loop);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const game = gameRef.current;
    if (!game) return;

    if (event.code === "Enter" && (game.phase === "ready" || game.phase === "over")) {
      event.preventDefault();
      startRound();
      return;
    }

    if (event.code === "Escape" || event.code === "KeyP") {
      event.preventDefault();
      togglePause();
      return;
    }

    if (game.phase !== "playing") return;

    if (event.code === "ArrowLeft" || event.code === "KeyA") {
      event.preventDefault();
      game.keys.left = true;
    }

    if (event.code === "ArrowRight" || event.code === "KeyD") {
      event.preventDefault();
      game.keys.right = true;
    }

    if (event.code === "ArrowUp" || event.code === "KeyW" || event.code === "Space") {
      event.preventDefault();
      game.keys.up = true;
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    const game = gameRef.current;
    if (!game) return;

    if (event.code === "ArrowLeft" || event.code === "KeyA") {
      game.keys.left = false;
    }

    if (event.code === "ArrowRight" || event.code === "KeyD") {
      game.keys.right = false;
    }

    if (event.code === "ArrowUp" || event.code === "KeyW" || event.code === "Space") {
      game.keys.up = false;
    }
  };

  return (
    <div
      ref={panelRef}
      className="compass-source-material compass-survivor-panel mt-4 hidden lg:block lg:flex-1"
      tabIndex={0}
      role="application"
      aria-label="Compass campaign survivor"
      onBlur={() => {
        const game = gameRef.current;
        if (game) {
          game.keys.left = false;
          game.keys.right = false;
          game.keys.up = false;
          game.pointerActive = false;
        }
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <div className="compass-survivor-panel__screen">
        <canvas ref={canvasRef} className="compass-survivor-panel__canvas" aria-hidden="true" />

        {phase !== "playing" && (
          <div className="compass-survivor-panel__overlay">
            {phase === "ready" && (
              <>
                <p className="compass-survivor-panel__kicker">CAMPAIGN SURVIVOR</p>
                <h3>위험 신호를 피하세요</h3>
                <p>정책, 출처, 캠페인 조건을 흔드는 신호가 아래로 떨어집니다.</p>
                <button type="button" onClick={startRound}>
                  START
                </button>
              </>
            )}

            {phase === "paused" && (
              <>
                <p className="compass-survivor-panel__kicker">PAUSED</p>
                <h3>점검 일시정지</h3>
                <button type="button" onClick={togglePause}>
                  계속하기
                </button>
              </>
            )}

            {phase === "over" && (
              <>
                <p className="compass-survivor-panel__kicker">REVIEW BLOCKED</p>
                <h3>{hud.score.toLocaleString()}점</h3>
                <p>{gameRef.current?.gameOverComment || "위험 신호가 누적되었습니다."}</p>
                <button type="button" onClick={startRound}>
                  RETRY
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="compass-survivor-panel__status" aria-hidden="true">
        <span>{hud.stage}</span>
        <strong>{hud.score.toLocaleString()}</strong>
        <em>BEST {hud.best.toLocaleString()}</em>
        <em>LIFE {hud.lives}</em>
        <em>SHIELD {hud.shields}</em>
        {hud.combo > 0 && <em>CLEAN {hud.combo}</em>}
      </div>
    </div>
  );
}
