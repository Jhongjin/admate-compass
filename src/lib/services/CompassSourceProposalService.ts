import {
  buildCompassSourceOpsPlan,
  COMPASS_POLICY_SOURCES,
  type CompassPolicySource,
  type CompassSourceOpsItem,
} from './CompassSourceOpsService';

type ProposalStatus = 'candidate_ready' | 'fetch_disabled' | 'fetch_failed' | 'blocked';

export interface CompassSourceProposalCandidate {
  id: string;
  sourceId: string;
  vendor: CompassPolicySource['vendor'];
  label: string;
  url: string;
  host: string;
  status: ProposalStatus;
  reason: string;
  title?: string;
  canonicalUrl?: string;
  headings: string[];
  contentPreview?: string;
  contentLength?: number;
  fetchedAt?: string;
  sourceStatus?: CompassSourceOpsItem['status'];
  riskLevel: 'low' | 'medium' | 'high';
  wouldFetch: boolean;
  wouldIndex: false;
  wouldPromote: false;
  safety: {
    allowedHost: boolean;
    proposalOnly: true;
    mutationEnabled: false;
  };
}

export interface CompassSourceProposalRun {
  mode: 'proposal-only';
  dryRun: true;
  mutationEnabled: false;
  fetchEnabled: boolean;
  collectionOwner: 'backend-agent';
  generatedAt: string;
  candidates: CompassSourceProposalCandidate[];
  safetyNotes: string[];
}

interface BuildProposalOptions {
  sourceId?: string;
  maxSources?: number;
  fetchPreview?: boolean;
}

interface ExtractedPreview {
  title?: string;
  canonicalUrl?: string;
  headings: string[];
  contentPreview: string;
  contentLength: number;
  fetchedAt: string;
}

const MAX_SOURCES_PER_RUN = Number(process.env.COMPASS_SOURCE_PROPOSAL_MAX_SOURCES || 6);
const MAX_FETCH_BYTES = Number(process.env.COMPASS_SOURCE_PROPOSAL_MAX_BYTES || 200_000);
const FETCH_TIMEOUT_MS = Number(process.env.COMPASS_SOURCE_PROPOSAL_TIMEOUT_MS || 8000);

export async function buildCompassSourceProposalRun(
  options: BuildProposalOptions = {},
): Promise<CompassSourceProposalRun> {
  const sourceOpsPlan = await buildCompassSourceOpsPlan();
  const sourceStatusById = new Map(sourceOpsPlan.sources.map((source) => [source.id, source.status]));
  const fetchEnabled = isFetchEnabled(options.fetchPreview);
  const selectedSources = selectSources(options);
  const candidates: CompassSourceProposalCandidate[] = [];

  for (const source of selectedSources) {
    candidates.push(await buildCandidate(source, sourceStatusById.get(source.id), fetchEnabled));
  }

  return {
    mode: 'proposal-only',
    dryRun: true,
    mutationEnabled: false,
    fetchEnabled,
    collectionOwner: 'backend-agent',
    generatedAt: new Date().toISOString(),
    candidates,
    safetyNotes: [
      'This proposal run never writes documents, chunks, embeddings, or source templates.',
      'Network preview fetching is disabled unless COMPASS_SOURCE_PROPOSAL_FETCH_ENABLED=true.',
      'Only allowlisted official Compass policy hosts are eligible for proposal previews.',
      'Promotion to the production corpus must remain a separate apply step with an explicit approval gate.',
    ],
  };
}

function selectSources(options: BuildProposalOptions): CompassPolicySource[] {
  const maxSources = Math.max(1, Math.min(options.maxSources || MAX_SOURCES_PER_RUN, 20));
  const sources = options.sourceId
    ? COMPASS_POLICY_SOURCES.filter((source) => source.id === options.sourceId)
    : COMPASS_POLICY_SOURCES;

  return sources.slice(0, maxSources);
}

async function buildCandidate(
  source: CompassPolicySource,
  sourceStatus: CompassSourceOpsItem['status'] | undefined,
  fetchEnabled: boolean,
): Promise<CompassSourceProposalCandidate> {
  const sourceUrl = safeUrl(source.url);
  const allowedHost = Boolean(sourceUrl && isAllowedPolicyHost(sourceUrl));
  const baseCandidate: CompassSourceProposalCandidate = {
    id: `proposal_${source.id}`,
    sourceId: source.id,
    vendor: source.vendor,
    label: source.label,
    url: source.url,
    host: sourceUrl?.hostname || '',
    status: 'fetch_disabled',
    reason: 'Queued for proposal review. Fetch preview is disabled in this environment.',
    headings: [],
    sourceStatus,
    riskLevel: source.discoveryMode === 'domain_discovery' ? 'medium' : 'low',
    wouldFetch: fetchEnabled,
    wouldIndex: false,
    wouldPromote: false,
    safety: {
      allowedHost,
      proposalOnly: true,
      mutationEnabled: false,
    },
  };

  if (!sourceUrl || !allowedHost) {
    return {
      ...baseCandidate,
      status: 'blocked',
      reason: 'Source URL is not allowlisted for Compass policy collection.',
    };
  }

  if (!fetchEnabled) {
    return baseCandidate;
  }

  try {
    const preview = await fetchPreview(sourceUrl);
    return {
      ...baseCandidate,
      status: 'candidate_ready',
      reason: 'Preview fetched for operator review. No corpus mutation was performed.',
      ...preview,
    };
  } catch (error) {
    return {
      ...baseCandidate,
      status: 'fetch_failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function isFetchEnabled(fetchPreview?: boolean): boolean {
  if (!fetchPreview) return false;
  if (process.env.COMPASS_SOURCE_PROPOSAL_FETCH_ENABLED !== 'true') return false;
  if (process.env.COMPASS_SOURCE_COLLECTION_DRY_RUN === 'false') return false;
  return true;
}

function isAllowedPolicyHost(url: URL): boolean {
  return COMPASS_POLICY_SOURCES.some((source) => {
    const allowed = safeUrl(source.url);
    if (!allowed) return false;
    return url.hostname === allowed.hostname || url.hostname.endsWith(`.${allowed.hostname}`);
  });
}

async function fetchPreview(url: URL): Promise<ExtractedPreview> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
        'User-Agent': 'AdMate-Compass-Source-Proposal/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Preview fetch failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      throw new Error(`Unsupported preview content type: ${contentType || 'unknown'}`);
    }

    const html = await readLimitedText(response, MAX_FETCH_BYTES);
    return extractPreview(html, response.url || url.toString());
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return text.slice(0, maxBytes);
  }
  return text;
}

function extractPreview(html: string, finalUrl: string): ExtractedPreview {
  const title = decodeEntities(matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const canonicalUrl = matchFirst(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || matchFirst(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)
    || finalUrl;
  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((match) => normalizeText(stripTags(match[1])))
    .filter(Boolean)
    .slice(0, 12);
  const mainHtml = matchFirst(html, /<main[^>]*>([\s\S]*?)<\/main>/i)
    || matchFirst(html, /<article[^>]*>([\s\S]*?)<\/article>/i)
    || matchFirst(html, /<body[^>]*>([\s\S]*?)<\/body>/i)
    || html;
  const contentPreview = normalizeText(stripTags(removePageChrome(mainHtml))).slice(0, 1200);

  return {
    title: normalizeText(title),
    canonicalUrl,
    headings,
    contentPreview,
    contentLength: contentPreview.length,
    fetchedAt: new Date().toISOString(),
  };
}

function removePageChrome(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '));
}

function normalizeText(value?: string): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value?: string): string {
  return (value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function matchFirst(value: string, pattern: RegExp): string | undefined {
  const match = value.match(pattern);
  return match?.[1];
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
