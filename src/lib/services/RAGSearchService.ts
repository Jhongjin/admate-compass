/**
 * RAG (Retrieval-Augmented Generation) 기반 검색 서비스
 * 인덱싱된 문서에서 유사한 콘텐츠를 검색하여 챗봇 답변에 활용
 */

import { createCompassServiceClient } from '@/lib/supabase/compass';
import {
  getCompassRetrievalDurableCacheStatus,
  readCompassRetrievalDurableCache,
  writeCompassRetrievalDurableCache,
} from '@/lib/server/compassRetrievalRuntimeStore';
import { CompassEvidenceGraphService, type EvidenceGraphCandidate } from './CompassEvidenceGraphService';
import { SimpleEmbeddingService } from './SimpleEmbeddingService';
import { generateResponse } from './ollama';
import { detectUnavailablePolicyTarget } from './ragNoDataIntentBoundary.mjs';

export type RetrievalMethod = 'vector' | 'keyword' | 'hybrid' | 'graph' | 'fallback';
export type RetrievalCorpus = 'ollama_document_chunks' | 'document_chunks' | 'evidence_graph' | 'fallback';
export type EvidenceType = 'vector' | 'keyword' | 'hybrid' | 'graph' | 'fallback';
export type EvidenceDecision = 'verified' | 'weak' | 'rejected';
export type VendorIntent = 'META' | 'KAKAO' | 'NAVER' | 'GOOGLE';
export type TopicIntent = 'review' | 'youth' | 'false_claim' | 'price' | 'event' | 'rights' | 'hate' | 'gambling' | 'spec' | 'product_structure';
export type QueryType = 'single-vendor' | 'multi-vendor' | 'generic-policy' | 'exploratory';

export interface QueryIntent {
  vendors: VendorIntent[];
  topics: TopicIntent[];
  keywords: string[];
  strictProductTerms: string[];
  strictContextTerms: string[];
  adPolicyTerms: string[];
  outOfScopeTerms: string[];
  unavailablePolicyTarget: boolean;
  unavailablePolicyTargetReason?: 'future_impossible' | 'fictional_platform';
  isProductStructureOverview: boolean;
  isSpecificProductGuidance: boolean;
  isOutOfScope: boolean;
  queryType: QueryType;
  isComparative: boolean;
  requiresVendorCoverage: boolean;
  recommendedSourceLimit: number;
}

export interface SourceQuality {
  hasDocumentId: boolean;
  hasTitle: boolean;
  hasUrl: boolean;
  hasExcerpt: boolean;
  isFallback: boolean;
  warnings: string[];
  linkedToDocument?: boolean;
  qualityScore?: number;
  corpus?: RetrievalCorpus;
  lexicalOverlap?: number;
  vendorMatch?: boolean;
  vendorMismatch?: boolean;
  sourceVendor?: VendorIntent | 'UNKNOWN';
  policyTitleMatch?: boolean;
}

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  score: number;
  hybridScore?: number;
  vectorScore?: number;
  keywordScore?: number;
  corpus?: RetrievalCorpus;
  evidenceType?: EvidenceType;
  evidenceDecision?: EvidenceDecision;
  evidenceDecisionReason?: string[];
  rankReason?: string[];
  lexicalOverlap?: number;
  vendorMatch?: boolean;
  vendorMismatch?: boolean;
  sourceVendor?: VendorIntent | 'UNKNOWN';
  sourceVendors?: VendorIntent[];
  topicMatch?: boolean;
  topicExactMatch?: boolean;
  policyTitleMatch?: boolean;
  retrievalMethod: RetrievalMethod;
  documentId: string;
  documentTitle: string;
  documentUrl?: string;
  chunkIndex: number;
  metadata?: any;
  sourceQuality: SourceQuality;
}

export type RetrievalChannelTimeoutMetadata = {
  timedOut: boolean;
  channels: string[];
  timings: RetrievalChannelTiming[];
};

export type RetrievalChannelTiming = {
  label: string;
  durationMs: number;
  resultCount: number;
  timedOut: boolean;
  failed?: boolean;
  deferred?: boolean;
};

type SearchResultsWithRetrievalMetadata = SearchResult[] & {
  __compassRetrievalTimedOut?: boolean;
  __compassTimedOutChannels?: string[];
  __compassRetrievalChannelTimings?: RetrievalChannelTiming[];
};

type CompassSupabaseRowsCacheEntry = {
  expiresAt: number;
  rows?: any[];
  promise?: Promise<any[] | null>;
};

const compassSupabaseRowsCacheStats = {
  hitCount: 0,
  missCount: 0,
  inflightHitCount: 0,
  writeCount: 0,
  durableHitCount: 0,
  durableMissCount: 0,
  durableWriteCount: 0,
};
const COMPASS_SUPABASE_ROWS_CACHE_MAX_ENTRIES = 256;
const COMPASS_SUPABASE_ROWS_CACHE_TTL_MS = Math.min(
  Math.max(Number(process.env.COMPASS_SUPABASE_ROWS_CACHE_TTL_MS || 900000), 30000),
  900000,
);
const COMPASS_SUPABASE_ROWS_CACHE_KEY_VERSION = 'v2-product-retrieval-paths';
const compassSupabaseRowsCache = new Map<string, CompassSupabaseRowsCacheEntry>();

const META_APP_INSTALL_OFFICIAL_CHUNK_IDS = [
  'doc_1773886683376_omws3g9_chunk_2',
  'doc_1773886683376_omws3g9_chunk_0',
  'doc_1773886683376_omws3g9_chunk_1',
];

const META_CATALOG_OFFICIAL_CHUNK_IDS = [
  'doc_1773886203371_8rlmmdv_chunk_1',
  'doc_1773886203371_8rlmmdv_chunk_0',
  'doc_1773886203371_8rlmmdv_chunk_2',
];

const NAVER_VIDEO_OFFICIAL_CHUNK_IDS = [
  'doc_1764895606613_llkwwsf_doc_0',
];

const KAKAO_BIZBOARD_DISPLAY_OFFICIAL_CHUNK_IDS = [
  'doc_1774488483929_bigcm1d_chunk_2',
  'doc_1774488184369_r97sach_chunk_0',
];

const KAKAO_RESTRICTED_INDUSTRY_OFFICIAL_CHUNK_IDS = [
  'doc_1774491147517_yj1v810_chunk_17',
  'url_1773203880202_q3y8fucqb_chunk_5',
  'doc_1774491147517_yj1v810_chunk_18',
];

export function getCompassSupabaseRowsCacheStatus() {
  const now = Date.now();
  let activeEntries = 0;
  let inflightEntries = 0;
  for (const entry of compassSupabaseRowsCache.values()) {
    if (entry.expiresAt <= now) continue;
    activeEntries += 1;
    if (entry.promise) inflightEntries += 1;
  }
  const lookupCount = compassSupabaseRowsCacheStats.hitCount + compassSupabaseRowsCacheStats.missCount;
  return {
    enabled: true,
    scope: 'memory+durable',
    ttlMs: COMPASS_SUPABASE_ROWS_CACHE_TTL_MS,
    maxEntries: COMPASS_SUPABASE_ROWS_CACHE_MAX_ENTRIES,
    entries: activeEntries,
    inflightEntries,
    hitCount: compassSupabaseRowsCacheStats.hitCount,
    missCount: compassSupabaseRowsCacheStats.missCount,
    inflightHitCount: compassSupabaseRowsCacheStats.inflightHitCount,
    writeCount: compassSupabaseRowsCacheStats.writeCount,
    durableHitCount: compassSupabaseRowsCacheStats.durableHitCount,
    durableMissCount: compassSupabaseRowsCacheStats.durableMissCount,
    durableWriteCount: compassSupabaseRowsCacheStats.durableWriteCount,
    hitRatio: lookupCount > 0
      ? Number((compassSupabaseRowsCacheStats.hitCount / lookupCount).toFixed(4))
      : null,
    durable: getCompassRetrievalDurableCacheStatus(),
  };
}

export function getCompassRetrievalChannelTimeoutMetadata(
  results: SearchResult[],
): RetrievalChannelTimeoutMetadata {
  const metadata = results as SearchResultsWithRetrievalMetadata;
  return {
    timedOut: metadata.__compassRetrievalTimedOut === true,
    channels: Array.isArray(metadata.__compassTimedOutChannels)
      ? metadata.__compassTimedOutChannels
      : [],
    timings: Array.isArray(metadata.__compassRetrievalChannelTimings)
      ? metadata.__compassRetrievalChannelTimings
      : [],
  };
}

export interface ChatResponse {
  answer: string;
  sources: SearchResult[];
  confidence: number;
  processingTime: number;
  model: string;
  isLLMGenerated?: boolean;
}

const VENDOR_TERM_SPECS: Array<[VendorIntent, string[]]> = [
  ['META', ['meta', '메타', 'facebook', '페이스북', 'instagram', '인스타그램', '릴스', 'reels']],
  ['KAKAO', ['kakao', '카카오', '카카오톡', '톡채널', '비즈보드', '모먼트', '카카오모먼트', '카카오비즈니스', '상품가이드', '상품 가이드']],
  ['NAVER', [
    'naver', '네이버', '검색광고', '쇼핑검색', '파워링크', '브랜드검색',
    '사이트검색', '쇼핑블록', '네이버da', '네이버 da', 'da상품', 'da 상품',
    '보장형 da', '홈피드', '홈피드da', '스마트채널', '타임보드', '롤링보드',
    '성과형 디스플레이', '디지털 옥외광고',
  ]],
  ['GOOGLE', ['google', '구글', 'youtube', '유튜브', 'gdn', 'google ads', 'google display', '구글 디스플레이']],
];

function getCompassVendorTerms(vendor: VendorIntent): string[] {
  return VENDOR_TERM_SPECS.find(([candidate]) => candidate === vendor)?.[1] || [];
}

const TOPIC_TERM_SPECS: Array<[TopicIntent, string[]]> = [
  ['review', ['심사', '승인', '반려', '집행 기준', '준수사항', '위반', '검토', '판단']],
  ['youth', ['청소년', '유해', '성인', '연령']],
  ['false_claim', ['허위', '과장', '오인', '오인하게', '기만', '속임', '거짓', '효능', '효과', '보장', '입증', '개선', '치료']],
  ['price', ['가격', '할인', '할인율']],
  ['event', ['이벤트', '경품', '참여', '당첨']],
  ['rights', ['상표', '저작권', '초상권', '권리', '침해', '무단', '타인']],
  ['hate', ['혐오', '차별', '비하']],
  ['gambling', ['도박', '사행', '사행성', '베팅', '배팅', '카지노']],
  ['spec', ['사이즈', '크기', '파일', '형식', '스펙', '동영상', '이미지', '카루셀']],
  ['product_structure', [
    '광고 상품', '광고상품', '광고 종류', '광고종류', '광고 유형', '광고유형', '상품 구조', '광고 구조',
    '캠페인 목표', '광고 관리자 목표', 'objective', 'objectives', 'advantage+', '어드밴티지',
    '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드', '전환', 'conversion', 'conversions api',
    '노출 위치', '게재 위치', 'placements', '지면',
    '앱 캠페인', '앱 인스톨', '앱 설치', '앱 홍보', '앱 사전등록', '앱 사전 등록', 'app install', 'app promotion',
    '쇼핑 광고', '검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이', '리드 양식', '잠재고객 광고', '비즈니스폼', 'lead generation', 'lead ads',
    '동영상 광고', '동영상 조회', 'video ads', 'youtube shorts', 'video action campaign',
    '검색광고', '쇼핑검색', '파워링크', '브랜드검색', '쇼핑블록', '디지털 옥외광고',
    '네이버DA', 'DA상품', '보장형 DA', '스마트채널', '타임보드', '롤링보드',
    '비즈보드', '카카오모먼트', '브랜드이모티콘', '상품가이드', '상품 가이드'
  ]],
];

const PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS = [
  '캠페인 목표', '광고 관리자 목표', '인지도', '트래픽', '참여', '잠재 고객', '앱 홍보', '판매',
  '앱 캠페인', '쇼핑 광고', '검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이 광고', '리드 양식',
  '앱 인스톨', '앱 설치', '앱 홍보', 'App Install', 'App Promotion', 'MMP', 'SDK', '앱 이벤트',
  '앱 사전등록', '앱 사전 등록', 'Performance Max', 'PMax', 'Demand Gen',
  '잠재고객 광고', '비즈니스폼', 'Lead Generation', 'Lead Ads',
  '동영상 광고', '동영상 조회', '동영상 소재', 'Video Ads', 'YouTube Shorts', 'Shorts 광고', 'Video action campaign',
  '검색광고', '쇼핑검색', '파워링크', '브랜드검색', '쇼핑블록', '디지털 옥외광고',
  'DA', '네이버DA', 'DA상품', '보장형 DA', '스마트채널', '타임보드', '롤링보드', '디스플레이 광고', '성과형 디스플레이', '홈피드DA', '홈피드', '배너 광고',
  '비즈보드', '카카오모먼트', '브랜드이모티콘', '상품가이드', '상품 가이드',
  '광고 형식', '소재 형식', '노출 위치', '게재 위치', '지면',
  'Advantage+', '어드밴티지', '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드', '전환', 'conversion', 'Conversions API',
  '이미지', '동영상', '슬라이드', '컬렉션', '릴스', '스토리', '피드'
];

const PRODUCT_STRUCTURE_ANCHOR_TERMS = [
  '광고 관리자 목표',
  '캠페인 목표',
  'Advantage+',
  '어드밴티지',
  '카탈로그',
  '메타 픽셀',
  'Meta Pixel',
  'Conversions API',
  '앱 캠페인',
  '앱 인스톨',
  '앱 설치',
  '앱 홍보',
  'App Install',
  'App Promotion',
  'MMP',
  'SDK',
  '앱 이벤트',
  '앱 사전등록',
  '앱 사전 등록',
  'Performance Max',
  'PMax',
  'Demand Gen',
  '쇼핑 광고',
  '반응형 디스플레이 광고',
  '리드 양식',
  '잠재고객 광고',
  '비즈니스폼',
  'Lead Generation',
  'Lead Ads',
  '동영상 광고',
  '동영상 조회',
  '동영상 소재',
  'Video Ads',
  'YouTube Shorts',
  'Shorts 광고',
  'Video action campaign',
  '검색광고',
  '쇼핑검색',
  '쇼핑블록',
  'PC 쇼핑블록',
  '모바일 쇼핑',
  '상품DB',
  '상품 DB',
  'DB URL',
  'EP',
  '가격비교',
  '디지털 옥외광고',
  'DA',
  '디스플레이 광고',
  '성과형 디스플레이',
  '홈피드DA',
  '홈피드',
  '배너 광고',
  '네이버DA',
  'DA상품',
  '보장형 DA',
  '스마트채널',
  '타임보드',
  '롤링보드',
  '비즈보드',
  '상품가이드',
  '상품 가이드',
];

function isProductStructureQueryText(text: string): boolean {
  const hasOverviewSignal = /광고\s*상품|광고상품|광고\s*종류|광고종류|광고\s*유형|광고유형|상품\s*구조|광고\s*구조|캠페인\s*목표|광고\s*관리자\s*목표|목적별|목표별|상황별|선택\s*기준|고르는\s*기준|어떻게\s*(선택|고르|구분)|기준으로\s*(설명|구분|선택|정리)/.test(text);
  if (hasOverviewSignal) return true;

  const hasVendorOrAdContext = detectCompassVendors(text).length > 0 || AD_POLICY_TERMS.some(term => text.includes(term));
  return hasVendorOrAdContext && /상품\s*(목록|종류|유형|구조|군)|종류|유형|구조|솔루션/.test(text);
}

function isProductCatalogOverviewQuestionText(text: string): boolean {
  const hasNamedProductSignal = /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고|동영상\s*광고|비디오\s*광고|youtube\s*shorts|shorts\s*광고|video\s*action\s*campaign|\bvac\b|앱\s*인스톨|앱\s*설치|앱\s*홍보|앱\s*사전\s*등록|app\s*install|app\s*promotion|리드\s*양식|잠재\s*고객\s*광고|잠재고객\s*광고|잠재고객광고|비즈니스\s*폼|비즈니스폼|lead\s*form|lead\s*generation|lead\s*ads?|db\s*url|상품\s*db|상품db|상품등록|상품\s*등록|dburl|\bep\b|카탈로그|catalog|advantage\+|어드밴티지|performance\s*max|\bpmax\b|demand\s*gen|쇼핑검색|사이트검색|파워링크|브랜드검색|쇼핑블록|비즈보드/.test(text);
  const asksWholeProductCatalog = /전체\s*(광고\s*)?(상품|목록|종류|유형|구조|군)|광고\s*상품\s*(전체|목록|종류|유형|구조|군)|광고상품\s*(전체|목록|종류|유형|구조|군)|상품\s*(전체|목록|종류|유형|구조|군)/.test(text);
  const hasExplicitCatalogSignal = (
    asksWholeProductCatalog
    || /광고\s*(종류|유형)|상품\s*구조|광고\s*구조/.test(text)
    || /캠페인\s*목표|광고\s*관리자\s*목표|목적별|목표별|상황별|선택\s*기준|고르는\s*기준|어떻게\s*(선택|고르|구분)|기준으로\s*(설명|구분|선택|정리)/.test(text)
  );

  if (hasNamedProductSignal && !asksWholeProductCatalog) return false;
  if (hasExplicitCatalogSignal) return true;

  return (
    /광고\s*상품.*(알려|설명|정리|구분)/.test(text)
  );
}

function hasSpecificProductActionOrPolicySignalText(text: string): boolean {
  return /등록|절차|집행|세팅|설정|연동|제작|가이드|소재|문구|사양|스펙|조건|주의|유의|확인해야|꼭\s*확인|db\s*url|상품\s*db|상품등록|mmp|sdk|추적|트래킹|오류|에러|반려|승인|심사|검수|정책|랜딩/.test(text);
}

function isPolicyJudgmentQueryText(text: string): boolean {
  const hasPolicyDecisionSignal = /정책|심사|승인|반려|검수|검토|판단|위반|금지|제한|불가|가능|허용|주의|유의|오인|허위|과장|기만|거짓|도박|사행|사행성|상표|저작권|초상권|권리|침해/.test(text);
  const hasAdExpressionContext = /광고|소재|문구|표현|캠페인|집행|ads?/.test(text);
  return hasPolicyDecisionSignal && hasAdExpressionContext;
}

function isSpecificProductGuidanceQueryText(text: string): boolean {
  const strictProductTerms = detectStrictProductTerms(text);
  const hasSpecificSignal = /등록|절차|집행|세팅|설정|연동|제작|가이드|소재|문구|사양|스펙|조건|주의|유의|확인해야|꼭\s*확인|db\s*url|상품\s*db|상품등록|앱\s*인스톨|앱\s*설치|앱\s*사전\s*등록|리드\s*양식|잠재고객\s*광고|비즈니스\s*폼|비즈니스폼|동영상\s*광고/.test(text);
  const hasNamedProductSignal = /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고|동영상\s*광고|비디오\s*광고|youtube\s*shorts|shorts\s*광고|video\s*action\s*campaign|\bvac\b|앱\s*인스톨|앱\s*설치|앱\s*홍보|앱\s*사전\s*등록|app\s*install|app\s*promotion|리드\s*양식|잠재고객\s*광고|비즈니스\s*폼|비즈니스폼|lead\s*form|lead\s*generation|lead\s*ads?|db\s*url|상품\s*db|상품db|상품등록|상품\s*등록|dburl|\bep\b|카탈로그|catalog|advantage\+|어드밴티지|performance\s*max|\bpmax\b|demand\s*gen|쇼핑검색|사이트검색|파워링크|브랜드검색|쇼핑블록|비즈보드/.test(text);
  const asksWholeProductCatalog = /전체\s*(광고\s*)?(상품|목록|종류|유형|구조)|광고\s*상품\s*(전체|목록|종류|유형|구조)|상품\s*(전체|목록)/.test(text);
  const asksProductCatalogOverview = isProductCatalogOverviewQuestionText(text);
  const hasActionOrPolicySignal = hasSpecificProductActionOrPolicySignalText(text);
  const asksOverview = /종류|유형|구조|구분|선택|고르|고르면|기준으로\s*(설명|구분|선택)|어떻게\s*(선택|고르|구분)/.test(text);
  const namesMultipleProductFamilies = [
    /검색\s*(캠페인|광고)|사이트검색|파워링크/.test(text),
    /디스플레이\s*(캠페인|광고)|da($|[\s/]|도|상품|광고)|비즈보드/.test(text),
    /쇼핑\s*(광고|캠페인)|쇼핑검색|쇼핑블록|상품\s*db|카탈로그|catalog/.test(text),
    /앱\s*(캠페인|인스톨|설치|홍보)|app\s*(install|promotion)/.test(text),
    /동영상\s*광고|비디오\s*광고|youtube|유튜브|shorts|쇼츠/.test(text),
    /리드\s*양식|잠재고객|lead\s*(form|ads?|generation)/.test(text),
  ].filter(Boolean).length >= 2;

  if (asksProductCatalogOverview && (asksOverview || namesMultipleProductFamilies) && !hasActionOrPolicySignal) {
    return false;
  }
  if (isPolicyJudgmentQueryText(text) && !hasNamedProductSignal && strictProductTerms.length === 0) return false;
  if ((hasNamedProductSignal || strictProductTerms.length > 0) && !asksWholeProductCatalog) return true;
  if (asksProductCatalogOverview && !hasActionOrPolicySignal) return false;
  if (!hasSpecificSignal) return false;

  const asksProcedureOrGuide = /등록|절차|집행|세팅|설정|연동|제작|가이드|소재|문구|사양|스펙|조건|주의|유의|확인해야|꼭\s*확인|db\s*url|상품\s*db|상품등록|앱\s*인스톨|앱\s*설치|앱\s*사전\s*등록|리드\s*양식|잠재고객\s*광고|비즈니스\s*폼|비즈니스폼|동영상\s*광고/.test(text);

  return asksProcedureOrGuide && !asksOverview;
}

function isProductStructureOverviewQueryText(text: string): boolean {
  if (isSpecificProductGuidanceQueryText(text)) return false;

  return isProductCatalogOverviewQuestionText(text)
    || /광고\s*상품|광고상품|광고\s*종류|광고종류|광고\s*유형|광고유형|상품\s*구조|광고\s*구조|캠페인\s*목표|광고\s*관리자\s*목표|종류를|유형을|어떻게\s*(선택|고르|구분)|기준으로\s*(설명|구분|선택)/.test(text);
}

function stripKoreanParticle(word: string): string {
  const protectedTerms = new Set([
    '디스플레이',
    'display',
    'youtube',
    'shorts',
    'reels',
    'gdn',
    'da',
  ]);
  const normalized = word.toLowerCase();
  if (protectedTerms.has(normalized)) return word;

  const stripped = word.replace(/(으로|에게|에서|부터|까지|이나|거나|하고|은|는|이|가|을|를|에|의|도|만|로|과|와)$/u, '');
  if (stripped.length < 2) return word;
  return stripped;
}

const AD_POLICY_TERMS = [
  '광고', '정책', '심사', '소재', '매체', '캠페인', '타겟', '집행', '승인', '반려',
  'meta', '메타', 'facebook', '페이스북', 'instagram', '인스타그램', 'kakao', '카카오',
  'naver', '네이버', 'google', '구글', 'youtube', '유튜브', 'gdn'
];

const OUT_OF_SCOPE_TERMS = [
  '날씨', '기온', '우산', '미세먼지', '김치찌개', '레시피', '요리', '맛집',
  '점심', '저녁', '아침', '식사', '메뉴 추천', '메뉴추천',
  '주식', '코인', '환율', '연예', '영화 추천', '건강 상담', '진단', '치료'
];

function normalizeCompassSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchCompassTerms(text: string, terms: string[]): string[] {
  return terms.filter(term => text.includes(term));
}

function detectCompassVendors(text: string): VendorIntent[] {
  const vendors: VendorIntent[] = [];

  for (const [vendor, terms] of VENDOR_TERM_SPECS) {
    if (terms.some(term => text.includes(term))) {
      vendors.push(vendor);
    }
  }

  return vendors;
}

function detectCompassTopics(text: string): TopicIntent[] {
  const topics: TopicIntent[] = [];

  for (const [topic, terms] of TOPIC_TERM_SPECS) {
    if (terms.some(term => text.includes(term))) {
      topics.push(topic);
    }
  }

  return topics;
}

function detectStrictProductTerms(text: string): string[] {
  const terms: string[] = [];

  if (text.includes('쇼핑검색')) terms.push('쇼핑검색');
  if (/쇼핑\s*블록|쇼핑블록|주요\s*쇼핑\s*지면|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑/.test(text)) {
    terms.push('쇼핑블록', '쇼핑 블록', '주요 쇼핑 지면', 'PC 쇼핑블록', 'MO 쇼핑블록', '모바일 쇼핑');
  }
  if (text.includes('사이트검색')) terms.push('사이트검색');
  if (text.includes('파워링크')) terms.push('파워링크');
  if (text.includes('브랜드검색')) terms.push('브랜드검색');
  if (text.includes('지역소상공인')) terms.push('지역소상공인');
  if (text.includes('비즈보드')) terms.push('비즈보드');
  if (/카카오모먼트|카카오\s*모먼트/.test(text)) terms.push('카카오모먼트');
  if (/브랜드\s*이모티콘|브랜드이모티콘/.test(text)) terms.push('브랜드이모티콘');
  if (/상품\s*가이드|상품가이드/.test(text)) terms.push('상품가이드', '상품 가이드');
  if (/디지털\s*옥외\s*광고|디지털\s*옥외광고/.test(text)) terms.push('디지털 옥외광고');
  if (/검색\s*캠페인|검색\s*광고|search\s*campaign/.test(text)) terms.push('검색 캠페인', '검색 광고', 'Search campaign');
  if (/디스플레이\s*캠페인|반응형\s*디스플레이|display\s*campaign|responsive\s*display/.test(text)) terms.push('디스플레이 캠페인', '반응형 디스플레이', 'Display campaign');
  if (/쇼핑\s*광고|쇼핑\s*캠페인|shopping\s*(ads?|campaigns?)/.test(text)) terms.push('쇼핑 광고', '쇼핑 캠페인', 'Shopping ads');
  if (text.includes('키워드광고') || text.includes('키워드 광고')) terms.push('키워드광고');
  if (/(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(text)) {
    terms.push('DA', 'DA상품', '네이버DA', '보장형 DA', '스마트채널', '타임보드', '롤링보드', '디스플레이광고', '성과형디스플레이', '홈피드DA', '배너광고');
  }
  if (/동영상\s*광고|비디오\s*광고|youtube\s*shorts|shorts\s*광고|쇼츠|숏폼|아웃스트림|video\s*action\s*campaign|\bvac\b/.test(text)) {
    terms.push('동영상광고', '비디오광고', '동영상 조회', '동영상 소재', '숏폼 광고', '숏폼', '아웃스트림');
    if (/youtube|유튜브/.test(text)) terms.push('YouTube', '유튜브');
    if (/youtube\s*shorts|shorts\s*광고|쇼츠/.test(text)) terms.push('YouTube Shorts', 'Shorts 광고', '쇼츠');
    if (/video\s*action\s*campaign|\bvac\b/.test(text)) terms.push('Video action campaign', 'VAC');
  }
  if (/카루셀|캐러셀|carousel|슬라이드\s*광고/.test(text)) {
    terms.push('카루셀', '캐러셀', 'Carousel', '슬라이드 광고');
  }
  if (/릴스|reels|스토리|stories|피드|feed/.test(text)) {
    terms.push('릴스', 'Reels', '스토리', 'Stories', '피드', 'Feed');
  }
  if (/앱\s*인스톨|앱\s*설치|앱\s*홍보|앱\s*사전\s*등록|app\s*install|app\s*promotion/.test(text)) {
    terms.push('앱인스톨', '앱설치', '앱홍보', '앱 사전등록', 'App Install', 'App Promotion');
    if (/sdk/.test(text)) terms.push('SDK');
    if (/mmp/.test(text)) terms.push('MMP');
  }
  if (/리드\s*양식|잠재\s*고객\s*양식|잠재고객\s*광고|잠재\s*고객\s*광고|비즈니스\s*폼|비즈니스폼|lead\s*form|lead\s*gen|lead\s*generation|lead\s*ads?/.test(text)) {
    terms.push('리드 양식', '리드양식', '잠재고객 양식', '잠재고객양식', '잠재고객 광고', '비즈니스폼', 'Lead Form', 'Lead Ads', 'Lead Gen', 'Lead Generation');
  }
  if (/advantage\+|어드밴티지|카탈로그|catalog|컬렉션|collection|performance\s*max|\bpmax\b|demand\s*gen/.test(text)) {
    terms.push('Advantage+', '어드밴티지', '카탈로그', 'Catalog', '컬렉션', 'Collection', 'Performance Max', 'PMax', 'Demand Gen');
  }
  if (/db\s*url|상품\s*db|상품등록|ep/.test(text)) terms.push('DB URL', '상품DB', 'EP', '상품등록');

  return terms;
}

function detectStrictContextTerms(text: string): string[] {
  const terms: string[] = [];

  if (/금융|대출|보험|투자|신용|카드|여신|저축|은행/.test(text)) {
    terms.push('금융', '대출', '보험', '투자', '신용', '카드', 'financial', 'finance', 'credit', 'loan', 'insurance');
  }

  if (/의료|병원|의약품|건강기능식품|건기식|헬스케어|웰니스/.test(text)) {
    terms.push('의료', '병원', '의약품', '건강기능식품', '건기식', '헬스케어', '웰니스', 'health', 'healthcare', 'wellness');
  }

  return Array.from(new Set(terms));
}

function extractCompassKeywords(query: string): string[] {
  const stopwords = new Set([
    '무엇인가요', '무엇', '어떤', '있는', '없는', '해주세요', '알려줘', '기준은', '기준',
    '관련', '대한', '대해', '대해서', '대하여', '그리고', '또는', '가능한가요', '되나요', '경우', '알려', '줘',
    'the', 'and', 'for', 'with', 'what', 'how'
  ]);

  const normalized = normalizeCompassSearchText(query);
  const productStructureQuery = isProductStructureQueryText(normalized);
  const specificProductGuidance = isSpecificProductGuidanceQueryText(normalized);
  const baseKeywords = Array.from(new Set(
    query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map(word => stripKoreanParticle(word.trim()))
      .filter(word => word.length >= 2 && !stopwords.has(word))
  ));
  const expansions: string[] = [];

  if (/효능|효과|성능|개선|보장|입증|치료|허위|과장|오인|기만|거짓/.test(normalized)) {
    expansions.push('효능', '효과', '보장', '입증', '개선', '치료', '허위', '과장', '오인', '기만', '거짓', '사실과 다름');
  }

  if (/주의|유의|제한|금지|반려|심사|위반|검토|판단|가능|불가|허용/.test(normalized)) {
    expansions.push('주의', '제한', '금지', '반려', '심사', '검수', '정책', '운영정책', '등록기준', '광고등록기준', '가이드', '위반', '검토', '판단', '허용', '불가');
  }

  if (/도박|사행|사행성|베팅|배팅|카지노/.test(normalized)) {
    expansions.push('도박', '사행', '사행성', '베팅', '배팅', '카지노', '금지', '제한', '광고등록기준');
  }

  if (/상표|저작권|초상권|권리|침해|무단|타인/.test(normalized)) {
    expansions.push('상표', '저작권', '초상권', '권리', '침해', '무단', '타인', '허가', '동의', '광고등록기준');
  }

  if (/(^|[\s/])da($|[\s/]|도|상품|광고)|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(normalized)) {
    expansions.push('DA', '디스플레이 광고', '성과형 디스플레이 광고', '홈피드DA', '배너 광고');
  }

  if (/앱\s*인스톨|앱\s*설치|앱\s*홍보|app\s*install|app\s*promotion/.test(normalized)) {
    expansions.push('앱 인스톨', '앱 설치', '앱 홍보', 'App Install', 'App Promotion', 'SDK', 'MMP', '앱 이벤트');
  }

  if (/동영상\s*광고|비디오\s*광고/.test(normalized)) {
    expansions.push('동영상 광고', '비디오 광고', '동영상 소재', 'Video Ads');
  }

  if (/등록|db\s*url|상품\s*db|상품등록|쇼핑검색/.test(normalized)) {
    expansions.push('상품등록', '상품 DB', '상품DB', 'DB URL', 'EP', '쇼핑파트너센터', '카테고리', '가격비교');
  }

  if (/앱\s*인스톨|앱\s*설치|앱\s*홍보|app\s*promotion|app\s*install/.test(normalized)) {
    expansions.push('앱 홍보', '앱 캠페인', '앱 설치', '사전 등록', '앱 이벤트', 'SDK', 'MMP', '전환', '캠페인 설정');
  }

  if (/리드\s*양식|lead\s*form/.test(normalized)) {
    expansions.push('리드 양식', '확장 소재', '잠재 고객', '양식 제출', '개인정보', '상담 신청');
  }

  if (/제작|가이드|소재|문구|사양|스펙|동영상\s*광고/.test(normalized)) {
    expansions.push('제작 가이드', '상품 가이드', '소재 가이드', '이미지', '동영상', '비율', '문구', '랜딩', '심사');
  }

  if (productStructureQuery && !specificProductGuidance) {
    expansions.push(...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS);
  }

  return Array.from(new Set([...baseKeywords, ...expansions])).slice(0, productStructureQuery ? (specificProductGuidance ? 24 : 28) : 16);
}

export function classifyCompassRagQuery(query: string): QueryIntent {
  const normalized = normalizeCompassSearchText(query);
  const vendors = detectCompassVendors(normalized);
  const detectedTopics = detectCompassTopics(normalized);
  const strictProductTerms = detectStrictProductTerms(normalized);
  const strictContextTerms = detectStrictContextTerms(normalized);
  const adPolicyTerms = matchCompassTerms(normalized, AD_POLICY_TERMS);
  const outOfScopeTerms = matchCompassTerms(normalized, OUT_OF_SCOPE_TERMS);
  const unavailablePolicyTarget = detectUnavailablePolicyTarget(query);
  const isComparative = vendors.length >= 2 || /비교|차이|공통|각각|vs\.?|versus|동시에|나란히/.test(normalized);
  const isSpecificProductGuidance = isSpecificProductGuidanceQueryText(normalized);
  const isProductStructureOverview = isProductStructureOverviewQueryText(normalized);
  const requiresVendorCoverage = vendors.length >= 2
    || (isComparative && vendors.length > 0);
  const shouldKeepProductStructureTopic = (
    isSpecificProductGuidance
    || isProductStructureOverview
    || (
      detectedTopics.includes('product_structure')
      && /광고\s*(상품|종류|유형|구조)|광고상품|상품\s*(구조|목록|종류|유형)|캠페인\s*목표|광고\s*관리자\s*목표|목적별|목표별|어떻게\s*(선택|고르|구분)|기준으로\s*(설명|구분|선택|정리)/.test(normalized)
    )
  );
  const topics = [
    ...detectedTopics.filter(topic => topic !== 'product_structure'),
    ...(shouldKeepProductStructureTopic ? ['product_structure' as TopicIntent] : []),
  ];
  const queryType: QueryType = vendors.length >= 2
    ? 'multi-vendor'
    : vendors.length === 1
      ? 'single-vendor'
      : topics.length > 0 && adPolicyTerms.length > 0
        ? 'generic-policy'
        : 'exploratory';
  const hasProductStructureIntent = topics.includes('product_structure');
  const recommendedSourceLimit = requiresVendorCoverage
    ? 5
    : hasProductStructureIntent
      ? 6
    : topics.length >= 2
      ? 4
      : 3;

  return {
    vendors,
    topics,
    keywords: extractCompassKeywords(query),
    strictProductTerms,
    strictContextTerms,
    adPolicyTerms,
    outOfScopeTerms,
    unavailablePolicyTarget: unavailablePolicyTarget.isUnavailablePolicyTarget,
    unavailablePolicyTargetReason: unavailablePolicyTarget.reason,
    isProductStructureOverview,
    isSpecificProductGuidance,
    isOutOfScope: outOfScopeTerms.length > 0 && adPolicyTerms.length === 0,
    queryType,
    isComparative,
    requiresVendorCoverage,
    recommendedSourceLimit,
  };
}

export class RAGSearchService {
  private supabase;
  private embeddingService: SimpleEmbeddingService;
  private evidenceGraphService?: CompassEvidenceGraphService;

  private getRetrievalChannelTimeoutMs(): number {
    const parsed = Math.floor(Number(process.env.COMPASS_RETRIEVAL_CHANNEL_TIMEOUT_MS));
    const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 28000;
    return Math.min(Math.max(timeoutMs, 8000), 30000);
  }

  private getKakaoProductGraphSoftBudgetMs(): number {
    const parsed = Math.floor(Number(process.env.COMPASS_KAKAO_PRODUCT_GRAPH_SOFT_BUDGET_MS || 1100));
    const budgetMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 1100;
    return Math.min(Math.max(budgetMs, 500), 4000);
  }

  private async withRetrievalChannelTimeout<T>(
    promise: Promise<T>,
    label: string,
    fallback: T,
    timedOutChannels?: string[],
    channelTimings?: RetrievalChannelTiming[],
  ): Promise<T> {
    const timeoutMs = this.getRetrievalChannelTimeoutMs();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let settled = false;

    const countResults = (value: T): number => Array.isArray(value) ? value.length : 0;
    const recordTiming = (value: T, timedOut: boolean, failed = false) => {
      channelTimings?.push({
        label,
        durationMs: Date.now() - startedAt,
        resultCount: countResults(value),
        timedOut,
        ...(failed ? { failed: true } : {}),
      });
    };

    try {
      return await Promise.race([
        promise.then(
          (value) => {
            if (!settled) {
              settled = true;
              recordTiming(value, false);
            }
            return value;
          },
          (error) => {
            if (!settled) {
              settled = true;
              recordTiming(fallback, false, true);
            }
            throw error;
          },
        ),
        new Promise<T>((resolve) => {
          timeoutId = setTimeout(() => {
            settled = true;
            console.warn('Compass retrieval channel timed out', { label, timeoutMs });
            timedOutChannels?.push(label);
            recordTiming(fallback, true);
            resolve(fallback);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async withRetrievalChannelSoftBudget<T>(
    promise: Promise<T>,
    label: string,
    fallback: T,
    budgetMs: number,
    channelTimings?: RetrievalChannelTiming[],
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let settled = false;

    const countResults = (value: T): number => Array.isArray(value) ? value.length : 0;
    const recordTiming = (value: T, failed = false, deferred = false) => {
      channelTimings?.push({
        label,
        durationMs: Date.now() - startedAt,
        resultCount: countResults(value),
        timedOut: false,
        ...(failed ? { failed: true } : {}),
        ...(deferred ? { deferred: true } : {}),
      });
    };

    try {
      return await Promise.race([
        promise.then(
          (value) => {
            if (!settled) {
              settled = true;
              recordTiming(value);
            }
            return value;
          },
          (error) => {
            if (!settled) {
              settled = true;
              recordTiming(fallback, true);
            }
            console.warn('Compass retrieval channel failed within soft budget', {
              label,
              errorName: error instanceof Error ? error.name : 'UnknownError',
            });
            return fallback;
          },
        ),
        new Promise<T>((resolve) => {
          timeoutId = setTimeout(() => {
            settled = true;
            recordTiming(fallback, false, true);
            resolve(fallback);
          }, budgetMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async loadCachedSupabaseRows(
    cacheKey: string,
    loader: () => Promise<any[] | null>,
  ): Promise<any[] | null> {
    const cachedRows = this.readSupabaseRowsCache(cacheKey);
    if (cachedRows) {
      return cachedRows;
    }

    const inflightRows = await this.awaitSupabaseRowsCacheInflight(cacheKey);
    if (inflightRows) {
      return inflightRows;
    }

    const durableRows = await readCompassRetrievalDurableCache<any[]>('supabase_rows', cacheKey);
    if (Array.isArray(durableRows?.payload)) {
      compassSupabaseRowsCacheStats.durableHitCount += 1;
      this.writeSupabaseRowsCacheRows(cacheKey, durableRows.payload);
      return this.cloneSupabaseRows(durableRows.payload);
    }
    compassSupabaseRowsCacheStats.durableMissCount += 1;

    compassSupabaseRowsCacheStats.missCount += 1;
    const promise = loader();
    this.writeSupabaseRowsCacheInflight(cacheKey, promise);
    let rows: any[] | null;
    try {
      rows = await promise;
    } catch (error) {
      compassSupabaseRowsCache.delete(cacheKey);
      throw error;
    }

    if (rows === null) {
      compassSupabaseRowsCache.delete(cacheKey);
      return null;
    }

    const expiresAt = this.writeSupabaseRowsCacheRows(cacheKey, rows);
    const durableWritten = await writeCompassRetrievalDurableCache({
      namespace: 'supabase_rows',
      cacheKey,
      payload: this.cloneSupabaseRows(rows),
      expiresAt,
      metadata: {
        rowCount: rows.length,
      },
    });
    if (durableWritten) {
      compassSupabaseRowsCacheStats.durableWriteCount += 1;
    }
    return this.cloneSupabaseRows(rows);
  }

  private buildSupabaseRowsCacheKey(kind: string, params: Record<string, unknown>): string {
    const normalizeValue = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value
          .map(item => String(item || '').trim())
          .filter(Boolean)
          .sort();
      }
      if (typeof value === 'string') return value.trim();
      return value;
    };
    const normalizedParams = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, normalizeValue(value)])
    );
    return JSON.stringify({ version: COMPASS_SUPABASE_ROWS_CACHE_KEY_VERSION, kind, ...normalizedParams });
  }

  private readSupabaseRowsCache(cacheKey: string): any[] | null {
    const entry = compassSupabaseRowsCache.get(cacheKey);
    if (!entry?.rows) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      compassSupabaseRowsCache.delete(cacheKey);
      return null;
    }

    compassSupabaseRowsCacheStats.hitCount += 1;
    return this.cloneSupabaseRows(entry.rows);
  }

  private async awaitSupabaseRowsCacheInflight(cacheKey: string): Promise<any[] | null> {
    const entry = compassSupabaseRowsCache.get(cacheKey);
    if (!entry?.promise) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      compassSupabaseRowsCache.delete(cacheKey);
      return null;
    }

    try {
      const rows = await entry.promise;
      if (rows !== null) {
        compassSupabaseRowsCacheStats.inflightHitCount += 1;
      }
      return rows === null ? null : this.cloneSupabaseRows(rows);
    } catch (error) {
      compassSupabaseRowsCache.delete(cacheKey);
      throw error;
    }
  }

  private writeSupabaseRowsCacheInflight(
    cacheKey: string,
    promise: Promise<any[] | null>,
  ) {
    this.pruneSupabaseRowsCache();
    compassSupabaseRowsCache.set(cacheKey, {
      expiresAt: Date.now() + COMPASS_SUPABASE_ROWS_CACHE_TTL_MS,
      promise,
    });
  }

  private writeSupabaseRowsCacheRows(cacheKey: string, rows: any[]) {
    this.pruneSupabaseRowsCache();
    const expiresAt = new Date(Date.now() + COMPASS_SUPABASE_ROWS_CACHE_TTL_MS);
    compassSupabaseRowsCache.set(cacheKey, {
      expiresAt: expiresAt.getTime(),
      rows: this.cloneSupabaseRows(rows),
    });
    compassSupabaseRowsCacheStats.writeCount += 1;
    return expiresAt;
  }

  private pruneSupabaseRowsCache() {
    const now = Date.now();
    for (const [cacheKey, entry] of compassSupabaseRowsCache) {
      if (entry.expiresAt <= now) {
        compassSupabaseRowsCache.delete(cacheKey);
      }
    }

    while (compassSupabaseRowsCache.size >= COMPASS_SUPABASE_ROWS_CACHE_MAX_ENTRIES) {
      const oldestKey = compassSupabaseRowsCache.keys().next().value;
      if (!oldestKey) break;
      compassSupabaseRowsCache.delete(oldestKey);
    }
  }

  private cloneSupabaseRows(rows: any[]): any[] {
    return rows.map(row => ({
      ...row,
      metadata: row?.metadata && typeof row.metadata === 'object'
        ? { ...row.metadata }
        : row?.metadata,
    }));
  }

  private selectSupabaseKeywordSearchTerms(
    keywords: string[],
    intent?: QueryIntent,
    vendor?: VendorIntent,
    options: { rawKeywordsOnly?: boolean } = {},
  ): string[] {
    const cleanedKeywords = keywords
      .map(keyword => keyword.trim())
      .filter(keyword => keyword.length >= 2);
    const vendorTerms = vendor ? getCompassVendorTerms(vendor) : [];
    const priorityTerms = intent
      ? [
        ...intent.strictProductTerms,
        ...intent.strictContextTerms,
        ...intent.adPolicyTerms,
      ]
      : [];
    const maxTerms = this.isBroadProductStructureRetrievalIntent(intent)
      ? 10
      : intent?.topics.includes('product_structure')
      ? (intent.isSpecificProductGuidance ? 14 : 16)
      : intent?.vendors.length
        ? 14
        : 12;

    const specificPriorityTermLimit = intent && this.isNaverVideoProductIntent(intent)
      ? 6
      : intent && (
        this.isMetaAppInstallIntent(intent)
        || this.isGoogleLeadFormIntent(intent)
      )
        ? 10
        : maxTerms;

    if (options.rawKeywordsOnly) {
      return Array.from(new Set(cleanedKeywords)).slice(0, specificPriorityTermLimit);
    }

    if (intent && (this.isMetaAppInstallIntent(intent) || this.isGoogleLeadFormIntent(intent))) {
      return Array.from(new Set([
        ...priorityTerms,
        ...cleanedKeywords,
      ])).slice(0, specificPriorityTermLimit);
    }

    if (
      intent
      && this.isBroadProductStructureRetrievalIntent(intent)
      && this.isKakaoBizboardDisplayProductIntent(intent)
    ) {
      return Array.from(new Set([
        '비즈보드',
        '카카오 비즈보드',
        '디스플레이 광고',
        '카카오모먼트',
        '상품가이드',
        ...cleanedKeywords.filter(keyword => /카카오|비즈보드|디스플레이|상품|구조/.test(keyword)),
      ])).slice(0, 6);
    }

    return Array.from(new Set([
      ...vendorTerms,
      ...priorityTerms,
      ...cleanedKeywords,
    ])).slice(0, maxTerms);
  }

  private isBroadProductStructureRetrievalIntent(intent?: QueryIntent): boolean {
    return Boolean(
      intent?.topics.includes('product_structure')
      && intent.isProductStructureOverview
      && !intent.isSpecificProductGuidance
      && intent.vendors.length === 1
      && !intent.isComparative
    );
  }

  private getKeywordTableFetchLimit(limit: number, intent?: QueryIntent): number {
    if (intent && this.isMetaAppInstallIntent(intent)) {
      return Math.min(Math.max(limit, 12), 28);
    }
    if (intent && this.isNaverVideoProductIntent(intent)) {
      return Math.min(Math.max(limit, 8), 18);
    }
    if (intent && this.isGoogleLeadFormIntent(intent)) {
      return Math.min(Math.max(limit * 2, 12), 32);
    }
    if (
      intent
      && intent.isSpecificProductGuidance
      && this.isKakaoBizboardDisplayProductIntent(intent)
    ) {
      return Math.min(Math.max(limit + 4, 8), 16);
    }

    if (
      intent
      && this.isBroadProductStructureRetrievalIntent(intent)
      && this.isKakaoBizboardDisplayProductIntent(intent)
    ) {
      return Math.min(Math.max(limit, 12), 20);
    }

    if (this.isBroadProductStructureRetrievalIntent(intent)) {
      return Math.min(Math.max(limit * 2, 16), 36);
    }
    if (intent && this.isKakaoBizboardDisplayProductIntent(intent)) {
      return Math.min(Math.max(limit * 3, 24), 48);
    }

    const productStructureIntent = intent?.topics.includes('product_structure') === true;
    const multiplier = productStructureIntent ? 8 : 10;
    const floor = productStructureIntent ? 48 : 40;
    const ceiling = productStructureIntent ? 160 : 120;
    return Math.min(Math.max(limit * multiplier, floor), ceiling);
  }

  private getVendorMetadataFetchLimit(limit: number, intent?: QueryIntent): number {
    if (intent && this.isMetaAppInstallIntent(intent)) {
      return Math.min(Math.max(limit, 8), 18);
    }
    if (intent && this.isNaverVideoProductIntent(intent)) {
      return Math.min(Math.max(limit, 6), 10);
    }
    if (intent && this.isGoogleLeadFormIntent(intent)) {
      return Math.min(Math.max(limit * 2, 10), 20);
    }
    if (
      intent
      && intent.isSpecificProductGuidance
      && this.isKakaoBizboardDisplayProductIntent(intent)
    ) {
      return Math.min(Math.max(limit + 4, 8), 18);
    }

    if (this.isBroadProductStructureRetrievalIntent(intent)) {
      return Math.min(Math.max(limit * 2, 16), 36);
    }
    if (intent && this.isKakaoBizboardDisplayProductIntent(intent)) {
      return Math.min(Math.max(limit * 3, 18), 36);
    }

    const productStructureIntent = intent?.topics.includes('product_structure') === true;
    const multiplier = productStructureIntent ? 8 : 10;
    const floor = productStructureIntent ? 48 : 40;
    const ceiling = productStructureIntent ? 120 : 96;
    return Math.min(Math.max(limit * multiplier, floor), ceiling);
  }

  private getProductStructureAnchorFetchLimit(limit: number, intent?: QueryIntent): number {
    if (intent && this.isMetaAppInstallIntent(intent)) {
      return Math.min(Math.max(limit, 8), 16);
    }

    if (
      intent
      && intent.isSpecificProductGuidance
      && this.isKakaoBizboardDisplayProductIntent(intent)
    ) {
      return Math.min(Math.max(limit + 3, 8), 16);
    }

    if (this.isBroadProductStructureRetrievalIntent(intent)) {
      return Math.min(Math.max(limit * 3, 18), 36);
    }

    return Math.min(Math.max(limit * 8, 32), 72);
  }

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log('🔧 RAGSearchService 초기화 시작...');
    console.log('📊 환경 변수 상태:', {
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey
    });

    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ Supabase 환경변수가 설정되지 않았습니다. Fallback 모드로 전환합니다.');
      console.warn('필요한 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');

      // 프로덕션 환경에서는 더미 클라이언트 사용
      if (process.env.NODE_ENV === 'production') {
        this.supabase = createCompassServiceClient();
        this.embeddingService = new SimpleEmbeddingService();
        this.evidenceGraphService = new CompassEvidenceGraphService(this.supabase);
        console.log('✅ RAGSearchService 초기화 완료 (Fallback 모드)');
        return;
      }

      throw new Error('Supabase 환경변수가 설정되지 않았습니다. .env.local 파일을 확인해주세요.');
    }

    try {
      this.supabase = createCompassServiceClient();

      // SimpleEmbeddingService 사용
      this.embeddingService = new SimpleEmbeddingService();
      this.evidenceGraphService = new CompassEvidenceGraphService(this.supabase);
      console.log('✅ RAGSearchService 초기화 완료 (SimpleEmbeddingService)');
    } catch (error) {
      console.error('RAGSearchService initialization failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new Error(`RAGSearchService 초기화 실패: ${error}`);
    }
  }

  /**
   * 질문에 대한 유사한 문서 청크 검색
   */
  async searchSimilarChunks(
    query: string,
    limit: number = 5,
    similarityThreshold: number = 0.1  // 임계값을 낮춰서 더 많은 결과 검색
  ): Promise<SearchResult[]> {
    try {
      console.log('RAG search started', { queryLength: query.length, limit });

      // Fallback 모드인 경우 샘플 데이터 반환
      if (!this.supabase) {
        console.log('⚠️ Fallback 모드: 샘플 데이터 반환');
        return this.getFallbackSearchResults(query, limit);
      }

      const timedOutChannels: string[] = [];
      const channelTimings: RetrievalChannelTiming[] = [];
      const intent = this.detectQueryIntent(query);
      console.log('🧭 Query intent:', {
        vendors: intent.vendors,
        topics: intent.topics,
        queryType: intent.queryType,
        isComparative: intent.isComparative,
        recommendedSourceLimit: intent.recommendedSourceLimit,
        keywordCount: intent.keywords.length,
        outOfScopeTerms: intent.outOfScopeTerms,
        unavailablePolicyTarget: intent.unavailablePolicyTarget,
        unavailablePolicyTargetReason: intent.unavailablePolicyTargetReason,
        isOutOfScope: intent.isOutOfScope,
        strictContextTerms: intent.strictContextTerms,
        isProductStructureOverview: intent.isProductStructureOverview,
        isSpecificProductGuidance: intent.isSpecificProductGuidance,
      });

      if (intent.isOutOfScope || intent.unavailablePolicyTarget) {
        console.log('⚠️ 광고/정책 범위 밖 질문으로 판단하여 검색을 중단합니다.');
        return [];
      }

      const needsVendorAwareRetrieval = intent.vendors.length > 0;
      const needsProductStructureRetrieval = intent.topics.includes('product_structure');
      const usesProductStructureFastRetrieval = intent.isProductStructureOverview && !intent.isSpecificProductGuidance;
      const usesSpecificProductRetrieval = (
        needsProductStructureRetrieval
        && intent.isSpecificProductGuidance
        && intent.vendors.length === 1
        && !intent.isComparative
      );
      const usesNaverProductStructurePriority =
        needsProductStructureRetrieval
        && intent.vendors.length === 1
        && intent.vendors[0] === 'NAVER'
        && (
          this.isNaverShoppingDataIntent(intent)
          || this.isNaverShoppingSearchCreativeIntent(intent)
          || this.isNaverDisplayAdIntent(intent)
          || this.isNaverVideoProductIntent(intent)
          || intent.isProductStructureOverview
        );
      const usesNaverShoppingDataPriority =
        usesNaverProductStructurePriority
        && this.isNaverShoppingDataIntent(intent);
      const usesMetaAppInstallPriority =
        needsProductStructureRetrieval
        && intent.vendors.length === 1
        && intent.vendors[0] === 'META'
        && this.isMetaAppInstallIntent(intent);
      const usesMetaCatalogPriority =
        needsProductStructureRetrieval
        && intent.vendors.length === 1
        && intent.vendors[0] === 'META'
        && this.isMetaCatalogIntent(intent);
      const usesMetaCreativeSpecPriority =
        needsProductStructureRetrieval
        && intent.vendors.length === 1
        && intent.vendors[0] === 'META'
        && this.isMetaCreativeSpecIntent(intent);
      const usesGoogleLeadFormPriority =
        needsProductStructureRetrieval
        && intent.vendors.length === 1
        && intent.vendors[0] === 'GOOGLE'
        && this.isGoogleLeadFormIntent(intent);
      const usesMetaProductOverviewPriority =
        needsProductStructureRetrieval
        && intent.vendors.length === 1
        && intent.vendors[0] === 'META'
        && !usesMetaAppInstallPriority
        && !usesMetaCatalogPriority
        && intent.isProductStructureOverview
        && !intent.isSpecificProductGuidance;
      const usesKakaoProductPriority =
        needsProductStructureRetrieval
        && intent.vendors.length === 1
        && intent.vendors[0] === 'KAKAO'
        && this.isKakaoBizboardDisplayProductIntent(intent);
      const usesKakaoInternalProductComparison =
        usesKakaoProductPriority
        && intent.isComparative
        && this.isKakaoBizboardDisplayComparisonIntent(intent);
      const skipsGraphForGoogleProductOverview =
        needsProductStructureRetrieval
        && intent.vendors.length === 1
        && intent.vendors[0] === 'GOOGLE'
        && intent.isProductStructureOverview
        && !intent.isSpecificProductGuidance;
      const usesPrioritySpecificProductRetrieval =
        usesNaverProductStructurePriority
        || usesMetaAppInstallPriority
        || usesMetaCatalogPriority
        || usesMetaCreativeSpecPriority
        || usesKakaoProductPriority
        || usesGoogleLeadFormPriority;
      const candidateLimit = usesSpecificProductRetrieval
        ? Math.max(limit * 2, 16)
        : needsVendorAwareRetrieval
        ? Math.max(limit, intent.vendors.length * 4, needsProductStructureRetrieval ? 18 : 8)
        : needsProductStructureRetrieval
          ? Math.max(limit * 3, 18)
          : limit;
      const usesVendorProductStructurePriority = (
        usesProductStructureFastRetrieval
        && intent.vendors.length === 1
        && (
          intent.vendors[0] === 'NAVER'
          || intent.vendors[0] === 'GOOGLE'
          || usesMetaProductOverviewPriority
          || usesMetaAppInstallPriority
          || usesMetaCatalogPriority
          || usesKakaoProductPriority
        )
      );

      if (usesProductStructureFastRetrieval && intent.vendors.length === 1 && !intent.isComparative) {
        const [
          keywordCandidates,
          vendorCoverageCandidates,
          productStructureCandidates,
          naverPriorityCandidates,
          metaProductOverviewPriorityCandidates,
          metaAppInstallPriorityCandidates,
          metaCatalogPriorityCandidates,
          kakaoProductPriorityCandidates,
          graphCandidates
        ] = await Promise.all([
          this.withRetrievalChannelTimeout(this.searchKeywordCandidates(query, candidateLimit, intent), 'product_fast_keyword', [], timedOutChannels, channelTimings),
          intent.requiresVendorCoverage
            ? this.withRetrievalChannelTimeout(this.searchVendorCoverageCandidates(query, candidateLimit, intent), 'product_fast_vendor_coverage', [], timedOutChannels, channelTimings)
            : Promise.resolve([]),
          usesVendorProductStructurePriority
            ? Promise.resolve([])
            : this.withRetrievalChannelTimeout(this.searchProductStructureCandidates(candidateLimit, intent), 'product_fast_structure_anchor', [], timedOutChannels, channelTimings),
          this.withRetrievalChannelTimeout(this.searchNaverProductStructurePriorityCandidates(intent), 'product_fast_naver_priority', [], timedOutChannels, channelTimings),
          usesMetaProductOverviewPriority
            ? this.withRetrievalChannelTimeout(this.searchMetaProductOverviewPriorityCandidates(intent), 'product_fast_meta_overview_priority', [], timedOutChannels, channelTimings)
            : Promise.resolve([]),
          usesMetaAppInstallPriority
            ? this.withRetrievalChannelTimeout(this.searchMetaAppInstallPriorityCandidates(intent), 'product_fast_meta_app_priority', [], timedOutChannels, channelTimings)
            : Promise.resolve([]),
          usesMetaCatalogPriority
            ? this.withRetrievalChannelTimeout(this.searchMetaCatalogPriorityCandidates(intent), 'product_fast_meta_catalog_priority', [], timedOutChannels, channelTimings)
            : Promise.resolve([]),
          Promise.resolve([]),
          skipsGraphForGoogleProductOverview
            ? Promise.resolve([])
            : usesKakaoProductPriority
              ? this.withRetrievalChannelSoftBudget(this.searchEvidenceGraphCandidates(query, candidateLimit, intent), 'product_fast_graph', [], this.getKakaoProductGraphSoftBudgetMs(), channelTimings)
              : this.withRetrievalChannelTimeout(this.searchEvidenceGraphCandidates(query, candidateLimit, intent), 'product_fast_graph', [], timedOutChannels, channelTimings)
        ]);

        console.log(`📊 Product structure fast 후보 수집 결과: keyword=${keywordCandidates.length}, vendorCoverage=${vendorCoverageCandidates.length}, productStructure=${productStructureCandidates.length}, naverPriority=${naverPriorityCandidates.length}, metaOverviewPriority=${metaProductOverviewPriorityCandidates.length}, metaAppInstallPriority=${metaAppInstallPriorityCandidates.length}, metaCatalogPriority=${metaCatalogPriorityCandidates.length}, kakaoProductPriority=${kakaoProductPriorityCandidates.length}, graph=${graphCandidates.length}`);
        const allCandidates = [
          ...keywordCandidates,
          ...vendorCoverageCandidates,
          ...productStructureCandidates,
          ...naverPriorityCandidates,
          ...metaProductOverviewPriorityCandidates,
          ...metaAppInstallPriorityCandidates,
          ...metaCatalogPriorityCandidates,
          ...kakaoProductPriorityCandidates,
          ...graphCandidates
        ];
        const rankedResults = this.ensureProductStructureGraphCandidateCoverage(
          this.ensureNaverProductStructureCoverage(
            this.mergeDedupeAndRankCandidates(
              allCandidates,
              limit,
              intent
            ),
            allCandidates,
            intent
          ),
          allCandidates,
          limit,
          intent
        );

        console.log(`✅ 상품 구조 검색 완료: ${rankedResults.length}개 결과 (fast keyword/anchor path)`);
        return this.withRetrievalTimeoutMetadata(rankedResults, timedOutChannels, channelTimings);
      }

      if (usesNaverProductStructurePriority && usesSpecificProductRetrieval) {
        const naverProductPriorityCandidates = await this.withRetrievalChannelTimeout(
          this.searchNaverProductStructurePriorityCandidates(intent),
          'specific_naver_priority_direct',
          [],
          timedOutChannels,
          channelTimings,
        );

        if (naverProductPriorityCandidates.length > 0) {
          const rankedResults = this.mergeDedupeAndRankCandidates(
            naverProductPriorityCandidates,
            limit,
            intent,
          );
          console.log(`✅ NAVER specific product 검색 완료: ${rankedResults.length}개 결과 (specific naver priority direct path)`);
          if (rankedResults.length > 0) {
            return this.withRetrievalTimeoutMetadata(rankedResults, timedOutChannels, channelTimings);
          }
          const rescueResults = this.selectNaverProductPriorityRescueCandidates(
            naverProductPriorityCandidates,
            limit,
            intent,
          );
          if (rescueResults.length > 0) {
            console.warn('NAVER specific product priority candidates were rescued after strict ranking filtered all candidates', {
              priorityCandidateCount: naverProductPriorityCandidates.length,
              rescueCount: rescueResults.length,
            });
            return this.withRetrievalTimeoutMetadata(rescueResults, timedOutChannels, channelTimings);
          }
          console.warn('NAVER specific product priority candidates were all filtered; continuing to hybrid retrieval', {
            priorityCandidateCount: naverProductPriorityCandidates.length,
          });
        }
      }

      if (usesMetaAppInstallPriority && usesSpecificProductRetrieval) {
        const metaAppInstallPriorityCandidates = await this.withRetrievalChannelTimeout(
          this.searchMetaAppInstallPriorityCandidates(intent),
          'specific_meta_app_install_priority_direct',
          [],
          timedOutChannels,
          channelTimings,
        );

        if (metaAppInstallPriorityCandidates.length > 0) {
          const rankedResults = this.mergeDedupeAndRankCandidates(
            metaAppInstallPriorityCandidates,
            limit,
            intent,
          );
          console.log(`✅ META app install specific product 검색 완료: ${rankedResults.length}개 결과 (specific meta app install priority direct path)`);
          if (rankedResults.length > 0) {
            return this.withRetrievalTimeoutMetadata(rankedResults, timedOutChannels, channelTimings);
          }
        }
      }

      if (usesMetaCatalogPriority && usesSpecificProductRetrieval) {
        const metaCatalogPriorityCandidates = await this.withRetrievalChannelTimeout(
          this.searchMetaCatalogPriorityCandidates(intent),
          'specific_meta_catalog_priority_direct',
          [],
          timedOutChannels,
          channelTimings,
        );

        if (metaCatalogPriorityCandidates.length > 0) {
          const rankedResults = this.mergeDedupeAndRankCandidates(
            metaCatalogPriorityCandidates,
            limit,
            intent,
          );
          console.log(`✅ META catalog specific product 검색 완료: ${rankedResults.length}개 결과 (specific meta catalog priority direct path)`);
          if (rankedResults.length > 0) {
            return this.withRetrievalTimeoutMetadata(rankedResults, timedOutChannels, channelTimings);
          }
        }
      }

      if (usesMetaCreativeSpecPriority && usesSpecificProductRetrieval) {
        const metaCreativeSpecPriorityCandidates = await this.withRetrievalChannelTimeout(
          this.searchMetaCreativeSpecPriorityCandidates(intent),
          'specific_meta_creative_spec_priority_direct',
          [],
          timedOutChannels,
          channelTimings,
        );

        if (metaCreativeSpecPriorityCandidates.length > 0) {
          const rankedResults = this.mergeDedupeAndRankCandidates(
            metaCreativeSpecPriorityCandidates,
            limit,
            intent,
          );
          console.log(`✅ META creative spec 검색 완료: ${rankedResults.length}개 결과 (specific meta creative spec priority direct path)`);
          if (rankedResults.length > 0) {
            return this.withRetrievalTimeoutMetadata(rankedResults, timedOutChannels, channelTimings);
          }
        }
      }

      if (usesGoogleLeadFormPriority && usesSpecificProductRetrieval) {
        const googleLeadFormPriorityCandidates = await this.withRetrievalChannelTimeout(
          this.searchGoogleLeadFormPriorityCandidates(intent),
          'specific_google_lead_form_priority_direct',
          [],
          timedOutChannels,
          channelTimings,
        );

        if (googleLeadFormPriorityCandidates.length > 0) {
          const rankedResults = this.mergeDedupeAndRankCandidates(
            googleLeadFormPriorityCandidates,
            limit,
            intent,
          );
          console.log(`✅ GOOGLE lead form specific product 검색 완료: ${rankedResults.length}개 결과 (specific google lead form priority direct path)`);
          if (rankedResults.length > 0) {
            return this.withRetrievalTimeoutMetadata(rankedResults, timedOutChannels, channelTimings);
          }
        }
      }

      if (usesKakaoProductPriority && usesSpecificProductRetrieval) {
        const kakaoProductPriorityCandidates = await this.withRetrievalChannelTimeout(
          this.searchKakaoProductStructurePriorityCandidates(intent),
          'specific_kakao_priority_direct',
          [],
          timedOutChannels,
          channelTimings,
        );

        if (kakaoProductPriorityCandidates.length > 0) {
          const rankedResults = this.mergeDedupeAndRankCandidates(
            kakaoProductPriorityCandidates,
            limit,
            intent,
          );
        console.log(`✅ KAKAO specific product 검색 완료: ${rankedResults.length}개 결과 (specific kakao priority direct path)`);
        if (rankedResults.length > 0) {
          return this.withRetrievalTimeoutMetadata(rankedResults, timedOutChannels, channelTimings);
        }
        const rescueResults = this.selectKakaoProductPriorityRescueCandidates(
          kakaoProductPriorityCandidates,
          limit,
          intent,
        );
        if (rescueResults.length > 0) {
          console.warn('KAKAO specific product priority candidates were rescued after strict ranking filtered all candidates', {
            priorityCandidateCount: kakaoProductPriorityCandidates.length,
            rescueCount: rescueResults.length,
          });
          return this.withRetrievalTimeoutMetadata(rescueResults, timedOutChannels, channelTimings);
        }
        console.warn('KAKAO specific product priority candidates were all filtered; continuing to hybrid retrieval', {
          priorityCandidateCount: kakaoProductPriorityCandidates.length,
        });
      }
      }

      const usesGenericRightsPolicyPriority = this.isGenericRightsPolicyPriorityIntent(intent);
      const usesGenericGamblingPolicyPriority = this.isGenericGamblingPolicyPriorityIntent(intent);
      const usesKakaoServiceProtectionPriority = this.isKakaoServiceProtectionPolicyIntent(intent);
      const usesFastPolicySourcePriority = this.isFastPolicySourceGuidedPriorityIntent(intent);

      if (usesFastPolicySourcePriority && !usesPrioritySpecificProductRetrieval) {
        const fastPolicyOfficialCandidates = await this.withRetrievalChannelTimeout(
          this.searchFastPolicySourceGuidedOfficialCandidates(intent),
          'fast_policy_official_chunk_direct',
          [],
          timedOutChannels,
          channelTimings,
        );
        if (fastPolicyOfficialCandidates.length > 0) {
          const rankedOfficialResults = this.mergeDedupeAndRankCandidates(
            fastPolicyOfficialCandidates,
            limit,
            intent,
          );
          if (rankedOfficialResults.length > 0) {
            console.log(`✅ Fast policy official chunk 검색 완료: ${rankedOfficialResults.length}개 결과 (policy official chunk direct path)`);
            return this.withRetrievalTimeoutMetadata(rankedOfficialResults, timedOutChannels, channelTimings);
          }
          const rescueResults = fastPolicyOfficialCandidates.slice(0, limit);
          console.warn('Fast policy official chunk candidates were rescued after strict ranking filtered all candidates', {
            priorityCandidateCount: fastPolicyOfficialCandidates.length,
            rescueCount: rescueResults.length,
          });
          return this.withRetrievalTimeoutMetadata(rescueResults, timedOutChannels, channelTimings);
        }

        const fastPolicyCandidates = await this.withRetrievalChannelTimeout(
          this.searchKeywordCandidates(query, Math.max(limit * 2, 12), intent),
          'fast_policy_keyword_direct',
          [],
          timedOutChannels,
          channelTimings,
        );

        const focusedPolicyCandidates = this.selectFastPolicySourceGuidedPriorityCandidates(fastPolicyCandidates, intent);
        const rankedResults = this.mergeDedupeAndRankCandidates(
          focusedPolicyCandidates.length > 0 ? focusedPolicyCandidates : fastPolicyCandidates,
          limit,
          intent,
        );
        if (rankedResults.length > 0) {
          console.log(`✅ Fast policy source 검색 완료: ${rankedResults.length}개 결과 (policy priority direct path)`);
          return this.withRetrievalTimeoutMetadata(rankedResults, timedOutChannels, channelTimings);
        }
        if (focusedPolicyCandidates.length > 0) {
          const rescueResults = focusedPolicyCandidates.slice(0, limit);
          console.warn('Fast policy source priority candidates were rescued after strict ranking filtered all candidates', {
            priorityCandidateCount: fastPolicyCandidates.length,
            rescueCount: rescueResults.length,
          });
          return this.withRetrievalTimeoutMetadata(rescueResults, timedOutChannels, channelTimings);
        }
      }

      // 질문을 임베딩으로 변환
      const queryEmbeddingResult = await this.embeddingService.generateEmbedding(query);
      const queryEmbedding = queryEmbeddingResult.embedding;
      console.log(`📊 질문 임베딩 생성 완료: ${queryEmbedding.length}차원`);

      const [
        vectorCandidates,
        keywordCandidates,
        genericRightsPolicyCandidates,
        genericGamblingPolicyCandidates,
        kakaoServiceProtectionCandidates,
        vendorCoverageCandidates,
        productStructureCandidates,
        naverPriorityCandidates,
        metaProductOverviewPriorityCandidates,
        metaAppInstallPriorityCandidates,
        metaCatalogPriorityCandidates,
        googleLeadFormPriorityCandidates,
        kakaoProductPriorityCandidates,
        graphCandidates
      ] = await Promise.all([
        this.withRetrievalChannelTimeout(this.searchVectorCandidates(queryEmbedding, candidateLimit, intent), 'hybrid_vector', [], timedOutChannels, channelTimings),
        usesKakaoProductPriority
          ? Promise.resolve([])
          : this.withRetrievalChannelTimeout(this.searchKeywordCandidates(query, candidateLimit, intent), 'hybrid_keyword', [], timedOutChannels, channelTimings),
        usesGenericRightsPolicyPriority
          ? this.withRetrievalChannelTimeout(this.searchGenericRightsPolicyPriorityCandidates(intent), 'hybrid_generic_rights_policy_priority', [], timedOutChannels, channelTimings)
          : Promise.resolve([]),
        usesGenericGamblingPolicyPriority
          ? this.withRetrievalChannelTimeout(this.searchGenericGamblingPolicyPriorityCandidates(intent), 'hybrid_generic_gambling_policy_priority', [], timedOutChannels, channelTimings)
          : Promise.resolve([]),
        usesKakaoServiceProtectionPriority
          ? this.withRetrievalChannelTimeout(this.searchKakaoServiceProtectionPolicyCandidates(intent), 'hybrid_kakao_service_protection_priority', [], timedOutChannels, channelTimings)
          : Promise.resolve([]),
        usesKakaoProductPriority
          ? Promise.resolve([])
          : usesSpecificProductRetrieval
          ? this.withRetrievalChannelTimeout(this.searchVendorCoverageCandidates(query, Math.max(limit, 8), intent), 'hybrid_vendor_coverage_specific', [], timedOutChannels, channelTimings)
          : this.withRetrievalChannelTimeout(this.searchVendorCoverageCandidates(query, candidateLimit, intent), 'hybrid_vendor_coverage', [], timedOutChannels, channelTimings),
        usesPrioritySpecificProductRetrieval
          ? Promise.resolve([])
          : this.withRetrievalChannelTimeout(this.searchProductStructureCandidates(candidateLimit, intent), 'hybrid_product_structure_anchor', [], timedOutChannels, channelTimings),
        usesNaverProductStructurePriority
          ? this.withRetrievalChannelTimeout(this.searchNaverProductStructurePriorityCandidates(intent), 'hybrid_naver_priority', [], timedOutChannels, channelTimings)
          : Promise.resolve([]),
        usesMetaProductOverviewPriority
          ? this.withRetrievalChannelTimeout(this.searchMetaProductOverviewPriorityCandidates(intent), 'hybrid_meta_overview_priority', [], timedOutChannels, channelTimings)
          : Promise.resolve([]),
        usesMetaAppInstallPriority
          ? this.withRetrievalChannelTimeout(this.searchMetaAppInstallPriorityCandidates(intent), 'hybrid_meta_app_priority', [], timedOutChannels, channelTimings)
          : Promise.resolve([]),
        usesMetaCatalogPriority
          ? this.withRetrievalChannelTimeout(this.searchMetaCatalogPriorityCandidates(intent), 'hybrid_meta_catalog_priority', [], timedOutChannels, channelTimings)
          : Promise.resolve([]),
        usesGoogleLeadFormPriority
          ? this.withRetrievalChannelTimeout(this.searchGoogleLeadFormPriorityCandidates(intent), 'hybrid_google_lead_form_priority', [], timedOutChannels, channelTimings)
          : Promise.resolve([]),
        usesKakaoProductPriority
          ? this.withRetrievalChannelTimeout(this.searchKakaoProductStructurePriorityCandidates(intent), 'hybrid_kakao_priority', [], timedOutChannels, channelTimings)
          : Promise.resolve([]),
        usesKakaoInternalProductComparison
          ? this.withRetrievalChannelSoftBudget(this.searchEvidenceGraphCandidates(query, candidateLimit, intent), 'hybrid_graph', [], this.getKakaoProductGraphSoftBudgetMs(), channelTimings)
          : this.withRetrievalChannelTimeout(this.searchEvidenceGraphCandidates(query, candidateLimit, intent), 'hybrid_graph', [], timedOutChannels, channelTimings)
      ]);

      console.log(`📊 Hybrid 후보 수집 결과: vector=${vectorCandidates.length}, keyword=${keywordCandidates.length}, genericRightsPolicy=${genericRightsPolicyCandidates.length}, genericGamblingPolicy=${genericGamblingPolicyCandidates.length}, kakaoServiceProtection=${kakaoServiceProtectionCandidates.length}, vendorCoverage=${vendorCoverageCandidates.length}, productStructure=${productStructureCandidates.length}, naverPriority=${naverPriorityCandidates.length}, metaOverviewPriority=${metaProductOverviewPriorityCandidates.length}, metaAppInstallPriority=${metaAppInstallPriorityCandidates.length}, metaCatalogPriority=${metaCatalogPriorityCandidates.length}, googleLeadFormPriority=${googleLeadFormPriorityCandidates.length}, kakaoProductPriority=${kakaoProductPriorityCandidates.length}, graph=${graphCandidates.length}`);
      const allCandidates = [
        ...vectorCandidates,
        ...keywordCandidates,
        ...genericRightsPolicyCandidates,
        ...genericGamblingPolicyCandidates,
        ...kakaoServiceProtectionCandidates,
        ...vendorCoverageCandidates,
        ...productStructureCandidates,
        ...naverPriorityCandidates,
        ...metaProductOverviewPriorityCandidates,
        ...metaAppInstallPriorityCandidates,
        ...metaCatalogPriorityCandidates,
        ...googleLeadFormPriorityCandidates,
        ...kakaoProductPriorityCandidates,
        ...graphCandidates
      ];
      const rankedResults = this.ensureProductStructureGraphCandidateCoverage(
        this.ensureNaverProductStructureCoverage(
          this.mergeDedupeAndRankCandidates(
            allCandidates,
            limit,
            intent
          ),
          allCandidates,
          intent
        ),
        allCandidates,
        limit,
        intent
      );

      if (rankedResults.length > 0) {
        console.log('🔍 Hybrid 검색 결과 샘플:', rankedResults.slice(0, 2).map((chunk) => ({
          chunk_id: chunk.id,
          corpus: chunk.corpus,
          retrievalMethod: chunk.retrievalMethod,
          hybridScore: chunk.hybridScore,
          vectorScore: chunk.vectorScore,
          keywordScore: chunk.keywordScore,
          warnings: chunk.sourceQuality.warnings
        })));
      } else {
        console.log('⚠️ Hybrid 검색 결과가 없습니다. 데이터베이스에 문서가 있는지 확인하세요.');
      }

      console.log(`✅ 검색 완료: ${rankedResults.length}개 결과 (임계값: ${similarityThreshold})`);
      return this.withRetrievalTimeoutMetadata(rankedResults, timedOutChannels, channelTimings);

    } catch (error) {
      console.error('RAG search failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      // 오류 발생 시에도 fallback 데이터 반환
      return this.getFallbackSearchResults(query, limit);
    }
  }

  private withRetrievalTimeoutMetadata(
    results: SearchResult[],
    timedOutChannels: string[],
    channelTimings: RetrievalChannelTiming[] = [],
  ): SearchResult[] {
    const channels = Array.from(new Set(timedOutChannels));
    if (channels.length === 0 && channelTimings.length === 0) return results;

    if (channels.length > 0) {
      Object.defineProperty(results, '__compassRetrievalTimedOut', {
        value: true,
        enumerable: false,
      });
      Object.defineProperty(results, '__compassTimedOutChannels', {
        value: channels,
        enumerable: false,
      });
    }
    if (channelTimings.length > 0) {
      Object.defineProperty(results, '__compassRetrievalChannelTimings', {
        value: channelTimings,
        enumerable: false,
      });
    }
    return results;
  }

  private async searchEvidenceGraphCandidates(query: string, limit: number, intent: QueryIntent): Promise<SearchResult[]> {
    if (!this.evidenceGraphService) {
      return [];
    }

    const graphCandidates = await this.evidenceGraphService.searchCandidates(query, intent, limit);
    return graphCandidates
      .map((candidate) => this.normalizeEvidenceGraphCandidate(candidate, intent))
      .filter((candidate): candidate is SearchResult => Boolean(candidate));
  }

  private normalizeEvidenceGraphCandidate(candidate: EvidenceGraphCandidate, intent: QueryIntent): SearchResult | null {
    const content = [candidate.claimText, candidate.excerpt]
      .filter((value) => Boolean(value && String(value).trim()))
      .join('\n\n')
      .trim();
    if (!content) {
      return null;
    }

    const documentTitle = candidate.title || (candidate.sourceKind === 'resolved_case'
      ? 'Compass 실무 해결 사례'
      : 'Compass 공식 가이드 근거');
    const documentId = candidate.sourceDocumentId
      || candidate.sourceChunkId
      || candidate.caseId
      || `graph_assertion:${candidate.id}`;
    const documentUrl = candidate.sourceUrl || undefined;
    const sourceVendor = candidate.vendor || 'UNKNOWN';
    const vendorMatch = sourceVendor !== 'UNKNOWN' && intent.vendors.includes(sourceVendor);
    const vendorMismatch = intent.vendors.length > 0 && sourceVendor !== 'UNKNOWN' && !vendorMatch;

    if (vendorMismatch) {
      return null;
    }

    const metadata = {
      ...(candidate.metadata || {}),
      sourceKind: candidate.sourceKind,
      source_kind: candidate.sourceKind,
      graphPath: candidate.graphPath,
      evidenceGraphAssertionId: candidate.id,
      source_document_id: candidate.sourceDocumentId,
      source_chunk_id: candidate.sourceChunkId,
      case_id: candidate.caseId,
      claimType: candidate.claimType,
      matchedTerms: candidate.matchedTerms,
      documentId,
      sourceVendor,
      source_vendor: sourceVendor,
      sourceVendors: sourceVendor === 'UNKNOWN' ? [] : [sourceVendor],
      source_vendors: sourceVendor === 'UNKNOWN' ? [] : [sourceVendor],
      retrievalMethod: 'graph',
      evidenceType: 'graph',
      corpus: 'evidence_graph',
    };
    const sourceText = this.buildCandidateSearchText(content, documentTitle, metadata);
    const lexicalOverlap = this.calculateLexicalOverlap(sourceText, intent.keywords);
    const topicMatch = this.hasTopicMatch(sourceText, intent.topics) || candidate.matchedTerms.length > 0;
    const topicExactMatch = this.hasExactTopicMatch(sourceText, intent.topics) || candidate.score >= 0.72;
    const policyTitleMatch = candidate.sourceKind === 'official_doc'
      || this.hasPolicyGradeTitle(documentTitle, metadata);
    const keywordScore = Math.max(
      candidate.score,
      this.calculateKeywordScore(
        content,
        documentTitle,
        [...intent.keywords, ...candidate.matchedTerms],
        lexicalOverlap,
        topicMatch,
        topicExactMatch,
        policyTitleMatch
      )
    );
    const sourceQuality = this.buildSourceQuality({
      documentId,
      documentTitle,
      documentUrl,
      content,
      metadata,
      corpus: 'evidence_graph',
      warnings: [],
      lexicalOverlap,
      vendorMatch,
      vendorMismatch,
      sourceVendor,
      policyTitleMatch,
    });
    const vectorScore = 0;
    let hybridScore = this.calculateHybridScore({
      vectorScore,
      keywordScore,
      sourceQualityScore: Math.max(sourceQuality.qualityScore || 0, candidate.confidence),
      retrievalMethod: 'graph',
      corpus: 'evidence_graph',
      lexicalOverlap,
      vendorMatch,
      vendorMismatch,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      genericPolicyIntent: this.isGenericPolicyIntent(intent),
      originalMetaSeed: false,
      hasUrl: sourceQuality.hasUrl,
    });
    hybridScore = Math.max(hybridScore, Math.min(1, candidate.score + (candidate.sourceKind === 'resolved_case' ? 0.08 : 0.04)));
    const graphTitleAdjustment = this.calculateProductStructureGraphTitleAdjustment(
      documentTitle,
      documentUrl,
      content,
      intent
    );
    if (graphTitleAdjustment.adjustment !== 0) {
      hybridScore = Math.max(0, Math.min(1, hybridScore + graphTitleAdjustment.adjustment));
    }
    const evidenceDecision = this.decideEvidence({
      content,
      sourceQuality,
      retrievalMethod: 'graph',
      corpus: 'evidence_graph',
      hybridScore,
      vectorScore,
      keywordScore,
      lexicalOverlap,
      vendorMatch,
      vendorMismatch,
      topicExactMatch,
      policyTitleMatch,
    });
    const graphEvidenceDecision = candidate.sourceKind === 'official_doc'
      ? 'verified'
      : evidenceDecision.decision;
    const graphEvidenceDecisionReasons = Array.from(new Set([
      ...evidenceDecision.reasons,
      candidate.sourceKind === 'official_doc' ? 'official_doc_graph_evidence' : '',
    ].filter(Boolean)));
    const rankReason = Array.from(new Set([
      'evidence_graph_sidecar',
      `source_kind_${candidate.sourceKind}`,
      `claim_type_${candidate.claimType}`,
      candidate.sourceKind === 'resolved_case' ? 'approved_operational_case' : 'official_doc_assertion',
      ...graphTitleAdjustment.reasons,
      vendorMatch ? 'vendor_match' : '',
      topicMatch ? 'topic_match' : '',
      topicExactMatch ? 'topic_exact_match' : '',
      lexicalOverlap > 0 ? 'lexical_overlap' : '',
    ].filter(Boolean)));

    return {
      id: `graph_assertion:${candidate.id}`,
      content,
      similarity: hybridScore,
      score: hybridScore,
      hybridScore,
      vectorScore,
      keywordScore,
      corpus: 'evidence_graph',
      evidenceType: 'graph',
      evidenceDecision: graphEvidenceDecision,
      evidenceDecisionReason: graphEvidenceDecisionReasons,
      rankReason,
      lexicalOverlap,
      vendorMatch,
      vendorMismatch,
      sourceVendor,
      sourceVendors: sourceVendor === 'UNKNOWN' ? [] : [sourceVendor],
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      retrievalMethod: 'graph',
      documentId,
      documentTitle,
      documentUrl,
      chunkIndex: 0,
      metadata: {
        ...metadata,
        retrievalMethod: 'graph',
        evidenceType: 'graph',
        corpus: 'evidence_graph',
        evidenceDecision: graphEvidenceDecision,
        evidenceDecisionReason: graphEvidenceDecisionReasons,
        score: hybridScore,
        hybridScore,
        productStructureGraphTitleAdjustment: graphTitleAdjustment.adjustment,
        keywordScore,
        lexicalOverlap,
        vendorMatch,
        vendorMismatch,
        topicMatch,
        topicExactMatch,
        policyTitleMatch,
        sourceQualityWarnings: sourceQuality.warnings,
      },
      sourceQuality,
    };
  }

  private async searchVectorCandidates(queryEmbedding: number[], limit: number, intent: QueryIntent): Promise<SearchResult[]> {
    try {
      console.log('🔍 벡터 검색 RPC 함수 호출 시도');
      const { data, error } = await this.supabase.rpc('search_ollama_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.001,
        match_count: limit * 3
      });

      if (error) {
      console.warn('Vector RPC failed; keyword channel will continue', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
        return [];
      }

      console.log(`✅ 벡터 검색 RPC 함수 성공: ${data?.length || 0}개`);
      return (data || [])
        .map((result: any) => this.normalizeCandidate(result, {
          queryEmbedding,
          intent,
          retrievalMethod: 'vector',
          corpus: 'ollama_document_chunks',
          evidenceType: 'vector',
        }))
        .filter((result: SearchResult | null): result is SearchResult => result !== null);
    } catch (error) {
      console.warn('Vector retrieval failed; keyword channel will continue', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return [];
    }
  }

  private async searchKeywordCandidates(query: string, limit: number, intent: QueryIntent): Promise<SearchResult[]> {
    const keywords = intent.keywords;
    console.log('🔍 Hybrid keyword 검색:', keywords);

    if (keywords.length === 0) {
      return [];
    }

    const keywordVendor = this.isBroadProductStructureRetrievalIntent(intent) && intent.vendors.length === 1
      ? intent.vendors[0]
      : undefined;
    const [ollamaResults, documentChunkResults] = await Promise.all([
      this.searchKeywordTable('ollama_document_chunks', keywords, limit, intent, keywordVendor),
      this.searchKeywordTable('document_chunks', keywords, limit, intent, keywordVendor)
    ]);

    return [...ollamaResults, ...documentChunkResults]
      .map((result) => this.normalizeCandidate(result.row, {
        keywords,
        intent,
        retrievalMethod: 'keyword',
        corpus: result.corpus,
        evidenceType: 'keyword',
      }))
      .filter((result: SearchResult | null): result is SearchResult => result !== null);
  }

  private async searchGenericRightsPolicyPriorityCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (!this.isGenericRightsPolicyPriorityIntent(intent)) {
      return [];
    }

    const anchors = [
      '상표',
      '상표권',
      '서비스표권',
      '초상권',
      '저작권',
      '권리보호',
      '권리 보호',
      '권리 침해',
      '권리침해',
      '타인의 권리',
      '타인 권리',
      '무단 사용',
      '허가 없이',
      '동의 없이',
      '광고문안과 권리보호',
    ];
    const keywords = Array.from(new Set([
      ...intent.keywords,
      ...intent.adPolicyTerms,
      ...anchors,
    ]));
    const [documentChunkResults, ollamaResults] = await Promise.all([
      this.searchKeywordTable('document_chunks', anchors, 18, intent, undefined, { rawKeywordsOnly: true }),
      this.searchKeywordTable('ollama_document_chunks', anchors, 12, intent, undefined, { rawKeywordsOnly: true }),
    ]);

    return [...documentChunkResults, ...ollamaResults]
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'hybrid',
          corpus: result.corpus,
          evidenceType: 'hybrid',
        });

        if (!candidate) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        if (!this.hasGenericRightsPolicyPrioritySignal(sourceText)) return null;

        const titleText = this.normalizeSearchText(candidate.documentTitle || '');
        const policyTitleSignal = candidate.policyTitleMatch
          || /집행\s*기준|광고\s*등록\s*기준|광고등록기준|운영\s*정책|운영정책|광고\s*정책|정책|심사|가이드|윤리|권리\s*보호|권리보호|상표\s*사용/.test(sourceText);
        if (!policyTitleSignal) return null;
        if (/공지사항|자주\s*묻는\s*질문|faq|목록|전체보기|검색결과/.test(titleText) && !/정책|집행|등록기준|권리\s*보호|권리보호|상표\s*사용/.test(sourceText)) {
          return null;
        }
        if (this.isTermsOfServiceCandidate(candidate) && !/광고문안|권리\s*보호|권리보호|상표권|서비스표권|초상권|저작권|타인의\s*권리|타인\s*권리|광고\s*소재/.test(sourceText)) {
          return null;
        }

        const hasTrademarkSignal = /상표|상표권|서비스표권|표장/.test(sourceText);
        const hasPortraitSignal = /초상권|성명권|인격권/.test(sourceText);
        const hasCopyrightSignal = /저작권|저작물|콘텐츠\s*권리/.test(sourceText);
        const hasRightsSignal = /권리\s*보호|권리보호|권리\s*침해|권리침해|타인의\s*권리|타인\s*권리|무단|허가|동의|침해/.test(sourceText);
        const exactSignalCount = [hasTrademarkSignal, hasPortraitSignal, hasCopyrightSignal, hasRightsSignal]
          .filter(Boolean).length;
        const boostedScore = Math.max(
          hasTrademarkSignal && hasPortraitSignal ? 0.99 : hasTrademarkSignal && hasRightsSignal ? 0.96 : 0.9,
          Math.min(1, (candidate.hybridScore || 0) + 0.42 + exactSignalCount * 0.04),
        );

        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.topicMatch = true;
        candidate.topicExactMatch = true;
        candidate.policyTitleMatch = true;
        candidate.retrievalMethod = 'hybrid';
        candidate.evidenceType = 'hybrid';
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'generic_rights_policy_priority',
          'rights_policy_signal',
          'hybrid_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          'generic_rights_policy_priority',
          ...(hasTrademarkSignal ? ['rights_trademark_signal'] : []),
          ...(hasPortraitSignal ? ['rights_portrait_signal'] : []),
          ...(hasCopyrightSignal ? ['rights_copyright_signal'] : []),
          ...(hasRightsSignal ? ['rights_infringement_signal'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          policyTitleMatch: true,
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, hasTrademarkSignal && hasPortraitSignal ? 0.96 : 0.88),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          retrievalMethod: 'hybrid',
          evidenceType: 'hybrid',
          genericRightsPolicyPriority: true,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          topicMatch: true,
          topicExactMatch: true,
          policyTitleMatch: true,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((result: SearchResult | null): result is SearchResult => result !== null);
  }

  private async searchGenericGamblingPolicyPriorityCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (!this.isGenericGamblingPolicyPriorityIntent(intent)) {
      return [];
    }

    const anchors = [
      '도박',
      '사행성',
      '사행 행위',
      '사행행위',
      '온라인 도박',
      '카지노',
      '베팅',
      '경마',
      '경륜',
      '경정',
      '사행성을 조장',
      '광고 집행 불가',
      '광고 게재제한',
      '등록불가 업종',
      '온라인 도박 및 게임 광고 정책',
    ];
    const keywords = Array.from(new Set([
      ...intent.keywords,
      ...intent.adPolicyTerms,
      ...anchors,
    ]));
    const [documentChunkResults, ollamaResults] = await Promise.all([
      this.searchKeywordTable('document_chunks', anchors, 18, intent, undefined, { rawKeywordsOnly: true }),
      this.searchKeywordTable('ollama_document_chunks', anchors, 18, intent, undefined, { rawKeywordsOnly: true }),
    ]);

    return [...documentChunkResults, ...ollamaResults]
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'hybrid',
          corpus: result.corpus,
          evidenceType: 'hybrid',
        });

        if (!candidate) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        if (!this.hasGenericGamblingPolicyPrioritySignal(sourceText)) return null;

        const titleText = this.normalizeSearchText(candidate.documentTitle || '');
        const policyTitleSignal = candidate.policyTitleMatch
          || /집행\s*기준|준수사항|업종별\s*가이드|심사\s*가이드|운영\s*정책|운영정책|광고\s*정책|정책|게재\s*제한|등록\s*불가|제한\s*업종|온라인\s*도박/.test(sourceText);
        if (!policyTitleSignal) return null;
        if (/마스트헤드|상품\s*소개|상품소개|캠페인\s*목표|도움말|faq|목록|검색결과/.test(titleText) && !/정책|집행|준수사항|게재\s*제한|등록\s*불가|온라인\s*도박/.test(sourceText)) {
          return null;
        }

        const hasDirectGamblingSignal = /도박|온라인\s*도박|카지노|베팅|배팅|경마|경륜|경정|복권|포커|빙고/.test(sourceText);
        const hasSpeculativeSignal = /사행|사행성|사행\s*행위|사행행위|확률형|랜덤박스/.test(sourceText);
        const hasRestrictionSignal = /불가|제한|금지|게재\s*제한|집행\s*불가|광고\s*집행\s*불가|광고\s*불가|등록\s*불가|승인|인증/.test(sourceText);
        const exactSignalCount = [hasDirectGamblingSignal, hasSpeculativeSignal, hasRestrictionSignal]
          .filter(Boolean).length;
        const boostedScore = Math.max(
          hasDirectGamblingSignal && hasSpeculativeSignal ? 0.99 : 0.94,
          Math.min(1, (candidate.hybridScore || 0) + 0.44 + exactSignalCount * 0.05),
        );

        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.topicMatch = true;
        candidate.topicExactMatch = true;
        candidate.policyTitleMatch = true;
        candidate.retrievalMethod = 'hybrid';
        candidate.evidenceType = 'hybrid';
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'generic_gambling_policy_priority',
          ...(hasDirectGamblingSignal ? ['gambling_direct_signal'] : []),
          ...(hasSpeculativeSignal ? ['gambling_speculative_signal'] : []),
          ...(hasRestrictionSignal ? ['gambling_restriction_signal'] : []),
          'hybrid_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          'generic_gambling_policy_priority',
          ...(hasDirectGamblingSignal ? ['gambling_direct_match'] : []),
          ...(hasSpeculativeSignal ? ['gambling_speculative_match'] : []),
          ...(hasRestrictionSignal ? ['gambling_restriction_match'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          policyTitleMatch: true,
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, hasDirectGamblingSignal && hasSpeculativeSignal ? 0.96 : 0.88),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          retrievalMethod: 'hybrid',
          evidenceType: 'hybrid',
          genericGamblingPolicyPriority: true,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          topicMatch: true,
          topicExactMatch: true,
          policyTitleMatch: true,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((result: SearchResult | null): result is SearchResult => result !== null);
  }

  private async searchKakaoServiceProtectionPolicyCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (!this.isKakaoServiceProtectionPolicyIntent(intent)) {
      return [];
    }

    const anchors = [
      '카카오 서비스 보호',
      '카카오 서비스 로고',
      '카카오 서비스 및 디자인',
      '카카오의 로고',
      '카카오 로고',
      '카카오 디자인',
      '서비스명',
      '저작물',
      '상표',
      '모방',
      '침해',
      '무단 사용',
      '집행기준',
      '준수사항',
    ];
    const keywords = Array.from(new Set([
      ...getCompassVendorTerms('KAKAO'),
      ...intent.keywords,
      ...intent.adPolicyTerms,
      ...intent.strictContextTerms,
      ...anchors,
    ]));
    const [documentChunkResults, ollamaResults, vendorMetadataResults] = await Promise.all([
      this.searchKeywordTable('document_chunks', anchors, 18, intent, undefined, { rawKeywordsOnly: true }),
      this.searchKeywordTable('ollama_document_chunks', anchors, 14, intent, 'KAKAO', { rawKeywordsOnly: true }),
      this.searchVendorMetadataTable('ollama_document_chunks', 'KAKAO', anchors, 8, intent),
    ]);

    return [
      ...documentChunkResults.map(result => ({ ...result, anchor: 'kakao_service_protection_document' })),
      ...ollamaResults.map(result => ({ ...result, anchor: 'kakao_service_protection_ollama' })),
      ...vendorMetadataResults.map(result => ({ ...result, anchor: 'kakao_service_protection_vendor_metadata' })),
    ]
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'hybrid',
          corpus: result.corpus,
          evidenceType: 'hybrid',
        });

        if (!candidate) return null;
        if (this.hasExplicitOtherVendorSignal(candidate, 'KAKAO')) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        if (!this.hasKakaoServiceProtectionPolicySignal(sourceText)) return null;

        const hasExactServiceProtectionSignal = /카카오\s*서비스\s*보호|카카오\s*서비스(?:의)?\s*(?:로고|디자인|이미지)|카카오의\s*로고|카카오\s*로고/.test(sourceText);
        const hasImitationSignal = /모방|침해|무단|사용\s*불가|발송\s*불가|집행\s*불가|광고\s*집행\s*불가/.test(sourceText);
        const hasRightsAssetSignal = /로고|디자인|서비스명|상표|저작물|이미지/.test(sourceText);
        const boostedScore = Math.max(
          hasExactServiceProtectionSignal ? 0.99 : 0.94,
          Math.min(1, (candidate.hybridScore || 0) + 0.46 + (hasImitationSignal ? 0.06 : 0) + (hasRightsAssetSignal ? 0.04 : 0)),
        );

        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.sourceVendor = 'KAKAO';
        candidate.sourceVendors = Array.from(new Set([
          ...(candidate.sourceVendors || []),
          'KAKAO',
        ]));
        candidate.vendorMatch = true;
        candidate.vendorMismatch = false;
        candidate.topicMatch = true;
        candidate.topicExactMatch = true;
        candidate.policyTitleMatch = true;
        candidate.retrievalMethod = 'hybrid';
        candidate.evidenceType = 'hybrid';
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'kakao_service_protection_priority',
          ...(hasExactServiceProtectionSignal ? ['kakao_service_protection_exact_signal'] : []),
          ...(hasImitationSignal ? ['kakao_service_imitation_restriction_signal'] : []),
          'hybrid_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `kakao_service_protection_priority_${result.anchor}`,
          ...(hasExactServiceProtectionSignal ? ['kakao_service_protection_exact_match'] : []),
          ...(hasRightsAssetSignal ? ['kakao_service_asset_rights_match'] : []),
          ...(hasImitationSignal ? ['kakao_service_imitation_restriction_match'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          vendorMatch: true,
          vendorMismatch: false,
          sourceVendor: 'KAKAO',
          policyTitleMatch: true,
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, hasExactServiceProtectionSignal ? 0.98 : 0.9),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          source_vendor: 'KAKAO',
          sourceVendors: candidate.sourceVendors,
          retrievalMethod: 'hybrid',
          evidenceType: 'hybrid',
          kakaoServiceProtectionPriority: true,
          policyAnchor: result.anchor,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          topicMatch: true,
          topicExactMatch: true,
          policyTitleMatch: true,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((result: SearchResult | null): result is SearchResult => result !== null);
  }

  private async searchVendorCoverageCandidates(query: string, limit: number, intent: QueryIntent): Promise<SearchResult[]> {
    if (intent.vendors.length === 0) {
      return [];
    }

    const normalizedQuery = normalizeCompassSearchText(query);
    const queryKeywords = intent.keywords.filter((keyword) => (
      !intent.vendors.some((vendor) => getCompassVendorTerms(vendor).some(term => term === keyword))
    ));
    const topicKeywords = queryKeywords.length > 0 ? queryKeywords : intent.keywords;

    const results = await Promise.all(intent.vendors.map(async (vendor) => {
      const vendorTerms = getCompassVendorTerms(vendor);
      const vendorKeywords = Array.from(new Set([
        ...vendorTerms,
        ...topicKeywords,
        normalizedQuery.includes('효능') ? '효능' : '',
        normalizedQuery.includes('효과') ? '효과' : '',
        normalizedQuery.includes('보장') ? '보장' : '',
        normalizedQuery.includes('입증') ? '입증' : '',
        normalizedQuery.includes('심사') ? '심사' : '',
        normalizedQuery.includes('정책') ? '정책' : '',
      ].filter(Boolean))).slice(0, 24);

      const [
        ollamaResults,
        documentChunkResults,
        vendorOllamaResults,
        vendorDocumentChunkResults,
      ] = await Promise.all([
        this.searchKeywordTable('ollama_document_chunks', vendorKeywords, limit, intent, vendor),
        this.searchKeywordTable('document_chunks', vendorKeywords, limit, intent, vendor),
        this.searchVendorMetadataTable('ollama_document_chunks', vendor, vendorKeywords, limit, intent),
        this.searchVendorMetadataTable('document_chunks', vendor, vendorKeywords, limit, intent)
      ]);

      return [...vendorOllamaResults, ...vendorDocumentChunkResults, ...ollamaResults, ...documentChunkResults]
        .map((result) => {
          const candidate = this.normalizeCandidate(result.row, {
            keywords: vendorKeywords,
            intent,
            retrievalMethod: 'keyword',
            corpus: result.corpus,
            evidenceType: 'keyword',
          });

          if (!candidate) return null;
          const evidenceText = this.buildCandidateEvidenceText(
            candidate.content,
            candidate.documentTitle,
            candidate.metadata
          );
          const normalizedEvidenceText = this.normalizeSearchText(evidenceText);

          if (
            intent.topics.includes('product_structure')
            && intent.isSpecificProductGuidance
          ) {
            if (this.isOffAxisProductStructureEvidence(normalizedEvidenceText, intent)) {
              return null;
            }
            if (!this.hasSpecificProductTermMatch(evidenceText, intent)) {
              return null;
            }
          if (this.isBroadProductStructureOnlyText(evidenceText, intent)) {
            return null;
          }
          if (
              !this.hasSpecificProductAnswerableSignalForIntent(evidenceText, intent)
              && !(this.isNaverShoppingDataIntent(intent) && this.hasStrongNaverShoppingDataSignal(evidenceText))
              && !(this.isKakaoBizboardDisplayProductIntent(intent) && this.hasKakaoBizboardDisplaySignal(evidenceText))
            ) {
              return null;
            }
            if (this.isOffTopicSpecificProductEvidence(evidenceText, intent)) {
              return null;
            }
          }

          if (this.matchesVendorSlot(candidate, vendor)) {
            const boostedScore = Math.min(1, (candidate.hybridScore || 0) + 0.08);
            candidate.hybridScore = boostedScore;
            candidate.score = boostedScore;
            candidate.rankReason = Array.from(new Set([
              ...(candidate.rankReason || []),
              `vendor_coverage_probe_${vendor.toLowerCase()}`,
            ]));
            candidate.metadata = {
              ...(candidate.metadata || {}),
              coverageProbeVendor: vendor,
              rankReason: candidate.rankReason,
              score: boostedScore,
              hybridScore: boostedScore,
            };
          }

          return candidate;
        })
        .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
    }));

    return results.flat();
  }

  private async searchNaverProductStructurePriorityCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (!intent.topics.includes('product_structure') || intent.vendors[0] !== 'NAVER') {
      return [];
    }

    const anchors = [
      '사이트검색광고',
      '파워링크',
      '브랜드검색',
      '쇼핑검색',
      '쇼핑몰 상품형',
      '쇼핑검색광고',
      '네이버 DA',
      'DA 상품',
      '성과형 디스플레이',
      '디스플레이 광고',
      '홈피드',
      '스마트채널',
      '타임보드',
      '롤링보드',
      '동영상 광고',
      '동영상 소재',
      '비디오 광고',
      '상품등록 절차',
      'DB URL',
      'DBURL',
      'EP',
      'EP(=DB URL)',
      '상품 DB URL',
      '상품DB URL',
      '상품정보 수신 현황',
      '등록요청',
      '입점심사',
      '카테고리 자동매칭',
      '신규상품 등록',
      '네이버 가격비교',
      '상품관리',
      '쇼핑파트너센터',
      '쇼핑블록',
      'PC 쇼핑블록',
      '모바일 쇼핑',
    ];
    const keywords = Array.from(new Set([
      ...getCompassVendorTerms('NAVER'),
      ...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS,
      ...anchors,
    ]));

    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    const usesShoppingDataIntent = /db\s*url|dburl|상품\s*db|상품db|상품등록|상품\s*등록|ep|상품정보\s*수신|등록\s*요청|등록요청|쇼핑파트너센터|카테고리|입점\s*심사|가격비교/.test(queryText);
    const shoppingDataAnchors = [
      '쇼핑검색광고',
      '쇼핑몰 상품형',
      '상품등록 절차',
      'DB URL',
      'DBURL',
      'EP',
      'EP(=DB URL)',
      '상품 DB URL',
      '상품DB URL',
      '상품정보 수신 현황',
      '등록요청',
      '입점심사',
      '카테고리 자동매칭',
      '신규상품 등록',
      '네이버 가격비교',
      '상품관리',
      '쇼핑파트너센터',
    ];
    const usesDisplayAdIntent = this.isNaverDisplayAdIntent(intent);
    const usesShoppingSearchCreativeIntent = this.isNaverShoppingSearchCreativeIntent(intent);
    const usesVideoProductIntent = this.isNaverVideoProductIntent(intent);
    const displayAnchors = [
      '네이버 DA',
      'DA 상품',
      'DA상품',
      '보장형 DA',
      '성과형 디스플레이',
      '디스플레이 광고',
      '홈피드DA',
      '홈피드',
      '스마트채널',
      '타임보드',
      '롤링보드',
      '배너 광고',
      'PC 헤드라인DA',
    ];
    const shoppingSearchCreativeAnchors = [
      '쇼핑검색광고',
      '쇼핑검색',
      '쇼핑 광고',
      '쇼핑몰 상품형',
      '상품명',
      '대표이미지',
      '소재',
      '랜딩',
      '심사',
      '검수',
      '광고등록기준',
      '쇼핑블록',
    ];
    const videoProductAnchors = [
      '동영상 광고',
      '동영상조회광고',
      '동영상 조회',
      '동영상 소재',
      '비디오 광고',
      '숏폼 아웃스트림',
      '숏폼 광고',
      '아웃스트림 광고',
      '인스트림 광고',
      '네이버 클립',
      '클립 서비스',
      '성과형 디스플레이',
    ];
    const priorityAnchors = usesShoppingDataIntent
      ? Array.from(new Set(shoppingDataAnchors))
      : usesDisplayAdIntent
        ? Array.from(new Set(displayAnchors))
      : usesVideoProductIntent
        ? Array.from(new Set(videoProductAnchors))
      : usesShoppingSearchCreativeIntent
        ? Array.from(new Set(shoppingSearchCreativeAnchors))
      : anchors.slice(0, intent.isSpecificProductGuidance ? 12 : 8);

    if (usesVideoProductIntent) {
      const officialChunkResults = await this.searchKnownOfficialDocumentChunks(
        NAVER_VIDEO_OFFICIAL_CHUNK_IDS,
        1,
        intent,
        'NAVER',
        'naver_video_official_chunk',
      );
      const officialChunkCandidates = this.normalizeNaverProductStructurePriorityResults(
        officialChunkResults,
        keywords,
        intent,
        {
          usesDisplayAdIntent,
          usesVideoProductIntent,
          usesShoppingSearchCreativeIntent,
        },
      );
      if (officialChunkCandidates.length > 0) {
        return officialChunkCandidates;
      }
    }

    const results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }> = [];
    if (usesShoppingDataIntent) {
      const [documentKeywordResults, ollamaKeywordResults, ollamaMetadataResults] = await Promise.all([
        this.searchKeywordTable('document_chunks', priorityAnchors, 12, intent, 'NAVER'),
        this.searchKeywordTable('ollama_document_chunks', priorityAnchors, 8, intent, 'NAVER'),
        this.searchVendorMetadataTable('ollama_document_chunks', 'NAVER', priorityAnchors, 8, intent),
      ]);
      results.push(
        ...documentKeywordResults.map((result) => ({ ...result, anchor: 'naver_shopping_data_keyword' })),
        ...ollamaKeywordResults.map((result) => ({ ...result, anchor: 'naver_shopping_data_keyword' })),
        ...ollamaMetadataResults.map((result) => ({ ...result, anchor: 'naver_shopping_data_metadata' })),
      );
    } else {
      const usesRawNaverGuideAnchors = usesDisplayAdIntent || usesVideoProductIntent;
      const keywordSearchOptions = usesRawNaverGuideAnchors ? { rawKeywordsOnly: true } : {};
      const keywordVendor = usesRawNaverGuideAnchors ? undefined : 'NAVER';
      const documentKeywordLimit = usesVideoProductIntent ? 8 : 14;
      const ollamaKeywordLimit = usesVideoProductIntent ? 6 : 12;
      const metadataKeywordLimit = usesVideoProductIntent ? 0 : 8;
      const [documentKeywordResults, ollamaKeywordResults, ollamaMetadataResults] = await Promise.all([
        this.searchKeywordTable('document_chunks', priorityAnchors, documentKeywordLimit, intent, keywordVendor, keywordSearchOptions),
        this.searchKeywordTable('ollama_document_chunks', priorityAnchors, ollamaKeywordLimit, intent, keywordVendor, keywordSearchOptions),
        metadataKeywordLimit > 0
          ? this.searchVendorMetadataTable('ollama_document_chunks', 'NAVER', priorityAnchors, metadataKeywordLimit, intent)
          : Promise.resolve([]),
      ]);
      results.push(
        ...documentKeywordResults.map((result) => ({ ...result, anchor: 'naver_product_structure_priority_keyword' })),
        ...ollamaKeywordResults.map((result) => ({ ...result, anchor: 'naver_product_structure_priority_keyword' })),
        ...ollamaMetadataResults.map((result) => ({ ...result, anchor: 'naver_product_structure_priority_metadata' })),
      );
    }

    return this.normalizeNaverProductStructurePriorityResults(
      results,
      keywords,
      intent,
      {
        usesDisplayAdIntent,
        usesVideoProductIntent,
        usesShoppingSearchCreativeIntent,
      },
    );
  }

  private normalizeNaverProductStructurePriorityResults(
    results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }>,
    keywords: string[],
    intent: QueryIntent,
    options: {
      usesDisplayAdIntent: boolean;
      usesVideoProductIntent: boolean;
      usesShoppingSearchCreativeIntent: boolean;
    },
  ): SearchResult[] {
    const {
      usesDisplayAdIntent,
      usesVideoProductIntent,
      usesShoppingSearchCreativeIntent,
    } = options;

    return results
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'keyword',
          corpus: result.corpus,
          evidenceType: 'keyword',
        });

        if (!candidate) return null;
        if (this.hasExplicitOtherVendorSignal(candidate, 'NAVER')) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        if (!this.hasNaverProductStructureSignal(sourceText)) return null;
        if (usesDisplayAdIntent && !this.hasNaverDisplayProductGuideSignal(sourceText)) return null;
        if (usesVideoProductIntent && !this.hasNaverVideoProductGuideSignal(sourceText)) return null;
        if (usesShoppingSearchCreativeIntent && !this.hasNaverShoppingSearchCreativeGuideSignal(sourceText)) return null;

        const isShoppingDataIntent = this.isNaverShoppingDataIntent(intent);
        const hasShoppingDataSignal = this.hasNaverShoppingDataSignal(sourceText);
        const hasStrongShoppingDataSignal = this.hasStrongNaverShoppingDataSignal(sourceText);
        const hasShoppingSearchCreativeSignal = usesShoppingSearchCreativeIntent && this.hasNaverShoppingSearchCreativeGuideSignal(sourceText);
        const hasVideoProductSignal = usesVideoProductIntent && this.hasNaverVideoProductGuideSignal(sourceText);
        const boostedScore = isShoppingDataIntent && hasStrongShoppingDataSignal
          ? Math.max(0.995, Math.min(1, (candidate.hybridScore || 0) + 0.75))
          : isShoppingDataIntent && hasShoppingDataSignal
            ? Math.max(0.9, Math.min(0.97, (candidate.hybridScore || 0) + 0.35))
          : hasShoppingSearchCreativeSignal
            ? Math.max(0.92, Math.min(0.98, (candidate.hybridScore || 0) + 0.34))
          : hasVideoProductSignal
            ? Math.max(0.92, Math.min(0.98, (candidate.hybridScore || 0) + 0.34))
            : Math.min(0.88, (candidate.hybridScore || 0) + 0.22);
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.sourceVendor = 'NAVER';
        candidate.sourceVendors = Array.from(new Set([
          ...(candidate.sourceVendors || []),
          'NAVER',
        ]));
        candidate.vendorMatch = true;
        candidate.vendorMismatch = false;
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'naver_product_structure_priority',
          ...(isShoppingDataIntent && hasStrongShoppingDataSignal ? ['naver_shopping_data_strong_priority'] : []),
          ...(isShoppingDataIntent && hasShoppingDataSignal ? ['naver_shopping_data_priority'] : []),
          ...(hasShoppingSearchCreativeSignal ? ['naver_shopping_search_creative_priority'] : []),
          ...(hasVideoProductSignal ? ['naver_video_product_priority'] : []),
          'keyword_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `naver_product_structure_priority_${result.anchor}`,
          ...(isShoppingDataIntent && hasStrongShoppingDataSignal ? ['naver_shopping_data_strong_detail_priority'] : []),
          ...(isShoppingDataIntent && hasShoppingDataSignal ? ['naver_shopping_data_specific_priority'] : []),
          ...(hasShoppingSearchCreativeSignal ? ['naver_shopping_search_creative_specific_priority'] : []),
          ...(hasVideoProductSignal ? ['naver_video_product_specific_priority'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          vendorMatch: true,
          vendorMismatch: false,
          sourceVendor: 'NAVER',
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, hasStrongShoppingDataSignal ? 0.98 : hasShoppingDataSignal ? 0.86 : 0.8),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          source_vendor: 'NAVER',
          sourceVendors: candidate.sourceVendors,
          naverProductStructurePriority: true,
          productStructureAnchor: result.anchor,
          naverShoppingDataPriority: isShoppingDataIntent && hasShoppingDataSignal,
          naverShoppingDataStrongPriority: isShoppingDataIntent && hasStrongShoppingDataSignal,
          naverShoppingSearchCreativePriority: hasShoppingSearchCreativeSignal,
          naverVideoProductPriority: hasVideoProductSignal,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private selectNaverProductPriorityRescueCandidates(
    candidates: SearchResult[],
    limit: number,
    intent: QueryIntent,
  ): SearchResult[] {
    if (intent.vendors.length !== 1 || intent.vendors[0] !== 'NAVER') return [];

    const seen = new Set<string>();
    return candidates
      .filter((candidate) => {
        if (!this.matchesVendorSlot(candidate, 'NAVER')) return false;
        if (this.hasExplicitOtherVendorSignal(candidate, 'NAVER')) return false;

        const sourceText = this.buildCandidateEvidenceText(
          candidate.content,
          candidate.documentTitle,
          candidate.metadata,
        );
        if (!this.hasNaverProductStructureSignal(sourceText)) return false;
        if (this.isNaverDisplayAdIntent(intent) && !this.hasNaverDisplayProductGuideSignal(sourceText)) return false;
        if (this.isNaverVideoProductIntent(intent) && !this.hasNaverVideoProductGuideSignal(sourceText)) return false;
        if (this.isNaverShoppingSearchCreativeIntent(intent) && !this.hasNaverShoppingSearchCreativeGuideSignal(sourceText)) return false;
        if (this.isOffTopicSpecificProductEvidence(sourceText, intent)) return false;
        return true;
      })
      .sort((a, b) => this.scoreSearchCandidateForRanking(b, intent) - this.scoreSearchCandidateForRanking(a, intent))
      .filter((candidate) => {
        const key = this.buildCandidateDedupeKey(candidate);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit)
      .map((candidate) => ({
        ...candidate,
        rankReason: Array.from(new Set([
          ...(candidate.rankReason || []),
          'naver_product_structure_priority_rescue',
        ])),
        metadata: {
          ...(candidate.metadata || {}),
          naverProductStructurePriorityRescue: true,
        },
      }));
  }

  private selectKakaoProductPriorityRescueCandidates(
    candidates: SearchResult[],
    limit: number,
    intent: QueryIntent,
  ): SearchResult[] {
    if (!this.isKakaoBizboardDisplayProductIntent(intent)) return [];

    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    const asksCreativeGuide = /제작|소재|가이드|이미지|비율|문구|카피|사이즈|리사이징|지면|노출/.test(queryText);
    const asksAuditGuide = /집행|심사|기준|준수|업종|제한|등록\s*불가|금지|검수/.test(queryText);
    const seen = new Set<string>();

    return candidates
      .filter((candidate) => {
        if (!this.matchesVendorSlot(candidate, 'KAKAO')) return false;
        if (this.hasExplicitOtherVendorSignal(candidate, 'KAKAO')) return false;

        const sourceText = this.buildCandidateEvidenceText(
          candidate.content,
          candidate.documentTitle,
          candidate.metadata,
        );
        if (!this.hasKakaoBizboardDisplaySignal(sourceText)) return false;
        if (this.isKakaoMeasurementOnlySource(sourceText, intent)) return false;

        const hasCreativeGuideSignal = /제작\s*가이드|제작가이드|소재|홍보이미지|행동유도버튼|닫힘버튼|메인\s*카피|서브\s*카피|이미지\s*세부\s*가이드|외곽\s*테두리|리사이징|비율|사이즈|노출\s*지면|지면/.test(sourceText);
        const hasAuditGuideSignal = /심사\s*가이드|집행\s*기준|준수사항|업종별\s*가이드|광고\s*가능\s*업종|등록\s*불가|금지\s*행위|소재\s*제한|업종\s*제한/.test(sourceText);
        const hasProductGuideSignal = /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard|디스플레이\s*광고|디스플레이광고|카카오모먼트|상품가이드|상품\s*가이드/.test(sourceText);

        if (asksCreativeGuide && hasCreativeGuideSignal) return true;
        if (asksAuditGuide && hasAuditGuideSignal) return true;
        return hasProductGuideSignal && (hasCreativeGuideSignal || hasAuditGuideSignal);
      })
      .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))
      .filter((candidate) => {
        const key = this.getDedupeKeys(candidate)[0] || candidate.id;
        if (seen.has(key)) return false;
        seen.add(key);
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          'kakao_priority_guide_rescue',
        ]));
        candidate.metadata = {
          ...(candidate.metadata || {}),
          kakaoPriorityGuideRescue: true,
          rankReason: candidate.rankReason,
        };
        return true;
      })
      .slice(0, limit);
  }

  private async searchMetaAppInstallPriorityCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (!this.isMetaAppInstallIntent(intent)) {
      return [];
    }

    const anchors = [
      '앱 이벤트',
      '모바일 측정 파트너',
      'Mobile Measurement Partner',
      'MMP',
      'Meta SDK',
      'Facebook SDK',
      'SDK',
      '앱 홍보',
      '앱홍보',
      '앱 설치',
      '앱설치',
      '앱 인스톨',
      '앱인스톨',
      'App Promotion',
      'App Install',
      '모바일 앱',
    ];
    const keywords = Array.from(new Set([
      ...getCompassVendorTerms('META'),
      ...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS,
      ...anchors,
    ]));

    const officialChunkResults = await this.searchKnownOfficialDocumentChunks(
      META_APP_INSTALL_OFFICIAL_CHUNK_IDS,
      3,
      intent,
      'META',
      'meta_app_install_official_chunk',
    );
    const officialCandidates = this.normalizeMetaAppInstallPriorityResults(officialChunkResults, keywords, intent);
    if (officialCandidates.length > 0) {
      return officialCandidates;
    }

    const priorityAnchors = anchors.slice(0, 12);
    const keywordSearchOptions = { rawKeywordsOnly: true };
    const [
      documentKeywordResults,
      ollamaKeywordResults,
      vendorMetadataResults,
      setupAnchorResultGroups,
    ] = await Promise.all([
      this.searchKeywordTable('document_chunks', priorityAnchors, 16, intent, undefined, keywordSearchOptions),
      this.searchKeywordTable('ollama_document_chunks', priorityAnchors, 6, intent, undefined, keywordSearchOptions),
      this.searchVendorMetadataTable('ollama_document_chunks', 'META', priorityAnchors, 4, intent),
      Promise.all(['MMP', 'Facebook SDK'].map(anchor => (
        this.searchProductStructureAnchorTable('document_chunks', anchor, 4, undefined, intent)
      ))),
    ]);
    const setupAnchorResults = setupAnchorResultGroups.flat();
    const results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }> = [
      ...documentKeywordResults.map(result => ({
        ...result,
        anchor: 'meta_app_install_priority_keyword',
      })),
      ...ollamaKeywordResults.map(result => ({
        ...result,
        anchor: 'meta_app_install_priority_keyword',
      })),
      ...vendorMetadataResults.map(result => ({
        ...result,
        anchor: 'meta_app_install_vendor_metadata',
      })),
      ...setupAnchorResults.map(result => ({
        ...result,
        anchor: `meta_app_install_setup_anchor_${result.anchor}`,
      })),
    ];

    return this.normalizeMetaAppInstallPriorityResults(results, keywords, intent);
  }

  private normalizeMetaAppInstallPriorityResults(
    results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }>,
    keywords: string[],
    intent: QueryIntent,
  ): SearchResult[] {
    return results
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'keyword',
          corpus: result.corpus,
          evidenceType: 'keyword',
        });

        if (!candidate) return null;
        if (this.hasExplicitOtherVendorSignal(candidate, 'META')) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        const normalizedSourceText = this.normalizeSearchText(sourceText);
        if (
          !this.matchesVendorSlot(candidate, 'META')
          && !/meta|facebook|instagram|페이스북|인스타그램|business\/help|business\/ads-guide/.test(normalizedSourceText)
        ) {
          return null;
        }
        if (this.isMetaBroadProductNewsNoiseText(sourceText)) return null;
        if (!this.hasMetaAppInstallSignal(sourceText)) return null;

        const hasMeasurementSetupSignal = /sdk|mmp|mobile\s*measurement\s*partner|모바일\s*측정\s*파트너|measurement|측정|연동|설정|세팅|앱\s*이벤트|app\s*event|이벤트\s*관리자|포스트백|postback|app\s*id|app\s*secret|앱\s*id|앱\s*시크릿/i.test(sourceText);
        const hasProcedureSignal = hasMeasurementSetupSignal
          || /최적화|스토어|store|랜딩|소재|문구|cta|앱\s*설치|앱\s*홍보|app\s*(install|promotion)/i.test(sourceText);
        const boostedScore = Math.max(
          hasMeasurementSetupSignal ? 0.99 : hasProcedureSignal ? 0.94 : 0.84,
          Math.min(hasMeasurementSetupSignal ? 1 : hasProcedureSignal ? 0.96 : 0.9, (candidate.hybridScore || 0) + (hasMeasurementSetupSignal ? 0.5 : hasProcedureSignal ? 0.32 : 0.12))
        );
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.sourceVendor = 'META';
        candidate.sourceVendors = Array.from(new Set([
          ...(candidate.sourceVendors || []),
          'META',
        ]));
        candidate.vendorMatch = true;
        candidate.vendorMismatch = false;
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'meta_app_install_priority',
          ...(hasMeasurementSetupSignal ? ['meta_app_install_measurement_setup_signal'] : []),
          ...(hasProcedureSignal ? ['meta_app_install_procedure_signal'] : []),
          'keyword_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `meta_app_install_priority_${result.anchor}`,
          ...(hasMeasurementSetupSignal ? ['meta_app_install_measurement_setup_priority'] : []),
          ...(hasProcedureSignal ? ['meta_app_install_detail_priority'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          vendorMatch: true,
          vendorMismatch: false,
          sourceVendor: 'META',
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, hasMeasurementSetupSignal ? 0.98 : hasProcedureSignal ? 0.9 : 0.78),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          source_vendor: 'META',
          sourceVendors: candidate.sourceVendors,
          metaAppInstallPriority: true,
          productStructureAnchor: result.anchor,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private async searchMetaCatalogPriorityCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (!this.isMetaCatalogIntent(intent)) {
      return [];
    }

    const anchors = [
      '카탈로그',
      'Catalog',
      '상품 카탈로그',
      'Product catalog',
      '컬렉션 광고',
      'Collection ads',
      'collection ads',
      'Advantage+ catalog',
      'Advantage+ Catalog',
      '어드밴티지 카탈로그',
      '상품 데이터',
      '상품 세트',
      'Shop',
      'Shops',
    ];
    const keywords = Array.from(new Set([
      ...getCompassVendorTerms('META'),
      ...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS,
      ...anchors,
    ]));

    const officialChunkResults = await this.searchKnownOfficialDocumentChunks(
      META_CATALOG_OFFICIAL_CHUNK_IDS,
      3,
      intent,
      'META',
      'meta_catalog_official_chunk',
    );
    const officialCandidates = this.normalizeMetaCatalogPriorityResults(officialChunkResults, keywords, intent);
    if (officialCandidates.length > 0) {
      return officialCandidates;
    }

    const priorityAnchors = anchors.slice(0, 12);
    const keywordSearchOptions = { rawKeywordsOnly: true };
    const [
      documentKeywordResults,
      ollamaKeywordResults,
      vendorMetadataResults,
    ] = await Promise.all([
      this.searchKeywordTable('document_chunks', priorityAnchors, 18, intent, undefined, keywordSearchOptions),
      this.searchKeywordTable('ollama_document_chunks', priorityAnchors, 10, intent, undefined, keywordSearchOptions),
      this.searchVendorMetadataTable('ollama_document_chunks', 'META', priorityAnchors, 8, intent),
    ]);
    const results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }> = [
      ...documentKeywordResults.map(result => ({
        ...result,
        anchor: 'meta_catalog_priority_keyword',
      })),
      ...ollamaKeywordResults.map(result => ({
        ...result,
        anchor: 'meta_catalog_priority_keyword',
      })),
      ...vendorMetadataResults.map(result => ({
        ...result,
        anchor: 'meta_catalog_vendor_metadata',
      })),
    ];

    return this.normalizeMetaCatalogPriorityResults(results, keywords, intent);
  }

  private normalizeMetaCatalogPriorityResults(
    results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }>,
    keywords: string[],
    intent: QueryIntent,
  ): SearchResult[] {
    return results
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'keyword',
          corpus: result.corpus,
          evidenceType: 'keyword',
        });

        if (!candidate) return null;
        if (this.hasExplicitOtherVendorSignal(candidate, 'META')) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        const normalizedSourceText = this.normalizeSearchText(sourceText);
        if (
          !this.matchesVendorSlot(candidate, 'META')
          && !/meta|facebook|instagram|페이스북|인스타그램|business\/help|business\/ads-guide/.test(normalizedSourceText)
        ) {
          return null;
        }
        if (this.isMetaBroadProductNewsNoiseText(sourceText)) return null;
        if (!this.hasMetaCatalogSignal(sourceText)) return null;

        const hasCatalogSetupSignal = /연동|연결|설정|세팅|상품\s*데이터|product\s*data|feed|피드|데이터\s*소스|commerce|커머스|shop|shops/i.test(sourceText);
        const hasCollectionSignal = /컬렉션|collection|collection\s*ads?|instant\s*experience|인스턴트\s*경험|advantage\+|어드밴티지/i.test(sourceText);
        const boostedScore = Math.max(
          hasCatalogSetupSignal ? 0.99 : hasCollectionSignal ? 0.96 : 0.9,
          Math.min(1, (candidate.hybridScore || 0) + (hasCatalogSetupSignal ? 0.5 : hasCollectionSignal ? 0.36 : 0.2)),
        );
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.sourceVendor = 'META';
        candidate.sourceVendors = Array.from(new Set([
          ...(candidate.sourceVendors || []),
          'META',
        ]));
        candidate.vendorMatch = true;
        candidate.vendorMismatch = false;
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'meta_catalog_priority',
          ...(hasCatalogSetupSignal ? ['meta_catalog_setup_signal'] : []),
          ...(hasCollectionSignal ? ['meta_catalog_collection_signal'] : []),
          'keyword_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `meta_catalog_priority_${result.anchor}`,
          ...(hasCatalogSetupSignal ? ['meta_catalog_setup_priority'] : []),
          ...(hasCollectionSignal ? ['meta_catalog_collection_priority'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          vendorMatch: true,
          vendorMismatch: false,
          sourceVendor: 'META',
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, hasCatalogSetupSignal ? 0.98 : hasCollectionSignal ? 0.92 : 0.84),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          source_vendor: 'META',
          sourceVendors: candidate.sourceVendors,
          metaCatalogPriority: true,
          productStructureAnchor: result.anchor,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private async searchMetaCreativeSpecPriorityCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (!this.isMetaCreativeSpecIntent(intent)) return [];

    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    const asksCarousel = /카루셀|캐러셀|carousel|슬라이드/.test(queryText);
    const asksInstagram = /instagram|인스타그램/.test(queryText);
    const anchors = Array.from(new Set([
      ...(asksCarousel ? ['Facebook 피드 카루셀', '카루셀 광고', '캐러셀', '슬라이드 광고', '슬라이드 수'] : []),
      ...(asksInstagram ? ['Instagram 탐색 홈', 'Instagram 피드', '인스타그램 광고 사양', 'Instagram 광고'] : []),
      '1080x1080',
      '1080픽셀',
      '광고 사양',
    ]));
    const keywords = Array.from(new Set([
      ...getCompassVendorTerms('META'),
      ...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS,
      ...this.buildSpecificProductAnchorTerms(intent),
      ...anchors,
    ]));
    const anchorGroups = await Promise.all(anchors.slice(0, 8).map(anchor => Promise.all([
      this.searchProductStructureAnchorTable('document_chunks', anchor, 8, undefined, intent),
      this.searchProductStructureAnchorTable('ollama_document_chunks', anchor, 6, undefined, intent),
    ])));
    const results = anchorGroups.flat(2);

    return results
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'hybrid',
          corpus: result.corpus,
          evidenceType: 'hybrid',
        });

        if (!candidate) return null;
        if (this.hasExplicitOtherVendorSignal(candidate, 'META')) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        const normalizedSourceText = this.normalizeSearchText(sourceText);
        if (
          !this.matchesVendorSlot(candidate, 'META')
          && !/meta|facebook|instagram|페이스북|인스타그램|business\/help|business\/ads-guide|광고\s*가이드/.test(normalizedSourceText)
        ) {
          return null;
        }
        if (this.isMetaBroadProductNewsNoiseText(sourceText)) return null;
        const titleText = this.normalizeSearchText(candidate.documentTitle || '');
        if (asksCarousel && /슬라이드쇼/.test(titleText)) return null;
        if (/광고\s*정책|ad\s*policy|policy/.test(titleText) && !/광고\s*가이드|ads?\s*guide|사양/.test(titleText)) return null;
        if (!this.hasSpecificProductTermMatch(sourceText, intent) && this.scoreStrictProductCreativeSpecSignal(sourceText, intent) <= 0) return null;
        if (this.isBroadSpecificProductCatalogHit(sourceText, intent)) return null;

        const creativeSpecScore = this.scoreStrictProductCreativeSpecSignal(sourceText, intent);
        const boostedScore = Math.max(
          0.98,
          Math.min(1, (candidate.hybridScore || 0) + 0.42 + creativeSpecScore),
        );
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.retrievalMethod = 'hybrid';
        candidate.evidenceType = 'hybrid';
        candidate.sourceVendor = 'META';
        candidate.sourceVendors = Array.from(new Set([
          ...(candidate.sourceVendors || []),
          'META',
        ]));
        candidate.vendorMatch = true;
        candidate.vendorMismatch = false;
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'meta_creative_spec_priority',
          ...(creativeSpecScore > 0 ? ['meta_creative_spec_signal'] : []),
          'hybrid_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `meta_creative_spec_priority_${result.anchor}`,
          ...(creativeSpecScore > 0 ? ['meta_creative_spec_detail_priority'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          vendorMatch: true,
          vendorMismatch: false,
          sourceVendor: 'META',
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, creativeSpecScore > 0 ? 0.98 : 0.9),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          retrievalMethod: 'hybrid',
          evidenceType: 'hybrid',
          source_vendor: 'META',
          sourceVendors: candidate.sourceVendors,
          metaCreativeSpecPriority: true,
          productStructureAnchor: result.anchor,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private async searchGoogleLeadFormPriorityCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (!this.isGoogleLeadFormIntent(intent)) {
      return [];
    }

    const anchors = [
      '리드 양식',
      '리드양식',
      '잠재 고객',
      '잠재고객',
      '양식 제출',
      'Lead Form',
      'lead form',
      'Lead Generation',
      'lead generation',
      '비즈니스 폼',
      '개인정보',
      '동의',
    ];
    const keywords = Array.from(new Set([
      ...getCompassVendorTerms('GOOGLE'),
      ...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS,
      ...anchors,
    ]));
    const keywordSearchOptions = { rawKeywordsOnly: true };
    const [
      documentKeywordResults,
      ollamaKeywordResults,
      vendorMetadataResults,
    ] = await Promise.all([
      this.searchKeywordTable('document_chunks', anchors, 12, intent, undefined, keywordSearchOptions),
      this.searchKeywordTable('ollama_document_chunks', anchors, 8, intent, 'GOOGLE'),
      this.searchVendorMetadataTable('ollama_document_chunks', 'GOOGLE', anchors, 6, intent),
    ]);
    const results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }> = [
      ...documentKeywordResults.map(result => ({
        ...result,
        anchor: 'google_lead_form_priority_keyword',
      })),
      ...ollamaKeywordResults.map(result => ({
        ...result,
        anchor: 'google_lead_form_priority_keyword',
      })),
      ...vendorMetadataResults.map(result => ({
        ...result,
        anchor: 'google_lead_form_vendor_metadata',
      })),
    ];

    return results
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'keyword',
          corpus: result.corpus,
          evidenceType: 'keyword',
        });

        if (!candidate) return null;
        if (this.hasExplicitOtherVendorSignal(candidate, 'GOOGLE')) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        const normalizedSourceText = this.normalizeSearchText(sourceText);
        if (
          !this.matchesVendorSlot(candidate, 'GOOGLE')
          && !/google|google\s*ads|ads\.google|support\.google|구글/.test(normalizedSourceText)
        ) {
          return null;
        }
        if (!this.hasGoogleLeadFormSignal(sourceText)) return null;

        const hasPolicySignal = /개인정보|동의|고지|정책|검토|승인|심사|privacy|consent|policy|review/i.test(sourceText);
        const hasCampaignSignal = /검색|동영상|디스플레이|실적\s*최대화|performance\s*max|캠페인|campaign|lead\s*form|리드\s*양식/i.test(sourceText);
        const boostedScore = Math.max(
          hasPolicySignal ? 0.98 : hasCampaignSignal ? 0.94 : 0.86,
          Math.min(1, (candidate.hybridScore || 0) + (hasPolicySignal ? 0.45 : hasCampaignSignal ? 0.32 : 0.16)),
        );
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.sourceVendor = 'GOOGLE';
        candidate.sourceVendors = Array.from(new Set([
          ...(candidate.sourceVendors || []),
          'GOOGLE',
        ]));
        candidate.vendorMatch = true;
        candidate.vendorMismatch = false;
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'google_lead_form_priority',
          ...(hasPolicySignal ? ['google_lead_form_policy_signal'] : []),
          ...(hasCampaignSignal ? ['google_lead_form_campaign_signal'] : []),
          'keyword_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `google_lead_form_priority_${result.anchor}`,
          ...(hasPolicySignal ? ['google_lead_form_policy_priority'] : []),
          ...(hasCampaignSignal ? ['google_lead_form_campaign_priority'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          vendorMatch: true,
          vendorMismatch: false,
          sourceVendor: 'GOOGLE',
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, hasPolicySignal ? 0.98 : hasCampaignSignal ? 0.9 : 0.8),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          source_vendor: 'GOOGLE',
          sourceVendors: candidate.sourceVendors,
          googleLeadFormPriority: true,
          productStructureAnchor: result.anchor,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private async searchMetaProductOverviewPriorityCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (
      !intent.topics.includes('product_structure')
      || intent.vendors.length !== 1
      || intent.vendors[0] !== 'META'
      || !intent.isProductStructureOverview
      || intent.isSpecificProductGuidance
    ) {
      return [];
    }

    const anchors = [
      '캠페인 목표',
      '광고 관리자 목표',
      '마케팅 목표',
      '앱 홍보',
      '판매',
      'Advantage+',
      '어드밴티지',
      '카탈로그',
      'catalog',
      'Meta Pixel',
      '메타 픽셀',
      'Conversions API',
      '노출 위치',
      '게재 위치',
      'placements',
      '컬렉션 광고',
      'Lead Ads',
      '잠재고객 광고',
    ];
    const keywords = Array.from(new Set([
      ...getCompassVendorTerms('META'),
      ...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS,
      ...anchors,
    ]));

    const results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }> = [];
    const priorityAnchors = anchors.slice(0, 14);
    const [documentKeywordResults, ollamaKeywordResults, vendorMetadataResults] = await Promise.all([
      this.searchKeywordTable('document_chunks', priorityAnchors, 14, intent, 'META'),
      this.searchKeywordTable('ollama_document_chunks', priorityAnchors, 14, intent, 'META'),
      this.searchVendorMetadataTable(
        'ollama_document_chunks',
        'META',
        priorityAnchors,
        8,
        intent,
      ),
    ]);
    results.push(
      ...documentKeywordResults.map(result => ({
        ...result,
        anchor: 'meta_product_overview_keyword',
      })),
      ...ollamaKeywordResults.map(result => ({
        ...result,
        anchor: 'meta_product_overview_keyword',
      })),
      ...vendorMetadataResults.map(result => ({
        ...result,
        anchor: 'meta_vendor_metadata',
      })),
    );

    return results
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'keyword',
          corpus: result.corpus,
          evidenceType: 'keyword',
        });

        if (!candidate) return null;
        if (this.hasExplicitOtherVendorSignal(candidate, 'META')) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        const normalizedSourceText = this.normalizeSearchText(sourceText);
        if (!this.hasMetaProductOverviewSignal(sourceText)) return null;
        if (this.isMetaBroadProductNewsNoiseText(sourceText)) return null;
        if (this.isCreativeSpecOnlyText(normalizedSourceText)) return null;

        const hasObjectiveSignal = /캠페인\s*(목표|목적)|광고\s*관리자\s*목표|마케팅\s*목표|목표[\s\S]{0,120}(인지도|트래픽|참여|잠재\s*고객|앱\s*홍보|판매)|인지도[\s\S]{0,120}트래픽[\s\S]{0,120}참여[\s\S]{0,120}잠재\s*고객[\s\S]{0,120}앱\s*홍보[\s\S]{0,120}판매|objective|objectives/i.test(sourceText);
        const hasCommerceSignal = /advantage\+|어드밴티지|카탈로그|catalog|meta\s*pixel|메타\s*픽셀|픽셀\s*(이벤트|코드|설치|전환)|conversions?\s*api/i.test(sourceText);
        const hasFormatPlacementSignal = /노출\s*위치|게재\s*위치|placements|지면|이미지\s*광고|동영상\s*광고|슬라이드\s*광고|컬렉션\s*광고|릴스|스토리|피드|lead\s*ads|잠재고객\s*광고/i.test(sourceText);
        const queryWantsFormatPlacement = /형식|소재|지면|노출\s*위치|게재\s*위치|placement|슬라이드|릴스|스토리|피드/i.test(intent.keywords.join(' '));
        if (hasFormatPlacementSignal && !hasObjectiveSignal && !hasCommerceSignal && !queryWantsFormatPlacement) {
          return null;
        }
        if (this.isMetaOverviewPolicyNoiseText(normalizedSourceText) && !hasObjectiveSignal && !hasCommerceSignal && !hasFormatPlacementSignal) {
          return null;
        }
        const boostedScore = Math.max(
          hasObjectiveSignal ? 0.96 : hasCommerceSignal || hasFormatPlacementSignal ? 0.9 : 0.84,
          Math.min(1, (candidate.hybridScore || 0) + (hasObjectiveSignal ? 0.5 : hasCommerceSignal || hasFormatPlacementSignal ? 0.34 : 0.2))
        );
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.sourceVendor = 'META';
        candidate.sourceVendors = Array.from(new Set([
          ...(candidate.sourceVendors || []),
          'META',
        ]));
        candidate.vendorMatch = true;
        candidate.vendorMismatch = false;
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'meta_product_overview_priority',
          ...(hasObjectiveSignal ? ['meta_objective_signal'] : []),
          ...(hasCommerceSignal ? ['meta_commerce_measurement_signal'] : []),
          ...(hasFormatPlacementSignal ? ['meta_format_placement_signal'] : []),
          'keyword_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `meta_product_overview_priority_${result.anchor}`,
          ...(hasObjectiveSignal ? ['meta_objective_priority'] : []),
          ...(hasCommerceSignal ? ['meta_commerce_measurement_priority'] : []),
          ...(hasFormatPlacementSignal ? ['meta_format_placement_priority'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          vendorMatch: true,
          vendorMismatch: false,
          sourceVendor: 'META',
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, hasObjectiveSignal ? 0.95 : hasCommerceSignal || hasFormatPlacementSignal ? 0.88 : 0.8),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          source_vendor: 'META',
          sourceVendors: candidate.sourceVendors,
          metaProductOverviewPriority: true,
          productStructureAnchor: result.anchor,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private async searchKakaoProductStructurePriorityCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    if (!this.isKakaoBizboardDisplayProductIntent(intent)) {
      return [];
    }

    const anchors = [
      '비즈보드',
      '카카오 비즈보드',
      '카카오비즈보드',
      '톡보드',
      'Talkboard',
      'talkboard',
      '디스플레이 광고',
      '디스플레이광고',
      'Display Ad',
      'displayad',
      '카카오모먼트',
      '상품가이드',
      '상품 가이드',
      '제작 가이드',
      '제작가이드',
      '홍보이미지',
      '행동유도버튼',
      '닫힘버튼',
      '메인 카피',
      '서브 카피',
      '노출 지면',
      '리사이징',
      '외곽 테두리',
      '이미지 세부 가이드',
      '집행 기준',
      '심사 가이드',
      '업종별 가이드',
      '등록불가 업종',
    ];
    const keywords = Array.from(new Set([
      ...getCompassVendorTerms('KAKAO'),
      ...PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS,
      ...anchors,
    ]));

    const results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }> = [];
    const prioritySearchAnchors = [
      '비즈보드',
      '카카오 비즈보드',
      '디스플레이 광고',
      '카카오모먼트',
      '상품가이드',
      '제작 가이드',
      '노출 지면',
      '심사 가이드',
      '집행 기준',
    ];
    const specificKakaoFastPathAnchors = [
      '비즈보드',
      '카카오 비즈보드',
      '디스플레이 광고',
      '카카오모먼트',
      '상품가이드',
    ];

    const usesSpecificKakaoOllamaFastPath = intent.isSpecificProductGuidance;
    const requiresKakaoBizboardEvidence = this.requiresKakaoBizboardEvidence(intent);
    const hasRequiredKakaoFastPathEvidence = (candidate: SearchResult): boolean => {
      const evidenceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
      return this.hasKakaoBizboardDisplayExactSignal(evidenceText)
        && (!requiresKakaoBizboardEvidence || this.hasKakaoBizboardProductSignal(evidenceText));
    };
    if (usesSpecificKakaoOllamaFastPath) {
      const officialChunkResults = await this.searchKnownOfficialDocumentChunks(
        KAKAO_BIZBOARD_DISPLAY_OFFICIAL_CHUNK_IDS,
        2,
        intent,
        'KAKAO',
        'kakao_product_official_chunk',
      );
      const officialChunkCandidates = this.normalizeKakaoProductStructurePriorityResults(
        officialChunkResults,
        keywords,
        intent,
      );
      if (officialChunkCandidates.some(hasRequiredKakaoFastPathEvidence)) {
        return officialChunkCandidates;
      }

      const [documentFastResults, ollamaResults] = await Promise.all([
        this.searchKeywordTable('document_chunks', specificKakaoFastPathAnchors, 8, intent),
        this.searchKeywordTable('ollama_document_chunks', specificKakaoFastPathAnchors, 5, intent, 'KAKAO'),
      ]);
      const keywordFastCandidates = this.normalizeKakaoProductStructurePriorityResults(
        [
          ...documentFastResults.map(result => ({ ...result, anchor: 'kakao_product_priority_keyword' })),
          ...ollamaResults.map(result => ({ ...result, anchor: 'kakao_product_priority_keyword' })),
        ],
        keywords,
        intent,
      );
      if (keywordFastCandidates.some(hasRequiredKakaoFastPathEvidence)) {
        return keywordFastCandidates;
      }

      const exactFastAnchorResults = await Promise.all([
        '비즈보드',
        '카카오 비즈보드',
        '디스플레이 광고',
      ].map(anchor => this.searchProductStructureAnchorTable('document_chunks', anchor, 5, undefined, intent)));
      const anchorFastCandidates = this.normalizeKakaoProductStructurePriorityResults(
        [
          ...exactFastAnchorResults.flat(),
          ...documentFastResults.map(result => ({ ...result, anchor: 'kakao_product_priority_keyword' })),
          ...ollamaResults.map(result => ({ ...result, anchor: 'kakao_product_priority_keyword' })),
        ],
        keywords,
        intent,
      );
      if (anchorFastCandidates.some(hasRequiredKakaoFastPathEvidence)) {
        return anchorFastCandidates;
      }
    }

    const [
      documentChunkResults,
      ollamaResults,
      vendorMetadataResults,
    ] = await Promise.all([
      this.searchKeywordTable('document_chunks', prioritySearchAnchors, 12, intent),
      this.searchKeywordTable('ollama_document_chunks', prioritySearchAnchors, 12, intent, 'KAKAO'),
      this.searchVendorMetadataTable('ollama_document_chunks', 'KAKAO', prioritySearchAnchors, 6, intent),
    ]);
    results.push(
      ...documentChunkResults.map(result => ({ ...result, anchor: 'kakao_product_priority_keyword' })),
      ...ollamaResults.map(result => ({ ...result, anchor: 'kakao_product_priority_keyword' })),
      ...vendorMetadataResults.map(result => ({ ...result, anchor: 'kakao_vendor_metadata' })),
    );

    return this.normalizeKakaoProductStructurePriorityResults(results, keywords, intent);
  }

  private normalizeKakaoProductStructurePriorityResults(
    results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }>,
    keywords: string[],
    intent: QueryIntent
  ): SearchResult[] {
    return results
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'keyword',
          corpus: result.corpus,
          evidenceType: 'keyword',
        });

        if (!candidate) return null;
        if (this.hasExplicitOtherVendorSignal(candidate, 'KAKAO')) return null;

        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        if (!this.hasKakaoBizboardDisplaySignal(sourceText)) return null;
        if (this.isKakaoMeasurementOnlySource(sourceText, intent)) return null;

        const normalizedSourceText = this.normalizeSearchText(sourceText);
        const hasExactProductSignal = this.hasKakaoBizboardDisplayExactSignal(sourceText);
        const hasProductGuideUrl = /kakaobusiness\.gitbook\.io\/main\/ad\/moment\/(performance|guarantee)\/(talkboard|displayad|catalog|cpt|cpt-mo|cpt-pc)(?:\/|$)/.test(normalizedSourceText);
        const hasCreativeGuideSignal = /홍보이미지|행동유도버튼|닫힘버튼|메인\s*카피|서브\s*카피|2:1\s*비율|1:1\s*비율|이미지\s*세부\s*가이드|외곽\s*테두리|리사이징|타이틀|소재|제작\s*가이드|노출\s*지면/.test(sourceText);
        const hasAuditSignal = /심사\s*가이드|집행\s*기준|업종별\s*가이드|광고\s*가능\s*업종|등록\s*불가|금지\s*행위|소재\s*제한/.test(sourceText);
        const boostedScore = Math.max(
          hasExactProductSignal ? 0.99 : hasProductGuideUrl || hasCreativeGuideSignal ? 0.95 : hasAuditSignal ? 0.9 : 0.84,
          Math.min(1, (candidate.hybridScore || 0) + (hasExactProductSignal ? 0.62 : hasProductGuideUrl || hasCreativeGuideSignal ? 0.48 : hasAuditSignal ? 0.34 : 0.2))
        );
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.sourceVendor = 'KAKAO';
        candidate.sourceVendors = Array.from(new Set([
          ...(candidate.sourceVendors || []),
          'KAKAO',
        ]));
        candidate.vendorMatch = true;
        candidate.vendorMismatch = false;
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'kakao_product_structure_priority',
          ...(hasExactProductSignal ? ['kakao_bizboard_display_exact_signal'] : []),
          ...(hasCreativeGuideSignal ? ['kakao_creative_guide_signal'] : []),
          ...(hasAuditSignal ? ['kakao_audit_guide_signal'] : []),
          'keyword_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `kakao_product_structure_priority_${result.anchor}`,
          ...(hasExactProductSignal ? ['kakao_bizboard_display_exact_match'] : []),
          ...(hasProductGuideUrl ? ['kakao_official_product_guide_url'] : []),
          ...(hasCreativeGuideSignal ? ['kakao_creative_guide_priority'] : []),
          ...(hasAuditSignal ? ['kakao_audit_guide_priority'] : []),
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          vendorMatch: true,
          vendorMismatch: false,
          sourceVendor: 'KAKAO',
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, hasExactProductSignal ? 0.97 : hasProductGuideUrl || hasCreativeGuideSignal ? 0.94 : hasAuditSignal ? 0.88 : 0.8),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          source_vendor: 'KAKAO',
          sourceVendors: candidate.sourceVendors,
          kakaoProductStructurePriority: true,
          productStructureAnchor: result.anchor,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private async searchProductStructureCandidates(limit: number, intent: QueryIntent): Promise<SearchResult[]> {
    if (!intent.topics.includes('product_structure')) {
      return [];
    }

    const vendorTerms = intent.vendors.flatMap((vendor) => getCompassVendorTerms(vendor));
    const specificAnchorTerms = this.buildSpecificProductAnchorTerms(intent);
    const specificDetailTerms = intent.isSpecificProductGuidance
      ? [
        ...specificAnchorTerms,
        ...intent.strictContextTerms,
        ...intent.adPolicyTerms,
        ...intent.keywords.filter(keyword => /등록|절차|집행|세팅|설정|연동|제작|소재|사양|스펙|조건|주의|유의|심사|검수|오류|에러|sdk|mmp|db|url|상품|카탈로그|픽셀|전환|리드|양식|동영상|비즈보드|지면|노출|검색|쇼핑|앱/i.test(keyword)),
      ]
      : PRODUCT_STRUCTURE_KEYWORD_EXPANSIONS;
    const keywords = Array.from(new Set([
      ...vendorTerms,
      ...specificDetailTerms,
    ]));
    const usesBroadProductStructureRetrieval = this.isBroadProductStructureRetrievalIntent(intent);
    const anchorLimit = usesBroadProductStructureRetrieval
      ? Math.max(2, Math.ceil(limit / 6))
      : Math.max(3, Math.ceil(limit / 4));
    const anchorVendors: Array<VendorIntent | undefined> = intent.vendors.length > 0
      ? usesBroadProductStructureRetrieval
        ? [intent.vendors[0]]
        : [intent.vendors[0], undefined]
      : [undefined];
    const queryMatchedAnchors = PRODUCT_STRUCTURE_ANCHOR_TERMS.filter((anchor) => {
      if (intent.isSpecificProductGuidance) return false;
      const normalizedAnchor = normalizeCompassSearchText(anchor);
      return intent.keywords.some(keyword => normalizedAnchor.includes(keyword) || keyword.includes(normalizedAnchor));
    });
    const explicitSpecificAnchors = intent.isSpecificProductGuidance
      ? specificAnchorTerms.filter(anchor => {
        const normalizedAnchor = normalizeCompassSearchText(anchor);
        return intent.strictProductTerms.some(term => {
          const normalizedTerm = normalizeCompassSearchText(term);
          return normalizedTerm.includes(normalizedAnchor) || normalizedAnchor.includes(normalizedTerm);
        }) || intent.keywords.some(keyword => {
          const normalizedKeyword = normalizeCompassSearchText(keyword);
          return normalizedKeyword.includes(normalizedAnchor) || normalizedAnchor.includes(normalizedKeyword);
        });
      })
      : [];
    const uncappedAnchorTerms = intent.isSpecificProductGuidance
      ? Array.from(new Set([...explicitSpecificAnchors, ...specificAnchorTerms]))
      : Array.from(new Set([...PRODUCT_STRUCTURE_ANCHOR_TERMS, ...queryMatchedAnchors]));
    const anchorTerms = uncappedAnchorTerms.slice(0, intent.isSpecificProductGuidance ? 8 : usesBroadProductStructureRetrieval ? 6 : 14);

    if (intent.isSpecificProductGuidance && anchorTerms.length === 0) {
      return [];
    }

    const results: Array<{ row: any; corpus: RetrievalCorpus; anchor: string }> = [];
    for (const vendor of anchorVendors) {
      for (const anchor of anchorTerms) {
        const [documentChunkResults, ollamaResults] = await Promise.all([
          this.searchProductStructureAnchorTable('document_chunks', anchor, anchorLimit, vendor, intent),
          this.searchProductStructureAnchorTable('ollama_document_chunks', anchor, Math.max(2, Math.ceil(anchorLimit / 2)), vendor, intent),
        ]);
        results.push(...documentChunkResults, ...ollamaResults);
        if (results.length >= (usesBroadProductStructureRetrieval ? 32 : 64)) break;
      }
      if (results.length >= (usesBroadProductStructureRetrieval ? 32 : 64)) break;
    }
    return results
      .map((result) => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'keyword',
          corpus: result.corpus,
          evidenceType: 'keyword',
        });

        if (!candidate) return null;
        if (intent.vendors.length === 1 && this.hasExplicitOtherVendorSignal(candidate, intent.vendors[0])) {
          return null;
        }

        const searchText = this.buildCandidateSearchText(candidate.content, candidate.documentTitle, candidate.metadata);
        const evidenceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        const specificProductMatch = this.hasSpecificProductTermMatch(evidenceText, intent);
        if (
          intent.isSpecificProductGuidance
          && anchorTerms.length > 0
          && !specificProductMatch
        ) {
          return null;
        }

        const hasSpecificDetailEvidence = (
          intent.isSpecificProductGuidance
          && specificProductMatch
          && this.hasSpecificProductDetailSignal(evidenceText)
        );
        const hasSpecificDetailNearProduct = (
          intent.isSpecificProductGuidance
          && specificProductMatch
          && this.hasSpecificProductDetailSignalNearAnyTerm(evidenceText, intent)
        );
        const hasSpecificGroundingNearProduct = (
          intent.isSpecificProductGuidance
          && specificProductMatch
          && this.hasSpecificProductAnswerableSignalNearAnyTerm(evidenceText, intent)
        );

        if (
          intent.isSpecificProductGuidance
          && !hasSpecificGroundingNearProduct
          && !this.hasSpecificProductAnswerableSignalForIntent(evidenceText, intent)
          && !(this.isNaverShoppingDataIntent(intent) && this.hasStrongNaverShoppingDataSignal(evidenceText))
          && !(this.isNaverVideoProductIntent(intent) && this.hasNaverVideoProductGuideSignal(evidenceText))
          && !(this.isKakaoBizboardDisplayProductIntent(intent) && this.hasKakaoBizboardDisplaySignal(evidenceText))
        ) {
          return null;
        }
        if (this.isOffTopicSpecificProductEvidence(evidenceText, intent)) {
          return null;
        }

        if (
          !hasSpecificDetailEvidence
          && !this.hasProductStructureSignal(evidenceText)
          && !this.hasHighValueProductStructureSignal(evidenceText)
        ) {
          return null;
        }

        if (intent.vendors.length > 0 && candidate.vendorMismatch && !candidate.vendorMatch) {
          return null;
        }

        const boostedScore = Math.min(1, (candidate.hybridScore || 0) + (hasSpecificDetailNearProduct ? 0.3 : hasSpecificDetailEvidence ? 0.18 : this.hasHighValueProductStructureSignal(evidenceText) ? 0.14 : 0.08));
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `product_structure_anchor_${result.anchor}`,
          ...(searchText !== evidenceText ? ['verified_against_visible_evidence'] : []),
          ...(specificProductMatch ? ['specific_product_anchor_match'] : []),
          ...(hasSpecificDetailEvidence ? ['specific_product_detail_match'] : []),
          ...(hasSpecificDetailNearProduct ? ['specific_product_near_detail_match'] : []),
        ]));
        candidate.metadata = {
          ...(candidate.metadata || {}),
          productStructureAnchor: result.anchor,
          rankReason: candidate.rankReason,
          specificProductAnchorMatch: specificProductMatch,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private ensureNaverProductStructureCoverage(
    selected: SearchResult[],
    candidates: SearchResult[],
    intent: QueryIntent
  ): SearchResult[] {
    if (!intent.topics.includes('product_structure') || intent.vendors.length !== 1) {
      return selected;
    }

    const vendor = intent.vendors[0];
    const usesNaverShoppingDataIntent = vendor === 'NAVER' && this.isNaverShoppingDataIntent(intent);
    if (!intent.isProductStructureOverview && !usesNaverShoppingDataIntent) {
      return selected;
    }

    const requiredGroupsByVendor: Partial<Record<VendorIntent, string[][]>> = {
      META: [
        ['캠페인 목표', '광고 관리자 목표', '마케팅 목표', '인지도', '트래픽', '참여', '잠재 고객', '앱 홍보', '판매'],
        ['컬렉션 광고', '슬라이드 광고', '캐러셀', '카루셀', '이미지 광고', '동영상 광고'],
        ['advantage+', '어드밴티지', '카탈로그', 'catalog', 'shop', 'shops'],
        ['리드 양식', '잠재고객 광고', 'Lead Ads', 'Lead Generation'],
        ['앱 홍보', '앱 설치', '앱 인스톨', 'App Promotion', 'App Install'],
        ['메타 픽셀', 'Meta Pixel', 'Conversions API', '픽셀 이벤트', '전환'],
      ],
      GOOGLE: [
        ['앱 캠페인', '앱 설치', '사전 등록'],
        ['쇼핑 광고', '쇼핑 캠페인', 'shopping ads', 'shopping campaigns', 'merchant center'],
        ['검색 캠페인', '이미지 확장', '검색 광고'],
        ['반응형 디스플레이', '디스플레이 캠페인'],
        ['실적 최대화', 'Performance Max', 'PMax'],
        ['Demand Gen', '디맨드젠', '수요 창출'],
        ['YouTube', '유튜브', '동영상 광고', 'Video Ads', 'Video action campaign'],
        ['리드 양식', 'lead form'],
      ],
      NAVER: [
        ['사이트검색광고', '웹사이트 방문 목적', '파워링크'],
        ['브랜드검색', '브랜드 검색'],
        ['쇼핑검색', '쇼핑검색광고', '쇼핑몰 상품형'],
        ['상품등록', '상품 등록', '신규상품 등록', '상품 db', '상품db', 'db url', 'ep', '쇼핑파트너센터', '상품정보 수신 현황', '등록요청', '입점 심사', '카테고리 자동매칭', '카테고리 매칭'],
        ['쇼핑블록', '쇼핑 지면', '쇼핑지면', 'pc 쇼핑블록', 'mo 쇼핑블록', '모바일 쇼핑'],
        ['성과형 디스플레이', 'ADVoost', '홈피드', '스마트채널', '타임보드', '롤링보드', '헤드라인DA', '보장형'],
      ],
      KAKAO: [
        ['비즈보드', '디스플레이 광고'],
        ['상품가이드', '상품 가이드', '업종 제한'],
        ['제작 가이드', '이미지', '비율', '노출 지면'],
        ['심사 가이드', '집행 기준', '등록불가 업종'],
      ],
    };
    if (intent.isSpecificProductGuidance && !usesNaverShoppingDataIntent) {
      return selected;
    }

    const requiredGroups = usesNaverShoppingDataIntent
      ? [
        ['쇼핑검색', '쇼핑검색광고', '쇼핑몰 상품형'],
        ['상품정보 수신 현황', '등록요청', '상품 db url', '상품db url', 'ep(=db url)', 'db url', '입점 심사', '카테고리 자동매칭', '카테고리 매칭', '상품관리'],
      ]
      : requiredGroupsByVendor[vendor];
    const coverageReasonByVendor: Record<VendorIntent, string> = {
      META: 'meta_required_product_structure_coverage',
      GOOGLE: 'google_required_product_structure_coverage',
      NAVER: 'naver_required_product_structure_coverage',
      KAKAO: 'kakao_required_product_structure_coverage',
    };

    if (!requiredGroups?.length) {
      return selected;
    }

    const next = [...selected];
    const selectedKeys = new Set(next.map(candidate => this.buildCandidateDedupeKey(candidate)));
    const protectedKeys = new Set<string>();

    if (usesNaverShoppingDataIntent) {
      const hasSelectedShoppingData = next.some(candidate => this.hasStrongNaverShoppingDataSignal(
        this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata)
      ));
      if (!hasSelectedShoppingData) {
        const candidate = candidates
          .filter(item => this.isCandidateUsableForProductStructureCoverage(item))
          .filter(item => this.matchesVendorSlot(item, vendor) || (
            vendor === 'NAVER'
            && this.hasStrongNaverShoppingDataSignal(this.buildCandidateEvidenceText(item.content, item.documentTitle, item.metadata))
          ))
          .filter(item => this.hasStrongNaverShoppingDataSignal(
            this.buildCandidateEvidenceText(item.content, item.documentTitle, item.metadata)
          ))
          .filter(item => !selectedKeys.has(this.buildCandidateDedupeKey(item)))
          .sort((a, b) => this.scoreNaverShoppingDataCandidate(b, intent) - this.scoreNaverShoppingDataCandidate(a, intent))[0];

        if (candidate) {
          candidate.sourceVendor = 'NAVER';
          candidate.sourceVendors = Array.from(new Set([
            ...(candidate.sourceVendors || []),
            'NAVER',
          ]));
          candidate.rankReason = Array.from(new Set([
            ...(candidate.rankReason || []),
            'naver_shopping_data_required_coverage',
            'naver_shopping_data_strong_detail_rescue',
          ]));
          candidate.evidenceDecisionReason = Array.from(new Set([
            ...(candidate.evidenceDecisionReason || []),
            'naver_shopping_data_required_coverage',
            'naver_shopping_data_strong_detail_rescue',
          ]));
          candidate.metadata = {
            ...(candidate.metadata || {}),
            coverageRole: 'naver_shopping_data_required_coverage',
            naverShoppingDataStrongPriority: true,
            rankReason: candidate.rankReason,
            evidenceDecisionReason: candidate.evidenceDecisionReason,
          };
          const key = this.buildCandidateDedupeKey(candidate);
          selectedKeys.add(key);
          protectedKeys.add(key);
          next.push(candidate);
        }
      }
    }

    for (const terms of requiredGroups) {
      const existingCoverage = next.find(candidate => (
        this.candidateContainsAny(candidate, terms)
        && this.isRequiredProductStructureCoverageCandidate(candidate, terms, intent)
      ));
      if (existingCoverage) {
        protectedKeys.add(this.buildCandidateDedupeKey(existingCoverage));
        continue;
      }

      const candidate = candidates
        .filter(item => this.isCandidateUsableForProductStructureCoverage(item))
        .filter(item => this.matchesVendorSlot(item, vendor))
        .filter(item => this.candidateContainsAny(item, terms))
        .filter(item => this.isRequiredProductStructureCoverageCandidate(item, terms, intent))
        .filter(item => !selectedKeys.has(this.buildCandidateDedupeKey(item)))
        .sort((a, b) => (
          usesNaverShoppingDataIntent
            ? this.scoreNaverShoppingDataCandidate(b, intent) - this.scoreNaverShoppingDataCandidate(a, intent)
            : this.scoreVendorSlotCandidate(b, intent) - this.scoreVendorSlotCandidate(a, intent)
        ))[0];

      if (!candidate) {
        continue;
      }

      candidate.rankReason = Array.from(new Set([
        ...(candidate.rankReason || []),
        coverageReasonByVendor[vendor],
      ].filter(Boolean)));
      candidate.evidenceDecisionReason = Array.from(new Set([
        ...(candidate.evidenceDecisionReason || []),
        coverageReasonByVendor[vendor],
      ]));
      candidate.metadata = {
        ...(candidate.metadata || {}),
        coverageRole: coverageReasonByVendor[vendor],
        rankReason: candidate.rankReason,
        evidenceDecisionReason: candidate.evidenceDecisionReason,
      };
      const key = this.buildCandidateDedupeKey(candidate);
      selectedKeys.add(key);
      protectedKeys.add(key);
      next.push(candidate);
    }

    const sorted = next
      .sort((a, b) => (
        usesNaverShoppingDataIntent
          ? this.scoreNaverShoppingDataCandidate(b, intent) - this.scoreNaverShoppingDataCandidate(a, intent)
          : this.scoreVendorSlotCandidate(b, intent) - this.scoreVendorSlotCandidate(a, intent)
      ))
    const protectedCandidates = sorted.filter(candidate => protectedKeys.has(this.buildCandidateDedupeKey(candidate)));
    const remainingCandidates = sorted.filter(candidate => !protectedKeys.has(this.buildCandidateDedupeKey(candidate)));
    const outputLimit = Math.max(selected.length, intent.recommendedSourceLimit, protectedCandidates.length);

    return [
      ...protectedCandidates,
      ...remainingCandidates,
    ].slice(0, outputLimit);
  }

  private isCandidateUsableForProductStructureCoverage(candidate: SearchResult): boolean {
    if (this.isUnusableEvidenceShell(candidate)) {
      return false;
    }

    const evidenceText = this.buildCandidateEvidenceText(
      candidate.content,
      candidate.documentTitle,
      candidate.metadata
    );

    if (this.hasStrongNaverShoppingDataSignal(evidenceText)) {
      return true;
    }

    const normalizedEvidenceText = this.normalizeSearchText(evidenceText);
    if (this.isLowValueProductStructureDirectoryText(normalizedEvidenceText)) {
      return false;
    }

    if (this.isCreativeSpecOnlyText(normalizedEvidenceText)) {
      return false;
    }

    return (
      this.hasHighValueProductStructureSignal(normalizedEvidenceText)
      || this.hasProductStructureSignal(normalizedEvidenceText)
    );
  }

  private isRequiredProductStructureCoverageCandidate(
    candidate: SearchResult,
    terms: string[],
    intent: QueryIntent
  ): boolean {
    const evidenceText = this.buildCandidateEvidenceText(
      candidate.content,
      candidate.documentTitle,
      candidate.metadata
    );
    const normalizedEvidenceText = this.normalizeSearchText(evidenceText);

    if (this.isOffAxisProductStructureEvidence(normalizedEvidenceText, intent)) {
      return false;
    }

    if (this.isNaverShoppingDataIntent(intent) && this.hasStrongNaverShoppingDataSignal(normalizedEvidenceText)) {
      return true;
    }

    if (this.isNaverVideoProductIntent(intent) && this.hasNaverVideoProductGuideSignal(normalizedEvidenceText)) {
      return true;
    }

    if (this.isKakaoBizboardDisplayProductIntent(intent) && this.hasKakaoBizboardDisplaySignal(normalizedEvidenceText)) {
      return true;
    }

    if ((candidate.rankReason || []).includes('product_structure_no_signal_penalty')
      && !this.hasHighValueProductStructureSignal(normalizedEvidenceText)
    ) {
      return false;
    }

    const hasRequiredTerm = terms.some(term => this.textContainsNormalizedTerm(normalizedEvidenceText, term));
    if (!hasRequiredTerm) {
      return false;
    }

    if (this.hasHighValueProductStructureSignal(normalizedEvidenceText)) {
      return true;
    }

    if (intent.isSpecificProductGuidance && this.hasSpecificProductTermMatch(normalizedEvidenceText, intent)) {
      return this.hasSpecificProductDetailSignal(normalizedEvidenceText);
    }

    return false;
  }

  private isOffAxisProductStructureEvidence(text: string, intent: QueryIntent): boolean {
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ].filter(Boolean).join(' '));

    const queryAllows = (pattern: RegExp) => pattern.test(queryText);
    const evidenceHas = (pattern: RegExp) => pattern.test(text);

    if (
      evidenceHas(/세금|부가가치세|vat|청구|결제|인보이스|tax|billing|payment/)
      && !queryAllows(/세금|부가가치세|vat|청구|결제|인보이스|tax|billing|payment/)
    ) {
      return true;
    }

    if (
      evidenceHas(/계정\s*(생성|만들기|로그인)|비즈니스\s*계정|광고\s*계정\s*(생성|추가)|회원\s*가입/)
      && !queryAllows(/계정|로그인|가입|비즈니스\s*계정/)
    ) {
      return true;
    }

    if (
      evidenceHas(/개인정보\s*보호|데이터\s*분류|데이터\s*사용|사용자\s*데이터|privacy/)
      && !queryAllows(/개인정보|데이터|타겟|오디언스|audience|privacy/)
    ) {
      return true;
    }

    if (
      evidenceHas(/오프라인\s*전환|향상된\s*전환|conversion\s*api|conversions\s*api|capi/)
      && !queryAllows(/전환|측정|픽셀|sdk|mmp|api|카탈로그|앱|app/)
    ) {
      return true;
    }

    if (
      evidenceHas(/라이브\s*쇼핑|live\s*shopping|동영상\s*편집|크리에이터\s*스튜디오/)
      && !queryAllows(/라이브|live|동영상|영상|크리에이터/)
    ) {
      return true;
    }

    return false;
  }

  private candidateContainsAny(candidate: SearchResult, terms: string[]): boolean {
    const text = this.normalizeSearchText(this.buildCandidateEvidenceText(
      candidate.content,
      candidate.documentTitle,
      candidate.metadata
    ));
    return terms.some(term => this.textContainsNormalizedTerm(text, term));
  }

  private textContainsNormalizedTerm(text: string, term: string): boolean {
    const normalizedText = this.normalizeSearchText(text);
    const normalizedTerm = this.normalizeSearchText(term);
    if (!normalizedTerm || normalizedTerm.length < 2) return false;
    if (/^[a-z0-9+]{2,3}$/i.test(normalizedTerm)) {
      const escapedTerm = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const shortAsciiTermPattern = new RegExp(`(^|[^a-z0-9])${escapedTerm}($|[^a-z0-9])`, 'i');
      if (shortAsciiTermPattern.test(normalizedText)) return true;

      const compactText = normalizedText.replace(/\s+/g, '');
      return shortAsciiTermPattern.test(compactText);
    }
    if (normalizedText.includes(normalizedTerm)) return true;

    const compactText = normalizedText.replace(/\s+/g, '');
    const compactTerm = normalizedTerm.replace(/\s+/g, '');
    return compactTerm.length >= 2 && compactText.includes(compactTerm);
  }

  private isGenericStandaloneProductEvidenceTerm(term: string): boolean {
    const normalizedTerm = this.normalizeSearchText(term);
    const compactTerm = normalizedTerm.replace(/\s+/g, '');
    return /^(광고|광고상품|상품|종류|유형|목록|구조|상세|설명|가이드|기준|정보|알려줘|알려|정리|구분|매체|플랫폼|네이버|naver|meta|메타|google|구글|kakao|카카오)$/.test(compactTerm);
  }

  private buildSpecificProductFamilyMatchers(intent: QueryIntent): RegExp[] {
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
    ].join(' '));
    const compactQueryText = queryText.replace(/\s+/g, '');
    const matchers: RegExp[] = [];

    if (/(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(queryText)) {
      matchers.push(/(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/);
    }

    if (/동영상\s*광고|비디오\s*광고|video\s*ads|youtube\s*shorts|shorts\s*광고|쇼츠|숏폼|아웃스트림|video\s*action\s*campaign|\bvac\b/.test(queryText)) {
      matchers.push(/동영상\s*광고|동영상광고|비디오\s*광고|비디오광고|video\s*ads?|동영상\s*조회|동영상\s*소재|youtube|유튜브|shorts|쇼츠|숏폼|아웃스트림|reels|릴스|video\s*action\s*campaign|\bvac\b/);
    }

    if (/앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록)|app\s*(install|promotion)|mmp|sdk|사전\s*등록/.test(queryText)) {
      matchers.push(/앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록|등록)|app\s*(install|promotion)|mobile\s*app|sdk|mmp|모바일\s*측정\s*파트너|트래킹|추적|인앱\s*이벤트|포스트백|postback|skadnetwork|skan/);
    }

    if (/db\s*url|상품\s*db|상품등록|상품\s*등록|ep|쇼핑파트너센터|가격비교/.test(queryText) || /상품db|dburl/.test(compactQueryText)) {
      matchers.push(/db\s*url|dburl|상품\s*db|상품db|ep\s*(\(|=|$)|상품등록|상품\s*등록|쇼핑파트너센터|상품정보\s*수신|등록요청|상품관리|카테고리\s*(자동)?매칭|입점\s*심사|가격비교|데이터\s*피드|feed/);
    }

    if (/리드\s*양식|lead\s*form|lead\s*generation|lead\s*ads?|잠재\s*고객\s*(양식|광고|확장|소재)|잠재고객\s*(양식|광고|확장|소재)|비즈니스\s*폼|비즈니스폼|양식\s*제출/.test(queryText)) {
      matchers.push(/리드\s*양식|리드양식|lead\s*form|lead\s*generation|lead\s*ads?|잠재\s*고객\s*(양식|광고|확장|소재)|잠재고객\s*(양식|광고|확장|소재)|비즈니스\s*폼|비즈니스폼|양식\s*제출/);
    }

    if (/카탈로그|catalog|advantage\+|어드밴티지|컬렉션|performance\s*max|\bpmax\b|demand\s*gen/.test(queryText)) {
      matchers.push(/카탈로그|catalog|advantage\+|어드밴티지|컬렉션|collection|performance\s*max|\bpmax\b|demand\s*gen/);
    }

    if (/쇼핑검색/.test(queryText)) matchers.push(/쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형/);
    if (/사이트검색/.test(queryText)) matchers.push(/사이트검색|사이트\s*검색/);
    if (/쇼핑블록/.test(queryText)) matchers.push(/쇼핑블록|쇼핑\s*지면/);
    if (/비즈보드/.test(queryText)) matchers.push(/비즈보드|카카오\s*비즈보드/);

    return matchers;
  }

  private sourceTextMatchesSpecificProductFamily(sourceText: string, intent: QueryIntent): boolean {
    const familyMatchers = this.buildSpecificProductFamilyMatchers(intent);
    if (familyMatchers.length === 0) return true;
    const normalizedSourceText = this.normalizeSearchText(sourceText);
    return familyMatchers.some(pattern => pattern.test(normalizedSourceText));
  }

  private getFastPolicySourceGuidedPriorityPattern(intent: QueryIntent): RegExp | null {
    if (intent.isComparative || intent.isOutOfScope || intent.unavailablePolicyTarget) return null;
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.topics,
      ...intent.adPolicyTerms,
      ...intent.strictContextTerms,
    ].join(' '));

    if (this.isKakaoServiceProtectionPolicyIntent(intent)) {
      return /카카오|로고|디자인|서비스명|서비스|상표|저작물|모방|침해|무단|사용\s*불가|집행\s*불가/i;
    }
    if (this.isKakaoRestrictedIndustryPolicyIntent(intent)) {
      return /카카오|업종|제한\s*업종|업종\s*제한|광고\s*가능\s*업종|등록\s*불가|집행\s*불가|금지|제한|허용|심사|가이드/i;
    }
    if (/오인|기만|속이|혼란|허위|과장|오해/.test(queryText)) {
      return /오인|기만|속이|속임|혼란|허위|과장|오해|mislead|decept/i;
    }
    if (/가격|할인|할인율|혜택|쿠폰|정가|판매가/.test(queryText)) {
      return /가격|할인|할인율|혜택|쿠폰|정가|판매가|무료배송|카드할인|price|discount/i;
    }
    if (/이벤트|경품|참여|프로모션|추첨/.test(queryText)) {
      return /이벤트|경품|참여|프로모션|추첨|당첨|기간|조건/i;
    }

    return null;
  }

  private isKakaoRestrictedIndustryPolicyIntent(intent: QueryIntent): boolean {
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.topics,
      ...intent.adPolicyTerms,
      ...intent.strictContextTerms,
    ].join(' '));

    return intent.vendors.length === 1
      && intent.vendors[0] === 'KAKAO'
      && /카카오/.test(queryText)
      && /업종|제한\s*업종|업종\s*제한|광고\s*가능\s*업종|등록\s*불가|집행\s*불가|금지\s*업종|허용\s*업종/.test(queryText);
  }

  private isFastPolicySourceGuidedPriorityIntent(intent: QueryIntent): boolean {
    return this.getFastPolicySourceGuidedPriorityPattern(intent) !== null;
  }

  private async searchFastPolicySourceGuidedOfficialCandidates(intent: QueryIntent): Promise<SearchResult[]> {
    const chunkIds = this.isKakaoRestrictedIndustryPolicyIntent(intent)
      ? KAKAO_RESTRICTED_INDUSTRY_OFFICIAL_CHUNK_IDS
      : [];
    if (chunkIds.length === 0) return [];

    const vendor: VendorIntent = intent.vendors.length === 1 ? intent.vendors[0] : 'KAKAO';
    const officialChunkResults = await this.searchKnownOfficialDocumentChunks(
      chunkIds,
      Math.min(chunkIds.length, 4),
      intent,
      vendor,
      'fast_policy_official_chunk',
    );
    const keywords = Array.from(new Set([
      ...getCompassVendorTerms(vendor),
      ...intent.keywords,
      ...intent.adPolicyTerms,
      ...intent.strictContextTerms,
      '업종',
      '제한 업종',
      '등록불가 업종',
      '광고 가능 업종',
      '집행 불가',
    ]));

    const candidates = officialChunkResults
      .map((result): SearchResult | null => {
        const candidate = this.normalizeCandidate(result.row, {
          keywords,
          intent,
          retrievalMethod: 'keyword',
          corpus: result.corpus,
          evidenceType: 'keyword',
        });
        if (!candidate) return null;
        if (this.hasExplicitOtherVendorSignal(candidate, vendor)) return null;

        const boostedScore = Math.max(0.98, Math.min(1, (candidate.hybridScore || candidate.score || 0) + 0.3));
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.sourceVendor = vendor;
        candidate.sourceVendors = Array.from(new Set([
          ...(candidate.sourceVendors || []),
          vendor,
        ]));
        candidate.vendorMatch = true;
        candidate.vendorMismatch = false;
        candidate.topicMatch = true;
        candidate.topicExactMatch = true;
        candidate.policyTitleMatch = true;
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'fast_policy_official_chunk',
          'keyword_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `fast_policy_official_chunk_${result.anchor}`,
        ]));
        candidate.sourceQuality = {
          ...candidate.sourceQuality,
          hasExcerpt: true,
          isFallback: false,
          vendorMatch: true,
          vendorMismatch: false,
          sourceVendor: vendor,
          policyTitleMatch: true,
          qualityScore: Math.max(candidate.sourceQuality.qualityScore || 0, 0.96),
        };
        candidate.metadata = {
          ...(candidate.metadata || {}),
          source_vendor: vendor,
          sourceVendors: candidate.sourceVendors,
          fastPolicyOfficialChunk: true,
          policyAnchor: result.anchor,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          topicMatch: true,
          topicExactMatch: true,
          policyTitleMatch: true,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);

    return this.selectFastPolicySourceGuidedPriorityCandidates(candidates, intent);
  }

  private selectFastPolicySourceGuidedPriorityCandidates(
    candidates: SearchResult[],
    intent: QueryIntent,
  ): SearchResult[] {
    const pattern = this.getFastPolicySourceGuidedPriorityPattern(intent);
    if (!pattern) return [];

    return candidates
      .map((candidate): SearchResult | null => {
        const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
        if (!pattern.test(sourceText)) return null;

        const boostedScore = Math.max(
          candidate.hybridScore || candidate.score || 0,
          Math.min(1, (candidate.hybridScore || candidate.score || 0) + 0.24),
        );
        candidate.hybridScore = boostedScore;
        candidate.score = boostedScore;
        candidate.evidenceDecision = 'verified';
        candidate.evidenceDecisionReason = Array.from(new Set([
          ...(candidate.evidenceDecisionReason || []),
          'fast_policy_source_priority',
          'keyword_retrieval',
        ]));
        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          'fast_policy_source_priority_match',
        ]));
        candidate.metadata = {
          ...(candidate.metadata || {}),
          fastPolicySourcePriority: true,
          evidenceDecision: candidate.evidenceDecision,
          evidenceDecisionReason: candidate.evidenceDecisionReason,
          rankReason: candidate.rankReason,
          score: boostedScore,
          hybridScore: boostedScore,
        };

        return candidate;
      })
      .filter((candidate: SearchResult | null): candidate is SearchResult => candidate !== null);
  }

  private buildSpecificProductAnchorTerms(intent: QueryIntent): string[] {
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
    ].join(' '));
    const compactQueryText = queryText.replace(/\s+/g, '');
    const naverShoppingDataIntent = this.isNaverShoppingDataIntent(intent);
    const terms: string[] = intent.strictProductTerms
      .filter(term => !this.isGenericStandaloneProductEvidenceTerm(term));
    const add = (...items: string[]) => terms.push(...items);

    if (!intent.vendors.includes('KAKAO') && /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(queryText)) {
      add('DA', 'DA 상품', 'DA상품', '네이버DA', '네이버 DA', '네이버DA상품', '보장형 DA', '스마트채널', '타임보드', '롤링보드', '디스플레이 광고', '디스플레이광고', '성과형 디스플레이', '성과형디스플레이', '홈피드DA', '홈피드', '배너 광고', '배너광고');
    }

    if (/동영상\s*광고|비디오\s*광고|video\s*ads|youtube\s*shorts|shorts\s*광고|쇼츠|숏폼|아웃스트림|video\s*action\s*campaign|\bvac\b/.test(queryText)) {
      add('동영상 광고', '동영상광고', '비디오 광고', '비디오광고', '동영상 조회', '동영상 소재', '숏폼 광고', '숏폼', '아웃스트림', 'Video Ads');
      if (/youtube|유튜브/.test(queryText)) add('YouTube', '유튜브');
      if (/youtube\s*shorts|shorts\s*광고|쇼츠/.test(queryText)) add('YouTube Shorts', 'Shorts', 'Shorts 광고', '쇼츠');
      if (/video\s*action\s*campaign|\bvac\b/.test(queryText)) add('Video action campaign', 'VAC');
    }

    if (/카루셀|캐러셀|carousel|슬라이드\s*광고/.test(queryText)) {
      add('카루셀', '캐러셀', 'Carousel', '슬라이드 광고', '슬라이드 광고 사양', '슬라이드 수', '1080x1080', '해상도');
    }

    if (/(instagram|인스타그램).*(소재|스펙|사양|제작|가이드|광고)|(소재|스펙|사양|제작|가이드).*(instagram|인스타그램)/.test(queryText)) {
      add('Instagram', '인스타그램', 'Instagram 광고', '인스타그램 광고');
    }

    if (/(facebook|페이스북).*(카루셀|캐러셀|carousel|슬라이드|소재|스펙|사양|제작|가이드)|(카루셀|캐러셀|carousel|슬라이드|소재|스펙|사양|제작|가이드).*(facebook|페이스북)/.test(queryText)) {
      add('Facebook 광고 가이드', '페이스북 광고 가이드');
    }

    if (/앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록)|app\s*(install|promotion)|mmp|sdk|사전\s*등록/.test(queryText)) {
      add(
        '앱 인스톨',
        '앱인스톨',
        '앱 설치',
        '앱설치',
        '앱 홍보',
        '앱홍보',
        '앱 캠페인',
        '앱 이벤트',
        '앱 이벤트 최적화',
        'App Install',
        'App Promotion',
        'Mobile App',
        '사전 등록',
        '앱 사전등록',
        '앱 등록',
        'Meta SDK',
        'Facebook SDK',
        'SDK',
        'MMP',
        '모바일 측정 파트너',
        'Mobile Measurement Partner',
        'App ID',
        'App Secret',
        '앱 ID',
        '앱 시크릿',
        '포스트백',
        'postback',
        'tracking_specs',
        '트래킹',
        '추적',
        '인앱 이벤트',
        'SKAdNetwork',
        'SKAN',
        '캠페인 설정',
        '이벤트 설정'
      );
    }

    if (/db\s*url|상품\s*db|상품등록|ep|쇼핑파트너센터|가격비교/.test(queryText) || /상품db|dburl/.test(compactQueryText)) {
      add(
        'DB URL',
        'DBURL',
        'EP',
        'EP(=DB URL)',
        '상품 DB',
        '상품DB',
        '상품 DB URL',
        '상품DB URL',
        '상품등록',
        '상품 등록',
        '신규상품 등록',
        '쇼핑파트너센터',
        '상품정보 수신 현황',
        '등록요청',
        '입점심사',
        '입점 심사',
        '카테고리 자동매칭',
        '카테고리 매칭',
        '가격비교',
        '네이버 가격비교',
        '상품관리'
      );
    }

    if (/리드\s*양식|lead\s*form|lead\s*generation|lead\s*ads?|잠재\s*고객\s*(양식|광고|확장|소재)|잠재고객\s*(양식|광고|확장|소재)|비즈니스\s*폼|비즈니스폼|양식\s*제출/.test(queryText)) {
      add('리드 양식', '리드양식', 'lead form', 'Lead Form', 'Lead Ads', 'Lead Generation', '잠재고객 광고', '잠재 고객 광고', '잠재고객 양식', '잠재 고객 양식', '비즈니스 폼', '비즈니스폼', '양식 제출');
    }

    if (/카탈로그|catalog|advantage\+|어드밴티지|컬렉션|performance\s*max|\bpmax\b|demand\s*gen/.test(queryText)) {
      add('카탈로그', 'catalog', 'Advantage+', '어드밴티지', '컬렉션', 'collection', 'Performance Max', 'PMax', 'Demand Gen');
    }

    if (intent.vendors.includes('KAKAO') && /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard|디스플레이\s*광고|디스플레이광고|displayad|상품\s*가이드|상품가이드|제작\s*가이드|제작가이드|소재|지면|노출|카카오모먼트|광고\s*상품|상품\s*(종류|유형|구분)/.test(queryText)) {
      add(
        '비즈보드',
        '카카오 비즈보드',
        '카카오비즈보드',
        '톡보드',
        'Talkboard',
        'talkboard',
        '디스플레이 광고',
        '디스플레이광고',
        'Display Ad',
        'displayad',
        '카카오모먼트',
        '상품가이드',
        '상품 가이드',
        '제작 가이드',
        '제작가이드',
        '홍보이미지',
        '행동유도버튼',
        '닫힘버튼',
        '메인 카피',
        '서브 카피',
        '노출 지면',
        '소재',
        '심사 가이드',
        '집행 기준',
        '업종별 가이드',
      );
    }

    if (!naverShoppingDataIntent && /쇼핑검색|사이트검색|파워링크|브랜드검색|쇼핑블록|비즈보드|상품가이드|상품\s*가이드/.test(queryText)) {
      add('쇼핑검색', '쇼핑검색광고', '사이트검색광고', '파워링크', '브랜드검색', '쇼핑블록', '비즈보드', '상품가이드', '상품 가이드');
    }

    return Array.from(new Set(
      terms
        .map(term => term.trim())
        .filter(term => term.length >= 2 && !this.isGenericStandaloneProductEvidenceTerm(term))
    ));
  }

  private hasSpecificProductTermOnlyMatch(sourceText: string, intent: QueryIntent): boolean {
    return this.getSpecificProductMatchedTerms(sourceText, intent).length > 0;
  }

  private isNaverDisplayAdIntent(intent: QueryIntent): boolean {
    if (!intent.vendors.includes('NAVER')) return false;
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    return /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(queryText);
  }

  private isNaverVideoProductIntent(intent: QueryIntent): boolean {
    if (!intent.topics.includes('product_structure') || intent.vendors[0] !== 'NAVER') return false;
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ].join(' '));
    return /동영상\s*광고|동영상\s*조회|동영상\s*소재|동영상조회광고|비디오\s*광고|숏폼|쇼츠|아웃스트림|인스트림|네이버\s*클립|클립\s*(광고|서비스)|video\s*ads?/.test(queryText);
  }

  private isKakaoBizboardDisplayProductIntent(intent: QueryIntent): boolean {
    if (!intent.vendors.includes('KAKAO')) return false;
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    return /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard|디스플레이\s*광고|디스플레이광고|displayad|카카오모먼트|상품\s*가이드|상품가이드|제작\s*가이드|제작가이드|소재|지면|노출|광고\s*상품|상품\s*(종류|유형|구분)/.test(queryText);
  }

  private isKakaoBizboardDisplayComparisonIntent(intent: QueryIntent): boolean {
    if (!intent.isComparative || intent.vendors.length !== 1 || intent.vendors[0] !== 'KAKAO') return false;
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    const mentionsBizboard = /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard/.test(queryText);
    const mentionsDisplay = /디스플레이\s*광고|디스플레이광고|displayad|display\s*ad|카카오모먼트/.test(queryText);
    return mentionsBizboard && mentionsDisplay;
  }

  private requiresKakaoBizboardEvidence(intent: QueryIntent): boolean {
    if (!intent.vendors.includes('KAKAO')) return false;
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    return /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard/.test(queryText);
  }

  private hasKakaoBizboardProductSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    return /kakaobusiness\.gitbook\.io\/main\/ad\/moment\/(performance|guarantee)\/talkboard(?:\/|$)/.test(text)
      || /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard/.test(text);
  }

  private hasKakaoBizboardDisplaySignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    return /kakaobusiness\.gitbook\.io\/main\/ad\/moment\/(performance|guarantee)\/(talkboard|displayad|catalog|cpt|cpt-mo|cpt-pc)|\/content-guide/.test(text)
      || /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard|디스플레이\s*광고|디스플레이광고|displayad|카카오모먼트|상품\s*가이드|상품가이드|제작\s*가이드|제작가이드|홍보이미지|행동유도버튼|닫힘버튼|메인\s*카피|서브\s*카피|2:1\s*비율|1:1\s*비율|이미지\s*세부\s*가이드|외곽\s*테두리|리사이징|노출\s*지면|심사\s*가이드|집행\s*기준|업종별\s*가이드|등록\s*불가/.test(text);
  }

  private hasKakaoBizboardDisplayExactSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    return /kakaobusiness\.gitbook\.io\/main\/ad\/moment\/(performance|guarantee)\/(talkboard|displayad)(?:\/|$)/.test(text)
      || /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard|디스플레이\s*광고|디스플레이광고|displayad/.test(text);
  }

  private isKakaoServiceProtectionPolicyIntent(intent: QueryIntent): boolean {
    if (!intent.vendors.includes('KAKAO')) return false;
    if (intent.isSpecificProductGuidance) return false;
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.adPolicyTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    const hasServiceProtectionAsset = /로고|디자인|서비스명|상표|저작물|이미지|브랜드|명칭/.test(queryText);
    const hasServiceProtectionAction = /서비스|보호|모방|침해|무단|사용|사용해도|가능|불가|금지/.test(queryText);
    return hasServiceProtectionAsset && hasServiceProtectionAction;
  }

  private hasKakaoServiceProtectionPolicySignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasKakaoContext = /카카오|kakao|kakaobusiness\.gitbook\.io/.test(text);
    const hasServiceProtectionContext = /카카오\s*서비스\s*보호|카카오\s*서비스|카카오의\s*(?:로고|상표|서비스명|저작물)|서비스명|서비스\s*및\s*디자인/.test(text);
    const hasAssetSignal = /로고|디자인|서비스명|상표|저작물|이미지|브랜드/.test(text);
    const hasRestrictionSignal = /모방|침해|무단|사용\s*불가|발송\s*불가|집행\s*불가|광고\s*집행\s*불가|금지/.test(text);
    return hasKakaoContext && hasServiceProtectionContext && hasAssetSignal && hasRestrictionSignal;
  }

  private isKakaoMeasurementOnlySource(sourceText: string, intent: QueryIntent): boolean {
    const text = this.normalizeSearchText(sourceText);
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ].join(' '));
    const asksMeasurement = /skadnetwork|skan|sdk|픽셀|전환|추적|앱\s*(설치|이벤트)|postback|포스트백|mmp|측정/.test(queryText);
    const skanSource = /skadnetwork|\bskan\b|앱\s*스토어|app\s*store|앱\s*다운로드|앱\s*설치/.test(text);
    if (skanSource && !asksMeasurement) {
      return true;
    }

    const measurementOnly = /skadnetwork|skan|sdk|픽셀|전환\s*추적|앱\s*이벤트|postback|포스트백|mmp|measurement/.test(text);
    const hasProductOrCreative = /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard|디스플레이\s*광고|디스플레이광고|displayad|카카오모먼트|제작\s*가이드|상품\s*가이드|소재|홍보이미지|행동유도버튼|노출\s*지면|심사|업종/.test(text);
    return measurementOnly && !asksMeasurement && !hasProductOrCreative;
  }

  private isOffTopicSpecificProductEvidence(sourceText: string, intent: QueryIntent): boolean {
    if (!intent.isSpecificProductGuidance) return false;
    const text = this.normalizeSearchText(sourceText);
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ].join(' '));
    const asksTrackingOrPrivacy = /전환|추적|픽셀|sdk|mmp|이벤트|개인정보|동의|태그|측정|tracking|conversion|privacy|쿠키|행태/.test(queryText);

    if (this.isNaverDisplayAdIntent(intent)) {
      const privacyOrTrackingOnly = /전환\s*추적|개인정보|행태\s*정보|쿠키|동의|태그\s*설정|tracking|conversion|privacy/.test(text);
      if (privacyOrTrackingOnly && !asksTrackingOrPrivacy) return true;

      const hasDisplayProductName = /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|보장형\s*da|스마트채널|타임보드|롤링보드|홈피드|배너|성과형\s*디스플레이|디스플레이\s*광고/.test(text);
      const hasDisplayAnswerSignal = /지면|노출|게재|소재|사이즈|크기|비율|구매|예약|과금|입찰|집행|등록|심사|검수|제작|상품\s*소개|상품\s*안내|브랜딩|유입/.test(text);
      if (!hasDisplayProductName || !hasDisplayAnswerSignal) return true;
    }

    if (this.isKakaoBizboardDisplayProductIntent(intent)) {
      if (this.isKakaoMeasurementOnlySource(text, intent)) return true;
      const hasOtherVendorProduct = /(네이버|naver|google|구글|meta|facebook|instagram|페이스북|인스타그램)\s*(검색|쇼핑|캠페인|광고|ads?)/.test(text);
      if (hasOtherVendorProduct && !/카카오|kakao/.test(text)) return true;
    }

    return false;
  }

  private getSpecificProductMatchedTerms(sourceText: string, intent: QueryIntent): string[] {
    const terms = this.buildSpecificProductAnchorTerms(intent);
    if (terms.length === 0) return [];
    return terms.filter(term => this.textContainsNormalizedTerm(sourceText, term));
  }

  private hasSpecificProductDetailSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    return /집행|절차|세팅|설정|연동|앱\s*등록|상품\s*등록|계정|권한|승인|요청|공유|테스트|검증|제작|소재|문구|카피|사양|스펙|규격|비율|사이즈|크기|파일|해상도|길이|정책|심사|검수|검토|주의|유의|제한|금지|반려|오류|에러|문제|해결|원인|조치|sdk|mmp|추적|트래킹|이벤트|픽셀|db\s*url|상품\s*db|상품db|ep|쇼핑파트너센터|상품정보\s*수신|등록요청|상품관리|카테고리|가격비교|데이터\s*피드|feed|양식\s*제출|개인정보|고지|동의|상품\s*(소개|안내)|광고\s*(상품|유형|종류)|지면|노출|게재|위치|운영|목적|브랜딩|유입|전환|조회|시청|클릭|구매|예약|입찰|과금|보장형|홈피드|스마트채널|타임보드|롤링보드|헤드라인\s*da|배너/.test(text);
  }

  private hasSpecificProductDetailSignalNearTerm(sourceText: string, term: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const normalizedTerm = this.normalizeSearchText(term);
    if (!text || !normalizedTerm || normalizedTerm.length < 2) return false;

    const detailPattern = /집행|절차|세팅|설정|연동|앱\s*등록|상품\s*등록|계정|권한|승인|요청|공유|테스트|검증|제작|소재|문구|카피|사양|스펙|규격|비율|사이즈|크기|파일|해상도|길이|정책|심사|검수|검토|주의|유의|제한|금지|반려|오류|에러|문제|해결|원인|조치|sdk|mmp|추적|트래킹|이벤트|픽셀|db\s*url|상품\s*db|상품db|ep|쇼핑파트너센터|상품정보\s*수신|등록요청|상품관리|카테고리|가격비교|데이터\s*피드|feed|양식\s*제출|개인정보|고지|동의|상품\s*(소개|안내)|광고\s*(상품|유형|종류)|지면|노출|게재|위치|운영|목적|브랜딩|유입|전환|조회|시청|클릭|구매|예약|입찰|과금|보장형|홈피드|스마트채널|타임보드|롤링보드|헤드라인\s*da|배너/;
    let startIndex = 0;
    while (startIndex < text.length) {
      const index = text.indexOf(normalizedTerm, startIndex);
      if (index < 0) break;
      const windowText = text.slice(Math.max(0, index - 180), Math.min(text.length, index + normalizedTerm.length + 220));
      if (detailPattern.test(windowText)) return true;
      startIndex = index + Math.max(1, normalizedTerm.length);
    }

    const compactTerm = normalizedTerm.replace(/\s+/g, '');
    if (compactTerm.length < 2) return false;
    const compactText = text.replace(/\s+/g, '');
    const compactIndex = compactText.indexOf(compactTerm);
    if (compactIndex < 0) return false;

    // Compact matching handles spacing variants only. Keep the same nearby
    // evidence requirement so a broad catalog page cannot pass just because a
    // detail word appears somewhere else in the chunk.
    const approximateIndex = Math.min(text.length - 1, compactIndex);
    const windowText = text.slice(
      Math.max(0, approximateIndex - 180),
      Math.min(text.length, approximateIndex + normalizedTerm.length + 220),
    );
    return detailPattern.test(windowText);
  }

  private hasSpecificProductDetailSignalNearAnyTerm(sourceText: string, intent: QueryIntent): boolean {
    const text = this.normalizeSearchText(sourceText);
    const matchedTerms = this.getSpecificProductMatchedTerms(text, intent);
    if (matchedTerms.length === 0) return false;
    return matchedTerms.some(term => this.hasSpecificProductDetailSignalNearTerm(text, term));
  }

  private hasSpecificProductDescriptionSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    return /상품|광고|유형|종류|형태|소개|개요|설명|지면|노출|게재|위치|운영|목적|브랜딩|유입|전환|조회|시청|클릭|구매|예약|설치|잠재\s*고객|리드|숏폼|아웃스트림|피드|스토리|릴스|쇼츠|홈피드|스마트채널|타임보드|롤링보드|비즈보드|쇼핑블록|사이트검색|쇼핑검색|디스플레이|배너/.test(text);
  }

  private hasSpecificProductGroundingSignal(sourceText: string): boolean {
    return this.hasSpecificProductDetailSignal(sourceText)
      || this.hasSpecificProductDescriptionSignal(sourceText);
  }

  private hasSpecificProductGroundingSignalNearTerm(sourceText: string, term: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const normalizedTerm = this.normalizeSearchText(term);
    if (!text || !normalizedTerm || normalizedTerm.length < 2) return false;

    const groundingPattern = /집행|절차|세팅|설정|연동|앱\s*등록|상품\s*등록|계정|권한|승인|요청|공유|테스트|검증|제작|소재|문구|카피|사양|스펙|규격|비율|사이즈|크기|파일|해상도|길이|정책|심사|검수|검토|주의|유의|제한|금지|반려|오류|에러|문제|해결|원인|조치|sdk|mmp|추적|트래킹|이벤트|픽셀|db\s*url|상품\s*db|상품db|ep|쇼핑파트너센터|상품정보\s*수신|등록요청|상품관리|카테고리|가격비교|데이터\s*피드|feed|양식\s*제출|개인정보|고지|동의|상품|광고|유형|종류|형태|소개|개요|설명|지면|노출|게재|위치|운영|목적|브랜딩|유입|전환|조회|시청|클릭|구매|예약|설치|잠재\s*고객|리드|숏폼|아웃스트림|피드|스토리|릴스|쇼츠|홈피드|스마트채널|타임보드|롤링보드|비즈보드|쇼핑블록|사이트검색|쇼핑검색|디스플레이|배너/;
    let startIndex = 0;
    while (startIndex < text.length) {
      const index = text.indexOf(normalizedTerm, startIndex);
      if (index < 0) break;
      const windowText = text.slice(Math.max(0, index - 220), Math.min(text.length, index + normalizedTerm.length + 260));
      if (groundingPattern.test(windowText)) return true;
      startIndex = index + Math.max(1, normalizedTerm.length);
    }

    const compactTerm = normalizedTerm.replace(/\s+/g, '');
    if (compactTerm.length < 2) return false;
    const compactText = text.replace(/\s+/g, '');
    const compactIndex = compactText.indexOf(compactTerm);
    if (compactIndex < 0) return false;

    const approximateIndex = Math.min(text.length - 1, compactIndex);
    const windowText = text.slice(
      Math.max(0, approximateIndex - 220),
      Math.min(text.length, approximateIndex + normalizedTerm.length + 260),
    );
    return groundingPattern.test(windowText);
  }

  private hasSpecificProductGroundingSignalNearAnyTerm(sourceText: string, intent: QueryIntent): boolean {
    const text = this.normalizeSearchText(sourceText);
    const matchedTerms = this.getSpecificProductMatchedTerms(text, intent);
    if (matchedTerms.length === 0) return false;
    return matchedTerms.some(term => this.hasSpecificProductGroundingSignalNearTerm(text, term));
  }

  private hasSpecificProductAnswerableSignalNearAnyTerm(sourceText: string, intent: QueryIntent): boolean {
    const text = this.normalizeSearchText(sourceText);
    const matchedTerms = this.getSpecificProductMatchedTerms(text, intent);
    if (matchedTerms.length === 0) return false;

    const answerablePattern = /집행|절차|세팅|설정|연동|등록|계정|권한|승인|요청|공유|테스트|검증|제작|소재|문구|카피|사양|스펙|규격|비율|사이즈|크기|파일|해상도|길이|정책|심사|검수|검토|주의|유의|제한|금지|반려|오류|에러|문제|해결|원인|조치|sdk|mmp|추적|트래킹|이벤트|픽셀|db\s*url|상품\s*db|상품db|ep|쇼핑파트너센터|상품정보\s*수신|등록요청|상품관리|카테고리|가격비교|데이터\s*피드|feed|양식\s*제출|개인정보|고지|동의|지면|노출|게재|위치|브랜딩|유입|전환|조회|시청|클릭|구매|예약|설치|잠재\s*고객|리드|숏폼|아웃스트림|피드|스토리|릴스|쇼츠|홈피드|스마트채널|타임보드|롤링보드|비즈보드|쇼핑블록|사이트검색|쇼핑검색|디스플레이|배너/;

    return matchedTerms.some((term) => {
      const normalizedTerm = this.normalizeSearchText(term);
      if (!normalizedTerm || normalizedTerm.length < 2) return false;

      let startIndex = 0;
      while (startIndex < text.length) {
        const index = text.indexOf(normalizedTerm, startIndex);
        if (index < 0) break;
        const windowText = text.slice(Math.max(0, index - 180), Math.min(text.length, index + normalizedTerm.length + 240));
        if (answerablePattern.test(windowText)) return true;
        startIndex = index + Math.max(1, normalizedTerm.length);
      }

      const compactTerm = normalizedTerm.replace(/\s+/g, '');
      if (compactTerm.length < 2) return false;
      const compactText = text.replace(/\s+/g, '');
      const compactIndex = compactText.indexOf(compactTerm);
      if (compactIndex < 0) return false;
      const approximateIndex = Math.min(text.length - 1, compactIndex);
      const windowText = text.slice(
        Math.max(0, approximateIndex - 180),
        Math.min(text.length, approximateIndex + normalizedTerm.length + 240),
      );
      return answerablePattern.test(windowText);
    });
  }

  private hasSpecificProductAnswerableSignalForIntent(sourceText: string, intent: QueryIntent): boolean {
    const text = this.normalizeSearchText(sourceText);
    if (!this.hasSpecificProductTermMatch(text, intent)) return false;

    if (this.hasSpecificProductAnswerableSignalNearAnyTerm(text, intent)) return true;

    if (this.isNaverShoppingDataIntent(intent) && this.hasStrongNaverShoppingDataSignal(text)) return true;
    if (this.isKakaoBizboardDisplayProductIntent(intent) && this.hasKakaoBizboardDisplaySignal(text)) return true;
    if (this.isNaverVideoProductIntent(intent) && this.hasNaverVideoProductGuideSignal(text)) return true;
    if (this.isBroadProductStructureOnlyText(text, intent)) return false;

    const titleOrGuideSignal = /상품\s*가이드|상품가이드|제작\s*가이드|제작가이드|가이드|도움말|헬프|support|상품\s*소개|상품소개|광고\s*상품|광고상품|캠페인|지면|노출|게재|운영|설정|세팅|등록/.test(text);
    return this.hasSpecificProductDetailSignal(text)
      && (titleOrGuideSignal || this.hasSpecificProductDescriptionSignal(text));
  }

  private isBroadSpecificProductCatalogHit(sourceText: string, intent?: QueryIntent): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasBroadCatalogSignal = (
      /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives/.test(text)
      || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text)
      || /광고\s*상품|광고\s*종류|상품\s*구조|광고\s*구조/.test(text)
    );
    if (!hasBroadCatalogSignal) return false;
    if (!intent) return !this.hasSpecificProductDetailSignal(text);

    const matchedTerms = this.getSpecificProductMatchedTerms(text, intent);
    if (matchedTerms.length === 0) return true;
    const hasNearbyDetail = matchedTerms.some(term => this.hasSpecificProductDetailSignalNearTerm(text, term));
    const hasNearbyGrounding = matchedTerms.some(term => this.hasSpecificProductGroundingSignalNearTerm(text, term));
    return !hasNearbyDetail && !hasNearbyGrounding;
  }

  private hasSpecificProductTermMatch(sourceText: string, intent: QueryIntent): boolean {
    if (!this.sourceTextMatchesSpecificProductFamily(sourceText, intent)) return false;
    const matchedTerms = this.getSpecificProductMatchedTerms(sourceText, intent);
    if (matchedTerms.length === 0) return false;
    return !this.isBroadSpecificProductCatalogHit(sourceText, intent);
  }

  private isBroadProductStructureOnlyText(sourceText: string, intent: QueryIntent): boolean {
    if (!intent.isSpecificProductGuidance) return false;
    if (this.hasSpecificProductTermMatch(sourceText, intent)) return false;

    const text = this.normalizeSearchText(sourceText);
    return (
      /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives/.test(text)
      || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text)
      || /광고\s*상품|광고\s*종류|상품\s*구조|광고\s*구조/.test(text)
    );
  }

  private buildCandidateDedupeKey(candidate: SearchResult): string {
    return [
      candidate.documentId || candidate.metadata?.document_id || '',
      candidate.id || candidate.metadata?.chunk_id || '',
      candidate.documentTitle || candidate.metadata?.title || '',
    ].join(':');
  }

  private buildRawRowTitleText(row: any): string {
    const metadata = row?.metadata || {};
    return this.normalizeSearchText([
      metadata.title,
      metadata.source_title,
      metadata.canonical_title,
      metadata.documentTitle,
      metadata.source,
      row?.title,
      row?.document_title,
    ].filter(Boolean).join(' '));
  }

  private buildRawRowEvidenceText(row: any): string {
    const metadata = row?.metadata || {};
    const content = typeof row?.content === 'string' ? row.content : '';
    const title = this.buildRawRowTitleText(row);
    return this.buildCandidateEvidenceText(content, title, metadata);
  }

  private buildRawRowSearchText(row: any): string {
    const metadata = row?.metadata || {};
    const content = typeof row?.content === 'string' ? row.content : '';
    const title = this.buildRawRowTitleText(row);
    return this.buildCandidateSearchText(content, title, {
      ...metadata,
      document_id: row?.document_id || metadata.document_id,
      chunk_id: row?.chunk_id || row?.id || metadata.chunk_id,
    });
  }

  private getRawRowVendor(row: any): VendorIntent | null {
    const metadata = row?.metadata || {};
    return this.normalizeVendorToken(
      metadata.source_vendor
      || metadata.sourceVendor
      || metadata.vendor
      || metadata.platform
      || metadata.source
    );
  }

  private isPolicyOrTermsQuestion(intent?: QueryIntent): boolean {
    if (!intent) return false;
    return (
      intent.topics.some(topic => topic !== 'product_structure')
      || intent.adPolicyTerms.length > 0
      || /정책|심사|승인|반려|검수|검토|금지|제한|유의|주의/.test(this.normalizeSearchText(intent.keywords.join(' ')))
    );
  }

  private isBroadLowValueRawRow(row: any, intent?: QueryIntent): boolean {
    const titleText = this.buildRawRowTitleText(row);
    const searchText = this.buildRawRowSearchText(row);
    const content = typeof row?.content === 'string' ? row.content : '';

    if (this.isPlaceholderContent(content)) return true;
    if (/이\s*url은\s*서버리스|javascript|__next_f|loading|로그인|권한이\s*필요/.test(searchText)) return true;

    const broadTitle = /공지사항|새소식|이용약관|운영정책|개인정보\s*처리방침|개인정보처리방침|자주\s*묻는\s*질문|faq|목록|전체보기|고객센터/.test(titleText);
    if (!broadTitle) return false;

    if (!intent) return true;
    if (intent.topics.includes('product_structure') && !this.isPolicyOrTermsQuestion(intent)) {
      return true;
    }
    return false;
  }

  private hasProductGuideRawSignal(row: any): boolean {
    const text = this.buildRawRowSearchText(row);
    return /상품소식|상품\s*가이드|제작\s*가이드|제작가이드|운영하기|활용하기|도움말|헬프|support|business\s*help|고객\s*시선|숏폼|아웃스트림|쇼핑검색광고|사이트검색광고|파워링크|브랜드검색|쇼핑블록|비즈보드|스마트채널|타임보드|롤링보드|홈피드|성과형\s*디스플레이|광고\s*상품|상품\s*유형|상품\s*소개/.test(text);
  }

  private scoreRawCreativeSpecRowForIntent(titleText: string, evidenceText: string, intent?: QueryIntent): number {
    if (!intent?.isSpecificProductGuidance || !intent.topics.includes('product_structure')) return 0;

    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    const asksCreativeSpec = intent.topics.includes('spec')
      || /소재|스펙|사양|제작|규격|비율|사이즈|크기|카루셀|캐러셀|carousel|슬라이드/.test(queryText);
    if (!asksCreativeSpec) return 0;

    const text = this.normalizeSearchText(`${titleText} ${evidenceText}`);
    if (!this.hasSpecificProductTermMatch(text, intent)) return 0;

    const hasSpecCoreSignal = /광고\s*사양|슬라이드\s*광고\s*사양|디자인\s*추천\s*사항|기술\s*요구\s*사항|해상도|1080x|1080\s*x|1080픽셀|비율|슬라이드\s*수|2\s*~\s*10|2~10|파일\s*(크기|형식)|지원\s*형식/.test(text);
    let score = 0;

    if (hasSpecCoreSignal) score += 170;
    if (/슬라이드\s*광고\s*사양|참여\s*슬라이드\s*광고\s*사양|carousel\s*ad\s*spec/.test(text)) score += 120;
    if (/1080x1080|1080\s*x\s*1080|1080픽셀|해상도/.test(text)) score += 90;
    if (/슬라이드\s*수|2\s*~\s*10|2~10|최대\s*10개/.test(text)) score += 70;
    if (/디자인\s*추천\s*사항|기술\s*요구\s*사항|jpg|png|mp4|mov|최대\s*(이미지|동영상|파일)/.test(text)) score += 55;
    if (/href=|data-ms|<div|<a\s|&quot;|&#123;/.test(text) && !hasSpecCoreSignal) score -= 160;

    return score;
  }

  private scoreRawRowForIntent(
    row: any,
    options: {
      keywords?: string[];
      intent?: QueryIntent;
      vendor?: VendorIntent;
      anchor?: string;
    } = {}
  ): number {
    const intent = options.intent;
    const keywords = Array.from(new Set((options.keywords || [])
      .map(keyword => keyword.trim())
      .filter(keyword => keyword.length >= 2)));
    const titleText = this.buildRawRowTitleText(row);
    const searchText = this.buildRawRowSearchText(row);
    const evidenceText = this.buildRawRowEvidenceText(row);
    const rowVendor = this.getRawRowVendor(row);
    let score = 0;

    if (options.vendor) {
      score += rowVendor === options.vendor ? 90 : rowVendor ? -160 : 0;
    }

    if (intent?.vendors.length) {
      const targetVendorMatch = intent.vendors.some(vendor => (
        rowVendor === vendor
        || getCompassVendorTerms(vendor).some(term => this.textContainsNormalizedTerm(searchText, term))
      ));
      const singleVendorProductStructurePenalty = (
        intent.vendors.length === 1
        && intent.topics.includes('product_structure')
      )
        ? -220
        : -35;
      score += targetVendorMatch ? 45 : singleVendorProductStructurePenalty;
    }

    if (options.anchor) {
      if (this.textContainsNormalizedTerm(titleText, options.anchor)) score += 95;
      if (this.textContainsNormalizedTerm(evidenceText, options.anchor)) score += 38;
    }

    for (const keyword of keywords) {
      if (this.textContainsNormalizedTerm(titleText, keyword)) score += 18;
      if (this.textContainsNormalizedTerm(searchText, keyword)) score += 5;
    }

    if (intent?.topics.includes('product_structure')) {
      if (this.hasProductGuideRawSignal(row)) score += 42;
      if (this.hasHighValueProductStructureSignal(evidenceText)) score += 38;
      if (this.hasProductStructureSignal(evidenceText)) score += 16;
      score += this.scoreRawCreativeSpecRowForIntent(titleText, evidenceText, intent);
      if (this.isMetaAppInstallIntent(intent)) {
        if (/sdk|mmp|mobile\s*measurement\s*partner|모바일\s*측정\s*파트너|앱\s*이벤트|app\s*event|이벤트\s*관리자|포스트백|postback|앱\s*(id|시크릿)|app\s*(id|secret)/i.test(evidenceText)) {
          score += 150;
        }
        if (/광고\s*관리자\s*목표|마케팅\s*목표|인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재\s*고객[\s\S]{0,80}앱\s*홍보[\s\S]{0,80}판매/.test(evidenceText)
          && !/sdk|mmp|앱\s*이벤트|app\s*event|포스트백|postback/i.test(evidenceText)
        ) {
          score -= 70;
        }
      }
    }

    if (intent?.isSpecificProductGuidance) {
      const matchedTerms = this.getSpecificProductMatchedTerms(evidenceText, intent);
      if (matchedTerms.length > 0) score += 115 + Math.min(80, matchedTerms.length * 18);
      if (this.hasSpecificProductGroundingSignalNearAnyTerm(evidenceText, intent)) score += 95;
      if (this.hasSpecificProductDetailSignalNearAnyTerm(evidenceText, intent)) score += 42;
      if (this.isBroadSpecificProductCatalogHit(evidenceText, intent)) score -= 190;
      if (this.isOffAxisProductStructureEvidence(evidenceText, intent)) score -= 170;
    }

    if (this.isBroadLowValueRawRow(row, intent)) score -= 140;
    if (/공지사항|이용약관|운영정책/.test(titleText) && intent?.topics.includes('product_structure')) score -= 80;

    return score;
  }

  private rankRawRowsForIntent<T extends { row: any }>(
    rows: T[],
    limit: number,
    options: {
      keywords?: string[];
      intent?: QueryIntent;
      vendor?: VendorIntent;
      anchor?: string;
    } = {}
  ): T[] {
    return rows
      .map((item, index) => ({
        item,
        index,
        sourceCandidateRawRank: this.scoreRawRowForIntent(item.row, options),
      }))
      .sort((a, b) => {
        if (b.sourceCandidateRawRank !== a.sourceCandidateRawRank) {
          return b.sourceCandidateRawRank - a.sourceCandidateRawRank;
        }
        return a.index - b.index;
      })
      .slice(0, limit)
      .map(item => item.item);
  }

  private async searchKnownOfficialDocumentChunks(
    chunkIds: string[],
    limit: number,
    intent: QueryIntent,
    vendor: VendorIntent,
    anchor: string,
  ): Promise<Array<{ row: any; corpus: RetrievalCorpus; anchor: string }>> {
    try {
      const uniqueChunkIds = Array.from(new Set(chunkIds.map(id => id.trim()).filter(Boolean)));
      if (uniqueChunkIds.length === 0) return [];
      const fetchLimit = Math.min(Math.max(limit, 1), uniqueChunkIds.length);
      const cacheKey = this.buildSupabaseRowsCacheKey('known_official_document_chunks', {
        tableName: 'document_chunks',
        vendor,
        anchor,
        chunkIds: uniqueChunkIds,
        fetchLimit,
      });

      const data = await this.loadCachedSupabaseRows(cacheKey, async () => {
        const { data, error } = await this.supabase
          .from('document_chunks')
          .select('id, document_id, chunk_id, content, metadata')
          .in('id', uniqueChunkIds)
          .limit(fetchLimit);

        if (error) {
          console.warn('Known official document chunk lookup failed', {
            vendor,
            anchor,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          return null;
        }

        return data || [];
      });
      if (data === null) return [];

      const chunkOrder = new Map(uniqueChunkIds.map((chunkId, index) => [chunkId, index]));
      return data
        .map((row: any) => ({
          row,
          corpus: 'document_chunks' as RetrievalCorpus,
          anchor,
          order: chunkOrder.get(String(row?.id || '')) ?? Number.MAX_SAFE_INTEGER,
        }))
        .sort((a, b) => a.order - b.order)
        .slice(0, limit)
        .map(({ row, corpus, anchor }) => ({ row, corpus, anchor }));
    } catch (error) {
      console.warn('Known official document chunk lookup threw', {
        vendor,
        anchor,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return [];
    }
  }

  private async searchProductStructureAnchorTable(
    tableName: 'ollama_document_chunks' | 'document_chunks',
    anchor: string,
    limit: number,
    vendor?: VendorIntent,
    intent?: QueryIntent
  ): Promise<Array<{ row: any; corpus: RetrievalCorpus; anchor: string }>> {
    try {
      const selectColumns = tableName === 'ollama_document_chunks'
        ? 'chunk_id, document_id, content, metadata'
        : 'id, document_id, chunk_id, content, metadata';
      const fetchLimit = this.getProductStructureAnchorFetchLimit(limit, intent);
      const cacheKey = this.buildSupabaseRowsCacheKey('product_structure_anchor', {
        tableName,
        anchor,
        vendor,
        fetchLimit,
      });

      const data = await this.loadCachedSupabaseRows(cacheKey, async () => {
        let query = this.supabase
          .from(tableName)
          .select(selectColumns)
          .ilike('content', `%${anchor}%`);

        if (vendor) {
          query = query.eq('metadata->>source_vendor', vendor);
        }

        const { data, error } = await query.limit(fetchLimit);

        if (error) {
          console.warn('Product-structure anchor search failed', {
            tableName,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          return null;
        }

        return data || [];
      });
      if (data === null) return [];

      const rows = data.map((row: any) => ({
        row,
        corpus: tableName,
        anchor,
      }));
      return this.rankRawRowsForIntent(rows, limit, {
        keywords: [anchor],
        intent,
        vendor,
        anchor,
      });
    } catch (error) {
      console.warn('Product-structure anchor search threw', {
        tableName,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return [];
    }
  }

  private async searchVendorMetadataTable(
    tableName: 'ollama_document_chunks' | 'document_chunks',
    vendor: VendorIntent,
    keywords: string[],
    limit: number,
    intent: QueryIntent
  ): Promise<Array<{ row: any; corpus: RetrievalCorpus }>> {
    try {
      const selectColumns = tableName === 'ollama_document_chunks'
        ? 'chunk_id, document_id, content, metadata'
        : 'id, document_id, chunk_id, content, metadata';
      const searchTerms = this.selectSupabaseKeywordSearchTerms(keywords, intent, vendor);
      if (searchTerms.length === 0) return [];
      const keywordConditions = searchTerms.map(keyword => `content.ilike.%${keyword}%`);
      const fetchLimit = this.getVendorMetadataFetchLimit(limit, intent);
      const cacheKey = this.buildSupabaseRowsCacheKey('vendor_metadata_keyword', {
        tableName,
        vendor,
        searchTerms,
        fetchLimit,
      });

      const data = await this.loadCachedSupabaseRows(cacheKey, async () => {
        const { data, error } = await this.supabase
          .from(tableName)
          .select(selectColumns)
          .eq('metadata->>source_vendor', vendor)
          .or(keywordConditions.join(','))
          .limit(fetchLimit);

        if (error) {
          console.warn('Vendor metadata keyword search failed', {
            tableName,
            vendor,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          return null;
        }

        console.log(`📊 ${tableName} ${vendor} metadata keyword 검색 결과: ${data?.length || 0}개`);
        return data || [];
      });
      if (data === null) return [];

      const rows = data.map((row: any) => ({
        row,
        corpus: tableName,
      }));
      return this.rankRawRowsForIntent(rows, limit * 3, {
        keywords,
        intent,
        vendor,
      });
    } catch (error) {
      console.warn('Vendor metadata keyword search threw', {
        tableName,
        vendor,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return [];
    }
  }

  private async searchKeywordTable(
    tableName: 'ollama_document_chunks' | 'document_chunks',
    keywords: string[],
    limit: number,
    intent?: QueryIntent,
    vendor?: VendorIntent,
    options: { rawKeywordsOnly?: boolean } = {},
  ): Promise<Array<{ row: any; corpus: RetrievalCorpus }>> {
    try {
      const selectColumns = tableName === 'ollama_document_chunks'
        ? 'chunk_id, document_id, content, metadata'
        : 'id, document_id, chunk_id, content, metadata';
      const searchTerms = this.selectSupabaseKeywordSearchTerms(keywords, intent, vendor, options);
      if (searchTerms.length === 0) return [];
      const keywordConditions = searchTerms.map(keyword => `content.ilike.%${keyword}%`);
      const fetchLimit = this.getKeywordTableFetchLimit(limit, intent);
      const cacheKey = this.buildSupabaseRowsCacheKey('keyword_table', {
        tableName,
        vendor,
        rawKeywordsOnly: options.rawKeywordsOnly === true,
        searchTerms,
        fetchLimit,
      });

      const data = await this.loadCachedSupabaseRows(cacheKey, async () => {
        let request = this.supabase
          .from(tableName)
          .select(selectColumns)
          .or(keywordConditions.join(','));
        if (vendor) {
          request = request.eq('metadata->>source_vendor', vendor);
        }
        const { data, error } = await request.limit(fetchLimit);

        if (error) {
          console.warn('Keyword table search failed', {
            tableName,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
          return null;
        }

        console.log(`📊 ${tableName} keyword 검색 결과: ${data?.length || 0}개`);
        return data || [];
      });
      if (data === null) return [];

      const rows = data.map((row: any) => ({
        row,
        corpus: tableName,
      }));
      return this.rankRawRowsForIntent(rows, limit * 3, {
        keywords,
        intent,
        vendor,
      });
    } catch (error) {
      console.warn('Keyword table search threw', {
        tableName,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return [];
    }
  }

  private normalizeCandidate(
    result: any,
    options: {
      queryEmbedding?: number[];
      keywords?: string[];
      intent: QueryIntent;
      retrievalMethod: RetrievalMethod;
      corpus: RetrievalCorpus;
      evidenceType: EvidenceType;
    }
  ): SearchResult | null {
    const content = typeof result.content === 'string' ? result.content : '';
    const rawChunkId = result.id ?? result.chunk_id;
    const chunkId = String(rawChunkId || `${result.document_id || 'unknown'}_chunk_0`);
    const documentId = result.document_id || result.metadata?.document_id || this.inferDocumentId(chunkId);
    const documentTitle =
      result.metadata?.title
      || result.metadata?.source_title
      || result.metadata?.canonical_title
      || result.title
      || result.metadata?.source
      || this.inferDocumentTitleFromContent(content)
      || 'Unknown';
    const documentUrl = result.metadata?.source_url || result.metadata?.document_url || result.metadata?.url;
    const chunkIndex = this.inferChunkIndex(chunkId, result.chunk_id);
    const warnings: string[] = [];

    if (!documentId) warnings.push('missing_document_id');
    if (!documentTitle || documentTitle === 'Unknown') warnings.push('missing_title');
    if (!documentUrl) warnings.push('missing_url');
    if (!content.trim()) warnings.push('missing_excerpt');
    if (this.isPlaceholderContent(content)) warnings.push('placeholder_content');

    const vectorScore = this.resolveVectorScore(result, options.queryEmbedding);
    const sourceText = this.buildCandidateSearchText(content, documentTitle, {
      ...(result.metadata || {}),
      document_id: documentId,
      chunk_id: chunkId,
    });
    const lexicalOverlap = this.calculateLexicalOverlap(sourceText, options.intent.keywords);
    const vendorAlignment = this.calculateVendorAlignment(sourceText, options.intent.vendors, {
      metadata: result.metadata,
      title: documentTitle,
      url: documentUrl,
      documentId,
    });
    const topicMatch = this.hasTopicMatch(sourceText, options.intent.topics);
    const topicExactMatch = this.hasExactTopicMatch(sourceText, options.intent.topics);
    const policyTitleMatch = this.hasPolicyGradeTitle(documentTitle, result.metadata);
    const originalMetaSeed = this.isOriginalMetaSeedCandidate({
      chunkId,
      corpus: options.corpus,
      sourceVendor: vendorAlignment.primaryVendor,
      metadata: result.metadata,
    });
    const keywordScore = this.calculateKeywordScore(
      content,
      documentTitle,
      options.keywords || [],
      lexicalOverlap,
      topicMatch,
      topicExactMatch,
      policyTitleMatch
    );
    const sourceQuality = this.buildSourceQuality({
      documentId,
      documentTitle,
      documentUrl,
      content,
      metadata: result.metadata,
      corpus: options.corpus,
      warnings,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      sourceVendor: vendorAlignment.primaryVendor,
      policyTitleMatch,
    });
    let hybridScore = this.calculateHybridScore({
      vectorScore,
      keywordScore,
      sourceQualityScore: sourceQuality.qualityScore || 0,
      retrievalMethod: options.retrievalMethod,
      corpus: options.corpus,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      genericPolicyIntent: this.isGenericPolicyIntent(options.intent),
      originalMetaSeed,
      hasUrl: sourceQuality.hasUrl,
    });
    const productStructureEvidenceText = this.buildCandidateEvidenceText(content, documentTitle, result.metadata);
    const productStructureAdjustment = this.calculateProductStructureScoreAdjustment(productStructureEvidenceText, options.intent);
    if (productStructureAdjustment.adjustment !== 0) {
      hybridScore = Math.max(0, Math.min(1, hybridScore + productStructureAdjustment.adjustment));
    }
    const rankReason = Array.from(new Set([
      ...this.buildRankReason({
      vectorScore,
      keywordScore,
      sourceQuality,
      corpus: options.corpus,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      genericPolicyIntent: this.isGenericPolicyIntent(options.intent),
      originalMetaSeed,
      hasUrl: sourceQuality.hasUrl,
      }),
      ...productStructureAdjustment.reasons,
    ]));
    const evidenceDecision = this.decideEvidence({
      content,
      sourceQuality,
      retrievalMethod: options.retrievalMethod,
      corpus: options.corpus,
      hybridScore,
      vectorScore,
      keywordScore,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      topicExactMatch,
      policyTitleMatch,
    });

    return {
      id: chunkId,
      content,
      similarity: vectorScore || keywordScore || hybridScore,
      score: hybridScore,
      hybridScore,
      vectorScore,
      keywordScore,
      corpus: options.corpus,
      evidenceType: options.evidenceType,
      evidenceDecision: evidenceDecision.decision,
      evidenceDecisionReason: evidenceDecision.reasons,
      rankReason,
      lexicalOverlap,
      vendorMatch: vendorAlignment.match,
      vendorMismatch: vendorAlignment.mismatch,
      sourceVendor: vendorAlignment.primaryVendor,
      sourceVendors: vendorAlignment.sourceVendors,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      retrievalMethod: options.retrievalMethod,
      documentId,
      documentTitle,
      documentUrl,
      chunkIndex,
      metadata: {
        ...(result.metadata || {}),
        retrievalMethod: options.retrievalMethod,
        evidenceType: options.evidenceType,
        corpus: options.corpus,
        evidenceDecision: evidenceDecision.decision,
        evidenceDecisionReason: evidenceDecision.reasons,
        score: hybridScore,
        hybridScore,
        vectorScore,
        keywordScore,
        lexicalOverlap,
        vendorMatch: vendorAlignment.match,
        vendorMismatch: vendorAlignment.mismatch,
        sourceVendor: vendorAlignment.primaryVendor,
        sourceVendors: vendorAlignment.sourceVendors,
        topicMatch,
        topicExactMatch,
        policyTitleMatch,
        originalTitle: documentTitle,
        documentId,
        sourceQualityWarnings: sourceQuality.warnings,
      },
      sourceQuality,
    };
  }

  private mergeDedupeAndRankCandidates(candidates: SearchResult[], limit: number, intent: QueryIntent): SearchResult[] {
    const byKey = new Map<string, SearchResult>();
    const hasTargetVendorRescueCandidate = candidates.some(candidate => this.isTargetVendorRescueCandidate(candidate, intent));
    const hasGenericTopicRescueCandidate = candidates.some(candidate => this.isGenericTopicRescueCandidate(candidate, intent));

    for (const candidate of candidates) {
      if (
        intent.topics.includes('product_structure')
        && this.isEvidenceGraphCandidate(candidate)
        && this.isOfficialGraphCandidate(candidate)
        && this.isLowValueProductStructureGraphCandidate(candidate, intent)
      ) {
        continue;
      }

      if (!this.isVerifiedEvidence(candidate, intent, hasTargetVendorRescueCandidate, hasGenericTopicRescueCandidate)) {
        continue;
      }

      const dedupeKeys = this.getDedupeKeys(candidate);
      const existingKey = dedupeKeys.find(key => byKey.has(key));

      if (!existingKey) {
        byKey.set(dedupeKeys[0], candidate);
        continue;
      }

      const existing = byKey.get(existingKey)!;
      const merged = this.mergeDuplicateCandidate(existing, candidate, intent);
      byKey.delete(existingKey);
      byKey.set(this.getDedupeKeys(merged)[0], merged);
    }

    const documentCounts = new Map<string, number>();
    const titleCounts = new Map<string, number>();

    const ranked = Array.from(byKey.values())
      .sort((a, b) => (
        this.isNaverShoppingDataIntent(intent)
          ? this.scoreNaverShoppingDataCandidate(b, intent) - this.scoreNaverShoppingDataCandidate(a, intent)
          : this.scoreSearchCandidateForRanking(b, intent) - this.scoreSearchCandidateForRanking(a, intent)
      ));
    const rescueCandidate = ranked.find(candidate => this.isTargetVendorRescueCandidate(candidate, intent));
    const genericRescueCandidate = ranked.find(candidate => this.isGenericTopicRescueCandidate(candidate, intent));
    const maxPerDocument = intent.topics.includes('product_structure')
      ? (this.isNaverShoppingDataIntent(intent) || intent.isSpecificProductGuidance ? 2 : 1)
      : 2;
    const maxPerTitle = intent.topics.includes('product_structure')
      ? (this.isNaverShoppingDataIntent(intent) || intent.isSpecificProductGuidance ? 2 : 1)
      : 2;

    const selected = ranked.filter((candidate) => {
        const docKey = candidate.documentId || candidate.id;
        const titleKey = candidate.documentTitle || docKey;
        const docCount = documentCounts.get(docKey) || 0;
        const titleCount = titleCounts.get(titleKey) || 0;

        if (docCount >= maxPerDocument || titleCount >= maxPerTitle) {
          return false;
        }

        documentCounts.set(docKey, docCount + 1);
        titleCounts.set(titleKey, titleCount + 1);
        return true;
      })
      .slice(0, limit);

    if (
      genericRescueCandidate
      && !selected.some(candidate => candidate.id === genericRescueCandidate.id)
      && selected.length > 0
    ) {
      genericRescueCandidate.rankReason = Array.from(new Set([
        ...(genericRescueCandidate.rankReason || []),
        'generic_topic_rescue',
      ]));
      const replacementIndex = this.findWeakestGenericPolicyReplacementIndex(selected, intent);
      selected[replacementIndex] = genericRescueCandidate;
      const rescueSelected = selected.sort((a, b) => {
        if (a.id === genericRescueCandidate.id) return -1;
        if (b.id === genericRescueCandidate.id) return 1;
        return this.scoreSearchCandidateForRanking(b, intent) - this.scoreSearchCandidateForRanking(a, intent);
      });
      return this.applyVendorSlots(rescueSelected, ranked, limit, intent);
    }

    if (
      rescueCandidate
      && !selected.some(candidate => candidate.id === rescueCandidate.id)
      && selected.length > 0
    ) {
      rescueCandidate.rankReason = Array.from(new Set([
        ...(rescueCandidate.rankReason || []),
        'target_vendor_document_chunks_rescue',
      ]));
      selected[selected.length - 1] = rescueCandidate;
      const rescueSelected = selected.sort((a, b) => {
        if (a.id === rescueCandidate.id) return -1;
        if (b.id === rescueCandidate.id) return 1;
        return this.scoreSearchCandidateForRanking(b, intent) - this.scoreSearchCandidateForRanking(a, intent);
      });
      return this.applyVendorSlots(rescueSelected, ranked, limit, intent);
    }

    return this.applyVendorSlots(selected, ranked, limit, intent);
  }

  private applyVendorSlots(
    selected: SearchResult[],
    ranked: SearchResult[],
    limit: number,
    intent: QueryIntent
  ): SearchResult[] {
    if (!intent.requiresVendorCoverage || intent.vendors.length <= 1) {
      return this.ensureGraphEvidenceCoverage(
        this.filterLowValuePolicySources(selected, intent),
        ranked,
        limit,
        intent
      )
        .slice(0, limit)
        .sort((a, b) => this.scoreSearchCandidateForRanking(b, intent) - this.scoreSearchCandidateForRanking(a, intent));
    }

    const next = [...selected];

    for (const vendor of intent.vendors) {
      const existingSlotIndexes = next
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => this.matchesVendorSlot(candidate, vendor));
      const bestCandidate = this.pickBestVendorSlotCandidate(ranked, next, vendor, intent);

      if (existingSlotIndexes.length > 0) {
        if (!bestCandidate) {
          continue;
        }

        const weakestExisting = existingSlotIndexes
          .sort((a, b) => (
            this.scoreVendorSlotCandidate(a.candidate, intent) - this.scoreVendorSlotCandidate(b.candidate, intent)
          ))[0];

        if (
          this.scoreVendorSlotCandidate(bestCandidate, intent)
          <= this.scoreVendorSlotCandidate(weakestExisting.candidate, intent) + 0.04
        ) {
          continue;
        }

        bestCandidate.rankReason = Array.from(new Set([
          ...(bestCandidate.rankReason || []),
          `required_vendor_slot_upgrade_${vendor.toLowerCase()}`,
        ]));
        bestCandidate.metadata = {
          ...(bestCandidate.metadata || {}),
          coverageRole: `required_vendor_slot_upgrade_${vendor}`,
        };
        next[weakestExisting.index] = bestCandidate;
        continue;
      }

      const candidate = bestCandidate;

      if (!candidate) {
        continue;
      }

      candidate.rankReason = Array.from(new Set([
        ...(candidate.rankReason || []),
        `required_vendor_slot_${vendor.toLowerCase()}`,
      ]));
      candidate.metadata = {
        ...(candidate.metadata || {}),
        coverageRole: `required_vendor_slot_${vendor}`,
      };

      if (next.length < limit) {
        next.push(candidate);
        continue;
      }

      const replacementIndex = this.findVendorSlotReplacementIndex(next, intent);
      next[replacementIndex] = candidate;
    }

    const balanced = this.balanceVendorSlots(next, ranked, limit, intent);
    const policyFiltered = this.filterLowValuePolicySources(balanced, intent);

    return this.ensureGraphEvidenceCoverage(policyFiltered, ranked, limit, intent)
      .slice(0, limit)
      .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));
  }

  private ensureGraphEvidenceCoverage(
    selected: SearchResult[],
    ranked: SearchResult[],
    limit: number,
    intent: QueryIntent
  ): SearchResult[] {
    if (!intent.topics.includes('product_structure')) {
      return selected;
    }
    const specificProductIntent = intent.isSpecificProductGuidance;
    const isSpecificOfficialGraphMatch = (candidate: SearchResult) => {
      if (!this.isTargetOfficialGraphCandidate(candidate, intent)) return false;
      if (!specificProductIntent) return true;

      const sourceText = this.buildCandidateEvidenceText(
        candidate.content,
        candidate.documentTitle,
        candidate.metadata
      );
      return (
        this.isOfficialGraphCreativeSpecCandidateForIntent(candidate, intent, sourceText)
        || (
          this.hasSpecificProductTermMatch(sourceText, intent)
          && !this.isBroadProductStructureOnlyText(sourceText, intent)
        )
      );
    };

    if (selected.some(candidate => isSpecificOfficialGraphMatch(candidate))) {
      return selected;
    }

    const graphCandidate = ranked
      .filter(candidate => this.isEvidenceGraphCandidate(candidate))
      .filter(candidate => this.isOfficialGraphCandidate(candidate))
      .filter(candidate => !this.isLowValueProductStructureGraphCandidate(candidate, intent))
      .filter(candidate => {
        if (!specificProductIntent) return true;

        const sourceText = this.buildCandidateEvidenceText(
          candidate.content,
          candidate.documentTitle,
          candidate.metadata
        );
        return (
          this.isOfficialGraphCreativeSpecCandidateForIntent(candidate, intent, sourceText)
          || (
            this.hasSpecificProductTermMatch(sourceText, intent)
            && !this.isBroadProductStructureOnlyText(sourceText, intent)
          )
        );
      })
      .filter(candidate => !selected.some(selectedCandidate => this.isSameSearchCandidate(selectedCandidate, candidate)))
      .filter(candidate => (
        intent.vendors.length === 0
        || intent.vendors.some(vendor => (
          this.matchesExplicitGraphVendor(candidate, vendor)
          || this.matchesVendorSlot(candidate, vendor)
        ))
      ))
      .sort((a, b) => this.scoreVendorSlotCandidate(b, intent) - this.scoreVendorSlotCandidate(a, intent))[0];

    if (!graphCandidate) {
      return selected;
    }

    graphCandidate.rankReason = Array.from(new Set([
      ...(graphCandidate.rankReason || []),
      'official_guide_graph_rag_coverage',
    ]));
    graphCandidate.metadata = {
      ...(graphCandidate.metadata || {}),
      coverageRole: 'official_guide_graph_rag_coverage',
    };

    const next = [...selected];
    if (next.length < limit) {
      next.push(graphCandidate);
      return next;
    }

    const replacement = next
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => !this.isEvidenceGraphCandidate(candidate))
      .sort((a, b) => this.scoreVendorSlotCandidate(a.candidate, intent) - this.scoreVendorSlotCandidate(b.candidate, intent))[0];

    if (!replacement) {
      return selected;
    }

    next[replacement.index] = graphCandidate;
    return next;
  }

  private ensureProductStructureGraphCandidateCoverage(
    selected: SearchResult[],
    candidates: SearchResult[],
    limit: number,
    intent: QueryIntent
  ): SearchResult[] {
    if (!intent.topics.includes('product_structure')) {
      return selected;
    }

    const selectedTargetGraphCandidate = selected.find(candidate => this.isTargetOfficialGraphCandidate(candidate, intent));
    const officialGraphCandidates = [...selected, ...candidates]
      .filter(candidate => this.isEvidenceGraphCandidate(candidate))
      .filter(candidate => this.isOfficialGraphCandidate(candidate));
    const vendorMatchedGraphCandidates = officialGraphCandidates
      .filter(candidate => (
        intent.vendors.length === 0
        || intent.vendors.some(vendor => (
          this.matchesExplicitGraphVendor(candidate, vendor)
          || this.matchesVendorSlot(candidate, vendor)
        ))
      ))
      .filter(candidate => !this.isLowValueProductStructureGraphCandidate(candidate, intent));
    const graphCandidate = vendorMatchedGraphCandidates
      .sort((a, b) => this.scoreProductStructureGraphCandidate(b, intent) - this.scoreProductStructureGraphCandidate(a, intent))[0];

    if (!graphCandidate) {
      return selected;
    }

    if (selected.some(candidate => this.isSameSearchCandidate(candidate, graphCandidate))) {
      return selected;
    }

    if (
      selectedTargetGraphCandidate
      && this.scoreProductStructureGraphCandidate(selectedTargetGraphCandidate, intent)
        >= this.scoreProductStructureGraphCandidate(graphCandidate, intent) - 0.05
    ) {
      return selected;
    }

    graphCandidate.rankReason = Array.from(new Set([
      ...(graphCandidate.rankReason || []),
      'official_guide_graph_rag_candidate_coverage',
    ]));
    graphCandidate.evidenceDecisionReason = Array.from(new Set([
      ...(graphCandidate.evidenceDecisionReason || []),
      'official_guide_graph_rag_candidate_coverage',
    ]));
    graphCandidate.metadata = {
      ...(graphCandidate.metadata || {}),
      coverageRole: 'official_guide_graph_rag_candidate_coverage',
      rankReason: graphCandidate.rankReason,
      evidenceDecisionReason: graphCandidate.evidenceDecisionReason,
    };

    const next = [...selected];
    if (selectedTargetGraphCandidate) {
      const existingIndex = next.findIndex(candidate => this.isSameSearchCandidate(candidate, selectedTargetGraphCandidate));
      if (existingIndex >= 0) {
        next[existingIndex] = graphCandidate;
        return next
          .slice(0, limit)
          .sort((a, b) => this.scoreVendorSlotCandidate(b, intent) - this.scoreVendorSlotCandidate(a, intent));
      }
    }

    if (next.length < limit) {
      next.push(graphCandidate);
      return next
        .slice(0, limit)
        .sort((a, b) => this.scoreVendorSlotCandidate(b, intent) - this.scoreVendorSlotCandidate(a, intent));
    }

    const replacement = next
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => !this.isEvidenceGraphCandidate(candidate))
      .sort((a, b) => this.scoreVendorSlotCandidate(a.candidate, intent) - this.scoreVendorSlotCandidate(b.candidate, intent))[0];

    if (!replacement) {
      return selected;
    }

    next[replacement.index] = graphCandidate;
    return next
      .slice(0, limit)
      .sort((a, b) => this.scoreVendorSlotCandidate(b, intent) - this.scoreVendorSlotCandidate(a, intent));
  }

  private scoreProductStructureGraphCandidate(candidate: SearchResult, intent: QueryIntent): number {
    const sourceText = this.normalizeSearchText(this.buildCandidateEvidenceText(
      candidate.content,
      candidate.documentTitle,
      candidate.metadata
    ));
    const highValueMatch = this.hasHighValueProductStructureSignal(sourceText);
    const productStructureMatch = this.hasProductStructureSignal(sourceText);
    const specificProductAnchorTerms = this.buildSpecificProductAnchorTerms(intent);
    const specificProductIntent = intent.isSpecificProductGuidance;
    const specificProductMatch = specificProductIntent ? this.hasSpecificProductTermMatch(sourceText, intent) : false;
    const graphQueryTerms = specificProductIntent
      ? (specificProductAnchorTerms.length > 0 ? specificProductAnchorTerms : intent.keywords)
      : intent.keywords;
    const queryTermHits = graphQueryTerms
      .map(keyword => this.normalizeSearchText(keyword))
      .filter(keyword => keyword.length >= 2 && sourceText.includes(keyword))
      .length;

    let score = this.scoreVendorSlotCandidate(candidate, intent);
    if (specificProductIntent) {
      score += specificProductMatch ? 1.2 : -2.4;
      if (!specificProductMatch && this.isBroadProductStructureOnlyText(sourceText, intent)) {
        score -= 1.4;
      }
    }
    if (highValueMatch) score += specificProductIntent && !specificProductMatch ? 0.1 : 0.85;
    if (productStructureMatch) score += specificProductIntent && !specificProductMatch ? 0.05 : 0.35;
    score += Math.min(0.72, queryTermHits * 0.12);
    score += this.calculateProductStructureGraphTitleAdjustment(
      candidate.documentTitle,
      candidate.documentUrl,
      candidate.content,
      intent
    ).adjustment * 3;

    if (/캠페인\s*(목표|유형)|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|비즈보드|상품\s*db|db\s*url|상품가이드|상품\s*가이드|campaign\s*objective|objective/.test(sourceText)) {
      score += specificProductIntent && !specificProductMatch ? 0.08 : 0.55;
    }

    const queryText = this.normalizeSearchText(intent.keywords.join(' '));
    if (this.isOffAxisProductStructureGraphText(sourceText, queryText)) {
      score -= 2.2;
    } else if (/세금|청구|결제|woocommerce|google\s*태그|태그\s*설정|gtag|측정\s*태그/.test(sourceText) && !highValueMatch) {
      score -= 1.05;
    }

    return score;
  }

  private calculateProductStructureGraphTitleAdjustment(
    documentTitle: string | undefined,
    documentUrl: string | undefined,
    content: string,
    intent: QueryIntent
  ): { adjustment: number; reasons: string[] } {
    if (!intent.topics.includes('product_structure') || !intent.isProductStructureOverview) {
      return { adjustment: 0, reasons: [] };
    }

    const titleText = this.normalizeSearchText(documentTitle || '');
    const urlText = this.normalizeSearchText(documentUrl || '');
    const contentText = this.normalizeSearchText(content);
    const reasons: string[] = [];
    let adjustment = 0;
    const hasAdProductTitle = /광고\s*(관리자|상품|종류|유형|구조|목표|목적|가이드|사양)|캠페인\s*(목표|유형|목적)|campaign\s*objective|objectives?|instagram\s*광고\s*(가이드|관리자|상품|사양)|threads\s*광고\s*(가이드|관리자|상품|사양)|앱\s*(광고|캠페인|홍보)|게재\s*위치|노출\s*위치|advantage\+|어드밴티지|카탈로그|catalog|컬렉션\s*광고|리드\s*양식|lead\s*ads?|상품\s*가이드|상품가이드/.test(titleText);
    const hasOfficialGuideUrl = /\/business\/help|\/business\/ads-guide|\/business\/learn|adsmanager|support\.google|ads\.google|searchad\.naver|kakaobusiness\.gitbook/.test(urlText);
    const hasProductContentSignal = this.hasHighValueProductStructureSignal(contentText) || this.hasProductStructureSignal(contentText);
    const hasBroadNewsTitle = /뉴스|합류|혁신|spotlight|creator\s*method|cyber\s*5|성공\s*전략|트렌드|협업|크리에이터|크리에이티브\s*다각화|creative\s*diversification|demystifying[-\s]*creative[-\s]*diversification|manus|성과\s*증대|도입\s*1주년|게이밍\s*광고주/.test(titleText);
    const hasMetaBusinessNewsUrl = intent.vendors.includes('META')
      && /facebook\.com\/business\/news|\/business\/news|business\/news/.test(urlText);

    if (hasAdProductTitle) {
      adjustment += 0.12;
      reasons.push('product_structure_graph_ad_product_title');
    }

    if (hasOfficialGuideUrl && (hasAdProductTitle || hasProductContentSignal)) {
      adjustment += 0.06;
      reasons.push('product_structure_graph_official_guide_url');
    }

    if (hasBroadNewsTitle && !hasAdProductTitle) {
      adjustment -= 0.28;
      reasons.push('product_structure_graph_news_title_penalty');
    }

    if (hasMetaBusinessNewsUrl && !this.hasMetaObjectiveProductStructureSignal(contentText)) {
      adjustment -= 0.36;
      reasons.push('meta_product_structure_news_url_penalty');
    }

    return { adjustment, reasons };
  }

  private isLowValueProductStructureGraphCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    const sourceText = this.normalizeSearchText(this.buildCandidateEvidenceText(
      candidate.content,
      candidate.documentTitle,
      candidate.metadata
    ));
    const allowedOfficialGraphCreativeSpecCandidate = this.isOfficialGraphCreativeSpecCandidateForIntent(candidate, intent, sourceText);
    if (intent.isSpecificProductGuidance) {
      if (!allowedOfficialGraphCreativeSpecCandidate && !this.hasSpecificProductTermMatch(sourceText, intent)) {
        return true;
      }
      if (!allowedOfficialGraphCreativeSpecCandidate && this.isBroadProductStructureOnlyText(sourceText, intent)) {
        return true;
      }
      if (
        !allowedOfficialGraphCreativeSpecCandidate
        &&
        !this.hasSpecificProductAnswerableSignalForIntent(sourceText, intent)
        && !(this.isNaverShoppingDataIntent(intent) && this.hasStrongNaverShoppingDataSignal(sourceText))
        && !(this.isKakaoBizboardDisplayProductIntent(intent) && this.hasKakaoBizboardDisplaySignal(sourceText))
      ) {
        return true;
      }
      if (!allowedOfficialGraphCreativeSpecCandidate && this.isOffTopicSpecificProductEvidence(sourceText, intent)) {
        return true;
      }
    }
    if (!allowedOfficialGraphCreativeSpecCandidate && this.isCreativeSpecOnlyText(sourceText)) {
      return true;
    }

    const hasRelevantStructureSignal = (
      this.hasHighValueProductStructureSignal(sourceText)
      || this.hasProductStructureSignal(sourceText)
      || /캠페인\s*(목표|유형)|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|비즈보드|상품\s*db|db\s*url|상품가이드|상품\s*가이드|campaign\s*objective|objective/.test(sourceText)
    );

    const queryText = this.normalizeSearchText(intent.keywords.join(' '));
    if (
      intent.vendors.length === 1
      && intent.vendors[0] === 'META'
      && intent.isProductStructureOverview
      && !intent.isSpecificProductGuidance
      && (
        this.isMetaBroadProductNewsNoiseText(sourceText)
        || (
          this.isMetaAppInstallIntent(intent)
          && /facebook\.com\/business\/news|\/business\/news|business\/news/.test(sourceText)
        )
      )
    ) {
      return true;
    }

    if (this.isOffAxisProductStructureGraphText(sourceText, queryText)) {
      return true;
    }

    if (hasRelevantStructureSignal) return false;
    if (/데이터\s*분류|개인정보\s*보호|세금|청구|결제|지불|woocommerce|google\s*태그|태그\s*설정|gtag|측정\s*태그/.test(sourceText)
      && !/데이터|개인정보|privacy|data|태그|측정|결제|지불|청구|세금/.test(queryText)
    ) {
      return true;
    }

    return false;
  }

  private isOfficialGraphCreativeSpecCandidateForIntent(candidate: SearchResult, intent: QueryIntent, sourceText?: string): boolean {
    if (!intent.topics.includes('product_structure') || !intent.isSpecificProductGuidance) return false;
    if (!intent.vendors.includes('META')) return false;
    if (!this.isTargetOfficialGraphCandidate(candidate, intent)) return false;

    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ].join(' '));
    const asksCreativeSpec = (
      intent.topics.includes('spec')
      || /소재|스펙|사양|제작|규격|비율|사이즈|크기|카루셀|캐러셀|carousel|instagram|인스타그램|facebook|페이스북/.test(queryText)
    );
    if (!asksCreativeSpec) return false;

    const text = this.normalizeSearchText([
      sourceText || this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata),
      this.buildCandidateSearchText(candidate.content, candidate.documentTitle, candidate.metadata),
    ].join(' '));
    const hasMetaAdsGuideIdentity = /meta|메타|facebook|페이스북|instagram|인스타그램|business\/ads-guide|ads-guide|광고\s*가이드/.test(text);
    const hasCreativeSpecSignal = /asset_spec|ad_format|placement|광고\s*사양|광고\s*형식\/사양|제작\s*가이드|소재\s*제작|이미지\s*광고|동영상\s*광고|슬라이드\s*광고|carousel|카루셀|캐러셀|instagram|인스타그램|facebook|페이스북|비율|1080x|1080|1200x|파일\s*(크기|형식)|지원\s*형식|텍스트\s*제한|문구|랜딩|크기|사이즈/.test(text);
    if (!hasMetaAdsGuideIdentity || !hasCreativeSpecSignal) return false;

    if (/카루셀|캐러셀|carousel/.test(queryText) && !/카루셀|캐러셀|carousel|슬라이드\s*광고/.test(text)) return false;
    if (/instagram|인스타그램|릴스|reels|스토리/.test(queryText) && !/instagram|인스타그램|릴스|reels|스토리|피드/.test(text)) return false;
    if (/facebook|페이스북/.test(queryText) && !/facebook|페이스북|meta|메타/.test(text)) return false;

    return !this.isMetaBroadProductNewsNoiseText(text);
  }

  private isOffAxisProductStructureGraphText(sourceText: string, queryText: string): boolean {
    if (/데이터\s*분류|개인정보\s*보호/.test(sourceText) && !/데이터|분류|개인정보|privacy|data|타겟|잠재고객|세그먼트|audience|segment/.test(queryText)) {
      return true;
    }
    if (/세금|청구|결제|지불/.test(sourceText) && !/세금|청구|결제|지불|tax|billing|payment/.test(queryText)) {
      return true;
    }
    if (/woocommerce|google\s*태그|태그\s*설정|gtag|측정\s*태그/.test(sourceText) && !/태그|측정|woocommerce|gtag/.test(queryText)) {
      return true;
    }
    if (/라이브\s*관리|라이브커머스|쇼핑\s*라이브|shopping\s*live/.test(sourceText) && !/라이브|live/.test(queryText)) {
      return true;
    }
    if (/가입하기|회원\s*가입|계정\s*(생성|만들기)|비즈니스\s*계정/.test(sourceText) && !/가입|계정|account/.test(queryText)) {
      return true;
    }
    if (/오프라인\s*전환|향상된\s*전환|전환\s*(api|최적화|측정|추적|가져오기)|conversion\s*api|conversions?\s*api|enhanced\s*conversions|offline\s*conversion|capi/.test(sourceText)
      && !/전환|측정|conversion|capi|mmp|픽셀|sdk|오프라인|api/.test(queryText)
    ) {
      return true;
    }
    return false;
  }

  private isSameSearchCandidate(a: SearchResult, b: SearchResult): boolean {
    const aChunkId = a.metadata?.chunk_id || a.metadata?.chunkId;
    const bChunkId = b.metadata?.chunk_id || b.metadata?.chunkId;
    if (a.id && b.id && a.id === b.id) return true;
    if (aChunkId && bChunkId && aChunkId === bChunkId) return true;
    if (a.documentId && b.documentId && a.documentId === b.documentId && a.chunkIndex === b.chunkIndex) return true;
    return false;
  }

  private isEvidenceGraphCandidate(candidate: SearchResult): boolean {
    return (
      candidate.retrievalMethod === 'graph'
      || candidate.evidenceType === 'graph'
      || candidate.corpus === 'evidence_graph'
      || candidate.metadata?.retrievalMethod === 'graph'
      || candidate.metadata?.evidenceType === 'graph'
      || candidate.metadata?.corpus === 'evidence_graph'
    );
  }

  private isOfficialGraphCandidate(candidate: SearchResult): boolean {
    return (
      this.isEvidenceGraphCandidate(candidate)
      && (
        candidate.metadata?.source_kind === 'official_doc'
        || candidate.metadata?.sourceKind === 'official_doc'
      )
    );
  }

  private isTargetOfficialGraphCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    if (!this.isOfficialGraphCandidate(candidate)) return false;
    return (
      intent.vendors.length === 0
      || intent.vendors.some(vendor => (
        this.matchesExplicitGraphVendor(candidate, vendor)
        || this.matchesVendorSlot(candidate, vendor)
      ))
    );
  }

  private matchesExplicitGraphVendor(candidate: SearchResult, vendor: VendorIntent): boolean {
    if (!this.isEvidenceGraphCandidate(candidate)) return false;
    const metadata = candidate.metadata || {};
    const metadataVendors = [
      ...(Array.isArray(metadata.sourceVendors) ? metadata.sourceVendors : []),
      ...(Array.isArray(metadata.source_vendors) ? metadata.source_vendors : []),
    ];
    const explicitVendors = Array.from(new Set([
      candidate.sourceVendor,
      ...(candidate.sourceVendors || []),
      metadata.sourceVendor,
      metadata.source_vendor,
      ...metadataVendors,
    ].filter(Boolean)));

    return explicitVendors.includes(vendor);
  }

  private filterLowValuePolicySources(selected: SearchResult[], intent: QueryIntent): SearchResult[] {
    if (!this.hasPolicyJudgmentIntent(intent) || intent.topics.includes('spec')) {
      return selected;
    }

    return selected.filter(candidate => {
      if (!this.isLowValuePolicySource(candidate, intent)) return true;

      const candidateVendor = candidate.sourceVendor;
      if (candidateVendor && candidateVendor !== 'UNKNOWN' && intent.vendors.includes(candidateVendor)) {
        const sameVendorCount = selected.filter(item => this.matchesVendorSlot(item, candidateVendor)).length;
        return sameVendorCount <= 1;
      }

      return false;
    });
  }

  private balanceVendorSlots(
    selected: SearchResult[],
    ranked: SearchResult[],
    limit: number,
    intent: QueryIntent
  ): SearchResult[] {
    if (!intent.requiresVendorCoverage || intent.vendors.length <= 1) {
      return selected;
    }

    const next = [...selected];
    const targetPerVendor = Math.max(1, Math.floor(limit / intent.vendors.length));

    for (const vendor of intent.vendors) {
      let vendorCount = next.filter(candidate => this.matchesVendorSlot(candidate, vendor)).length;

      while (vendorCount < targetPerVendor) {
        const candidate = this.pickBestVendorSlotCandidate(ranked, next, vendor, intent);
        if (!candidate) break;

        const overrepresentedVendor = intent.vendors.find(candidateVendor => (
          candidateVendor !== vendor
          && next.filter(item => this.matchesVendorSlot(item, candidateVendor)).length > targetPerVendor
        ));

        let replacementIndex = -1;
        if (overrepresentedVendor) {
          replacementIndex = this.findWeakestVendorIndex(next, overrepresentedVendor, intent);
        }

        if (replacementIndex < 0 && next.length < limit) {
          candidate.rankReason = Array.from(new Set([
            ...(candidate.rankReason || []),
            `balanced_vendor_slot_${vendor.toLowerCase()}`,
          ]));
          next.push(candidate);
          vendorCount += 1;
          continue;
        }

        if (replacementIndex < 0) {
          replacementIndex = this.findVendorSlotReplacementIndex(next, intent);
        }

        const current = next[replacementIndex];
        if (
          current
          && this.scoreVendorSlotCandidate(candidate, intent)
          <= this.scoreVendorSlotCandidate(current, intent) - 0.12
        ) {
          break;
        }

        candidate.rankReason = Array.from(new Set([
          ...(candidate.rankReason || []),
          `balanced_vendor_slot_${vendor.toLowerCase()}`,
        ]));
        next[replacementIndex] = candidate;
        vendorCount = next.filter(item => this.matchesVendorSlot(item, vendor)).length;
      }
    }

    return next;
  }

  private findWeakestVendorIndex(selected: SearchResult[], vendor: VendorIntent, intent: QueryIntent): number {
    let weakestIndex = -1;
    let weakestScore = Number.POSITIVE_INFINITY;

    selected.forEach((candidate, index) => {
      if (!this.matchesVendorSlot(candidate, vendor)) return;
      const score = this.scoreVendorSlotCandidate(candidate, intent);
      if (score < weakestScore) {
        weakestScore = score;
        weakestIndex = index;
      }
    });

    return weakestIndex;
  }

  private matchesVendorSlot(candidate: SearchResult, vendor: VendorIntent): boolean {
    if (candidate.sourceQuality.isFallback) return false;
    if (!candidate.sourceQuality.hasExcerpt) return false;
    if (this.matchesExplicitGraphVendor(candidate, vendor)) return true;
    if (this.hasExplicitOtherVendorSignal(candidate, vendor)) return false;
    if (candidate.sourceVendor === vendor) return true;
    return Boolean(candidate.sourceVendors?.includes(vendor));
  }

  private hasExplicitOtherVendorSignal(candidate: SearchResult, targetVendor: VendorIntent): boolean {
    const primaryIdentityText = this.normalizeSearchText([
      candidate.metadata?.originalTitle,
      candidate.metadata?.canonical_title,
      candidate.metadata?.source_title,
      candidate.metadata?.source,
      candidate.metadata?.source_url,
      candidate.metadata?.document_url,
      candidate.metadata?.url,
      candidate.documentId,
    ].filter(Boolean).join(' '));
    const fallbackIdentityText = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.documentId,
    ].filter(Boolean).join(' '));
    const text = primaryIdentityText || fallbackIdentityText;
    if (!text) return false;

    const hasTarget = getCompassVendorTerms(targetVendor).some(term => text.includes(term));
    const otherVendors = (['META', 'KAKAO', 'NAVER', 'GOOGLE'] as VendorIntent[])
      .filter(vendor => vendor !== targetVendor);
    const hasOther = otherVendors.some(vendor => getCompassVendorTerms(vendor).some(term => text.includes(term)));

    return hasOther && !hasTarget;
  }

  private pickBestVendorSlotCandidate(
    ranked: SearchResult[],
    selected: SearchResult[],
    vendor: VendorIntent,
    intent: QueryIntent
  ): SearchResult | undefined {
    return ranked
      .filter(item => (
        this.matchesVendorSlot(item, vendor)
        && !selected.some(selectedItem => selectedItem.id === item.id)
      ))
      .sort((a, b) => (
        this.scoreVendorSlotCandidate(b, intent) - this.scoreVendorSlotCandidate(a, intent)
      ))[0];
  }

  private scoreVendorSlotCandidate(candidate: SearchResult, intent: QueryIntent): number {
    const baseScore = candidate.hybridScore || candidate.score || candidate.similarity || 0;
    const graphBoost = (
      candidate.retrievalMethod === 'graph'
      || candidate.evidenceType === 'graph'
      || candidate.corpus === 'evidence_graph'
      || candidate.metadata?.retrievalMethod === 'graph'
      || candidate.metadata?.evidenceType === 'graph'
      || candidate.metadata?.corpus === 'evidence_graph'
    ) ? 0.2 : 0;
    const policyJudgmentIntent = this.hasPolicyJudgmentIntent(intent);
    const policyEvidenceBoost = policyJudgmentIntent && candidate.topicExactMatch ? 0.22 : 0;
    const policyTitleBoost = policyJudgmentIntent && candidate.policyTitleMatch ? 0.16 : 0;
    const reviewPolicyTitleBoost = policyJudgmentIntent && this.isReviewPolicyCandidate(candidate) ? 0.55 : 0;
    const verifiedBoost = candidate.evidenceDecision === 'verified' ? 0.3 : 0;
    const weakPenalty = candidate.evidenceDecision === 'weak' ? 0.25 : 0;
    const termsPenalty = policyJudgmentIntent && this.isTermsOfServiceCandidate(candidate) ? 0.75 : 0;
    const creativeGuidePenalty = policyJudgmentIntent && this.isCreativeSpecCandidate(candidate) ? 1.15 : 0;
    const supportDocPenalty = policyJudgmentIntent && this.isAdministrativeSupportCandidate(candidate) ? 0.9 : 0;
    const eventPromoPenalty = policyJudgmentIntent && this.isEventPromoCandidate(candidate) ? 0.65 : 0;
    const strictContextPenalty = policyJudgmentIntent && this.isStrictContextMismatchCandidate(candidate, intent) ? 1.1 : 0;
    const unknownTitlePenalty = candidate.documentTitle === 'Unknown' ? 0.12 : 0;
    const productStructureSourceText = intent.topics.includes('product_structure')
      ? this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata)
      : '';
    const strictProductIntent = intent.topics.includes('product_structure') && intent.isSpecificProductGuidance;
    const strictProductAlignmentBoost = strictProductIntent && this.hasSpecificProductTermMatch(productStructureSourceText, intent) ? 0.48 : 0;
    const strictProductAlignmentPenalty = strictProductIntent && !this.hasSpecificProductTermMatch(productStructureSourceText, intent) ? 0.7 : 0;
    const strictCreativeSpecBoost = strictProductIntent
      ? this.scoreStrictProductCreativeSpecSignal(productStructureSourceText, intent)
      : 0;
    const productStructureGraphPenalty = (
      intent.topics.includes('product_structure')
      && this.isEvidenceGraphCandidate(candidate)
      && this.isOfficialGraphCandidate(candidate)
    )
      ? this.productStructureGraphRelevancePenalty(candidate, intent)
      : 0;

    return baseScore + graphBoost + verifiedBoost + policyEvidenceBoost + policyTitleBoost + reviewPolicyTitleBoost
      + strictProductAlignmentBoost
      + strictCreativeSpecBoost
      - weakPenalty - termsPenalty - creativeGuidePenalty - supportDocPenalty - eventPromoPenalty - strictContextPenalty - unknownTitlePenalty - productStructureGraphPenalty - strictProductAlignmentPenalty;
  }

  private scoreSearchCandidateForRanking(candidate: SearchResult, intent: QueryIntent): number {
    if (this.isNaverShoppingDataIntent(intent)) return this.scoreNaverShoppingDataCandidate(candidate, intent);
    if (intent.topics.includes('product_structure')) return this.scoreVendorSlotCandidate(candidate, intent);
    return candidate.hybridScore || candidate.score || candidate.similarity || 0;
  }

  private scoreStrictProductCreativeSpecSignal(sourceText: string, intent: QueryIntent): number {
    const text = this.normalizeSearchText(sourceText);
    const queryText = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].join(' '));
    const asksCreativeSpec = intent.topics.includes('spec')
      || /소재|스펙|사양|제작|규격|비율|사이즈|크기|카루셀|캐러셀|carousel|슬라이드/.test(queryText);
    if (!asksCreativeSpec || !this.hasSpecificProductTermMatch(text, intent)) return 0;

    let score = 0;
    if (/광고\s*사양|광고\s*형식\/사양|제작\s*가이드|디자인\s*추천|기술\s*요구\s*사항/.test(text)) score += 0.28;
    if (/1080x|1080\s*x|1080픽셀|해상도|비율|1:1|9:16|16:9/.test(text)) score += 0.34;
    if (/슬라이드\s*수|2\s*~\s*10|2~10|최대\s*10개|최대\s*(이미지|동영상|파일)|파일\s*(크기|형식)|jpg|png|mp4|mov/.test(text)) score += 0.22;
    if (/모든\s*광고는\s*facebook\s*광고\s*정책|광고\s*정책을\s*준수/.test(text)) score += 0.12;
    return Math.min(0.82, score);
  }

  private productStructureGraphRelevancePenalty(candidate: SearchResult, intent: QueryIntent): number {
    const sourceText = this.normalizeSearchText(this.buildCandidateEvidenceText(
      candidate.content,
      candidate.documentTitle,
      candidate.metadata
    ));
    const queryText = this.normalizeSearchText(intent.keywords.join(' '));
    if (intent.isSpecificProductGuidance && !this.hasSpecificProductTermMatch(sourceText, intent)) {
      return this.isBroadProductStructureOnlyText(sourceText, intent) ? 2.4 : 1.75;
    }

    if (this.isOffAxisProductStructureGraphText(sourceText, queryText)) {
      return 1.65;
    }
    if (!this.hasHighValueProductStructureSignal(sourceText) && !this.hasProductStructureSignal(sourceText)) {
      return 0.65;
    }
    return 0;
  }

  private findVendorSlotReplacementIndex(selected: SearchResult[], intent: QueryIntent): number {
    const nonRequiredVendorIndex = selected.findIndex(candidate => (
      candidate.sourceVendor
      && candidate.sourceVendor !== 'UNKNOWN'
      && !intent.vendors.includes(candidate.sourceVendor)
    ));

    if (nonRequiredVendorIndex >= 0) {
      return nonRequiredVendorIndex;
    }

    let weakestIndex = selected.length - 1;
    let weakestScore = Number.POSITIVE_INFINITY;

    selected.forEach((candidate, index) => {
      const score = candidate.hybridScore || candidate.score || candidate.similarity || 0;
      if (score < weakestScore) {
        weakestScore = score;
        weakestIndex = index;
      }
    });

    return weakestIndex;
  }

  private mergeDuplicateCandidate(existing: SearchResult, incoming: SearchResult, intent: QueryIntent): SearchResult {
    const vectorScore = Math.max(existing.vectorScore || 0, incoming.vectorScore || 0);
    const keywordScore = Math.max(existing.keywordScore || 0, incoming.keywordScore || 0);
    const sourceQualityScore = Math.max(
      existing.sourceQuality.qualityScore || 0,
      incoming.sourceQuality.qualityScore || 0
    );
    const lexicalOverlap = Math.max(existing.lexicalOverlap || 0, incoming.lexicalOverlap || 0);
    const vendorMatch = existing.vendorMatch === true || incoming.vendorMatch === true;
    const vendorMismatch = existing.vendorMismatch === true && incoming.vendorMismatch === true;
    const sourceVendor = this.chooseMergedSourceVendor(existing, incoming);
    const sourceVendors = Array.from(new Set([
      ...(existing.sourceVendors || []),
      ...(incoming.sourceVendors || []),
    ]));
    const evidenceDecision: EvidenceDecision = existing.evidenceDecision === 'verified' || incoming.evidenceDecision === 'verified'
      ? 'verified'
      : existing.evidenceDecision === 'weak' || incoming.evidenceDecision === 'weak'
        ? 'weak'
        : existing.evidenceDecision || incoming.evidenceDecision || 'weak';
    const evidenceDecisionReason = Array.from(new Set([
      ...(existing.evidenceDecisionReason || []),
      ...(incoming.evidenceDecisionReason || []),
    ]));
    const topicMatch = existing.topicMatch === true || incoming.topicMatch === true;
    const topicExactMatch = existing.topicExactMatch === true || incoming.topicExactMatch === true;
    const policyTitleMatch = existing.policyTitleMatch === true || incoming.policyTitleMatch === true;
    const existingIsGraph = existing.retrievalMethod === 'graph' || existing.evidenceType === 'graph' || existing.corpus === 'evidence_graph' || existing.metadata?.retrievalMethod === 'graph' || existing.metadata?.evidenceType === 'graph' || existing.metadata?.corpus === 'evidence_graph';
    const incomingIsGraph = incoming.retrievalMethod === 'graph' || incoming.evidenceType === 'graph' || incoming.corpus === 'evidence_graph' || incoming.metadata?.retrievalMethod === 'graph' || incoming.metadata?.evidenceType === 'graph' || incoming.metadata?.corpus === 'evidence_graph';
    const hasGraphEvidence = existingIsGraph || incomingIsGraph;
    const retrievalMethods = Array.from(new Set([
      existing.retrievalMethod,
      incoming.retrievalMethod,
      ...(Array.isArray(existing.metadata?.retrievalMethods) ? existing.metadata.retrievalMethods : []),
      ...(Array.isArray(incoming.metadata?.retrievalMethods) ? incoming.metadata.retrievalMethods : []),
    ].filter(Boolean)));
    const graphCarrier = existingIsGraph ? existing : incomingIsGraph ? incoming : undefined;
    const retrievalMethod: RetrievalMethod = hasGraphEvidence
      ? 'graph'
      : vectorScore > 0 && keywordScore > 0 ? 'hybrid' : existing.retrievalMethod;
    const evidenceType: EvidenceType = hasGraphEvidence
      ? 'graph'
      : retrievalMethod === 'hybrid' ? 'hybrid' : existing.evidenceType || incoming.evidenceType || retrievalMethod;
    const corpus: RetrievalCorpus = hasGraphEvidence ? 'evidence_graph' : existing.corpus || incoming.corpus || 'ollama_document_chunks';
    const originalMetaSeed =
      this.isOriginalMetaSeedCandidate({
        chunkId: existing.id,
        corpus,
        sourceVendor: existing.sourceVendor || 'UNKNOWN',
        metadata: existing.metadata,
      })
      || this.isOriginalMetaSeedCandidate({
        chunkId: incoming.id,
        corpus,
        sourceVendor: incoming.sourceVendor || 'UNKNOWN',
        metadata: incoming.metadata,
      });
    let hybridScore = this.calculateHybridScore({
      vectorScore,
      keywordScore,
      sourceQualityScore,
      retrievalMethod,
      corpus,
      lexicalOverlap,
      vendorMatch,
      vendorMismatch,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      genericPolicyIntent: this.isGenericPolicyIntent(intent),
      originalMetaSeed,
      hasUrl: existing.sourceQuality.hasUrl || incoming.sourceQuality.hasUrl,
    });
    const mergedSourceText = this.buildCandidateEvidenceText(
      `${existing.content || ''} ${incoming.content || ''}`,
      existing.documentTitle || incoming.documentTitle,
      {
        ...(existing.metadata || {}),
        ...(incoming.metadata || {}),
      }
    );
    const productStructureAdjustment = this.calculateProductStructureScoreAdjustment(mergedSourceText, intent);
    if (productStructureAdjustment.adjustment !== 0) {
      hybridScore = Math.max(0, Math.min(1, hybridScore + productStructureAdjustment.adjustment));
    }
    const warnings = Array.from(new Set([
      ...existing.sourceQuality.warnings,
      ...incoming.sourceQuality.warnings,
    ]));
    const rankReason = Array.from(new Set([
      ...(existing.rankReason || []),
      ...(incoming.rankReason || []),
      ...productStructureAdjustment.reasons,
      hasGraphEvidence ? 'merged_with_evidence_graph' : '',
      retrievalMethod === 'hybrid' ? 'matched_vector_and_keyword' : '',
    ].filter(Boolean)));
    const existingSourceText = this.buildCandidateEvidenceText(existing.content, existing.documentTitle, existing.metadata);
    const incomingSourceText = this.buildCandidateEvidenceText(incoming.content, incoming.documentTitle, incoming.metadata);
    const specificProductIntent = intent.topics.includes('product_structure') && intent.isSpecificProductGuidance;
    const existingSpecificMatch = specificProductIntent && this.hasSpecificProductTermMatch(existingSourceText, intent);
    const incomingSpecificMatch = specificProductIntent && this.hasSpecificProductTermMatch(incomingSourceText, intent);
    const existingDetailMatch = existingSpecificMatch && this.hasSpecificProductDetailSignal(existingSourceText);
    const incomingDetailMatch = incomingSpecificMatch && this.hasSpecificProductDetailSignal(incomingSourceText);
    const representative = (
      incomingDetailMatch && !existingDetailMatch
        ? incoming
        : incomingSpecificMatch && !existingSpecificMatch
          ? incoming
          : (incoming.hybridScore || 0) > (existing.hybridScore || 0) && !existingDetailMatch
            ? incoming
            : existing
    );

    return {
      ...representative,
      id: representative.id || existing.id || incoming.id,
      content: representative.content || existing.content || incoming.content,
      similarity: Math.max(existing.similarity, incoming.similarity),
      score: hybridScore,
      hybridScore,
      vectorScore,
      keywordScore,
      retrievalMethod,
      evidenceType,
      rankReason,
      lexicalOverlap,
      vendorMatch,
      vendorMismatch,
      topicMatch,
      topicExactMatch,
      policyTitleMatch,
      documentId: representative.documentId || graphCarrier?.documentId || existing.documentId || incoming.documentId,
      documentTitle: representative.documentTitle || graphCarrier?.documentTitle || existing.documentTitle || incoming.documentTitle,
      documentUrl: representative.documentUrl || graphCarrier?.documentUrl || existing.documentUrl || incoming.documentUrl,
      corpus,
      sourceQuality: {
        ...representative.sourceQuality,
        ...(graphCarrier?.sourceQuality || {}),
        hasUrl: existing.sourceQuality.hasUrl || incoming.sourceQuality.hasUrl,
        qualityScore: sourceQualityScore,
        warnings,
        corpus,
        lexicalOverlap,
        vendorMatch,
        vendorMismatch,
        sourceVendor,
        policyTitleMatch,
      },
      metadata: {
        ...(existing.metadata || {}),
        ...(incoming.metadata || {}),
        retrievalMethod,
        retrievalMethods,
        evidenceType,
        corpus,
        graphMerged: hasGraphEvidence,
        score: hybridScore,
        hybridScore,
        vectorScore,
        keywordScore,
        lexicalOverlap,
        vendorMatch,
        vendorMismatch,
        sourceVendor,
        sourceVendors,
        evidenceDecision,
        evidenceDecisionReason,
        topicMatch,
        topicExactMatch,
        policyTitleMatch,
        sourceQualityWarnings: warnings,
      },
    };
  }

  private isVerifiedEvidence(
    candidate: SearchResult,
    intent: QueryIntent,
    hasTargetVendorRescueCandidate: boolean,
    hasGenericTopicRescueCandidate: boolean
  ): boolean {
    if (this.isUnusableEvidenceShell(candidate)) return false;

    const hybridScore = candidate.hybridScore || 0;
    const lexicalOverlap = candidate.lexicalOverlap || 0;
    const keywordScore = candidate.keywordScore || 0;
    const vectorScore = candidate.vectorScore || 0;
    const hasVendorIntent = intent.vendors.length > 0;
    const hasTopicIntent = intent.topics.length > 0;
    const hasIntent = hasVendorIntent || hasTopicIntent;
    const genericPolicyIntent = this.isGenericPolicyIntent(intent);

    if (intent.topics.includes('product_structure')) {
      const sourceText = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
      const normalizedContent = this.normalizeSearchText(candidate.content);
      const isGraphEvidence = this.isEvidenceGraphCandidate(candidate);
      const strictSpecificProductIntent = intent.isSpecificProductGuidance;
      const strictSpecificProductMatch = strictSpecificProductIntent
        ? this.hasSpecificProductTermMatch(sourceText, intent)
        : false;
      const strictSpecificProductDetailMatch = (
        strictSpecificProductIntent
        && strictSpecificProductMatch
        && this.hasSpecificProductDetailSignalNearAnyTerm(sourceText, intent)
      );
      const strictSpecificProductGroundingMatch = (
        strictSpecificProductIntent
        && strictSpecificProductMatch
        && this.hasSpecificProductAnswerableSignalForIntent(sourceText, intent)
      );
      const allowedSpecificProductProcedureEvidence = (
        strictSpecificProductIntent
        && this.isNaverShoppingDataIntent(intent)
        && this.hasNaverShoppingDataSignal(sourceText)
      );
      const allowedKakaoProductGuideEvidence = (
        strictSpecificProductIntent
        && this.isKakaoBizboardDisplayProductIntent(intent)
        && this.hasKakaoBizboardDisplaySignal(sourceText)
      );
      const allowedNaverDisplayProductGuideEvidence = (
        strictSpecificProductIntent
        && this.isNaverDisplayAdIntent(intent)
        && this.hasNaverDisplayProductGuideSignal(sourceText)
      );
      const allowedNaverVideoProductGuideEvidence = (
        strictSpecificProductIntent
        && this.isNaverVideoProductIntent(intent)
        && this.hasNaverVideoProductGuideSignal(sourceText)
      );

      if (
        strictSpecificProductIntent
        && !strictSpecificProductMatch
        && !allowedSpecificProductProcedureEvidence
        && !allowedKakaoProductGuideEvidence
        && !allowedNaverDisplayProductGuideEvidence
        && !allowedNaverVideoProductGuideEvidence
      ) {
        return false;
      }

      if (
        strictSpecificProductIntent
        && strictSpecificProductMatch
        && !strictSpecificProductGroundingMatch
        && !allowedSpecificProductProcedureEvidence
        && !allowedKakaoProductGuideEvidence
        && !allowedNaverDisplayProductGuideEvidence
        && !isGraphEvidence
        && !this.hasSpecificProductAnswerableSignalForIntent(sourceText, intent)
      ) {
        return false;
      }

      if (
        intent.isSpecificProductGuidance
        && this.isBroadProductStructureOnlyText(sourceText, intent)
      ) {
        return false;
      }
      if (this.isOffTopicSpecificProductEvidence(sourceText, intent)) {
        return false;
      }

      const graphMatchesVendor = (
        intent.vendors.length === 0
        || intent.vendors.some(vendor => (
          this.matchesExplicitGraphVendor(candidate, vendor)
          || this.matchesVendorSlot(candidate, vendor)
        ))
      );
      const graphHasProductSignal = (
        isGraphEvidence
        && graphMatchesVendor
        && this.hasProductStructureSignal(sourceText)
      );
      const graphSpecificProductDetailSignal = (
        isGraphEvidence
        && graphMatchesVendor
        && strictSpecificProductGroundingMatch
      );
      const broadProductOverviewEvidence = (
        !strictSpecificProductIntent
        && intent.isProductStructureOverview
        && graphMatchesVendor
        && (
          this.hasProductStructureSignal(sourceText)
          || this.hasHighValueProductStructureSignal(sourceText)
        )
      );

      if (
        !broadProductOverviewEvidence
        && !graphHasProductSignal
        && !graphSpecificProductDetailSignal
        && !strictSpecificProductGroundingMatch
        && !allowedKakaoProductGuideEvidence
        && !allowedNaverDisplayProductGuideEvidence
        && !this.hasHighValueProductStructureSignal(sourceText)
      ) {
        return false;
      }
      if (
        !broadProductOverviewEvidence
        && !graphHasProductSignal
        && !graphSpecificProductDetailSignal
        && !strictSpecificProductGroundingMatch
        && !allowedKakaoProductGuideEvidence
        && !allowedNaverDisplayProductGuideEvidence
        && normalizedContent.length < 140
      ) {
        return false;
      }
    }

    if (hybridScore < 0.25) return false;
    if (
      genericPolicyIntent
      && hasGenericTopicRescueCandidate
      && this.isVectorOnlyMetaSeed(candidate)
      && !candidate.topicExactMatch
      && keywordScore === 0
      && lexicalOverlap <= 0.2
    ) {
      return false;
    }
    if (
      hasVendorIntent
      && candidate.vendorMismatch
      && !candidate.vendorMatch
    ) {
      return false;
    }
    if (
      hasTargetVendorRescueCandidate
      && this.isExplicitNonMetaIntent(intent)
      && this.isMetaOnlyOllamaMismatch(candidate, intent)
      && lexicalOverlap < 0.45
      && keywordScore < 0.5
    ) {
      return false;
    }
    if (
      candidate.vendorMismatch
      && !candidate.vendorMatch
      && hasTargetVendorRescueCandidate
    ) {
      return false;
    }
    if (
      candidate.vendorMismatch
      && !candidate.vendorMatch
      && lexicalOverlap < 0.12
      && keywordScore < 0.2
    ) {
      return false;
    }

    if (candidate.vendorMatch) return true;
    if (genericPolicyIntent && candidate.topicExactMatch && candidate.policyTitleMatch && lexicalOverlap >= 0.15) return true;
    if (keywordScore >= 0.35 && lexicalOverlap >= 0.12) return true;
    if (lexicalOverlap >= (hasIntent ? 0.2 : 0.28)) return true;
    if (vectorScore >= 0.82 && lexicalOverlap >= 0.12) return true;

    return false;
  }

  private getDedupeKeys(candidate: SearchResult): string[] {
    return [
      `chunk:${candidate.id}`,
      `doc-index:${candidate.documentId}:${candidate.chunkIndex}`,
      `content:${this.contentFingerprint(candidate.content)}`,
    ].filter(Boolean);
  }

  private detectQueryIntent(query: string): QueryIntent {
    return classifyCompassRagQuery(query);
  }

  private detectVendors(text: string): VendorIntent[] {
    const vendors: VendorIntent[] = [];
    const specs: Array<[VendorIntent, string[]]> = [
      ['META', ['메타', 'facebook', '페이스북', 'instagram', '인스타그램', '릴스', 'reels']],
      ['KAKAO', ['kakao', '카카오', '카카오톡', '톡채널', '비즈보드', '모먼트']],
      ['NAVER', [
        'naver', '네이버', '검색광고', '쇼핑검색', '파워링크', '브랜드검색',
        '사이트검색', '쇼핑블록', '네이버da', '네이버 da', 'da상품', 'da 상품',
        '보장형 da', '홈피드', '홈피드da', '스마트채널', '타임보드', '롤링보드',
        '성과형 디스플레이', '디지털 옥외광고',
      ]],
      ['GOOGLE', ['google', '구글', 'youtube', '유튜브', 'gdn', 'google ads', 'google display', '구글 디스플레이']],
    ];

    for (const [vendor, terms] of specs) {
      if (terms.some(term => text.includes(term))) {
        vendors.push(vendor);
      }
    }

    return vendors;
  }

  private choosePrimaryVendor(sourceVendors: VendorIntent[], queryVendors: VendorIntent[]): VendorIntent | 'UNKNOWN' {
    if (sourceVendors.length === 0) return 'UNKNOWN';
    const queryMatch = queryVendors.find(vendor => sourceVendors.includes(vendor));
    return queryMatch || sourceVendors[0];
  }

  private detectTopics(text: string): TopicIntent[] {
    const topics: TopicIntent[] = [];
    const specs: Array<[TopicIntent, string[]]> = [
        ['review', ['심사', '승인', '반려', '집행 기준', '준수사항', '위반', '검토', '판단']],
        ['youth', ['청소년', '유해', '성인', '연령']],
        ['false_claim', ['허위', '과장', '오인', '오인하게', '기만', '속임', '거짓', '효능', '효과', '보장', '입증', '개선', '치료']],
        ['price', ['가격', '할인', '할인율']],
        ['event', ['이벤트', '경품', '참여', '당첨']],
        ['rights', ['상표', '저작권', '초상권', '권리', '침해', '무단', '타인']],
        ['hate', ['혐오', '차별', '비하']],
        ['gambling', ['도박', '사행', '사행성', '베팅', '배팅', '카지노']],
      ['spec', ['사이즈', '크기', '파일', '형식', '스펙', '동영상', '이미지', '카루셀']],
      ['product_structure', [
        '광고 상품', '광고상품', '광고 종류', '광고종류', '광고 유형', '광고유형', '상품 구조', '광고 구조',
        '캠페인 목표', '광고 관리자 목표', 'objective', 'objectives', 'advantage+', '어드밴티지',
        '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드', '전환', 'conversion', 'conversions api',
        '노출 위치', '게재 위치', 'placements', '지면',
        '앱 캠페인', '쇼핑 광고', '검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이', '리드 양식',
        '검색광고', '쇼핑검색', '파워링크', '브랜드검색', '쇼핑블록', '디지털 옥외광고',
        '비즈보드', '카카오모먼트', '브랜드이모티콘', '상품가이드', '상품 가이드'
      ]],
    ];

    for (const [topic, terms] of specs) {
      if (terms.some(term => text.includes(term))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  private matchTerms(text: string, terms: string[]): string[] {
    return terms.filter(term => text.includes(term));
  }

  private extractKeywords(query: string): string[] {
    const stopwords = new Set([
      '무엇인가요', '무엇', '어떤', '있는', '없는', '해주세요', '알려줘', '기준은', '기준',
      '관련', '대한', '그리고', '또는', '가능한가요', '되나요', '경우', '알려', '줘',
      'the', 'and', 'for', 'with', 'what', 'how'
    ]);

    return Array.from(new Set(
      query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .map(word => word.trim())
        .filter(word => word.length >= 2 && !stopwords.has(word))
    )).slice(0, 8);
  }

  private calculateKeywordScore(
    content: string,
    title: string,
    keywords: string[],
    lexicalOverlap: number,
    topicMatch: boolean,
    topicExactMatch: boolean = false,
    policyTitleMatch: boolean = false
  ): number {
    if (keywords.length === 0) {
      return 0;
    }

    const contentLower = content.toLowerCase();
    const titleLower = (title || '').toLowerCase();
    let score = 0;

    for (const keyword of keywords) {
      if (contentLower.includes(keyword)) score += 1;
      if (titleLower.includes(keyword)) score += 0.7;
    }

    const rawScore = score / Math.max(1, keywords.length);
    const topicBoost = topicMatch ? 0.12 : 0;
    const topicExactBoost = topicExactMatch ? 0.12 : 0;
    const policyTitleBoost = policyTitleMatch ? 0.05 : 0;
    return Math.max(0, Math.min(1, (rawScore * 0.75) + (lexicalOverlap * 0.25) + topicBoost + topicExactBoost + policyTitleBoost));
  }

  private resolveVectorScore(result: any, queryEmbedding?: number[]): number {
    const rpcSimilarity = Number(result.similarity ?? result.score ?? result.match_score);
    if (Number.isFinite(rpcSimilarity) && rpcSimilarity > 0) {
      return Math.max(0, Math.min(1, rpcSimilarity));
    }

    if (!queryEmbedding || !result.embedding) {
      return 0;
    }

    const storedEmbedding = this.parseEmbedding(result.embedding);
    if (!storedEmbedding) {
      return 0;
    }

    return this.calculateCosineSimilarity(queryEmbedding, storedEmbedding);
  }

  private parseEmbedding(embedding: unknown): number[] | null {
    try {
      if (typeof embedding === 'string') {
        return JSON.parse(embedding);
      }

      if (Array.isArray(embedding)) {
        return embedding as number[];
      }
    } catch (error) {
      console.warn('Embedding parse failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    return null;
  }

  private normalizeSearchText(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildCandidateSearchText(content: string, title: string, metadata?: any): string {
    return this.normalizeSearchText([
      title,
      content,
      metadata?.title,
      metadata?.source_title,
      metadata?.canonical_title,
      metadata?.source,
      metadata?.source_vendor,
      metadata?.sourceVendor,
      metadata?.sourceKind,
      metadata?.source_kind,
      metadata?.retrievalMethod,
      metadata?.evidenceType,
      metadata?.corpus,
      metadata?.claimType,
      metadata?.graphPath,
      metadata?.productStructureAnchor,
      Array.isArray(metadata?.topic_labels) ? metadata.topic_labels.join(' ') : metadata?.topic_labels,
      Array.isArray(metadata?.graphTopics) ? metadata.graphTopics.join(' ') : metadata?.graphTopics,
      Array.isArray(metadata?.sourceVendors) ? metadata.sourceVendors.join(' ') : metadata?.sourceVendors,
      Array.isArray(metadata?.source_vendors) ? metadata.source_vendors.join(' ') : metadata?.source_vendors,
      metadata?.sample_bucket,
      metadata?.source_url,
      metadata?.document_url,
      metadata?.url,
      metadata?.document_id,
      metadata?.chunk_id,
    ].filter(Boolean).join(' '));
  }

  private buildCandidateEvidenceText(content: string, title: string, metadata?: any): string {
    return this.normalizeSearchText([
      title,
      content,
      metadata?.title,
      metadata?.source_title,
      metadata?.canonical_title,
      metadata?.documentTitle,
      metadata?.excerpt,
      metadata?.claimText,
      metadata?.claim_text,
      Array.isArray(metadata?.topic_labels) ? metadata.topic_labels.join(' ') : metadata?.topic_labels,
      Array.isArray(metadata?.graphTopics) ? metadata.graphTopics.join(' ') : metadata?.graphTopics,
    ].filter(Boolean).join(' '));
  }

  private collectCandidateEvidenceWarnings(candidate: SearchResult): string[] {
    return [
      ...(Array.isArray(candidate.sourceQuality?.warnings) ? candidate.sourceQuality.warnings : []),
      ...(Array.isArray(candidate.metadata?.sourceQualityWarnings) ? candidate.metadata.sourceQualityWarnings : []),
      ...(Array.isArray(candidate.evidenceDecisionReason) ? candidate.evidenceDecisionReason : []),
      ...(Array.isArray(candidate.metadata?.evidenceDecisionReason) ? candidate.metadata.evidenceDecisionReason : []),
    ].map(String);
  }

  private isUnusableEvidenceShell(candidate: SearchResult): boolean {
    const warnings = this.collectCandidateEvidenceWarnings(candidate);
    return (
      !candidate.content?.trim()
      || candidate.retrievalMethod === 'fallback'
      || candidate.evidenceDecision === 'rejected'
      || candidate.sourceQuality?.isFallback === true
      || candidate.sourceQuality?.hasExcerpt === false
      || warnings.some(warning => (
        warning === 'placeholder_content'
        || warning === 'fallback_evidence'
        || warning === 'missing_excerpt'
      ))
      || this.isPlaceholderContent(candidate.content)
    );
  }

  private calculateLexicalOverlap(sourceText: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    const matched = keywords.filter(keyword => sourceText.includes(this.normalizeSearchText(keyword)));
    return Math.max(0, Math.min(1, matched.length / keywords.length));
  }

  private calculateVendorAlignment(
    sourceText: string,
    vendors: VendorIntent[],
    sourceIdentity?: {
      metadata?: any;
      title?: string;
      url?: string;
      documentId?: string;
    }
  ): {
    match: boolean;
    mismatch: boolean;
    primaryVendor: VendorIntent | 'UNKNOWN';
    sourceVendors: VendorIntent[];
  } {
    const authoritativeVendor = this.getAuthoritativeSourceVendor(sourceIdentity);

    if (authoritativeVendor && authoritativeVendor !== 'UNKNOWN') {
      const match = vendors.length === 0 ? false : vendors.includes(authoritativeVendor);
      const mismatch = vendors.length > 0 && !match;
      return {
        match,
        mismatch,
        primaryVendor: authoritativeVendor,
        sourceVendors: [authoritativeVendor],
      };
    }

    const sourceVendors = this.detectVendors(sourceText);
    const primaryVendor = this.choosePrimaryVendor(sourceVendors, vendors);
    if (vendors.length === 0) {
      return { match: false, mismatch: false, primaryVendor, sourceVendors };
    }

    const match = vendors.some(vendor => sourceVendors.includes(vendor));
    const mismatch = sourceVendors.length > 0 && !match;

    return { match, mismatch, primaryVendor, sourceVendors };
  }

  private getAuthoritativeSourceVendor(sourceIdentity?: {
    metadata?: any;
    title?: string;
    url?: string;
    documentId?: string;
  }): VendorIntent | 'UNKNOWN' {
    if (!sourceIdentity) return 'UNKNOWN';

    const metadata = sourceIdentity.metadata || {};
    const explicitVendor = this.normalizeVendorToken(
      metadata.source_vendor
      || metadata.vendor
      || metadata.media
      || metadata.platform
    );

    if (explicitVendor) {
      return explicitVendor;
    }

    const identityText = this.normalizeSearchText([
      sourceIdentity.title,
      metadata.canonical_title,
      metadata.source_title,
      metadata.source,
      metadata.sample_bucket,
      metadata.source_url,
      metadata.document_url,
      metadata.url,
      sourceIdentity.url,
      sourceIdentity.documentId,
    ].filter(Boolean).join(' '));

    if (
      identityText.includes('kakaobusiness')
      || identityText.includes('카카오 광고')
      || identityText.includes('카카오비즈니스')
      || identityText.includes('kakao:')
      || identityText.startsWith('kakao')
    ) {
      return 'KAKAO';
    }

    if (
      identityText.includes('ads.naver.com')
      || identityText.includes('naver:')
      || identityText.includes('네이버 광고')
      || identityText.includes('네이버 검색광고')
      || identityText.startsWith('naver')
    ) {
      return 'NAVER';
    }

    if (
      identityText.includes('support.google.com')
      || identityText.includes('google ads')
      || identityText.includes('google:')
      || identityText.includes('youtube:')
      || identityText.startsWith('google')
    ) {
      return 'GOOGLE';
    }

    if (
      identityText.includes('meta:')
      || identityText.includes('facebook')
      || identityText.includes('instagram')
      || identityText.includes('메타 광고')
      || identityText.includes('페이스북 광고')
      || identityText.includes('인스타그램 광고')
      || identityText.startsWith('meta')
    ) {
      return 'META';
    }

    return 'UNKNOWN';
  }

  private normalizeVendorToken(value: unknown): VendorIntent | null {
    const text = this.normalizeSearchText(String(value || ''));
    if (!text) return null;
    if (text === 'meta' || text === 'facebook' || text === 'instagram') return 'META';
    if (
      text === 'kakao'
      || text === '카카오'
      || text === '카카오톡'
      || text === '카카오모먼트'
      || text === '카카오비즈니스'
      || text === '비즈보드'
    ) return 'KAKAO';
    if (text === 'naver' || text === '네이버') return 'NAVER';
    if (text === 'google' || text === 'youtube' || text === '구글' || text === '유튜브') return 'GOOGLE';
    return null;
  }

  private chooseMergedSourceVendor(existing: SearchResult, incoming: SearchResult): VendorIntent | 'UNKNOWN' {
    if (existing.vendorMatch && existing.sourceVendor && existing.sourceVendor !== 'UNKNOWN') {
      return existing.sourceVendor;
    }
    if (incoming.vendorMatch && incoming.sourceVendor && incoming.sourceVendor !== 'UNKNOWN') {
      return incoming.sourceVendor;
    }
    if (existing.sourceVendor && existing.sourceVendor !== 'UNKNOWN') return existing.sourceVendor;
    if (incoming.sourceVendor && incoming.sourceVendor !== 'UNKNOWN') return incoming.sourceVendor;
    return 'UNKNOWN';
  }

  private isExplicitNonMetaIntent(intent: QueryIntent): boolean {
    return intent.vendors.some(vendor => vendor === 'KAKAO' || vendor === 'NAVER' || vendor === 'GOOGLE');
  }

  private isMetaOnlyOllamaMismatch(candidate: SearchResult, intent: QueryIntent): boolean {
    return Boolean(
      candidate.corpus === 'ollama_document_chunks'
      && candidate.sourceVendor === 'META'
      && candidate.vendorMismatch
      && !candidate.vendorMatch
      && this.isExplicitNonMetaIntent(intent)
    );
  }

  private isGenericPolicyIntent(intent: QueryIntent): boolean {
    return (
      intent.vendors.length === 0
      && intent.topics.length > 0
      && intent.adPolicyTerms.length > 0
      && !intent.isOutOfScope
      && !intent.unavailablePolicyTarget
    );
  }

  private isGenericRightsPolicyPriorityIntent(intent: QueryIntent): boolean {
    return this.isGenericPolicyIntent(intent) && intent.topics.includes('rights');
  }

  private isGenericGamblingPolicyPriorityIntent(intent: QueryIntent): boolean {
    return this.isGenericPolicyIntent(intent) && intent.topics.includes('gambling');
  }

  private hasGenericRightsPolicyPrioritySignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasRightsTopic = /상표|상표권|서비스표권|표장|초상권|성명권|인격권|저작권|저작물|권리\s*보호|권리보호|권리\s*침해|권리침해|타인의\s*권리|타인\s*권리|무단|허가|동의|침해/.test(text);
    const hasAdPolicyContext = /광고|소재|문안|문구|심사|집행|등록\s*기준|등록기준|운영\s*정책|운영정책|광고\s*정책|정책|가이드|윤리/.test(text);
    return hasRightsTopic && hasAdPolicyContext;
  }

  private hasGenericGamblingPolicyPrioritySignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasGamblingTopic = /도박|온라인\s*도박|사행|사행성|사행\s*행위|사행행위|카지노|베팅|배팅|경마|경륜|경정|복권|포커|빙고|확률형|랜덤박스/.test(text);
    const hasAdPolicyContext = /광고|소재|심사|집행|게재|등록\s*기준|등록기준|운영\s*정책|운영정책|광고\s*정책|정책|가이드|준수사항|업종/.test(text);
    const hasRestrictionContext = /불가|제한|금지|승인|인증|청소년|유해|등록\s*불가|게재\s*제한|집행\s*불가|광고\s*집행\s*불가/.test(text);
    return hasGamblingTopic && hasAdPolicyContext && hasRestrictionContext;
  }

  private hasPolicyJudgmentIntent(intent: QueryIntent): boolean {
    if (intent.topics.some(topic => topic !== 'spec' && topic !== 'product_structure')) return true;
    return intent.keywords.some(keyword => (
      ['주의', '제한', '금지', '반려', '심사', '검수', '검토', '판단', '위반', '정책', '운영정책', '등록기준', '광고등록기준', '허용', '불가'].includes(keyword)
    ));
  }

  private calculateProductStructureScoreAdjustment(sourceText: string, intent: QueryIntent): { adjustment: number; reasons: string[] } {
    if (!intent.topics.includes('product_structure')) {
      return { adjustment: 0, reasons: [] };
    }

    const text = this.normalizeSearchText(sourceText);
    const reasons: string[] = [];
    let adjustment = 0;
    const specificProductAnchorTerms = this.buildSpecificProductAnchorTerms(intent);
    const specificProductIntent = intent.isSpecificProductGuidance;
    const specificProductHasAnchors = specificProductAnchorTerms.length > 0;
    const specificProductMatch = specificProductHasAnchors ? this.hasSpecificProductTermMatch(text, intent) : false;
    const allowBroadProductStructureBoost = !specificProductIntent || specificProductMatch;

    if (specificProductIntent) {
      if (specificProductMatch) {
        adjustment += 0.42;
        reasons.push('strict_product_term_match');
      } else {
        adjustment -= specificProductHasAnchors ? 0.65 : 0.35;
        reasons.push('strict_product_term_missing_penalty');

        if (this.isBroadProductStructureOnlyText(text, intent)) {
          adjustment -= 0.45;
          reasons.push('broad_product_structure_penalty');
        }
      }
    }

    if (this.hasHighValueProductStructureSignal(text) && allowBroadProductStructureBoost) {
      adjustment += 0.32;
      reasons.push('high_value_product_structure_match');
    }

    if (this.hasProductStructureSignal(text) && allowBroadProductStructureBoost) {
      adjustment += 0.06;
      reasons.push('product_structure_match');
    }

    if (allowBroadProductStructureBoost
      && (
        /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives/.test(text)
        || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text)
      )
    ) {
      adjustment += 0.22;
      reasons.push('campaign_objective_match');
    }

    if (allowBroadProductStructureBoost
      && /advantage\+|어드밴티지|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|app\s*(install|promotion)|sdk|mmp|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|디지털\s*옥외광고|da($|[\s/]|도|상품|광고)|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고|비즈보드|카카오모먼트|카카오비즈니스|브랜드이모티콘|상품\s*가이드|상품가이드|상품\s*db|db\s*url|ep|쇼핑파트너센터|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑|전환\s*최적화|conversion api|픽셀\s*&?\s*sdk|비즈니스폼/.test(text)
    ) {
      adjustment += 0.18;
      reasons.push('product_solution_match');
    }

    if (
      allowBroadProductStructureBoost
      && /상품\s*db|db\s*url|쇼핑파트너센터|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑|가격비교|광고\s*등록\s*기준|광고등록기준|디지털\s*옥외광고|da($|[\s/]|도|상품|광고)|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(text)
    ) {
      adjustment += 0.2;
      reasons.push('vendor_product_detail_match');
    }

    if (this.isLowValueProductStructureDirectoryText(text)) {
      adjustment -= 0.72;
      reasons.push('product_structure_directory_penalty');
    }

    if (this.isCreativeSpecOnlyText(text)) {
      adjustment -= 1.15;
      reasons.push('creative_spec_only_penalty');
    }

    if (!this.hasHighValueProductStructureSignal(text) && !specificProductMatch) {
      adjustment -= 0.75;
      reasons.push('product_structure_no_signal_penalty');
    }

    return { adjustment, reasons };
  }

  private hasProductStructureSignal(text: string): boolean {
    return /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives|advantage\+|어드밴티지|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|노출 위치|게재 위치|placements|지면|컬렉션|collection|리드|lead|앱\s*캠페인|앱\s*(인스톨|설치|홍보|이벤트)|app\s*(install|promotion)|sdk|mmp|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|상품\s*db|db\s*url|가격비교|디지털\s*옥외광고|da($|[\s/]|도|상품|광고)|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고|동영상\s*광고|동영상\s*조회|동영상\s*소재|동영상조회광고|숏폼|아웃스트림|인스트림|네이버\s*클립|비즈보드|카카오모먼트|카카오비즈니스|브랜드이모티콘|상품\s*가이드|상품가이드|전환\s*최적화|conversion api|픽셀\s*&?\s*sdk|비즈니스폼/.test(text);
  }

  private hasNaverProductStructureSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    return /사이트검색광고|웹사이트\s*방문\s*목적|쇼핑검색|쇼핑검색광고|쇼핑몰\s*상품형|상품등록|상품\s*db|db\s*url|ep|상품정보\s*수신\s*현황|등록요청|입점\s*심사|카테고리\s*자동매칭|카테고리\s*매칭|쇼핑파트너센터|쇼핑블록|쇼핑\s*지면|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑|가격비교|(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|pc\s*헤드라인\s*da|성과형\s*디스플레이|디스플레이\s*광고|홈피드\s*da|홈피드|스마트채널|타임보드|롤링보드|배너\s*광고|동영상\s*광고|동영상\s*조회|동영상\s*소재|동영상조회광고|비디오\s*광고|숏폼|아웃스트림|인스트림|네이버\s*클립/.test(text);
  }

  private hasNaverDisplayProductGuideSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasDisplayProductName = /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|pc\s*헤드라인\s*da|성과형\s*디스플레이|디스플레이\s*광고|홈피드\s*da|홈피드|스마트채널|타임보드|롤링보드|배너\s*광고/.test(text);
    const hasDisplayAnswerSignal = /상품\s*(소개|안내)|광고\s*(상품|유형|종류)|지면|노출|게재|소재|사이즈|크기|비율|구매|예약|과금|입찰|집행|등록|심사|검수|제작|브랜딩|유입|전환|조회|클릭|운영|목적/.test(text);
    return hasDisplayProductName && hasDisplayAnswerSignal;
  }

  private hasNaverVideoProductGuideSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasVideoProductName = /동영상\s*(광고|조회|소재)|동영상조회광고|비디오\s*광고|숏폼|쇼츠|아웃스트림|인스트림|네이버\s*클립|클립\s*(광고|서비스)|video\s*ads?/.test(text);
    const hasVideoAnswerSignal = /상품\s*(소개|안내)|광고\s*(상품|유형|종류)|지면|노출|게재|소재|사이즈|크기|비율|길이|용량|파일|mp4|mov|재생|시청|조회|클릭|입찰|과금|집행|등록|저장|단계|심사|검수|제작|브랜딩|유입|전환|목적/.test(text);
    return hasVideoProductName && hasVideoAnswerSignal;
  }

  private hasNaverShoppingSearchCreativeGuideSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasShoppingSearchName = /쇼핑검색|쇼핑\s*검색|쇼핑검색광고|쇼핑몰\s*상품형|쇼핑\s*광고|쇼핑블록/.test(text);
    const hasCreativeOrReviewSignal = /소재|심사|검수|제작|가이드|대표이미지|상품명|이미지|랜딩|가격|배송비|카테고리|광고등록기준|광고\s*등록\s*기준|주의|유의|제한|반려|상품\s*(정보|등록|관리)/.test(text);
    return hasShoppingSearchName && hasCreativeOrReviewSignal;
  }

  private isNaverShoppingDataIntent(intent: QueryIntent): boolean {
    if (intent.vendors[0] !== 'NAVER') return false;
    const text = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
    ].filter(Boolean).join(' '));
    const compact = text.replace(/\s+/g, '');
    return (
      /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑\s*광고/.test(text)
      && /db\s*url|상품\s*db|상품\s*등록|상품등록|ep|쇼핑파트너센터|입점\s*심사|카테고리\s*자동매칭|가격비교\s*(입점|연동|등록)|등록요청|상품관리|상품정보\s*수신\s*현황/.test(text)
    ) || /상품db|dburl|상품dburl|상품정보수신현황|쇼핑파트너센터|카테고리자동매칭/.test(compact);
  }

  private isNaverShoppingSearchCreativeIntent(intent: QueryIntent): boolean {
    if (!intent.topics.includes('product_structure') || intent.vendors[0] !== 'NAVER') return false;
    if (this.isNaverShoppingDataIntent(intent)) return false;
    const text = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ].filter(Boolean).join(' '));
    return /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑\s*광고|쇼핑블록/.test(text)
      && /소재|심사|검수|제작|가이드|대표이미지|상품명|이미지|랜딩|광고등록기준|주의|유의|제한|반려/.test(text);
  }

  private isMetaAppInstallIntent(intent: QueryIntent): boolean {
    if (!intent.topics.includes('product_structure') || intent.vendors[0] !== 'META') return false;
    const text = this.normalizeSearchText([
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ].filter(Boolean).join(' '));
    return /앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록|등록)|앱인스톨|앱설치|앱홍보|app\s*(install|promotion)|mobile\s*app|sdk|mmp|모바일\s*(앱|측정)/i.test(text);
  }

  private hasMetaAppInstallSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    return /앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록|등록)|앱인스톨|앱설치|앱홍보|app\s*(install|promotion)|mobile\s*app|sdk|mmp|모바일\s*(앱|측정)|app\s*id|app\s*secret|앱\s*id|앱\s*시크릿|포스트백|postback|skadnetwork|skan/i.test(text);
  }

  private isMetaCatalogIntent(intent: QueryIntent): boolean {
    if (!intent.topics.includes('product_structure') || intent.vendors[0] !== 'META') return false;
    if (this.isMetaAppInstallIntent(intent)) return false;
    const text = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ].filter(Boolean).join(' '));
    return /카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지/.test(text)
      && /광고|집행|운영|연동|연결|설정|상품|데이터|피드|feed|shop|shops|판매|구매|commerce|커머스/.test(text);
  }

  private hasMetaCatalogSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasCatalogIdentity = /카탈로그|catalog|컬렉션|collection|collection\s*ads?|advantage\+|어드밴티지/.test(text);
    const hasCommerceOrSetupSignal = /상품|product|데이터|data|feed|피드|연동|연결|설정|commerce|커머스|shop|shops|판매|구매|instant\s*experience|인스턴트\s*경험|광고/.test(text);
    return hasCatalogIdentity && hasCommerceOrSetupSignal;
  }

  private isGoogleLeadFormIntent(intent: QueryIntent): boolean {
    if (!intent.topics.includes('product_structure') || intent.vendors[0] !== 'GOOGLE') return false;
    const text = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
      ...intent.adPolicyTerms,
    ].filter(Boolean).join(' '));
    return /리드\s*양식|리드양식|잠재\s*고객\s*(양식|광고)|잠재고객\s*(양식|광고)|비즈니스\s*폼|비즈니스폼|lead\s*(form|generation|gen|ads?)/i.test(text);
  }

  private hasGoogleLeadFormSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    return /리드\s*양식|리드양식|잠재\s*고객\s*(양식|광고)|잠재고객\s*(양식|광고)|비즈니스\s*폼|비즈니스폼|lead\s*(form|generation|gen|ads?)|양식\s*제출|개인정보|동의|privacy|consent/i.test(text);
  }

  private isMetaCreativeSpecIntent(intent: QueryIntent): boolean {
    if (!intent.topics.includes('product_structure') || intent.vendors[0] !== 'META') return false;
    const text = this.normalizeSearchText([
      ...intent.keywords,
      ...intent.strictProductTerms,
      ...intent.strictContextTerms,
    ].filter(Boolean).join(' '));
    return intent.topics.includes('spec')
      || /소재|사양|스펙|규격|비율|사이즈|크기|해상도|파일|이미지|동영상|카루셀|캐러셀|carousel|슬라이드|instagram|인스타그램/.test(text);
  }

  private hasMetaObjectiveProductStructureSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    return /광고\s*관리자\s*목표|캠페인\s*(목표|목적|유형)|마케팅\s*목표|목표[\s\S]{0,120}(인지도|트래픽|참여|잠재\s*고객|앱\s*홍보|판매)|인지도[\s\S]{0,120}트래픽[\s\S]{0,120}참여[\s\S]{0,120}잠재\s*고객[\s\S]{0,120}앱\s*홍보[\s\S]{0,120}판매|광고\s*(상품|종류|유형|구조)|상품\s*구조|목적별|목표별|objective|objectives/i.test(text);
  }

  private hasMetaProductOverviewSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasMetaIdentity = /meta|메타|facebook|페이스북|instagram|인스타그램|릴스|reels/.test(text);
    const hasProductSignal = /캠페인\s*(목표|목적)|광고\s*관리자\s*목표|마케팅\s*목표|목표[\s\S]{0,120}(인지도|트래픽|참여|잠재\s*고객|앱\s*홍보|판매)|인지도[\s\S]{0,120}트래픽[\s\S]{0,120}참여[\s\S]{0,120}잠재\s*고객[\s\S]{0,120}앱\s*홍보[\s\S]{0,120}판매|objective|objectives|advantage\+|어드밴티지|카탈로그|catalog|meta\s*pixel|메타\s*픽셀|픽셀\s*(이벤트|코드|설치|전환)|conversions?\s*api|노출\s*위치|게재\s*위치|placements|지면|이미지\s*광고|동영상\s*광고|슬라이드\s*광고|컬렉션\s*광고|릴스|스토리|피드|lead\s*ads|잠재고객\s*광고/i.test(text);
    return hasMetaIdentity && hasProductSignal;
  }

  private isMetaBroadProductNewsNoiseText(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const hasMetaIdentity = /meta|메타|facebook|페이스북|instagram|인스타그램|릴스|reels/.test(text);
    const isMetaNewsSource = /facebook\.com\/business\/news|\/business\/news|business\/news/.test(text)
      || /도입\s*1주년|전\s*세계의\s*모든\s*사용자|성과\s*증대|게이밍\s*광고주|광고주의\s*성과|heroes\s*&?\s*dragons|사용자\s*확보\s*투자|크리에이티브\s*다각화|creative\s*diversification|demystifying[-\s]*creative[-\s]*diversification|manus|ai\s*혁신|혁신\s*가속화|cyber\s*5|사이버\s*5|creator\s*method|크리에이터|성공\s*전략|threads\s*광고|app\s*value\s*optimization/i.test(text);
    if (!hasMetaIdentity || !isMetaNewsSource) return false;

    return !this.hasMetaObjectiveProductStructureSignal(text)
      || /도입\s*1주년|전\s*세계의\s*모든\s*사용자|성과\s*증대|게이밍\s*광고주|광고주의\s*성과|heroes\s*&?\s*dragons|사용자\s*확보\s*투자|크리에이티브\s*다각화|creative\s*diversification|demystifying[-\s]*creative[-\s]*diversification|manus|ai\s*혁신|혁신\s*가속화|cyber\s*5|사이버\s*5|creator\s*method|크리에이터|성공\s*전략|threads\s*광고|app\s*value\s*optimization/i.test(text);
  }

  private isMetaOverviewPolicyNoiseText(text: string): boolean {
    return /체중\s*감량|성전환|주름|신체\s*측정|허용되지\s*않는\s*예시|정책에\s*맞지\s*않|제한된\s*상품|금지된\s*상품|광고\s*게재\s*제한/.test(text);
  }

  private hasNaverShoppingDataSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const compact = text.replace(/\s+/g, '');
    const hasShoppingContext = /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑파트너센터|가격비교|네이버\s*쇼핑/.test(text);
    const hasDataSignal = /db\s*url|상품\s*db|ep|상품정보\s*수신\s*현황|상품\s*등록|상품등록|신규상품\s*등록|등록요청|입점\s*심사|카테고리\s*자동매칭|카테고리\s*매칭|상품관리/.test(text)
      || /상품db|dburl|상품dburl|상품정보수신현황|신규상품등록|카테고리자동매칭/.test(compact);
    return hasShoppingContext && hasDataSignal;
  }

  private hasStrongNaverShoppingDataSignal(sourceText: string): boolean {
    const text = this.normalizeSearchText(sourceText);
    const compact = text.replace(/\s+/g, '');
    const hasShoppingContext = /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑파트너센터|가격비교|네이버\s*쇼핑/.test(text);
    const hasExactProcedureSignal =
      /상품정보\s*수신\s*현황|등록\s*요청|등록요청|상품관리|입점\s*심사|영업일\s*기준\s*1\s*[-~]?\s*2일|카테고리\s*자동매칭|카테고리\s*매칭/.test(text)
      || /상품정보수신현황|등록요청|상품관리|입점심사|카테고리자동매칭|카테고리매칭/.test(compact);
    const hasExactDbUrlSignal =
      /ep\s*\(=\s*db\s*url\)|상품\s*db\s*url|상품db\s*url|db\s*url/.test(text)
      || /ep\(=dburl\)|상품dburl|dburl/.test(compact);
    const hasProcedureVerb = /입력|등록|요청|수신|심사|매칭|확인|연동/.test(text);

    return hasShoppingContext && (hasExactProcedureSignal || (hasExactDbUrlSignal && hasProcedureVerb));
  }

  private scoreNaverShoppingDataCandidate(candidate: SearchResult, intent: QueryIntent): number {
    const text = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
    let score = this.scoreVendorSlotCandidate(candidate, intent);

    if (this.hasStrongNaverShoppingDataSignal(text)) score += 100;
    else if (this.hasNaverShoppingDataSignal(text)) score += 10;

    const normalized = this.normalizeSearchText(text);
    if (/상품정보\s*수신\s*현황|등록\s*요청|등록요청|상품관리/.test(normalized)) score += 35;
    if (/ep\s*\(=\s*db\s*url\)|상품\s*db\s*url|상품db\s*url|db\s*url/.test(normalized)) score += 30;
    if (/카테고리\s*자동매칭|카테고리\s*매칭|입점\s*심사|영업일\s*기준\s*1\s*[-~]?\s*2일/.test(normalized)) score += 25;
    if (/상품\s*가격|가격대|배송비|쿠폰|할인|대표이미지|색상\s*필터|혜택\s*필터/.test(normalized)) score -= 8;
    if (/쇼핑블록|주요\s*쇼핑\s*지면|사이트검색광고|디지털\s*옥외광고/.test(normalized)) score -= 12;

    return score;
  }

  private hasHighValueProductStructureSignal(text: string): boolean {
    const hasObjectiveList = /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text);
    return hasObjectiveList
      || /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives|advantage\+|어드밴티지|어드밴티지\+|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|app\s*(install|promotion)|sdk|mmp|사전\s*등록|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|상품\s*db|db\s*url|가격비교|디지털\s*옥외광고|da($|[\s/]|도|상품|광고)|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고|동영상\s*광고|동영상\s*조회|동영상\s*소재|동영상조회광고|숏폼|아웃스트림|인스트림|네이버\s*클립|비즈보드|카카오모먼트|카카오비즈니스|브랜드이모티콘|상품\s*가이드|상품가이드|전환\s*최적화|conversion api|픽셀\s*&?\s*sdk|비즈니스폼|campaign_objective|commerce_measurement/.test(text)
      || /노출 위치|게재 위치|placements|지면/.test(text) && /캠페인 목표|광고 관리자 목표|마케팅 목표/.test(text);
  }

  private isLowValueProductStructureDirectoryText(text: string): boolean {
    const hasDirectoryShell = /공지사항|성공전략|성공사례|광고운영팁|검색어 입력 창|thumbnail|sequence|badge|전체 공통/.test(text);
    const hasSpecificProductDetail = /상품\s*db|db\s*url|쇼핑파트너센터|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑|가격비교|광고\s*등록\s*기준|광고등록기준|디지털\s*옥외광고[\s\S]{0,80}불가\s*업종|쇼핑검색[\s\S]{0,80}필터/.test(text);
    return hasDirectoryShell && !hasSpecificProductDetail;
  }

  private isCreativeSpecOnlyText(text: string): boolean {
    const hasSpecSignal = /광고 사양|광고 형식\/사양|제작 가이드|소재 제작|크기|파일 크기|최대 파일|지원 형식|비율|jpg|png|mp4|mov|1200x|1080x|1280x|텍스트 제한|최대 길이|초|marketplace의|facebook marketplace|facebook 검색 결과|instagram 탐색 홈|탐색 홈의|검색 결과의/.test(text);
    const titleLooksLikeSinglePlacementSpec = /광고\s*사양|이미지\s*광고\s*사양|동영상\s*광고\s*사양|슬라이드\s*광고\s*사양|스토리\s*광고\s*사양|릴스\s*광고\s*사양|instagram\s*탐색\s*홈|facebook\s*검색\s*결과|marketplace의/.test(text);
    const hasTrueOverviewSignal = /광고\s*(상품|종류|유형|구조)|상품\s*구조|캠페인\s*(목표|유형|목적)|광고\s*관리자\s*목표|마케팅\s*목표|목적별|인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재\s*고객[\s\S]{0,80}앱\s*홍보[\s\S]{0,80}판매|검색광고[\s\S]{0,120}쇼핑검색|사이트검색광고[\s\S]{0,120}쇼핑검색광고|비즈보드[\s\S]{0,120}디스플레이|상품\s*가이드|상품가이드|상품\s*db|db\s*url/.test(text);
    if (titleLooksLikeSinglePlacementSpec && !hasTrueOverviewSignal) return true;
    return hasSpecSignal && !this.hasHighValueProductStructureSignal(text);
  }

  private inferDocumentTitleFromContent(content: string): string | undefined {
    const text = this.normalizeSearchText(content).slice(0, 500);

    if (
      /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑파트너센터/.test(text)
      && /상품\s*등록|상품등록|상품\s*db|db\s*url|ep|상품정보\s*수신\s*현황|입점\s*심사|카테고리\s*자동매칭/.test(text)
    ) {
      return '네이버 쇼핑검색광고 상품등록/DB URL 가이드';
    }

    if (text.includes('facebook 광고 가이드') && text.includes('meta 광고 관리자 목표 업데이트')) {
      return 'Facebook 광고 가이드: Meta 광고 관리자 목표 업데이트';
    }

    if (text.includes('facebook 광고 가이드')) return 'Facebook 광고 가이드';
    if (text.includes('instagram 광고 가이드')) return 'Instagram 광고 가이드';
    if (text.includes('meta 비즈니스 지원 센터')) return 'Meta 비즈니스 지원 센터';
    if (text.includes('google ads')) return 'Google Ads 가이드';
    if (text.includes('네이버 통합 광고주센터')) return '네이버 통합 광고주센터';
    if (text.includes('카카오비즈니스')) return '카카오비즈니스 가이드';

    return undefined;
  }

  private isTermsOfServiceCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return text.includes('이용약관') || text.includes('약관');
  }

  private isCreativeSpecCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.content,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return (
      text.includes('제작 가이드')
      || text.includes('광고 사양')
      || text.includes('동영상배너')
      || text.includes('배너형')
      || text.includes('소재 제작')
      || text.includes('이미지 광고')
      || text.includes('동영상 광고')
      || text.includes('카루셀 광고')
      || text.includes('최대 파일 크기')
      || text.includes('지원 형식')
      || text.includes('픽셀')
      || text.includes('비율')
      || text.includes('반응형 디스플레이')
      || text.includes('권장사항 가이드')
      || text.includes('최종 url')
      || text.includes('광고 그룹별')
      || text.includes('실적이 우수한')
    );
  }

  private isAdministrativeSupportCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.content,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return (
      text.includes('세금')
      || text.includes('vat')
      || text.includes('인보이스')
      || text.includes('invoice')
      || text.includes('결제')
      || text.includes('지불')
      || text.includes('청구')
      || text.includes('billing')
      || text.includes('payment')
      || text.includes('비즈니스 지원 센터')
    );
  }

  private isLowValuePolicySource(candidate: SearchResult, intent: QueryIntent): boolean {
    return (
      this.isCreativeSpecCandidate(candidate)
      || this.isAdministrativeSupportCandidate(candidate)
      || this.isTermsOfServiceCandidate(candidate)
      || this.isEventPromoCandidate(candidate)
      || this.isStrictProductMismatchCandidate(candidate, intent)
      || this.isStrictContextMismatchCandidate(candidate, intent)
    );
  }

  private isStrictProductMismatchCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    if (this.buildSpecificProductAnchorTerms(intent).length === 0) return false;
    const text = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
    return !this.hasSpecificProductTermMatch(text, intent);
  }

  private isStrictContextMismatchCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    if (intent.strictContextTerms.length === 0) return false;
    const text = this.buildCandidateEvidenceText(candidate.content, candidate.documentTitle, candidate.metadata);
    return !intent.strictContextTerms.some(term => text.includes(term.toLowerCase()));
  }

  private isReviewPolicyCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.content,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return (
      text.includes('광고 등록 기준')
      || text.includes('광고등록기준')
      || text.includes('등록 기준')
      || text.includes('운영정책')
      || text.includes('심사 가이드')
      || text.includes('검수 가이드')
      || text.includes('광고 검토')
      || text.includes('광고소재 검수')
    );
  }

  private isEventPromoCandidate(candidate: SearchResult): boolean {
    const text = this.normalizeSearchText([
      candidate.documentTitle,
      candidate.content,
      candidate.metadata?.source_title,
      candidate.metadata?.canonical_title,
      candidate.metadata?.title,
      candidate.metadata?.source,
    ].filter(Boolean).join(' '));

    return (
      text.includes('오늘 여기 클립')
      || text.includes('이벤트')
      || text.includes('npay')
      || text.includes('혜택 지급')
      || text.includes('프로모션')
      || text.includes('챌린저')
    );
  }

  private isOriginalMetaSeedCandidate(input: {
    chunkId: string;
    corpus: RetrievalCorpus;
    sourceVendor: VendorIntent | 'UNKNOWN';
    metadata?: any;
  }): boolean {
    const chunkId = String(input.chunkId || '');
    return Boolean(
      input.corpus === 'ollama_document_chunks'
      && input.sourceVendor === 'META'
      && !input.metadata?.rag_gate
      && !chunkId.startsWith('rag3d_')
      && !chunkId.startsWith('rag3j_')
    );
  }

  private isVectorOnlyMetaSeed(candidate: SearchResult): boolean {
    return Boolean(
      candidate.corpus === 'ollama_document_chunks'
      && candidate.sourceVendor === 'META'
      && candidate.retrievalMethod === 'vector'
      && (candidate.keywordScore || 0) === 0
      && !candidate.metadata?.rag_gate
      && !String(candidate.id || '').startsWith('rag3d_')
      && !String(candidate.id || '').startsWith('rag3j_')
    );
  }

  private isTargetVendorRescueCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    const targetVendor = intent.vendors.find(vendor => vendor === 'KAKAO' || vendor === 'NAVER' || vendor === 'GOOGLE');
    if (!targetVendor) return false;
    if (candidate.corpus !== 'document_chunks') return false;
    if (candidate.sourceVendor !== targetVendor) return false;
    if ((candidate.lexicalOverlap || 0) < 0.18) return false;
    if ((candidate.keywordScore || 0) < 0.35) return false;
    if ((candidate.hybridScore || 0) < 0.35) return false;
    if (!candidate.sourceQuality.hasExcerpt || candidate.sourceQuality.isFallback) return false;
    return this.hasVendorProductTerm(candidate, targetVendor);
  }

  private isGenericTopicRescueCandidate(candidate: SearchResult, intent: QueryIntent): boolean {
    if (!this.isGenericPolicyIntent(intent)) return false;
    if (!candidate.sourceQuality.hasExcerpt || candidate.sourceQuality.isFallback) return false;
    if (!candidate.topicExactMatch) return false;
    if (!candidate.policyTitleMatch) return false;
    if ((candidate.hybridScore || 0) < 0.35) return false;
    if ((candidate.keywordScore || 0) < 0.3 && (candidate.lexicalOverlap || 0) < 0.25) return false;

    const ragGate = String(candidate.metadata?.rag_gate || '');
    if (candidate.corpus === 'ollama_document_chunks' && (ragGate === 'RAG-3F' || ragGate === 'RAG-3K')) {
      return true;
    }
    if (this.isOfficialGraphCandidate(candidate)) {
      return (candidate.lexicalOverlap || 0) >= 0.16 || (candidate.keywordScore || 0) >= 0.28;
    }
    if (candidate.corpus === 'ollama_document_chunks') {
      return (candidate.keywordScore || 0) >= 0.28 || (candidate.lexicalOverlap || 0) >= 0.25;
    }

    return candidate.corpus === 'document_chunks' && (candidate.keywordScore || 0) >= 0.35;
  }

  private findWeakestGenericPolicyReplacementIndex(selected: SearchResult[], intent: QueryIntent): number {
    const metaSeedIndex = selected.findIndex(candidate => (
      this.isGenericPolicyIntent(intent)
      && this.isVectorOnlyMetaSeed(candidate)
      && !candidate.topicExactMatch
    ));

    if (metaSeedIndex >= 0) return metaSeedIndex;

    let weakestIndex = selected.length - 1;
    let weakestScore = Number.POSITIVE_INFINITY;
    selected.forEach((candidate, index) => {
      const score = candidate.hybridScore || 0;
      if (score < weakestScore) {
        weakestScore = score;
        weakestIndex = index;
      }
    });
    return weakestIndex;
  }

  private hasVendorProductTerm(candidate: SearchResult, vendor: VendorIntent): boolean {
    const text = this.buildCandidateSearchText(candidate.content, candidate.documentTitle, candidate.metadata);
    const terms: Record<VendorIntent, string[]> = {
      META: ['meta', '메타', 'facebook', '페이스북', 'instagram', '인스타그램', '릴스', 'reels'],
      KAKAO: ['kakao', '카카오', '카카오톡', '톡채널', '비즈보드', '모먼트'],
      NAVER: [
        'naver', '네이버', '검색광고', '쇼핑검색', '파워링크', '브랜드검색',
        '사이트검색', '쇼핑블록', '네이버da', '네이버 da', 'da상품', 'da 상품',
        '보장형 da', '홈피드', '홈피드da', '스마트채널', '타임보드', '롤링보드',
        '성과형 디스플레이', '디지털 옥외광고',
      ],
      GOOGLE: ['google', '구글', 'youtube', '유튜브', 'gdn', 'google ads', 'google display', '구글 디스플레이'],
    };
    return terms[vendor].some(term => text.includes(term));
  }

  private hasTopicMatch(sourceText: string, topics: TopicIntent[]): boolean {
    if (topics.length === 0) return false;
    const sourceTopics = this.detectTopics(sourceText);
    return topics.some(topic => sourceTopics.includes(topic));
  }

  private hasExactTopicMatch(sourceText: string, topics: TopicIntent[]): boolean {
    if (topics.length === 0) return false;
    const specs: Record<TopicIntent, string[]> = {
      review: ['심사', '승인', '반려', '집행 기준', '준수사항', '심사 가이드'],
      youth: ['청소년', '유해', '성인', '연령', '청소년 보호'],
      false_claim: ['허위', '과장', '오인', '기만', '거짓', '효능', '효과', '보장', '입증', '개선', '치료'],
      price: ['가격', '할인', '할인율', '표시', '소재'],
      event: ['이벤트', '경품', '참여', '당첨'],
      rights: ['상표', '저작권', '초상권', '권리', '침해'],
      hate: ['혐오', '차별', '비하', '증오'],
      gambling: ['도박', '사행', '사행성', '금지', '제한', '불가', '허용'],
      spec: ['사이즈', '크기', '파일', '형식', '스펙', '동영상', '이미지', '카루셀'],
      product_structure: [
        '광고 상품', '광고상품', '광고 종류', '광고종류', '상품 구조', '광고 구조',
        '캠페인 목표', '광고 관리자 목표', '마케팅 목표',
        'objective', 'objectives', 'advantage+', '어드밴티지', '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드',
        'conversions api', '노출 위치', '게재 위치', 'placements', '지면',
        '앱 캠페인', '앱 인스톨', '앱 설치', '앱 홍보', '앱 이벤트', 'app install', 'app promotion', 'sdk', 'mmp', '사전 등록',
        '쇼핑 광고', '쇼핑 캠페인', 'shopping ads', 'shopping campaigns', '검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이', '리드 양식',
        '검색광고', '사이트검색광고', '쇼핑검색', '쇼핑검색광고', '쇼핑몰 상품형', '상품등록', '상품 등록', '상품db', '상품 db', 'db url', 'ep', '쇼핑파트너센터', '쇼핑블록', 'pc 쇼핑블록', 'mo 쇼핑블록', '모바일 쇼핑', '디지털 옥외광고',
        '비즈보드', '디스플레이 광고', '카카오모먼트', '브랜드이모티콘', '상품가이드', '상품 가이드', '제작 가이드',
      ],
    };

    return topics.some(topic => specs[topic].some(term => sourceText.includes(term)));
  }

  private hasPolicyGradeTitle(title: string, metadata?: any): boolean {
    const text = this.normalizeSearchText([
      title,
      metadata?.canonical_title,
      metadata?.source_title,
      metadata?.title,
      metadata?.source,
    ].filter(Boolean).join(' '));
    return [
      '정책',
      '운영정책',
      '집행기준',
      '집행 기준',
      '심사 가이드',
      '광고등록기준',
      '광고 등록 기준',
      '가이드',
      '클린센터',
    ].some(term => text.includes(term));
  }

  private buildSourceQuality(input: {
    documentId: string;
    documentTitle: string;
    documentUrl?: string;
    content: string;
    metadata?: any;
    corpus: RetrievalCorpus;
    warnings: string[];
    lexicalOverlap: number;
    vendorMatch: boolean;
    vendorMismatch: boolean;
    sourceVendor: VendorIntent | 'UNKNOWN';
    policyTitleMatch: boolean;
  }): SourceQuality {
    const hasDocumentId = Boolean(input.documentId);
    const hasTitle = Boolean(input.documentTitle && input.documentTitle !== 'Unknown');
    const hasUrl = Boolean(input.documentUrl);
    const hasExcerpt = Boolean(input.content && input.content.trim().length > 0);
    const isFallback = input.metadata?.type === 'fallback' || input.corpus === 'fallback';
    let qualityScore = 0;
    if (hasDocumentId) qualityScore += 0.22;
    if (hasTitle) qualityScore += 0.22;
    if (hasUrl) qualityScore += 0.14;
    if (hasExcerpt) qualityScore += 0.28;
    if (!isFallback) qualityScore += 0.14;
    if (!hasUrl) qualityScore -= 0.05;
    if (!hasTitle) qualityScore -= 0.12;
    if (!hasDocumentId) qualityScore -= 0.1;
    if (input.vendorMismatch) qualityScore -= 0.18;
    if (input.vendorMatch) qualityScore += 0.08;
    if (input.lexicalOverlap >= 0.2) qualityScore += 0.06;
    if (input.policyTitleMatch) qualityScore += 0.05;
    qualityScore = Math.max(0, Math.min(1, qualityScore));

    return {
      hasDocumentId,
      hasTitle,
      hasUrl,
      hasExcerpt,
      isFallback,
      warnings: input.warnings,
      linkedToDocument: Boolean(input.metadata?.document_id || input.metadata?.source_url || input.metadata?.document_url),
      qualityScore,
      corpus: input.corpus,
      lexicalOverlap: input.lexicalOverlap,
      vendorMatch: input.vendorMatch,
      vendorMismatch: input.vendorMismatch,
      sourceVendor: input.sourceVendor,
      policyTitleMatch: input.policyTitleMatch,
    };
  }

  private decideEvidence(input: {
    content: string;
    sourceQuality: SourceQuality;
    retrievalMethod: RetrievalMethod;
    corpus: RetrievalCorpus;
    hybridScore: number;
    vectorScore: number;
    keywordScore: number;
    lexicalOverlap: number;
    vendorMatch: boolean;
    vendorMismatch: boolean;
    topicExactMatch: boolean;
    policyTitleMatch: boolean;
  }): { decision: EvidenceDecision; reasons: string[] } {
    const reasons: string[] = [];
    const sourceQualityScore = input.sourceQuality.qualityScore || 0;

    if (this.isPlaceholderContent(input.content) || input.sourceQuality.warnings.includes('placeholder_content')) {
      reasons.push('placeholder_content');
    }
    if (input.retrievalMethod === 'fallback' || input.corpus === 'fallback' || input.sourceQuality.isFallback) {
      reasons.push('fallback_evidence');
    }
    if (!input.sourceQuality.hasExcerpt) reasons.push('missing_excerpt');
    if (!input.sourceQuality.hasTitle) reasons.push('missing_title');
    if (!input.sourceQuality.hasDocumentId) reasons.push('missing_document_id');
    if (!input.sourceQuality.hasUrl) reasons.push('missing_url');
    if (input.vendorMismatch && !input.vendorMatch) reasons.push('vendor_mismatch');

    if (
      reasons.includes('placeholder_content')
      || reasons.includes('fallback_evidence')
      || reasons.includes('missing_excerpt')
      || (
        reasons.includes('vendor_mismatch')
        && input.lexicalOverlap < 0.35
        && input.keywordScore < 0.45
      )
    ) {
      return {
        decision: 'rejected',
        reasons: Array.from(new Set([...reasons, 'not_answerable'])),
      };
    }

    const hasStrongScore = input.hybridScore >= 0.5 || input.keywordScore >= 0.45 || input.vectorScore >= 0.86;
    const hasGroundingSignal =
      input.lexicalOverlap >= 0.18
      || input.vendorMatch
      || input.topicExactMatch
      || input.policyTitleMatch;
    const hasSourceShape =
      input.sourceQuality.hasDocumentId
      && input.sourceQuality.hasTitle
      && input.sourceQuality.hasExcerpt
      && sourceQualityScore >= 0.65;

    if (hasStrongScore && hasGroundingSignal && hasSourceShape) {
      return {
        decision: 'verified',
        reasons: Array.from(new Set([
          'source_quality_complete',
          input.vendorMatch ? 'vendor_topic_match' : '',
          input.topicExactMatch ? 'topic_exact_match' : '',
          input.policyTitleMatch ? 'policy_title_match' : '',
          input.retrievalMethod === 'hybrid' ? 'hybrid_retrieval' : `${input.retrievalMethod}_retrieval`,
        ].filter(Boolean))),
      };
    }

    const weakReasons = [
      ...reasons,
      !hasStrongScore ? 'score_below_verified_threshold' : '',
      !hasGroundingSignal ? 'weak_grounding_signal' : '',
      !hasSourceShape ? 'incomplete_source_shape' : '',
    ].filter(Boolean);

    return {
      decision: 'weak',
      reasons: Array.from(new Set(weakReasons.length > 0 ? weakReasons : ['needs_team_lead_review'])),
    };
  }

  private isPlaceholderContent(content: string): boolean {
    const normalized = this.normalizeSearchText(content);
    return [
      '이 url은 서버리스 환경에서 크롤링할 수 없습니다',
      '이 pdf 파일은 서버리스 환경에서 텍스트 추출이 제한됩니다',
      'docx 파일은 서버리스 환경에서 처리할 수 없습니다',
      'pdf 처리 중 오류가 발생했습니다',
      'self.__next_f',
      '__next_f',
      '_next/static',
      'static/chunks',
      'static/css',
      'crossorigin',
      'webpack',
      'hydration',
      'react-server-dom',
      'buildid',
      'window.__',
    ].some(pattern => normalized.includes(pattern));
  }

  private calculateHybridScore(input: {
    vectorScore: number;
    keywordScore: number;
    sourceQualityScore: number;
    retrievalMethod: RetrievalMethod;
    corpus: RetrievalCorpus;
    lexicalOverlap: number;
    vendorMatch: boolean;
    vendorMismatch: boolean;
    topicMatch: boolean;
    topicExactMatch: boolean;
    policyTitleMatch: boolean;
    genericPolicyIntent: boolean;
    originalMetaSeed: boolean;
    hasUrl: boolean;
  }): number {
    const baseScore =
      input.vectorScore * 0.42
      + input.keywordScore * 0.28
      + input.lexicalOverlap * 0.16
      + input.sourceQualityScore * 0.14;
    const methodBoost = input.retrievalMethod === 'hybrid' ? 0.08 : 0;
    const graphBoost = input.retrievalMethod === 'graph' || input.corpus === 'evidence_graph' ? 0.12 : 0;
    const documentChunkBoost = input.corpus === 'document_chunks'
      && input.keywordScore >= 0.35
      && input.lexicalOverlap >= 0.18
      ? 0.12
      : 0;
    const vendorBoost = input.vendorMatch ? 0.18 : 0;
    const topicBoost = input.topicMatch ? 0.08 : 0;
    const topicExactBoost = input.topicExactMatch ? 0.12 : 0;
    const policyTitleBoost = input.policyTitleMatch ? 0.08 : 0;
    const mismatchPenalty = input.vendorMismatch ? 0.28 : 0;
    const vectorOnlyPenalty = input.vectorScore > 0 && input.keywordScore === 0 && input.lexicalOverlap < 0.12 ? 0.22 : 0;
    const missingLexicalPenalty = input.lexicalOverlap === 0 ? 0.08 : 0;
    const genericMetaSeedPenalty =
      input.genericPolicyIntent
      && input.originalMetaSeed
      && input.vectorScore > 0
      && input.keywordScore === 0
      && !input.topicExactMatch
      && !input.hasUrl
      && input.lexicalOverlap <= 0.2
        ? 0.3
        : 0;
    const ragTopicRescueBoost =
      input.genericPolicyIntent
      && input.topicExactMatch
      && input.policyTitleMatch
      && input.keywordScore >= 0.3
        ? 0.1
        : 0;

    return Math.max(0, Math.min(1,
      baseScore
      + methodBoost
      + graphBoost
      + documentChunkBoost
      + vendorBoost
      + topicBoost
      + topicExactBoost
      + policyTitleBoost
      + ragTopicRescueBoost
      - mismatchPenalty
      - vectorOnlyPenalty
      - missingLexicalPenalty
      - genericMetaSeedPenalty
    ));
  }

  private buildRankReason(input: {
    vectorScore: number;
    keywordScore: number;
    sourceQuality: SourceQuality;
    corpus: RetrievalCorpus;
    lexicalOverlap: number;
    vendorMatch: boolean;
    vendorMismatch: boolean;
    topicMatch: boolean;
    topicExactMatch: boolean;
    policyTitleMatch: boolean;
    genericPolicyIntent: boolean;
    originalMetaSeed: boolean;
    hasUrl: boolean;
  }): string[] {
    const reasons: string[] = [];
    if (input.vectorScore > 0) reasons.push('vector_match');
    if (input.keywordScore > 0) reasons.push('keyword_match');
    if (input.lexicalOverlap > 0) reasons.push('lexical_overlap');
    if (input.vendorMatch) reasons.push('vendor_match');
    if (input.vendorMismatch) reasons.push('vendor_mismatch_penalty');
    if (input.topicMatch) reasons.push('topic_match');
    if (input.topicExactMatch) reasons.push('topic_exact_match');
    if (input.policyTitleMatch) reasons.push('policy_title_match');
    if (input.genericPolicyIntent && input.topicExactMatch) reasons.push('generic_policy_topic_boost');
    if (
      input.genericPolicyIntent
      && input.originalMetaSeed
      && input.vectorScore > 0
      && input.keywordScore === 0
      && !input.topicExactMatch
      && !input.hasUrl
      && input.lexicalOverlap <= 0.2
    ) {
      reasons.push('generic_vector_seed_penalty');
    }
    if (input.sourceQuality.hasTitle) reasons.push('has_title');
    if (input.sourceQuality.hasUrl) reasons.push('has_url');
    if (input.corpus === 'document_chunks') reasons.push('document_chunks_keyword_corpus');
    return reasons;
  }

  private inferDocumentId(chunkId: string): string {
    return chunkId.includes('_chunk_') ? chunkId.split('_chunk_')[0] : chunkId;
  }

  private inferChunkIndex(chunkId: string, rawChunkId?: unknown): number {
    if (typeof rawChunkId === 'number') {
      return rawChunkId;
    }

    const match = chunkId.match(/_chunk_(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  private contentFingerprint(content: string): string {
    return content
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
      .toLowerCase();
  }

  /**
   * Fallback 모드에서 사용할 샘플 검색 결과
   */
  private getFallbackSearchResults(query: string, limit: number): SearchResult[] {
    const lowerQuery = query.toLowerCase();

    // Meta 광고 정책 관련 질문에 대한 샘플 데이터
    if (lowerQuery.includes('광고') || lowerQuery.includes('정책')) {
      const fallbackResults: SearchResult[] = [
        {
          id: 'fallback-1',
          content: 'Meta 광고 정책은 광고 콘텐츠의 품질과 안전성을 보장하기 위해 설계되었습니다. 모든 광고는 정확하고 진실된 정보를 포함해야 하며, 사용자에게 유익한 콘텐츠여야 합니다.',
          similarity: 0.8,
          score: 0.8,
          retrievalMethod: 'fallback',
          documentId: 'meta-policy-2024',
          documentTitle: 'Meta 광고 정책 2024',
          documentUrl: 'https://www.facebook.com/policies/ads',
          chunkIndex: 0,
          metadata: { type: 'fallback', retrievalMethod: 'fallback' },
          sourceQuality: {
            hasDocumentId: true,
            hasTitle: true,
            hasUrl: true,
            hasExcerpt: true,
            isFallback: true,
            warnings: ['fallback_source'],
          }
        },
        {
          id: 'fallback-2',
          content: '금지된 콘텐츠에는 폭력, 성인 콘텐츠, 허위 정보, 차별적 내용 등이 포함됩니다. 이러한 콘텐츠는 광고에 사용할 수 없으며, 정책 위반 시 광고가 거부될 수 있습니다.',
          similarity: 0.7,
          score: 0.7,
          retrievalMethod: 'fallback',
          documentId: 'meta-policy-2024',
          documentTitle: 'Meta 광고 정책 2024',
          documentUrl: 'https://www.facebook.com/policies/ads',
          chunkIndex: 1,
          metadata: { type: 'fallback', retrievalMethod: 'fallback' },
          sourceQuality: {
            hasDocumentId: true,
            hasTitle: true,
            hasUrl: true,
            hasExcerpt: true,
            isFallback: true,
            warnings: ['fallback_source'],
          }
        }
      ];
      return fallbackResults.slice(0, limit);
    }

    // Facebook/Instagram 관련 질문
    if (lowerQuery.includes('facebook') || lowerQuery.includes('instagram')) {
      const fallbackResults: SearchResult[] = [
        {
          id: 'fallback-3',
          content: 'Facebook과 Instagram은 Meta의 주요 광고 플랫폼입니다. Facebook은 광범위한 타겟팅 옵션을 제공하며, Instagram은 시각적 콘텐츠 중심의 광고에 최적화되어 있습니다.',
          similarity: 0.8,
          score: 0.8,
          retrievalMethod: 'fallback',
          documentId: 'platform-guide',
          documentTitle: 'Meta 플랫폼 가이드',
          documentUrl: 'https://business.facebook.com',
          chunkIndex: 0,
          metadata: { type: 'fallback', retrievalMethod: 'fallback' },
          sourceQuality: {
            hasDocumentId: true,
            hasTitle: true,
            hasUrl: true,
            hasExcerpt: true,
            isFallback: true,
            warnings: ['fallback_source'],
          }
        }
      ];
      return fallbackResults.slice(0, limit);
    }

    // 기본 샘플 데이터
    const fallbackResults: SearchResult[] = [
      {
        id: 'fallback-default',
        content: 'Meta 광고에 대한 질문이군요. 현재 서비스가 일시적으로 제한되어 있어 기본 정보를 제공합니다. 더 자세한 정보는 Meta 비즈니스 도움말 센터를 참조하세요.',
        similarity: 0.5,
        score: 0.5,
        retrievalMethod: 'fallback',
        documentId: 'general-info',
        documentTitle: 'Meta 광고 일반 정보',
        documentUrl: 'https://www.facebook.com/business/help',
        chunkIndex: 0,
        metadata: { type: 'fallback', retrievalMethod: 'fallback' },
        sourceQuality: {
          hasDocumentId: true,
          hasTitle: true,
          hasUrl: true,
          hasExcerpt: true,
          isFallback: true,
          warnings: ['fallback_source'],
        }
      }
    ];
    return fallbackResults.slice(0, limit);
  }

  /**
   * 코사인 유사도 계산 (개선된 버전)
   */
  private calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      console.warn('벡터 차원이 다릅니다:', vecA.length, vecB.length);
      return 0;
    }

    if (vecA.length === 0 || vecB.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      const a = Number(vecA[i]) || 0;
      const b = Number(vecB[i]) || 0;

      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

    // NaN이나 Infinity 체크
    if (!isFinite(similarity)) {
      return 0;
    }

    return Math.max(0, Math.min(1, similarity)); // 0-1 범위로 제한
  }

  /**
   * 검색 결과를 바탕으로 답변 생성 (Ollama LLM 사용)
   */
  async generateAnswer(query: string, searchResults: SearchResult[]): Promise<string> {
    if (searchResults.length === 0) {
      return '죄송합니다. 질문과 관련된 정보를 찾을 수 없습니다. 다른 질문을 시도해보시거나 관리자에게 문의해주세요.';
    }

    // 검색 결과를 기반으로 한 지능적인 답변 생성
    console.log('🤖 검색 결과 기반 답변 생성 시작');

    const context = this.buildContextFromSearchResults(searchResults);
    const answer = this.generateIntelligentAnswer(query, searchResults, context);

    console.log('✅ 답변 생성 완료');
    return answer;
  }

  /**
   * 검색 결과를 컨텍스트로 구성
   */
  private buildContextFromSearchResults(searchResults: SearchResult[]): string {
    return searchResults
      .map((result, index) => `[출처 ${index + 1}] ${result.content}`)
      .join('\n\n');
  }

  /**
   * 검색 결과를 기반으로 한 지능적인 답변 생성
   */
  private generateIntelligentAnswer(query: string, searchResults: SearchResult[], context: string): string {
    const lowerQuery = query.toLowerCase();

    // Meta 광고 정책 관련 질문
    if (lowerQuery.includes('광고') && lowerQuery.includes('정책')) {
      return this.generatePolicyAnswer(query, searchResults, context);
    }

    // Facebook/Instagram 관련 질문
    if (lowerQuery.includes('facebook') || lowerQuery.includes('instagram')) {
      return this.generatePlatformAnswer(query, searchResults, context);
    }

    // 일반적인 질문
    return this.generateGeneralAnswer(query, searchResults, context);
  }

  /**
   * 광고 정책 관련 답변 생성
   */
  private generatePolicyAnswer(query: string, searchResults: SearchResult[], context: string): string {
    const relevantContent = this.extractRelevantContent(context, query);

    return `**Meta 광고 정책 안내**

${relevantContent}

**주요 광고 정책:**
- 광고는 정확하고 진실된 정보를 포함해야 합니다
- 금지된 콘텐츠(폭력, 성인 콘텐츠, 허위 정보 등)는 광고에 사용할 수 없습니다
- 개인정보 보호 및 데이터 사용에 대한 정책을 준수해야 합니다

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.documentTitle}: ${result.content.substring(0, 150)}...`).join('\n')}

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터: https://www.facebook.com/business/help
- 광고 정책 센터: https://www.facebook.com/policies/ads

이 정보가 도움이 되었나요? 더 구체적인 질문이 있으시면 언제든지 문의해주세요.`;
  }

  /**
   * 플랫폼 관련 답변 생성
   */
  private generatePlatformAnswer(query: string, searchResults: SearchResult[], context: string): string {
    const relevantContent = this.extractRelevantContent(context, query);

    return `**Facebook/Instagram 광고 안내**

${relevantContent}

**주요 플랫폼 특징:**
- Facebook: 광범위한 타겟팅 옵션과 다양한 광고 형식
- Instagram: 시각적 콘텐츠 중심의 광고와 스토리 광고
- 두 플랫폼 모두 Meta 광고 관리자에서 통합 관리 가능

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.documentTitle}: ${result.content.substring(0, 150)}...`).join('\n')}

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터에서 최신 정보를 확인하시거나, 관리자에게 문의해주세요.`;
  }

  /**
   * 일반적인 질문 답변 생성
   */
  private generateGeneralAnswer(query: string, searchResults: SearchResult[], context: string): string {
    const relevantContent = this.extractRelevantContent(context, query);

    return `**Meta 광고 FAQ 안내**

검색된 정보에 따르면:

${relevantContent}

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.documentTitle}: ${result.content.substring(0, 150)}...`).join('\n')}

**추가 정보:**
- Meta 비즈니스 도움말: https://www.facebook.com/business/help
- 광고 정책: https://www.facebook.com/policies/ads
- 광고 관리자: https://business.facebook.com

이 정보가 도움이 되었나요? 더 자세한 내용이 필요하시면 다른 질문을 해주세요.`;
  }

  /**
   * LLM 없이 기본 답변 생성 (개선된 버전)
   */
  private generateFallbackAnswer(query: string, searchResults: SearchResult[]): string {
    if (searchResults.length === 0) {
      return '죄송합니다. 질문과 관련된 정보를 찾을 수 없습니다. 다른 질문을 시도해보시거나 관리자에게 문의해주세요.';
    }

    const lowerQuery = query.toLowerCase();

    // Meta 광고 정책 관련 질문에 대한 구조화된 답변
    if (lowerQuery.includes('광고') && lowerQuery.includes('정책')) {
      return `**Meta 광고 정책 안내**

Meta 광고 정책에 대한 질문이군요. 현재 AI 답변 생성 서비스가 일시적으로 중단되어 있어, 기본 정보를 제공해드립니다.

**주요 광고 정책:**
- 광고는 정확하고 진실된 정보를 포함해야 합니다
- 금지된 콘텐츠(폭력, 성인 콘텐츠, 허위 정보 등)는 광고에 사용할 수 없습니다
- 개인정보 보호 및 데이터 사용에 대한 정책을 준수해야 합니다

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.content.substring(0, 200)}...`).join('\n')}

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터: https://www.facebook.com/business/help
- 광고 정책 센터: https://www.facebook.com/policies/ads

관리자에게 문의하시면 더 구체적인 답변을 받으실 수 있습니다.`;
    }

    // Facebook/Instagram 관련 질문
    if (lowerQuery.includes('facebook') || lowerQuery.includes('instagram')) {
      return `**Facebook/Instagram 광고 안내**

Facebook이나 Instagram 관련 질문이군요. 현재 AI 답변 생성 서비스가 일시적으로 중단되어 있어, 기본 정보를 제공해드립니다.

**주요 플랫폼 특징:**
- Facebook: 광범위한 타겟팅 옵션과 다양한 광고 형식
- Instagram: 시각적 콘텐츠 중심의 광고와 스토리 광고
- 두 플랫폼 모두 Meta 광고 관리자에서 통합 관리 가능

**검색된 관련 정보:**
${searchResults.map((result, index) => `${index + 1}. ${result.content.substring(0, 200)}...`).join('\n')}

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터에서 최신 정보를 확인하시거나, 관리자에게 문의해주세요.`;
    }

    // 기본 답변
    const topResult = searchResults[0];
    const content = this.extractRelevantContent(topResult.content, query);

    return `**Meta 광고 FAQ 안내**

검색된 정보에 따르면:

${content}

**추가 정보:**
- Meta 비즈니스 도움말: https://www.facebook.com/business/help
- 광고 정책: https://www.facebook.com/policies/ads
- 광고 관리자: https://business.facebook.com

이 정보가 도움이 되었나요? 더 자세한 내용이 필요하시면 다른 질문을 해주세요.`;
  }

  /**
   * 관련 내용 추출 및 정리
   */
  private extractRelevantContent(content: string, query: string): string {
    // 기본적인 텍스트 정리
    let cleanedContent = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim();

    // 연속된 공백 제거
    cleanedContent = cleanedContent.replace(/\s{2,}/g, ' ');

    // 문장 단위로 정리
    const sentences = cleanedContent.split(/[.!?]+/).filter(s => s.trim().length > 10);

    // 한글이 포함된 문장 우선 선택
    const koreanSentences = sentences.filter(sentence =>
      /[\u3131-\u3163\uac00-\ud7a3]/.test(sentence)
    );

    if (koreanSentences.length > 0) {
      return koreanSentences.slice(0, 3).join('. ').trim() + '.';
    }

    // 한글 문장이 없으면 영문 문장도 포함하여 반환
    const allSentences = sentences.slice(0, 3);
    if (allSentences.length > 0) {
      return allSentences.join('. ').trim() + '.';
    }

    // 문장이 없으면 원본 내용의 일부 반환
    return cleanedContent.substring(0, 500);
  }

  /**
   * 영문 내용을 한글로 번역하여 답변 생성 (간소화됨)
   */
  private translateToKorean(content: string): string {
    // 번역 기능을 임시로 비활성화하여 빌드 오류 방지
    return content;
  }

  /**
   * 완전한 RAG 기반 챗봇 응답 생성
   */
  async generateChatResponse(query: string): Promise<ChatResponse> {
    const startTime = Date.now();

    try {
      console.log(`🚀 RAG 챗봇 응답 생성 시작: "${query}"`);

      // 1. 유사한 문서 청크 검색 (임계값을 더 낮춰서 더 많은 결과 검색)
      const searchResults = await this.searchSimilarChunks(query, 5, 0.01);
      console.log(`📊 검색 결과: ${searchResults.length}개`);

      // 2. 답변 생성
      const answer = await this.generateAnswer(query, searchResults);

      // 3. 신뢰도 계산
      const confidence = this.calculateConfidence(searchResults);

      // 4. 처리 시간 계산
      const processingTime = Date.now() - startTime;

      // 5. LLM 사용 여부 확인 (Ollama 시스템에서는 항상 true)
      const isLLMGenerated = true;

      console.log(`✅ RAG 응답 생성 완료: ${processingTime}ms, 신뢰도: ${confidence}`);

      return {
        answer,
        sources: searchResults,
        confidence,
        processingTime,
        model: isLLMGenerated ? 'tinyllama:1.1b' : 'fallback',
        isLLMGenerated
      };

    } catch (error) {
      console.error('RAG response generation failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });

      // Supabase 연결 오류인 경우 특별한 메시지 제공
      if (error instanceof Error && error.message.includes('Supabase')) {
        return {
          answer: '죄송합니다. 현재 데이터베이스 연결 설정이 완료되지 않았습니다. 관리자에게 문의하시거나 잠시 후 다시 시도해주세요.\n\n임시로 Meta 광고 정책 관련 질문은 Meta 비즈니스 도움말 센터에서 확인하실 수 있습니다.',
          sources: [],
          confidence: 0,
          processingTime: Date.now() - startTime,
          model: 'error',
          isLLMGenerated: false
        };
      }

      return {
        answer: '죄송합니다. 현재 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
        sources: [],
        confidence: 0,
        processingTime: Date.now() - startTime,
        model: 'error',
        isLLMGenerated: false
      };
    }
  }

  /**
   * 검색 결과 기반 신뢰도 계산
   */
  private calculateConfidence(searchResults: SearchResult[]): number {
    if (searchResults.length === 0) return 0;

    // Hybrid score와 source quality를 함께 반영한다.
    const topScore = searchResults[0].hybridScore ?? searchResults[0].similarity;
    const averageQuality = searchResults.reduce((sum, result) => (
      sum + (result.sourceQuality.qualityScore || 0)
    ), 0) / searchResults.length;
    const confidence = (topScore * 0.75) + (averageQuality * 0.25);

    if (confidence >= 0.9) return 0.95;
    if (confidence >= 0.8) return 0.85;
    if (confidence >= 0.7) return 0.75;
    if (confidence >= 0.6) return 0.65;

    // 그 외에는 매우 낮은 신뢰도
    return 0.3;
  }

  /**
   * 검색 통계 조회
   */
  async getSearchStats(): Promise<{
    totalChunks: number;
    totalDocuments: number;
    averageSimilarity: number;
  }> {
    try {
      const { data: chunks, error: chunksError } = await this.supabase
        .from('document_chunks')
        .select('id', { count: 'exact' });

      if (chunksError) throw chunksError;

      const { data: documents, error: docsError } = await this.supabase
        .from('documents')
        .select('id', { count: 'exact' });

      if (docsError) throw docsError;

      return {
        totalChunks: chunks?.length || 0,
        totalDocuments: documents?.length || 0,
        averageSimilarity: 0.75 // 임시값
      };

    } catch (error) {
      console.error('RAG search stats lookup failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return {
        totalChunks: 0,
        totalDocuments: 0,
        averageSimilarity: 0
      };
    }
  }
}

// 지연 초기화를 위한 싱글톤 패턴
let ragSearchServiceInstance: RAGSearchService | null = null;

export function getRAGSearchService(): RAGSearchService {
  if (!ragSearchServiceInstance) {
    try {
      ragSearchServiceInstance = new RAGSearchService();
    } catch (error) {
    console.error('RAGSearchService initialization failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
      throw error;
    }
  }
  return ragSearchServiceInstance;
}

// 기존 호환성을 위한 export (deprecated)
export const ragSearchService = {
  generateChatResponse: async (message: string) => {
    const service = getRAGSearchService();
    return service.generateChatResponse(message);
  },
  getSearchStats: async () => {
    const service = getRAGSearchService();
    return service.getSearchStats();
  }
};
