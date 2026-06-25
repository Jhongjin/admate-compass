import { NextRequest, NextResponse } from 'next/server';
import { getCompassDbSchema } from '@/lib/supabase/compass';
import {
  classifyCompassRagQuery,
  getCompassRetrievalChannelTimeoutMetadata,
  RAGSearchService,
  type EvidenceDecision,
  type QueryIntent,
  type RetrievalChannelTiming,
  type VendorIntent,
} from '@/lib/services/RAGSearchService';
import { getCompassOfficialDocumentChunkSnapshotRows } from '@/lib/services/compassOfficialChunkSnapshots';
import { generateCompassAnswer, polishCompassAnswerStyle, type CompassGroundingSource } from '@/lib/services/CompassAnswerLlmService';
import {
  getCompassAnswerDurableStoreStatus,
  readCompassAnswerDurableCache,
  recordCompassAnswerDurableRuntimeEvent,
  writeCompassAnswerDurableCache,
  type CompassAnswerDurableRuntimeEvent,
} from './compassAnswerRuntimeStore';

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

type CompassAnswerResponseCacheEntry = {
  body: Record<string, unknown>;
  expiresAt: number;
};

export type CompassAnswerCacheStatus = 'HIT' | 'MISS' | 'BYPASS';

type CompassRetrievalResult = {
  results: SearchResult[];
  timedOut: boolean;
  channelTimedOut: boolean;
  channelTimings: RetrievalChannelTiming[];
  durationMs: number;
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
const COMPASS_ANSWER_RESPONSE_CACHE_TTL_MS = Math.min(
  Math.max(Number(process.env.COMPASS_ANSWER_RESPONSE_CACHE_TTL_MS || 900000), 30000),
  900000,
);
const COMPASS_ANSWER_RESPONSE_CACHE_MAX_ENTRIES = 64;
const COMPASS_ANSWER_RESPONSE_CACHE_KEY_VERSION = 'v49-specific-product-routing';
const COMPASS_CONVERSATION_HISTORY_MAX_ITEMS = 25;
const compassAnswerResponseCache = new Map<string, CompassAnswerResponseCacheEntry>();
const compassAnswerRuntimeMetrics = {
  startedAt: Date.now(),
  updatedAt: Date.now(),
  cacheableRequestCount: 0,
  cacheHitCount: 0,
  cacheMissCount: 0,
  bypassedRequestCount: 0,
  completedRequestCount: 0,
  errorResponseCount: 0,
  noDataResponseCount: 0,
  retrievalLimitedResponseCount: 0,
  processingTimeTotalMs: 0,
  processingTimeSampleCount: 0,
  retrievalDurationTotalMs: 0,
  retrievalDurationSampleCount: 0,
  answerGenerationDurationTotalMs: 0,
  answerGenerationDurationSampleCount: 0,
  lastProcessingTimeMs: null as number | null,
  lastRetrievalDurationMs: null as number | null,
  lastAnswerGenerationDurationMs: null as number | null,
  lastCacheStatus: 'BYPASS' as CompassAnswerCacheStatus,
  lastSlowestChannel: null as Record<string, unknown> | null,
};

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveAverage(total: number, count: number): number | null {
  return count > 0 ? Math.round(total / count) : null;
}

function readCompassAnswerSourceDiagnostics(body: Record<string, unknown>): Record<string, any> {
  const response = (body as any).response;
  const diagnostics = response?.sourceDiagnostics;
  return diagnostics && typeof diagnostics === 'object' ? diagnostics : {};
}

function recordCompassAnswerRuntimeResult(
  result: CompassAnswerHandlerResult,
  cacheStatus: CompassAnswerCacheStatus,
): void {
  const body = result.body;
  const response = (body as any).response;
  const sourceDiagnostics = readCompassAnswerSourceDiagnostics(body);
  const processingTimeMs = toFiniteNumber((body as any).processingTime);
  const retrievalDurationMs = toFiniteNumber(sourceDiagnostics.retrievalDurationMs);
  const answerGenerationDurationMs = toFiniteNumber(sourceDiagnostics.answerGenerationDurationMs);

  compassAnswerRuntimeMetrics.updatedAt = Date.now();
  compassAnswerRuntimeMetrics.completedRequestCount += 1;
  compassAnswerRuntimeMetrics.lastCacheStatus = cacheStatus;
  if ((result.status || 200) >= 400 || response?.error === true) {
    compassAnswerRuntimeMetrics.errorResponseCount += 1;
  }
  if (response?.noDataFound === true) {
    compassAnswerRuntimeMetrics.noDataResponseCount += 1;
  }
  if (sourceDiagnostics.retrievalTimedOut === true || sourceDiagnostics.retrievalChannelTimedOut === true) {
    compassAnswerRuntimeMetrics.retrievalLimitedResponseCount += 1;
  }
  if (processingTimeMs !== null) {
    compassAnswerRuntimeMetrics.processingTimeTotalMs += processingTimeMs;
    compassAnswerRuntimeMetrics.processingTimeSampleCount += 1;
    compassAnswerRuntimeMetrics.lastProcessingTimeMs = processingTimeMs;
  }
  if (retrievalDurationMs !== null && cacheStatus !== 'HIT') {
    compassAnswerRuntimeMetrics.retrievalDurationTotalMs += retrievalDurationMs;
    compassAnswerRuntimeMetrics.retrievalDurationSampleCount += 1;
    compassAnswerRuntimeMetrics.lastRetrievalDurationMs = retrievalDurationMs;
  }
  if (answerGenerationDurationMs !== null && cacheStatus !== 'HIT') {
    compassAnswerRuntimeMetrics.answerGenerationDurationTotalMs += answerGenerationDurationMs;
    compassAnswerRuntimeMetrics.answerGenerationDurationSampleCount += 1;
    compassAnswerRuntimeMetrics.lastAnswerGenerationDurationMs = answerGenerationDurationMs;
  }
  if (sourceDiagnostics.retrievalSlowestChannel && typeof sourceDiagnostics.retrievalSlowestChannel === 'object') {
    compassAnswerRuntimeMetrics.lastSlowestChannel = sourceDiagnostics.retrievalSlowestChannel;
  }
}

export function getCompassAnswerRuntimeMetrics() {
  const cacheableRequests = compassAnswerRuntimeMetrics.cacheableRequestCount;
  return {
    startedAt: new Date(compassAnswerRuntimeMetrics.startedAt).toISOString(),
    updatedAt: new Date(compassAnswerRuntimeMetrics.updatedAt).toISOString(),
    uptimeMs: Date.now() - compassAnswerRuntimeMetrics.startedAt,
    completedRequestCount: compassAnswerRuntimeMetrics.completedRequestCount,
    errorResponseCount: compassAnswerRuntimeMetrics.errorResponseCount,
    noDataResponseCount: compassAnswerRuntimeMetrics.noDataResponseCount,
    retrievalLimitedResponseCount: compassAnswerRuntimeMetrics.retrievalLimitedResponseCount,
    cache: {
      entries: compassAnswerResponseCache.size,
      maxEntries: COMPASS_ANSWER_RESPONSE_CACHE_MAX_ENTRIES,
      ttlMs: COMPASS_ANSWER_RESPONSE_CACHE_TTL_MS,
      cacheableRequestCount: cacheableRequests,
      hitCount: compassAnswerRuntimeMetrics.cacheHitCount,
      missCount: compassAnswerRuntimeMetrics.cacheMissCount,
      bypassedRequestCount: compassAnswerRuntimeMetrics.bypassedRequestCount,
      hitRatio: cacheableRequests > 0
        ? Number((compassAnswerRuntimeMetrics.cacheHitCount / cacheableRequests).toFixed(4))
        : null,
      lastStatus: compassAnswerRuntimeMetrics.lastCacheStatus,
    },
    durableStore: getCompassAnswerDurableStoreStatus(),
    durations: {
      avgProcessingTimeMs: resolveAverage(
        compassAnswerRuntimeMetrics.processingTimeTotalMs,
        compassAnswerRuntimeMetrics.processingTimeSampleCount,
      ),
      avgRetrievalDurationMs: resolveAverage(
        compassAnswerRuntimeMetrics.retrievalDurationTotalMs,
        compassAnswerRuntimeMetrics.retrievalDurationSampleCount,
      ),
      avgAnswerGenerationDurationMs: resolveAverage(
        compassAnswerRuntimeMetrics.answerGenerationDurationTotalMs,
        compassAnswerRuntimeMetrics.answerGenerationDurationSampleCount,
      ),
      lastProcessingTimeMs: compassAnswerRuntimeMetrics.lastProcessingTimeMs,
      lastRetrievalDurationMs: compassAnswerRuntimeMetrics.lastRetrievalDurationMs,
      lastAnswerGenerationDurationMs: compassAnswerRuntimeMetrics.lastAnswerGenerationDurationMs,
      retrievalSampleCount: compassAnswerRuntimeMetrics.retrievalDurationSampleCount,
      answerGenerationSampleCount: compassAnswerRuntimeMetrics.answerGenerationDurationSampleCount,
    },
    lastSlowestChannel: compassAnswerRuntimeMetrics.lastSlowestChannel,
  };
}

function normalizeCompassAnswerCacheMessage(message: unknown): string {
  return String(message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveCompassAnswerCacheKey(body: any): string | null {
  const message = normalizeCompassAnswerCacheMessage(body?.message);
  if (!message || message.length > 500) return null;

  const history = Array.isArray(body?.conversationHistory)
    ? body.conversationHistory.slice(-COMPASS_CONVERSATION_HISTORY_MAX_ITEMS)
    : [];
  if (history.length > 0) return null;

  return `compass-answer:${COMPASS_ANSWER_RESPONSE_CACHE_KEY_VERSION}:${message}`;
}

async function resolveCompassAnswerRequestCacheKey(request: NextRequest): Promise<string | null> {
  try {
    return resolveCompassAnswerCacheKey(await request.clone().json());
  } catch {
    return null;
  }
}

function shouldBypassCompassAnswerRuntimeCache(request: NextRequest): boolean {
  const bypassHeader = request.headers.get('x-compass-answer-cache-bypass')
    || request.headers.get('x-rag-eval-cache-bypass')
    || '';
  if (/^(1|true|yes)$/i.test(bypassHeader.trim())) return true;

  const cacheControl = request.headers.get('cache-control') || '';
  if (/\bno-cache\b|\bno-store\b/i.test(cacheControl)) return true;

  return request.nextUrl.searchParams.get('cache') === 'bypass';
}

function cloneCompassAnswerBody(body: Record<string, unknown>): Record<string, unknown> {
  return typeof structuredClone === 'function'
    ? structuredClone(body)
    : JSON.parse(JSON.stringify(body));
}

function getCachedCompassAnswerResponse(cacheKey: string): Record<string, unknown> | null {
  const entry = compassAnswerResponseCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    compassAnswerResponseCache.delete(cacheKey);
    return null;
  }
  return cloneCompassAnswerBody(entry.body);
}

function rememberCompassAnswerResponse(cacheKey: string, result: CompassAnswerHandlerResult): Date | null {
  if ((result.status || 200) >= 400) return null;
  const response = (result.body as any).response;
  if (response?.error === true) return null;
  const expiresAt = new Date(Date.now() + COMPASS_ANSWER_RESPONSE_CACHE_TTL_MS);

  compassAnswerResponseCache.set(cacheKey, {
    body: cloneCompassAnswerBody(result.body),
    expiresAt: expiresAt.getTime(),
  });

  while (compassAnswerResponseCache.size > COMPASS_ANSWER_RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = compassAnswerResponseCache.keys().next().value;
    if (!oldestKey) break;
    compassAnswerResponseCache.delete(oldestKey);
  }

  return expiresAt;
}

function markCompassAnswerCacheHit(
  body: Record<string, unknown>,
  processingTime: number,
  scope: 'memory' | 'durable' = 'memory',
): Record<string, unknown> {
  const response = (body as any).response;
  if (response && typeof response === 'object') {
    response.sourceDiagnostics = {
      ...(response.sourceDiagnostics && typeof response.sourceDiagnostics === 'object'
        ? response.sourceDiagnostics
        : {}),
      responseCacheHit: true,
      responseCacheScope: scope,
    };
  }
  return {
    ...body,
    processingTime,
  };
}

function markCompassAnswerCacheMiss(body: Record<string, unknown>): Record<string, unknown> {
  const response = (body as any).response;
  if (response && typeof response === 'object') {
    response.sourceDiagnostics = {
      ...(response.sourceDiagnostics && typeof response.sourceDiagnostics === 'object'
        ? response.sourceDiagnostics
        : {}),
      responseCacheHit: false,
      responseCacheScope: 'none',
    };
  }
  return body;
}

function countCompassGraphLikeSources(sources: unknown): number | null {
  if (!Array.isArray(sources)) return null;
  return sources.filter((source: any) => (
    source?.retrievalMethod === 'graph'
    || source?.metadata?.retrievalMethod === 'graph'
    || source?.metadata?.answerEvidenceRole === 'official_graph'
    || (source?.metadata?.source_kind === 'official_doc' && source?.metadata?.graphPath)
  )).length;
}

function buildCompassAnswerDurableRuntimeEvent(
  result: CompassAnswerHandlerResult,
  cacheStatus: CompassAnswerCacheStatus,
  cacheKey: string | null,
): CompassAnswerDurableRuntimeEvent {
  const body = result.body as any;
  const response = body.response && typeof body.response === 'object' ? body.response : {};
  const sourceDiagnostics = readCompassAnswerSourceDiagnostics(result.body);
  const sources = Array.isArray(response.sources) ? response.sources : [];
  const status = result.status || 200;

  return {
    cacheStatus,
    cacheKey,
    processingTimeMs: toFiniteNumber(body.processingTime),
    retrievalDurationMs: toFiniteNumber(sourceDiagnostics.retrievalDurationMs),
    answerGenerationDurationMs: toFiniteNumber(sourceDiagnostics.answerGenerationDurationMs),
    retrievalTimedOut: sourceDiagnostics.retrievalTimedOut === true,
    retrievalChannelTimedOut: sourceDiagnostics.retrievalChannelTimedOut === true,
    noDataFound: response.noDataFound === true,
    errorResponse: status >= 400 || response.error === true,
    model: typeof body.model === 'string' ? body.model : null,
    sourceCount: sources.length,
    graphLikeSourceCount: countCompassGraphLikeSources(sources),
    slowestChannel: sourceDiagnostics.retrievalSlowestChannel && typeof sourceDiagnostics.retrievalSlowestChannel === 'object'
      ? sourceDiagnostics.retrievalSlowestChannel
      : null,
    metadata: {
      status,
      answerMode: sourceDiagnostics.answerMode,
      deterministicAnswerFamily: sourceDiagnostics.deterministicAnswerFamily,
      fastAnswerFallback: sourceDiagnostics.fastAnswerFallback,
      responseCacheScope: sourceDiagnostics.responseCacheScope,
    },
  };
}

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
      return { results: [], timedOut: false, channelTimedOut: false, channelTimings: [], durationMs: Date.now() - startedAt };
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
    const retrievalDurationMs = Date.now() - startedAt;
    const slowestChannel = channelTimeoutMetadata.timings.length > 0
      ? channelTimeoutMetadata.timings.reduce((slowest, current) => (
        current.durationMs > slowest.durationMs ? current : slowest
      ))
      : null;
    
    console.log('Compass evidence retrieval completed', {
      resultCount: searchResults.length,
      durationMs: retrievalDurationMs,
      limit,
      timedOut: retrievalResult.timedOut,
      channelTimedOut: channelTimeoutMetadata.timedOut,
      timedOutChannelCount: channelTimeoutMetadata.channels.length,
      channelTimingCount: channelTimeoutMetadata.timings.length,
      slowestChannel: slowestChannel
        ? {
          label: slowestChannel.label,
          durationMs: slowestChannel.durationMs,
          resultCount: slowestChannel.resultCount,
          timedOut: slowestChannel.timedOut,
          failed: slowestChannel.failed === true,
        }
        : null,
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
      channelTimings: channelTimeoutMetadata.timings,
      durationMs: retrievalDurationMs,
    };
    
  } catch (error) {
    console.error('Compass evidence retrieval failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return { results: [], timedOut: false, channelTimedOut: false, channelTimings: [], durationMs: 0 };
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
  KAKAO: /kakao|카카오|카카오톡|톡채널|비즈보드|모먼트|카카오모먼트/i,
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

function applyCoverageNoticeToAnswer(answer: string, diagnostics: ReturnType<typeof buildSourceDiagnostics>) {
  const notice = buildCoverageNotice(diagnostics);
  const normalizedAnswer = answer.trim();
  if (!notice) return normalizedAnswer;
  if (!normalizedAnswer) return notice;
  if (normalizedAnswer.includes(notice)) return normalizedAnswer;

  return `${notice}\n\n${normalizedAnswer}`;
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

function hasSourceGuidedProductOrPolicyIntent(message: string, intent: QueryIntent): boolean {
  if (detectFastPolicySourceGuidedAnswerFamily(message, intent)) return true;
  if (isPolicyJudgmentAnswerIntent(intent)) return true;
  if (intent.topics.includes('product_structure')) return true;
  if (intent.isProductStructureOverview || intent.isSpecificProductGuidance) return true;
  if (hasNamedSpecificProductQuestion(message)) return true;

  return false;
}

function shouldUseSourceGuidedAnswerWithPartialCoverage(
  message: string,
  intent: QueryIntent,
  diagnostics: ReturnType<typeof buildSourceDiagnostics>,
): boolean {
  if (intent.isOutOfScope || intent.unavailablePolicyTarget) return false;
  if (diagnostics.missingVendorSlots.length === 0) return false;

  const coveredRequestedVendors = diagnostics.coveredVendors.filter((vendor) => intent.vendors.includes(vendor));
  if (coveredRequestedVendors.length === 0) return false;

  return hasSourceGuidedProductOrPolicyIntent(message, intent);
}

function normalizeProductIntentText(message: string): string {
  return message.toLowerCase().replace(/\s+/g, ' ').trim();
}

type CompassConversationHistoryItem = {
  role?: unknown;
  content?: unknown;
  message?: unknown;
  text?: unknown;
  parts?: unknown;
};

const CONTEXTUAL_PRODUCT_VENDOR_LABELS: Record<VendorIntent, string> = {
  META: 'Meta',
  GOOGLE: 'Google Ads',
  NAVER: '네이버',
  KAKAO: '카카오',
};

function getConversationHistoryItemText(item: unknown): string {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  const record = item as CompassConversationHistoryItem;
  const directText = [record.content, record.message, record.text]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .trim();
  if (directText) return directText;

  if (!Array.isArray(record.parts)) return '';
  return record.parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object' || Array.isArray(part)) return '';
      const partRecord = part as Record<string, unknown>;
      return [partRecord.text, partRecord.content]
        .filter((value): value is string => typeof value === 'string')
        .join(' ');
    })
    .join(' ')
    .trim();
}

function detectContextualVendorMentions(text: string): VendorIntent[] {
  const normalized = normalizeProductIntentText(text);
  const vendors: VendorIntent[] = [];
  const addVendor = (vendor: VendorIntent) => {
    if (!vendors.includes(vendor)) vendors.push(vendor);
  };

  if (/meta|메타|facebook|페이스북|instagram|인스타그램/.test(normalized)) addVendor('META');
  if (/google|구글|youtube|유튜브|google\s*ads|구글\s*애즈|pmax|performance\s*max/.test(normalized)) addVendor('GOOGLE');
  if (/naver|네이버/.test(normalized)) addVendor('NAVER');
  if (/kakao|카카오|카카오톡|톡채널|비즈보드|카카오모먼트/.test(normalized)) addVendor('KAKAO');

  return vendors;
}

function isContextualProductGuideFollowup(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  if (detectContextualVendorMentions(normalized).length > 0) return false;

  const hasFollowupSignal = /상품\s*별|상품별|제작\s*가이드|소재\s*(가이드|제작|사양|규격)|상품\s*(가이드|유형|종류|목록)|가이드|상세|자세|모두|추가|더|도\s*알려|알려줘|정리/.test(normalized);
  const hasStandaloneScope = /광고\s*상품|광고상품|광고\s*(유형|종류|목록)|캠페인\s*(유형|목표|목적)|비교|매체별/.test(normalized);

  return hasFollowupSignal && !hasStandaloneScope;
}

function buildContextualCompassProductQuestion(
  message: string,
  conversationHistory: unknown,
): { message: string; contextualized: boolean; historyItemCount: number; vendors: VendorIntent[] } {
  const history = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-COMPASS_CONVERSATION_HISTORY_MAX_ITEMS)
    : [];
  const currentVendors = detectContextualVendorMentions(message);
  const hasCurrentNamedProduct = hasNamedSpecificProductQuestion(message);
  const shouldUseHistory = isContextualProductGuideFollowup(message);
  if (!shouldUseHistory || currentVendors.length > 0 || hasCurrentNamedProduct || history.length === 0) {
    return {
      message,
      contextualized: false,
      historyItemCount: history.length,
      vendors: currentVendors,
    };
  }

  const contextualVendors: VendorIntent[] = [];
  for (const item of [...history].reverse()) {
    const text = getConversationHistoryItemText(item);
    if (!text) continue;
    for (const vendor of detectContextualVendorMentions(text)) {
      if (!contextualVendors.includes(vendor)) contextualVendors.push(vendor);
    }
    if (contextualVendors.length >= 4) break;
  }

  if (contextualVendors.length === 0) {
    return {
      message,
      contextualized: false,
      historyItemCount: history.length,
      vendors: [],
    };
  }

  const vendorLabel = contextualVendors
    .map(vendor => CONTEXTUAL_PRODUCT_VENDOR_LABELS[vendor])
    .join(', ');
  const contextualPrefix = `${vendorLabel} 광고 상품 유형과 상품별 소재 제작 가이드 기준으로`;

  return {
    message: `${contextualPrefix} ${message}`,
    contextualized: true,
    historyItemCount: history.length,
    vendors: contextualVendors,
  };
}

function hasNamedSpecificProductQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  return /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|스마트채널|타임보드|롤링보드|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고|동영상\s*광고|비디오\s*광고|youtube\s*shorts|shorts\s*광고|video\s*action\s*campaign|\bvac\b|앱\s*인스톨|앱\s*설치|앱\s*홍보|앱\s*사전\s*등록|app\s*install|app\s*promotion|리드\s*양식|잠재\s*고객\s*광고|잠재고객\s*광고|잠재고객광고|비즈니스\s*폼|비즈니스폼|lead\s*form|lead\s*generation|lead\s*ads?|db\s*url|상품\s*db|상품등록|ep|카탈로그|catalog|advantage\+|어드밴티지|performance\s*max|\bpmax\b|demand\s*gen|쇼핑검색|사이트검색|파워링크|브랜드검색|쇼핑블록|비즈보드/.test(normalized);
}

function isProductSelectionQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  return /어떻게\s*(고르|선택|구분)|기준으로\s*(설명|구분|선택|정리)|선택\s*기준|고르는\s*기준|골라야|고르면|추천|목적별|목표별|상황별|어떤\s*(상품|유형|캠페인)|무엇을\s*(선택|고르)|뭘\s*(선택|고르)|목표\s*기준|광고\s*상품\s*(종류|유형|목록|구조|군)|광고상품\s*(종류|유형|목록|구조|군)|상품\s*(종류|유형|목록|구조|군)|광고\s*(종류|유형)/.test(normalized);
}

function isBroadMetaProductPlanningQuestion(message: string, intent?: QueryIntent): boolean {
  const normalized = normalizeProductIntentText(message);
  if (intent && intent.vendors.length > 1) return false;
  const vendor = intent?.vendors.length === 1 ? intent.vendors[0] : undefined;
  if (vendor && vendor !== 'META') return false;

  const asksMeta = vendor === 'META'
    || /meta|메타|facebook|페이스북|instagram|인스타그램/.test(normalized);
  const asksProductTypes = /광고\s*(상품|유형|종류|구조)|광고상품|상품\s*(유형|종류|구조)|유형별|상품별/.test(normalized);
  const asksPlanningAxes = /캠페인\s*목표|광고\s*형식|소재\s*형식|게재\s*위치|노출\s*위치|리드|잠재\s*고객|앱|카탈로그|활용\s*기준|실무|제작\s*가이드|소재|사양|규격|비율|사이즈/.test(normalized);
  const namedAxisCount = [
    /캠페인\s*(목표|목적)|광고\s*관리자\s*목표|인지도|트래픽|참여|판매/.test(normalized),
    /광고\s*형식|소재\s*형식|이미지|동영상|카루셀|캐러셀|컬렉션|collection/.test(normalized),
    /게재\s*위치|노출\s*위치|placements?|facebook|페이스북|instagram|인스타그램/.test(normalized),
    /리드|잠재\s*고객|lead/.test(normalized),
    /앱|app/.test(normalized),
    /카탈로그|catalog|컬렉션|collection/.test(normalized),
    /측정|픽셀|pixel|capi|conversions?\s*api/.test(normalized),
  ].filter(Boolean).length;

  return asksMeta && asksProductTypes && asksPlanningAxes && namedAxisCount >= 2;
}

function hasOnlyMetaGoogleVendors(intent: QueryIntent): boolean {
  return intent.vendors.every(vendor => vendor === 'META' || vendor === 'GOOGLE');
}

function hasExplicitLeadCollectionSignal(normalized: string): boolean {
  return /리드|잠재\s*고객|lead|리드\s*양식|lead\s*form|instant\s*form|인스턴트\s*(폼|양식)|crm|mql|sql|cpl|오프라인\s*전환|offline\s*conversion|webhook|전화\s*리드|메시지\s*리드|qualified\s*lead/.test(normalized);
}

function isCommerceProductFeedQuestion(message: string, intent?: QueryIntent): boolean {
  const normalized = normalizeProductIntentText(message);
  const hasCommerceSignal = /쇼핑몰|커머스|commerce|e-?commerce|쇼핑\s*광고|쇼핑검색|쇼핑\s*검색|상품\s*피드|product\s*feed|merchant\s*center|머천트\s*센터|상품\s*db|db\s*url|ep\b|sku|카탈로그|catalog|재고|품절|가격\s*동기화|상품\s*데이터|product\s*data/.test(normalized);
  if (!hasCommerceSignal) return false;
  const hasOperatingAxis = /소재|전환\s*추적|추적|재고|피드|데이터|카탈로그|비교|기준|운영|관리|상품\s*광고|쇼핑검색|google\s*쇼핑|메타\s*카탈로그|네이버\s*쇼핑|카카오\s*상품/.test(normalized);
  return hasOperatingAxis || Boolean(intent?.topics.includes('product_structure'));
}

function isAcquisitionRetargetingBudgetQuestion(message: string, intent?: QueryIntent): boolean {
  const normalized = normalizeProductIntentText(message);
  const asksAcquisition = /신규\s*고객|고객\s*확보|신규\s*확보|획득|acquisition|prospecting|상단\s*퍼널/.test(normalized);
  const asksRetargeting = /리타겟|리마케팅|retarget|remarket|재방문|재구매|장바구니|하단\s*퍼널/.test(normalized);
  const asksBudgetKpi = /예산\s*배분|예산|budget|장단점|kpi|측정\s*kpi|성과\s*지표|비교/.test(normalized);
  return asksBudgetKpi && (asksAcquisition || asksRetargeting || Boolean(intent?.vendors.length && intent.vendors.length >= 3));
}

function isPerformanceDropTroubleshootingQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  const dropSignal = /성과.{0,20}(떨어|하락|저하|급락|악화)|갑자기.{0,20}(떨어|하락|저하)|performance.{0,20}(drop|decline)/.test(normalized);
  const troubleshootingSignal = /점검|체크리스트|순서|원인|진단|troubleshoot|debug/.test(normalized);
  const axisCount = [
    /예산|budget/.test(normalized),
    /입찰|bid|bidding/.test(normalized),
    /타겟|오디언스|audience|target/.test(normalized),
    /소재|creative|asset/.test(normalized),
    /전환\s*태그|태그|픽셀|pixel|capi|google\s*tag|ga|sdk|mmp/.test(normalized),
    /정책|제한|심사|반려|policy|limited/.test(normalized),
  ].filter(Boolean).length;
  return (dropSignal || troubleshootingSignal) && axisCount >= 3;
}

function isPolicyReviewCheckQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  const hasPolicyOrReviewRisk = /정책|심사|검수|검토|승인|반려|위반|제한|금지|허위|과장|오인|기만|불일치|랜딩\s*페이지|랜딩|등록\s*기준|광고\s*등록\s*기준/.test(normalized);
  const asksForReviewAction = /점검|체크|체크리스트|주의|유의|기준|판단|확인|순서|리스크|문제|해야\s*하|알려|정리/.test(normalized);
  const asksForProductAssetGuide = /상품\s*별\s*(소재\s*)?(제작\s*)?가이드|상품별\s*(소재\s*)?(제작\s*)?가이드|소재\s*(제작\s*)?가이드|제작\s*가이드|광고\s*상품\s*소재|상품\s*소재|소재\s*규격|소재\s*사양|creative\s*(guide|spec)|asset\s*(guide|spec)/.test(normalized)
    && /광고\s*상품|광고상품|상품\s*(유형|종류|가이드|별)|상품별|product|캠페인\s*유형|종류|광고\s*(유형|종류)/.test(normalized);

  return hasPolicyOrReviewRisk && asksForReviewAction && !asksForProductAssetGuide;
}

function isPolicyOrRegulatedDomainQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  const hasRegulatedDomain = /병원|의료|의료법|의원|치과|한의원|성형|피부과|시술|진료|환자/.test(normalized);
  const hasPolicyOrReviewRisk = /정책|심사|검수|검토|승인|반려|위반|제한|금지|허위|과장|오인|기만|불일치|랜딩\s*페이지|랜딩|등록\s*기준|광고\s*등록\s*기준|전후\s*사진|전후사진/.test(normalized);
  const asksForReviewAction = /점검|체크|체크리스트|주의|유의|기준|판단|확인|순서|리스크|문제|해야\s*하|알려|정리|비교/.test(normalized);
  const asksForProductAssetGuide = /상품\s*별\s*(소재\s*)?(제작\s*)?가이드|상품별\s*(소재\s*)?(제작\s*)?가이드|소재\s*(제작\s*)?가이드|제작\s*가이드|광고\s*상품\s*소재|상품\s*소재|소재\s*규격|소재\s*사양|creative\s*(guide|spec)|asset\s*(guide|spec)/.test(normalized)
    && /광고\s*상품|광고상품|상품\s*(유형|종류|가이드|별)|상품별|product|캠페인\s*유형|종류|광고\s*(유형|종류)/.test(normalized);

  return (hasRegulatedDomain || hasPolicyOrReviewRisk) && asksForReviewAction && !asksForProductAssetGuide;
}

function isBroadReviewTroubleshootingQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  const hasReviewOutcome = /반려|비승인|승인|심사|검수|검토|등록\s*기준|광고\s*등록\s*기준/.test(normalized);
  const asksTroubleshooting = /점검|체크|체크리스트|순서|원인|진단|무엇부터|어떤\s*순서|확인/.test(normalized);
  const axisCount = [
    /소재|문안|이미지|동영상|creative|asset/.test(normalized),
    /랜딩|url|페이지|목적지|destination/.test(normalized),
    /업종|제한|금지|정책|심사/.test(normalized),
    /가격|혜택|할인|쿠폰|이벤트/.test(normalized),
    /계정|비즈니스|사업자|인증|설정/.test(normalized),
  ].filter(Boolean).length;

  return hasReviewOutcome && asksTroubleshooting && axisCount >= 2;
}

function isAssetGuideProductQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  const hasAssetGuideSignal = /상품\s*별\s*(소재\s*)?(제작\s*)?가이드|상품별\s*(소재\s*)?(제작\s*)?가이드|소재\s*(제작\s*)?가이드|제작\s*가이드|광고\s*상품\s*소재|상품\s*소재|소재\s*규격|소재\s*사양|creative\s*(guide|spec)|asset\s*(guide|spec)/.test(normalized);
  const hasProductScopeSignal = /광고\s*상품|광고상품|상품\s*(유형|종류|가이드|별)|상품별|product|캠페인\s*유형|종류|광고\s*(유형|종류)/.test(normalized);
  return hasAssetGuideSignal && hasProductScopeSignal;
}

function isMetaGoogleLeadComparisonQuestion(message: string, intent: QueryIntent): boolean {
  const normalized = normalizeProductIntentText(message);
  if (isLeadKpiFrameworkQuestion(message)) return false;
  if (!hasOnlyMetaGoogleVendors(intent)) return false;
  if (isCommerceProductFeedQuestion(message, intent)) return false;
  const asksMeta = intent.vendors.includes('META') || /meta|메타|facebook|페이스북|instagram|인스타그램/.test(normalized);
  const asksGoogle = intent.vendors.includes('GOOGLE') || /google|구글|youtube|유튜브|google\s*ads/.test(normalized);
  if (!asksMeta || !asksGoogle) return false;
  if (!hasExplicitLeadCollectionSignal(normalized)) return false;

  const comparisonSignal = intent.isComparative || /비교|차이|대조|vs|versus|와\s+google|과\s+google|meta와|meta\s*and\s*google/.test(normalized);
  const axisCount = [
    /캠페인\s*(목표|목적)|objective|목표/.test(normalized),
    /광고\s*형식|소재\s*형식|형식|format/.test(normalized),
    /게재\s*위치|노출\s*위치|placement|지면/.test(normalized),
    /리드\s*양식|인스턴트\s*양식|lead\s*form|양식/.test(normalized),
    /전환\s*(추적|목표|입찰|최적화)|conversion|tracking/.test(normalized),
    /실무|체크포인트|운영/.test(normalized),
  ].filter(Boolean).length;

  return comparisonSignal && axisCount >= 2;
}

type LeadOperatingAnswerFamily =
  | 'meta_lead_methods'
  | 'google_lead_methods'
  | 'cross_vendor_lead_operations'
  | 'cross_vendor_lead_kpi_framework';

function questionMentionsMeta(message: string, intent: QueryIntent): boolean {
  const normalized = normalizeProductIntentText(message);
  return intent.vendors.includes('META') || /meta|메타|facebook|페이스북|instagram|인스타그램/.test(normalized);
}

function questionMentionsGoogle(message: string, intent: QueryIntent): boolean {
  const normalized = normalizeProductIntentText(message);
  return intent.vendors.includes('GOOGLE') || /google|구글|youtube|유튜브|google\s*ads|구글\s*광고/.test(normalized);
}

function isLeadOperatingQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  return hasExplicitLeadCollectionSignal(normalized)
    || /계약률|유효\s*리드|웹사이트\s*전환/.test(normalized);
}

function isLeadKpiFrameworkQuestion(message: string): boolean {
  const normalized = normalizeProductIntentText(message);
  const hasKpiTerm = /kpi|cpl|유효\s*리드|mql|sql|계약률|계약\s*전환|상담\s*연결|품질\s*관리|최적화|운영\s*프레임워크|성과\s*보고|리드\s*(수량|건수|개수)|리드\s*수(?!집)/.test(normalized);
  return hasKpiTerm && /리드|lead|잠재\s*고객/.test(normalized);
}

function detectLeadOperatingAnswerFamily(message: string, intent: QueryIntent): LeadOperatingAnswerFamily | null {
  if (!isLeadOperatingQuestion(message)) return null;
  if (isBroadMetaProductPlanningQuestion(message, intent)) return null;
  if (isCommerceProductFeedQuestion(message, intent)) return null;

  const normalized = normalizeProductIntentText(message);
  const asksMeta = questionMentionsMeta(message, intent);
  const asksGoogle = questionMentionsGoogle(message, intent);

  if (asksMeta && asksGoogle) {
    if (!hasOnlyMetaGoogleVendors(intent)) return null;
    if (isLeadKpiFrameworkQuestion(message)) return 'cross_vendor_lead_kpi_framework';
    return 'cross_vendor_lead_operations';
  }

  if (asksMeta) {
    const asksLeadMethod = /instant\s*form|인스턴트\s*(폼|양식)|웹사이트\s*전환|website\s*conversion|메시지|messag|전화|phone|crm|품질|추적|pixel|픽셀|capi|conversions?\s*api|리드\s*(캠페인|양식|광고|품질|수집|관리)/.test(normalized);
    return asksLeadMethod ? 'meta_lead_methods' : null;
  }

  if (asksGoogle) {
    const asksLeadMethod = /검색\s*리드|리드\s*양식|lead\s*form|웹사이트\s*전환|website\s*conversion|pmax|실적\s*최대화|동영상|디스플레이|오프라인\s*전환|향상된\s*전환|webhook|api|qa|체크리스트|crm|품질|추적|전환\s*(목표|액션|가져오기)/.test(normalized);
    return asksLeadMethod ? 'google_lead_methods' : null;
  }

  return null;
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

  if (isBroadMetaProductPlanningQuestion(message)) return true;

  if (hasNamedSpecificProductQuestion(message) && !asksWholeCatalog) {
    return false;
  }

  if (
    isProductSelectionQuestion(message)
    && /광고\s*상품|광고상품|상품\s*(종류|유형|목록|구조|군)|유형별|상품별/.test(normalized)
  ) {
    return true;
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

function getStrictExplicitVendorMention(message: string): VendorIntent | null {
  const normalized = normalizeProductIntentText(message);
  const matches: VendorIntent[] = [];

  if (/meta|메타|facebook|페이스북|instagram|인스타그램/.test(normalized)) matches.push('META');
  if (/google|구글|youtube|유튜브|google\s*ads|구글\s*애즈|pmax|performance\s*max/.test(normalized)) matches.push('GOOGLE');
  if (/naver|네이버/.test(normalized)) matches.push('NAVER');
  if (/kakao|카카오|카카오톡|톡채널|비즈보드|카카오모먼트/.test(normalized)) matches.push('KAKAO');

  return matches.length === 1 ? matches[0] : null;
}

function getBroadProductDeterministicIntent(message: string, intent: QueryIntent): QueryIntent | null {
  const explicitVendor = getStrictExplicitVendorMention(message);
  const canScopeToExplicitVendor = Boolean(
    explicitVendor
    && (intent.vendors.includes(explicitVendor) || intent.topics.includes('product_structure')),
  );
  const scopedIntent: QueryIntent = canScopeToExplicitVendor
    ? {
      ...intent,
      vendors: [explicitVendor as VendorIntent],
      isComparative: false,
      requiresVendorCoverage: false,
      queryType: 'single-vendor',
    }
    : intent;

  if (isBroadProductStructureAnswerIntent(message, scopedIntent) || isProductCatalogOverviewQuestion(message)) {
    return scopedIntent;
  }

  return null;
}

function isBroadProductStructureAnswerIntent(message: string, intent: QueryIntent): boolean {
  if (!intent.topics.includes('product_structure')) return false;
  if (isBroadMetaProductPlanningQuestion(message, intent)) return true;
  if (intent.vendors.length !== 1 || intent.isComparative) return false;
  const explicitCatalogOverview = isProductCatalogOverviewQuestion(message);
  if (explicitCatalogOverview) return true;
  if (intent.isSpecificProductGuidance && !isExplicitWholeProductCatalogQuestion(message)) return false;
  if (hasNamedSpecificProductQuestion(message) && !isExplicitWholeProductCatalogQuestion(message)) return false;

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
        && !sourceHasBlockingExtractionNoise(source)
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
    'Meta 광고 상품은 상품명 목록으로만 보면 부족합니다. 실무에서는 캠페인 구조, 목표, 형식/게재 위치, 운영 모듈, 측정을 같이 묶어 설계합니다.',
    '',
    '1. **캠페인 구조와 목표 잡기**',
    '',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /캠페인[\s\S]{0,80}광고\s*세트|광고\s*세트[\s\S]{0,80}광고\s*단위|campaign[\s\S]{0,80}ad\s*set|ad\s*level/i,
    label => `- Meta 광고 관리자는 캠페인, 광고 세트, 광고 단위로 나뉘며 목표는 캠페인 단계에서 정하고 예산·일정·타겟·게재 위치는 광고 세트에서 조정합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /인지도[\s\S]{0,160}트래픽[\s\S]{0,160}참여[\s\S]{0,160}잠재\s*고객[\s\S]{0,160}앱\s*홍보[\s\S]{0,160}판매|캠페인\s*목표|광고\s*관리자\s*목표|campaign[_\s-]*objective|objective/i,
    label => `- 캠페인 목표는 인지도, 트래픽, 참여, 잠재 고객, 앱 홍보, 판매처럼 원하는 결과를 기준으로 고릅니다 ${label}.`,
  );

  const formatLines: string[] = [];
  addFallbackLine(
    formatLines,
    used,
    sources,
    'META',
    /이미지[\s\S]{0,120}동영상[\s\S]{0,120}(카루셀|캐러셀|슬라이드|컬렉션|인스턴트)|카루셀|carousel|collection|컬렉션|인스턴트\s*경험|광고\s*형식|ad\s*format/i,
    label => `- 광고 형식은 이미지, 동영상, 카루셀, 컬렉션, 인스턴트 경험처럼 목표와 지면에 따라 사용할 수 있는 선택지가 달라집니다 ${label}.`,
  );
  addFallbackLine(
    formatLines,
    used,
    sources,
    'META',
    /facebook|instagram|messenger|audience\s*network|페이스북|인스타그램|게재\s*위치|노출\s*위치|placement/i,
    label => `- Facebook, Instagram 등 게재 위치별로 지원 형식과 권장 사양이 달라지므로 목표와 함께 확인해야 합니다 ${label}.`,
  );
  if (formatLines.length > 0) {
    sections.push('', '2. **형식과 게재 위치 확인하기**', '', ...formatLines);
  }

  const operationLines: string[] = [];
  addFallbackLine(
    operationLines,
    used,
    sources,
    'META',
    /리드\s*양식|잠재\s*고객|lead\s*form|lead\s*generation|인스턴트\s*양식|메시지|전화/i,
    label => `- 상담 신청이나 연락처 수집이 목표라면 리드 목적과 인스턴트 양식, 메시지, 전화 같은 전환 위치를 먼저 봅니다 ${label}.`,
  );
  addFallbackLine(
    operationLines,
    used,
    sources,
    'META',
    /앱\s*(홍보|설치|인스톨|캠페인|이벤트)|app\s*(promotion|install|event)|앱\s*광고/i,
    label => `- 앱 설치나 앱 내 행동을 늘리는 목적이면 앱 홍보 목표와 앱 이벤트 측정 조건을 함께 확인합니다 ${label}.`,
  );
  addFallbackLine(
    operationLines,
    used,
    sources,
    'META',
    /카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지|웹사이트\s*전환|conversions?\s*api|meta\s*pixel|메타\s*픽셀/i,
    label => `- 판매·커머스 운영은 카탈로그, 컬렉션, Advantage+ 카탈로그, 픽셀/CAPI 같은 전환 측정을 묶어서 검토합니다 ${label}.`,
  );
  if (operationLines.length > 0) {
    sections.push('', `${formatLines.length > 0 ? '3' : '2'}. **운영 모듈과 측정 붙이기**`, '', ...operationLines);
  }

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, 목표를 먼저 고르고 그 목표에서 지원되는 전환 위치, 게재 위치, 소재 형식, 리드·앱·카탈로그·측정 모듈을 순서대로 붙이면 됩니다.');
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
    const structuredFallbackAnswer = buildStructuredLlmFailureFallbackAnswer(
      structuredSources,
      intent,
      isBroadProductStructureLlmIntent,
      message,
    );
    if (structuredFallbackAnswer) return structuredFallbackAnswer;

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
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  return normalizeEvidenceText([
    source.title,
    source.originalTitle,
    source.excerpt,
    source.matchText,
    metadata.title,
    metadata.source_title,
    metadata.canonical_title,
    metadata.productStructureAnchor,
    metadata.sourceKind,
    metadata.answerEvidenceRole,
    metadata.answer_evidence_role,
    Array.isArray(source.rankReason) ? source.rankReason.join(' ') : '',
    Array.isArray(source.evidenceDecisionReason) ? source.evidenceDecisionReason.join(' ') : '',
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
  return /집행|절차|세팅|설정|연동|앱\s*등록|상품\s*등록|계정|권한|승인|요청|공유|테스트|검증|제작|소재|문구|카피|사양|스펙|규격|비율|사이즈|크기|파일|해상도|길이|정책|심사|검수|검토|주의|유의|제한|금지|반려|오류|에러|문제|해결|원인|조치|sdk|mmp|추적|트래킹|이벤트|픽셀|db\s*url|상품\s*db|상품db|ep|쇼핑파트너센터|상품정보\s*수신|등록요청|상품관리|카테고리|가격비교|데이터\s*피드|feed|양식\s*제출|개인정보|고지|동의|상품\s*(소개|안내)|광고\s*(상품|유형|종류)|지면|노출|게재|위치|운영|목적|브랜딩|유입|전환|조회|시청|클릭|구매|예약|입찰|과금|보장형|홈피드|스마트채널|타임보드|롤링보드|헤드라인\s*da|배너/.test(normalizedText);
}

function sourceTextHasSpecificProductDetailSignalNearTerm(text: string, term: string): boolean {
  const normalizedText = normalizeEvidenceText(text);
  const normalizedTerm = normalizeEvidenceText(term);
  if (!normalizedText || !normalizedTerm || normalizedTerm.length < 2) return false;

  const detailPattern = /집행|절차|세팅|설정|연동|앱\s*등록|상품\s*등록|계정|권한|승인|요청|공유|테스트|검증|제작|소재|문구|카피|사양|스펙|규격|비율|사이즈|크기|파일|해상도|길이|정책|심사|검수|검토|주의|유의|제한|금지|반려|오류|에러|문제|해결|원인|조치|sdk|mmp|추적|트래킹|이벤트|픽셀|db\s*url|상품\s*db|상품db|ep|쇼핑파트너센터|상품정보\s*수신|등록요청|상품관리|카테고리|가격비교|데이터\s*피드|feed|양식\s*제출|개인정보|고지|동의|상품\s*(소개|안내)|광고\s*(상품|유형|종류)|지면|노출|게재|위치|운영|목적|브랜딩|유입|전환|조회|시청|클릭|구매|예약|입찰|과금|보장형|홈피드|스마트채널|타임보드|롤링보드|헤드라인\s*da|배너/;
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

  if (
    (intent.vendors.includes('META') || /메타|meta|페이스북|facebook|인스타그램|instagram/.test(queryText))
    && /소재|사양|스펙|규격|비율|사이즈|크기|해상도|파일|이미지|동영상|비디오|카루셀|캐러셀|carousel|슬라이드|instagram|인스타그램/.test(queryText)
  ) {
    add(
      '광고 사양',
      '광고 가이드',
      '소재 사양',
      '이미지 광고',
      '이미지 소재',
      '동영상 광고',
      '동영상 소재',
      '비디오 광고',
      '슬라이드 광고',
      '카루셀',
      '캐러셀',
      'Carousel',
      'Instagram',
      '인스타그램',
      'Facebook',
      '페이스북',
      '해상도',
      '파일 형식',
      '권장 비율',
      '1080x1080',
    );
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

  if (
    (intent.vendors.includes('META') || /메타|meta|페이스북|facebook|인스타그램|instagram/.test(queryText))
    && /소재|사양|스펙|규격|비율|사이즈|크기|해상도|파일|이미지|동영상|비디오|카루셀|캐러셀|carousel|슬라이드|instagram|인스타그램/.test(queryText)
  ) {
    matchers.push(/광고\s*사양|광고\s*가이드|소재\s*사양|이미지\s*(광고|소재)|동영상\s*(광고|소재)|비디오\s*광고|슬라이드\s*광고|카루셀|캐러셀|carousel|instagram|인스타그램|facebook|페이스북|해상도|파일\s*형식|권장\s*비율|1080x1080/);
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

  const genericLegalOrAccountSignal = /이용약관|약관|운영\s*정책|서비스\s*이용|회원\s*가입|회원가입|계정\s*(생성|만들기|관리)|책임자|세금\s*계산서|세금계산서|청구|결제|지불|billing|payment|invoice|권한\s*관리|비즈니스\s*계정|클린센터|개인정보\s*처리방침/.test(identityText);
  const productSpecificGuideSignal = /상품\s*가이드|상품가이드|상품\s*소개|상품소개|제작\s*가이드|제작가이드|광고\s*상품|광고상품|캠페인\s*(목표|유형|목적)|광고\s*관리자|마케팅\s*목표|게재\s*위치|노출\s*위치|광고\s*형식|전환\s*위치|advertising\s*standards?|ad\s*standards?|사이트검색광고|쇼핑검색광고|쇼핑블록|비즈보드|카탈로그|컬렉션|리드\s*양식|앱\s*(인스톨|설치|홍보)|동영상\s*광고|디스플레이\s*광고|성과형\s*디스플레이|홈피드|스마트채널|타임보드|롤링보드/.test(identityText);

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

function sourceHasRecoverableMetaAdsGuideObjectiveGraphEvidence(source: ReturnType<typeof buildVerifiedSources>[number]) {
  if (!sourceMatchesVendor(source, 'META')) return false;
  if (!isOfficialGuideGraphSource(source)) return false;
  if (sourceLooksLikeMetaBroadProductNewsNoise(source)) return false;

  const identityText = normalizeEvidenceText(getSourceIdentityText(source));
  const text = normalizeEvidenceText([
    identityText,
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
  ].join(' '));
  const isMetaAdsGuideSource = /facebook\.com\/business\/ads-guide|\/business\/ads-guide|ads\s*guide/.test(identityText);
  const hasObjectiveGraphSignal = /campaign[_\s-]*objective|캠페인\s*(목표|목적|유형)|광고\s*관리자\s*목표|인지도[\s\S]{0,140}트래픽[\s\S]{0,140}참여[\s\S]{0,140}잠재\s*고객[\s\S]{0,140}앱\s*홍보[\s\S]{0,140}판매/.test(text);

  return isMetaAdsGuideSource && hasObjectiveGraphSignal;
}

function sourceHasRecoverableMetaAdsGuideCreativeSpecEvidence(source: ReturnType<typeof buildVerifiedSources>[number]) {
  if (!sourceMatchesVendor(source, 'META')) return false;
  if (sourceLooksLikeMetaBroadProductNewsNoise(source)) return false;

  const identityText = normalizeEvidenceText(getSourceIdentityText(source));
  const text = normalizeEvidenceText([
    identityText,
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
  ].join(' '));
  const isMetaAdsGuideSource = /facebook\.com\/business\/ads-guide|\/business\/ads-guide|ads\s*guide|facebook\s*광고\s*가이드|meta\s*ads\s*guide/.test(text);
  const hasCreativeSpecSignal = /광고\s*사양|슬라이드\s*광고\s*사양|이미지\s*광고\s*사양|동영상\s*광고\s*사양|디자인\s*추천\s*사항|기술\s*요구\s*사항|해상도\s*:\s*1080|1080x1080|1080\s*x\s*1080|1080픽셀|슬라이드\s*수|2\s*~\s*10|2~10|최대\s*(이미지|동영상|파일)|파일\s*(크기|형식)|지원\s*형식/.test(text);

  return isMetaAdsGuideSource && hasCreativeSpecSignal;
}

function sourceHasBlockingExtractionNoise(source: ReturnType<typeof buildVerifiedSources>[number]) {
  return sourceHasExtractionNoise(source)
    && !sourceHasRecoverableMetaAdsGuideObjectiveGraphEvidence(source)
    && !sourceHasRecoverableMetaAdsGuideCreativeSpecEvidence(source);
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

  if (sourceHasBlockingExtractionNoise(source)) return true;
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

  const broadLegalOrAccountDoc = /이용\s*약관|이용약관|약관|운영\s*정책|운영정책|서비스\s*이용|회원\s*가입|회원가입|계정\s*(생성|만들기|관리)|책임자|세금\s*계산서|세금계산서|청구|결제|지불|billing|payment|invoice|권한\s*관리|비즈니스\s*계정|클린센터|개인정보\s*처리방침|광고\s*게재\s*제한/.test(text);
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
  if (mode === 'creative_guide' && sourceHasRecoverableMetaAdsGuideCreativeSpecEvidence(source)) score += 42;

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
  if (mode === 'creative_guide' && /1080x|1080\s*x|1080픽셀|해상도|슬라이드\s*수|2\s*~\s*10|2~10|최대\s*(이미지|동영상|파일)|파일\s*(크기|형식)|지원\s*형식/.test(normalizedText)) {
    score += 30;
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
  const indexByKey = new Map<string, number>();
  const deduped: ReturnType<typeof buildVerifiedSources> = [];

  for (const source of sources) {
    const publicKey = getProductStructurePublicSourceKey(source);
    const key = publicKey || getProductStructureSourceKey(source);
    if (seen.has(key)) {
      const existingIndex = indexByKey.get(key);
      if (
        existingIndex !== undefined
        && shouldPreferProductStructureDedupeSource(source, deduped[existingIndex])
      ) {
        deduped[existingIndex] = source;
      }
      continue;
    }
    if (deduped.length >= limit) continue;
    seen.add(key);
    indexByKey.set(key, deduped.length);
    deduped.push(source);
  }

  return deduped;
}

function shouldPreferProductStructureDedupeSource(
  next: ReturnType<typeof buildVerifiedSources>[number],
  existing: ReturnType<typeof buildVerifiedSources>[number],
) {
  const priority = (source: ReturnType<typeof buildVerifiedSources>[number]) => {
    if (isOfficialGuideGraphSource(source)) return 3;
    if (isGraphVerifiedSource(source)) return 2;
    return 1;
  };
  const nextPriority = priority(next);
  const existingPriority = priority(existing);
  if (nextPriority !== existingPriority) return nextPriority > existingPriority;

  const nextScore = Number(next.hybridScore || next.score || next.similarity || 0);
  const existingScore = Number(existing.hybridScore || existing.score || existing.similarity || 0);
  return nextScore > existingScore;
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
    || buildMetaCreativeSpecStructuredFallbackAnswer(sources, intent, message)
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

type FastKakaoProductAnswerFallback =
  | 'kakao_specific_product_source_guided'
  | 'kakao_product_structured'
  | 'kakao_product_scope_rescue';

type FastPolicySourceGuidedAnswerFamily =
  | 'price_discount'
  | 'user_deception'
  | 'event_material'
  | 'medical_hospital_landing_review'
  | 'kakao_restricted_industry'
  | 'kakao_service_protection'
  | 'youth_harmful'
  | 'hate_discrimination'
  | 'adult_content'
  | 'rights_infringement'
  | 'review_standards'
  | 'vendor_policy_general';

type FastPolicySourceGuidedAnswerFallback =
  | 'policy_source_guided_price_discount'
  | 'policy_source_guided_user_deception'
  | 'policy_source_guided_event_material'
  | 'policy_source_guided_medical_hospital_landing_review'
  | 'policy_source_guided_kakao_restricted_industry'
  | 'policy_source_guided_kakao_service_protection'
  | 'policy_source_guided_youth_harmful'
  | 'policy_source_guided_hate_discrimination'
  | 'policy_source_guided_adult_content'
  | 'policy_source_guided_rights_infringement'
  | 'policy_source_guided_review_standards'
  | 'policy_source_guided_vendor_policy_general';

type FastNaverVideoProductAnswerFallback = 'naver_video_product_structured';

type FastStructuredSpecificProductAnswerFallback =
  | 'meta_app_install_structured'
  | 'meta_catalog_structured'
  | 'meta_creative_spec_structured'
  | 'naver_shopping_search_creative_structured'
  | 'naver_shopping_data_operational'
  | 'naver_shopping_data_structured'
  | 'naver_display_ad_structured'
  | 'google_lead_structured';

type ProductAnswerFamily =
  | 'meta_overview'
  | 'meta_app_install'
  | 'meta_lead'
  | 'meta_catalog'
  | 'meta_creative_spec'
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
    if (isBroadMetaProductPlanningQuestion(message, intent)) return 'meta_overview';
    if (/앱\s*(인스톨|설치|홍보|캠페인|사전\s*등록)|app\s*(install|promotion)/.test(normalized)) return 'meta_app_install';
    if (/리드\s*양식|잠재\s*고객|잠재고객|lead\s*(form|ads?|generation)|비즈니스\s*폼|비즈니스폼/.test(normalized)) return 'meta_lead';
    if (/카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지/.test(normalized)) return 'meta_catalog';
    if (/소재|사양|스펙|규격|비율|사이즈|크기|해상도|파일|이미지|동영상|비디오|카루셀|캐러셀|carousel|슬라이드|instagram|인스타그램/.test(normalized)) return 'meta_creative_spec';
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
  const citedSourceIndexes = Array.from(usedSourceIndexes).sort((a, b) => a - b);
  const citedSourceLabels = new Map(citedSourceIndexes.map((sourceIndex, citationIndex) => [
    sourceIndex + 1,
    citationIndex + 1,
  ]));
  const answer = lines.join('\n').replace(/\[S(\d+)\]/g, (label, sourceNumber) => {
    const remappedLabel = citedSourceLabels.get(Number(sourceNumber));
    return remappedLabel ? `[S${remappedLabel}]` : label;
  });

  return {
    answer: polishCompassAnswerStyle(answer),
    sources: citedSourceIndexes.map(index => sources[index]),
    model: profile.model,
    showContactOption: profile.showContactOption,
    confidenceCap: profile.confidenceCap,
    reviewStatus: profile.reviewStatus,
  };
}

const META_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS = [
  'meta_business_help_ad_levels_2026_chunk_0',
  'meta_business_help_objectives_2026_chunk_0',
  'meta_business_help_formats_placements_2026_chunk_0',
  'meta_business_help_operating_modules_2026_chunk_0',
  'doc_1773886203371_8rlmmdv_chunk_1',
  'doc_1773886203371_8rlmmdv_chunk_2',
] as const;

const META_GOOGLE_LEAD_COMPARISON_REQUIRED_CHUNK_IDS = [
  'meta_business_help_ad_levels_2026_chunk_0',
  'meta_business_help_objectives_2026_chunk_0',
  'meta_business_help_formats_placements_2026_chunk_0',
  'meta_business_help_operating_modules_2026_chunk_0',
  'meta_business_help_lead_ads_instant_forms_2026_chunk_0',
  'meta_business_help_lead_data_crm_2026_chunk_0',
  'meta_business_help_pixel_capi_leads_2026_chunk_0',
  'meta_business_help_capi_crm_quality_leads_2026_chunk_0',
  'google_ads_campaign_objectives_2026_chunk_0',
  'google_ads_campaign_types_2026_chunk_0',
  'doc_1773662526796_7rijhfq_chunk_1',
  'doc_1773662526796_7rijhfq_chunk_2',
  'doc_1773662526796_7rijhfq_chunk_3',
  'google_ads_conversion_goals_leads_2026_chunk_0',
  'google_ads_web_conversion_measurement_2026_chunk_0',
  'google_ads_offline_enhanced_conversions_leads_2026_chunk_0',
  'google_ads_lead_form_export_crm_api_2026_chunk_0',
] as const;

const META_LEAD_OPERATING_REQUIRED_CHUNK_IDS = [
  'meta_business_help_ad_levels_2026_chunk_0',
  'meta_business_help_objectives_2026_chunk_0',
  'meta_business_help_formats_placements_2026_chunk_0',
  'meta_business_help_operating_modules_2026_chunk_0',
  'meta_business_help_lead_ads_instant_forms_2026_chunk_0',
  'meta_business_help_lead_data_crm_2026_chunk_0',
  'meta_business_help_pixel_capi_leads_2026_chunk_0',
  'meta_business_help_capi_crm_quality_leads_2026_chunk_0',
] as const;

const GOOGLE_LEAD_OPERATING_REQUIRED_CHUNK_IDS = [
  'google_ads_campaign_objectives_2026_chunk_0',
  'google_ads_campaign_types_2026_chunk_0',
  'doc_1773662526796_7rijhfq_chunk_1',
  'doc_1773662526796_7rijhfq_chunk_2',
  'doc_1773662526796_7rijhfq_chunk_3',
  'google_ads_conversion_goals_leads_2026_chunk_0',
  'google_ads_web_conversion_measurement_2026_chunk_0',
  'google_ads_offline_enhanced_conversions_leads_2026_chunk_0',
  'google_ads_lead_form_export_crm_api_2026_chunk_0',
] as const;

const GOOGLE_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS = [
  'google_ads_campaign_objectives_2026_chunk_0',
  'google_ads_campaign_types_2026_chunk_0',
  'doc_1773662526796_7rijhfq_chunk_1',
  'google_ads_conversion_goals_leads_2026_chunk_0',
  'google_ads_web_conversion_measurement_2026_chunk_0',
  'google_ads_offline_enhanced_conversions_leads_2026_chunk_0',
  'google_ads_shopping_ads_2026_chunk_0',
  'google_ads_app_campaigns_2026_chunk_0',
] as const;

const NAVER_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS = [
  'naver_searchad_overview_powerlink_brand_2026_chunk_0',
  'naver_powerlink_product_overview_2026_chunk_0',
  'naver_brandsearch_product_overview_2026_chunk_0',
  'doc_1764895552052_8xy5ad6_para_2',
  'doc_1773710116296_uawf5xm_chunk_2',
  'doc_1764922396107_b9w41zn_chunk_5',
  'naver_display_product_catalog_2026_chunk_0',
  'naver_chzzk_product_catalog_2026_chunk_0',
  'doc_1764895606547_buwpoz4_sent_11',
  'doc_1764895606613_llkwwsf_doc_0',
  'naver_adguide_registration_standard_2026_chunk_0',
  'naver_adguide_operating_policy_2026_chunk_0',
] as const;

const KAKAO_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS = [
  'kakao_moment_product_overview_2026_chunk_0',
  'doc_1774488483929_bigcm1d_chunk_2',
  'doc_1774488184369_r97sach_chunk_0',
  'kakao_product_catalog_2026_chunk_0',
  'kakao_guaranteed_cpt_2026_chunk_0',
  'kakao_searchad_product_catalog_2026_chunk_0',
  'kakao_brandsearch_content_guide_2026_chunk_0',
  'kakao_channelsearch_content_guide_2026_chunk_0',
  'url_1773203880202_q3y8fucqb_chunk_5',
  'doc_1774491147517_yj1v810_chunk_17',
  'doc_1774488207473_cjq6ve0_chunk_19',
] as const;

const CROSS_VENDOR_PRODUCT_OPERATING_REQUIRED_CHUNK_IDS = [
  ...META_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS,
  ...GOOGLE_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS,
  ...NAVER_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS,
  ...KAKAO_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS,
] as const;

function buildOfficialProductOverviewSnapshotSearchResult(
  row: ReturnType<typeof getCompassOfficialDocumentChunkSnapshotRows>[number],
): SearchResult {
  const sourceVendor = String(row.metadata?.source_vendor || row.metadata?.sourceVendor || 'META') as VendorIntent;
  const isMetaProductOverviewChunk = sourceVendor === 'META';
  const isGoogleProductOverviewChunk = sourceVendor === 'GOOGLE' && String(row.id || '').startsWith('google_ads_');
  const isGoogleLeadFormOfficialChunk = sourceVendor === 'GOOGLE' && String(row.id || '').startsWith('doc_1773662526796_7rijhfq');
  const evidenceRole = isGoogleLeadFormOfficialChunk
    ? 'official_google_lead_form'
    : 'official_product_overview';
  const metadata: Record<string, unknown> = {
    ...row.metadata,
    officialProductOverviewSnapshot: true,
    metaProductOverviewOfficialChunk: isMetaProductOverviewChunk,
    googleProductOverviewOfficialChunk: isGoogleProductOverviewChunk,
    googleLeadFormOfficialChunk: isGoogleLeadFormOfficialChunk,
    answerEvidenceRole: evidenceRole,
    answer_evidence_role: evidenceRole,
    sourceKind: 'official_doc',
    source_kind: 'official_doc',
    sourceVendor,
    source_vendor: sourceVendor,
    sourceVendors: [sourceVendor],
    source_vendors: [sourceVendor],
    retrievalMethod: 'keyword',
    evidenceType: 'official_product_overview',
    evidenceDecision: 'verified',
    corpus: 'document_chunks',
  };
  const documentTitle = String(metadata['source_title'] || metadata['canonical_title'] || metadata['source'] || `${VENDOR_LABELS[sourceVendor] || sourceVendor} 광고 상품/구조`);
  const documentUrl = String(metadata['source_url'] || metadata['document_url'] || metadata['url'] || '');

  return {
    chunk_id: row.id,
    content: row.content,
    similarity: 1,
    score: 1,
    hybridScore: 1,
    vectorScore: 1,
    keywordScore: 1,
    corpus: 'document_chunks',
    evidenceType: 'official_product_overview',
    evidenceDecision: 'verified',
    evidenceDecisionReason: [
      isGoogleLeadFormOfficialChunk
        ? 'meta_google_lead_comparison_google_lead_form_required_official_snapshot'
        : 'product_answer_required_official_snapshot',
    ],
    rankReason: [
      isGoogleLeadFormOfficialChunk
        ? 'meta_google_lead_comparison_google_lead_form_required_official_snapshot'
        : 'product_answer_required_official_snapshot',
    ],
    lexicalOverlap: 1,
    vendorMatch: true,
    vendorMismatch: false,
    sourceVendor,
    sourceVendors: [sourceVendor],
    topicMatch: true,
    retrievalMethod: 'keyword',
    documentId: row.document_id,
    documentTitle,
    documentUrl,
    sourceQuality: {
      hasDocumentId: true,
      hasTitle: Boolean(documentTitle),
      hasUrl: Boolean(documentUrl),
      hasExcerpt: Boolean(row.content),
      isFallback: false,
      warnings: [],
      linkedToDocument: true,
      qualityScore: 0.98,
      corpus: 'document_chunks',
      lexicalOverlap: 1,
      vendorMatch: true,
      vendorMismatch: false,
      sourceVendor,
    },
    metadata,
  };
}

function sourceHasExactOfficialSnapshotChunk(
  source: ReturnType<typeof buildVerifiedSources>[number],
  chunkId: string,
) {
  const metadata = (source as any).metadata || {};
  const normalizedChunkId = normalizeEvidenceText(chunkId);
  return [
    source.id,
    source.chunkId,
    metadata.id,
    metadata.chunkId,
    metadata.chunk_id,
    metadata.sourceChunkId,
    metadata.source_chunk_id,
  ].filter(Boolean).some(value => normalizeEvidenceText(String(value)) === normalizedChunkId);
}

function sourceHasExactMetaProductPlanningMatrixChunk(
  source: ReturnType<typeof buildVerifiedSources>[number],
  chunkId: string,
) {
  return sourceHasExactOfficialSnapshotChunk(source, chunkId);
}

function uniqueOfficialChunkIds(chunkIds: readonly string[]): string[] {
  return Array.from(new Set(chunkIds));
}

function getLeadOperatingRequiredChunkIds(message: string, intent: QueryIntent): string[] {
  const family = detectLeadOperatingAnswerFamily(message, intent);
  if (!family) return [];

  if (family === 'meta_lead_methods') return uniqueOfficialChunkIds(META_LEAD_OPERATING_REQUIRED_CHUNK_IDS);
  if (family === 'google_lead_methods') return uniqueOfficialChunkIds(GOOGLE_LEAD_OPERATING_REQUIRED_CHUNK_IDS);

  return uniqueOfficialChunkIds([
    ...META_LEAD_OPERATING_REQUIRED_CHUNK_IDS,
    ...GOOGLE_LEAD_OPERATING_REQUIRED_CHUNK_IDS,
  ]);
}

function buildOfficialSnapshotSupplementalSearchResults(
  requiredChunkIds: readonly string[],
  existingResults: SearchResult[],
): SearchResult[] {
  const missingChunkIds = requiredChunkIds
    .filter(chunkId => !existingResults.some(result => searchResultHasExactOfficialSnapshotChunk(result, chunkId)));
  if (missingChunkIds.length === 0) return [];

  return getCompassOfficialDocumentChunkSnapshotRows(uniqueOfficialChunkIds(missingChunkIds))
    .map(buildOfficialProductOverviewSnapshotSearchResult);
}

function buildLeadOperatingSupplementalSearchResults(
  message: string,
  intent: QueryIntent,
  existingResults: SearchResult[],
): SearchResult[] {
  const requiredChunkIds = getLeadOperatingRequiredChunkIds(message, intent);
  if (requiredChunkIds.length === 0) return [];
  return buildOfficialSnapshotSupplementalSearchResults(requiredChunkIds, existingResults);
}

function ensureOfficialSnapshotSources(
  sources: ReturnType<typeof buildVerifiedSources>,
  requiredChunkIds: readonly string[],
): ReturnType<typeof buildVerifiedSources> {
  const missingChunkIds = requiredChunkIds
    .filter(chunkId => !sources.some(source => sourceHasExactOfficialSnapshotChunk(source, chunkId)));

  if (missingChunkIds.length === 0) return sources;

  const supplementalSources = buildVerifiedSources(
    getCompassOfficialDocumentChunkSnapshotRows(uniqueOfficialChunkIds(missingChunkIds))
      .map(buildOfficialProductOverviewSnapshotSearchResult),
  );

  if (supplementalSources.length === 0) return sources;
  return [...sources, ...supplementalSources];
}

function ensureMetaProductPlanningMatrixSources(
  sources: ReturnType<typeof buildVerifiedSources>,
): ReturnType<typeof buildVerifiedSources> {
  const missingChunkIds = META_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS
    .filter(chunkId => !sources.some(source => sourceHasExactMetaProductPlanningMatrixChunk(source, chunkId)));

  if (missingChunkIds.length === 0) return sources;

  const supplementalSources = buildVerifiedSources(
    getCompassOfficialDocumentChunkSnapshotRows([...missingChunkIds])
      .map(buildOfficialProductOverviewSnapshotSearchResult),
  );

  if (supplementalSources.length === 0) return sources;
  return [...sources, ...supplementalSources];
}

function searchResultHasExactOfficialSnapshotChunk(result: SearchResult, chunkId: string) {
  const resultLike = result as any;
  const metadata = result.metadata || {};
  const normalizedChunkId = normalizeEvidenceText(chunkId);
  return [
    result.chunk_id,
    resultLike.id,
    metadata.id,
    metadata.chunkId,
    metadata.chunk_id,
    metadata.sourceChunkId,
    metadata.source_chunk_id,
  ].filter(Boolean).some(value => normalizeEvidenceText(String(value)) === normalizedChunkId);
}

function buildMetaGoogleLeadComparisonSupplementalSearchResults(
  message: string,
  intent: QueryIntent,
  existingResults: SearchResult[],
): SearchResult[] {
  if (!isMetaGoogleLeadComparisonQuestion(message, intent)) return [];

  return buildOfficialSnapshotSupplementalSearchResults(
    META_GOOGLE_LEAD_COMPARISON_REQUIRED_CHUNK_IDS,
    existingResults,
  );
}

function ensureMetaGoogleLeadComparisonSources(
  sources: ReturnType<typeof buildVerifiedSources>,
): ReturnType<typeof buildVerifiedSources> {
  return ensureOfficialSnapshotSources(sources, META_GOOGLE_LEAD_COMPARISON_REQUIRED_CHUNK_IDS);
}

function ensureLeadOperatingSources(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
): ReturnType<typeof buildVerifiedSources> {
  const requiredChunkIds = getLeadOperatingRequiredChunkIds(message, intent);
  if (requiredChunkIds.length === 0) return sources;
  return ensureOfficialSnapshotSources(sources, requiredChunkIds);
}

function getMetaProductPlanningMatrixRequiredSourceIndexes(
  sources: ReturnType<typeof buildVerifiedSources>,
) {
  const indexes = META_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS.map(chunkId => (
    sources.findIndex(source => sourceHasExactMetaProductPlanningMatrixChunk(source, chunkId))
  ));
  if (indexes.some(index => index < 0)) return null;
  if (new Set(indexes).size !== META_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS.length) return null;

  return {
    levelsIndex: indexes[0],
    objectivesIndex: indexes[1],
    formatsIndex: indexes[2],
    modulesIndex: indexes[3],
    catalogIndex: indexes[4],
    advantageIndex: indexes[5],
  };
}

function getMetaGoogleLeadComparisonRequiredSourceIndexes(
  sources: ReturnType<typeof buildVerifiedSources>,
) {
  const indexes = META_GOOGLE_LEAD_COMPARISON_REQUIRED_CHUNK_IDS.map(chunkId => (
    sources.findIndex(source => sourceHasExactOfficialSnapshotChunk(source, chunkId))
  ));
  if (indexes.some(index => index < 0)) return null;
  if (new Set(indexes).size !== META_GOOGLE_LEAD_COMPARISON_REQUIRED_CHUNK_IDS.length) return null;

  return {
    metaLevelsIndex: indexes[0],
    metaObjectivesIndex: indexes[1],
    metaFormatsIndex: indexes[2],
    metaModulesIndex: indexes[3],
    metaLeadInstantFormIndex: indexes[4],
    metaLeadCrmIndex: indexes[5],
    metaPixelCapiIndex: indexes[6],
    metaCapiCrmQualityIndex: indexes[7],
    googleObjectivesIndex: indexes[8],
    googleTypesIndex: indexes[9],
    googleLeadAvailabilityIndex: indexes[10],
    googleLeadPolicyIndex: indexes[11],
    googleLeadConversionIndex: indexes[12],
    googleConversionGoalsIndex: indexes[13],
    googleWebConversionIndex: indexes[14],
    googleOfflineEnhancedIndex: indexes[15],
    googleLeadExportCrmApiIndex: indexes[16],
  };
}

function getGoogleProductPlanningMatrixRequiredSourceIndexes(
  sources: ReturnType<typeof buildVerifiedSources>,
) {
  const indexes = GOOGLE_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS.map(chunkId => (
    sources.findIndex(source => sourceHasExactOfficialSnapshotChunk(source, chunkId))
  ));
  if (indexes.some(index => index < 0)) return null;
  if (new Set(indexes).size !== GOOGLE_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS.length) return null;

  return {
    googleObjectivesIndex: indexes[0],
    googleTypesIndex: indexes[1],
    googleLeadAvailabilityIndex: indexes[2],
    googleConversionGoalsIndex: indexes[3],
    googleWebConversionIndex: indexes[4],
    googleOfflineEnhancedIndex: indexes[5],
    googleShoppingIndex: indexes[6],
    googleAppIndex: indexes[7],
  };
}

function finalizeOfficialSnapshotDeterministicAnswer(
  lines: string[],
  sources: ReturnType<typeof buildVerifiedSources>,
  used: Set<number>,
  model: string,
  confidenceCap = 88,
): DeterministicProductAnswer {
  const citedSourceIndexes = Array.from(used).sort((a, b) => a - b);
  const citedSourceLabels = new Map(citedSourceIndexes.map((sourceIndex, citationIndex) => [
    sourceIndex + 1,
    citationIndex + 1,
  ]));
  const answer = lines.join('\n').replace(/\[S(\d+)\]/g, (label, sourceNumber) => {
    const remappedLabel = citedSourceLabels.get(Number(sourceNumber));
    return remappedLabel ? `[S${remappedLabel}]` : label;
  });

  return {
    answer: polishCompassAnswerStyle(answer),
    sources: citedSourceIndexes.map(index => sources[index]),
    model,
    showContactOption: false,
    confidenceCap,
    reviewStatus: 'completed',
  };
}

function getRequiredOfficialSnapshotIndexes(
  sources: ReturnType<typeof buildVerifiedSources>,
  chunkIds: readonly string[],
) {
  const indexes = chunkIds.map(chunkId => (
    sources.findIndex(source => sourceHasExactOfficialSnapshotChunk(source, chunkId))
  ));
  if (indexes.some(index => index < 0)) return null;
  return indexes;
}

function buildMetaGoogleLeadComparisonAnswer(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  if (
    !isMetaGoogleLeadComparisonQuestion(message, intent)
    && detectLeadOperatingAnswerFamily(message, intent) !== 'cross_vendor_lead_operations'
  ) return null;

  const comparisonSources = ensureMetaGoogleLeadComparisonSources(sources);
  const requiredSourceIndexes = getMetaGoogleLeadComparisonRequiredSourceIndexes(comparisonSources);
  if (!requiredSourceIndexes) return null;

  const {
    metaLevelsIndex,
    metaObjectivesIndex,
    metaFormatsIndex,
    metaModulesIndex,
    metaLeadInstantFormIndex,
    metaLeadCrmIndex,
    metaPixelCapiIndex,
    metaCapiCrmQualityIndex,
    googleObjectivesIndex,
    googleTypesIndex,
    googleLeadAvailabilityIndex,
    googleLeadPolicyIndex,
    googleLeadConversionIndex,
    googleConversionGoalsIndex,
    googleWebConversionIndex,
    googleOfflineEnhancedIndex,
    googleLeadExportCrmApiIndex,
  } = requiredSourceIndexes;

  const used = new Set<number>([
    metaLevelsIndex,
    metaObjectivesIndex,
    metaFormatsIndex,
    metaModulesIndex,
    metaLeadInstantFormIndex,
    metaLeadCrmIndex,
    metaPixelCapiIndex,
    metaCapiCrmQualityIndex,
    googleObjectivesIndex,
    googleTypesIndex,
    googleLeadAvailabilityIndex,
    googleLeadPolicyIndex,
    googleLeadConversionIndex,
    googleConversionGoalsIndex,
    googleWebConversionIndex,
    googleOfflineEnhancedIndex,
    googleLeadExportCrmApiIndex,
  ]);

  const citation = (index: number) => {
    used.add(index);
    return `[S${index + 1}]`;
  };

  const metaLevelRef = citation(metaLevelsIndex);
  const metaObjectiveRef = citation(metaObjectivesIndex);
  const metaFormatRef = citation(metaFormatsIndex);
  const metaLeadRef = citation(metaModulesIndex);
  const metaLeadInstantFormRef = citation(metaLeadInstantFormIndex);
  const metaLeadCrmRef = citation(metaLeadCrmIndex);
  const metaPixelCapiRef = citation(metaPixelCapiIndex);
  const metaCapiCrmQualityRef = citation(metaCapiCrmQualityIndex);
  const googleObjectiveRef = citation(googleObjectivesIndex);
  const googleTypeRef = citation(googleTypesIndex);
  const googleLeadAvailabilityRef = citation(googleLeadAvailabilityIndex);
  const googleLeadPolicyRef = citation(googleLeadPolicyIndex);
  const googleLeadConversionRef = citation(googleLeadConversionIndex);
  const googleConversionGoalsRef = citation(googleConversionGoalsIndex);
  const googleWebConversionRef = citation(googleWebConversionIndex);
  const googleOfflineEnhancedRef = citation(googleOfflineEnhancedIndex);
  const googleLeadExportCrmApiRef = citation(googleLeadExportCrmApiIndex);

  const lines = [
    'Meta와 Google Ads 모두 리드 확보에 쓸 수 있지만, 실무 설계 기준은 다릅니다. **Meta는 잠재 고객 목표 + 전환 위치 + 인스턴트 양식/메시지/전화 + Pixel/CAPI + Conversions API for CRM/Qualified leads**를 먼저 봐야 하고, **Google Ads는 리드 목표 + 캠페인 유형 + 리드 양식 애셋 + 전환 목표/입찰 + webhook/Google Ads API + 오프라인 전환 가져오기**를 같이 맞춰야 합니다.',
    '아래의 “운영 해석”은 공식 기능 조건을 바탕으로 한 실무 판단입니다. 확정 설정 전에는 업종, 국가, 계정 자격, 개인정보처리방침, 태그/CRM 상태를 계정 화면에서 다시 대조하는 흐름이 안전합니다.',
    '',
    '**1. 핵심 비교표**',
    '',
    '| 비교 축 | Meta | Google Ads | 실무 판단 |',
    '|---|---|---|---|',
    `| 캠페인 목표 | Meta Ads Manager의 주요 목표 축에는 잠재 고객이 포함되며, 목표 선택에 따라 전환 위치와 최적화 이벤트, 사용할 수 있는 설정이 달라집니다 ${metaObjectiveRef}. | Google Ads도 판매, 리드, 웹사이트 트래픽, 브랜드 인지도와 도달범위, 앱 홍보 같은 목표를 먼저 정하고, 목표에 맞는 캠페인 유형과 기능을 조합합니다 ${googleObjectiveRef}. | 둘 다 “리드” 목표를 쓸 수 있지만, Meta는 목표 선택 뒤 전환 위치가 핵심이고, Google은 목표와 캠페인 유형/전환 목표를 같이 맞추는 쪽이 핵심입니다. |`,
    `| 계정 구조 | Meta는 캠페인, 광고 세트, 광고 단위로 나뉘며 광고 세트에서 예산, 일정, 타겟, 게재 위치를 정하고 광고 단위에서 소재와 문구를 구성합니다 ${metaLevelRef}. | Google Ads는 검색, 디스플레이, 동영상, 쇼핑, 앱, 실적 최대화처럼 캠페인 유형별로 노출 지면, 광고 형식, 입찰과 애셋 요구사항이 달라집니다 ${googleTypeRef}. | Meta는 광고 세트 단위 운영 변수가 중요하고, Google은 먼저 검색/동영상/디스플레이/PMax 중 리드 양식을 붙일 캠페인 유형을 확정해야 합니다. |`,
    `| 광고 형식 | Meta는 이미지, 동영상, 카루셀, 컬렉션, 인스턴트 경험 같은 형식을 목표와 Facebook/Instagram 게재 위치에 따라 대조해야 합니다 ${metaFormatRef}. 인스턴트 양식형 리드 광고는 양식 작성으로 리드를 생성·검증하는 구조입니다 ${metaLeadInstantFormRef}. | Google 리드 양식은 검색, 동영상, 실적 최대화, 디스플레이 캠페인에 추가할 수 있고 이메일, 전화번호, 기타 세부정보를 받을 수 있습니다 ${googleLeadAvailabilityRef}. | Meta는 소재 형식과 전환 위치 조합을 봅니다. Google은 리드 양식 애셋을 지원하는 캠페인인지와 반응형 검색 광고 등 지원 소재 조건을 먼저 확인합니다 ${googleLeadConversionRef}. |`,
    `| 게재 위치 | Meta는 목표별 게재 위치와 광고 형식을 구분해 안내하므로 Facebook, Instagram, 피드, 스토리, 릴스 등 지면별 소재 사양을 확인해야 합니다 ${metaFormatRef}. | Google은 캠페인 유형에 따라 검색, 디스플레이, 동영상, 실적 최대화 등 노출 범위와 애셋 요구사항이 달라집니다 ${googleTypeRef}; 리드 양식은 검색/동영상/PMax/디스플레이 캠페인에 붙일 수 있습니다 ${googleLeadAvailabilityRef}. | 운영 해석: Meta는 피드·스토리·릴스의 발견형 경험을 활용하고, Google은 검색 의도형 리드와 동영상/디스플레이/PMax 확장형 리드를 분리해 봅니다. |`,
    `| 리드 수집 방식 | Meta 리드 목적은 인스턴트 양식, 메시지, 전화 같은 전환 위치를 검토합니다 ${metaLeadRef}. 인스턴트 양식은 맞춤 질문과 연락처 수집으로 상담, 견적, 가입 후속 절차에 연결할 수 있습니다 ${metaLeadInstantFormRef}. | Google 리드 양식은 연락처 정보를 제출받는 애셋이며, 계정에는 양호한 정책 준수 내역이 필요합니다 ${googleLeadAvailabilityRef}. | Meta는 양식/메시지/전화 중 어디서 리드를 받을지 먼저 정하고, Google은 리드 양식 애셋과 웹사이트 리드 완료 전환을 함께 설계합니다. |`,
    `| 전환 추적·최적화 | Meta는 리드 전환 위치 외에도 웹사이트 리드라면 Meta Pixel, Conversions API, 웹사이트 이벤트로 행동 측정과 최적화를 보강해야 합니다 ${metaPixelCapiRef}. | Google은 리드 양식 광고 형식 게재 시 전환 중심 입찰 전략과 Google 리드 양식 전환 목표 최적화가 필요합니다 ${googleLeadConversionRef}. 전환 목표는 Submit lead forms 같은 전환 액션을 묶고, Primary conversion action은 보고와 입찰 최적화에 쓰입니다 ${googleConversionGoalsRef}. | Meta는 “리드를 어디서 받고 Pixel/CAPI/CRM으로 어떻게 닫을지”, Google은 “어떤 전환 액션을 Primary로 삼고 입찰에 넣을지”가 핵심입니다. |`,
    `| 오프라인·CRM 후속 | Meta 리드 데이터는 Ads Manager, 인스턴트 양식 페이지, Meta Business Suite 등에서 CSV로 받을 수 있고, CRM 연결과 Qualified leads 흐름을 구성할 수 있습니다 ${metaLeadCrmRef}. Conversions API for CRM은 리드 데이터와 Meta Business Suite를 연결해 리드 광고 성과 개선에 활용됩니다 ${metaCapiCrmQualityRef}. | Google 리드 양식 데이터는 CSV, 이메일, webhook, 서드파티 연동, Google Ads API로 CRM에 보낼 수 있고, API는 최대 60일치 리드와 거의 실시간 신규 리드 검색을 지원합니다 ${googleLeadExportCrmApiRef}. 오프라인 전환 가져오기는 광고 클릭이나 전화 통화 후 발생한 상담, 계약, 구매 같은 결과를 측정합니다 ${googleOfflineEnhancedRef}. | 리드 수만 보지 말고 CRM 유입, 중복 제거, 상담 연결, 적격 리드, 계약/매출까지 다시 업로드하거나 측정하는 구조를 먼저 잡습니다. |`,
    `| 정책·계정 조건 | Meta 리드 광고는 인스턴트 양식, 개인정보처리방침 URL, 리드 광고 약관/보안 조건을 함께 확인해야 합니다 ${metaLeadInstantFormRef}. | Google은 민감한 카테고리에서 리드 양식을 사용할 수 없고, 개인정보처리방침 링크가 필요하며, 동영상/디스플레이 리드 양식은 지출 요건과 광고주 인증이 필요할 수 있습니다 ${googleLeadPolicyRef}. | Google은 리드 양식 자격·개인정보·인증 조건이 강하게 드러나고, Meta는 목표/전환 위치/지면/양식/CRM 권한을 같이 확인해야 합니다. |`,
    '',
    '**2. 목적별 운영 판단**',
    '',
    `- **빠른 상담/예약 리드**: Meta는 인스턴트 양식, 메시지, 전화 전환 위치를 활용할 수 있어 문의 진입 장벽을 낮추기 좋습니다 ${metaLeadRef}. Google은 검색 캠페인에 리드 양식을 붙이거나 웹사이트 리드 완료 전환을 잡아 이미 수요가 있는 사용자를 받을 때 강점이 있습니다 ${googleLeadAvailabilityRef} ${googleWebConversionRef}.`,
    `- **고관여 B2B·견적 리드**: 운영 해석상 Meta는 발견형 소재와 양식 질문으로 관심군을 넓게 만들고, Google은 검색/PMax/동영상 리드 양식과 전환 중심 입찰을 묶어 품질 신호를 축적하는 쪽이 맞습니다 ${metaFormatRef} ${googleLeadConversionRef}.`,
    `- **웹사이트 리드 중심**: Meta는 Meta Pixel/Conversions API/웹사이트 이벤트로 신청 완료, 상담 예약, 견적 제출 같은 행동을 측정합니다 ${metaPixelCapiRef}. Google은 Google tag 또는 Google Analytics 연결을 확인하고 웹사이트 전환 액션을 생성해 리드 완료를 측정합니다 ${googleWebConversionRef}.`,
    `- **CRM·영업 후속 중심**: Meta는 리드 CSV 다운로드, CRM 연결, Qualified leads, Conversions API for CRM 흐름을 먼저 준비합니다 ${metaLeadCrmRef} ${metaCapiCrmQualityRef}. Google은 CSV/이메일/webhook/API 수신과 오프라인 전환 가져오기 또는 향상된 전환 리드로 상담, 계약, 구매 같은 후속 성과를 다시 가져오는 구조를 고려합니다 ${googleLeadExportCrmApiRef} ${googleOfflineEnhancedRef}.`,
    `- **영상/디스플레이 확장 리드**: Meta는 이미지·동영상·카루셀과 Facebook/Instagram 지면별 소재 사양을 맞춰야 하고 ${metaFormatRef}, Google은 동영상/디스플레이 리드 양식에 지출 요건과 광고주 인증이 필요할 수 있으므로 사전 확인이 필요합니다 ${googleLeadPolicyRef}.`,
    '',
    '**3. 집행 전 체크포인트**',
    '',
    '| 체크포인트 | Meta | Google Ads |',
    '|---|---|---|',
    `| 목표/최적화 | 잠재 고객 목표를 쓰는지, 전환 위치가 인스턴트 양식·메시지·전화 중 무엇인지 확인 ${metaObjectiveRef} ${metaLeadRef} | 리드 목표와 캠페인 유형을 맞추고, 리드 양식 전환 목표·전환 중심 입찰·Primary conversion action을 확인 ${googleObjectiveRef} ${googleLeadConversionRef} ${googleConversionGoalsRef} |`,
    `| 광고 형식 | 이미지·동영상·카루셀·컬렉션·인스턴트 경험이 선택한 지면/목표에서 지원되는지 확인 ${metaFormatRef} | 리드 양식을 검색/동영상/PMax/디스플레이 캠페인에 붙일 수 있는지, 반응형 검색 광고 등 지원 소재 조건을 확인 ${googleLeadAvailabilityRef} ${googleLeadConversionRef} |`,
    `| 게재 위치 | Facebook/Instagram 피드·스토리·릴스 등 게재 위치와 소재 비율·양식 경험을 분리 검토 ${metaFormatRef} | 검색·동영상·디스플레이·PMax 중 리드 확보 목적에 맞는 캠페인 유형을 선택 ${googleTypeRef} |`,
    `| 리드 양식 | 인스턴트 양식 질문 수, 개인정보처리방침 URL, 리드 광고 약관/보안, 메시지/전화 대체 흐름 확인 ${metaLeadInstantFormRef} | 개인정보처리방침 링크, 정책 준수 내역, 민감 카테고리 제한, 광고주 인증/지출 요건 가능성을 확인 ${googleLeadAvailabilityRef} ${googleLeadPolicyRef} |`,
    `| 전환 추적 | Meta Pixel, Conversions API, 웹사이트 이벤트, CRM Qualified leads, Conversions API for CRM 흐름을 확인 ${metaPixelCapiRef} ${metaLeadCrmRef} ${metaCapiCrmQualityRef} | Google tag/GA 연결, 웹사이트 리드 완료 전환 액션, Submit lead forms 목표, 오프라인 전환 가져오기/향상된 전환 리드 확인 ${googleWebConversionRef} ${googleConversionGoalsRef} ${googleOfflineEnhancedRef} |`,
    `| 리드 수신/보관 | CSV 다운로드, Leads Center/Business Suite 확인, CRM 필드 매핑, Qualified leads 단계 매핑 확인 ${metaLeadCrmRef} ${metaCapiCrmQualityRef} | CSV, 이메일, webhook, 서드파티 연동, Google Ads API 중 수신 방식을 정하고, 60일 데이터 제한과 API/export 권한을 확인 ${googleLeadExportCrmApiRef} |`,
    `| QA 테스트 | 테스트 리드 제출, CRM 수신 시간, CSV/CRM 필드 매핑, 중복 리드 처리, 상담 SLA 확인 ${metaLeadCrmRef} | 리드 양식 제출, webhook Send test data, 전환 태그 firing, Primary/Secondary 전환 분류, GCLID/해시 1st-party 데이터, lead_id dedupe, 오프라인 업로드 진단 확인 ${googleLeadExportCrmApiRef} ${googleConversionGoalsRef} ${googleOfflineEnhancedRef} |`,
    '',
    '**4. 리드 품질 관리 기준**',
    '',
    '- **공통 KPI**: 리드 수, CPL, 유효 리드율, 중복/허위 리드율, 상담 연결률, MQL/SQL 전환율, 계약/구매 전환율을 매체별로 분리합니다.',
    `- **Meta 품질 관리**: 인스턴트 양식 질문 수를 늘리면 리드량은 줄 수 있지만 상담 의도를 더 걸러낼 수 있습니다. 제출 리드는 CSV/CRM으로 즉시 넘어가야 하며 Qualified leads 기준을 영업팀과 맞춰야 합니다 ${metaLeadInstantFormRef} ${metaLeadCrmRef}. 하위 퍼널 품질 신호를 쓰려면 Conversions API for CRM과 lead quality 성과 목표를 함께 검토합니다 ${metaCapiCrmQualityRef}.`,
    `- **Google 품질 관리**: 리드 양식 전환 목표와 Primary conversion action을 잘못 잡으면 입찰이 “좋은 리드”가 아니라 쉬운 제출에 맞춰질 수 있습니다. 상담/계약 같은 오프라인 성과를 향상된 전환 리드나 오프라인 전환 가져오기로 되돌리고, webhook/API 수신 리드는 lead_id로 중복 제거하는 구조가 중요합니다 ${googleConversionGoalsRef} ${googleOfflineEnhancedRef} ${googleLeadExportCrmApiRef}.`,
    '- **운영 해석**: Meta와 Google을 같은 CPL 하나로만 비교하지 말고, Meta는 발견형 수요와 빠른 문의, Google은 의도형 검색/캠페인 유형별 리드 품질로 역할을 나눠 보는 편이 안전합니다.',
    '',
    '**5. 설계 분기표**',
    '',
    '| 상황 | 우선 설계 | 주의할 점 |',
    '|---|---|---|',
    `| Meta Instant Form vs Meta 웹사이트 리드 | 빠른 상담/예약은 인스턴트 양식, 랜딩에서 상세 설명과 전환 검증이 필요하면 웹사이트 리드 + Pixel/CAPI를 우선 검토 ${metaLeadInstantFormRef} ${metaPixelCapiRef} | 인스턴트 양식은 CRM 수신과 Qualified leads 기준, 웹사이트 리드는 이벤트/태그 수집 품질을 먼저 QA합니다 ${metaLeadCrmRef} ${metaCapiCrmQualityRef}. |`,
    `| Meta 메시지/전화 vs 양식 | 즉시 대화나 콜센터 연결이 중요하면 메시지/전화 전환 위치, 정보 수집과 후속 영업 분배가 중요하면 인스턴트 양식 ${metaLeadRef} | 메시지/전화는 상담 SLA, 양식은 개인정보 URL·질문 수·CRM 필드 매핑이 병목입니다 ${metaLeadInstantFormRef} ${metaLeadCrmRef}. |`,
    `| Google 리드 양식 vs 웹사이트 전환 | 검색/동영상/PMax/디스플레이에서 광고 안 제출을 줄이고 싶으면 리드 양식, 랜딩 콘텐츠와 자격 검증이 중요하면 웹사이트 전환 ${googleLeadAvailabilityRef} ${googleWebConversionRef} | Google 리드 양식은 전환 중심 입찰과 리드 양식 전환 목표, 웹사이트 전환은 Google tag/GA와 전환 액션 품질을 확인합니다 ${googleLeadConversionRef} ${googleConversionGoalsRef}. |`,
    `| PMax/동영상 확장 리드 | 확장 도달과 자동화가 필요하면 PMax/동영상 리드 양식도 후보 ${googleLeadAvailabilityRef} | 오프라인 전환/향상된 전환 리드가 없으면 쉬운 제출 중심으로 학습될 수 있어 CRM 수신, lead_id dedupe, 후속 성과 업로드를 먼저 준비합니다 ${googleLeadExportCrmApiRef} ${googleOfflineEnhancedRef}. |`,
    '',
    '**6. 빠른 선택 기준**',
    '',
    '- **Meta 우선**: Facebook/Instagram 소재 반응을 활용해 신규 관심군을 만들고, 인스턴트 양식·메시지·전화로 상담 신청을 빠르게 열어야 할 때.',
    '- **Google Ads 우선**: 검색 의도가 이미 있는 잠재고객을 받거나, 검색/동영상/디스플레이/PMax 캠페인에서 리드 양식 전환 목표와 전환 중심 입찰로 최적화해야 할 때.',
    '- **동시 운영**: Meta는 발견형 수요와 리타게팅 풀, Google은 검색/PMax/동영상 기반 의도형 리드와 오프라인 전환 피드백을 맡기는 식으로 역할을 분리합니다.',
    '',
    '정리하면, 이 질문에서는 **Meta = 잠재 고객 목표 + 전환 위치 + 인스턴트 양식/메시지/전화 + Pixel/CAPI + Conversions API for CRM/Qualified leads 중심**, **Google Ads = 리드 목표 + 캠페인 유형 + 리드 양식 애셋 + 전환 목표/Primary action + webhook/API 수신 + 오프라인·향상된 전환 중심**으로 비교하면 됩니다. 실무에서는 리드가 들어오는 위치, 개인정보 동의, 태그/CRM 수신, 영업 후속 KPI를 먼저 정한 뒤 예산과 소재를 붙이는 순서가 안전합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  const citedSourceIndexes = Array.from(used).sort((a, b) => a - b);
  const citedSourceLabels = new Map(citedSourceIndexes.map((sourceIndex, citationIndex) => [
    sourceIndex + 1,
    citationIndex + 1,
  ]));
  const answer = lines.join('\n').replace(/\[S(\d+)\]/g, (label, sourceNumber) => {
    const remappedLabel = citedSourceLabels.get(Number(sourceNumber));
    return remappedLabel ? `[S${remappedLabel}]` : label;
  });

  return {
    answer,
    sources: citedSourceIndexes.map(index => comparisonSources[index]),
    model: 'compass-answer-deterministic-meta-google-lead-comparison-matrix',
    showContactOption: false,
    confidenceCap: 88,
    reviewStatus: 'completed',
  };
}

function buildMetaLeadOperatingAnswer(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  if (detectLeadOperatingAnswerFamily(message, intent) !== 'meta_lead_methods') return null;

  const leadSources = ensureLeadOperatingSources(message, intent, sources);
  const indexes = getRequiredOfficialSnapshotIndexes(leadSources, META_LEAD_OPERATING_REQUIRED_CHUNK_IDS);
  if (!indexes) return null;

  const [
    metaLevelsIndex,
    metaObjectivesIndex,
    metaFormatsIndex,
    metaModulesIndex,
    metaLeadInstantFormIndex,
    metaLeadCrmIndex,
    metaPixelCapiIndex,
    metaCapiCrmQualityIndex,
  ] = indexes;
  const used = new Set<number>();
  const citation = (index: number) => {
    used.add(index);
    return `[S${index + 1}]`;
  };

  const metaLevelRef = citation(metaLevelsIndex);
  const metaObjectiveRef = citation(metaObjectivesIndex);
  const metaFormatRef = citation(metaFormatsIndex);
  const metaLeadRef = citation(metaModulesIndex);
  const metaInstantRef = citation(metaLeadInstantFormIndex);
  const metaCrmRef = citation(metaLeadCrmIndex);
  const metaPixelRef = citation(metaPixelCapiIndex);
  const metaQualityRef = citation(metaCapiCrmQualityIndex);

  const lines = [
    'Meta 리드 캠페인은 “리드 상품 하나”를 고르는 문제가 아니라, **잠재 고객 목표 + 전환 위치 + 양식/메시지/전화/웹사이트 흐름 + Pixel/CAPI + CRM 품질 신호**를 조합해 설계하는 문제로 보는 편이 안전합니다.',
    '아래 내용은 공식 기능 조건을 바탕으로 한 운영 해석입니다. 실제 집행 전에는 업종, 개인정보처리방침, 계정 권한, CRM 수신 상태를 계정 화면에서 다시 확인해야 합니다.',
    '',
    '**1. 선택 기준 비교**',
    '',
    '| 리드 방식 | 언제 우선 선택하나 | 추적/최적화 | CRM·품질 관리 |',
    '|---|---|---|---|',
    `| Instant Form / 인스턴트 양식 | 랜딩 이동 없이 빠르게 상담, 견적, 가입 정보를 받고 싶을 때 우선 검토합니다. 인스턴트 양식은 연락처와 맞춤 질문으로 리드를 생성·검증하는 구조입니다 ${metaInstantRef}. | 잠재 고객 목표와 전환 위치를 함께 보고, 캠페인-광고 세트-광고 단위 구조에서 목표·예산·게재 위치·소재를 나눠 세팅합니다 ${metaObjectiveRef} ${metaLevelRef}. | 제출 리드는 Ads Manager, 인스턴트 양식 페이지, Meta Business Suite, CSV/CRM 연결로 후속 처리하고 Qualified leads 기준을 맞춥니다 ${metaCrmRef}. 질문 수를 늘리면 리드량은 줄 수 있지만 의도 필터링에는 유리합니다. |`,
    `| 웹사이트 전환 리드 | 랜딩에서 상세 설명, 가격/자격 조건, 신청 완료, 상담 예약, 견적 제출 등 하위 행동을 검증해야 할 때 선택합니다. | Meta Pixel, Conversions API, 웹사이트 이벤트로 웹 행동을 측정하고 최적화 신호를 보강합니다 ${metaPixelRef}. | CRM의 상담·계약 결과를 다시 묶으려면 Conversions API for CRM과 lead quality 흐름을 검토합니다 ${metaQualityRef}. |`,
    `| 메시지 리드 | 즉시 대화, 상담사 연결, 챗 기반 상담 SLA가 중요한 경우 후보입니다. Meta의 리드 운영 모듈은 인스턴트 양식뿐 아니라 메시지, 전화 같은 전환 위치를 같이 검토하게 합니다 ${metaLeadRef}. | 메시지 전환 위치를 목표와 맞추고, 광고 형식과 Facebook/Instagram 지면별 소재 조건을 확인합니다 ${metaFormatRef}. | 상담 응답 시간, 대화 후 CRM 등록, 중복 문의 처리, 상담 결과 태깅을 운영 KPI로 둬야 합니다. |`,
    `| 전화 리드 | 콜센터 연결, 예약 전화, 고관여 상담처럼 통화 자체가 1차 전환일 때 후보입니다. 전화 역시 리드 전환 위치 후보로 함께 검토합니다 ${metaLeadRef}. | 전화 연결 가능 시간, 지역/기기 조건, 지면별 소재 경험을 함께 봅니다 ${metaFormatRef}. | 통화 연결률, 부재/중복, 상담 품질, CRM 후속 상태를 리드 품질 KPI로 분리해야 합니다. |`,
    '',
    '**2. 운영 설계 순서**',
    '',
    `1. **캠페인 목표 먼저 확정**: Meta 목표 축에서 잠재 고객을 선택하고, 실제로 받을 전환 위치가 양식·메시지·전화·웹사이트 중 무엇인지 정합니다 ${metaObjectiveRef} ${metaLeadRef}.`,
    `2. **광고 세트에서 운영 변수 분리**: 예산, 일정, 타겟, 게재 위치는 광고 세트에서 다루고, 소재와 문구는 광고 단위에서 관리합니다 ${metaLevelRef}.`,
    `3. **지면/소재 호환성 확인**: 이미지, 동영상, 카루셀, 컬렉션, 인스턴트 경험 등 형식은 Facebook/Instagram 게재 위치와 목표에 따라 사용 조건이 달라질 수 있습니다 ${metaFormatRef}.`,
    `4. **측정 체계 확정**: 웹사이트 리드는 Pixel/CAPI/웹 이벤트, 양식 리드는 CSV/CRM/Qualified leads, 하위 퍼널 품질은 Conversions API for CRM으로 이어지는지 봅니다 ${metaPixelRef} ${metaCrmRef} ${metaQualityRef}.`,
    '',
    '**3. 런칭 전 QA 체크리스트**',
    '',
    `- Instant Form: 질문 수, 개인정보처리방침 URL, 리드 광고 약관/보안 조건, 제출 완료 화면, CRM 필드 매핑을 확인합니다 ${metaInstantRef} ${metaCrmRef}.`,
    `- 웹사이트 전환: Pixel 설치, Conversions API 이벤트, 신청 완료 이벤트명, 중복 이벤트, 테스트 이벤트 수신 여부를 확인합니다 ${metaPixelRef}.`,
    '- 메시지/전화: 상담 가능 시간, 응답 SLA, 부재 처리, CRM 등록 규칙, 상담 결과 태깅 기준을 정합니다.',
    `- 품질 피드백: Qualified leads 기준을 영업팀과 맞추고, lead quality 목표와 Conversions API for CRM 적용 가능성을 검토합니다 ${metaQualityRef}.`,
    '',
    '**4. 빠른 선택 기준**',
    '',
    '- **빠른 문의량**이 목표면 Instant Form, 메시지, 전화부터 검토합니다.',
    '- **리드 품질과 자격 검증**이 중요하면 웹사이트 전환 또는 질문 수가 충분한 Instant Form을 우선 검토합니다.',
    '- **영업 후속 성과**가 핵심이면 CRM 수신, Qualified leads, Conversions API for CRM을 먼저 준비한 뒤 예산을 키우는 편이 안전합니다.',
    '',
    `정리하면, Meta 리드 운영은 **전환 위치 선택 → 소재/지면 확인 → Pixel/CAPI 또는 CRM 연결 → Qualified leads/계약까지 품질 신호 회수** 순서로 설계해야 합니다.`,
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    leadSources,
    used,
    'compass-answer-deterministic-meta-lead-operating-matrix',
    88,
  );
}

function buildGoogleLeadOperatingAnswer(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  if (detectLeadOperatingAnswerFamily(message, intent) !== 'google_lead_methods') return null;

  const leadSources = ensureLeadOperatingSources(message, intent, sources);
  const indexes = getRequiredOfficialSnapshotIndexes(leadSources, GOOGLE_LEAD_OPERATING_REQUIRED_CHUNK_IDS);
  if (!indexes) return null;

  const [
    googleObjectivesIndex,
    googleTypesIndex,
    googleLeadAvailabilityIndex,
    googleLeadPolicyIndex,
    googleLeadConversionIndex,
    googleConversionGoalsIndex,
    googleWebConversionIndex,
    googleOfflineEnhancedIndex,
    googleLeadExportCrmApiIndex,
  ] = indexes;
  const used = new Set<number>();
  const citation = (index: number) => {
    used.add(index);
    return `[S${index + 1}]`;
  };

  const googleObjectiveRef = citation(googleObjectivesIndex);
  const googleTypeRef = citation(googleTypesIndex);
  const googleLeadAvailabilityRef = citation(googleLeadAvailabilityIndex);
  const googleLeadPolicyRef = citation(googleLeadPolicyIndex);
  const googleLeadConversionRef = citation(googleLeadConversionIndex);
  const googleConversionGoalsRef = citation(googleConversionGoalsIndex);
  const googleWebConversionRef = citation(googleWebConversionIndex);
  const googleOfflineEnhancedRef = citation(googleOfflineEnhancedIndex);
  const googleLeadExportCrmApiRef = citation(googleLeadExportCrmApiIndex);

  const lines = [
    'Google Ads 리드 운영은 **리드 목표 + 캠페인 유형 + 리드 양식 애셋/웹사이트 전환 + 전환 목표와 Primary action + CRM/API/webhook + 오프라인·향상된 전환**을 같이 맞추는 구조로 봐야 합니다.',
    '아래의 운영 판단은 공식 기능 조건을 바탕으로 한 실무 해석입니다. 실제 계정에서는 국가, 정책 준수 내역, 광고주 인증, 개인정보처리방침, 태그/CRM 권한을 다시 확인해야 합니다.',
    '',
    '**1. 리드 방식 비교**',
    '',
    '| 방식 | 언제 쓰나 | 세팅 핵심 | QA/주의점 |',
    '|---|---|---|---|',
    `| 검색 리드 양식 | 검색 수요가 이미 있고, 광고 클릭 후 바로 연락처를 제출받고 싶을 때 후보입니다. 리드 양식은 검색, 동영상, 실적 최대화, 디스플레이 캠페인에 추가할 수 있습니다 ${googleLeadAvailabilityRef}. | 캠페인 목표를 리드로 잡고, 캠페인 유형과 전환 중심 입찰을 맞춥니다 ${googleObjectiveRef} ${googleLeadConversionRef}. | 개인정보처리방침 링크, 정책 준수 내역, 민감 카테고리 제한을 확인합니다 ${googleLeadPolicyRef}. |`,
    `| 웹사이트 전환 | 랜딩 콘텐츠, 가격/자격 조건, 폼 검증, 상담 예약 완료처럼 사이트 내 행동 품질을 보고 싶을 때 선택합니다. | Google tag 또는 Google Analytics 연결 상태를 확인하고 웹사이트 전환 액션을 생성해 리드 완료를 측정합니다 ${googleWebConversionRef}. | 태그 firing, 중복 전환, 완료 페이지/이벤트 조건, Primary/Secondary 분류를 확인합니다 ${googleConversionGoalsRef}. |`,
    `| PMax/동영상/디스플레이 리드 | 검색 외 지면에서 확장 도달과 자동화를 쓰되 리드 제출까지 받고 싶을 때 후보입니다. Google Ads 캠페인 유형은 검색, 디스플레이, 동영상, 쇼핑, 앱, 실적 최대화 등으로 나뉩니다 ${googleTypeRef}. | 리드 양식 애셋 지원 여부와 전환 중심 입찰 조건을 확인합니다 ${googleLeadAvailabilityRef} ${googleLeadConversionRef}. | 동영상/디스플레이 리드 양식은 지출 요건과 광고주 인증이 필요할 수 있습니다 ${googleLeadPolicyRef}. |`,
    `| 오프라인 전환 가져오기/향상된 전환 리드 | 광고 클릭 또는 전화 이후 상담, 계약, 구매 같은 후속 결과를 다시 Google Ads에 반영해야 할 때 사용합니다. | 오프라인 전환 가져오기는 오프라인에서 발생한 상담, 계약, 구매 결과를 측정하고, 향상된 전환 리드는 해시 처리된 1st-party 데이터를 활용합니다 ${googleOfflineEnhancedRef}. | GCLID/해시 데이터, 업로드 진단, 전환 시점, 중복 제거, CRM 상태값 매핑을 확인합니다. |`,
    '',
    '**2. 전환 목표와 입찰 기준**',
    '',
    `- Google Ads는 판매, 리드, 웹사이트 트래픽 등 목표를 먼저 정하고 목표에 맞는 캠페인 유형과 기능을 조합합니다 ${googleObjectiveRef}.`,
    `- Submit lead forms 같은 전환 액션은 관련 전환 목표로 묶이고, Primary conversion action은 보고와 입찰 최적화에 사용됩니다 ${googleConversionGoalsRef}.`,
    `- 리드 양식 광고 형식으로 게재하려면 전환 중심 입찰 전략과 Google 리드 양식 전환 목표 최적화가 필요합니다 ${googleLeadConversionRef}.`,
    '',
    '**3. CRM·수신 구조**',
    '',
    `- 리드 양식 데이터는 CSV, 이메일, webhook, 서드파티 연동, Google Ads API로 받을 수 있고, API는 최대 60일치 리드와 거의 실시간 신규 리드 검색을 지원합니다 ${googleLeadExportCrmApiRef}.`,
    '- CRM에는 원본 캠페인, 키워드/자산, lead_id, 제출 시간, 동의 URL, 상담 상태, MQL/SQL/계약 상태를 함께 저장하는 편이 안전합니다.',
    '- webhook/API 수신 리드는 lead_id 기준 중복 제거와 실패 재시도 로그가 필요합니다.',
    '',
    '**4. 런칭 전 QA 체크리스트**',
    '',
    `- 캠페인 목표가 리드이고, 캠페인 유형이 검색/동영상/PMax/디스플레이 중 리드 양식 애셋을 지원하는지 확인합니다 ${googleObjectiveRef} ${googleLeadAvailabilityRef}.`,
    `- 리드 양식 전환 목표, 전환 중심 입찰, Primary/Secondary conversion action 분류를 확인합니다 ${googleLeadConversionRef} ${googleConversionGoalsRef}.`,
    `- 웹사이트 전환이면 Google tag/GA 연결, 웹사이트 도메인, 리드 완료 전환 액션, 태그 firing을 확인합니다 ${googleWebConversionRef}.`,
    `- webhook을 쓰면 Send test data, 수신 필드, CRM 필드 매핑, lead_id dedupe, 60일 데이터 제한과 API 권한을 확인합니다 ${googleLeadExportCrmApiRef}.`,
    `- 오프라인/향상된 전환은 GCLID 또는 해시 처리된 1st-party 데이터, 업로드 진단, 상담·계약 상태값 매핑을 확인합니다 ${googleOfflineEnhancedRef}.`,
    '',
    '**5. 빠른 선택 기준**',
    '',
    '- **검색 의도형 리드**는 검색 캠페인 + 리드 양식 또는 웹사이트 전환을 먼저 비교합니다.',
    '- **랜딩 검증이 중요한 리드**는 웹사이트 전환을 우선하고 태그/전환 액션 품질을 QA합니다.',
    '- **확장 도달**은 PMax/동영상/디스플레이 리드 양식을 검토하되, 쉬운 제출 중심 학습을 막으려면 오프라인·향상된 전환 피드백을 준비합니다.',
    '',
    '정리하면, Google Ads 리드 운영은 리드 양식을 붙이는 것에서 끝나지 않고, 전환 목표/Primary action, CRM 수신, webhook/API, 오프라인·향상된 전환으로 “좋은 리드” 신호를 되돌리는 구조까지 같이 잡아야 합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    leadSources,
    used,
    'compass-answer-deterministic-google-lead-operating-matrix',
    88,
  );
}

function buildCrossVendorLeadKpiFrameworkAnswer(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  if (detectLeadOperatingAnswerFamily(message, intent) !== 'cross_vendor_lead_kpi_framework') return null;

  const leadSources = ensureLeadOperatingSources(message, intent, sources);
  const requiredSourceIndexes = getMetaGoogleLeadComparisonRequiredSourceIndexes(leadSources);
  if (!requiredSourceIndexes) return null;

  const used = new Set<number>();
  const citation = (index: number) => {
    used.add(index);
    return `[S${index + 1}]`;
  };

  const metaObjectiveRef = citation(requiredSourceIndexes.metaObjectivesIndex);
  const metaLeadRef = citation(requiredSourceIndexes.metaModulesIndex);
  const metaInstantRef = citation(requiredSourceIndexes.metaLeadInstantFormIndex);
  const metaCrmRef = citation(requiredSourceIndexes.metaLeadCrmIndex);
  const metaPixelRef = citation(requiredSourceIndexes.metaPixelCapiIndex);
  const metaQualityRef = citation(requiredSourceIndexes.metaCapiCrmQualityIndex);
  const googleObjectiveRef = citation(requiredSourceIndexes.googleObjectivesIndex);
  const googleTypeRef = citation(requiredSourceIndexes.googleTypesIndex);
  const googleLeadAvailabilityRef = citation(requiredSourceIndexes.googleLeadAvailabilityIndex);
  const googleConversionGoalsRef = citation(requiredSourceIndexes.googleConversionGoalsIndex);
  const googleWebConversionRef = citation(requiredSourceIndexes.googleWebConversionIndex);
  const googleOfflineEnhancedRef = citation(requiredSourceIndexes.googleOfflineEnhancedIndex);
  const googleLeadExportCrmApiRef = citation(requiredSourceIndexes.googleLeadExportCrmApiIndex);

  const lines = [
    'Meta와 Google Ads 리드 캠페인을 동시에 운영할 때는 **CPL 하나로 승패를 판단하면 안 됩니다.** 두 매체의 역할이 다르므로, 리드 수 → 유효 리드율 → MQL → SQL → 계약률을 같은 CRM 기준으로 묶되 매체별 역할과 최적화 신호는 분리해야 합니다.',
    '아래 프레임워크는 공식 기능 조건을 바탕으로 한 운영 해석입니다. KPI 정의, CRM 단계, 영업 SLA, 오프라인 전환 업로드 가능 여부는 계정과 내부 프로세스 기준으로 확정해야 합니다.',
    '',
    '**1. KPI 계층 구조**',
    '',
    '| 계층 | 공통 정의 | Meta 운영 해석 | Google Ads 운영 해석 |',
    '|---|---|---|---|',
    `| 리드 수 | 양식 제출, 메시지/전화 문의, 웹사이트 신청 완료처럼 1차 리드 발생 건수입니다. | Meta는 잠재 고객 목표와 인스턴트 양식·메시지·전화 전환 위치로 진입 장벽을 낮출 수 있습니다 ${metaObjectiveRef} ${metaLeadRef} ${metaInstantRef}. | Google은 리드 목표와 검색/동영상/PMax/디스플레이 리드 양식 또는 웹사이트 전환을 조합합니다 ${googleObjectiveRef} ${googleTypeRef} ${googleLeadAvailabilityRef}. |`,
    '| CPL | 광고비 / 리드 수입니다. 단, CPL은 “싼 제출”인지 “영업 가능한 리드”인지 구분하지 못합니다. | 발견형 수요에서 CPL이 낮아도 상담 연결률과 중복/허위 리드를 같이 봅니다. | 검색 의도형 리드는 CPL이 높아도 MQL/SQL/계약률이 높으면 예산을 유지할 수 있습니다. |',
    `| 유효 리드율 | 중복, 허위, 연락 불가, 조건 미충족을 제외한 비율입니다. | 인스턴트 양식 질문 수와 개인정보/필드 구성을 조정하고, CRM/Qualified leads 기준으로 품질을 맞춥니다 ${metaInstantRef} ${metaCrmRef}. | 리드 양식 수신은 CSV, 이메일, webhook, 서드파티, Google Ads API로 가져오고 lead_id 기준 중복 제거가 필요합니다 ${googleLeadExportCrmApiRef}. |`,
    `| MQL | 마케팅 기준으로 자격이 있는 리드입니다. | Meta는 Pixel/CAPI, 웹사이트 이벤트, Conversions API for CRM으로 하위 퍼널 품질 신호를 보강합니다 ${metaPixelRef} ${metaQualityRef}. | Google은 Primary conversion action과 웹사이트 전환 액션을 잘 잡아 보고/입찰 최적화가 “좋은 리드”에 맞게 작동해야 합니다 ${googleConversionGoalsRef} ${googleWebConversionRef}. |`,
    `| SQL | 영업팀이 실제 상담·견적·제안 대상으로 인정한 리드입니다. | Qualified leads 기준을 영업팀과 합의하고, 상담 결과를 CRM에 남겨야 합니다 ${metaCrmRef} ${metaQualityRef}. | 상담, 계약, 구매 같은 후속 결과를 오프라인 전환 가져오기 또는 향상된 전환 리드로 되돌리는 구조가 필요합니다 ${googleOfflineEnhancedRef}. |`,
    '| 계약률 | 계약/구매 건수 ÷ SQL 또는 전체 리드입니다. 최종 예산 배분은 계약률과 매출 기준으로 봐야 합니다. | 상단 퍼널 생성과 리타게팅 풀을 만드는 역할을 평가합니다. | 의도형 검색과 오프라인 성과 피드백으로 계약 가능성이 높은 쿼리·캠페인을 키웁니다. |',
    '',
    '**2. 대시보드 분리 방식**',
    '',
    '- **매체별 1차 지표**: 노출, 클릭, CTR, CPC, 리드 수, CPL을 Meta와 Google로 나눕니다.',
    '- **품질 지표**: 유효 리드율, 중복/허위 리드율, 연락 성공률, 상담 예약률, MQL 전환율, SQL 전환율을 CRM 기준으로 통일합니다.',
    '- **영업 지표**: 견적 발송률, 제안 진행률, 계약률, 계약 CPA, 매출/ROAS를 매체별·캠페인별로 다시 연결합니다.',
    '- **시간 지표**: 리드 발생 후 첫 응답 시간, 24시간 내 연락률, 상담 완료까지 걸린 시간을 같이 봅니다. 빠른 리드는 SLA가 무너지면 품질이 급락합니다.',
    '',
    '**3. 최적화 의사결정 규칙**',
    '',
    '- **CPL 낮고 유효 리드율 낮음**: 양식 질문, 필수 필드, 랜딩 자격 조건을 강화합니다. Meta는 Instant Form 질문/CRM 기준을 조정하고, Google은 리드 양식 전환 목표와 Primary action을 재점검합니다.',
    '- **CPL 높고 SQL/계약률 높음**: 단순 CPL만 보고 중단하지 않습니다. Google 검색 또는 고의도 캠페인은 예산을 유지하고, Meta는 리타게팅/유사 관심군 확장 역할을 봅니다.',
    '- **리드 수 많고 상담 연결률 낮음**: 콜센터/영업 SLA, 중복 처리, CRM 라우팅을 먼저 고칩니다. 매체 세팅 문제가 아니라 후속 처리 병목일 수 있습니다.',
    '- **MQL은 많은데 SQL이 낮음**: 광고 문구와 양식 질문이 실제 자격 조건을 충분히 거르고 있는지 봅니다. 약속 없는 “무료 상담”식 소재는 품질을 낮출 수 있습니다.',
    '- **계약률은 좋은데 전환 학습이 약함**: Meta는 Conversions API for CRM/Qualified leads, Google은 오프라인 전환 가져오기/향상된 전환 리드로 하위 퍼널 신호를 되돌립니다.',
    '',
    '**4. 운영 주기**',
    '',
    '- **매일**: 리드 수, CPL, 수신 실패, webhook/API 오류, CRM 누락, 상담 SLA를 봅니다.',
    '- **주 2-3회**: 캠페인/소재/검색어 또는 자산별 유효 리드율과 MQL 전환율을 봅니다.',
    '- **주간**: SQL, 계약률, 계약 CPA, 매출 기여를 기준으로 예산을 재배분합니다.',
    '- **월간**: Meta는 발견형 수요 생성과 리타게팅 풀 기여, Google은 의도형 리드와 오프라인 성과 회수 기여를 분리 평가합니다.',
    '',
    '**5. 실무 결론**',
    '',
    'Meta는 빠른 리드 생성과 관심군 확장에 강하고, Google Ads는 검색 의도와 전환 목표/오프라인 피드백을 통한 하위 퍼널 최적화에 강합니다. 그래서 두 매체를 함께 운영할 때는 **같은 CRM 단계 정의로 품질을 비교하되, 최적화 신호와 역할은 분리**해야 합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    leadSources,
    used,
    'compass-answer-deterministic-meta-google-lead-kpi-framework',
    88,
  );
}

function buildLeadOperatingDeterministicAnswer(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const family = detectLeadOperatingAnswerFamily(message, intent);
  if (!family) return null;

  if (family === 'cross_vendor_lead_kpi_framework') {
    return buildCrossVendorLeadKpiFrameworkAnswer(message, intent, sources);
  }
  if (family === 'meta_lead_methods') {
    return buildMetaLeadOperatingAnswer(message, intent, sources);
  }
  if (family === 'google_lead_methods') {
    return buildGoogleLeadOperatingAnswer(message, intent, sources);
  }

  return null;
}

function buildMetaProductPlanningMatrixAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const matrixSources = ensureMetaProductPlanningMatrixSources(sources);
  const requiredSourceIndexes = getMetaProductPlanningMatrixRequiredSourceIndexes(matrixSources);
  if (!requiredSourceIndexes) return null;

  const {
    levelsIndex,
    objectivesIndex,
    formatsIndex,
    modulesIndex,
    catalogIndex,
    advantageIndex,
  } = requiredSourceIndexes;

  const used = new Set<number>([
    objectivesIndex,
    formatsIndex,
    modulesIndex,
    levelsIndex,
    catalogIndex,
    advantageIndex,
  ]);

  const citation = (index: number, fallbackIndex = objectivesIndex) => {
    const usableIndex = index >= 0 ? index : fallbackIndex;
    used.add(usableIndex);
    return `[S${usableIndex + 1}]`;
  };

  const levelRef = citation(levelsIndex, objectivesIndex);
  const objectiveRef = citation(objectivesIndex);
  const formatRef = citation(formatsIndex);
  const moduleRef = citation(modulesIndex);
  const catalogRef = citation(catalogIndex);
  const advantageRef = citation(advantageIndex);
  const commerceRef = `${catalogRef} ${advantageRef}`;

  const lines = [
    'Meta 광고 상품은 “상품명 목록”이 아니라 **목표별 캠페인 유형 + 전환 위치 + 광고 형식/게재 위치 + 데이터·측정 모듈**을 조합해 고르는 구조로 보는 편이 실무적입니다.',
    `광고 관리자는 캠페인에서 목표를 정하고, 광고 세트에서 예산·일정·타겟·게재 위치를 잡으며, 광고 단위에서 소재와 문구를 구성합니다 ${levelRef}.`,
    '',
    '**1. 유형별 비교**',
    '',
    '| 유형 | 캠페인 목표 | 주로 맞는 광고 형식 | 게재 위치 판단 | 리드/앱/카탈로그 활용 기준 | 실무 판단 포인트 |',
    '|---|---|---|---|---|---|',
    `| 인지도/도달 | 브랜드 인지, 도달, 기억률처럼 상단 퍼널 확대가 목표일 때 ${objectiveRef} | 이미지, 동영상, 카루셀처럼 빠르게 메시지를 전달하는 형식 ${formatRef} | 릴스·스토리·피드처럼 도달량과 반복 노출을 확보하기 쉬운 지면을 우선 보고, 빈도 피로도가 크면 지면을 넓힙니다 ${formatRef} | 리드·앱·카탈로그는 핵심 모듈이 아니라 후속 리타게팅/전환 캠페인으로 넘기는 편이 안전 | KPI는 전환수보다 도달, 빈도, ThruPlay/조회, 브랜드 리프트 성격으로 봅니다. |`,
    `| 트래픽/방문 유도 | 웹사이트, 앱, 메시지 등 목적지로 사람을 보내는 것이 목표일 때 ${objectiveRef} | 이미지, 동영상, 카루셀, 링크형 소재를 목적지와 맞춰 사용 ${formatRef} | 피드·스토리·릴스·탐색처럼 클릭 후 랜딩 흐름이 끊기지 않는 지면을 고르고, 랜딩 속도가 느리면 모바일 지면을 보수적으로 봅니다 ${formatRef} | 앱 유입이면 앱 목적/앱 이벤트로 분리하고, 상품 탐색이면 카탈로그/커머스 구조와 연결 여부를 봅니다 ${moduleRef} | 랜딩 속도, URL, UTM, 픽셀/CAPI 이벤트 수집 여부를 집행 전 확인합니다. |`,
    `| 참여/메시지 | 게시물 반응, 동영상 조회, 메시지 대화처럼 상호작용이 목표일 때 ${objectiveRef} | 동영상, 이미지, 카루셀 등 참여를 유도하기 쉬운 소재 ${formatRef} | 릴스·피드·스토리는 반응/조회에, 메시지 상담은 Messenger·Instagram DM 진입 흐름을 중심으로 검토합니다 ${formatRef} | 상담형이면 메시지 전환 위치를, 리드 수집형이면 잠재 고객 목표로 분리합니다 ${moduleRef} | “반응”과 “문의/전환”을 같은 캠페인에서 동시에 기대하지 않도록 KPI를 분리합니다. |`,
    `| 리드 수집 | 상담 신청, 견적 요청, 연락처 확보처럼 잠재 고객 확보가 목표일 때 ${objectiveRef} | 이미지·동영상·카루셀 소재로 제안 가치를 설명하고, 인스턴트 양식/메시지/전화 같은 전환 위치와 연결 ${moduleRef} | 모바일 피드·스토리·릴스처럼 양식 제출 흐름이 짧은 지면을 우선 보고, 메시지 리드는 대화 진입 위치를 따로 검토합니다 ${formatRef} | **리드**가 핵심입니다. 인스턴트 양식은 CRM 연동, 질문 항목, 개인정보 고지, 후속 연락 프로세스까지 같이 설계합니다 ${moduleRef} | 리드 품질이 중요하면 양식 질문을 늘리고, 리드량이 중요하면 입력 장벽을 낮춥니다. |`,
    `| 앱 성장 | 앱 설치, 앱 내 행동, 앱 이벤트 최적화가 목표일 때 ${objectiveRef} | 짧은 동영상, 이미지, 카루셀 등 모바일 앱 가치가 즉시 보이는 소재 ${formatRef} | 모바일 피드·스토리·릴스 중심으로 보되, 스토어 이동과 앱 이벤트 측정이 끊기지 않는 전환 위치를 먼저 확인합니다 ${moduleRef} | **앱**이 핵심입니다. SDK/MMP, 앱 이벤트, 설치 후 행동 이벤트가 준비되지 않으면 최적화 품질이 떨어집니다 ${moduleRef} | 설치 캠페인과 구매/가입 같은 앱 이벤트 캠페인을 분리해 학습 기준을 명확히 둡니다. |`,
    `| 판매/커머스 | 구매, 장바구니, 웹사이트 전환, 상품 판매가 목표일 때 ${objectiveRef} | 이미지, 동영상, 카루셀, 컬렉션, 인스턴트 경험, Advantage+ 카탈로그 계열을 상품 수와 구매 흐름에 맞춰 선택 ${formatRef} ${advantageRef} | 피드·스토리·릴스는 발견/탐색, 카탈로그·컬렉션은 상품 비교, 리타게팅은 구매 이벤트가 잘 잡히는 지면을 우선합니다 ${formatRef} | **카탈로그**가 핵심입니다. 상품 피드, 상품 세트, 픽셀/CAPI, 웹사이트 전환 측정을 묶어서 봐야 합니다 ${commerceRef} | SKU가 많으면 카탈로그/동적 소재, SKU가 적거나 신제품이면 일반 판매 캠페인+수동 소재가 더 나을 수 있습니다. |`,
    '',
    '**2. 리드/앱/카탈로그 빠른 판별**',
    '',
    '| 모듈 | 선택해야 하는 상황 | 피하는 편이 나은 상황 | 준비 조건 |',
    '|---|---|---|---|',
    `| 리드/잠재 고객 | 상담, 견적, 예약, B2B 문의처럼 “연락처 확보 후 영업 처리”가 핵심일 때 ${objectiveRef} | 즉시 구매가 목표인데 후속 상담 조직이 없거나 리드 품질을 검수할 수 없을 때 | 인스턴트 양식/메시지/전화 전환 위치, 질문 항목, 개인정보 고지, CRM·알림·상담 SLA ${moduleRef} |`,
    `| 앱 홍보 | 앱 설치, 가입, 구매, 구독처럼 앱 안 행동을 늘려야 할 때 ${objectiveRef} | 웹 전환만 측정하거나 앱 이벤트가 준비되지 않은 상태에서 설치 수만 늘리려 할 때 | SDK/MMP, 앱 이벤트, 스토어 연결, 설치 후 핵심 이벤트, 앱 이벤트 최적화 기준 ${moduleRef} |`,
    `| 카탈로그/컬렉션/Advantage+ 카탈로그 | SKU가 많고 상품별 노출·리타게팅·동적 소재가 필요한 커머스일 때 ${commerceRef} | SKU가 적거나 가격/재고 동기화가 불안정해 상품 피드 품질을 보장하기 어려울 때 | 상품 피드, 상품 세트, 품절·가격 동기화, 픽셀/CAPI, 구매·장바구니 이벤트 ${catalogRef} ${advantageRef} |`,
    `| 일반 목표형 캠페인 | 신제품 테스트, 브랜드 메시지, 소수 SKU, 이벤트 고지처럼 수동 소재로 메시지 통제가 중요할 때 ${objectiveRef} | 상품 수가 많아 소재 운영이 반복되거나 구매 이벤트 학습이 더 중요한 커머스 확장 단계 | 목표, 광고 세트 타겟·게재 위치, 이미지/동영상/카루셀 소재와 랜딩 경험 ${levelRef} ${formatRef} |`,
    '',
    '**3. 선택 순서**',
    '',
    `- 먼저 캠페인 목표를 고릅니다. Meta의 주요 목표 축은 인지도, 트래픽, 참여, 잠재 고객, 앱 홍보, 판매입니다 ${objectiveRef}.`,
    `- 다음으로 전환 위치를 고릅니다. 리드는 인스턴트 양식/메시지/전화, 앱은 앱 설치·앱 이벤트, 판매는 카탈로그·웹사이트 전환 측정처럼 목표별 운영 모듈이 달라집니다 ${moduleRef}.`,
    `- 마지막으로 해당 목표에서 지원되는 광고 형식과 게재 위치를 대조합니다. 이미지, 동영상, 카루셀, 컬렉션, 인스턴트 경험은 목표와 지면에 따라 사용 가능 여부와 권장 사양이 달라집니다 ${formatRef}.`,
    '',
    '**4. 실무 체크**',
    '',
    '- 리드 캠페인: 양식 질문 수, 개인정보 고지, CRM/알림 연동, 상담 SLA를 먼저 정합니다.',
    '- 앱 캠페인: SDK/MMP, 앱 이벤트, 설치 후 핵심 행동 이벤트가 잡히는지 확인합니다.',
    `- 카탈로그/판매 캠페인: 상품 피드 품질, 품절/가격 동기화, 픽셀/CAPI, 구매 이벤트, Advantage+ 카탈로그와 상품 세트 매칭을 확인합니다 ${catalogRef} ${advantageRef}.`,
    '- 형식/지면: 같은 소재라도 피드, 스토리, 릴스, 검색/탐색 지면에서 비율과 사용 경험이 달라지므로 소재를 지면별로 나눠 봅니다.',
    '',
    '정리하면, “어떤 상품을 쓸까?”보다 **목표 → 전환 위치 → 형식/게재 위치 → 데이터·측정 조건** 순서로 좁히면 됩니다. 이 질문의 범위에서는 리드형, 앱형, 판매/카탈로그형을 별도 운영 유형으로 분리해 설계하는 것이 가장 안전합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  const citedSourceIndexes = Array.from(used).sort((a, b) => a - b);
  const citedSourceLabels = new Map(citedSourceIndexes.map((sourceIndex, citationIndex) => [
    sourceIndex + 1,
    citationIndex + 1,
  ]));
  const answer = lines.join('\n').replace(/\[S(\d+)\]/g, (label, sourceNumber) => {
    const remappedLabel = citedSourceLabels.get(Number(sourceNumber));
    return remappedLabel ? `[S${remappedLabel}]` : label;
  });

  return {
    answer,
    sources: citedSourceIndexes.map(index => matrixSources[index]),
    model: 'compass-answer-deterministic-meta-product-planning-matrix',
    showContactOption: false,
    confidenceCap: 88,
    reviewStatus: 'completed',
  };
}

function buildGoogleProductPlanningMatrixAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const matrixSources = ensureOfficialSnapshotSources(sources, GOOGLE_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS);
  const requiredSourceIndexes = getGoogleProductPlanningMatrixRequiredSourceIndexes(matrixSources);
  if (!requiredSourceIndexes) return null;

  const {
    googleObjectivesIndex,
    googleTypesIndex,
    googleLeadAvailabilityIndex,
    googleConversionGoalsIndex,
    googleWebConversionIndex,
    googleOfflineEnhancedIndex,
    googleShoppingIndex,
    googleAppIndex,
  } = requiredSourceIndexes;
  const used = new Set<number>();
  const citation = (index: number) => {
    used.add(index);
    return `[S${index + 1}]`;
  };

  const objectiveRef = citation(googleObjectivesIndex);
  const typesRef = citation(googleTypesIndex);
  const leadRef = citation(googleLeadAvailabilityIndex);
  const conversionGoalRef = citation(googleConversionGoalsIndex);
  const webConversionRef = citation(googleWebConversionIndex);
  const offlineRef = citation(googleOfflineEnhancedIndex);
  const shoppingRef = citation(googleShoppingIndex);
  const appRef = citation(googleAppIndex);

  const lines = [
    'Google Ads 상품은 개별 이름을 외우기보다 **캠페인 목표 → 캠페인 유형 → 광고/애셋 → 전환 측정** 순서로 보는 편이 실무적입니다.',
    '공식 도움말 기준의 주요 축은 검색, 디스플레이, 동영상, 쇼핑, 앱, 실적 최대화 캠페인이며, 리드 양식·상품 피드·앱 애셋·전환 목표가 목적에 따라 붙습니다.',
    '',
    '**1. 캠페인 유형별 구조**',
    '',
    '| 유형 | 주 목적 | 실무에서 확인할 것 |',
    '|---|---|---|',
    `| 검색 캠페인 | 이미 검색 의도가 있는 수요를 포착합니다. | 키워드/검색어, 광고 문구, 랜딩, 전환 목표를 함께 봅니다. Google Ads는 목표를 먼저 정하고 목표에 맞는 캠페인 유형과 기능을 조합합니다 ${objectiveRef}. |`,
    `| 디스플레이 캠페인 | 이미지·텍스트 조합으로 넓은 지면에 노출합니다. | 지면, 소재 애셋, 리마케팅/관심 기반 도달, 전환 측정을 분리해 봅니다. 캠페인 유형마다 노출 지면, 광고 형식, 입찰과 애셋 요구사항이 달라집니다 ${typesRef}. |`,
    `| 동영상/YouTube 캠페인 | 영상 시청, 브랜드 도달, 리드 확장에 활용합니다. | 동영상 애셋, YouTube 지면, 리드 양식 가능 여부, 전환 중심 입찰 조건을 확인합니다 ${typesRef} ${leadRef}. |`,
    `| 실적 최대화 / PMax | 여러 Google 지면을 자동화로 묶어 전환을 키울 때 후보입니다. | 애셋 그룹, 전환 목표, 오프라인/향상된 전환 피드백이 있어야 품질 좋은 학습이 가능합니다 ${typesRef} ${conversionGoalRef} ${offlineRef}. |`,
    `| 쇼핑 광고 | 상품 이미지, 제목, 가격, 매장명 같은 상품 정보를 노출합니다. | Merchant Center 상품 데이터, 상품 피드 품질, 정책 준수, 쇼핑/PMax 전환 목표를 함께 점검합니다 ${shoppingRef}. |`,
    `| 앱 캠페인 | 앱 설치와 앱 내 행동을 늘립니다. | Google 검색, Google Play, YouTube, Discover, 디스플레이 네트워크 전반 게재와 텍스트·이미지·동영상 애셋, 입찰, 전환 추적을 함께 확인합니다 ${appRef}. |`,
    `| 리드 양식 애셋 | 검색, 동영상, 실적 최대화, 디스플레이에서 잠재 고객 정보를 받을 때 붙입니다. | 개인정보처리방침, 정책 준수 내역, 리드 양식 전환 목표, 전환 중심 입찰, CRM 수신 구조를 확인합니다 ${leadRef} ${conversionGoalRef}. |`,
    '',
    '**2. 목표별 빠른 선택 기준**',
    '',
    `- **문의/상담 리드**: 리드 목표를 잡고 검색 캠페인, 리드 양식, 웹사이트 전환, PMax/동영상 리드 확장을 비교합니다 ${objectiveRef} ${leadRef}.`,
    `- **웹사이트 신청/구매 행동**: Google tag 또는 Google Analytics 연결을 확인하고 웹사이트 전환 액션을 만들어 리드 완료나 구매 행동을 측정합니다 ${webConversionRef}.`,
    `- **오프라인 상담/계약 성과**: 광고 클릭이나 전화 후 발생한 상담, 계약, 구매를 오프라인 전환 가져오기 또는 향상된 전환 리드로 되돌립니다 ${offlineRef}.`,
    `- **상품 판매**: 쇼핑 광고 또는 PMax에서 Merchant Center 상품 데이터와 전환 목표를 함께 봅니다 ${shoppingRef}.`,
    `- **앱 성장**: 앱 캠페인에서 앱 설치, 앱 내 행동, 애셋, 입찰과 전환 추적 설정을 함께 봅니다 ${appRef}.`,
    '',
    '**3. 런칭 전 공통 체크포인트**',
    '',
    '- 캠페인 목표가 실제 비즈니스 목표와 맞는지 먼저 확인합니다.',
    `- 캠페인 유형별로 필요한 광고 형식, 애셋, 입찰, 노출 지면이 다르므로 검색/디스플레이/동영상/쇼핑/앱/PMax를 한 묶음으로 보지 않습니다 ${typesRef}.`,
    `- 전환 목표는 전환 액션을 묶어 최적화하는 단위이고, Primary conversion action은 보고와 입찰 최적화에 쓰이므로 리드/구매/앱 행동을 잘못 Primary로 잡지 않도록 확인합니다 ${conversionGoalRef}.`,
    `- 리드나 계약 품질이 중요하면 웹사이트 전환, 오프라인 전환 가져오기, 향상된 전환 리드까지 연결해야 합니다 ${webConversionRef} ${offlineRef}.`,
    '',
    '정리하면, Google Ads는 **검색/디스플레이/동영상/PMax/쇼핑/앱**이라는 캠페인 유형 위에 **리드 양식, 상품 피드, 앱 애셋, 전환 목표, 오프라인·향상된 전환**을 붙여 운영하는 구조로 정리하면 됩니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    matrixSources,
    used,
    'compass-answer-deterministic-google-product-planning-matrix',
    88,
  );
}

function prepareOfficialSnapshotAnswerSources(
  sources: ReturnType<typeof buildVerifiedSources>,
  chunkIds: readonly string[],
) {
  const requiredChunkIds = uniqueOfficialChunkIds(chunkIds);
  const scenarioSources = ensureOfficialSnapshotSources(sources, requiredChunkIds);
  const indexes = getRequiredOfficialSnapshotIndexes(scenarioSources, requiredChunkIds);
  if (!indexes) return null;

  const sourceIndexByChunkId = new Map(requiredChunkIds.map((chunkId, index) => [
    chunkId,
    indexes[index],
  ]));
  const used = new Set<number>();
  const cite = (chunkId: string) => {
    const sourceIndex = sourceIndexByChunkId.get(chunkId);
    if (sourceIndex === undefined) return '[S1]';
    used.add(sourceIndex);
    return `[S${sourceIndex + 1}]`;
  };

  return { sources: scenarioSources, used, cite };
}

function buildKakaoProductSelectionMatrixAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const prepared = prepareOfficialSnapshotAnswerSources(sources, KAKAO_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const momentRef = cite('kakao_moment_product_overview_2026_chunk_0');
  const bizboardRef = cite('doc_1774488483929_bigcm1d_chunk_2');
  const displayRef = cite('doc_1774488184369_r97sach_chunk_0');
  const catalogRef = cite('kakao_product_catalog_2026_chunk_0');
  const guaranteedRef = cite('kakao_guaranteed_cpt_2026_chunk_0');
  const searchRef = cite('kakao_searchad_product_catalog_2026_chunk_0');
  const brandGuideRef = cite('kakao_brandsearch_content_guide_2026_chunk_0');
  const channelGuideRef = cite('kakao_channelsearch_content_guide_2026_chunk_0');
  const channelRef = cite('url_1773203880202_q3y8fucqb_chunk_5');
  const messageRef = cite('doc_1774491147517_yj1v810_chunk_17');
  const policyRef = cite('doc_1774488207473_cjq6ve0_chunk_19');

  const lines = [
    '카카오 광고 상품은 목적과 접점에 따라 **성과형/보장형/검색형/메시지형/상품 카탈로그형**으로 구분해 선택합니다.',
    `카카오모먼트는 비즈보드, 디스플레이, 동영상, 메시지 광고, 상품 카탈로그 광고처럼 카카오 핵심 서비스 지면을 활용하는 상품 축을 포함합니다 ${momentRef} ${catalogRef}. 검색 광고 쪽은 키워드광고, 브랜드검색, 톡채널검색으로 따로 봐야 합니다 ${searchRef}.`,
    '',
    '**1. 상품명 기준 비교**',
    '',
    '| 상품 | 우선 검토 상황 | 소재/지면 확인 항목 | 운영 기준 |',
    '|---|---|---|---|',
    `| 카카오 비즈보드 | 카카오톡 기반 대량 도달, 신상품/프로모션, 브랜드 인지와 랜딩 유입을 함께 노릴 때 | 카카오톡·카카오서비스 주요 지면, 소재 유형, 랜딩 옵션을 봅니다 ${bizboardRef}. | 카카오 서비스처럼 오인되는 UI·로고·디자인 모방과 허위·과장 표현을 피합니다 ${policyRef}. |`,
    `| 디스플레이 광고 | 관심사/오디언스 기반 배너·이미지·동영상 노출, 리타게팅, 퍼포먼스 확장이 필요할 때 | 카카오 핵심 서비스와 파트너 지면, 이미지/동영상 소재 유형과 제작 가이드를 봅니다 ${displayRef}. | 지면 UI와 유사한 오인 표현, 업종 제한, 랜딩 불일치를 먼저 점검합니다 ${policyRef}. |`,
    `| 동영상 광고 | 영상 시청, 브랜드 임팩트, 짧은 영상 소재 반응을 보고 싶을 때 | 카카오모먼트 안에서 동영상 소재와 노출 지면을 목적별로 분리합니다 ${momentRef}. | 조회 KPI와 클릭/전환 KPI를 한 캠페인에서 섞지 않고, 랜딩 또는 채널 전환을 별도 확인합니다. |`,
    `| 상품 카탈로그 광고 | 상품 연동 기반으로 구매 가능성이 높은 사용자에게 리타게팅·추천 광고를 노출하고 싶을 때 | 상품 연동, 다이내믹 광고, 구매 전환 목적, CPC 과금 구조를 봅니다 ${catalogRef}. | 상품 정보, 가격·혜택, 랜딩 상품 정보가 일치하는지 확인하고 전환 이벤트 품질을 봅니다. |`,
    `| 카카오톡 채널 메시지/메시지 광고 | 보유 고객, 친구, 채널 기반으로 쿠폰, 예약, 재구매, 이벤트 안내를 직접 보내야 할 때 | 메시지 내용, 가격·혜택 표시, 이벤트 조건, 랜딩 일치 여부를 봅니다 ${messageRef}. | 관계 법령 위반, 성인·담배·도박·의약품 등 제한 업종은 발송 불가 또는 제한 가능성이 있습니다 ${messageRef}. |`,
    `| 키워드광고 | 카카오 검색 지면에서 검색 의도 기반 유입을 확보하고 싶을 때 | 키워드, 광고문안, 랜딩, 사업자 정보와 검색어 의도를 맞춥니다 ${searchRef}. | 검색어-소재-랜딩 불일치와 허위·과장 표현을 먼저 봅니다. |`,
    `| 브랜드검색 광고 | 브랜드 키워드 또는 브랜드 연관 키워드 검색 시 상단 정보성 콘텐츠를 보여주고 싶을 때 | 모바일 라이트, 모바일 오토플레이형, PC 베이직 등 템플릿별 이미지·동영상·CTA·랜딩URL을 봅니다 ${searchRef} ${brandGuideRef}. | 검토 완료 소재로만 집행하고, 브랜드와 직접 관련 없는 키워드 확장은 조심합니다. |`,
    `| 톡채널검색 | 카카오톡 검색에서 채널 발견, 상담, 예약, 재방문, 콘텐츠 구독을 모아야 할 때 | 추천소재/맞춤소재, 채널명, 썸네일, 홍보문구, 행동유도버튼, 랜딩URL을 확인합니다 ${channelGuideRef}. | 채널과 연동 사이트의 사업자 정보, 소재와 랜딩의 일치, 등록불가 사이트 조건을 봅니다 ${channelRef}. |`,
    `| 보장형 광고/카카오비즈보드 CPT | 특정 시간대 대형 지면 점유, 대규모 브랜딩 임팩트와 도달 보장이 필요할 때 | 카카오톡 친구탭의 주목도 높은 영역을 일정 시간 단독 점유하는 CPT 구조를 봅니다 ${guaranteedRef}. | 성과형 CPC 캠페인과 KPI를 섞지 말고 도달, 점유 시간, 이벤트 유입을 별도로 봅니다. |`,
    '',
    '**2. 업종별 빠른 판단**',
    '',
    '- **지역 매장/예약형**: 톡채널검색, 채널 메시지, 비즈보드 랜딩을 후보로 두고 상담 가능 시간과 채널 응답 SLA를 먼저 잡습니다.',
    '- **커머스/프로모션형**: 상품 카탈로그 광고, 비즈보드, 디스플레이를 후보로 두고 가격, 할인율, 이벤트 조건이 랜딩과 일치하는지 먼저 봅니다.',
    '- **금융·의료·성인·주류·담배 등 제한 가능 업종**: 소재부터 만들기 전에 제한 업종과 등록불가 조건을 원문 기준으로 확인합니다.',
    '- **브랜드 인지/신제품 런칭**: 카카오비즈보드 CPT, 비즈보드, 브랜드검색, 디스플레이를 우선 검토하고 메시지는 리타게팅 또는 보유 고객 재접촉 용도로 분리합니다.',
    '',
    '**3. 런칭 전 체크리스트**',
    '',
    '- 상품명보다 먼저 KPI를 정합니다: 도달/빈도, 클릭, 채널 추가, 상담, 구매, 재방문을 분리합니다.',
    '- 카카오톡 지면에서 광고처럼 명확히 보이는지 확인합니다. 카카오 UI·서비스를 모방하면 집행 제한 가능성이 있습니다.',
    '- 가격, 이벤트, 혜택은 소재와 랜딩에서 같은 조건으로 확인되어야 합니다.',
    '- 상품 카탈로그형은 상품 연동과 구매 전환, 검색형은 키워드·템플릿·랜딩, 메시지형은 발송 가능 업종과 수신자 맥락을 별도 체크합니다.',
    '- 제한 업종은 상품 기능 문제가 아니라 심사·정책 문제이므로 별도 체크리스트로 분리합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-kakao-product-selection-matrix',
    86,
  );
}

function isKakaoProductSelectionMatrixFastIntent(message: string, intent: QueryIntent): boolean {
  const normalized = normalizeProductIntentText(message);
  const compact = normalized.replace(/\s+/g, '');
  const hasKakaoAnchor = (
    intent.vendors.includes('KAKAO')
    || /카카오|kakao|카카오톡|카카오비즈니스|비즈보드|톡채널검색|카카오모먼트/.test(normalized)
  );
  if (!hasKakaoAnchor) return false;

  const namesExplicitOtherVendor = /메타|meta|구글|google|네이버|naver/.test(normalized);
  const startsAsKakaoProductQuestion = /^(?:카카오|kakao)\s*(?:광고|ads?)?\s*(?:상품|광고\s*상품)/.test(normalized);
  if (namesExplicitOtherVendor && !startsAsKakaoProductQuestion) return false;

  const hasProductQuestionShape = (
    intent.topics.includes('product_structure')
    || /광고\s*상품|상품\s*(유형|종류|구분|가이드|별)|상품별|상품명|상품군|기준으로\s*(비교|정리|구분)|비교\s*정리|선택\s*기준/.test(normalized)
  );
  if (!hasProductQuestionShape) return false;

  const productSignals = [
    /비즈보드|카카오\s*비즈보드|카카오비즈보드|톡보드/.test(normalized),
    /디스플레이|카카오모먼트|모먼트/.test(normalized),
    /동영상|비디오|video/.test(normalized),
    /상품\s*카탈로그|상품카탈로그|catalog|카탈로그/.test(normalized),
    /메시지|친구톡|알림톡|채널\s*메시지/.test(normalized),
    /키워드\s*광고|키워드광고/.test(normalized),
    /브랜드\s*검색|브랜드검색/.test(normalized),
    /톡\s*채널\s*검색|톡채널검색|채널검색/.test(normalized),
    /보장형|cpt|guarantee/.test(normalized),
  ];
  const signalCount = productSignals.filter(Boolean).length;
  const singleNamedProductQuestion = hasNamedSpecificProductQuestion(message)
    && !isExplicitWholeProductCatalogQuestion(message)
    && signalCount <= 1
    && !/비교|차이|구분|나눠|나누|목록|종류|유형|전체|상품별|기준으로\s*(비교|정리|구분|설명)|비즈보드.*디스플레이|디스플레이.*비즈보드/.test(normalized);
  if (singleNamedProductQuestion) return false;

  return signalCount >= 2
    || (
      /카카오/.test(normalized)
      && /상품별|상품\s*(유형|종류|가이드|명)|광고\s*상품/.test(normalized)
      && /제작|소재|가이드|비교|기준|정리|알려/.test(normalized)
    )
    || /비즈보드.*디스플레이|디스플레이.*비즈보드|톡채널검색|브랜드검색|키워드광고|상품카탈로그|보장형|cpt/.test(compact);
}

function buildPreRetrievalDeterministicProductAnswer(
  message: string,
  intent: QueryIntent,
): DeterministicProductAnswer | null {
  if (isKakaoProductSelectionMatrixFastIntent(message, intent)) {
    return buildKakaoProductSelectionMatrixAnswer([]);
  }
  if (isAssetGuideProductQuestion(message) && intent.vendors.length >= 3) {
    return buildCrossVendorProductAssetGuideAnswer([]);
  }
  if (
    isAssetGuideProductQuestion(message)
    && intent.vendors.length === 2
    && intent.vendors.includes('NAVER')
    && intent.vendors.includes('KAKAO')
  ) {
    return buildNaverKakaoAssetGuideComparisonAnswer([]);
  }
  if (
    isAssetGuideProductQuestion(message)
    && intent.vendors.length === 2
    && intent.vendors.includes('META')
    && intent.vendors.includes('GOOGLE')
  ) {
    return buildMetaGoogleProductAssetGuideAnswer([]);
  }
  if (isAssetGuideProductQuestion(message) && intent.vendors.length === 1 && intent.vendors[0] === 'META') {
    return buildMetaAssetGuideProductAnswer([]);
  }
  if (isAssetGuideProductQuestion(message) && intent.vendors.length === 1 && intent.vendors[0] === 'GOOGLE') {
    return buildGoogleAssetGuideProductAnswer([]);
  }

  return null;
}

function buildNaverSearchAdProductComparisonAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const prepared = prepareOfficialSnapshotAnswerSources(sources, NAVER_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const overviewRef = cite('naver_searchad_overview_powerlink_brand_2026_chunk_0');
  const powerlinkRef = cite('naver_powerlink_product_overview_2026_chunk_0');
  const brandRef = cite('naver_brandsearch_product_overview_2026_chunk_0');
  const shoppingBlockRef = cite('doc_1764895552052_8xy5ad6_para_2');
  const shoppingDbRef = cite('doc_1773710116296_uawf5xm_chunk_2');
  const advoostRef = cite('doc_1764922396107_b9w41zn_chunk_5');
  const displayProductRef = cite('naver_display_product_catalog_2026_chunk_0');
  const chzzkRef = cite('naver_chzzk_product_catalog_2026_chunk_0');
  const headlineDaRef = cite('doc_1764895606547_buwpoz4_sent_11');
  const shortformRef = cite('doc_1764895606613_llkwwsf_doc_0');
  const policyRef = cite('naver_adguide_registration_standard_2026_chunk_0');

  const lines = [
    '네이버 광고 상품은 검색 유입, 쇼핑/상품 DB, 성과형 디스플레이, 영상/신규 지면으로 나눠 목적별로 선택합니다.',
    `네이버 검색광고 축에는 파워링크, 쇼핑검색광고, 파워컨텐츠, 브랜드검색광고, 신제품검색광고, 플레이스검색광고, 지역소상공인광고, 서칭뷰가 포함됩니다 ${overviewRef}. 디스플레이 축에는 ADVoost 쇼핑, 인지도 및 트래픽 광고, 웹사이트 전환 광고, 앱 전환 광고, 카탈로그 판매, 쇼핑 프로모션, 동영상 조회 광고, 커뮤니케이션 애드가 포함됩니다 ${displayProductRef}.`,
    '',
    '**1. 상품명 기준 비교**',
    '',
    '| 상품 | 우선 검토 상황 | 소재/데이터 확인 항목 | 운영·측정 기준 |',
    '|---|---|---|---|',
    `| 파워링크/사이트검색 | 검색 의도가 있는 사용자를 웹사이트, 상담, 예약, 구매 페이지로 보내는 기본 검색 유입 | 키워드, 제목, 설명, 표시 URL, 확장 소재, 랜딩 관련성을 봅니다 ${powerlinkRef}. | CPC, 입찰, 예산, 검색어-광고문안-랜딩 일치, 전환 스크립트/로그 분석을 봅니다. |`,
    `| 쇼핑검색광고 | 상품 비교·구매 의도가 있는 사용자에게 상품 단위 노출이 필요할 때 | 상품명, 대표이미지, 가격, 배송비, 카테고리, 상품 DB URL/EP를 봅니다 ${shoppingDbRef}. | 상품 DB 수신, 카테고리 매칭, 미서비스 상품, 가격·재고 동기화, 구매 전환을 함께 봅니다. |`,
    `| 쇼핑블록 | 네이버 쇼핑 지면에서 상품형 노출과 구매 흐름을 강화할 때 | 쇼핑 지면, 상품 이미지, 상품명, 가격, 카테고리 검수 조건을 확인합니다 ${shoppingBlockRef}. | 쇼핑검색/쇼핑블록은 상품 DB 품질과 가격비교 반영 지연이 병목이 될 수 있습니다. |`,
    `| 브랜드검색광고 | 상호명, 상품명처럼 브랜드 키워드 검색 결과에서 브랜드 정보를 크게 보여줄 때 | 브랜드명, 대표 이미지/동영상, 주요 링크, 프로모션 문구와 템플릿을 활용합니다 ${brandRef}. | 브랜드와 직접 연관된 키워드인지, 공식 랜딩과 프로모션 문구가 정확한지 확인합니다. |`,
    `| 파워컨텐츠 | 정보 탐색형 검색 수요에 콘텐츠형 소재로 설명과 신뢰를 먼저 전달해야 할 때 | 검색어 intent, 콘텐츠 제목·설명, 랜딩 콘텐츠 품질을 봅니다 ${overviewRef}. | 단순 구매 문구보다 정보성 콘텐츠와 랜딩 신뢰도가 중요합니다. |`,
    `| 신제품검색광고 | 신제품 출시, 신규 카테고리 인지, 초기 검색 수요 확보가 필요할 때 | 신제품명, 대표 이미지, 출시 메시지, 랜딩 정보를 확인합니다 ${overviewRef}. | 브랜드/제품명 검색량과 공식 정보 일치, 허위·과장 가능성을 봅니다 ${policyRef}. |`,
    `| 플레이스검색광고/지역소상공인광고 | 지역 매장, 병원, 학원, 예약형 업종처럼 위치 기반 문의가 중요할 때 | 상호, 위치, 영업정보, 예약·전화 랜딩, 지도/플레이스 정보를 봅니다 ${overviewRef}. | 지역 타겟, 영업시간, 전화·예약 전환, 플레이스 정보 최신성을 확인합니다. |`,
    `| 서칭뷰 | 검색 과정에서 더 시각적인 탐색 경험과 브랜드/상품 발견을 강화하고 싶을 때 | 검색 지면 내 노출 맥락, 이미지·영상형 소재, 랜딩을 확인합니다 ${overviewRef}. | 검색 의도와 소재 경험이 맞지 않으면 클릭 후 이탈이 커질 수 있습니다. |`,
    `| ADVoost 쇼핑 | 쇼핑 광고를 AI 기반으로 쉽게 시작하고 자동 최적화하고 싶을 때 | 비즈채널 선택, 하루 예산, 상품/전환 조건, AI 자동 최적화 구조를 봅니다 ${advoostRef}. | 쉬운 세팅만 믿지 말고 상품 DB 품질, 전환 추적, 가격·재고 품질을 같이 봅니다. |`,
    `| 인지도 및 트래픽/웹사이트 전환/앱 전환 | 디스플레이 지면에서 도달, 방문, 전환, 앱 행동을 목적별로 분리하고 싶을 때 | 배너, 동영상, 이미지 소재와 타겟팅, 실시간 입찰 방식을 봅니다 ${displayProductRef}. | 목적별 전환 태그, 랜딩 속도, 앱 이벤트, 지면별 소재 피로도를 분리합니다. |`,
    `| 카탈로그 판매/쇼핑 프로모션 | 상품 수가 많고 상품 데이터 기반 커머스 확장이 필요할 때 | 상품 데이터, 상품군, 프로모션 문구, 가격·재고 반영을 봅니다 ${displayProductRef}. | 구매/장바구니/상품조회 이벤트와 상품 데이터 매칭 품질을 봅니다. |`,
    `| 동영상 조회 광고/숏폼 아웃스트림/네이버 클립 | 영상 조회, 브랜드 관심, 숏폼 소재 반응을 확보하고 싶을 때 | 숏폼/동영상 비율, 네이버 클립·아웃스트림 지면, 첫 화면 메시지를 봅니다 ${shortformRef}. | 조회 KPI와 전환 KPI를 섞지 말고, 랜딩 연결은 별도 전환으로 봅니다. |`,
    `| 커뮤니케이션 애드 | 상담, 채팅, 문의처럼 대화형 접점과 사용자 반응을 유도해야 할 때 | 메시지/문의 진입, CTA, 상담 가능 시간, 응답 SLA를 봅니다 ${displayProductRef}. | 리드 품질, 상담 연결률, 중복 문의, 후속 CRM 등록을 KPI로 봅니다. |`,
    `| 치지직 전용 광고 | 게임·라이브·1030 타겟처럼 치지직 지면의 라이브/VOD 맥락을 활용할 때 | 인스트림 동영상 광고, 치지직 배너 광고, 치지직 프리미엄 라이브(beta)를 구분합니다 ${chzzkRef}. | 라이브/VOD/PC·모바일 홈/영상엔드/추천 라이브 영역별 노출 맥락과 게임 타겟 적합성을 봅니다. |`,
    `| 보장형 DA/헤드라인DA | 특정 지면 점유와 대형 노출로 브랜드 임팩트가 필요할 때 | PC 헤드라인DA, 홈피드, 스마트채널, 타임보드, 롤링보드 같은 지면과 소재 규격을 봅니다 ${headlineDaRef}. | 성과형 CPC와 보장형 노출 KPI를 섞지 말고 도달, 점유, 브랜드 검색량을 따로 봅니다. |`,
    '',
    '**2. 운영 선택 기준**',
    '',
    '- **즉시 문의/예약/구매 유입**: 파워링크, 플레이스검색광고, 커뮤니케이션 애드를 목적에 맞춰 비교합니다.',
    '- **SKU 기반 커머스**: 쇼핑검색광고, 쇼핑블록, ADVoost 쇼핑, 카탈로그 판매, 쇼핑 프로모션을 상품 DB·가격·재고 품질 기준으로 봅니다.',
    '- **브랜드 방어/인지 강화**: 브랜드검색광고, 신제품검색광고, 보장형 DA, 헤드라인DA, 동영상 조회 광고를 후보로 둡니다.',
    '- **영상/게임/라이브 맥락**: 치지직 전용 광고, 숏폼 아웃스트림, 네이버 클립 지면을 별도 후보로 봅니다.',
    '- **심사·정책 리스크**: 네이버 광고등록기준은 법령 위반, 허위·과장, 이용자 오인, 권리 침해 가능성을 소재·랜딩·업종 맥락과 함께 봅니다 ' + policyRef + '.',
    '',
    '**3. 런칭 전 체크포인트**',
    '',
    '- 키워드별 광고문안과 랜딩 URL이 같은 의도를 말하는지 확인합니다.',
    '- 쇼핑검색은 DB URL, EP, 상품정보 수신, 카테고리 자동매칭, 미서비스 상품 여부를 먼저 봅니다.',
    '- 디스플레이·성과형 상품은 목적별 전환 태그와 소재 피로도, 지면별 노출 맥락을 분리합니다.',
    '- 치지직/숏폼/클립처럼 신규 지면 성격이 강한 상품은 도달·조회와 전환을 따로 평가합니다.',
    '- 같은 CPC라도 파워링크는 검색어 품질, 쇼핑검색은 상품 데이터 품질, 브랜드검색은 브랜드 키워드 커버리지, ADVoost 쇼핑은 데이터·전환 품질이 병목입니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-naver-search-product-comparison',
    86,
  );
}

function buildEcommerceProductFeedComparisonAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const requiredChunkIds = uniqueOfficialChunkIds([
    'doc_1773886203371_8rlmmdv_chunk_1',
    'doc_1773886203371_8rlmmdv_chunk_2',
    'google_ads_shopping_ads_2026_chunk_0',
    'doc_1764895552052_8xy5ad6_para_2',
    'doc_1773710116296_uawf5xm_chunk_2',
    ...KAKAO_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS,
  ]);
  const prepared = prepareOfficialSnapshotAnswerSources(sources, requiredChunkIds);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const metaCatalogRef = cite('doc_1773886203371_8rlmmdv_chunk_1');
  const metaAdvantageRef = cite('doc_1773886203371_8rlmmdv_chunk_2');
  const googleShoppingRef = cite('google_ads_shopping_ads_2026_chunk_0');
  const naverShoppingRef = cite('doc_1764895552052_8xy5ad6_para_2');
  const naverDbRef = cite('doc_1773710116296_uawf5xm_chunk_2');
  const kakaoBizboardRef = cite('doc_1774488483929_bigcm1d_chunk_2');
  const kakaoDisplayRef = cite('doc_1774488184369_r97sach_chunk_0');
  const kakaoCatalogRef = cite('kakao_product_catalog_2026_chunk_0');
  const kakaoPolicyRef = cite('doc_1774491147517_yj1v810_chunk_17');

  const lines = [
    '쇼핑몰 광고는 매체별 이름보다 **상품 데이터 구조 → 소재 생성 방식 → 전환 추적 → 가격·재고 운영**을 먼저 맞춰야 합니다.',
    '',
    '**1. 매체별 비교**',
    '',
    '| 매체/상품 | 상품 피드·데이터 | 소재 운영 | 전환 추적 | 재고·가격 관리 포인트 |',
    '|---|---|---|---|---|',
    `| Google 쇼핑/PMax | Merchant Center 상품 데이터를 사용해 상품 이미지, 제목, 가격, 매장명 등을 노출합니다 ${googleShoppingRef}. | 상품 데이터 품질과 정책 준수, 쇼핑 캠페인 또는 PMax 전환 목표를 함께 봅니다 ${googleShoppingRef}. | 구매, 장바구니, 리드 등 Primary conversion action과 오프라인/향상된 전환 연결을 점검합니다. | 피드 불승인, 가격 불일치, 품절 반영 지연이 성과 급락 원인이 됩니다. |`,
    `| Meta 카탈로그/컬렉션 | 카탈로그의 작은 제품 이미지와 커버 이미지/동영상을 함께 보여 구매 흐름으로 연결합니다 ${metaCatalogRef}. | 컬렉션, 카탈로그, Advantage+ 카탈로그를 SKU 수와 리타게팅 목적에 맞춰 선택합니다 ${metaAdvantageRef}. | Pixel/CAPI, 구매·장바구니 이벤트, 상품 세트와 웹사이트 전환 측정을 묶어 봅니다. | 상품 세트, 품절·가격 동기화, 이벤트 매칭 품질이 중요합니다. |`,
    `| 네이버 쇼핑검색광고 | EP 또는 상품 DB URL 등록, 상품정보 수신, 카테고리 자동매칭이 핵심입니다 ${naverDbRef}. | 쇼핑블록/쇼핑검색은 상품 이미지, 상품명, 가격, 카테고리, 쇼핑 지면 검수 조건을 봅니다 ${naverShoppingRef}. | 스마트스토어/쇼핑파트너센터, 로그 분석, 구매 전환 또는 랜딩 전환을 함께 봅니다. | 상품 DB 수신 오류, 미서비스 상품, 카테고리 불일치, 가격비교 업데이트 지연을 점검합니다. |`,
    `| 카카오 상품 카탈로그/커머스형 운영 | 카카오 상품 카탈로그 광고는 상품 연동을 통해 구매 전환 가능성이 높은 사용자에게 리타게팅·추천 광고를 노출하는 다이내믹 광고입니다 ${kakaoCatalogRef}. Google Merchant Center나 네이버 EP와 같은 운영 화면으로 동일시하지 말고 카카오 상품 연동 구조로 봅니다. | 비즈보드/디스플레이/메시지 소재의 가격·혜택·이벤트 문구가 랜딩과 일치해야 합니다 ${kakaoBizboardRef} ${kakaoDisplayRef}. | 구매 전환 목적, CPC 과금, 리타게팅/추천 노출, 전환 이벤트 품질을 함께 확인합니다 ${kakaoCatalogRef}. | 제한 업종, 가격 표시, 인터넷 판매 불가 상품은 메시지/소재 발송 제한과 연결될 수 있습니다 ${kakaoPolicyRef}. |`,
    '',
    '**2. 실행 순서**',
    '',
    '- 상품 수가 많고 가격·재고가 자주 바뀌면 Google 쇼핑, Meta 카탈로그, 네이버 쇼핑검색처럼 데이터 기반 상품부터 우선 검토합니다.',
    '- SKU가 적거나 신제품 메시지가 중요하면 수동 소재형 캠페인과 랜딩 품질을 먼저 검증합니다.',
    '- 구매 최적화 전에는 구매/장바구니/상세조회 이벤트가 상품 ID와 맞는지 확인합니다.',
    '- 품절·가격 불일치, DB 수신 오류, 정책 불승인은 입찰보다 먼저 점검합니다.',
    '',
    '정리하면, 쇼핑몰 광고는 **Google = Merchant Center 상품 데이터, Meta = 카탈로그/컬렉션/Advantage+ 카탈로그, Naver = 상품 DB/EP와 쇼핑 지면, Kakao = 상품 카탈로그 광고/카카오 지면·소재·심사 범위**로 역할을 나누어 설계하는 것이 안전합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-ecommerce-product-feed-comparison',
    88,
  );
}

function buildCrossVendorBudgetFrameworkAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const prepared = prepareOfficialSnapshotAnswerSources(sources, CROSS_VENDOR_PRODUCT_OPERATING_REQUIRED_CHUNK_IDS);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const metaObjectiveRef = cite('meta_business_help_objectives_2026_chunk_0');
  const metaFormatRef = cite('meta_business_help_formats_placements_2026_chunk_0');
  const googleObjectiveRef = cite('google_ads_campaign_objectives_2026_chunk_0');
  const googleTypesRef = cite('google_ads_campaign_types_2026_chunk_0');
  const naverOverviewRef = cite('naver_searchad_overview_powerlink_brand_2026_chunk_0');
  const naverShoppingRef = cite('doc_1773710116296_uawf5xm_chunk_2');
  const kakaoMomentRef = cite('kakao_moment_product_overview_2026_chunk_0');
  const kakaoBizboardRef = cite('doc_1774488483929_bigcm1d_chunk_2');

  const lines = [
    'Meta, Google Ads, 네이버, 카카오는 같은 “광고비”로 묶으면 안 됩니다. **신규 고객 확보와 리타겟팅 역할, 학습 데이터, 검색 의도, 소재 피로도, 측정 KPI**를 분리해 예산을 배분해야 합니다.',
    '',
    '**1. 역할별 예산 배분 프레임**',
    '',
    '| 매체 | 신규 고객 확보 역할 | 리타겟팅 역할 | 장점 | 주의점 | 핵심 KPI |',
    '|---|---|---|---|---|---|',
    `| Meta | 인지도, 트래픽, 참여, 잠재 고객, 앱 홍보, 판매 목표를 활용해 발견형 수요를 만듭니다 ${metaObjectiveRef}. | Pixel/CAPI, 카탈로그, 참여자·방문자 기반으로 재접촉합니다. | 피드·스토리·릴스 등 지면과 이미지/동영상/카루셀/컬렉션 형식 조합이 넓습니다 ${metaFormatRef}. | 소재 피로도와 낮은 의도 유입을 분리해 봐야 합니다. | 도달, 빈도, CTR, CPC, 리드 수, 구매, CPA, ROAS |`,
    `| Google Ads | 검색, 디스플레이, 동영상, 쇼핑, 앱, PMax 등 캠페인 유형으로 의도형 수요와 확장 도달을 나눕니다 ${googleTypesRef}. | 검색 리마케팅, YouTube/디스플레이, PMax 신호, 오프라인/향상된 전환 피드백을 활용합니다. | 검색 의도와 전환 목표를 캠페인 유형에 직접 묶기 좋습니다 ${googleObjectiveRef}. | Primary conversion action을 잘못 잡으면 쉬운 전환에 최적화됩니다. | 검색 점유, 전환율, CPA, ROAS, 오프라인 전환율 |`,
    `| 네이버 | 파워링크/쇼핑검색/브랜드검색으로 검색 의도와 상품 비교 수요를 포착합니다 ${naverOverviewRef}. | 브랜드검색, 재방문 검색어, 쇼핑 상품 DB 기반으로 하단 퍼널을 보강합니다. | 국내 검색·쇼핑 의도와 상품 DB/카테고리 매칭을 연결하기 좋습니다 ${naverShoppingRef}. | 상품 DB, 랜딩 품질, 가격·재고 반영이 병목입니다. | 검색어별 CVR, 쇼핑상품 클릭률, 구매율, 브랜드 검색량 |`,
    `| 카카오 | 카카오모먼트, 비즈보드, 디스플레이, 메시지로 카카오톡 기반 도달과 상담·재방문 접점을 만듭니다 ${kakaoMomentRef}. | 메시지/채널/방문자 기반으로 쿠폰, 예약, 재구매 안내에 활용합니다. | 카카오톡 주요 지면과 모바일 발견 경험이 강합니다 ${kakaoBizboardRef}. | 업종 제한과 카카오 서비스 오인, 메시지 발송 정책을 먼저 봐야 합니다. | 도달, 클릭, 채널 추가, 상담, 쿠폰 사용, 재구매율 |`,
    '',
    '**2. 예산 운영 규칙**',
    '',
    '- 고정 비율보다 “신규/리타게팅/브랜드 방어/상품 판매” 역할별 예산 통을 나눕니다.',
    '- 신규 확보는 Meta·Kakao의 발견형 도달과 Google·Naver의 검색 의도를 분리해 비교합니다.',
    '- 리타겟팅은 전체 예산을 크게 먹기보다 전환 모수가 충분한 범위에서 빈도와 CPA를 관리합니다.',
    '- SKU 커머스는 Google 쇼핑, Meta 카탈로그, Naver 쇼핑검색처럼 상품 데이터 품질이 있는 매체에 우선권을 줍니다.',
    '- 상담/예약형은 Meta 리드/메시지, Kakao 채널/메시지, Google/Naver 검색 리드를 같은 CRM 단계로 묶어 유효 리드율을 봅니다.',
    '',
    '**3. KPI 분리**',
    '',
    '- 신규 고객: 신규 방문자 비중, 첫 구매 CPA, 신규 리드율, 브랜드 신규 검색량.',
    '- 리타겟팅: 재방문 전환율, 장바구니 회수율, 빈도, 중복 노출, 리타게팅 CPA.',
    '- 매출: ROAS, 구매 전환율, 객단가, 마진 반영 CPA.',
    '- 품질: 유효 리드율, MQL/SQL, 상담 연결률, 반품/취소율, 오프라인 계약률.',
    '',
    '정리하면, 예산은 매체명이 아니라 **수요 창출, 의도 포착, 재접촉, 상품 판매, 브랜드 방어** 역할별로 배분하고, 매체별 KPI는 같은 CRM·매출 기준으로 다시 합쳐 평가해야 합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-cross-vendor-budget-framework',
    88,
  );
}

function buildPerformanceDropTroubleshootingAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const requiredChunkIds = uniqueOfficialChunkIds([
    ...CROSS_VENDOR_PRODUCT_OPERATING_REQUIRED_CHUNK_IDS,
    'doc_1773663427417_g8z1v3y_chunk_2',
  ]);
  const prepared = prepareOfficialSnapshotAnswerSources(sources, requiredChunkIds);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const metaLevelRef = cite('meta_business_help_ad_levels_2026_chunk_0');
  const metaFormatRef = cite('meta_business_help_formats_placements_2026_chunk_0');
  const googleObjectiveRef = cite('google_ads_campaign_objectives_2026_chunk_0');
  const googlePolicyRef = cite('doc_1773663427417_g8z1v3y_chunk_2');
  const naverPolicyRef = cite('naver_adguide_registration_standard_2026_chunk_0');
  const naverDbRef = cite('doc_1773710116296_uawf5xm_chunk_2');
  const kakaoPolicyRef = cite('doc_1774488207473_cjq6ve0_chunk_19');
  const kakaoChannelRef = cite('url_1773203880202_q3y8fucqb_chunk_5');

  const lines = [
    '광고 성과가 갑자기 떨어지면 “소재가 별로다”부터 보면 늦습니다. **측정 이상 → 정책/심사 제한 → 예산·입찰 → 타겟/지면 → 소재 → 랜딩/피드/재고 → 최근 변경사항** 순서로 좁히는 편이 안전합니다.',
    '',
    '**1. 공통 점검 순서**',
    '',
    '| 순서 | 확인 항목 | 왜 먼저 보나 |',
    '|---|---|---|',
    '| 1 | 전환 태그/이벤트/CRM 수신 | 측정이 깨지면 실제 성과가 정상이어도 알고리즘과 보고서가 모두 흔들립니다. |',
    `| 2 | 정책 제한/심사/계정 상태 | Google은 정책 위반 시 비승인, 위치 제한, 계정 정지까지 이어질 수 있습니다 ${googlePolicyRef}. 네이버와 카카오도 소재·랜딩·업종 맥락 심사가 중요합니다 ${naverPolicyRef} ${kakaoPolicyRef}. |`,
    '| 3 | 예산/입찰/전환 목표 | 예산 소진, 입찰 제한, 잘못된 전환 목표는 노출과 학습을 동시에 줄입니다. |',
    '| 4 | 타겟/지면/검색어 | 오디언스 축소, 검색어 변화, 지면 제외가 도달을 줄일 수 있습니다. |',
    '| 5 | 소재 피로도 | CTR 하락, 빈도 상승, 댓글/반응 악화는 소재 교체 신호입니다. |',
    '| 6 | 랜딩/상품 피드/재고 | 랜딩 속도, 상품 DB 오류, 가격·품절 반영 지연은 구매율을 떨어뜨립니다. |',
    '',
    '**2. 매체별 체크리스트**',
    '',
    `- **Meta**: 캠페인-광고 세트-광고 단위 구조에서 예산·일정·타겟·게재 위치가 어디에서 바뀌었는지 먼저 봅니다 ${metaLevelRef}. 이어서 피드/스토리/릴스별 소재 형식과 게재 위치가 목표와 맞는지 확인합니다 ${metaFormatRef}.`,
    `- **Google Ads**: 캠페인 목표와 캠페인 유형, Primary conversion action이 바뀌었는지 봅니다 ${googleObjectiveRef}. 정책 비승인·제한 상태, 쇼핑/PMax 피드 품질, 오프라인 전환 업로드 누락도 확인합니다.`,
    `- **네이버**: 검색어·키워드·입찰·랜딩을 먼저 보고, 쇼핑검색은 상품 DB URL, EP, 카테고리 매칭, 미서비스 상품, 가격비교 업데이트 상태를 점검합니다 ${naverDbRef}.`,
    `- **카카오**: 비즈보드/디스플레이/메시지 지면에서 카카오 서비스 오인, 제한 업종, AI 생성물 표시, 소재·랜딩 불일치가 없는지 확인합니다 ${kakaoPolicyRef}. 톡채널검색은 채널과 사이트 사업자 정보, 등록불가 사이트 조건도 봅니다 ${kakaoChannelRef}.`,
    '',
    '**3. 실무 판단 규칙**',
    '',
    '- 전환수만 떨어지고 클릭·도달은 정상: 태그, 이벤트, CRM, 랜딩 완료 페이지를 먼저 봅니다.',
    '- 도달과 클릭이 동시에 하락: 예산 소진, 입찰 제한, 정책 제한, 타겟/지면 축소를 먼저 봅니다.',
    '- CTR만 하락: 소재 피로도, 메시지 반복, 지면별 소재 비율을 확인합니다.',
    '- CVR만 하락: 랜딩 속도, 가격/재고, 상품 DB, 상담 응답 SLA를 확인합니다.',
    '- 특정 매체만 하락: 해당 매체의 정책/심사, 계정 상태, 최근 자동화 변경을 먼저 봅니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-performance-drop-troubleshooting',
    86,
  );
}

function buildNaverKakaoAssetGuideComparisonAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const requiredChunkIds = uniqueOfficialChunkIds([
    ...NAVER_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS,
    ...KAKAO_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS,
  ]);
  const prepared = prepareOfficialSnapshotAnswerSources(sources, requiredChunkIds);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const naverPowerlinkRef = cite('naver_powerlink_product_overview_2026_chunk_0');
  const naverBrandRef = cite('naver_brandsearch_product_overview_2026_chunk_0');
  const naverShoppingRef = cite('doc_1773710116296_uawf5xm_chunk_2');
  const naverDisplayCatalogRef = cite('naver_display_product_catalog_2026_chunk_0');
  const naverAdvoostRef = cite('doc_1764922396107_b9w41zn_chunk_5');
  const naverChzzkRef = cite('naver_chzzk_product_catalog_2026_chunk_0');
  const naverVideoRef = cite('doc_1764895606613_llkwwsf_doc_0');
  const kakaoMomentRef = cite('kakao_moment_product_overview_2026_chunk_0');
  const kakaoBizboardRef = cite('doc_1774488483929_bigcm1d_chunk_2');
  const kakaoDisplayRef = cite('doc_1774488184369_r97sach_chunk_0');
  const kakaoCatalogRef = cite('kakao_product_catalog_2026_chunk_0');
  const kakaoGuaranteedRef = cite('kakao_guaranteed_cpt_2026_chunk_0');
  const kakaoSearchRef = cite('kakao_searchad_product_catalog_2026_chunk_0');
  const kakaoBrandGuideRef = cite('kakao_brandsearch_content_guide_2026_chunk_0');
  const kakaoChannelGuideRef = cite('kakao_channelsearch_content_guide_2026_chunk_0');
  const kakaoMessageRef = cite('doc_1774491147517_yj1v810_chunk_17');
  const kakaoPolicyRef = cite('doc_1774488207473_cjq6ve0_chunk_19');

  const lines = [
    '네이버와 카카오 광고 상품·소재 가이드는 대분류만 말하면 부족합니다. 실무에서는 **실제 상품명 → 목적/지면 → 소재 제작 요소 → 심사·측정 체크** 순서로 정리해야 재사용할 수 있습니다.',
    '',
    '**1. 네이버 상품명 기준**',
    '',
    '| 상품 | 언제 쓰나 | 소재 제작에서 먼저 볼 것 | 심사·운영 체크 |',
    '|---|---|---|---|',
    `| 파워링크/사이트검색 | 검색 의도 기반 웹사이트 유입, 상담, 예약, 구매 전환을 받을 때 | 키워드, 제목/설명, 표시 URL, 확장 소재, 랜딩 관련성을 봅니다 ${naverPowerlinkRef}. | 검색어 intent와 랜딩 불일치, 허위·과장, 권리 침해 가능성을 점검합니다. |`,
    `| 쇼핑검색광고/쇼핑블록 | 상품 비교·구매 수요를 상품 단위로 받을 때 | 상품명, 대표이미지, 가격, 배송비, 카테고리, 상품 DB URL/EP를 봅니다 ${naverShoppingRef}. | DB 수신, 카테고리 매칭, 미서비스 상품, 가격·재고 동기화를 확인합니다. |`,
    `| 브랜드검색광고 | 브랜드 키워드 검색 결과에서 공식 브랜드 정보를 크게 보여줄 때 | 브랜드 키워드 자격, 브랜드 소재 템플릿, 이미지·동영상, 공식 랜딩을 봅니다 ${naverBrandRef}. | 브랜드와 직접 연관된 키워드인지, 소재가 지면별 규격을 만족하는지 확인합니다. |`,
    `| 파워컨텐츠/신제품검색광고/플레이스검색광고/지역소상공인광고/서칭뷰 | 정보 탐색, 신제품 노출, 지역 매장 유입, 검색 중 시각적 발견이 필요할 때 | 검색어 intent, 콘텐츠·상품·장소 정보, 랜딩 품질을 먼저 봅니다. 네이버 검색광고 상품 축에 함께 포함됩니다 ${cite('naver_searchad_overview_powerlink_brand_2026_chunk_0')}. | 정보성 콘텐츠, 신제품 주장, 지역 정보 최신성, 예약·전화 연결을 따로 점검합니다. |`,
    `| ADVoost 쇼핑 | 쇼핑 성과형 광고를 AI 기반 자동 최적화로 쉽게 시작하고 싶을 때 | 비즈채널, 하루 예산, 상품 데이터, 전환 조건, 자동 최적화 구조를 봅니다 ${naverAdvoostRef}. | 상품 DB·가격·재고·전환 추적 품질이 낮으면 자동화가 좋은 신호를 학습하기 어렵습니다. |`,
    `| 인지도 및 트래픽/웹사이트 전환/앱 전환/카탈로그 판매/쇼핑 프로모션/동영상 조회/커뮤니케이션 애드 | 디스플레이·성과형 지면에서 목적별 캠페인을 분리해야 할 때 | 배너, 동영상, 이미지 소재와 세밀한 타겟팅, 실시간 입찰, 목적별 전환 태그를 봅니다 ${naverDisplayCatalogRef}. | 커뮤니케이션 애드는 상담 SLA, 카탈로그/쇼핑형은 상품 데이터, 동영상 조회는 조회 KPI를 분리합니다. |`,
    `| 치지직 전용 광고 | 게임·라이브·1030 타겟, 치지직 라이브/VOD 맥락을 활용할 때 | 인스트림 동영상 광고, 치지직 배너 광고, 치지직 프리미엄 라이브(beta)를 구분합니다 ${naverChzzkRef}. | 라이브/VOD/PC·모바일 홈/영상엔드/추천 라이브 영역별 노출 맥락과 타겟 적합성을 봅니다. |`,
    `| 숏폼 아웃스트림/네이버 클립/헤드라인DA | 영상·숏폼·대형 지면으로 브랜드 관심과 도달을 키울 때 | 숏폼/동영상 비율, 클립/아웃스트림 지면, PC 헤드라인DA 같은 보장형 지면을 확인합니다 ${naverVideoRef}. | 조회·도달 KPI와 랜딩 전환 KPI를 섞지 않고 따로 봅니다. |`,
    '',
    '**2. 카카오 상품명 기준**',
    '',
    '| 상품 | 언제 쓰나 | 소재 제작에서 먼저 볼 것 | 심사·운영 체크 |',
    '|---|---|---|---|',
    `| 카카오 비즈보드 | 카카오톡 기반 대량 도달, 프로모션, 브랜드 인지와 랜딩 유입을 함께 노릴 때 | 카카오톡·카카오서비스 주요 지면, 소재 유형, 랜딩 옵션을 봅니다 ${kakaoBizboardRef}. | 카카오 서비스처럼 보이는 UI/로고/디자인 모방을 피해야 합니다 ${kakaoPolicyRef}. |`,
    `| 디스플레이 광고/동영상 광고 | 카카오 핵심 서비스와 파트너 지면에서 이미지·동영상 소재를 운영할 때 | 이미지/동영상 등 소재 유형, 노출 지면, 제작 가이드를 봅니다 ${kakaoDisplayRef} ${kakaoMomentRef}. | 업종 제한, 허위·과장, AI 생성물 표시, 랜딩 일치 여부를 확인합니다. |`,
    `| 상품 카탈로그 광고 | 상품 연동 기반 리타게팅·추천 광고로 구매 전환을 유도할 때 | 상품 연동, 다이내믹 광고, 구매 전환 목적, CPC 과금 구조를 확인합니다 ${kakaoCatalogRef}. | 상품 정보, 가격·혜택, 랜딩 상품 정보와 전환 이벤트 품질을 봅니다. |`,
    `| 카카오톡 채널 메시지/메시지 광고 | 쿠폰, 예약, 재구매, 이벤트 안내처럼 보유 고객 직접 도달이 중요할 때 | 메시지 내용, 가격·혜택 표시, 이벤트 조건, 랜딩 일치 여부를 봅니다 ${kakaoMessageRef}. | 제한 업종과 발송 가능 여부, 관계 법령 위반 가능성을 먼저 봅니다 ${kakaoMessageRef}. |`,
    `| 키워드광고 | 카카오 검색 지면에서 검색 의도 기반 유입을 확보할 때 | 키워드, 광고문안, 랜딩, 사업자 정보와 검색어 의도를 맞춥니다 ${kakaoSearchRef}. | 검색어-소재-랜딩 불일치와 허위·과장 표현을 확인합니다. |`,
    `| 브랜드검색 광고 | 브랜드 키워드 또는 브랜드 연관 키워드 검색 시 상단 정보성 콘텐츠를 보여줄 때 | 모바일 라이트, 모바일 오토플레이형, PC 베이직 등 템플릿별 이미지·동영상·행동유도버튼·랜딩URL을 봅니다 ${kakaoBrandGuideRef}. | 검토 완료 소재로만 집행하고 템플릿별 사양을 맞춥니다. |`,
    `| 톡채널검색 | 카카오톡 검색에서 채널 발견, 상담, 예약, 재방문을 모아야 할 때 | 추천소재/맞춤소재, 채널명, 썸네일, 홍보문구, 행동유도버튼, 랜딩URL을 봅니다 ${kakaoChannelGuideRef}. | 채널과 연동 사이트의 사업자 정보, 소재와 랜딩 일치, 등록불가 업종 조건을 확인합니다. |`,
    `| 보장형 광고/카카오비즈보드 CPT | 특정 시간대 대형 지면 점유와 브랜딩 임팩트가 필요할 때 | 카카오톡 친구탭의 주목도 높은 영역을 일정 시간 단독 점유하는 CPT 구조를 확인합니다 ${kakaoGuaranteedRef}. | CPC 성과형 캠페인과 KPI를 섞지 말고 도달, 점유, 이벤트 유입을 따로 봅니다. |`,
    '',
    '**3. 제작 순서**',
    '',
    '- 네이버 검색형은 키워드와 랜딩 의도가 먼저이고, 쇼핑형은 상품 DB와 대표이미지/가격 품질이 먼저입니다.',
    '- 네이버 성과형/영상형은 ADVoost 쇼핑, 커뮤니케이션 애드, 동영상 조회, 치지직처럼 지면과 목적이 갈리므로 대카테고리 “DA”로 뭉치면 안 됩니다.',
    '- 카카오는 지면 경험과 심사 맥락이 먼저입니다. 같은 이미지라도 비즈보드, 디스플레이, 메시지, 브랜드검색, 톡채널검색에서 사용자 맥락과 제작 사양이 달라집니다.',
    '- 두 매체 모두 소재 문구만 보지 말고 업종, 랜딩, 권리 침해, 허위·과장 표현, 상품 데이터·전환 측정을 함께 확인합니다.',
    '',
    '정리하면, 네이버는 **검색광고 상품명 + 쇼핑/상품 DB + ADVoost·커뮤니케이션 애드·치지직 같은 성과형/신규 지면**, 카카오는 **비즈보드·디스플레이·동영상·상품 카탈로그·메시지·브랜드검색·톡채널검색·보장형/CPT** 기준으로 소재 제작 가이드를 나누어야 합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-naver-kakao-asset-guide-comparison',
    86,
  );
}

function buildCrossVendorProductAssetGuideAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const requiredChunkIds = uniqueOfficialChunkIds([
    'meta_business_help_objectives_2026_chunk_0',
    'meta_business_help_formats_placements_2026_chunk_0',
    'meta_business_help_operating_modules_2026_chunk_0',
    'doc_1773886203371_8rlmmdv_chunk_1',
    'google_ads_campaign_types_2026_chunk_0',
    'google_ads_campaign_objectives_2026_chunk_0',
    'google_ads_shopping_ads_2026_chunk_0',
    'google_ads_app_campaigns_2026_chunk_0',
    'naver_searchad_overview_powerlink_brand_2026_chunk_0',
    'naver_powerlink_product_overview_2026_chunk_0',
    'doc_1773710116296_uawf5xm_chunk_2',
    'naver_brandsearch_product_overview_2026_chunk_0',
    'doc_1764922396107_b9w41zn_chunk_5',
    'naver_display_product_catalog_2026_chunk_0',
    'naver_chzzk_product_catalog_2026_chunk_0',
    'kakao_moment_product_overview_2026_chunk_0',
    'doc_1774488483929_bigcm1d_chunk_2',
    'doc_1774488184369_r97sach_chunk_0',
    'kakao_product_catalog_2026_chunk_0',
    'kakao_guaranteed_cpt_2026_chunk_0',
    'kakao_searchad_product_catalog_2026_chunk_0',
    'kakao_brandsearch_content_guide_2026_chunk_0',
    'kakao_channelsearch_content_guide_2026_chunk_0',
    'doc_1774491147517_yj1v810_chunk_17',
    'doc_1774488207473_cjq6ve0_chunk_19',
  ]);
  const prepared = prepareOfficialSnapshotAnswerSources(sources, requiredChunkIds);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const metaObjectiveRef = cite('meta_business_help_objectives_2026_chunk_0');
  const metaFormatRef = cite('meta_business_help_formats_placements_2026_chunk_0');
  const metaModuleRef = cite('meta_business_help_operating_modules_2026_chunk_0');
  const metaCatalogRef = cite('doc_1773886203371_8rlmmdv_chunk_1');
  const googleTypeRef = cite('google_ads_campaign_types_2026_chunk_0');
  const googleObjectiveRef = cite('google_ads_campaign_objectives_2026_chunk_0');
  const googleShoppingRef = cite('google_ads_shopping_ads_2026_chunk_0');
  const googleAppRef = cite('google_ads_app_campaigns_2026_chunk_0');
  const naverOverviewRef = cite('naver_searchad_overview_powerlink_brand_2026_chunk_0');
  const naverPowerlinkRef = cite('naver_powerlink_product_overview_2026_chunk_0');
  const naverShoppingRef = cite('doc_1773710116296_uawf5xm_chunk_2');
  const naverBrandRef = cite('naver_brandsearch_product_overview_2026_chunk_0');
  const naverAdvoostRef = cite('doc_1764922396107_b9w41zn_chunk_5');
  const naverDisplayRef = cite('naver_display_product_catalog_2026_chunk_0');
  const naverChzzkRef = cite('naver_chzzk_product_catalog_2026_chunk_0');
  const kakaoMomentRef = cite('kakao_moment_product_overview_2026_chunk_0');
  const kakaoBizboardRef = cite('doc_1774488483929_bigcm1d_chunk_2');
  const kakaoDisplayRef = cite('doc_1774488184369_r97sach_chunk_0');
  const kakaoCatalogRef = cite('kakao_product_catalog_2026_chunk_0');
  const kakaoGuaranteedRef = cite('kakao_guaranteed_cpt_2026_chunk_0');
  const kakaoSearchRef = cite('kakao_searchad_product_catalog_2026_chunk_0');
  const kakaoBrandGuideRef = cite('kakao_brandsearch_content_guide_2026_chunk_0');
  const kakaoChannelGuideRef = cite('kakao_channelsearch_content_guide_2026_chunk_0');
  const kakaoMessageRef = cite('doc_1774491147517_yj1v810_chunk_17');
  const kakaoPolicyRef = cite('doc_1774488207473_cjq6ve0_chunk_19');

  const lines = [
    '광고 상품과 소재 제작 가이드는 매체명을 나열하는 대신 **목표 → 상품/캠페인 유형 → 광고 형식/소재 형식 → 측정·심사 조건**으로 나누어 보면 실무에서 재사용하기 쉽습니다.',
    '',
    '**1. 매체별 상품/소재 기준**',
    '',
    '| 매체 | 상품/캠페인 축 | 소재 제작에서 먼저 볼 것 | 측정·심사 체크 |',
    '|---|---|---|---|',
    `| Meta | 인지도, 트래픽, 참여, 잠재 고객, 앱 홍보, 판매 같은 캠페인 목표를 먼저 정합니다 ${metaObjectiveRef}. | 이미지, 동영상, 카루셀, 컬렉션, 인스턴트 경험을 목표와 Facebook/Instagram 지면별로 나눕니다 ${metaFormatRef}. | 리드, 앱, 카탈로그는 전환 위치, Pixel/CAPI, 앱 이벤트, 카탈로그 피드까지 같이 봅니다 ${metaModuleRef} ${metaCatalogRef}. |`,
    `| Google Ads | 판매, 리드, 웹사이트 트래픽, 브랜드 인지도와 도달범위, 앱 홍보 같은 목표와 검색/디스플레이/동영상/쇼핑/앱/PMax 유형을 연결합니다 ${googleObjectiveRef} ${googleTypeRef}. | 검색은 텍스트와 랜딩, 디스플레이/동영상은 이미지·영상 애셋, 쇼핑은 상품 피드, 앱은 앱 애셋을 봅니다. | 쇼핑은 Merchant Center 상품 데이터와 정책, 앱은 Google Play/YouTube/Discover 등 게재와 앱 이벤트를 함께 확인합니다 ${googleShoppingRef} ${googleAppRef}. |`,
    `| 네이버 | 검색광고 축은 파워링크, 쇼핑검색광고, 파워컨텐츠, 브랜드검색광고, 신제품검색광고, 플레이스검색광고, 지역소상공인광고, 서칭뷰로 봅니다 ${naverOverviewRef}. 디스플레이 축은 ADVoost 쇼핑, 인지도 및 트래픽, 웹사이트 전환, 앱 전환, 카탈로그 판매, 쇼핑 프로모션, 동영상 조회, 커뮤니케이션 애드로 봅니다 ${naverDisplayRef}. | 파워링크는 키워드·문안·랜딩, 쇼핑검색은 상품 DB/EP·이미지·가격, 브랜드검색은 템플릿, ADVoost 쇼핑은 자동 최적화와 상품·전환 조건, 치지직은 인스트림/배너/프리미엄 라이브 지면을 봅니다 ${naverPowerlinkRef} ${naverShoppingRef} ${naverBrandRef} ${naverAdvoostRef} ${naverChzzkRef}. | 검색어와 랜딩 일치, 상품 DB/EP 수신, 가격·재고 동기화, 브랜드 키워드 자격, 커뮤니케이션 애드 상담 SLA, 치지직 지면 적합성을 확인합니다. |`,
    `| 카카오 | 카카오모먼트 축은 비즈보드, 디스플레이, 동영상, 메시지, 상품 카탈로그 광고를 봅니다 ${kakaoMomentRef} ${kakaoCatalogRef}. 검색 광고 축은 키워드광고, 브랜드검색, 톡채널검색으로 분리하고, 보장형 광고/카카오비즈보드 CPT는 별도 브랜딩 상품으로 봅니다 ${kakaoSearchRef} ${kakaoGuaranteedRef}. | 비즈보드는 카카오톡 주요 지면, 디스플레이/동영상은 소재 유형과 노출 지면, 상품 카탈로그는 상품 연동과 구매 전환, 메시지는 발송 내용, 브랜드검색/톡채널검색은 템플릿·행동유도버튼·랜딩URL을 봅니다 ${kakaoBizboardRef} ${kakaoDisplayRef} ${kakaoMessageRef} ${kakaoBrandGuideRef} ${kakaoChannelGuideRef}. | 카카오 서비스 오인, UI/로고 모방, AI 생성물 표시, 제한 업종, 허위·과장, 상품 정보와 랜딩 일치, 발송 가능 업종을 심사 기준으로 봅니다 ${kakaoPolicyRef}. |`,
    '',
    '**2. 질문 유형별 빠른 분기**',
    '',
    '- **상품 종류를 묻는 질문**: 캠페인 목표와 상품/캠페인 유형을 먼저 정리합니다.',
    '- **소재 제작을 묻는 질문**: 형식, 비율, 지면, 랜딩, 심사 표현을 함께 정리합니다.',
    '- **성과/전환을 묻는 질문**: 전환 태그, Pixel/CAPI, Google tag/GA, 앱 SDK/MMP, 상품 피드, CRM 수신을 분리합니다.',
    '- **커머스 질문**: Google Merchant Center, Meta 카탈로그, 네이버 상품 DB/EP, 카카오 상품·지면 조건을 가격·재고 동기화 기준으로 비교합니다.',
    '',
    '정리하면, 다매체 상품 가이드는 **Meta=목표·전환 위치·지면/형식**, **Google=목표·캠페인 유형·애셋/전환**, **네이버=검색광고 상품명·상품 DB·ADVoost/커뮤니케이션 애드/치지직**, **카카오=비즈보드·상품 카탈로그·메시지·브랜드검색·톡채널검색·보장형/CPT**로 나누는 것이 안전합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-cross-vendor-product-asset-guide',
    88,
  );
}

function buildMetaGoogleProductAssetGuideAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const requiredChunkIds = uniqueOfficialChunkIds([
    'meta_business_help_objectives_2026_chunk_0',
    'meta_business_help_formats_placements_2026_chunk_0',
    'meta_business_help_operating_modules_2026_chunk_0',
    'doc_1773886203371_8rlmmdv_chunk_1',
    'google_ads_campaign_types_2026_chunk_0',
    'google_ads_campaign_objectives_2026_chunk_0',
    'google_ads_shopping_ads_2026_chunk_0',
    'google_ads_app_campaigns_2026_chunk_0',
    'google_ads_web_conversion_measurement_2026_chunk_0',
  ]);
  const prepared = prepareOfficialSnapshotAnswerSources(sources, requiredChunkIds);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const metaObjectiveRef = cite('meta_business_help_objectives_2026_chunk_0');
  const metaFormatRef = cite('meta_business_help_formats_placements_2026_chunk_0');
  const metaModuleRef = cite('meta_business_help_operating_modules_2026_chunk_0');
  const metaCatalogRef = cite('doc_1773886203371_8rlmmdv_chunk_1');
  const googleTypeRef = cite('google_ads_campaign_types_2026_chunk_0');
  const googleObjectiveRef = cite('google_ads_campaign_objectives_2026_chunk_0');
  const googleShoppingRef = cite('google_ads_shopping_ads_2026_chunk_0');
  const googleAppRef = cite('google_ads_app_campaigns_2026_chunk_0');
  const googleConversionRef = cite('google_ads_web_conversion_measurement_2026_chunk_0');

  const lines = [
    'Meta와 Google Ads 상품·소재 가이드는 **상품명을 외우는 방식**보다 **캠페인 목표 → 광고 형식/캠페인 유형 → 게재 위치/애셋 → 전환 측정** 순서로 정리해야 실무에서 바로 쓸 수 있습니다.',
    '',
    '**1. 상품/소재 제작 기준 비교**',
    '',
    '| 매체 | 상품/캠페인 종류 | 소재 제작에서 먼저 볼 것 | 측정·운영 체크 |',
    '|---|---|---|---|',
    `| Meta | 인지도, 트래픽, 참여, 잠재 고객, 앱 홍보, 판매 같은 캠페인 목표를 먼저 고릅니다 ${metaObjectiveRef}. | 이미지, 동영상, 카루셀, 컬렉션, 인스턴트 경험 같은 광고 형식을 Facebook/Instagram 피드·스토리·릴스 등 게재 위치와 함께 봅니다 ${metaFormatRef}. | 리드는 인스턴트 양식·메시지·전화, 앱은 앱 이벤트, 판매/카탈로그는 상품 피드와 Pixel/CAPI 흐름을 함께 확인합니다 ${metaModuleRef} ${metaCatalogRef}. |`,
    `| Google Ads | 판매, 리드, 웹사이트 트래픽, 브랜드 인지도, 앱 홍보 같은 목표를 정하고 검색, 디스플레이, 동영상, 쇼핑, 앱, PMax 유형을 연결합니다 ${googleObjectiveRef} ${googleTypeRef}. | 검색은 키워드·광고문·랜딩, 디스플레이/동영상은 이미지·영상 애셋, 쇼핑은 Merchant Center 상품 데이터, 앱은 앱 애셋을 먼저 봅니다. | 웹사이트 전환은 Google tag/GA와 전환 액션, 쇼핑은 상품 피드 품질, 앱은 Google Play·YouTube·Discover 등 게재와 앱 이벤트를 점검합니다 ${googleConversionRef} ${googleShoppingRef} ${googleAppRef}. |`,
    '',
    '**2. 소재 제작 순서**',
    '',
    '- **Meta**: 캠페인 목표를 고른 뒤 전환 위치가 리드/웹사이트/앱/메시지/전화/카탈로그 중 무엇인지 정하고, 그다음 이미지·동영상·카루셀·컬렉션·인스턴트 경험을 지면별로 나눕니다.',
    '- **Google Ads**: 목표를 고른 뒤 검색/디스플레이/동영상/쇼핑/앱/PMax 중 캠페인 유형을 정하고, 캠페인 유형별로 필요한 광고문, 이미지·영상 애셋, 상품 피드, 앱 애셋, 랜딩을 준비합니다.',
    '- **공통**: 소재 문구만 보지 말고 랜딩 속도, 개인정보 고지, 정책 제한, 전환 태그, 상품 피드 품질, CRM 수신까지 같은 체크리스트에 묶어야 합니다.',
    '',
    '**3. 빠른 선택 기준**',
    '',
    '- 상담·견적·예약 리드는 Meta의 인스턴트 양식/메시지/전화와 Google의 리드 양식/웹사이트 전환을 함께 비교합니다.',
    '- 검색 의도가 강하면 Google 검색·쇼핑을 먼저 보고, 발견형 수요와 리타겟팅 풀을 넓혀야 하면 Meta 피드·스토리·릴스와 카탈로그를 봅니다.',
    '- 앱 성장은 Meta 앱 홍보와 Google 앱 캠페인을 분리해 앱 이벤트, SDK/MMP, 설치 후 핵심 행동 이벤트가 학습되는지 확인합니다.',
    '- 상품 수가 많으면 Meta 카탈로그/컬렉션과 Google 쇼핑/PMax를 우선 검토하고, 상품명·가격·재고·이미지 동기화 문제를 소재 제작 전 단계에서 잡습니다.',
    '',
    '정리하면, **Meta = 캠페인 목표 + 전환 위치 + 광고 형식/게재 위치 + Pixel/CAPI·카탈로그**, **Google Ads = 목표 + 캠페인 유형 + 애셋/상품 피드 + Primary conversion action·Google tag/GA** 기준으로 나누면 됩니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-meta-google-product-asset-guide',
    88,
  );
}

function buildMetaAssetGuideProductAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const requiredChunkIds = uniqueOfficialChunkIds([
    ...META_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS,
    'doc_1773886203371_8rlmmdv_chunk_1',
    'doc_1773886203371_8rlmmdv_chunk_2',
  ]);
  const prepared = prepareOfficialSnapshotAnswerSources(sources, requiredChunkIds);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const objectiveRef = cite('meta_business_help_objectives_2026_chunk_0');
  const formatRef = cite('meta_business_help_formats_placements_2026_chunk_0');
  const moduleRef = cite('meta_business_help_operating_modules_2026_chunk_0');
  const catalogRef = cite('doc_1773886203371_8rlmmdv_chunk_1');
  const advantageRef = cite('doc_1773886203371_8rlmmdv_chunk_2');

  const lines = [
    'Meta 광고 상품과 소재 제작 가이드는 **캠페인 목표 → 전환 위치/운영 모듈 → 광고 형식 → 게재 위치별 사양** 순서로 봐야 합니다.',
    '',
    '**1. 상품 유형과 소재 축**',
    '',
    '| 유형 | 주 목적 | 주로 확인할 소재/형식 | 제작 체크 |',
    '|---|---|---|---|',
    `| 인지도/도달 | 브랜드 인지, 도달, 기억률 확대 ${objectiveRef} | 이미지, 동영상, 카루셀 | 첫 화면 메시지, 반복 노출 피로도, 피드/스토리/릴스 비율을 나눕니다 ${formatRef}. |`,
    `| 트래픽/참여/메시지 | 웹사이트 방문, 게시물 반응, 메시지 대화 ${objectiveRef} | 링크형 이미지/동영상, 카루셀, 메시지 진입 소재 | 클릭 후 랜딩 속도, CTA, 메시지 상담 가능 시간을 확인합니다. |`,
    `| 리드 수집 | 상담 신청, 견적 요청, 연락처 확보 ${objectiveRef} | 인스턴트 양식, 메시지, 전화 전환 위치와 연결되는 소재 ${moduleRef} | 양식 질문, 개인정보 고지, CRM 수신, 후속 상담 SLA를 소재 전부터 정합니다. |`,
    `| 앱 홍보 | 앱 설치와 앱 이벤트 최적화 ${objectiveRef} | 모바일 짧은 동영상, 이미지, 스토어 이동 소재 | SDK/MMP, 앱 이벤트, 설치 후 핵심 행동 이벤트가 준비되어야 합니다 ${moduleRef}. |`,
    `| 판매/카탈로그 | 구매, 장바구니, 상품 탐색 ${objectiveRef} | 컬렉션, 카탈로그, Advantage+ 카탈로그 | 컬렉션은 커버 이미지/동영상과 상품 이미지를 연결해 구매 흐름을 만듭니다 ${catalogRef}. Advantage+ 카탈로그와 상품 세트·이벤트 매칭도 확인합니다 ${advantageRef}. |`,
    '',
    '**2. 제작 전 체크리스트**',
    '',
    '- 목표에서 지원되는 형식과 게재 위치를 먼저 확인합니다. Meta는 목표별로 사용할 수 있는 게재 위치와 광고 형식을 구분합니다.',
    '- 이미지, 동영상, 카루셀, 컬렉션, 인스턴트 경험은 같은 소재를 그대로 복붙하지 말고 지면별 비율과 CTA를 나눕니다.',
    '- 리드/앱/카탈로그는 소재 문제가 아니라 측정·데이터 모듈 문제까지 포함합니다.',
    '- 카탈로그형은 상품 피드, 상품 세트, 품절·가격 동기화, Pixel/CAPI 이벤트를 함께 점검합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-meta-asset-guide-product-matrix',
    88,
  );
}

function buildGoogleAssetGuideProductAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const requiredChunkIds = uniqueOfficialChunkIds([
    ...GOOGLE_PRODUCT_PLANNING_MATRIX_REQUIRED_CHUNK_IDS,
    'google_ads_lead_form_export_crm_api_2026_chunk_0',
  ]);
  const prepared = prepareOfficialSnapshotAnswerSources(sources, requiredChunkIds);
  if (!prepared) return null;
  const { sources: scenarioSources, used, cite } = prepared;

  const objectiveRef = cite('google_ads_campaign_objectives_2026_chunk_0');
  const typeRef = cite('google_ads_campaign_types_2026_chunk_0');
  const leadFormRef = cite('doc_1773662526796_7rijhfq_chunk_1');
  const conversionGoalRef = cite('google_ads_conversion_goals_leads_2026_chunk_0');
  const webConversionRef = cite('google_ads_web_conversion_measurement_2026_chunk_0');
  const offlineRef = cite('google_ads_offline_enhanced_conversions_leads_2026_chunk_0');
  const leadExportRef = cite('google_ads_lead_form_export_crm_api_2026_chunk_0');
  const shoppingRef = cite('google_ads_shopping_ads_2026_chunk_0');
  const appRef = cite('google_ads_app_campaigns_2026_chunk_0');

  const lines = [
    'Google Ads 상품과 소재 제작 가이드는 **목표 → 캠페인 유형 → 애셋/광고 형식 → 전환 측정** 순서로 나누어야 합니다. 검색, 디스플레이, 동영상, 쇼핑, 앱, 실적 최대화/PMax는 노출 지면과 필요한 애셋이 다르므로 같은 “구글 광고 소재”로 묶으면 실무에서 빠지는 항목이 생깁니다.',
    '',
    '**1. 캠페인 유형별 소재 제작 기준**',
    '',
    '| 유형 | 언제 우선 검토하나 | 소재/애셋에서 먼저 볼 것 | 측정·운영 체크 |',
    '|---|---|---|---|',
    `| 검색 캠페인 | 검색 의도가 이미 있는 사용자를 랜딩, 상담, 구매 페이지로 보내야 할 때 ${objectiveRef} | 키워드, 검색어 의도, 광고 제목/설명, 표시 URL, 확장 애셋, 랜딩 메시지 일치를 봅니다. | 전환 목표와 캠페인 유형을 먼저 맞추고, 리드/구매 같은 전환 액션이 보고·입찰에 맞게 잡혔는지 확인합니다 ${objectiveRef} ${conversionGoalRef}. |`,
    `| 디스플레이 캠페인 | 이미지·텍스트 조합으로 넓은 지면에서 도달, 리마케팅, 전환 확장을 해야 할 때 | 반응형 디스플레이용 이미지, 로고, 짧은/긴 제목, 설명, CTA, 랜딩 URL을 지면별로 준비합니다. 캠페인 유형마다 노출 지면, 광고 형식, 입찰과 애셋 요구사항이 달라집니다 ${typeRef}. | 소재 피로도, 지면 품질, 리마케팅/오디언스, 전환 태그와 랜딩 속도를 함께 봅니다. |`,
    `| 동영상/YouTube 캠페인 | 영상 시청, 브랜드 도달, 리드 확장, 검색 외 지면 확장이 필요할 때 | 영상 첫 화면 메시지, CTA, 썸네일/컴패니언 요소, YouTube 지면, 리드 양식 가능 여부를 확인합니다 ${typeRef} ${leadFormRef}. | 조회 KPI와 전환 KPI를 분리하고, 리드 양식을 붙일 때는 전환 중심 입찰 조건과 리드 양식 전환 목표를 확인합니다 ${conversionGoalRef}. |`,
    `| 실적 최대화/PMax | 여러 Google 지면을 자동화로 묶어 전환을 키워야 할 때 | 애셋 그룹 단위로 텍스트, 이미지, 로고, 동영상, 랜딩 URL, 상품 피드 또는 앱/리드 애셋을 묶어 준비합니다 ${typeRef}. | 좋은 학습을 위해 Primary conversion action, 오프라인 전환 가져오기, 향상된 전환 리드 같은 후속 품질 신호를 같이 설계합니다 ${conversionGoalRef} ${offlineRef}. |`,
    `| 쇼핑 광고 | 상품 이미지, 제목, 가격, 매장명 같은 상품 정보를 검색·쇼핑 지면에 노출해야 할 때 | Merchant Center 상품 데이터, 상품명, 대표 이미지, 가격, 재고, 상품 카테고리, 랜딩 상품 정보를 먼저 봅니다 ${shoppingRef}. | 피드 불승인, 가격·재고 불일치, 정책 제한, 쇼핑/PMax 전환 목표를 함께 점검합니다 ${shoppingRef}. |`,
    `| 앱 캠페인 | 앱 설치와 앱 내 행동을 늘려야 할 때 | 텍스트, 이미지, 동영상 애셋과 Google 검색, Google Play, YouTube, Discover, 디스플레이 네트워크 게재를 함께 봅니다 ${appRef}. | 앱 설치와 앱 내 핵심 행동 이벤트, 입찰, 전환 추적 설정이 준비되어야 합니다 ${appRef}. |`,
    `| 리드 양식 애셋 | 검색, 동영상, PMax, 디스플레이에서 바로 연락처를 받을 때 | 개인정보처리방침, 질문/필드, 제출 후 안내, CRM 수신 필드와 webhook/API 연동을 봅니다 ${leadFormRef} ${leadExportRef}. | CSV·이메일·webhook·서드파티·Google Ads API 수신 방식, 중복 제거, 후속 상담 상태, Primary/Secondary 전환 분류를 확인합니다 ${leadExportRef} ${conversionGoalRef}. |`,
    '',
    '**2. 소재 제작 순서**',
    '',
    `- 먼저 목표를 정합니다. Google Ads는 판매, 리드, 웹사이트 트래픽, 브랜드 인지도와 도달범위, 앱 홍보 같은 목표를 캠페인 유형과 기능에 연결합니다 ${objectiveRef}.`,
    `- 다음으로 캠페인 유형을 고릅니다. 검색/디스플레이/동영상/쇼핑/앱/PMax는 필요한 광고 형식, 애셋, 입찰, 노출 지면이 다릅니다 ${typeRef}.`,
    `- 웹사이트 전환형이면 Google tag 또는 Google Analytics 연결과 전환 액션을 먼저 확인합니다 ${webConversionRef}.`,
    `- 리드·계약 품질이 중요하면 오프라인 전환 가져오기나 향상된 전환 리드로 상담, 계약, 구매 같은 후속 결과를 되돌릴 구조를 잡습니다 ${offlineRef}.`,
    '',
    '**3. 런칭 전 체크리스트**',
    '',
    '- 검색: 키워드/검색어, 광고문, 표시 URL, 랜딩 제목, 전환 액션이 같은 의도를 말하는지 봅니다.',
    '- 디스플레이: 이미지·로고·제목·설명 조합, 지면별 잘림, 랜딩 속도, 리마케팅 오디언스 품질을 봅니다.',
    '- 동영상: 첫 3~5초 메시지, CTA, YouTube 지면, 조회 목표와 전환 목표 분리를 봅니다.',
    '- PMax: 애셋 그룹, 최종 URL, 상품 피드, 전환 목표, 오프라인/향상된 전환 피드백을 함께 봅니다.',
    '- 쇼핑: Merchant Center 상품 피드, 가격·재고 동기화, 이미지 품질, 정책 승인, 구매 전환을 먼저 봅니다.',
    '- 앱: 스토어 연결, 앱 이벤트, SDK/MMP, 설치 후 핵심 행동 이벤트, 텍스트·이미지·동영상 애셋을 봅니다.',
    '- 리드 양식: 개인정보처리방침, 필드/질문, 제출 후 화면, CRM 수신, webhook/API 테스트, lead_id 중복 제거를 봅니다.',
    '',
    '정리하면, Google Ads 소재 제작가이드는 **검색=광고문·키워드·랜딩**, **디스플레이=이미지/로고/문구 애셋**, **동영상=영상·CTA·YouTube 지면**, **PMax=애셋 그룹+전환 목표**, **쇼핑=Merchant Center 상품 피드**, **앱=앱 애셋+앱 이벤트**, **리드 양식=필드·개인정보·CRM 수신**으로 나누어야 합니다.',
    '',
    `근거: ${Array.from(used).sort((a, b) => a - b).map(index => `[S${index + 1}]`).join(', ')}`,
  ];

  return finalizeOfficialSnapshotDeterministicAnswer(
    lines,
    scenarioSources,
    used,
    'compass-answer-deterministic-google-asset-guide-product-matrix',
    88,
  );
}

function buildOperationalScenarioDeterministicAnswer(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
): DeterministicProductAnswer | null {
  const normalized = normalizeProductIntentText(message);
  const shouldDeferToPolicyReviewAnswer = isPolicyReviewCheckQuestion(message);
  const shouldDeferToPolicyOrRegulatedDomainAnswer = isPolicyOrRegulatedDomainQuestion(message);

  if (isPerformanceDropTroubleshootingQuestion(message)) {
    return buildPerformanceDropTroubleshootingAnswer(sources);
  }

  if (
    !shouldDeferToPolicyOrRegulatedDomainAnswer
    && isCommerceProductFeedQuestion(message, intent)
    && intent.vendors.length >= 2
  ) {
    return buildEcommerceProductFeedComparisonAnswer(sources);
  }

  if (
    !shouldDeferToPolicyOrRegulatedDomainAnswer
    && isAcquisitionRetargetingBudgetQuestion(message, intent)
    && intent.vendors.length >= 2
  ) {
    return buildCrossVendorBudgetFrameworkAnswer(sources);
  }

  if (!shouldDeferToPolicyReviewAnswer && isAssetGuideProductQuestion(message)) {
    if (intent.vendors.length >= 3) {
      return buildCrossVendorProductAssetGuideAnswer(sources);
    }
    if (intent.vendors.includes('NAVER') && intent.vendors.includes('KAKAO')) {
      return buildNaverKakaoAssetGuideComparisonAnswer(sources);
    }
    if (
      intent.vendors.length === 2
      && intent.vendors.includes('META')
      && intent.vendors.includes('GOOGLE')
    ) {
      return buildMetaGoogleProductAssetGuideAnswer(sources);
    }
    if (intent.vendors.length === 1 && intent.vendors[0] === 'META') {
      return buildMetaAssetGuideProductAnswer(sources) ?? buildMetaProductPlanningMatrixAnswer(sources);
    }
    if (intent.vendors.length === 1 && intent.vendors[0] === 'GOOGLE') {
      return buildGoogleAssetGuideProductAnswer(sources) ?? buildGoogleProductPlanningMatrixAnswer(sources);
    }
    if (intent.vendors.length === 1 && intent.vendors[0] === 'KAKAO') {
      return buildKakaoProductSelectionMatrixAnswer(sources);
    }
    if (intent.vendors.length === 1 && intent.vendors[0] === 'NAVER') {
      return buildNaverSearchAdProductComparisonAnswer(sources);
    }
  }

  if (
    intent.vendors.length === 1
    && intent.vendors[0] === 'KAKAO'
    && !shouldDeferToPolicyReviewAnswer
    && !shouldDeferToPolicyOrRegulatedDomainAnswer
    && /톡채널|카카오모먼트|비즈보드|메시지|업종별|선택|언제|기준|상품\s*(종류|유형|가이드|별)|상품별|제작\s*가이드|소재/.test(normalized)
  ) {
    return buildKakaoProductSelectionMatrixAnswer(sources);
  }

  if (
    intent.vendors.length === 1
    && intent.vendors[0] === 'NAVER'
    && !shouldDeferToPolicyReviewAnswer
    && !shouldDeferToPolicyOrRegulatedDomainAnswer
    && /파워링크|쇼핑검색|브랜드검색|검색광고|과금|랜딩|전환\s*측정|캠페인\s*목적|소재\s*구성|상품\s*(종류|유형|가이드|별)|상품별|제작\s*가이드|소재/.test(normalized)
  ) {
    return buildNaverSearchAdProductComparisonAnswer(sources);
  }

  if (
    intent.vendors.includes('NAVER')
    && intent.vendors.includes('KAKAO')
    && !shouldDeferToPolicyReviewAnswer
    && !shouldDeferToPolicyOrRegulatedDomainAnswer
    && /상품\s*(종류|유형|가이드|별)|상품별|광고\s*상품|소재|제작\s*가이드/.test(normalized)
  ) {
    return buildNaverKakaoAssetGuideComparisonAnswer(sources);
  }

  return null;
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

  const deterministicAnswer = family === 'meta_overview'
    ? buildMetaProductPlanningMatrixAnswer(sources)
    : family === 'google_overview'
      ? buildGoogleProductPlanningMatrixAnswer(sources)
      : buildEvidenceBackedAnswer(profile, sources);
  if (!deterministicAnswer) return null;

  if (family === 'meta_overview' || family === 'google_overview') {
    return {
      ...deterministicAnswer,
      model: `${deterministicAnswer.model}-quality-repair`,
      reason: 'broad_product_quality_gap',
    };
  }

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
    answer: polishCompassAnswerStyle(lines.join('\n')),
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
        intro: 'Meta 광고 상품은 개별 상품명을 나열하기보다, 캠페인 구조와 목표, 게재 위치/형식, 운영 모듈을 조합해 설계하는 체계로 보는 편이 실무적입니다.',
        sections: [
          {
            heading: '1. 캠페인 구조와 목표',
            bullets: [
              { text: '광고 관리자는 캠페인, 광고 세트, 광고 단위로 나뉘며 캠페인에서 목표를 정하고 광고 세트에서 예산·일정·타겟·게재 위치를 잡은 뒤 광고 단위에서 소재와 문구를 구성합니다.', terms: ['광고 관리자 구조', '광고 레벨', 'advertising levels'] },
              { text: '캠페인 목표는 인지도, 트래픽, 참여, 잠재 고객, 앱 홍보, 판매처럼 비즈니스가 얻으려는 결과를 기준으로 선택합니다.', terms: ['인지도', '트래픽', '참여', '잠재 고객', '앱 홍보', '판매'] },
            ],
          },
          {
            heading: '2. 형식과 노출 위치',
            bullets: [
              { text: '이미지, 동영상, 카루셀, 컬렉션, 인스턴트 경험 같은 광고 형식은 목표와 게재 위치에 따라 사용 가능 여부와 세부 사양이 달라집니다.', terms: ['광고 형식', '인스턴트 경험'] },
              { text: 'Facebook, Instagram 등 노출 위치는 캠페인 목표와 함께 확인해야 하며, 같은 소재라도 지면별 권장 사양이 달라질 수 있습니다.', terms: ['목표별 게재 위치', '광고 형식'] },
            ],
          },
          {
            heading: '3. 운영 모듈',
            bullets: [
              { text: '상담 신청이나 연락처 수집이 목표라면 리드 목적과 인스턴트 양식, 메시지, 전화 같은 전환 위치를 먼저 검토합니다.', terms: ['인스턴트 양식', '메시지', '전화'] },
              { text: '앱 설치나 앱 내 행동을 키우려면 앱 홍보 목표와 앱 이벤트 측정 조건을 함께 확인합니다.', terms: ['앱 이벤트 측정', '앱 이벤트'] },
              { text: '상품 판매와 커머스 운영은 카탈로그, 컬렉션, Advantage+ 카탈로그, 웹사이트 전환 측정을 묶어서 봐야 합니다.', terms: ['Advantage+ 카탈로그', '웹사이트 전환 측정'] },
            ],
          },
        ],
        summary: '정리하면, Meta 광고는 목표를 먼저 고르고, 그 목표에 맞는 전환 위치와 게재 위치/형식을 정한 뒤 리드·앱·카탈로그·측정 기능이 필요한지 붙이는 순서로 검토하면 됩니다.',
        model: 'compass-answer-deterministic-meta-overview',
        minBullets: 5,
        coverageNotice: '실무 체크: 실제 캠페인 생성 전에는 선택한 목표에서 지원되는 전환 위치, 게재 위치, 소재 형식, 픽셀/CAPI 또는 앱 이벤트 같은 측정 조건을 같은 기준으로 대조해야 합니다.',
        showContactOption: true,
        confidenceCap: 86,
        reviewStatus: 'completed',
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
        coverageNotice: '추가 확인: PMax, Demand Gen, YouTube/동영상처럼 핵심 캠페인 축은 공식 근거가 함께 잡힌 경우에만 확정 상품군으로 분리하고, 계정·목표·애셋 조건을 원문 기준으로 다시 대조합니다.',
        confidenceCap: 86,
      };

    case 'naver_overview':
      return {
        family,
        intro: '네이버 광고 상품은 검색 유입, 쇼핑 상품 노출, 디스플레이/동영상 지면, 상품 DB 조건을 나눠 확인하는 편이 안전합니다.',
        sections: [
          {
            heading: '대표 상품군',
            bullets: [
              { text: '사이트검색광고는 키워드 검색 기반으로 웹사이트 방문을 늘릴 때 확인합니다.', terms: ['사이트검색광고', '웹사이트 방문'] },
              { text: '파워링크와 브랜드검색은 검색 노출 목적과 브랜드 홍보 목적을 나눠 확인합니다.', terms: ['파워링크', '브랜드검색', '브랜드 검색'] },
              { text: '쇼핑검색광고는 쇼핑몰 상품형처럼 상품 노출과 유입을 함께 다룰 때 확인합니다.', terms: ['쇼핑검색광고', '쇼핑검색', '쇼핑몰 상품형'] },
              { text: '쇼핑블록이나 주요 쇼핑 지면은 쇼핑몰 유입 또는 브랜딩 목적을 검토할 때 확인합니다.', terms: ['쇼핑블록', '쇼핑 지면', 'PC 쇼핑블록', '모바일 쇼핑'] },
              { text: '성과형/보장형 디스플레이와 DA 지면은 검색형 상품과 분리해 홈피드, 스마트채널, 타임보드, 롤링보드, 헤드라인DA 같은 지면 조건을 확인합니다.', terms: ['성과형 디스플레이', '보장형', '네이버 DA', '헤드라인DA', '홈피드', '스마트채널', '타임보드', '롤링보드'] },
              { text: '동영상 광고는 동영상 조회, 숏폼 아웃스트림, 네이버 클립처럼 영상 노출 방식과 소재 조건을 별도로 확인합니다.', terms: ['동영상 광고', '동영상 조회', '숏폼 아웃스트림', '네이버 클립', '아웃스트림'] },
              { text: '상품 DB URL, EP, 상품정보 수신 같은 조건은 쇼핑 상품 운영 전 함께 확인합니다.', terms: ['상품 DB', '상품DB', 'DB URL', 'EP', '상품정보 수신'] },
            ],
          },
        ],
        summary: '정리하면, 네이버는 검색형 상품, 쇼핑형 상품, 디스플레이/동영상 지면, 상품 DB 조건을 분리해서 검토해야 합니다.',
        model: 'compass-answer-deterministic-naver-overview',
        minBullets: 4,
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

function shouldUseFastBroadProductDeterministicAnswer(intent: QueryIntent, message?: string) {
  if (process.env.COMPASS_DISABLE_FAST_BROAD_PRODUCT_ANSWERS === 'true') return false;
  if (!intent.isProductStructureOverview || intent.isSpecificProductGuidance) return false;
  if (message && isBroadMetaProductPlanningQuestion(message, intent)) return true;
  if (intent.vendors.length !== 1 || intent.isComparative) return false;

  return intent.vendors[0] === 'META'
    || intent.vendors[0] === 'NAVER'
    || intent.vendors[0] === 'GOOGLE';
}

function buildFastKakaoProductStructuredAnswer(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
  model: string,
  fastAnswerFallback: Exclude<FastKakaoProductAnswerFallback, 'kakao_specific_product_source_guided'>,
): (DeterministicProductAnswer & { fastAnswerFallback: FastKakaoProductAnswerFallback }) | null {
  if (process.env.COMPASS_DISABLE_FAST_KAKAO_STRUCTURED_PRODUCT_ANSWERS === 'true') return null;
  if (!intent.topics.includes('product_structure')) return null;
  if (intent.vendors.length !== 1 || intent.vendors[0] !== 'KAKAO') return null;

  const family = detectProductAnswerFamily(message, intent);
  if (family !== 'kakao_overview' && family !== 'kakao_bizboard' && family !== 'kakao_creative') return null;

  const candidateSources = dedupePublicProductSources(
    sources.filter(source => (
      sourceMatchesVendor(source, 'KAKAO')
      && !sourceHasCrossVendorUrl(source, ['KAKAO'])
      && !sourceHasExtractionNoise(source)
      && String(source.excerpt || source.matchText || source.title || '').trim()
    )),
    6,
  );
  if (candidateSources.length === 0) return null;

  const structuredAnswer = buildKakaoProductStructuredFallbackAnswer(candidateSources, intent);
  if (!structuredAnswer) return null;

  return {
    answer: polishCompassAnswerStyle(structuredAnswer),
    sources: candidateSources,
    model,
    showContactOption: true,
    confidenceCap: 76,
    reviewStatus: 'completed',
    fastAnswerFallback,
  };
}

function detectFastPolicySourceGuidedAnswerFamily(
  message: string,
  intent: QueryIntent,
): FastPolicySourceGuidedAnswerFamily | null {
  const queryText = normalizeEvidenceText([
    message,
    ...intent.keywords,
    ...intent.topics,
    ...intent.adPolicyTerms,
    ...intent.strictContextTerms,
  ].join(' '));
  const originalText = normalizeEvidenceText(message);
  const looksLikeCreativeSpecQuestion = /사이즈|크기|파일|형식|이미지|동영상|비율|해상도|사양|스펙|규격|카루셀|캐러셀|carousel/.test(originalText);
  const hasExplicitPolicyQuestionSignal = /정책|위반|금지|심사|검수|검토|반려|승인|가능\s*여부/.test(originalText);
  if (looksLikeCreativeSpecQuestion && !hasExplicitPolicyQuestionSignal) return null;

  if (
    /병원|의료|의료법|의원|치과|한의원|성형|피부과|시술|진료|환자/.test(queryText)
    && /광고|문안|소재|랜딩|페이지|심사|검수|검토|반려|승인|주의|유의|기준|정책|가능/.test(queryText)
  ) {
    return 'medical_hospital_landing_review';
  }

  if (
    intent.vendors.length === 1
    && intent.vendors[0] === 'KAKAO'
    && /카카오/.test(queryText)
    && /로고|디자인|서비스명|서비스|상표|저작물|모방|무단|사용/.test(queryText)
  ) {
    return 'kakao_service_protection';
  }

  if (
    intent.vendors.length === 1
    && intent.vendors[0] === 'KAKAO'
    && /카카오/.test(queryText)
    && /업종|제한\s*업종|업종\s*제한|광고\s*가능\s*업종|등록\s*불가|집행\s*불가|금지\s*업종|허용\s*업종/.test(queryText)
  ) {
    return 'kakao_restricted_industry';
  }

  if (isBroadReviewTroubleshootingQuestion(message)) return 'review_standards';
  if (/오인|기만|속이|혼란|허위|과장|오해/.test(queryText)) return 'user_deception';
  if (/가격|할인|할인율|혜택|쿠폰|정가|판매가/.test(queryText)) return 'price_discount';
  if (/이벤트|경품|참여|프로모션|추첨/.test(queryText)) return 'event_material';
  if (/청소년|유해/.test(queryText)) return 'youth_harmful';
  if (/혐오|차별|비하|증오|모욕/.test(queryText)) return 'hate_discrimination';
  if (/성인|선정|음란|노출/.test(queryText)) return 'adult_content';
  if (/상표|초상권|저작권|권리|침해/.test(queryText)) return 'rights_infringement';
  if (
    intent.vendors.length === 1
    && /정책|위반|금지|소재|판단/.test(originalText)
    && !/심사\s*기준|등록\s*기준|광고\s*등록\s*기준|준수사항|가이드/.test(originalText)
  ) {
    return 'vendor_policy_general';
  }
  if (/심사|검수|검토|등록\s*기준|광고\s*등록\s*기준|준수사항|가이드|기준/.test(queryText)) return 'review_standards';
  if (
    intent.vendors.length === 1
    && /정책|위반|금지|소재|판단|심사|검토|검수|광고/.test(queryText)
  ) {
    return 'vendor_policy_general';
  }

  return null;
}

function getFastPolicySourcePattern(family: FastPolicySourceGuidedAnswerFamily): RegExp {
  switch (family) {
    case 'price_discount':
      return /가격|할인|할인율|혜택|쿠폰|정가|판매가|무료배송|카드할인|price|discount/i;
    case 'user_deception':
      return /오인|기만|속이|속임|혼란|허위|과장|오해|mislead|decept/i;
    case 'event_material':
      return /이벤트|경품|참여|프로모션|추첨|당첨|기간|조건/i;
    case 'medical_hospital_landing_review':
      return /의료|의료법|병원|의원|치과|한의원|성형|피부과|시술|진료|환자|관계\s*법령|인터넷\s*광고|랜딩|심사|가이드/i;
    case 'kakao_restricted_industry':
      return /카카오|업종|제한\s*업종|업종\s*제한|광고\s*가능\s*업종|등록\s*불가|집행\s*불가|금지|제한|허용|심사|가이드/i;
    case 'kakao_service_protection':
      return /카카오|로고|디자인|서비스명|서비스|상표|저작물|모방|침해|무단|사용\s*불가|집행\s*불가/i;
    case 'youth_harmful':
      return /청소년|유해|미성년|연령|성인|보호/i;
    case 'hate_discrimination':
      return /혐오|차별|비하|증오|모욕|선동/i;
    case 'adult_content':
      return /성인|선정|음란|노출|유해|청소년|19세|19금/i;
    case 'rights_infringement':
      return /상표|초상권|저작권|권리|침해|무단|지식재산|저작물/i;
    case 'review_standards':
      return /심사|검수|검토|기준|등록\s*기준|준수사항|가이드|관리\s*정책/i;
    case 'vendor_policy_general':
      return /광고|정책|위반|금지|소재|심사|검토|가이드|기준/i;
  }
}

function getFastPolicyAnswerFallback(
  family: FastPolicySourceGuidedAnswerFamily,
): FastPolicySourceGuidedAnswerFallback {
  switch (family) {
    case 'price_discount':
      return 'policy_source_guided_price_discount';
    case 'user_deception':
      return 'policy_source_guided_user_deception';
    case 'event_material':
      return 'policy_source_guided_event_material';
    case 'medical_hospital_landing_review':
      return 'policy_source_guided_medical_hospital_landing_review';
    case 'kakao_restricted_industry':
      return 'policy_source_guided_kakao_restricted_industry';
    case 'kakao_service_protection':
      return 'policy_source_guided_kakao_service_protection';
    case 'youth_harmful':
      return 'policy_source_guided_youth_harmful';
    case 'hate_discrimination':
      return 'policy_source_guided_hate_discrimination';
    case 'adult_content':
      return 'policy_source_guided_adult_content';
    case 'rights_infringement':
      return 'policy_source_guided_rights_infringement';
    case 'review_standards':
      return 'policy_source_guided_review_standards';
    case 'vendor_policy_general':
      return 'policy_source_guided_vendor_policy_general';
  }
}

function buildMultiVendorUserDeceptionPolicyAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
) {
  const requestedVendors = intent.vendors.length > 0
    ? intent.vendors
    : (['META', 'GOOGLE', 'NAVER', 'KAKAO'] as VendorIntent[]);
  const uniqueRequestedVendors = Array.from(new Set(requestedVendors));
  if (uniqueRequestedVendors.length < 2) return null;

  const sourceIndexForVendor = (vendor: VendorIntent) => sources.findIndex(source => sourceMatchesVendor(source, vendor));
  const labelForIndex = (index: number) => `[S${index + 1}]`;
  const cited = new Set<number>();
  const rowForVendor = (vendor: VendorIntent) => {
    const sourceIndex = sourceIndexForVendor(vendor);
    const label = sourceIndex >= 0 ? labelForIndex(sourceIndex) : '';
    if (sourceIndex >= 0) cited.add(sourceIndex);
    const missingText = '현재 검색 결과에서 직접 검증 출처가 부족해 세부 기준은 단정하지 않습니다.';
    const withLabel = (text: string) => (label ? `${text} ${label}` : missingText);

    switch (vendor) {
      case 'META':
        return `| Meta | ${withLabel('광고 표준과 검토 기준에서 금지·제한 콘텐츠, 오인 가능성, 연결 URL/랜딩 맥락을 함께 확인합니다.')} | 광고에서 약속한 혜택·조건·서비스 내용이 랜딩에서 같은 조건으로 확인되는지 봅니다. | 출처가 부족하면 자동 승인 가능성이나 매체별 예외를 추정하지 않습니다. |`;
      case 'GOOGLE':
        return `| Google Ads | ${withLabel('Google Ads 정책에서 오해 소지가 있는 표현, 제한 콘텐츠, 광고와 목적지의 정책 준수 여부를 먼저 봅니다.')} | 최종 URL, 랜딩 페이지, 고지 조건, 가격·혜택 표현이 광고 문구와 충돌하지 않는지 확인합니다. | Primary 전환이나 입찰 문제로 보기 전에 정책 제한·목적지 불일치를 먼저 배제합니다. |`;
      case 'NAVER':
        return `| 네이버 | ${withLabel('네이버 광고 등록 기준/가이드에서 허위·과장, 이용자 오인, 법령 위반, 권리 침해 가능성을 봅니다.')} | 검색어, 광고문안, 표시 URL, 랜딩의 실제 상품·서비스 정보가 같은 의도를 말하는지 확인합니다. | 검색광고·쇼핑·플레이스처럼 상품별 등록 기준이 다르므로 공통 기준과 상품별 기준을 나눕니다. |`;
      case 'KAKAO':
        return `| 카카오 | ${withLabel('카카오 집행 기준에서 허위·과장, 카카오 서비스 오인, 업종 제한, 소재·랜딩 불일치를 확인합니다.')} | 가격·혜택·이벤트·상담 조건이 소재와 랜딩/채널/메시지에서 같은 조건으로 표시되는지 봅니다. | 비즈보드·디스플레이·메시지·검색형은 지면과 수신 맥락이 달라 심사 리스크를 분리합니다. |`;
    }
  };

  const citedLabels = Array.from(cited)
    .sort((a, b) => a - b)
    .map(labelForIndex)
    .join(', ');

  return [
    '검증된 정책 근거 기준으로만 보면, 허위·과장 표현과 랜딩페이지 불일치는 **소재 문구 → 랜딩 실제 표시 → 업종/상품 제한 → 필수 고지·증빙**을 함께 확인해야 합니다.',
    '',
    '**1. 매체별 점검 기준**',
    '',
    '| 매체 | 정책·심사에서 먼저 볼 것 | 랜딩페이지 체크 | 운영 판단 |',
    '|---|---|---|---|',
    ...uniqueRequestedVendors.map(rowForVendor),
    '',
    '**2. 공통 점검 순서**',
    '',
    '- 먼저 광고 문구의 효과, 가격, 혜택, 기간, 대상, 주체가 사실과 다르게 이해될 여지가 있는지 봅니다.',
    '- 다음으로 랜딩에서 같은 조건이 즉시 확인되는지 봅니다. 소재에는 “무료/보장/최고/한정”이라고 쓰고 랜딩에서 조건이 숨겨져 있으면 위험합니다.',
    '- 업종 제한, 필수 고지, 증빙 자료, 권리 침해 가능성을 매체별 원문 기준으로 따로 확인합니다.',
    '- 출처가 부족한 매체는 다른 매체 기준을 섞어 추정하지 말고, 실제 문안·랜딩 URL·업종을 기준으로 원문 정책을 추가 대조합니다.',
    '',
    `근거: ${citedLabels || sources.map((_, index) => labelForIndex(index)).join(', ')}`,
  ].join('\n');
}

function buildMultiVendorReviewStandardsPolicyAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
) {
  const requestedVendors = intent.vendors.length > 0
    ? intent.vendors
    : (['META', 'GOOGLE', 'NAVER', 'KAKAO'] as VendorIntent[]);
  const uniqueRequestedVendors = Array.from(new Set(requestedVendors));
  if (uniqueRequestedVendors.length < 2) return null;

  const sourceIndexForVendor = (vendor: VendorIntent) => sources.findIndex(source => sourceMatchesVendor(source, vendor));
  const labelForIndex = (index: number) => `[S${index + 1}]`;
  const cited = new Set<number>();
  const rowForVendor = (vendor: VendorIntent) => {
    const sourceIndex = sourceIndexForVendor(vendor);
    const label = sourceIndex >= 0 ? labelForIndex(sourceIndex) : '';
    if (sourceIndex >= 0) cited.add(sourceIndex);
    const missingText = '현재 검색 결과에서 직접 검증 출처가 부족해 세부 기준은 단정하지 않습니다.';
    const withLabel = (text: string) => (label ? `${text} ${label}` : missingText);

    switch (vendor) {
      case 'META':
        return `| Meta | ${withLabel('광고 표준, 광고 검토, 금지·제한 콘텐츠, 연결 URL과 랜딩 맥락을 먼저 봅니다.')} | 소재 문구와 랜딩의 가격·혜택·상담 조건이 같은지 확인합니다. | 타겟팅, 전환 위치, 픽셀/CAPI 이벤트 문제와 정책 반려를 분리해 봅니다. |`;
      case 'GOOGLE':
        return `| Google Ads | ${withLabel('정책 위반, 제한 콘텐츠, 광고 소재와 목적지의 정책 준수 여부를 함께 봅니다.')} | 최종 URL, 목적지, 고지, 가격·혜택 조건이 광고문과 충돌하지 않는지 확인합니다. | 정책 제한·목적지 불일치 확인 후 전환 목표, Primary action, 입찰 설정을 점검합니다. |`;
      case 'NAVER':
        return `| 네이버 | ${withLabel('광고 등록 기준에서 법령 위반, 허위·과장, 이용자 오인, 권리 침해 가능성을 봅니다.')} | 검색어, 광고문안, 표시 URL, 랜딩의 상품·서비스 정보가 같은 의도를 말하는지 확인합니다. | 검색광고, 쇼핑검색, 플레이스, 디스플레이처럼 상품별 등록 기준을 나누어 봅니다. |`;
      case 'KAKAO':
        return `| 카카오 | ${withLabel('카카오 심사 기준에서 업종 제한, 허위·과장, 카카오 서비스 오인, 소재·랜딩 불일치를 확인합니다.')} | 가격·혜택·이벤트·상담 조건이 소재, 랜딩, 채널, 메시지에서 같은 조건인지 봅니다. | 비즈보드, 디스플레이, 메시지, 검색형은 지면과 수신 맥락이 달라 따로 점검합니다. |`;
    }
  };

  const citedLabels = Array.from(cited)
    .sort((a, b) => a - b)
    .map(labelForIndex)
    .join(', ');

  return [
    '검증된 정책/가이드 근거 기준으로만 보면, 광고 반려나 심사 이슈는 **정책·업종 제한 → 랜딩/목적지 → 소재 표현 → 계정·측정 설정** 순서로 좁히는 편이 안전합니다.',
    '',
    '**1. 매체별 점검 기준**',
    '',
    '| 매체 | 심사에서 먼저 볼 것 | 랜딩/목적지 체크 | 운영 점검 |',
    '|---|---|---|---|',
    ...uniqueRequestedVendors.map(rowForVendor),
    '',
    '**2. 공통 점검 순서**',
    '',
    '- 먼저 업종 자체가 제한되거나 추가 서류·고지·인증이 필요한지 확인합니다.',
    '- 다음으로 광고 문안, 이미지·동영상, 가격·혜택·이벤트 조건이 랜딩에서 같은 조건으로 확인되는지 봅니다.',
    '- 소재가 문제인지, 랜딩/목적지 문제인지, 계정·상품 데이터·전환 설정 문제인지 분리합니다.',
    '- 출처가 부족한 매체는 다른 매체 기준을 섞어 추정하지 말고 실제 문안·랜딩 URL·업종을 기준으로 원문 정책을 추가 대조합니다.',
    '',
    `근거: ${citedLabels || sources.map((_, index) => labelForIndex(index)).join(', ')}`,
  ].join('\n');
}

function buildFastPolicyAnswerText(
  family: FastPolicySourceGuidedAnswerFamily,
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
) {
  const cite = (index: number) => `[S${Math.min(index, Math.max(0, sources.length - 1)) + 1}]`;
  const citations = sources.map((_, index) => `[S${index + 1}]`).join(', ');
  const vendorLabel = intent.vendors.length === 1
    ? (VENDOR_LABELS[intent.vendors[0]] || intent.vendors[0])
    : '각 매체';

  switch (family) {
    case 'price_discount':
      return [
        '검증된 정책/가이드 근거 기준으로만 보면, 가격이나 할인율 표시는 실제 조건과 소비자 오인 가능성을 함께 확인해야 합니다.',
        '',
        '**판단 기준**',
        `- 가격, 할인율, 쿠폰·혜택처럼 금액이나 혜택을 나타내는 표현은 실제 등록 정보나 판매 조건과 맞아야 합니다 ${cite(0)}.`,
        `- 할인 조건이 특정 기간, 대상, 결제수단, 재고 등에 제한된다면 소재나 랜딩에서 그 조건을 확인할 수 있어야 합니다 ${cite(0)}.`,
        '',
        '**실무 확인**',
        `- 출처에 직접 없는 예외나 자동 승인 가능성은 보강하지 말고, 원문 정책과 실제 소재 맥락으로 최종 확인하세요 ${cite(1)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'user_deception':
      {
        const multiVendorAnswer = buildMultiVendorUserDeceptionPolicyAnswer(sources, intent);
        if (multiVendorAnswer) return multiVendorAnswer;
      }
      return [
        '검증된 정책 근거 기준으로만 보면, 이용자를 오인하게 하거나 기만할 수 있는 표현은 집행 가능 여부를 보수적으로 봐야 합니다.',
        '',
        '**판단 기준**',
        `- 상품·서비스의 효과, 조건, 주체를 사실과 다르게 이해하게 하는 오인·기만 표현은 제한 또는 반려 가능성이 있습니다 ${cite(0)}.`,
        `- 중요한 조건을 숨기거나 과장된 문구로 클릭을 유도하는 경우에는 소재와 랜딩의 실제 내용까지 함께 확인해야 합니다 ${cite(0)}.`,
        '',
        '**실무 확인**',
        `- 표현 자체뿐 아니라 사용자가 도착하는 페이지에서 같은 조건이 명확히 확인되는지도 원문 정책 기준으로 점검하세요 ${cite(1)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'event_material':
      return [
        '검증된 정책/가이드 근거 기준으로만 보면, 이벤트 광고 소재는 참여 조건과 경품 정보를 사용자가 오해하지 않게 확인해야 합니다.',
        '',
        '**필수 확인**',
        `- 이벤트, 경품, 참여 조건은 실제 제공 조건과 일치해야 하며 기간·대상·방법이 제한될 경우 그 범위를 명확히 확인해야 합니다 ${cite(0)}.`,
        `- 경품이나 혜택을 강조할수록 지급 기준, 참여 방법, 제외 조건이 소재 또는 랜딩에서 확인되는지 함께 봐야 합니다 ${cite(1)}.`,
        '',
        '**실무 확인**',
        `- 출처에 없는 세부 운영 방식은 임의로 보강하지 말고 원문 정책과 실제 이벤트 페이지 기준으로 검토하세요 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'medical_hospital_landing_review':
      return [
        '검증된 정책/가이드 근거 기준으로만 보면, 병원/의료 광고는 일반 상품 광고처럼 보지 말고 **의료법 등 관계 법령 위반 여부 → 광고 문안 표현 → 랜딩페이지 표시 정보 → 상담/예약 흐름** 순서로 확인해야 합니다.',
        '',
        '**판단 기준**',
        `- 의료법 등 현행 법률을 위반하는 경우 광고·메시지 집행이 제한될 수 있으므로, 병원·의료 서비스는 먼저 관련 법령 준수 여부를 확인해야 합니다 ${cite(0)}.`,
        `- 관계 법령에 따라 인터넷 광고가 금지되거나 인터넷 판매·유통 등이 제한되는 항목은 광고 문안뿐 아니라 연결 페이지와 상담 흐름까지 보수적으로 봐야 합니다 ${cite(0)}.`,
        `- 출처에 직접 확인되지 않은 매체별 예외나 자동 승인 가능성은 단정하지 말고, 실제 진료과·시술명·광고 문안·랜딩 URL을 원문 심사 기준과 대조해야 합니다 ${cite(1)}.`,
        '',
        '**랜딩 체크**',
        '- 광고 문안의 진료/시술 범위, 가격·혜택·이벤트 조건, 상담/예약 안내가 랜딩페이지에서 같은 조건으로 확인되는지 봅니다.',
        '- 전후사진, 후기, “최고/보장/무조건”처럼 효과를 단정하거나 과장·오인될 수 있는 표현은 별도 심사 리스크로 분리합니다.',
        '- 상담 신청 폼이나 예약 폼을 쓰는 경우 수집 항목, 동의, 후속 연락 안내도 추가 확인 대상으로 둡니다.',
        '',
        '**실무 확인**',
        `- 현재 확인된 출처 범위만으로 모든 매체의 병원 광고 허용/금지 기준을 확정하지 말고, 매체명과 실제 소재·랜딩을 원문 기준으로 다시 대조하세요 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'kakao_restricted_industry':
      return [
        '검증된 카카오 심사 가이드 근거 기준으로만 보면, 업종 제한은 “광고 가능 업종인지”와 “소재·랜딩이 등록 기준을 충족하는지”를 나누어 확인하는 편이 안전합니다.',
        '',
        '**확인 순서**',
        `- 먼저 제한 업종, 등록 불가, 집행 불가처럼 업종 자체가 막히는 조건이 있는지 원문 기준으로 확인해야 합니다 ${cite(0)}.`,
        `- 업종이 가능해 보이더라도 소재 표현, 랜딩, 고지·증빙 조건이 별도 심사 기준에 걸리지 않는지 함께 봐야 합니다 ${cite(1)}.`,
        '',
        '**실무 확인**',
        `- 출처에 없는 예외나 승인 가능성을 단정하지 말고, 실제 업종·상품·소재·랜딩을 카카오 원문 가이드와 대조하세요 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'kakao_service_protection':
      return [
        '검증된 카카오 정책 근거 기준으로만 보면, 카카오 로고나 서비스명·디자인 사용은 카카오 서비스 오인 가능성을 먼저 확인해야 합니다.',
        '',
        '**판단 기준**',
        `- 카카오 로고, 서비스명, 디자인을 광고에 사용할 때는 공식 카카오 서비스처럼 보이거나 제휴·보증으로 오인될 가능성을 점검해야 합니다 ${cite(0)}.`,
        `- 카카오의 상표·저작물·서비스 이미지를 무단 사용하거나 디자인을 모방하는 표현은 제한 또는 집행 불가 사유가 될 수 있습니다 ${cite(1)}.`,
        '',
        '**실무 확인**',
        `- 사용 권한, 표기 방식, 랜딩 내 설명이 원문 정책과 맞는지 확인한 뒤 소재 심사를 진행하는 쪽이 안전합니다 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'youth_harmful':
      return [
        '검증된 정책/가이드 근거 기준으로만 보면, 청소년 유해 콘텐츠는 광고 집행 가능 여부를 보수적으로 확인해야 합니다.',
        '',
        '**판단 기준**',
        `- 청소년에게 유해하거나 연령 보호가 필요한 표현, 상품, 랜딩 요소는 광고 심사에서 제한 또는 반려될 수 있습니다 ${cite(0)}.`,
        `- 문구와 이미지만이 아니라 연결되는 페이지에서 청소년 유해 요소가 드러나는지도 함께 확인해야 합니다 ${cite(1)}.`,
        '',
        '**실무 확인**',
        `- 출처에 없는 예외를 추정하지 말고 실제 소재, 업종, 랜딩을 원문 기준과 대조하세요 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'hate_discrimination':
      return [
        '검증된 정책/가이드 근거 기준으로만 보면, 혐오표현이나 차별 표현은 광고 집행 가능 여부를 보수적으로 봐야 합니다.',
        '',
        '**판단 기준**',
        `- 특정 집단을 혐오, 차별, 비하하거나 공격하는 표현은 광고 정책상 제한 또는 반려 가능성이 있습니다 ${cite(0)}.`,
        `- 풍자나 비교 표현처럼 보이더라도 사용자가 차별적 메시지로 받아들일 수 있는지 소재와 랜딩을 함께 확인해야 합니다 ${cite(1)}.`,
        '',
        '**실무 확인**',
        `- 출처에 없는 맥락을 보태 승인 가능성을 단정하지 말고, 원문 정책과 실제 표현을 기준으로 검토하세요 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'adult_content':
      return [
        '검증된 정책/가이드 근거 기준으로만 보면, 성인 콘텐츠나 선정적인 표현은 광고 심사에서 제한될 가능성을 먼저 확인해야 합니다.',
        '',
        '**판단 기준**',
        `- 성인, 선정, 음란, 노출처럼 청소년 유해 또는 부적절 표현으로 볼 수 있는 요소는 광고 정책상 제한 또는 반려 사유가 될 수 있습니다 ${cite(0)}.`,
        `- 소재 문구, 이미지, 영상, 랜딩 페이지가 함께 심사 맥락이 되므로 표현 수위와 실제 연결 페이지를 같이 점검해야 합니다 ${cite(1)}.`,
        '',
        '**실무 확인**',
        `- 업종별 허용 예외나 연령 타게팅 가능성을 출처 없이 단정하지 말고 원문 정책 기준으로 확인하세요 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'rights_infringement':
      return [
        '검증된 정책/가이드 근거 기준으로만 보면, 타인의 상표, 초상권, 저작권 같은 권리를 침해할 수 있는 광고는 집행 가능성을 보수적으로 봐야 합니다.',
        '',
        '**판단 기준**',
        `- 상표, 초상권, 저작권, 지식재산 등 권리 침해 소지가 있는 표현이나 이미지는 광고 제한 또는 반려 사유가 될 수 있습니다 ${cite(0)}.`,
        `- 권리자 허가, 사용 범위, 랜딩의 실제 표시가 확인되지 않으면 소재만 보고 가능하다고 단정하기 어렵습니다 ${cite(1)}.`,
        '',
        '**실무 확인**',
        `- 출처에 없는 사용 허가나 예외를 보강하지 말고, 실제 권리 관계와 원문 정책을 함께 확인하세요 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'review_standards':
      {
        const multiVendorAnswer = buildMultiVendorReviewStandardsPolicyAnswer(sources, intent);
        if (multiVendorAnswer) return multiVendorAnswer;
      }
      if (intent.vendors.length === 1 && intent.vendors[0] === 'NAVER') {
        return [
          '검증된 네이버 광고 등록 기준 근거 기준으로만 보면, 광고 심사는 등록 가능 업종·표현 제한·법령 준수·이용자 오인 가능성을 함께 검토해야 합니다.',
          '',
          '**판단 기준**',
          `- 광고 등록 기준은 소재와 랜딩이 네이버 원문 기준을 충족하는지 보는 흐름으로 접근해야 합니다 ${cite(0)}.`,
          `- 법령 위반, 필수 고지 누락, 허위·과장 또는 이용자 오인 표현은 등록 제한이나 반려 사유가 될 수 있으므로 별도 확인해야 합니다 ${cite(1)}.`,
          '',
          '**실무 확인**',
          `- 업종, 문구, 이미지·동영상, 랜딩의 실제 표시를 함께 놓고 원문 기준으로 최종 검토하세요 ${cite(0)}.`,
          '',
          `근거: ${citations}`,
        ].join('\n');
      }
      if (intent.vendors.length === 1 && intent.vendors[0] === 'GOOGLE') {
        return [
          '검증된 Google Ads 정책 근거 기준으로만 보면, 정책 위반 여부는 소재 표현, 캠페인 설정, 랜딩 페이지를 함께 검토해야 합니다.',
          '',
          '**판단 기준**',
          `- Google Ads 정책에서 제한하거나 금지하는 표현, 업종, 소재 요소가 있는지 먼저 확인해야 합니다 ${cite(0)}.`,
          `- 정책 검토는 광고 문구만이 아니라 이미지·동영상 소재, 연결 URL, 랜딩 페이지의 실제 내용까지 함께 대조하는 편이 안전합니다 ${cite(1)}.`,
          '',
          '**실무 확인**',
          `- 출처에 없는 승인 예외는 단정하지 말고 실제 소재와 랜딩을 Google 원문 정책 기준으로 최종 검토하세요 ${cite(0)}.`,
          '',
          `근거: ${citations}`,
        ].join('\n');
      }
      return [
        '검증된 정책/가이드 근거 기준으로만 보면, 광고 심사 기준은 소재 표현, 업종, 랜딩, 계정 설정을 함께 놓고 확인해야 합니다.',
        '',
        '**판단 기준**',
        `- 광고 심사나 등록 기준은 단일 문구만이 아니라 소재와 랜딩이 원문 기준을 충족하는지 보는 흐름으로 접근해야 합니다 ${cite(0)}.`,
        `- 집행 가능 여부는 업종 제한, 금지 표현, 필수 고지, 증빙 조건이 함께 걸릴 수 있으므로 확인 범위를 나눠 봐야 합니다 ${cite(1)}.`,
        '',
        '**실무 확인**',
        `- 출처에 없는 자동 승인 가능성은 단정하지 말고 실제 소재·랜딩·업종을 원문 심사 기준과 대조한 뒤 최종 검토하세요 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
    case 'vendor_policy_general':
      if (intent.vendors.length === 1 && intent.vendors[0] === 'META') {
        return [
          'Meta 광고 정책은 소재 문구만 보는 기준이 아니라, 광고 표준 위반 여부를 소재·타겟팅·연결 URL·랜딩 페이지까지 함께 검토하는 체계로 보는 편이 안전합니다.',
          '',
          '**핵심 기준**',
          `- Meta 광고 표준은 광고에서 허용되는 콘텐츠와 금지되는 콘텐츠에 대한 세부 정책과 지침을 제공합니다 ${cite(0)}.`,
          `- 광고 검토는 이미지, 동영상, 텍스트, 타겟팅, 연결 URL, 랜딩 페이지까지 포함할 수 있으므로 소재와 랜딩의 표현이 서로 맞는지 함께 봐야 합니다 ${cite(2)}.`,
          `- 차별 관행 정책에서는 오디언스 선택 도구로 특정 그룹을 부당하게 포함하거나 제외하는 행위와 차별적 광고 콘텐츠를 금지합니다 ${cite(1)}.`,
          `- 혐오 행동 광고는 인종, 민족, 국적, 장애, 종교, 계급, 성적 지향, 성별, 성 정체성, 심각한 질병 등 보호 특성을 근거로 타인을 공격하면 안 됩니다 ${cite(3)}.`,
          '',
          '**실무 체크**',
          '- 타겟팅: 보호 특성 집단을 배제하거나 특정 집단만 부당하게 겨냥하는 조건이 없는지 확인합니다.',
          '- 소재: 문구, 이미지, 영상에서 개인 특성 단정, 차별, 혐오, 과장·오인 가능성이 없는지 확인합니다.',
          '- 랜딩: 광고에서 약속한 조건과 실제 랜딩의 가격, 혜택, 고지, 서비스 내용이 일치하는지 확인합니다.',
          '- 승인 후 리스크: 광고가 게재되기 전 모든 정책을 완전히 검토하지 않을 수도 있으므로, 승인 이후에도 수정·제한 가능성을 염두에 둡니다.',
          '',
          `근거: ${citations}`,
        ].join('\n');
      }
      if (intent.vendors.length === 1 && intent.vendors[0] === 'NAVER') {
        return [
          '검증된 네이버 광고 정책 근거 기준으로만 보면, 정책 위반 소재 판단은 광고 등록 기준, 법령 준수, 이용자 오인 가능성을 함께 검토해야 합니다.',
          '',
          '**판단 기준**',
          `- 네이버 광고 등록 기준에서 금지하거나 제한하는 표현, 업종, 소재 요소가 있는지 먼저 확인해야 합니다 ${cite(0)}.`,
          `- 법령 위반, 허위·과장, 이용자 오인 가능성은 문구와 랜딩의 실제 표시까지 함께 대조해야 합니다 ${cite(1)}.`,
          '',
          '**실무 확인**',
          `- 출처에 없는 예외나 계정별 승인 가능성은 단정하지 말고 네이버 원문 정책과 실제 소재 기준으로 최종 검토하세요 ${cite(0)}.`,
          '',
          `근거: ${citations}`,
        ].join('\n');
      }
      if (intent.vendors.length === 1 && intent.vendors[0] === 'GOOGLE') {
        return [
          '검증된 Google Ads 정책 근거 기준으로만 보면, 정책 위반 소재 판단은 원문 정책과 실제 광고·랜딩 맥락을 함께 검토해야 합니다.',
          '',
          '**판단 기준**',
          `- Google Ads 정책에서 금지하거나 제한하는 표현, 업종, 소재 요소가 있는지 먼저 확인해야 합니다 ${cite(0)}.`,
          `- 정책 위반 여부는 광고 문구만이 아니라 이미지, 동영상, 랜딩 페이지, 고지 조건까지 함께 대조하는 편이 안전합니다 ${cite(1)}.`,
          '',
          '**실무 확인**',
          `- 출처에 없는 예외나 계정별 승인 가능성은 단정하지 말고 Google 원문 정책과 실제 소재 기준으로 최종 검토하세요 ${cite(0)}.`,
          '',
          `근거: ${citations}`,
        ].join('\n');
      }
      return [
        `검증된 ${vendorLabel} 광고 정책 근거 기준으로만 보면, 정책 위반 소재 판단은 원문 정책과 실제 광고·랜딩 맥락을 함께 확인해야 합니다.`,
        '',
        '**판단 기준**',
        `- ${vendorLabel} 광고 정책에서 금지하거나 제한하는 표현, 업종, 소재 요소가 있는지 먼저 확인해야 합니다 ${cite(0)}.`,
        `- 정책 위반 여부는 광고 문구만이 아니라 이미지, 동영상, 랜딩 페이지, 고지 조건까지 함께 대조하는 편이 안전합니다 ${cite(1)}.`,
        '',
        '**실무 확인**',
        `- 출처에 없는 예외나 계정별 승인 가능성은 단정하지 말고 ${vendorLabel} 원문 정책과 실제 소재 기준으로 최종 검토하세요 ${cite(0)}.`,
        '',
        `근거: ${citations}`,
      ].join('\n');
  }
}

function buildFastPolicySourceGuidedAnswer(
  message: string,
  intent: QueryIntent,
  sources: ReturnType<typeof buildVerifiedSources>,
  isBroadProductStructureLlmIntent: boolean,
): (DeterministicProductAnswer & {
  policyAnswerFamily: FastPolicySourceGuidedAnswerFamily;
  fastAnswerFallback: FastPolicySourceGuidedAnswerFallback;
}) | null {
  if (process.env.COMPASS_DISABLE_FAST_POLICY_SOURCE_GUIDED_ANSWERS === 'true') return null;
  if (isBroadProductStructureLlmIntent) return null;
  if (intent.isOutOfScope || intent.unavailablePolicyTarget) return null;

  const family = detectFastPolicySourceGuidedAnswerFamily(message, intent);
  if (!family) return null;

  const pattern = getFastPolicySourcePattern(family);
  const requiredVendor = family === 'kakao_service_protection' || family === 'kakao_restricted_industry'
    ? 'KAKAO'
    : (intent.vendors.length === 1 ? intent.vendors[0] : undefined);
  const candidateSources = dedupePublicProductSources(
    sources.filter(source => {
      if (source.evidenceDecision === 'rejected') return false;
      if (requiredVendor && (!sourceMatchesVendor(source, requiredVendor) || sourceHasCrossVendorUrl(source, [requiredVendor]))) {
        return false;
      }
      const sourceText = normalizeEvidenceText([
        source.title,
        source.originalTitle,
        source.excerpt,
        source.matchText,
        getFallbackSourceText(source),
      ].filter(Boolean).join(' '));
      if (!pattern.test(sourceText)) return false;
      if (sourceHasBlockingExtractionNoise(source) && !/광고|가이드|정책|심사|운영|상품|소재/.test(sourceText)) {
        return false;
      }
      return true;
    }),
    6,
  );
  if (candidateSources.length === 0) return null;

  return {
    answer: polishCompassAnswerStyle(buildFastPolicyAnswerText(family, candidateSources, intent)),
    sources: candidateSources,
    model: `compass-answer-fast-policy-source-guided-${family.replace(/_/g, '-')}`,
    showContactOption: true,
    confidenceCap: family === 'kakao_service_protection' || family === 'kakao_restricted_industry' ? 80 : 76,
    reviewStatus: 'completed',
    policyAnswerFamily: family,
    fastAnswerFallback: getFastPolicyAnswerFallback(family),
  };
}

function buildFastNaverVideoProductAnswer(
  message: string,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
  fallbackSources: ReturnType<typeof buildVerifiedSources>,
): (DeterministicProductAnswer & { fastAnswerFallback: FastNaverVideoProductAnswerFallback }) | null {
  if (process.env.COMPASS_DISABLE_FAST_NAVER_VIDEO_PRODUCT_ANSWERS === 'true') return null;
  if (!intent.topics.includes('product_structure')) return null;
  if (intent.vendors.length !== 1 || intent.vendors[0] !== 'NAVER' || intent.isComparative) return null;
  if (!intent.isSpecificProductGuidance && !hasNamedSpecificProductQuestion(message)) return null;

  const queryText = normalizeProductIntentText(message);
  if (!/동영상|비디오|video|숏폼|아웃스트림|인스트림|클립|조회/.test(queryText)) return null;

  const scopedSources = scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources;
  const candidateSources = scopedSources.length > 0 ? scopedSources : fallbackSources;
  const naverSources = candidateSources.filter(source => (
    sourceMatchesVendor(source, 'NAVER')
    && !sourceHasCrossVendorUrl(source, ['NAVER'])
    && !sourceHasExtractionNoise(source)
    && String(source.excerpt || source.matchText || source.title || '').trim()
  ));
  const answerSources = dedupePublicProductSources(
    naverSources.length > 0 ? naverSources : candidateSources,
    6,
  );
  if (answerSources.length === 0) return null;

  const structuredAnswer = buildNaverVideoStructuredFallbackAnswer(answerSources, intent, message);
  if (!structuredAnswer) return null;

  return {
    answer: polishCompassAnswerStyle(structuredAnswer),
    sources: answerSources,
    model: 'compass-answer-fast-naver-video-product-structured',
    showContactOption: true,
    confidenceCap: 78,
    reviewStatus: 'completed',
    fastAnswerFallback: 'naver_video_product_structured',
  };
}

function buildMetaCatalogStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  message: string,
) {
  if (!intent.vendors.includes('META')) return null;
  if (detectProductAnswerFamily(message, intent) !== 'meta_catalog') return null;

  const used = new Set<number>();
  const sections = [
    'Meta 카탈로그/컬렉션 계열 광고는 상품 카탈로그와 구매 흐름을 연결해 운영하는 상품군입니다.',
    '',
    '**집행 전 확인**',
  ];

  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /카탈로그|catalog|상품\s*(데이터|정보|이미지)|product\s*(data|image)|feed|피드/i,
    label => `- 카탈로그 또는 Catalog 기반 상품은 상품 데이터가 광고에 연결되는 구조인지 먼저 확인합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /컬렉션|collection|collection\s*ads?|instant\s*experience|인스턴트\s*경험/i,
    label => `- 컬렉션 광고는 커버 이미지/동영상과 카탈로그 상품 이미지를 함께 보여주고 구매 흐름으로 연결하는지 봅니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /advantage\+|어드밴티지|자동화|최적화/i,
    label => `- Advantage+ 또는 자동화 문맥이 함께 잡히면 상품 노출과 최적화 조건을 별도로 대조합니다 ${label}.`,
  );

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, 카탈로그 연결 상태와 컬렉션/자동화 운영 조건을 같은 공식 출처 기준으로 확인하는 것이 핵심입니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);
  return sections.join('\n');
}

function isMetaCreativeSpecFastStructuredIntent(message: string, intent: QueryIntent): boolean {
  if (intent.vendors.length !== 1 || intent.vendors[0] !== 'META' || intent.isComparative) return false;
  const text = normalizeProductIntentText([
    message,
    ...intent.keywords,
    ...intent.strictProductTerms,
    ...intent.strictContextTerms,
  ].filter(Boolean).join(' '));
  return intent.topics.includes('spec')
    || intent.topics.includes('product_structure')
    || /소재|사양|스펙|규격|비율|사이즈|크기|해상도|파일|이미지|동영상|비디오|카루셀|캐러셀|carousel|슬라이드|instagram|인스타그램/.test(text);
}

function buildMetaCreativeSpecStructuredFallbackAnswer(
  sources: ReturnType<typeof buildVerifiedSources>,
  intent: QueryIntent,
  message: string,
) {
  if (!isMetaCreativeSpecFastStructuredIntent(message, intent)) return null;
  if (detectProductAnswerFamily(message, intent) !== 'meta_creative_spec') return null;

  const used = new Set<number>();
  const sections = [
    'Meta 광고 소재 사양은 광고 형식과 노출 위치에 따라 달라지므로, 이미지·동영상·슬라이드 같은 형식별 요구사항을 먼저 나눠 확인하는 편이 안전합니다.',
    '',
    '1. **이미지·동영상 기본 사양 확인**',
    '',
  ];

  const addedCanonicalImageSpec = addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /이미지[\s\S]{0,180}(1200\s*x\s*628|1200x628|1\.91:1)[\s\S]{0,180}(jpg|png|30mb|파일)|1200\s*x\s*628[\s\S]{0,180}(jpg|png|30mb|파일)/i,
    label => `- Facebook 이미지 광고는 1200x628픽셀(1.91:1) 같은 지면별 권장 크기와 JPG/PNG, 최대 파일 크기 조건을 함께 확인해야 합니다 ${label}.`,
  );
  if (!addedCanonicalImageSpec) addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /이미지[\s\S]{0,180}(jpg|png|비율|해상도|1080x1080|파일)|파일\s*형식:\s*jpg|이미지\s*파일\s*형식/i,
    label => `- 이미지 소재는 JPG/PNG 같은 파일 형식, 권장 비율, 해상도, 최대 파일 크기를 지면별 원문에서 확인해야 합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /동영상[\s\S]{0,220}(mp4|mov|gif|h\.264|길이|4gb|프레임|오디오)|파일\s*형식:\s*mp4|동영상\s*파일\s*형식/i,
    label => `- 동영상 소재는 MP4/MOV/GIF, 압축 설정, 길이, 최대 파일 크기처럼 이미지와 다른 기술 요구사항을 따로 봐야 합니다 ${label}.`,
  );

  sections.push('');
  sections.push('2. **슬라이드/캐러셀과 노출 위치 조건 확인**');
  sections.push('');
  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /슬라이드|카루셀|캐러셀|carousel|2~10개|최대\s*동영상\s*파일\s*크기|랜딩\s*페이지\s*URL/i,
    label => `- 슬라이드/캐러셀 형식은 이미지 또는 동영상을 여러 장 쓰는 구조라 슬라이드 수, 랜딩 URL, 파일 크기 조건을 함께 확인해야 합니다 ${label}.`,
  );
  addFallbackLine(
    sections,
    used,
    sources,
    'META',
    /facebook|instagram|페이스북|인스타그램|피드|검색\s*결과|탐색\s*홈|노출\s*위치|광고\s*정책/i,
    label => `- 같은 형식이라도 Facebook 피드, 검색 결과, Instagram 탐색 홈처럼 노출 위치별 권장값과 정책 문구가 달라질 수 있습니다 ${label}.`,
  );

  if (used.size === 0) return null;

  sections.push('');
  sections.push('정리하면, Meta 소재 규격은 “이미지/동영상/슬라이드 중 무엇인지”와 “어느 노출 위치에 낼지”를 먼저 고른 뒤 해당 공식 가이드의 권장값을 대조하는 흐름이 가장 안전합니다.');
  sections.push('');
  sections.push(`근거: ${formatFallbackEvidenceLabels(used)}`);
  return sections.join('\n');
}

function buildFastStructuredSpecificProductAnswer(
  message: string,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
  fallbackSources: ReturnType<typeof buildVerifiedSources>,
): (DeterministicProductAnswer & { fastAnswerFallback: FastStructuredSpecificProductAnswerFallback }) | null {
  if (process.env.COMPASS_DISABLE_FAST_STRUCTURED_SPECIFIC_PRODUCT_ANSWERS === 'true') return null;
  const isMetaCreativeSpecFastIntent = isMetaCreativeSpecFastStructuredIntent(message, intent);
  if (!intent.topics.includes('product_structure') && !isMetaCreativeSpecFastIntent) return null;
  if (intent.vendors.length !== 1 || intent.isComparative) return null;
  if (!isMetaCreativeSpecFastIntent && !intent.isSpecificProductGuidance && !hasNamedSpecificProductQuestion(message)) return null;

  const vendor = intent.vendors[0];
  const scopedSources = scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources;
  const candidateSources = scopedSources.length > 0 ? scopedSources : fallbackSources;
  const vendorSources = candidateSources.filter(source => (
    sourceMatchesVendor(source, vendor)
    && !sourceHasCrossVendorUrl(source, [vendor])
    && !sourceHasExtractionNoise(source)
    && String(source.excerpt || source.matchText || source.title || '').trim()
  ));
  const answerSources = dedupePublicProductSources(
    vendorSources.length > 0 ? vendorSources : candidateSources,
    6,
  );
  if (answerSources.length === 0) return null;

  const builders: Array<{
    vendor: VendorIntent;
    model: string;
    fastAnswerFallback: FastStructuredSpecificProductAnswerFallback;
    confidenceCap: number;
    build: () => string | null;
  }> = [
    {
      vendor: 'META',
      model: 'compass-answer-fast-meta-app-install-structured',
      fastAnswerFallback: 'meta_app_install_structured',
      confidenceCap: 78,
      build: () => buildMetaAppInstallStructuredFallbackAnswer(answerSources, intent, message),
    },
    {
      vendor: 'META',
      model: 'compass-answer-fast-meta-catalog-structured',
      fastAnswerFallback: 'meta_catalog_structured',
      confidenceCap: 78,
      build: () => buildMetaCatalogStructuredFallbackAnswer(answerSources, intent, message),
    },
    {
      vendor: 'META',
      model: 'compass-answer-fast-meta-creative-spec-structured',
      fastAnswerFallback: 'meta_creative_spec_structured',
      confidenceCap: 78,
      build: () => buildMetaCreativeSpecStructuredFallbackAnswer(answerSources, intent, message),
    },
    {
      vendor: 'NAVER',
      model: 'compass-answer-fast-naver-shopping-search-creative-structured',
      fastAnswerFallback: 'naver_shopping_search_creative_structured',
      confidenceCap: 78,
      build: () => buildNaverShoppingSearchCreativeGuideStructuredFallbackAnswer(answerSources, intent, message),
    },
    {
      vendor: 'NAVER',
      model: 'compass-answer-fast-naver-shopping-data-operational',
      fastAnswerFallback: 'naver_shopping_data_operational',
      confidenceCap: 80,
      build: () => buildNaverShoppingDataOperationalAnswer(message, answerSources),
    },
    {
      vendor: 'NAVER',
      model: 'compass-answer-fast-naver-shopping-data-structured',
      fastAnswerFallback: 'naver_shopping_data_structured',
      confidenceCap: 78,
      build: () => buildNaverShoppingDataStructuredFallbackAnswer(answerSources, intent, message),
    },
    {
      vendor: 'NAVER',
      model: 'compass-answer-fast-naver-display-ad-structured',
      fastAnswerFallback: 'naver_display_ad_structured',
      confidenceCap: 78,
      build: () => buildNaverDisplayAdStructuredFallbackAnswer(answerSources, intent, message),
    },
    {
      vendor: 'GOOGLE',
      model: 'compass-answer-fast-google-lead-structured',
      fastAnswerFallback: 'google_lead_structured',
      confidenceCap: 78,
      build: () => buildGoogleLeadStructuredFallbackAnswer(answerSources, intent, message),
    },
  ];

  for (const builder of builders) {
    if (builder.vendor !== vendor) continue;
    const structuredAnswer = builder.build();
    if (!structuredAnswer) continue;
    return {
      answer: polishCompassAnswerStyle(structuredAnswer),
      sources: answerSources,
      model: builder.model,
      showContactOption: true,
      confidenceCap: builder.confidenceCap,
      reviewStatus: 'completed',
      fastAnswerFallback: builder.fastAnswerFallback,
    };
  }

  return null;
}

function buildFastKakaoSpecificProductAnswer(
  message: string,
  intent: QueryIntent,
  scope: ReturnType<typeof buildSpecificProductAnswerScope>,
): (DeterministicProductAnswer & { fastAnswerFallback: FastKakaoProductAnswerFallback }) | null {
  if (process.env.COMPASS_DISABLE_FAST_KAKAO_SPECIFIC_PRODUCT_ANSWERS === 'true') return null;
  if (!intent.topics.includes('product_structure')) return null;
  if (intent.vendors.length !== 1 || intent.vendors[0] !== 'KAKAO' || intent.isComparative) return null;
  if (!intent.isSpecificProductGuidance && !hasNamedSpecificProductQuestion(message)) return null;

  const family = detectProductAnswerFamily(message, intent);
  if (family !== 'kakao_bizboard' && family !== 'kakao_creative') return null;

  const candidateSources = scope.answerSources.length > 0 ? scope.answerSources : scope.strictProductSources;
  if (candidateSources.length === 0) return null;

  const deterministicAnswer = buildDeterministicSpecificProductAnswer(message, intent, scope);
  if (deterministicAnswer) {
    return {
      ...deterministicAnswer,
      model: `${deterministicAnswer.model}-fast-source-guided`,
      fastAnswerFallback: 'kakao_specific_product_source_guided',
    };
  }

  const structuredAnswer = buildStructuredSpecificProductScopeLimitedAnswer(candidateSources, intent, message);
  if (!structuredAnswer) return null;

  return {
    answer: polishCompassAnswerStyle(structuredAnswer),
    sources: candidateSources.slice(0, 6),
    model: 'compass-answer-fast-kakao-specific-product-source-guided',
    showContactOption: true,
    confidenceCap: 76,
    reviewStatus: 'completed',
    fastAnswerFallback: 'kakao_specific_product_source_guided',
  };
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
  const scopedIntent = getBroadProductDeterministicIntent(message, intent);
  if (!scopedIntent) {
    return null;
  }

  const family = detectProductAnswerFamily(message, scopedIntent);
  if (family === 'meta_overview') {
    return buildMetaProductPlanningMatrixAnswer(sources);
  }
  if (family === 'google_overview') {
    return buildGoogleProductPlanningMatrixAnswer(sources);
  }

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

  if (/세금|tax|vat|청구|결제|지불|billing|payment|invoice/.test(text)) return true;
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
  return /캠페인\s*(목표|유형|목적)|광고\s*(상품|종류|유형|구조)|상품\s*구조|광고\s*관리자\s*목표|마케팅\s*목표|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|비즈보드|상품\s*db|db\s*url|쇼핑검색|쇼핑블록|사이트검색광고|쇼핑검색광고|브랜드검색|파워링크|상품가이드|상품\s*가이드|campaign[_\s-]*objective|objectives?|catalog|app\s*(install|promotion)/.test(text);
}

function isLowValueProductStructureGraphSource(source: ReturnType<typeof buildVerifiedSources>[number]) {
  if (!isGraphVerifiedSource(source)) return false;
  const text = getProductStructureVisibleSourceText(source);
  if (graphSourceLooksLikeBroadBusinessNewsTitle(source) && !graphSourceHasAdProductTitle(source)) return true;
  if (sourceLooksLikeGranularCreativeSpecOnly(source) && /광고\s*사양|기술\s*요구\s*사항|파일\s*(크기|형식)|화면\s*비율/.test(text)) return true;
  if (/데이터\s*분류|개인정보\s*보호/.test(text)) return true;
  if (/오프라인\s*전환|향상된\s*전환|전환\s*(api|최적화|측정|추적|가져오기)|conversion\s*api|conversions?\s*api|enhanced\s*conversions|offline\s*conversion|capi/.test(text)) return true;
  if (/라이브\s*관리|라이브커머스|쇼핑\s*라이브|shopping\s*live/.test(text)) return true;
  if (/가입하기|회원\s*가입|계정\s*(생성|만들기)|비즈니스\s*계정/.test(text)) return true;
  return /세금|청구|결제|지불|billing|payment|invoice|woocommerce|google\s*태그|태그\s*설정|gtag|측정\s*태그/.test(text)
    && !hasProductStructureGraphSourceSignal(source);
}

function graphSourceHasAdProductTitle(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const title = normalizeEvidenceText(source.title || '');
  return /광고\s*(관리자|상품|종류|유형|구조|목표|목적|가이드|사양)|캠페인\s*(목표|유형|목적)|campaign\s*objective|objectives?|instagram\s*광고\s*(가이드|관리자|상품|사양)|threads\s*광고\s*(가이드|관리자|상품|사양)|앱\s*(광고|캠페인|홍보)|게재\s*위치|노출\s*위치|advantage\+|어드밴티지|카탈로그|catalog|컬렉션\s*광고|리드\s*양식|lead\s*ads?|상품\s*가이드|상품가이드|audience\s*network|messenger/.test(title);
}

function graphSourceLooksLikeBroadBusinessNewsTitle(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const title = normalizeEvidenceText(source.title || '');
  return /뉴스|합류|혁신|spotlight|creator\s*method|cyber\s*5|성공\s*전략|트렌드|협업|크리에이터|크리에이티브\s*다각화|creative\s*diversification|demystifying[-\s]*creative[-\s]*diversification|manus|성과\s*증대|도입\s*1주년|게이밍\s*광고주/.test(title);
}

function scoreProductStructureGraphSource(source: ReturnType<typeof buildVerifiedSources>[number], targetVendor?: VendorIntent) {
  const text = getProductStructureVisibleSourceText(source);
  let score = Number(source.hybridScore || source.score || 0);
  if (isOfficialGuideGraphSource(source)) score += 0.65;
  if (sourceMatchesVendor(source, targetVendor)) score += 0.3;
  if (hasProductStructureGraphSourceSignal(source)) score += 1.05;
  if (graphSourceHasAdProductTitle(source)) score += 0.55;
  if (graphSourceLooksLikeBroadBusinessNewsTitle(source) && !graphSourceHasAdProductTitle(source)) score -= 2.2;
  if (/캠페인\s*(목표|유형|목적)|광고\s*(상품|종류|유형|구조)|상품\s*구조|광고\s*관리자\s*목표|마케팅\s*목표|검색\s*캠페인|디스플레이\s*캠페인|반응형\s*디스플레이|쇼핑\s*광고|앱\s*(캠페인|인스톨|설치|홍보|이벤트)|리드\s*양식|비즈보드|상품\s*db|db\s*url|상품가이드|상품\s*가이드|campaign\s*objective|objectives?|catalog/.test(text)) {
    score += 0.45;
  }
  if (/세금|tax|vat|청구|결제|지불|billing|payment|invoice/.test(text)) score -= 1.8;
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
    META: /meta|메타|facebook|페이스북|instagram|인스타그램|릴스|reels|advantage\+|어드밴티지|메타\s*픽셀/,
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
    META: /meta|메타|facebook|페이스북|instagram|인스타그램|릴스|reels/,
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
  const hasProductTaxonomy = /캠페인\s*(목표|유형|목적)|광고\s*(상품|종류|유형|구조)|상품\s*구조|광고\s*관리자\s*목표|마케팅\s*목표|목적별|목표별|campaign[_\s-]*objective|objectives?/.test(text);
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

function sourceLooksLikeProductStructureSupportNoise(source: ReturnType<typeof buildVerifiedSources>[number]) {
  const text = normalizeEvidenceText([
    getSourceIdentityText(source),
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
  ].join(' '));
  const hasSupportSignal = /세금|tax|vat|청구|결제|지불|billing|payment|invoice|비즈쿠폰|쿠폰|광고할\s*수\s*없는\s*경우|광고\s*게재\s*제한/.test(text);
  if (!hasSupportSignal) return false;

  return !/상품\s*db|상품db|db\s*url|dburl|ep\s*\(=\s*db\s*url\)|쇼핑파트너센터|상품정보\s*수신|상품관리|가격비교|상품\s*등록|상품등록/.test(text);
}

function sourceLooksLikeMetaBroadProductNewsNoise(source: ReturnType<typeof buildVerifiedSources>[number]) {
  if (!sourceMatchesVendor(source, 'META')) return false;

  const identityText = normalizeEvidenceText(getSourceIdentityText(source));
  const text = normalizeEvidenceText([
    identityText,
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
  ].join(' '));
  const isMetaNewsSource = /facebook\.com\/business\/news|\/business\/news|business\/news/.test(identityText)
    || /도입\s*1주년|전\s*세계의\s*모든\s*사용자|성과\s*증대|게이밍\s*광고주|광고주의\s*성과|heroes\s*&?\s*dragons|크리에이티브\s*다각화|creative\s*diversification|demystifying[-\s]*creative[-\s]*diversification|manus|ai\s*혁신|혁신\s*가속화|cyber\s*5|사이버\s*5|creator\s*method|크리에이터|성공\s*전략|threads\s*광고|app\s*value\s*optimization/i.test(text);
  if (!isMetaNewsSource) return false;

  const hasBroadOverviewStructure = /광고\s*관리자\s*목표|캠페인\s*(목표|목적|유형)|마케팅\s*목표|목표[\s\S]{0,120}(인지도|트래픽|참여|잠재\s*고객|앱\s*홍보|판매)|인지도[\s\S]{0,120}트래픽[\s\S]{0,120}참여[\s\S]{0,120}잠재\s*고객[\s\S]{0,120}앱\s*홍보[\s\S]{0,120}판매|광고\s*(상품|종류|유형|구조)|상품\s*구조|목적별|목표별|objective|objectives/i.test(text);
  const looksLikeSingleNewsStory = /도입\s*1주년|전\s*세계의\s*모든\s*사용자|성과\s*증대|게이밍\s*광고주|광고주의\s*성과|heroes\s*&?\s*dragons|사용자\s*확보\s*투자|크리에이티브\s*다각화|creative\s*diversification|demystifying[-\s]*creative[-\s]*diversification|manus|ai\s*혁신|혁신\s*가속화|cyber\s*5|사이버\s*5|creator\s*method|크리에이터|성공\s*전략|threads\s*광고|app\s*value\s*optimization/i.test(text);

  return looksLikeSingleNewsStory || !hasBroadOverviewStructure;
}

function sourceIsOfficialMetaProductOverviewSnapshot(source: ReturnType<typeof buildVerifiedSources>[number]) {
  if (!sourceMatchesVendor(source, 'META')) return false;
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  const identityText = normalizeEvidenceText([
    getSourceIdentityText(source),
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
    metadata.sourceKind,
    metadata.answerEvidenceRole,
    metadata.answer_evidence_role,
  ].filter(Boolean).join(' '));

  return metadata.metaProductOverviewOfficialChunk === true
    || metadata.officialProductOverviewSnapshot === true
    || metadata.answerEvidenceRole === 'official_product_overview'
    || metadata.answer_evidence_role === 'official_product_overview'
    || /meta_product_overview_official_chunk|official_product_overview|meta_business_help_(ad_levels|objectives|formats_placements|operating_modules)_2026|facebook\.com\/business\/help\/(621956575422138|1438417719786914|279271845888065|2035196646663270)/.test(identityText);
}

function sourceIsOfficialProductOverviewSnapshot(
  source: ReturnType<typeof buildVerifiedSources>[number],
  targetVendor?: VendorIntent,
) {
  if (!sourceMatchesVendor(source, targetVendor)) return false;
  if (targetVendor && hasExplicitOtherVendorSignal(source, targetVendor)) return false;
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  const identityText = normalizeEvidenceText([
    getSourceIdentityText(source),
    getProductStructureVisibleSourceText(source),
    getSourceText(source),
    metadata.sourceKind,
    metadata.source_kind,
    metadata.answerEvidenceRole,
    metadata.answer_evidence_role,
    metadata.productStructureAnchor,
    Array.isArray(source.rankReason) ? source.rankReason.join(' ') : '',
    Array.isArray(source.evidenceDecisionReason) ? source.evidenceDecisionReason.join(' ') : '',
  ].filter(Boolean).join(' '));

  return metadata.officialProductOverviewSnapshot === true
    || metadata.metaProductOverviewOfficialChunk === true
    || metadata.googleProductOverviewOfficialChunk === true
    || metadata.answerEvidenceRole === 'official_product_overview'
    || metadata.answer_evidence_role === 'official_product_overview'
    || /official_product_overview|meta_product_overview_official_chunk|google_product_overview_official_chunk|naver_(video|shopping|display).*official_chunk|kakao_product_official_chunk/.test(identityText)
    || /meta_business_help_(ad_levels|objectives|formats_placements|operating_modules)_2026|google_ads_(campaign_types|campaign_objectives|shopping_ads|app_campaigns)_2026/.test(identityText);
}

function isUsableBroadProductStructureSource(
  source: ReturnType<typeof buildVerifiedSources>[number],
  targetVendor?: VendorIntent,
) {
  if (!sourceMatchesVendor(source, targetVendor)) return false;
  if (targetVendor && hasExplicitOtherVendorSignal(source, targetVendor)) return false;
  if (sourceIsOfficialProductOverviewSnapshot(source, targetVendor)) return true;
  if (targetVendor === 'META' && sourceLooksLikeMetaBroadProductNewsNoise(source)) return false;
  if (sourceIdentityLooksLikeGenericLegalOrAccountDoc(source)) return false;
  if (sourceLooksLikeProductStructureSupportNoise(source)) return false;
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
  if (sourceIsOfficialProductOverviewSnapshot(source, targetVendor)) score += 1.4;
  if (isOfficialGuideGraphSource(source)) score += 0.75;
  if (isGraphVerifiedSource(source)) score += 0.35;
  if (hasProductStructureGraphSourceSignal(source)) score += 0.9;
  if (hasBroadProductStructureAnswerSignal(source)) score += 0.85;

  const queryHits = queryTerms.filter(term => textContainsEvidenceTerm(text, term)).length;
  score += Math.min(2.8, queryHits * 0.3);

  if (/세금|tax|vat|청구|결제|지불|billing|payment|invoice/.test(text)) score -= 2.4;
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
    .filter(source => !(targetVendor === 'META' && graphSourceLooksLikeBroadBusinessNewsTitle(source) && !graphSourceHasAdProductTitle(source)))
    .filter(source => !sourceHasBlockingExtractionNoise(source));
  const baseUsableLabelledSources = labelledSources
    .filter(source => isUsableBroadProductStructureSource(source, targetVendor));
  const officialProductOverviewSources = labelledSources
    .filter(source => sourceIsOfficialProductOverviewSnapshot(source, targetVendor));
  const officialProductOverviewKeys = new Set(officialProductOverviewSources.map(getProductStructureSourceKey).filter(Boolean));
  const usableLabelledSources = [
    ...officialProductOverviewSources,
    ...baseUsableLabelledSources.filter(source => {
      if (officialProductOverviewSources.includes(source)) return false;
      const key = getProductStructureSourceKey(source);
      return !key || !officialProductOverviewKeys.has(key);
    }),
  ];
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
      const perGroupLimit = sourceGroup === 'official_product_overview' || sourceGroup === 'official_meta_overview' ? 4 : sourceGroup === 'official_graph' ? 3 : 2;
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
        if (targetVendor === 'META' && sourceLooksLikeMetaBroadProductNewsNoise(source)) return null;

        const text = normalizeEvidenceText([
          getProductStructureVisibleSourceText(source),
          getSourceText(source),
        ].join(' '));
        const queryHits = queryTerms.filter(term => textContainsEvidenceTerm(text, term)).length;
        const coverageHits = requestedCoverageTerms.filter(term => sourceCoversRequestedProductStructureTerm(source, term)).length;
        const focusHit = sourceMatchesRequestedProductFocus(source, requestedFocus);
        const hasAnswerSignal = hasBroadProductStructureAnswerSignal(source);
        const isOfficialProductOverview = sourceIsOfficialProductOverviewSnapshot(source, targetVendor);
        const isRecoverable = (
          isOfficialProductOverview
          || hasAnswerSignal
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
          + (isOfficialProductOverview ? 1.1 : 0)
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
  if (sourceIsOfficialProductOverviewSnapshot(source, targetVendor)) return 'official_product_overview';
  if (targetVendor === 'META' && sourceIsOfficialMetaProductOverviewSnapshot(source)) return 'official_meta_overview';
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
    case 'META':
    case 'GOOGLE':
      return 0;
    case 'KAKAO':
      return 1;
    default:
      return 1;
  }
}

function isKakaoDisplaySpecificProductQuestion(message: string) {
  return /비즈보드|디스플레이\s*광고|카카오모먼트|톡채널|브랜드이모티콘|상품\s*가이드|상품가이드|상품\s*별|상품별|제작\s*가이드|소재/.test(
    normalizeProductIntentText(message),
  );
}

function isNaverDisplaySpecificProductQuestion(message: string) {
  return /(^|[\s/])da($|[\s/]|도|상품|광고)|네이버\s*da|네이버da|da\s*상품|da상품|보장형\s*da|pc\s*헤드라인\s*da|성과형\s*디스플레이|디스플레이\s*광고|홈피드\s*da|홈피드|스마트채널|타임보드|롤링보드|배너\s*광고/.test(
    normalizeProductIntentText(message),
  );
}

function isNaverShoppingCreativeSpecificProductQuestion(message: string) {
  const normalized = normalizeProductIntentText(message);
  return /쇼핑검색|쇼핑\s*검색|쇼핑몰\s*상품형|쇼핑\s*광고|쇼핑블록/.test(normalized)
    && /소재|심사|검수|제작|가이드|대표이미지|상품명|이미지|랜딩|광고등록기준|주의|유의|제한|반려/.test(normalized)
    && !/db\s*url|상품\s*db|상품db|상품\s*등록|상품등록|ep|쇼핑파트너센터|상품정보\s*수신\s*현황|등록요청/.test(normalized);
}

function isNaverVideoSpecificProductQuestion(message: string) {
  const normalized = normalizeProductIntentText(message);
  return /동영상\s*광고|동영상\s*조회|동영상\s*소재|동영상조회광고|비디오\s*광고|숏폼|쇼츠|아웃스트림|인스트림|네이버\s*클립|클립\s*(광고|서비스)|video\s*ads?/.test(normalized)
    && /상품|상세|가이드|소재|지면|노출|게재|등록|집행|제작|사양|스펙|길이|비율|심사|검수|주의|유의|확인/.test(normalized);
}

function isMetaAppInstallSpecificProductQuestion(message: string) {
  return /앱\s*(인스톨|설치|홍보|캠페인|이벤트|사전\s*등록)|앱인스톨|앱설치|앱홍보|app\s*(install|promotion)|mobile\s*app|sdk|mmp|모바일\s*측정\s*파트너|포스트백|postback/.test(
    normalizeProductIntentText(message),
  );
}

function isMetaCatalogSpecificProductQuestion(message: string) {
  const normalized = normalizeProductIntentText(message);
  return /카탈로그|catalog|컬렉션|collection|advantage\+|어드밴티지/.test(normalized)
    && /광고|집행|운영|연동|연결|설정|상품|데이터|피드|feed|shop|shops|판매|구매|commerce|커머스/.test(normalized)
    && !isProductCatalogOverviewQuestion(message);
}

function isMetaCreativeSpecSpecificProductQuestion(message: string) {
  return /소재|사양|스펙|규격|비율|사이즈|크기|해상도|파일|이미지|동영상|비디오|카루셀|캐러셀|carousel|슬라이드|instagram|인스타그램/.test(
    normalizeProductIntentText(message),
  );
}

function isGoogleLeadFormSpecificProductQuestion(message: string) {
  return /리드\s*양식|리드양식|잠재\s*고객\s*(양식|광고)|잠재고객\s*(양식|광고)|비즈니스\s*폼|비즈니스폼|lead\s*(form|generation|gen|ads?)/.test(
    normalizeProductIntentText(message),
  );
}

function getSpecificProductSupplementLimit(vendor?: VendorIntent, message = '') {
  if (vendor === 'KAKAO' && isKakaoDisplaySpecificProductQuestion(message)) return 0;
  if (vendor === 'NAVER' && isNaverDisplaySpecificProductQuestion(message)) return 0;
  if (vendor === 'NAVER' && isNaverShoppingCreativeSpecificProductQuestion(message)) return 0;
  if (vendor === 'NAVER' && isNaverVideoSpecificProductQuestion(message)) return 0;
  if (vendor === 'META' && isMetaAppInstallSpecificProductQuestion(message)) return 0;
  if (vendor === 'META' && isMetaCatalogSpecificProductQuestion(message)) return 0;
  if (vendor === 'META' && isMetaCreativeSpecSpecificProductQuestion(message)) return 0;
  if (vendor === 'GOOGLE' && isGoogleLeadFormSpecificProductQuestion(message)) return 0;
  return vendor === 'KAKAO' ? 1 : 2;
}

function buildProductStructureSupplementQueries(intent: QueryIntent, originalMessage: string) {
  if (!intent.topics.includes('product_structure') || intent.vendors.length !== 1) return [];

  const vendor = intent.vendors[0];
  const normalized = normalizeProductIntentText(originalMessage);
  const targetedQueries: string[] = [];

  if (intent.isSpecificProductGuidance || hasNamedSpecificProductQuestion(originalMessage)) {
    const asksNaverDa = vendor === 'NAVER' && /(^|[\s/])da($|[\s/]|도|상품|광고)|디스플레이\s*광고|성과형\s*디스플레이|홈피드\s*da|홈피드|배너\s*광고/.test(normalized);
    const asksKakaoDisplay = vendor === 'KAKAO' && /비즈보드|디스플레이\s*광고|카카오모먼트|톡채널|브랜드이모티콘|상품\s*가이드|상품가이드|상품\s*별|상품별|제작\s*가이드|소재/.test(normalized);
    const asksNaverShoppingBlock = vendor === 'NAVER' && /쇼핑\s*블록|쇼핑블록|주요\s*쇼핑\s*지면|pc\s*쇼핑블록|mo\s*쇼핑블록|모바일\s*쇼핑/.test(normalized);
    const asksNaverProductOverview = vendor === 'NAVER'
      && (isProductCatalogOverviewQuestion(originalMessage) || isAssetGuideProductQuestion(originalMessage))
      && /광고\s*(상품|종류|유형)|상품\s*(종류|유형|가이드|별)|상품별|제작\s*가이드|소재/.test(normalized);
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
  const asksSpec = intent.topics.includes('spec')
    || [...intent.keywords, ...intent.strictProductTerms].some(term => /소재|스펙|사양|규격|비율|사이즈|크기|카루셀|캐러셀|carousel|슬라이드/.test(term));
  if (asksSpec) {
    const specMatch = lower.match(/1080x|1080\s*x|1080픽셀|해상도|슬라이드\s*수|2\s*~\s*10|2~10|최대\s*(이미지|동영상|파일)|파일\s*(크기|형식)|지원\s*형식/);
    if (specMatch?.index !== undefined && specMatch.index > 70) {
      const start = Math.max(0, specMatch.index - 150);
      const end = Math.min(compact.length, specMatch.index + 270);
      const prefix = start > 0 ? '...' : '';
      const suffix = end < compact.length ? '...' : '';
      return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
    }
  }

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
  const sourceLike = source as any;
  const metadata = sourceLike.metadata || {};
  const text = `${source.title || ''} ${source.originalTitle || ''} ${source.excerpt || ''}`.toLowerCase();
  const identityText = normalizeEvidenceText([
    text,
    source.url,
    metadata.source_url,
    metadata.document_url,
    metadata.url,
    metadata.sourceKind,
    metadata.answerEvidenceRole,
    metadata.answer_evidence_role,
    Array.isArray(source.rankReason) ? source.rankReason.join(' ') : '',
    Array.isArray(source.evidenceDecisionReason) ? source.evidenceDecisionReason.join(' ') : '',
  ].filter(Boolean).join(' '));
  let score = 100 - originalIndex;

  if (source.sourceVendor && intent.vendors.includes(source.sourceVendor as VendorIntent)) score += 40;
  if (intent.requiresVendorCoverage && source.sourceVendor) {
    const vendorIndex = intent.vendors.indexOf(source.sourceVendor as VendorIntent);
    if (vendorIndex >= 0) score += (intent.vendors.length - vendorIndex) * 1000;
  }
  if (source.vendorMismatch) score -= 35;
  if (source.evidenceDecision === 'verified') score += 20;
  if (metadata.fastPolicyOfficialChunk === true || metadata.answerEvidenceRole === 'official_policy' || metadata.answer_evidence_role === 'official_policy') score += 70;
  if (metadata.metaProductOverviewOfficialChunk === true || metadata.googleProductOverviewOfficialChunk === true || metadata.officialProductOverviewSnapshot === true || metadata.answerEvidenceRole === 'official_product_overview' || metadata.answer_evidence_role === 'official_product_overview') score += 70;
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

  if (
    intent.vendors.includes('META')
    && /메타 광고 정책 2024|광고 콘텐츠 가이드라인/.test(text)
    && !/facebook\.com|meta\.com|transparency\.meta\.com/.test(identityText)
  ) {
    score -= 95;
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
    const productStructureQueryText = [
      ...intent.keywords,
      ...intent.strictProductTerms,
    ].join(' ').toLowerCase();
    const hasAdministrativeSupportSignal = /세금|tax|vat|청구|결제|지불|billing|payment|invoice/.test(text);
    const queryAsksAdministrativeSupport = /세금|tax|vat|청구|결제|지불|billing|payment|invoice/.test(productStructureQueryText);
    if (hasAdministrativeSupportSignal && !queryAsksAdministrativeSupport) {
      score -= strictProductIntent ? 140 : 95;
    }
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
    const metaAdsGuideTitle = normalizeMetaAdsGuideSourceTitle(title, content);
    if (metaAdsGuideTitle) return metaAdsGuideTitle;
    if (/collection\s*ads?|컬렉션\s*광고/.test(blob)) {
      return 'Meta 비즈니스 지원 센터: 카탈로그/컬렉션 광고';
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

function normalizeMetaAdsGuideSourceTitle(title: string, content: string): string | null {
  const text = `${title || ''} ${content || ''}`;
  if (!/meta\s*ads\s*guide|\/business\/ads-guide/i.test(text)) return null;

  const pathMatch = text.match(/Meta\s*Ads\s*Guide:\s*([a-z-]+)\s*>\s*([a-z0-9-]+)\s*>\s*([a-z0-9-]+)/i)
    || text.match(/\/business\/ads-guide\/update\/([a-z-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)/i);
  const format = pathMatch?.[1] || '';
  const placement = pathMatch?.[2] || '';
  const objective = pathMatch?.[3] || '';

  const formatLabel: Record<string, string> = {
    image: '이미지',
    video: '동영상',
    carousel: '카루셀',
    collection: '컬렉션',
  };
  const objectiveLabel: Record<string, string> = {
    'app-installs': '앱 홍보',
    'outcome-sales': '판매',
    'outcome-leads': '잠재 고객',
    'outcome-engagement': '참여',
    'outcome-awareness': '인지도',
    traffic: '트래픽',
  };
  const placementLabel: Record<string, string> = {
    'audience-network-native': 'Audience Network 네이티브',
    'audience-network-rewarded-video': 'Audience Network 보상형 동영상',
    'instagram-profile-feed': 'Instagram 프로필 피드',
    'instagram-stream': 'Instagram 피드',
    'facebook-feed': 'Facebook 피드',
    'messenger-story': 'Messenger 스토리',
  };

  const objectivePart = objectiveLabel[objective] ? `${objectiveLabel[objective]} 목표` : '캠페인 목표';
  const placementPart = placementLabel[placement] || '게재 위치';
  const formatPart = formatLabel[format] ? `${formatLabel[format]} 광고` : '광고';
  return `Meta Ads Guide: ${objectivePart} / ${placementPart} ${formatPart}`;
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
  const officialEvidenceRole = metadata.answerEvidenceRole || metadata.answer_evidence_role;
  const isOfficialGuideEvidence = (
    metadata.sourceKind === 'official_doc'
    || metadata.source_kind === 'official_doc'
    || metadata.fastPolicyOfficialChunk === true
    || metadata.officialProductOverviewSnapshot === true
    || metadata.metaProductOverviewOfficialChunk === true
    || metadata.googleProductOverviewOfficialChunk === true
    || officialEvidenceRole === 'official_policy'
    || officialEvidenceRole === 'official_product_overview'
  );

  if (!hasGrounding || isFallback || hasBlockingWarning) {
    return false;
  }

  if (isOfficialGuideGraphEvidence || isOfficialGuideEvidence) {
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
  const hasGenericPolicySourceIdentity = Boolean(metadata.genericPolicyIntent)
    || rescueReasons.some(reason => /generic_policy|generic_topic/i.test(reason))
    || (resultLike.topicExactMatch === true && resultLike.policyTitleMatch === true);
  const keywordScore = Number(result.keywordScore ?? resultLike.metadata?.keywordScore ?? 0);
  const lexicalOverlap = Number(result.lexicalOverlap ?? resultLike.metadata?.lexicalOverlap ?? 0);
  const qualityScore = Number(result.sourceQuality?.qualityScore ?? 0);
  const hasScoreSignal = keywordScore >= 0.42 || lexicalOverlap >= 0.16 || qualityScore >= 0.5;

  return hasUsableSourceShape && (hasVendorIdentity || hasGenericPolicySourceIdentity) && (hasRagRescueSignal || hasScoreSignal);
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
    
    const { message: rawMessage, conversationHistory } = requestBody;
    
    if (!rawMessage || typeof rawMessage !== 'string') {
      return {
        body: { error: '메시지가 필요합니다.' },
        status: 400,
      };
    }

    const contextualQuestion = buildContextualCompassProductQuestion(rawMessage, conversationHistory);
    const message = contextualQuestion.message;
    if (contextualQuestion.contextualized) {
      console.log('Compass answer contextualized follow-up question', {
        historyItemCount: contextualQuestion.historyItemCount,
        vendors: contextualQuestion.vendors,
        originalLength: rawMessage.length,
        contextualLength: message.length,
      });
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

    const preRetrievalDeterministicAnswer = buildPreRetrievalDeterministicProductAnswer(message, ragIntent);
    if (preRetrievalDeterministicAnswer) {
      const schema = getCompassDbSchema();
      const answerCoveredVendors = Array.from(new Set(
        preRetrievalDeterministicAnswer.sources.flatMap(source => [
          ...(Array.isArray(source.sourceVendors) ? source.sourceVendors : []),
          source.sourceVendor,
        ]).filter(isVendorIntentValue),
      ));
      emitPhase?.({
        phase: 'evidence-started',
        message: '공식 스냅샷 출처를 기준으로 상품 구조를 확인합니다.',
        queryType: ragIntent.queryType,
      });
      emitPhase?.({
        phase: 'evidence-ready',
        message: '확인 가능한 출처를 선별했습니다.',
        queryType: ragIntent.queryType,
        sourceCount: preRetrievalDeterministicAnswer.sources.length,
        verifiedSourceCount: preRetrievalDeterministicAnswer.sources.length,
      });
      emitPhase?.({ phase: 'answer-ready', message: '공식 운영 시나리오 근거를 기준으로 답변을 정리했습니다.' });

      return {
        body: {
          response: {
            message: preRetrievalDeterministicAnswer.answer,
            content: preRetrievalDeterministicAnswer.answer,
            sources: preRetrievalDeterministicAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics: {
              ...buildSourceDiagnostics(ragIntent, []),
              coveredVendors: answerCoveredVendors.length > 0 ? answerCoveredVendors : ragIntent.vendors,
              missingVendorSlots: [],
              answerSourceCount: preRetrievalDeterministicAnswer.sources.length,
              answerGenerationDurationMs: 0,
              deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
              operationalScenarioAnswer: true,
              preRetrievalDeterministicAnswer: true,
            },
            reviewPipeline: buildDeterministicProductReviewPipeline(
              preRetrievalDeterministicAnswer,
              preRetrievalDeterministicAnswer.sources.length,
            ),
          },
          confidence: getDeterministicProductConfidence(
            preRetrievalDeterministicAnswer.confidenceCap || 86,
            preRetrievalDeterministicAnswer,
          ),
          processingTime: Date.now() - startTime,
          model: preRetrievalDeterministicAnswer.model,
        },
      };
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
        ? getSpecificProductSupplementLimit(ragIntent.vendors[0], message)
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
    const retrievalQueryTimings = searchResultGroups.map((group, queryIndex) => ({
      queryIndex,
      queryRole: queryIndex === 0 ? 'primary' : 'supplement',
      durationMs: group.durationMs,
      resultCount: group.results.length,
      timedOut: group.timedOut,
      channelTimedOut: group.channelTimedOut,
      queryLength: searchQueries[queryIndex]?.length || 0,
    }));
    const retrievalChannelTimings = searchResultGroups.flatMap((group, queryIndex) =>
      group.channelTimings.map((timing) => ({
        ...timing,
        queryIndex,
        queryRole: queryIndex === 0 ? 'primary' : 'supplement',
      })),
    );
    const retrievalSlowestChannel = retrievalChannelTimings.length > 0
      ? retrievalChannelTimings.reduce((slowest, current) => (
        current.durationMs > slowest.durationMs ? current : slowest
      ))
      : null;
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
      slowestChannel: retrievalSlowestChannel
        ? {
          queryRole: retrievalSlowestChannel.queryRole,
          label: retrievalSlowestChannel.label,
          durationMs: retrievalSlowestChannel.durationMs,
          resultCount: retrievalSlowestChannel.resultCount,
          timedOut: retrievalSlowestChannel.timedOut,
          failed: retrievalSlowestChannel.failed === true,
        }
        : null,
    });
    const metaGoogleLeadComparisonSupplementalResults = buildMetaGoogleLeadComparisonSupplementalSearchResults(
      message,
      ragIntent,
      searchResults,
    );
    if (metaGoogleLeadComparisonSupplementalResults.length > 0) {
      searchResults = mergeSearchResultsByIdentity([
        ...searchResults,
        ...metaGoogleLeadComparisonSupplementalResults,
      ]);
      console.log('Compass Meta/Google lead comparison official evidence supplemented', {
        supplementalResultCount: metaGoogleLeadComparisonSupplementalResults.length,
        mergedResultCount: searchResults.length,
      });
    }
    const leadOperatingSupplementalResults = buildLeadOperatingSupplementalSearchResults(
      message,
      ragIntent,
      searchResults,
    );
    if (leadOperatingSupplementalResults.length > 0) {
      searchResults = mergeSearchResultsByIdentity([
        ...searchResults,
        ...leadOperatingSupplementalResults,
      ]);
      console.log('Compass lead operating official evidence supplemented', {
        supplementalResultCount: leadOperatingSupplementalResults.length,
        leadOperatingFamily: detectLeadOperatingAnswerFamily(message, ragIntent),
        mergedResultCount: searchResults.length,
      });
    }
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
      retrievalQueryTimings,
      retrievalChannelTimings,
      retrievalSlowestChannel,
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

    const sources = orderVerifiedSourcesForIntent(buildVerifiedSources(verifiedSearchResults, ragIntent), ragIntent);
    const confidence = calculateConfidence(verifiedSearchResults, ragIntent);
    const schema = getCompassDbSchema();
    const operationalScenarioAnswer = buildOperationalScenarioDeterministicAnswer(message, ragIntent, sources);
    if (operationalScenarioAnswer) {
      const answerCoveredVendors = Array.from(new Set(
        operationalScenarioAnswer.sources.flatMap(source => [
          ...(Array.isArray(source.sourceVendors) ? source.sourceVendors : []),
          source.sourceVendor,
        ]).filter(isVendorIntentValue),
      ));
      const deterministicBaseConfidence = Math.max(
        confidence,
        operationalScenarioAnswer.confidenceCap || confidence,
      );
      emitPhase?.({ phase: 'answer-ready', message: '공식 운영 시나리오 근거를 기준으로 답변을 정리했습니다.' });
      return {
        body: {
          response: {
            message: operationalScenarioAnswer.answer,
            content: operationalScenarioAnswer.answer,
            sources: operationalScenarioAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              coveredVendors: answerCoveredVendors.length > 0 ? answerCoveredVendors : sourceDiagnostics.coveredVendors,
              missingVendorSlots: [],
              answerSourceCount: operationalScenarioAnswer.sources.length,
              answerGenerationDurationMs: 0,
              deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
              operationalScenarioAnswer: true,
            },
            reviewPipeline: buildDeterministicProductReviewPipeline(
              operationalScenarioAnswer,
              searchResults.length,
            ),
          },
          confidence: getDeterministicProductConfidence(deterministicBaseConfidence, operationalScenarioAnswer),
          processingTime: Date.now() - startTime,
          model: operationalScenarioAnswer.model,
        },
      };
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

    const leadOperatingAnswer = buildLeadOperatingDeterministicAnswer(message, ragIntent, sources);
    if (leadOperatingAnswer) {
      emitPhase?.({ phase: 'answer-ready', message: '리드 운영 근거를 기준으로 답변을 정리했습니다.' });
      return {
        body: {
          response: {
            message: leadOperatingAnswer.answer,
            content: leadOperatingAnswer.answer,
            sources: leadOperatingAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              answerSourceCount: leadOperatingAnswer.sources.length,
              answerGenerationDurationMs: 0,
              deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
              leadOperatingAnswerFamily: detectLeadOperatingAnswerFamily(message, ragIntent),
            },
            reviewPipeline: buildDeterministicProductReviewPipeline(
              leadOperatingAnswer,
              searchResults.length,
            ),
          },
          confidence: getDeterministicProductConfidence(confidence, leadOperatingAnswer),
          processingTime: Date.now() - startTime,
          model: leadOperatingAnswer.model,
        },
      };
    }

    const metaGoogleLeadComparisonAnswer = buildMetaGoogleLeadComparisonAnswer(message, ragIntent, sources);
    if (metaGoogleLeadComparisonAnswer) {
      emitPhase?.({ phase: 'answer-ready', message: 'Meta와 Google 리드 캠페인 비교 답변을 정리했습니다.' });
      return {
        body: {
          response: {
            message: metaGoogleLeadComparisonAnswer.answer,
            content: metaGoogleLeadComparisonAnswer.answer,
            sources: metaGoogleLeadComparisonAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics,
            reviewPipeline: buildDeterministicProductReviewPipeline(
              metaGoogleLeadComparisonAnswer,
              searchResults.length,
            ),
          },
          confidence: getDeterministicProductConfidence(confidence, metaGoogleLeadComparisonAnswer),
          processingTime: Date.now() - startTime,
          model: metaGoogleLeadComparisonAnswer.model,
        },
      };
    }

    const preCoverageBroadProductIntent = ragIntent.requiresVendorCoverage
      && sourceDiagnostics.missingVendorSlots.length > 0
      ? getBroadProductDeterministicIntent(message, ragIntent)
      : null;
    const preCoverageBroadProductAnswer = preCoverageBroadProductIntent
      ? buildDeterministicBroadProductAnswer(message, preCoverageBroadProductIntent, sources)
      : null;
    if (preCoverageBroadProductAnswer && preCoverageBroadProductIntent) {
      const answerCoveredVendors = Array.from(new Set(
        preCoverageBroadProductAnswer.sources.flatMap(source => [
          ...(Array.isArray(source.sourceVendors) ? source.sourceVendors : []),
          source.sourceVendor,
        ]).filter(isVendorIntentValue),
      ));
      emitPhase?.({ phase: 'answer-ready', message: '공식 상품 구조 근거를 기준으로 답변을 정리했습니다.' });
      return {
        body: {
          response: {
            message: preCoverageBroadProductAnswer.answer,
            content: preCoverageBroadProductAnswer.answer,
            sources: preCoverageBroadProductAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              queryType: preCoverageBroadProductIntent.queryType,
              isComparative: preCoverageBroadProductIntent.isComparative,
              requestedVendors: preCoverageBroadProductIntent.vendors,
              coveredVendors: answerCoveredVendors.length > 0
                ? answerCoveredVendors
                : preCoverageBroadProductIntent.vendors,
              missingVendorSlots: [],
              answerSourceCount: preCoverageBroadProductAnswer.sources.length,
              answerGenerationDurationMs: 0,
              deterministicAnswerFamily: detectProductAnswerFamily(message, preCoverageBroadProductIntent),
              vendorCoverageRescuedByExplicitProductIntent: true,
            },
            reviewPipeline: buildDeterministicProductReviewPipeline(
              preCoverageBroadProductAnswer,
              searchResults.length,
            ),
          },
          confidence: getDeterministicProductConfidence(confidence, preCoverageBroadProductAnswer),
          processingTime: Date.now() - startTime,
          model: preCoverageBroadProductAnswer.model,
        },
      };
    }

    const shouldUseSourceGuidedPartialCoverageAnswer =
      shouldUseSourceGuidedAnswerWithPartialCoverage(message, ragIntent, sourceDiagnostics);

    if (
      ragIntent.requiresVendorCoverage
      && sourceDiagnostics.missingVendorSlots.length > 0
      && !shouldUseSourceGuidedPartialCoverageAnswer
    ) {
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

    if (
      ragIntent.isComparative
      && ragIntent.vendors.length >= 2
      && !shouldUseSourceGuidedPartialCoverageAnswer
    ) {
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

    const earlyBroadProductIntent = getBroadProductDeterministicIntent(message, ragIntent);
    const earlyBroadProductAnswer = earlyBroadProductIntent
      ? buildDeterministicBroadProductAnswer(message, earlyBroadProductIntent, sources)
      : null;
    if (earlyBroadProductAnswer && earlyBroadProductIntent) {
      const answerCoveredVendors = Array.from(new Set(
        earlyBroadProductAnswer.sources.flatMap(source => [
          ...(Array.isArray(source.sourceVendors) ? source.sourceVendors : []),
          source.sourceVendor,
        ]).filter(isVendorIntentValue),
      ));
      emitPhase?.({ phase: 'answer-ready', message: '공식 상품 구조 근거를 기준으로 답변을 정리했습니다.' });
      return {
        body: {
          response: {
            message: earlyBroadProductAnswer.answer,
            content: earlyBroadProductAnswer.answer,
            sources: earlyBroadProductAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption: false,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              queryType: earlyBroadProductIntent.queryType,
              isComparative: earlyBroadProductIntent.isComparative,
              requestedVendors: earlyBroadProductIntent.vendors,
              coveredVendors: answerCoveredVendors.length > 0
                ? answerCoveredVendors
                : earlyBroadProductIntent.vendors,
              missingVendorSlots: [],
              answerSourceCount: earlyBroadProductAnswer.sources.length,
              answerGenerationDurationMs: 0,
              deterministicAnswerFamily: detectProductAnswerFamily(message, earlyBroadProductIntent),
            },
            reviewPipeline: buildDeterministicProductReviewPipeline(
              earlyBroadProductAnswer,
              searchResults.length,
            ),
          },
          confidence: getDeterministicProductConfidence(confidence, earlyBroadProductAnswer),
          processingTime: Date.now() - startTime,
          model: earlyBroadProductAnswer.model,
        },
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
    const isBroadProductStructureCatalogIntent = isBroadProductStructureLlmIntent
      || isProductCatalogOverviewQuestion(message);
    const diagnosticAnswerMode = getCompassDiagnosticAnswerMode(
      message,
      specificProductScope,
      isBroadProductStructureLlmIntent,
    );

    if (specificProductScope.shouldLimit && !(shouldUseSourceGuidedPartialCoverageAnswer && isPolicyJudgmentAnswerIntent(ragIntent))) {
      console.warn('Compass answer generation limited by strict product answer scope', {
        strictProductTerms: ragIntent.strictProductTerms,
        mode: specificProductScope.mode,
        strictProductSourceCount: specificProductScope.strictProductSources.length,
        answerSourceCount: specificProductScope.answerSources.length,
      });

      const fastKakaoScopeRescueAnswer = buildFastKakaoProductStructuredAnswer(
        message,
        ragIntent,
        sources,
        'compass-answer-fast-kakao-product-structured-scope-rescue',
        'kakao_product_scope_rescue',
      );
      if (fastKakaoScopeRescueAnswer) {
        emitPhase?.({ phase: 'answer-ready', message: '카카오 공식 근거를 기준으로 제한 범위 답변을 보강했습니다.' });
        return {
          body: {
            response: {
              message: fastKakaoScopeRescueAnswer.answer,
              content: fastKakaoScopeRescueAnswer.answer,
              sources: fastKakaoScopeRescueAnswer.sources,
              noDataFound: false,
              schema,
              showContactOption: true,
              sourceDiagnostics: {
                ...sourceDiagnostics,
                strictProductSourceCount: specificProductScope.strictProductSources.length,
                answerSourceCount: fastKakaoScopeRescueAnswer.sources.length,
                answerMode: diagnosticAnswerMode,
                answerGenerationDurationMs: 0,
                deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
                fastAnswerFallback: fastKakaoScopeRescueAnswer.fastAnswerFallback,
              },
              reviewPipeline: buildReviewPipeline({
                status: fastKakaoScopeRescueAnswer.reviewStatus || 'completed',
                sourceCount: searchResults.length,
                verifiedSourceCount: fastKakaoScopeRescueAnswer.sources.length,
                contactRecommended: true,
                retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
              }),
            },
            confidence: getDeterministicProductConfidence(confidence || 64, fastKakaoScopeRescueAnswer),
            processingTime: Date.now() - startTime,
            model: fastKakaoScopeRescueAnswer.model
          }
        };
      }

      const fastStructuredScopeRescueAnswer = buildFastStructuredSpecificProductAnswer(
        message,
        ragIntent,
        specificProductScope,
        sources,
      );
      if (fastStructuredScopeRescueAnswer) {
        const showContactOption = Boolean(fastStructuredScopeRescueAnswer.showContactOption);
        emitPhase?.({ phase: 'answer-ready', message: '공식 상품 근거를 기준으로 제한 범위 답변을 보강했습니다.' });
        return {
          body: {
            response: {
              message: fastStructuredScopeRescueAnswer.answer,
              content: fastStructuredScopeRescueAnswer.answer,
              sources: fastStructuredScopeRescueAnswer.sources,
              noDataFound: false,
              schema,
              showContactOption,
              sourceDiagnostics: {
                ...sourceDiagnostics,
                strictProductSourceCount: specificProductScope.strictProductSources.length,
                answerSourceCount: fastStructuredScopeRescueAnswer.sources.length,
                answerMode: diagnosticAnswerMode,
                answerGenerationDurationMs: 0,
                deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
                fastAnswerFallback: fastStructuredScopeRescueAnswer.fastAnswerFallback,
                scopeRescue: true,
              },
              reviewPipeline: buildReviewPipeline({
                status: fastStructuredScopeRescueAnswer.reviewStatus || 'completed',
                sourceCount: searchResults.length,
                verifiedSourceCount: fastStructuredScopeRescueAnswer.sources.length,
                contactRecommended: showContactOption,
                retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
              }),
            },
            confidence: getDeterministicProductConfidence(confidence || 64, fastStructuredScopeRescueAnswer),
            processingTime: Date.now() - startTime,
            model: fastStructuredScopeRescueAnswer.model
          }
        };
      }

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

    if (shouldUseDeterministicProductAnswerBeforeLlm() && !isBroadProductStructureCatalogIntent) {
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

    const fastKakaoSpecificProductAnswer = buildFastKakaoSpecificProductAnswer(
      message,
      ragIntent,
      specificProductScope,
    );
    if (fastKakaoSpecificProductAnswer) {
      const showContactOption = Boolean(fastKakaoSpecificProductAnswer.showContactOption);
      emitPhase?.({
        phase: 'answer-ready',
        message: '카카오 상품 근거를 기준으로 답변을 정리했습니다.',
      });
      return {
        body: {
          response: {
            message: fastKakaoSpecificProductAnswer.answer,
            content: fastKakaoSpecificProductAnswer.answer,
            sources: fastKakaoSpecificProductAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              strictProductSourceCount: specificProductScope.strictProductSources.length,
              answerSourceCount: fastKakaoSpecificProductAnswer.sources.length,
              answerMode: diagnosticAnswerMode,
              answerGenerationDurationMs: 0,
              deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
              fastAnswerFallback: fastKakaoSpecificProductAnswer.fastAnswerFallback,
            },
            reviewPipeline: buildReviewPipeline({
              status: fastKakaoSpecificProductAnswer.reviewStatus || 'completed',
              sourceCount: searchResults.length,
              verifiedSourceCount: fastKakaoSpecificProductAnswer.sources.length,
              contactRecommended: showContactOption,
              retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
            }),
          },
          confidence: getDeterministicProductConfidence(confidence, fastKakaoSpecificProductAnswer),
          processingTime: Date.now() - startTime,
          model: fastKakaoSpecificProductAnswer.model
        }
      };
    }

    if (!isBroadProductStructureCatalogIntent && ragIntent.vendors.length === 1 && ragIntent.vendors[0] === 'KAKAO') {
      const fastKakaoStructuredProductAnswer = buildFastKakaoProductStructuredAnswer(
        message,
        ragIntent,
        answerSources.length > 0 ? answerSources : sources,
        'compass-answer-fast-kakao-product-structured',
        'kakao_product_structured',
      );
      if (fastKakaoStructuredProductAnswer) {
        emitPhase?.({ phase: 'answer-ready', message: '카카오 상품 근거를 기준으로 답변을 정리했습니다.' });
        return {
          body: {
            response: {
              message: fastKakaoStructuredProductAnswer.answer,
              content: fastKakaoStructuredProductAnswer.answer,
              sources: fastKakaoStructuredProductAnswer.sources,
              noDataFound: false,
              schema,
              showContactOption: true,
              sourceDiagnostics: {
                ...sourceDiagnostics,
                strictProductSourceCount: specificProductScope.strictProductSources.length,
                answerSourceCount: fastKakaoStructuredProductAnswer.sources.length,
                answerMode: diagnosticAnswerMode,
                answerGenerationDurationMs: 0,
                deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
                fastAnswerFallback: fastKakaoStructuredProductAnswer.fastAnswerFallback,
              },
              reviewPipeline: buildReviewPipeline({
                status: fastKakaoStructuredProductAnswer.reviewStatus || 'completed',
                sourceCount: searchResults.length,
                verifiedSourceCount: fastKakaoStructuredProductAnswer.sources.length,
                contactRecommended: true,
                retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
              }),
            },
            confidence: getDeterministicProductConfidence(confidence, fastKakaoStructuredProductAnswer),
            processingTime: Date.now() - startTime,
            model: fastKakaoStructuredProductAnswer.model
          }
        };
      }
    }

    const fastNaverVideoProductAnswer = buildFastNaverVideoProductAnswer(
      message,
      ragIntent,
      specificProductScope,
      answerSources.length > 0 ? answerSources : sources,
    );
    if (fastNaverVideoProductAnswer) {
      const showContactOption = Boolean(fastNaverVideoProductAnswer.showContactOption);
      emitPhase?.({ phase: 'answer-ready', message: '네이버 동영상 상품 근거를 기준으로 답변을 정리했습니다.' });
      return {
        body: {
          response: {
            message: fastNaverVideoProductAnswer.answer,
            content: fastNaverVideoProductAnswer.answer,
            sources: fastNaverVideoProductAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              strictProductSourceCount: specificProductScope.strictProductSources.length,
              answerSourceCount: fastNaverVideoProductAnswer.sources.length,
              answerMode: diagnosticAnswerMode,
              answerGenerationDurationMs: 0,
              deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
              fastAnswerFallback: fastNaverVideoProductAnswer.fastAnswerFallback,
            },
            reviewPipeline: buildReviewPipeline({
              status: fastNaverVideoProductAnswer.reviewStatus || 'completed',
              sourceCount: searchResults.length,
              verifiedSourceCount: fastNaverVideoProductAnswer.sources.length,
              contactRecommended: showContactOption,
              retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
            }),
          },
          confidence: getDeterministicProductConfidence(confidence, fastNaverVideoProductAnswer),
          processingTime: Date.now() - startTime,
          model: fastNaverVideoProductAnswer.model
        }
      };
    }

    const fastStructuredSpecificProductAnswer = buildFastStructuredSpecificProductAnswer(
      message,
      ragIntent,
      specificProductScope,
      answerSources.length > 0 ? answerSources : sources,
    );
    if (fastStructuredSpecificProductAnswer) {
      const showContactOption = Boolean(fastStructuredSpecificProductAnswer.showContactOption);
      emitPhase?.({ phase: 'answer-ready', message: '공식 상품 근거를 기준으로 답변을 정리했습니다.' });
      return {
        body: {
          response: {
            message: fastStructuredSpecificProductAnswer.answer,
            content: fastStructuredSpecificProductAnswer.answer,
            sources: fastStructuredSpecificProductAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              strictProductSourceCount: specificProductScope.strictProductSources.length,
              answerSourceCount: fastStructuredSpecificProductAnswer.sources.length,
              answerMode: diagnosticAnswerMode,
              answerGenerationDurationMs: 0,
              deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
              fastAnswerFallback: fastStructuredSpecificProductAnswer.fastAnswerFallback,
            },
            reviewPipeline: buildReviewPipeline({
              status: fastStructuredSpecificProductAnswer.reviewStatus || 'completed',
              sourceCount: searchResults.length,
              verifiedSourceCount: fastStructuredSpecificProductAnswer.sources.length,
              contactRecommended: showContactOption,
              retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
            }),
          },
          confidence: getDeterministicProductConfidence(confidence, fastStructuredSpecificProductAnswer),
          processingTime: Date.now() - startTime,
          model: fastStructuredSpecificProductAnswer.model
        }
      };
    }

    const fastPolicySourceGuidedAnswer = buildFastPolicySourceGuidedAnswer(
      message,
      ragIntent,
      sources,
      isBroadProductStructureLlmIntent,
    );
    if (fastPolicySourceGuidedAnswer) {
      const showContactOption = Boolean(fastPolicySourceGuidedAnswer.showContactOption);
      const fastPolicySourceGuidedAnswerContent = applyCoverageNoticeToAnswer(
        fastPolicySourceGuidedAnswer.answer,
        sourceDiagnostics,
      );
      emitPhase?.({ phase: 'answer-ready', message: '검증된 정책 근거를 기준으로 답변을 정리했습니다.' });
      return {
        body: {
          response: {
            message: fastPolicySourceGuidedAnswerContent,
            content: fastPolicySourceGuidedAnswerContent,
            sources: fastPolicySourceGuidedAnswer.sources,
            noDataFound: false,
            schema,
            showContactOption,
            sourceDiagnostics: {
              ...sourceDiagnostics,
              strictProductSourceCount: specificProductScope.strictProductSources.length,
              answerSourceCount: fastPolicySourceGuidedAnswer.sources.length,
              answerMode: diagnosticAnswerMode,
              answerGenerationDurationMs: 0,
              policyAnswerFamily: fastPolicySourceGuidedAnswer.policyAnswerFamily,
              fastAnswerFallback: fastPolicySourceGuidedAnswer.fastAnswerFallback,
              partialCoverageSourceGuided: shouldUseSourceGuidedPartialCoverageAnswer,
            },
            reviewPipeline: buildReviewPipeline({
              status: fastPolicySourceGuidedAnswer.reviewStatus || 'completed',
              sourceCount: searchResults.length,
              verifiedSourceCount: fastPolicySourceGuidedAnswer.sources.length,
              contactRecommended: showContactOption,
              retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
            }),
          },
          confidence: getDeterministicProductConfidence(confidence, fastPolicySourceGuidedAnswer),
          processingTime: Date.now() - startTime,
          model: fastPolicySourceGuidedAnswer.model
        }
      };
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

    if (isBroadProductStructureCatalogIntent) {
      const productStructureSources = selectProductStructureResponseSources(sources, ragIntent, message)
        .filter(source => sourceIsOfficialProductOverviewSnapshot(source, ragIntent.vendors[0]) || !sourceLooksLikeProductStructureSupportNoise(source));
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
      const fastKakaoBroadProductAnswer = buildFastKakaoProductStructuredAnswer(
        message,
        ragIntent,
        productStructureSources,
        'compass-answer-fast-kakao-product-structured',
        'kakao_product_structured',
      );
      if (fastKakaoBroadProductAnswer) {
        emitPhase?.({ phase: 'answer-ready', message: '카카오 상품 구조 근거를 기준으로 답변을 정리했습니다.' });
        return {
          body: {
            response: {
              message: fastKakaoBroadProductAnswer.answer,
              content: fastKakaoBroadProductAnswer.answer,
              sources: fastKakaoBroadProductAnswer.sources,
              noDataFound: false,
              schema,
              showContactOption: true,
              sourceDiagnostics: {
                ...sourceDiagnostics,
                answerSourceCount: fastKakaoBroadProductAnswer.sources.length,
                answerMode: diagnosticAnswerMode,
                answerGenerationDurationMs: 0,
                deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
                fastAnswerFallback: fastKakaoBroadProductAnswer.fastAnswerFallback,
              },
              reviewPipeline: buildReviewPipeline({
                status: fastKakaoBroadProductAnswer.reviewStatus || 'completed',
                sourceCount: searchResults.length,
                verifiedSourceCount: fastKakaoBroadProductAnswer.sources.length,
                contactRecommended: true,
                retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
              }),
            },
            confidence: getDeterministicProductConfidence(confidence, fastKakaoBroadProductAnswer),
            processingTime: Date.now() - startTime,
            model: fastKakaoBroadProductAnswer.model
          }
        };
      }
      if (
        shouldUseDeterministicProductAnswerBeforeLlm()
        || shouldUseFastBroadProductDeterministicAnswer(ragIntent, message)
      ) {
        const shouldUseFastBroadAnswer = shouldUseFastBroadProductDeterministicAnswer(ragIntent, message);
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
                  answerGenerationDurationMs: 0,
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

        if (shouldUseFastBroadAnswer) {
          const sourceGuidedBroadProductSources = answerSources.filter(source => (
            !sourceLooksLikeProductStructureSupportNoise(source)
          ));
          const sourceGuidedBroadProductAnswer = buildLlmFailureGroundedFallbackAnswer(
            message,
            sourceGuidedBroadProductSources,
            ragIntent,
            specificProductScope,
            true,
          );
          if (sourceGuidedBroadProductAnswer) {
            emitPhase?.({ phase: 'answer-ready', message: '상품 구조 근거를 기준으로 답변을 정리했습니다.' });
            return {
              body: {
                response: {
                  message: sourceGuidedBroadProductAnswer,
                  content: sourceGuidedBroadProductAnswer,
                  sources: sourceGuidedBroadProductSources,
                  noDataFound: false,
                  schema,
                  showContactOption: true,
                  sourceDiagnostics: {
                    ...sourceDiagnostics,
                    answerSourceCount: sourceGuidedBroadProductSources.length,
                    answerMode: diagnosticAnswerMode,
                    answerGenerationDurationMs: 0,
                    deterministicAnswerFamily: detectProductAnswerFamily(message, ragIntent),
                    fastAnswerFallback: 'source_guided_broad_product',
                  },
                  reviewPipeline: buildReviewPipeline({
                    status: 'completed',
                    sourceCount: searchResults.length,
                    verifiedSourceCount: answerSources.length,
                    contactRecommended: true,
                    retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
                  }),
                },
                confidence: Math.min(confidence, 78),
                processingTime: Date.now() - startTime,
                model: 'compass-answer-fast-broad-product-source-guided'
              }
            };
          }
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
      const noDataRepairSources = finalAnswerSources.length > 0 ? finalAnswerSources : answerSources;
      const noDataRepairAnswer = buildLlmFailureGroundedFallbackAnswer(
        message,
        noDataRepairSources,
        ragIntent,
        specificProductScope,
        isBroadProductStructureLlmIntent,
      );
      if (noDataRepairAnswer && noDataRepairSources.length > 0) {
        console.warn('Compass answer generation produced no-data text; preserving verified sources with grounded fallback', {
          sourceCount: noDataRepairSources.length,
          answerMode: diagnosticAnswerMode,
        });
        emitPhase?.({ phase: 'answer-ready', message: '확보된 근거를 기준으로 답변을 복구했습니다.' });
        return {
          body: {
            response: {
              message: noDataRepairAnswer,
              content: noDataRepairAnswer,
              sources: noDataRepairSources,
              noDataFound: false,
              schema,
              showContactOption: true,
              sourceDiagnostics: {
                ...sourceDiagnostics,
                answerSourceCount: noDataRepairSources.length,
                answerMode: diagnosticAnswerMode,
                answerGenerationDurationMs,
                fallbackReason: 'generated_no_data_repaired',
                answerRepairReason: answerRepair?.reason,
                broadAnswerRepairReason: broadAnswerRepair?.reason,
                partialCoverageSourceGuided: shouldUseSourceGuidedPartialCoverageAnswer,
              },
              reviewPipeline: buildReviewPipeline({
                status: 'limited',
                sourceCount: searchResults.length,
                verifiedSourceCount: noDataRepairSources.length,
                contactRecommended: true,
                retrievalChannelLimited: sourceDiagnostics.retrievalChannelTimedOut === true,
              }),
            },
            confidence: Math.min(finalConfidenceCap ? Math.min(confidence, finalConfidenceCap) : confidence, 62),
            processingTime,
            model: 'compass-answer-grounded-no-data-repair'
          }
        };
      }
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
            partialCoverageSourceGuided: shouldUseSourceGuidedPartialCoverageAnswer,
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

export async function buildCompassAnswerResponseWithRuntimeCache(
  request: NextRequest,
  emitPhase?: CompassAnswerPhaseEmitter,
): Promise<{ result: CompassAnswerHandlerResult; cacheStatus: CompassAnswerCacheStatus }> {
  const requestStartedAt = Date.now();
  if (shouldBypassCompassAnswerRuntimeCache(request)) {
    compassAnswerRuntimeMetrics.bypassedRequestCount += 1;
    const result = await buildCompassAnswerResponse(request, emitPhase);
    recordCompassAnswerRuntimeResult(result, 'BYPASS');
    await recordCompassAnswerDurableRuntimeEvent(
      buildCompassAnswerDurableRuntimeEvent(result, 'BYPASS', null),
    );
    return { result, cacheStatus: 'BYPASS' };
  }

  const cacheKey = await resolveCompassAnswerRequestCacheKey(request);
  if (!cacheKey) {
    compassAnswerRuntimeMetrics.bypassedRequestCount += 1;
    const result = await buildCompassAnswerResponse(request, emitPhase);
    recordCompassAnswerRuntimeResult(result, 'BYPASS');
    await recordCompassAnswerDurableRuntimeEvent(
      buildCompassAnswerDurableRuntimeEvent(result, 'BYPASS', null),
    );
    return { result, cacheStatus: 'BYPASS' };
  }

  compassAnswerRuntimeMetrics.cacheableRequestCount += 1;
  const cachedBody = getCachedCompassAnswerResponse(cacheKey);
  if (cachedBody) {
    compassAnswerRuntimeMetrics.cacheHitCount += 1;
    const result = {
      body: markCompassAnswerCacheHit(cachedBody, Date.now() - requestStartedAt, 'memory'),
      status: 200,
    };
    recordCompassAnswerRuntimeResult(result, 'HIT');
    await recordCompassAnswerDurableRuntimeEvent(
      buildCompassAnswerDurableRuntimeEvent(result, 'HIT', cacheKey),
    );
    return { result, cacheStatus: 'HIT' };
  }

  const durableCachedEntry = await readCompassAnswerDurableCache(cacheKey);
  if (durableCachedEntry) {
    compassAnswerRuntimeMetrics.cacheHitCount += 1;
    const cachedResult = {
      body: cloneCompassAnswerBody(durableCachedEntry.body),
      status: durableCachedEntry.status,
    };
    rememberCompassAnswerResponse(cacheKey, cachedResult);
    const result = {
      body: markCompassAnswerCacheHit(cachedResult.body, Date.now() - requestStartedAt, 'durable'),
      status: durableCachedEntry.status,
    };
    recordCompassAnswerRuntimeResult(result, 'HIT');
    await recordCompassAnswerDurableRuntimeEvent(
      buildCompassAnswerDurableRuntimeEvent(result, 'HIT', cacheKey),
    );
    return { result, cacheStatus: 'HIT' };
  }

  compassAnswerRuntimeMetrics.cacheMissCount += 1;
  const result = await buildCompassAnswerResponse(request, emitPhase);
  markCompassAnswerCacheMiss(result.body);
  const expiresAt = rememberCompassAnswerResponse(cacheKey, result);
  recordCompassAnswerRuntimeResult(result, 'MISS');
  await Promise.all([
    expiresAt
      ? writeCompassAnswerDurableCache({
        cacheKey,
        body: result.body,
        status: result.status || 200,
        expiresAt,
      })
      : Promise.resolve(false),
    recordCompassAnswerDurableRuntimeEvent(
      buildCompassAnswerDurableRuntimeEvent(result, 'MISS', cacheKey),
    ),
  ]);
  return { result, cacheStatus: 'MISS' };
}

/**
 * Compass answer API handler.
 */
export async function POST(request: NextRequest) {
  const { result, cacheStatus } = await buildCompassAnswerResponseWithRuntimeCache(request);
  const cacheHeaders = cacheStatus === 'HIT'
    ? { 'x-compass-answer-cache': 'HIT' }
    : cacheStatus === 'MISS'
      ? { 'x-compass-answer-cache': 'MISS' }
      : undefined;

  return NextResponse.json(result.body, {
    status: result.status || 200,
    headers: cacheHeaders,
  });
}
