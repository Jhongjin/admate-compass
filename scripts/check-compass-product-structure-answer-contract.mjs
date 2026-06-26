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
  return fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n');
}

const rag = read('src/lib/services/RAGSearchService.ts');
const officialChunkSnapshots = read('src/lib/services/compassOfficialChunkSnapshots.ts');
const answerService = read('src/lib/services/CompassAnswerLlmService.ts');
const answerHandler = read('src/lib/server/compassAnswerHandler.ts');
const chatbotRoute = read('src/app/api/chatbot/route.ts');
const relatedQuestionsRoute = read('src/app/api/related-questions/route.ts');
const ragFixtureEvaluator = read('scripts/evaluate-rag-fixtures.mjs');

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
  'META_APP_INSTALL_OFFICIAL_CHUNK_IDS',
  'META_CATALOG_OFFICIAL_CHUNK_IDS',
  'META_PRODUCT_OVERVIEW_OFFICIAL_CHUNK_IDS',
  'META_CREATIVE_SPEC_OFFICIAL_CHUNK_IDS',
  'GOOGLE_LEAD_FORM_OFFICIAL_CHUNK_IDS',
  'GOOGLE_PRODUCT_OVERVIEW_OFFICIAL_CHUNK_IDS',
  'META_VENDOR_POLICY_GENERAL_OFFICIAL_CHUNK_IDS',
  'GOOGLE_VENDOR_POLICY_GENERAL_OFFICIAL_CHUNK_IDS',
  'NAVER_VENDOR_POLICY_GENERAL_OFFICIAL_CHUNK_IDS',
  'NAVER_VIDEO_OFFICIAL_CHUNK_IDS',
  'NAVER_SHOPPING_DATA_OFFICIAL_CHUNK_IDS',
  'NAVER_SHOPPING_SEARCH_CREATIVE_OFFICIAL_CHUNK_IDS',
  'NAVER_DISPLAY_AD_OFFICIAL_CHUNK_IDS',
  'KAKAO_BIZBOARD_DISPLAY_OFFICIAL_CHUNK_IDS',
  'KAKAO_RESTRICTED_INDUSTRY_OFFICIAL_CHUNK_IDS',
  'KAKAO_USER_DECEPTION_OFFICIAL_CHUNK_IDS',
  'KAKAO_SERVICE_PROTECTION_OFFICIAL_CHUNK_IDS',
  'KAKAO_YOUTH_HARMFUL_OFFICIAL_CHUNK_IDS',
  'KAKAO_ADULT_CONTENT_OFFICIAL_CHUNK_IDS',
  'KAKAO_HATE_DISCRIMINATION_OFFICIAL_CHUNK_IDS',
  'KAKAO_RIGHTS_INFRINGEMENT_OFFICIAL_CHUNK_IDS',
  'KAKAO_REVIEW_STANDARDS_OFFICIAL_CHUNK_IDS',
  'KAKAO_PRICE_DISCOUNT_OFFICIAL_CHUNK_IDS',
  'KAKAO_EVENT_MATERIAL_OFFICIAL_CHUNK_IDS',
  'getCompassOfficialDocumentChunkSnapshotRows',
  'searchKnownOfficialDocumentChunks',
  'known_official_document_chunks',
  'naver_shopping_data_official_chunk',
  'naver_shopping_search_creative_official_chunk',
  'naver_video_official_chunk',
  'naver_display_ad_official_chunk',
  'kakao_service_protection_official_chunk',
  'kakao_product_official_chunk',
  'getKakaoFastPolicyOfficialChunkIds',
  'getFastPolicyOfficialChunkIdsForIntent',
  'searchFastPolicySourceGuidedOfficialCandidates',
  'fast_policy_official_chunk_direct',
  'fast_policy_official_chunk',
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
  'isFastPolicySourceGuidedPriorityIntent',
  'selectFastPolicySourceGuidedPriorityCandidates',
  'fast_policy_keyword_direct',
  'specific_naver_priority_direct',
  'selectNaverProductPriorityRescueCandidates',
  'naver_product_structure_priority_rescue',
  'specific_meta_app_install_priority_direct',
  'meta_app_install_setup_anchor',
  'meta_app_install_measurement_setup_priority',
  'specific_meta_creative_spec_priority_direct',
  'searchMetaCreativeSpecPriorityCandidates',
  'meta_creative_spec_official_chunk',
  'meta_creative_spec_priority',
  'meta_creative_spec_priority_rescue',
  'meta_product_overview_official_chunk',
  'google_product_overview_official_chunk',
  'specific_google_lead_form_priority_direct',
  'searchGoogleProductOverviewPriorityCandidates',
  'searchGoogleLeadFormPriorityCandidates',
  'google_lead_form_official_chunk',
  'google_lead_form_priority',
  'googleProductOverviewOfficialChunk',
  'usesGoogleProductOverviewPriority',
  'usesGoogleLeadFormPriority',
  'isMetaCreativeSpecIntent',
  'rawKeywordsOnly',
  'isKakaoBizboardDisplayComparisonIntent',
  'usesKakaoInternalProductComparison',
  'specific kakao priority direct path',
  'naver_product_structure_priority_keyword',
  'meta_product_overview_keyword',
  'meta_app_install_priority_keyword',
  'meta_app_install_vendor_metadata',
  'usesMetaAppInstallPriority',
  'product_fast_google_overview_priority',
  'hybrid_google_overview_priority',
  'getNaverFastPolicyOfficialChunkIds',
  'isOfficialProductOverviewCandidate',
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
  'isOfficialGraphCreativeSpecCandidateForIntent',
  'asset_spec',
  'ad_format',
  'placement',
  'product_structure_no_signal_penalty',
  "topic !== 'spec' && topic !== 'product_structure'",
]) {
  if (!rag.includes(snippet)) fail(`RAG service missing product structure contract snippet: ${snippet}`);
}

if (rag.includes('skipsGraphForGoogleProductOverview')) {
  fail('Google product overview must not skip graph/official coverage');
}

for (const snippet of [
  'COMPASS_OFFICIAL_CHUNK_SNAPSHOTS',
  'getCompassOfficialDocumentChunkSnapshotRows',
  'doc_1773710116296_uawf5xm_chunk_2',
  'doc_1774488207473_cjq6ve0_chunk_10',
  'doc_1774488207473_cjq6ve0_chunk_19',
  'doc_1774491147517_yj1v810_chunk_4',
  'doc_1774491147517_yj1v810_chunk_17',
  'url_1773203880202_q3y8fucqb_chunk_5',
  'facebook-ad-policy_chunk_0',
  'doc_1773886683376_omws3g9_chunk_2',
  'doc_1773886203371_8rlmmdv_chunk_1',
  'meta_business_help_ad_levels_2026_chunk_0',
  'meta_business_help_objectives_2026_chunk_0',
  'meta_business_help_formats_placements_2026_chunk_0',
  'meta_business_help_operating_modules_2026_chunk_0',
  'meta_business_help_lead_ads_instant_forms_2026_chunk_0',
  'meta_business_help_lead_data_crm_2026_chunk_0',
  'meta_business_help_pixel_capi_leads_2026_chunk_0',
  'meta_business_help_capi_crm_quality_leads_2026_chunk_0',
  'google_ads_campaign_types_2026_chunk_0',
  'google_ads_campaign_objectives_2026_chunk_0',
  'google_ads_conversion_goals_leads_2026_chunk_0',
  'google_ads_web_conversion_measurement_2026_chunk_0',
  'google_ads_offline_enhanced_conversions_leads_2026_chunk_0',
  'google_ads_lead_form_export_crm_api_2026_chunk_0',
  'google_ads_shopping_ads_2026_chunk_0',
  'google_ads_app_campaigns_2026_chunk_0',
  'naver_adguide_registration_standard_2026_chunk_0',
  'naver_adguide_operating_policy_2026_chunk_0',
  'meta_ad_standards_intro_2026_chunk_0',
  'meta_ad_standards_discriminatory_practices_2026_chunk_0',
  'meta_business_help_ad_review_2026_chunk_0',
  'doc_1773662526796_7rijhfq_chunk_2',
  'url_1770857834681_kyfp93bbk_chunk_9',
  'url_1773109915186_xnqeew2qd_chunk_4',
  'doc_1773663427417_g8z1v3y_chunk_2',
  'url_1770093784959_btzm84yr7_chunk_13',
  'doc_1764895606613_llkwwsf_doc_0',
  'doc_1764895552052_8xy5ad6_para_2',
]) {
  if (!officialChunkSnapshots.includes(snippet)) {
    fail(`official chunk snapshot store missing product/policy contract snippet: ${snippet}`);
  }
}

if (!/allowedRetrievalMethods[\s\S]*"graph"/.test(ragFixtureEvaluator)) {
  fail('RAG fixture evaluator must allow GraphRAG retrieval methods for official graph-backed product/spec fixtures');
}

if (!/requiredSourceChunkIds/.test(ragFixtureEvaluator)
  || !/requiredCitedSourceChunkIds/.test(ragFixtureEvaluator)
  || !/requireCitationConsistency/.test(ragFixtureEvaluator)
  || !/collectCitationNumbers/.test(ragFixtureEvaluator)
  || !/conversationHistory/.test(ragFixtureEvaluator)) {
  fail('RAG fixture evaluator must assert required source chunk ids and citation consistency for deterministic product answers');
}

if (!/private async searchKnownOfficialDocumentChunks[\s\S]*getCompassOfficialDocumentChunkSnapshotRows\(uniqueChunkIds, fetchLimit\)[\s\S]*snapshotRows\.length >= fetchLimit[\s\S]*const cacheKey = this\.buildSupabaseRowsCacheKey\('known_official_document_chunks'/.test(rag)) {
  fail('known official chunk retrieval must use local official snapshots before durable/Supabase lookup');
}

if (!/private getKakaoFastPolicyOfficialChunkIds[\s\S]*intent\.vendors\.length === 0[\s\S]*intent\.vendors\.length === 1 && intent\.vendors\[0\] === 'KAKAO'[\s\S]*KAKAO_YOUTH_HARMFUL_OFFICIAL_CHUNK_IDS[\s\S]*KAKAO_ADULT_CONTENT_OFFICIAL_CHUNK_IDS[\s\S]*KAKAO_HATE_DISCRIMINATION_OFFICIAL_CHUNK_IDS[\s\S]*KAKAO_RIGHTS_INFRINGEMENT_OFFICIAL_CHUNK_IDS[\s\S]*KAKAO_REVIEW_STANDARDS_OFFICIAL_CHUNK_IDS/.test(rag)) {
  fail('KAKAO official policy chunk routing must cover generic policy families without forcing keyword fan-out');
}

if (!/private getFastPolicyOfficialChunkIdsForIntent[\s\S]*case 'META':[\s\S]*getMetaFastPolicyOfficialChunkIds\(intent\)[\s\S]*case 'GOOGLE':[\s\S]*getGoogleFastPolicyOfficialChunkIds\(intent\)[\s\S]*getKakaoFastPolicyOfficialChunkIds\(intent\)/.test(rag)) {
  fail('fast policy official chunk routing must cover META and GOOGLE before keyword fan-out');
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
  'buildContextualCompassProductQuestion',
  'contextualized follow-up question',
  'COMPASS_CONVERSATION_HISTORY_MAX_ITEMS',
  'pickTopicSources',
  'buildProductStructureSupplementQueries',
  'getProductStructureFastPathSupplementLimit',
  'usesProductStructureFastPath',
  'intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(originalMessage)',
  'return intent.isProductStructureOverview',
  'buildSpecificProductAnswerScope',
  'buildFastKakaoSpecificProductAnswer',
  'buildFastKakaoProductStructuredAnswer',
  'buildFastPolicySourceGuidedAnswer',
  'buildFastNaverVideoProductAnswer',
  'buildFastStructuredSpecificProductAnswer',
  'META_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS',
  'META_GOOGLE_LEAD_COMPARISON_REQUIRED_CHUNK_IDS',
  'sourceHasExactMetaProductPlanningMatrixChunk',
  'sourceHasExactOfficialSnapshotChunk',
  'buildMetaGoogleLeadComparisonSupplementalSearchResults',
  'getMetaGoogleLeadComparisonRequiredSourceIndexes',
  'buildMetaGoogleLeadComparisonAnswer',
  'compass-answer-deterministic-meta-google-lead-comparison-matrix',
  'Meta와 Google Ads 모두 리드 확보에 쓸 수 있지만',
  '| 비교 축 | Meta | Google Ads | 실무 판단 |',
  '| 캠페인 목표 | Meta Ads Manager',
  '| 전환 추적·최적화 | Meta는 리드 전환 위치 외에도 웹사이트 리드라면 Meta Pixel',
  '| 오프라인·CRM 후속 | Meta 리드 데이터는 Ads Manager',
  '| 정책·계정 조건 | Meta 리드 광고는 인스턴트 양식',
  'Google은 리드 양식 광고 형식 게재 시 전환 중심 입찰 전략과 Google 리드 양식 전환 목표 최적화가 필요합니다',
  'Primary conversion action은 보고와 입찰 최적화에 쓰입니다',
  'Conversions API for CRM은 리드 데이터와 Meta Business Suite를 연결해 리드 광고 성과 개선',
  'CSV, 이메일, webhook, 서드파티 연동, Google Ads API로 CRM에 보낼 수 있고',
  '오프라인 전환 가져오기 또는 향상된 전환 리드',
  '전환 태그 firing',
  'lead_id dedupe',
  '유효 리드율',
  'MQL/SQL',
  '설계 분기표',
  'Meta Instant Form vs Meta 웹사이트 리드',
  'Google 리드 양식 vs 웹사이트 전환',
  'Meta = 잠재 고객 목표 + 전환 위치 + 인스턴트 양식/메시지/전화 + Pixel/CAPI + Conversions API for CRM/Qualified leads 중심',
  'Google Ads = 리드 목표 + 캠페인 유형 + 리드 양식 애셋 + 전환 목표/Primary action + webhook/API 수신 + 오프라인·향상된 전환 중심',
  'getMetaProductPlanningMatrixRequiredSourceIndexes',
  'if (!requiredSourceIndexes) return null',
  'buildMetaProductPlanningMatrixAnswer',
  'Meta 광고 상품은 “상품명 목록”이 아니라',
  '| 유형 | 캠페인 목표 | 주로 맞는 광고 형식 | 게재 위치 판단 | 리드/앱/카탈로그 활용 기준 | 실무 판단 포인트 |',
  '인지도/도달',
  '트래픽/방문 유도',
  '참여/메시지',
  '리드 수집',
  '앱 성장',
  '판매/커머스',
  '리드/앱/카탈로그 빠른 판별',
  '| 모듈 | 선택해야 하는 상황 | 피하는 편이 나은 상황 | 준비 조건 |',
  'SDK/MMP',
  '상품 피드',
  '픽셀/CAPI',
  'Meta 광고 상품은 상품명 목록으로만 보면 부족합니다',
  '캠페인 구조와 목표 잡기',
  '운영 모듈과 측정 붙이기',
  'Meta 광고 정책은 소재 문구만 보는 기준이 아니라',
  "'medical_hospital_landing_review'",
  "'policy_source_guided_medical_hospital_landing_review'",
  '병원/의료 광고',
  '의료법 등 관계 법령',
  '랜딩페이지 표시 정보',
  '전후사진',
  '상담 신청 폼',
  'v51-specific-product-policy-bypass',
  'applyCoverageNoticeToAnswer',
  'shouldUseSourceGuidedAnswerWithPartialCoverage',
  'hasSourceGuidedProductOrPolicyIntent',
  'const coveredRequestedVendors = diagnostics.coveredVendors.filter',
  'partialCoverageSourceGuided',
  'isPolicyReviewCheckQuestion',
  'isPolicyOrRegulatedDomainQuestion',
  'isBroadReviewTroubleshootingQuestion',
  'shouldDeferToPolicyReviewAnswer',
  'shouldDeferToPolicyOrRegulatedDomainAnswer',
  'buildMultiVendorUserDeceptionPolicyAnswer',
  'buildMultiVendorReviewStandardsPolicyAnswer',
  '허위·과장 표현과 랜딩페이지 불일치',
  '| 매체 | 정책·심사에서 먼저 볼 것 | 랜딩페이지 체크 | 운영 판단 |',
  '| 매체 | 심사에서 먼저 볼 것 | 랜딩/목적지 체크 | 운영 점검 |',
  '광고 반려나 심사 이슈는',
  '정책·업종 제한 → 랜딩/목적지 → 소재 표현 → 계정·측정 설정',
  '오디언스 선택 도구로 특정 그룹을 부당하게 포함하거나 제외',
  'COMPASS_DISABLE_FAST_KAKAO_SPECIFIC_PRODUCT_ANSWERS',
  'COMPASS_DISABLE_FAST_KAKAO_STRUCTURED_PRODUCT_ANSWERS',
  'COMPASS_DISABLE_FAST_POLICY_SOURCE_GUIDED_ANSWERS',
  'COMPASS_DISABLE_FAST_NAVER_VIDEO_PRODUCT_ANSWERS',
  'COMPASS_DISABLE_FAST_STRUCTURED_SPECIFIC_PRODUCT_ANSWERS',
  "fastAnswerFallback: 'kakao_specific_product_source_guided'",
  "'policy_source_guided_price_discount'",
  "'policy_source_guided_user_deception'",
  "'policy_source_guided_event_material'",
  "'policy_source_guided_medical_hospital_landing_review'",
  "'policy_source_guided_kakao_restricted_industry'",
  "'policy_source_guided_kakao_service_protection'",
  "'policy_source_guided_youth_harmful'",
  "'policy_source_guided_hate_discrimination'",
  "'policy_source_guided_adult_content'",
  "'policy_source_guided_rights_infringement'",
  "'policy_source_guided_review_standards'",
  "'policy_source_guided_vendor_policy_general'",
  "'kakao_product_structured'",
  "'kakao_product_scope_rescue'",
  "'naver_video_product_structured'",
  "'meta_app_install_structured'",
  "'meta_creative_spec_structured'",
  "'naver_shopping_data_operational'",
  "'google_lead_structured'",
  'compass-answer-fast-kakao-specific-product-source-guided',
  'compass-answer-fast-kakao-product-structured',
  "'compass-answer-fast-naver-video-product-structured'",
  "'compass-answer-fast-meta-creative-spec-structured'",
  "'compass-answer-fast-naver-shopping-data-operational'",
  "'compass-answer-fast-google-lead-structured'",
  'sourceMatchesRequestedProductMode',
  'buildSpecificProductScopeLimitedAnswer',
  "model: 'compass-answer-naver-shopping-data-operational'",
  'Compass specific product answer will use grounded LLM synthesis',
  "'compass-answer-grounded-specific-product-llm'",
  'sourceHasCrossVendorUrl',
  'sourceHasExtractionNoise',
  'sourceIsOfficialProductOverviewSnapshot',
  'googleProductOverviewOfficialChunk',
  'official_product_overview',
  'isOfficialGuideEvidence',
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

if (!/!shouldDeferToPolicyOrRegulatedDomainAnswer[\s\S]*isCommerceProductFeedQuestion\(message, intent\)/.test(answerHandler)) {
  fail('commerce product-feed scenario answers must defer to policy/regulatory-domain questions');
}

if (!/!shouldDeferToPolicyOrRegulatedDomainAnswer[\s\S]*isAcquisitionRetargetingBudgetQuestion\(message, intent\)/.test(answerHandler)) {
  fail('acquisition/retargeting budget scenario answers must defer to policy/regulatory-domain questions');
}

if (!/isBroadReviewTroubleshootingQuestion\(message\)\) return 'review_standards';[\s\S]*return 'price_discount'/.test(answerHandler)) {
  fail('broad rejection/review troubleshooting questions must route to review_standards before price_discount');
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

if (!/COMPASS_ANSWER_RESPONSE_CACHE_KEY_VERSION = 'v51-specific-product-policy-bypass'[\s\S]*`compass-answer:\$\{COMPASS_ANSWER_RESPONSE_CACHE_KEY_VERSION\}:\$\{message\}`/.test(answerHandler)) {
  fail('answer response cache key must be versioned so stale durable cached answers are bypassed after source-quality fixes');
}

if (!/type DeterministicGateClass = 'always' \| 'policy' \| 'product'/.test(answerHandler)
  || !/type DeterministicAnswerScope = 'full' \| 'policy_only' \| 'off'/.test(answerHandler)
  || !/function resolveDeterministicAnswerScope\(\): DeterministicAnswerScope[\s\S]*COMPASS_DETERMINISTIC_ANSWER_SCOPE \|\| 'full'[\s\S]*return value === 'policy_only' \|\| value === 'off' \? value : 'full';/.test(answerHandler)
  || !/function isDeterministicGateEnabled\(gate: DeterministicGateClass\): boolean[\s\S]*if \(gate === 'always'\) return true;[\s\S]*if \(scope === 'full'\) return true;[\s\S]*if \(scope === 'off'\) return false;[\s\S]*return gate === 'policy';/.test(answerHandler)) {
  fail('deterministic answer scope must default to full while allowing policy_only/off scoped gate experiments');
}

if (!/function isPolicyReviewCheckQuestion\([\s\S]*허위\|과장\|오인\|기만\|불일치\|랜딩[\s\S]*const shouldDeferToPolicyReviewAnswer = isPolicyReviewCheckQuestion\(message\)[\s\S]*!shouldDeferToPolicyReviewAnswer && isAssetGuideProductQuestion\(message\)[\s\S]*intent\.vendors\.includes\('NAVER'\)[\s\S]*!shouldDeferToPolicyReviewAnswer[\s\S]*buildNaverKakaoAssetGuideComparisonAnswer\(sources\)/.test(answerHandler)) {
  fail('policy/review checklist questions must bypass product asset-guide deterministic answers');
}

if (!/function buildMultiVendorUserDeceptionPolicyAnswer\([\s\S]*uniqueRequestedVendors\.length < 2[\s\S]*\| 매체 \| 정책·심사에서 먼저 볼 것 \| 랜딩페이지 체크 \| 운영 판단 \|[\s\S]*case 'user_deception':[\s\S]*buildMultiVendorUserDeceptionPolicyAnswer\(sources, intent\)/.test(answerHandler)) {
  fail('multi-vendor deception/review policy questions must produce media-specific checklist answers instead of generic policy blurbs');
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
  if (!relatedQuestionsRoute.includes(snippet)) {
    fail(`related question route missing coverage-aware product recommendation snippet: ${snippet}`);
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
  if (relatedQuestionsRoute.includes(rejected)) {
    fail(`related question route must not fall back to naive chunk/question extraction: ${rejected}`);
  }
}

const defaultRelatedQuestionBlock = relatedQuestionsRoute.match(/const DEFAULT_PRODUCT_GUIDE_QUESTIONS = \[([\s\S]*?)\];/)?.[1] || '';
if (!defaultRelatedQuestionBlock.includes('Meta 광고 상품은 어떤 기준으로 고르면 돼?')
  || !defaultRelatedQuestionBlock.includes('Google Ads 검색광고는 어떤 상황에서 먼저 쓰는 게 좋아?')
  || !defaultRelatedQuestionBlock.includes('네이버 쇼핑검색광고는 어떤 상황에서 쓰는 게 좋아?')
  || !defaultRelatedQuestionBlock.includes('카카오 비즈보드는 어떤 상황에서 쓰는 게 좋아?')) {
  fail('default related product questions must cover all four vendors with product-specific prompts');
}

for (const overBroad of [
  /병원\s*광고를\s*Meta,\s*Google Ads,\s*네이버,\s*카카오/,
  /광고\s*성과가\s*갑자기\s*떨어졌을\s*때\s*Meta,\s*Google Ads,\s*네이버,\s*카카오별/,
  /Google\s*쇼핑,\s*Meta\s*카탈로그,\s*네이버\s*쇼핑검색광고,\s*카카오\s*상품\s*카탈로그/,
  /비즈보드,\s*디스플레이,\s*동영상,\s*상품\s*카탈로그,\s*메시지,\s*키워드광고,\s*브랜드검색,\s*톡채널검색,\s*보장형\/CPT/,
]) {
  if (overBroad.test(relatedQuestionsRoute)) {
    fail('default related questions must not recommend over-broad multi-vendor or multi-product comparison prompts');
  }
}

const kakaoProductSelectionMatrixFastIntentBlock = extractBlock(
  'Kakao product selection matrix preflight intent',
  answerHandler,
  'function isKakaoProductSelectionMatrixFastIntent',
  'function buildPreRetrievalDeterministicProductAnswer',
);
if (!kakaoProductSelectionMatrixFastIntentBlock.includes('const hasKakaoAnchor =')
  || !kakaoProductSelectionMatrixFastIntentBlock.includes('intent.vendors.includes(\'KAKAO\')')
  || !kakaoProductSelectionMatrixFastIntentBlock.includes('const namesExplicitOtherVendor =')
  || !kakaoProductSelectionMatrixFastIntentBlock.includes('^(?:카카오|kakao)')
  || kakaoProductSelectionMatrixFastIntentBlock.includes("intent.vendors.length !== 1 || intent.vendors[0] !== 'KAKAO'")
  || kakaoProductSelectionMatrixFastIntentBlock.includes('|카카오\\s*광고\\s*상품/.test')
  || !kakaoProductSelectionMatrixFastIntentBlock.includes('상품\\s*카탈로그')
  || !kakaoProductSelectionMatrixFastIntentBlock.includes('톡\\s*채널\\s*검색')
  || !kakaoProductSelectionMatrixFastIntentBlock.includes('보장형|cpt')
  || !answerHandler.includes('function buildPreRetrievalDeterministicProductAnswer')
  || !answerHandler.includes('buildKakaoProductSelectionMatrixAnswer([])')
  || !answerHandler.includes('buildNaverKakaoAssetGuideComparisonAnswer([])')
  || !answerHandler.includes('buildCrossVendorProductAssetGuideAnswer([])')
  || !answerHandler.includes('buildMetaGoogleProductAssetGuideAnswer([])')
  || !answerHandler.includes('buildMetaAssetGuideProductAnswer([])')
  || !answerHandler.includes('buildGoogleAssetGuideProductAnswer([])')
  || !/const preRetrievalDeterministicAnswer = isDeterministicGateEnabled\('product'\)[\s\S]*buildPreRetrievalDeterministicProductAnswer\(message, ragIntent\)/.test(answerHandler)
  || !answerHandler.includes('preRetrievalDeterministicAnswer: true')) {
  fail('Kakao named-product matrix questions must use a pre-retrieval deterministic answer before slow RAG fan-out');
}

for (const snippet of [
  'function buildGoogleAssetGuideProductAnswer',
  'compass-answer-deterministic-google-asset-guide-product-matrix',
  'Google Ads 상품과 소재 제작 가이드는',
  '| 유형 | 언제 우선 검토하나 | 소재/애셋에서 먼저 볼 것 | 측정·운영 체크 |',
  '검색=광고문·키워드·랜딩',
  '디스플레이=이미지/로고/문구 애셋',
  'PMax=애셋 그룹+전환 목표',
  '쇼핑=Merchant Center 상품 피드',
  '리드 양식=필드·개인정보·CRM 수신',
  "return buildMetaAssetGuideProductAnswer(sources) ?? buildMetaProductPlanningMatrixAnswer(sources)",
  "return buildGoogleAssetGuideProductAnswer(sources) ?? buildGoogleProductPlanningMatrixAnswer(sources)",
]) {
  if (!answerHandler.includes(snippet)) {
    fail(`Meta/Google asset-guide routing must keep creative-guide-first deterministic coverage: ${snippet}`);
  }
}

if (/VENDOR_TERM_SPECS[\s\S]*\['KAKAO',[^\]]*(?:'상품가이드'|'상품 가이드')/.test(rag)
  || /DIAGNOSTIC_VENDOR_PATTERNS[\s\S]*KAKAO:[^\n]*(?:상품\\s\*가이드|상품가이드)/.test(answerHandler)) {
  fail('generic 상품 가이드 wording must not classify a query as KAKAO vendor intent');
}

if (!/function isLeadKpiFrameworkQuestion[\s\S]*리드\\s\*수\(\?!집\)/.test(answerHandler)) {
  fail('lead KPI intent detection must not treat 리드 수집 as the KPI term 리드 수');
}

if (!/COMPASS_SUPABASE_ROWS_CACHE_KEY_VERSION = 'v2-product-retrieval-paths'[\s\S]*JSON\.stringify\(\{ version: COMPASS_SUPABASE_ROWS_CACHE_KEY_VERSION, kind, \.\.\.normalizedParams \}\)/.test(rag)) {
  fail('durable retrieval row cache key must be versioned so stale product retrieval rows are bypassed after routing fixes');
}

if (!answerHandler.includes('process.env.COMPASS_ANSWER_RESPONSE_CACHE_TTL_MS || 900000')
  || !rag.includes('process.env.COMPASS_SUPABASE_ROWS_CACHE_TTL_MS || 900000')
) {
  fail('answer and Supabase row caches should default to the durable/shared 15 minute TTL window');
}

if (answerHandler.includes('compass-answer:v1:${message}')) {
  fail('answer response cache key must not reuse the old v1 prefix after product source filtering changes');
}

if (!/sourceLooksLikeProductStructureSupportNoise[\s\S]*getSourceIdentityText\(source\)[\s\S]*세금\|tax\|vat\|청구\|결제\|지불[\s\S]*비즈쿠폰\|쿠폰[\s\S]*광고할\\s\*수\\s\*없는\\s\*경우[\s\S]*isUsableBroadProductStructureSource[\s\S]*sourceLooksLikeProductStructureSupportNoise\(source\)/.test(answerHandler)) {
  fail('broad product source selection must reject tax/coupon/support-noise documents before answer source selection');
}

if (!/sourceLooksLikeMetaBroadProductNewsNoise[\s\S]*facebook\\\.com\\\/business\\\/news[\s\S]*성과\\s\*증대[\s\S]*크리에이티브\\s\*다각화[\s\S]*creative\\s\*diversification[\s\S]*manus[\s\S]*cyber\\s\*5[\s\S]*creator\\s\*method[\s\S]*hasBroadOverviewStructure[\s\S]*isUsableBroadProductStructureSource[\s\S]*targetVendor === 'META' && sourceLooksLikeMetaBroadProductNewsNoise\(source\)/.test(answerHandler)) {
  fail('Meta broad product source selection must reject business/news success-story sources before answer source selection');
}

const fallbackSourceRejectsBlockingNoise = /findFallbackSource(?:CandidateIndexes|Index)[\s\S]*!sourceHasBlockingExtractionNoise\(source\)/.test(answerHandler);

if (!answerHandler.includes('sourceHasRecoverableMetaAdsGuideObjectiveGraphEvidence')
  || !answerHandler.includes('facebook\\.com\\/business\\/ads-guide')
  || !answerHandler.includes('campaign[_\\s-]*objective')
  || !answerHandler.includes('sourceHasBlockingExtractionNoise')
  || !fallbackSourceRejectsBlockingNoise
  || !/selectProductStructureResponseSources[\s\S]*!sourceHasBlockingExtractionNoise\(source\)/.test(answerHandler)
) {
  fail('Meta Ads Guide objective graph evidence must survive HTML extraction-noise filtering for broad product answers');
}

if (!/function normalizeMetaAdsGuideSourceTitle[\s\S]*app-installs[\s\S]*앱 홍보[\s\S]*audience-network-native[\s\S]*Audience Network 네이티브/.test(answerHandler)) {
  fail('Meta Ads Guide graph source titles should be normalized into user-facing objective and placement labels');
}

if (!/graphSourceLooksLikeBroadBusinessNewsTitle[\s\S]*크리에이티브\\s\*다각화[\s\S]*creative\\s\*diversification/.test(answerHandler)
  || !/calculateProductStructureGraphTitleAdjustment[\s\S]*hasBroadNewsTitle[\s\S]*크리에이티브\\s\*다각화[\s\S]*creative\\s\*diversification/.test(rag)
) {
  fail('Meta broad product graph ranking must treat creative-diversification business/news titles as low-value sources');
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

if (!/isMetaBroadProductNewsNoiseText[\s\S]*facebook\\\.com\\\/business\\\/news[\s\S]*성과\\s\*증대[\s\S]*크리에이티브\\s\*다각화[\s\S]*creative\\s\*diversification[\s\S]*manus[\s\S]*cyber\\s\*5[\s\S]*creator\\s\*method[\s\S]*hasMetaObjectiveProductStructureSignal/.test(rag)
  || !/searchMetaProductOverviewPriorityCandidates[\s\S]*isMetaBroadProductNewsNoiseText\(sourceText\)[\s\S]*return null[\s\S]*queryWantsFormatPlacement[\s\S]*hasFormatPlacementSignal && !hasLevelStructureSignal && !hasObjectiveSignal && !hasCommerceSignal && !queryWantsFormatPlacement[\s\S]*return null/.test(rag)
) {
  fail('Meta overview priority retrieval must reject business/news and format-only sources before boosting them');
}

const metaAppInstallIntentBlock = extractBlock(
  'Meta app install intent',
  rag,
  'private isMetaAppInstallIntent',
  'private hasMetaAppInstallSignal',
);
if (metaAppInstallIntentBlock.includes('intent.isProductStructureOverview && !intent.isSpecificProductGuidance')) {
  fail('Meta app install intent must include app-install product overview questions so the priority path can run');
}
if (metaAppInstallIntentBlock.includes('...intent.keywords')) {
  fail('Meta app install intent must not inspect expanded keywords because they make every Meta product overview look app-install focused');
}

if (!/calculateProductStructureGraphTitleAdjustment[\s\S]*hasMetaBusinessNewsUrl[\s\S]*meta_product_structure_news_url_penalty[\s\S]*isLowValueProductStructureGraphCandidate[\s\S]*intent\.vendors\[0\] === 'META'[\s\S]*isMetaBroadProductNewsNoiseText\(sourceText\)/.test(rag)) {
  fail('Meta product-structure GraphRAG selection must penalize and reject weak business/news graph sources');
}

if (!/mergeDedupeAndRankCandidates[\s\S]*isEvidenceGraphCandidate\(candidate\)[\s\S]*isOfficialGraphCandidate\(candidate\)[\s\S]*isLowValueProductStructureGraphCandidate\(candidate, intent\)[\s\S]*continue/.test(rag)
  || !/ensureGraphEvidenceCoverage[\s\S]*isOfficialGraphCandidate\(candidate\)[\s\S]*!this\.isLowValueProductStructureGraphCandidate\(candidate, intent\)/.test(rag)
) {
  fail('product-structure ranking must drop low-value official graph candidates before merge and coverage rescue');
}

if (!/isLowValueProductStructureGraphCandidate[\s\S]*isMetaAppInstallIntent\(intent\)[\s\S]*facebook\\\.com\\\/business\\\/news\|\\\/business\\\/news\|business\\\/news[\s\S]*return true/.test(rag)) {
  fail('Meta app-install product questions must reject Meta business/news graph sources before coverage promotion');
}

if (!/const sourceGuidedBroadProductSources = answerSources\.filter[\s\S]*sourceLooksLikeProductStructureSupportNoise\(source\)[\s\S]*buildLlmFailureGroundedFallbackAnswer\([\s\S]*sourceGuidedBroadProductSources[\s\S]*sources: sourceGuidedBroadProductSources[\s\S]*answerSourceCount: sourceGuidedBroadProductSources\.length/.test(answerHandler)) {
  fail('fast broad product source-guided fallback must use support-noise-filtered sources');
}

if (!/const productStructureSources = selectProductStructureResponseSources\(sources, ragIntent, message\)[\s\S]*\.filter\(source => sourceIsOfficialProductOverviewSnapshot\(source, ragIntent\.vendors\[0\]\) \|\| !sourceLooksLikeProductStructureSupportNoise\(source\)\)[\s\S]*if \(productStructureSources\.length === 0\)/.test(answerHandler)) {
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

if (!/productStructureRetrievalIntent[\s\S]*Math\.max\(limit,\s*intent\.vendors\.length \* 4,\s*productStructureRetrievalIntent \? 18 : 8\)/.test(rag)) {
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

if (!/private shouldApplyStrictMetadataVendorFilter\([\s\S]*tableName === 'ollama_document_chunks' \|\| getCompassSearchSource\(\) !== 'document_chunks'/.test(rag)) {
  fail('document_chunks mode must relax strict metadata vendor filters while preserving ollama/default filtering');
}

if (!/if \(vendor && this\.shouldApplyStrictMetadataVendorFilter\(tableName\)\) \{[\s\S]*request = request\.eq\('metadata->>source_vendor', vendor\);[\s\S]*\}/.test(rag)) {
  fail('keyword table search must apply vendor metadata filtering unless document_chunks mode deliberately relaxes it');
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

const metaAppInstallPriorityBlock = extractBlock(
  'Meta app install priority retrieval',
  rag,
  'private async searchMetaAppInstallPriorityCandidates',
  'private async searchMetaProductOverviewPriorityCandidates',
);
if (!/const priorityAnchors = anchors\.slice\(0, 12\)[\s\S]*searchKeywordTable\('document_chunks', priorityAnchors, 16[\s\S]*searchKeywordTable\('ollama_document_chunks', priorityAnchors, 6[\s\S]*searchVendorMetadataTable\('ollama_document_chunks', 'META', priorityAnchors, 4[\s\S]*Promise\.all\(\['MMP', 'Facebook SDK'\]\.map\(anchor =>[\s\S]*searchProductStructureAnchorTable\('document_chunks', anchor, 4/.test(metaAppInstallPriorityBlock)) {
  fail('Meta app-install priority retrieval must use bounded batch keyword/metadata queries plus bounded parallel setup anchors instead of sequential per-anchor Supabase fan-out');
}

if (!/searchKnownOfficialDocumentChunks\([\s\S]*META_APP_INSTALL_OFFICIAL_CHUNK_IDS[\s\S]*'meta_app_install_official_chunk'[\s\S]*normalizeMetaAppInstallPriorityResults\(officialChunkResults[\s\S]*officialCandidates\.length > 0/.test(metaAppInstallPriorityBlock)) {
  fail('Meta app-install priority retrieval must try known official chunk lookup before broad keyword fan-out');
}

if (!/private getKeywordTableFetchLimit[\s\S]*isMetaAppInstallIntent\(intent\)[\s\S]*Math\.min\(Math\.max\(limit, 12\), 28\)[\s\S]*intent\.isSpecificProductGuidance[\s\S]*isKakaoBizboardDisplayProductIntent\(intent\)[\s\S]*Math\.min\(Math\.max\(limit \+ 4, 8\), 16\)/.test(rag)
  || !/private getVendorMetadataFetchLimit[\s\S]*isMetaAppInstallIntent\(intent\)[\s\S]*Math\.min\(Math\.max\(limit, 8\), 18\)[\s\S]*intent\.isSpecificProductGuidance[\s\S]*isKakaoBizboardDisplayProductIntent\(intent\)[\s\S]*Math\.min\(Math\.max\(limit \+ 4, 8\), 18\)/.test(rag)
  || !/private getProductStructureAnchorFetchLimit[\s\S]*isMetaAppInstallIntent\(intent\)[\s\S]*Math\.min\(Math\.max\(limit, 8\), 16\)[\s\S]*intent\.isSpecificProductGuidance[\s\S]*isKakaoBizboardDisplayProductIntent\(intent\)[\s\S]*Math\.min\(Math\.max\(limit \+ 3, 8\), 16\)/.test(rag)) {
  fail('Meta app-install and KAKAO specific product direct paths must not inflate small direct-path limits back into broad batch fetches');
}

if (/for \(const anchor of anchors\)/.test(metaAppInstallPriorityBlock)) {
  fail('Meta app-install priority retrieval must not use sequential per-anchor Supabase fan-out');
}

if (!/const usesMetaProductOverviewPriority[\s\S]*!usesMetaAppInstallPriority[\s\S]*const usesKakaoProductPriority/.test(rag)) {
  fail('Meta app-install product questions must skip duplicate Meta overview priority retrieval');
}

if (!/usesVendorProductStructurePriority[\s\S]*usesMetaProductOverviewPriority[\s\S]*usesMetaAppInstallPriority[\s\S]*usesKakaoProductPriority/.test(rag)) {
  fail('Meta app-install priority retrieval must skip generic product-structure anchor fan-out');
}

if (/skipsGraphForGoogleProductOverview\s*\n\s*\|\| usesMetaAppInstallPriority[\s\S]*Promise\.resolve\(\[\]\)[\s\S]*product_fast_graph/.test(rag)) {
  fail('Meta app-install product fast path must not skip official graph retrieval because app-install ads-guide assertions can ground the answer');
}

if (!/getKakaoProductGraphSoftBudgetMs[\s\S]*COMPASS_KAKAO_PRODUCT_GRAPH_SOFT_BUDGET_MS[\s\S]*usesKakaoProductPriority[\s\S]*withRetrievalChannelSoftBudget[\s\S]*product_fast_graph[\s\S]*getKakaoProductGraphSoftBudgetMs\(\)/.test(rag)) {
  fail('KAKAO product fast graph retrieval must use a non-blocking soft budget');
}

if (!/usesKakaoInternalProductComparison[\s\S]*isKakaoBizboardDisplayComparisonIntent\(intent\)[\s\S]*withRetrievalChannelSoftBudget[\s\S]*hybrid_graph[\s\S]*getKakaoProductGraphSoftBudgetMs\(\)/.test(rag)) {
  fail('KAKAO internal Bizboard/display comparison retrieval must not block on hybrid graph completion');
}

if (!/private isKakaoBizboardDisplayComparisonIntent\([\s\S]*intent\.isComparative[\s\S]*intent\.vendors\.length !== 1[\s\S]*mentionsBizboard[\s\S]*mentionsDisplay[\s\S]*return mentionsBizboard && mentionsDisplay/.test(rag)) {
  fail('KAKAO internal comparison soft-budget routing must stay scoped to Bizboard vs display comparison questions');
}

if (!/metaAppInstallPriorityCandidates,[\s\S]*graphCandidates[\s\S]*usesMetaAppInstallPriority[\s\S]*searchMetaAppInstallPriorityCandidates[\s\S]*product_fast_graph/.test(rag)) {
  fail('Meta app-install product priority must keep its exact priority path while allowing official graph evidence');
}

if (!/private async searchMetaCreativeSpecPriorityCandidates[\s\S]*searchKnownOfficialDocumentChunks\([\s\S]*getMetaCreativeSpecOfficialChunkIds\(queryText\)[\s\S]*'meta_creative_spec_official_chunk'[\s\S]*normalizeMetaCreativeSpecPriorityResults\(officialChunkResults[\s\S]*officialCandidates\.length > 0/.test(rag)
  || !/private getMetaCreativeSpecOfficialChunkIds[\s\S]*META_CREATIVE_SPEC_OFFICIAL_CHUNK_IDS[\s\S]*카루셀[\s\S]*동영상[\s\S]*이미지/.test(rag)) {
  fail('Meta creative/spec priority retrieval must try known official ads-guide chunks before anchor fan-out');
}

if (!/if \(usesMetaCreativeSpecPriority && \(usesSpecificProductRetrieval \|\| intent\.topics\.includes\('spec'\)\)\)[\s\S]*specific_meta_creative_spec_priority_direct[\s\S]*if \(rankedResults\.length > 0\)[\s\S]*return this\.withRetrievalTimeoutMetadata\(rankedResults, timedOutChannels, channelTimings\);[\s\S]*meta_creative_spec_priority_rescue[\s\S]*META creative spec priority candidates were rescued[\s\S]*return this\.withRetrievalTimeoutMetadata\(rescueResults, timedOutChannels, channelTimings\);/.test(rag)) {
  fail('Meta creative/spec direct retrieval must rescue official candidates when strict ranking filters them all');
}

if (!/const usesGoogleLeadFormPriority =[\s\S]*this\.isGoogleLeadFormIntent\(intent\)/.test(rag)
  || !/usesPrioritySpecificProductRetrieval =[\s\S]*usesGoogleLeadFormPriority/.test(rag)
  || !/if \(usesGoogleLeadFormPriority && usesSpecificProductRetrieval\) \{[\s\S]*this\.searchGoogleLeadFormPriorityCandidates\(intent\)[\s\S]*'specific_google_lead_form_priority_direct'[\s\S]*return this\.withRetrievalTimeoutMetadata\(rankedResults, timedOutChannels, channelTimings\);[\s\S]*\n\s*\}\n\s*\}\n\s*\n\s*if \(usesKakaoProductPriority && usesSpecificProductRetrieval\)/.test(rag)) {
  fail('Google lead-form specific product retrieval must use a bounded priority direct path before embedding/vector/graph fan-out');
}

if (!/private async searchGoogleLeadFormPriorityCandidates[\s\S]*searchKnownOfficialDocumentChunks\([\s\S]*GOOGLE_LEAD_FORM_OFFICIAL_CHUNK_IDS[\s\S]*'google_lead_form_official_chunk'[\s\S]*normalizeGoogleLeadFormPriorityResults\(officialChunkResults[\s\S]*officialCandidates\.length > 0/.test(rag)) {
  fail('Google lead-form priority retrieval must try known official chunks before keyword/vendor fan-out');
}

if (!/googleLeadFormPriorityCandidates,\s*\n\s*kakaoProductPriorityCandidates,\s*\n\s*graphCandidates/.test(rag)
  || !/usesGoogleLeadFormPriority\s*\?\s*this\.withRetrievalChannelTimeout\(this\.searchGoogleLeadFormPriorityCandidates\(intent\), 'hybrid_google_lead_form_priority'/.test(rag)
  || !/googleLeadFormPriority=\$\{googleLeadFormPriorityCandidates\.length\}/.test(rag)
  || !/\.\.\.googleLeadFormPriorityCandidates/.test(rag)) {
  fail('Google lead-form hybrid fallback must keep the bounded priority candidates and avoid product-structure anchor fan-out');
}

if (!/const usesFastPolicySourcePriority = this\.isFastPolicySourceGuidedPriorityIntent\(intent\)[\s\S]*if \(usesFastPolicySourcePriority && !usesPrioritySpecificProductRetrieval\)[\s\S]*fast_policy_keyword_direct[\s\S]*selectFastPolicySourceGuidedPriorityCandidates\(fastPolicyCandidates, intent\)[\s\S]*return this\.withRetrievalTimeoutMetadata\(rankedResults, timedOutChannels, channelTimings\);[\s\S]*focusedPolicyCandidates\.length > 0[\s\S]*Fast policy source priority candidates were rescued[\s\S]*return this\.withRetrievalTimeoutMetadata\(rescueResults, timedOutChannels, channelTimings\);[\s\S]*const queryEmbeddingResult = await this\.embeddingService\.generateEmbedding\(query\)/.test(rag)) {
  fail('fast policy source-guided retrieval must try bounded keyword/service priority before vector/graph fan-out');
}

if (!/private getFastPolicySourceGuidedPriorityPattern\([\s\S]*isKakaoServiceProtectionPolicyIntent\(intent\)[\s\S]*업종[\s\S]*제한[\s\S]*오인[\s\S]*기만[\s\S]*가격[\s\S]*할인[\s\S]*이벤트[\s\S]*경품[\s\S]*private isFastPolicySourceGuidedPriorityIntent/.test(rag)
  || !/private selectFastPolicySourceGuidedPriorityCandidates\([\s\S]*fast_policy_source_priority[\s\S]*fast_policy_source_priority_match/.test(rag)) {
  fail('fast policy source-guided retrieval must keep query-family and source-evidence filters');
}

const kakaoSpecificFastPathBlock = extractBlock(
  'KAKAO specific product fast path',
  rag,
  'const specificKakaoFastPathAnchors = [',
  'const [\n      documentChunkResults,',
);
if (!/specificKakaoFastPathAnchors[\s\S]*'비즈보드'[\s\S]*'카카오 비즈보드'[\s\S]*'디스플레이 광고'[\s\S]*usesSpecificKakaoOllamaFastPath[\s\S]*const requiresKakaoBizboardEvidence = this\.requiresKakaoBizboardEvidence\(intent\)[\s\S]*const hasRequiredKakaoFastPathEvidence = \(candidate: SearchResult\): boolean =>[\s\S]*this\.hasKakaoBizboardDisplayExactSignal\(evidenceText\)[\s\S]*!requiresKakaoBizboardEvidence \|\| this\.hasKakaoBizboardProductSignal\(evidenceText\)[\s\S]*Promise\.all\(\[[\s\S]*searchKeywordTable\('document_chunks', specificKakaoFastPathAnchors, 8, intent\)[\s\S]*searchKeywordTable\('ollama_document_chunks', specificKakaoFastPathAnchors, 5, intent, 'KAKAO'\)[\s\S]*keywordFastCandidates\.some\(hasRequiredKakaoFastPathEvidence\)[\s\S]*return keywordFastCandidates[\s\S]*exactFastAnchorResults[\s\S]*searchProductStructureAnchorTable\('document_chunks', anchor, 5, undefined, intent\)[\s\S]*anchorFastCandidates\.some\(hasRequiredKakaoFastPathEvidence\)/.test(kakaoSpecificFastPathBlock)) {
  fail('KAKAO specific product retrieval must try narrow keyword paths first, but Bizboard questions must require actual Bizboard evidence before returning');
}

if (!/usesKakaoServiceProtectionAssetIntent[\s\S]*KAKAO_SERVICE_PROTECTION_OFFICIAL_CHUNK_IDS[\s\S]*'kakao_service_protection_official_chunk'[\s\S]*hasKakaoServiceProtectionPolicySignal/.test(kakaoSpecificFastPathBlock)) {
  fail('KAKAO service/logo protection product questions must use the known official chunk before keyword fan-out');
}

const kakaoExactSignalBlock = extractBlock(
  'KAKAO exact Bizboard/display signal',
  rag,
  'private hasKakaoBizboardDisplayExactSignal',
  'private isKakaoServiceProtectionPolicyIntent',
);
if (/\/content-guide/.test(kakaoExactSignalBlock) || /카카오모먼트/.test(kakaoExactSignalBlock)) {
  fail('KAKAO exact Bizboard/display signal must not treat generic content-guide URLs or bare 카카오모먼트 as exact product evidence');
}

if (!/private requiresKakaoBizboardEvidence\([\s\S]*비즈보드[\s\S]*톡보드[\s\S]*talkboard/.test(rag)
  || !/private hasKakaoBizboardProductSignal\([\s\S]*\/talkboard\(\?:\\\/\|\$\)[\s\S]*비즈보드[\s\S]*talkboard/.test(rag)) {
  fail('KAKAO Bizboard fast path must keep explicit query and source evidence helpers');
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

if (!/const usesNaverProductStructurePriority =[\s\S]*isNaverShoppingDataIntent\(intent\)[\s\S]*isNaverShoppingSearchCreativeIntent\(intent\)[\s\S]*isNaverDisplayAdIntent\(intent\)[\s\S]*intent\.isProductStructureOverview/.test(rag)) {
  fail('NAVER shopping creative product questions must use priority direct retrieval before hybrid vector fan-out');
}

if (!/NAVER_SHOPPING_DATA_OFFICIAL_CHUNK_IDS[\s\S]*if \(usesShoppingDataIntent\) \{[\s\S]*searchKnownOfficialDocumentChunks\([\s\S]*NAVER_SHOPPING_DATA_OFFICIAL_CHUNK_IDS[\s\S]*'naver_shopping_data_official_chunk'[\s\S]*return officialChunkCandidates;[\s\S]*if \(usesShoppingSearchCreativeIntent\)/.test(rag)) {
  fail('NAVER shopping DB URL/product-registration questions must try known official chunks before keyword fan-out');
}

if (!/NAVER_SHOPPING_SEARCH_CREATIVE_OFFICIAL_CHUNK_IDS[\s\S]*if \(usesShoppingSearchCreativeIntent\) \{[\s\S]*searchKnownOfficialDocumentChunks\([\s\S]*NAVER_SHOPPING_SEARCH_CREATIVE_OFFICIAL_CHUNK_IDS[\s\S]*'naver_shopping_search_creative_official_chunk'[\s\S]*return officialChunkCandidates;[\s\S]*if \(usesDisplayAdIntent\)/.test(rag)) {
  fail('NAVER shopping search creative questions must try known official chunks before keyword fan-out');
}

if (!/NAVER_DISPLAY_AD_OFFICIAL_CHUNK_IDS[\s\S]*if \(usesDisplayAdIntent\) \{[\s\S]*searchKnownOfficialDocumentChunks\([\s\S]*NAVER_DISPLAY_AD_OFFICIAL_CHUNK_IDS[\s\S]*'naver_display_ad_official_chunk'[\s\S]*return officialChunkCandidates;[\s\S]*if \(usesVideoProductIntent\)/.test(rag)) {
  fail('NAVER DA/display questions must try known display chunks before broad keyword fan-out');
}

if (!/const shoppingSearchCreativeAnchors = \[[\s\S]*'쇼핑검색광고'[\s\S]*'대표이미지'[\s\S]*'광고등록기준'/.test(rag)
  || !/usesShoppingSearchCreativeIntent[\s\S]*hasNaverShoppingSearchCreativeGuideSignal\(sourceText\)/.test(rag)) {
  fail('NAVER shopping creative priority retrieval must stay narrowly anchored and evidence-gated');
}

if (!/function isNaverShoppingCreativeSpecificProductQuestion[\s\S]*쇼핑검색[\s\S]*소재[\s\S]*getSpecificProductSupplementLimit[\s\S]*isNaverShoppingCreativeSpecificProductQuestion\(message\)/.test(answerHandler)) {
  fail('NAVER shopping creative structured answers must not launch slow supplement fan-out');
}

if (!/isNaverVideoProductIntent\(intent\)[\s\S]*specific_naver_priority_direct[\s\S]*private hasNaverVideoProductGuideSignal[\s\S]*동영상/.test(rag)) {
  fail('NAVER video product questions must use narrow direct priority retrieval before hybrid vector fan-out');
}

if (!/getKeywordTableFetchLimit[\s\S]*isNaverVideoProductIntent\(intent\)[\s\S]*Math\.min\(Math\.max\(limit,\s*8\),\s*18\)/.test(rag)
  || !/const documentKeywordLimit = usesVideoProductIntent \? 8 : 14/.test(rag)
  || !/metadataKeywordLimit > 0[\s\S]*searchVendorMetadataTable[\s\S]*Promise\.resolve\(\[\]\)/.test(rag)) {
  fail('NAVER video product direct retrieval must keep keyword fetch limits tight and skip metadata fan-out');
}

if (!/function isNaverVideoSpecificProductQuestion[\s\S]*동영상[\s\S]*getSpecificProductSupplementLimit[\s\S]*isNaverVideoSpecificProductQuestion\(message\)/.test(answerHandler)) {
  fail('NAVER video structured answers must not launch slow supplement fan-out');
}

if (!answerHandler.includes("'Meta 비즈니스 지원 센터: 카탈로그/컬렉션 광고'")) {
  fail('Meta catalog/collection sources must expose the Korean catalog term for source verification');
}

if (!/const usesMetaCatalogPriority =[\s\S]*isMetaCatalogIntent\(intent\)/.test(rag)
  || !/specific_meta_catalog_priority_direct/.test(rag)
  || !/private async searchMetaCatalogPriorityCandidates[\s\S]*hasMetaCatalogSignal\(sourceText\)/.test(rag)) {
  fail('Meta catalog product questions must use narrow direct priority retrieval before hybrid anchor fan-out');
}

const metaCatalogPriorityBlock = extractBlock(
  'Meta catalog priority retrieval',
  rag,
  'private async searchMetaCatalogPriorityCandidates',
  'private async searchMetaProductOverviewPriorityCandidates',
);
if (!/searchKnownOfficialDocumentChunks\([\s\S]*META_CATALOG_OFFICIAL_CHUNK_IDS[\s\S]*'meta_catalog_official_chunk'[\s\S]*normalizeMetaCatalogPriorityResults\(officialChunkResults[\s\S]*officialCandidates\.length > 0/.test(metaCatalogPriorityBlock)) {
  fail('Meta catalog priority retrieval must try known official chunk lookup before broad keyword fan-out');
}

if (!/function isMetaCatalogSpecificProductQuestion[\s\S]*카탈로그[\s\S]*getSpecificProductSupplementLimit[\s\S]*isMetaCatalogSpecificProductQuestion\(message\)/.test(answerHandler)) {
  fail('Meta catalog structured answers must not launch slow supplement fan-out');
}

if (!/meta_catalog_structured/.test(answerHandler)
  || !/function buildMetaCatalogStructuredFallbackAnswer[\s\S]*addFallbackLine[\s\S]*카탈로그[\s\S]*컬렉션/.test(answerHandler)) {
  fail('Meta catalog product questions must have a fast structured answer path');
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

if (!/function isGoogleLeadFormSpecificProductQuestion\(message: string\)[\s\S]*lead\\s\*\(form\|generation\|gen\|ads\?\)/.test(answerHandler)
  || !/function getSpecificProductSupplementLimit\(vendor\?: VendorIntent,\s*message = ''\)[\s\S]*vendor === 'KAKAO' && isKakaoDisplaySpecificProductQuestion\(message\)[\s\S]*return 0;[\s\S]*vendor === 'NAVER' && isNaverDisplaySpecificProductQuestion\(message\)[\s\S]*return 0;[\s\S]*vendor === 'META' && isMetaAppInstallSpecificProductQuestion\(message\)[\s\S]*return 0;[\s\S]*vendor === 'GOOGLE' && isGoogleLeadFormSpecificProductQuestion\(message\)[\s\S]*return 0;[\s\S]*return vendor === 'KAKAO' \? 1 : 2;/.test(answerHandler)) {
  fail('specific product supplement fan-out must skip duplicate direct-path supplements for Kakao display, Naver DA, Meta app-install, and Google lead-form product questions');
}

if (!/function isMetaCreativeSpecSpecificProductQuestion\(message: string\)[\s\S]*카루셀[\s\S]*인스타그램/.test(answerHandler)
  || !/function getSpecificProductSupplementLimit\(vendor\?: VendorIntent,\s*message = ''\)[\s\S]*vendor === 'META' && isMetaCreativeSpecSpecificProductQuestion\(message\)[\s\S]*return 0;/.test(answerHandler)) {
  fail('specific product supplement fan-out must skip duplicate direct-path supplements for Meta creative/spec product questions');
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

if (!/function buildContextualCompassProductQuestion\([\s\S]*hasCurrentNamedProduct[\s\S]*currentVendors\.length > 0 \|\| hasCurrentNamedProduct/.test(answerHandler)) {
  fail('contextual product follow-up rewriting must not broaden named single-product questions');
}

if (!/function isSingleNamedKakaoProductQuestion\([\s\S]*productSignals[\s\S]*productSignals\.filter\(Boolean\)\.length <= 1[\s\S]*!isMultiProductMatrixQuestionText\(normalized\)/.test(answerHandler)
  || !/function isKakaoProductSelectionMatrixFastIntent\([\s\S]*if \(isSingleNamedKakaoProductQuestion\(message\)\) return false;[\s\S]*return signalCount >= 2/.test(answerHandler)
  || !/function buildOperationalScenarioDeterministicAnswer\([\s\S]*!isSingleNamedKakaoProductQuestion\(message\)[\s\S]*buildKakaoProductSelectionMatrixAnswer\(sources\)/.test(answerHandler)) {
  fail('Kakao product matrix fast path must not capture a single named Bizboard-style product question');
}

if (!/function isSingleNamedNaverProductQuestion\([\s\S]*productSignals[\s\S]*productSignals\.filter\(Boolean\)\.length <= 1[\s\S]*파워링크\.\*쇼핑검색/.test(answerHandler)
  || !/function buildOperationalScenarioDeterministicAnswer\([\s\S]*!isSingleNamedNaverProductQuestion\(message\)[\s\S]*buildNaverSearchAdProductComparisonAnswer\(sources\)/.test(answerHandler)) {
  fail('Naver product matrix path must not capture a single named Shopping Search-style product question');
}

if (!/const fastKakaoSpecificProductAnswer = isDeterministicGateEnabled\('product'\)[\s\S]*buildFastKakaoSpecificProductAnswer\([\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastKakaoSpecificProductAnswer\.fastAnswerFallback/.test(answerHandler)) {
  fail('Kakao specific product fast answer must expose zero answer-generation duration and fast-answer diagnostics');
}

if (!/function buildFastKakaoProductStructuredAnswer\([\s\S]*COMPASS_DISABLE_FAST_KAKAO_STRUCTURED_PRODUCT_ANSWERS[\s\S]*intent\.vendors\.length !== 1 \|\| intent\.vendors\[0\] !== 'KAKAO'[\s\S]*buildKakaoProductStructuredFallbackAnswer\(candidateSources, intent\)[\s\S]*fastAnswerFallback/.test(answerHandler)) {
  fail('Kakao structured product fast answer must stay gated to single-vendor Kakao evidence and reuse the official-source structured fallback before LLM');
}

if (!/const fastKakaoScopeRescueAnswer = isDeterministicGateEnabled\('product'\)[\s\S]*buildFastKakaoProductStructuredAnswer\([\s\S]*compass-answer-fast-kakao-product-structured-scope-rescue[\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastKakaoScopeRescueAnswer\.fastAnswerFallback[\s\S]*const scopeLimitedAnswer/.test(answerHandler)) {
  fail('Kakao scope-limited product answers must try structured official-source rescue before returning no-data');
}

if (!/const fastStructuredScopeRescueAnswer = isDeterministicGateEnabled\('product'\)[\s\S]*buildFastStructuredSpecificProductAnswer\([\s\S]*specificProductScope,[\s\S]*sources,[\s\S]*fastAnswerFallback: fastStructuredScopeRescueAnswer\.fastAnswerFallback[\s\S]*scopeRescue: true,[\s\S]*const scopeLimitedAnswer/.test(answerHandler)) {
  fail('single-vendor structured product answers must try fast official-source scope rescue before returning no-data');
}

if (!/const fastKakaoStructuredProductAnswer = buildFastKakaoProductStructuredAnswer\([\s\S]*answerSources\.length > 0 \? answerSources : sources[\s\S]*compass-answer-fast-kakao-product-structured[\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastKakaoStructuredProductAnswer\.fastAnswerFallback[\s\S]*Compass specific product answer will use grounded LLM synthesis/.test(answerHandler)) {
  fail('Kakao single-vendor specific/comparison product answers must try structured fast answers before grounded LLM synthesis');
}

if (!/function buildFastNaverVideoProductAnswer\([\s\S]*COMPASS_DISABLE_FAST_NAVER_VIDEO_PRODUCT_ANSWERS[\s\S]*intent\.vendors\.length !== 1 \|\| intent\.vendors\[0\] !== 'NAVER' \|\| intent\.isComparative[\s\S]*buildNaverVideoStructuredFallbackAnswer\(answerSources, intent, message\)[\s\S]*fastAnswerFallback: 'naver_video_product_structured'/.test(answerHandler)) {
  fail('Naver video product fast answer must stay gated to single-vendor Naver video questions and reuse official-source structured fallback');
}

if (!/const fastNaverVideoProductAnswer = isDeterministicGateEnabled\('product'\)[\s\S]*buildFastNaverVideoProductAnswer\([\s\S]*answerSources\.length > 0 \? answerSources : sources[\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastNaverVideoProductAnswer\.fastAnswerFallback[\s\S]*Compass specific product answer will use grounded LLM synthesis/.test(answerHandler)) {
  fail('Naver video product fast answer must run before grounded LLM synthesis and expose zero answer-generation diagnostics');
}

if (!/function buildFastStructuredSpecificProductAnswer\([\s\S]*COMPASS_DISABLE_FAST_STRUCTURED_SPECIFIC_PRODUCT_ANSWERS[\s\S]*intent\.vendors\.length !== 1 \|\| intent\.isComparative[\s\S]*buildNaverShoppingDataOperationalAnswer\(message, answerSources\)[\s\S]*buildGoogleLeadStructuredFallbackAnswer\(answerSources, intent, message\)[\s\S]*fastAnswerFallback: builder\.fastAnswerFallback/.test(answerHandler)) {
  fail('structured specific product fast answer must stay single-vendor gated and reuse existing official-source structured builders');
}

if (!/function buildMetaCreativeSpecStructuredFallbackAnswer[\s\S]*detectProductAnswerFamily\(message, intent\) !== 'meta_creative_spec'[\s\S]*addFallbackLine[\s\S]*이미지[\s\S]*addFallbackLine[\s\S]*동영상[\s\S]*addFallbackLine[\s\S]*슬라이드/.test(answerHandler)) {
  fail('Meta creative/spec product questions must have a fast structured answer path');
}

if (!/const fastStructuredSpecificProductAnswer = isDeterministicGateEnabled\('product'\)[\s\S]*buildFastStructuredSpecificProductAnswer\([\s\S]*answerSources\.length > 0 \? answerSources : sources[\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastStructuredSpecificProductAnswer\.fastAnswerFallback[\s\S]*Compass specific product answer will use grounded LLM synthesis/.test(answerHandler)) {
  fail('structured specific product fast answer must run before grounded LLM synthesis and expose zero answer-generation diagnostics');
}

if (!/function buildFastPolicySourceGuidedAnswer\([\s\S]*COMPASS_DISABLE_FAST_POLICY_SOURCE_GUIDED_ANSWERS[\s\S]*if \(isBroadProductStructureLlmIntent\) return null;[\s\S]*detectFastPolicySourceGuidedAnswerFamily\(message, intent\)[\s\S]*const pattern = getFastPolicySourcePattern\(family\)[\s\S]*getFallbackSourceText\(source\)[\s\S]*if \(!pattern\.test\(sourceText\)\) return false;[\s\S]*sourceHasBlockingExtractionNoise\(source\)[\s\S]*buildFastPolicyAnswerText\(family, candidateSources, intent\)/.test(answerHandler)) {
  fail('fast policy source-guided answers must stay narrowly gated and require matching verified source evidence');
}

if (!/function shouldBypassFastPolicySourceGuidedForSpecificProductQuestion\([\s\S]*intent\.topics\.includes\('product_structure'\)[\s\S]*hasNamedSpecificProductQuestion\(message\)[\s\S]*isPolicyReviewCheckQuestion\(message\)[\s\S]*hasExplicitPolicyReviewSignal[\s\S]*hasPolicyFamilySignal[\s\S]*connectsPolicyFamilyToReview[\s\S]*return true;[\s\S]*function getFastPolicySourcePattern/.test(answerHandler)
  || !/function buildFastPolicySourceGuidedAnswer\([\s\S]*if \(shouldBypassFastPolicySourceGuidedForSpecificProductQuestion\(message, intent\)\) return null;[\s\S]*detectFastPolicySourceGuidedAnswerFamily\(message, intent\)/.test(answerHandler)) {
  fail('fast policy source-guided answers must not capture plain named single-product explanation questions');
}

if (!/function sourceIsOfficialMetaProductOverviewSnapshot\([\s\S]*officialProductOverviewSnapshot[\s\S]*official_product_overview[\s\S]*meta_business_help_\(ad_levels\|objectives\|formats_placements\|operating_modules\)_2026/.test(answerHandler)) {
  fail('Meta official product overview snapshots must have an explicit final-source allowlist marker');
}

if (!/sourceGroup === 'official_meta_overview' \? 4/.test(answerHandler)) {
  fail('Meta official product overview snapshots must not be collapsed by generic per-group product source limits');
}

if (!/metadata\.fastPolicyOfficialChunk === true[\s\S]*score \+= 70/.test(answerHandler)
  || !/메타 광고 정책 2024\|광고 콘텐츠 가이드라인[\s\S]*score -= 95/.test(answerHandler)) {
  fail('official policy chunks must outrank synthetic Meta policy seed documents');
}

if (!/shouldIncludeFastPolicyOfficialHybridCandidates\(intent\)/.test(rag)
  || !/hybrid_fast_policy_official_chunk/.test(rag)
  || !/fastPolicyOfficial=\$\{fastPolicyOfficialCandidates\.length\}/.test(rag)) {
  fail('official fast-policy chunks must be included in hybrid retrieval when direct policy routing is skipped');
}

if (!/metaProductOverviewOfficialChunk: isOfficialProductOverviewChunk[\s\S]*officialProductOverviewSnapshot: isOfficialProductOverviewChunk[\s\S]*answerEvidenceRole: isOfficialProductOverviewChunk \? 'official_product_overview'/.test(rag)) {
  fail('Meta product overview official chunks must carry durable metadata through retrieval');
}

if (!/const hasLevelStructureSignal =[\s\S]*광고\\s\*관리자\\s\*구조[\s\S]*hasFormatPlacementSignal && !hasLevelStructureSignal/.test(rag)
  || !/meta_level_structure_signal/.test(rag)) {
  fail('Meta advertising-level official snapshot must not be filtered as a generic format/placement-only chunk');
}

if (!/const fastPolicySourceGuidedAnswer = isDeterministicGateEnabled\('policy'\)[\s\S]*buildFastPolicySourceGuidedAnswer\([\s\S]*message,[\s\S]*ragIntent,[\s\S]*sources,[\s\S]*answerGenerationDurationMs: 0,[\s\S]*policyAnswerFamily: fastPolicySourceGuidedAnswer\.policyAnswerFamily[\s\S]*fastAnswerFallback: fastPolicySourceGuidedAnswer\.fastAnswerFallback[\s\S]*Compass specific product answer will use grounded LLM synthesis/.test(answerHandler)) {
  fail('fast policy source-guided answers must run before grounded LLM synthesis and expose zero answer-generation diagnostics');
}

if (!/const fastKakaoBroadProductAnswer = isDeterministicGateEnabled\('product'\)[\s\S]*buildFastKakaoProductStructuredAnswer\([\s\S]*productStructureSources[\s\S]*compass-answer-fast-kakao-product-structured[\s\S]*answerGenerationDurationMs: 0,[\s\S]*fastAnswerFallback: fastKakaoBroadProductAnswer\.fastAnswerFallback[\s\S]*Compass product structure broad answer will use grounded LLM synthesis/.test(answerHandler)) {
  fail('Kakao broad product structure answers must try structured fast answers before grounded LLM synthesis');
}

if (/- 캠페인 목표 기준|먼저 고르는 것|그다음 고르는 것|고정된 상품명|고정 상품 목록|출처는 없지만 일반적으로|모든 매체에서 동일|  - 인지도:/.test(answerHandler)) {
  fail('product structure answer should avoid awkward or nested bullet formatting in rendered chat output');
}

if (process.exitCode) process.exit(process.exitCode);
console.log('[check-compass-product-structure-answer-contract] ok');
