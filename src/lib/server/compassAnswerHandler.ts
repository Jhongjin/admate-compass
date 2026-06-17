import { NextRequest, NextResponse } from 'next/server';
import { getCompassDbSchema } from '@/lib/supabase/compass';
import { classifyCompassRagQuery, RAGSearchService, type EvidenceDecision, type QueryIntent, type VendorIntent } from '@/lib/services/RAGSearchService';
import { generateCompassAnswer, type CompassGroundingSource } from '@/lib/services/CompassAnswerLlmService';

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
  retrievalMethod?: 'vector' | 'keyword' | 'hybrid' | 'graph' | 'fallback';
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
  const answerScope = diagnostics.isComparative ? '비교 답변' : '답변';

  return [
    `요청하신 ${answerScope}은 현재 검증 출처가 부족해 확정해서 답변할 수 없습니다.`,
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

  const meaningfulText = normalized
    .replace(/\[출처:\s*S\d+(?:,\s*S\d+)*\]/g, '')
    .replace(/근거:\s*\[?S\d+\]?(?:,\s*\[?S\d+\]?)*\.?/g, '')
    .trim();
  const explicitInsufficientEvidence = /현재\s*제공된\s*문서에서는\s*확인되지\s*않습니다|제공된\s*(근거|문서).*확인되지\s*않습니다|충분히\s*확인되지\s*않습니다/.test(normalized);

  if (sources.length > 0 && explicitInsufficientEvidence && meaningfulText.length >= 120) {
    normalized = normalized
      .replace(/^현재\s*제공된\s*문서에서는\s*확인되지\s*않습니다[.。]?\s*/i, '제공된 근거 기준으로 확인되는 범위만 정리합니다. ')
      .replace(/^제공된\s*(근거|문서).*확인되지\s*않습니다[.。]?\s*/i, '제공된 근거 기준으로 확인되는 범위만 정리합니다. ');
  }

  if (sources.length > 0 && meaningfulText.length < 80 && !explicitInsufficientEvidence) {
    return buildExtractiveAnswer(sources);
  }

  return normalized.trim() || buildExtractiveAnswer(sources);
}

function buildNaverShoppingDataOperationalAnswer(
  message: string,
  sources: ReturnType<typeof buildVerifiedSources>,
) {
  const normalizedQuestion = message.toLowerCase().replace(/\s+/g, ' ');
  const isNaverShoppingDataQuestion = /네이버|naver/.test(normalizedQuestion)
    && /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑\s*광고/.test(normalizedQuestion)
    && /db\s*url|상품\s*db|상품db|상품\s*등록|상품등록|ep|연동|등록|상품\s*정보/.test(normalizedQuestion);

  if (!isNaverShoppingDataQuestion) return null;

  const sourceText = (source: ReturnType<typeof buildVerifiedSources>[number]) => [
    source.title,
    source.originalTitle,
    source.excerpt,
    source.matchText,
  ].filter(Boolean).join(' ').toLowerCase();

  const sourceExcerptText = (source: ReturnType<typeof buildVerifiedSources>[number]) => [
    source.title,
    source.originalTitle,
    source.excerpt,
  ].filter(Boolean).join(' ').toLowerCase();

  const findSourceIndex = (pattern: RegExp) => sources.findIndex(source => (
    sourceMatchesVendor(source, 'NAVER') && pattern.test(sourceText(source))
  ));
  const label = (index: number) => `[S${index + 1}]`;
  const used = new Set<number>();
  const addUsed = (index: number) => {
    if (index >= 0) used.add(index);
  };

  const registrationIndex = findSourceIndex(/ep\s*\(=\s*db\s*url\)|상품\s*db\s*url|상품db\s*url|상품정보\s*수신\s*현황|등록\s*요청|등록요청|상품관리|입점\s*심사|영업일\s*기준\s*1\s*[-~]?\s*2일|카테고리\s*자동매칭|카테고리\s*매칭/);
  const epDetailIndex = findSourceIndex(/상품\s*가격|가격대|배송비|쿠폰|할인|대표이미지|색상\s*필터|혜택\s*필터/);
  const fallbackEpIndex = registrationIndex < 0
    ? findSourceIndex(/ep\s*\(=\s*db\s*url\)|상품\s*db\s*url|상품db\s*url|db\s*url/)
    : -1;
  const epIndex = epDetailIndex >= 0 ? epDetailIndex : fallbackEpIndex;
  const partnerIndex = sources.findIndex(source => {
    if (!sourceMatchesVendor(source, 'NAVER')) return false;
    const text = sourceText(source);
    if (!/쇼핑몰.*연동|네이버\s*쇼핑에\s*등록|전환\s*추적|고객센터/.test(text)) return false;
    if (sources[registrationIndex] === source && !/쇼핑몰.*연동|네이버\s*쇼핑에\s*등록|전환\s*추적|고객센터/.test(text.replace(/쇼핑파트너센터/g, ''))) {
      return false;
    }
    return true;
  });
  const standardIndex = findSourceIndex(/광고등록기준|통신판매업|인[\-/]?허가|신고|모조품|상표권|등록\s*기준/);

  if (registrationIndex < 0 && epIndex < 0 && partnerIndex < 0) return null;

  const sections: string[] = [
    '네이버 쇼핑검색광고의 상품등록/DB URL 점검은 “DB URL 하나만 입력하면 되는지”보다, EP와 쇼핑몰 상품 데이터가 노출 조건에 맞게 들어가 있는지 확인하는 흐름으로 보는 편이 안전합니다.',
    '',
  ];

  if (registrationIndex >= 0) {
    const registrationSource = sources[registrationIndex];
    const text = sourceText(registrationSource);
    addUsed(registrationIndex);
    sections.push('1. **상품 등록 경로와 EP(=DB URL) 심사부터 확인하기**');
    sections.push('');
    if (/상품정보\s*수신\s*현황|등록\s*요청|등록요청|상품관리/.test(text)) {
      sections.push(`- 쇼핑파트너센터의 상품관리/상품정보 수신 현황에서 등록요청을 진행하는 흐름을 먼저 확인해야 합니다 ${label(registrationIndex)}.`);
    }
    if (/ep\s*\(=\s*db\s*url\)|상품\s*db\s*url|상품db\s*url|db\s*url/.test(text)) {
      sections.push(`- CPC 상품 등록은 EP(=DB URL) 또는 상품 DB URL 입력과 연결되므로, 광고 집행 전에 DB URL이 등록 가능한 상태인지 점검해야 합니다 ${label(registrationIndex)}.`);
    }
    if (/입점\s*심사|영업일\s*기준\s*1\s*[-~]?\s*2일/.test(text)) {
      sections.push(`- EP 등록 후에는 심사가 필요할 수 있고, 근거에서는 영업일 기준 1~2일 정도의 심사 흐름이 확인됩니다 ${label(registrationIndex)}.`);
    }
    if (/카테고리\s*자동매칭|카테고리\s*매칭/.test(text)) {
      sections.push(`- 상품 DB URL을 넣은 뒤 카테고리 자동매칭 또는 카테고리 매칭 상태도 함께 확인해야 합니다 ${label(registrationIndex)}.`);
    }
    if (/cpc|cps/.test(text)) {
      sections.push(`- CPC/CPS 입점 또는 상품 등록 방식이 섞일 수 있으므로, 현재 쇼핑몰의 입점 유형과 상품 등록 경로를 같이 확인해야 합니다 ${label(registrationIndex)}.`);
    }
    sections.push('');
  }

  if (epIndex >= 0) {
    const epSource = sources[epIndex];
    const text = sourceText(epSource);
    addUsed(epIndex);
    sections.push(`${registrationIndex >= 0 ? '2' : '1'}. **EP 상품 데이터부터 확인하기**`);
    sections.push('');
    const beforeDetailCount = sections.length;
    if (/상품\s*가격|가격대/.test(text)) {
      sections.push(`- 가격대 필터는 EP에 등록된 상품 가격 기준으로 노출될 수 있으므로, 상품 가격이 정확히 등록되어 있는지 확인해야 합니다 ${label(epIndex)}.`);
    }
    if (/배송비|쿠폰|할인|혜택/.test(text)) {
      sections.push(`- 무료배송, 카드할인 같은 혜택 필터는 EP에 등록한 배송비, 쿠폰, 할인 정보 기준으로 노출될 수 있으므로 혜택 정보도 함께 점검해야 합니다 ${label(epIndex)}.`);
    }
    if (/대표이미지|색상\s*필터|색상/.test(text)) {
      sections.push(`- 색상 필터는 상품 대표이미지를 기반으로 자동 추출될 수 있으므로, 상품 색상이 명확하게 보이는 대표이미지를 등록하는 것이 좋습니다 ${label(epIndex)}.`);
    }
    if (sections.length === beforeDetailCount) {
      sections.push(`- 현재 근거에서는 EP/상품 데이터 관련 항목이 확인되지만, 세부 필드와 입력 화면은 원문에서 추가 확인하는 편이 안전합니다 ${label(epIndex)}.`);
    }
    sections.push('');
  }

  if (partnerIndex >= 0) {
    const partnerSource = sources[partnerIndex];
    const text = sourceText(partnerSource);
    addUsed(partnerIndex);
    const sectionNumber = (registrationIndex >= 0 ? 2 : 1) + (epIndex >= 0 ? 1 : 0);
    sections.push(`${sectionNumber}. **쇼핑몰 연동과 등록 경로 확인하기**`);
    sections.push('');
    if (/쇼핑몰.*연동|네이버\s*쇼핑에\s*등록|전환\s*추적/.test(text)) {
      sections.push(`- 쇼핑 집행에는 네이버 쇼핑에 등록된 쇼핑몰과의 연동, 쇼핑몰 전환 추적 설치가 필요한 경우가 있으므로 사전에 연동 상태를 확인해야 합니다 ${label(partnerIndex)}.`);
    }
    if (/쇼핑파트너|고객센터/.test(text)) {
      sections.push(`- 구매나 세부 운영 문의는 네이버 쇼핑파트너 고객센터 경로에서 확인하는 것이 안전합니다 ${label(partnerIndex)}.`);
    }
    sections.push('');
  }

  if (standardIndex >= 0) {
    addUsed(standardIndex);
    const sectionNumber = (registrationIndex >= 0 ? 2 : 1) + (epIndex >= 0 ? 1 : 0) + (partnerIndex >= 0 ? 1 : 0);
    sections.push(`${sectionNumber}. **광고 등록 기준도 함께 확인하기**`);
    sections.push('');
    sections.push(`- 상품 데이터가 맞더라도 업종별 인허가, 신고, 모조품, 상표권 침해 같은 등록 기준에 걸리면 광고가 제한될 수 있으므로 상품 등록 전 광고등록기준을 함께 확인해야 합니다 ${label(standardIndex)}.`);
    sections.push('');
  }

  const hasExactDbUrlEvidence = sources.some(source => (
    sourceMatchesVendor(source, 'NAVER')
    && /db\s*url|상품\s*db\s*url|상품db\s*url|ep\s*\(=\s*db\s*url\)/i.test(sourceExcerptText(source))
    && /입력|형식|필드|url|등록\s*요청|등록요청|상품정보\s*수신\s*현황|카테고리\s*자동매칭|카테고리\s*매칭/.test(sourceExcerptText(source))
  ));

  if (/db\s*url/.test(normalizedQuestion) && !hasExactDbUrlEvidence) {
    sections.push('4. **현재 근거에서 확인되지 않는 항목**');
    sections.push('');
    sections.push('- 제공된 근거에서는 DB URL의 정확한 입력 형식, 필드명, 제출 화면까지는 확인되지 않습니다. 이 부분은 쇼핑파트너센터 또는 담당자에게 추가 확인하는 것이 좋습니다.');
    sections.push('');
  }

  const evidenceLabels = Array.from(used)
    .sort((a, b) => a - b)
    .map(index => label(index));

  sections.push(`근거: ${evidenceLabels.join(', ')}`);

  return sections.join('\n');
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

function normalizeProductIntentText(message: string): string {
  return message.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasNamedSpecificProductQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  return /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고|동영상\s*광고|비디오\s*광고|youtube\s*shorts|shorts\s*광고|video\s*action\s*campaign|\bvac\b|앱\s*인스톨|앱\s*설치|앱\s*홍보|앱\s*사전\s*등록|app\s*install|app\s*promotion|리드\s*양식|잠재\s*고객\s*광고|잠재고객\s*광고|잠재고객광고|비즈니스\s*폼|비즈니스폼|lead\s*form|lead\s*generation|lead\s*ads?|db\s*url|상품\s*db|상품등록|ep|카탈로그|catalog|advantage\+|어드밴티지|performance\s*max|\bpmax\b|demand\s*gen|쇼핑검색|사이트검색|파워링크|브랜드검색|쇼핑블록|비즈보드/.test(normalized);
}

function isProductSelectionQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  return /어떻게\s*(고르|선택|구분)|기준으로\s*(설명|구분|선택)|선택\s*기준|고르는\s*기준|골라야|고르면|추천|목적별|목표별|상황별|어떤\s*(상품|유형|캠페인)|무엇을\s*(선택|고르)|뭘\s*(선택|고르)|목표\s*기준/.test(normalized);
}

function isBroadProductStructureAnswerIntent(message: string, intent: QueryIntent): boolean {
  if (!intent.topics.includes('product_structure')) return false;
  if (intent.vendors.length !== 1 || intent.isComparative) return false;
  if (intent.isSpecificProductGuidance) return false;
  if (hasNamedSpecificProductQuestion(message) && !isProductSelectionQuestion(message)) return false;

  return intent.isProductStructureOverview;
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

function getProductStructureVisibleSourceText(source: ReturnType<typeof buildVerifiedSources>[number]) {
  return [
    source.title,
    source.originalTitle,
    source.excerpt,
  ].filter(Boolean).join(' ').toLowerCase();
}

function isGraphVerifiedSource(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  return (
    source.retrievalMethod === 'graph'
    || source.evidenceType === 'graph'
    || source.corpus === 'evidence_graph'
    || metadata.retrievalMethod === 'graph'
    || metadata.evidenceType === 'graph'
    || metadata.corpus === 'evidence_graph'
  );
}

function normalizeEvidenceText(text: string) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function textContainsEvidenceTerm(text: string, term: string) {
  const normalizedText = normalizeEvidenceText(text);
  const normalizedTerm = normalizeEvidenceText(term);
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

function sourceTextHasSpecificProductDetailSignal(text: string): boolean {
  const normalizedText = normalizeEvidenceText(text);
  return /집행|절차|세팅|설정|연동|앱\s*등록|상품\s*등록|계정|권한|승인|요청|공유|테스트|검증|제작|소재|문구|카피|사양|스펙|규격|비율|사이즈|크기|파일|해상도|길이|정책|심사|검수|검토|주의|유의|제한|금지|반려|오류|에러|문제|해결|원인|조치|sdk|mmp|추적|트래킹|이벤트|픽셀|db\s*url|상품\s*db|상품db|ep|쇼핑파트너센터|상품정보\s*수신|등록요청|상품관리|카테고리|가격비교|데이터\s*피드|feed|양식\s*제출|개인정보|고지|동의/.test(normalizedText);
}

function sourceTextHasSpecificProductDetailSignalNearTerm(text: string, term: string): boolean {
  const normalizedText = normalizeEvidenceText(text);
  const normalizedTerm = normalizeEvidenceText(term);
  if (!normalizedText || !normalizedTerm || normalizedTerm.length < 2) return false;

  const detailPattern = /집행|절차|세팅|설정|연동|앱\s*등록|상품\s*등록|계정|권한|승인|요청|공유|테스트|검증|제작|소재|문구|카피|사양|스펙|규격|비율|사이즈|크기|파일|해상도|길이|정책|심사|검수|검토|주의|유의|제한|금지|반려|오류|에러|문제|해결|원인|조치|sdk|mmp|추적|트래킹|이벤트|픽셀|db\s*url|상품\s*db|상품db|ep|쇼핑파트너센터|상품정보\s*수신|등록요청|상품관리|카테고리|가격비교|데이터\s*피드|feed|양식\s*제출|개인정보|고지|동의/;
  let startIndex = 0;
  while (startIndex < normalizedText.length) {
    const index = normalizedText.indexOf(normalizedTerm, startIndex);
    if (index < 0) break;
    const windowText = normalizedText.slice(Math.max(0, index - 180), Math.min(normalizedText.length, index + normalizedTerm.length + 220));
    if (detailPattern.test(windowText)) return true;
    startIndex = index + Math.max(1, normalizedTerm.length);
  }

  const compactTerm = normalizedTerm.replace(/\s+/g, '');
  if (compactTerm.length < 2) return false;
  const compactText = normalizedText.replace(/\s+/g, '');
  const compactIndex = compactText.indexOf(compactTerm);
  if (compactIndex < 0) return false;

  // Compact matching is only a fallback for spacing variants. It still has to
  // prove that detail/procedure/policy evidence is close to the product anchor.
  const approximateIndex = Math.min(normalizedText.length - 1, compactIndex);
  const windowText = normalizedText.slice(
    Math.max(0, approximateIndex - 180),
    Math.min(normalizedText.length, approximateIndex + normalizedTerm.length + 220),
  );
  return detailPattern.test(windowText);
}

function sourceTextLooksLikeBroadProductCatalogOnly(text: string, terms: string[] = []): boolean {
  const normalizedText = normalizeEvidenceText(text);
  const hasBroadCatalogSignal = (
    /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives/.test(normalizedText)
    || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(normalizedText)
    || /광고\s*상품|광고\s*종류|상품\s*구조|광고\s*구조/.test(normalizedText)
  );
  if (!hasBroadCatalogSignal) return false;
  if (terms.length === 0) return !sourceTextHasSpecificProductDetailSignal(normalizedText);

  return !terms.some(term => sourceTextHasSpecificProductDetailSignalNearTerm(normalizedText, term));
}

function isNaverShoppingDataIntent(intent: QueryIntent) {
  if (!intent.vendors.includes('NAVER')) return false;

  const queryText = normalizeEvidenceText([
    ...intent.keywords,
    ...intent.strictProductTerms,
  ].join(' '));
  const compactQueryText = queryText.replace(/\s+/g, '');

  const hasShoppingSignal = /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑\s*광고|네이버/.test(queryText);
  const hasDataSignal = /db\s*url|상품\s*db|상품db|상품\s*등록|상품등록|ep|쇼핑파트너센터|상품정보\s*수신\s*현황|등록요청|카테고리\s*매칭|카테고리\s*자동매칭|입점\s*심사|가격비교|상품관리/.test(queryText)
    || /dburl|상품db/.test(compactQueryText);

  return hasShoppingSignal && hasDataSignal;
}

function sourceHasNaverShoppingDataEvidence(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  const text = normalizeEvidenceText([
    getSourceText(source),
    metadata.rankReason,
    metadata.evidenceDecisionReason,
    metadata.coverageRole,
    metadata.retrievalMethod,
  ].filter(Boolean).join(' '));

  return /naver_shopping_data|ep\s*\(=\s*db\s*url\)|db\s*url|dburl|상품\s*db|상품db|상품\s*db\s*url|상품db\s*url|상품정보\s*수신\s*현황|등록\s*요청|등록요청|상품관리|쇼핑파트너센터|카테고리\s*(자동)?매칭|입점\s*심사|영업일\s*기준\s*1\s*[-~]?\s*2일|cpc|cps|상품\s*등록|상품등록|데이터\s*피드|feed/.test(text);
}

function scoreNaverShoppingDataEvidence(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const text = normalizeEvidenceText(getSourceText(source));
  let score = Number(source.hybridScore || source.score || 0);

  if (/상품정보\s*수신\s*현황|등록\s*요청|등록요청|상품관리/.test(text)) score += 14;
  if (/ep\s*\(=\s*db\s*url\)|상품\s*db\s*url|상품db\s*url|db\s*url|dburl/.test(text)) score += 12;
  if (/카테고리\s*자동매칭|카테고리\s*매칭|입점\s*심사|영업일\s*기준\s*1\s*[-~]?\s*2일/.test(text)) score += 11;
  if (/쇼핑파트너센터|상품\s*등록|상품등록|cpc|cps|가격비교/.test(text)) score += 7;
  if (/상품\s*가격|가격대|배송비|쿠폰|할인|대표이미지|색상\s*필터|혜택\s*필터/.test(text)) score += 2;
  if (/쇼핑블록|주요\s*쇼핑\s*지면|사이트검색광고|디지털\s*옥외광고/.test(text) && !sourceHasNaverShoppingDataEvidence(source)) score -= 6;

  return score;
}

function buildStrictProductEvidenceTerms(intent: QueryIntent) {
  const queryText = normalizeEvidenceText([
    ...intent.keywords,
    ...intent.strictProductTerms,
  ].join(' '));
  const compactQueryText = queryText.replace(/\s+/g, '');
  const usesNaverShoppingDataIntent = isNaverShoppingDataIntent(intent);
  const terms: string[] = [
    ...intent.strictProductTerms,
  ];
  const add = (...items: string[]) => terms.push(...items);

  if (/(^|[\s/])da($|[\s/]|도|상품|광고)|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(queryText)) {
    add('DA', 'DA 상품', 'DA상품', '네이버DA', '네이버 DA', '네이버DA상품', '보장형 DA', '스마트채널', '타임보드', '롤링보드', '디스플레이 광고', '디스플레이광고', '성과형 디스플레이', '성과형디스플레이', '홈피드DA', '홈피드', '배너 광고', '배너광고', '디스플레이 캠페인', '반응형 디스플레이');
  }

  if (/동영상\s*광고|비디오\s*광고|video\s*ads|youtube\s*shorts|shorts\s*광고|video\s*action\s*campaign|\bvac\b/.test(queryText)) {
    add('동영상 광고', '동영상광고', '비디오 광고', '비디오광고', '동영상 조회', '동영상 소재', 'Video Ads', 'YouTube', '유튜브', 'YouTube Shorts', 'Shorts', 'Shorts 광고', 'Video action campaign', 'VAC');
  }

  if (/앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록)|app\s*(install|promotion)|mmp|sdk|사전\s*등록/.test(queryText)) {
    add('앱 인스톨', '앱인스톨', '앱 설치', '앱설치', '앱 홍보', '앱홍보', '앱 캠페인', '앱 이벤트', 'App Install', 'App Promotion', 'MMP', 'SDK', '사전 등록', '앱 사전등록', '앱 등록');
  }

  if (/db\s*url|상품\s*db|상품등록|ep|쇼핑파트너센터|가격비교/.test(queryText) || /상품db|dburl/.test(compactQueryText)) {
    add(
      'DB URL', 'DBURL', '상품 DB', '상품DB', '상품 DB URL', '상품DB URL',
      'EP', 'EP(=DB URL)', '상품등록', '상품 등록', '쇼핑파트너센터', '가격비교',
      '상품정보 수신 현황', '등록요청', '등록 요청', '상품관리',
      '카테고리 자동매칭', '카테고리 매칭', '입점 심사', '영업일 기준 1~2일',
      'CPC', 'CPS',
    );
  }

  if (/리드\s*양식|lead\s*form|lead\s*generation|lead\s*ads?|잠재\s*고객|잠재고객\s*광고|비즈니스\s*폼|비즈니스폼|양식\s*제출/.test(queryText)) {
    add('리드 양식', '리드양식', 'lead form', 'Lead Form', 'Lead Ads', 'Lead Generation', '잠재 고객', '잠재고객', '잠재고객 광고', '비즈니스 폼', '비즈니스폼', '양식 제출');
  }

  if (/카탈로그|catalog|advantage\+|어드밴티지|컬렉션|performance\s*max|\bpmax\b|demand\s*gen/.test(queryText)) {
    add('카탈로그', 'catalog', 'Advantage+', '어드밴티지', '컬렉션', 'collection', 'Performance Max', 'PMax', 'Demand Gen');
  }

  if (!usesNaverShoppingDataIntent && /쇼핑검색|사이트검색|파워링크|브랜드검색|쇼핑블록|비즈보드|상품가이드|상품\s*가이드/.test(queryText)) {
    add('쇼핑검색', '쇼핑검색광고', '사이트검색광고', '파워링크', '브랜드검색', '쇼핑블록', '비즈보드', '상품가이드', '상품 가이드');
  }

  return Array.from(new Set(terms.map(term => term.trim()).filter(term => term.length >= 2)));
}

function buildPrimarySpecificProductEvidenceTerms(intent: QueryIntent) {
  const queryText = normalizeEvidenceText([
    ...intent.keywords,
    ...intent.strictProductTerms,
  ].join(' '));
  const compactQueryText = queryText.replace(/\s+/g, '');
  const terms: string[] = [...intent.strictProductTerms];
  const add = (...items: string[]) => terms.push(...items);

    if (/(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(queryText)) {
      add('DA', 'DA 상품', 'DA상품', '네이버 DA', '네이버DA', '네이버DA상품', '보장형 DA', '스마트채널', '타임보드', '롤링보드', '디스플레이 광고', '디스플레이광고', '성과형 디스플레이', '성과형디스플레이', '홈피드DA', '홈피드 DA', '홈피드', '배너 광고', '배너광고', '디스플레이 캠페인', '반응형 디스플레이');
    }

    if (/동영상\s*광고|비디오\s*광고|video\s*ads|youtube\s*shorts|shorts\s*광고|video\s*action\s*campaign|\bvac\b/.test(queryText)) {
      add('동영상 광고', '동영상광고', '비디오 광고', '비디오광고', '동영상 조회', '동영상 소재', 'Video Ads', 'YouTube', '유튜브', 'YouTube Shorts', 'Shorts', 'Shorts 광고', 'Video action campaign', 'VAC');
    }

  if (/앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록)|app\s*(install|promotion)|mmp|sdk|사전\s*등록/.test(queryText)) {
    add('앱 인스톨', '앱인스톨', '앱 설치', '앱설치', '앱 홍보', '앱홍보', '앱 캠페인', 'App Install', 'App Promotion', 'MMP', 'SDK', '사전 등록', '앱 등록');
  }

  if (/리드\s*양식|lead\s*form|lead\s*generation|lead\s*ads?|잠재\s*고객|잠재고객\s*광고|비즈니스\s*폼|비즈니스폼|양식\s*제출/.test(queryText)) {
    add('리드 양식', '리드양식', 'Lead Form', 'Lead Ads', 'Lead Generation', '잠재 고객', '잠재고객', '비즈니스 폼', '비즈니스폼', '양식 제출');
  }

  if (/db\s*url|상품\s*db|상품등록|ep|쇼핑파트너센터|가격비교/.test(queryText) || /상품db|dburl/.test(compactQueryText)) {
    add('DB URL', 'DBURL', '상품 DB', '상품DB', '상품 DB URL', '상품DB URL', 'EP', 'EP(=DB URL)', '상품등록', '상품 등록', '쇼핑파트너센터', '상품정보 수신 현황', '등록요청', '상품관리');
  }

  if (/비즈보드/.test(queryText)) {
    add('비즈보드', '카카오 비즈보드', 'Kakao Bizboard');
  }

  if (/카탈로그|catalog|advantage\+|어드밴티지|컬렉션|performance\s*max|\bpmax\b|demand\s*gen/.test(queryText)) {
    add('카탈로그', 'Catalog', 'Advantage+', '어드밴티지', '컬렉션', 'Collection', 'Performance Max', 'PMax', 'Demand Gen');
  }

  if (/쇼핑검색/.test(queryText)) add('쇼핑검색', '쇼핑검색광고');
  if (/사이트검색/.test(queryText)) add('사이트검색', '사이트검색광고');
  if (/쇼핑블록/.test(queryText)) add('쇼핑블록', '쇼핑 지면');

  return Array.from(new Set(terms.map(term => term.trim()).filter(term => term.length >= 2)));
}

function sourceMatchesStrictProductIntent(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent
) {
  const text = `${source.title || ''} ${source.originalTitle || ''} ${source.excerpt || ''} ${source.matchText || ''}`;
  const primaryTerms = buildPrimarySpecificProductEvidenceTerms(intent);
  const primaryMatches = primaryTerms.filter(term => textContainsEvidenceTerm(text, term));
  if (primaryTerms.length > 0 && primaryMatches.length === 0) return false;

  const matchedTerms = (
    primaryMatches.length > 0
      ? primaryMatches
      : buildStrictProductEvidenceTerms(intent).filter(term => textContainsEvidenceTerm(text, term))
  );
  if (matchedTerms.length === 0) return false;
  return !sourceTextLooksLikeBroadProductCatalogOnly(text, matchedTerms);
}

function sourceIsBroadProductStructureOnly(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent
) {
  if (!intent.isSpecificProductGuidance) return false;

  const text = normalizeEvidenceText(`${source.title || ''} ${source.originalTitle || ''} ${source.excerpt || ''} ${source.matchText || ''}`);
  if (sourceMatchesStrictProductIntent(source, intent)) return false;
  return (
    /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives/.test(text)
    || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text)
    || /광고\s*상품|광고\s*종류|상품\s*구조|광고\s*구조/.test(text)
  );
}

type SpecificProductAnswerMode =
  | 'product_detail'
  | 'execution_guide'
  | 'setup_procedure'
  | 'creative_guide'
  | 'policy_screening'
  | 'db_setup'
  | 'operational_issue';

function inferSpecificProductAnswerMode(message: string): SpecificProductAnswerMode {
  const normalized = normalizeEvidenceText(message);
  const compact = normalized.replace(/\s+/g, '');
  const hasCreativeExplicitSignal = (
    /제작|소재|문구|카피|사양|스펙|규격|비율|사이즈|크기|파일|이미지|배너|썸네일|텍스트|해상도|길이|자막|cta/.test(normalized)
    || (/동영상/.test(normalized) && /제작|소재|사양|스펙|규격|비율|사이즈|길이|해상도|파일|썸네일|자막|초/.test(normalized))
  );

  if (/오류|에러|문제|해결|원인|조치|반려|실패|tracking_specs|불일치|미승인|승인\s*거절/.test(normalized)) {
    return 'operational_issue';
  }

  if (/db\s*url|상품\s*db|상품db|상품\s*등록|상품등록|ep|쇼핑파트너센터|가격비교|데이터\s*피드|feed/.test(normalized) || /dburl/.test(compact)) {
    return 'db_setup';
  }

  if (/정책|심사|검수|검토|주의|유의|제한|금지|가능\s*여부|승인|등록\s*기준|광고\s*등록\s*기준|확인해야|꼭\s*확인/.test(normalized)) {
    return 'policy_screening';
  }

  const hasSetupSignal = /집행|가이드|절차|방법|세팅|설정|연동|sdk|mmp|추적|트래킹|이벤트|앱\s*등록|캠페인\s*설정|계정|권한|픽셀|카탈로그\s*연동|카탈로그\s*설정/.test(normalized);

  if (hasSetupSignal && hasCreativeExplicitSignal) {
    return 'execution_guide';
  }

  if (hasSetupSignal && !hasCreativeExplicitSignal) {
    return 'setup_procedure';
  }

  if (hasCreativeExplicitSignal) {
    return 'creative_guide';
  }

  if (hasSetupSignal) {
    return 'setup_procedure';
  }

  return 'product_detail';
}

function getSpecificProductModeLabel(mode: SpecificProductAnswerMode) {
  switch (mode) {
    case 'execution_guide':
      return '집행 절차와 소재 조건';
    case 'setup_procedure':
      return '집행 절차와 설정 방법';
    case 'creative_guide':
      return '소재 제작 조건';
    case 'policy_screening':
      return '정책·심사 기준';
    case 'db_setup':
      return '상품 등록·DB URL 조건';
    case 'operational_issue':
      return '실무 이슈 원인과 조치';
    default:
      return '상품 상세';
  }
}

function buildRequestedProductModeTerms(mode: SpecificProductAnswerMode) {
  switch (mode) {
    case 'execution_guide':
      return [
        '집행', '절차', '세팅', '설정', '연동', 'SDK', 'MMP',
        '추적', '트래킹', '이벤트', '앱 등록', '캠페인 설정', '광고 관리자', 'Ads Manager',
        '계정', '권한', 'App ID', 'App Secret', '픽셀', '카탈로그 연동', '카탈로그 설정',
        '제작', '소재', '문구', '카피', '사양', '스펙', '규격', '비율', '사이즈',
        '크기', '파일', '이미지', '동영상', '배너', '썸네일', '텍스트',
      ];
    case 'setup_procedure':
      return [
        '집행', '절차', '세팅', '설정', '연동', 'SDK', 'MMP',
        '추적', '트래킹', '이벤트', '앱 등록', '캠페인 설정', '광고 관리자', 'Ads Manager',
        '계정', '권한', 'App ID', 'App Secret', '픽셀', '카탈로그 연동', '카탈로그 설정',
      ];
    case 'creative_guide':
      return [
        '제작', '소재', '문구', '카피', '사양', '스펙', '규격', '비율', '사이즈',
        '크기', '파일', '이미지', '동영상', '배너', '썸네일', '텍스트',
      ];
    case 'policy_screening':
      return [
        '정책', '심사', '검수', '검토', '주의', '유의', '제한', '금지', '승인',
        '등록 기준', '광고 등록 기준', '반려', '가능 여부',
      ];
    case 'db_setup':
      return [
        'DB URL', 'DBURL', '상품 DB', '상품DB', 'EP', '상품 등록', '상품등록',
        'EP(=DB URL)', '상품 DB URL', '상품DB URL', '상품정보 수신 현황', '등록요청',
        '등록 요청', '상품관리', '쇼핑파트너센터', '스마트스토어센터', 'CPC', 'CPS',
        '가격비교', '입점 심사', '영업일 기준', '1~2일', '데이터 피드', 'feed',
        '카테고리', '카테고리 매칭', '카테고리 자동매칭', '상품 정보',
      ];
    case 'operational_issue':
      return [
        '오류', '에러', '문제', '해결', '원인', '조치', '반려', '실패',
        'tracking_specs', '불일치', '미승인', '승인 거절',
      ];
    default:
      return [];
  }
}

function sourceMatchesRequestedProductMode(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent,
  mode: SpecificProductAnswerMode,
) {
  if (!sourceMatchesStrictProductIntent(source, intent)) return false;

  if (mode === 'db_setup' && isNaverShoppingDataIntent(intent) && sourceHasNaverShoppingDataEvidence(source)) {
    return true;
  }

  const text = `${source.title || ''} ${source.originalTitle || ''} ${source.excerpt || ''} ${source.matchText || ''}`;
  const primaryTerms = buildPrimarySpecificProductEvidenceTerms(intent);
  if (mode === 'product_detail') {
    if (primaryTerms.length === 0) return true;
    return primaryTerms.some(term => sourceTextHasSpecificProductDetailSignalNearTerm(text, term))
      || /상품\s*가이드|상품가이드|제작\s*가이드|제작가이드|운영\s*가이드|운영가이드|광고\s*상품|광고상품|상품\s*소개|상품소개|지면|노출|형식|사양/.test(normalizeEvidenceText(text));
  }

  const modeTerms = buildRequestedProductModeTerms(mode);
  const hasModeTerm = modeTerms.some(term => textContainsEvidenceTerm(text, term));
  if (!hasModeTerm) return false;
  if (primaryTerms.length === 0) return true;

  return primaryTerms.some(term => sourceTextHasSpecificProductDetailSignalNearTerm(text, term));
}

function getSourceIdentityText(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  return [
    source.title,
    source.originalTitle,
    source.url,
    source.documentId,
    sourceLike.documentUrl,
    metadata.url,
    metadata.source_url,
    metadata.document_url,
    metadata.canonical_url,
    metadata.title,
    metadata.document_title,
    metadata.source,
  ].filter(Boolean).join(' ').toLowerCase();
}

function sourceHasStrongVendorIdentity(
  source: ReturnType<typeof buildVerifiedSources>[number],
  vendors: VendorIntent[],
) {
  if (vendors.length === 0) return true;
  const identityText = getSourceIdentityText(source);
  const sourceVendors = source.sourceVendors || [];

  return vendors.some((vendor) => {
    if (source.sourceVendor === vendor || sourceVendors.includes(vendor)) return true;
    if (explicitGraphSourceMatchesVendor(source, vendor)) return true;

    switch (vendor) {
      case 'META':
        return /meta|facebook|instagram|페이스북|인스타그램/.test(identityText);
      case 'NAVER':
        return /naver|searchad|네이버/.test(identityText);
      case 'GOOGLE':
        return /google|youtube|구글|유튜브/.test(identityText);
      case 'KAKAO':
        return /kakao|카카오/.test(identityText);
      default:
        return false;
    }
  });
}

function sourceHasCrossVendorUrl(
  source: ReturnType<typeof buildVerifiedSources>[number],
  vendors: VendorIntent[],
) {
  if (vendors.length !== 1) return false;

  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  const urlText = [
    source.url,
    sourceLike.documentUrl,
    metadata.url,
    metadata.source_url,
    metadata.document_url,
    metadata.canonical_url,
  ].filter(Boolean).join(' ').toLowerCase();

  if (!urlText) return false;

  const [vendor] = vendors;
  if (vendor !== 'KAKAO' && /kakaobusiness|kakao\.com|kakao\.io|gitbook\.io\/main\/ad/.test(urlText)) return true;
  if (vendor !== 'NAVER' && /naver\.com|searchad\.naver|naverbusiness/.test(urlText)) return true;
  if (vendor !== 'META' && /facebook\.com|meta\.com|instagram\.com/.test(urlText)) return true;
  if (vendor !== 'GOOGLE' && /google\.com|support\.google|youtube\.com/.test(urlText)) return true;

  return false;
}

function sourceHasExtractionNoise(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  const text = [
    source.title,
    source.originalTitle,
    source.excerpt,
    source.matchText,
    metadata.raw,
    metadata.content,
  ].filter(Boolean).join(' ');

  const noiseHit = /thumbnailTitle|thumbnailImagePath|displayOrder|insightSequence|sourceType|brandName|readTime|bookmarked|__next_f|webpack|hydration|\\u003cbr|&quot;|&#x27;/.test(text);
  const jsonShapeCount = (text.match(/[{}"]/g) || []).length;

  return noiseHit && jsonShapeCount >= 4;
}

function isLowValueSpecificProductSource(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent,
  mode: SpecificProductAnswerMode,
) {
  const text = normalizeEvidenceText([
    source.title,
    source.originalTitle,
    source.excerpt,
    source.matchText,
  ].filter(Boolean).join(' '));

  if (sourceHasExtractionNoise(source)) return true;
  if (sourceHasCrossVendorUrl(source, intent.vendors)) return true;
  if (sourceIsBroadProductStructureOnly(source, intent)) return true;

  if (
    intent.vendors.length > 0
    && !sourceHasStrongVendorIdentity(source, intent.vendors)
    && !sourceMatchesStrictProductIntent(source, intent)
  ) {
    return true;
  }

  if (/공지사항|성공전략|성공사례|광고운영팁/.test(text)
    && !/db\s*url|상품\s*db|상품db|ep|ep\s*\(=\s*db\s*url\)|쇼핑파트너센터|상품정보\s*수신\s*현황|등록요청|상품관리|카테고리\s*자동매칭|가격비교|상품\s*등록|상품등록|tracking_specs|오류|에러|불일치|반려/.test(text)
  ) {
    return true;
  }

  if (mode === 'db_setup' && !/db\s*url|상품\s*db|상품db|ep|ep\s*\(=\s*db\s*url\)|상품정보\s*수신\s*현황|등록요청|상품관리|쇼핑파트너센터|가격비교|상품\s*등록|상품등록|입점\s*심사|카테고리\s*(자동)?매칭|데이터\s*피드|feed|상품\s*정보/.test(text)) {
    return true;
  }

  return false;
}

function scoreSpecificProductAnswerSource(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent,
  mode: SpecificProductAnswerMode,
  originalIndex: number,
) {
  const text = `${source.title || ''} ${source.originalTitle || ''} ${source.excerpt || ''} ${source.matchText || ''}`;
  const normalizedText = normalizeEvidenceText(text);
  const primaryTerms = buildPrimarySpecificProductEvidenceTerms(intent);
  let score = Number(source.hybridScore || source.score || source.similarity || 0) + (100 - originalIndex);

  if (source.sourceVendor && intent.vendors.includes(source.sourceVendor as VendorIntent)) score += 35;
  if (source.evidenceDecision === 'verified') score += 12;
  if (source.retrievalMethod === 'vector' || source.retrievalMethod === 'hybrid') score += 8;
  if (source.retrievalMethod === 'keyword') score += 4;
  if (isGraphVerifiedSource(source)) score += 10;

  const titleText = normalizeEvidenceText(`${source.title || ''} ${source.originalTitle || ''}`);
  const primaryHitCount = primaryTerms.filter(term => textContainsEvidenceTerm(text, term)).length;
  const primaryTitleHitCount = primaryTerms.filter(term => textContainsEvidenceTerm(titleText, term)).length;
  score += primaryHitCount * 8;
  score += primaryTitleHitCount * 18;

  const nearDetailHitCount = primaryTerms.filter(term => sourceTextHasSpecificProductDetailSignalNearTerm(text, term)).length;
  score += nearDetailHitCount * 22;

  if (mode !== 'product_detail') {
    if (sourceMatchesRequestedProductMode(source, intent, mode)) {
      score += 32;
    } else {
      score -= 35;
    }
  } else if (sourceMatchesRequestedProductMode(source, intent, mode)) {
    score += 18;
  }

  if (/상품\s*가이드|상품가이드|제작\s*가이드|제작가이드|운영\s*가이드|운영가이드|광고\s*상품|광고상품|상품\s*소개|상품소개/.test(normalizedText)) {
    score += 10;
  }

  if (sourceTextLooksLikeBroadProductCatalogOnly(text, primaryTerms)) score -= 80;
  if (/캠페인 목표|광고 관리자 목표|마케팅 목표|objective|인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(normalizedText)) {
    score -= mode === 'product_detail' ? 18 : 45;
  }

  return score;
}

function dedupeSpecificProductSources(sources: ReturnType<typeof buildVerifiedSources>) {
  const seen = new Set<string>();
  const deduped: ReturnType<typeof buildVerifiedSources> = [];

  sources.forEach((source) => {
    const titleKey = normalizeEvidenceText(String(source.title || source.originalTitle || ''));
    const excerptKey = normalizeEvidenceText(String(source.excerpt || source.matchText || '')).slice(0, 220);
    const key = `${source.documentId || ''}:${titleKey}:${excerptKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(source);
  });

  return deduped;
}

function refineSpecificProductAnswerSources(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  mode: SpecificProductAnswerMode,
) {
  const refined = dedupeSpecificProductSources(
    sources.filter(source => !isLowValueSpecificProductSource(source, intent, mode))
  );

  if (mode === 'db_setup' && isNaverShoppingDataIntent(intent)) {
    return refined.sort((a, b) => scoreNaverShoppingDataEvidence(b) - scoreNaverShoppingDataEvidence(a));
  }

  return refined
    .map((source, index) => ({
      source,
      index,
      score: scoreSpecificProductAnswerSource(source, intent, mode, index),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ source }) => source);
}

type SpecificProductEvidenceRole =
  | 'mode_detail'
  | 'official_graph'
  | 'product_context'
  | 'db_detail';

function withSpecificProductEvidenceRole(
  source: ReturnType<typeof buildVerifiedSources>[number],
  role: SpecificProductEvidenceRole,
): ReturnType<typeof buildVerifiedSources>[number] {
  return {
    ...source,
    metadata: {
      ...source.metadata,
      answerEvidenceRole: role,
      answer_evidence_role: role,
    },
  };
}

function pushUniqueSpecificProductSource(
  target: ReturnType<typeof buildVerifiedSources>,
  seen: Set<string>,
  source: ReturnType<typeof buildVerifiedSources>[number],
  role: SpecificProductEvidenceRole,
) {
  const key = [
    source.id,
    source.chunkId,
    source.documentId,
    normalizeEvidenceText(String(source.title || source.originalTitle || '')),
    normalizeEvidenceText(String(source.excerpt || source.matchText || '')).slice(0, 180),
  ].filter(Boolean).join(':');
  if (seen.has(key)) return;
  seen.add(key);
  target.push(withSpecificProductEvidenceRole(source, role));
}

function selectSpecificProductAnswerSources(
  strictProductSources: ReturnType<typeof buildVerifiedSources>,
  modeMatchedSources: ReturnType<typeof buildVerifiedSources>,
  rankedAnswerSources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  mode: SpecificProductAnswerMode,
) {
  if (mode === 'db_setup' && isNaverShoppingDataIntent(intent)) {
    return rankedAnswerSources.map(source => (
      sourceHasNaverShoppingDataEvidence(source)
        ? withSpecificProductEvidenceRole(source, 'db_detail')
        : withSpecificProductEvidenceRole(source, 'product_context')
    ));
  }

  const selected: ReturnType<typeof buildVerifiedSources> = [];
  const seen = new Set<string>();
  const modeSources = mode === 'product_detail'
    ? strictProductSources.filter(source => sourceMatchesRequestedProductMode(source, intent, mode))
    : modeMatchedSources;
  const modeDetailSources = modeSources.filter(source => !isGraphVerifiedSource(source));
  const officialGraphSources = strictProductSources.filter(source => (
    isOfficialGuideGraphSource(source)
    && sourceMatchesStrictProductIntent(source, intent)
  ));
  const productContextSources = rankedAnswerSources.filter(source => (
    !isGraphVerifiedSource(source)
    && !sourceIsBroadProductStructureOnly(source, intent)
  ));
  const productContextLimit = modeDetailSources.length > 0 || modeSources.length > 0 ? 1 : 3;

  modeDetailSources.slice(0, 3).forEach(source => {
    pushUniqueSpecificProductSource(selected, seen, source, 'mode_detail');
  });

  officialGraphSources.slice(0, 1).forEach(source => {
    pushUniqueSpecificProductSource(selected, seen, source, 'official_graph');
  });

  modeSources.slice(0, 2).forEach(source => {
    pushUniqueSpecificProductSource(
      selected,
      seen,
      source,
      isGraphVerifiedSource(source) ? 'official_graph' : 'mode_detail',
    );
  });

  productContextSources.slice(0, productContextLimit).forEach(source => {
    pushUniqueSpecificProductSource(selected, seen, source, 'product_context');
  });

  rankedAnswerSources
    .filter(source => !sourceIsBroadProductStructureOnly(source, intent))
    .slice(0, 6)
    .forEach(source => {
      pushUniqueSpecificProductSource(
        selected,
        seen,
        source,
        isGraphVerifiedSource(source) ? 'official_graph' : 'product_context',
      );
    });

  return selected.slice(0, 6);
}

function getSpecificProductLabel(intent: QueryIntent) {
  const strictTerms = intent.strictProductTerms.length > 0
    ? intent.strictProductTerms
    : intent.keywords.filter(keyword => keyword.length >= 2);
  return Array.from(new Set(strictTerms)).slice(0, 4).join(', ') || '요청한 광고 상품';
}

function buildSpecificProductAnswerScope(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  message: string,
) {
  const isSpecificProductScope = (
    intent.topics.includes('product_structure')
    && intent.isSpecificProductGuidance
  );

  if (!isSpecificProductScope) {
    return {
      mode: inferSpecificProductAnswerMode(message),
      strictProductSources: sources,
      answerSources: sources,
      shouldLimit: false,
    };
  }

  const mode = inferSpecificProductAnswerMode(message);
  const naverShoppingDataSources = mode === 'db_setup' && isNaverShoppingDataIntent(intent)
    ? sources.filter(source => sourceMatchesVendor(source, 'NAVER') && sourceHasNaverShoppingDataEvidence(source))
    : [];
  const strictProductSources = refineSpecificProductAnswerSources(
    [
      ...naverShoppingDataSources,
      ...sources.filter(source => sourceMatchesStrictProductIntent(source, intent)),
    ],
    intent,
    mode,
  );
  const modeMatchedSources = mode === 'product_detail'
    ? strictProductSources
    : strictProductSources.filter(source => sourceMatchesRequestedProductMode(source, intent, mode));
  const rawAnswerSources = mode === 'product_detail'
    ? strictProductSources
    : modeMatchedSources;
  const rankedAnswerSources = refineSpecificProductAnswerSources(
    mode === 'db_setup' && naverShoppingDataSources.length > 0
      ? [...naverShoppingDataSources, ...rawAnswerSources]
      : rawAnswerSources,
    intent,
    mode,
  );
  const answerSources = selectSpecificProductAnswerSources(
    strictProductSources,
    modeMatchedSources,
    rankedAnswerSources,
    intent,
    mode,
  );

  return {
    mode,
    strictProductSources,
    answerSources,
    shouldLimit: strictProductSources.length === 0 || (mode !== 'product_detail' && answerSources.length === 0),
  };
}

function buildSpecificProductScopeLimitedAnswer(
  message: string,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
) {
  const vendorLabel = intent.vendors.map(vendor => VENDOR_LABELS[vendor] || vendor).join(', ') || '해당 매체';
  const productLabel = getSpecificProductLabel(intent);
  const modeLabel = getSpecificProductModeLabel(scope.mode);
  const lines: string[] = [];

  if (scope.strictProductSources.length === 0) {
    lines.push(`${vendorLabel} ${productLabel}에 대해 질문하셨지만, 현재 검증 출처에서는 이 상품명을 직접 확인할 수 있는 공식 근거가 부족합니다.`);
    lines.push('');
    lines.push('다른 광고 상품이나 지면 기준과 섞어 답하면 잘못된 운영 판단으로 이어질 수 있어, 현재는 답변을 제한합니다.');
  } else {
    lines.push(`${vendorLabel} ${productLabel} 관련 근거는 일부 확인되지만, 질문하신 ${modeLabel}까지 직접 설명하는 근거는 부족합니다.`);
    lines.push('');
    lines.push('**확인된 범위**');
    scope.strictProductSources.slice(0, 3).forEach((source, index) => {
      lines.push(`- ${compactEvidenceExcerpt(source.excerpt, source.title)} [S${index + 1}]`);
    });
    lines.push('');
    lines.push('**현재 답변을 제한하는 범위**');
    lines.push(`- ${modeLabel}은 현재 선별된 출처 안에서 직접 확인되지 않습니다.`);
    lines.push('- 계정 설정, 실제 집행 가능 여부, 세부 절차는 원문 또는 담당자 확인이 필요합니다.');
  }

  lines.push('');
  lines.push('필요하면 상품명, 지면, 계정/캠페인 설정 화면, 확인하려는 절차를 더 구체적으로 넣어 다시 대조해 주세요.');

  return lines.join('\n');
}

function isOfficialGuideGraphSource(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  return (
    isGraphVerifiedSource(source)
    && (
      metadata.sourceKind === 'official_doc'
      || metadata.source_kind === 'official_doc'
    )
  );
}

function isWeakProductStructureDisplaySource(source: ReturnType<typeof buildVerifiedSources>[number]) {
  if (isGraphVerifiedSource(source)) return false;

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

function hasProductStructureGraphSourceSignal(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const text = getProductStructureVisibleSourceText(source);
  return /캠페인\s*(목표|유형)|광고\s*(형식|포맷|소재)|노출\s*(위치|지면)|게재\s*위치|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|비즈보드|상품\s*db|db\s*url|쇼핑검색|쇼핑블록|상품가이드|상품\s*가이드|캠페인\s*목적|광고\s*관리자\s*목표|campaign|objective|ad\s*format|placement|catalog|app\s*(install|promotion)/.test(text);
}

function isLowValueProductStructureGraphSource(source: ReturnType<typeof buildVerifiedSources>[number]) {
  if (!isGraphVerifiedSource(source)) return false;
  const text = getProductStructureVisibleSourceText(source);
  if (/데이터\s*분류|개인정보\s*보호/.test(text)) return true;
  if (/오프라인\s*전환|향상된\s*전환|전환\s*(api|최적화|측정|추적|가져오기)|conversion\s*api|conversions?\s*api|enhanced\s*conversions|offline\s*conversion|capi/.test(text)) return true;
  if (/라이브\s*관리|라이브커머스|쇼핑\s*라이브|shopping\s*live/.test(text)) return true;
  if (/가입하기|회원\s*가입|계정\s*(생성|만들기)|비즈니스\s*계정/.test(text)) return true;
  return /세금|청구|결제|woocommerce|google\s*태그|태그\s*설정|gtag|측정\s*태그/.test(text)
    && !hasProductStructureGraphSourceSignal(source);
}

function scoreProductStructureGraphSource(source: ReturnType<typeof buildVerifiedSources>[number], targetVendor?: VendorIntent) {
  const text = getProductStructureVisibleSourceText(source);
  let score = Number(source.hybridScore || source.score || 0);
  if (isOfficialGuideGraphSource(source)) score += 0.65;
  if (sourceMatchesVendor(source, targetVendor)) score += 0.3;
  if (hasProductStructureGraphSourceSignal(source)) score += 1.05;
  if (/캠페인\s*(목표|유형)|광고\s*(형식|포맷|소재)|노출\s*(위치|지면)|게재\s*위치|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|비즈보드|상품\s*db|db\s*url|상품가이드|상품\s*가이드|campaign|objective|ad\s*format|placement/.test(text)) {
    score += 0.45;
  }
  if (isLowValueProductStructureGraphSource(source)) score -= 1.4;
  return score;
}

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
  if (explicitGraphSourceMatchesVendor(source, vendor)) return true;
  if (hasExplicitOtherVendorSignal(source, vendor)) return false;
  if (source.sourceVendor === vendor || Boolean(source.sourceVendors?.includes(vendor))) return true;

  const text = getSourceText(source);
  const vendorTerms: Record<VendorIntent, RegExp> = {
    META: /meta|facebook|페이스북|instagram|인스타그램|릴스|reels|advantage\+|어드밴티지|메타\s*픽셀/,
    KAKAO: /kakao|카카오|카카오톡|톡채널|비즈보드|모먼트|상품\s*가이드|상품가이드/,
    NAVER: /naver|네이버|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|쇼핑파트너센터|상품\s*db|db\s*url|가격비교|사이트검색광고|네이버\s*da|네이버da|홈피드\s*da|홈피드|스마트채널|타임보드|롤링보드|성과형\s*디스플레이|디지털\s*옥외광고/,
    GOOGLE: /google|구글|youtube|유튜브|gdn|google ads|구글\s*애즈|구글\s*광고/,
  };

  return vendorTerms[vendor].test(text);
}

function explicitGraphSourceMatchesVendor(source: ReturnType<typeof buildVerifiedSources>[number], vendor: VendorIntent) {
  if (!isGraphVerifiedSource(source)) return false;
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  const metadataVendors = [
    ...(Array.isArray(metadata.sourceVendors) ? metadata.sourceVendors : []),
    ...(Array.isArray(metadata.source_vendors) ? metadata.source_vendors : []),
  ];
  const explicitVendors = Array.from(new Set([
    sourceLike.sourceVendor,
    ...(Array.isArray(sourceLike.sourceVendors) ? sourceLike.sourceVendors : []),
    metadata.sourceVendor,
    metadata.source_vendor,
    ...metadataVendors,
  ].filter(Boolean)));

  return explicitVendors.includes(vendor);
}

function hasExplicitOtherVendorSignal(source: ReturnType<typeof buildVerifiedSources>[number], targetVendor: VendorIntent) {
  const sourceLike = source as any;
  const primaryIdentityText = `${sourceLike.originalTitle || ''} ${sourceLike.documentTitle || ''} ${sourceLike.documentUrl || ''} ${sourceLike.url || ''} ${sourceLike.documentId || ''}`.toLowerCase();
  const text = primaryIdentityText.trim() || getSourceText(source);
  const vendorTerms: Record<VendorIntent, RegExp> = {
    META: /meta|facebook|페이스북|instagram|인스타그램|릴스|reels/,
    KAKAO: /kakao|카카오|카카오톡|톡채널|비즈보드|모먼트/,
    NAVER: /naver|네이버|검색광고|쇼핑검색|파워링크|브랜드검색/,
    GOOGLE: /google|구글|youtube|유튜브|gdn|google ads|구글\s*애즈|구글\s*광고/,
  };
  const hasTarget = vendorTerms[targetVendor].test(text);
  const hasOther = (Object.keys(vendorTerms) as VendorIntent[])
    .filter(vendor => vendor !== targetVendor)
    .some(vendor => vendorTerms[vendor].test(text));

  return hasOther && !hasTarget;
}

function buildBroadProductStructureQueryTerms(intent?: QueryIntent) {
  const terms = new Set<string>();
  const add = (...items: Array<string | undefined>) => {
    for (const item of items) {
      const term = item?.trim();
      if (term && term.length >= 2) terms.add(term);
    }
  };

  add(...(intent?.keywords || []), ...(intent?.strictProductTerms || []));

  for (const vendor of intent?.vendors || []) {
    switch (vendor) {
      case 'META':
        add('Meta', 'Facebook', 'Instagram', '캠페인 목표', '광고 형식', '노출 위치', 'Advantage+', '카탈로그', '앱 홍보', '리드 양식');
        break;
      case 'GOOGLE':
        add('Google Ads', '검색 캠페인', '디스플레이 캠페인', '쇼핑 광고', '앱 캠페인', '리드 양식', '확장 소재');
        break;
      case 'NAVER':
        add('네이버', '사이트검색광고', '쇼핑검색광고', '쇼핑블록', '브랜드검색', '파워링크', '상품 DB', 'DB URL');
        break;
      case 'KAKAO':
        add('카카오', '비즈보드', '디스플레이 광고', '카카오모먼트', '상품가이드', '제작 가이드', '심사 가이드');
        break;
      default:
        break;
    }
  }

  add(
    '광고 상품', '광고 종류', '광고 유형', '상품 구조', '캠페인 유형',
    '캠페인 목표', '광고 형식', '노출 지면', '노출 위치', '운영 조건',
  );

  return Array.from(terms);
}

function hasBroadProductStructureAnswerSignal(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const text = getSourceText(source);
  return /캠페인\s*(목표|유형)|광고\s*(상품|종류|유형|형식|포맷)|노출\s*(위치|지면)|게재\s*위치|검색\s*캠페인|디스플레이\s*캠페인|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|상품\s*db|db\s*url|비즈보드|카카오모먼트|상품\s*가이드|advantage\+|어드밴티지|카탈로그|catalog|collection|placement|campaign_objective|ad_format/.test(text);
}

function scoreBroadProductStructureSource(
  source: ReturnType<typeof buildVerifiedSources>[number],
  targetVendor: VendorIntent | undefined,
  queryTerms: string[],
  index: number,
) {
  if (isWeakProductStructureDisplaySource(source)) return Number.NEGATIVE_INFINITY;
  if (targetVendor && hasExplicitOtherVendorSignal(source, targetVendor)) return Number.NEGATIVE_INFINITY;

  const text = getSourceText(source);
  let score = Number(source.hybridScore || source.score || source.similarity || 0);
  score += Math.max(0, 0.45 - index * 0.025);

  if (sourceMatchesVendor(source, targetVendor)) score += 0.8;
  if (isOfficialGuideGraphSource(source)) score += 0.75;
  if (isGraphVerifiedSource(source)) score += 0.35;
  if (hasProductStructureGraphSourceSignal(source)) score += 0.9;
  if (hasBroadProductStructureAnswerSignal(source)) score += 0.85;

  const queryHits = queryTerms.filter(term => textContainsEvidenceTerm(text, term)).length;
  score += Math.min(2.8, queryHits * 0.3);

  if (/소재\s*(사양|제작|규격)|파일\s*크기|지원\s*형식|텍스트\s*제한|이미지\s*비율|동영상\s*비율/.test(text)
    && !/광고\s*(상품|종류|유형)|캠페인\s*(목표|유형)|노출\s*(위치|지면)|게재\s*위치|상품\s*db|db\s*url/.test(text)) {
    score -= 0.6;
  }

  return score;
}

function selectProductStructureResponseSources(sources: ReturnType<typeof buildVerifiedSources>, intent?: QueryIntent) {
  const targetVendor = intent?.vendors.length === 1 ? intent.vendors[0] : undefined;
  const queryTerms = buildBroadProductStructureQueryTerms(intent);
  const labelledSources = sources.map((source, index) => ({
    ...source,
    label: `S${index + 1}`,
  })).filter(source => sourceMatchesVendor(source, targetVendor));
  const selected = labelledSources
    .map((source, index) => ({
      source,
      score: scoreBroadProductStructureSource(source, targetVendor, queryTerms, index),
      index,
    }))
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.source)
    .slice(0, 5);
  const selectedKeys = new Set<string>();
  selected.forEach(source => selectedKeys.add(getProductStructureSourceKey(source)));

  if (selected.length === 0) {
    return capProductStructureGraphSources(ensureProductStructureGraphSourceCoverage(sources
      .filter(source => sourceMatchesVendor(source, targetVendor))
      .filter(source => !isWeakProductStructureDisplaySource(source))
      .slice(0, 3), labelledSources, selectedKeys, targetVendor), labelledSources, targetVendor, 5);
  }

  return capProductStructureGraphSources(
    ensureProductStructureGraphSourceCoverage(selected, labelledSources, selectedKeys, targetVendor),
    labelledSources,
    targetVendor,
    5
  );
}

function capProductStructureGraphSources(
  selected: ReturnType<typeof buildVerifiedSources>[number][],
  labelledSources: Array<ReturnType<typeof buildVerifiedSources>[number] & { label: string }>,
  targetVendor?: VendorIntent,
  limit = 5
) {
  const head = selected.slice(0, limit);
  const bestGraphSource = [...head, ...labelledSources]
    .filter(source => isOfficialGuideGraphSource(source))
    .filter(source => sourceMatchesVendor(source, targetVendor))
    .filter(source => !isWeakProductStructureDisplaySource(source))
    .filter(source => !isLowValueProductStructureGraphSource(source))
    .sort((a, b) => scoreProductStructureGraphSource(b, targetVendor) - scoreProductStructureGraphSource(a, targetVendor))[0];

  const bestGraphKey = bestGraphSource ? getProductStructureSourceKey(bestGraphSource) : null;
  const next: ReturnType<typeof buildVerifiedSources>[number][] = [];
  const selectedKeys = new Set<string>();

  for (const source of head) {
    if (isGraphVerifiedSource(source)) {
      if (!bestGraphKey || getProductStructureSourceKey(source) !== bestGraphKey) {
        continue;
      }
    }

    const key = getProductStructureSourceKey(source);
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    next.push(source);
  }

  if (bestGraphSource && !selectedKeys.has(bestGraphKey || '')) {
    const graphInsertIndex = next.length < limit
      ? next.length
      : next
        .map((source, index) => ({ source, index }))
        .filter(({ source }) => !isGraphVerifiedSource(source))
        .sort((a, b) => Number(a.source.hybridScore || a.source.score || 0) - Number(b.source.hybridScore || b.source.score || 0))[0]?.index;

    if (typeof graphInsertIndex === 'number') {
      if (graphInsertIndex >= next.length) {
        next.push(bestGraphSource);
      } else {
        selectedKeys.delete(getProductStructureSourceKey(next[graphInsertIndex]));
        next[graphInsertIndex] = bestGraphSource;
      }
      selectedKeys.add(bestGraphKey || '');
    }
  }

  for (const source of labelledSources) {
    if (next.length >= limit) break;
    if (isGraphVerifiedSource(source)) continue;
    if (!sourceMatchesVendor(source, targetVendor)) continue;
    if (isWeakProductStructureDisplaySource(source)) continue;
    const key = getProductStructureSourceKey(source);
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    next.push(source);
  }

  return next.slice(0, limit);
}

function ensureProductStructureGraphSourceCoverage(
  selected: ReturnType<typeof buildVerifiedSources>[number][],
  labelledSources: Array<ReturnType<typeof buildVerifiedSources>[number] & { label: string }>,
  selectedKeys: Set<string>,
  targetVendor?: VendorIntent
) {
  const selectedOfficialGraphSource = selected.find(source => (
    isOfficialGuideGraphSource(source)
    && sourceMatchesVendor(source, targetVendor)
    && !isLowValueProductStructureGraphSource(source)
  ));

  const graphSourcePool = [...selected, ...labelledSources]
    .filter(source => isOfficialGuideGraphSource(source))
    .filter(source => sourceMatchesVendor(source, targetVendor))
    .filter(source => !isWeakProductStructureDisplaySource(source))
    .filter(source => !isLowValueProductStructureGraphSource(source));
  const graphSource = graphSourcePool
    .sort((a, b) => scoreProductStructureGraphSource(b, targetVendor) - scoreProductStructureGraphSource(a, targetVendor))[0];

  if (!graphSource) {
    return selected;
  }

  if (
    selectedOfficialGraphSource
    && scoreProductStructureGraphSource(selectedOfficialGraphSource, targetVendor)
      >= scoreProductStructureGraphSource(graphSource, targetVendor) - 0.05
  ) {
    return selected;
  }

  const graphSourceKey = getProductStructureSourceKey(graphSource);
  const graphAlreadyInFirstFive = selected
    .slice(0, 5)
    .some(source => getProductStructureSourceKey(source) === graphSourceKey);

  if (graphAlreadyInFirstFive) {
    return selected;
  }

  selectedKeys.add(graphSourceKey);

  const next = selected.filter(source => getProductStructureSourceKey(source) !== graphSourceKey);
  if (selectedOfficialGraphSource) {
    const selectedOfficialGraphKey = getProductStructureSourceKey(selectedOfficialGraphSource);
    const existingIndex = next.findIndex(source => getProductStructureSourceKey(source) === selectedOfficialGraphKey);
    if (existingIndex >= 0) {
      next[existingIndex] = graphSource;
      return next;
    }
  }

  if (next.length < 5) {
    next.push(graphSource);
    return next;
  }

  const head = next.slice(0, 5);
  const tail = next.slice(5);
  const replacement = head
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => !isGraphVerifiedSource(source))
    .sort((a, b) => Number(a.source.hybridScore || a.source.score || 0) - Number(b.source.hybridScore || b.source.score || 0))[0];

  if (!replacement) {
    head[head.length - 1] = graphSource;
    return [...head, ...tail];
  }

  head[replacement.index] = graphSource;
  return [...head, ...tail];
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
  const normalized = normalizeProductIntentText(originalMessage);
  const targetedQueries: string[] = [];

  if (intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(originalMessage)) {
    if (/(^|[\s/])da($|[\s/]|도|상품|광고)|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(normalized)) {
      targetedQueries.push(
        `${VENDOR_LABELS[vendor] || vendor} DA 디스플레이 광고 상품`,
        `${VENDOR_LABELS[vendor] || vendor} 성과형 디스플레이 홈피드DA 배너 광고 상품`
      );
    }
    if (/동영상\s*광고|비디오\s*광고/.test(normalized)) {
      targetedQueries.push(
        `${VENDOR_LABELS[vendor] || vendor} 동영상 광고 상품`,
        `${VENDOR_LABELS[vendor] || vendor} 동영상 소재 비디오 광고 지면`
      );
    }
    if (/앱\s*인스톨|앱\s*설치|앱\s*홍보|app\s*install|app\s*promotion/.test(normalized)) {
      targetedQueries.push(
        `${VENDOR_LABELS[vendor] || vendor} 앱 인스톨 앱 홍보 광고 가이드`,
        `${VENDOR_LABELS[vendor] || vendor} App Install App Promotion SDK MMP 앱 이벤트`
      );
    }
    if (/db\s*url|상품\s*db|상품등록|ep|쇼핑검색/.test(normalized)) {
      targetedQueries.push(
        `${VENDOR_LABELS[vendor] || vendor} 쇼핑검색광고 상품등록 EP DB URL`,
        `${VENDOR_LABELS[vendor] || vendor} 상품 DB 쇼핑파트너센터 상품 데이터`
      );
    }
    if (/카탈로그|catalog|advantage\+|어드밴티지/.test(normalized)) {
      targetedQueries.push(
        `${VENDOR_LABELS[vendor] || vendor} 카탈로그 광고 상품`,
        `${VENDOR_LABELS[vendor] || vendor} Advantage+ 카탈로그 컬렉션 광고`
      );
    }
    if (/리드\s*양식|lead/.test(normalized)) {
      targetedQueries.push(
        `${VENDOR_LABELS[vendor] || vendor} 리드 양식 광고`,
        `${VENDOR_LABELS[vendor] || vendor} 잠재 고객 리드 수집 광고`
      );
    }

    return Array.from(new Set([
      originalMessage,
      ...targetedQueries,
    ].filter(Boolean)));
  }

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
      '네이버 디스플레이 광고 DA 홈피드 배너 광고 상품',
      '네이버 성과형 디스플레이 광고 DA 광고 상품',
      '네이버 브랜드검색 파워링크 검색광고 광고 상품',
      '네이버 쇼핑검색광고 상품등록 절차 EP DB URL 쇼핑파트너센터',
      '네이버 쇼핑블록 PC 모바일 쇼핑 지면 광고 상품',
      '네이버 쇼핑검색광고 상품형 쇼핑블록 광고 상품',
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
  return pickTopicSources(sources, terms)[0];
}

function pickTopicSources(
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
    .sort((a, b) => (
      b.hits - a.hits
      || Number(isGraphVerifiedSource(b.source)) - Number(isGraphVerifiedSource(a.source))
      || a.index - b.index
    ))
    .map(candidate => candidate.source);
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
      Array.isArray(result.metadata?.graphTopics) ? result.metadata.graphTopics.join(' ') : result.metadata?.graphTopics,
      result.metadata?.graphPath,
      result.metadata?.claimType,
      result.metadata?.sourceKind,
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
      documentType: result.metadata?.documentType || 'policy',
      metadata: result.metadata || {}
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
  if (isGraphVerifiedSource(source)) score += intent.topics.includes('product_structure') ? 55 : 18;
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
    const strictProductIntent = intent.isSpecificProductGuidance;
    const strictProductMatch = strictProductIntent ? sourceMatchesStrictProductIntent(source, intent) : false;
    const allowBroadProductStructureBoost = !strictProductIntent || strictProductMatch;
    if (strictProductIntent) {
      if (strictProductMatch) {
        score += 160;
      } else {
        score -= 95;
        if (sourceIsBroadProductStructureOnly(source, intent)) {
          score -= 130;
        }
      }
    }

    const structureTerms = [
      '캠페인 목표', '광고 관리자 목표', '마케팅 목표',
      'objective', 'objectives', 'advantage+', '어드밴티지', '카탈로그', 'catalog', '메타 픽셀', 'meta pixel', '픽셀 이벤트', '픽셀 코드',
      'conversions api', '노출 위치', '게재 위치', 'placements', '지면',
      '컬렉션', 'collection', '리드', 'lead',
      '앱 캠페인', '앱 인스톨', '앱 설치', '앱 홍보', '앱 이벤트', 'app install', 'app promotion', 'sdk', 'mmp', '사전 등록',
      '쇼핑 광고', '검색 캠페인', '디스플레이 캠페인', '반응형 디스플레이', '리드 양식',
      '검색광고', '쇼핑검색', '파워링크', '브랜드검색', '쇼핑블록', '디지털 옥외광고',
      'da', '디스플레이 광고', '성과형 디스플레이', '홈피드da', '홈피드', '배너 광고',
      '비즈보드', '카카오모먼트', '브랜드이모티콘', '상품가이드', '상품 가이드',
      '상품db', '상품 db', 'db url', 'ep', '가격비교', '업종 제한', '심사 가이드',
    ];
    const structureHitCount = structureTerms.filter(term => text.includes(term)).length;
    score += allowBroadProductStructureBoost ? structureHitCount * 7 : Math.min(8, structureHitCount * 2);

    const hasHighValueProductStructure = /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives|advantage\+|어드밴티지|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|app\s*(install|promotion)|sdk|mmp|사전\s*등록|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|디지털\s*옥외광고|da($|[\s/]|도|상품|광고)|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고|비즈보드|카카오모먼트|브랜드이모티콘|상품\s*가이드|상품가이드|상품\s*db|db\s*url|가격비교|업종\s*제한|심사\s*가이드/.test(text)
      || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text)
      || (/노출 위치|게재 위치|placements|지면/.test(text) && /캠페인 목표|광고 관리자 목표|마케팅 목표/.test(text));

    if (hasHighValueProductStructure && allowBroadProductStructureBoost) {
      score += 60;
    }
    if (allowBroadProductStructureBoost
      && (
        /캠페인 목표|광고 관리자 목표|마케팅 목표|objective|objectives/.test(text)
        || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text)
      )
    ) score += 30;
    if (allowBroadProductStructureBoost
      && /advantage\+|어드밴티지|카탈로그|catalog|메타\s*픽셀|meta\s*pixel|픽셀\s*(이벤트|코드|설치|전환)|conversions api|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|app\s*(install|promotion)|sdk|mmp|사전\s*등록|쇼핑\s*광고|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|디지털\s*옥외광고|da($|[\s/]|도|상품|광고)|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고|비즈보드|카카오모먼트|브랜드이모티콘|상품\s*가이드|상품가이드|상품\s*db|db\s*url|가격비교|업종\s*제한|심사\s*가이드/.test(text)
    ) score += 18;
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

type CompassGroundingOptions = {
  answerMode?: string;
  questionIntent?: string;
  targetVendor?: VendorIntent;
};

function toCompassLlmAnswerMode(mode: SpecificProductAnswerMode) {
  if (mode === 'db_setup') return 'setup_procedure';
  return mode;
}

function buildCompassGroundingOptions(
  message: string,
  intent: QueryIntent,
  specificProductScope: ReturnType<typeof buildSpecificProductAnswerScope>,
  isBroadProductStructureLlmIntent: boolean,
): CompassGroundingOptions {
  const targetVendor = intent.vendors.length === 1 ? intent.vendors[0] : undefined;
  const vendorLabel = targetVendor ? (VENDOR_LABELS[targetVendor] || targetVendor) : '해당 매체';

  if (intent.topics.includes('product_structure') && intent.isSpecificProductGuidance) {
    return {
      answerMode: toCompassLlmAnswerMode(specificProductScope.mode),
      questionIntent: `${vendorLabel} 특정 광고 상품의 ${getSpecificProductModeLabel(specificProductScope.mode)}에 직접 답변`,
      targetVendor,
    };
  }

  if (isBroadProductStructureLlmIntent) {
    return {
      answerMode: isProductSelectionQuestion(message) ? 'product_selection' : 'product_overview',
      questionIntent: isProductSelectionQuestion(message)
        ? `${vendorLabel} 광고 상품을 목적별 선택 기준으로 설명`
        : `${vendorLabel} 광고 상품/유형을 근거 기반으로 개요 설명`,
      targetVendor,
    };
  }

  if (isPolicyJudgmentAnswerIntent(intent)) {
    return {
      answerMode: 'policy_screening',
      questionIntent: `${vendorLabel} 정책·심사 기준과 운영 전 확인사항 답변`,
      targetVendor,
    };
  }

  return {
    questionIntent: `${vendorLabel} 근거 확인 질문에 맞춰 답변`,
    targetVendor,
  };
}

function buildCompassAnswerModel(
  intent: QueryIntent,
  isBroadProductStructureLlmIntent: boolean,
): string {
  if (isBroadProductStructureLlmIntent) {
    return 'compass-answer-grounded-product-structure-llm';
  }

  if (intent.topics.includes('product_structure') && intent.isSpecificProductGuidance) {
    return 'compass-answer-grounded-specific-product-llm';
  }

  const neutralAnswer = { model: 'compass-answer' };
  return neutralAnswer.model;
}

function buildAnswerGroundingSources(
  sources: ReturnType<typeof buildVerifiedSources>,
  options: CompassGroundingOptions = {},
): CompassGroundingSource[] {
  return sources.map(source => ({
    chunk_id: source.chunkId || source.id,
    id: source.id,
    content: source.excerpt || source.matchText || '',
    similarity: source.similarity,
    score: source.score,
    hybridScore: source.hybridScore,
    corpus: source.corpus,
    evidenceType: source.evidenceType,
    evidenceDecision: source.evidenceDecision,
    evidenceDecisionReason: source.evidenceDecisionReason,
    rankReason: source.rankReason,
    retrievalMethod: source.retrievalMethod,
    sourceKind: source.metadata?.sourceKind || source.metadata?.source_kind || 'official_doc',
    graphPath: source.metadata?.graphPath || source.metadata?.graph_path,
    documentId: source.documentId,
    documentTitle: source.originalTitle || source.title,
      documentUrl: source.url,
      sourceVendor: source.sourceVendor,
      answerMode: options.answerMode,
      questionIntent: options.questionIntent,
      answerEvidenceRole: source.metadata?.answerEvidenceRole || source.metadata?.answer_evidence_role,
      sourceQuality: source.sourceQuality,
      metadata: {
        ...source.metadata,
        title: source.title,
        originalTitle: source.originalTitle,
      sourceVendor: source.sourceVendor,
      source_vendor: source.sourceVendor,
      evidenceDecision: source.evidenceDecision,
      evidenceDecisionReason: source.evidenceDecisionReason,
      retrievalMethod: source.retrievalMethod,
      source_kind: source.metadata?.source_kind || source.metadata?.sourceKind || 'official_doc',
      graphPath: source.metadata?.graphPath || source.metadata?.graph_path,
      answerMode: options.answerMode,
      questionIntent: options.questionIntent,
      targetVendor: options.targetVendor,
    },
  }));
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

function isGraphSearchResult(result: SearchResult): boolean {
  return (
    result.retrievalMethod === 'graph'
    || result.evidenceType === 'graph'
    || result.corpus === 'evidence_graph'
    || result.metadata?.retrievalMethod === 'graph'
    || result.metadata?.evidenceType === 'graph'
    || result.metadata?.corpus === 'evidence_graph'
  );
}

function isVerifiedGrounding(result: SearchResult): boolean {
  const hasGrounding = typeof result.content === 'string' && result.content.trim().length > 0;
  const isFallback = result.retrievalMethod === 'fallback'
    || result.sourceQuality?.isFallback === true
    || result.metadata?.type === 'fallback';
  const evidenceDecision = getEvidenceDecision(result);
  const isOfficialGuideGraphEvidence = isGraphSearchResult(result)
    && (result.metadata?.sourceKind === 'official_doc' || result.metadata?.source_kind === 'official_doc');

  if (hasGrounding && !isFallback && isOfficialGuideGraphEvidence) {
    return true;
  }

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
    const usesProductStructureFastPath = isBroadProductStructureAnswerIntent(message, ragIntent);
    const fastPathSupplementQueries = usesProductStructureFastPath && ragIntent.vendors[0] === 'NAVER'
      ? [
        '네이버 쇼핑검색광고 상품등록 절차 EP DB URL 쇼핑파트너센터',
        '네이버 쇼핑블록 PC 모바일 쇼핑 지면 광고 상품',
      ]
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
      console.log('Compass policy/detail answer will use grounded LLM synthesis', {
        topics: ragIntent.topics,
        isSpecificProductGuidance: ragIntent.isSpecificProductGuidance,
      });
    }

    const specificProductScope = buildSpecificProductAnswerScope(sources, ragIntent, message);
    let answerSources = specificProductScope.answerSources;
    const isBroadProductStructureLlmIntent = isBroadProductStructureAnswerIntent(message, ragIntent);

    if (specificProductScope.shouldLimit) {
      console.warn('Compass answer generation limited by strict product answer scope', {
        strictProductTerms: ragIntent.strictProductTerms,
        mode: specificProductScope.mode,
        strictProductSourceCount: specificProductScope.strictProductSources.length,
        answerSourceCount: specificProductScope.answerSources.length,
      });

      const scopeLimitedAnswer = buildSpecificProductScopeLimitedAnswer(message, ragIntent, specificProductScope);
      emitPhase?.({ phase: 'answer-ready', message: '질문한 상품 범위에 맞는 출처가 부족해 제한 답변을 준비했습니다.' });
      return {
        body: {
          response: {
            message: scopeLimitedAnswer,
            content: scopeLimitedAnswer,
            sources: specificProductScope.strictProductSources,
            noDataFound: specificProductScope.strictProductSources.length === 0,
            schema,
            showContactOption: true,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              strictProductSourceCount: specificProductScope.strictProductSources.length,
              answerSourceCount: specificProductScope.answerSources.length,
              answerMode: specificProductScope.mode,
            },
            reviewPipeline: buildReviewPipeline({
              status: 'limited',
              sourceCount: searchResults.length,
              verifiedSourceCount: specificProductScope.strictProductSources.length,
              contactRecommended: true,
            }),
          },
          confidence: specificProductScope.strictProductSources.length > 0 ? Math.min(confidence, 64) : 0,
          processingTime: Date.now() - startTime,
          model: 'compass-answer-specific-product-scope-limited'
        }
      };
    }

    const naverShoppingDataOperationalAnswer = buildNaverShoppingDataOperationalAnswer(message, answerSources);

    if (naverShoppingDataOperationalAnswer) {
      emitPhase?.({ phase: 'answer-ready', message: '네이버 상품 DB 근거를 기준으로 절차 답변을 정리했습니다.' });
      return {
        body: {
          response: {
            message: naverShoppingDataOperationalAnswer,
            content: naverShoppingDataOperationalAnswer,
            sources: answerSources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              strictProductSourceCount: specificProductScope.strictProductSources.length,
              answerSourceCount: answerSources.length,
              answerMode: specificProductScope.mode,
            },
            reviewPipeline,
          },
          confidence,
          processingTime: Date.now() - startTime,
          model: 'compass-answer-naver-shopping-data-operational'
        }
      };
    }

    if (ragIntent.topics.includes('product_structure') && ragIntent.isSpecificProductGuidance) {
      console.log('Compass specific product answer will use grounded LLM synthesis', {
        sourceCount: answerSources.length,
        strictProductTerms: ragIntent.strictProductTerms,
        vendor: ragIntent.vendors[0] || 'UNKNOWN',
        answerMode: specificProductScope.mode,
      });
      emitPhase?.({ phase: 'answer-started', message: '특정 상품 근거를 바탕으로 답변을 작성합니다.' });
    }

    if (isBroadProductStructureLlmIntent) {
      const productStructureSources = selectProductStructureResponseSources(sources, ragIntent);
      if (productStructureSources.length > 0) {
        answerSources = productStructureSources;
      }
      console.log('Compass product structure broad answer will use grounded LLM synthesis', {
        sourceCount: answerSources.length,
        vendor: ragIntent.vendors[0] || 'UNKNOWN',
      });
      emitPhase?.({ phase: 'answer-started', message: '상품 구조 근거를 바탕으로 답변을 작성합니다.' });
    }

    let answerResult;
    try {
      answerResult = await generateCompassAnswer(
        message,
        buildAnswerGroundingSources(
          answerSources,
          buildCompassGroundingOptions(message, ragIntent, specificProductScope, isBroadProductStructureLlmIntent),
        ),
      );
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
            sources: answerSources,
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
    const operationalAnswer = buildNaverShoppingDataOperationalAnswer(message, answerSources);
    const normalizedAnswer = normalizeGeneratedAnswer(operationalAnswer || answerResult.answer, answerSources);
    const responseAnswer = coverageNotice ? `${coverageNotice}\n\n${normalizedAnswer}` : normalizedAnswer;
    
    emitPhase?.({ phase: 'answer-ready', message: '답변 정리가 완료되었습니다.' });
    return {
      body: {
        response: {
          message: responseAnswer,
          content: responseAnswer,
          sources: answerSources,
          noDataFound: false,
          schema,
          showContactOption: false,
          sourceDiagnostics: {
            ...sourceDiagnostics,
            answerSourceCount: answerSources.length,
            answerMode: specificProductScope.mode,
          },
          reviewPipeline,
        },
        confidence,
        processingTime,
        model: buildCompassAnswerModel(ragIntent, isBroadProductStructureLlmIntent)
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
