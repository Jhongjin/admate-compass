import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const chatPagePath = path.join(root, 'src/app/desk/page.tsx')
const legacyChatPagePath = path.join(root, 'src/app/chat-ollama/page.tsx')
const legacyChatAliasPagePath = path.join(root, 'src/app/chat/page.tsx')
const canonicalRoutePath = path.join(root, 'src/app/api/chat-ollama/route.ts')
const legacyRoutePath = path.join(root, 'src/app/api/chatbot/route.ts')
const decisionDocPath = path.join(root, 'docs/tasks/2026-05-17_compass_reliability_3agent_openrouter_graphrag_plan_v3.md')
const packagePath = path.join(root, 'package.json')

function fail(message) {
  console.error(`[check-compass-answer-route-contract] ${message}`)
  process.exitCode = 1
}

for (const filePath of [chatPagePath, legacyChatPagePath, legacyChatAliasPagePath, canonicalRoutePath, legacyRoutePath, decisionDocPath, packagePath]) {
  if (!fs.existsSync(filePath)) fail(`missing required file: ${path.relative(root, filePath)}`)
}

if (process.exitCode) process.exit()

const chatPageText = fs.readFileSync(chatPagePath, 'utf8')
const legacyChatPageText = fs.readFileSync(legacyChatPagePath, 'utf8')
const legacyChatAliasPageText = fs.readFileSync(legacyChatAliasPagePath, 'utf8')
const canonicalRouteText = fs.readFileSync(canonicalRoutePath, 'utf8')
const legacyRouteText = fs.readFileSync(legacyRoutePath, 'utf8')
const decisionDocText = fs.readFileSync(decisionDocPath, 'utf8')
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

for (const requiredText of [
  "fetch('/api/chat-ollama'",
  'buildAssistantMessageFromResponse',
  'generation-limited',
  'noDataFound',
  'sanitizeSources',
]) {
  if (!chatPageText.includes(requiredText)) fail(`desk page missing ${requiredText}`)
}

for (const requiredText of [
  'redirect(suffix ? `/desk?${suffix}` : "/desk")',
]) {
  if (!legacyChatPageText.includes(requiredText)) fail(`legacy chat page missing ${requiredText}`)
  if (!legacyChatAliasPageText.includes(requiredText)) fail(`legacy chat alias page missing ${requiredText}`)
}

for (const requiredText of [
  'POST /api/chat-ollama',
  'generateCompassAnswer',
  'buildVerifiedSources',
  'verifiedSearchResults',
  "model: 'compass-answer-no-data'",
  "model: 'compass-answer-connection-failed'",
  'answerProvider',
]) {
  if (!canonicalRouteText.includes(requiredText)) fail(`canonical route missing ${requiredText}`)
}

for (const forbiddenText of [
  "generateResponse(message.trim(), 'tinyllama:1.1b')",
  'checkOllamaHealth',
]) {
  if (canonicalRouteText.includes(forbiddenText)) {
    fail(`canonical route must not use legacy Ollama-only behavior: ${forbiddenText}`)
  }
}

for (const requiredText of [
  "version: 'chatbot-v1'",
  "endpoint: '/api/chatbot'",
  'legacy: true',
  "canonicalEndpoint: '/api/chat-ollama'",
]) {
  if (!legacyRouteText.includes(requiredText)) fail(`legacy route missing ${requiredText}`)
}

for (const requiredText of [
  'Make `/api/chat-ollama` the canonical answer runtime.',
  'Treat `/api/chatbot` as legacy until removed or adapted.',
]) {
  if (!decisionDocText.includes(requiredText)) fail(`decision doc missing ${requiredText}`)
}

if (packageJson.scripts?.['check:compass-answer-route-contract'] !== 'node scripts/check-compass-answer-route-contract.mjs') {
  fail('package script check:compass-answer-route-contract is missing or changed')
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-answer-route-contract')) {
  fail('verify:harness must include check:compass-answer-route-contract')
}

if (!process.exitCode) console.log('[check-compass-answer-route-contract] ok')
