#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function fail(message) {
  console.error(`[check-compass-product-structure-answer-contract] ${message}`);
  process.exitCode = 1;
}

function read(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    fail(`missing ${relativePath}`);
    return '';
  }
  return fs.readFileSync(fullPath, 'utf8');
}

const rag = read('src/lib/services/RAGSearchService.ts');
const answerService = read('src/lib/services/CompassAnswerLlmService.ts');
const answerHandler = read('src/lib/server/compassAnswerHandler.ts');

for (const snippet of [
  "'product_structure'",
  'PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS',
  'PRODUCT_STRUCTURE_ANCHOR_TERMS',
  'isProductStructureQueryText',
  'searchProductStructureCandidates',
  'searchProductStructureAnchorTable',
  '캠페인 목표',
  '광고 관리자 목표',
  'Advantage+',
  '카탈로그',
  'Conversions API',
  'inferDocumentTitleFromContent',
  'self.__next_f',
  'high_value_product_structure_match',
  'product_structure_match',
  'campaign_objective_match',
  'product_solution_match',
  'creative_spec_only_penalty',
  'product_structure_no_signal_penalty',
  "topic !== 'spec' && topic !== 'product_structure'",
]) {
  if (!rag.includes(snippet)) fail(`RAG service missing product structure contract snippet: ${snippet}`);
}

for (const snippet of [
  "topics.includes('product_structure')",
  "vendors.includes('META')",
  '!ragIntent.isComparative',
  'buildProductStructureAnswer',
  'selectProductStructureResponseSources',
  'isWeakProductStructureDisplaySource',
  'compass-answer-grounded-product-structure',
  'Meta 광고 상품은 먼저 캠페인 목표를 고르고',
  '**1. 먼저 고르는 것: 캠페인 목표**',
  '**2. 그다음 고르는 것: 광고 소재 형식**',
  '**3. 판매/카탈로그 운영 기능**',
  '**빠르게 고르면**',
  '캠페인 목표',
  'advantage+',
  '카탈로그',
  'score -= 95',
  "topic !== 'spec' && topic !== 'product_structure'",
]) {
  if (!answerHandler.includes(snippet)) fail(`answer handler missing product structure ordering/routing snippet: ${snippet}`);
}

for (const snippet of [
  '광고 상품/종류/구조',
  '캠페인 목표 / 노출 위치 / 소재 형식 / 자동화·커머스·측정 기반 / 목적별 선택 기준',
  '제공된 근거에서는 소재 형식/사양 범위만 확인됩니다',
]) {
  if (!answerService.includes(snippet)) fail(`answer prompt missing product structure instruction: ${snippet}`);
}

if (answerService.includes('상품 카탈로그가 아니라 "근거에서 확인되는 광고 형식/사양"으로 범위를 좁혀 답하세요')) {
  fail('answer prompt must not always narrow ad product questions to creative specs');
}

if (!/recommendedSourceLimit[\s\S]*hasProductStructureIntent[\s\S]*\?\s*6/.test(rag)) {
  fail('product structure intent should request broader verified source coverage');
}

if (!/needsProductStructureRetrieval[\s\S]*Math\.max\(limit,\s*intent\.vendors\.length \* 4,\s*needsProductStructureRetrieval \? 18 : 8\)/.test(rag)) {
  fail('product structure intent should expand retrieval candidate pool for vendor queries');
}

if (!/productStructureCandidates[\s\S]*mergeDedupeAndRankCandidates[\s\S]*productStructureCandidates/.test(rag)) {
  fail('product structure anchor candidates must be merged into final ranking');
}

if (!/광고\s*사양[\s\S]*!this\.hasHighValueProductStructureSignal/.test(rag)) {
  fail('creative spec-only documents must be penalized only when high-value product structure is absent');
}

if (!/maxPerTitle[\s\S]*product_structure[\s\S]*\?\s*1\s*:\s*2/.test(rag)) {
  fail('product structure intent should not repeat multiple chunks from the same source title');
}

if (!/filter\(candidate => candidate\.hits > 0\)/.test(answerHandler)) {
  fail('topic source picker must not select unrelated sources when no topic term matches');
}

if (answerHandler.includes('실무 선택 기준')) {
  fail('product structure answer should use user-facing labels instead of internal wording like 실무 선택 기준');
}

if (/- 캠페인 목표 기준|  - 인지도:/.test(answerHandler)) {
  fail('product structure answer should avoid nested bullet formatting in rendered chat output');
}

if (process.exitCode) process.exit(process.exitCode);
console.log('[check-compass-product-structure-answer-contract] ok');
