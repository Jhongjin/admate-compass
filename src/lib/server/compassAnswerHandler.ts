import { NextRequest, NextResponse } from 'next/server';
import { getCompassDbSchema } from '@/lib/supabase/compass';
import { classifyCompassRagQuery, RAGSearchService, type EvidenceDecision, type QueryIntent, type VendorIntent } from '@/lib/services/RAGSearchService';
import { generateCompassAnswer } from '@/lib/services/CompassAnswerLlmService';

export type CompassAnswerPhase =
  | 'accepted'
  | 'evidence-started'
  | 'evidence-ready'
  | 'answer-started'
  | 'answer-ready';

export type CompassAnswerPhaseEmitter = (event: {
  phase: CompassAnswerPhase;
  message?: string;
  queryType?: string;
  sourceCount?: number;
  verifiedSourceCount?: number;
}) => void;

type CompassAnswerHandlerResult = {
  body: Record<string, unknown>;
  status?: number;
};

type CompassReviewPipelineStatus = 'completed' | 'limited' | 'blocked' | 'error';

function hasCompassEvidenceStore() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

interface SearchResult {
  chunk_id: string;
  content: string;
  similarity: number;
  score?: number;
  hybridScore?: number;
  vectorScore?: number;
  keywordScore?: number;
  corpus?: string;
  evidenceType?: string;
  evidenceDecision?: EvidenceDecision | string;
  evidenceDecisionReason?: string[];
  rankReason?: string[];
  lexicalOverlap?: number;
  vendorMatch?: boolean;
  vendorMismatch?: boolean;
  sourceVendor?: string;
  sourceVendors?: string[];
  topicMatch?: boolean;
  retrievalMethod?: 'vector' | 'keyword' | 'hybrid' | 'fallback';
  documentId?: string;
  documentTitle?: string;
  documentUrl?: string;
  sourceQuality?: {
    hasDocumentId: boolean;
    hasTitle: boolean;
    hasUrl: boolean;
    hasExcerpt: boolean;
    isFallback: boolean;
    warnings: string[];
    linkedToDocument?: boolean;
    qualityScore?: number;
    corpus?: string;
    lexicalOverlap?: number;
    vendorMatch?: boolean;
    vendorMismatch?: boolean;
    sourceVendor?: string;
  };
  metadata: any;
}

interface ChatResponse {
  answer: string;
  sources: any[];
  confidence: number;
  processingTime: number;
  model: string;
}

/**
 * Compass RAG 검색
 */
async function searchWithCompassRAG(
  query: string,
  limit: number = 5
): Promise<SearchResult[]> {
  try {
    console.log('Compass evidence retrieval started', { queryLength: query.length });
    
    if (!hasCompassEvidenceStore()) {
      console.warn('Compass evidence store is unavailable');
      return [];
    }

    // RAGSearchService 사용
    const ragService = new RAGSearchService();
    const searchResults = await ragService.searchSimilarChunks(query, limit);
    
    console.log('Compass evidence retrieval completed', { resultCount: searchResults.length });
    
    return searchResults.map(result => ({
      chunk_id: result.id,
      content: result.content,
      similarity: result.similarity,
      score: result.score,
      hybridScore: result.hybridScore,
      vectorScore: result.vectorScore,
      keywordScore: result.keywordScore,
      corpus: result.corpus,
      evidenceType: result.evidenceType,
      evidenceDecision: result.evidenceDecision,
      evidenceDecisionReason: result.evidenceDecisionReason,
      rankReason: result.rankReason,
      lexicalOverlap: result.lexicalOverlap,
      vendorMatch: result.vendorMatch,
      vendorMismatch: result.vendorMismatch,
      sourceVendor: result.sourceVendor,
      sourceVendors: result.sourceVendors,
      topicMatch: result.topicMatch,
      retrievalMethod: result.retrievalMethod,
      documentId: result.documentId,
      documentTitle: result.documentTitle,
      documentUrl: result.documentUrl,
      sourceQuality: result.sourceQuality,
      metadata: result.metadata
    }));
    
  } catch (error) {
    console.error('Compass evidence retrieval failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return [];
  }
}

/**
 * 신뢰도 계산
 */
function getResultVendor(result: SearchResult): string {
  return result.sourceVendor || result.metadata?.sourceVendor || result.metadata?.source_vendor || result.sourceQuality?.sourceVendor || 'UNKNOWN';
}

function getMissingVendorSlots(intent: QueryIntent, searchResults: SearchResult[]): VendorIntent[] {
  if (!intent.requiresVendorCoverage) return [];

  return intent.vendors.filter((vendor) => !searchResults.some((result) => {
    const sourceVendors = result.sourceVendors || result.metadata?.sourceVendors || [];
    return getResultVendor(result) === vendor || sourceVendors.includes(vendor);
  }));
}

function buildSourceDiagnostics(intent: QueryIntent, searchResults: SearchResult[]) {
  const vendors = Array.from(new Set(searchResults.map(getResultVendor).filter((vendor) => vendor !== 'UNKNOWN')));
  const missingVendorSlots = getMissingVendorSlots(intent, searchResults);

  return {
    queryType: intent.queryType,
    isComparative: intent.isComparative,
    requestedVendors: intent.vendors,
    coveredVendors: vendors,
    missingVendorSlots,
    sourceCount: searchResults.length,
    recommendedSourceLimit: intent.recommendedSourceLimit,
  };
}

function buildCoverageNotice(diagnostics: ReturnType<typeof buildSourceDiagnostics>) {
  if (diagnostics.missingVendorSlots.length === 0) return '';

  return `참고: 요청한 매체 중 ${diagnostics.missingVendorSlots.join(', ')} 관련 검증 출처는 현재 결과에서 충분히 확인되지 않았습니다. 아래 답변은 확인된 출처 범위 안에서만 정리합니다.`;
}

function buildCoverageLimitedAnswer(diagnostics: ReturnType<typeof buildSourceDiagnostics>) {
  const missing = diagnostics.missingVendorSlots.join(', ');
  const covered = diagnostics.coveredVendors.length > 0 ? diagnostics.coveredVendors.join(', ') : '일부 출처';

  return [
    `요청하신 비교 답변은 현재 검증 출처가 부족해 확정해서 답변할 수 없습니다.`,
    '',
    `확인된 범위: ${covered}`,
    `부족한 범위: ${missing}`,
    '',
    '매체별 기준을 섞어 추정하면 잘못된 운영 판단으로 이어질 수 있어, 현재는 확인된 출처만 아래에 남깁니다.',
    '매체명, 업종, 소재 문안 또는 확인하려는 정책 항목을 더 구체적으로 입력하면 다시 대조하겠습니다.',
  ].join('\n');
}

function buildReviewPipeline({
  status,
  sourceCount,
  verifiedSourceCount,
  contactRecommended,
}: {
  status: CompassReviewPipelineStatus;
  sourceCount: number;
  verifiedSourceCount: number;
  contactRecommended: boolean;
}) {
  const isCompleted = status === 'completed';
  const label = isCompleted ? 'AI 2단계 검토 완료' : 'AI 2단계 제한 검토';
  const summary = isCompleted
    ? '1차로 질문 조건과 후보 출처를 정리하고, 2차로 검증 출처와 답변 범위를 대조했습니다.'
    : '1차로 후보 출처를 찾고, 2차로 답변 가능 범위를 점검한 결과 추가 확인이 필요한 상태입니다.';

  return {
    label,
    summary,
    status,
    steps: [
      {
        label: '1차 AI 검토',
        description: `질문 의도와 매체 조건을 분석하고 후보 출처 ${sourceCount}개를 검색했습니다.`,
        status: sourceCount > 0 ? 'completed' : 'attention',
      },
      {
        label: '2차 정합성 검토',
        description: `실제 답변에 사용할 수 있는 검증 출처 ${verifiedSourceCount}개만 선별했습니다.`,
        status: verifiedSourceCount > 0 ? 'completed' : 'limited',
      },
      {
        label: '답변 정리',
        description: contactRecommended
          ? '검증 출처가 부족하거나 범위가 제한되어 담당자 추가 확인을 권장합니다.'
          : '확인된 출처 범위 안에서만 답변을 정리했습니다.',
        status: contactRecommended ? 'attention' : 'completed',
      },
    ],
    disclosure: 'Compass 답변은 확인된 출처 범위 안에서만 제공되며, 최종 운영 판단 전 원문 대조를 권장합니다.',
  };
}

function buildNoDataAnswer(intent: QueryIntent) {
  if (intent.strictProductTerms.length > 0 && intent.vendors.length > 0) {
    const vendorLabels = intent.vendors.map(vendor => VENDOR_LABELS[vendor] || vendor).join(', ');
    return `${vendorLabels} ${intent.strictProductTerms.join(', ')} 기준을 직접 확인할 수 있는 출처를 현재 문서에서 찾지 못했습니다. 다른 지면 기준과 섞어 단정하지 않기 위해 답변을 제한했습니다.`;
  }

  if (intent.strictContextTerms.length > 0 && intent.vendors.length > 0) {
    const vendorLabels = intent.vendors.map(vendor => VENDOR_LABELS[vendor] || vendor).join(', ');
    const contextLabel = intent.strictContextTerms.slice(0, 3).join(', ');
    return `${vendorLabels} ${contextLabel} 맥락을 직접 확인할 수 있는 출처를 현재 문서에서 찾지 못했습니다. 일반 정책 기준으로 업종별 판단을 추정하지 않기 위해 답변을 제한했습니다.`;
  }

  return '죄송합니다. 현재 제공된 문서에서 관련 정보를 찾을 수 없습니다. 더 구체적인 질문을 해주시거나 다른 키워드로 시도해보세요.';
}

function normalizeGeneratedAnswer(answer: string, sources: ReturnType<typeof buildVerifiedSources>) {
  let normalized = String(answer || '').trim();

  normalized = normalized
    .replace(/^귀하의 질문에 대한 답변은 다음과 같습니다:\s*/i, '')
    .replace(/^답변:\s*/i, '')
    .replace(/린스 광고/g, '릴스 광고');

  const leakedPromptOrEvidenceShape = [
    /\[사용자 질문\]/,
    /검증된 근거:/,
    /답변 규칙:/,
    /\n?\[S\d+\]\s+[^:\n]{2,80}(?:는|은)\s+다음과 같습니다[:：]/,
    /\bdecisionReasons?:/i,
    /\bretrievalMethod:/i,
    /\bvendor:/i,
  ].some((pattern) => pattern.test(normalized));

  if (sources.length > 0 && leakedPromptOrEvidenceShape) {
    return buildExtractiveAnswer(sources);
  }

  if (sources.length > 0) {
    normalized = normalized.replace(/현재 제공된 문서에서는 확인되지 않습니다[.\s]*/g, '');
  }

  const meaningfulText = normalized
    .replace(/\[출처:\s*S\d+(?:,\s*S\d+)*\]/g, '')
    .replace(/근거:\s*\[?S\d+\]?(?:,\s*\[?S\d+\]?)*\.?/g, '')
    .trim();

  if (sources.length > 0 && meaningfulText.length < 80) {
    return buildExtractiveAnswer(sources);
  }

  return normalized.trim() || buildExtractiveAnswer(sources);
}

function buildExtractiveAnswer(sources: ReturnType<typeof buildVerifiedSources>) {
  const lines = sources.slice(0, 5).map((source, index) => {
    const excerpt = String(source.excerpt || '')
      .replace(/\s+/g, ' ')
      .replace(/\.\.\.$/, '')
      .trim();
    const compactExcerpt = excerpt.length > 260 ? `${excerpt.slice(0, 260)}...` : excerpt;
    return `${index + 1}. ${source.title}: ${compactExcerpt} [S${index + 1}]`;
  });

  return [
    '제공된 검증 출처 기준으로 확인되는 내용은 다음과 같습니다.',
    '',
    ...lines,
    '',
    `근거: ${sources.slice(0, 5).map((_, index) => `[S${index + 1}]`).join(', ')}`,
  ].join('\n');
}

function isPolicyJudgmentAnswerIntent(intent: QueryIntent): boolean {
  if (intent.topics.some(topic => topic !== 'spec' && topic !== 'product_structure')) return true;
  return intent.keywords.some(keyword => (
    ['주의', '제한', '금지', '반려', '심사', '검수', '정책', '운영정책', '등록기준', '광고등록기준'].includes(keyword)
  ));
}

function buildPolicyGroundedAnswer(sources: ReturnType<typeof buildVerifiedSources>) {
  const extractiveAnswer = buildExtractiveAnswer(sources)
    .replace(/^제공된 검증 출처 기준으로 확인되는 내용은 다음과 같습니다\.\n\n/, '');
  return [
    '제공된 검증 출처 기준으로만 정리합니다. 정책 판단은 아래 출처에 직접 확인되는 범위로 제한해 보셔야 합니다.',
    '',
    extractiveAnswer,
    '',
    '실무 판단: 출처에 명시되지 않은 업종, 소재 문안, 랜딩 페이지 조건은 추가 확인 대상으로 남겨두는 것이 안전합니다.',
  ].join('\n');
}

function getProductStructureSourceKey(source: ReturnType<typeof buildVerifiedSources>[number]) {
  return `${source.documentId || ''}:${source.chunkId || source.id || ''}:${source.title || ''}:${source.excerpt?.slice(0, 80) || ''}`;
}

function isWeakProductStructureDisplaySource(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const title = `${source.title || ''} ${source.originalTitle || ''}`.toLowerCase();
  const text = getSourceText(source);
  const hasCoreSignal = /광고 관리자 목표|캠페인 목표|마케팅 목표|인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매|advantage\+ catalog|어드밴티지\+ catalog|컬렉션 광고|앱\s*캠페인|쇼핑\s*광고|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|쇼핑블록|비즈보드|상품\s*가이드|상품가이드|상품\s*db|db\s*url|ep|쇼핑파트너센터|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑|가격비교|디지털\s*옥외광고/.test(text);

  if (/세금|tax|vat|청구|결제/.test(text)) return true;
  if (/woocommerce|google\s*태그|태그\s*설정|gtag|측정\s*태그/.test(text)
    && !/앱\s*캠페인|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식/.test(text)
  ) return true;
  if (/공지사항|성공전략|성공사례|광고운영팁|검색어 입력 창|thumbnail|sequence|badge|전체 공통/.test(text)
    && !/상품\s*db|db\s*url|쇼핑파트너센터|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑|가격비교|광고\s*등록\s*기준|광고등록기준|디지털\s*옥외광고[\s\S]{0,80}불가\s*업종|쇼핑검색[\s\S]{0,80}필터/.test(text)
  ) return true;
  if (/^블로그$|blog|news|뉴스|도움말$/.test(title) && !hasCoreSignal) return true;
  if (/self\.__next_f|static\/css|webpack|hydration/.test(text) && !hasCoreSignal) return true;

  return false;
}

type ProductStructureBullet = {
  text: string;
  terms: string[];
};

type ProductStructureSection = {
  title: string;
  bullets: ProductStructureBullet[];
};

type ProductStructureProfile = {
  intro: string;
  sections: ProductStructureSection[];
  summary: string;
};

const PRODUCT_STRUCTURE_PROFILES: Record<VendorIntent, ProductStructureProfile> = {
  META: {
    intro: 'Meta 광고는 상품명 하나를 고르는 방식이라기보다, 캠페인 목표와 광고 형식, 운영 기능을 조합해 설계하는 방식에 가깝습니다.',
    sections: [
      {
        title: '**1. 캠페인 목표부터 정하기**',
        bullets: [
          { text: '인지도: 브랜드나 상품을 넓게 알리고 싶을 때', terms: ['인지도', '캠페인 목표', '광고 관리자 목표'] },
          { text: '트래픽: 웹사이트, 앱, 프로필 방문을 늘리고 싶을 때', terms: ['트래픽', '캠페인 목표', '광고 관리자 목표'] },
          { text: '참여: 좋아요, 댓글, 메시지, 영상 조회 같은 반응을 늘리고 싶을 때', terms: ['참여', '캠페인 목표', '광고 관리자 목표'] },
          { text: '잠재 고객: 상담 신청, 견적 요청, 리드 수집이 필요할 때', terms: ['잠재 고객', '리드', 'lead'] },
          { text: '앱 홍보: 앱 설치나 앱 내 행동을 늘리고 싶을 때', terms: ['앱 홍보', '앱 설치'] },
          { text: '판매: 구매, 장바구니, 전환을 만들고 싶을 때', terms: ['판매', '전환', '장바구니'] },
        ],
      },
      {
        title: '**2. 목표에 맞는 광고 형식과 노출 위치 확인하기**',
        bullets: [
          { text: '이미지: 한 장의 이미지로 핵심 메시지를 빠르게 전달할 때', terms: ['이미지', '단일 이미지'] },
          { text: '동영상: 사용 장면, 제품 설명, 브랜드 스토리를 보여줄 때', terms: ['동영상', 'video'] },
          { text: '슬라이드(캐러셀): 여러 이미지나 영상을 순서대로 보여줄 때', terms: ['슬라이드', '카루셀', 'carousel'] },
          { text: '컬렉션: 여러 상품을 한 번에 보여주고 구매 흐름으로 연결할 때', terms: ['컬렉션', 'collection'] },
          { text: '노출 위치는 Facebook, Instagram 등 지면별 사양을 함께 확인해야 합니다.', terms: ['노출 위치', '게재 위치', 'facebook', 'instagram'] },
        ],
      },
      {
        title: '**3. 판매·카탈로그 운영 기능 확인하기**',
        bullets: [
          { text: '컬렉션 광고: 커버 이미지나 영상 아래 여러 상품을 보여주고 구매 흐름으로 연결할 때', terms: ['컬렉션 광고', 'collection ads'] },
          { text: 'Advantage+ 카탈로그 컬렉션 광고: 카탈로그 기반 상품 노출을 자동화해 운영할 때', terms: ['advantage+', '어드밴티지', '카탈로그', 'catalog'] },
        ],
      },
      {
        title: '**4. 상황별 빠른 선택 기준**',
        bullets: [
          { text: '브랜드를 알리고 싶다면: 인지도', terms: ['인지도', '캠페인 목표'] },
          { text: '방문을 늘리고 싶다면: 트래픽', terms: ['트래픽', '캠페인 목표'] },
          { text: '반응이나 메시지를 늘리고 싶다면: 참여', terms: ['참여', '메시지'] },
          { text: '문의나 상담 신청을 받고 싶다면: 잠재 고객', terms: ['잠재 고객', 'lead'] },
          { text: '앱 설치나 앱 내 행동을 늘리고 싶다면: 앱 홍보', terms: ['앱 홍보', '앱 설치'] },
          { text: '구매나 전환을 만들고 싶다면: 판매', terms: ['판매', '전환'] },
        ],
      },
    ],
    summary: '정리하면, 먼저 브랜드 인지도, 방문 유도, 참여 확대, 잠재 고객 확보, 앱 홍보, 판매 전환 중 우선 목표를 정하고 그 목표에 맞는 형식과 운영 기능을 선택하면 됩니다. 실제 사용 가능 항목은 계정 설정이나 Meta 정책에 따라 달라질 수 있습니다.',
  },
  GOOGLE: {
    intro: 'Google Ads는 상품명 하나를 고르는 방식이라기보다, 캠페인 유형과 광고 애셋, 확장 소재, 측정 기능을 조합해 운영하는 구조로 보는 편이 안전합니다.',
    sections: [
      {
        title: '**1. 목적에 맞는 캠페인 유형부터 확인하기**',
        bullets: [
          { text: '앱 캠페인: 앱 설치, 앱 내 행동, 사전 등록처럼 앱 성과를 만들 때 검토합니다.', terms: ['앱 캠페인', '사전 등록', '앱 설치'] },
          { text: '쇼핑 광고: 상품 홍보와 쇼핑 지면 노출을 다룰 때 확인합니다.', terms: ['쇼핑 광고', 'shopping ads'] },
          { text: '검색/디스플레이 캠페인: 검색 결과, 디스플레이 지면, 반응형 디스플레이 광고처럼 노출 방식이 다른 캠페인을 나누어 봅니다.', terms: ['검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이'] },
          { text: '리드 양식 확장 소재: 상담 신청이나 연락처 수집처럼 잠재 고객 정보를 받을 때 검토합니다.', terms: ['리드 양식', '잠재고객', 'lead'] },
        ],
      },
      {
        title: '**2. 소재와 운영 조건 확인하기**',
        bullets: [
          { text: '이미지, 동영상, 광고 제목, 설명 등 애셋 구성과 품질 기준을 함께 확인해야 합니다.', terms: ['이미지', '동영상', '광고 제목', '설명', '애셋'] },
          { text: '광고 그룹별로 여러 광고를 시험하고 실적이 우수한 광고를 더 자주 게재하는 운영 방식도 고려합니다.', terms: ['광고 그룹', '실적이 우수한', '3~4개'] },
          { text: '정책 제한, 도착 페이지, 검토 상태에 따라 게재 가능 여부가 달라질 수 있습니다.', terms: ['정책', '도착 페이지', '검토 상태', '비승인'] },
        ],
      },
      {
        title: '**3. 상황별 빠른 선택 기준**',
        bullets: [
          { text: '앱 설치나 사전 등록을 늘리고 싶다면: 앱 캠페인', terms: ['앱 캠페인', '사전 등록'] },
          { text: '상품 노출이나 쇼핑몰 판매를 다룬다면: 쇼핑 광고', terms: ['쇼핑 광고'] },
          { text: '검색 유입에 시각 요소를 더하고 싶다면: 검색 캠페인과 이미지 확장 소재', terms: ['검색 캠페인', '이미지 확장'] },
          { text: '상담 신청이나 연락처 수집이 필요하다면: 리드 양식 확장 소재', terms: ['리드 양식'] },
        ],
      },
    ],
    summary: '정리하면, 먼저 달성하려는 목적을 정하고, 확인된 캠페인 유형과 애셋 조건을 원문 기준으로 대조하는 흐름이 안전합니다.',
  },
  NAVER: {
    intro: '네이버 광고는 검색 유입, 쇼핑 상품 노출, 주요 쇼핑 지면, 업종별 노출 가능 여부를 나누어 확인하는 편이 안전합니다.',
    sections: [
      {
        title: '**1. 광고 목적과 노출 지면부터 확인하기**',
        bullets: [
          { text: '사이트검색광고: 키워드 검색 기반으로 웹사이트 방문을 늘릴 때 확인합니다.', terms: ['사이트검색광고', '웹사이트 방문 목적', '키워드 검색', '웹사이트로 고객'] },
          { text: '쇼핑검색광고: 쇼핑몰 상품형처럼 상품 노출과 유입을 함께 다룰 때 확인합니다.', terms: ['쇼핑검색', '쇼핑검색광고', '쇼핑몰 상품형', '상품등록', '상품DB', '상품 DB', 'DB URL', 'EP', '쇼핑파트너센터'] },
          { text: '쇼핑블록/쇼핑 지면: 네이버 PC·모바일 쇼핑 지면에서 쇼핑몰 유입이나 브랜딩 목적을 검토할 때 확인합니다.', terms: ['쇼핑블록', '쇼핑 지면', 'PC 쇼핑블록', '모바일 쇼핑'] },
          { text: '디지털 옥외광고: 네이버 플레이스 노출 업종과 등록 불가 업종을 함께 확인해야 합니다.', terms: ['디지털 옥외광고', '네이버 플레이스'] },
        ],
      },
      {
        title: '**2. 운영 전에 확인할 조건**',
        bullets: [
          { text: '업종 제한과 광고 등록 기준에 따라 노출 가능 여부가 달라질 수 있습니다.', terms: ['불가 업종', '광고 등록', '등록기준', '광고등록기준'] },
          { text: '상품 정보는 DB URL, 카테고리 매칭, 가격비교 업데이트 같은 등록 절차와 함께 관리해야 합니다.', terms: ['DB URL', '카테고리', '가격비교', '상품등록'] },
          { text: '일부 지면에서는 선 검수나 소재 승인 조건이 붙을 수 있습니다.', terms: ['선 검수', '검수 승인', '소재'] },
        ],
      },
      {
        title: '**3. 상황별 빠른 선택 기준**',
        bullets: [
          { text: '웹사이트 방문을 늘리고 싶다면: 사이트검색광고', terms: ['사이트검색광고', '웹사이트 방문 목적', '키워드 검색', '웹사이트로 고객'] },
          { text: '쇼핑몰 상품형 유입을 강화하려면: 쇼핑검색광고', terms: ['쇼핑검색', '쇼핑검색광고', '쇼핑몰 상품형', '상품DB', '상품 DB', 'DB URL', 'EP', '쇼핑파트너센터'] },
          { text: '쇼핑몰 유입과 브랜딩을 함께 노리려면: 쇼핑블록/주요 쇼핑 지면', terms: ['쇼핑블록', '쇼핑 지면'] },
        ],
      },
    ],
    summary: '정리하면, 먼저 우선 목적을 정하고, 확인된 검색·쇼핑 노출 조건과 등록 기준을 함께 확인하는 흐름이 안전합니다.',
  },
  KAKAO: {
    intro: '카카오 광고는 카카오 서비스 지면, 소재 형식, 업종 제한, 심사 기준을 함께 확인하면서 상품과 집행 가능 범위를 정리하는 방식이 안전합니다.',
    sections: [
      {
        title: '**1. 상품·지면·심사 기준부터 확인하기**',
        bullets: [
          { text: '비즈보드/디스플레이 광고: 카카오 주요 지면과 소재 형태를 함께 검토할 때 확인합니다.', terms: ['비즈보드', '디스플레이 광고'] },
          { text: '상품가이드: 상품별 집행 조건과 업종 제한을 확인할 때 봅니다.', terms: ['상품가이드', '상품 가이드', '업종 제한'] },
          { text: '제작 가이드: 이미지 비율, 텍스트 영역, 노출 지면별 리사이징처럼 소재 조건을 확인할 때 필요합니다.', terms: ['제작 가이드', '이미지', '비율', '노출 지면', '리사이징'] },
          { text: '집행 기준 및 심사 가이드: 광고 가능 업종, 금지 행위, 소재 제한을 검토할 때 확인합니다.', terms: ['집행 기준', '심사 가이드', '광고 집행', '등록불가 업종'] },
        ],
      },
      {
        title: '**2. 운영 전에 확인할 조건**',
        bullets: [
          { text: '연령 제한 업종, 주류·담배·사행성 등 제한 업종은 상품별로 집행 가능 여부가 달라질 수 있습니다.', terms: ['연령 제한', '주류', '담배', '사행', '업종 제한'] },
          { text: '카카오 서비스나 디자인을 모방하거나 오인하게 만드는 소재는 집행이 제한될 수 있습니다.', terms: ['카카오 서비스', '모방', '오인', '상표'] },
          { text: 'AI 생성물이나 허위·과장으로 오인될 수 있는 소재는 별도 기준을 함께 확인해야 합니다.', terms: ['생성형 인공지능', 'AI 생성물', '허위', '과장'] },
        ],
      },
      {
        title: '**3. 상황별 빠른 선택 기준**',
        bullets: [
          { text: '카카오 주요 지면에서 브랜드 노출을 원한다면: 비즈보드/디스플레이 광고', terms: ['비즈보드', '디스플레이 광고'] },
          { text: '업종 제한이 민감한 상품이라면: 상품가이드와 심사 가이드 선확인', terms: ['상품가이드', '심사 가이드', '업종 제한'] },
          { text: '소재 제작 단계라면: 제작 가이드와 노출 지면별 이미지 조건 확인', terms: ['제작 가이드', '노출 지면', '이미지'] },
        ],
      },
    ],
    summary: '정리하면, 먼저 카카오 지면 노출, 상품별 집행 조건, 소재 제작 조건 중 무엇을 확인하려는지 정하고, 상품가이드와 심사 가이드를 함께 대조하는 흐름이 안전합니다.',
  },
};

const PRODUCT_STRUCTURE_SELECTION_TERMS = [
  [
    '광고 관리자 목표', '캠페인 목표', '마케팅 목표', '인지도', '트래픽', '참여', '잠재 고객', '앱 홍보', '판매',
    '앱 캠페인', '쇼핑 광고', '검색 캠페인', '디스플레이 캠페인', '검색광고', '쇼핑검색', '쇼핑블록',
    '비즈보드', '카카오모먼트', '상품가이드', '상품 가이드',
  ],
  [
    '이미지', '동영상', '슬라이드', '카루셀', '컬렉션', '형식', '노출 위치', '게재 위치', '지면',
    '반응형 디스플레이', '이미지 확장', '제작 가이드', '소재',
  ],
  [
    'advantage+', '어드밴티지', '카탈로그', 'catalog', '컬렉션 광고', 'collection ads', '메타 픽셀', 'conversions api',
    '리드 양식', '상품DB', '상품 DB', 'DB URL', 'EP', '가격비교', '업종 제한', '심사 가이드',
  ],
];

function sourceMatchesVendor(source: ReturnType<typeof buildVerifiedSources>[number], vendor?: VendorIntent) {
  if (!vendor) return true;
  if (hasExplicitOtherVendorSignal(source, vendor)) return false;
  if (source.sourceVendor === vendor || Boolean(source.sourceVendors?.includes(vendor))) return true;

  const text = getSourceText(source);
  const vendorTerms: Record<VendorIntent, RegExp> = {
    META: /meta|facebook|페이스북|instagram|인스타그램|릴스|reels|advantage\+|어드밴티지|메타\s*픽셀/,
    KAKAO: /kakao|카카오|카카오톡|톡채널|비즈보드|모먼트|상품\s*가이드|상품가이드/,
    NAVER: /naver|네이버|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|쇼핑파트너센터|상품\s*db|db\s*url|가격비교|사이트검색광고/,
    GOOGLE: /google|구글|youtube|유튜브|gdn|google ads|display|앱\s*캠페인|반응형\s*디스플레이|리드\s*양식/,
  };

  return vendorTerms[vendor].test(text);
}

function hasExplicitOtherVendorSignal(source: ReturnType<typeof buildVerifiedSources>[number], targetVendor: VendorIntent) {
  const sourceLike = source as any;
  const primaryIdentityText = `${sourceLike.originalTitle || ''} ${sourceLike.documentTitle || ''} ${sourceLike.documentUrl || ''} ${sourceLike.url || ''} ${sourceLike.documentId || ''}`.toLowerCase();
  const text = primaryIdentityText.trim() || getSourceText(source);
  const vendorTerms: Record<VendorIntent, RegExp> = {
    META: /meta|facebook|페이스북|instagram|인스타그램|릴스|reels/,
    KAKAO: /kakao|카카오|카카오톡|톡채널|비즈보드|모먼트/,
    NAVER: /naver|네이버|검색광고|쇼핑검색|파워링크|브랜드검색/,
    GOOGLE: /google|구글|youtube|유튜브|gdn|google ads|display/,
  };
  const hasTarget = vendorTerms[targetVendor].test(text);
  const hasOther = (Object.keys(vendorTerms) as VendorIntent[])
    .filter(vendor => vendor !== targetVendor)
    .some(vendor => vendorTerms[vendor].test(text));

  return hasOther && !hasTarget;
}

function selectProductStructureResponseSources(sources: ReturnType<typeof buildVerifiedSources>, intent?: QueryIntent) {
  const targetVendor = intent?.vendors.length === 1 ? intent.vendors[0] : undefined;
  const profile = targetVendor ? PRODUCT_STRUCTURE_PROFILES[targetVendor] : undefined;
  const labelledSources = sources.map((source, index) => ({
    ...source,
    label: `S${index + 1}`,
  })).filter(source => sourceMatchesVendor(source, targetVendor));
  const selected: ReturnType<typeof buildVerifiedSources>[number][] = [];
  const selectedKeys = new Set<string>();

  const addSource = (source?: ReturnType<typeof buildVerifiedSources>[number]) => {
    if (!source || isWeakProductStructureDisplaySource(source)) return;
    const key = getProductStructureSourceKey(source);
    if (selectedKeys.has(key)) return;
    selectedKeys.add(key);
    selected.push(source);
  };

  if (profile) {
    for (const section of profile.sections) {
      for (const bullet of section.bullets) {
        addSource(pickTopicSource(labelledSources, bullet.terms));
      }
    }
  }

  for (const terms of PRODUCT_STRUCTURE_SELECTION_TERMS) {
    addSource(pickTopicSource(labelledSources, terms));
  }

  if (selected.length === 0) {
    return sources
      .filter(source => sourceMatchesVendor(source, targetVendor))
      .filter(source => !isWeakProductStructureDisplaySource(source))
      .slice(0, 3);
  }

  return selected.slice(0, 5);
}

function buildProductStructureAnswer(sources: ReturnType<typeof buildVerifiedSources>, intent: QueryIntent) {
  const targetVendor = intent.vendors.length === 1
    ? intent.vendors[0]
    : (sources.find(source => source.sourceVendor && source.sourceVendor !== 'UNKNOWN')?.sourceVendor as VendorIntent | undefined);
  const profile = targetVendor ? PRODUCT_STRUCTURE_PROFILES[targetVendor] : undefined;
  const vendorLabel = targetVendor ? (VENDOR_LABELS[targetVendor] || targetVendor) : '해당 매체';
  const labelledSources = sources.map((source, index) => ({
    ...source,
    label: `S${index + 1}`,
  })).filter(source => sourceMatchesVendor(source, targetVendor));
  const usedLabels = new Set<string>();
  const lines: string[] = [profile?.intro || `${vendorLabel} 광고 상품/유형은 현재 검증 출처에서 확인되는 범위 안에서만 정리합니다.`, ''];
  let renderedBulletCount = 0;

  for (const section of profile?.sections || []) {
    const sectionLines: string[] = [];

    for (const bullet of section.bullets) {
      const source = pickTopicSource(labelledSources, bullet.terms);
      if (!source) continue;
      usedLabels.add(source.label);
      sectionLines.push(`- ${bullet.text}`);
    }

    if (sectionLines.length === 0) continue;
    lines.push(section.title);
    lines.push(...sectionLines);
    lines.push('');
    renderedBulletCount += sectionLines.length;
  }

  if (renderedBulletCount === 0) {
    lines.push('**확인된 범위**');
    if (labelledSources.length === 0) {
      lines.push(`- 현재 선택된 검증 출처에서는 ${vendorLabel} 광고 상품/유형 구조를 직접 확인할 수 있는 근거가 충분하지 않습니다.`);
    } else {
      for (const source of labelledSources.slice(0, 3)) {
        usedLabels.add(source.label);
        lines.push(`- ${compactEvidenceExcerpt(source.excerpt, source.title)} [${source.label}]`);
      }
    }
    lines.push('');
    lines.push('**추가 확인 필요**');
    lines.push(`- ${vendorLabel}의 전체 상품 목록, 사용 가능 지면, 계정별 노출 조건은 원문 또는 담당자 확인이 필요합니다.`);
    lines.push('- 확인되지 않은 상품명을 다른 매체 기준으로 대응시키거나 추정하지 않는 것이 안전합니다.');
    lines.push('');
  } else {
    lines.push(profile?.summary || `${vendorLabel} 광고는 확인된 출처 범위 안에서 목표, 지면, 소재 형식, 운영 조건을 나누어 확인하는 흐름이 안전합니다.`);
  }
  lines.push('');

  const labelList = Array.from(usedLabels);
  lines.push(`근거: ${labelList.length > 0 ? labelList.map((label) => `[${label}]`).join(', ') : sources.slice(0, 3).map((_, index) => `[S${index + 1}]`).join(', ')}`);

  return lines.join('\n');
}

const VENDOR_LABELS: Record<string, string> = {
  META: 'Meta',
  GOOGLE: 'Google',
  KAKAO: '카카오',
  NAVER: '네이버',
};

function buildProductStructureSupplementQueries(intent: QueryIntent, originalMessage: string) {
  if (!intent.topics.includes('product_structure') || intent.vendors.length !== 1) return [];

  const vendor = intent.vendors[0];
  const queryByVendor: Record<VendorIntent, string[]> = {
    META: [
      'Meta 캠페인 목표 광고 관리자 목표 광고 상품',
      'Meta 컬렉션 광고 카탈로그 Advantage+ 노출 위치',
    ],
    GOOGLE: [
      'Google Ads 앱 캠페인 광고 유형',
      'Google Ads 검색 캠페인 반응형 디스플레이 리드 양식 쇼핑 광고',
    ],
    NAVER: [
      '네이버 사이트검색광고 웹사이트 방문 목적 광고 상품',
      '네이버 쇼핑검색광고 상품등록 절차 EP DB URL 쇼핑파트너센터',
      '네이버 쇼핑블록 PC 모바일 쇼핑 지면 광고 상품',
    ],
    KAKAO: [
      '카카오 비즈보드 디스플레이 광고 지면 광고 상품',
      '카카오 상품가이드 카카오모먼트 브랜드이모티콘 제작 가이드 광고 상품',
    ],
  };

  return Array.from(new Set([
    originalMessage,
    ...queryByVendor[vendor],
  ].filter(Boolean)));
}

function mergeSearchResultsByIdentity(results: SearchResult[]) {
  const byKey = new Map<string, SearchResult>();

  for (const result of results) {
    const key = [
      result.documentId || result.metadata?.document_id || '',
      result.chunk_id || result.metadata?.chunk_id || '',
      result.documentTitle || '',
    ].join(':');
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, result);
      continue;
    }

    const existingScore = existing.hybridScore || existing.score || existing.similarity || 0;
    const nextScore = result.hybridScore || result.score || result.similarity || 0;
    if (nextScore > existingScore) {
      byKey.set(key, result);
    }
  }

  return Array.from(byKey.values());
}

function decodeBasicHtmlEntities(text: string) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#123;/g, '{')
    .replace(/&#125;/g, '}')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function isNoisyExcerpt(text: string) {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('data-ms=')
    || normalized.includes('creative_detail')
    || normalized.includes('help-center-nav')
    || normalized.includes('style=')
    || normalized.includes('href=')
    || /_[a-z0-9]{3,}/i.test(normalized)
  );
}

function cleanEvidenceExcerpt(excerpt: string, fallbackTitle?: string) {
  const decoded = decodeBasicHtmlEntities(String(excerpt || ''));
  const compact = decoded
    .replace(/\*\*/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\b(?:class|style|href|data-[a-z0-9_-]+)=["'][^"']*["']/gi, ' ')
    .replace(/_[a-z0-9]{3,}/gi, ' ')
    .replace(/\{[^{}]*(?:creative_detail|help-center-nav|folder\d+)[^{}]*\}/gi, ' ')
    .replace(/\/business\/help\/\d+/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.\.\.$/, '')
    .trim();

  if (!compact || compact.length < 35 || isNoisyExcerpt(compact)) {
    const title = fallbackTitle && fallbackTitle !== 'Unknown' ? fallbackTitle : '해당 출처';
    return `${title}에서 확인한 관련 정책입니다. 원문 세부 기준은 출처를 함께 확인하세요.`;
  }

  return compact;
}

function compactEvidenceExcerpt(excerpt: string, fallbackTitle?: string) {
  const compact = cleanEvidenceExcerpt(excerpt, fallbackTitle);

  return compact.length > 210 ? `${compact.slice(0, 210)}...` : compact;
}

function buildIntentFocusedExcerpt(
  excerpt: string,
  fallbackTitle: string,
  intent?: QueryIntent
) {
  const compact = cleanEvidenceExcerpt(excerpt, fallbackTitle);
  if (!intent) return compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;

  const lower = compact.toLowerCase();
  const focusTermGroups = [
    intent.strictContextTerms,
    intent.strictProductTerms,
    intent.keywords,
  ];
  let matchIndex: number | undefined;

  for (const group of focusTermGroups) {
    const groupMatchIndex = Array.from(new Set(group))
      .map(term => term.toLowerCase())
      .filter(term => term.length >= 2)
      .map(term => lower.indexOf(term))
      .filter(index => index >= 0)
      .sort((a, b) => a - b)[0];

    if (groupMatchIndex !== undefined) {
      matchIndex = groupMatchIndex;
      break;
    }
  }

  if (matchIndex === undefined || matchIndex <= 70) {
    return compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
  }

  const start = Math.max(0, matchIndex - 90);
  const end = Math.min(compact.length, matchIndex + 230);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < compact.length ? '...' : '';

  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

function getSourceText(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceLike = source as any;
  return [
    source.title,
    source.originalTitle,
    source.excerpt,
    sourceLike.matchText,
    Array.isArray(source.rankReason) ? source.rankReason.join(' ') : '',
    Array.isArray(source.evidenceDecisionReason) ? source.evidenceDecisionReason.join(' ') : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

function pickTopicSource(
  sources: Array<ReturnType<typeof buildVerifiedSources>[number] & { label: string }>,
  terms: string[]
) {
  return sources
    .map((source, index) => ({
      source,
      index,
      hits: terms.filter(term => getSourceText(source).includes(term.toLowerCase())).length,
    }))
    .filter(candidate => candidate.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.index - b.index)[0]?.source;
}

function buildFalseClaimComparisonAnswer(
  intent: QueryIntent,
  labelledSources: Array<ReturnType<typeof buildVerifiedSources>[number] & { label: string }>
) {
  const usedLabels = new Set<string>();
  const lines: string[] = [
    '효능, 효과, 보장, 개선처럼 성과를 단정하는 표현은 매체별로 별도 확인이 필요합니다.',
    '',
  ];

  for (const vendor of intent.vendors) {
    const vendorSources = labelledSources
      .filter((source) => source.sourceVendor === vendor || source.sourceVendors?.includes(vendor))
      .slice(0, 3);
    const topicSource = pickTopicSource(vendorSources, [
      '효능', '효과', '보장', '입증', '개선', '치료', '허위', '과장',
      '건강', '웰니스', '헬스케어', '의료', 'health', 'wellness', 'healthcare',
    ]);
    const supportSource = vendorSources.find(source => source.label !== topicSource?.label);

    lines.push(`### ${VENDOR_LABELS[vendor] || vendor}`);

    if (!topicSource) {
      lines.push('- 현재 선택된 검증 출처에서는 이 매체의 효능/보장 표현 기준이 충분히 확인되지 않았습니다.');
      lines.push('');
      continue;
    }

    usedLabels.add(topicSource.label);

    if (vendor === 'GOOGLE') {
      lines.push(`- Google은 헬스케어 관련 콘텐츠에서 광고 불가, 인증 필요, 승인 지역 제한처럼 집행 조건이 붙을 수 있음을 먼저 확인해야 합니다. 효능을 단정하는 문구는 상품/지역/인증 조건과 함께 원문 대조가 필요합니다. [${topicSource.label}]`);
    } else if (vendor === 'META') {
      lines.push(`- Meta는 건강 및 웰니스 정책 출처를 별도로 확인해야 합니다. 현재 확보된 출처만으로 세부 허용 문구를 단정하기보다, 효능·치료·개선 표현이 이용자를 오인하게 만들지 않는지 원문 기준으로 대조해야 합니다. [${topicSource.label}]`);
    } else {
      lines.push(`- ${compactEvidenceExcerpt(topicSource.excerpt, topicSource.title)} [${topicSource.label}]`);
    }

    if (supportSource) {
      usedLabels.add(supportSource.label);
      lines.push(`- 보조 기준: ${compactEvidenceExcerpt(supportSource.excerpt, supportSource.title)} [${supportSource.label}]`);
    }

    lines.push('');
  }

  lines.push('### 실무 판단');
  lines.push('- “효과 보장”, “개선 입증”, “치료 가능”처럼 결과를 약속하는 표현은 매체별 원문과 업종별 법적 제한을 함께 확인한 뒤 사용해야 합니다.');
  lines.push('- 한 매체에서 허용 가능해 보이는 표현도 다른 매체에는 그대로 적용하지 말고, 랜딩 페이지의 증빙과 고지 문구까지 함께 검토하는 것이 안전합니다.');
  lines.push('');
  const labelList = Array.from(usedLabels);
  lines.push(`근거: ${labelList.map((label) => `[${label}]`).join(', ')}`);

  return lines.join('\n');
}

function buildGroundedComparisonAnswer(
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>
) {
  const labelledSources = sources.map((source, index) => ({
    ...source,
    label: `S${index + 1}`,
  }));

  if (intent.topics.includes('false_claim')) {
    return buildFalseClaimComparisonAnswer(intent, labelledSources);
  }

  const usedLabels = new Set<string>();
  const lines: string[] = [
    '제공된 검증 출처 기준으로 매체별 차이를 정리하면 다음과 같습니다.',
    '',
  ];

  for (const vendor of intent.vendors) {
    const vendorSources = labelledSources
      .filter((source) => source.sourceVendor === vendor || source.sourceVendors?.includes(vendor))
      .slice(0, 2);

    lines.push(`### ${VENDOR_LABELS[vendor] || vendor}`);

    if (vendorSources.length === 0) {
      lines.push('- 현재 선택된 검증 출처에서는 이 매체의 기준이 충분히 확인되지 않았습니다.');
      lines.push('');
      continue;
    }

    for (const source of vendorSources) {
      usedLabels.add(source.label);
      lines.push(`- ${compactEvidenceExcerpt(source.excerpt, source.title)} [${source.label}]`);
    }
    lines.push('');
  }

  lines.push('### 실무 판단');
  lines.push('- 비교 질문에서는 한 매체의 허용 기준을 다른 매체에 그대로 적용하지 말고, 매체별 원문 기준을 각각 확인해야 합니다.');
  lines.push('- 위 출처 기준으로 확인되지 않은 세부 업종, 소재 문안, 랜딩 페이지 조건은 추가 확인 대상으로 남겨두는 것이 안전합니다.');
  lines.push('');
  const labelList = Array.from(usedLabels);
  lines.push(`근거: ${labelList.map((label) => `[${label}]`).join(', ')}`);

  return lines.join('\n');
}

function calculateConfidence(searchResults: SearchResult[], intent?: QueryIntent): number {
  if (searchResults.length === 0) return 0;
  
  const avgScore = searchResults.reduce((sum, result) => {
    const retrievalScore = result.hybridScore ?? result.score ?? result.similarity;
    const qualityScore = result.sourceQuality?.qualityScore ?? 0.6;
    const lexicalScore = result.lexicalOverlap ?? result.sourceQuality?.lexicalOverlap ?? 0;
    const vendorPenalty = result.vendorMismatch || result.sourceQuality?.vendorMismatch ? 0.15 : 0;
    return sum + (retrievalScore * 0.62) + (qualityScore * 0.2) + (lexicalScore * 0.18) - vendorPenalty;
  }, 0) / searchResults.length;
  let confidence = Math.min(avgScore * 100, 100);

  if (intent) {
    const missingVendorSlots = getMissingVendorSlots(intent, searchResults);
    confidence -= missingVendorSlots.length * 18;

    if (intent.recommendedSourceLimit > 3 && searchResults.length < 2) {
      confidence -= 15;
    }

    const distinctTitles = new Set(searchResults.map((result) => (
      result.documentTitle || result.metadata?.originalTitle || result.metadata?.title || result.chunk_id
    ))).size;

    if (searchResults.length >= 3 && distinctTitles <= 1) {
      confidence -= 8;
    }
  }

  return Math.max(0, Math.min(confidence, 100));
}

function buildVerifiedSources(searchResults: SearchResult[], intent?: QueryIntent) {
  return searchResults.map(result => {
    const originalTitle = result.documentTitle || result.metadata?.originalTitle || result.metadata?.title || 'Meta 광고 정책 문서';
    const sourceVendor = result.sourceVendor || result.metadata?.sourceVendor || result.metadata?.source_vendor || result.sourceQuality?.sourceVendor || 'UNKNOWN';
    const sourceVendors = Array.from(new Set([
      ...(result.sourceVendors || []),
      ...(Array.isArray(result.metadata?.sourceVendors) ? result.metadata.sourceVendors : []),
      ...(Array.isArray(result.metadata?.source_vendors) ? result.metadata.source_vendors : []),
      ...(sourceVendor && sourceVendor !== 'UNKNOWN' ? [sourceVendor] : []),
    ].filter(Boolean)));
    const displayTitle = normalizeSourceTitle(originalTitle, sourceVendor, result.content);
    const matchText = [
      result.content,
      result.documentTitle,
      result.documentUrl,
      result.metadata?.title,
      result.metadata?.source_title,
      result.metadata?.canonical_title,
      result.metadata?.source,
      result.metadata?.source_url,
      result.metadata?.document_url,
      result.metadata?.url,
      result.metadata?.sourceVendor,
      result.metadata?.source_vendor,
      result.metadata?.productStructureAnchor,
      Array.isArray(result.metadata?.topic_labels) ? result.metadata.topic_labels.join(' ') : result.metadata?.topic_labels,
      Array.isArray(result.rankReason) ? result.rankReason.join(' ') : '',
      Array.isArray(result.evidenceDecisionReason) ? result.evidenceDecisionReason.join(' ') : '',
    ].filter(Boolean).join(' ').slice(0, 6000).toLowerCase();

    return {
      id: result.chunk_id,
      title: displayTitle,
      originalTitle,
      url: result.documentUrl || result.metadata?.source_url || result.metadata?.document_url || result.metadata?.url || '',
      updatedAt: result.metadata?.updatedAt || new Date().toISOString(),
      excerpt: buildIntentFocusedExcerpt(result.content, displayTitle, intent),
      similarity: result.similarity,
      score: result.score ?? result.similarity,
      hybridScore: result.hybridScore ?? result.metadata?.hybridScore,
      vectorScore: result.vectorScore ?? result.metadata?.vectorScore,
      keywordScore: result.keywordScore ?? result.metadata?.keywordScore,
      retrievalMethod: result.retrievalMethod || result.metadata?.retrievalMethod || 'vector',
      evidenceType: result.evidenceType || result.metadata?.evidenceType || result.retrievalMethod || 'vector',
      evidenceDecision: result.evidenceDecision || result.metadata?.evidenceDecision || 'weak',
      evidenceDecisionReason: result.evidenceDecisionReason || result.metadata?.evidenceDecisionReason || [],
      corpus: result.corpus || result.metadata?.corpus,
      rankReason: result.rankReason || result.metadata?.rankReason || [],
      lexicalOverlap: result.lexicalOverlap ?? result.metadata?.lexicalOverlap,
      vendorMatch: result.vendorMatch ?? result.metadata?.vendorMatch,
      vendorMismatch: result.vendorMismatch ?? result.metadata?.vendorMismatch,
      sourceVendor,
      sourceVendors,
      topicMatch: result.topicMatch ?? result.metadata?.topicMatch,
      matchText,
      sourceQuality: result.sourceQuality || {
        hasDocumentId: Boolean(result.documentId),
        hasTitle: Boolean(result.documentTitle || result.metadata?.title),
        hasUrl: Boolean(result.documentUrl || result.metadata?.source_url || result.metadata?.document_url || result.metadata?.url),
        hasExcerpt: Boolean(result.content),
        isFallback: false,
        warnings: [],
      },
      documentId: result.documentId || result.metadata?.documentId || result.metadata?.document_id,
      chunkId: result.chunk_id,
      sourceType: result.metadata?.type || 'document',
      documentType: result.metadata?.documentType || 'policy'
    };
  });
}

function scoreVerifiedSourceForIntent(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent,
  originalIndex: number
) {
  const text = `${source.title || ''} ${source.originalTitle || ''} ${source.excerpt || ''}`.toLowerCase();
  let score = 100 - originalIndex;

  if (source.sourceVendor && intent.vendors.includes(source.sourceVendor as VendorIntent)) score += 40;
  if (intent.requiresVendorCoverage && source.sourceVendor) {
    const vendorIndex = intent.vendors.indexOf(source.sourceVendor as VendorIntent);
    if (vendorIndex >= 0) score += (intent.vendors.length - vendorIndex) * 1000;
  }
  if (source.vendorMismatch) score -= 35;
  if (source.evidenceDecision === 'verified') score += 20;
  if (source.retrievalMethod === 'hybrid') score += 8;
  if (source.retrievalMethod === 'keyword') score += 6;
  if (source.url) score += 4;

  for (const keyword of intent.keywords) {
    if (keyword.length >= 2 && text.includes(keyword.toLowerCase())) score += 3;
  }

  if (intent.topics.includes('false_claim')) {
    const specificTerms = [
      '효능', '효과', '보장', '입증', '개선', '치료', '허위', '과장', '오인', '기만',
      '건강', '웰니스', '헬스케어', '의료', 'health', 'wellness', 'healthcare',
    ];
    const specificHitCount = specificTerms.filter(term => text.includes(term)).length;
    score += specificHitCount * 8;

    if (/건강|웰니스|헬스케어|의료|health|wellness|healthcare/.test(text)) score += 22;
    if (/광고 정책 2024|광고 콘텐츠 가이드라인/.test(text) && specificHitCount <= 1) score -= 18;
  }

  if (intent.topics.includes('review') && /심사|검수|승인|반려|등록기준|운영정책/.test(text)) score += 14;
  if (intent.topics.includes('spec') && /사이즈|크기|파일|형식|비율|픽셀|동영상|이미지/.test(text)) score += 14;
  if (intent.topics.includes('product_structure')) {
    const structureTerms = [
      '캠페인 목표', '광고 관리자 목표', '마케팅 목표',
      'objective', 'objectives', 'advantage+', '어드밴티지', '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드',
      'conversions api', '노출 위치', '게재 위치', 'placements', '지면',
      '컬렉션', 'collection', '리드', 'lead',
      '앱 캠페인', '쇼핑 광고', '검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이', '리드 양식',
      '검색광고', '쇼핑검색', '파워링크', '브랜드검색', '쇼핑블록', '디지털 옥외광고',
      '비즈보드', '카카오모먼트', '브랜드이모티콘', '상품가이드', '상품 가이드',
      '상품db', '상품 db', 'db url', 'ep', '가격비교', '업종 제한', '심사 가이드',
    ];
    const structureHitCount = structureTerms.filter(term => text.includes(term)).length;
    score += structureHitCount * 7;

    const hasHighValueProductStructure = /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives|advantage\+|어드밴티지|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|앱\s*캠페인|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|디지털\s*옥외광고|비즈보드|카카오모먼트|브랜드이모티콘|상품\s*가이드|상품가이드|상품\s*db|db\s*url|가격비교|업종\s*제한|심사\s*가이드/.test(text)
      || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text)
      || (/노출 위치|게재 위치|placements|지면/.test(text) && /캠페인 목표|광고 관리자 목표|마케팅 목표/.test(text));

    if (hasHighValueProductStructure) {
      score += 60;
    }
    if (/캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives/.test(text)
      || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text)
    ) score += 30;
    if (/advantage\+|어드밴티지|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|앱\s*캠페인|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|디지털\s*옥외광고|비즈보드|카카오모먼트|브랜드이모티콘|상품\s*가이드|상품가이드|상품\s*db|db\s*url|가격비교|업종\s*제한|심사\s*가이드/.test(text)) score += 18;
    if (/광고 사양|광고 형식\/사양|제작 가이드|소재 제작|크기|파일 크기|최대 파일|지원 형식|비율|jpg|png|mp4|mov|1200x|1080x|1280x|텍스트 제한|marketplace의|facebook marketplace|facebook 검색 결과|instagram 탐색 홈|탐색 홈의|검색 결과의/.test(text)
      && !hasHighValueProductStructure
    ) {
      score -= 95;
    }
  }
  if (isNoisyExcerpt(String(source.excerpt || ''))) score -= 8;

  return score;
}

function orderVerifiedSourcesForIntent(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent
) {
  return sources
    .map((source, index) => ({
      source,
      index,
      score: scoreVerifiedSourceForIntent(source, intent, index),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ source }) => source);
}

function normalizeSourceTitle(title: string, sourceVendor: string, content: string): string {
  const blob = `${title} ${content}`.toLowerCase();

  if (
    sourceVendor === 'KAKAO'
    || blob.includes('카카오')
    || blob.includes('kakao')
    || blob.includes('비즈보드')
    || blob.includes('카카오톡')
    || blob.includes('모먼트')
  ) {
    return appendOriginalTitle('카카오 광고 심사 가이드', title);
  }

  if (
    sourceVendor === 'NAVER'
    || blob.includes('네이버')
    || blob.includes('naver')
    || blob.includes('쇼핑검색')
    || blob.includes('파워링크')
    || blob.includes('브랜드검색')
  ) {
    if (/사이트검색광고|웹사이트 방문 목적/.test(blob)) {
      return '네이버 광고 가이드: 사이트검색광고';
    }
    if (/쇼핑검색광고|쇼핑몰 상품형/.test(blob)) {
      return '네이버 광고 가이드: 쇼핑검색광고 상품형';
    }
    return appendOriginalTitle('네이버 광고 가이드', title);
  }

  if (
    sourceVendor === 'GOOGLE'
    || blob.includes('google')
    || blob.includes('구글')
    || blob.includes('youtube')
    || blob.includes('유튜브')
    || blob.includes('gdn')
  ) {
    return appendOriginalTitle('Google Ads 가이드', title);
  }

  if (
    sourceVendor === 'META'
    || blob.includes('meta')
    || blob.includes('메타')
    || blob.includes('facebook')
    || blob.includes('페이스북')
  ) {
    return title && title !== 'Unknown' ? title : 'Meta 광고 정책';
  }

  return title && title !== 'Unknown' ? title : '광고 정책 문서';
}

function appendOriginalTitle(normalizedTitle: string, originalTitle: string): string {
  if (!originalTitle || originalTitle === 'Unknown') return normalizedTitle;
  if (originalTitle.includes(normalizedTitle) || normalizedTitle.includes(originalTitle)) {
    return normalizedTitle;
  }
  return `${normalizedTitle}: ${originalTitle}`;
}

function getEvidenceDecision(result: SearchResult): string | undefined {
  return result.evidenceDecision || result.metadata?.evidenceDecision;
}

function isVerifiedGrounding(result: SearchResult): boolean {
  const hasGrounding = typeof result.content === 'string' && result.content.trim().length > 0;
  const isFallback = result.retrievalMethod === 'fallback'
    || result.sourceQuality?.isFallback === true
    || result.metadata?.type === 'fallback';
  const evidenceDecision = getEvidenceDecision(result);
  return hasGrounding && !isFallback && evidenceDecision === 'verified';
}


/**
 * Builds a Compass answer payload. JSON and streaming routes both use this
 * path so answer quality and source contracts stay identical.
 */
export async function buildCompassAnswerResponse(
  request: NextRequest,
  emitPhase?: CompassAnswerPhaseEmitter
): Promise<CompassAnswerHandlerResult> {
  const startTime = Date.now();
  console.log('Compass answer runtime request started');
  
  try {
    // JSON 파싱 오류 방지
    let requestBody;
    try {
      requestBody = await request.json();
    } catch (parseError) {
      console.error('Compass answer request payload parsing failed', {
        errorName: parseError instanceof Error ? parseError.name : 'UnknownError',
      });
      return {
        body: { error: '잘못된 JSON 형식입니다.' },
        status: 400,
      };
    }
    
    const { message, conversationHistory } = requestBody;
    
    if (!message || typeof message !== 'string') {
      return {
        body: { error: '메시지가 필요합니다.' },
        status: 400,
      };
    }

    emitPhase?.({ phase: 'accepted', message: '질문을 접수했습니다.' });
    const ragIntent = classifyCompassRagQuery(message);

    // 1. Compass RAG 검색
    emitPhase?.({
      phase: 'evidence-started',
      message: '질문 조건을 분석하고 관련 출처를 검색합니다.',
      queryType: ragIntent.queryType,
    });
    const usesProductStructureFastPath =
      ragIntent.topics.includes('product_structure')
      && ragIntent.vendors.length === 1
      && !ragIntent.isComparative;
    const fastPathSupplementQueries = usesProductStructureFastPath && ragIntent.vendors[0] === 'NAVER'
      ? ['네이버 쇼핑검색광고 상품형 쇼핑블록 광고 상품']
      : [];
    const supplementQueries = usesProductStructureFastPath
      ? fastPathSupplementQueries
      : buildProductStructureSupplementQueries(ragIntent, message).filter(query => query !== message);

    const searchQueries = [message, ...supplementQueries];
    const searchResultGroups = await Promise.all(
      searchQueries.map(query => searchWithCompassRAG(query, Math.max(8, ragIntent.recommendedSourceLimit)))
    );
    const supplementResultCount = searchResultGroups.slice(1).flat().length;
    let searchResults = searchResultGroups.flat();

    if (supplementQueries.length > 0) {
      searchResults = mergeSearchResultsByIdentity(searchResults);
      console.log('Compass product-structure adaptive retrieval completed', {
        supplementQueryCount: supplementQueries.length,
        supplementResultCount,
        mergedResultCount: searchResults.length,
      });
    }
    console.log('Compass answer evidence selected', {
      resultCount: searchResults.length,
      queryType: ragIntent.queryType,
      recommendedSourceLimit: ragIntent.recommendedSourceLimit,
      requestedVendors: ragIntent.vendors,
    });
    const verifiedSearchResults = searchResults.filter(isVerifiedGrounding);
    const sourceDiagnostics = buildSourceDiagnostics(ragIntent, verifiedSearchResults);
    emitPhase?.({
      phase: 'evidence-ready',
      message: '확인 가능한 출처를 선별했습니다.',
      queryType: ragIntent.queryType,
      sourceCount: searchResults.length,
      verifiedSourceCount: verifiedSearchResults.length,
    });
    if (verifiedSearchResults.length !== searchResults.length) {
      console.warn('Compass answer evidence filtered', { filteredCount: searchResults.length - verifiedSearchResults.length });
    }

    // 2. 검색 결과가 없으면 관련 내용 없음 응답
    if (verifiedSearchResults.length === 0) {
      console.log('Compass answer request completed without grounded evidence');
      const noDataAnswer = buildNoDataAnswer(ragIntent);
      emitPhase?.({ phase: 'answer-ready', message: '확인 가능한 출처가 없어 제한 응답을 준비했습니다.' });
      return {
        body: {
          response: {
            message: noDataAnswer,
            content: noDataAnswer,
            sources: [],
            noDataFound: true,
            schema: getCompassDbSchema(),
            showContactOption: true,
            sourceDiagnostics,
            reviewPipeline: buildReviewPipeline({
              status: 'blocked',
              sourceCount: searchResults.length,
              verifiedSourceCount: 0,
              contactRecommended: true,
            }),
          },
          confidence: 0,
          processingTime: Date.now() - startTime,
          model: 'compass-answer-no-data'
        }
      };
    }

    // 3. 설정된 답변 LLM으로 생성. Retrieval/source contract remains provider-agnostic.
    console.log('Compass answer generation started');
    
    const sources = orderVerifiedSourcesForIntent(buildVerifiedSources(verifiedSearchResults, ragIntent), ragIntent);
    const confidence = calculateConfidence(verifiedSearchResults, ragIntent);
    const schema = getCompassDbSchema();
    const coverageNotice = buildCoverageNotice(sourceDiagnostics);
    const reviewPipeline = buildReviewPipeline({
      status: 'completed',
      sourceCount: searchResults.length,
      verifiedSourceCount: verifiedSearchResults.length,
      contactRecommended: false,
    });
    emitPhase?.({
      phase: 'answer-started',
      message: '선별된 출처를 기준으로 답변을 정리합니다.',
      queryType: ragIntent.queryType,
      sourceCount: searchResults.length,
      verifiedSourceCount: verifiedSearchResults.length,
    });

    if (ragIntent.requiresVendorCoverage && sourceDiagnostics.missingVendorSlots.length > 0) {
      console.warn('Compass answer generation skipped because requested vendor coverage is incomplete', {
        requestedVendors: sourceDiagnostics.requestedVendors,
        coveredVendors: sourceDiagnostics.coveredVendors,
        missingVendorSlots: sourceDiagnostics.missingVendorSlots,
      });

      const coverageLimitedAnswer = buildCoverageLimitedAnswer(sourceDiagnostics);
      emitPhase?.({ phase: 'answer-ready', message: '출처 범위 제한을 표시한 답변을 준비했습니다.' });
      return {
        body: {
          response: {
            message: coverageLimitedAnswer,
            content: coverageLimitedAnswer,
            sources,
            noDataFound: false,
            schema,
            showContactOption: true,
            sourceDiagnostics,
            reviewPipeline: buildReviewPipeline({
              status: 'limited',
              sourceCount: searchResults.length,
              verifiedSourceCount: verifiedSearchResults.length,
              contactRecommended: true,
            }),
          },
          confidence,
          processingTime: Date.now() - startTime,
          model: 'compass-answer-coverage-limited'
        }
      };
    }

    if (ragIntent.isComparative && ragIntent.vendors.length >= 2) {
      const groundedComparisonAnswer = buildGroundedComparisonAnswer(ragIntent, sources);

      emitPhase?.({ phase: 'answer-ready', message: '비교 답변을 출처 기준으로 정리했습니다.' });
      return {
        body: {
          response: {
            message: groundedComparisonAnswer,
            content: groundedComparisonAnswer,
            sources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics,
            reviewPipeline,
          },
          confidence,
          processingTime: Date.now() - startTime,
          model: 'compass-answer-grounded-comparison'
        }
      };
    }

    if (isPolicyJudgmentAnswerIntent(ragIntent)) {
      const groundedAnswer = buildPolicyGroundedAnswer(sources);

      emitPhase?.({ phase: 'answer-ready', message: '정책 판단 답변을 출처 기준으로 정리했습니다.' });
      return {
        body: {
          response: {
            message: groundedAnswer,
            content: groundedAnswer,
            sources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics,
            reviewPipeline,
          },
          confidence,
          processingTime: Date.now() - startTime,
          model: 'compass-answer-grounded-extractive'
        }
      };
    }

    if (
      ragIntent.topics.includes('product_structure')
      && !ragIntent.isComparative
      && ragIntent.vendors.length === 1
    ) {
      const productStructureSources = selectProductStructureResponseSources(sources, ragIntent);
      const groundedAnswer = buildProductStructureAnswer(productStructureSources, ragIntent);
      const usedSourceIndexes = Array.from(groundedAnswer.matchAll(/\[S(\d+)\]/g))
        .map(match => Number(match[1]) - 1)
        .filter(index => Number.isInteger(index) && index >= 0);
      const usedSourceIndexSet = new Set(usedSourceIndexes);
      const responseProductStructureSources = usedSourceIndexSet.size > 0
        ? productStructureSources.filter((_, index) => usedSourceIndexSet.has(index))
        : productStructureSources;

      emitPhase?.({ phase: 'answer-ready', message: '상품 구조 답변을 출처 기준으로 정리했습니다.' });
      return {
        body: {
          response: {
            message: groundedAnswer,
            content: groundedAnswer,
            sources: responseProductStructureSources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics,
            reviewPipeline,
          },
          confidence,
          processingTime: Date.now() - startTime,
          model: 'compass-answer-grounded-product-structure'
        }
      };
    }

    let answerResult;
    try {
      answerResult = await generateCompassAnswer(message, verifiedSearchResults);
    } catch (error) {
      console.error('Compass answer generation failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      
      // 답변 LLM 실패와 retrieval 실패를 분리하기 위해 검증된 sources는 보존한다.
      emitPhase?.({ phase: 'answer-ready', message: '출처는 확보했지만 생성 답변은 제한되었습니다.' });
      return {
        body: {
          response: {
            message: "답변 생성 모델에 연결할 수 없습니다. 근거 문서는 확보했지만 생성 답변은 일시적으로 제한되어 있습니다.",
            content: "답변 생성 모델에 연결할 수 없습니다. 근거 문서는 확보했지만 생성 답변은 일시적으로 제한되어 있습니다.",
            sources,
            noDataFound: false,
            schema,
            showContactOption: true,
            sourceDiagnostics,
            reviewPipeline: buildReviewPipeline({
              status: 'limited',
              sourceCount: searchResults.length,
              verifiedSourceCount: verifiedSearchResults.length,
              contactRecommended: true,
            }),
            error: true
          },
          confidence,
          processingTime: Date.now() - startTime,
          model: 'compass-answer-connection-failed'
        }
      };
    }

    // 처리 시간 계산
    const processingTime = Date.now() - startTime;
    console.log('Compass answer runtime request completed', { processingTime });
    const normalizedAnswer = normalizeGeneratedAnswer(answerResult.answer, sources);
    const responseAnswer = coverageNotice ? `${coverageNotice}\n\n${normalizedAnswer}` : normalizedAnswer;
    
    emitPhase?.({ phase: 'answer-ready', message: '답변 정리가 완료되었습니다.' });
    return {
      body: {
        response: {
          message: responseAnswer,
          content: responseAnswer,
          sources,
          noDataFound: false,
          schema,
          showContactOption: false,
          sourceDiagnostics,
          reviewPipeline,
        },
        confidence,
        processingTime,
        model: 'compass-answer'
      }
    };

  } catch (error) {
    console.error('Compass answer runtime request failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    
    // 에러 상세 정보 로깅
    if (error instanceof Error) {
      console.error('Compass answer runtime error detail:', {
        name: error.name,
      });
    } else {
      console.error('Compass answer runtime error detail:', { name: 'UnknownError' });
    }
    
    const processingTime = Date.now() - startTime;
    
    // 에러 타입별 응답
    let errorMessage = '죄송합니다. 현재 Compass 답변 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.';
    
    if (error instanceof Error) {
      if (error.message.includes('타임아웃')) {
        errorMessage = '죄송합니다. 서버 응답이 너무 느려서 타임아웃이 발생했습니다. 더 간단한 질문으로 다시 시도해주세요.';
      } else if (error.message.includes('연결할 수 없습니다')) {
        errorMessage = '죄송합니다. 답변 생성 모델에 연결할 수 없습니다. 서버 상태를 확인해주세요.';
      }
    }
    
    return {
      body: {
        response: {
          message: errorMessage,
          content: errorMessage,
          sources: [],
          noDataFound: true,
          schema: getCompassDbSchema(),
          showContactOption: true,
          reviewPipeline: buildReviewPipeline({
            status: 'error',
            sourceCount: 0,
            verifiedSourceCount: 0,
            contactRecommended: true,
          }),
        },
        confidence: 0,
        processingTime,
        model: 'compass-answer-error'
      },
      status: 500,
    };
  }
}

/**
 * Compass answer API handler.
 */
export async function POST(request: NextRequest) {
  const result = await buildCompassAnswerResponse(request);
  return NextResponse.json(result.body, { status: result.status || 200 });
}
