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
const chatbotRoute = read('src/app/api/chatbot/route.ts');

for (const snippet of [
  "'product_structure'",
  'PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS',
  'PRODUCT_STRUCTURE_ANCHOR_TERMS',
  'isProductStructureQueryText',
  'isSpecificProductGuidance',
  'isProductStructureOverview',
  'searchProductStructureCandidates',
  'searchNaverProductStructurePriorityCandidates',
  'ensureNaverProductStructureCoverage',
  'naver_product_structure_priority',
  'naver_shopping_data_priority',
  'naver_required_product_structure_coverage',
  'naver_shopping_data_required_coverage',
  'google_required_product_structure_coverage',
  'kakao_required_product_structure_coverage',
  'meta_required_product_structure_coverage',
  'searchProductStructureAnchorTable',
  'isMetaOverviewPolicyNoiseText',
  'getCompassRetrievalChannelTimeoutMetadata',
  'RetrievalChannelTiming',
  '__compassRetrievalTimedOut',
  '__compassRetrievalChannelTimings',
  'timedOutChannels?.push(label)',
  'channelTimings?.push',
  'withRetrievalTimeoutMetadata',
  'selectSupabaseKeywordSearchTerms',
  'COMPASS_SUPABASE_ROWS_CACHE_TTL_MS',
  'getCompassSupabaseRowsCacheStatus',
  'loadCachedSupabaseRows',
  'readCompassRetrievalDurableCache',
  'writeCompassRetrievalDurableCache',
  "'supabase_rows'",
  'durableHitCount',
  'compassSupabaseRowsCache',
  'getKeywordTableFetchLimit',
  'getVendorMetadataFetchLimit',
  'getProductStructureAnchorFetchLimit',
  'usesVendorProductStructurePriority',
  'kakao_product_priority_keyword',
  'specific_kakao_priority_direct',
  'selectKakaoProductPriorityRescueCandidates',
  'kakao_priority_guide_rescue',
  'isKakaoBizboardDisplayComparisonIntent',
  'usesKakaoInternalProductComparison',
  'skipsGraphForGoogleProductOverview',
  'specific kakao priority direct path',
  'naver_product_structure_priority_keyword',
  'meta_product_overview_keyword',
  'mergeDuplicateCandidate',
  'evidenceDecisionReason',
  'Product structure fast 후보 수집 결과',
  'fast keyword/anchor path',
  '캠페인 목표',
  '광고 유형',
  '광고 관리자 목표',
  'Advantage+',
  '카탈로그',
  '앱 캠페인',
  '앱 인스톨',
  '앱 홍보',
  '동영상 광고',
  '동영상 조회',
  '쇼핑검색',
  '쇼핑검색광고',
  '쇼핑블록',
  'EP(=DB URL)',
  '상품정보 수신 현황',
  '등록요청',
  '카테고리 자동매칭',
  '리드 양식',
  '비즈보드',
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
  'hasNamedSpecificProductQuestion',
  'isProductSelectionQuestion',
  'buildAnswerGroundingSources',
  'isBroadProductStructureAnswerIntent',
  'Compass policy/detail answer will use grounded LLM synthesis',
  'explicitInsufficientEvidence',
  'GOOGLE',
  'NAVER',
  'KAKAO',
  'buildNaverShoppingDataOperationalAnswer',
  'const epDetailIndex = findSourceIndex(/상품\\s*가격|가격대|배송비|쿠폰|할인|대표이미지|색상\\s*필터|혜택\\s*필터/)',
  'const fallbackEpIndex = registrationIndex < 0',
  'const epIndex = epDetailIndex >= 0 ? epDetailIndex : fallbackEpIndex',
  'selectProductStructureResponseSources',
  'pickTopicSources',
  'buildProductStructureSupplementQueries',
  'getProductStructureFastPathSupplementLimit',
  'usesProductStructureFastPath',
  'intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(originalMessage)',
  'return intent.isProductStructureOverview',
  'buildSpecificProductAnswerScope',
  'buildFastKakaoSpecificProductAnswer',
  'buildFastKakaoProductStructuredAnswer',
  'COMPASS_DISABLE_FAST_KAKAO_SPECIFIC_PRODUCT_ANSWERS',
  'COMPASS_DISABLE_FAST_KAKAO_STRUCTURED_PRODUCT_ANSWERS',
  "fastAnswerFallback: 'kakao_specific_product_source_guided'",
  "'kakao_product_structured'",
  "'kakao_product_scope_rescue'",
  'compass-answer-fast-kakao-specific-product-source-guided',
  'compass-answer-fast-kakao-product-structured',
  'sourceMatchesRequestedProductMode',
  'buildSpecificProductScopeLimitedAnswer',
  "model: 'compass-answer-naver-shopping-data-operational'",
  'Compass specific product answer will use grounded LLM synthesis',
  "'compass-answer-grounded-specific-product-llm'",
  'sourceHasCrossVendorUrl',
  'sourceHasExtractionNoise',
  'refineSpecificProductAnswerSources',
  'buildCompassGroundingOptions(message, ragIntent, specificProductScope, isBroadProductStructureLlmIntent)',
  'answerMode: options.answerMode',
  'answerEvidenceRole: source.metadata?.answerEvidenceRole',
  'buildBroadProductGeneratedAnswerRepair',
  'broad_product_quality_gap',
  'answerHasMetaOverviewCommerceCoverageGap',
  'answerHasKakaoSpecificScopeRisk',
  'kakao_scope_risk',
  'const sourceText = getStrictProductVisibleEvidenceText(source)',
  'da($|[\\s/]|도|상품|광고)',
  '네이버 쇼핑검색광고 상품형 쇼핑블록 광고 상품',
  '네이버 디스플레이 광고 DA 홈피드 배너 광고 상품',
  '네이버 성과형 디스플레이 광고 DA 광고 상품',
  '앱 인스톨 App Install 앱 홍보 앱 이벤트',
  'mergeSearchResultsByIdentity',
  'sourceMatchesVendor',
  'isWeakProductStructureDisplaySource',
  'buildBroadProductStructureQueryTerms',
  'buildRequestedProductFocus',
  'sourceMatchesRequestedProductFocus',
  'scoreRequestedProductFocus',
  'ensureProductStructureRequestedFocusCoverage',
  'selectProductStructureResponseSources(sources: ReturnType<typeof buildVerifiedSources>, intent?: QueryIntent, message = \'\')',
  'buildBroadProductStructureQueryTerms(intent?: QueryIntent, message = \'\')',
  'buildRequestedProductStructureCoverageTerms(intent?: QueryIntent, message = \'\')',
  'const productStructureSources = selectProductStructureResponseSources(sources, ragIntent, message)',
  'scoreBroadProductStructureSource',
  'matchText',
  'metadata?.source_vendor',
  'Compass product structure broad answer will use grounded LLM synthesis',
  'compass-answer-grounded-product-structure-llm',
  '사이트검색광고',
  '쇼핑검색광고 상품형',
  '쇼핑파트너센터',
  '상품DB',
  'EP 상품 데이터부터 확인하기',
  'DB URL의 정확한 입력 형식',
  '네이버 쇼핑블록 PC 모바일 쇼핑 지면 광고 상품',
  '캠페인 목표',
  'advantage+',
  '카탈로그',
  'score -= 95',
  "topic !== 'spec' && topic !== 'product_structure'",
]) {
  if (!answerHandler.includes(snippet)) fail(`answer handler missing product structure ordering/routing snippet: ${snippet}`);
}

if (answerHandler.includes('const epIndex = findSourceIndex(/ep|')) {
  fail('NAVER DB URL answer must not treat a bare EP token as a separate EP detail section');
}

for (const snippet of [
  '광고 상품/종류/구조',
  'answerEvidenceRole',
  'answerEvidenceRole이 mode_detail 또는 db_detail',
  'answerEvidenceRole이 official_graph',
  'answerEvidenceRole이 product_context',
  'Do not reuse a canned overview',
  '특정 상품 질문의 첫 문장은 반드시 사용자가 물은 상품명/지면/절차를 직접 언급해야 합니다.',
  '특정 상품 질문에서 근거가 부족하면 다른 상품군의 일반 개요로 대체하지 마세요.',
  'product_detail은 "무엇인지 / 어디에 노출되는지 / 언제 쓰는지 / 운영 전 확인할 조건" 순서로 답하세요.',
  'setup_procedure는 "준비 항목 / 설정 또는 연동 순서 / 담당자나 원문 확인이 필요한 범위" 순서로 답하세요.',
  'creative_guide는 "필수 소재 요소 / 규격·비율·파일 조건 / 문구·랜딩·심사 주의사항" 순서로 답하세요.',
  'policy_screening은 "심사 전 확인 기준 / 제한 또는 반려 가능 사유 / 추가 확인 자료" 순서로 답하세요.',
  '질문 의도를 먼저 구분하세요',
  '전체 상품 개요, 목적별 선택 기준, 특정 상품 상세, 정책 심사 체크, 실무 이슈 해결',
  '서로 다른 모드를 하나의 고정 템플릿으로 합치지 마세요',
  '전체 상품 개요 질문에는 근거에서 확인되는 상품군, 지면, 캠페인 유형을 먼저 나누고',
  '목적별 선택 질문에는 "우선 목표를 정하고 / 그 목표에 맞는 상품군과 지면을 고르고 / 운영 전 조건을 확인한다"',
  'DA도 있지 않아?',
  '전체 상품 구조를 반복하지 말고 그 항목에 직접 답하세요',
  '특정 광고 상품을 물으면 개요 템플릿을 반복하지 말고',
  '등록, DB URL, 상품 DB, 카탈로그, 앱 등록, 추적 툴, 리드 양식, 제작 가이드, 소재 조건',
  '제공된 근거에서는 소재 형식/사양 범위만 확인됩니다',
]) {
  if (!answerService.includes(snippet)) fail(`answer prompt missing product structure instruction: ${snippet}`);
}

for (const snippet of [
  'hasNamedProductSignal',
  'strictProductTerms.length > 0',
  'asksWholeProductCatalog',
  'buildSpecificProductAnchorTerms',
  '? specificAnchorTerms',
  'if (intent.isSpecificProductGuidance) return false',
  'hasSpecificProductTermMatch',
  'getSpecificProductMatchedTerms',
  'hasSpecificProductDetailSignalNearTerm',
  'hasSpecificProductDetailSignalNearAnyTerm',
  'isBroadSpecificProductCatalogHit(sourceText, intent)',
  'matchedTerms.some(term => this.hasSpecificProductDetailSignalNearTerm(text, term))',
  'shortAsciiTermPattern',
  'isBroadProductStructureOnlyText',
  'specific_product_anchor_match',
  'specificProductAnchorMatch',
  'strict_product_term_match',
  'strict_product_term_missing_penalty',
  'specific_product_near_detail_match',
  'broad_product_structure_penalty',
  'strictProductAlignmentBoost',
  'strictProductAlignmentPenalty',
  'da($|[\\s/]|도|상품|광고)',
  '디스플레이 광고',
  '홈피드',
  '배너 광고',
  '홈피드DA',
  'App Install',
  'Lead Form',
  'Lead Ads',
  'Advantage+',
  'Catalog',
  '상품DB',
  'hasStrongNaverShoppingDataSignal',
  'strictSpecificProductIntent',
  'allowedSpecificProductProcedureEvidence',
  'graphQueryTerms',
  'scoreNaverShoppingDataCandidate',
  'naver_shopping_data_strong_detail_priority',
  'naver_shopping_data_strong_detail_rescue',
]) {
  if (!rag.includes(snippet)) fail(`RAG service missing specific product routing snippet: ${snippet}`);
}

if (rag.includes('...intent.keywords.filter(keyword => keyword.length >= 2),')) {
  fail('specific product anchors must not promote generic user keywords into strict product evidence terms');
}

if (rag.includes('? Array.from(new Set([...queryMatchedAnchors, ...specificAnchorTerms]))')) {
  fail('specific product retrieval must not reintroduce query-matched generic anchors');
}

for (const forbidden of [
  'const specificProductIntent = intent.isSpecificProductGuidance && specificProductAnchorTerms.length > 0',
  "const strictProductIntent = intent.topics.includes('product_structure') && intent.isSpecificProductGuidance && specificProductAnchorTerms.length > 0",
  'const strictSpecificProductIntent = intent.isSpecificProductGuidance && specificProductAnchorTerms.length > 0',
  'intent.isSpecificProductGuidance\n      && specificProductAnchorTerms.length > 0',
]) {
  if (rag.includes(forbidden)) {
    fail(`specific product routing must not weaken the gate when anchor extraction misses: ${forbidden}`);
  }
}

if (answerHandler.includes('|| buildSpecificProductGroundedAnswer(message, ragIntent, specificProductScope)')) {
  fail('specific product questions must use grounded LLM synthesis instead of the canned specific product answer path');
}

if (answerHandler.includes('function buildSpecificProductGroundedAnswer')) {
  fail('dead canned specific product answer builders must not remain in compassAnswerHandler');
}

for (const forbidden of [
  'PRODUCT_STRUCTURE_PROFILES',
  'PRODUCT_PROFILE',
  'function buildProductStructureAnswer',
  'function buildBroadProductOverviewAnswer',
  'function buildCannedProductStructureAnswer',
]) {
  if (answerHandler.includes(forbidden) || answerService.includes(forbidden)) {
    fail(`dead broad canned product builder/profile must not remain: ${forbidden}`);
  }
}

for (const phrase of [
  'DA는 다운로드형 상품이 아니라 디스플레이/배너형 광고 맥락으로 보는 것이 맞습니다.',
  '현재 선별된 출처에서는 DA 관련 일부 운영 기준만 확인됩니다.',
  '에서 질문하신 상품은 소재 형식, 규격, 지면별 제한을 함께 대조해야 합니다.',
  'Meta 광고는 상품명 하나를 고르는 방식이라기보다',
  'Google Ads는 상품명 하나를 고르는 방식이라기보다',
  '네이버 광고는 검색 유입, 쇼핑 상품 노출',
  '카카오 광고는 카카오 서비스 지면',
  '**1. 캠페인 목표부터 정하기**',
  '**2. 목표에 맞는 광고 형식과 노출 위치 확인하기**',
  '**3. 판매·카탈로그 운영 기능 확인하기**',
  '**4. 상황별 빠른 선택 기준**',
  '**1. 목적에 맞는 캠페인 유형부터 확인하기**',
  '**1. 광고 목적과 노출 지면부터 확인하기**',
  '**1. 상품·지면·심사 기준부터 확인하기**',
]) {
  if (answerHandler.includes(phrase)) {
    fail(`canned product answer phrase must not remain in answer handler: ${phrase}`);
  }
}

if (answerHandler.includes("model: 'compass-answer-grounded-specific-product'")) {
  fail('specific product questions must not return the canned grounded-specific-product model before LLM synthesis');
}

const productStructureSelectorBody = answerHandler.split('function selectProductStructureResponseSources')[1]?.split('function capProductStructureGraphSources')[0] || '';

if (productStructureSelectorBody.includes('PRODUCT_STRUCTURE_PROFILES')) {
  fail('broad product structure source selection must be query-driven, not profile-template driven');
}

if (!productStructureSelectorBody.includes('scoreBroadProductStructureSource')) {
  fail('broad product structure source selection must score sources from query and graph signals');
}

if (!/graphSourceLooksLikeBroadBusinessNewsTitle[\s\S]*graphSourceHasAdProductTitle[\s\S]*scoreProductStructureGraphSource/.test(answerHandler)) {
  fail('broad product graph source selection must demote business/news graph titles unless they clearly name an ad product');
}

if (!/targetVendor === 'META' && graphSourceLooksLikeBroadBusinessNewsTitle\(source\) && !graphSourceHasAdProductTitle\(source\)/.test(productStructureSelectorBody)) {
  fail('Meta broad product source pool must remove broad business/news titles before source selection');
}

if (!/isBroadProductStructureCatalogIntent[\s\S]*isProductCatalogOverviewQuestion\(message\)[\s\S]*shouldUseDeterministicProductAnswerBeforeLlm\(\) && !isBroadProductStructureCatalogIntent[\s\S]*buildDeterministicSpecificProductAnswer/.test(answerHandler)) {
  fail('broad product questions must bypass the early specific-product deterministic path and use broad source selection');
}

if (!/intent\.isSpecificProductGuidance[\s\S]*!usesNaverShoppingDataIntent[\s\S]*return selected/.test(rag)) {
  fail('specific product questions must bypass broad required product coverage except NAVER shopping DB setup intents, even when strictProductTerms missed the product');
}

function extractBlock(label, source, startNeedle, endNeedle) {
  const startIndex = source.indexOf(startNeedle);
  if (startIndex < 0) {
    fail(`${label} block start not found: ${startNeedle}`);
    return '';
  }
  const endIndex = source.indexOf(endNeedle, startIndex + startNeedle.length);
  if (endIndex < 0) {
    fail(`${label} block end not found: ${endNeedle}`);
    return source.slice(startIndex);
  }
  return source.slice(startIndex, endIndex);
}

const ragSpecificAnchorBlock = extractBlock(
  'RAG specific product anchors',
  rag,
  'private buildSpecificProductAnchorTerms',
  'private hasSpecificProductTermOnlyMatch',
);
const answerStrictAnchorBlock = extractBlock(
  'answer routing strict product anchors',
  answerHandler,
  'function buildStrictProductEvidenceTerms',
  'function buildPrimarySpecificProductEvidenceTerms',
);
const answerPrimaryAnchorBlock = extractBlock(
  'answer routing primary product anchors',
  answerHandler,
  'function buildPrimarySpecificProductEvidenceTerms',
  'function sourceMatchesStrictProductIntent',
);
const answerSupplementBlock = extractBlock(
  'answer routing product supplement queries',
  answerHandler,
  'function buildProductStructureSupplementQueries',
  'function mergeSearchResultsByIdentity',
);
const productStructureGraphCoverageBlock = extractBlock(
  'RAG product structure graph coverage',
  rag,
  'private ensureProductStructureGraphCandidateCoverage',
  'private isLowValueProductStructureGraphCandidate',
);
const requestedProductFocusMatchBlock = extractBlock(
  'requested product focus match',
  answerHandler,
  'function sourceMatchesRequestedProductFocus',
  'function scoreRequestedProductFocus',
);
const requestedProductFocusScoreBlock = extractBlock(
  'requested product focus score',
  answerHandler,
  'function scoreRequestedProductFocus',
  'function buildRequestedProductStructureCoverageTerms',
);
const strictProductVisibleEvidenceTextBlock = extractBlock(
  'strict product visible evidence text',
  answerHandler,
  'function getStrictProductVisibleEvidenceText',
  'function getSpecificProductEvidenceText',
);
const specificProductEvidenceTextBlock = extractBlock(
  'specific product evidence text',
  answerHandler,
  'function getSpecificProductEvidenceText',
  'function isGraphVerifiedSource',
);
const naverShoppingDataEvidenceBlock = extractBlock(
  'NAVER shopping data evidence',
  answerHandler,
  'function sourceHasNaverShoppingDataEvidence',
  'function sourceHasStrongNaverShoppingDataEvidence',
);
const naverStrongShoppingDataEvidenceBlock = extractBlock(
  'NAVER strong shopping data evidence',
  answerHandler,
  'function sourceHasStrongNaverShoppingDataEvidence',
  'function scoreNaverShoppingDataEvidence',
);
const naverShoppingDataScoreBlock = extractBlock(
  'NAVER shopping data score',
  answerHandler,
  'function scoreNaverShoppingDataEvidence',
  'function buildStrictProductEvidenceTerms',
);
const groundingSourceContentBlock = extractBlock(
  'answer grounding source content',
  answerHandler,
  'function buildGroundingSourceContent',
  'function buildAnswerGroundingSources',
);
const answerGroundingSourcesBlock = extractBlock(
  'answer grounding sources',
  answerHandler,
  'function buildAnswerGroundingSources',
  'function normalizeSourceTitle',
);
const searchResultRescueTextBlock = extractBlock(
  'search result rescue text',
  answerHandler,
  'function buildSearchResultActualEvidenceText',
  'function searchResultHasBroadProductSignal',
);

for (const [label, block] of [
  ['requested product focus match', requestedProductFocusMatchBlock],
  ['requested product focus score', requestedProductFocusScoreBlock],
]) {
  if (!block.includes('getSpecificProductEvidenceText(source)')) {
    fail(`${label} must match only against actual evidence text`);
  }

  if (block.includes('getProductStructureCoverageText(source)')) {
    fail(`${label} must not use product-structure metadata/rank reasons as evidence text`);
  }
}

if (strictProductVisibleEvidenceTextBlock.includes('getSourceText(source)')) {
  fail('strict product visible evidence text must not fall back to metadata/rank-expanded source text');
}

for (const forbiddenEvidenceText of [
  'getSourceText(source)',
  'matchText',
  'rankReason',
  'evidenceDecisionReason',
  'metadata.',
  'getProductStructureVisibleSourceText',
]) {
  if (specificProductEvidenceTextBlock.includes(forbiddenEvidenceText)) {
    fail(`specific product evidence text must use only visible source fields, not ${forbiddenEvidenceText}`);
  }
}

for (const [label, block] of [
  ['NAVER shopping data evidence', naverShoppingDataEvidenceBlock],
  ['NAVER strong shopping data evidence', naverStrongShoppingDataEvidenceBlock],
  ['NAVER shopping data score', naverShoppingDataScoreBlock],
]) {
  if (!block.includes('getSpecificProductEvidenceText(source)')) {
    fail(`${label} must score only actual evidence text`);
  }

  for (const forbiddenText of [
    'getSourceText(source)',
    'getProductStructureVisibleSourceText(source)',
    'metadata.rankReason',
    'metadata.evidenceDecisionReason',
    'metadata.coverageRole',
    'metadata.retrievalMethod',
  ]) {
    if (block.includes(forbiddenText)) {
      fail(`${label} must not use metadata/rank-expanded evidence: ${forbiddenText}`);
    }
  }
}

if (searchResultRescueTextBlock.includes('buildDiagnosticSourceText(result)')) {
  fail('product structure rescue must not use diagnostic text as answerable evidence');
}

if (!searchResultRescueTextBlock.includes('function searchResultTextForRescue(result: SearchResult): string')) {
  fail('product structure rescue must keep a dedicated actual-evidence text helper');
}

if (groundingSourceContentBlock.includes('wantsDetailContent && matchText')) {
  fail('detail grounding must not expand with metadata-rich matchText');
}

if (!groundingSourceContentBlock.includes('wantsProductStructureContent && matchText.length')) {
  fail('matchText expansion must be limited to broad product structure overview/selection content');
}

if (groundingSourceContentBlock.includes('const fallbackContent = excerpt || matchText')) {
  fail('detail grounding fallback must not use metadata-rich matchText when excerpt is empty');
}

if (answerGroundingSourcesBlock.includes("source.evidenceDecision === 'rejected' ? source.evidenceDecision : 'verified'")) {
  fail('grounding sources must not coerce weak/rescued sources into verified evidence');
}

if (!answerGroundingSourcesBlock.includes("const groundingDecision = source.evidenceDecision || 'weak'")) {
  fail('grounding sources must preserve evidenceDecision and default missing values to weak');
}

if (/if\s*\(\s*intent\.isSpecificProductGuidance\s*\)\s*\{\s*return selected;\s*\}/.test(productStructureGraphCoverageBlock)) {
  fail('specific product questions should allow official-guide GraphRAG complement instead of bypassing graph coverage entirely');
}

for (const snippet of [
  'isLowValueProductStructureGraphCandidate',
  'official_guide_graph_rag_candidate_coverage',
]) {
  if (!productStructureGraphCoverageBlock.includes(snippet)) {
    fail(`product structure GraphRAG coverage must keep only useful official guide complements: ${snippet}`);
  }
}

if (!/isAdministrativeSupportCandidate[\s\S]*text\.includes\('지불'\)[\s\S]*text\.includes\('billing'\)/.test(rag)) {
  fail('administrative support filtering must catch Korean payment wording such as 지불');
}

if (!/isLowValueProductStructureGraphCandidate[\s\S]*세금\|청구\|결제\|지불[\s\S]*isOffAxisProductStructureGraphText[\s\S]*세금\|청구\|결제\|지불/.test(rag)) {
  fail('product structure graph filtering must catch Korean payment wording such as 지불');
}

if (!/sourceIdentityLooksLikeGenericLegalOrAccountDoc[\s\S]*청구\|결제\|지불[\s\S]*isLowValueSpecificProductSource[\s\S]*청구\|결제\|지불[\s\S]*scoreVerifiedSourceForIntent[\s\S]*hasAdministrativeSupportSignal[\s\S]*청구\|결제\|지불/.test(answerHandler)) {
  fail('answer source routing must demote payment/account support documents such as 지불 for product-structure answers');
}

if (!/COMPASS_ANSWER_RESPONSE_CACHE_KEY_VERSION = 'v6-kakao-priority-guide-rescue'[\s\S]*`compass-answer:\$\{COMPASS_ANSWER_RESPONSE_CACHE_KEY_VERSION\}:\$\{message\}`/.test(answerHandler)) {
  fail('answer response cache key must be versioned so stale durable cached answers are bypassed after source-quality fixes');
}

if (answerHandler.includes('compass-answer:v1:${message}')) {
  fail('answer response cache key must not reuse the old v1 prefix after product source filtering changes');
}

if (!/sourceLooksLikeProductStructureSupportNoise[\s\S]*getSourceIdentityText\(source\)[\s\S]*세금\|tax\|vat\|청구\|결제\|지불[\s\S]*비즈쿠폰\|쿠폰[\s\S]*광고할\\s\*수\\s\*없는\\s\*경우[\s\S]*isUsableBroadProductStructureSource[\s\S]*sourceLooksLikeProductStructureSupportNoise\(source\)/.test(answerHandler)) {
  fail('broad product source selection must reject tax/coupon/support-noise documents before answer source selection');
}

if (!/sourceLooksLikeMetaBroadProductNewsNoise[\s\S]*facebook\\\.com\\\/business\\\/news[\s\S]*성과\\s\*증대[\s\S]*hasBroadOverviewStructure[\s\S]*isUsableBroadProductStructureSource[\s\S]*targetVendor === 'META' && sourceLooksLikeMetaBroadProductNewsNoise\(source\)/.test(answerHandler)) {
  fail('Meta broad product source selection must reject business/news success-story sources before answer source selection');
}

const graphTitleBlock = extractBlock(
  'answer graph product title signal',
  answerHandler,
  'function graphSourceHasAdProductTitle',
  'function graphSourceLooksLikeBroadBusinessNewsTitle',
);
if (/광고\|ads\?\|ad\\s/.test(graphTitleBlock)) {
  fail('graphSourceHasAdProductTitle must not treat bare 광고/ads/ad as product-structure title evidence');
}

if (!/selected\.length === 0[\s\S]*recoverableBroadSources[\s\S]*targetVendor === 'META' && sourceLooksLikeMetaBroadProductNewsNoise\(source\)[\s\S]*return null/.test(answerHandler)) {
  fail('Meta broad product recoverable fallback must not reintroduce business/news success-story sources');
}

if (!/isMetaBroadProductNewsNoiseText[\s\S]*facebook\\\.com\\\/business\\\/news[\s\S]*성과\\s\*증대[\s\S]*hasMetaObjectiveProductStructureSignal/.test(rag)
  || !/searchMetaProductOverviewPriorityCandidates[\s\S]*isMetaBroadProductNewsNoiseText\(sourceText\)[\s\S]*return null[\s\S]*queryWantsFormatPlacement[\s\S]*hasFormatPlacementSignal && !hasObjectiveSignal && !hasCommerceSignal && !queryWantsFormatPlacement[\s\S]*return null/.test(rag)
) {
  fail('Meta overview priority retrieval must reject business/news and format-only sources before boosting them');
}

if (!/calculateProductStructureGraphTitleAdjustment[\s\S]*hasMetaBusinessNewsUrl[\s\S]*meta_product_structure_news_url_penalty[\s\S]*isLowValueProductStructureGraphCandidate[\s\S]*intent\.vendors\[0\] === 'META'[\s\S]*isMetaBroadProductNewsNoiseText\(sourceText\)/.test(rag)) {
  fail('Meta product-structure GraphRAG selection must penalize and reject weak business/news graph sources');
}

if (!/const sourceGuidedBroadProductSources = answerSources\.filter[\s\S]*sourceLooksLikeProductStructureSupportNoise\(source\)[\s\S]*buildLlmFailureGroundedFallbackAnswer\([\s\S]*sourceGuidedBroadProductSources[\s\S]*sources: sourceGuidedBroadProductSources[\s\S]*answerSourceCount: sourceGuidedBroadProductSources\.length/.test(answerHandler)) {
  fail('fast broad product source-guided fallback must use support-noise-filtered sources');
}

if (!/const productStructureSources = selectProductStructureResponseSources\(sources, ragIntent, message\)[\s\S]*\.filter\(source => !sourceLooksLikeProductStructureSupportNoise\(source\)\)[\s\S]*if \(productStructureSources\.length === 0\)/.test(answerHandler)) {
  fail('broad product answer routing must remove support-noise sources before deciding whether evidence is sufficient');
}

if (!/function buildEvidenceBackedAnswer[\s\S]*const citedSourceIndexes = Array\.from\(usedSourceIndexes\)[\s\S]*citedSourceLabels[\s\S]*sources: citedSourceIndexes\.map\(index => sources\[index\]\)/.test(answerHandler)) {
  fail('deterministic product answers must return only the sources cited in the rendered answer');
}

if (!/scoreProductStructureGraphSource[\s\S]*청구\|결제\|지불[\s\S]*score -= 1\.8/.test(answerHandler)
  || !/scoreBroadProductStructureSource[\s\S]*청구\|결제\|지불[\s\S]*score -= 2\.4/.test(answerHandler)
) {
  fail('product-structure answer source scoring must penalize payment/account support sources such as 지불');
}

for (const [label, text] of [
  ['RAG specific product anchors', ragSpecificAnchorBlock],
  ['answer routing strict product anchors', answerStrictAnchorBlock],
  ['answer routing primary product anchors', answerPrimaryAnchorBlock],
]) {
  for (const forbiddenAnchor of [
    "'디스플레이 캠페인'",
    "'반응형 디스플레이'",
  ]) {
    if (text.includes(forbiddenAnchor)) {
      fail(`${label} must not use broad display-campaign siblings as strict DA anchors: ${forbiddenAnchor}`);
    }
  }
}

for (const forbiddenSupplement of [
  '앱 인스톨 앱 홍보 광고 가이드',
  'App Install App Promotion SDK MMP 앱 이벤트',
]) {
  if (answerSupplementBlock.includes(forbiddenSupplement)) {
    fail(`specific product supplement queries must not inject broad app-install guidance terms unconditionally: ${forbiddenSupplement}`);
  }
}

if (!/strictSpecificProductIntent[\s\S]*!strictSpecificProductMatch[\s\S]*!allowedSpecificProductProcedureEvidence[\s\S]*return false/.test(rag)) {
  fail('specific product evidence gate must reject broad candidates that do not match requested product terms');
}

if (!/const matchedTerms = this\.getSpecificProductMatchedTerms\(sourceText,\s*intent\)[\s\S]*return !this\.isBroadSpecificProductCatalogHit\(sourceText,\s*intent\)/.test(rag)) {
  fail('specific product term match must reject broad catalog hits unless the matched product has nearby detail evidence');
}

if (!/const primaryTerms = buildPrimarySpecificProductEvidenceTerms\(intent\)[\s\S]*const matchedTerms = \([\s\S]*sourceTextLooksLikeBroadProductCatalogOnly\(text,\s*matchedTerms\)/.test(answerHandler)) {
  fail('specific product answer routing must reject broad catalog-only sources even when they mention the product term');
}

if (!/const rawAnswerSources = mode === 'product_detail'[\s\S]*: \(modeMatchedSources\.length > 0 \? modeMatchedSources : relaxedModeSources\)[\s\S]*const answerSources = selectedAnswerSources\.length > 0[\s\S]*: \(rankedAnswerSources\.length > 0 \? rankedAnswerSources : strictProductSources\)\.slice\(0, 6\)[\s\S]*const missingRequestedFocus = Boolean\(requestedFocus\?\.isSpecificFamilyQuestion && focusMatchedSources\.length === 0\)[\s\S]*strictProductSources: returnedStrictProductSources[\s\S]*shouldLimit: returnedStrictProductSources\.length === 0/.test(answerHandler)) {
  fail('specific product mode questions must carry relaxed/strict evidence into LLM synthesis before limiting the answer');
}

if (!/if \(selected\.length === 0 && mode !== 'product_detail'\)/.test(answerHandler)
  || !/const productContextLimit = mode === 'product_detail'[\s\S]*\? 0/.test(answerHandler)
  || !/const titleHasPrimaryTerm = primaryTerms\.some/.test(answerHandler)
) {
  fail('product_detail routing must require title or nearby detail evidence and must not use context fallback fillers');
}

const ragSpecificDetailBlock = rag.split('private hasSpecificProductDetailSignal(sourceText: string): boolean')[1]?.split('private isBroadSpecificProductCatalogHit')[0] || '';
const answerSpecificDetailBlock = answerHandler.split('function sourceTextHasSpecificProductDetailSignal(text: string): boolean')[1]?.split('function sourceTextLooksLikeBroadProductCatalogOnly')[0] || '';
const ragNearTermDetailBlock = rag.split('private hasSpecificProductDetailSignalNearTerm(sourceText: string, term: string): boolean')[1]?.split('private isBroadSpecificProductCatalogHit')[0] || '';
const answerNearTermDetailBlock = answerHandler.split('function sourceTextHasSpecificProductDetailSignalNearTerm(text: string, term: string): boolean')[1]?.split('function sourceTextLooksLikeBroadProductCatalogOnly')[0] || '';
for (const [label, block] of [
  ['RAG specific product detail signal', ragSpecificDetailBlock],
  ['answer routing specific product detail signal', answerSpecificDetailBlock],
]) {
  if (!block) {
    fail(`${label} block not found`);
    continue;
  }

  for (const broadTerm of ['|선택|', '|관리자|', '|이미지|', '|동영상|', '|배너|', '|썸네일|']) {
    if (block.includes(broadTerm)) {
      fail(`${label} must not use broad product/catalog words as standalone detail signals: ${broadTerm}`);
    }
  }
}

for (const [label, block, forbiddenGlobalFallback] of [
  ['RAG specific product near-term detail signal', ragNearTermDetailBlock, 'return this.hasSpecificProductDetailSignal(text);'],
  ['answer routing specific product near-term detail signal', answerNearTermDetailBlock, 'return sourceTextHasSpecificProductDetailSignal(normalizedText);'],
]) {
  if (!block) {
    fail(`${label} block not found`);
    continue;
  }

  if (!/windowText[\s\S]*detailPattern\.test\(windowText\)/.test(block)) {
    fail(`${label} must require detail signals near the matched product term`);
  }

  if (block.includes(forbiddenGlobalFallback)) {
    fail(`${label} must not pass based only on global detail signals elsewhere in the source`);
  }
}

if (!/const specificProductAnchorTerms = this\.buildSpecificProductAnchorTerms\(intent\)[\s\S]*const graphQueryTerms = specificProductIntent[\s\S]*specificProductAnchorTerms[\s\S]*: intent\.keywords/.test(rag)) {
  fail('graph product-structure scoring must use strict product anchors for specific product questions');
}

for (const snippet of [
  'buildStrictProductEvidenceTerms',
  'sourceMatchesStrictProductIntent',
  'sourceTextHasSpecificProductDetailSignalNearTerm',
  'sourceTextLooksLikeBroadProductCatalogOnly(text, matchedTerms)',
  'shortAsciiTermPattern',
  'sourceIsBroadProductStructureOnly',
  'inferSpecificProductAnswerMode',
  'buildRequestedProductModeTerms',
  'strictProductSourceCount',
  'answerSourceCount',
  'strictProductMatch',
  'sourceIsBroadProductStructureOnly(source, intent)',
  'score += 160',
  'score -= 95',
  'score -= 130',
  'buildGroundingSourceContent',
  'wantsProductStructureContent && matchText.length',
  'source.matchText',
  'answerLooksLikeExtractiveSourceDump',
  'answerHasSpecificOperationalDepth',
  'extractive_source_dump',
  'insufficient_specific_depth',
  '디스플레이 광고',
  '홈피드',
  '배너 광고',
]) {
  if (!answerHandler.includes(snippet)) fail(`answer handler missing strict product evidence snippet: ${snippet}`);
}

for (const snippet of [
  'answer_mode',
  'product_overview',
  'product_detail',
  'execution_guide',
  'setup_procedure',
  'policy_screening',
  'operational_issue',
  '전체 상품 구조를 반복하지 말고 그 항목에 직접 답하세요. 첫 문장부터 질문한 항목을 다루세요.',
  '특정 광고 상품을 물으면 개요 템플릿을 반복하지 말고',
  '섹션 제목은 답변 모드와 사용자가 물은 상품/절차를 반영해 새로 붙이세요.',
  '검증 근거가 하나도 없을 때만 "현재 제공된 문서에서는 확인되지 않습니다"라고 답하세요.',
]) {
  if (!answerService.includes(snippet)) fail(`answer prompt missing intent-mode snippet: ${snippet}`);
}

if (!/const answerModeHint = searchResults\.find\(result => result\.answerMode \|\| result\.metadata\?\.answerMode\)\?\.answerMode[\s\S]*\|\| searchResults\.find\(result => result\.metadata\?\.answerMode\)\?\.metadata\?\.answerMode[\s\S]*\|\| 'auto'/.test(answerService)) {
  fail('answer LLM prompt must derive answerMode from grounding sources and metadata');
}

if (!/const questionIntentHint = searchResults\.find\(result => result\.questionIntent \|\| result\.metadata\?\.questionIntent\)\?\.questionIntent[\s\S]*\|\| searchResults\.find\(result => result\.metadata\?\.questionIntent\)\?\.metadata\?\.questionIntent[\s\S]*\|\| 'auto'/.test(answerService)) {
  fail('answer LLM prompt must derive questionIntent from grounding sources and metadata');
}

if (!answerService.includes('`답변 모드 힌트: ${answerModeHint}`') || !answerService.includes('`질문 처리 힌트: ${questionIntentHint}`')) {
  fail('answer LLM prompt must render answerMode and questionIntent hints');
}

if (!/function buildAnswerGroundingSources[\s\S]*answerMode: options\.answerMode[\s\S]*questionIntent: options\.questionIntent[\s\S]*metadata:\s*\{[\s\S]*answerMode: options\.answerMode[\s\S]*questionIntent: options\.questionIntent/.test(answerHandler)) {
  fail('answer grounding sources must carry answerMode/questionIntent both top-level and in metadata');
}

if (!/answerResult = await generateCompassAnswer\([\s\S]*buildAnswerGroundingSources\([\s\S]*buildCompassGroundingOptions\(message,\s*ragIntent,\s*specificProductScope,\s*isBroadProductStructureLlmIntent\)/.test(answerHandler)) {
  fail('answer generation must receive answerMode/questionIntent grounding options from the handler');
}

if (!answerHandler.includes('buildCompassAnswerModel(message, ragIntent, isBroadProductStructureLlmIntent)')) {
  fail('answer metadata must classify specific product questions with the original message, not only parsed intent flags');
}

if (answerService.includes('상품 카탈로그가 아니라 "근거에서 확인되는 광고 형식/사양"으로 범위를 좁혀 답하세요')) {
  fail('answer prompt must not always narrow ad product questions to creative specs');
}

if (answerService.includes('캠페인 목표 / 노출 위치 / 소재 형식 / 자동화·커머스·측정 기반 / 목적별 선택 기준')) {
  fail('answer prompt must not force every ad product question into one fixed structure');
}

if (!/recommendedSourceLimit[\s\S]*hasProductStructureIntent[\s\S]*\?\s*6/.test(rag)) {
  fail('product structure intent should request broader verified source coverage');
}

if (!/needsProductStructureRetrieval[\s\S]*Math\.max\(limit,\s*intent\.vendors\.length \* 4,\s*needsProductStructureRetrieval \? 18 : 8\)/.test(rag)) {
  fail('product structure intent should expand retrieval candidate pool for vendor queries');
}

if (!/const timeoutMs = Number\.isFinite\(parsed\) && parsed > 0 \? parsed : 28000/.test(rag)) {
  fail('RAG retrieval channels need a 28s default budget so slower production Supabase keyword paths do not collapse to empty no-data results');
}

if (!/return Math\.min\(Math\.max\(timeoutMs, 8000\), 30000\)/.test(rag)) {
  fail('RAG retrieval channel timeout must allow 8s-30s range for production latency variance');
}

if (!/const timeoutMs = Number\.isFinite\(parsed\) \? parsed : 30000/.test(answerHandler)) {
  fail('Compass answer retrieval needs a 30s default budget before no-data fallback');
}

if (!/return Math\.min\(Math\.max\(timeoutMs, 12000\), 45000\)/.test(answerHandler)) {
  fail('Compass answer retrieval timeout must allow 12s-45s range inside the 60s Vercel function budget');
}

if (!/type CompassRetrievalResult = \{[\s\S]*results: SearchResult\[\];[\s\S]*timedOut: boolean;[\s\S]*\}/.test(answerHandler)) {
  fail('Compass answer retrieval must carry timeout metadata alongside search results');
}

if (!/const retrievalTimedOut = searchResultGroups\.some\(group => group\.timedOut\)/.test(answerHandler)) {
  fail('Compass answer handler must preserve whether any retrieval query timed out');
}

if (!/const channelTimeoutMetadata = getCompassRetrievalChannelTimeoutMetadata\(searchResults\)[\s\S]*channelTimedOut: channelTimeoutMetadata\.timedOut/.test(answerHandler)) {
  fail('Compass answer handler must preserve per-channel retrieval timeout metadata');
}

if (!/type CompassRetrievalResult = \{[\s\S]*channelTimings: RetrievalChannelTiming\[\];[\s\S]*durationMs: number;[\s\S]*\}/.test(answerHandler)) {
  fail('Compass answer retrieval must carry per-channel timing metadata alongside search results');
}

if (!/retrievalChannelTimings = searchResultGroups\.flatMap/.test(answerHandler)) {
  fail('Compass answer handler must aggregate per-query retrieval channel timings');
}

if (!/retrievalSlowestChannel = retrievalChannelTimings\.length > 0/.test(answerHandler)) {
  fail('Compass answer handler must expose the slowest retrieval channel for tuning');
}

if (!/retrievalQueryTimings,[\s\S]*retrievalChannelTimings,[\s\S]*retrievalSlowestChannel/.test(answerHandler)) {
  fail('Compass source diagnostics must expose retrieval query and channel timing metrics');
}

if (!/const retrievalLimited = retrievalTimedOut \|\| retrievalChannelTimedOut/.test(answerHandler)) {
  fail('Compass answer handler must combine outer and per-channel retrieval timeouts for no-evidence limiting');
}

if (!/verifiedSearchResults\.length === 0 && retrievalLimited/.test(answerHandler)) {
  fail('Compass answer handler must separate retrieval-limited empty evidence from authoritative no-data');
}

if (!/model: 'compass-answer-retrieval-limited'/.test(answerHandler)) {
  fail('Compass answer handler must return a dedicated retrieval-limited model for timed-out empty evidence');
}

if (!/noDataFound: false,[\s\S]*model: 'compass-answer-retrieval-limited'/.test(answerHandler)) {
  fail('retrieval-limited responses must not be classified as noDataFound');
}

if (!/productStructureCandidates[\s\S]*mergeDedupeAndRankCandidates[\s\S]*productStructureCandidates/.test(rag)) {
  fail('product structure anchor candidates must be merged into final ranking');
}

if (!/usesVendorProductStructurePriority[\s\S]*Promise\.resolve\(\[\]\)[\s\S]*searchProductStructureCandidates/.test(rag)) {
  fail('single-vendor broad product fast path must skip generic product-structure anchor fan-out when a vendor priority path exists');
}

if (!/selectSupabaseKeywordSearchTerms[\s\S]*maxTerms[\s\S]*16/.test(rag)) {
  fail('Supabase keyword search must cap product-structure OR terms to avoid broad fan-out latency');
}

if (!/selectSupabaseKeywordSearchTerms[\s\S]*isBroadProductStructureRetrievalIntent\(intent\)[\s\S]*\?\s*10/.test(rag)) {
  fail('broad product fast path must use a tighter keyword term cap');
}

if (!/selectSupabaseKeywordSearchTerms[\s\S]*isKakaoBizboardDisplayProductIntent\(intent\)[\s\S]*'비즈보드'[\s\S]*'카카오 비즈보드'[\s\S]*'디스플레이 광고'[\s\S]*\.slice\(0, 6\)/.test(rag)) {
  fail('KAKAO broad product keyword retrieval must use a narrow Bizboard term set');
}

if (!/getKeywordTableFetchLimit[\s\S]*Math\.min\(Math\.max\(limit \* multiplier, floor\), ceiling\)/.test(rag)) {
  fail('keyword table search must use bounded fetch limits instead of unbounded broad-product row fan-out');
}

if (!/getKeywordTableFetchLimit[\s\S]*isKakaoBizboardDisplayProductIntent\(intent\)[\s\S]*Math\.min\(Math\.max\(limit, 12\), 20\)[\s\S]*isBroadProductStructureRetrievalIntent/.test(rag)) {
  fail('KAKAO broad product keyword retrieval must use a smaller fetch limit before generic broad product limits');
}

if (!/isBroadProductStructureRetrievalIntent[\s\S]*intent\.isProductStructureOverview[\s\S]*getKeywordTableFetchLimit[\s\S]*Math\.min\(Math\.max\(limit \* 2, 16\), 36\)/.test(rag)) {
  fail('broad product fast path keyword table search must use a tighter fetch limit');
}

if (!/const keywordVendor = this\.isBroadProductStructureRetrievalIntent\(intent\)[\s\S]*this\.searchKeywordTable\('ollama_document_chunks', keywords, limit, intent, keywordVendor\)[\s\S]*this\.searchKeywordTable\('document_chunks', keywords, limit, intent, keywordVendor\)/.test(rag)) {
  fail('broad product fast path keyword search must be scoped to the requested vendor');
}

if (!/if \(vendor\) \{[\s\S]*request = request\.eq\('metadata->>source_vendor', vendor\);[\s\S]*\}/.test(rag)) {
  fail('keyword table search must apply vendor metadata filtering when a vendor is supplied');
}

if (!/isBroadProductStructureRetrievalIntent[\s\S]*getVendorMetadataFetchLimit[\s\S]*Math\.min\(Math\.max\(limit \* 2, 16\), 36\)/.test(rag)) {
  fail('broad product fast path vendor metadata search must use a tighter fetch limit');
}

if (!/getProductStructureAnchorFetchLimit[\s\S]*Math\.min\(Math\.max\(limit \* 8, 32\), 72\)/.test(rag)) {
  fail('product-structure anchor search must keep per-anchor Supabase fetches bounded');
}

if (!/getProductStructureAnchorFetchLimit[\s\S]*Math\.min\(Math\.max\(limit \* 3, 18\), 36\)/.test(rag)) {
  fail('broad product fast path anchor search must keep Supabase fetches small');
}

if (/search(?:ProductStructureAnchorTable|VendorMetadataTable|KeywordTable)[\s\S]{0,900}content, metadata, embedding/.test(rag)) {
  fail('keyword/anchor product retrieval must not fetch embedding payloads when query embeddings are not used');
}

if (!/calculateProductStructureGraphTitleAdjustment[\s\S]*product_structure_graph_ad_product_title[\s\S]*product_structure_graph_news_title_penalty/.test(rag)) {
  fail('product overview graph ranking must prefer ad product guide titles over broad business/news articles');
}

if (!/usesBroadProductStructureRetrieval[\s\S]*anchorVendors[\s\S]*\? \[intent\.vendors\[0\]\][\s\S]*anchorTerms[\s\S]*usesBroadProductStructureRetrieval \? 6 : 14/.test(rag)) {
  fail('broad product fast path anchor search must stay vendor-scoped with fewer generic anchors');
}

if (!/intent\.requiresVendorCoverage[\s\S]*searchVendorCoverageCandidates\(query, candidateLimit, intent\)[\s\S]*Promise\.resolve\(\[\]\)/.test(rag)) {
  fail('single-vendor broad product fast path must skip vendor-coverage fan-out when vendor coverage is not required');
}

if (!/prioritySearchAnchors[\s\S]*searchKeywordTable\('document_chunks', prioritySearchAnchors[\s\S]*searchVendorMetadataTable\('ollama_document_chunks', 'KAKAO', prioritySearchAnchors/.test(rag)) {
  fail('KAKAO product priority retrieval must use bounded batch keyword/metadata queries instead of sequential per-anchor Supabase fan-out');
}

if (!/getKakaoProductGraphSoftBudgetMs[\s\S]*COMPASS_KAKAO_PRODUCT_GRAPH_SOFT_BUDGET_MS[\s\S]*skipsGraphForGoogleProductOverview[\s\S]*usesKakaoProductPriority[\s\S]*product_fast_graph[\s\S]*getKakaoProductGraphSoftBudgetMs\(\)/.test(rag)) {
  fail('KAKAO product fast graph retrieval must use a non-blocking soft budget');
}

if (!/usesKakaoInternalProductComparison[\s\S]*isKakaoBizboardDisplayComparisonIntent\(intent\)[\s\S]*withRetrievalChannelSoftBudget[\s\S]*hybrid_graph[\s\S]*getKakaoProductGraphSoftBudgetMs\(\)/.test(rag)) {
  fail('KAKAO internal Bizboard/display comparison retrieval must not block on hybrid graph completion');
}

if (!/private isKakaoBizboardDisplayComparisonIntent\([\s\S]*intent\.isComparative[\s\S]*intent\.vendors\.length !== 1[\s\S]*mentionsBizboard[\s\S]*mentionsDisplay[\s\S]*return mentionsBizboard && mentionsDisplay/.test(rag)) {
  fail('KAKAO internal comparison soft-budget routing must stay scoped to Bizboard vs display comparison questions');
}

if (!/metaAppInstallPriorityCandidates,\s*\n\s*kakaoProductPriorityCandidates,\s*\n\s*graphCandidates[\s\S]*usesMetaAppInstallPriority[\s\S]*Promise\.resolve\(\[\]\),[\s\S]*skipsGraphForGoogleProductOverview/.test(rag)) {
  fail('KAKAO product fast path must not block on KAKAO priority retrieval');
}

if (!/specificKakaoFastPathAnchors[\s\S]*'비즈보드'[\s\S]*'카카오 비즈보드'[\s\S]*'디스플레이 광고'[\s\S]*usesSpecificKakaoOllamaFastPath[\s\S]*searchKeywordTable\('ollama_document_chunks', specificKakaoFastPathAnchors, 8, intent, 'KAKAO'\)[\s\S]*fastCandidates\.length > 0[\s\S]*return fastCandidates/.test(rag)) {
  fail('KAKAO specific product retrieval must try a narrow KAKAO-scoped ollama keyword path before broader document/vendor metadata fan-out');
}

if (!/if \(usesKakaoProductPriority && usesSpecificProductRetrieval\)[\s\S]*specific_kakao_priority_direct[\s\S]*if \(rankedResults\.length > 0\)[\s\S]*return this\.withRetrievalTimeoutMetadata\(rankedResults, timedOutChannels, channelTimings\);[\s\S]*selectKakaoProductPriorityRescueCandidates[\s\S]*KAKAO specific product priority candidates were rescued[\s\S]*continuing to hybrid retrieval[\s\S]*const queryEmbeddingResult = await this\.embeddingService\.generateEmbedding\(query\)/.test(rag)) {
  fail('KAKAO specific product retrieval must try the bounded priority direct path before embedding/vector/graph fan-out, but continue when priority candidates rank to zero');
}

if (!/allowedKakaoProductGuideEvidence[\s\S]*!allowedKakaoProductGuideEvidence[\s\S]*!this\.hasHighValueProductStructureSignal\(sourceText\)[\s\S]*!allowedKakaoProductGuideEvidence[\s\S]*normalizedContent\.length < 140/.test(rag)) {
  fail('KAKAO creative/audit guide evidence allowed by the specific product gate must not be dropped by later product-structure filters');
}

if (!/private selectKakaoProductPriorityRescueCandidates\([\s\S]*this\.isKakaoBizboardDisplayProductIntent\(intent\)[\s\S]*asksCreativeGuide[\s\S]*asksAuditGuide[\s\S]*hasCreativeGuideSignal[\s\S]*hasAuditGuideSignal[\s\S]*kakao_priority_guide_rescue/.test(rag)) {
  fail('KAKAO priority guide rescue must stay limited to Kakao creative/audit/product guide signals');
}

if (!/광고\s*사양[\s\S]*!this\.hasHighValueProductStructureSignal/.test(rag)) {
  fail('creative spec-only documents must be penalized only when high-value product structure is absent');
}

if (!/maxPerTitle[\s\S]*isNaverShoppingDataIntent\(intent\) \|\| intent\.isSpecificProductGuidance \? 2 : 1/.test(rag)) {
  fail('NAVER DB URL/product registration and specific product intents should allow detail chunks to survive same-title dedupe');
}

if (!/filter\(candidate => candidate\.hits > 0\)/.test(answerHandler)) {
  fail('topic source picker must not select unrelated sources when no topic term matches');
}

if (answerHandler.includes('실무 선택 기준')) {
  fail('product structure answer should use user-facing labels instead of internal wording like 실무 선택 기준');
}

if (/\['GOOGLE',\s*\[[^\]]*'display'[^\]]*\]\]/.test(rag) || /GOOGLE:\s*\[[^\]]*'display'[^\]]*\]/.test(rag)) {
  fail('bare display must not be treated as a GOOGLE vendor term because it corrupts NAVER DA/display routing');
}

for (const snippet of [
  "'네이버da'",
  "'홈피드'",
  "'스마트채널'",
  "'타임보드'",
  "'성과형 디스플레이'",
  "'google display'",
  "'구글 디스플레이'",
]) {
  if (!rag.includes(snippet)) fail(`RAG vendor-term contract missing disambiguation snippet: ${snippet}`);
}

if (answerHandler.includes("model: 'compass-answer-grounded-extractive'")) {
  fail('policy/detail questions must not bypass LLM synthesis with extractive boilerplate');
}

if (!chatbotRoute.includes("buildCompassAnswerResponse")) {
  fail('legacy /api/chatbot route must delegate to the canonical Compass answer engine');
}

if (/generateChatResponse|generateResponse|checkOllamaHealth|getRAGSearchService/.test(chatbotRoute)) {
  fail('legacy /api/chatbot route must not call old hard-coded chatbot/RAG/Ollama paths');
}

if (!/usesProductStructureFastPath\s*=\s*isBroadProductStructureAnswerIntent\(message,\s*ragIntent\)/.test(answerHandler)) {
  fail('product structure fast path must be limited to broad overview questions');
}

if (!/function getProductStructureFastPathSupplementLimit\(vendor\?: VendorIntent\)[\s\S]*case 'NAVER':[\s\S]*case 'META':[\s\S]*case 'GOOGLE':[\s\S]*return 0;[\s\S]*case 'KAKAO':[\s\S]*return 1;/.test(answerHandler)) {
  fail('product structure fast path supplement fan-out must stay bounded by vendor, with Meta/Naver/Google using graph/main retrieval only');
}

if (!/function getSpecificProductSupplementLimit\(vendor\?: VendorIntent,\s*message = ''\)[\s\S]*vendor === 'KAKAO' && isKakaoDisplaySpecificProductQuestion\(message\)[\s\S]*return 0;[\s\S]*return vendor === 'KAKAO' \? 1 : 2;/.test(answerHandler)) {
  fail('specific product supplement fan-out must stay bounded for Kakao product-detail questions and skip duplicate Kakao display supplements');
}

if (!/const supplementQueryLimit = usesProductStructureFastPath\s*\?\s*getProductStructureFastPathSupplementLimit\(ragIntent\.vendors\[0\]\)/.test(answerHandler)) {
  fail('product structure fast path must use the bounded supplement limit helper');
}

if (!/usesSpecificProductSupplementPath\s*\?\s*getSpecificProductSupplementLimit\(ragIntent\.vendors\[0\],\s*message\)/.test(answerHandler)) {
  fail('specific product supplement path must use the bounded supplement limit helper');
}

if (!/function buildFastKakaoSpecificProductAnswer\([\s\S]*COMPASS_DISABLE_FAST_KAKAO_SPECIFIC_PRODUCT_ANSWERS[\s\S]*intent\.vendors\.length !== 1 \|\| intent\.vendors\[0\] !== 'KAKAO' \|\| intent\.isComparative[\s\S]*family !== 'kakao_bizboard' && family !== 'kakao_creative'[\s\S]*buildDeterministicSpecificProductAnswer[\s\S]*buildStructuredSpecificProductScopeLimitedAnswer/.test(answerHandler)) {
  fail('Kakao specific product fast answer must stay gated to single-vendor Kakao bizboard/creative questions with source-guided evidence');
}

if (!/const fastKakaoSpecificProductAnswer = buildFastKakaoSpecificProductAnswer\([\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastKakaoSpecificProductAnswer\.fastAnswerFallback/.test(answerHandler)) {
  fail('Kakao specific product fast answer must expose zero answer-generation duration and fast-answer diagnostics');
}

if (!/function buildFastKakaoProductStructuredAnswer\([\s\S]*COMPASS_DISABLE_FAST_KAKAO_STRUCTURED_PRODUCT_ANSWERS[\s\S]*intent\.vendors\.length !== 1 \|\| intent\.vendors\[0\] !== 'KAKAO'[\s\S]*buildKakaoProductStructuredFallbackAnswer\(candidateSources, intent\)[\s\S]*fastAnswerFallback/.test(answerHandler)) {
  fail('Kakao structured product fast answer must stay gated to single-vendor Kakao evidence and reuse the official-source structured fallback before LLM');
}

if (!/const fastKakaoScopeRescueAnswer = buildFastKakaoProductStructuredAnswer\([\s\S]*compass-answer-fast-kakao-product-structured-scope-rescue[\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastKakaoScopeRescueAnswer\.fastAnswerFallback[\s\S]*const scopeLimitedAnswer/.test(answerHandler)) {
  fail('Kakao scope-limited product answers must try structured official-source rescue before returning no-data');
}

if (!/const fastKakaoStructuredProductAnswer = buildFastKakaoProductStructuredAnswer\([\s\S]*answerSources\.length > 0 \? answerSources : sources[\s\S]*compass-answer-fast-kakao-product-structured[\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastKakaoStructuredProductAnswer\.fastAnswerFallback[\s\S]*Compass specific product answer will use grounded LLM synthesis/.test(answerHandler)) {
  fail('Kakao single-vendor specific/comparison product answers must try structured fast answers before grounded LLM synthesis');
}

if (!/const fastKakaoBroadProductAnswer = buildFastKakaoProductStructuredAnswer\([\s\S]*productStructureSources[\s\S]*compass-answer-fast-kakao-product-structured[\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastKakaoBroadProductAnswer\.fastAnswerFallback[\s\S]*Compass product structure broad answer will use grounded LLM synthesis/.test(answerHandler)) {
  fail('Kakao broad product structure answers must try structured fast answers before grounded LLM synthesis');
}

if (/- 캠페인 목표 기준|먼저 고르는 것|그다음 고르는 것|고정된 상품명|고정 상품 목록|출처는 없지만 일반적으로|모든 매체에서 동일|  - 인지도:/.test(answerHandler)) {
  fail('product structure answer should avoid awkward or nested bullet formatting in rendered chat output');
}

if (process.exitCode) process.exit(process.exitCode);
console.log('[check-compass-product-structure-answer-contract] ok');
