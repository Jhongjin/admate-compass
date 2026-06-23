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
  'ADVoost 쇼핑',
  '치지직 전용 광고',
  '커뮤니케이션 애드',
  '비즈보드, 디스플레이, 동영상, 상품 카탈로그, 메시지, 키워드광고, 브랜드검색, 톡채널검색, 보장형/CPT',
  'Google 쇼핑, Meta 카탈로그, 네이버 쇼핑검색광고, 카카오 상품 카탈로그',
  'Instant Form/리드 양식',
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
if (!defaultQuestionBlock.includes('Meta 광고 상품 유형')
  || !defaultQuestionBlock.includes('Google Ads 광고 상품 유형')
  || !defaultQuestionBlock.includes('네이버 광고 상품 유형')
  || !defaultQuestionBlock.includes('카카오 광고 상품을 비즈보드')) {
  fail('default product guide questions must cover all four vendors with product-specific prompts');
}

if (/병원\s*광고를\s*Meta,\s*Google Ads,\s*네이버,\s*카카오/.test(route)) {
  fail('default related questions must not recommend broad regulated multi-vendor hospital comparisons');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('[check-related-questions-coverage-contract] OK');
