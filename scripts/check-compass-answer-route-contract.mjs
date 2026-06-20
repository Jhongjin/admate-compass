import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const chatPagePath = path.join(root, 'src/app/desk/page.tsx')
const legacyChatPagePath = path.join(root, 'src/app/chat-ollama/page.tsx')
const legacyChatAliasPagePath = path.join(root, 'src/app/chat/page.tsx')
const publicAnswerRoutePath = path.join(root, 'src/app/api/compass-answer/route.ts')
const legacyAnswerRoutePath = path.join(root, 'src/app/api/chat-ollama/route.ts')
const answerHandlerPath = path.join(root, 'src/lib/server/compassAnswerHandler.ts')
const legacyRoutePath = path.join(root, 'src/app/api/chatbot/route.ts')
const decisionDocPath = path.join(root, 'docs/tasks/2026-05-17_compass_reliability_3agent_openrouter_graphrag_plan_v3.md')
const packagePath = path.join(root, 'package.json')

function fail(message) {
  console.error(`[check-compass-answer-route-contract] ${message}`)
  process.exitCode = 1
}

for (const filePath of [chatPagePath, legacyChatPagePath, legacyChatAliasPagePath, publicAnswerRoutePath, legacyAnswerRoutePath, answerHandlerPath, legacyRoutePath, decisionDocPath, packagePath]) {
  if (!fs.existsSync(filePath)) fail(`missing required file: ${path.relative(root, filePath)}`)
}

if (process.exitCode) process.exit()

const chatPageText = fs.readFileSync(chatPagePath, 'utf8')
const legacyChatPageText = fs.readFileSync(legacyChatPagePath, 'utf8')
const legacyChatAliasPageText = fs.readFileSync(legacyChatAliasPagePath, 'utf8')
const publicAnswerRouteText = fs.readFileSync(publicAnswerRoutePath, 'utf8')
const legacyAnswerRouteText = fs.readFileSync(legacyAnswerRoutePath, 'utf8')
const answerHandlerText = fs.readFileSync(answerHandlerPath, 'utf8')
const legacyRouteText = fs.readFileSync(legacyRoutePath, 'utf8')
const decisionDocText = fs.readFileSync(decisionDocPath, 'utf8')
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))

for (const requiredText of [
  "fetch('/api/compass-answer'",
  'buildAssistantMessageFromResponse',
  'generation-limited',
  'noDataFound',
  'sanitizeSources',
]) {
  if (!chatPageText.includes(requiredText)) fail(`desk page missing ${requiredText}`)
}

if (chatPageText.includes("fetch('/api/chat-ollama'") || chatPageText.includes('fetch("/api/chat-ollama"')) {
  fail('desk page must use public-neutral /api/compass-answer for user-facing answer requests')
}

for (const requiredText of [
  'redirect(suffix ? `/desk?${suffix}` : "/desk")',
]) {
  if (!legacyChatPageText.includes(requiredText)) fail(`legacy chat page missing ${requiredText}`)
  if (!legacyChatAliasPageText.includes(requiredText)) fail(`legacy chat alias page missing ${requiredText}`)
}

for (const requiredText of [
  "export { POST } from '@/lib/server/compassAnswerHandler'",
]) {
  if (!publicAnswerRouteText.includes(requiredText)) fail(`public answer route missing ${requiredText}`)
  if (!legacyAnswerRouteText.includes(requiredText)) fail(`legacy compatibility answer route missing ${requiredText}`)
}

for (const requiredText of [
  'generateCompassAnswer',
  'buildVerifiedSources',
  'function isVerifiedGrounding',
  'verifiedSearchResults',
  "evidenceDecision === 'verified'",
  "model: 'compass-answer-no-data'",
  "model: 'compass-answer-connection-failed'",
  'function buildCompassAnswerModel',
  'buildCompassAnswerModel(message, ragIntent, isBroadProductStructureLlmIntent)',
  'buildAuthoritativeNoDataResponse',
  'ragIntent.isOutOfScope || ragIntent.unavailablePolicyTarget',
  'answerStatesNoVerifiedData(responseAnswer)',
  'getProductStructurePublicSourceKey',
  'sourceIdentityLooksLikeGenericLegalOrAccountDoc(source)',
  'sources: []',
  "'compass-answer-grounded-product-structure-llm'",
  "'compass-answer'",
]) {
  if (!answerHandlerText.includes(requiredText)) fail(`neutral answer handler missing ${requiredText}`)
}

const verifiedFilterIndex = answerHandlerText.indexOf('const verifiedSearchResults = searchResults.filter(isVerifiedGrounding)')
const generationIndex = answerHandlerText.indexOf('answerResult = await generateCompassAnswer(')
const noDataIndex = answerHandlerText.indexOf('if (verifiedSearchResults.length === 0)')
const authoritativeBoundaryIndex = answerHandlerText.indexOf('if (ragIntent.isOutOfScope || ragIntent.unavailablePolicyTarget)')
const finalNoAnswerGuardIndex = answerHandlerText.indexOf('if (answerStatesNoVerifiedData(responseAnswer))')
const finalGroundedNoDataFalseIndex = answerHandlerText.indexOf('noDataFound: false', finalNoAnswerGuardIndex)
if (verifiedFilterIndex === -1 || noDataIndex === -1 || generationIndex === -1 || !(verifiedFilterIndex < noDataIndex && noDataIndex < generationIndex)) {
  fail('neutral answer handler must route weak-only evidence to noData before answer generation')
}

if (authoritativeBoundaryIndex === -1 || !(authoritativeBoundaryIndex < verifiedFilterIndex)) {
  fail('neutral answer handler must apply out-of-scope/unavailable intent boundary before retrieval and source attachment')
}

if (finalNoAnswerGuardIndex === -1 || finalGroundedNoDataFalseIndex === -1 || !(finalNoAnswerGuardIndex < finalGroundedNoDataFalseIndex)) {
  fail('neutral answer handler must force generated no-answer text to noData before final grounded noDataFound=false response')
}

const authoritativeNoDataBlock = answerHandlerText.split('function buildAuthoritativeNoDataResponse')[1]?.split('function answerStatesNoVerifiedData')[0] || ''
for (const requiredText of [
  'sources: []',
  'noDataFound: true',
  'confidence: 0',
  "model: 'compass-answer-no-data'",
]) {
  if (!authoritativeNoDataBlock.includes(requiredText)) {
    fail(`authoritative no-data response missing ${requiredText}`)
  }
}

if (answerHandlerText.includes("decision !== 'rejected'") || answerHandlerText.includes('!isRejected')) {
  fail('neutral answer handler must require verified evidence, not merely exclude rejected evidence')
}

for (const forbiddenText of [
  "generateResponse(message.trim(), 'tinyllama:1.1b')",
  'checkOllamaHealth',
  'answerProvider',
]) {
  if (answerHandlerText.includes(forbiddenText)) {
    fail(`neutral answer handler must not use legacy Ollama-only behavior: ${forbiddenText}`)
  }
}

for (const requiredText of [
  "version: 'chatbot-v1'",
  "endpoint: '/api/chatbot'",
  'legacy: true',
  "canonicalEndpoint: '/api/compass-answer'",
]) {
  if (!legacyRouteText.includes(requiredText)) fail(`legacy route missing ${requiredText}`)
}

for (const forbiddenText of [
  "legacyCompatibilityEndpoint: '/api/chat-ollama'",
  'legacyCompatibilityEndpoint: "/api/chat-ollama"',
]) {
  if (legacyRouteText.includes(forbiddenText)) {
    fail(`legacy route must not advertise legacy provider-named endpoint: ${forbiddenText}`)
  }
}

for (const requiredText of [
  'Make `/api/compass-answer` the public-facing canonical answer runtime.',
  'Keep `/api/chat-ollama` as a legacy compatibility endpoint.',
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
