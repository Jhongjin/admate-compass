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

      // XML 정규화 (제어 문자 제거, 잘못된 형식 수정)
      let normalizedXml = xmlContent
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // 제어 문자 제거
        .replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;') // 잘못된 & 문자 수정
        .replace(/<([^>]+)\s+([^=]+)\s*>/g, '<$1 $2="">') // 속성 값 없는 경우 처리
        .trim();

      // XML 파싱 옵션 (관대한 모드)
      const parseOptions = {
        explicitArray: false,
        mergeAttrs: true,
        trim: true,
        normalize: true,
        normalizeTags: false,
        explicitRoot: false,
        ignoreAttrs: false,
        attrkey: '_attr',
        charkey: '_text',
        strict: false, // 엄격한 모드 비활성화
        async: false,
      };

      const result = await parseStringPromise(normalizedXml, parseOptions);

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
              if (urls.length > 0) {
                console.log(`✅ 하위 사이트맵 처리 완료: ${sitemap.loc} - ${urls.length}개 URL`);
              }
            } catch (error) {
              console.warn(`⚠️ 하위 사이트맵 파싱 실패: ${sitemap.loc}`, error);
            }
          }
        }

        if (allUrls.length > 0) {
          console.log(`✅ 사이트맵 인덱스 처리 완료: ${sitemapUrl} - 총 ${allUrls.length}개 URL`);
        }
        
        return allUrls;
      }

      // 일반 사이트맵인 경우 (urlset)
      if (result.urlset?.url) {
        const urls = Array.isArray(result.urlset.url)
          ? result.urlset.url
          : [result.urlset.url];

        const items = urls.map((item: any) => ({
          loc: item.loc || '',
          lastmod: item.lastmod,
          changefreq: item.changefreq,
          priority: item.priority ? parseFloat(item.priority) : undefined,
        })).filter((item: SitemapItem) => item.loc);
        
        if (items.length > 0) {
          console.log(`✅ 사이트맵 파싱 완료: ${sitemapUrl} - ${items.length}개 URL`);
        }
        
        return items;
      }

      console.log(`ℹ️ 사이트맵 형식 인식 실패: ${sitemapUrl} (빈 사이트맵 또는 알 수 없는 형식)`);
      return [];
    } catch (error) {
      // 에러 발생 시에도 경고만 표시하고 빈 배열 반환 (다른 방법으로 계속 진행)
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ 사이트맵 파싱 실패: ${sitemapUrl} - ${errorMessage}`);
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

