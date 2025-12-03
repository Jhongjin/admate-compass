/**
 * 사이트맵 파서
 * XML 사이트맵 파싱 및 URL 추출
 */

import { parseStringPromise } from 'xml2js';
import { gunzipSync } from 'zlib';
import type { SitemapItem } from '../types';

export class SitemapParser {
  /**
   * 사이트맵 URL에서 URL 목록 추출
   */
  async parseSitemap(sitemapUrl: string): Promise<SitemapItem[]> {
    try {
      console.log(`📄 사이트맵 파싱 시작: ${sitemapUrl}`);

      const response = await fetch(sitemapUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/xml, text/xml, */*',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      let xmlContent: string;
      const contentType = response.headers.get('content-type') || '';

      // Gzip 압축 해제
      if (contentType.includes('gzip') || sitemapUrl.endsWith('.gz')) {
        const buffer = await response.arrayBuffer();
        xmlContent = gunzipSync(Buffer.from(buffer)).toString('utf-8');
      } else {
        xmlContent = await response.text();
      }

      // XML 파싱
      const result = await parseStringPromise(xmlContent, {
        explicitArray: false,
        mergeAttrs: true,
      });

      // 사이트맵 인덱스인 경우 (sitemapindex)
      if (result.sitemapindex?.sitemap) {
        const sitemaps = Array.isArray(result.sitemapindex.sitemap)
          ? result.sitemapindex.sitemap
          : [result.sitemapindex.sitemap];

        const allUrls: SitemapItem[] = [];

        // 각 사이트맵을 재귀적으로 파싱
        for (const sitemap of sitemaps) {
          if (sitemap.loc) {
            try {
              const urls = await this.parseSitemap(sitemap.loc);
              allUrls.push(...urls);
            } catch (error) {
              console.warn(`⚠️ 하위 사이트맵 파싱 실패: ${sitemap.loc}`, error);
            }
          }
        }

        return allUrls;
      }

      // 일반 사이트맵인 경우 (urlset)
      if (result.urlset?.url) {
        const urls = Array.isArray(result.urlset.url)
          ? result.urlset.url
          : [result.urlset.url];

        return urls.map((item: any) => ({
          loc: item.loc || '',
          lastmod: item.lastmod,
          changefreq: item.changefreq,
          priority: item.priority ? parseFloat(item.priority) : undefined,
        })).filter((item: SitemapItem) => item.loc);
      }

      return [];
    } catch (error) {
      console.error(`❌ 사이트맵 파싱 실패: ${sitemapUrl}`, error);
      return [];
    }
  }

  /**
   * 일반적인 사이트맵 URL 찾기
   */
  getSitemapUrls(baseUrl: string): string[] {
    try {
      const baseUrlObj = new URL(baseUrl);
      const baseOrigin = `${baseUrlObj.protocol}//${baseUrlObj.host}`;

      return [
        `${baseOrigin}/sitemap.xml`,
        `${baseOrigin}/sitemap_index.xml`,
        `${baseOrigin}/sitemaps.xml`,
        `${baseOrigin}/sitemap1.xml`,
      ];
    } catch {
      // URL 파싱 실패 시 빈 배열 반환
      return [];
    }
  }

  /**
   * robots.txt에서 사이트맵 URL 찾기
   */
  async findSitemapsFromRobots(robotsUrl: string): Promise<string[]> {
    try {
      const response = await fetch(robotsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        return [];
      }

      const text = await response.text();
      const sitemapUrls: string[] = [];

      // Sitemap: 라인 찾기
      const lines = text.split('\n');
      for (const line of lines) {
        const match = line.match(/^Sitemap:\s*(.+)$/i);
        if (match && match[1]) {
          sitemapUrls.push(match[1].trim());
        }
      }

      return sitemapUrls;
    } catch (error) {
      console.warn(`⚠️ robots.txt에서 사이트맵 찾기 실패: ${robotsUrl}`, error);
      return [];
    }
  }
}

// 싱글톤 인스턴스
export const sitemapParser = new SitemapParser();

