#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const parserPath = path.join(root, 'src/lib/services/CompassSourcePreviewParser.ts')
const proposalServicePath = path.join(root, 'src/lib/services/CompassSourceProposalService.ts')
const fixturePath = path.join(root, 'docs/rag/compass-source-preview-parser-fixtures.json')
const indexingServicePath = path.join(root, 'src/lib/services/DocumentIndexingService.ts')
const processingServicePath = path.join(root, 'src/lib/services/DocumentProcessingService.ts')

function fail(message) {
  console.error(`[check-compass-source-preview-parser-fixtures] ${message}`)
  process.exitCode = 1
}

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing ${path.relative(root, filePath)}`)
    return ''
  }
  return fs.readFileSync(filePath, 'utf8')
}

function assertIncludes(value, expected, label) {
  if (!String(value || '').includes(expected)) {
    fail(`${label} must include ${expected}`)
  }
}

function assertExcludes(value, forbidden, label) {
  if (String(value || '').includes(forbidden)) {
    fail(`${label} must not include ${forbidden}`)
  }
}

const parserText = read(parserPath)
const proposalServiceText = read(proposalServicePath)
const fixtureText = read(fixturePath)
const indexingServiceText = read(indexingServicePath)
const processingServiceText = read(processingServicePath)

for (const token of [
  'CompassSourcePreview',
  'extractCompassSourcePreview',
  'validateCompassSourcePreview',
  'Preview fetch produced too little readable policy content.',
  'Preview fetch lacks enough readable policy signal for Compass review.',
]) {
  if (!parserText.includes(token)) fail(`parser missing ${token}`)
}

for (const forbidden of [
  'fetch(',
  'process.env',
  'createClient',
  'createCompassServiceClient',
  'supabase',
  'DocumentIndexingService',
  'VectorStorageService',
  'EmbeddingService',
  'CompassAnswerLlmService',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  'chat.completions',
  'node:fs',
]) {
  if (parserText.includes(forbidden)) {
    fail(`parser must remain pure and must not include ${forbidden}`)
  }
}

for (const token of [
  'CompassSourcePreviewParser',
  'extractCompassSourcePreview',
  'minPreviewChars: MIN_PREVIEW_CHARS',
]) {
  if (!proposalServiceText.includes(token)) {
    fail(`source proposal service must use preview parser token ${token}`)
  }
}

for (const forbidden of [
  'function extractPreview',
  'function validateExtractedPreview',
  'function removePageChrome',
  'function stripTags',
  'function decodeEntities',
  'function matchFirst',
]) {
  if (proposalServiceText.includes(forbidden)) {
    fail(`source proposal service must not keep duplicate parser helper ${forbidden}`)
  }
}

for (const [label, text] of [
  ['DocumentIndexingService', indexingServiceText],
  ['DocumentProcessingService', processingServiceText],
]) {
  if (text.includes('CompassSourcePreviewParser') || text.includes('extractCompassSourcePreview')) {
    fail(`${label} must not use proposal preview parser before URL indexing is approved`)
  }
}

let fixture
try {
  fixture = JSON.parse(fixtureText)
} catch (error) {
  fail(`fixture JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
}

if (fixture.fixturePack !== 'compass-source-preview-parser-v1') {
  fail('fixturePack must be compass-source-preview-parser-v1')
}
if (fixture.mode !== 'local_contract_only') {
  fail('mode must be local_contract_only')
}

for (const [key, value] of Object.entries(fixture.sideEffects || {})) {
  if (value !== false) fail(`sideEffects.${key} must be false`)
}

let parser
try {
  const transpiled = ts.transpileModule(parserText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: parserPath,
  })
  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    console,
    URL,
    Date,
    Error,
    String,
    Array,
    Set,
    RegExp,
  }
  vm.runInNewContext(transpiled.outputText, sandbox, { filename: parserPath })
  parser = module.exports
} catch (error) {
  fail(`parser transpile/evaluation failed: ${error instanceof Error ? error.message : String(error)}`)
}

if (typeof parser?.extractCompassSourcePreview !== 'function') {
  fail('parser export extractCompassSourcePreview must be a function')
}

let successCases = 0
let errorCases = 0

for (const [index, testCase] of (fixture.fixtures || []).entries()) {
  const label = `fixtures[${index}] ${testCase.id || 'unknown'}`

  if (!testCase.id || !testCase.finalUrl || !testCase.html) {
    fail(`${label} must include id, finalUrl, and html`)
    continue
  }

  try {
    const preview = parser.extractCompassSourcePreview(testCase.html, testCase.finalUrl, {
      fetchedAt: testCase.fetchedAt,
      minPreviewChars: testCase.minPreviewChars,
    })

    if (testCase.expectedErrorIncludes) {
      fail(`${label} expected an error but parser returned a preview`)
      continue
    }

    successCases += 1
    const expected = testCase.expected || {}

    if (expected.title && preview.title !== expected.title) {
      fail(`${label} title mismatch`)
    }
    if (expected.canonicalUrl && preview.canonicalUrl !== expected.canonicalUrl) {
      fail(`${label} canonicalUrl mismatch`)
    }
    if (Array.isArray(expected.headings)) {
      const actual = JSON.stringify(preview.headings)
      const wanted = JSON.stringify(expected.headings)
      if (actual !== wanted) fail(`${label} headings mismatch`)
    }
    for (const token of expected.contentPreviewIncludes || []) {
      assertIncludes(preview.contentPreview, token, `${label}.contentPreview`)
    }
    for (const token of expected.contentPreviewExcludes || []) {
      assertExcludes(preview.contentPreview, token, `${label}.contentPreview`)
    }
    if (expected.contentLengthEqualsPreviewLength && preview.contentLength !== preview.contentPreview.length) {
      fail(`${label} contentLength must match contentPreview.length`)
    }
    if (testCase.fetchedAt && preview.fetchedAt !== testCase.fetchedAt) {
      fail(`${label} fetchedAt should be deterministic from fixture`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!testCase.expectedErrorIncludes) {
      fail(`${label} unexpected parser error: ${message}`)
      continue
    }

    errorCases += 1
    if (!message.includes(testCase.expectedErrorIncludes)) {
      fail(`${label} error message must include ${testCase.expectedErrorIncludes}`)
    }
  }
}

if (successCases < 2) fail('expected at least two successful parser fixtures')
if (errorCases < 2) fail('expected at least two parser error fixtures')

if (!process.exitCode) {
  console.log('[check-compass-source-preview-parser-fixtures] ok')
}
