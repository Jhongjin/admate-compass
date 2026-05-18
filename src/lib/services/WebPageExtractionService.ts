export type WebPageExtractionStatus = 'accepted' | 'rejected';

export type WebPageExtractionLanguage = 'ko' | 'en' | 'mixed' | 'unknown';

export type WebPageExtractionRejectionReason =
  | 'invalid_url'
  | 'unsupported_url_scheme'
  | 'private_or_internal_url'
  | 'host_not_allowlisted'
  | 'canonical_url_not_allowlisted'
  | 'raw_html_too_large'
  | 'secret_like_text'
  | 'raw_html_detected'
  | 'placeholder_or_low_signal_content'
  | 'insufficient_readable_content'
  | 'insufficient_policy_signal';

export interface WebPageExtractionSourceQuality {
  hasDocumentId: false;
  hasTitle: boolean;
  hasUrl: boolean;
  hasExcerpt: boolean;
  isFallback: false;
  linkedToDocument: false;
  qualityScore: number;
  warnings: string[];
}

export interface WebPageExtractionOptions {
  fetchedAt?: string;
  allowedHosts?: string[];
  minContentChars?: number;
  minPolicySignals?: number;
  maxRawHtmlBytes?: number;
}

export interface WebPageExtractionResult {
  status: WebPageExtractionStatus;
  canonicalUrl: string;
  sourceTitle: string;
  contentText: string;
  contentHash: string;
  extractedAt: string;
  sourceQuality: WebPageExtractionSourceQuality;
  boilerplateRemoved: boolean;
  boilerplateRemovedTypes: string[];
  language: WebPageExtractionLanguage;
  headings: string[];
  policySignals: string[];
  rejectionReasons: WebPageExtractionRejectionReason[];
}

interface PageChromeRule {
  type: string;
  pattern: RegExp;
}

const DEFAULT_MIN_CONTENT_CHARS = 320;
const DEFAULT_MIN_POLICY_SIGNALS = 3;
const DEFAULT_MAX_RAW_HTML_BYTES = 512_000;

const DEFAULT_ALLOWED_POLICY_HOSTS = [
  'facebook.com',
  'instagram.com',
  'business.kakao.com',
  'ads.naver.com',
  'support.google.com',
];

const PAGE_CHROME_RULES: PageChromeRule[] = [
  { type: 'script', pattern: /<script[\s\S]*?<\/script>/gi },
  { type: 'style', pattern: /<style[\s\S]*?<\/style>/gi },
  { type: 'noscript', pattern: /<noscript[\s\S]*?<\/noscript>/gi },
  { type: 'svg', pattern: /<svg[\s\S]*?<\/svg>/gi },
  { type: 'iframe', pattern: /<iframe[\s\S]*?<\/iframe>/gi },
  { type: 'form', pattern: /<form[\s\S]*?<\/form>/gi },
  { type: 'header', pattern: /<header[\s\S]*?<\/header>/gi },
  { type: 'footer', pattern: /<footer[\s\S]*?<\/footer>/gi },
  { type: 'nav', pattern: /<nav[\s\S]*?<\/nav>/gi },
  { type: 'button', pattern: /<button[\s\S]*?<\/button>/gi },
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

const PLACEHOLDER_PATTERNS = [
  /\bcoming soon\b/i,
  /\blorem ipsum\b/i,
  /\bplaceholder\b/i,
  /\burl crawling is not available\b/i,
  /serverless document processing path/i,
  /이 URL은 서버리스 환경에서 크롤링할 수 없습니다/i,
  /URL 형태로 저장되었습니다/i,
  /실제 내용은 관리자가 별도로 처리/i,
  /관리자에게 문의/i,
  /로그인\s*회원가입\s*메뉴/i,
];

const POLICY_SIGNAL_GROUPS = [
  { signal: 'vendor:meta', terms: ['meta', 'facebook', 'instagram', '메타', '페이스북', '인스타그램'] },
  { signal: 'vendor:google', terms: ['google ads', 'google', 'adspolicy', 'youtube'] },
  { signal: 'vendor:kakao', terms: ['kakao', '카카오'] },
  { signal: 'vendor:naver', terms: ['naver', '네이버'] },
  { signal: 'policy:advertising', terms: ['advertising', 'ads', 'ad policy', 'advertiser', '광고'] },
  { signal: 'policy:review', terms: ['review', 'approval', 'prohibited', 'restricted', '검수', '심사', '승인', '반려', '금지', '제한'] },
  { signal: 'policy:campaign', terms: ['campaign', 'creative', 'landing page', 'business', '캠페인', '소재', '랜딩', '비즈니스'] },
  { signal: 'policy:support', terms: ['support', 'help center', '도움말', '고객센터', '가이드'] },
];

export class WebPageExtractionService {
  extract(
    html: string,
    finalUrl: string,
    options: WebPageExtractionOptions = {},
  ): WebPageExtractionResult {
    return extractWebPageForCompass(html, finalUrl, options);
  }
}

export function extractWebPageForCompass(
  html: string,
  finalUrl: string,
  options: WebPageExtractionOptions = {},
): WebPageExtractionResult {
  const rawHtml = String(html || '');
  const finalUrlValue = safeUrl(finalUrl);
  const rejectionReasons: WebPageExtractionRejectionReason[] = [];
  const maxRawHtmlBytes = options.maxRawHtmlBytes ?? DEFAULT_MAX_RAW_HTML_BYTES;

  if (approximateUtf8ByteLength(rawHtml) > maxRawHtmlBytes) {
    rejectionReasons.push('raw_html_too_large');
  }

  if (!finalUrlValue) {
    rejectionReasons.push('invalid_url');
  }

  if (finalUrlValue && finalUrlValue.protocol !== 'https:') {
    rejectionReasons.push('unsupported_url_scheme');
  }

  if (finalUrlValue && isPrivateOrInternalHost(finalUrlValue.hostname)) {
    rejectionReasons.push('private_or_internal_url');
  }

  const canonicalUrlValue = resolveCanonicalUrl(rawHtml, finalUrlValue);
  const allowedHosts = options.allowedHosts || DEFAULT_ALLOWED_POLICY_HOSTS;

  if (finalUrlValue && !isAllowedPolicyHost(finalUrlValue.hostname, allowedHosts)) {
    rejectionReasons.push('host_not_allowlisted');
  }

  if (
    canonicalUrlValue
    && (
      canonicalUrlValue.protocol !== 'https:'
      || isPrivateOrInternalHost(canonicalUrlValue.hostname)
      || !isAllowedPolicyHost(canonicalUrlValue.hostname, allowedHosts)
    )
  ) {
    rejectionReasons.push('canonical_url_not_allowlisted');
  }

  const title = normalizeText(decodeEntities(matchFirst(rawHtml, /<title[^>]*>([\s\S]*?)<\/title>/i)));
  const headings = extractHeadings(rawHtml);
  const fullChromeResult = removePageChrome(rawHtml);
  const mainHtml = matchFirst(fullChromeResult.html, /<main[^>]*>([\s\S]*?)<\/main>/i)
    || matchFirst(fullChromeResult.html, /<article[^>]*>([\s\S]*?)<\/article>/i)
    || matchFirst(fullChromeResult.html, /<body[^>]*>([\s\S]*?)<\/body>/i)
    || fullChromeResult.html;
  const mainChromeResult = removePageChrome(mainHtml);
  const removedBoilerplateTypes = unique([...fullChromeResult.removedTypes, ...mainChromeResult.removedTypes]);
  const contentCandidate = normalizeText(stripTags(mainChromeResult.html));
  const sourceTitle = title || headings[0] || canonicalUrlValue?.hostname || finalUrlValue?.hostname || '';
  const signalText = [
    sourceTitle,
    canonicalUrlValue?.toString(),
    finalUrlValue?.toString(),
    ...headings,
    contentCandidate,
  ].join(' ');
  const policySignals = detectPolicySignals(signalText);
  const minContentChars = options.minContentChars ?? DEFAULT_MIN_CONTENT_CHARS;
  const minPolicySignals = options.minPolicySignals ?? DEFAULT_MIN_POLICY_SIGNALS;

  if (
    containsSecretLikeText(rawHtml)
    || containsSecretLikeText(contentCandidate)
    || (finalUrlValue && containsSecretLikeUrl(finalUrlValue))
    || (canonicalUrlValue && containsSecretLikeUrl(canonicalUrlValue))
  ) {
    rejectionReasons.push('secret_like_text');
  }

  if (RAW_HTML_TEXT_PATTERN.test(contentCandidate)) {
    rejectionReasons.push('raw_html_detected');
  }

  if (contentCandidate.length < minContentChars) {
    rejectionReasons.push('insufficient_readable_content');
  }

  if (isPlaceholderOrLowSignalContent(contentCandidate)) {
    rejectionReasons.push('placeholder_or_low_signal_content');
  }

  if (policySignals.length < minPolicySignals) {
    rejectionReasons.push('insufficient_policy_signal');
  }

  const uniqueRejections = unique(rejectionReasons);
  const status: WebPageExtractionStatus = uniqueRejections.length > 0 ? 'rejected' : 'accepted';
  const contentText = status === 'accepted' ? contentCandidate : '';
  const warnings = status === 'accepted' ? [] : uniqueRejections;
  const canonicalUrl = sanitizeUrlForExtractionOutput(canonicalUrlValue?.toString() || finalUrlValue?.toString() || '');
  const result: WebPageExtractionResult = {
    status,
    canonicalUrl,
    sourceTitle,
    contentText,
    contentHash: buildContentHash(`${canonicalUrl}\n${contentText}`),
    extractedAt: options.fetchedAt || new Date().toISOString(),
    sourceQuality: buildSourceQuality({
      status,
      sourceTitle,
      canonicalUrl,
      contentText,
      policySignals,
      warnings,
    }),
    boilerplateRemoved: removedBoilerplateTypes.length > 0,
    boilerplateRemovedTypes: removedBoilerplateTypes,
    language: detectLanguage(contentCandidate),
    headings,
    policySignals,
    rejectionReasons: uniqueRejections,
  };
  const safetyReasons = validateWebPageExtractionSafety(result);

  if (safetyReasons.length === 0) {
    return result;
  }

  const safeRejections = unique([...uniqueRejections, ...safetyReasons]);

  return {
    ...result,
    status: 'rejected',
    contentText: '',
    contentHash: buildContentHash(`${canonicalUrl}\n`),
    sourceQuality: buildSourceQuality({
      status: 'rejected',
      sourceTitle,
      canonicalUrl,
      contentText: '',
      policySignals,
      warnings: safeRejections,
    }),
    rejectionReasons: safeRejections,
  };
}

export function validateWebPageExtractionSafety(
  extraction: Pick<WebPageExtractionResult, 'contentText' | 'status' | 'rejectionReasons'>,
): WebPageExtractionRejectionReason[] {
  const reasons: WebPageExtractionRejectionReason[] = [];

  if (extraction.contentText && RAW_HTML_TEXT_PATTERN.test(extraction.contentText)) {
    reasons.push('raw_html_detected');
  }

  if (containsSecretLikeText(extraction.contentText)) {
    reasons.push('secret_like_text');
  }

  if (extraction.status === 'accepted' && extraction.rejectionReasons.length > 0) {
    reasons.push(...extraction.rejectionReasons);
  }

  return unique(reasons);
}

function buildSourceQuality(input: {
  status: WebPageExtractionStatus;
  sourceTitle: string;
  canonicalUrl: string;
  contentText: string;
  policySignals: string[];
  warnings: string[];
}): WebPageExtractionSourceQuality {
  const hasTitle = input.sourceTitle.trim().length > 0;
  const hasUrl = input.canonicalUrl.trim().length > 0;
  const hasExcerpt = input.status === 'accepted' && input.contentText.trim().length > 0;
  const lengthScore = Math.min(input.contentText.length / 2000, 1) * 0.35;
  const signalScore = Math.min(input.policySignals.length / 6, 1) * 0.45;
  const shapeScore = (hasTitle ? 0.1 : 0) + (hasUrl ? 0.1 : 0);
  const acceptedScore = Math.max(0, Math.min(1, lengthScore + signalScore + shapeScore));

  return {
    hasDocumentId: false,
    hasTitle,
    hasUrl,
    hasExcerpt,
    isFallback: false,
    linkedToDocument: false,
    qualityScore: input.status === 'accepted' ? Number(acceptedScore.toFixed(2)) : 0,
    warnings: input.warnings,
  };
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

function extractHeadings(html: string): string[] {
  return Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((match) => normalizeText(stripTags(match[1])))
    .filter(Boolean)
    .slice(0, 12);
}

function removePageChrome(html: string): { html: string; removedTypes: string[] } {
  let cleanHtml = html;
  const removedTypes: string[] = [];

  for (const rule of PAGE_CHROME_RULES) {
    const matches = cleanHtml.match(rule.pattern);
    if (matches?.length) {
      removedTypes.push(rule.type);
      cleanHtml = cleanHtml.replace(rule.pattern, ' ');
    }
  }

  return {
    html: cleanHtml,
    removedTypes: unique(removedTypes),
  };
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

function detectPolicySignals(value: string): string[] {
  const normalized = value.toLowerCase();
  return POLICY_SIGNAL_GROUPS
    .filter((group) => group.terms.some((term) => normalized.includes(term.toLowerCase())))
    .map((group) => group.signal);
}

function detectLanguage(value: string): WebPageExtractionLanguage {
  const length = Math.max(value.length, 1);
  const hangulRatio = (value.match(/[\u3131-\u3163\uac00-\ud7a3]/g)?.length || 0) / length;
  const latinRatio = (value.match(/[a-z]/gi)?.length || 0) / length;

  if (hangulRatio > 0.12 && latinRatio > 0.12) return 'mixed';
  if (hangulRatio > 0.12) return 'ko';
  if (latinRatio > 0.2) return 'en';
  return 'unknown';
}

function isPlaceholderOrLowSignalContent(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  if (words.length >= 20 && uniqueWords.size / words.length < 0.25) return true;

  return false;
}

function containsSecretLikeText(value: string): boolean {
  return SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(value));
}

function containsSecretLikeUrl(url: URL): boolean {
  if (containsSecretLikeText(url.toString())) return true;

  return Array.from(url.searchParams.keys()).some((key) => (
    SECRET_LIKE_QUERY_KEY_PATTERN.test(key) && Boolean(url.searchParams.get(key)?.trim())
  ));
}

function sanitizeUrlForExtractionOutput(value: string): string {
  const url = safeUrl(value);
  if (!url) return value;

  for (const key of Array.from(url.searchParams.keys())) {
    if (SECRET_LIKE_QUERY_KEY_PATTERN.test(key)) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
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

function buildContentHash(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function approximateUtf8ByteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export const webPageExtractionService = new WebPageExtractionService();
