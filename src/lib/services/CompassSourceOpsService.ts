import { createCompassServiceClient } from '@/lib/supabase/compass';

export type CompassSourceVendor = 'META' | 'KAKAO' | 'NAVER' | 'GOOGLE';
export type CompassSourceStatus = 'indexed' | 'candidate_only' | 'stale' | 'unavailable';
export type CompassSourceAgentAction = 'watch' | 'queue_exact_url' | 'queue_domain_discovery' | 'review_extraction' | 'refresh_candidate';
export type CompassSourceReviewUrgency = 'normal' | 'due' | 'blocked';

export interface CompassPolicySource {
  id: string;
  vendor: CompassSourceVendor;
  label: string;
  url: string;
  sourceType: 'policy' | 'help' | 'entrypoint';
  priority: 'core' | 'support';
  cadenceDays: number;
  discoveryMode: 'exact_url' | 'domain_discovery';
}

interface StoredDocument {
  id: string;
  title?: string | null;
  url?: string | null;
  type?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  chunk_count?: number | null;
}

export interface CompassSourceOpsItem extends CompassPolicySource {
  status: CompassSourceStatus;
  agentAction: CompassSourceAgentAction;
  reviewUrgency: CompassSourceReviewUrgency;
  matchedDocuments: number;
  indexedDocuments: number;
  totalChunks: number;
  latestDocumentAt?: string;
  nextReviewAt?: string;
  matchedDocumentTitles: string[];
  recommendation: string;
}

export interface CompassSourceOpsPlan {
  mode: 'review-only';
  collectionOwner: 'backend-agent';
  manualCollectionRecommended: false;
  mutationEnabled: false;
  scheduleRecommendation: string;
  safetyNotes: string[];
  sources: CompassSourceOpsItem[];
  summary: {
    totalSources: number;
    indexedSources: number;
    staleSources: number;
    candidateOnlySources: number;
    unavailableSources: number;
  };
  generatedAt: string;
}

export const COMPASS_POLICY_SOURCES: CompassPolicySource[] = [
  {
    id: 'meta-ads-standards',
    vendor: 'META',
    label: 'Meta advertising standards',
    url: 'https://www.facebook.com/policies/ads/',
    sourceType: 'policy',
    priority: 'core',
    cadenceDays: 7,
    discoveryMode: 'exact_url',
  },
  {
    id: 'meta-business-help',
    vendor: 'META',
    label: 'Meta business help',
    url: 'https://www.facebook.com/business/help/',
    sourceType: 'help',
    priority: 'support',
    cadenceDays: 14,
    discoveryMode: 'domain_discovery',
  },
  {
    id: 'instagram-business-help',
    vendor: 'META',
    label: 'Instagram business help',
    url: 'https://business.instagram.com/help/',
    sourceType: 'help',
    priority: 'support',
    cadenceDays: 14,
    discoveryMode: 'domain_discovery',
  },
  {
    id: 'kakao-business-entry',
    vendor: 'KAKAO',
    label: 'Kakao business policy entry',
    url: 'https://business.kakao.com/',
    sourceType: 'entrypoint',
    priority: 'core',
    cadenceDays: 7,
    discoveryMode: 'domain_discovery',
  },
  {
    id: 'naver-ads-entry',
    vendor: 'NAVER',
    label: 'Naver ads policy entry',
    url: 'https://ads.naver.com/',
    sourceType: 'entrypoint',
    priority: 'core',
    cadenceDays: 7,
    discoveryMode: 'domain_discovery',
  },
  {
    id: 'google-ads-policy',
    vendor: 'GOOGLE',
    label: 'Google Ads policy help',
    url: 'https://support.google.com/adspolicy/answer/6008942?hl=ko',
    sourceType: 'policy',
    priority: 'core',
    cadenceDays: 7,
    discoveryMode: 'exact_url',
  },
  {
    id: 'google-ads-help',
    vendor: 'GOOGLE',
    label: 'Google Ads help center',
    url: 'https://support.google.com/google-ads/?hl=ko',
    sourceType: 'help',
    priority: 'support',
    cadenceDays: 14,
    discoveryMode: 'domain_discovery',
  },
];

export async function buildCompassSourceOpsPlan(): Promise<CompassSourceOpsPlan> {
  const documents = await readStoredDocuments();
  const generatedAt = new Date().toISOString();
  const generatedAtMs = new Date(generatedAt).getTime();
  const sources = COMPASS_POLICY_SOURCES.map((source) => buildSourceItem(source, documents, generatedAtMs));
  const summary = {
    totalSources: sources.length,
    indexedSources: sources.filter((source) => source.status === 'indexed').length,
    staleSources: sources.filter((source) => source.status === 'stale').length,
    candidateOnlySources: sources.filter((source) => source.status === 'candidate_only').length,
    unavailableSources: sources.filter((source) => source.status === 'unavailable').length,
  };

  return {
    mode: 'review-only',
    collectionOwner: 'backend-agent',
    manualCollectionRecommended: false,
    mutationEnabled: false,
    scheduleRecommendation: 'Run a backend source-watch job weekly for core policy sources and biweekly for support/help sources, then surface candidate diffs for operator review before any corpus promotion.',
    safetyNotes: [
      'This endpoint is read-only and does not crawl, upload, chunk, embed, or mutate production data.',
      'Manual URL upload should remain a fallback path, not the primary Compass source maintenance workflow.',
      'Future automated collection should write only to a proposal queue first; promotion to vector-ready corpus needs a separate approval/apply step.',
    ],
    sources,
    summary,
    generatedAt,
  };
}

async function readStoredDocuments(): Promise<StoredDocument[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }

  try {
    const supabase = createCompassServiceClient();
    const { data, error } = await supabase
      .from('documents')
      .select('id,title,url,type,status,created_at,updated_at,chunk_count')
      .limit(2000);

    if (error) {
      console.warn('Compass source ops document read failed:', error.message);
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('Compass source ops document read unavailable:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

function buildSourceItem(
  source: CompassPolicySource,
  documents: StoredDocument[],
  generatedAtMs: number,
): CompassSourceOpsItem {
  const matched = documents.filter((document) => documentMatchesSource(document, source));
  const indexedDocuments = matched.filter((document) => isIndexedStatus(document.status));
  const latestDocumentAt = latestTimestamp(matched);
  const isStale = latestDocumentAt ? daysSince(latestDocumentAt) > source.cadenceDays : false;
  const nextReviewAt = latestDocumentAt ? addDaysIso(latestDocumentAt, source.cadenceDays) : undefined;
  const status: CompassSourceStatus = matched.length === 0
    ? 'candidate_only'
    : indexedDocuments.length === 0
      ? 'unavailable'
      : isStale
        ? 'stale'
        : 'indexed';
  const agentAction = buildAgentAction(source, status);
  const reviewUrgency = buildReviewUrgency(status, latestDocumentAt, nextReviewAt, generatedAtMs);

  return {
    ...source,
    status,
    agentAction,
    reviewUrgency,
    matchedDocuments: matched.length,
    indexedDocuments: indexedDocuments.length,
    totalChunks: matched.reduce((sum, document) => sum + Number(document.chunk_count || 0), 0),
    latestDocumentAt,
    nextReviewAt,
    matchedDocumentTitles: matched
      .map((document) => document.title || document.url || document.id)
      .filter(Boolean)
      .slice(0, 4),
    recommendation: buildRecommendation(source, status),
  };
}

function buildAgentAction(
  source: CompassPolicySource,
  status: CompassSourceStatus,
): CompassSourceAgentAction {
  if (status === 'indexed') return 'watch';
  if (status === 'stale') return 'refresh_candidate';
  if (status === 'unavailable') return 'review_extraction';
  if (source.discoveryMode === 'exact_url') return 'queue_exact_url';
  return 'queue_domain_discovery';
}

function buildReviewUrgency(
  status: CompassSourceStatus,
  latestDocumentAt: string | undefined,
  nextReviewAt: string | undefined,
  generatedAtMs: number,
): CompassSourceReviewUrgency {
  if (status === 'unavailable') return 'blocked';
  if (!latestDocumentAt) return 'due';
  if (!nextReviewAt) return 'due';
  return new Date(nextReviewAt).getTime() <= generatedAtMs ? 'due' : 'normal';
}

function documentMatchesSource(document: StoredDocument, source: CompassPolicySource): boolean {
  const sourceUrl = safeUrl(source.url);
  const documentUrl = safeUrl(document.url || '');
  const haystack = `${document.title || ''} ${document.url || ''}`.toLowerCase();
  const vendor = source.vendor.toLowerCase();

  if (documentUrl && sourceUrl) {
    if (documentUrl.href === sourceUrl.href) return true;
    if (source.discoveryMode === 'domain_discovery' && documentUrl.hostname.endsWith(sourceUrl.hostname)) {
      return true;
    }
  }

  if (source.vendor === 'META') {
    return ['meta', 'facebook', 'instagram', '메타', '페이스북', '인스타그램'].some((term) => haystack.includes(term));
  }

  return haystack.includes(vendor) || haystack.includes(source.vendor);
}

function buildRecommendation(source: CompassPolicySource, status: CompassSourceStatus): string {
  if (status === 'indexed') {
    return 'Current corpus has indexed material for this source. Keep it on scheduled watch.';
  }

  if (status === 'stale') {
    return 'Existing corpus material is older than the recommended cadence. Queue a backend refresh proposal.';
  }

  if (status === 'unavailable') {
    return 'A document match exists, but it is not indexed. Review extraction/chunking logs before promotion.';
  }

  if (source.discoveryMode === 'exact_url') {
    return 'No indexed match yet. Queue exact URL extraction in proposal mode.';
  }

  return 'No indexed match yet. Run domain discovery in proposal mode and let the agent select policy-grade pages.';
}

function isIndexedStatus(status?: string | null): boolean {
  return status === 'indexed' || status === 'completed';
}

function latestTimestamp(documents: StoredDocument[]): string | undefined {
  const timestamps = documents
    .map((document) => document.updated_at || document.created_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

  return timestamps[0];
}

function daysSince(timestamp: string): number {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / (1000 * 60 * 60 * 24);
}

function addDaysIso(timestamp: string, days: number): string | undefined {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return undefined;
  return new Date(time + days * 24 * 60 * 60 * 1000).toISOString();
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
