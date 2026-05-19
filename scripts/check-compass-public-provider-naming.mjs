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

const publicRoute = read('src/app/api/compass-answer/route.ts')
const legacyRoute = read('src/app/api/chat-ollama/route.ts')
const deskPage = read('src/app/desk/page.tsx')
const answerHandler = read('src/lib/server/compassAnswerHandler.ts')
const legacyProviderRoute = read('src/app/api/chat-huggingface/route.ts')
const legacyProviderService = read('src/lib/services/ollama.ts')
const healthRoute = read('src/app/api/health/route.ts')
const webIntegrationStatusRoute = read('src/app/api/web-integration-status/route.ts')
const packageJson = JSON.parse(read('package.json') || '{}')

const providerNamedDiagnosticRouteFiles = [
  'src/app/api/ollama/route.ts',
  'src/app/api/proxy-ollama/route.ts',
  'src/app/api/chat-railway/route.ts',
  'src/app/api/railway-status/route.ts',
  'src/app/api/chatbot/route.ts',
  'src/app/api/debug-env/route.ts',
  'src/app/api/debug-rag/route.ts',
]

const proxyRoute = read('src/app/api/proxy-ollama/route.ts')

for (const removedPage of [
  'src/app/test-ollama/page.tsx',
  'src/app/test-ollama-response/page.tsx',
  'src/app/test-railway/page.tsx',
]) {
  assertMissing(removedPage)
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
  ['src/app/api/chat-huggingface/route.ts', legacyProviderRoute],
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
      { pattern: /\bRailway\b/i, label: 'infra name Railway' },
      { pattern: /\bVultr\b/i, label: 'infra name Vultr' },
      { pattern: /ollama-v1/i, label: 'provider-specific version ollama-v1' },
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
]) {
  if (webIntegrationStatusRoute.includes(forbidden)) {
    fail(`src/app/api/web-integration-status/route.ts must not expose provider-specific status field ${forbidden}`)
  }
}

if (packageJson.scripts?.['check:compass-public-provider-naming'] !== 'node scripts/check-compass-public-provider-naming.mjs') {
  fail('package script check:compass-public-provider-naming is missing or changed')
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-public-provider-naming')) {
  fail('verify:harness must include check:compass-public-provider-naming')
}

if (!process.exitCode) {
  console.log('[check-compass-public-provider-naming] ok')
}
