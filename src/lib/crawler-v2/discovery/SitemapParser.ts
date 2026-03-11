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
  async parseSitemap(sitemapUrl: string, baseDomain?: string, config?: any): Promise<SitemapItem[]> {
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
        normalizeTags: true, // 태그 자동 소문자화
        explicitRoot: false,
        ignoreAttrs: false,
        attrkey: '_attr',
        charkey: '_text',
        strict: false, // 엄격한 모드 비활성화
        async: false,
      };

      const result = await parseStringPromise(normalizedXml, parseOptions);

      // 디버깅: 파싱 결과 구조 확인
      const resultKeys = Object.keys(result);
      if (resultKeys.length > 0) {
        console.log(`🔍 사이트맵 파싱 결과 키: ${resultKeys.join(', ')}`);
      }

      // 사이트맵 인덱스인 경우 (sitemapindex)
      // explicitRoot: false이므로 result 자체가 sitemapindex일 수도 있고 속성으로 있을 수도 있음
      const sitemapIndex = result.sitemapindex || result.sitemap_index || result;
      const sitemapItems = sitemapIndex.sitemap || sitemapIndex.sitemapindex?.sitemap;

      if (sitemapItems) {
        const sitemaps = Array.isArray(sitemapItems)
          ? sitemapItems
          : [sitemapItems];

        const allUrls: SitemapItem[] = [];

        // 각 사이트맵을 재귀적으로 파싱
        for (const sitemap of sitemaps) {
          if (sitemap.loc) {
            try {
              const urls = await this.parseSitemap(sitemap.loc, baseDomain, config);
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
      // explicitRoot: false이므로 result 자체가 urlset일 수도 있고 속성으로 있을 수도 있음
      const urlSet = result.urlset || result.url_set || result;
      const urlItems = urlSet.url || urlSet.urlset?.url;

      if (urlItems) {
        const urls = Array.isArray(urlItems)
          ? urlItems
          : [urlItems];

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

      // 디버깅: 실제 응답 내용 확인 (처음 500자만)
      if (normalizedXml.length > 0) {
        const preview = normalizedXml.substring(0, 500);
        console.log(`ℹ️ 사이트맵 형식 인식 실패: ${sitemapUrl}`);
        console.log(`📄 응답 미리보기 (처음 500자): ${preview}...`);
        console.log(`📊 파싱 결과 키: ${resultKeys.join(', ') || '없음'}`);
      } else {
        console.log(`ℹ️ 사이트맵이 비어있음: ${sitemapUrl}`);
      }
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

