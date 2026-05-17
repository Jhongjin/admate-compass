#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function fail(message) {
  console.error(`[check-compass-source-proposal-worker-contract] ${message}`)
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

const route = read('src/app/api/internal/source-proposals/dry-run/route.ts')
const packageJson = JSON.parse(read('package.json') || '{}')

for (const token of [
  "process.env.NODE_ENV === 'production'",
  'SOURCE_PROPOSAL_WORKER_DISABLED',
  'COMPASS_SOURCE_PROPOSAL_WORKER_ENABLED',
  'COMPASS_SOURCE_PROPOSAL_WORKER_KEY',
  'CRON_SECRET',
  "request.headers.get('authorization')",
  "authorization.toLowerCase().startsWith('bearer ')",
  'timingSafeEqual',
  'body?.dryRun !== true',
  'buildCompassSourceProposalRun',
  'persistCompassSourceProposalRun',
  'readCompassSourceProposalQueueSnapshot',
  'mutationEnabled: proposalRun.mutationEnabled',
  'candidateCount: proposalRun.candidates.length',
  "'cache-control': 'no-store'",
]) {
  if (!route.includes(token)) {
    fail(`worker route missing ${token}`)
  }
}

const productionCheckIndex = route.indexOf("process.env.NODE_ENV === 'production'")
const enabledCheckIndex = route.indexOf('if (!isWorkerEnabled())')
const authCheckIndex = route.indexOf('hasWorkerAccess(request)')
const persistIndex = route.indexOf('const queue = await persistCompassSourceProposalRun')
if (productionCheckIndex < 0 || enabledCheckIndex < 0 || authCheckIndex < 0 || persistIndex < 0) {
  fail('worker route guard ordering cannot be evaluated')
} else {
  if (productionCheckIndex > enabledCheckIndex || enabledCheckIndex > authCheckIndex) {
    fail('worker route must block production, then disabled worker, then auth')
  }
  if (authCheckIndex > persistIndex) {
    fail('worker route must authenticate before queue persistence')
  }
}

for (const forbidden of [
  'DocumentIndexingService',
  'documentIndexingService',
  'VectorStorageService',
  'vectorStorageService',
  'saveChunks',
  'saveDocument(',
  'updateDocumentStatus',
  'deleteDocument',
  'EmbeddingService',
  'SimpleEmbeddingService',
  'generateCompassAnswer',
]) {
  if (route.includes(forbidden)) {
    fail(`worker route must not import or call corpus/embedding/answer mutation API: ${forbidden}`)
  }
}

if (packageJson.scripts?.['check:compass-source-proposal-worker-contract'] !== 'node scripts/check-compass-source-proposal-worker-contract.mjs') {
  fail('package script check:compass-source-proposal-worker-contract is missing or changed')
}

if (!String(packageJson.scripts?.['verify:harness'] || '').includes('check:compass-source-proposal-worker-contract')) {
  fail('verify:harness must include check:compass-source-proposal-worker-contract')
}

if (!process.exitCode) {
  console.log('[check-compass-source-proposal-worker-contract] ok')
}
