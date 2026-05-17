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
}

const DEFAULT_MIN_PREVIEW_CHARS = 160;
const MAX_PREVIEW_CHARS = 1200;

export function extractCompassSourcePreview(
  html: string,
  finalUrl: string,
  options: CompassSourcePreviewParserOptions = {},
): CompassSourcePreview {
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
  const contentPreview = normalizeText(stripTags(removePageChrome(mainHtml))).slice(0, MAX_PREVIEW_CHARS);

  const preview = {
    title: normalizeText(title),
    canonicalUrl,
    headings,
    contentPreview,
    contentLength: contentPreview.length,
    fetchedAt: options.fetchedAt || new Date().toISOString(),
  };

  validateCompassSourcePreview(preview, finalUrl, options);
  return preview;
}

export function validateCompassSourcePreview(
  preview: CompassSourcePreview,
  finalUrl: string,
  options: CompassSourcePreviewParserOptions = {},
): void {
  const minPreviewChars = options.minPreviewChars ?? DEFAULT_MIN_PREVIEW_CHARS;
  const signalText = [
    preview.title,
    preview.canonicalUrl,
    finalUrl,
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
