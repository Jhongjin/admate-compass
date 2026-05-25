export interface CompassSourcePreview {
  title?: string;
  canonicalUrl?: string;
  headings: string[];
  contentPreview: string;
  contentLength: number;
  fetchedAt: string;
}

export interface CompassSourcePreviewParserOptions {
  fetchedAt?: string;
  minPreviewChars?: number;
  allowedHosts?: string[];
}

export type CompassSourcePreviewSafetyRejectionReason =
  | 'invalid_url'
  | 'unsupported_url_scheme'
  | 'private_or_internal_url'
  | 'host_not_allowlisted'
  | 'canonical_url_not_allowlisted'
  | 'secret_like_text'
  | 'raw_html_detected';

const DEFAULT_MIN_PREVIEW_CHARS = 160;
const MAX_PREVIEW_CHARS = 1200;

const DEFAULT_ALLOWED_POLICY_HOSTS = [
  'facebook.com',
  'instagram.com',
  'business.kakao.com',
  'ads.naver.com',
  'support.google.com',
];

const SECRET_LIKE_PATTERNS = [
  /\bauthorization\s*:\s*bearer\s+[a-z0-9._~+/=_-]{10,}/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?id|credential|secret)\s*[:=]\s*["']?[a-z0-9._~+/=_-]{10,}/i,
  /\bcookie\s*[:=]\s*["']?[^;\s]{10,}/i,
  /\beyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/i,
  /\bX-Amz-Signature=/i,
];

const SECRET_LIKE_QUERY_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session(?:[_-]?id)?|credential|cookie|secret|signature|x-amz-signature)/i;

const RAW_HTML_TEXT_PATTERN = /<\/?(?:html|head|body|script|style|nav|header|footer|main|article|section|div|span|p|h[1-6]|meta|link)\b[^>]*>/i;

export function extractCompassSourcePreview(
  html: string,
  finalUrl: string,
  options: CompassSourcePreviewParserOptions = {},
): CompassSourcePreview {
  const rawHtml = String(html || '');
  const finalUrlValue = safeUrl(finalUrl);
  const canonicalUrl = resolveCanonicalUrl(rawHtml, finalUrlValue)?.toString() || finalUrl;
  const title = decodeEntities(matchFirst(rawHtml, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const headings = Array.from(rawHtml.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((match) => normalizeText(stripTags(match[1])))
    .filter(Boolean)
    .slice(0, 12);
  const mainHtml = matchFirst(rawHtml, /<main[^>]*>([\s\S]*?)<\/main>/i)
    || matchFirst(rawHtml, /<article[^>]*>([\s\S]*?)<\/article>/i)
    || matchFirst(rawHtml, /<body[^>]*>([\s\S]*?)<\/body>/i)
    || rawHtml;
  const contentPreview = normalizeText(stripTags(removePageChrome(mainHtml))).slice(0, MAX_PREVIEW_CHARS);

  const preview = {
    title: normalizeText(title),
    canonicalUrl,
    headings,
    contentPreview,
    contentLength: contentPreview.length,
    fetchedAt: options.fetchedAt || new Date().toISOString(),
  };

  validateCompassSourcePreview(preview, finalUrl, options, rawHtml);
  return preview;
}

export function validateCompassSourcePreview(
  preview: CompassSourcePreview,
  finalUrl: string,
  options: CompassSourcePreviewParserOptions = {},
  rawHtml = '',
): void {
  const minPreviewChars = options.minPreviewChars ?? DEFAULT_MIN_PREVIEW_CHARS;
  const safetyReasons = validateCompassSourcePreviewSafety(preview, finalUrl, options, rawHtml);

  if (safetyReasons.length > 0) {
    throw new Error(`Preview fetch failed public-envelope safety check: ${safetyReasons.join(', ')}`);
  }

  const signalText = [
    preview.title,
    ...preview.headings,
    preview.contentPreview,
  ].join(' ').toLowerCase();

  const hasPolicySignal = [
    'ads',
    'adspolicy',
    'advertis',
    'business',
    'campaign',
    'facebook',
    'google',
    'instagram',
    'kakao',
    'meta',
    'naver',
    'policy',
    'support',
    '\uad11\uace0',
    '\uac80\uc218',
    '\uc815\ucc45',
    '\ub3c4\uc6c0\ub9d0',
  ].some((term) => signalText.includes(term));

  if (preview.contentPreview.length < 80 || (preview.contentPreview.length < minPreviewChars && preview.headings.length === 0)) {
    throw new Error('Preview fetch produced too little readable policy content.');
  }

  if (!hasPolicySignal) {
    throw new Error('Preview fetch lacks enough readable policy signal for Compass review.');
  }
}

export function validateCompassSourcePreviewSafety(
  preview: CompassSourcePreview,
  finalUrl: string,
  options: CompassSourcePreviewParserOptions = {},
  rawHtml = '',
): CompassSourcePreviewSafetyRejectionReason[] {
  const reasons: CompassSourcePreviewSafetyRejectionReason[] = [];
  const allowedHosts = options.allowedHosts || DEFAULT_ALLOWED_POLICY_HOSTS;
  const finalUrlValue = safeUrl(finalUrl);
  const canonicalUrlValue = preview.canonicalUrl ? safeUrl(preview.canonicalUrl) : null;

  if (!finalUrlValue) {
    reasons.push('invalid_url');
  }

  if (finalUrlValue && finalUrlValue.protocol !== 'https:') {
    reasons.push('unsupported_url_scheme');
  }

  if (finalUrlValue && isPrivateOrInternalHost(finalUrlValue.hostname)) {
    reasons.push('private_or_internal_url');
  }

  if (finalUrlValue && !isAllowedPolicyHost(finalUrlValue.hostname, allowedHosts)) {
    reasons.push('host_not_allowlisted');
  }

  if (
    !canonicalUrlValue
    || canonicalUrlValue.protocol !== 'https:'
    || isPrivateOrInternalHost(canonicalUrlValue.hostname)
    || !isAllowedPolicyHost(canonicalUrlValue.hostname, allowedHosts)
  ) {
    reasons.push('canonical_url_not_allowlisted');
  }

  for (const value of [
    preview.title,
    preview.canonicalUrl,
    ...preview.headings,
    preview.contentPreview,
  ]) {
    reasons.push(...getPublicEnvelopeFieldSafetyReasons(value));
  }

  if (
    containsSecretLikeText(rawHtml)
    || (finalUrlValue && containsSecretLikeUrl(finalUrlValue))
    || (canonicalUrlValue && containsSecretLikeUrl(canonicalUrlValue))
  ) {
    reasons.push('secret_like_text');
  }

  return unique(reasons);
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

function resolveCanonicalUrl(html: string, finalUrl: URL | null): URL | null {
  const canonicalHref = matchFirst(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || matchFirst(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);

  if (!canonicalHref && finalUrl) {
    return finalUrl;
  }

  if (!canonicalHref) {
    return null;
  }

  try {
    return new URL(decodeEntities(canonicalHref), finalUrl?.toString());
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '));
}

function normalizeText(value?: string): string {
  return (value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value?: string): string {
  return (value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function matchFirst(value: string, pattern: RegExp): string | undefined {
  const match = value.match(pattern);
  return match?.[1];
}

function getPublicEnvelopeFieldSafetyReasons(value?: string): CompassSourcePreviewSafetyRejectionReason[] {
  const normalized = normalizeText(value);
  const reasons: CompassSourcePreviewSafetyRejectionReason[] = [];

  if (!normalized) return reasons;

  if (containsRawHtmlLikeText(normalized)) {
    reasons.push('raw_html_detected');
  }

  if (containsSecretLikeText(normalized)) {
    reasons.push('secret_like_text');
  }

  return unique(reasons);
}

function containsSecretLikeText(value?: string): boolean {
  return buildSafetyScanCandidates(value).some((candidate) => (
    SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(candidate))
  ));
}

function containsRawHtmlLikeText(value?: string): boolean {
  return buildSafetyScanCandidates(value).some((candidate) => RAW_HTML_TEXT_PATTERN.test(candidate));
}

function buildSafetyScanCandidates(value?: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];

  const entityDecoded = normalizeText(decodeEntities(normalized));
  const uriDecoded = normalizeText(decodeUriComponentSafely(normalized));
  const entityAndUriDecoded = normalizeText(decodeUriComponentSafely(entityDecoded));

  return unique([normalized, entityDecoded, uriDecoded, entityAndUriDecoded].filter(Boolean));
}

function decodeUriComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    try {
      return decodeURI(value);
    } catch {
      return value;
    }
  }
}

function containsSecretLikeUrl(url: URL): boolean {
  if (containsSecretLikeText(url.toString())) return true;

  return Array.from(url.searchParams.keys()).some((key) => (
    SECRET_LIKE_QUERY_KEY_PATTERN.test(key) && Boolean(url.searchParams.get(key)?.trim())
  ));
}

function isAllowedPolicyHost(hostname: string, allowedHosts: string[]): boolean {
  const normalizedHost = normalizeHostname(hostname);

  return allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = normalizeHostname(allowedHost);
    return normalizedHost === normalizedAllowedHost || normalizedHost.endsWith(`.${normalizedAllowedHost}`);
  });
}

function isPrivateOrInternalHost(hostname: string): boolean {
  const host = normalizeHostname(hostname).replace(/^\[|\]$/g, '');

  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.corp')) return true;
  if (host === 'metadata.google.internal') return true;
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;

  const ipv4Parts = host.split('.').map((part) => Number(part));
  if (ipv4Parts.length === 4 && ipv4Parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = ipv4Parts;
    if (first === 0 || first === 10 || first === 127) return true;
    if (first === 169 && second === 254) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 100 && second >= 64 && second <= 127) return true;
    if (first === 198 && (second === 18 || second === 19)) return true;
    if (first >= 224) return true;
  }

  return false;
}

function normalizeHostname(hostname: string): string {
  return String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
