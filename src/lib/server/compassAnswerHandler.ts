import { NextRequest, NextResponse } from 'next/server';
import { getCompassDbSchema } from '@/lib/supabase/compass';
import {
  classifyCompassRagQuery,
  getCompassRetrievalChannelTimeoutMetadata,
  RAGSearchService,
  type EvidenceDecision,
  type QueryIntent,
  type VendorIntent,
} from '@/lib/services/RAGSearchService';
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

type CompassRetrievalResult = {
  results: SearchResult[];
  timedOut: boolean;
  channelTimedOut: boolean;
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

let compassRagSearchService: RAGSearchService | null = null;

function getCompassRagSearchService(): RAGSearchService {
  if (!compassRagSearchService) {
    compassRagSearchService = new RAGSearchService();
  }
  return compassRagSearchService;
}

function resolveCompassRetrievalTimeoutMs(): number {
  const configured = process.env.COMPASS_RETRIEVAL_TIMEOUT_MS
    || process.env.COMPASS_EVIDENCE_RETRIEVAL_TIMEOUT_MS;
  const parsed = Math.floor(Number(configured));
  const timeoutMs = Number.isFinite(parsed) ? parsed : 30000;
  return Math.min(Math.max(timeoutMs, 12000), 45000);
}

async function withCompassTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  warningLabel: string,
  metadata: Record<string, unknown> = {},
): Promise<{ value: T; timedOut: boolean }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise
        .then((value) => ({ value, timedOut: false }))
        .finally(() => {
          if (timeoutId) clearTimeout(timeoutId);
        }),
      new Promise<{ value: T; timedOut: boolean }>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(warningLabel, { ...metadata, timeoutMs });
          resolve({ value: fallback, timedOut: true });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Compass RAG 검색
 */
async function searchWithCompassRAG(
  query: string,
  limit: number = 5
): Promise<CompassRetrievalResult> {
  try {
    const startedAt = Date.now();
    const timeoutMs = resolveCompassRetrievalTimeoutMs();
    console.log('Compass evidence retrieval started', { queryLength: query.length, limit });
    
    if (!hasCompassEvidenceStore()) {
      console.warn('Compass evidence store is unavailable');
      return { results: [], timedOut: false, channelTimedOut: false };
    }

    const ragService = getCompassRagSearchService();
    const retrievalResult = await withCompassTimeout(
      ragService.searchSimilarChunks(query, limit),
      timeoutMs,
      [] as Awaited<ReturnType<RAGSearchService['searchSimilarChunks']>>,
      'Compass evidence retrieval timed out',
      { queryLength: query.length, limit },
    );
    const searchResults = retrievalResult.value;
    const channelTimeoutMetadata = getCompassRetrievalChannelTimeoutMetadata(searchResults);
    
    console.log('Compass evidence retrieval completed', {
      resultCount: searchResults.length,
      durationMs: Date.now() - startedAt,
      limit,
      timedOut: retrievalResult.timedOut,
      channelTimedOut: channelTimeoutMetadata.timedOut,
      timedOutChannelCount: channelTimeoutMetadata.channels.length,
    });
    
    return {
      results: searchResults.map(result => ({
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
      })),
      timedOut: retrievalResult.timedOut,
      channelTimedOut: channelTimeoutMetadata.timedOut,
    };
    
  } catch (error) {
    console.error('Compass evidence retrieval failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return { results: [], timedOut: false, channelTimedOut: false };
  }
}

/**
 * 신뢰도 계산
 */
function getResultVendor(result: SearchResult): string {
  return result.sourceVendor || result.metadata?.sourceVendor || result.metadata?.source_vendor || result.sourceQuality?.sourceVendor || 'UNKNOWN';
}

const DIAGNOSTIC_VENDOR_PATTERNS: Record<VendorIntent, RegExp> = {
  META: /meta|facebook|페이스북|instagram|인스타그램|릴스|reels|advantage\+|어드밴티지|메타\s*픽셀|fb[_\s-]?ads/i,
  KAKAO: /kakao|카카오|카카오톡|톡채널|비즈보드|모먼트|카카오모먼트|상품\s*가이드|상품가이드/i,
  NAVER: /naver|네이버|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|쇼핑파트너센터|상품\s*db|db\s*url|가격비교|사이트검색광고|네이버\s*da|네이버da|홈피드|스마트채널|타임보드|롤링보드|성과형\s*디스플레이|디지털\s*옥외광고/i,
  GOOGLE: /google|구글|youtube|유튜브|gdn|google ads|구글\s*애즈|구글\s*광고|pmax|performance\s*max/i,
};

function isVendorIntentValue(value: unknown): value is VendorIntent {
  return value === 'META' || value === 'KAKAO' || value === 'NAVER' || value === 'GOOGLE';
}

function toDiagnosticText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(toDiagnosticText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return '';
}

function buildDiagnosticSourceText(result: SearchResult): string {
  const metadata = result.metadata || {};
  return [
    result.sourceVendor,
    result.sourceVendors,
    result.documentTitle,
    result.documentUrl,
    result.documentId,
    result.content,
    result.sourceQuality?.sourceVendor,
    result.sourceQuality?.warnings,
    result.rankReason,
    result.evidenceDecisionReason,
    metadata.sourceVendor,
    metadata.source_vendor,
    metadata.sourceVendors,
    metadata.source_vendors,
    metadata.title,
    metadata.originalTitle,
    metadata.source_title,
    metadata.canonical_title,
    metadata.source,
    metadata.source_url,
    metadata.document_url,
    metadata.url,
    metadata.documentId,
    metadata.document_id,
    metadata.productStructureAnchor,
    metadata.graphPath,
    metadata.sourceKind,
    metadata.source_kind,
    metadata.claimType,
    metadata.claim_type,
    metadata.answerEvidenceRole,
    metadata.answer_evidence_role,
    metadata.topic_labels,
    metadata.graphTopics,
  ].map(toDiagnosticText).filter(Boolean).join(' ').slice(0, 12000);
}

function getDiagnosticResultVendors(result: SearchResult): VendorIntent[] {
  const metadata = result.metadata || {};
  const explicitCandidates = [
    result.sourceVendor,
    result.sourceQuality?.sourceVendor,
    metadata.sourceVendor,
    metadata.source_vendor,
    ...(Array.isArray(result.sourceVendors) ? result.sourceVendors : []),
    ...(Array.isArray(metadata.sourceVendors) ? metadata.sourceVendors : []),
    ...(Array.isArray(metadata.source_vendors) ? metadata.source_vendors : []),
  ];
  const vendors = new Set<VendorIntent>(explicitCandidates.filter(isVendorIntentValue));
  const diagnosticText = buildDiagnosticSourceText(result);

  (Object.keys(DIAGNOSTIC_VENDOR_PATTERNS) as VendorIntent[]).forEach((vendor) => {
    if (DIAGNOSTIC_VENDOR_PATTERNS[vendor].test(diagnosticText)) {
      vendors.add(vendor);
    }
  });

  return Array.from(vendors);
}

function getMissingVendorSlots(intent: QueryIntent, searchResults: SearchResult[]): VendorIntent[] {
  if (!intent.requiresVendorCoverage) return [];

  return intent.vendors.filter((vendor) => !searchResults.some((result) => getDiagnosticResultVendors(result).includes(vendor)));
}

function buildSourceDiagnostics(intent: QueryIntent, searchResults: SearchResult[]) {
  const vendors = Array.from(new Set(searchResults.flatMap(getDiagnosticResultVendors)));
  const missingVendorSlots = getMissingVendorSlots(intent, searchResults);

  return {
    queryType: intent.queryType,
    isComparative: intent.isComparative,
    requestedVendors: intent.vendors,
    coveredVendors: vendors,
    missingVendorSlots,
    sourceCount: searchResults.length,
    recommendedSourceLimit: intent.recommendedSourceLimit,
    isOutOfScope: intent.isOutOfScope,
    outOfScopeTerms: intent.outOfScopeTerms,
    unavailablePolicyTarget: intent.unavailablePolicyTarget,
    unavailablePolicyTargetReason: intent.unavailablePolicyTargetReason,
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
  retrievalChannelLimited = false,
}: {
  status: CompassReviewPipelineStatus;
  sourceCount: number;
  verifiedSourceCount: number;
  contactRecommended: boolean;
  retrievalChannelLimited?: boolean;
}) {
  const effectiveStatus: CompassReviewPipelineStatus = status === 'completed' && retrievalChannelLimited && verifiedSourceCount > 0
    ? 'limited'
    : status;
  const isCompleted = effectiveStatus === 'completed';
  const label = isCompleted ? 'AI 2단계 검토 완료' : 'AI 2단계 제한 검토';
  const summary = retrievalChannelLimited && verifiedSourceCount > 0
    ? '질문 조건과 출처 정합성을 확인했으며, 일부 검색 경로 제한 여부도 함께 점검했습니다.'
    : isCompleted
    ? '1차로 질문 조건과 후보 출처를 정리하고, 2차로 검증 출처와 답변 범위를 대조했습니다.'
    : '1차로 후보 출처를 찾고, 2차로 답변 가능 범위를 점검한 결과 추가 확인이 필요한 상태입니다.';
  const steps = [
    {
      label: '1차 AI 검토',
      description: `질문 의도와 매체 조건을 분석하고 후보 출처 ${sourceCount}개를 검색했습니다.`,
      status: sourceCount > 0 ? 'completed' as const : 'attention' as const,
    },
    {
      label: '2차 정합성 검토',
      description: `실제 답변에 사용할 수 있는 검증 출처 ${verifiedSourceCount}개만 선별했습니다.`,
      status: verifiedSourceCount > 0 ? 'completed' as const : 'limited' as const,
    },
    {
      label: '답변 정리',
      description: contactRecommended
        ? '검증 출처가 부족하거나 범위가 제한되어 담당자 추가 확인을 권장합니다.'
        : '확인된 출처 범위 안에서만 답변을 정리했습니다.',
      status: contactRecommended ? 'attention' as const : 'completed' as const,
    },
  ];

  if (retrievalChannelLimited && verifiedSourceCount > 0) {
    steps.push({
      label: '검색 범위 점검',
      description: `일부 검색 경로가 제한되어 검증 출처 ${verifiedSourceCount}개 기준으로 답변했습니다.`,
      status: 'attention',
    });
  }

  return {
    label,
    summary,
    status: effectiveStatus,
    steps,
    disclosure: 'Compass 답변은 확인된 출처 범위 안에서만 제공되며, 최종 운영 판단 전 원문 대조를 권장합니다.',
  };
}

function buildNoDataAnswer(intent: QueryIntent) {
  if (intent.isOutOfScope) {
    return 'Compass 문서 기준으로 관련 광고 정책 근거를 찾지 못했습니다. 광고 플랫폼 정책, 심사 기준, 소재/캠페인 운영 조건에 대한 질문을 입력해 주세요.';
  }

  if (intent.unavailablePolicyTarget) {
    if (intent.unavailablePolicyTargetReason === 'fictional_platform') {
      return 'Compass 문서에서 해당 플랫폼의 정책 근거를 찾지 못했습니다. Meta, Google, Naver, Kakao처럼 실제 플랫폼명을 입력해 주세요.';
    }

    return 'Compass 문서 기준으로 해당 시점이나 대상의 광고 정책 근거를 찾지 못했습니다. 실제 운영 중인 플랫폼명과 확인하려는 정책 또는 상품 범위를 다시 입력해 주세요.';
  }

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

function buildAuthoritativeNoDataResponse(
  intent: QueryIntent,
  startTime: number,
  emitPhase?: CompassAnswerPhaseEmitter,
): CompassAnswerHandlerResult {
  const answer = buildNoDataAnswer(intent);
  const sourceDiagnostics = buildSourceDiagnostics(intent, []);
  emitPhase?.({ phase: 'answer-ready', message: 'Compass 범위에서 확인 가능한 근거가 없어 제한 응답을 준비했습니다.' });

  return {
    body: {
      response: {
        message: answer,
        content: answer,
        sources: [],
        noDataFound: true,
        schema: getCompassDbSchema(),
        showContactOption: true,
        sourceDiagnostics,
        reviewPipeline: buildReviewPipeline({
          status: 'blocked',
          sourceCount: 0,
          verifiedSourceCount: 0,
          contactRecommended: true,
        }),
      },
      confidence: 0,
      processingTime: Date.now() - startTime,
      model: 'compass-answer-no-data',
    },
  };
}

function answerStatesNoVerifiedData(answer: string): boolean {
  return /현재\s*제공된\s*문서에서는\s*(?:[^.。!?]{0,80})?(?:확인되지\s*않습니다|찾을\s*수\s*없습니다)|Compass\s*문서\s*기준으로\s*(?:[^.。!?]{0,80})?근거를\s*찾지\s*못했습니다|정책\s*근거를\s*찾지\s*못했습니다/.test(
    String(answer || '').replace(/\s+/g, ' ').trim(),
  );
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
    const hasCitation = /\[S\d+\]/.test(normalized);
    const hasOperationalSentence = /입니다|합니다|됩니다|하세요|확인|선택|등록|설정|연동|집행|제작|검토|주의|필요/.test(meaningfulText);
    if (meaningfulText.length >= 35 && (hasCitation || hasOperationalSentence)) {
      return normalized.trim();
    }

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
  return /어떻게\s*(고르|선택|구분)|기준으로\s*(설명|구분|선택|정리)|선택\s*기준|고르는\s*기준|골라야|고르면|추천|목적별|목표별|상황별|어떤\s*(상품|유형|캠페인)|무엇을\s*(선택|고르)|뭘\s*(선택|고르)|목표\s*기준|광고\s*상품\s*(종류|유형|목록|구조|군)|광고상품\s*(종류|유형|목록|구조|군)|상품\s*(종류|유형|목록|구조|군)|광고\s*(종류|유형)/.test(normalized);
}

function isWholeProductCatalogQuestionText(normalized: string): boolean {
  return /전체\s*(광고\s*)?(상품|목록|종류|유형|구조|군)|광고\s*상품\s*(전체|목록|종류|유형|구조|군)|광고상품\s*(전체|목록|종류|유형|구조|군)|상품\s*(전체|목록|종류|유형|구조|군)/.test(normalized);
}

function isExplicitWholeProductCatalogQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  return isWholeProductCatalogQuestionText(normalized);
}

function hasSpecificProductActionOrPolicySignalQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  return /등록|절차|집행|진행|세팅|설정|연동|제작|가이드|소재|문구|카피|사양|스펙|규격|비율|사이즈|조건|주의|유의|확인해야|꼭\s*확인|db\s*url|상품\s*db|상품등록|상품\s*등록|mmp|sdk|추적|트래킹|오류|에러|반려|승인|심사|검수|정책|랜딩|권한|계정/.test(normalized);
}

function isProductCatalogOverviewQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  const asksWholeCatalog = isWholeProductCatalogQuestionText(normalized);

  if (hasNamedSpecificProductQuestion(message) && !asksWholeCatalog) {
    return false;
  }

  if (!asksWholeCatalog && hasSpecificProductActionOrPolicySignalQuestion(message)) {
    return false;
  }

  if (isProductSelectionQuestion(message)) return true;

  if (isExplicitWholeProductCatalogQuestion(message)) return true;

  return (
    /광고\s*상품.*(알려|설명|정리|구분)/.test(normalized)
  );
}

function isBroadProductStructureAnswerIntent(message: string, intent: QueryIntent): boolean {
  if (!intent.topics.includes('product_structure')) return false;
  if (intent.vendors.length !== 1 || intent.isComparative) return false;
  if (intent.isSpecificProductGuidance && !isExplicitWholeProductCatalogQuestion(message)) return false;
  if (hasNamedSpecificProductQuestion(message) && !isExplicitWholeProductCatalogQuestion(message)) return false;

  const explicitCatalogOverview = isProductCatalogOverviewQuestion(message);
  if (explicitCatalogOverview) return true;

  return intent.isProductStructureOverview && !hasNamedSpecificProductQuestion(message);
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

function getFallbackSourceText(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  return normalizeEvidenceText([
    source.title,
    source.originalTitle,
    source.excerpt,
    source.matchText,
    metadata.title,
    metadata.originalTitle,
    metadata.documentTitle,
    metadata.document_title,
    metadata.source_title,
    metadata.canonical_title,
    metadata.productStructureAnchor,
    metadata.graphPath,
    metadata.topic_labels,
    metadata.graphTopics,
    Array.isArray(source.rankReason) ? source.rankReason.join(' ') : source.rankReason,
    Array.isArray(source.evidenceDecisionReason) ? source.evidenceDecisionReason.join(' ') : source.evidenceDecisionReason,
  ].filter(Boolean).join(' '));
}

function findFallbackSourceIndex(
  sources: ReturnType<typeof buildVerifiedSources>,
  vendor: VendorIntent | undefined,
  pattern: RegExp,
) {
  const matches = sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => {
      const searchableText = normalizeEvidenceText(`${source.title || ''} ${source.originalTitle || ''} ${getFallbackSourceText(source)}`);
      return sourceMatchesVendor(source, vendor)
        && (!vendor || !sourceHasCrossVendorUrl(source, [vendor]))
        && !sourceHasExtractionNoise(source)
        && pattern.test(searchableText);
    });
  const titleMatch = matches.find(({ source }) => (
    pattern.test(normalizeEvidenceText(`${source.title || ''} ${source.originalTitle || ''}`))
  ));
  return titleMatch?.index ?? matches[0]?.index ?? -1;
}

function formatFallbackEvidenceLabels(used: Set<number>) {
  return Array.from(used)
    .sort((a, b) => a - b)
    .map(index => `[S${index + 1}]`)
    .join(', ');
}

function addFallbackLine(
  lines: string[],
  used: Set<number>,
  sources: ReturnType<typeof buildVerifiedSources>,
  vendor: VendorIntent | undefined,
  pattern: RegExp,
  line: (label: string) => string,
) {
  const index = findFallbackSourceIndex(sources, vendor, pattern);
  if (index < 0) return false;
  used.add(index);
  lines.push(line(`[S${index + 1}]`));
  return true;
}

function buildNaverShoppingDataStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  originalMessage?: string,
) {
  if (!isNaverShoppingDataIntent(intent)) return null;
  const queryText = normalizeProductIntentText(originalMessage || '');
  const asksDataSetup = /db\s*url|dburl|상품\s*db|상품db|ep|상품\s*등록|등록\s*요청|등록요청|상품정보\s*수신|상품관리|쇼핑파트너센터|카테고리\s*(자동)?매칭|입점\s*심사|피드|feed/.test(queryText);
  if (originalMessage && !asksDataSetup) return null;

  const used = new Set<number>();
  const candidateIndexes = sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => sourceMatchesVendor(source, 'NAVER') && sourceHasNaverShoppingDataEvidence(source))
    .sort((a, b) => scoreNaverShoppingDataEvidence(b.source) - scoreNaverShoppingDataEvidence(a.source))
    .map(candidate => candidate.index);
  const bestIndex = candidateIndexes[0] ?? -1;

  const cite = (index: number) => {
    used.add(index);
    return `[S${index + 1}]`;
  };
  const findProcedureSourceIndex = (pattern: RegExp, allowBestFallback = false) => {
    const indexedMatches = sources
      .map((source, index) => ({ source, index }))
      .filter(({ source }) => {
        if (!sourceMatchesVendor(source, 'NAVER')) return false;
        const searchableText = getFallbackSourceText(source);
        return sourceHasNaverShoppingDataEvidence(source) && pattern.test(searchableText);
      })
      .sort((a, b) => scoreNaverShoppingDataEvidence(b.source) - scoreNaverShoppingDataEvidence(a.source));
    if (indexedMatches.length > 0) return indexedMatches[0].index;
    return allowBestFallback ? bestIndex : -1;
  };
  const addProcedureLine = (
    lines: string[],
    pattern: RegExp,
    line: (label: string) => string,
    allowBestFallback = false,
  ) => {
    const index = findProcedureSourceIndex(pattern, allowBestFallback);
    if (index < 0) return false;
    lines.push(line(cite(index)));
    return true;
  };

  const sections = [
    '네이버 쇼핑검색광고에서 상품 등록이나 DB URL을 확인할 때는 광고 생성 화면보다 먼저 “쇼핑몰 상품 데이터가 네이버 쪽으로 정상 수신되고, 노출 가능한 상태가 되었는지”를 확인하는 흐름이 중요합니다.',
    '',
    '1. **상품 DB URL/EP 등록 절차 확인**',
    '',
  ];

  const addedRegistration = addProcedureLine(
    sections,
    /상품정보\s*수신\s*현황|등록\s*요청|등록요청|상품관리|ep\s*\(=\s*db\s*url\)|상품\s*db\s*url|상품db\s*url|db\s*url|dburl/,
    label => `- 쇼핑파트너센터의 **상품관리 > 상품정보 수신 현황**에서 ‘등록요청’을 눌러 상품 DB URL 또는 EP를 입력하는 절차를 먼저 확인하세요 ${label}.`,
  );
  addProcedureLine(
    sections,
    /영업일\s*기준\s*1\s*[-~]?\s*2일|통상\s*1\s*[-~]?\s*2일|입점\s*심사|심사/,
    label => `- DB URL/EP 등록 후에는 통상 영업일 기준 1~2일 수준의 심사가 걸릴 수 있으니, 바로 노출된다고 전제하지 않는 것이 안전합니다 ${label}.`,
  );
  addProcedureLine(
    sections,
    /상품\s*현황\s*및\s*관리|미서비스\s*상품|대분류\s*검색|상품\s*리스트|상품리스트/,
    label => `- 심사나 업데이트가 끝난 뒤에는 **상품현황 및 관리 > 미서비스 상품**에서 대분류 검색으로 상품 리스트가 들어왔는지 확인하세요 ${label}.`,
  );
  addProcedureLine(
    sections,
    /카테고리\s*(자동)?매칭|네이버\s*가격비교\s*카테고리|상품명.*카테고리|매칭\s*수정/,
    label => `- 카테고리는 상품명 기준으로 자동매칭될 수 있으므로, 맞지 않으면 상품별 카테고리 매칭을 수정해야 합니다 ${label}.`,
  );
  addProcedureLine(
    sections,
    /서비스\s*가능\s*상태|가격비교\s*노출|쇼핑검색광고\s*상품등록\s*가능|상품등록\s*가능/,
    label => `- 최종적으로 서비스 가능 상태, 네이버 가격비교 노출, 쇼핑검색광고 상품등록 가능 여부까지 확인해야 합니다 ${label}.`,
  );

  const dataQualityLines: string[] = [];
  const addedDataQuality = addProcedureLine(
    dataQualityLines,
    /상품\s*가격|가격대|배송비|쿠폰|할인|대표이미지|색상\s*필터|혜택\s*필터|데이터\s*피드|feed/,
    label => `- 가격, 배송비, 쿠폰/할인, 대표이미지처럼 EP에 들어가는 상품 데이터는 필터나 노출 조건에 영향을 줄 수 있으므로 최신 상태로 관리해야 합니다 ${label}.`,
  );
  if (addedDataQuality) {
    sections.push('');
    sections.push('2. **상품 데이터 품질 확인**');
    sections.push('');
    sections.push(...dataQualityLines);
  }

  const operationLines: string[] = [];
  addProcedureLine(
    operationLines,
    /cpc|cps|쇼핑파트너센터|네이버\s*쇼핑에\s*등록|쇼핑몰.*연동|전환\s*추적/,
    label => `- CPC/CPS 입점 방식, 쇼핑몰 연동, 전환 추적처럼 계정이나 쇼핑몰 상태에 따라 달라지는 항목은 광고 집행 전 별도로 확인하는 것이 좋습니다 ${label}.`,
  );
  if (operationLines.length > 0) {
    sections.push('');
    sections.push(`${addedDataQuality ? '3' : '2'}. **운영 전에 남겨둘 확인 사항**`);
    sections.push('');
    sections.push(...operationLines);
  }

  if (!addedRegistration && !addedDataQuality && used.size === 0) return null;

  if (used.size === 0) {
    return null;
  }

  sections.push('');
  sections.push('정리하면, DB URL 자체만 확인하는 것이 아니라 **상품 데이터 등록 요청 → 심사/수신 상태 → 카테고리 매칭 → 서비스 가능 상태** 순서로 확인해야 쇼핑검색광고 집행 가능 여부를 판단하기 쉽습니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildNaverShoppingSearchCreativeGuideStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  originalMessage: string,
) {
  if (!intent.vendors.includes('NAVER')) return null;

  const queryText = normalizeProductIntentText(originalMessage);
  const asksShoppingSearch = /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑\s*광고/.test(queryText);
  const asksCreativeGuide = /제작|소재|가이드|사양|스펙|규격|이미지|문구|카피|랜딩|심사|검수|등록\s*기준/.test(queryText);
  if (!asksShoppingSearch || !asksCreativeGuide) return null;

  const used = new Set<number>();
  const sections = [
    '네이버 쇼핑검색광고 제작 가이드는 “쇼핑 지면에 노출될 상품 정보가 준비되어 있는지”와 “소재·랜딩·심사 조건이 맞는지”를 나누어 확인하는 편이 좋습니다.',
    '',
    '1. **쇼핑검색광고 노출 구조 확인**',
    '',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /쇼핑검색광고|쇼핑\s*검색|쇼핑몰\s*상품형|상품\s*노출|쇼핑\s*지면|네이버\s*쇼핑/,
    label => `- 쇼핑검색광고는 쇼핑몰 상품형처럼 상품 정보가 검색·쇼핑 지면에 노출되는 구조로 먼저 이해하면 됩니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /상품명|상품\s*정보|대표이미지|이미지|가격|배송비|카테고리|상품\s*상세|랜딩|url|쇼핑몰/,
    label => `- 제작 전에는 상품명, 대표이미지, 가격·배송비, 카테고리, 랜딩 URL처럼 실제 노출에 쓰이는 상품 정보를 함께 점검해야 합니다 ${label}.`,
  );

  const creativeLines: string[] = [];
  addFallbackLine(
    creativeLines,
    used,
    sources,
    'NAVER',
    /소재\s*(제작|사양|가이드|조건)|이미지\s*(비율|사이즈|크기)|문구|카피|텍스트|품질|광고등록기준|등록\s*기준/,
    label => `- 이미지 품질, 문구, 텍스트, 광고등록기준처럼 소재 제작과 심사에 연결되는 항목은 별도로 대조해야 합니다 ${label}.`,
  );
  addFallbackLine(
    creativeLines,
    used,
    sources,
    'NAVER',
    /심사|검수|승인|선\s*검수|업종\s*제한|등록\s*불가|제한\s*업종|소재\s*승인/,
    label => `- 업종 제한, 선검수, 소재 승인 조건은 상품 노출 가능 여부와 별개로 심사 기준에서 확인해야 합니다 ${label}.`,
  );

  if (creativeLines.length > 0) {
    sections.push('');
    sections.push('2. **제작·심사 전에 확인할 조건**');
    sections.push('');
    sections.push(...creativeLines);
  }

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, 쇼핑검색광고 제작 단계에서는 상품 정보, 대표이미지·문구, 랜딩, 업종/심사 기준을 함께 확인하는 흐름이 안전합니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildNaverProductOverviewStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  isBroadProductStructureLlmIntent: boolean,
  originalMessage?: string,
) {
  if (!intent.vendors.includes('NAVER')) return null;
  const queryText = normalizeProductIntentText(originalMessage || '');
  const asksNaverProductOverview = isBroadProductStructureLlmIntent
    || isProductCatalogOverviewQuestion(originalMessage || '');
  if (!isBroadProductStructureLlmIntent && !asksNaverProductOverview) return null;
  const explicitlyAsksShoppingBlock = /쇼핑\s*블록|쇼핑블록|주요\s*쇼핑\s*지면/.test(queryText);

  const used = new Set<number>();
  const sections = [
    '네이버 광고 상품은 확보된 공식 가이드 근거 기준으로 검색 유입, 쇼핑 상품 노출, 쇼핑 지면 노출, 업종별 노출 가능 여부를 나누어 확인하는 편이 안전합니다.',
    '',
    '1. **대표 상품군과 노출 지면 구분**',
    '',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /사이트검색광고|키워드\s*검색|검색\s*유입|파워링크|웹사이트\s*방문/,
    label => `- 사이트검색광고는 키워드 검색 기반으로 웹사이트 방문을 늘릴 때 확인하는 상품군입니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /쇼핑검색광고|쇼핑\s*검색|쇼핑몰\s*상품형|상품\s*노출|상품형/,
    label => `- 쇼핑검색광고는 쇼핑몰 상품형처럼 상품 노출과 구매 유입을 함께 다룰 때 확인합니다 ${label}.`,
  );
  const addedShoppingBlock = addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /쇼핑블록|주요\s*쇼핑\s*지면|쇼핑\s*지면|브랜딩\s*목적/,
    label => `- 쇼핑블록이나 주요 쇼핑 지면은 쇼핑몰 유입과 브랜딩 목적을 함께 검토할 때 확인할 수 있습니다 ${label}.`,
  );
  if (!addedShoppingBlock && explicitlyAsksShoppingBlock) {
    sections.push('- 쇼핑블록은 이번에 확인된 출처 안에서는 세부 상품 설명이나 운영 기준이 충분히 잡히지 않았습니다. 이 항목은 출처 추가 또는 담당자 확인 대상으로 남겨두는 것이 안전합니다.');
  }
  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /디지털\s*옥외광고|네이버\s*플레이스|업종\s*제한|등록\s*불가\s*업종/,
    label => `- 디지털 옥외광고나 일부 노출 지면은 업종 제한과 등록 가능 여부를 별도로 확인해야 합니다 ${label}.`,
  );

  if (used.size === 0) return null;

  sections.push('');
  sections.push('2. **등록·소재 조건 확인**');
  sections.push('');
  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /상품\s*db|db\s*url|상품정보\s*수신\s*현황|쇼핑파트너센터|카테고리\s*(자동)?매칭|입점\s*심사/,
    label => `- 쇼핑 상품을 다루는 경우 상품 DB URL, 쇼핑파트너센터 등록 상태, 카테고리 매칭 상태를 함께 확인해야 합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /업종\s*제한|광고등록기준|등록\s*기준|심사|선\s*검수|소재\s*승인/,
    label => `- 업종 제한, 선 검수, 소재 승인 조건은 상품이나 지면별로 달라질 수 있으므로 광고등록기준과 함께 대조해야 합니다 ${label}.`,
  );

  sections.push('');
  sections.push('정리하면, 우선 유입 목적을 정하고 검색/쇼핑 노출 조건과 등록 기준을 함께 확인하는 흐름이 안전합니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildNaverDisplayAdStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  originalMessage: string,
) {
  if (!isNaverDisplayAdQuestion(originalMessage, intent)) return null;

  const used = new Set<number>();
  const sections = [
    '네이버 DA는 검색 키워드형 상품 하나로 보기보다, 디스플레이 노출 지면과 구매/예약 방식, 소재 조건을 나누어 확인하는 편이 좋습니다.',
    '',
    '1. **확인되는 DA 계열과 지면**',
    '',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /보장형\s*디스플레이|보장형\s*da|스마트채널|타임보드|롤링보드|브랜드\s*보드|메인\s*보드|스페셜\s*da|배너/,
    label => `- 보장형 디스플레이 계열은 정해진 지면이나 노출 구좌를 구매·예약하는 상품군으로 확인됩니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /성과형\s*디스플레이|성과형\s*da|gfa|디스플레이\s*광고|홈피드|배너|브랜딩|전환|타겟팅/,
    label => `- 성과형 디스플레이 계열은 홈피드, 배너 등 지면과 타겟팅/전환 목적을 함께 검토해야 합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /숏폼\s*아웃스트림|아웃스트림|동영상\s*조회|네이버\s*클립|동영상\s*광고|비디오\s*광고/,
    label => `- 동영상형 DA 성격의 상품은 숏폼 아웃스트림, 동영상 조회, 네이버 클립 같은 노출 지면과 소재 길이를 함께 확인해야 합니다 ${label}.`,
  );

  const conditionLines: string[] = [];
  addFallbackLine(
    conditionLines,
    used,
    sources,
    'NAVER',
    /소재\s*(제작|사양|가이드|조건)|이미지\s*비율|동영상\s*비율|사이즈|해상도|파일|용량|텍스트|랜딩/,
    label => `- 실제 집행 전에는 선택한 지면별 이미지/동영상 비율, 파일 용량, 랜딩 조건 같은 소재 사양을 따로 대조해야 합니다 ${label}.`,
  );
  addFallbackLine(
    conditionLines,
    used,
    sources,
    'NAVER',
    /광고등록기준|심사|검수|업종\s*제한|등록\s*불가|제한\s*업종|의료|금융|주류|도박|성인/,
    label => `- 업종 제한이나 선검수 조건은 DA 상품 선택과 별개로 광고등록기준에서 확인해야 합니다 ${label}.`,
  );

  if (conditionLines.length > 0) {
    sections.push('');
    sections.push('2. **집행 전 같이 확인할 조건**');
    sections.push('');
    sections.push(...conditionLines);
  }

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, 네이버 DA는 “검색광고냐 아니냐”보다 보장형/성과형, 노출 지면, 소재 사양, 심사 조건을 함께 묶어서 봐야 합니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildNaverVideoStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  originalMessage: string,
) {
  if (!intent.vendors.includes('NAVER')) return null;
  const queryText = normalizeProductIntentText(originalMessage);
  if (!/동영상|비디오|video|숏폼|아웃스트림|인스트림|클립|조회/.test(queryText)) return null;

  const used = new Set<number>();
  const sections = [
    '네이버 동영상 광고는 노출 지면과 재생 방식에 따라 소재 조건이 달라질 수 있으므로, 먼저 어떤 지면에서 어떤 영상 상품을 쓰는지부터 나누어 확인하는 편이 안전합니다.',
    '',
    '1. **동영상 노출 지면과 상품 성격**',
    '',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /동영상\s*조회|동영상\s*광고|비디오\s*광고|네이버\s*클립|숏폼\s*아웃스트림|아웃스트림|인스트림/,
    label => `- 동영상 조회, 숏폼 아웃스트림, 인스트림/아웃스트림처럼 영상 노출 방식별로 확인해야 하는 상품군이 나뉩니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'NAVER',
    /게재\s*위치|노출\s*지면|지면별|노출되는\s*지면|네이버\s*tv|클립|피드|서비스\s*지면/,
    label => `- 같은 동영상 소재라도 게재 위치와 서비스 지면에 따라 노출 조건이 달라질 수 있습니다 ${label}.`,
  );

  const specLines: string[] = [];
  addFallbackLine(
    specLines,
    used,
    sources,
    'NAVER',
    /영상\s*비율|동영상\s*비율|16:9|9:16|21:9|영상\s*길이|최대\s*\d+\s*(초|분)|용량|mb|해상도|480p|파일|mp4|mov/,
    label => `- 제작 단계에서는 영상 비율, 길이, 용량, 해상도, 파일 형식 같은 소재 사양을 지면별로 확인해야 합니다 ${label}.`,
  );
  addFallbackLine(
    specLines,
    used,
    sources,
    'NAVER',
    /저화질|tv\s*cf|품질|썸네일|텍스트|타이틀|랜딩|심사|검수|승인/,
    label => `- 영상 품질, 썸네일/문구, 랜딩, 심사 조건도 실제 집행 전 확인 대상입니다 ${label}.`,
  );

  if (specLines.length > 0) {
    sections.push('');
    sections.push('2. **제작 전에 확인할 소재 조건**');
    sections.push('');
    sections.push(...specLines);
  }

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, 네이버 동영상 광고는 상품명만 보는 것보다 노출 지면, 재생 방식, 영상 비율·길이·용량 같은 제작 조건을 함께 확인해야 합니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildMetaAppInstallStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  originalMessage: string,
) {
  if (!intent.vendors.includes('META')) return null;
  const queryText = normalizeProductIntentText(originalMessage);
  if (!/앱\s*(인스톨|설치|홍보|캠페인|사전\s*등록|이벤트)|app\s*(install|promotion)|sdk|mmp|트래킹|추적/.test(queryText)) {
    return null;
  }

  const used = new Set<number>();
  const sections = [
    'Meta 앱 인스톨 광고는 “앱 설치를 늘릴 캠페인인지”와 “앱 이벤트를 측정할 준비가 되어 있는지”를 먼저 나누어 확인하는 편이 안전합니다.',
    '',
    '1. **집행 전에 연결할 항목**',
    '',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /앱\s*(홍보|설치|인스톨)|app\s*(promotion|install)|앱\s*광고|모바일\s*앱/,
    label => `- 앱 설치나 앱 내 행동을 늘리려면 앱 홍보/App Promotion 계열 목표와 캠페인 설정을 먼저 확인해야 합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /앱\s*등록|app\s*id|app\s*secret|비즈니스\s*설정|광고\s*계정|권한|스토어|store/,
    label => `- 앱 등록, App ID/App Secret, 광고 계정 권한, 앱스토어/플레이스토어 연결 상태를 함께 점검해야 합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /sdk|mmp|모바일\s*측정\s*파트너|앱\s*이벤트|이벤트\s*추적|포스트백|postback|skadnetwork|skan|트래킹|추적/,
    label => `- SDK, MMP, 앱 이벤트, 포스트백처럼 설치와 인앱 행동을 측정하는 연결 항목은 집행 전에 확인해야 합니다 ${label}.`,
  );

  const creativeLines: string[] = [];
  addFallbackLine(
    creativeLines,
    used,
    sources,
    'META',
    /소재|광고\s*콘텐츠|이미지|동영상|카피|문구|cta|랜딩|스토어|심사|검토|정책/,
    label => `- 소재와 문구는 앱 스토어 랜딩, CTA, 광고 콘텐츠 정책과 함께 검토하는 것이 좋습니다 ${label}.`,
  );
  addFallbackLine(
    creativeLines,
    used,
    sources,
    'META',
    /앱\s*설치\s*대신\s*링크\s*클릭|링크\s*클릭|최적화|앱\s*이벤트\s*데이터|측정/,
    label => `- 앱 이벤트나 SDK 연결이 충분하지 않으면 설치가 아니라 링크 클릭 중심으로 최적화될 수 있으므로 측정 설정을 먼저 확인해야 합니다 ${label}.`,
  );
  if (creativeLines.length === 0 && /소재|문구|카피|이미지|동영상|랜딩|cta|스토어/.test(queryText)) {
    addFallbackLine(
      creativeLines,
      used,
      sources,
      'META',
      /앱\s*(홍보|설치|인스톨)|app\s*(promotion|install)|광고|캠페인|정책|스토어|store/,
      label => `- 소재·문구·랜딩은 앱 홍보 캠페인 설정과 별도로, 실제 게재 전 광고 콘텐츠 정책과 앱스토어 이동 경로를 함께 확인하는 것이 좋습니다 ${label}.`,
    );
  }

  if (creativeLines.length > 0) {
    sections.push('');
    sections.push('2. **소재·최적화에서 주의할 점**');
    sections.push('');
    sections.push(...creativeLines);
  }

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, 앱 홍보 목표를 고른 뒤 앱 등록/권한, SDK 또는 MMP 이벤트 측정, 스토어 랜딩과 소재 정책을 함께 확인하는 흐름이 안전합니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildMetaProductOverviewStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  isBroadProductStructureLlmIntent: boolean,
  originalMessage: string,
) {
  if (!intent.vendors.includes('META')) return null;

  const asksMetaProductOverview = isBroadProductStructureLlmIntent
    || isProductCatalogOverviewQuestion(originalMessage);
  if (!asksMetaProductOverview) return null;

  const used = new Set<number>();
  const sections = [
    'Meta 광고는 캠페인 목표를 먼저 정하고, 그 목표에 맞는 노출 형식과 운영 기능을 조합해 설계하는 구조로 보는 것이 좋습니다.',
    '',
    '1. **캠페인 목표부터 정하기**',
    '',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /인지도[\s\S]{0,120}트래픽[\s\S]{0,120}참여[\s\S]{0,120}잠재\s*고객[\s\S]{0,120}앱\s*홍보[\s\S]{0,120}판매|캠페인\s*목표|광고\s*관리자\s*목표|objective/i,
    label => `- Meta 광고 관리자에서는 인지도, 트래픽, 참여, 잠재 고객, 앱 홍보, 판매처럼 목적별 캠페인 목표를 먼저 고릅니다 ${label}.`,
  );

  const formatLines: string[] = [];
  addFallbackLine(
    formatLines,
    used,
    sources,
    'META',
    /이미지[\s\S]{0,80}동영상[\s\S]{0,80}슬라이드|카루셀|carousel|collection|컬렉션|광고\s*형식|ad\s*format/i,
    label => `- 광고 형식은 이미지, 동영상, 슬라이드/카루셀, 컬렉션처럼 메시지를 보여주는 방식에 따라 나누어 확인합니다 ${label}.`,
  );
  addFallbackLine(
    formatLines,
    used,
    sources,
    'META',
    /facebook|instagram|messenger|audience\s*network|페이스북|인스타그램|게재\s*위치|노출\s*위치|placement/i,
    label => `- Facebook, Instagram 등 노출 위치에 따라 사용할 수 있는 형식과 세부 사양이 달라질 수 있습니다 ${label}.`,
  );
  if (formatLines.length > 0) {
    sections.push('', '2. **목표에 맞는 광고 형식과 노출 위치 확인하기**', '', ...formatLines);
  }

  const operationLines: string[] = [];
  addFallbackLine(
    operationLines,
    used,
    sources,
    'META',
    /앱\s*(홍보|설치|인스톨|캠페인)|app\s*(promotion|install)|앱\s*광고/i,
    label => `- 앱 설치나 앱 내 행동을 늘리는 목적이면 앱 홍보/App Promotion 계열 목표와 앱 광고 조건을 확인합니다 ${label}.`,
  );
  addFallbackLine(
    operationLines,
    used,
    sources,
    'META',
    /카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지/i,
    label => `- 상품 카탈로그나 여러 상품을 묶어 보여주는 운영이라면 카탈로그, 컬렉션, Advantage+ 관련 조건을 별도로 확인합니다 ${label}.`,
  );
  addFallbackLine(
    operationLines,
    used,
    sources,
    'META',
    /리드\s*양식|잠재\s*고객|lead\s*form|lead\s*generation|비즈니스\s*폼/i,
    label => `- 상담 신청이나 연락처 수집이 목적이면 잠재 고객/리드 양식 계열 조건을 확인합니다 ${label}.`,
  );
  if (operationLines.length > 0) {
    sections.push('', `${formatLines.length > 0 ? '3' : '2'}. **운영 기능이 필요한지 확인하기**`, '', ...operationLines);
  }

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, 먼저 캠페인 목표를 정하고, 그 목표에 맞는 광고 형식과 노출 위치를 고른 뒤 앱·카탈로그·리드 같은 운영 기능이 필요한지 확인하면 됩니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildKakaoProductStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
) {
  if (!intent.vendors.includes('KAKAO')) return null;

  const combinedText = sources.map(getFallbackSourceText).join(' ');
  const queryText = normalizeEvidenceText([
    ...intent.keywords,
    ...intent.strictProductTerms,
    ...intent.strictContextTerms,
  ].join(' '));
  const asksBizboardOrDisplay = /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|biz\s*board|talkboard|디스플레이|display|상품\s*가이드|상품가이드|제작\s*가이드|제작가이드|소재|지면|노출/.test(`${combinedText} ${queryText}`);
  if (!asksBizboardOrDisplay) return null;

  const used = new Set<number>();
  const productLines: string[] = [];
  const creativeLines: string[] = [];
  const auditLines: string[] = [];
  const sections = [
    '카카오 광고는 상품명만 고르는 방식보다, 노출 지면과 제작·심사 기준을 함께 확인하는 방식으로 보는 것이 안전합니다.',
  ];

  addFallbackLine(
    productLines,
    used,
    sources,
    'KAKAO',
    /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드|talkboard|카카오\s*주요\s*지면|카카오모먼트|상품가이드|상품\s*가이드/,
    label => `- 비즈보드/톡보드 계열은 카카오 주요 지면 노출 상품으로, 상품가이드에서 노출 지면과 진행 조건을 먼저 확인합니다 ${label}.`,
  );
  addFallbackLine(
    productLines,
    used,
    sources,
    'KAKAO',
    /디스플레이\s*광고|디스플레이광고|displayad|display\s*ad|노출\s*지면|지면/,
    label => `- 디스플레이 광고는 노출 지면과 소재 형식이 함께 달라질 수 있으므로 지면별 조건을 분리해서 확인합니다 ${label}.`,
  );

  addFallbackLine(
    creativeLines,
    used,
    sources,
    'KAKAO',
    /제작\s*가이드|제작가이드|홍보이미지|행동유도버튼|닫힘버튼|메인\s*카피|서브\s*카피|이미지\s*세부\s*가이드|외곽\s*테두리|리사이징|비율|사이즈|타이틀|소재\s*조건/,
    label => `- 소재 제작 단계에서는 홍보이미지, 버튼/문구 영역, 이미지 비율·리사이징 같은 제작 조건을 확인해야 합니다 ${label}.`,
  );

  addFallbackLine(
    auditLines,
    used,
    sources,
    'KAKAO',
    /심사\s*가이드|집행\s*기준|광고\s*가능\s*업종|등록\s*불가|금지\s*행위|소재\s*제한|업종\s*제한|연령\s*제한|주류|담배|사행성|카카오\s*서비스|디자인\s*모방|오인|ai\s*생성물|허위|과장/,
    label => `- 업종 제한, 금지 행위, 카카오 서비스 오인, 허위·과장 가능성은 상품 선택과 별개로 심사 기준에서 확인해야 합니다 ${label}.`,
  );

  if (used.size === 0) return null;

  let sectionNumber = 1;
  if (productLines.length > 0) {
    sections.push('', `${sectionNumber}. **상품/지면 먼저 구분하기**`, '', ...productLines);
    sectionNumber += 1;
  }
  if (creativeLines.length > 0) {
    sections.push('', `${sectionNumber}. **소재 제작 기준 확인하기**`, '', ...creativeLines);
    sectionNumber += 1;
  }
  if (auditLines.length > 0) {
    sections.push('', `${sectionNumber}. **심사·업종 제한 같이 보기**`, '', ...auditLines);
  }

  sections.push('');
  sections.push('정리하면, 먼저 비즈보드/디스플레이처럼 노출 지면을 정하고, 그 지면의 제작가이드와 심사가이드를 함께 대조하는 흐름이 안전합니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildGoogleLeadStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  originalMessage?: string,
) {
  if (!intent.vendors.includes('GOOGLE')) return null;

  const queryText = normalizeEvidenceText(
    originalMessage
      ? originalMessage
      : [
          ...intent.keywords,
          ...intent.strictProductTerms,
        ].join(' ')
  );
  if (!/리드\s*양식|잠재\s*고객|lead\s*form|lead\s*generation/.test(queryText)) return null;

  const used = new Set<number>();
  const sections = [
    'Google Ads 리드 양식은 잠재고객 정보를 받는 기능이므로, 캠페인 추가 가능 여부와 개인정보 관련 문구를 함께 확인하는 편이 안전합니다.',
    '',
    '1. **사용 가능한 캠페인과 적용 범위 확인**',
    '',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'GOOGLE',
    /리드\s*양식|lead\s*form|검색|동영상|실적\s*최대화|performance\s*max|디스플레이|캠페인에\s*추가/,
    label => `- 리드 양식은 검색, 동영상, 실적 최대화, 디스플레이 등 캠페인에 추가 가능 여부를 먼저 확인해야 합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'GOOGLE',
    /동영상\s*캠페인.*리드\s*양식|베타|google\s*담당자|문의/,
    label => `- 동영상 캠페인의 리드 양식처럼 베타 또는 담당자 확인이 필요한 항목은 계정별 사용 가능 여부를 별도로 확인해야 합니다 ${label}.`,
  );

  sections.push('');
  sections.push('2. **주의해야 할 정책·소재 조건**');
  sections.push('');
  addFallbackLine(
    sections,
    used,
    sources,
    'GOOGLE',
    /개인정보|동의|고지|양식\s*제출|개인\s*정보|정책|검토|승인|심사/,
    label => `- 리드 수집은 개인정보 고지, 동의, 양식 제출 조건과 연결되므로 정책 문구를 원문 기준으로 확인해야 합니다 ${label}.`,
  );

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, 리드 양식은 “소재 사양”만 볼 것이 아니라 캠페인 적용 가능 여부, 계정별 사용 가능 여부, 개인정보 수집 조건을 함께 확인해야 합니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildGoogleProductOverviewStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  isBroadProductStructureLlmIntent: boolean,
  originalMessage: string,
) {
  if (!intent.vendors.includes('GOOGLE')) return null;

  const asksGoogleProductOverview = isBroadProductStructureLlmIntent
    || isProductCatalogOverviewQuestion(originalMessage);
  if (!asksGoogleProductOverview) return null;

  const used = new Set<number>();
  const sections = [
    'Google Ads는 상품명을 하나만 고르는 구조라기보다, 캠페인 유형과 애셋, 확장 소재, 측정 설정을 조합해 운영하는 구조로 보는 편이 좋습니다.',
    '',
    '1. **목적에 맞는 캠페인 유형 확인하기**',
    '',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'GOOGLE',
    /검색\s*캠페인|검색\s*광고|search\s*campaign|search\s*ads/i,
    label => `- 검색 캠페인은 검색 결과에서 수요가 있는 사용자에게 노출할 때 확인합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'GOOGLE',
    /디스플레이\s*캠페인|반응형\s*디스플레이|display\s*campaign|gdn/i,
    label => `- 디스플레이 캠페인은 배너·반응형 디스플레이처럼 지면 노출을 다룰 때 확인합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'GOOGLE',
    /쇼핑\s*(광고|캠페인)|shopping\s*(ads?|campaign)/i,
    label => `- 쇼핑 광고는 상품 피드와 쇼핑 지면 노출을 함께 다룰 때 확인합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'GOOGLE',
    /앱\s*(캠페인|설치|홍보)|app\s*(campaign|install|promotion)/i,
    label => `- 앱 캠페인은 앱 설치나 앱 내 행동을 유도할 때 확인합니다 ${label}.`,
  );

  const assetLines: string[] = [];
  addFallbackLine(
    assetLines,
    used,
    sources,
    'GOOGLE',
    /리드\s*양식|lead\s*form|확장\s*소재|asset/i,
    label => `- 리드 양식이나 확장 소재는 상담 신청·연락처 수집처럼 추가 정보를 받을 때 별도로 확인합니다 ${label}.`,
  );
  addFallbackLine(
    assetLines,
    used,
    sources,
    'GOOGLE',
    /이미지\s*확장|이미지\s*소재|동영상|youtube|유튜브|video/i,
    label => `- 이미지·동영상 소재는 노출 지면과 캠페인 유형에 맞는 애셋 조건을 함께 확인합니다 ${label}.`,
  );
  if (assetLines.length > 0) {
    sections.push('', '2. **애셋과 확장 소재 확인하기**', '', ...assetLines);
  }

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, 먼저 검색·디스플레이·쇼핑·앱 중 목적에 맞는 캠페인 유형을 정하고, 필요한 애셋과 확장 소재 조건을 원문 기준으로 대조하면 됩니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);

  return sections.join('\n');
}

function buildStructuredLlmFailureFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  isBroadProductStructureLlmIntent: boolean,
  originalMessage: string,
) {
  const canUseBroadOverviewFallback = isBroadProductStructureLlmIntent
    || isProductCatalogOverviewQuestion(originalMessage);

  return (
    buildMetaAppInstallStructuredFallbackAnswer(sources, intent, originalMessage)
    || buildNaverShoppingSearchCreativeGuideStructuredFallbackAnswer(sources, intent, originalMessage)
    || buildNaverShoppingDataStructuredFallbackAnswer(sources, intent, originalMessage)
    || buildNaverDisplayAdStructuredFallbackAnswer(sources, intent, originalMessage)
    || buildNaverVideoStructuredFallbackAnswer(sources, intent, originalMessage)
    || buildKakaoProductStructuredFallbackAnswer(sources, intent)
    || buildGoogleLeadStructuredFallbackAnswer(sources, intent, originalMessage)
    || (canUseBroadOverviewFallback
      ? buildMetaProductOverviewStructuredFallbackAnswer(sources, intent, isBroadProductStructureLlmIntent, originalMessage)
      : null)
    || (canUseBroadOverviewFallback
      ? buildNaverProductOverviewStructuredFallbackAnswer(sources, intent, isBroadProductStructureLlmIntent, originalMessage)
      : null)
    || (canUseBroadOverviewFallback
      ? buildGoogleProductOverviewStructuredFallbackAnswer(sources, intent, isBroadProductStructureLlmIntent, originalMessage)
      : null)
  );
}

function buildFallbackFocusTerms(message: string, intent: QueryIntent) {
  const terms = new Set<string>();
  [
    ...intent.strictContextTerms,
    ...intent.strictProductTerms,
    ...intent.adPolicyTerms,
    ...intent.keywords,
    ...message.split(/[\s,./!?()[\]{}'"“”‘’]+/),
  ]
    .map(term => String(term || '').trim())
    .filter(term => term.length >= 2 && !/^(광고|상품|유형|종류|알려줘|알려|설명|정리|기준|가이드|문의|확인|네이버|naver|meta|메타|google|구글|kakao|카카오)$/i.test(term))
    .forEach(term => terms.add(term));

  return Array.from(terms).slice(0, 18);
}

function stripFallbackBoilerplate(text: string) {
  return cleanEvidenceExcerpt(text)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b(?:STEP|Step|step)\s*\d+\.?/g, ' ')
    .replace(/이전\s*화면|화면\s*공유하기|공유하기|저장하기|목록보기|닫기|접기|펼치기/gi, ' ')
    .replace(/상품소식\s*\d*\s*분?/g, ' ')
    .replace(/이전\s*다음|전체\s*보기|자세히\s*보기|바로가기|카테고리\s*도움말|주소\s*복사|출력하기|검색어\s*입력\s*창|탭메뉴\s*열기|메뉴\s*열기/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function insertFallbackSemanticBreaks(text: string) {
  return text
    .replace(/(가능합니다|됩니다|있습니다|합니다|하세요|입니다|아닙니다|수\s*있습니다|확인하세요|선택하세요)(?=[가-힣A-Za-z0-9])/g, '$1\n')
    .replace(/(TIP|알아두세요|상세보기|더\s*알아보기|자주\s*묻는\s*질문|광고\s*시작하기|교육\s*영상\s*보기)(?=[가-힣A-Za-z0-9])/g, '\n$1\n')
    .replace(/(?<!^)(?=(사이트검색광고|쇼핑검색광고|쇼핑블록|비즈보드|톡보드|디스플레이\s*광고|성과형\s*디스플레이|브랜드검색|콘텐츠검색|플레이스광고|앱\s*광고|컬렉션\s*광고|카루셀\s*광고|동영상\s*광고|이미지\s*광고)\b)/g, '\n')
    .replace(/(?=(노출지면|과금방식|소재\s*사양|제작\s*가이드|상품\s*등록|등록요청|상품정보\s*수신\s*현황|카테고리\s*자동매칭|캠페인\s*목표|광고\s*목표|광고\s*관리자)\b)/g, '\n')
    .replace(/\n{2,}/g, '\n');
}

function splitFallbackEvidenceSentences(text: string) {
  const cleaned = insertFallbackSemanticBreaks(stripFallbackBoilerplate(text));
  if (!cleaned) return [];

  return cleaned
    .replace(/(다\.|니다\.|요\.|함\.|됨\.|[.!?。])\s*/g, '$1\n')
    .split(/\n|[•●▪■▶◆]+|\s+-\s+/)
    .map(sentence => sentence.replace(/^[\s\d.)]+/, '').trim())
    .filter(sentence => sentence.length >= 18)
    .map(sentence => (sentence.length > 180 ? `${sentence.slice(0, 180).trim()}...` : sentence));
}

function extractFallbackSourceTags(text: string) {
  const tags = Array.from(new Set(
    Array.from(String(text || '').matchAll(/#\s*([가-힣A-Za-z0-9+_.-]{2,30})/g))
      .map(match => match[1]?.trim())
      .filter(Boolean) as string[],
  ));

  return tags.slice(0, 8);
}

function isMostlyEnglishFallbackFragment(sentence: string) {
  const koreanCount = (sentence.match(/[가-힣]/g) || []).length;
  const englishCount = (sentence.match(/[A-Za-z]/g) || []).length;
  return englishCount >= 35 && koreanCount < 12;
}

function isFallbackNavigationOrChromeNoise(sentence: string) {
  return (
    /https?:\/\/|카테고리\s*도움말|주소\s*복사|출력하기|검색어\s*입력\s*창|이전\s*화면|화면\s*공유|목록보기|저장하기|전체\s*보기|자세히\s*보기|바로가기|탭메뉴\s*열기|메뉴\s*열기/i.test(sentence)
    || /\b(?:STEP|Step|step)\s*\d+/.test(sentence)
    || /네이버\s*광고\s*가이드\s*:/i.test(sentence)
    || /도움말\s*홈|광고시스템|고객센터|copyright/i.test(sentence)
    || /^(해당 출처에서 확인한 관련 정책입니다|원문 세부 기준은 출처를 함께 확인하세요)/.test(sentence)
    || /조회\s*\d+\s*최종\s*수정일|최종\s*수정일\s*\d{4}/.test(sentence)
    || /ADVoost[\s\S]{0,80}쇼핑인지도|웹사이트\s*전환앱\s*전환|쇼핑\s*소식동영상\s*조회/.test(sentence)
    || (sentence.length > 140 && /탭|메뉴|열기|닫기|전체|도움말/.test(sentence))
  );
}

function isNaverDisplayAdQuestion(message: string, intent: QueryIntent) {
  const normalized = normalizeProductIntentText(message);
  return intent.vendors.includes('NAVER') && /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|디스플레이\s*광고|성과형\s*디스플레이|보장형\s*da|스마트채널|타임보드|롤링보드|홈피드|배너/.test(normalized);
}

function isFallbackOffTopicForMessage(sentence: string, message: string, intent: QueryIntent) {
  const normalizedSentence = normalizeProductIntentText(sentence);
  const normalizedMessage = normalizeProductIntentText(message);
  const asksTrackingOrPrivacy = /전환|추적|픽셀|sdk|mmp|이벤트|개인정보|동의|태그|측정|tracking|conversion|privacy|쿠키|행태/.test(normalizedMessage);
  if (!asksTrackingOrPrivacy && /전환\s*추적|개인정보|행태\s*정보|쿠키|동의|tracking|conversion|privacy|google\s*태그|woocommerce|wordpress|connect\s*\(/i.test(normalizedSentence)) {
    return true;
  }

  if (isNaverDisplayAdQuestion(message, intent)) {
    const hasDisplayDetail = /da|디스플레이|성과형|보장형|스마트채널|타임보드|롤링보드|홈피드|배너|지면|노출|소재|사이즈|과금|구매|예약|보장|집행|등록|심사/.test(normalizedSentence);
    if (!hasDisplayDetail) return true;
    if (!asksTrackingOrPrivacy && /전환\s*추적|개인정보|행태\s*정보|쿠키|동의/.test(normalizedSentence)) {
      return true;
    }
  }

  return false;
}

function compactFallbackFactAroundFocus(sentence: string, focusTerms: string[]) {
  const compact = sentence.replace(/\s+/g, ' ').trim();
  if (compact.length <= 170) return compact;

  const normalized = normalizeProductIntentText(compact);
  const normalizedTerms = focusTerms.map(term => normalizeProductIntentText(term)).filter(term => term.length >= 2);
  const hit = normalizedTerms.find(term => normalized.includes(term));
  if (!hit) return `${compact.slice(0, 170).trim()}...`;

  const rawIndex = compact.toLowerCase().indexOf(hit.toLowerCase());
  const index = rawIndex >= 0 ? rawIndex : Math.max(0, Math.floor(compact.length / 2) - 45);
  const start = Math.max(0, index - 55);
  const end = Math.min(compact.length, index + 115);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < compact.length ? '...' : '';
  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

type SourceGuidedFallbackSectionKey =
  | 'overview'
  | 'setup'
  | 'creative'
  | 'policy'
  | 'issue'
  | 'uncategorized';

type SourceGuidedFallbackFact = {
  text: string;
  citation: string;
  normalized: string;
  section: SourceGuidedFallbackSectionKey;
  score: number;
  sourceIndex: number;
};

function getSourceGuidedFallbackProfile(
  message: string,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
  isBroadProductStructureLlmIntent: boolean,
) {
  const vendorLabel = intent.vendors.map(vendor => VENDOR_LABELS[vendor] || vendor).join(', ') || '해당 매체';
  const productLabel = intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(message)
    ? getSpecificProductLabel(intent)
    : '광고 상품';
  const mode = scope.mode;
  const asksSpecificProduct = intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(message);
  const normalizedMessage = normalizeProductIntentText(message);
  const asksChoice = /고르|선택|구분|종류|유형|상품|목표|기준/.test(normalizedMessage);

  if (mode === 'db_setup') {
    return {
      intro: `${vendorLabel} ${productLabel}는 상품 정보 등록과 DB/EP 연동 상태를 먼저 확인하는 질문으로 정리하는 것이 맞습니다.`,
      sections: [
        ['setup', '등록·연동 절차'] as const,
        ['policy', '운영 전 확인할 조건'] as const,
        ['issue', '막히는 지점'] as const,
        ['uncategorized', '추가로 확인된 근거'] as const,
      ],
      closing: '정리하면, 상품 DB URL 또는 EP가 실제로 수신되는지, 상품 정보가 매체 기준에 맞게 매칭되는지, 심사나 승인 조건이 별도로 필요한지 순서대로 확인하세요.',
    };
  }

  if (mode === 'setup_procedure' || mode === 'execution_guide') {
    return {
      intro: `${vendorLabel} ${productLabel}는 집행 전에 설정, 연동, 소재 조건을 나눠 확인하는 편이 안전합니다.`,
      sections: [
        ['setup', '준비·설정 절차'] as const,
        ['creative', '소재·랜딩 조건'] as const,
        ['policy', '심사 전 확인 기준'] as const,
        ['issue', '오류·반려 시 확인'] as const,
        ['uncategorized', '추가로 확인된 근거'] as const,
      ],
      closing: '정리하면, 먼저 계정과 연동 상태를 확인하고, 그다음 소재·랜딩·심사 조건을 원문 기준으로 대조하는 흐름이 좋습니다.',
    };
  }

  if (mode === 'creative_guide') {
    return {
      intro: `${vendorLabel} ${productLabel} 소재는 지면별 규격과 심사 조건을 분리해서 확인해야 합니다.`,
      sections: [
        ['creative', '소재 제작 기준'] as const,
        ['overview', '적용 지면·상품'] as const,
        ['policy', '심사 전 주의사항'] as const,
        ['uncategorized', '추가로 확인된 근거'] as const,
      ],
      closing: '정리하면, 제작 전에는 노출 지면, 이미지·영상 규격, 문구와 랜딩 조건을 같은 출처 기준으로 함께 확인하세요.',
    };
  }

  if (mode === 'policy_screening') {
    return {
      intro: `${vendorLabel} ${productLabel} 정책 질문은 심사 기준과 제한 조건을 먼저 분리해서 보는 것이 안전합니다.`,
      sections: [
        ['policy', '심사 전 확인할 정책'] as const,
        ['creative', '소재·표현 주의사항'] as const,
        ['setup', '운영 전 준비 조건'] as const,
        ['uncategorized', '추가로 확인된 근거'] as const,
      ],
      closing: '정리하면, 근거에서 직접 확인되는 제한 조건만 반영하고, 업종·계정·랜딩 예외는 원문 또는 담당자 확인으로 남겨두는 것이 안전합니다.',
    };
  }

  if (mode === 'operational_issue') {
    return {
      intro: `${vendorLabel} ${productLabel} 이슈는 오류 문구, 계정·연동 상태, 매체 심사 기준을 같이 대조해야 합니다.`,
      sections: [
        ['issue', '확인된 이슈 단서'] as const,
        ['setup', '점검 순서'] as const,
        ['policy', '정책·심사 확인'] as const,
        ['uncategorized', '추가로 확인된 근거'] as const,
      ],
      closing: '정리하면, 오류 메시지와 캠페인 설정값을 먼저 맞춰 보고, 같은 조건에서 재현되는지 확인한 뒤 매체 담당자 확인으로 넘기는 흐름이 좋습니다.',
    };
  }

  const intro = asksSpecificProduct
    ? `${vendorLabel} ${productLabel}는 공식 근거에서 확인되는 상품 특징과 운영 조건을 나눠 정리할 수 있습니다.`
    : (isBroadProductStructureLlmIntent || asksChoice
      ? `${vendorLabel} 광고 상품은 먼저 목적과 노출 지면을 정하고, 그에 맞는 상품·소재 조건을 확인하는 구조로 보는 것이 좋습니다.`
      : `${vendorLabel} 광고 관련 근거에서 확인되는 내용을 질문 범위에 맞춰 정리합니다.`);

  return {
    intro,
    sections: [
      ['overview', '상품·지면 구조'] as const,
      ['setup', '운영 전 확인할 조건'] as const,
      ['creative', '소재·노출 조건'] as const,
      ['policy', '심사·제한 기준'] as const,
      ['uncategorized', '추가로 확인된 근거'] as const,
    ],
    closing: asksChoice
      ? '정리하면, 먼저 달성하려는 목적을 정하고, 확인된 상품·지면·소재 조건을 원문 기준으로 대조한 뒤 집행 여부를 판단하는 흐름이 안전합니다.'
      : '정리하면, 확인된 근거 안에서 상품·지면·소재·심사 조건을 나눠 보고, 출처에 없는 세부 설정값은 별도 확인 대상으로 남겨두면 됩니다.',
  };
}

function classifySourceGuidedFallbackSection(
  sentence: string,
  source: ReturnType<typeof buildVerifiedSources>[number],
  message: string,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
): Pick<SourceGuidedFallbackFact, 'section' | 'score'> {
  const text = normalizeProductIntentText([
    sentence,
    source.title,
    source.originalTitle,
  ].filter(Boolean).join(' '));
  const normalizedMessage = normalizeProductIntentText(message);
  let section: SourceGuidedFallbackSectionKey = 'uncategorized';
  let score = 0;

  const setupHit = /등록|절차|방법|세팅|설정|연동|sdk|mmp|트래킹|추적|이벤트|계정|권한|픽셀|카탈로그|db\s*url|dburl|상품\s*db|상품db|ep|피드|feed|쇼핑파트너센터|상품정보|수신|connect|app\s*id|app\s*secret/i.test(text);
  const creativeHit = /소재|제작|이미지|동영상|배너|문구|카피|사양|스펙|규격|비율|사이즈|파일|해상도|썸네일|텍스트|랜딩|url|cta|길이|초/.test(text);
  const policyHit = /정책|심사|검수|검토|주의|유의|제한|금지|승인|반려|가능\s*여부|업종|개인정보|차별|허위|과장|청소년|성인|주류|담배|사행|금융/.test(text);
  const issueHit = /오류|에러|문제|해결|원인|조치|불일치|미승인|거절|실패|막힘|tracking_specs|수정|재심사/.test(text);
  const overviewHit = /상품|지면|노출|목표|캠페인|검색|쇼핑|비즈보드|디스플레이|톡보드|스마트채널|타임보드|홈피드|리드|앱\s*홍보|앱\s*인스톨|인지도|트래픽|참여|판매|컬렉션|카루셀/.test(text);

  if (issueHit) {
    section = 'issue';
    score += 8;
  } else if ((scope.mode === 'policy_screening' && policyHit) || (policyHit && normalizedMessage.match(/정책|심사|주의|제한|금지|승인|꼭\s*확인/))) {
    section = 'policy';
    score += 8;
  } else if ((scope.mode === 'creative_guide' && creativeHit) || creativeHit) {
    section = 'creative';
    score += scope.mode === 'creative_guide' ? 8 : 5;
  } else if ((scope.mode === 'setup_procedure' || scope.mode === 'execution_guide' || scope.mode === 'db_setup') && setupHit) {
    section = 'setup';
    score += 8;
  } else if (setupHit) {
    section = 'setup';
    score += 5;
  } else if (overviewHit || intent.topics.includes('product_structure')) {
    section = 'overview';
    score += 4;
  }

  if (scope.mode === 'db_setup' && /db\s*url|dburl|상품\s*db|상품db|ep|피드|feed|상품정보|수신|등록/.test(text)) score += 8;
  if (scope.mode === 'operational_issue' && issueHit) score += 8;
  if (source.retrievalMethod === 'graph' || source.evidenceType === 'graph' || source.corpus === 'evidence_graph') score += 4;
  if (source.evidenceDecision === 'verified') score += 2;

  return { section, score };
}

function getFallbackProductLabelFromSource(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceText = `${source.title || ''} ${source.originalTitle || ''}`;
  const knownProductMatch = sourceText.match(/(사이트검색광고|쇼핑검색광고\s*상품형|쇼핑검색광고|쇼핑블록|비즈보드|톡보드|성과형\s*디스플레이|디스플레이\s*광고|스마트채널|타임보드|롤링보드|홈피드|리드\s*양식|앱\s*광고|앱\s*홍보|앱\s*인스톨|컬렉션\s*광고|카탈로그\s*컬렉션\s*광고|카루셀\s*광고|동영상\s*광고|이미지\s*광고|검색\s*캠페인|쇼핑\s*광고|앱\s*캠페인)/i);
  return knownProductMatch?.[1]?.replace(/\s+/g, ' ').trim() || '';
}

function formatSourceGuidedFallbackFactText(
  fact: string,
  source: ReturnType<typeof buildVerifiedSources>[number],
  section: SourceGuidedFallbackSectionKey,
) {
  const productLabel = getFallbackProductLabelFromSource(source);
  const cleanedFact = fact
    .replace(/^TIP\.?\s*/i, '')
    .replace(/^(더\s*알아보기|상세보기|알아두세요)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!productLabel || section === 'policy' || section === 'issue') {
    return cleanedFact;
  }

  const normalizedFact = normalizeProductIntentText(cleanedFact);
  const normalizedLabel = normalizeProductIntentText(productLabel);
  if (normalizedFact.startsWith(normalizedLabel)) return cleanedFact;

  return `${productLabel}: ${cleanedFact}`;
}

function rewriteKnownSourceGuidedFallbackFact(
  fact: string,
  source: ReturnType<typeof buildVerifiedSources>[number],
) {
  const text = normalizeEvidenceText([
    source.title,
    source.originalTitle,
    source.excerpt,
    source.matchText,
    fact,
  ].filter(Boolean).join(' '));
  const sourceTitle = normalizeEvidenceText(`${source.title || ''} ${source.originalTitle || ''}`);

  if (/meta|facebook|instagram|페이스북|인스타그램/.test(text)) {
    if (/인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재\s*고객[\s\S]{0,80}앱\s*홍보[\s\S]{0,80}판매/.test(text)) {
      return 'Meta 광고 관리자: 캠페인 목표는 인지도, 트래픽, 참여, 잠재 고객, 앱 홍보, 판매 6가지로 확인됩니다.';
    }
    if (/앱\s*홍보\s*목표|다운로드할\s*가능성이\s*가장\s*높은\s*사람|새로운\s*사용자\s*찾기/.test(text)) {
      return '앱 홍보 목표: 앱 스토어에서 앱을 다운로드할 가능성이 높은 사람을 대상으로 광고할 때 선택합니다.';
    }
    if (/어드밴티지\+?\s*앱\s*캠페인|advantage\+?\s*app/i.test(text)) {
      return '앱 캠페인: Meta 광고 관리자에서 Meta 어드밴티지+ 앱 캠페인을 만들 수 있습니다.';
    }
    if (/앱\s*광고[\s\S]{0,120}facebook[\s\S]{0,80}messenger[\s\S]{0,80}instagram[\s\S]{0,80}audience\s*network/i.test(text)) {
      return '앱 광고: Facebook, Messenger, Instagram, Audience Network에서 앱을 홍보할 수 있습니다.';
    }
    if (/컬렉션\s*형식[\s\S]{0,80}2026년\s*3월|2026년\s*3월[\s\S]{0,80}컬렉션\s*형식/.test(text)) {
      return '컬렉션 광고: 2026년 3월부터 광고 설정에 컬렉션 형식이 더 이상 표시되지 않는다고 안내되어 있습니다.';
    }
    if (/이미지[\s\S]{0,30}동영상[\s\S]{0,30}슬라이드[\s\S]{0,30}컬렉션/.test(text)) {
      return '광고 형식: 공식 가이드에서는 이미지, 동영상, 슬라이드, 컬렉션 형식을 함께 확인할 수 있습니다.';
    }
  }

  if (/naver|네이버/.test(text)) {
    if (/쇼핑검색광고\s*상품형/.test(sourceTitle) && /가격비교\s*카테고리|상품등록|상품\s*등록|서비스\s*가능\s*상태/.test(text)) {
      return '쇼핑검색광고 상품형: 상품을 네이버 가격비교 카테고리에 맞추고, 서비스 가능 상태가 되면 가격비교 노출과 쇼핑검색광고 상품등록이 가능합니다.';
    }
    if (/사이트검색광고/.test(sourceTitle) && /파워링크|키워드\s*검색|cpc|클릭당\s*과금|통합검색/.test(text)) {
      return '사이트검색광고: 키워드 검색 시 PC·모바일 통합검색과 네이버 서비스 영역 등에 노출되는 파워링크 유형의 검색광고입니다.';
    }
    if (/사이트검색광고/.test(sourceTitle) && /내\s*웹사이트|웹사이트\s*방문|검색\s*상단|검색\s*이용자|트래픽/.test(text)) {
      return '사이트검색광고: 키워드 검색 이용자를 웹사이트 방문으로 유도하는 데 쓰는 검색광고입니다.';
    }
    if (/사이트검색광고/.test(sourceTitle) && /반응형\s*소재|제목\s*1개|최대\s*15개의\s*제목|최대\s*3개의\s*제목/.test(text)) {
      return '사이트검색광고 소재: 반응형 소재는 여러 제목·설명을 조합해 PC·모바일 환경에 맞는 소재를 자동 노출하는 방식입니다.';
    }
    if (/쇼핑블록|쇼핑\s*블록/.test(text)) {
      return '쇼핑블록/쇼핑 지면: 네이버 PC·모바일 쇼핑 지면에서 쇼핑몰 유입이나 브랜딩 목적을 검토할 때 확인하는 영역입니다.';
    }
    if (/디지털\s*옥외광고|플레이스\s*노출\s*업종|등록\s*불가\s*업종/.test(text)) {
      return '디지털 옥외광고: 네이버 플레이스 노출 업종과 등록 불가 업종을 함께 확인해야 합니다.';
    }
  }

  if (/google|구글|youtube|유튜브/.test(text)) {
    if (/리드\s*양식|lead\s*form/i.test(text)) {
      return '리드 양식 확장 소재: 상담 신청이나 연락처 수집처럼 잠재 고객 정보를 받을 때 사용하는 확장 소재입니다.';
    }
    if (/검색\s*캠페인|디스플레이\s*캠페인|쇼핑\s*광고|앱\s*캠페인/.test(text)) {
      return 'Google Ads: 검색, 디스플레이, 쇼핑, 앱 캠페인은 캠페인 목적과 노출 지면에 따라 구분해서 확인해야 합니다.';
    }
    if (/이미지\s*확장|이미지\s*소재/.test(text)) {
      return '이미지 확장 소재: 검색 광고에 시각 요소를 더해 노출할 때 사용하는 소재 조건을 확인해야 합니다.';
    }
    if (/woocommerce|wordpress|google\s*태그|connect/i.test(text)) {
      return 'Google 연동: WordPress/WooCommerce 연동은 계정 연결, 카탈로그 선택, Google 태그 설정 순서로 확인합니다.';
    }
  }

  if (/kakao|카카오/.test(text)) {
    if (/비즈보드|톡보드/.test(text)) {
      return '비즈보드/톡보드: 카카오 주요 서비스 지면에서 브랜드 노출을 검토할 때 확인하는 대표 상품입니다.';
    }
    if (/디스플레이\s*광고|카카오\s*서비스\s*지면|소재\s*형태/.test(text)) {
      return '디스플레이 광고: 카카오 서비스 지면과 소재 형태, 업종 제한, 심사 기준을 함께 확인해야 합니다.';
    }
    if (/제작\s*가이드|이미지\s*비율|텍스트\s*영역|리사이징/.test(text)) {
      return '제작 가이드: 이미지 비율, 텍스트 영역, 노출 지면별 리사이징 조건을 소재 제작 전에 확인해야 합니다.';
    }
    if (/상품\s*가이드|업종\s*제한|연령\s*제한|주류|담배|사행/.test(text)) {
      return '상품가이드: 상품별 집행 조건과 업종 제한을 먼저 확인해야 합니다.';
    }
  }

  return null;
}

function shouldUseKnownSourceGuidedRewrite(fact: string) {
  const normalized = normalizeProductIntentText(fact);
  const isDenseNavigationText = /더\s*알아보기|자세히\s*보기|광고\s*시작하기|도움말|탭메뉴|메뉴\s*열기|전체\s*보기/.test(normalized);
  const isPackedCatalogSnippet = /(정보\s*)?이미지\s*동영상\s*슬라이드\s*컬렉션|(사이트검색|쇼핑검색|콘텐츠검색|브랜드검색).*(사이트검색|쇼핑검색|콘텐츠검색|브랜드검색)/.test(normalized);

  return fallbackFactLooksMergedNoise(fact)
    || fallbackFactLooksIncomplete(fact)
    || (fact.length > 180 && (isDenseNavigationText || isPackedCatalogSnippet));
}

function fallbackFactLooksMergedNoise(fact: string) {
  const normalized = normalizeProductIntentText(fact);
  const packedProductList = /(사이트검색쇼핑검색콘텐츠검색브랜드검색|웹사이트\s*전환앱\s*전환|정보\s*이미지\s*동영상\s*슬라이드\s*컬렉션\s*정보)/.test(normalized);
  const denseUiCopy = fact.length > 150 && /(탭메뉴|광고\s*시작하기|자주|교육\s*영상|더\s*알아보기|상세보기)/.test(fact);
  return packedProductList || denseUiCopy;
}

function fallbackFactLooksIncomplete(fact: string) {
  const trimmed = fact.trim();
  if (trimmed.length < 20) return true;
  if (/[가-힣A-Za-z0-9]$/.test(trimmed) && !/[.!?。다요함됨음임니다습니다]$/.test(trimmed)) {
    return true;
  }
  return /(상$|통$|쇼$|광고를 상$|사용자가\s*$|선택합니다\.\s*그런\s*$|다음과\s*같은\s*$)/.test(trimmed);
}

function fallbackFactLooksSimilar(
  left: SourceGuidedFallbackFact,
  right: SourceGuidedFallbackFact,
) {
  if (left.normalized === right.normalized) return true;
  const shorter = left.normalized.length <= right.normalized.length ? left.normalized : right.normalized;
  const longer = left.normalized.length > right.normalized.length ? left.normalized : right.normalized;
  if (shorter.length >= 45 && longer.includes(shorter)) return true;

  const leftTokens = new Set(left.normalized.split(/\s+/).filter(token => token.length >= 2));
  const rightTokens = new Set(right.normalized.split(/\s+/).filter(token => token.length >= 2));
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  const ratio = overlap / Math.min(leftTokens.size, rightTokens.size);
  return ratio >= 0.82 && Math.min(left.normalized.length, right.normalized.length) >= 60;
}

function pickSourceGuidedFallbackFacts(
  source: ReturnType<typeof buildVerifiedSources>[number],
  sourceIndex: number,
  message: string,
  intent: QueryIntent,
  focusTerms: string[],
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
) {
  const rawText = [source.excerpt, source.matchText].filter(Boolean).join(' ');
  const sourceText = rawText.trim() || [source.title, source.originalTitle].filter(Boolean).join(' ');
  const normalizedFocusTerms = focusTerms.map(term => normalizeProductIntentText(term)).filter(Boolean);
  const requiresSpecificFocus = intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(message);
  const sentences = splitFallbackEvidenceSentences(sourceText)
    .filter(sentence => !isFallbackNavigationOrChromeNoise(sentence))
    .filter(sentence => !isMostlyEnglishFallbackFragment(sentence))
    .filter(sentence => !isFallbackOffTopicForMessage(sentence, message, intent));
  const picked = sentences.filter((sentence) => {
    const normalizedSentence = normalizeProductIntentText(sentence);
    return normalizedFocusTerms.some(term => term.length >= 2 && normalizedSentence.includes(term))
      || (!requiresSpecificFocus && /상품|광고|지면|노출|소재|설정|등록|연동|심사|승인|오류|해결|캠페인|양식|동영상|쇼핑|비즈보드|카탈로그|db\s*url|ep|sdk|mmp/i.test(normalizedSentence));
  });
  const facts = (picked.length > 0 ? picked : (requiresSpecificFocus ? [] : sentences)).slice(0, requiresSpecificFocus ? 2 : 3);
  const seen = new Set<string>();
  const lines: SourceGuidedFallbackFact[] = facts
    .map((fact): SourceGuidedFallbackFact | null => {
      const rewrittenFact = shouldUseKnownSourceGuidedRewrite(fact)
        ? rewriteKnownSourceGuidedFallbackFact(fact, source)
        : null;
      const compactFact = rewrittenFact || compactFallbackFactAroundFocus(fact, focusTerms);
      const classification = classifySourceGuidedFallbackSection(compactFact, source, message, intent, scope);
      const formattedFact = formatSourceGuidedFallbackFactText(compactFact, source, classification.section);
      if (!rewrittenFact && fallbackFactLooksMergedNoise(formattedFact)) return null;
      if (!rewrittenFact && fallbackFactLooksIncomplete(formattedFact)) return null;
      const normalizedFact = normalizeProductIntentText(formattedFact);
      const focusHitCount = normalizedFocusTerms.filter(term => term.length >= 2 && normalizedFact.includes(term)).length;
      return {
        text: formattedFact,
        citation: `[S${sourceIndex + 1}]`,
        normalized: normalizedFact,
        section: classification.section,
        score: classification.score + focusHitCount * 3,
        sourceIndex,
      };
    })
    .filter((fact): fact is SourceGuidedFallbackFact => Boolean(fact))
    .filter((fact) => {
      const normalized = fact.normalized;
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  return lines.slice(0, 3);
}

function buildSourceGuidedLlmFailureFallbackAnswer(
  message: string,
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
  isBroadProductStructureLlmIntent: boolean,
) {
  const usableSources = sources.filter(source => String(source.excerpt || source.matchText || source.title || '').trim()).slice(0, 6);
  if (usableSources.length === 0) return null;

  const focusTerms = buildFallbackFocusTerms(message, intent);
  const profile = getSourceGuidedFallbackProfile(message, intent, scope, isBroadProductStructureLlmIntent);
  const factItems = usableSources
    .flatMap((source, index) => pickSourceGuidedFallbackFacts(source, index, message, intent, focusTerms, scope))
    .sort((a, b) => b.score - a.score);
  if (factItems.length === 0) return null;

  const globalSeen = new Set<string>();
  const uniqueFacts = factItems.filter((fact) => {
    if (!fact.normalized || globalSeen.has(fact.normalized)) return false;
    if (Array.from(globalSeen).some(normalized => fallbackFactLooksSimilar(
      fact,
      { ...fact, normalized } as SourceGuidedFallbackFact,
    ))) {
      return false;
    }
    globalSeen.add(fact.normalized);
    return true;
  });
  if (uniqueFacts.length === 0) return null;

  const usedCitations = new Set<string>();
  const answerLines: string[] = [profile.intro, ''];
  let includedCount = 0;

  profile.sections.forEach(([sectionKey, label]) => {
    const sectionFacts = uniqueFacts
      .filter(fact => fact.section === sectionKey)
      .slice(0, sectionKey === 'uncategorized' ? 2 : 4);
    if (sectionFacts.length === 0) return;

    answerLines.push(`**${label}**`);
    sectionFacts.forEach((fact) => {
      answerLines.push(`- ${fact.text} ${fact.citation}`);
      usedCitations.add(fact.citation);
      includedCount += 1;
    });
    answerLines.push('');
  });

  if (includedCount < Math.min(3, uniqueFacts.length)) {
    const remainingFacts = uniqueFacts
      .filter(fact => !answerLines.some(line => line.includes(fact.text)))
      .slice(0, 4 - includedCount);
    if (remainingFacts.length > 0) {
      answerLines.push('**추가로 확인된 근거**');
      remainingFacts.forEach((fact) => {
        answerLines.push(`- ${fact.text} ${fact.citation}`);
        usedCitations.add(fact.citation);
        includedCount += 1;
      });
      answerLines.push('');
    }
  }

  if (includedCount === 0) return null;

  answerLines.push(profile.closing);
  answerLines.push('');
  const citations = Array.from(usedCitations).sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));
  answerLines.push(`근거: ${citations.join(', ') || usableSources.map((_, index) => `[S${index + 1}]`).join(', ')}`);

  return answerLines.join('\n');
}

function buildLlmFailureGroundedFallbackAnswer(
  message: string,
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
  isBroadProductStructureLlmIntent: boolean,
) {
  const allUsableSources = sources.filter(source => String(source.excerpt || source.matchText || '').trim());
  const structuredSources = allUsableSources.slice(0, 10);
  const usableSources = allUsableSources.slice(0, 8);
  if (usableSources.length === 0) return null;
  const prefersSourceGuidedFallback = intent.isSpecificProductGuidance
    || hasNamedSpecificProductQuestion(message)
    || !isBroadProductStructureLlmIntent;

  if (prefersSourceGuidedFallback) {
    const structuredSpecificFallbackAnswer = buildStructuredSpecificProductScopeLimitedAnswer(
      structuredSources,
      intent,
      message,
    );
    if (structuredSpecificFallbackAnswer) return structuredSpecificFallbackAnswer;

    const sourceGuidedFallbackAnswer = buildSourceGuidedLlmFailureFallbackAnswer(
      message,
      usableSources,
      intent,
      scope,
      isBroadProductStructureLlmIntent,
    );
    if (sourceGuidedFallbackAnswer) return sourceGuidedFallbackAnswer;
  }

  if (!prefersSourceGuidedFallback) {
    const sourceGuidedFallbackAnswer = buildSourceGuidedLlmFailureFallbackAnswer(
      message,
      usableSources,
      intent,
      scope,
      isBroadProductStructureLlmIntent,
    );
    if (sourceGuidedFallbackAnswer) return sourceGuidedFallbackAnswer;
  }

  const structuredFallbackAnswer = buildStructuredLlmFailureFallbackAnswer(
    structuredSources,
    intent,
    isBroadProductStructureLlmIntent,
    message,
  );
  if (structuredFallbackAnswer) return structuredFallbackAnswer;

  const vendorLabel = intent.vendors.map(vendor => VENDOR_LABELS[vendor] || vendor).join(', ') || '해당 매체';
  const modeLabel = isBroadProductStructureLlmIntent
    ? '광고 상품 구조'
    : (intent.isSpecificProductGuidance ? getSpecificProductModeLabel(scope.mode) : '정책 근거');
  const evidenceLines = usableSources.map((source, index) => {
    const title = source.title || source.originalTitle || `확인 출처 ${index + 1}`;
    const excerpt = buildIntentFocusedExcerpt(source.excerpt || source.matchText || '', title, intent);
    return `- ${title}: ${excerpt} [S${index + 1}]`;
  });
  const answerScopeLine = isBroadProductStructureLlmIntent
    ? `${vendorLabel} 광고 상품을 전체 목록처럼 단정하기보다, 현재 확보된 공식 근거에서 확인되는 상품·목표·지면 단위로 정리합니다.`
    : `${vendorLabel} ${modeLabel}에 대해 현재 확보된 공식 근거에서 직접 확인되는 내용만 정리합니다.`;
  const limitationLine = intent.isSpecificProductGuidance
    ? '출처에 직접 나오지 않는 세부 설정값, 계정별 사용 가능 여부, 실제 심사 판단은 원문 또는 담당자 확인이 필요합니다.'
    : '출처에 없는 상품명이나 운영 조건은 임의로 보강하지 않았습니다.';

  return [
    answerScopeLine,
    '',
    '**확인된 내용**',
    ...evidenceLines,
    '',
    '**확인 시 주의할 점**',
    `- ${limitationLine}`,
    '',
    `근거: ${usableSources.map((_, index) => `[S${index + 1}]`).join(', ')}`,
  ].join('\n');
}

function getProductStructureSourceKey(source: ReturnType<typeof buildVerifiedSources>[number]) {
  return `${source.documentId || ''}:${source.chunkId || source.id || ''}:${source.title || ''}:${source.excerpt?.slice(0, 80) || ''}`;
}

function normalizeProductStructureSourceTitleKey(title: string) {
  return normalizeEvidenceText(String(title || '')
    .replace(/상품소식\s*\d*\s*분?/gi, ' ')
    .replace(/#\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function normalizeProductStructureSourceUrlKey(url: string) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) return '';

  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    parsed.search = '';
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return normalizeEvidenceText(rawUrl.replace(/[?#].*$/, '').replace(/\/+$/, ''));
  }
}

function getProductStructurePublicSourceKey(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  const urlKey = normalizeProductStructureSourceUrlKey([
    source.url,
    sourceLike.documentUrl,
    metadata.url,
    metadata.source_url,
    metadata.document_url,
    metadata.canonical_url,
  ].find(Boolean) || '');
  if (urlKey) return `url:${urlKey}`;

  const titleKey = normalizeProductStructureSourceTitleKey([
    source.title,
    source.originalTitle,
    metadata.title,
    metadata.source_title,
    metadata.canonical_title,
  ].find(Boolean) || '');
  return titleKey ? `title:${titleKey}` : '';
}

function getProductStructureVisibleSourceText(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  return [
    source.title,
    source.originalTitle,
    source.excerpt,
    source.matchText,
    metadata.title,
    metadata.originalTitle,
    metadata.source_title,
    metadata.canonical_title,
    metadata.productStructureAnchor,
    metadata.graphPath,
    metadata.claimType,
    metadata.sourceKind,
    metadata.answerEvidenceRole,
    metadata.answer_evidence_role,
    Array.isArray(metadata.topic_labels) ? metadata.topic_labels.join(' ') : metadata.topic_labels,
    Array.isArray(metadata.graphTopics) ? metadata.graphTopics.join(' ') : metadata.graphTopics,
    Array.isArray(source.rankReason) ? source.rankReason.join(' ') : '',
    Array.isArray(source.evidenceDecisionReason) ? source.evidenceDecisionReason.join(' ') : '',
  ].filter(Boolean).join(' ').toLowerCase();
}

function getStrictProductVisibleEvidenceText(source: ReturnType<typeof buildVerifiedSources>[number]) {
  return normalizeEvidenceText([
    source.title,
    source.originalTitle,
    source.excerpt,
  ].filter(Boolean).join(' '));
}

function getSpecificProductEvidenceText(source: ReturnType<typeof buildVerifiedSources>[number]) {
  return getStrictProductVisibleEvidenceText(source);
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
  const hasDataSignal = /db\s*url|상품\s*db|상품db|상품\s*등록|상품등록|ep|쇼핑파트너센터|상품정보\s*수신\s*현황|등록요청|카테고리\s*매칭|카테고리\s*자동매칭|입점\s*심사|가격비교\s*(입점|연동|등록)|상품관리/.test(queryText)
    || /dburl|상품db/.test(compactQueryText);

  return hasShoppingSignal && hasDataSignal;
}

function isGenericStandaloneProductEvidenceTerm(term: string) {
  const normalizedTerm = normalizeEvidenceText(term);
  const compactTerm = normalizedTerm.replace(/\s+/g, '');
  return /^(광고|광고상품|상품|종류|유형|목록|구조|상세|설명|가이드|기준|정보|알려줘|알려|정리|구분|매체|플랫폼|네이버|naver|meta|메타|google|구글|kakao|카카오)$/.test(compactTerm);
}

function sourceHasNaverShoppingDataEvidence(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const text = getSpecificProductEvidenceText(source);

  return /naver_shopping_data|ep\s*\(=\s*db\s*url\)|db\s*url|dburl|상품\s*db|상품db|상품\s*db\s*url|상품db\s*url|상품정보\s*수신\s*현황|등록\s*요청|등록요청|상품관리|쇼핑파트너센터|카테고리\s*(자동)?매칭|입점\s*심사|영업일\s*기준\s*1\s*[-~]?\s*2일|cpc|cps|상품\s*등록|상품등록|데이터\s*피드|feed/.test(text);
}

function sourceHasStrongNaverShoppingDataEvidence(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const text = getSpecificProductEvidenceText(source);
  const hasNaverShoppingContext = /네이버|naver|쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑파트너센터|shopping/.test(text);
  const hasDirectDataProcedure = /ep\s*\(=\s*db\s*url\)|db\s*url|dburl|상품\s*db|상품db|상품\s*db\s*url|상품db\s*url|상품정보\s*수신\s*현황|등록\s*요청|등록요청|상품관리|카테고리\s*(자동)?매칭|입점\s*심사|영업일\s*기준\s*1\s*[-~]?\s*2일|데이터\s*피드|feed/.test(text);
  const hasOnlyGeneralShoppingSignal = /쇼핑블록|주요\s*쇼핑\s*지면|사이트검색광고|디지털\s*옥외광고|필터|혜택|색상|가격대/.test(text)
    && !hasDirectDataProcedure;

  return hasNaverShoppingContext && hasDirectDataProcedure && !hasOnlyGeneralShoppingSignal;
}

function scoreNaverShoppingDataEvidence(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const text = getSpecificProductEvidenceText(source);
  let score = Number(source.hybridScore || source.score || 0);

  if (sourceHasStrongNaverShoppingDataEvidence(source)) score += 24;
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
  const terms: string[] = intent.strictProductTerms.filter(term => !isGenericStandaloneProductEvidenceTerm(term));
  const add = (...items: string[]) => terms.push(...items);

  if (/(^|[\s/])da($|[\s/]|도|상품|광고)|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(queryText)) {
    add('DA', 'DA 상품', 'DA상품', '네이버DA', '네이버 DA', '네이버DA상품', '보장형 DA', '스마트채널', '타임보드', '롤링보드', '디스플레이 광고', '디스플레이광고', '성과형 디스플레이', '성과형디스플레이', '홈피드DA', '홈피드', '배너 광고', '배너광고');
  }

  if (/동영상\s*광고|비디오\s*광고|video\s*ads|youtube\s*shorts|shorts\s*광고|쇼츠|숏폼|아웃스트림|video\s*action\s*campaign|\bvac\b/.test(queryText)) {
    add('동영상 광고', '동영상광고', '비디오 광고', '비디오광고', '동영상 조회', '동영상 소재', '숏폼 광고', '숏폼', '아웃스트림', 'Video Ads');
    if (/youtube|유튜브/.test(queryText)) add('YouTube', '유튜브');
    if (/youtube\s*shorts|shorts\s*광고|쇼츠/.test(queryText)) add('YouTube Shorts', 'Shorts', 'Shorts 광고', '쇼츠');
    if (/video\s*action\s*campaign|\bvac\b/.test(queryText)) add('Video action campaign', 'VAC');
  }

  if (/앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록)|app\s*(install|promotion)|mmp|sdk|사전\s*등록/.test(queryText)) {
    add('앱 인스톨', '앱인스톨', '앱 설치', '앱설치', '앱 홍보', '앱홍보', '앱 캠페인', '앱 이벤트', 'App Install', 'App Promotion', '사전 등록', '앱 사전등록', '앱 등록');
    if (/mmp/.test(queryText)) add('MMP');
    if (/sdk/.test(queryText)) add('SDK');
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

  if (/리드\s*양식|lead\s*form|lead\s*generation|lead\s*ads?|잠재\s*고객\s*(양식|광고|확장|소재)|잠재고객\s*(양식|광고|확장|소재)|비즈니스\s*폼|비즈니스폼|양식\s*제출/.test(queryText)) {
    add('리드 양식', '리드양식', 'lead form', 'Lead Form', 'Lead Ads', 'Lead Generation', '잠재고객 광고', '잠재 고객 광고', '잠재고객 양식', '잠재 고객 양식', '비즈니스 폼', '비즈니스폼', '양식 제출');
  }

  if (/카탈로그|catalog|advantage\+|어드밴티지|컬렉션|performance\s*max|\bpmax\b|demand\s*gen/.test(queryText)) {
    add('카탈로그', 'catalog', 'Advantage+', '어드밴티지', '컬렉션', 'collection', 'Performance Max', 'PMax', 'Demand Gen');
  }

  if (!usesNaverShoppingDataIntent && /쇼핑검색|사이트검색|파워링크|브랜드검색|쇼핑블록|비즈보드|상품가이드|상품\s*가이드/.test(queryText)) {
    add('쇼핑검색', '쇼핑검색광고', '사이트검색광고', '파워링크', '브랜드검색', '쇼핑블록', '비즈보드', '상품가이드', '상품 가이드');
  }

  return Array.from(new Set(terms.map(term => term.trim()).filter(term => term.length >= 2 && !isGenericStandaloneProductEvidenceTerm(term))));
}

function buildPrimarySpecificProductEvidenceTerms(intent: QueryIntent) {
  const queryText = normalizeEvidenceText([
    ...intent.keywords,
    ...intent.strictProductTerms,
  ].join(' '));
  const compactQueryText = queryText.replace(/\s+/g, '');
  const terms: string[] = intent.strictProductTerms.filter(term => !isGenericStandaloneProductEvidenceTerm(term));
  const add = (...items: string[]) => terms.push(...items);

  if (/(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(queryText)) {
    add('DA', 'DA 상품', 'DA상품', '네이버 DA', '네이버DA', '네이버DA상품', '보장형 DA', '스마트채널', '타임보드', '롤링보드', '디스플레이 광고', '디스플레이광고', '성과형 디스플레이', '성과형디스플레이', '홈피드DA', '홈피드 DA', '홈피드', '배너 광고', '배너광고');
  }

  if (/동영상\s*광고|비디오\s*광고|video\s*ads|youtube\s*shorts|shorts\s*광고|쇼츠|숏폼|아웃스트림|video\s*action\s*campaign|\bvac\b/.test(queryText)) {
    add('동영상 광고', '동영상광고', '비디오 광고', '비디오광고', '동영상 조회', '동영상 소재', '숏폼 광고', '숏폼', '아웃스트림', 'Video Ads');
    if (/youtube|유튜브/.test(queryText)) add('YouTube', '유튜브');
    if (/youtube\s*shorts|shorts\s*광고|쇼츠/.test(queryText)) add('YouTube Shorts', 'Shorts', 'Shorts 광고', '쇼츠');
    if (/video\s*action\s*campaign|\bvac\b/.test(queryText)) add('Video action campaign', 'VAC');
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

  if (/리드\s*양식|lead\s*form|lead\s*generation|lead\s*ads?|잠재\s*고객\s*(양식|광고|확장|소재)|잠재고객\s*(양식|광고|확장|소재)|비즈니스\s*폼|비즈니스폼|양식\s*제출/.test(queryText)) {
    add('리드 양식', '리드양식', 'Lead Form', 'Lead Ads', 'Lead Generation', '잠재고객 광고', '잠재 고객 광고', '잠재고객 양식', '잠재 고객 양식', '비즈니스 폼', '비즈니스폼', '양식 제출');
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

  return Array.from(new Set(terms.map(term => term.trim()).filter(term => term.length >= 2 && !isGenericStandaloneProductEvidenceTerm(term))));
}

function buildSpecificProductFamilyMatchers(intent: QueryIntent): RegExp[] {
  const queryText = normalizeEvidenceText([
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

function sourceMatchesSpecificProductFamily(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent,
) {
  const familyMatchers = buildSpecificProductFamilyMatchers(intent);
  if (familyMatchers.length === 0) return true;

  const evidenceText = getSpecificProductEvidenceText(source);
  return familyMatchers.some(pattern => pattern.test(evidenceText));
}

function sourceMatchesStrictProductIntent(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent
) {
  const text = getSpecificProductEvidenceText(source);
  if (!sourceMatchesSpecificProductFamily(source, intent)) return false;
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

function sourceMatchesRelaxedSpecificProductIntent(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent,
  mode: SpecificProductAnswerMode,
) {
  const targetVendor = intent.vendors.length === 1 ? intent.vendors[0] : undefined;
  if (!sourceMatchesVendor(source, targetVendor)) return false;
  if (sourceHasCrossVendorUrl(source, intent.vendors)) return false;

  const text = getSpecificProductEvidenceText(source);
  if (!sourceMatchesSpecificProductFamily(source, intent)) return false;
  if (sourceIsBroadProductStructureOnly(source, intent)) return false;
  if (!sourceTextHasSpecificProductDetailSignal(text) && mode !== 'product_detail') return false;

  const strictTerms = buildStrictProductEvidenceTerms(intent);
  const primaryTerms = buildPrimarySpecificProductEvidenceTerms(intent);
  const modeTerms = buildRequestedProductModeTerms(mode);
  const hasStrictTerm = strictTerms.some(term => textContainsEvidenceTerm(text, term));
  const hasPrimaryTerm = primaryTerms.some(term => textContainsEvidenceTerm(text, term));
  const hasModeTerm = modeTerms.some(term => textContainsEvidenceTerm(text, term));
  const titleText = `${source.title || ''} ${source.originalTitle || ''}`;
  const titleHasPrimaryTerm = primaryTerms.some(term => textContainsEvidenceTerm(titleText, term));
  const hasPrimaryTermDetail = primaryTerms.some(term => sourceTextHasSpecificProductDetailSignalNearTerm(text, term));
  const hasGenericLegalIdentity = sourceIdentityLooksLikeGenericLegalOrAccountDoc(source);

  if (
    mode === 'product_detail'
    && primaryTerms.length > 0
    && !hasPrimaryTermDetail
    && !(titleHasPrimaryTerm && sourceTextHasSpecificProductDetailSignal(text) && !hasGenericLegalIdentity)
  ) {
    return false;
  }

  if (hasPrimaryTerm || hasStrictTerm) return true;
  if (primaryTerms.length > 0 || strictTerms.length > 0) return false;
  if (mode !== 'product_detail' && hasModeTerm && sourceTextHasSpecificProductDetailSignal(text)) return true;

  return false;
}

function sourceMatchesProductFamilyFallbackCandidate(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent,
  mode: SpecificProductAnswerMode,
) {
  const targetVendor = intent.vendors.length === 1 ? intent.vendors[0] : undefined;
  if (!sourceMatchesVendor(source, targetVendor)) return false;
  if (sourceHasCrossVendorUrl(source, intent.vendors)) return false;
  if (!sourceMatchesSpecificProductFamily(source, intent)) return false;
  if (sourceIsBroadProductStructureOnly(source, intent)) return false;
  if (isLowValueSpecificProductSource(source, intent, mode)) return false;

  const text = getSpecificProductEvidenceText(source);
  const primaryTerms = buildPrimarySpecificProductEvidenceTerms(intent);
  const strictTerms = buildStrictProductEvidenceTerms(intent);
  const hasProductTerm = [...primaryTerms, ...strictTerms].some(term => textContainsEvidenceTerm(text, term));

  return (
    hasProductTerm
    || sourceTextHasSpecificProductDetailSignal(text)
    || isOfficialGuideGraphSource(source)
  );
}

function sourceIsBroadProductStructureOnly(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent
) {
  if (!intent.isSpecificProductGuidance) return false;

  const text = getSpecificProductEvidenceText(source);
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
  const hasSetupSignal = /집행|진행|가이드|절차|방법|세팅|설정|연동|sdk|mmp|추적|트래킹|이벤트|앱\s*등록|캠페인\s*설정|계정|권한|픽셀|카탈로그\s*연동|카탈로그\s*설정/.test(normalized);
  const hasPolicySignal = /정책|심사|검수|검토|주의|유의|제한|금지|가능\s*여부|승인|등록\s*기준|광고\s*등록\s*기준|확인해야|꼭\s*확인/.test(normalized);

  if (/오류|에러|문제|해결|원인|조치|반려|실패|tracking_specs|불일치|미승인|승인\s*거절/.test(normalized)) {
    return 'operational_issue';
  }

  if (/db\s*url|상품\s*db|상품db|상품\s*등록|상품등록|ep|쇼핑파트너센터|가격비교|데이터\s*피드|feed/.test(normalized) || /dburl/.test(compact)) {
    return 'db_setup';
  }

  if (hasSetupSignal && hasCreativeExplicitSignal) {
    return 'execution_guide';
  }

  if (hasSetupSignal && hasPolicySignal) {
    return /집행|진행|가이드|절차|방법|세팅|설정|연동|sdk|mmp|트래킹|추적|이벤트/.test(normalized)
      ? 'execution_guide'
      : 'policy_screening';
  }

  if (hasSetupSignal && !hasCreativeExplicitSignal) {
    return 'setup_procedure';
  }

  if (hasPolicySignal) {
    return 'policy_screening';
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
  allowRelaxed = false,
) {
  if (!sourceMatchesSpecificProductFamily(source, intent)) return false;

  const strictMatch = sourceMatchesStrictProductIntent(source, intent);
  if (!strictMatch) {
    if (!allowRelaxed || !sourceMatchesRelaxedSpecificProductIntent(source, intent, mode)) return false;
  }

  if (mode === 'db_setup' && isNaverShoppingDataIntent(intent) && sourceHasNaverShoppingDataEvidence(source)) {
    return true;
  }

  const text = getSpecificProductEvidenceText(source);
  const primaryTerms = buildPrimarySpecificProductEvidenceTerms(intent);
  if (mode === 'product_detail') {
    if (primaryTerms.length === 0) return true;
    const titleText = `${source.title || ''} ${source.originalTitle || ''}`;
    const titleHasPrimaryTerm = primaryTerms.some(term => textContainsEvidenceTerm(titleText, term));
    const sourceHasDetailSignal = sourceTextHasSpecificProductDetailSignal(text);

    return primaryTerms.some(term => sourceTextHasSpecificProductDetailSignalNearTerm(text, term))
      || (titleHasPrimaryTerm && sourceHasDetailSignal);
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

function sourceIdentityLooksLikeGenericLegalOrAccountDoc(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const identityText = normalizeEvidenceText(getSourceIdentityText(source));
  if (!identityText) return false;

  const genericLegalOrAccountSignal = /이용약관|약관|운영\s*정책|서비스\s*이용|회원\s*가입|회원가입|계정\s*(생성|만들기|관리)|책임자|세금\s*계산서|세금계산서|청구|결제|권한\s*관리|비즈니스\s*계정|클린센터|개인정보\s*처리방침/.test(identityText);
  const productSpecificGuideSignal = /상품\s*가이드|상품가이드|상품\s*소개|상품소개|제작\s*가이드|제작가이드|광고\s*상품|광고상품|사이트검색광고|쇼핑검색광고|쇼핑블록|비즈보드|카탈로그|컬렉션|리드\s*양식|앱\s*(인스톨|설치|홍보)|동영상\s*광고|디스플레이\s*광고|성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드/.test(identityText);

  return genericLegalOrAccountSignal && !productSpecificGuideSignal;
}

function sourceHasSpecificProductNamedDetail(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent,
) {
  const text = getSpecificProductEvidenceText(source);
  const primaryTerms = buildPrimarySpecificProductEvidenceTerms(intent);
  const strictTerms = buildStrictProductEvidenceTerms(intent);
  const terms = primaryTerms.length > 0 ? primaryTerms : strictTerms;
  if (terms.length === 0) return sourceTextHasSpecificProductDetailSignal(text);

  const titleText = `${source.title || ''} ${source.originalTitle || ''}`;
  const titleHasTerm = terms.some(term => textContainsEvidenceTerm(titleText, term));
  const nearDetail = terms.some(term => sourceTextHasSpecificProductDetailSignalNearTerm(text, term));

  return nearDetail || (titleHasTerm && sourceTextHasSpecificProductDetailSignal(text));
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

  return (noiseHit && jsonShapeCount >= 4) || isNavigationOrMenuExcerpt(text, { requireLowEvidenceSignal: true });
}

function isLowValueSpecificProductSource(
  source: ReturnType<typeof buildVerifiedSources>[number],
  intent: QueryIntent,
  mode: SpecificProductAnswerMode,
) {
  const queryText = normalizeEvidenceText([
    ...intent.keywords,
    ...intent.strictProductTerms,
  ].join(' '));
  const text = normalizeEvidenceText([
    source.title,
    source.originalTitle,
    source.excerpt,
    source.matchText,
  ].filter(Boolean).join(' '));

  if (sourceHasExtractionNoise(source)) return true;
  if (sourceHasCrossVendorUrl(source, intent.vendors)) return true;
  if (intent.vendors.length === 1 && hasExplicitOtherVendorSignal(source, intent.vendors[0])) return true;
  if (sourceIsBroadProductStructureOnly(source, intent)) return true;

  const sensitivePolicyDoc = /암호화폐|crypto|사회\s*문제|정치|선거|주택|고용|신용|제한된\s*상품|금지된\s*상품|민감한\s*카테고리/.test(text);
  const queryAsksSensitivePolicy = /암호화폐|crypto|사회\s*문제|정치|선거|주택|고용|신용|제한된\s*상품|금지된\s*상품|민감한\s*카테고리|금융|대출|보험|부동산/.test(queryText);
  const queryAsksAppInstall = /앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록)|app\s*(install|promotion)|mmp|sdk|사전\s*등록/.test(queryText);
  const sourceHasAppInstallEvidence = /앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록)|app\s*(install|promotion)|mobile\s*app|sdk|mmp|모바일\s*측정\s*파트너|app\s*id|app\s*secret/.test(text);
  const hasNamedDetail = sourceHasSpecificProductNamedDetail(source, intent);
  if (
    intent.isSpecificProductGuidance
    && sensitivePolicyDoc
    && !queryAsksSensitivePolicy
    && !sourceHasAppInstallEvidence
    && !hasNamedDetail
  ) {
    return true;
  }
  if (queryAsksAppInstall && sensitivePolicyDoc && !sourceHasAppInstallEvidence) {
    return true;
  }

  const broadLegalOrAccountDoc = /이용\s*약관|이용약관|약관|운영\s*정책|운영정책|서비스\s*이용|회원\s*가입|회원가입|계정\s*(생성|만들기|관리)|책임자|세금\s*계산서|세금계산서|청구|결제|권한\s*관리|비즈니스\s*계정|클린센터|개인정보\s*처리방침|광고\s*게재\s*제한/.test(text);
  const genericLegalIdentity = sourceIdentityLooksLikeGenericLegalOrAccountDoc(source);
  if (
    intent.isSpecificProductGuidance
    && mode === 'product_detail'
    && (broadLegalOrAccountDoc || genericLegalIdentity)
  ) {
    return true;
  }

  if (
    intent.isSpecificProductGuidance
    && broadLegalOrAccountDoc
    && !sourceMatchesRequestedProductMode(source, intent, mode, true)
    && !sourceTextHasSpecificProductDetailSignal(text)
  ) {
    return true;
  }

  if (
    intent.vendors.length > 0
    && !sourceHasStrongVendorIdentity(source, intent.vendors)
    && !hasNamedDetail
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
    if (sourceMatchesRequestedProductMode(source, intent, mode, true)) {
      score += 32;
    } else {
      score -= 35;
    }
  } else if (sourceMatchesRequestedProductMode(source, intent, mode, true)) {
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

function dedupePublicProductSources(
  sources: ReturnType<typeof buildVerifiedSources>,
  limit = sources.length,
) {
  const seen = new Set<string>();
  const deduped: ReturnType<typeof buildVerifiedSources> = [];

  for (const source of sources) {
    if (deduped.length >= limit) break;
    const publicKey = getProductStructurePublicSourceKey(source);
    const key = publicKey || getProductStructureSourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }

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
    getProductStructurePublicSourceKey(source)
      || source.id
      || source.chunkId
      || source.documentId,
    normalizeEvidenceText(String(source.title || source.originalTitle || '')),
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
    const strongNaverShoppingDataAnswerSources = rankedAnswerSources.filter(source => sourceHasStrongNaverShoppingDataEvidence(source));
    const naverShoppingDataAnswerSources = strongNaverShoppingDataAnswerSources.length > 0
      ? strongNaverShoppingDataAnswerSources
      : rankedAnswerSources.filter(source => sourceHasNaverShoppingDataEvidence(source));
    const dataFocusedSources = naverShoppingDataAnswerSources.length > 0
      ? naverShoppingDataAnswerSources
      : rankedAnswerSources.filter(source => (
        sourceMatchesStrictProductIntent(source, intent)
        || sourceMatchesRelaxedSpecificProductIntent(source, intent, mode)
      ));

    return dataFocusedSources.slice(0, 4).map(source => (
      sourceHasNaverShoppingDataEvidence(source)
        ? withSpecificProductEvidenceRole(source, 'db_detail')
        : withSpecificProductEvidenceRole(source, 'product_context')
    ));
  }

  const selected: ReturnType<typeof buildVerifiedSources> = [];
  const seen = new Set<string>();
  const targetVendor = intent.vendors.length === 1 ? intent.vendors[0] : undefined;
  const vendorScopedStrictProductSources = targetVendor
    ? strictProductSources.filter(source => sourceMatchesVendor(source, targetVendor))
    : strictProductSources;
  const vendorScopedModeMatchedSources = targetVendor
    ? modeMatchedSources.filter(source => sourceMatchesVendor(source, targetVendor))
    : modeMatchedSources;
  const vendorScopedRankedAnswerSources = targetVendor
    ? rankedAnswerSources.filter(source => sourceMatchesVendor(source, targetVendor))
    : rankedAnswerSources;
  const modeSources = mode === 'product_detail'
    ? vendorScopedStrictProductSources.filter(source => sourceMatchesRequestedProductMode(source, intent, mode, true))
    : vendorScopedModeMatchedSources;
  const modeDetailSources = modeSources.filter(source => !isGraphVerifiedSource(source));
  const officialGraphSources = vendorScopedStrictProductSources.filter(source => (
    isOfficialGuideGraphSource(source)
    && (
      sourceMatchesStrictProductIntent(source, intent)
      || sourceMatchesRelaxedSpecificProductIntent(source, intent, mode)
    )
    && (mode !== 'product_detail' || sourceMatchesRequestedProductMode(source, intent, mode, true))
  ));
  const productContextSources = vendorScopedRankedAnswerSources.filter(source => (
    !isGraphVerifiedSource(source)
    && (
      sourceMatchesStrictProductIntent(source, intent)
      || sourceMatchesRelaxedSpecificProductIntent(source, intent, mode)
    )
    && !sourceIsBroadProductStructureOnly(source, intent)
  ));
  const productContextLimit = mode === 'product_detail'
    ? 0
    : (modeDetailSources.length > 0 || modeSources.length > 0 || officialGraphSources.length > 0 ? 1 : 2);

  modeDetailSources.slice(0, 3).forEach(source => {
    pushUniqueSpecificProductSource(selected, seen, source, 'mode_detail');
  });

  officialGraphSources.slice(0, 2).forEach(source => {
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

  if (selected.length === 0 && mode !== 'product_detail') {
    vendorScopedRankedAnswerSources
      .filter(source => (
        sourceMatchesStrictProductIntent(source, intent)
        || sourceMatchesRelaxedSpecificProductIntent(source, intent, mode)
      ))
      .filter(source => !sourceIsBroadProductStructureOnly(source, intent))
      .slice(0, 3)
      .forEach(source => {
        pushUniqueSpecificProductSource(
          selected,
          seen,
          source,
          isGraphVerifiedSource(source) ? 'official_graph' : 'product_context',
        );
      });
  }

  return dedupePublicProductSources(selected, 6);
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
  const mode = inferSpecificProductAnswerMode(message);
  const namedSpecificProductQuestion = hasNamedSpecificProductQuestion(message);
  const explicitWholeCatalogQuestion = isExplicitWholeProductCatalogQuestion(message);
  const hasSpecificActionSignal = hasSpecificProductActionOrPolicySignalQuestion(message);
  const shouldUseSpecificProductScope = (
    intent.isSpecificProductGuidance
    || namedSpecificProductQuestion
    || hasSpecificActionSignal
  ) && !explicitWholeCatalogQuestion;
  const isSpecificProductScope = (
    intent.topics.includes('product_structure')
    && shouldUseSpecificProductScope
  );

  if (!isSpecificProductScope) {
    return {
      mode,
      strictProductSources: sources,
      answerSources: sources,
      shouldLimit: false,
    };
  }

  const requestedFocus = buildRequestedProductFocus(message, intent);
  const focusMatchedSources = requestedFocus?.isSpecificFamilyQuestion
    ? refineSpecificProductAnswerSources(
      sources.filter(source => sourceMatchesRequestedProductFocus(source, requestedFocus)),
      intent,
      mode,
    )
    : [];
  const naverShoppingDataSources = mode === 'db_setup' && isNaverShoppingDataIntent(intent)
    ? sources.filter(source => sourceMatchesVendor(source, 'NAVER') && sourceHasNaverShoppingDataEvidence(source))
    : [];
  const strictMatchedSources = refineSpecificProductAnswerSources(
    [
      ...naverShoppingDataSources,
      ...focusMatchedSources,
      ...sources.filter(source => sourceMatchesStrictProductIntent(source, intent)),
    ],
    intent,
    mode,
  );
  const relaxedMatchedSources = strictMatchedSources.length > 0
    ? []
    : refineSpecificProductAnswerSources(
      sources.filter(source => sourceMatchesRelaxedSpecificProductIntent(source, intent, mode)),
      intent,
      mode,
    );
  const familyFallbackSources = strictMatchedSources.length === 0 && relaxedMatchedSources.length === 0
    ? refineSpecificProductAnswerSources(
      sources.filter(source => sourceMatchesProductFamilyFallbackCandidate(source, intent, mode)),
      intent,
      mode,
    )
    : [];
  const strictProductSources = strictMatchedSources.length > 0
    ? strictMatchedSources
    : (relaxedMatchedSources.length > 0 ? relaxedMatchedSources : familyFallbackSources);
  const modeMatchedSources = mode === 'product_detail'
    ? strictProductSources
    : strictProductSources.filter(source => sourceMatchesRequestedProductMode(source, intent, mode, true));
  const relaxedModeSources = modeMatchedSources.length > 0
    ? modeMatchedSources
    : strictProductSources.filter(source => (
      mode === 'product_detail'
      || sourceMatchesRelaxedSpecificProductIntent(source, intent, mode)
    ));
  const rawAnswerSources = mode === 'product_detail'
    ? strictProductSources
    : (modeMatchedSources.length > 0 ? modeMatchedSources : relaxedModeSources);
  const rankedAnswerSources = refineSpecificProductAnswerSources(
    mode === 'db_setup' && naverShoppingDataSources.length > 0
      ? [...naverShoppingDataSources, ...rawAnswerSources]
      : rawAnswerSources,
    intent,
    mode,
  );
  const selectedAnswerSources = selectSpecificProductAnswerSources(
    strictProductSources,
    modeMatchedSources,
    rankedAnswerSources,
    intent,
    mode,
  );
  const answerSources = selectedAnswerSources.length > 0
    ? selectedAnswerSources
    : (rankedAnswerSources.length > 0 ? rankedAnswerSources : strictProductSources).slice(0, 6);
  const missingRequestedFocus = Boolean(requestedFocus?.isSpecificFamilyQuestion && focusMatchedSources.length === 0);
  if (missingRequestedFocus && strictProductSources.length > 0) {
    for (const source of strictProductSources) {
      source.metadata = {
        ...(source.metadata || {}),
        requestedFocusFallback: true,
      };
    }
  }
  const returnedStrictProductSources = dedupePublicProductSources(strictProductSources);
  const returnedAnswerSources = dedupePublicProductSources(answerSources, 6);

  return {
    mode,
    strictProductSources: returnedStrictProductSources,
    answerSources: returnedAnswerSources,
    shouldLimit: returnedStrictProductSources.length === 0,
  };
}

function buildStructuredSpecificProductScopeLimitedAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  message: string,
) {
  return (
    buildMetaAppInstallStructuredFallbackAnswer(sources, intent, message)
    || buildNaverShoppingSearchCreativeGuideStructuredFallbackAnswer(sources, intent, message)
    || buildNaverShoppingDataStructuredFallbackAnswer(sources, intent, message)
    || buildNaverDisplayAdStructuredFallbackAnswer(sources, intent, message)
    || buildNaverVideoStructuredFallbackAnswer(sources, intent, message)
    || buildKakaoProductStructuredFallbackAnswer(sources, intent)
    || buildGoogleLeadStructuredFallbackAnswer(sources, intent, message)
  );
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
  const structuredCandidateSources = scope.answerSources.length > 0
    ? scope.answerSources
    : scope.strictProductSources;

  if (scope.strictProductSources.length === 0) {
    lines.push(`${vendorLabel} ${productLabel}에 대해 질문하셨지만, 현재 검증 출처에서는 이 상품명을 직접 확인할 수 있는 공식 근거가 부족합니다.`);
    lines.push('');
    lines.push('다른 광고 상품이나 지면 기준과 섞어 답하면 잘못된 운영 판단으로 이어질 수 있어, 현재는 답변을 제한합니다.');
  } else {
    const structuredAnswer = buildStructuredSpecificProductScopeLimitedAnswer(structuredCandidateSources, intent, message);
    if (structuredAnswer) return structuredAnswer;

    const sourceGuidedAnswer = buildSourceGuidedLlmFailureFallbackAnswer(
      message,
      scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources,
      intent,
      scope,
      false,
    );
    if (sourceGuidedAnswer) return sourceGuidedAnswer;

    const evidenceBackedAnswer = shouldUseDeterministicProductAnswerOnLlmFailure()
      ? buildDeterministicSpecificProductAnswer(message, intent, scope)
      : null;
    if (evidenceBackedAnswer) return evidenceBackedAnswer.answer;

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

type DeterministicProductAnswer = {
  answer: string;
  sources: ReturnType<typeof buildVerifiedSources>;
  model: string;
  showContactOption?: boolean;
  confidenceCap?: number;
  reviewStatus?: CompassReviewPipelineStatus;
};

type ProductAnswerFamily =
  | 'meta_overview'
  | 'meta_app_install'
  | 'meta_lead'
  | 'meta_catalog'
  | 'google_overview'
  | 'google_lead'
  | 'google_app'
  | 'naver_overview'
  | 'naver_da'
  | 'naver_video'
  | 'naver_shopping'
  | 'kakao_overview'
  | 'kakao_bizboard'
  | 'kakao_creative'
  | 'unknown';

type EvidenceBackedBullet = {
  text: string;
  terms: string[];
};

type EvidenceBackedSection = {
  heading: string;
  bullets: EvidenceBackedBullet[];
};

type EvidenceBackedAnswerProfile = {
  family: ProductAnswerFamily;
  intro: string;
  sections: EvidenceBackedSection[];
  summary: string;
  model: string;
  minBullets?: number;
  coverageNotice?: string;
  showContactOption?: boolean;
  confidenceCap?: number;
  reviewStatus?: CompassReviewPipelineStatus;
};

function detectProductAnswerFamily(message: string, intent: QueryIntent): ProductAnswerFamily {
  const normalized = normalizeProductIntentText(message);
  const compact = normalized.replace(/\s+/g, '');
  const vendor = intent.vendors.length === 1 ? intent.vendors[0] : undefined;

  if (vendor === 'META') {
    if (/앱\s*(인스톨|설치|홍보|캠페인|사전\s*등록)|app\s*(install|promotion)/.test(normalized)) return 'meta_app_install';
    if (/리드\s*양식|잠재\s*고객|잠재고객|lead\s*(form|ads?|generation)|비즈니스\s*폼|비즈니스폼/.test(normalized)) return 'meta_lead';
    if (/카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지/.test(normalized)) return 'meta_catalog';
    return 'meta_overview';
  }

  if (vendor === 'GOOGLE') {
    if (/리드\s*양식|잠재\s*고객|lead\s*(form|ads?|generation)|양식\s*확장|lead\s*asset/.test(normalized)) return 'google_lead';
    if (/앱\s*(캠페인|설치|인스톨|홍보|사전\s*등록)|app\s*(campaign|install|promotion)|사전\s*등록/.test(normalized)) return 'google_app';
    return 'google_overview';
  }

  if (vendor === 'NAVER') {
    if (/동영상\s*광고|비디오\s*광고|동영상\s*소재|동영상\s*조회|숏폼|쇼츠|아웃스트림/.test(normalized)) return 'naver_video';
    if (/(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|디스플레이\s*광고|성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드|배너\s*광고/.test(normalized)) return 'naver_da';
    if (/쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑블록|상품\s*db|상품db|db\s*url|dburl|ep|상품등록|상품\s*등록|가격비교|쇼핑파트너센터/.test(normalized) || /상품db|dburl/.test(compact)) return 'naver_shopping';
    return 'naver_overview';
  }

  if (vendor === 'KAKAO') {
    if (/비즈보드|bizboard/.test(normalized)) return 'kakao_bizboard';
    if (/제작|소재|가이드|이미지|비율|텍스트|심사|검수|제한/.test(normalized)) return 'kakao_creative';
    return 'kakao_overview';
  }

  return 'unknown';
}

function sourceHasEvidenceTerm(
  source: ReturnType<typeof buildVerifiedSources>[number],
  terms: string[],
) {
  const sourceText = getStrictProductVisibleEvidenceText(source);
  return terms.some(term => textContainsEvidenceTerm(sourceText, term));
}

function buildEvidenceBackedAnswer(
  profile: EvidenceBackedAnswerProfile,
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const usedSourceIndexes = new Set<number>();
  const lines: string[] = [profile.intro, ''];
  let supportedBulletCount = 0;

  profile.sections.forEach((section) => {
    const sectionLines: string[] = [];

    section.bullets.forEach((bullet) => {
      const sourceIndex = sources.findIndex(source => sourceHasEvidenceTerm(source, bullet.terms));
      if (sourceIndex < 0) return;

      supportedBulletCount += 1;
      usedSourceIndexes.add(sourceIndex);
      sectionLines.push(`- ${bullet.text} [S${sourceIndex + 1}]`);
    });

    if (sectionLines.length === 0) return;

    lines.push(`**${section.heading}**`);
    lines.push(...sectionLines);
    lines.push('');
  });

  if (supportedBulletCount < (profile.minBullets || 2) || usedSourceIndexes.size === 0) {
    return null;
  }

  if (profile.coverageNotice) {
    lines.push(profile.coverageNotice);
    lines.push('');
  }
  lines.push(profile.summary);
  lines.push('');
  lines.push(`근거: ${Array.from(usedSourceIndexes).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`);

  return {
    answer: lines.join('\n'),
    sources,
    model: profile.model,
    showContactOption: profile.showContactOption,
    confidenceCap: profile.confidenceCap,
    reviewStatus: profile.reviewStatus,
  };
}

function countEvidenceBackedSupportedBullets(
  profile: EvidenceBackedAnswerProfile,
  sources: ReturnType<typeof buildVerifiedSources>,
) {
  return profile.sections.reduce((count, section) => (
    count + section.bullets.filter(bullet => sources.some(source => sourceHasEvidenceTerm(source, bullet.terms))).length
  ), 0);
}

function countEvidenceBackedAnswerHits(
  profile: EvidenceBackedAnswerProfile,
  answer: string,
) {
  const normalizedAnswer = normalizeEvidenceText(answer);
  return profile.sections.reduce((count, section) => (
    count + section.bullets.filter((bullet) => (
      bullet.terms.some(term => textContainsEvidenceTerm(normalizedAnswer, term))
    )).length
  ), 0);
}

function answerHasKakaoSpecificScopeRisk(answer: string, message: string, intent: QueryIntent) {
  if (!intent.vendors.includes('KAKAO')) return false;
  const family = detectProductAnswerFamily(message, intent);
  if (family !== 'kakao_bizboard' && family !== 'kakao_overview') return false;

  const normalizedAnswer = normalizeEvidenceText(answer);
  return /랜덤|확률형|사이버몰|전자상거래|통신판매|업종별\s*가이드|사행|주류|담배/.test(normalizedAnswer);
}

function answerHasMetaOverviewCommerceCoverageGap(answer: string, family: ProductAnswerFamily) {
  if (family !== 'meta_overview') return false;

  const normalizedAnswer = normalizeEvidenceText(answer);
  const commerceHeavy = /shop|shops|커머스|컬렉션|카탈로그|catalog/.test(normalizedAnswer);
  const hasBroaderStructure = /캠페인\s*(목표|목적)|광고\s*관리자\s*목표|마케팅\s*목표|노출\s*위치|게재\s*위치|advantage\+|어드밴티지/.test(normalizedAnswer);
  const statesLimitedScope = /추가\s*공식\s*근거|근거가\s*잡힌\s*경우|대조해야|확인된\s*형식|확인된\s*상품\s*구조|확인된\s*범위/.test(normalizedAnswer);

  return commerceHeavy && !hasBroaderStructure && !statesLimitedScope;
}

function buildBroadProductGeneratedAnswerRepair(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
  isBroadProductStructureLlmIntent: boolean,
  rawGeneratedAnswer: string,
): (DeterministicProductAnswer & { reason: 'broad_product_quality_gap' }) | null {
  if (!isBroadProductStructureLlmIntent) return null;

  const family = detectProductAnswerFamily(message, intent);
  const profile = getBroadProductAnswerProfile(family);
  if (!profile) return null;

  const deterministicAnswer = buildEvidenceBackedAnswer(profile, sources);
  if (!deterministicAnswer) return null;

  const supportedBulletCount = countEvidenceBackedSupportedBullets(profile, sources);
  const answerHitCount = countEvidenceBackedAnswerHits(profile, rawGeneratedAnswer);
  const hasMeaningfulGap = supportedBulletCount >= 3 && answerHitCount <= Math.max(1, supportedBulletCount - 2);
  const hasMetaOverviewCommerceCoverageGap = supportedBulletCount >= 2
    && answerHasMetaOverviewCommerceCoverageGap(rawGeneratedAnswer, family);

  if (!hasMeaningfulGap && !hasMetaOverviewCommerceCoverageGap) return null;

  return {
    ...deterministicAnswer,
    model: `${deterministicAnswer.model}-quality-repair`,
    reason: 'broad_product_quality_gap',
  };
}

function buildDeterministicScopeNoticeAnswer(
  productLabel: string,
  sources: ReturnType<typeof buildVerifiedSources>,
  model: string,
): DeterministicProductAnswer {
  const visibleSources = sources.slice(0, 3);
  const lines: string[] = [
    `${productLabel}에 대해 질문하셨지만, 현재 선별된 공식 출처만으로는 상품 상세나 집행 절차를 충분히 단정하기 어렵습니다.`,
    '',
    '**확인된 근거 범위**',
  ];

  visibleSources.forEach((source, index) => {
    lines.push(`- ${compactEvidenceExcerpt(source.excerpt, source.title)} [S${index + 1}]`);
  });

  lines.push('');
  lines.push('**추가 확인이 필요한 항목**');
  lines.push('- 정확한 상품명 또는 노출 지면');
  lines.push('- 소재 규격, 집행 가능 업종, 승인/검수 조건');
  lines.push('- 실제 계정에서 노출되는 등록 경로와 운영 설정');
  lines.push('');
  lines.push('다른 상품의 기준을 섞어 답하면 잘못된 운영 판단으로 이어질 수 있어, 현재는 답변 범위를 제한합니다.');
  if (visibleSources.length > 0) {
    lines.push('');
    lines.push(`근거: ${visibleSources.map((_, index) => `[S${index + 1}]`).join(', ')}`);
  }

  return {
    answer: lines.join('\n'),
    sources: visibleSources,
    model,
    showContactOption: true,
    confidenceCap: 62,
    reviewStatus: 'limited',
  };
}

function getSpecificProductAnswerProfile(
  family: ProductAnswerFamily,
  _mode: SpecificProductAnswerMode,
): EvidenceBackedAnswerProfile | null {
  switch (family) {
    case 'meta_app_install':
      return {
        family,
        intro: 'Meta 앱 인스톨 광고는 앱 홍보 목적과 앱 이벤트 추적, 소재·랜딩 조건을 함께 확인해야 합니다.',
        sections: [
          {
            heading: '집행 전 확인할 설정',
            bullets: [
              { text: '앱 설치나 앱 내 행동을 늘리려면 앱 홍보/App Promotion 계열 목표를 먼저 확인합니다.', terms: ['앱 홍보', '앱 설치', '앱 인스톨', 'App Promotion', 'App Install'] },
              { text: 'SDK, MMP, 앱 이벤트, 픽셀처럼 전환 추적에 필요한 연결 항목은 별도로 점검해야 합니다.', terms: ['SDK', 'MMP', '앱 이벤트', '트래킹', '추적', '픽셀'] },
              { text: '앱 등록, 계정 권한, 캠페인 설정은 실제 광고 관리자 또는 비즈니스 설정에서 확인해야 합니다.', terms: ['앱 등록', '계정', '권한', '캠페인 설정', 'Ads Manager'] },
            ],
          },
          {
            heading: '소재와 심사',
            bullets: [
              { text: '소재와 문구는 Meta 광고 콘텐츠 가이드라인과 랜딩/스토어 연결 상태를 함께 봐야 합니다.', terms: ['소재', '광고 콘텐츠 가이드라인', '랜딩', '스토어', '심사'] },
            ],
          },
        ],
        summary: '정리하면, 앱 홍보 목표를 고른 뒤 앱 이벤트 추적과 계정 연결 상태, 소재·랜딩 조건을 함께 대조하는 흐름이 안전합니다.',
        model: 'compass-answer-deterministic-meta-app-install',
      };

    case 'meta_lead':
      return {
        family,
        intro: 'Meta 리드 양식 광고는 잠재 고객 정보를 수집하는 목적이므로 양식 구성과 개인정보 고지 조건을 함께 확인해야 합니다.',
        sections: [
          {
            heading: '상품/목적',
            bullets: [
              { text: '리드 양식 또는 잠재 고객 목적은 상담 신청, 견적 요청, 고객 정보 수집에 맞춰 검토합니다.', terms: ['리드 양식', '잠재 고객', 'Lead Form', 'Lead Ads', 'Lead Generation'] },
              { text: '양식 제출과 개인정보 수집 항목은 고지, 동의, 이용 목적을 함께 확인해야 합니다.', terms: ['양식 제출', '개인정보', '고지', '동의'] },
            ],
          },
          {
            heading: '운영 전 확인',
            bullets: [
              { text: '소재와 랜딩/후속 안내 문구가 이용자를 오인하게 만들지 않는지 정책 기준과 함께 봅니다.', terms: ['소재', '랜딩', '오인', '정책', '심사'] },
            ],
          },
        ],
        summary: '정리하면, 리드 수집 목적과 양식의 개인정보 처리 조건을 먼저 확인한 뒤 소재 심사 기준을 함께 대조해야 합니다.',
        model: 'compass-answer-deterministic-meta-lead',
      };

    case 'meta_catalog':
      return {
        family,
        intro: 'Meta 카탈로그/컬렉션 계열 광고는 상품 카탈로그와 구매 흐름을 연결해 운영하는 상품군입니다.',
        sections: [
          {
            heading: '상품 구조',
            bullets: [
              { text: '카탈로그 또는 Catalog 기반 상품은 상품 정보를 연결해 노출하는 구조로 봅니다.', terms: ['카탈로그', 'Catalog'] },
              { text: '컬렉션 광고는 여러 상품을 한 화면에서 보여주고 구매 흐름으로 연결할 때 검토합니다.', terms: ['컬렉션', 'Collection', '컬렉션 광고'] },
              { text: 'Advantage+ 또는 자동화 기능은 상품 노출과 최적화 조건을 함께 확인해야 합니다.', terms: ['Advantage+', '어드밴티지'] },
            ],
          },
        ],
        summary: '정리하면, 카탈로그 연결 상태와 컬렉션/자동화 운영 조건을 함께 확인하는 것이 핵심입니다.',
        model: 'compass-answer-deterministic-meta-catalog',
      };

    case 'google_lead':
      return {
        family,
        intro: 'Google Ads 리드 양식은 검색, 디스플레이, 동영상 등 캠페인에서 잠재 고객 정보를 받을 때 검토하는 확장/애셋 계열 기능입니다.',
        sections: [
          {
            heading: '사용 목적',
            bullets: [
              { text: '리드 양식은 상담 신청, 연락처 수집, 견적 요청처럼 잠재 고객 정보를 받을 때 확인합니다.', terms: ['리드 양식', 'Lead Form', '잠재 고객', '상담 신청', '연락처'] },
              { text: '검색, 동영상, 실적 최대화, 디스플레이 캠페인에 추가할 수 있는지 캠페인 유형을 먼저 대조합니다.', terms: ['검색', '동영상', '실적 최대화', '디스플레이', '캠페인'] },
            ],
          },
          {
            heading: '주의 조건',
            bullets: [
              { text: '양식 제출 과정에서는 개인정보 수집, 고지, 동의 조건을 함께 확인해야 합니다.', terms: ['개인정보', '고지', '동의', '양식 제출'] },
            ],
          },
        ],
        summary: '정리하면, 캠페인 유형에 리드 양식을 붙일 수 있는지와 개인정보 수집 조건을 함께 확인하는 흐름이 안전합니다.',
        model: 'compass-answer-deterministic-google-lead',
      };

    case 'google_app':
      return {
        family,
        intro: 'Google 앱 캠페인은 앱 설치나 앱 내 행동을 늘리는 목적에 맞춰 캠페인 유형과 앱 연결 상태를 먼저 확인합니다.',
        sections: [
          {
            heading: '집행 전 확인',
            bullets: [
              { text: '앱 캠페인, 앱 설치, 사전 등록처럼 앱 성과를 만들려는 캠페인 유형을 먼저 구분합니다.', terms: ['앱 캠페인', '앱 설치', '사전 등록', 'App campaign', 'App Install'] },
              { text: '앱 이벤트, 측정, 추적 설정은 실제 계정과 앱 연결 상태를 기준으로 확인해야 합니다.', terms: ['앱 이벤트', '측정', '추적', '계정', '연결'] },
            ],
          },
        ],
        summary: '정리하면, 앱 캠페인 유형과 앱 연결·측정 상태를 함께 대조한 뒤 소재와 정책 조건을 확인해야 합니다.',
        model: 'compass-answer-deterministic-google-app',
      };

    case 'naver_da':
      return {
        family,
        intro: '네이버 DA/디스플레이 계열 상품은 노출 지면과 보장형/성과형 운영 조건을 함께 봐야 합니다.',
        sections: [
          {
            heading: '확인할 상품/지면',
            bullets: [
              { text: 'DA 또는 디스플레이 광고는 검색형 상품과 별도로 지면, 소재, 과금 조건을 확인합니다.', terms: ['DA', '디스플레이 광고', '성과형 디스플레이', '배너 광고'] },
              { text: '홈피드, 스마트채널, 타임보드, 롤링보드처럼 지면명이 확인되면 해당 지면별 조건을 따로 대조합니다.', terms: ['홈피드', '스마트채널', '타임보드', '롤링보드'] },
            ],
          },
          {
            heading: '운영 전 확인',
            bullets: [
              { text: '소재 규격, 업종 제한, 심사 조건은 지면별로 달라질 수 있어 원문 기준으로 확인해야 합니다.', terms: ['소재', '규격', '업종 제한', '심사', '등록 기준'] },
            ],
          },
        ],
        summary: '정리하면, 네이버 DA는 상품명보다 지면과 소재·심사 조건을 먼저 좁혀 확인하는 것이 안전합니다.',
        model: 'compass-answer-deterministic-naver-da',
      };

    case 'naver_video':
      return {
        family,
        intro: '네이버 동영상 광고는 현재 확보된 공식 근거에서 동영상 소재, 노출 지면, 심사 조건이 직접 확인되는 범위로만 봐야 합니다.',
        sections: [
          {
            heading: '동영상 관련 확인 항목',
            bullets: [
              { text: '동영상 광고나 동영상 소재가 언급되는 상품/지면부터 먼저 확인합니다.', terms: ['동영상 광고', '동영상광고', '동영상 소재', '비디오 광고', '동영상 조회'] },
              { text: '숏폼, 아웃스트림, 쇼츠처럼 별도 지면명이 확인되면 해당 지면별 소재 조건을 따로 봅니다.', terms: ['숏폼', '아웃스트림', '쇼츠', 'Shorts'] },
              { text: '영상 길이, 비율, 파일 형식, 심사 조건은 제작 가이드 또는 지면별 기준과 함께 확인해야 합니다.', terms: ['길이', '비율', '파일', '형식', '심사', '제작 가이드'] },
            ],
          },
        ],
        summary: '정리하면, 네이버 동영상 상품은 상품명 하나로 단정하지 말고 동영상이 노출되는 지면과 소재 조건을 함께 좁혀 확인해야 합니다.',
        model: 'compass-answer-deterministic-naver-video',
      };

    case 'naver_shopping':
      return {
        family,
        intro: '네이버 쇼핑검색/쇼핑 지면은 상품 노출 목적과 상품 DB·등록 조건을 함께 확인해야 합니다.',
        sections: [
          {
            heading: '상품/지면',
            bullets: [
              { text: '사이트검색광고는 키워드 검색 기반으로 웹사이트 방문을 늘릴 때 검토합니다.', terms: ['사이트검색광고', '웹사이트 방문'] },
              { text: '쇼핑검색광고는 쇼핑몰 상품형처럼 상품 노출과 유입을 함께 다룰 때 확인합니다.', terms: ['쇼핑검색광고', '쇼핑검색', '쇼핑몰 상품형'] },
              { text: '쇼핑블록이나 주요 쇼핑 지면은 PC·모바일 쇼핑 지면의 노출 목적을 따로 확인합니다.', terms: ['쇼핑블록', '쇼핑 지면', 'PC 쇼핑블록', '모바일 쇼핑'] },
            ],
          },
          {
            heading: '운영 전 확인',
            bullets: [
              { text: '상품 DB URL, EP, 상품정보 수신, 카테고리 매칭 같은 등록 조건을 함께 확인해야 합니다.', terms: ['상품 DB', '상품DB', 'DB URL', 'EP', '상품정보 수신', '카테고리 매칭'] },
            ],
          },
        ],
        summary: '정리하면, 목적에 맞는 검색·쇼핑 지면을 고른 뒤 상품 DB와 등록 기준을 함께 대조하는 흐름이 안전합니다.',
        model: 'compass-answer-naver-shopping-data-operational',
      };

    case 'kakao_bizboard':
      return {
        family,
        intro: '카카오 비즈보드는 카카오 주요 지면 노출 목적과 소재·심사 기준을 함께 확인해야 하는 디스플레이 계열 상품입니다.',
        sections: [
          {
            heading: '상품/지면',
            bullets: [
              { text: '비즈보드 또는 디스플레이 광고는 카카오 주요 지면에서 브랜드 노출을 검토할 때 확인합니다.', terms: ['비즈보드', '디스플레이 광고', '카카오모먼트'] },
              { text: '상품가이드는 상품별 집행 조건을 확인하되, 업종 제한은 일반 상품 기능이 아니라 별도 심사 체크로 분리합니다.', terms: ['상품가이드', '상품 가이드', '업종 제한'] },
            ],
          },
          {
            heading: '소재/심사',
            bullets: [
              { text: '제작 가이드와 심사 가이드에서 이미지 비율, 텍스트 영역, 제한 업종을 함께 확인해야 합니다.', terms: ['제작 가이드', '심사 가이드', '이미지', '비율', '텍스트'] },
            ],
          },
        ],
        summary: '정리하면, 비즈보드는 지면 노출 목적과 제작·심사 기준을 함께 대조해야 합니다.',
        model: 'compass-answer-deterministic-kakao-bizboard',
      };

    case 'kakao_creative':
      return {
        family,
        intro: '카카오 광고 소재는 상품가이드, 제작가이드, 심사가이드를 함께 보며 지면별 제작 조건을 확인해야 합니다.',
        sections: [
          {
            heading: '제작 전 확인',
            bullets: [
              { text: '상품가이드에서 상품별 집행 조건과 노출 지면을 먼저 확인합니다.', terms: ['상품가이드', '상품 가이드', '노출 지면'] },
              { text: '제작가이드에서 이미지 비율, 텍스트 영역, 소재 크기 같은 제작 조건을 확인합니다.', terms: ['제작가이드', '제작 가이드', '이미지', '비율', '텍스트', '소재'] },
              { text: '심사가이드에서 금지 행위, 업종 제한, 소재 제한을 함께 대조합니다.', terms: ['심사가이드', '심사 가이드', '금지', '업종 제한', '제한'] },
            ],
          },
        ],
        summary: '정리하면, 카카오 소재는 상품별 지면과 제작·심사 기준을 나눠 확인하는 것이 안전합니다.',
        model: 'compass-answer-deterministic-kakao-creative',
      };

    default:
      return null;
  }
}

function getBroadProductAnswerProfile(family: ProductAnswerFamily): EvidenceBackedAnswerProfile | null {
  switch (family) {
    case 'meta_overview':
      return {
        family,
        intro: '제공된 Meta 근거 기준으로는 광고 형식, Shop/카탈로그형 커머스 흐름, Facebook·Instagram 노출 흐름을 중심으로 확인됩니다. 캠페인 목표나 자동화 기능은 해당 근거가 잡힌 경우에만 함께 대조해야 합니다.',
        sections: [
          {
            heading: '먼저 정할 것',
            bullets: [
              { text: '캠페인 목표는 인지도, 트래픽, 참여, 잠재 고객, 앱 홍보처럼 달성하려는 결과를 기준으로 고릅니다.', terms: ['캠페인 목표', '광고 관리자 목표', '마케팅 목표', '인지도', '트래픽', '참여', '잠재 고객', '앱 홍보'] },
              { text: '광고 형식은 컬렉션이나 슬라이드/캐러셀처럼 제품과 여러 이미지를 보여주는 방식이 확인됩니다.', terms: ['슬라이드 광고', '컬렉션 광고', '캐러셀', '카루셀', '컬렉션'] },
              { text: '노출 위치는 Facebook, Instagram 등 지면별 사양과 함께 확인해야 합니다.', terms: ['노출 위치', '게재 위치', 'Facebook', 'Instagram'] },
              { text: 'Shops나 Shop 광고는 Facebook·Instagram의 커머스 흐름과 상품 노출을 함께 볼 때 확인합니다.', terms: ['Shop', 'Shops', 'Shop 광고', 'Facebook 및 Instagram에서 Shop'] },
            ],
          },
          {
            heading: '추가로 확인할 기능',
            bullets: [
              { text: '카탈로그와 컬렉션은 상품 데이터와 구매 흐름을 함께 봅니다.', terms: ['카탈로그', 'Catalog', '컬렉션'] },
              { text: 'Advantage+ 같은 자동화 기능은 해당 공식 근거가 확인될 때 별도로 대조합니다.', terms: ['Advantage+', '어드밴티지'] },
            ],
          },
        ],
        summary: '정리하면, 이번 근거에서는 확인된 형식과 커머스 지면을 먼저 설명하고, 목표·자동화 같은 넓은 체계는 추가 공식 근거와 대조해야 합니다.',
        model: 'compass-answer-deterministic-meta-overview',
        minBullets: 3,
        coverageNotice: '범위 제한: 현재 선별 출처가 Meta 목표·리드·앱·측정 축을 모두 직접 뒷받침하지 않으면, 전체 상품 목록이 아니라 확인된 상품 구조만 답변합니다.',
        showContactOption: true,
        confidenceCap: 78,
        reviewStatus: 'limited',
      };

    case 'google_overview':
      return {
        family,
        intro: 'Google Ads는 캠페인 유형, 광고 애셋, 확장 소재, 측정 조건을 조합해 운영하는 구조로 보는 편이 안전합니다.',
        sections: [
          {
            heading: '캠페인 유형',
            bullets: [
              { text: '검색 캠페인은 검색 결과에서 수요를 포착할 때 확인합니다.', terms: ['검색 캠페인', '검색 광고'] },
              { text: '디스플레이 캠페인과 반응형 디스플레이 광고는 이미지·텍스트 조합으로 지면 노출을 다룰 때 확인합니다.', terms: ['디스플레이 캠페인', '반응형 디스플레이'] },
              { text: '쇼핑 광고는 상품 노출과 Merchant Center/상품 데이터 조건을 함께 봅니다.', terms: ['쇼핑 광고', '쇼핑 캠페인', 'Merchant Center'] },
              { text: '앱 캠페인과 리드 양식은 앱 성과 또는 잠재 고객 정보 수집 목적일 때 따로 확인합니다.', terms: ['앱 캠페인', '앱 설치', '리드 양식', 'Lead Form'] },
              { text: '실적 최대화와 검색 캠페인 문구 가이드는 자동화 캠페인과 검색 광고 소재 문구를 점검할 때 별도로 확인합니다.', terms: ['실적 최대화', 'Performance Max', 'PMax', '검색 캠페인', '광고 문구'] },
              { text: '동영상/YouTube와 Demand Gen 계열은 해당 캠페인 유형 근거가 잡힌 경우 별도 상품군으로 분리합니다.', terms: ['YouTube', '유튜브', '동영상', 'Video', 'Demand Gen', '디맨드젠'] },
            ],
          },
        ],
        summary: '정리하면, Google Ads는 목적에 맞는 캠페인 유형을 먼저 고르고, 애셋·확장 소재·측정 조건을 함께 대조해야 합니다.',
        model: 'compass-answer-deterministic-google-overview',
        minBullets: 4,
        coverageNotice: '범위 제한: PMax, Demand Gen, YouTube/동영상처럼 핵심 캠페인 축의 직접 근거가 없으면 해당 축은 확정 목록이 아니라 추가 확인 항목으로 남깁니다.',
        confidenceCap: 86,
      };

    case 'naver_overview':
      return {
        family,
        intro: '네이버 광고 상품은 검색 유입, 쇼핑 상품 노출, 주요 쇼핑/디스플레이 지면, 상품 DB 조건을 나눠 확인하는 편이 안전합니다.',
        sections: [
          {
            heading: '대표 상품군',
            bullets: [
              { text: '사이트검색광고는 키워드 검색 기반으로 웹사이트 방문을 늘릴 때 확인합니다.', terms: ['사이트검색광고', '웹사이트 방문'] },
              { text: '파워링크와 브랜드검색은 검색 노출 목적과 브랜드 홍보 목적을 나눠 확인합니다.', terms: ['파워링크', '브랜드검색', '브랜드 검색'] },
              { text: '쇼핑검색광고는 쇼핑몰 상품형처럼 상품 노출과 유입을 함께 다룰 때 확인합니다.', terms: ['쇼핑검색광고', '쇼핑검색', '쇼핑몰 상품형'] },
              { text: '쇼핑블록이나 주요 쇼핑 지면은 쇼핑몰 유입 또는 브랜딩 목적을 검토할 때 확인합니다.', terms: ['쇼핑블록', '쇼핑 지면', 'PC 쇼핑블록', '모바일 쇼핑'] },
              { text: '성과형/보장형 디스플레이와 DA 지면은 검색형 상품과 분리해 홈피드, 스마트채널, 타임보드, 롤링보드, 헤드라인DA 같은 지면 조건을 확인합니다.', terms: ['성과형 디스플레이', '보장형', '네이버 DA', '헤드라인DA', '홈피드', '스마트채널', '타임보드', '롤링보드'] },
              { text: '상품 DB URL, EP, 상품정보 수신 같은 조건은 쇼핑 상품 운영 전 함께 확인합니다.', terms: ['상품 DB', '상품DB', 'DB URL', 'EP', '상품정보 수신'] },
            ],
          },
        ],
        summary: '정리하면, 네이버는 검색형 상품과 쇼핑형 상품, 쇼핑 지면, 상품 DB 조건을 분리해서 검토해야 합니다.',
        model: 'compass-answer-deterministic-naver-overview',
        minBullets: 5,
        confidenceCap: 88,
      };

    case 'kakao_overview':
      return {
        family,
        intro: '카카오 광고 상품은 카카오 주요 지면, 소재 형식, 업종 제한, 심사 기준을 함께 확인하면서 상품과 집행 가능 범위를 정리하는 방식이 안전합니다.',
        sections: [
          {
            heading: '상품/지면',
            bullets: [
              { text: '비즈보드와 디스플레이 광고는 카카오 주요 지면에서 브랜드 노출을 검토할 때 확인합니다.', terms: ['비즈보드', '디스플레이 광고', '카카오모먼트'] },
              { text: '상품가이드는 상품별 집행 조건을 확인하되, 업종 제한은 별도 심사 체크 항목으로 분리해서 봅니다.', terms: ['상품가이드', '상품 가이드', '업종 제한'] },
              { text: '제작가이드와 심사가이드는 이미지 비율, 텍스트 영역, 제한 업종처럼 소재 조건을 대조할 때 필요합니다.', terms: ['제작가이드', '제작 가이드', '심사가이드', '심사 가이드', '이미지', '비율'] },
            ],
          },
        ],
        summary: '정리하면, 카카오는 상품 지면과 제작·심사 기준을 함께 확인해야 실제 집행 가능 여부를 판단할 수 있습니다.',
        model: 'compass-answer-deterministic-kakao-overview',
      };

    default:
      return null;
  }
}

function shouldUseDeterministicProductAnswerBeforeLlm() {
  // 고정 상품 답변은 운영 QA용 가드레일이다. 기본 흐름에서는 반드시
  // retrieval 근거를 LLM이 합성하게 두어 질문별 답변이 같은 템플릿으로
  // 수렴하지 않도록 한다.
  if (process.env.COMPASS_ALLOW_PRE_LLM_DETERMINISTIC_PRODUCT_ANSWERS !== 'true') {
    return false;
  }

  return process.env.COMPASS_DETERMINISTIC_PRODUCT_ANSWER_MODE === 'pre_llm'
    || process.env.COMPASS_ENABLE_DETERMINISTIC_PRODUCT_ANSWERS === 'true';
}

function shouldUseDeterministicProductAnswerOnLlmFailure() {
  // LLM 연결 실패 시에도 기본값은 실제 출처 요약 폴백이다.
  // 고정 상품 프로필은 QA/회귀 테스트용으로 명시적으로 켠 경우에만 사용한다.
  return process.env.COMPASS_ENABLE_DETERMINISTIC_PRODUCT_FALLBACK_ON_LLM_FAILURE === 'true';
}

function buildDeterministicSpecificProductAnswer(
  message: string,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
): DeterministicProductAnswer | null {
  if (
    !intent.topics.includes('product_structure')
    || (!intent.isSpecificProductGuidance && !hasNamedSpecificProductQuestion(message))
  ) {
    return null;
  }

  const family = detectProductAnswerFamily(message, intent);
  const sources = scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources;
  if (sources.length === 0) return null;

  const profile = getSpecificProductAnswerProfile(family, scope.mode);
  if (!profile) return null;

  const answer = buildEvidenceBackedAnswer(profile, sources);
  if (answer) return answer;

  const vendorLabel = intent.vendors.map(vendor => VENDOR_LABELS[vendor] || vendor).join(', ') || '해당 매체';
  const productLabel = `${vendorLabel} ${getSpecificProductLabel(intent)}`;
  return buildDeterministicScopeNoticeAnswer(productLabel, sources, `${profile.model}-scope-limited`);
}

function buildDeterministicBroadProductAnswer(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  if (!isBroadProductStructureAnswerIntent(message, intent) || sources.length === 0) {
    return null;
  }

  const family = detectProductAnswerFamily(message, intent);
  const profile = getBroadProductAnswerProfile(family)
    || getSpecificProductAnswerProfile(family, 'product_detail');
  if (!profile) return null;

  return buildEvidenceBackedAnswer(profile, sources);
}

function getDeterministicProductConfidence(
  baseConfidence: number,
  answer: DeterministicProductAnswer,
) {
  return answer.confidenceCap ? Math.min(baseConfidence, answer.confidenceCap) : baseConfidence;
}

function buildDeterministicProductReviewPipeline(
  answer: DeterministicProductAnswer,
  sourceCount: number,
) {
  const showContactOption = Boolean(answer.showContactOption);
  return buildReviewPipeline({
    status: answer.reviewStatus || 'completed',
    sourceCount,
    verifiedSourceCount: answer.sources.length,
    contactRecommended: showContactOption,
  });
}

type SpecificProductGeneratedAnswerRepair = {
  answer: string;
  sources: ReturnType<typeof buildVerifiedSources>;
  model: string;
  reason:
    | 'missing_requested_product_family'
    | 'generic_product_structure'
    | 'extractive_source_dump'
    | 'insufficient_specific_depth'
    | 'kakao_scope_risk';
  showContactOption?: boolean;
  confidenceCap?: number;
  reviewStatus?: CompassReviewPipelineStatus;
};

function getExpectedProductAnswerFamilyPattern(family: ProductAnswerFamily): RegExp | null {
  switch (family) {
    case 'meta_app_install':
      return /앱\s*(인스톨|설치|홍보|캠페인|사전\s*등록|이벤트)|app\s*(install|promotion)|sdk|mmp|모바일\s*측정|앱\s*등록|앱\s*이벤트/i;
    case 'meta_lead':
      return /리드\s*양식|잠재\s*고객|잠재고객|lead\s*(form|ads?|generation)|비즈니스\s*폼|양식\s*제출/i;
    case 'meta_catalog':
      return /카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지/i;
    case 'google_lead':
      return /리드\s*양식|lead\s*form|잠재\s*고객|양식\s*확장|양식\s*제출/i;
    case 'google_app':
      return /앱\s*(캠페인|설치|인스톨|홍보|사전\s*등록|이벤트)|app\s*(campaign|install|promotion)|firebase|sdk|측정|추적/i;
    case 'naver_da':
      return /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|디스플레이|성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드|배너/i;
    case 'naver_video':
      return /동영상|비디오|숏폼|쇼츠|shorts|아웃스트림|영상\s*(길이|비율|소재)/i;
    case 'naver_shopping':
      return /쇼핑검색|쇼핑블록|쇼핑\s*지면|상품\s*db|상품db|db\s*url|dburl|\bep\b|쇼핑파트너센터|상품등록|상품\s*등록|가격비교/i;
    case 'kakao_bizboard':
      return /비즈보드|bizboard|디스플레이|카카오\s*주요\s*지면|카카오모먼트/i;
    case 'kakao_creative':
      return /제작\s*가이드|제작가이드|심사\s*가이드|심사가이드|상품\s*가이드|상품가이드|소재|이미지|비율|텍스트|업종\s*제한/i;
    default:
      return null;
  }
}

function isSpecificProductAnswerGateTarget(
  message: string,
  intent: QueryIntent,
  isBroadProductStructureLlmIntent: boolean,
) {
  return (
    !isBroadProductStructureLlmIntent
    && intent.topics.includes('product_structure')
    && (intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(message))
  );
}

function answerMentionsRequestedProductFamily(
  answer: string,
  message: string,
  intent: QueryIntent,
) {
  const family = detectProductAnswerFamily(message, intent);
  const pattern = getExpectedProductAnswerFamilyPattern(family);
  if (!pattern) return true;
  return pattern.test(answer);
}

function answerLooksLikeGenericProductStructure(answer: string) {
  const normalized = normalizeProductIntentText(answer);
  const genericSignals = [
    /상품명\s*하나를\s*고르는\s*방식/,
    /캠페인\s*목표부터\s*정하기/,
    /목표에\s*맞는\s*광고\s*형식/,
    /광고\s*목적과\s*노출\s*지면부터\s*확인/,
    /운영\s*전에\s*확인할\s*조건/,
    /상황별\s*빠른\s*선택\s*기준/,
    /검색\s*유입,\s*쇼핑\s*상품\s*노출,\s*주요\s*쇼핑\s*지면/,
    /대표\s*상품군/,
  ];

  return genericSignals.some(pattern => pattern.test(normalized));
}

function answerLooksLikeExtractiveSourceDump(answer: string) {
  const normalized = normalizeProductIntentText(answer);
  const dumpSignals = [
    /제공된\s*(검증\s*)?출처\s*기준으로만\s*정리/,
    /제공된\s*근거\s*기준으로는.*정보가\s*확인/,
    /출처에\s*명시되지\s*않은.*추가\s*확인/,
    /(meta|google|naver|kakao|메타|구글|네이버|카카오)\s*(광고\s*)?(가이드|규정|정책)\s*:/,
    /작동\s*방식\s*[a-z가-힣\s]*\[\s*s\d+\s*\]/i,
    /현재\s*제공된\s*문서에서는\s*확인되지\s*않습니다/,
  ];

  return dumpSignals.filter(pattern => pattern.test(normalized)).length >= 2;
}

function getSpecificProductDepthPattern(family: ProductAnswerFamily): RegExp | null {
  switch (family) {
    case 'meta_app_install':
      return /sdk|mmp|앱\s*이벤트|앱\s*등록|app\s*id|app\s*secret|포스트백|추적|트래킹|캠페인\s*설정|스토어|비즈니스\s*설정/i;
    case 'meta_lead':
      return /리드\s*양식|잠재\s*고객|양식\s*제출|개인정보|고지|동의|비즈니스\s*폼|문의|상담/i;
    case 'meta_catalog':
      return /카탈로그|catalog|컬렉션|collection|advantage\+|상품\s*데이터|상품\s*세트|구매\s*흐름|커머스/i;
    case 'google_lead':
      return /리드\s*양식|lead\s*form|양식\s*확장|잠재\s*고객|연락처|고지|동의|캠페인/i;
    case 'google_app':
      return /앱\s*(캠페인|설치|인스톨|사전\s*등록|이벤트)|firebase|sdk|측정|추적|연결|스토어/i;
    case 'naver_da':
      return /da|디스플레이|성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드|배너|지면/i;
    case 'naver_video':
      return /동영상|비디오|숏폼|쇼츠|아웃스트림|길이|비율|파일|형식|소재|심사|노출/i;
    case 'naver_shopping':
      return /쇼핑검색|쇼핑블록|상품\s*db|상품db|db\s*url|dburl|\bep\b|쇼핑파트너센터|상품\s*등록|카테고리|가격비교|입점/i;
    case 'kakao_bizboard':
      return /비즈보드|bizboard|디스플레이|카카오모먼트|상품가이드|제작\s*가이드|심사\s*가이드|지면|톡채널/i;
    case 'kakao_creative':
      return /제작\s*가이드|심사\s*가이드|상품\s*가이드|소재|이미지|비율|텍스트|업종\s*제한|리사이징|홍보이미지|홍보동영상/i;
    default:
      return null;
  }
}

function answerHasSpecificOperationalDepth(
  answer: string,
  message: string,
  intent: QueryIntent,
) {
  const family = detectProductAnswerFamily(message, intent);
  const depthPattern = getSpecificProductDepthPattern(family);
  if (!depthPattern) return true;
  return depthPattern.test(answer);
}

function getSpecificProductGeneratedAnswerRepairReason(
  mentionsRequestedFamily: boolean,
  genericProductStructure: boolean,
  extractiveSourceDump: boolean,
  hasSpecificDepth: boolean,
): SpecificProductGeneratedAnswerRepair['reason'] {
  if (!mentionsRequestedFamily) return 'missing_requested_product_family';
  if (extractiveSourceDump) return 'extractive_source_dump';
  if (!hasSpecificDepth) return 'insufficient_specific_depth';
  return genericProductStructure ? 'generic_product_structure' : 'insufficient_specific_depth';
}

function buildSpecificProductGeneratedAnswerRepair(
  message: string,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
  isBroadProductStructureLlmIntent: boolean,
  rawGeneratedAnswer: string,
  operationalAnswer: string | null,
): SpecificProductGeneratedAnswerRepair | null {
  if (!isSpecificProductAnswerGateTarget(message, intent, isBroadProductStructureLlmIntent)) {
    return null;
  }

  const mentionsRequestedFamily = answerMentionsRequestedProductFamily(rawGeneratedAnswer, message, intent);
  const genericProductStructure = answerLooksLikeGenericProductStructure(rawGeneratedAnswer);
  const extractiveSourceDump = answerLooksLikeExtractiveSourceDump(rawGeneratedAnswer);
  const hasSpecificDepth = answerHasSpecificOperationalDepth(rawGeneratedAnswer, message, intent);
  const kakaoScopeRisk = answerHasKakaoSpecificScopeRisk(rawGeneratedAnswer, message, intent);
  if (rawGeneratedAnswer && mentionsRequestedFamily && hasSpecificDepth && !genericProductStructure && !extractiveSourceDump && !kakaoScopeRisk) {
    return null;
  }
  const repairReason = kakaoScopeRisk ? 'kakao_scope_risk' : getSpecificProductGeneratedAnswerRepairReason(
    mentionsRequestedFamily,
    genericProductStructure,
    extractiveSourceDump,
    hasSpecificDepth,
  );

  if (kakaoScopeRisk) {
    const evidenceBackedAnswer = buildDeterministicSpecificProductAnswer(message, intent, scope);
    if (evidenceBackedAnswer) {
      return {
        answer: evidenceBackedAnswer.answer,
        sources: evidenceBackedAnswer.sources,
        model: `${evidenceBackedAnswer.model}-scope-risk-repair`,
        reason: repairReason,
        showContactOption: evidenceBackedAnswer.showContactOption,
        confidenceCap: evidenceBackedAnswer.confidenceCap,
        reviewStatus: evidenceBackedAnswer.reviewStatus,
      };
    }
  }

  if (operationalAnswer) {
    return {
      answer: operationalAnswer,
      sources: scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources,
      model: 'compass-answer-specific-product-operational-repair',
      reason: repairReason,
    };
  }

  const structuredFallback = buildStructuredSpecificProductScopeLimitedAnswer(
    scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources,
    intent,
    message,
  );
  if (structuredFallback) {
    return {
      answer: structuredFallback,
      sources: scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources,
      model: 'compass-answer-specific-product-structured-repair',
      reason: repairReason,
    };
  }

  const sourceGuidedFallback = buildSourceGuidedLlmFailureFallbackAnswer(
    message,
    scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources,
    intent,
    scope,
    isBroadProductStructureLlmIntent,
  );
  if (sourceGuidedFallback) {
    return {
      answer: sourceGuidedFallback,
      sources: scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources,
      model: 'compass-answer-specific-product-source-guided-repair',
      reason: repairReason,
    };
  }

  const evidenceBackedAnswer = shouldUseDeterministicProductAnswerOnLlmFailure()
    ? buildDeterministicSpecificProductAnswer(message, intent, scope)
    : null;
  if (evidenceBackedAnswer) {
    return {
      answer: evidenceBackedAnswer.answer,
      sources: evidenceBackedAnswer.sources,
      model: `${evidenceBackedAnswer.model}-post-llm-repair`,
      reason: repairReason,
      showContactOption: evidenceBackedAnswer.showContactOption,
      confidenceCap: evidenceBackedAnswer.confidenceCap,
      reviewStatus: evidenceBackedAnswer.reviewStatus,
    };
  }

  return null;
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
  if (/암호화폐|사회\s*문제|정치|선거|주택|고용|신용|제한된\s*상품|금지된\s*상품|민감한\s*카테고리/.test(text)
    && !/캠페인\s*(목표|유형|목적)|광고\s*(상품|종류|유형|구조)|상품\s*구조|광고\s*관리자\s*목표|마케팅\s*목표/.test(text)
  ) return true;
  if (/공지사항|성공전략|성공사례|광고운영팁|검색어 입력 창|thumbnail|sequence|badge|전체 공통/.test(text)
    && !/상품\s*db|db\s*url|쇼핑파트너센터|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑|가격비교|광고\s*등록\s*기준|광고등록기준|디지털\s*옥외광고[\s\S]{0,80}불가\s*업종|쇼핑검색[\s\S]{0,80}필터/.test(text)
  ) return true;
  if (/^블로그$|blog|news|뉴스|도움말$/.test(title) && !hasCoreSignal) return true;
  if (/self\.__next_f|static\/css|webpack|hydration/.test(text) && !hasCoreSignal) return true;
  return false;
}

function sourceLooksLikeGranularCreativeSpecOnly(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const titleText = normalizeEvidenceText(`${source.title || ''} ${source.originalTitle || ''}`);
  const text = normalizeEvidenceText(getProductStructureVisibleSourceText(source) || getSourceText(source));
  const hasGranularSpecSignal = /광고\s*사양|이미지\s*광고\s*사양|동영상\s*광고\s*사양|슬라이드\s*광고\s*사양|스토리\s*광고\s*사양|릴스\s*광고\s*사양|소재\s*(사양|규격)|기술\s*요구\s*사항|디자인\s*추천\s*사항|텍스트\s*추천\s*사항|파일\s*(크기|형식)|지원\s*형식|화면\s*비율|이미지\s*비율|동영상\s*비율|종횡비|최소\s*(너비|높이)|최대\s*파일|해상도/.test(text);
  if (!hasGranularSpecSignal) return false;

  const titleLooksLikeSinglePlacementSpec = /광고\s*사양|이미지\s*광고\s*사양|동영상\s*광고\s*사양|슬라이드\s*광고\s*사양|스토리\s*광고\s*사양|릴스\s*광고\s*사양/.test(titleText);
  const hasTrueOverviewSignal = /광고\s*(상품|종류|유형|구조)|상품\s*구조|캠페인\s*(목표|유형|목적)|광고\s*관리자\s*목표|마케팅\s*목표|목적별|인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재\s*고객[\s\S]{0,80}앱\s*홍보[\s\S]{0,80}판매|검색광고[\s\S]{0,120}쇼핑검색|사이트검색광고[\s\S]{0,120}쇼핑검색광고|비즈보드[\s\S]{0,120}디스플레이|상품\s*가이드|상품가이드|상품\s*db|db\s*url/.test(text);
  if (titleLooksLikeSinglePlacementSpec && !hasTrueOverviewSignal) return true;

  const hasStrongOverviewSignal = hasTrueOverviewSignal || /advantage\+|어드밴티지|카탈로그|catalog/.test(text);
  return !hasStrongOverviewSignal;
}

function hasProductStructureGraphSourceSignal(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const text = getProductStructureVisibleSourceText(source);
  return /캠페인\s*(목표|유형|목적)|광고\s*(상품|종류|유형|구조)|상품\s*구조|광고\s*관리자\s*목표|마케팅\s*목표|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|비즈보드|상품\s*db|db\s*url|쇼핑검색|쇼핑블록|사이트검색광고|쇼핑검색광고|브랜드검색|파워링크|상품가이드|상품\s*가이드|campaign\s*objective|objectives?|catalog|app\s*(install|promotion)/.test(text);
}

function isLowValueProductStructureGraphSource(source: ReturnType<typeof buildVerifiedSources>[number]) {
  if (!isGraphVerifiedSource(source)) return false;
  const text = getProductStructureVisibleSourceText(source);
  if (sourceLooksLikeGranularCreativeSpecOnly(source) && /광고\s*사양|기술\s*요구\s*사항|파일\s*(크기|형식)|화면\s*비율/.test(text)) return true;
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
  if (/캠페인\s*(목표|유형|목적)|광고\s*(상품|종류|유형|구조)|상품\s*구조|광고\s*관리자\s*목표|마케팅\s*목표|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|비즈보드|상품\s*db|db\s*url|상품가이드|상품\s*가이드|campaign\s*objective|objectives?|catalog/.test(text)) {
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
  if (hasExplicitOtherVendorSignal(source, vendor)) return false;
  if (explicitGraphSourceMatchesVendor(source, vendor)) return true;
  if (source.sourceVendor === vendor || Boolean(source.sourceVendors?.includes(vendor))) return true;

  const text = getSourceText(source);
  const vendorTerms: Record<VendorIntent, RegExp> = {
    META: /meta|facebook|페이스북|instagram|인스타그램|릴스|reels|advantage\+|어드밴티지|메타\s*픽셀/,
    KAKAO: /kakao|카카오|카카오톡|톡채널|비즈보드|모먼트|카카오\s*디스플레이|카카오모먼트/,
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
  const metadata = sourceLike.metadata || {};
  const primaryIdentityText = [
    source.title,
    source.originalTitle,
    sourceLike.documentTitle,
    sourceLike.originalTitle,
    source.url,
    sourceLike.documentUrl,
    sourceLike.url,
    sourceLike.documentId,
    metadata.title,
    metadata.document_title,
    metadata.source_title,
    metadata.canonical_title,
    metadata.source,
    metadata.source_url,
    metadata.document_url,
    metadata.url,
  ].filter(Boolean).join(' ').toLowerCase();
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

function buildBroadProductStructureQueryTerms(intent?: QueryIntent, message = '') {
  const terms = new Set<string>();
  const add = (...items: Array<string | undefined>) => {
    for (const item of items) {
      const term = item?.trim();
      if (term && term.length >= 2) terms.add(term);
    }
  };

  add(...(intent?.keywords || []), ...(intent?.strictProductTerms || []));

  const focus = intent ? buildRequestedProductFocus(message, intent) : null;
  if (focus) {
    add(focus.label, ...focus.aliases, ...focus.queryTerms);
  }

  for (const vendor of intent?.vendors || []) {
    switch (vendor) {
      case 'META':
        add('Meta', 'Facebook', 'Instagram', '캠페인 목표', '광고 관리자 목표', '마케팅 목표', 'Advantage+', '카탈로그', '컬렉션 광고', '앱 홍보', '리드 양식');
        break;
      case 'GOOGLE':
        add('Google Ads', '검색 캠페인', '디스플레이 캠페인', '쇼핑 광고', '앱 캠페인', '리드 양식', '확장 소재');
        break;
      case 'NAVER':
        add('네이버', '사이트검색광고', '쇼핑검색광고', '쇼핑블록', '브랜드검색', '파워링크', '상품 DB', 'DB URL', 'DA 상품', '디스플레이 광고', '동영상 광고');
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
    '캠페인 목표', '광고 관리자 목표', '마케팅 목표',
  );

  return Array.from(terms);
}

type ProductStructureCoverageTerm = {
  label: string;
  pattern: RegExp;
  aliases: string[];
};

type RequestedProductFocus = ProductStructureCoverageTerm & {
  family: ProductAnswerFamily;
  isSpecificFamilyQuestion: boolean;
  queryTerms: string[];
};

function isSpecificRequestedProductFamily(family: ProductAnswerFamily) {
  return ![
    'unknown',
    'meta_overview',
    'google_overview',
    'naver_overview',
    'kakao_overview',
  ].includes(family);
}

function getRequestedProductFocusConfig(family: ProductAnswerFamily): Omit<RequestedProductFocus, 'family' | 'isSpecificFamilyQuestion'> | null {
  switch (family) {
    case 'meta_app_install':
      return {
        label: 'Meta 앱 인스톨/앱 홍보',
        pattern: /앱\s*(인스톨|설치|홍보|캠페인|사전\s*등록|이벤트|등록)|app\s*(install|promotion|campaign)|sdk|mmp|추적|트래킹|tracking/i,
        aliases: ['앱 인스톨', '앱 설치', '앱 홍보', '앱 캠페인', 'App Install', 'App Promotion', 'SDK', 'MMP', '트래킹'],
        queryTerms: ['앱 인스톨', '앱 홍보', '앱 캠페인', 'App Install', 'App Promotion', 'SDK', 'MMP', '트래킹', '앱 등록'],
      };
    case 'meta_lead':
      return {
        label: 'Meta 리드 양식',
        pattern: /리드\s*양식|잠재\s*고객|lead\s*(form|ads?|generation)|비즈니스\s*폼|비즈니스폼/i,
        aliases: ['리드 양식', '잠재 고객', 'Lead Form', 'Lead Ads', '비즈니스 폼'],
        queryTerms: ['리드 양식', '잠재 고객', 'Lead Form', 'Lead Ads', '비즈니스 폼'],
      };
    case 'meta_catalog':
      return {
        label: 'Meta 카탈로그/컬렉션',
        pattern: /카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지/i,
        aliases: ['카탈로그', '컬렉션 광고', 'Catalog', 'Collection', 'Advantage+', '어드밴티지'],
        queryTerms: ['카탈로그', '컬렉션 광고', 'Catalog', 'Collection', 'Advantage+', '어드밴티지'],
      };
    case 'google_lead':
      return {
        label: 'Google 리드 양식',
        pattern: /리드\s*양식|잠재\s*고객|lead\s*(form|ads?|generation)|양식\s*확장|lead\s*asset/i,
        aliases: ['리드 양식', '잠재 고객', 'Lead Form', 'Lead Asset', '양식 확장'],
        queryTerms: ['리드 양식', 'Lead Form', 'Lead Asset', '잠재 고객', '양식 확장'],
      };
    case 'google_app':
      return {
        label: 'Google 앱 캠페인',
        pattern: /앱\s*(캠페인|설치|인스톨|홍보|사전\s*등록)|app\s*(campaign|install|promotion)|사전\s*등록/i,
        aliases: ['앱 캠페인', '앱 설치', '앱 인스톨', 'App Campaign', 'App Install', '사전 등록'],
        queryTerms: ['앱 캠페인', '앱 설치', 'App Campaign', 'App Install', '사전 등록'],
      };
    case 'naver_da':
      return {
        label: '네이버 DA/디스플레이 광고',
        pattern: /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|디스플레이\s*광고|성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드|배너\s*광고/i,
        aliases: ['네이버 DA', 'DA 상품', '디스플레이 광고', '성과형 디스플레이', '홈피드', '스마트채널', '타임보드', '롤링보드', '배너 광고'],
        queryTerms: ['네이버 DA', 'DA 상품', '디스플레이 광고', '성과형 디스플레이', '홈피드', '스마트채널', '타임보드', '롤링보드', '배너 광고'],
      };
    case 'naver_video':
      return {
        label: '네이버 동영상 광고',
        pattern: /동영상\s*광고|비디오\s*광고|동영상\s*소재|동영상\s*조회|숏폼|쇼츠|아웃스트림|video/i,
        aliases: ['동영상 광고', '비디오 광고', '동영상 소재', '동영상 조회', '숏폼', '아웃스트림'],
        queryTerms: ['동영상 광고', '비디오 광고', '동영상 소재', '동영상 조회', '숏폼', '아웃스트림'],
      };
    case 'naver_shopping':
      return {
        label: '네이버 쇼핑검색/상품 DB',
        pattern: /쇼핑검색광고|쇼핑검색|쇼핑몰\s*상품형|쇼핑블록|상품\s*db|상품db|db\s*url|dburl|ep|상품등록|상품\s*등록|가격비교|쇼핑파트너센터/i,
        aliases: ['쇼핑검색광고', '쇼핑검색', '쇼핑몰 상품형', '쇼핑블록', '상품 DB', 'DB URL', 'EP', '상품등록', '가격비교', '쇼핑파트너센터'],
        queryTerms: ['쇼핑검색광고', '쇼핑검색', '쇼핑몰 상품형', '쇼핑블록', '상품 DB', 'DB URL', 'EP', '상품등록', '가격비교', '쇼핑파트너센터'],
      };
    case 'kakao_bizboard':
      return {
        label: '카카오 비즈보드/디스플레이',
        pattern: /비즈보드|bizboard|톡보드|디스플레이\s*광고|카카오모먼트|display/i,
        aliases: ['비즈보드', '톡보드', 'Bizboard', '디스플레이 광고', '카카오모먼트'],
        queryTerms: ['비즈보드', '톡보드', 'Bizboard', '디스플레이 광고', '카카오모먼트'],
      };
    case 'kakao_creative':
      return {
        label: '카카오 상품/제작 가이드',
        pattern: /상품\s*가이드|상품가이드|제작\s*가이드|제작가이드|소재\s*가이드|소재|이미지\s*비율|텍스트\s*영역|심사|검수/i,
        aliases: ['상품가이드', '제작 가이드', '소재 가이드', '이미지 비율', '텍스트 영역', '심사', '검수'],
        queryTerms: ['상품가이드', '제작 가이드', '소재 가이드', '이미지 비율', '텍스트 영역', '심사', '검수'],
      };
    default:
      return null;
  }
}

function buildRequestedProductFocus(message: string, intent?: QueryIntent): RequestedProductFocus | null {
  if (!intent || intent.vendors.length !== 1 || !intent.topics.includes('product_structure')) return null;

  const family = detectProductAnswerFamily(message, intent);
  const config = getRequestedProductFocusConfig(family);
  if (!config) return null;

  const normalizedQuestion = normalizeProductIntentText([
    message,
    ...(intent.keywords || []),
    ...(intent.strictProductTerms || []),
    ...(intent.strictContextTerms || []),
  ].join(' '));
  const compactQuestion = normalizedQuestion.replace(/\s+/g, '');
  const hasFocusSignal = config.pattern.test(normalizedQuestion)
    || config.pattern.test(compactQuestion)
    || config.aliases.some(alias => textContainsEvidenceTerm(normalizedQuestion, alias));

  return {
    ...config,
    family,
    isSpecificFamilyQuestion: isSpecificRequestedProductFamily(family)
      && !isExplicitWholeProductCatalogQuestion(message)
      && (
        intent.isSpecificProductGuidance
        || hasNamedSpecificProductQuestion(message)
        || hasSpecificProductActionOrPolicySignalQuestion(message)
        || hasFocusSignal
      ),
  };
}

function sourceMatchesRequestedProductFocus(
  source: ReturnType<typeof buildVerifiedSources>[number],
  focus: RequestedProductFocus | null,
) {
  if (!focus) return true;
  const text = getSpecificProductEvidenceText(source);
  const compactText = text.replace(/\s+/g, '');
  return focus.pattern.test(text)
    || focus.pattern.test(compactText)
    || focus.aliases.some(alias => textContainsEvidenceTerm(text, alias));
}

function scoreRequestedProductFocus(
  source: ReturnType<typeof buildVerifiedSources>[number],
  focus: RequestedProductFocus | null,
) {
  if (!focus) return 0;

  const text = getSpecificProductEvidenceText(source);
  const compactText = text.replace(/\s+/g, '');
  let score = 0;

  if (focus.pattern.test(text) || focus.pattern.test(compactText)) score += 1.45;

  const aliasHits = focus.aliases.filter(alias => textContainsEvidenceTerm(text, alias)).length;
  score += Math.min(2.2, aliasHits * 0.42);

  const queryHits = focus.queryTerms.filter(term => textContainsEvidenceTerm(text, term)).length;
  score += Math.min(1.8, queryHits * 0.32);

  if (focus.isSpecificFamilyQuestion && score === 0) score -= 3.4;
  return score;
}

function buildRequestedProductStructureCoverageTerms(intent?: QueryIntent, message = ''): ProductStructureCoverageTerm[] {
  if (!intent) return [];

  const queryText = normalizeProductIntentText([
    message,
    ...(intent.keywords || []),
    ...(intent.strictProductTerms || []),
    ...(intent.strictContextTerms || []),
  ].join(' '));
  const compactQueryText = queryText.replace(/\s+/g, '');
  const vendors = new Set(intent.vendors || []);
  const candidates: ProductStructureCoverageTerm[] = [];
  const pushCoverage = (vendor: VendorIntent, label: string, pattern: RegExp, aliases: string[]) => {
    if (vendors.size > 0 && !vendors.has(vendor)) return;
    candidates.push({ label, pattern, aliases });
  };
  const add = (vendor: VendorIntent, label: string, pattern: RegExp, aliases: string[]) => {
    if (vendors.size > 0 && !vendors.has(vendor)) return;
    if (pattern.test(queryText) || pattern.test(compactQueryText)) {
      pushCoverage(vendor, label, pattern, aliases);
    }
  };

  add('META', '캠페인 목표', /캠페인\s*목표|광고\s*관리자\s*목표|마케팅\s*목표|인지도|트래픽|참여|잠재\s*고객|판매|objective/i, ['캠페인 목표', '광고 관리자 목표', '인지도', '트래픽', '참여', '잠재 고객', '판매']);
  add('META', '앱 홍보/앱 인스톨', /앱\s*(홍보|인스톨|설치|캠페인|이벤트)|앱인스톨|앱설치|app\s*(install|promotion|campaign)/i, ['앱 홍보', '앱 인스톨', '앱 캠페인', 'app install', 'app promotion']);
  add('META', '카탈로그/컬렉션', /카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지/i, ['카탈로그', '컬렉션 광고', 'Advantage+', '어드밴티지']);
  add('META', '리드 양식', /리드\s*양식|잠재\s*고객|lead\s*form|lead\s*generation|비즈니스\s*폼/i, ['리드 양식', '잠재 고객', 'lead form']);
  add('META', '광고 소재 형식', /이미지|동영상|비디오|카루셀|슬라이드|소재\s*형식|광고\s*형식/i, ['이미지 광고', '동영상 광고', '카루셀 광고', '광고 형식']);

  add('NAVER', '사이트검색광고', /사이트검색광고|사이트검색|파워링크/i, ['사이트검색광고', '사이트검색', '파워링크']);
  add('NAVER', '쇼핑검색광고', /쇼핑검색광고|쇼핑검색|쇼핑몰\s*상품형|상품형/i, ['쇼핑검색광고', '쇼핑검색', '쇼핑몰 상품형']);
  add('NAVER', '쇼핑블록/쇼핑 지면', /쇼핑블록|쇼핑\s*블록|주요\s*쇼핑\s*지면|pc\s*쇼핑블록|mo\s*쇼핑블록/i, ['쇼핑블록', '쇼핑 지면', 'PC 쇼핑블록', 'MO 쇼핑블록']);
  add('NAVER', '브랜드검색', /브랜드검색/i, ['브랜드검색']);
  add('NAVER', '네이버 DA', /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드|배너\s*광고/i, ['네이버 DA', '성과형 디스플레이', '홈피드', '스마트채널', '타임보드']);
  add('NAVER', '동영상 광고', /동영상\s*광고|비디오\s*광고|동영상\s*소재|동영상\s*조회|숏폼|쇼츠|아웃스트림|video/i, ['동영상 광고', '비디오 광고', '동영상 소재', '동영상 조회', '숏폼', '아웃스트림']);
  add('NAVER', '상품 DB/DB URL', /상품\s*db|상품db|db\s*url|dburl|ep|쇼핑파트너센터|상품정보\s*수신|상품\s*등록|상품등록/i, ['상품 DB', 'DB URL', 'EP', '쇼핑파트너센터', '상품정보 수신', '상품등록']);

  add('GOOGLE', '검색 캠페인', /검색\s*캠페인|검색\s*광고|search\s*campaign/i, ['검색 캠페인', '검색 광고']);
  add('GOOGLE', '디스플레이 캠페인', /디스플레이\s*캠페인|반응형\s*디스플레이|display\s*campaign|gdn/i, ['디스플레이 캠페인', '반응형 디스플레이', 'GDN']);
  add('GOOGLE', '쇼핑 광고', /쇼핑\s*광고|쇼핑\s*캠페인|shopping\s*(ads|campaigns?)/i, ['쇼핑 광고', '쇼핑 캠페인']);
  add('GOOGLE', '앱 캠페인', /앱\s*캠페인|앱\s*설치|앱\s*홍보|app\s*campaign|app\s*install/i, ['앱 캠페인', '앱 설치', 'app campaign']);
  add('GOOGLE', '리드 양식', /리드\s*양식|lead\s*form/i, ['리드 양식', 'lead form']);
  add('GOOGLE', '이미지 확장 소재', /이미지\s*확장|이미지\s*소재|확장\s*소재/i, ['이미지 확장', '이미지 소재', '확장 소재']);

  add('KAKAO', '비즈보드/톡보드', /비즈보드|톡보드|biz\s*board|talkboard/i, ['비즈보드', '톡보드']);
  add('KAKAO', '디스플레이 광고', /디스플레이\s*광고|카카오모먼트|display/i, ['디스플레이 광고', '카카오모먼트']);
  add('KAKAO', '상품가이드', /상품\s*가이드|상품가이드/i, ['상품가이드', '상품 가이드']);
  add('KAKAO', '제작 가이드', /제작\s*가이드|제작가이드|소재\s*가이드|소재|이미지\s*비율|텍스트\s*영역/i, ['제작 가이드', '소재 가이드', '이미지 비율', '텍스트 영역']);

  if (intent.isProductStructureOverview && !intent.isSpecificProductGuidance) {
    if (vendors.has('META')) {
      pushCoverage('META', '캠페인 목표', /캠페인\s*목표|광고\s*관리자\s*목표|마케팅\s*목표|인지도|트래픽|참여|잠재\s*고객|판매|objective/i, ['캠페인 목표', '광고 관리자 목표', '인지도', '트래픽', '참여', '잠재 고객', '판매']);
      pushCoverage('META', '광고 형식/노출 위치', /이미지|동영상|비디오|카루셀|슬라이드|릴스|스토리|피드|노출\s*(위치|지면)|게재\s*위치|placement/i, ['이미지 광고', '동영상 광고', '카루셀 광고', '릴스', '스토리', '피드', '노출 위치']);
      pushCoverage('META', '앱/리드 목적', /앱\s*(홍보|인스톨|설치|캠페인|이벤트)|app\s*(install|promotion|campaign)|리드\s*양식|잠재\s*고객|lead\s*form|lead\s*generation/i, ['앱 홍보', '앱 인스톨', '앱 캠페인', '리드 양식', '잠재 고객']);
      pushCoverage('META', '카탈로그/자동화/측정', /카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지|픽셀|pixel|conversions?\s*api/i, ['카탈로그', '컬렉션 광고', 'Advantage+', '어드밴티지', '픽셀', 'Conversions API']);
    }
    if (vendors.has('GOOGLE')) {
      pushCoverage('GOOGLE', '검색 캠페인', /검색\s*캠페인|검색\s*광고|search\s*campaign/i, ['검색 캠페인', '검색 광고']);
      pushCoverage('GOOGLE', '디스플레이 캠페인', /디스플레이\s*캠페인|반응형\s*디스플레이|display\s*campaign|gdn/i, ['디스플레이 캠페인', '반응형 디스플레이', 'GDN']);
      pushCoverage('GOOGLE', '쇼핑 광고', /쇼핑\s*광고|쇼핑\s*캠페인|shopping\s*(ads|campaigns?)/i, ['쇼핑 광고', '쇼핑 캠페인']);
      pushCoverage('GOOGLE', '앱 캠페인', /앱\s*캠페인|앱\s*설치|앱\s*홍보|app\s*campaign|app\s*install/i, ['앱 캠페인', '앱 설치', 'app campaign']);
      pushCoverage('GOOGLE', '리드 양식', /리드\s*양식|lead\s*form/i, ['리드 양식', 'lead form']);
    }
    if (vendors.has('NAVER')) {
      pushCoverage('NAVER', '사이트검색광고', /사이트검색광고|사이트검색|파워링크/i, ['사이트검색광고', '사이트검색', '파워링크']);
      pushCoverage('NAVER', '쇼핑검색광고', /쇼핑검색광고|쇼핑검색|쇼핑몰\s*상품형|상품형/i, ['쇼핑검색광고', '쇼핑검색', '쇼핑몰 상품형']);
      pushCoverage('NAVER', '네이버 DA', /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드|배너\s*광고/i, ['네이버 DA', '성과형 디스플레이', '홈피드', '스마트채널', '타임보드']);
      pushCoverage('NAVER', '쇼핑블록/쇼핑 지면', /쇼핑블록|쇼핑\s*블록|주요\s*쇼핑\s*지면|pc\s*쇼핑블록|mo\s*쇼핑블록/i, ['쇼핑블록', '쇼핑 지면', 'PC 쇼핑블록', 'MO 쇼핑블록']);
      pushCoverage('NAVER', '동영상 광고', /동영상\s*광고|비디오\s*광고|동영상\s*소재|동영상\s*조회|숏폼|쇼츠|아웃스트림|video/i, ['동영상 광고', '비디오 광고', '동영상 소재', '동영상 조회', '숏폼', '아웃스트림']);
    }
    if (vendors.has('KAKAO')) {
      pushCoverage('KAKAO', '비즈보드/톡보드', /비즈보드|톡보드|biz\s*board|talkboard/i, ['비즈보드', '톡보드']);
      pushCoverage('KAKAO', '디스플레이 광고', /디스플레이\s*광고|카카오모먼트|display/i, ['디스플레이 광고', '카카오모먼트']);
      pushCoverage('KAKAO', '상품가이드', /상품\s*가이드|상품가이드/i, ['상품가이드', '상품 가이드']);
      pushCoverage('KAKAO', '제작/심사 가이드', /제작\s*가이드|제작가이드|소재\s*가이드|소재|심사|검수/i, ['제작 가이드', '소재 가이드', '심사 가이드', '검수']);
    }
  }

  const seen = new Set<string>();
  return candidates.filter((term) => {
    if (seen.has(term.label)) return false;
    seen.add(term.label);
    return true;
  }).slice(0, 6);
}

function getProductStructureCoverageText(source: ReturnType<typeof buildVerifiedSources>[number]) {
  return normalizeEvidenceText([
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
  ].join(' '));
}

function sourceCoversRequestedProductStructureTerm(
  source: ReturnType<typeof buildVerifiedSources>[number],
  term: ProductStructureCoverageTerm,
) {
  const text = getProductStructureCoverageText(source);
  const compactText = text.replace(/\s+/g, '');
  return term.pattern.test(text)
    || term.pattern.test(compactText)
    || term.aliases.some(alias => textContainsEvidenceTerm(text, alias));
}

function ensureProductStructureRequestedTermCoverage(
  selected: ReturnType<typeof buildVerifiedSources>[number][],
  labelledSources: Array<ReturnType<typeof buildVerifiedSources>[number] & { label: string }>,
  requestedTerms: ProductStructureCoverageTerm[],
  targetVendor: VendorIntent | undefined,
  limit: number,
) {
  if (requestedTerms.length === 0) return selected;

  const next = [...selected];
  const selectedKeys = new Set(next.map(source => getProductStructureSourceKey(source)));
  const selectedPublicKeys = new Set(next.map(getProductStructurePublicSourceKey).filter(Boolean));

  for (const term of requestedTerms) {
    if (next.some(source => sourceCoversRequestedProductStructureTerm(source, term))) continue;

    const best = labelledSources
      .map((source, index) => ({ source, index }))
      .filter(({ source }) => !selectedKeys.has(getProductStructureSourceKey(source)))
      .filter(({ source }) => {
        const publicKey = getProductStructurePublicSourceKey(source);
        return !publicKey || !selectedPublicKeys.has(publicKey);
      })
      .filter(({ source }) => isUsableBroadProductStructureSource(source, targetVendor))
      .filter(({ source }) => sourceCoversRequestedProductStructureTerm(source, term))
      .sort((a, b) => (
        scoreBroadProductStructureSource(b.source, targetVendor, term.aliases, b.index)
        - scoreBroadProductStructureSource(a.source, targetVendor, term.aliases, a.index)
      ))[0]?.source;

    if (!best) continue;

    const bestKey = getProductStructureSourceKey(best);
    const bestPublicKey = getProductStructurePublicSourceKey(best);
    if (next.length < limit) {
      next.push(best);
      selectedKeys.add(bestKey);
      if (bestPublicKey) selectedPublicKeys.add(bestPublicKey);
      continue;
    }

    const replacement = next
      .map((source, index) => ({ source, index }))
      .filter(({ source }) => !isGraphVerifiedSource(source))
      .filter(({ source }) => !requestedTerms.some(requestedTerm => sourceCoversRequestedProductStructureTerm(source, requestedTerm)))
      .sort((a, b) => (
        scoreBroadProductStructureSource(a.source, targetVendor, [], a.index)
        - scoreBroadProductStructureSource(b.source, targetVendor, [], b.index)
      ))[0];

    if (!replacement) continue;

    selectedKeys.delete(getProductStructureSourceKey(replacement.source));
    const replacementPublicKey = getProductStructurePublicSourceKey(replacement.source);
    if (replacementPublicKey) selectedPublicKeys.delete(replacementPublicKey);
    next[replacement.index] = best;
    selectedKeys.add(bestKey);
    if (bestPublicKey) selectedPublicKeys.add(bestPublicKey);
  }

  return next;
}

function ensureProductStructureRequestedFocusCoverage(
  selected: ReturnType<typeof buildVerifiedSources>[number][],
  labelledSources: Array<ReturnType<typeof buildVerifiedSources>[number] & { label: string }>,
  focus: RequestedProductFocus | null,
  targetVendor: VendorIntent | undefined,
  limit: number,
) {
  if (!focus?.isSpecificFamilyQuestion) return selected;
  if (selected.some(source => sourceMatchesRequestedProductFocus(source, focus))) return selected;

  const selectedKeys = new Set(selected.map(source => getProductStructureSourceKey(source)));
  const selectedPublicKeys = new Set(selected.map(getProductStructurePublicSourceKey).filter(Boolean));
  const bestFocusSource = labelledSources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => !selectedKeys.has(getProductStructureSourceKey(source)))
    .filter(({ source }) => {
      const publicKey = getProductStructurePublicSourceKey(source);
      return !publicKey || !selectedPublicKeys.has(publicKey);
    })
    .filter(({ source }) => isUsableBroadProductStructureSource(source, targetVendor))
    .filter(({ source }) => sourceMatchesRequestedProductFocus(source, focus))
    .sort((a, b) => (
      scoreBroadProductStructureSource(b.source, targetVendor, focus.queryTerms, b.index)
      + scoreRequestedProductFocus(b.source, focus)
      - scoreBroadProductStructureSource(a.source, targetVendor, focus.queryTerms, a.index)
      - scoreRequestedProductFocus(a.source, focus)
    ))[0]?.source;

  if (!bestFocusSource) return [];

  if (selected.length < limit) {
    return [...selected, bestFocusSource];
  }

  const replacement = selected
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => !isGraphVerifiedSource(source))
    .sort((a, b) => (
      scoreRequestedProductFocus(a.source, focus)
      - scoreRequestedProductFocus(b.source, focus)
      || scoreBroadProductStructureSource(a.source, targetVendor, [], a.index)
      - scoreBroadProductStructureSource(b.source, targetVendor, [], b.index)
    ))[0];

  if (!replacement) return [bestFocusSource, ...selected.slice(0, Math.max(0, limit - 1))];

  const next = [...selected];
  next[replacement.index] = bestFocusSource;
  return next;
}

function hasBroadProductStructureAnswerSignal(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const text = normalizeEvidenceText([
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
  ].join(' '));
  const hasObjectiveMatrix = /인지도[\s\S]{0,140}트래픽[\s\S]{0,140}참여[\s\S]{0,140}잠재\s*고객[\s\S]{0,140}앱\s*홍보[\s\S]{0,140}판매/.test(text);
  const hasProductTaxonomy = /캠페인\s*(목표|유형|목적)|광고\s*(상품|종류|유형|구조)|상품\s*구조|광고\s*관리자\s*목표|마케팅\s*목표|목적별|목표별|campaign\s*objective|objectives?/.test(text);
  const hasMetaProductSignal = /advantage\+|어드밴티지|카탈로그|catalog|컬렉션\s*광고|collection\s*ads?|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|app\s*(install|promotion)|리드\s*양식|비즈니스\s*폼/.test(text);
  const hasGoogleProductSignal = /검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*캠페인|performance\s*max|pmax|demand\s*gen|리드\s*양식/.test(text);
  const hasNaverProductSignal = /사이트검색광고|쇼핑검색광고|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|주요\s*쇼핑\s*지면|디지털\s*옥외광고|네이버\s*da|성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드|상품\s*db|db\s*url|ep\s*\(=\s*db\s*url\)|쇼핑파트너센터|상품정보\s*수신\s*현황|상품관리/.test(text);
  const hasKakaoProductSignal = /비즈보드|카카오모먼트|카카오\s*디스플레이|브랜드\s*이모티콘|상품\s*가이드|상품가이드/.test(text);
  return hasObjectiveMatrix
    || hasProductTaxonomy
    || hasMetaProductSignal
    || hasGoogleProductSignal
    || hasNaverProductSignal
    || hasKakaoProductSignal;
}

function isUsableBroadProductStructureSource(
  source: ReturnType<typeof buildVerifiedSources>[number],
  targetVendor?: VendorIntent,
) {
  if (!sourceMatchesVendor(source, targetVendor)) return false;
  if (targetVendor && hasExplicitOtherVendorSignal(source, targetVendor)) return false;
  if (sourceIdentityLooksLikeGenericLegalOrAccountDoc(source)) return false;
  if (isWeakProductStructureDisplaySource(source)) return false;
  if (sourceLooksLikeGranularCreativeSpecOnly(source)) return false;
  if (isLowValueProductStructureGraphSource(source)) return false;
  if (hasBroadProductStructureAnswerSignal(source)) return true;
  return isOfficialGuideGraphSource(source) && hasProductStructureGraphSourceSignal(source);
}

function scoreBroadProductStructureSource(
  source: ReturnType<typeof buildVerifiedSources>[number],
  targetVendor: VendorIntent | undefined,
  queryTerms: string[],
  index: number,
) {
  if (!isUsableBroadProductStructureSource(source, targetVendor)) return Number.NEGATIVE_INFINITY;

  const text = normalizeEvidenceText([
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
  ].join(' '));
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
  if (sourceLooksLikeGranularCreativeSpecOnly(source)) score -= 4.2;

  return score;
}

function selectProductStructureResponseSources(sources: ReturnType<typeof buildVerifiedSources>, intent?: QueryIntent, message = '') {
  const targetVendor = intent?.vendors.length === 1 ? intent.vendors[0] : undefined;
  const requestedFocus = intent ? buildRequestedProductFocus(message, intent) : null;
  const queryTerms = buildBroadProductStructureQueryTerms(intent, message);
  const requestedCoverageTerms = buildRequestedProductStructureCoverageTerms(intent, message);
  const sourceLimit = Math.min(7, Math.max(5, requestedCoverageTerms.length + 2));
  const labelledSources = sources.map((source, index) => ({
    ...source,
    label: `S${index + 1}`,
  }))
    .filter(source => sourceMatchesVendor(source, targetVendor))
    .filter(source => !targetVendor || !sourceHasCrossVendorUrl(source, [targetVendor]))
    .filter(source => !sourceHasExtractionNoise(source));
  const usableLabelledSources = labelledSources
    .filter(source => isUsableBroadProductStructureSource(source, targetVendor));
  const selected = usableLabelledSources
    .map((source, index) => ({
      source,
      score: scoreBroadProductStructureSource(source, targetVendor, queryTerms, index)
        + scoreRequestedProductFocus(source, requestedFocus),
      index,
    }))
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.source)
    .reduce((selected, source) => {
      if (selected.length >= sourceLimit) return selected;
      const sourceGroup = getBroadProductStructureEvidenceGroup(source, targetVendor);
      const groupCount = selected.filter(item => (
        getBroadProductStructureEvidenceGroup(item, targetVendor) === sourceGroup
      )).length;
      const perGroupLimit = sourceGroup === 'official_graph' ? 3 : 2;
      if (groupCount >= perGroupLimit) return selected;
      const publicKey = getProductStructurePublicSourceKey(source);
      if (publicKey && selected.some(item => getProductStructurePublicSourceKey(item) === publicKey)) {
        return selected;
      }
      const titleKey = normalizeEvidenceText(source.title || source.originalTitle || '');
      if (
        titleKey
        && selected.some(item => normalizeEvidenceText(item.title || item.originalTitle || '') === titleKey)
      ) {
        return selected;
      }
      selected.push(source);
      return selected;
    }, [] as ReturnType<typeof buildVerifiedSources>)
    .slice(0, sourceLimit);

  if (selected.length === 0) {
    const recoverableBroadSources = labelledSources
      .map((source, index) => {
        const text = normalizeEvidenceText([
          getProductStructureVisibleSourceText(source),
          getSourceText(source),
        ].join(' '));
        const queryHits = queryTerms.filter(term => textContainsEvidenceTerm(text, term)).length;
        const coverageHits = requestedCoverageTerms.filter(term => sourceCoversRequestedProductStructureTerm(source, term)).length;
        const focusHit = sourceMatchesRequestedProductFocus(source, requestedFocus);
        const hasAnswerSignal = hasBroadProductStructureAnswerSignal(source);
        const isRecoverable = (
          hasAnswerSignal
          || queryHits > 0
          || coverageHits > 0
          || (requestedFocus?.isSpecificFamilyQuestion && focusHit)
          || (isOfficialGuideGraphSource(source) && hasProductStructureGraphSourceSignal(source))
        );
        if (!isRecoverable) return null;
        if (isWeakProductStructureDisplaySource(source) && coverageHits === 0 && !hasAnswerSignal) return null;
        if (isLowValueProductStructureGraphSource(source) && coverageHits === 0 && !queryHits) return null;
        if (requestedFocus?.isSpecificFamilyQuestion && !focusHit) return null;

        const score = Number(source.hybridScore || source.score || source.similarity || 0)
          + (hasAnswerSignal ? 1.2 : 0)
          + queryHits * 0.35
          + coverageHits * 0.6
          + scoreRequestedProductFocus(source, requestedFocus)
          + (isOfficialGuideGraphSource(source) ? 0.45 : 0)
          + Math.max(0, 0.25 - index * 0.01);
        return { source, score, index };
      })
      .filter((item): item is { source: ReturnType<typeof buildVerifiedSources>[number] & { label: string }; score: number; index: number } => item !== null)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(item => item.source)
      .slice(0, sourceLimit);

    if (recoverableBroadSources.length > 0) {
      return recoverableBroadSources;
    }

    return [];
  }

  const selectedWithRequestedFocusCoverage = ensureProductStructureRequestedFocusCoverage(
    selected,
    usableLabelledSources,
    requestedFocus,
    targetVendor,
    sourceLimit
  );
  const selectedWithRequestedCoverage = ensureProductStructureRequestedTermCoverage(
    selectedWithRequestedFocusCoverage,
    usableLabelledSources,
    requestedCoverageTerms,
    targetVendor,
    sourceLimit
  );
  const selectedKeys = new Set<string>();
  selectedWithRequestedCoverage.forEach(source => selectedKeys.add(getProductStructureSourceKey(source)));

  return capProductStructureGraphSources(
    ensureProductStructureGraphSourceCoverage(selectedWithRequestedCoverage, usableLabelledSources, selectedKeys, targetVendor),
    usableLabelledSources,
    targetVendor,
    sourceLimit
  );
}

function getBroadProductStructureEvidenceGroup(
  source: ReturnType<typeof buildVerifiedSources>[number],
  targetVendor?: VendorIntent,
) {
  if (isOfficialGuideGraphSource(source)) return 'official_graph';

  const text = normalizeEvidenceText([
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
  ].join(' '));

  if (/캠페인\s*(목표|유형|목적)|광고\s*관리자\s*목표|마케팅\s*목표|인지도|트래픽|참여|잠재\s*고객|앱\s*홍보|판매|objective|objectives?/.test(text)) {
    return 'campaign_objective';
  }

  if (/카탈로그|catalog|advantage\+|어드밴티지|컬렉션\s*광고|상품\s*db|상품db|db\s*url|dburl|\bep\b|쇼핑파트너센터|상품정보\s*수신|상품\s*등록|상품등록|상품관리|가격비교|커머스|commerce/.test(text)) {
    return 'commerce_catalog';
  }

  if (/앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록)|app\s*(install|promotion|campaign)|sdk|mmp|추적|트래킹|리드\s*양식|잠재\s*고객|비즈니스\s*폼|lead/.test(text)) {
    return 'app_lead';
  }

  if (/이미지|동영상|비디오|슬라이드|카루셀|컬렉션|소재|형식|포맷|사양|규격|비율|사이즈|크기|파일|노출\s*(위치|지면)|게재\s*위치|지면|placement/.test(text)) {
    return 'format_placement';
  }

  if (/검색광고|사이트검색광고|쇼핑검색광고|쇼핑검색|쇼핑블록|파워링크|브랜드검색|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고/.test(text)) {
    return 'search_display_shopping';
  }

  if (/정책|심사|검수|검토|제한|금지|승인|등록\s*기준|광고\s*등록\s*기준|반려|업종\s*제한|가능\s*여부/.test(text)) {
    return 'policy_screening';
  }

  return targetVendor ? `general_${targetVendor.toLowerCase()}` : 'general';
}

function buildBroadProductStructureScopeLimitedAnswer(message: string, intent: QueryIntent) {
  const vendorLabel = intent.vendors.map(vendor => VENDOR_LABELS[vendor] || vendor).join(', ') || '해당 매체';
  const requestedScope = isProductSelectionQuestion(message) ? '광고 상품 선택 기준' : '광고 상품/유형 구조';
  return [
    `${vendorLabel} ${requestedScope}에 대해 질문하셨지만, 현재 선별된 공식 근거 안에서는 이 범위를 직접 설명할 수 있는 출처가 부족합니다.`,
    '',
    '노출 위치나 개별 소재 사양만 있는 출처로 전체 광고 상품 구조를 정리하면 잘못된 운영 판단으로 이어질 수 있어 답변을 제한합니다.',
    '',
    '상품명, 캠페인 목적, 지면명, 등록 절차처럼 확인하려는 범위를 더 구체적으로 넣어 다시 질문해 주세요. 필요한 경우 담당자 확인 요청으로 공식 가이드 보강을 남길 수 있습니다.',
  ].join('\n');
}

function capProductStructureGraphSources(
  selected: ReturnType<typeof buildVerifiedSources>[number][],
  labelledSources: Array<ReturnType<typeof buildVerifiedSources>[number] & { label: string }>,
  targetVendor?: VendorIntent,
  limit = 5
) {
  const head = selected.slice(0, limit);
  const maxGraphSources = Math.min(3, Math.max(1, limit - 2));
  const bestGraphSources = [...head, ...labelledSources]
    .filter(source => isOfficialGuideGraphSource(source))
    .filter(source => isUsableBroadProductStructureSource(source, targetVendor))
    .sort((a, b) => scoreProductStructureGraphSource(b, targetVendor) - scoreProductStructureGraphSource(a, targetVendor))
    .reduce((items, source) => {
      if (items.length >= maxGraphSources) return items;
      const key = getProductStructureSourceKey(source);
      const publicKey = getProductStructurePublicSourceKey(source);
      if (items.some(item => getProductStructureSourceKey(item) === key)) return items;
      if (publicKey && items.some(item => getProductStructurePublicSourceKey(item) === publicKey)) return items;
      items.push(source);
      return items;
    }, [] as ReturnType<typeof buildVerifiedSources>);

  const bestGraphKeys = new Set(bestGraphSources.map(getProductStructureSourceKey));
  const next: ReturnType<typeof buildVerifiedSources>[number][] = [];
  const selectedKeys = new Set<string>();
  const selectedPublicKeys = new Set<string>();
  const selectedTitleKeys = new Set<string>();

  for (const source of head) {
    if (!isUsableBroadProductStructureSource(source, targetVendor)) continue;
    if (isGraphVerifiedSource(source)) {
      if (!bestGraphKeys.has(getProductStructureSourceKey(source))) {
        continue;
      }
    }

    const key = getProductStructureSourceKey(source);
    if (selectedKeys.has(key)) continue;
    const publicKey = getProductStructurePublicSourceKey(source);
    if (publicKey && selectedPublicKeys.has(publicKey)) continue;
    const titleKey = normalizeEvidenceText(source.title || source.originalTitle || '');
    if (titleKey && selectedTitleKeys.has(titleKey)) continue;
    selectedKeys.add(key);
    if (publicKey) selectedPublicKeys.add(publicKey);
    if (titleKey) selectedTitleKeys.add(titleKey);
    next.push(source);
  }

  for (const bestGraphSource of bestGraphSources) {
    const bestGraphKey = getProductStructureSourceKey(bestGraphSource);
    if (selectedKeys.has(bestGraphKey)) continue;
    const bestGraphPublicKey = getProductStructurePublicSourceKey(bestGraphSource);
    if (bestGraphPublicKey && selectedPublicKeys.has(bestGraphPublicKey)) continue;
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
        const replacedSource = next[graphInsertIndex];
        selectedKeys.delete(getProductStructureSourceKey(replacedSource));
        const replacedPublicKey = getProductStructurePublicSourceKey(replacedSource);
        if (replacedPublicKey) selectedPublicKeys.delete(replacedPublicKey);
        selectedTitleKeys.delete(normalizeEvidenceText(replacedSource.title || replacedSource.originalTitle || ''));
        next[graphInsertIndex] = bestGraphSource;
      }
      selectedKeys.add(bestGraphKey);
      if (bestGraphPublicKey) selectedPublicKeys.add(bestGraphPublicKey);
      const titleKey = normalizeEvidenceText(bestGraphSource.title || bestGraphSource.originalTitle || '');
      if (titleKey) selectedTitleKeys.add(titleKey);
    }
  }

  for (const source of labelledSources) {
    if (next.length >= limit) break;
    if (isGraphVerifiedSource(source)) continue;
    if (!isUsableBroadProductStructureSource(source, targetVendor)) continue;
    const key = getProductStructureSourceKey(source);
    if (selectedKeys.has(key)) continue;
    const publicKey = getProductStructurePublicSourceKey(source);
    if (publicKey && selectedPublicKeys.has(publicKey)) continue;
    const titleKey = normalizeEvidenceText(source.title || source.originalTitle || '');
    if (titleKey && selectedTitleKeys.has(titleKey)) continue;
    selectedKeys.add(key);
    if (publicKey) selectedPublicKeys.add(publicKey);
    if (titleKey) selectedTitleKeys.add(titleKey);
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
    && isUsableBroadProductStructureSource(source, targetVendor)
  ));

  const graphSourcePool = [...selected, ...labelledSources]
    .filter(source => isOfficialGuideGraphSource(source))
    .filter(source => isUsableBroadProductStructureSource(source, targetVendor));
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

function getProductStructureFastPathSupplementLimit(vendor?: VendorIntent) {
  switch (vendor) {
    case 'NAVER':
      return 1;
    case 'GOOGLE':
      return 0;
    case 'META':
    case 'KAKAO':
      return 1;
    default:
      return 1;
  }
}

function getSpecificProductSupplementLimit(vendor?: VendorIntent) {
  return vendor === 'KAKAO' ? 1 : 2;
}

function buildProductStructureSupplementQueries(intent: QueryIntent, originalMessage: string) {
  if (!intent.topics.includes('product_structure') || intent.vendors.length !== 1) return [];

  const vendor = intent.vendors[0];
  const normalized = normalizeProductIntentText(originalMessage);
  const targetedQueries: string[] = [];

  if (intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(originalMessage)) {
    const asksNaverDa = vendor === 'NAVER' && /(^|[\s/])da($|[\s/]|도|상품|광고)|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(normalized);
    const asksKakaoDisplay = vendor === 'KAKAO' && /비즈보드|디스플레이\s*광고|카카오모먼트|톡채널|브랜드이모티콘|상품\s*가이드|상품가이드/.test(normalized);
    const asksNaverShoppingBlock = vendor === 'NAVER' && /쇼핑\s*블록|쇼핑블록|주요\s*쇼핑\s*지면|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑/.test(normalized);
    const asksNaverProductOverview = vendor === 'NAVER'
      && isProductCatalogOverviewQuestion(originalMessage)
      && /광고\s*(상품|종류|유형)|상품\s*(종류|유형)/.test(normalized);
    const asksNaverShoppingCreativeGuide = vendor === 'NAVER'
      && /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑\s*광고/.test(normalized)
      && /제작|가이드|소재|이미지|문구|카피|랜딩|심사|검수|사양|스펙|규격|비율|대표이미지|상품명/.test(normalized);
    const asksExplicitNaverShoppingData = vendor === 'NAVER'
      && (
        isNaverShoppingDataIntent(intent)
        || /db\s*url|상품\s*db|상품등록|상품\s*등록|ep|쇼핑파트너센터|상품정보\s*수신\s*현황|등록요청|상품관리|카테고리\s*자동매칭|가격비교\s*(입점|연동|등록)/.test(normalized)
      );

    if (asksNaverDa) {
      targetedQueries.push(
        `${VENDOR_LABELS[vendor] || vendor} DA 홈피드DA 스마트채널 타임보드 보장형 DA`,
        `${VENDOR_LABELS[vendor] || vendor} 성과형 디스플레이 홈피드DA 배너 광고`
      );
    }
    if (asksKakaoDisplay) {
      targetedQueries.push(
        '카카오 비즈보드 디스플레이 광고 지면 광고 상품',
        '카카오 디스플레이 광고 카카오모먼트 상품가이드 지면 소재 조건',
        '카카오 상품가이드 제작가이드 심사가이드 소재 제작 조건'
      );
    }
    if (asksNaverShoppingBlock) {
      targetedQueries.push(
        '네이버 쇼핑블록 주요 쇼핑 지면 PC 쇼핑블록 MO 쇼핑블록 광고 상품',
        '네이버 쇼핑블록 쇼핑 지면 상품 가이드 소재 조건'
      );
    }
    if (asksNaverProductOverview) {
      targetedQueries.push(
        '네이버 광고 상품 사이트검색광고 쇼핑검색광고 쇼핑블록 파워링크 브랜드검색',
        '네이버 검색 광고 쇼핑 지면 광고 상품 종류'
      );
    }
    if (vendor === 'NAVER' && /동영상\s*광고|비디오\s*광고/.test(normalized)) {
      targetedQueries.push(
        `${VENDOR_LABELS[vendor] || vendor} 동영상 광고 소재 사양`,
        `${VENDOR_LABELS[vendor] || vendor} 동영상 소재 비디오 광고 지면`
      );
    }
    const supportsAppInstallSupplement = vendor === 'META' || vendor === 'GOOGLE';
    if (supportsAppInstallSupplement && /앱\s*인스톨|앱\s*설치|앱\s*홍보|app\s*install|app\s*promotion/.test(normalized)) {
      targetedQueries.push(
        `${VENDOR_LABELS[vendor] || vendor} 앱 인스톨 App Install 앱 홍보 앱 이벤트`
      );
      if (/sdk|mmp|연동|추적|트래킹/.test(normalized)) {
        targetedQueries.push(`${VENDOR_LABELS[vendor] || vendor} App Install SDK MMP 앱 이벤트 추적`);
      }
    }
    if (asksNaverShoppingCreativeGuide && !asksExplicitNaverShoppingData) {
      targetedQueries.push(
        '네이버 쇼핑검색광고 제작 가이드 소재 이미지 랜딩 심사',
        '네이버 쇼핑검색광고 상품명 대표이미지 가격 배송비 카테고리 랜딩'
      );
    }
    if (asksExplicitNaverShoppingData) {
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
    || isNavigationOrMenuExcerpt(normalized)
  );
}

function isNavigationOrMenuExcerpt(text: string, options: { requireLowEvidenceSignal?: boolean } = {}) {
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  const navTerms = [
    '로그인', '회원가입', '메뉴', '검색어 입력', '검색어 입력 창', '고객센터',
    '전체보기', '전체 보기', '목록보기', '이전', '다음', '바로가기',
    '공지사항', '문의하기', '전화상담', '원격지원', '카테고리', '도움말',
  ];
  const navHitCount = navTerms.filter(term => normalized.includes(term)).length;
  if (navHitCount < 5) return false;
  if (!options.requireLowEvidenceSignal) return true;

  const evidenceSignals = [
    '광고 상품', '캠페인', '노출', '과금', '심사', '등록 기준', '상품 db',
    'db url', '비즈보드', '쇼핑검색광고', '사이트검색광고', '디스플레이 광고',
    '앱 캠페인', '리드 양식', '카탈로그', 'advantage+', 'objective',
  ];
  const evidenceHitCount = evidenceSignals.filter(term => normalized.includes(term)).length;
  return evidenceHitCount <= 1;
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
    .replace(/이전\s*화면\s*공유하기\s*저장하기/gi, ' ')
    .replace(/화면\s*공유하기|공유하기|저장하기|목록보기|닫기|접기|펼치기/gi, ' ')
    .replace(/상품소식\s*\d*\s*분?/g, ' ')
    .replace(/이전\s*다음|전체\s*보기|자세히\s*보기|바로가기/g, ' ')
    .replace(/([가-힣A-Za-z0-9])#/g, '$1 #')
    .replace(/#\s+/g, '#')
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
    const sourceVendor = result.sourceVendor || result.metadata?.sourceVendor || result.metadata?.source_vendor || result.sourceQuality?.sourceVendor || 'UNKNOWN';
    const fallbackTitleVendor = sourceVendor && sourceVendor !== 'UNKNOWN'
      ? VENDOR_LABELS[sourceVendor as VendorIntent] || String(sourceVendor)
      : '광고';
    const originalTitle = result.documentTitle || result.metadata?.originalTitle || result.metadata?.title || `${fallbackTitleVendor} 가이드 문서`;
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
  const isSpecificProductQuestion = (
    intent.topics.includes('product_structure')
    && (intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(message))
    && !isBroadProductStructureLlmIntent
  );

  if (isBroadProductStructureLlmIntent) {
    return {
      answerMode: isProductSelectionQuestion(message) ? 'product_selection' : 'product_overview',
      questionIntent: isProductSelectionQuestion(message)
        ? `${vendorLabel} 광고 상품을 목적별 선택 기준으로 설명`
        : `${vendorLabel} 광고 상품/유형을 근거 기반으로 개요 설명`,
      targetVendor,
    };
  }

  if (isSpecificProductQuestion) {
    return {
      answerMode: toCompassLlmAnswerMode(specificProductScope.mode),
      questionIntent: `${vendorLabel} 특정 광고 상품의 ${getSpecificProductModeLabel(specificProductScope.mode)}에 직접 답변`,
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

function getCompassDiagnosticAnswerMode(
  message: string,
  specificProductScope: ReturnType<typeof buildSpecificProductAnswerScope>,
  isBroadProductStructureLlmIntent: boolean,
) {
  if (isBroadProductStructureLlmIntent) {
    return isProductSelectionQuestion(message) ? 'product_selection' : 'product_overview';
  }

  return specificProductScope.mode;
}

function buildCompassAnswerModel(
  message: string,
  intent: QueryIntent,
  isBroadProductStructureLlmIntent: boolean,
): string {
  if (isBroadProductStructureLlmIntent) {
    return 'compass-answer-grounded-product-structure-llm';
  }

  if (
    intent.topics.includes('product_structure')
    && (intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(message))
    && !isBroadProductStructureLlmIntent
  ) {
    return 'compass-answer-grounded-specific-product-llm';
  }

  const neutralAnswer = { model: 'compass-answer' };
  return neutralAnswer.model;
}

function buildGroundingSourceContent(
  source: ReturnType<typeof buildVerifiedSources>[number],
  options: CompassGroundingOptions,
) {
  const excerpt = String(source.excerpt || '').trim();
  const matchText = String(source.matchText || '').trim();
  const answerMode = String(options.answerMode || 'auto');
  const evidenceRole = String(
    source.metadata?.answerEvidenceRole
    || source.metadata?.answer_evidence_role
    || '',
  );
  const coverageRole = String(source.metadata?.coverageRole || source.metadata?.coverage_role || '');
  const wantsProductStructureContent = (
    (answerMode === 'product_overview' || answerMode === 'product_selection')
    && matchText.length > excerpt.length + 120
    && (
      evidenceRole === 'official_graph'
      || evidenceRole === 'product_context'
      || coverageRole.includes('product_structure')
      || hasProductStructureGraphSourceSignal(source)
      || hasBroadProductStructureAnswerSignal(source)
    )
  );
  if (wantsProductStructureContent && matchText.length > excerpt.length + 120) {
    const merged = excerpt && !matchText.includes(excerpt)
      ? `${excerpt}\n\n${matchText}`
      : matchText;
    return merged.length > 5200 ? `${merged.slice(0, 5200)}...` : merged;
  }

  const fallbackContent = excerpt || (wantsProductStructureContent ? matchText : '');
  return fallbackContent.length > 5200 ? `${fallbackContent.slice(0, 5200)}...` : fallbackContent;
}

function buildAnswerGroundingSources(
  sources: ReturnType<typeof buildVerifiedSources>,
  options: CompassGroundingOptions = {},
): CompassGroundingSource[] {
  return sources.map(source => {
    const groundingDecision = source.evidenceDecision || 'weak';

    return {
      chunk_id: source.chunkId || source.id,
      id: source.id,
      content: buildGroundingSourceContent(source, options),
      similarity: source.similarity,
      score: source.score,
      hybridScore: source.hybridScore,
      corpus: source.corpus,
      evidenceType: source.evidenceType,
      evidenceDecision: groundingDecision,
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
      evidenceDecision: groundingDecision,
      evidenceDecisionReason: source.evidenceDecisionReason,
      retrievalMethod: source.retrievalMethod,
      source_kind: source.metadata?.source_kind || source.metadata?.sourceKind || 'official_doc',
      graphPath: source.metadata?.graphPath || source.metadata?.graph_path,
      answerMode: options.answerMode,
      questionIntent: options.questionIntent,
      targetVendor: options.targetVendor,
    },
    };
  });
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
    if (/pc\s*헤드라인\s*da|헤드라인da/.test(blob)) {
      return '네이버 광고 가이드: PC 헤드라인DA';
    }
    if (/쇼핑블록|쇼핑\s*지면/.test(blob)) {
      return '네이버 광고 가이드: 쇼핑블록/쇼핑 지면';
    }
    if (/성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드/.test(blob)) {
      return '네이버 광고 가이드: 성과형 디스플레이 광고';
    }
    if (/타겟팅\s*전략|타겟팅/.test(blob)) {
      return '네이버 광고 가이드: 타겟팅 전략';
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
    const titleLooksLikeUrl = /^https?:\/\//i.test(String(title || '').trim());
    if (/collection\s*ads?|컬렉션\s*광고/.test(blob)) {
      return 'Meta 비즈니스 지원 센터: 컬렉션 광고';
    }
    if (/slideshow|슬라이드쇼|슬라이드\s*광고/.test(blob)) {
      return 'Meta 비즈니스 지원 센터: 슬라이드쇼 광고';
    }
    if (/collaborative\s*ads?|협력\s*광고/.test(blob)) {
      return 'Meta 비즈니스 지원 센터: 협력 광고';
    }
    if (titleLooksLikeUrl) {
      return 'Meta 비즈니스 지원 센터: 광고 상품 가이드';
    }
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

function getResultIdentityKey(result: SearchResult): string {
  return [
    result.documentId || result.metadata?.documentId || result.metadata?.document_id || '',
    result.chunk_id || result.metadata?.chunk_id || '',
    result.documentTitle || result.metadata?.originalTitle || result.metadata?.title || '',
    String(result.content || '').slice(0, 120),
  ].join(':');
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
  const metadata = result.metadata || {};
  const sourceQuality = (result.sourceQuality || {}) as any;
  const warningValues = [
    ...(Array.isArray(sourceQuality.warnings) ? sourceQuality.warnings : []),
    ...(Array.isArray(metadata.sourceQualityWarnings) ? metadata.sourceQualityWarnings : []),
    ...(Array.isArray(metadata.evidenceDecisionReason) ? metadata.evidenceDecisionReason : []),
    ...(Array.isArray(result.evidenceDecisionReason) ? result.evidenceDecisionReason : []),
  ].map(String);
  const hasBlockingWarning = evidenceDecision === 'rejected'
    || warningValues.some((warning) => (
      warning === 'placeholder_content'
      || warning === 'fallback_evidence'
      || warning === 'missing_excerpt'
    ));
  const isOfficialGuideGraphEvidence = isGraphSearchResult(result)
    && (result.metadata?.sourceKind === 'official_doc' || result.metadata?.source_kind === 'official_doc');

  if (!hasGrounding || isFallback || hasBlockingWarning) {
    return false;
  }

  if (isOfficialGuideGraphEvidence) {
    return true;
  }

  if (evidenceDecision === 'verified') {
    return true;
  }

  const resultLike = result as any;
  const hasUsableSourceShape = Boolean(
    result.documentTitle
    || metadata.title
    || metadata.originalTitle
    || metadata.source_title
  ) && Boolean(
    result.documentId
    || result.documentUrl
    || metadata.documentId
    || metadata.document_id
    || metadata.source_url
    || metadata.document_url
    || metadata.url
  );
  const hasVendorIdentity = getDiagnosticResultVendors(result).length > 0;
  const rescueReasons = [
    ...(Array.isArray(result.rankReason) ? result.rankReason : []),
    ...(Array.isArray(metadata.rankReason) ? metadata.rankReason : []),
    ...(Array.isArray(result.evidenceDecisionReason) ? result.evidenceDecisionReason : []),
    ...(Array.isArray(metadata.evidenceDecisionReason) ? metadata.evidenceDecisionReason : []),
  ].map(String);
  const hasRagRescueSignal = rescueReasons.some((reason) => (
    /rescue|coverage|official_guide|target_vendor|graph|product_structure|generic_topic/i.test(reason)
  ));
  const keywordScore = Number(result.keywordScore ?? resultLike.metadata?.keywordScore ?? 0);
  const lexicalOverlap = Number(result.lexicalOverlap ?? resultLike.metadata?.lexicalOverlap ?? 0);
  const qualityScore = Number(result.sourceQuality?.qualityScore ?? 0);
  const hasScoreSignal = keywordScore >= 0.42 || lexicalOverlap >= 0.16 || qualityScore >= 0.5;

  return hasUsableSourceShape && hasVendorIdentity && (hasRagRescueSignal || hasScoreSignal);
}

function searchResultHasBlockingGroundingWarning(result: SearchResult): boolean {
  const metadata = result.metadata || {};
  const sourceQuality = (result.sourceQuality || {}) as any;
  const evidenceDecision = getEvidenceDecision(result);
  const warningValues = [
    ...(Array.isArray(sourceQuality.warnings) ? sourceQuality.warnings : []),
    ...(Array.isArray(metadata.sourceQualityWarnings) ? metadata.sourceQualityWarnings : []),
    ...(Array.isArray(metadata.evidenceDecisionReason) ? metadata.evidenceDecisionReason : []),
    ...(Array.isArray(result.evidenceDecisionReason) ? result.evidenceDecisionReason : []),
  ].map(String);

  return evidenceDecision === 'rejected'
    || warningValues.some((warning) => (
      warning === 'placeholder_content'
      || warning === 'fallback_evidence'
      || warning === 'missing_excerpt'
    ));
}

function searchResultMatchesTargetVendor(result: SearchResult, intent: QueryIntent): boolean {
  if (intent.vendors.length !== 1) return true;
  const targetVendor = intent.vendors[0];
  const resultVendors = getDiagnosticResultVendors(result);
  if (resultVendors.includes(targetVendor)) return true;
  if (result.vendorMismatch || result.metadata?.vendorMismatch || result.sourceQuality?.vendorMismatch) return false;

  const text = buildDiagnosticSourceText(result);
  if (!DIAGNOSTIC_VENDOR_PATTERNS[targetVendor].test(text)) return false;
  return !(Object.keys(DIAGNOSTIC_VENDOR_PATTERNS) as VendorIntent[])
    .filter(vendor => vendor !== targetVendor)
    .some(vendor => DIAGNOSTIC_VENDOR_PATTERNS[vendor].test(text));
}

function buildSearchResultActualEvidenceText(result: SearchResult): string {
  const metadata = result.metadata || {};
  return normalizeEvidenceText([
    result.content,
    result.documentTitle,
    metadata.title,
    metadata.originalTitle,
    metadata.source_title,
    metadata.canonical_title,
  ].map(toDiagnosticText).filter(Boolean).join(' '));
}

function searchResultTextForRescue(result: SearchResult): string {
  return buildSearchResultActualEvidenceText(result);
}

function searchResultHasBroadProductSignal(result: SearchResult): boolean {
  const text = searchResultTextForRescue(result);
  return /캠페인\s*(목표|유형)|광고\s*(상품|종류|유형|형식|포맷)|노출\s*(위치|지면)|게재\s*위치|검색\s*캠페인|디스플레이\s*캠페인|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|검색광고|쇼핑검색|파워링크|브랜드검색|쇼핑블록|상품\s*db|db\s*url|비즈보드|카카오모먼트|상품\s*가이드|advantage\+|어드밴티지|카탈로그|catalog|collection|placement|campaign_objective|ad_format/.test(text)
    || /인지도[\s\S]{0,80}트래픽[\s\S]{0,80}참여[\s\S]{0,80}잠재 고객[\s\S]{0,80}앱 홍보[\s\S]{0,80}판매/.test(text);
}

function isProductStructureRescueGrounding(
  result: SearchResult,
  intent: QueryIntent,
  message: string,
): boolean {
  if (!intent.topics.includes('product_structure')) return false;
  if (!result.content?.trim()) return false;
  if (result.retrievalMethod === 'fallback' || result.sourceQuality?.isFallback === true || result.metadata?.type === 'fallback') return false;
  if (searchResultHasBlockingGroundingWarning(result)) return false;
  if (!searchResultMatchesTargetVendor(result, intent)) return false;

  const text = searchResultTextForRescue(result);
  if (intent.isSpecificProductGuidance) {
    const mode = inferSpecificProductAnswerMode(message);
    const productTerms = Array.from(new Set([
      ...buildPrimarySpecificProductEvidenceTerms(intent),
      ...buildStrictProductEvidenceTerms(intent),
    ]));
    const modeTerms = buildRequestedProductModeTerms(mode);
    const hasProductTerm = productTerms.some(term => textContainsEvidenceTerm(text, term));
    const hasModeTerm = modeTerms.some(term => textContainsEvidenceTerm(text, term));
    const hasDetailSignal = sourceTextHasSpecificProductDetailSignal(text);

    return hasProductTerm && (
      mode === 'product_detail'
      || hasDetailSignal
      || hasModeTerm
    );
  }

  return searchResultHasBroadProductSignal(result);
}

function promoteProductStructureRescueGrounding(result: SearchResult): SearchResult {
  const evidenceDecisionReason = Array.from(new Set([
    ...(Array.isArray(result.evidenceDecisionReason) ? result.evidenceDecisionReason : []),
    ...(Array.isArray(result.metadata?.evidenceDecisionReason) ? result.metadata.evidenceDecisionReason : []),
    'product_structure_rescue_actual_evidence_verified',
  ]));
  const rankReason = Array.from(new Set([
    ...(Array.isArray(result.rankReason) ? result.rankReason : []),
    ...(Array.isArray(result.metadata?.rankReason) ? result.metadata.rankReason : []),
    'product_structure_rescue_promoted',
  ]));

  return {
    ...result,
    evidenceDecision: 'verified',
    evidenceDecisionReason,
    rankReason,
    metadata: {
      ...(result.metadata || {}),
      evidenceDecision: 'verified',
      evidenceDecisionReason,
      rankReason,
      answerEvidenceRole: result.metadata?.answerEvidenceRole
        || result.metadata?.answer_evidence_role
        || 'product_context',
    },
  };
}

function buildFilteredEvidenceDebugSample(result: SearchResult) {
  return {
    title: result.documentTitle || result.metadata?.title || result.metadata?.originalTitle || 'Unknown',
    vendor: getResultVendor(result),
    decision: getEvidenceDecision(result) || 'weak',
    retrievalMethod: result.retrievalMethod || result.metadata?.retrievalMethod || 'unknown',
    reasons: [
      ...(Array.isArray(result.rankReason) ? result.rankReason : []),
      ...(Array.isArray(result.evidenceDecisionReason) ? result.evidenceDecisionReason : []),
      ...(Array.isArray(result.metadata?.rankReason) ? result.metadata.rankReason : []),
      ...(Array.isArray(result.metadata?.evidenceDecisionReason) ? result.metadata.evidenceDecisionReason : []),
    ].slice(0, 4),
    excerpt: String(result.content || '').replace(/\s+/g, ' ').trim().slice(0, 120),
  };
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

    if (ragIntent.isOutOfScope || ragIntent.unavailablePolicyTarget) {
      console.log('Compass answer request blocked by authoritative no-data intent boundary', {
        isOutOfScope: ragIntent.isOutOfScope,
        outOfScopeTerms: ragIntent.outOfScopeTerms,
        unavailablePolicyTarget: ragIntent.unavailablePolicyTarget,
        unavailablePolicyTargetReason: ragIntent.unavailablePolicyTargetReason,
      });
      return buildAuthoritativeNoDataResponse(ragIntent, startTime, emitPhase);
    }

    // 1. Compass RAG 검색
    emitPhase?.({
      phase: 'evidence-started',
      message: '질문 조건을 분석하고 관련 출처를 검색합니다.',
      queryType: ragIntent.queryType,
    });
    const retrievalStartedAt = Date.now();
    const usesProductStructureFastPath = isBroadProductStructureAnswerIntent(message, ragIntent);
    const usesSpecificProductSupplementPath = (
      !usesProductStructureFastPath
      && ragIntent.topics.includes('product_structure')
      && (ragIntent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(message))
    );
    const fastPathSupplementQueries = usesProductStructureFastPath
      ? (() => {
        switch (ragIntent.vendors[0]) {
          case 'META':
            return [
              'Meta 광고 관리자 캠페인 목표 인지도 트래픽 참여 잠재 고객 앱 홍보 판매',
              'Meta 광고 상품 구조 컬렉션 광고 Advantage+ 카탈로그 리드 양식 앱 홍보',
              'Meta Advantage+ 카탈로그 컬렉션 광고 앱 홍보 앱 인스톨 리드 양식',
            ];
          case 'GOOGLE':
            return [
              'Google Ads 광고 유형 검색 캠페인 디스플레이 쇼핑 앱 캠페인',
              'Google Ads 실적 최대화 Performance Max PMax Demand Gen YouTube 동영상 캠페인',
              'Google Ads 리드 양식 확장 소재 앱 캠페인 쇼핑 광고',
              'Google Ads 반응형 디스플레이 동영상 YouTube 소재 가이드',
            ];
          case 'KAKAO':
            return [
              '카카오 광고 상품 비즈보드 디스플레이 광고 카카오모먼트',
              '카카오 상품가이드 제작가이드 심사가이드 소재 제작 조건',
              '카카오 비즈보드 톡채널 카카오톡 지면 광고 상품',
            ];
          case 'NAVER':
            return [
              '네이버 광고 상품 사이트검색 파워링크 브랜드검색 검색광고',
              '네이버 DA 성과형 디스플레이 홈피드 스마트채널 타임보드 롤링보드',
              '네이버 쇼핑검색광고 쇼핑블록 상품 DB URL EP 쇼핑파트너센터',
              '네이버 동영상 광고 소재 지면 상품 가이드',
            ];
          default:
            return [];
        }
      })()
      : [];
    const supplementQueries = usesProductStructureFastPath
      ? (fastPathSupplementQueries.length > 0
        ? fastPathSupplementQueries
        : buildProductStructureSupplementQueries(ragIntent, message).filter(query => query !== message))
      : buildProductStructureSupplementQueries(ragIntent, message).filter(query => query !== message);

    const supplementQueryLimit = usesProductStructureFastPath
      ? getProductStructureFastPathSupplementLimit(ragIntent.vendors[0])
      : usesSpecificProductSupplementPath
        ? getSpecificProductSupplementLimit(ragIntent.vendors[0])
      : 2;
    const selectedSupplementQueries = supplementQueries.slice(0, supplementQueryLimit);
    const searchQueries = [message, ...selectedSupplementQueries];
    const searchResultGroups = await Promise.all(
      searchQueries.map(query => searchWithCompassRAG(query, Math.max(8, ragIntent.recommendedSourceLimit))),
    );
    const retrievalDurationMs = Date.now() - retrievalStartedAt;
    const retrievalTimedOut = searchResultGroups.some(group => group.timedOut);
    const retrievalChannelTimedOut = searchResultGroups.some(group => group.channelTimedOut);
    const retrievalLimited = retrievalTimedOut || retrievalChannelTimedOut;
    const supplementResultCount = searchResultGroups.slice(1).flatMap(group => group.results).length;
    const rawSearchResultCount = searchResultGroups.flatMap(group => group.results).length;
    let searchResults = searchResultGroups.flatMap(group => group.results);

    if (supplementQueries.length > 0) {
      searchResults = mergeSearchResultsByIdentity(searchResults);
      console.log('Compass product-structure adaptive retrieval completed', {
        availableSupplementQueryCount: supplementQueries.length,
        selectedSupplementQueryCount: selectedSupplementQueries.length,
        supplementQueryLimit,
        supplementResultCount,
        mergedResultCount: searchResults.length,
        retrievalDurationMs,
      });
    }
    console.log('Compass answer retrieval completed', {
      retrievalDurationMs,
      searchQueryCount: searchQueries.length,
      selectedSupplementQueryCount: selectedSupplementQueries.length,
      rawResultCount: rawSearchResultCount,
      mergedResultCount: searchResults.length,
    });
    const verifiedSearchResults = searchResults.filter(isVerifiedGrounding);
    const verifiedResultKeys = new Set(verifiedSearchResults.map(result => getResultIdentityKey(result)));
    const productStructureRescueResults = searchResults.filter(result => (
      !verifiedResultKeys.has(getResultIdentityKey(result))
      && isProductStructureRescueGrounding(result, ragIntent, message)
    )).map(promoteProductStructureRescueGrounding);
    if (productStructureRescueResults.length > 0) {
      verifiedSearchResults.push(...productStructureRescueResults);
    }
    const sourceDiagnostics = {
      ...buildSourceDiagnostics(ragIntent, verifiedSearchResults),
      retrievalTimedOut,
      retrievalChannelTimedOut,
      retrievalDurationMs,
      searchQueryCount: searchQueries.length,
      selectedSupplementQueryCount: selectedSupplementQueries.length,
      supplementResultCount,
    };
    emitPhase?.({
      phase: 'evidence-ready',
      message: '확인 가능한 출처를 선별했습니다.',
      queryType: ragIntent.queryType,
      sourceCount: searchResults.length,
      verifiedSourceCount: verifiedSearchResults.length,
    });
    if (verifiedSearchResults.length !== searchResults.length) {
      const verifiedSet = new Set(verifiedSearchResults);
      console.warn('Compass answer evidence filtered', {
        filteredCount: searchResults.length - verifiedSearchResults.length,
        droppedSamples: searchResults
          .filter(result => !verifiedSet.has(result))
          .slice(0, 3)
          .map(buildFilteredEvidenceDebugSample),
      });
    }

    // 2. 검색 결과가 없으면 관련 내용 없음 응답
    if (verifiedSearchResults.length === 0 && retrievalLimited) {
      console.warn('Compass answer request completed with retrieval timeout and no grounded evidence');
      const limitedAnswer = '관련 출처 검색이 시간 제한에 걸려 답변을 확정할 수 없습니다. 현재 결과만으로 “자료 없음”으로 판단하지 않고, 잠시 후 다시 시도하거나 담당자 확인을 권장합니다.';
      emitPhase?.({ phase: 'answer-ready', message: '출처 검색이 제한되어 제한 응답을 준비했습니다.' });
      return {
        body: {
          response: {
            message: limitedAnswer,
            content: limitedAnswer,
            sources: [],
            noDataFound: false,
            schema: getCompassDbSchema(),
            showContactOption: true,
            sourceDiagnostics,
            reviewPipeline: buildReviewPipeline({
              status: 'limited',
              sourceCount: searchResults.length,
              verifiedSourceCount: 0,
              contactRecommended: true,
            }),
          },
          confidence: 0,
          processingTime: Date.now() - startTime,
          model: 'compass-answer-retrieval-limited'
        }
      };
    }

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
      retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
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
              retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
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
    const diagnosticAnswerMode = getCompassDiagnosticAnswerMode(
      message,
      specificProductScope,
      isBroadProductStructureLlmIntent,
    );

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
              answerMode: diagnosticAnswerMode,
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

    if (shouldUseDeterministicProductAnswerBeforeLlm()) {
      const deterministicSpecificProductAnswer = buildDeterministicSpecificProductAnswer(
        message,
        ragIntent,
        specificProductScope,
      );
      if (deterministicSpecificProductAnswer) {
        const showContactOption = Boolean(deterministicSpecificProductAnswer.showContactOption);
        emitPhase?.({
          phase: 'answer-ready',
          message: showContactOption
            ? '공식 출처 범위가 부족해 제한 답변을 준비했습니다.'
            : '상품별 공식 근거 답변을 정리했습니다.',
        });
        return {
          body: {
            response: {
              message: deterministicSpecificProductAnswer.answer,
              content: deterministicSpecificProductAnswer.answer,
              sources: deterministicSpecificProductAnswer.sources,
              noDataFound: deterministicSpecificProductAnswer.sources.length === 0,
              schema,
              showContactOption,
              sourceDiagnostics: {
                ...sourceDiagnostics,
                strictProductSourceCount: specificProductScope.strictProductSources.length,
                answerSourceCount: deterministicSpecificProductAnswer.sources.length,
                answerMode: diagnosticAnswerMode,
                deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
              },
              reviewPipeline: buildDeterministicProductReviewPipeline(
                deterministicSpecificProductAnswer,
                searchResults.length,
              ),
            },
            confidence: getDeterministicProductConfidence(confidence, deterministicSpecificProductAnswer),
            processingTime: Date.now() - startTime,
            model: deterministicSpecificProductAnswer.model
          }
        };
      }
    }

    if (ragIntent.topics.includes('product_structure') && ragIntent.isSpecificProductGuidance) {
      console.log('Compass specific product answer will use grounded LLM synthesis', {
        sourceCount: answerSources.length,
        strictProductTerms: ragIntent.strictProductTerms,
        vendor: ragIntent.vendors[0] || 'UNKNOWN',
        answerMode: diagnosticAnswerMode,
      });
      emitPhase?.({ phase: 'answer-started', message: '특정 상품 근거를 바탕으로 답변을 작성합니다.' });
    }

    if (isBroadProductStructureLlmIntent) {
      const productStructureSources = selectProductStructureResponseSources(sources, ragIntent, message);
      answerSources = productStructureSources;
      if (productStructureSources.length === 0) {
        const scopeLimitedAnswer = buildBroadProductStructureScopeLimitedAnswer(message, ragIntent);
        emitPhase?.({ phase: 'answer-ready', message: '광고 상품 구조를 직접 설명할 공식 근거가 부족해 제한 답변을 준비했습니다.' });
        return {
          body: {
            response: {
              message: scopeLimitedAnswer,
              content: scopeLimitedAnswer,
              sources: [],
              noDataFound: true,
              schema,
              showContactOption: true,
              sourceDiagnostics: {
                ...sourceDiagnostics,
                answerSourceCount: 0,
                answerMode: diagnosticAnswerMode,
              },
              reviewPipeline: buildReviewPipeline({
                status: 'limited',
                sourceCount: searchResults.length,
                verifiedSourceCount: 0,
                contactRecommended: true,
              }),
            },
            confidence: 0,
            processingTime: Date.now() - startTime,
            model: 'compass-answer-product-structure-scope-limited'
          }
        };
      }
      if (shouldUseDeterministicProductAnswerBeforeLlm()) {
        const deterministicBroadProductAnswer = buildDeterministicBroadProductAnswer(
          message,
          ragIntent,
          answerSources,
        );
        if (deterministicBroadProductAnswer) {
          emitPhase?.({ phase: 'answer-ready', message: '상품 구조 근거를 기준으로 답변을 정리했습니다.' });
          return {
            body: {
              response: {
                message: deterministicBroadProductAnswer.answer,
                content: deterministicBroadProductAnswer.answer,
                sources: deterministicBroadProductAnswer.sources,
                noDataFound: false,
                schema,
                showContactOption: Boolean(deterministicBroadProductAnswer.showContactOption),
                sourceDiagnostics: {
                  ...sourceDiagnostics,
                  answerSourceCount: deterministicBroadProductAnswer.sources.length,
                  answerMode: diagnosticAnswerMode,
                  deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
                },
                reviewPipeline: buildDeterministicProductReviewPipeline(
                  deterministicBroadProductAnswer,
                  searchResults.length,
                ),
              },
              confidence: getDeterministicProductConfidence(confidence, deterministicBroadProductAnswer),
              processingTime: Date.now() - startTime,
              model: deterministicBroadProductAnswer.model
            }
          };
        }
      }
      console.log('Compass product structure broad answer will use grounded LLM synthesis', {
        sourceCount: answerSources.length,
        vendor: ragIntent.vendors[0] || 'UNKNOWN',
      });
      emitPhase?.({ phase: 'answer-started', message: '상품 구조 근거를 바탕으로 답변을 작성합니다.' });
    }

    let answerResult;
    const answerGenerationStartedAt = Date.now();
    let answerGenerationDurationMs = 0;
    try {
      answerResult = await generateCompassAnswer(
        message,
        buildAnswerGroundingSources(
          answerSources,
          buildCompassGroundingOptions(message, ragIntent, specificProductScope, isBroadProductStructureLlmIntent),
        ),
      );
      answerGenerationDurationMs = Date.now() - answerGenerationStartedAt;
    } catch (error) {
      answerGenerationDurationMs = Date.now() - answerGenerationStartedAt;
      console.error('Compass answer generation failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        failureCategory: 'answer_generation_unavailable',
        sourceCount: answerSources.length,
        answerMode: diagnosticAnswerMode,
        isSpecificProductGuidance: ragIntent.isSpecificProductGuidance,
        answerGenerationDurationMs,
      });

      const evidenceBackedProductFallback = shouldUseDeterministicProductAnswerOnLlmFailure()
        ? (
          buildDeterministicSpecificProductAnswer(
            message,
            ragIntent,
            specificProductScope,
          ) || (isBroadProductStructureLlmIntent
            ? buildDeterministicBroadProductAnswer(message, ragIntent, answerSources)
            : null)
        )
        : null;

      if (evidenceBackedProductFallback) {
        const showContactOption = Boolean(evidenceBackedProductFallback.showContactOption);
        emitPhase?.({
          phase: 'answer-ready',
          message: showContactOption
            ? '모델 연결이 제한되어 출처 범위 안에서 제한 답변을 준비했습니다.'
            : '모델 연결이 제한되어 선별 근거 기준 답변을 준비했습니다.',
        });
        return {
          body: {
            response: {
              message: evidenceBackedProductFallback.answer,
              content: evidenceBackedProductFallback.answer,
              sources: evidenceBackedProductFallback.sources,
              noDataFound: evidenceBackedProductFallback.sources.length === 0,
              schema,
              showContactOption,
              sourceDiagnostics: {
                ...sourceDiagnostics,
                strictProductSourceCount: specificProductScope.strictProductSources.length,
                answerSourceCount: evidenceBackedProductFallback.sources.length,
                answerMode: diagnosticAnswerMode,
                answerGenerationDurationMs,
                fallbackReason: 'llm_generation_failed',
                deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
                evidenceBackedFallback: true,
              },
              reviewPipeline: buildDeterministicProductReviewPipeline(
                evidenceBackedProductFallback,
                searchResults.length,
              ),
            },
            confidence: getDeterministicProductConfidence(
              Math.min(confidence, 68),
              evidenceBackedProductFallback,
            ),
            processingTime: Date.now() - startTime,
            model: `${evidenceBackedProductFallback.model}-llm-fallback`
          }
        };
      }

      // 답변 LLM 실패와 retrieval 실패를 분리하기 위해 검증된 sources는 보존한다.
      const groundedFallbackAnswer = buildLlmFailureGroundedFallbackAnswer(
        message,
        answerSources,
        ragIntent,
        specificProductScope,
        isBroadProductStructureLlmIntent,
      );

      if (groundedFallbackAnswer) {
        emitPhase?.({ phase: 'answer-ready', message: '모델 연결이 제한되어 근거 요약을 준비했습니다.' });
        return {
          body: {
            response: {
              message: groundedFallbackAnswer,
              content: groundedFallbackAnswer,
              sources: answerSources,
              noDataFound: false,
              schema,
              showContactOption: true,
              sourceDiagnostics: {
                ...sourceDiagnostics,
                strictProductSourceCount: specificProductScope.strictProductSources.length,
                answerSourceCount: answerSources.length,
                answerMode: diagnosticAnswerMode,
                answerGenerationDurationMs,
                fallbackReason: 'llm_generation_failed',
              },
              reviewPipeline: buildReviewPipeline({
                status: 'limited',
                sourceCount: searchResults.length,
                verifiedSourceCount: answerSources.length,
                contactRecommended: true,
              }),
            },
            confidence: Math.min(confidence, 60),
            processingTime: Date.now() - startTime,
            model: 'compass-answer-grounded-llm-fallback'
          }
        };
      }

      if (process.env.COMPASS_ENABLE_DETERMINISTIC_PRODUCT_FALLBACK_ON_LLM_FAILURE === 'true') {
        const deterministicFallback = buildDeterministicSpecificProductAnswer(
          message,
          ragIntent,
          specificProductScope,
        ) || (isBroadProductStructureLlmIntent
          ? buildDeterministicBroadProductAnswer(message, ragIntent, answerSources)
          : null);

        if (deterministicFallback) {
          const showContactOption = Boolean(deterministicFallback.showContactOption);
          emitPhase?.({
            phase: 'answer-ready',
            message: showContactOption
              ? '모델 연결이 제한되어 공식 출처 범위 안에서 최소 답변을 준비했습니다.'
              : '모델 연결이 제한되어 준비된 근거 요약을 제공했습니다.',
          });
          return {
            body: {
              response: {
                message: deterministicFallback.answer,
                content: deterministicFallback.answer,
                sources: deterministicFallback.sources,
                noDataFound: deterministicFallback.sources.length === 0,
                schema,
                showContactOption,
                sourceDiagnostics: {
                  ...sourceDiagnostics,
                  strictProductSourceCount: specificProductScope.strictProductSources.length,
                  answerSourceCount: deterministicFallback.sources.length,
                  answerMode: diagnosticAnswerMode,
                  answerGenerationDurationMs,
                  deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
                  fallbackReason: 'llm_generation_failed',
                },
                reviewPipeline: buildDeterministicProductReviewPipeline(
                  deterministicFallback,
                  searchResults.length,
                ),
              },
              confidence: getDeterministicProductConfidence(confidence, deterministicFallback),
              processingTime: Date.now() - startTime,
              model: `${deterministicFallback.model}-llm-fallback`
            }
          };
        }
      }

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
            sourceDiagnostics: {
              ...sourceDiagnostics,
              answerSourceCount: answerSources.length,
              answerMode: diagnosticAnswerMode,
              answerGenerationDurationMs,
              fallbackReason: 'llm_generation_failed',
            },
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
    console.log('Compass answer runtime request completed', {
      processingTime,
      retrievalDurationMs,
      answerGenerationDurationMs,
    });
    const operationalAnswer = buildNaverShoppingDataOperationalAnswer(message, answerSources);
    const rawGeneratedAnswer = String(answerResult.answer || '').trim();
    const answerRepair = buildSpecificProductGeneratedAnswerRepair(
      message,
      ragIntent,
      specificProductScope,
      isBroadProductStructureLlmIntent,
      rawGeneratedAnswer,
      operationalAnswer,
    );
    const broadAnswerRepair = buildBroadProductGeneratedAnswerRepair(
      message,
      ragIntent,
      answerSources,
      isBroadProductStructureLlmIntent,
      rawGeneratedAnswer,
    );
    const finalAnswerSources = dedupePublicProductSources(answerRepair?.sources || broadAnswerRepair?.sources || answerSources);
    const finalConfidenceCap = answerRepair?.confidenceCap ?? broadAnswerRepair?.confidenceCap;
    const normalizedAnswer = normalizeGeneratedAnswer(
      answerRepair?.answer || broadAnswerRepair?.answer || rawGeneratedAnswer || operationalAnswer || '',
      finalAnswerSources,
    );
    const responseAnswer = coverageNotice ? `${coverageNotice}\n\n${normalizedAnswer}` : normalizedAnswer;

    if (answerStatesNoVerifiedData(responseAnswer)) {
      console.warn('Compass answer generation produced no-data text; forcing noDataFound response state');
      return buildAuthoritativeNoDataResponse(ragIntent, startTime, emitPhase);
    }
    
    emitPhase?.({ phase: 'answer-ready', message: '답변 정리가 완료되었습니다.' });
    return {
      body: {
        response: {
          message: responseAnswer,
          content: responseAnswer,
          sources: finalAnswerSources,
          noDataFound: false,
          schema,
          showContactOption: Boolean(answerRepair?.showContactOption || broadAnswerRepair?.showContactOption),
          sourceDiagnostics: {
            ...sourceDiagnostics,
            answerSourceCount: finalAnswerSources.length,
            answerMode: diagnosticAnswerMode,
            answerGenerationDurationMs,
            answerRepairReason: answerRepair?.reason,
            broadAnswerRepairReason: broadAnswerRepair?.reason,
          },
            reviewPipeline: answerRepair
            ? buildReviewPipeline({
              status: answerRepair.reviewStatus || 'completed',
              sourceCount: searchResults.length,
              verifiedSourceCount: finalAnswerSources.length,
              contactRecommended: Boolean(answerRepair.showContactOption),
              retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
            })
            : broadAnswerRepair
              ? buildReviewPipeline({
                status: broadAnswerRepair.reviewStatus || 'completed',
                sourceCount: searchResults.length,
                verifiedSourceCount: finalAnswerSources.length,
                contactRecommended: Boolean(broadAnswerRepair.showContactOption),
                retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
              })
            : reviewPipeline,
        },
        confidence: finalConfidenceCap ? Math.min(confidence, finalConfidenceCap) : confidence,
        processingTime,
        model: answerRepair?.model || broadAnswerRepair?.model || buildCompassAnswerModel(message, ragIntent, isBroadProductStructureLlmIntent)
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
