#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const packagePath = path.join(root, 'package.json')
const scriptPath = path.join(root, 'scripts', 'check-compass-prelaunch-offline-contracts.mjs')

const includedContracts = [
  {
    script: 'check:rag-contract',
    command: 'node scripts/check-rag-contract.mjs',
    fallback: true,
  },
  {
    script: 'check:compass-evidence-contract',
    command: 'node scripts/check-compass-evidence-contract.mjs',
  },
  {
    script: 'check:compass-sentinel-evidence-manifest',
    command: 'node scripts/check-compass-sentinel-evidence-manifest-contract.mjs',
  },
  {
    script: 'check:compass-answer-route-contract',
    command: 'node scripts/check-compass-answer-route-contract.mjs',
  },
  {
    script: 'check:compass-product-structure-answer-contract',
    command: 'node scripts/check-compass-product-structure-answer-contract.mjs',
  },
  {
    script: 'check:compass-evidence-graph-contract',
    command: 'node scripts/check-compass-evidence-graph-contract.mjs',
  },
  {
    script: 'check:compass-answer-provider-contract',
    command: 'node scripts/check-compass-answer-provider-contract.mjs',
  },
  {
    script: 'check:compass-source-proposal-contract',
    command: 'node scripts/check-compass-source-proposal-contract.mjs',
  },
  {
    script: 'check:compass-source-proposal-queue-contract',
    command: 'node scripts/check-compass-source-proposal-queue-contract.mjs',
  },
  {
    script: 'check:compass-source-proposal-worker-contract',
    command: 'node scripts/check-compass-source-proposal-worker-contract.mjs',
  },
]

const excludedPrelaunchSurfaces = [
  'provider calls',
  'migration/env/SQL work',
  'source proposal apply/persist/promote',
  'worker live execution',
  'smoke against live services',
  'authenticated UI smoke',
  'publish',
  'campaign mutation',
]

const excludedPackageScripts = [
  'dev',
  'build',
  'start',
  'check:migration-env',
  'smoke:compass-rag-contract',
  'smoke:compass-source-proposal-worker',
  'smoke:compass-answer-local',
  'smoke:chat-ollama-local',
  'gate6c:dry-run',
  'verify:migration',
]

const expectedAggregateScripts = {
  'check:compass-prelaunch-offline-contracts': 'node scripts/check-compass-prelaunch-offline-contracts.mjs',
  'verify:prelaunch-local': 'npm run check:compass-prelaunch-offline-contracts',
}

const forbiddenAggregateSourceSnippets = [
  ['process', '.env'].join(''),
  ['fet', 'ch('].join(''),
  ['XML', 'HttpRequest'].join(''),
  ['create', 'Client'].join(''),
  ['create', 'ServerClient'].join(''),
  ['create', 'CompassServiceClient'].join(''),
  ['supa', 'base'].join(''),
  ['local', 'Storage'].join(''),
  ['session', 'Storage'].join(''),
  ['document', '.cookie'].join(''),
  ['insert', '('].join(''),
  ['upsert', '('].join(''),
  ['update', '('].join(''),
  ['delete', '('].join(''),
]

function fail(message) {
  console.error(`[check-compass-prelaunch-offline-contracts] ${message}`)
  process.exit(1)
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/')
}

function readText(file) {
  if (!fs.existsSync(file)) fail(`missing ${relative(file)}`)
  return fs.readFileSync(file, 'utf8')
}

function readPackageJson() {
  try {
    return JSON.parse(readText(packagePath))
  } catch (error) {
    fail(`package.json parse failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function validateAggregateSource() {
  const source = readText(scriptPath)

  for (const token of [
    'const includedContracts = [',
    'const excludedPrelaunchSurfaces = [',
    'const excludedPackageScripts = [',
    'provider calls',
    'migration/env/SQL work',
    'source proposal apply/persist/promote',
    'worker live execution',
    'smoke against live services',
    'authenticated UI smoke',
    'publish',
    'campaign mutation',
  ]) {
    if (!source.includes(token)) fail(`aggregate source missing explicit ${token}`)
  }

  for (const snippet of forbiddenAggregateSourceSnippets) {
    if (source.includes(snippet)) {
      fail(`aggregate runner must remain offline/local-only; forbidden snippet: ${snippet}`)
    }
  }
}

function validatePackageWiring(packageJson) {
  const scripts = packageJson.scripts || {}

  for (const [script, command] of Object.entries(expectedAggregateScripts)) {
    if (scripts[script] !== command) {
      fail(`package script ${script} must be exactly "${command}"`)
    }
  }

  for (const contract of includedContracts) {
    if (scripts[contract.script] === undefined) {
      if (contract.fallback) {
        const fallbackPath = path.join(root, contract.command.replace(/^node /, ''))
        if (!fs.existsSync(fallbackPath)) {
          fail(`${contract.script} is absent and fallback target is missing: ${relative(fallbackPath)}`)
        }
        continue
      }

      fail(`package script ${contract.script} is missing`)
    }

    if (scripts[contract.script] !== contract.command) {
      fail(`package script ${contract.script} must be exactly "${contract.command}"`)
    }
  }

  const aggregateCommand = [
    scripts['check:compass-prelaunch-offline-contracts'],
    scripts['verify:prelaunch-local'],
  ].join(' ')

  for (const excludedScript of excludedPackageScripts) {
    if (aggregateCommand.includes(excludedScript) && excludedScript !== 'check:compass-prelaunch-offline-contracts') {
      fail(`aggregate package wiring must not call excluded script ${excludedScript}`)
    }
  }
}

function printPlan(packageJson) {
  const scripts = packageJson.scripts || {}

  console.log('[check-compass-prelaunch-offline-contracts] included contracts:')
  for (const contract of includedContracts) {
    const command = scripts[contract.script] === undefined ? contract.command : scripts[contract.script]
    const fallbackNote = scripts[contract.script] === undefined ? ' (package script absent; using fallback)' : ' (package script validated)'
    console.log(`- ${contract.script}: ${command}${fallbackNote}`)
  }

  console.log('[check-compass-prelaunch-offline-contracts] excluded surfaces:')
  for (const surface of excludedPrelaunchSurfaces) {
    console.log(`- ${surface}`)
  }
}

function runContract(contract, packageJson) {
  const scripts = packageJson.scripts || {}
  const command = scripts[contract.script] === undefined ? contract.command : scripts[contract.script]
  const match = /^node\s+(.+\.mjs)$/.exec(command)

  if (!match) {
    fail(`${contract.script} must resolve to a local node .mjs command`)
  }

  const localScript = match[1]
  console.log(`[check-compass-prelaunch-offline-contracts] running ${command}`)

  return spawnSync(process.execPath, [localScript], {
    cwd: root,
    stdio: 'inherit',
  })
}

validateAggregateSource()
const packageJson = readPackageJson()
validatePackageWiring(packageJson)
printPlan(packageJson)

for (const contract of includedContracts) {
  const result = runContract(contract, packageJson)
  if (result.error) fail(`${contract.script} failed to start: ${result.error.message}`)
  if (result.status !== 0) {
    const status = typeof result.status === 'number' ? result.status : 1
    console.error(`[check-compass-prelaunch-offline-contracts] failed at ${contract.script}`)
    process.exit(status)
  }
}

console.log('[check-compass-prelaunch-offline-contracts] ok')
