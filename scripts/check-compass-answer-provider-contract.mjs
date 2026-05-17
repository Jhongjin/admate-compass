#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function fail(message) {
  console.error(`[check-compass-answer-provider-contract] ${message}`)
  process.exitCode = 1
}

function read(relativePath) {
  const fullPath = path.join(root, relativePath)
  if (!fs.existsSync(fullPath)) {
    fail(`missing ${relativePath}`)
    return ''
  }
  return fs.readFileSync(fullPath, 'utf8')
}

function walkFiles(relativeDir) {
  const dir = path.join(root, relativeDir)
  if (!fs.existsSync(dir)) return []

  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue
    const relativePath = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(relativePath))
    } else {
      files.push(relativePath)
    }
  }
  return files
}

const service = read('src/lib/services/CompassAnswerLlmService.ts')
const canonicalRoute = read('src/app/api/chat-ollama/route.ts')
const legacyRoute = read('src/app/api/chatbot/route.ts')
const envExample = read('.env.example')
const providerDoc = read('docs/tasks/2026-05-17_compass_answer_llm_provider_boundary_v1.md')
const decisionDoc = read('docs/tasks/2026-05-17_compass_reliability_3agent_openrouter_graphrag_plan_v3.md')
const canaryDoc = read('docs/tasks/2026-05-17_compass_openrouter_canary_readiness_checklist_v1.md')
const packageJson = JSON.parse(read('package.json') || '{}')

const nonCommentEnvLines = envExample
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

for (const token of [
  "export type CompassAnswerProvider = 'openrouter' | 'ollama'",
  'OPENROUTER_API_KEY',
  'COMPASS_OPENROUTER_API_KEY',
  "process.env.COMPASS_ANSWER_PROVIDER || 'ollama'",
  "configured === 'openrouter'",
  "configured === 'ollama'",
  'DEFAULT_OPENROUTER_MODELS',
  'resolveOpenRouterModels',
  'resolveOpenRouterBaseUrl',
  '/chat/completions',
  "data_collection: 'deny'",
  'allow_fallbacks: true',
  'require_parameters: true',
]) {
  if (!service.includes(token)) fail(`Compass answer provider service missing ${token}`)
}

for (const token of [
  'generateCompassAnswer',
  'getCompassAnswerRuntimeStatus',
  'answerProvider',
  "model: 'compass-answer-connection-failed'",
]) {
  if (!canonicalRoute.includes(token)) fail(`canonical route missing ${token}`)
}

for (const token of [
  'legacy: true',
  "canonicalEndpoint: '/api/chat-ollama'",
]) {
  if (!legacyRoute.includes(token)) fail(`legacy route missing ${token}`)
}

for (const token of [
  'COMPASS_ANSWER_PROVIDER=ollama',
  'Do not use COMPASS_ANSWER_PROVIDER=auto as a deployment default before canary',
  'COMPASS_ANSWER_MODELS=<OPENROUTER_MODEL_FALLBACKS_COMMA_SEPARATED>',
  'OPENROUTER_API_KEY=<SERVER_ONLY_OPENROUTER_API_KEY>',
  'OPENROUTER_BASE_URL=https://openrouter.ai/api/v1',
]) {
  if (!envExample.includes(token)) fail(`.env.example missing placeholder ${token}`)
}

if (nonCommentEnvLines.some((line) => /^COMPASS_ANSWER_PROVIDER\s*=\s*auto\b/i.test(line))) {
  fail('.env.example must not default COMPASS_ANSWER_PROVIDER to auto before OpenRouter canary')
}

for (const forbidden of [
  'NEXT_PUBLIC_OPENROUTER',
  'NEXT_PUBLIC_COMPASS_OPENROUTER',
]) {
  for (const relativePath of [
    ...walkFiles('src'),
    '.env.example',
    'env.example',
  ]) {
    const text = read(relativePath)
    if (text.includes(forbidden)) {
      fail(`${relativePath} must not expose server-only OpenRouter config via ${forbidden}`)
    }
  }
}

for (const token of [
  'OpenRouter adapter already exists',
  'canary-safe default pinned',
  'A server-side key alone must not switch Compass to OpenRouter before canary',
  'COMPASS_ANSWER_PROVIDER=auto/empty  -> Ollama',
  'No real OpenRouter key is registered',
  'OpenRouter Canary Gate',
  'activated by an explicit canary gate',
  'COMPASS_ANSWER_PROVIDER=ollama',
  'COMPASS_ANSWER_PROVIDER=openrouter',
  'server-only',
]) {
  if (!providerDoc.includes(token)) fail(`provider boundary doc missing ${token}`)
}

for (const token of [
  'readiness contract',
  'The runtime default is canary-safe',
  'COMPASS_ANSWER_PROVIDER=auto/empty  -> Ollama',
  'server-side secret',
  'COMPASS_ANSWER_PROVIDER=ollama',
  'COMPASS_ANSWER_PROVIDER=openrouter',
  'COMPASS_ANSWER_MODELS',
  'NEXT_PUBLIC_OPENROUTER_*',
  'NEXT_PUBLIC_COMPASS_OPENROUTER_*',
  'Rollback',
]) {
  if (!canaryDoc.includes(token)) fail(`OpenRouter canary readiness doc missing ${token}`)
}

for (const token of [
  'Make `/api/chat-ollama` the canonical answer runtime.',
  'Use OpenRouter as the future answer-model gateway.',
  'OpenRouter first means an approved explicit provider selection',
  'Treat `/api/chatbot` as legacy until removed or adapted.',
]) {
  if (!decisionDoc.includes(token)) fail(`reliability decision doc missing ${token}`)
}

const secretLogPattern = /console\.(log|error|warn|info)\s*\([^)]*(OPENROUTER_API_KEY|COMPASS_OPENROUTER_API_KEY|\bapiKey\b)[^)]*\)/i
for (const [label, text] of [
  ['CompassAnswerLlmService', service],
  ['canonical answer route', canonicalRoute],
]) {
  const match = text.match(secretLogPattern)
  if (match) {
    fail(`${label} may expose OpenRouter secret material through console logging`)
  }
}

for (const forbidden of ['NEXT_PUBLIC_OPENROUTER']) {
  if (service.includes(forbidden) || canonicalRoute.includes(forbidden)) {
    fail(`answer provider path may expose OpenRouter public config: ${forbidden}`)
  }
}

if (packageJson.scripts?.['check:compass-answer-provider-contract'] !== 'node scripts/check-compass-answer-provider-contract.mjs') {
  fail('package script check:compass-answer-provider-contract is missing or changed')
}

if (service.includes("hasOpenRouterKey() ? 'openrouter' : 'ollama'")) {
  fail('Compass answer provider must not auto-switch to OpenRouter from key presence before canary')
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-answer-provider-contract')) {
  fail('verify:harness must include check:compass-answer-provider-contract')
}

if (!process.exitCode) {
  console.log('[check-compass-answer-provider-contract] ok')
}
