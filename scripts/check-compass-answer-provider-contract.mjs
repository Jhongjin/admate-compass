#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

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

function isGitTracked(relativePath) {
  try {
    const output = execFileSync('git', ['ls-files', '--', relativePath], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes(relativePath)
  } catch {
    return false
  }
}

const service = read('src/lib/services/CompassAnswerLlmService.ts')
const canonicalRoute = read('src/app/api/compass-answer/route.ts')
const legacyCompatibilityRoute = read('src/app/api/chat-ollama/route.ts')
const answerHandler = read('src/lib/server/compassAnswerHandler.ts')
const legacyRoute = read('src/app/api/chatbot/route.ts')
const envExample = read('.env.example')
const providerDoc = read('docs/tasks/2026-05-17_compass_answer_llm_provider_boundary_v1.md')
const decisionDoc = read('docs/tasks/2026-05-17_compass_reliability_3agent_openrouter_graphrag_plan_v3.md')
const canaryDoc = read('docs/tasks/2026-05-17_compass_openrouter_canary_readiness_checklist_v1.md')
const packageJson = JSON.parse(read('package.json') || '{}')
const vercelJson = JSON.parse(read('vercel.json') || '{}')

const nonCommentEnvLines = envExample
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

for (const token of [
  "export type CompassAnswerProvider = 'openrouter' | 'ollama' | 'openai'",
  'export function getCompassAnswerRuntimeStatus',
  'OPENROUTER_API_KEY',
  'COMPASS_OPENROUTER_API_KEY',
  "process.env.COMPASS_ANSWER_PROVIDER || ''",
  "configured === 'openrouter'",
  "configured === 'openai'",
  "configured === 'ollama'",
  'DEFAULT_OPENROUTER_MODELS',
  'resolveOpenRouterModels',
  'resolveOpenRouterBaseUrl',
  'resolveOllamaAnswerTimeoutMs',
  'COMPASS_OLLAMA_ANSWER_TIMEOUT_MS',
  '/chat/completions',
  "data_collection: 'deny'",
  'allow_fallbacks: true',
  'require_parameters: true',
]) {
  if (!service.includes(token)) fail(`Compass answer provider service missing ${token}`)
}

for (const token of [
  "export { POST } from '@/lib/server/compassAnswerHandler'",
]) {
  if (!canonicalRoute.includes(token)) fail(`canonical route missing ${token}`)
  if (!legacyCompatibilityRoute.includes(token)) fail(`legacy compatibility route missing ${token}`)
}

for (const token of [
  'generateCompassAnswer',
  "model: 'compass-answer-connection-failed'",
  "model: 'compass-answer'",
]) {
  if (!answerHandler.includes(token)) fail(`neutral answer handler missing ${token}`)
}

if (answerHandler.includes('getCompassAnswerRuntimeStatus')) {
  fail('neutral answer handler must not log or expose answer runtime status')
}

for (const token of [
  'legacy: true',
  "canonicalEndpoint: '/api/compass-answer'",
]) {
  if (!legacyRoute.includes(token)) fail(`legacy route missing ${token}`)
}

for (const forbidden of [
  "legacyCompatibilityEndpoint: '/api/chat-ollama'",
  'legacyCompatibilityEndpoint: "/api/chat-ollama"',
]) {
  if (legacyRoute.includes(forbidden)) {
    fail(`legacy route must not advertise provider-named compatibility endpoint: ${forbidden}`)
  }
}

for (const token of [
  'COMPASS_ANSWER_PROVIDER=',
  'Leave empty for production auto selection',
  'COMPASS_ANSWER_MODELS=<OPENROUTER_MODEL_FALLBACKS_COMMA_SEPARATED>',
  'OPENROUTER_API_KEY=<SERVER_ONLY_OPENROUTER_API_KEY>',
  'OPENROUTER_BASE_URL=https://openrouter.ai/api/v1',
]) {
  if (!envExample.includes(token)) fail(`.env.example missing placeholder ${token}`)
}

if (nonCommentEnvLines.some((line) => /^COMPASS_ANSWER_PROVIDER\s*=\s*auto\b/i.test(line))) {
  fail('.env.example must not use the literal auto value; leave it empty for auto selection')
}

for (const forbidden of [
  'NEXT_PUBLIC_OPENROUTER',
  'NEXT_PUBLIC_COMPASS_OPENROUTER',
]) {
  for (const relativePath of [
    ...walkFiles('src'),
    '.env.example',
  ]) {
    const text = read(relativePath)
    if (text.includes(forbidden)) {
      fail(`${relativePath} must not expose server-only OpenRouter config via ${forbidden}`)
    }
  }
}

for (const forbiddenTrackedEnvFile of [
  '.env.render',
  '.env.vercel',
  'env.example',
]) {
  if (isGitTracked(forbiddenTrackedEnvFile) && fs.existsSync(path.join(root, forbiddenTrackedEnvFile))) {
    fail(`${forbiddenTrackedEnvFile} must not be tracked; keep real runtime values in Vercel env and use .env.example for placeholders`)
  }
}

if (Object.prototype.hasOwnProperty.call(vercelJson, 'env')) {
  fail('vercel.json must not embed runtime environment values; manage them through Vercel env')
}

for (const token of [
  'OpenRouter adapter already exists',
  'open-beta auto provider selection',
  'COMPASS_ANSWER_PROVIDER=auto/empty  -> OpenRouter when a server key exists, else OpenAI, else Ollama',
  'No real OpenRouter key is registered',
  'OpenRouter Operation Gate',
  'Empty/auto provider selection',
  'COMPASS_ANSWER_PROVIDER=ollama',
  'COMPASS_ANSWER_PROVIDER=openrouter',
  'server-only',
]) {
  if (!providerDoc.includes(token)) fail(`provider boundary doc missing ${token}`)
}

for (const token of [
  'readiness contract',
  'open-beta answer',
  'COMPASS_ANSWER_PROVIDER=auto/empty  -> OpenRouter when configured, else OpenAI, else Ollama',
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
  'Make `/api/compass-answer` the public-facing canonical answer runtime.',
  'Keep `/api/chat-ollama` as a legacy compatibility endpoint.',
  'Use OpenRouter as the future answer-model gateway.',
  'OpenRouter first means an approved explicit provider selection',
  'Treat `/api/chatbot` as legacy until removed or adapted.',
]) {
  if (!decisionDoc.includes(token)) fail(`reliability decision doc missing ${token}`)
}

const secretLogPattern = /console\.(log|error|warn|info)\s*\([^)]*(OPENROUTER_API_KEY|COMPASS_OPENROUTER_API_KEY|\bapiKey\b)[^)]*\)/i
for (const [label, text] of [
  ['CompassAnswerLlmService', service],
  ['neutral answer handler', answerHandler],
]) {
  const match = text.match(secretLogPattern)
  if (match) {
    fail(`${label} may expose OpenRouter secret material through console logging`)
  }
}

for (const forbidden of ['NEXT_PUBLIC_OPENROUTER']) {
  if (service.includes(forbidden) || canonicalRoute.includes(forbidden) || legacyCompatibilityRoute.includes(forbidden) || answerHandler.includes(forbidden)) {
    fail(`answer provider path may expose OpenRouter public config: ${forbidden}`)
  }
}

for (const forbidden of ['answerProvider']) {
  if (canonicalRoute.includes(forbidden) || legacyCompatibilityRoute.includes(forbidden) || answerHandler.includes(forbidden)) {
    fail(`answer route response must not expose provider-specific field: ${forbidden}`)
  }
}

if (packageJson.scripts?.['check:compass-answer-provider-contract'] !== 'node scripts/check-compass-answer-provider-contract.mjs') {
  fail('package script check:compass-answer-provider-contract is missing or changed')
}

if (!service.includes("if (hasOpenRouterKey()) return 'openrouter';")) {
  fail('Compass answer provider must auto-select OpenRouter when a server-side key is configured')
}

if (!/AbortSignal\.timeout\(resolveOllamaAnswerTimeoutMs\(\)\)/.test(service)) {
  fail('Ollama answer generation must fail fast so fallback can run before the Vercel function timeout')
}

const endpointResolver = read('src/lib/services/ollamaEndpoint.ts')
if (!(endpointResolver.indexOf('process.env.OLLAMA_BASE_URL') >= 0 && endpointResolver.indexOf('process.env.VULTR_OLLAMA_URL') >= 0)) {
  fail('Ollama endpoint resolver must support both OLLAMA_BASE_URL and VULTR_OLLAMA_URL')
} else if (endpointResolver.indexOf('process.env.OLLAMA_BASE_URL') > endpointResolver.indexOf('process.env.VULTR_OLLAMA_URL')) {
  fail('OLLAMA_BASE_URL must take precedence over VULTR_OLLAMA_URL to avoid stale provider-specific fallback URLs')
}

for (const forbiddenDefault of [
  "process.env.COMPASS_ANSWER_PROVIDER || 'openrouter'",
  "hasOpenRouterKey() ? 'openrouter'",
]) {
  if (service.includes(forbiddenDefault)) {
    fail(`Compass answer provider must use explicit ordered branching, not terse default switching: ${forbiddenDefault}`)
  }
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-answer-provider-contract')) {
  fail('verify:harness must include check:compass-answer-provider-contract')
}

if (!process.exitCode) {
  console.log('[check-compass-answer-provider-contract] ok')
}
