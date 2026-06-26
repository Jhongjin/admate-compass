#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const filePath = path.join(root, 'src/lib/server/compassAnswerHandler.ts');
const source = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');

function fail(message) {
  console.error(`[check-compass-answer-self-assessment-contract] ${message}`);
  process.exitCode = 1;
}

for (const snippet of [
  'buildCompassAnswerSelfAssessment',
  'extractCompassAnswerCitationIndexes',
  'answerSelfAssessment',
  'citedSourceCount',
  'citationUseRate',
  'deterministic_or_fast_path_review',
  'deterministicScoreCap',
  'single_source_basis',
  'single_citation_with_multiple_sources',
  'generic_followup_questions',
  'findFallbackSourceCandidateIndexes',
  'candidateIndexes.find(index => !used?.has(index))',
  'indexedMatches.find(({ index }) => !used.has(index))',
  'const shouldDiversifyCitedSources = sources.length > 1',
  'confidenceBeforeSelfAssessment',
  'confidenceCappedBySelfAssessment',
  'applyCompassAnswerSelfAssessment(await buildCompassAnswerResponse',
  'applyCompassAnswerSelfAssessment(result)',
]) {
  if (!source.includes(snippet)) {
    fail(`missing self-assessment contract snippet: ${snippet}`);
  }
}

if (/buildCompassAnswerSelfAssessment[\s\S]{0,5000}카카오\s*비즈보드/.test(source)) {
  fail('self-assessment must not embed product-specific canned answer text');
}

if (/buildCompassAnswerSelfAssessment[\s\S]{0,5000}네이버\s*쇼핑검색광고/.test(source)) {
  fail('self-assessment must not embed product-specific canned answer text');
}

if (process.exitCode) process.exit(process.exitCode);

console.log('[check-compass-answer-self-assessment-contract] ok');
