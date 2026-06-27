#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const handlerPath = path.join(root, 'src/lib/server/compassAnswerHandler.ts');
const ragSearchPath = path.join(root, 'src/lib/services/RAGSearchService.ts');
const officialSnapshotsPath = path.join(root, 'src/lib/services/compassOfficialChunkSnapshots.ts');
const reportPath = path.join(root, 'docs/compass/answer-source-diversity-regression-2026-06-27.md');

function fail(message) {
  console.error(`[check-compass-answer-source-diversity-regression] ${message}`);
  process.exitCode = 1;
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing file: ${path.relative(root, filePath)}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) {
    fail(`missing function: ${name}`);
    return '';
  }
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

const handler = readFile(handlerPath);
const ragSearchService = readFile(ragSearchPath);
const officialSnapshots = readFile(officialSnapshotsPath);
const report = readFile(reportPath);

const naverShoppingDataBuilder = extractFunction(handler, 'buildNaverShoppingDataStructuredFallbackAnswer');
const strongEvidenceBlock = extractFunction(handler, 'sourceHasStrongNaverShoppingDataEvidence');
const lowPriorityBlock = extractFunction(handler, 'sourceLooksLikeLowPriorityNaverShoppingUtilityEvidence');
const shoppingBlockUtilityBlock = extractFunction(handler, 'sourceLooksLikeShoppingBlockOrCreativeNaverShoppingUtilityEvidence');
const procedureAlternateBlock = extractFunction(handler, 'sourceHasNaverShoppingDataProcedureAlternateEvidence');
const answerSourceSelector = extractFunction(handler, 'selectSpecificProductAnswerSources');
const fastStructuredSpecificProductAnswer = extractFunction(handler, 'buildFastStructuredSpecificProductAnswer');
const kakaoProductBuilder = extractFunction(handler, 'buildKakaoProductStructuredFallbackAnswer');
const kakaoSpecificBuilder = extractFunction(handler, 'buildFastKakaoSpecificProductAnswer');

const specificAnchorTermsBlock = ragSearchService.slice(
  ragSearchService.indexOf('private buildSpecificProductAnchorTerms'),
  ragSearchService.indexOf('private hasSpecificProductTermOnlyMatch'),
);
const naverPriorityBlock = ragSearchService.slice(
  ragSearchService.indexOf('private async searchNaverProductStructurePriorityCandidates'),
  ragSearchService.indexOf('private normalizeNaverProductStructurePriorityResults'),
);
const naverStrongSignalBlock = ragSearchService.slice(
  ragSearchService.indexOf('private hasStrongNaverShoppingDataSignal'),
  ragSearchService.indexOf('private hasHighValueProductStructureSignal'),
);

for (const [fragment, description] of [
  ['가격\\s*정보|가격정보', 'Naver DB data-quality regex must recognize price info'],
  ['배송\\s*정보|배송정보', 'Naver DB data-quality regex must recognize delivery info'],
  ['상품\\s*정보\\s*수정|상품정보\\s*수정', 'Naver DB data-quality regex must recognize product-info updates'],
  ['광고\\s*노출용\\s*상품명', 'Naver DB data-quality regex must recognize ad-facing product names'],
  ['광고\\s*노출용[\\s\\S]{0,80}이미지', 'Naver DB data-quality regex must recognize ad-facing images'],
  ['ep\\s*정보\\s*수정|ep정보\\s*수정', 'Naver DB data-quality regex must recognize EP info updates'],
  ['상품 데이터 품질 확인', 'Naver DB structured answer must expose the data-quality section'],
  ['광고 노출용 상품명·이미지, 가격정보, 배송정보, EP 정보 수정', 'Naver DB data-quality bullet must cite update/data-quality evidence'],
]) {
  if (!naverShoppingDataBuilder.includes(fragment)) {
    fail(`${description}: missing "${fragment}"`);
  }
}

for (const [fragment, description] of [
  ['looksLikeAllInOneRegistrationProcedure', 'all-in-one S1-style procedure source must not be treated as an alternate'],
  ['sourceHasAuditedNaverShoppingDataProcedureAlternateIdentity', 'procedure alternate must honor audited chunk identity/metadata before regex fallback'],
  ['상품\\s*db\\s*url\\s*검수|db\\s*url\\s*검수', 'procedure alternate must recognize DB URL inspection evidence'],
  ['미서비스\\s*상품|상품현황\\s*및\\s*관리', 'procedure alternate must recognize unserved-product-list evidence'],
  ['카테고리\\s*(자동)?매칭|카테고리\\s*매칭', 'procedure alternate must recognize category-matching evidence'],
  ['서비스\\s*시작|서비스\\s*가능|가격비교\\s*노출', 'procedure alternate must recognize service-ready evidence'],
]) {
  if (!procedureAlternateBlock.includes(fragment)) {
    fail(`${description}: missing "${fragment}"`);
  }
}

for (const [block, fragment, description] of [
  [specificAnchorTermsBlock, "'DB URL 검수'", 'specific product anchor terms must retrieve DB URL inspection alternates'],
  [specificAnchorTermsBlock, "'미서비스 상품'", 'specific product anchor terms must retrieve unserved-product alternates'],
  [specificAnchorTermsBlock, "'상품현황 및 관리'", 'specific product anchor terms must retrieve product-status alternates'],
  [specificAnchorTermsBlock, "'서비스 가능'", 'specific product anchor terms must retrieve service-ready alternates'],
  [naverPriorityBlock, "'DB URL 검수'", 'Naver priority search must include DB URL inspection anchors'],
  [naverPriorityBlock, "'미서비스 상품'", 'Naver priority search must include unserved-product anchors'],
  [naverPriorityBlock, "'상품현황 및 관리'", 'Naver priority search must include product-status anchors'],
  [naverPriorityBlock, "'서비스 가능'", 'Naver priority search must include service-ready anchors'],
  [naverStrongSignalBlock, '미서비스\\s*상품', 'Naver shopping data strong signal must recognize unserved-product evidence'],
  [naverStrongSignalBlock, '검수', 'Naver shopping data strong signal must recognize inspection evidence'],
  [naverStrongSignalBlock, '서비스\\s*가능', 'Naver shopping data strong signal must recognize service-ready evidence'],
]) {
  if (!block.includes(fragment)) {
    fail(`${description}: missing "${fragment}"`);
  }
}

for (const [fragment, description] of [
  ['doc_1774317605538_kkuzirx_chunk_3', 'audited procedure alternate chunk id must be pinned'],
  ['naver_shopping_data_procedure_alternate_official_chunk', 'RAG search must request the audited procedure alternate through the official chunk path'],
  ['naverShoppingDataProcedureAlternatePriority', 'RAG search must carry procedure alternate metadata to the answer-source selector'],
  ['isNaverShoppingDataProcedureAlternateCandidate', 'RAG search must preserve audited procedure alternates through coverage selection'],
  ['naver_shopping_data_procedure_alternate_coverage', 'RAG search must mark audited procedure alternate coverage'],
]) {
  if (!handler.includes(fragment) && !ragSearchService.includes(fragment)) {
    fail(`${description}: missing "${fragment}"`);
  }
}

if (!officialSnapshots.includes('doc_1774317605538_kkuzirx_chunk_3')) {
  fail('audited procedure alternate chunk must be available as an official snapshot supplement');
}

if (!/ensureNaverShoppingDataProcedureAlternateSources[\s\S]*mode !== 'db_setup'[\s\S]*isNaverShoppingDataIntent\(intent\)[\s\S]*ensureOfficialSnapshotSources\(sources, NAVER_SHOPPING_DATA_PROCEDURE_ALTERNATE_CHUNK_ID_LIST\)/.test(handler)) {
  fail('audited procedure alternate snapshot supplement must stay scoped to Naver shopping DB setup answers');
}

if (!/supplementedCandidateSources[\s\S]*scope\.mode === 'db_setup' && isNaverShoppingDataIntent\(intent\)[\s\S]*selectSpecificProductAnswerSources\([\s\S]*supplementedCandidateSources[\s\S]*refineSpecificProductAnswerSources\(supplementedCandidateSources, intent, scope\.mode\)/.test(fastStructuredSpecificProductAnswer)) {
  fail('fast structured Naver shopping DB answers must re-run the scoped four-source selector after snapshot supplementation');
}

for (const [fragment, description] of [
  ['쇼핑블록|pc\\s*쇼핑블록|mo\\s*쇼핑블록', 'shopping-block sources must be detectable as DB-procedure false positives'],
  ['소재|광고\\s*소재', 'creative/material sources must be detectable as DB-procedure false positives'],
  ['!hasCoreDbSetupProcedure', 'shopping-block/creative false positives must be allowed only when core DB setup evidence is absent'],
]) {
  if (!shoppingBlockUtilityBlock.includes(fragment)) {
    fail(`${description}: missing "${fragment}"`);
  }
}

if (!strongEvidenceBlock.includes('!sourceLooksLikeLowPriorityNaverShoppingUtilityEvidence(source)')) {
  fail('low-priority item-set/product-ID utility evidence must not be promoted to strong Naver shopping DB evidence');
}

if (!strongEvidenceBlock.includes('!sourceLooksLikeShoppingBlockOrCreativeNaverShoppingUtilityEvidence(source)')) {
  fail('shopping-block/creative utility evidence must not be promoted to strong Naver shopping DB procedure evidence');
}

for (const fragment of [
  '아이템\\s*세트|상품\\s*id|상품id|필터링',
  '광고\\s*노출용\\s*상품명',
  '가격\\s*정보|가격정보',
  '배송\\s*정보|배송정보',
]) {
  if (!lowPriorityBlock.includes(fragment)) {
    fail(`low-priority utility detector must preserve product-update distinction: missing "${fragment}"`);
  }
}

if (!/mode === 'db_setup' && isNaverShoppingDataIntent\(intent\)/.test(answerSourceSelector)) {
  fail('medium Naver shopping DB answer sources must stay scoped to db_setup + Naver shopping data intent');
}

if (!/procedureAlternateNaverShoppingDataAnswerSources[\s\S]*primaryStrongLeadNaverShoppingDataAnswerSources[\s\S]*primaryStrongRemainderNaverShoppingDataAnswerSources[\s\S]*shouldIncludeMediumNaverShoppingDataAnswerSources\(\)[\s\S]*dedupePublicProductSources\(\[[\s\S]*\.\.\.primaryStrongLeadNaverShoppingDataAnswerSources[\s\S]*\.\.\.procedureAlternateNaverShoppingDataAnswerSources[\s\S]*\.\.\.primaryStrongRemainderNaverShoppingDataAnswerSources[\s\S]*\.\.\.prioritizedMediumNaverShoppingDataAnswerSources[\s\S]*\], 4\)/.test(answerSourceSelector)) {
  fail('Naver shopping DB answer source selection must place real procedure alternates directly after the lead strong source within the four-source bucket');
}

if (/procedureAlternateNaverShoppingDataAnswerSources\s*=\s*rankedAnswerSources\.filter[\s\S]{0,180}sourceHasStrongNaverShoppingDataEvidence/.test(answerSourceSelector)) {
  fail('Naver shopping DB procedure alternates must not require the strong-only evidence gate before entering the four-source bucket');
}

if (!/preferProcedureAlternate[\s\S]*sourceHasNaverShoppingDataProcedureAlternateEvidence[\s\S]*영업일[\s\S]*preferProcedureAlternate: true[\s\S]*미서비스[\s\S]*preferProcedureAlternate: true/.test(naverShoppingDataBuilder)) {
  fail('Naver shopping DB builder must cite procedure alternate sources for review-time and unserved-list bullets when available');
}

if (!/prioritizedMediumNaverShoppingDataAnswerSources = \[[\s\S]*filter\(source => !sourceLooksLikeLowPriorityNaverShoppingUtilityEvidence\(source\)\)[\s\S]*filter\(source => sourceLooksLikeLowPriorityNaverShoppingUtilityEvidence\(source\)\)/.test(answerSourceSelector)) {
  fail('useful medium Naver shopping DB sources must rank before low-priority utility sources');
}

for (const [block, name] of [
  [kakaoProductBuilder, 'Kakao product structured builder'],
  [kakaoSpecificBuilder, 'Kakao specific-product fast builder'],
]) {
  for (const banned of ['상품 데이터 품질 확인', '광고 노출용 상품명', '가격정보, 배송정보, EP 정보 수정']) {
    if (block.includes(banned)) {
      fail(`${name} must not inherit Naver shopping DB data-quality wording: ${banned}`);
    }
  }
}

for (const row of [
  '| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | document_chunks + medium | 2 | 2 | 82 | 4 | 4 | 76 |',
  '| 네이버 쇼핑검색광고는 어떤 상품이야? | document_chunks + medium | 4 | 4 | 82 | 4 | 4 | 82 |',
  '| 카카오 비즈보드는 어떤 상품이야? | document_chunks + medium | 2 | 2 | 82 | 2 | 2 | 82 |',
  '| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | document_chunks + medium | 3 | 3 | 82 | 3 | 3 | 82 |',
  '| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | 23 | 17 | 17 | 6 | 4 | 4 | 76 | document_chunks |',
  '| 네이버 쇼핑검색광고는 어떤 상품이야? | 24 | 13 | 13 | 7 | 4 | 4 | 82 | document_chunks |',
  '| 카카오 비즈보드는 어떤 상품이야? | 4 | 4 | 4 | 2 | 2 | 2 | 82 | document_chunks |',
  '| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | 3 | 3 | 3 | 3 | 3 | 3 | 82 | document_chunks |',
  '`COMPASS_ANSWER_SOURCE_RELAXATION=medium` is approved for production as a conditional post-hoc ratification.',
  'Future production flag changes must follow this order: preview measurement, commander/audit approval, then production change.',
  '| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | 4 | 4 | 7 | S1 | 3 | 42.9% | no | no |',
  '| 네이버 쇼핑검색광고는 어떤 상품이야? | 4 | 4 | 4 | S1 | 1 | 25.0% | no | no |',
  '| 카카오 비즈보드는 어떤 상품이야? | 2 | 2 | 4 | S1 | 3 | 75.0% | yes | no, source-limited |',
  '| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | 3 | 3 | 3 | S1 | 1 | 33.3% | no | no |',
  'no true global dominance penalty candidate remains',
  'doc_1774317605538_kkuzirx_chunk_3`, which now appears as a cited source',
]) {
  if (!report.includes(row)) {
    fail(`source-diversity report must keep the measured regression row: ${row}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[check-compass-answer-source-diversity-regression] ok');
