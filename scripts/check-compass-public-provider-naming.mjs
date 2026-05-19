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

const checkedFiles = [
  'src/app/page.tsx',
  'src/app/login/page.tsx',
  'src/app/desk/page.tsx',
  ...walkFiles('src/components'),
]

const forbiddenPatterns = [
  { pattern: /\bollama\b/i, label: 'provider name "ollama"' },
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
const legacyProviderRoute = read('src/app/api/chat-huggingface/route.ts')
const legacyProviderService = read('src/lib/services/ollama.ts')
const healthRoute = read('src/app/api/health/route.ts')
const webIntegrationStatusRoute = read('src/app/api/web-integration-status/route.ts')
const packageJson = JSON.parse(read('package.json') || '{}')

for (const removedPage of [
  'src/app/test-ollama/page.tsx',
  'src/app/test-ollama-response/page.tsx',
  'src/app/test-railway/page.tsx',
]) {
  assertMissing(removedPage)
}

if (!publicRoute.includes("export { POST } from '../chat-ollama/route'")) {
  fail('src/app/api/compass-answer/route.ts must alias the legacy compatibility answer handler')
}

if (!legacyRoute.includes('export async function POST')) {
  fail('src/app/api/chat-ollama/route.ts must keep legacy compatibility POST handler')
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
  if (legacyRoute.includes(forbidden) || publicRoute.includes(forbidden)) {
    fail(`Compass answer routes must not expose provider-specific response field ${forbidden}`)
  }
}

for (const [relativePath, text] of [
  ['src/lib/services/ollama.ts', legacyProviderService],
  ['src/app/api/chat-ollama/route.ts', legacyRoute],
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
