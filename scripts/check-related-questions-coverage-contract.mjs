#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const routePath = path.join(root, 'src/app/api/related-questions/route.ts');
const route = fs.readFileSync(routePath, 'utf8').replace(/\r\n/g, '\n');

function fail(message) {
  console.error(`[check-related-questions-coverage-contract] ${message}`);
  process.exitCode = 1;
}

for (const snippet of [
  'buildCoverageAwareRelatedQuestions',
  'RELATED_QUESTION_LIMIT = 4',
  'DEFAULT_PRODUCT_GUIDE_QUESTIONS',
  'NAVER_KAKAO_QUESTIONS',
  'KAKAO_PRODUCT_QUESTIONS',
  'NAVER_PRODUCT_QUESTIONS',
  'META_GOOGLE_QUESTIONS',
  'COMMERCE_QUESTIONS',
  'OPERATIONS_QUESTIONS',
  'LEAD_QUESTIONS',
  'const isOperationsQuestion',
  'const isProductGuideQuestion',
  'if (isOperationsQuestion)',
  'if (isProductGuideQuestion)',
  'REGULATED_SCOPE_HINTS',
  'isUnsafeDefaultRecommendation',
  'isOverBroadRecommendation',
  'countVendorMentions',
  '쇼핑검색광고 등록 전에 상품 DB에서 뭘 확인해야 해?',
  '카카오 비즈보드는 어떤 상황에서 쓰는 게 좋아?',
  'Meta Instant Form은 어떤 상황에서 쓰는 게 좋아?',
]) {
  if (!route.includes(snippet)) {
    fail(`related question route missing coverage-aware snippet: ${snippet}`);
  }
}

for (const rejected of [
  '.from(\'document_chunks\')',
  '.from("document_chunks")',
  'questionPatterns',
  '(.*?)에 대해',
  'calculateSimilarity',
  'content.ilike',
]) {
  if (route.includes(rejected)) {
    fail(`related question route must not fall back to naive chunk/question extraction: ${rejected}`);
  }
}

const defaultQuestionBlock = route.match(/const DEFAULT_PRODUCT_GUIDE_QUESTIONS = \[([\s\S]*?)\];/)?.[1] || '';
if (!defaultQuestionBlock.includes('Meta 광고 상품은 어떤 기준으로 고르면 돼?')
  || !defaultQuestionBlock.includes('Google Ads 검색광고는 어떤 상황에서 먼저 쓰는 게 좋아?')
  || !defaultQuestionBlock.includes('네이버 쇼핑검색광고는 어떤 상황에서 쓰는 게 좋아?')
  || !defaultQuestionBlock.includes('카카오 비즈보드는 어떤 상황에서 쓰는 게 좋아?')) {
  fail('default product guide questions must cover all four vendors with product-specific prompts');
}

for (const overBroad of [
  /병원\s*광고를\s*Meta,\s*Google Ads,\s*네이버,\s*카카오/,
  /광고\s*성과가\s*갑자기\s*떨어졌을\s*때\s*Meta,\s*Google Ads,\s*네이버,\s*카카오별/,
  /Google\s*쇼핑,\s*Meta\s*카탈로그,\s*네이버\s*쇼핑검색광고,\s*카카오\s*상품\s*카탈로그/,
  /비즈보드,\s*디스플레이,\s*동영상,\s*상품\s*카탈로그,\s*메시지,\s*키워드광고,\s*브랜드검색,\s*톡채널검색,\s*보장형\/CPT/,
]) {
  if (overBroad.test(route)) {
    fail('default related questions must not recommend over-broad multi-vendor or multi-product comparison prompts');
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[check-related-questions-coverage-contract] OK');
