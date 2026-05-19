#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function fail(message) {
  console.error(`[check-compass-public-provider-naming] ${message}`)
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

function assertMissing(relativePath) {
  if (fs.existsSync(path.join(root, relativePath))) {
    fail(`${relativePath} must be removed from the browser-accessible app surface`)
  }
}

function walkFiles(relativeDir) {
  const dir = path.join(root, relativeDir)
  if (!fs.existsSync(dir)) return []

  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(relativePath))
    } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(relativePath)
    }
  }
  return files
}

function collectConsoleCalls(text) {
  const calls = []
  const consolePattern = /console\.(?:log|error|warn|info|debug)\s*\(/g
  let match

  while ((match = consolePattern.exec(text))) {
    let index = match.index
    let depth = 0
    let inString = null
    let escaped = false

    for (; index < text.length; index += 1) {
      const char = text[index]

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === inString) {
          inString = null
        }
        continue
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = char
        continue
      }

      if (char === '(') {
        depth += 1
      } else if (char === ')') {
        depth -= 1
        if (depth === 0) {
          calls.push(text.slice(match.index, index + 1))
          consolePattern.lastIndex = index + 1
          break
        }
      }
    }
  }

  return calls
}

function collectNextJsonResponses(text) {
  const calls = []
  const responsePattern = /NextResponse\.json\s*\(/g
  let match

  while ((match = responsePattern.exec(text))) {
    let index = match.index
    let depth = 0
    let inString = null
    let escaped = false

    for (; index < text.length; index += 1) {
      const char = text[index]

      if (inString) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === inString) {
          inString = null
        }
        continue
      }

      if (char === '"' || char === "'" || char === '`') {
        inString = char
        continue
      }

      if (char === '(') {
        depth += 1
      } else if (char === ')') {
        depth -= 1
        if (depth === 0) {
          calls.push(text.slice(match.index, index + 1))
          responsePattern.lastIndex = index + 1
          break
        }
      }
    }
  }

  return calls
}

const checkedFiles = [
  'src/app/page.tsx',
  'src/app/login/page.tsx',
  'src/app/desk/page.tsx',
  ...walkFiles('src/components'),
]

const publicDebugSurfaceFiles = [
  'src/components/chat/ChatInterface.tsx',
]

const forbiddenPatterns = [
  { pattern: /\bollama\b/i, label: 'provider name "ollama"' },
  { pattern: /\bopenrouter\b/i, label: 'provider gateway name "openrouter"' },
  { pattern: /\bllm\b/i, label: 'internal implementation name "LLM"' },
  { pattern: /\bagent\b/i, label: 'internal implementation name "agent"' },
  { pattern: /chat-ollama/i, label: 'legacy route name "chat-ollama"' },
  { pattern: /AdMate 가입 요청/, label: 'legacy access CTA "AdMate 가입 요청"' },
  { pattern: /접근 권한/, label: 'legacy access wording "접근 권한"' },
]

for (const relativePath of checkedFiles) {
  const text = read(relativePath)
  for (const { pattern, label } of forbiddenPatterns) {
    if (pattern.test(text)) {
      fail(`${relativePath} must not expose ${label}`)
    }
  }
}

for (const relativePath of publicDebugSurfaceFiles) {
  const text = read(relativePath)
  for (const consoleCall of collectConsoleCalls(text)) {
    for (const forbidden of [
      { pattern: /\btrimmedMessage\b/, label: 'raw request message' },
      { pattern: /\binputMessage\b/, label: 'raw input message' },
      { pattern: /\bmessageText\b/, label: 'raw message argument' },
      { pattern: /\bdata\b/, label: 'raw response payload' },
      { pattern: /\bresponse(?:\.statusText)?\b/, label: 'raw response metadata' },
      { pattern: /\berror\b/, label: 'raw error object' },
      { pattern: /\bbody\b/, label: 'request body' },
      { pattern: /\/api\/chat/i, label: 'internal chat route' },
    ]) {
      if (forbidden.pattern.test(consoleCall)) {
        fail(`${relativePath} console logging must not expose ${forbidden.label}`)
      }
    }
  }
}

const publicRoute = read('src/app/api/compass-answer/route.ts')
const legacyRoute = read('src/app/api/chat-ollama/route.ts')
const deskPage = read('src/app/desk/page.tsx')
const answerHandler = read('src/lib/server/compassAnswerHandler.ts')
const legacyProviderService = read('src/lib/services/ollama.ts')
const healthRoute = read('src/app/api/health/route.ts')
const webIntegrationStatusRoute = read('src/app/api/web-integration-status/route.ts')
const packageJson = JSON.parse(read('package.json') || '{}')
const vercelJson = JSON.parse(read('vercel.json') || '{}')
const evaluateRagFixturesScript = read('scripts/evaluate-rag-fixtures.mjs')
const compassAnswerLocalSmokeScript = read('scripts/smoke-compass-answer-local.mjs')

const providerNamedDiagnosticRouteFiles = [
  'src/app/api/ollama/route.ts',
  'src/app/api/proxy-ollama/route.ts',
  'src/app/api/chatbot/route.ts',
  'src/app/api/debug-env/route.ts',
  'src/app/api/debug-rag/route.ts',
]

const proxyRoute = read('src/app/api/proxy-ollama/route.ts')

const productionDebugGuardRequiredRouteFiles = [
  'src/app/api/ollama/route.ts',
  'src/app/api/proxy-ollama/route.ts',
  'src/app/api/debug-env/route.ts',
  'src/app/api/debug-rag/route.ts',
]

for (const relativePath of productionDebugGuardRequiredRouteFiles) {
  const text = read(relativePath)
  if (!/guardProductionAdminDebugRoute\s*\(\s*\)/.test(text)) {
    fail(`${relativePath} must call guardProductionAdminDebugRoute()`)
  }
}

for (const removedPage of [
  'src/app/test-ollama/page.tsx',
  'src/app/test-ollama-response/page.tsx',
  'src/app/test-railway/page.tsx',
]) {
  assertMissing(removedPage)
}

for (const removedRoute of [
  'src/app/api/chat-huggingface/route.ts',
  'src/app/api/test-huggingface/route.ts',
  'src/app/api/chat-railway/route.ts',
  'src/app/api/railway-status/route.ts',
]) {
  assertMissing(removedRoute)
}

if (!publicRoute.includes("export { POST } from '@/lib/server/compassAnswerHandler'")) {
  fail('src/app/api/compass-answer/route.ts must alias the neutral answer handler')
}

if (!legacyRoute.includes("export { POST } from '@/lib/server/compassAnswerHandler'")) {
  fail('src/app/api/chat-ollama/route.ts must keep legacy compatibility POST handler alias')
}

for (const forbidden of [
  'LLM1 후보',
  'LLM2 후보',
  '팀장 LLM',
  '3-agent',
]) {
  if (deskPage.includes(forbidden)) {
    fail(`src/app/desk/page.tsx must not expose legacy review label "${forbidden}"`)
  }
}

for (const required of [
  '1차 검토',
  '출처 대조',
  '최종 검토',
]) {
  if (!deskPage.includes(required)) {
    fail(`src/app/desk/page.tsx missing public review label "${required}"`)
  }
}

for (const token of [
  'answerRuntime',
  'configured:',
  'managed:',
  'reachable:',
  'documentStore',
  'responseTime',
]) {
  if (!healthRoute.includes(token)) {
    fail(`src/app/api/health/route.ts missing neutral health token ${token}`)
  }
}

for (const forbidden of [
  'services.ollama',
  'getOllamaEndpointStatus',
  'modelLabel',
  'defaultModel',
  'answerProvider',
  'models:',
  'source:',
  'Environment variables not set',
  'uptime:',
  'process.uptime',
  'memory:',
  'process.memoryUsage',
  'environment: process.env.NODE_ENV',
  'schema:',
  'getCompassDbSchema',
  'error?.message',
  'String(error)',
  '`HTTP ${response.status}`',
]) {
  if (healthRoute.includes(forbidden)) {
    fail(`src/app/api/health/route.ts must not expose provider-specific health field ${forbidden}`)
  }
}

for (const forbidden of [
  'answerProvider',
  'model: answerResult.model',
  'provider: answerResult.provider',
]) {
  if (legacyRoute.includes(forbidden) || publicRoute.includes(forbidden) || answerHandler.includes(forbidden)) {
    fail(`Compass answer routes must not expose provider-specific response field ${forbidden}`)
  }
}

for (const [relativePath, text] of [
  ['src/lib/services/ollama.ts', legacyProviderService],
  ['src/lib/server/compassAnswerHandler.ts', answerHandler],
]) {
  for (const consoleCall of collectConsoleCalls(text)) {
    for (const forbidden of [
      /\bollama\b/i,
      /hugging\s*face/i,
      /\brailway\b/i,
      /OPENROUTER/i,
      /COMPASS_ANSWER/i,
      /HUGGINGFACE/i,
      /NEXT_PUBLIC_SUPABASE/i,
      /SUPABASE_SERVICE/i,
      /modelLabel/i,
      /endpoint/i,
      /baseUrl/i,
      /apiKey/i,
    ]) {
      if (forbidden.test(consoleCall)) {
        fail(`${relativePath} has provider-internal or env-status console logging: ${forbidden}`)
      }
    }
  }
}

for (const relativePath of providerNamedDiagnosticRouteFiles) {
  const text = read(relativePath)
  const publicSurfaceSnippets = [
    ...collectConsoleCalls(text),
    ...collectNextJsonResponses(text),
  ]

  for (const snippet of publicSurfaceSnippets) {
    for (const forbidden of [
      { pattern: /\bOllama\b/i, label: 'provider name Ollama' },
      { pattern: /\bHugging\s*Face\b/i, label: 'provider name Hugging Face' },
      { pattern: /\bhuggingface\b/i, label: 'provider name huggingface' },
      { pattern: /\bRailway\b/i, label: 'infra name Railway' },
      { pattern: /\bVultr\b/i, label: 'infra name Vultr' },
      { pattern: /ollama-v1/i, label: 'provider-specific version ollama-v1' },
      { pattern: /huggingface-/i, label: 'provider-specific model huggingface-*' },
      { pattern: /railway-ollama/i, label: 'provider-specific model railway-ollama-*' },
      { pattern: /\/api\/chat-ollama/i, label: 'provider-named legacy endpoint /api/chat-ollama' },
      { pattern: /\/api\/ollama/i, label: 'provider-named endpoint /api/ollama' },
      { pattern: /meta-faq-ollama-production/i, label: 'default runtime URL' },
      { pattern: /https?:\/\/[^'"`\s)]*ollama/i, label: 'runtime URL containing provider name' },
      { pattern: /\bOLLAMA_[A-Z_]+\b/, label: 'provider-specific env key' },
      { pattern: /\bVULTR_OLLAMA_URL\b/, label: 'provider-specific env key' },
      { pattern: /getOllamaEndpointStatus\s*\(/, label: 'provider-specific endpoint status helper in public surface' },
      { pattern: /\burl\s*:\s*(?:railwayUrl|process\.env\.RAILWAY_OLLAMA_URL)/, label: 'runtime URL field' },
    ]) {
      if (forbidden.pattern.test(snippet)) {
        fail(`${relativePath} public response/console must not expose ${forbidden.label}`)
      }
    }
  }
}

for (const forbidden of [
  { pattern: /\.\.\.\s*data/, label: 'upstream response spread' },
  { pattern: /NextResponse\.json\s*\(\s*data\s*\)/, label: 'raw upstream response passthrough' },
]) {
  if (forbidden.pattern.test(proxyRoute)) {
    fail(`src/app/api/proxy-ollama/route.ts must not expose ${forbidden.label}`)
  }
}

for (const required of [
  'buildPublicGenerateResponse',
  "model: 'compass-answer'",
  'response:',
  'done:',
  'context:',
  'total_duration:',
  'load_duration:',
  'prompt_eval_count:',
  'prompt_eval_duration:',
  'eval_count:',
  'eval_duration:',
]) {
  if (!proxyRoute.includes(required)) {
    fail(`src/app/api/proxy-ollama/route.ts missing allowlisted generate field ${required}`)
  }
}

for (const token of [
  'answerRuntime: {',
  'configured: answerReady',
  "mode: 'managed'",
  "description: 'Compass 답변 런타임'",
  'documentStore: {',
  'runtimeConfigured:',
  'answerReady,',
]) {
  if (!webIntegrationStatusRoute.includes(token)) {
    fail(`src/app/api/web-integration-status/route.ts missing neutral status token ${token}`)
  }
}

for (const forbidden of [
  'provider:',
  'modelLabel',
  'openrouter:',
  'ollama:',
  'baseUrl:',
  'defaultModel',
  'answerProvider',
  'ollamaHealthy',
  'modelsConfigured',
  'supabase: {',
  'Supabase + pgvector',
  'error.message',
  'String(error)',
]) {
  if (webIntegrationStatusRoute.includes(forbidden)) {
    fail(`src/app/api/web-integration-status/route.ts must not expose provider-specific status field ${forbidden}`)
  }
}

for (const [relativePath, text] of [
  ['src/app/api/health/route.ts', healthRoute],
  ['src/app/api/web-integration-status/route.ts', webIntegrationStatusRoute],
]) {
  for (const snippet of collectNextJsonResponses(text)) {
    for (const forbidden of [
      { pattern: /\buptime\b/, label: 'process uptime' },
      { pattern: /\bmemory\b/, label: 'process memory' },
      { pattern: /environment\s*:\s*process\.env\.NODE_ENV/, label: 'runtime environment' },
      { pattern: /\bschema\s*:/, label: 'database schema' },
      { pattern: /error\?\.[a-zA-Z_$][\w$]*/, label: 'raw optional error field' },
      { pattern: /error\.message/, label: 'raw error message' },
      { pattern: /String\s*\(\s*error\s*\)/, label: 'raw stringified error' },
      { pattern: /HTTP\s+\$\{?response\.status\}?/, label: 'raw upstream HTTP status' },
      { pattern: /Supabase\s*\+\s*pgvector/i, label: 'storage technology stack' },
    ]) {
      if (forbidden.pattern.test(snippet)) {
        fail(`${relativePath} public response must not expose ${forbidden.label}`)
      }
    }
  }
}

if (packageJson.scripts?.['check:compass-public-provider-naming'] !== 'node scripts/check-compass-public-provider-naming.mjs') {
  fail('package script check:compass-public-provider-naming is missing or changed')
}

if (packageJson.scripts?.['smoke:compass-answer-local'] !== 'node scripts/smoke-compass-answer-local.mjs') {
  fail('package script smoke:compass-answer-local is missing or changed')
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-public-provider-naming')) {
  fail('verify:harness must include check:compass-public-provider-naming')
}

if (vercelJson.functions?.['src/app/api/compass-answer/route.ts']?.maxDuration !== 60) {
  fail('vercel.json must set src/app/api/compass-answer/route.ts maxDuration to 60')
}

if (!compassAnswerLocalSmokeScript.includes('COMPASS_ANSWER_SMOKE_URL')) {
  fail('scripts/smoke-compass-answer-local.mjs must prefer COMPASS_ANSWER_SMOKE_URL')
}

if (!compassAnswerLocalSmokeScript.includes('COMPASS_ANSWER_SMOKE_QUERY')) {
  fail('scripts/smoke-compass-answer-local.mjs must prefer COMPASS_ANSWER_SMOKE_QUERY')
}

if (!compassAnswerLocalSmokeScript.includes('http://127.0.0.1:3000/api/compass-answer')) {
  fail('scripts/smoke-compass-answer-local.mjs must default to /api/compass-answer')
}

const compassEvalEndpointIndex = evaluateRagFixturesScript.indexOf('process.env.COMPASS_ANSWER_EVAL_ENDPOINT')
const compassSmokeEndpointIndex = evaluateRagFixturesScript.indexOf('process.env.COMPASS_ANSWER_SMOKE_URL')
const legacySmokeEndpointIndex = evaluateRagFixturesScript.indexOf('process.env.CHAT_OLLAMA_SMOKE_URL')

if (compassEvalEndpointIndex === -1) {
  fail('scripts/evaluate-rag-fixtures.mjs must prefer COMPASS_ANSWER_EVAL_ENDPOINT')
}

if (compassSmokeEndpointIndex === -1) {
  fail('scripts/evaluate-rag-fixtures.mjs must prefer COMPASS_ANSWER_SMOKE_URL')
}

if (legacySmokeEndpointIndex !== -1 && legacySmokeEndpointIndex < compassSmokeEndpointIndex) {
  fail('scripts/evaluate-rag-fixtures.mjs must check COMPASS_ANSWER_SMOKE_URL before legacy CHAT_OLLAMA_SMOKE_URL')
}

if (!evaluateRagFixturesScript.includes('http://127.0.0.1:3000/api/compass-answer')) {
  fail('scripts/evaluate-rag-fixtures.mjs must default to /api/compass-answer')
}

if (!process.exitCode) {
  console.log('[check-compass-public-provider-naming] ok')
}
