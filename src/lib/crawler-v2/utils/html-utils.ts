/**
 * HTML 유틸리티 함수
 */

/**
 * HTML에서 텍스트 추출
 */
export function extractTextFromHtml(html: string): string {
  // 간단한 HTML 태그 제거
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // HTML 엔티티 디코딩
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&copy;/g, '©')
    .replace(/&reg;/g, '®')
    .replace(/&trade;/g, '™');

  return text;
}

/**
 * HTML에서 제목 추출
 */
export function extractTitleFromHtml(html: string, strategy: 'h1' | 'title' | 'og:title' | 'auto' = 'auto'): string | null {
  if (strategy === 'h1' || strategy === 'auto') {
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match && h1Match[1].trim()) {
      return h1Match[1].trim();
    }
  }

  if (strategy === 'og:title' || strategy === 'auto') {
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitleMatch && ogTitleMatch[1].trim()) {
      return ogTitleMatch[1].trim();
    }
  }

  if (strategy === 'title' || strategy === 'auto') {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1].trim()) {
      return titleMatch[1].trim();
    }
  }

  return null;
}

/**
 * HTML에서 메타 태그 추출
 */
export function extractMetaTag(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

import * as cheerio from 'cheerio';

/**
 * HTML에서 링크 추출 (Cheerio 사용)
 */
export function extractLinks(html: string, baseUrl: string): Array<{ url: string; text: string }> {
  const links: Array<{ url: string; text: string }> = [];
  const seenUrls = new Set<string>();

  try {
    const $ = cheerio.load(html);

    $('a').each((_, element) => {
      const $element = $(element);
      const href = $element.attr('href');

      if (!href) return;

      try {
        // 상대 URL 처리
        let absoluteUrl: string;
        if (href.startsWith('http://') || href.startsWith('https://')) {
          absoluteUrl = href;
        } else if (href.startsWith('//')) {
          absoluteUrl = new URL(baseUrl).protocol + href;
        } else if (href.startsWith('/')) {
          const baseUrlObj = new URL(baseUrl);
          absoluteUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`;
        } else {
          absoluteUrl = new URL(href, baseUrl).toString();
        }

        // 중복 제거
        const normalizedUrl = absoluteUrl.split('#')[0].split('?')[0];
        if (seenUrls.has(normalizedUrl)) {
          return;
        }

        // 텍스트 추출 (내부 태그 포함)
        let text = $element.text().trim();

        // 텍스트가 비어있다면 title 속성 확인
        if (!text) {
          text = $element.attr('title') || '';
        }

        // 그래도 비어있다면 이미지의 alt 텍스트 확인
        if (!text) {
          const imgAlt = $element.find('img').attr('alt');
          if (imgAlt) text = imgAlt;
        }

        // 마지막으로 URL에서 추측 (하지만 호출자가 처리하도록 비워두는 게 나을 수도 있음)
        // 여기서는 비어있으면 빈 문자열 반환

        // 공백 정리
        text = text.replace(/\s+/g, ' ').trim();

        seenUrls.add(normalizedUrl);
        links.push({
          url: absoluteUrl,
          text: text,
        });
      } catch {
        // 유효하지 않은 URL 무시
      }
    });
  } catch (error) {
    console.warn('Cheerio parsing failed, falling back to regex', error);
    // 폴백 로직 (기존 정규식)
    return extractLinksRegex(html, baseUrl);
  }

  return links;
}

/**
 * 정규식 기반 링크 추출 (폴백용)
 */
function extractLinksRegex(html: string, baseUrl: string): Array<{ url: string; text: string }> {
  const links: Array<{ url: string; text: string }> = [];
  const seenUrls = new Set<string>();

  const linkPatterns = [
    /<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a[^>]*href\s*=\s*([^\s>]+)[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const pattern of linkPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const href = match[1]?.trim();
      const text = match[2] || '';

      if (!href) continue;

      try {
        let absoluteUrl: string;
        if (href.startsWith('http')) {
          absoluteUrl = href;
        } else {
          absoluteUrl = new URL(href, baseUrl).toString();
        }

        const normalizedUrl = absoluteUrl.split('#')[0];
        if (seenUrls.has(normalizedUrl)) continue;
        seenUrls.add(normalizedUrl);

        links.push({
          url: absoluteUrl,
          text: extractTextFromHtml(text).trim(),
        });
      } catch { }
    }
  }
  return links;
}

/**
 * HTML에서 이미지 URL 추출
 */
export function extractImageUrls(html: string, baseUrl: string): string[] {
  const imageUrls: string[] = [];

  const imgPattern = /<img[^>]*src=["']([^"']+)["']/gi;
  let match;

  while ((match = imgPattern.exec(html)) !== null) {
    const src = match[1];
    try {
      const absoluteUrl = new URL(src, baseUrl).toString();
      imageUrls.push(absoluteUrl);
    } catch {
      // 유효하지 않은 URL은 무시
    }
  }

  return imageUrls;
}

/**
 * HTML 정리 (불필요한 요소 제거)
 */
export function cleanHtml(html: string, removeSelectors: string[] = []): string {
  let cleaned = html;

  // 기본 제거 선택자
  const defaultSelectors = ['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside'];
  const allSelectors = [...defaultSelectors, ...removeSelectors];

  for (const selector of allSelectors) {
    const pattern = new RegExp(`<${selector}[^>]*>[\s\S]*?<\/${selector}>`, 'gi');
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned;
}

