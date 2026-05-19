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
const packageJson = JSON.parse(read('package.json') || '{}')

if (!publicRoute.includes("export { POST } from '../chat-ollama/route'")) {
  fail('src/app/api/compass-answer/route.ts must alias the legacy compatibility answer handler')
}

if (!legacyRoute.includes('export async function POST')) {
  fail('src/app/api/chat-ollama/route.ts must keep legacy compatibility POST handler')
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
