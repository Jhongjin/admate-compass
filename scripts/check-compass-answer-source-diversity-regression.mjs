#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const handlerPath = path.join(root, 'src/lib/server/compassAnswerHandler.ts');
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
const report = readFile(reportPath);

const naverShoppingDataBuilder = extractFunction(handler, 'buildNaverShoppingDataStructuredFallbackAnswer');
const strongEvidenceBlock = extractFunction(handler, 'sourceHasStrongNaverShoppingDataEvidence');
const lowPriorityBlock = extractFunction(handler, 'sourceLooksLikeLowPriorityNaverShoppingUtilityEvidence');
const answerSourceSelector = extractFunction(handler, 'selectSpecificProductAnswerSources');
const kakaoProductBuilder = extractFunction(handler, 'buildKakaoProductStructuredFallbackAnswer');
const kakaoSpecificBuilder = extractFunction(handler, 'buildFastKakaoSpecificProductAnswer');

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

if (!strongEvidenceBlock.includes('!sourceLooksLikeLowPriorityNaverShoppingUtilityEvidence(source)')) {
  fail('low-priority item-set/product-ID utility evidence must not be promoted to strong Naver shopping DB evidence');
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

if (!/shouldIncludeMediumNaverShoppingDataAnswerSources\(\)[\s\S]*dedupePublicProductSources\(\[[\s\S]*\.\.\.strongNaverShoppingDataAnswerSources[\s\S]*\.\.\.prioritizedMediumNaverShoppingDataAnswerSources[\s\S]*\], 4\)/.test(answerSourceSelector)) {
  fail('medium Naver shopping DB answer sources must be allowed into the four-source answer bucket when the relaxation flag is enabled');
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
  '| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | document_chunks + medium | 2 | 2 | 82 | 4 | 3 | 82 |',
  '| 네이버 쇼핑검색광고는 어떤 상품이야? | document_chunks + medium | 4 | 4 | 82 | 4 | 4 | 82 |',
  '| 카카오 비즈보드는 어떤 상품이야? | document_chunks + medium | 2 | 2 | 82 | 2 | 2 | 82 |',
  '| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | document_chunks + medium | 3 | 3 | 82 | 3 | 3 | 82 |',
  '| 쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해? | 24 | 15 | 5 | 4 | 3 | document_chunks |',
  '| 네이버 쇼핑검색광고는 어떤 상품이야? | 24 | 14 | 7 | 4 | 4 | document_chunks |',
  '| 카카오 비즈보드는 어떤 상품이야? | 4 | 4 | 2 | 2 | 2 | document_chunks |',
  '| 카카오 비즈보드 소재 만들 때 뭘 확인해야 해? | 3 | 3 | 3 | 3 | 3 | document_chunks |',
]) {
  if (!report.includes(row)) {
    fail(`source-diversity report must keep the measured regression row: ${row}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[check-compass-answer-source-diversity-regression] ok');

