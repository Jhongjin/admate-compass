#!/usr/bin/env node

import fs from "node:fs";

const routePath = "src/app/api/compass-answer/stream/route.ts";
const deskPath = "src/app/desk/page.tsx";

const route = fs.readFileSync(routePath, "utf8");
const desk = fs.readFileSync(deskPath, "utf8");

const checks = [
  {
    name: "stream route exists and uses NDJSON",
    ok: route.includes("application/x-ndjson"),
  },
  {
    name: "stream route disables transform buffering",
    ok: route.includes("no-cache, no-transform") && route.includes("X-Accel-Buffering"),
  },
  {
    name: "stream route emits phase events",
    ok: route.includes("type: 'phase'") && route.includes("CompassAnswerPhaseEmitter"),
  },
  {
    name: "stream route emits delta events before final",
    ok: route.includes("type: 'delta'")
      && route.indexOf("type: 'delta',\n            content") < route.indexOf("type: 'final',\n          status"),
  },
  {
    name: "stream route final payload preserves existing answer contract",
    ok: route.includes("payload: result.body") && route.includes("buildCompassAnswerResponse"),
  },
  {
    name: "desk client prefers stream endpoint",
    ok: desk.includes("/api/compass-answer/stream"),
  },
  {
    name: "desk client appends delta to assistant message",
    ok: desk.includes("appendStreamDelta") && desk.includes('event.type === "delta"'),
  },
  {
    name: "desk client falls back to JSON endpoint",
    ok: desk.includes("fetchCompassAnswerJson") && desk.includes("/api/compass-answer"),
  },
];

const failed = checks.filter((check) => !check.ok);

if (failed.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: "compass-answer-stream-route-contract",
    failed,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: "compass-answer-stream-route-contract",
  checks: checks.length,
}, null, 2));
