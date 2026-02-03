import { DocumentProcessingService } from './DocumentProcessingService';

export interface MetaDocument {
  title: string;
  content: string;
  url: string;
  type: 'policy' | 'help' | 'guide';
  lastUpdated: string;
}

export class MetaCrawlingService {
  private documentProcessingService: DocumentProcessingService;

  constructor() {
    this.documentProcessingService = new DocumentProcessingService();
  }

  /**
   * Meta 공식 문서 URL 목록
   */
  private getMetaDocumentUrls(): string[] {
    return [
      // Facebook Business Help Center
      'https://www.facebook.com/business/help/164749007013531',
      'https://www.facebook.com/business/help/164749007013531?id=176276239642189',
      'https://www.facebook.com/business/help/164749007013531?id=176276239642189&ref=facebook_business_help',
      
      // Facebook Ads Policy
      'https://www.facebook.com/policies/ads/',
      'https://www.facebook.com/policies/ads/restricted_content/',
      'https://www.facebook.com/policies/ads/prohibited_content/',
      
      // Instagram Business Help
      'https://business.instagram.com/help/',
      'https://business.instagram.com/help/instagram-business/',
      
      // Meta for Developers
      'https://developers.facebook.com/docs/marketing-api/',
      'https://developers.facebook.com/docs/marketing-api/overview/',
      
      // 공개 Wikipedia 페이지 (대안)
      'https://ko.wikipedia.org/wiki/Facebook_Advertising',
      'https://ko.wikipedia.org/wiki/Instagram',
      'https://ko.wikipedia.org/wiki/Meta_Platforms'
    ];
  }

  /**
   * Meta URL에 대한 특별 처리
   */
  async crawlMetaDocument(url: string): Promise<MetaDocument | null> {
    try {
      console.log(`Meta 문서 크롤링 시작: ${url}`);

      // 1. 공개 Wikipedia 페이지는 일반 처리
      if (url.includes('wikipedia.org')) {
        const processedDoc = await this.documentProcessingService.processUrl(url);
        return {
          title: processedDoc.metadata.title,
          content: processedDoc.content,
          url: url,
          type: 'guide',
          lastUpdated: new Date().toISOString()
        };
      }

      // 2. Meta 공식 URL에 대한 특별 처리
      if (url.includes('facebook.com') || url.includes('instagram.com') || url.includes('meta.com')) {
        return await this.crawlMetaOfficialUrl(url);
      }

      // 3. 기타 URL은 일반 처리
      const processedDoc = await this.documentProcessingService.processUrl(url);
      return {
        title: processedDoc.metadata.title,
        content: processedDoc.content,
        url: url,
        type: 'guide',
        lastUpdated: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Meta 문서 크롤링 실패: ${url}`, error);
      return null;
    }
  }

  /**
   * Meta 공식 URL 크롤링 (특별 처리)
   */
  private async crawlMetaOfficialUrl(url: string): Promise<MetaDocument | null> {
    try {
      // Meta URL에 대한 특별한 User-Agent와 헤더 설정
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Cache-Control': 'max-age=0',
          'Referer': 'https://www.facebook.com/',
          'Origin': 'https://www.facebook.com'
        }
      });

      if (!response.ok) {
        console.warn(`Meta URL 접근 실패: ${url} - ${response.status} ${response.statusText}`);
        return null;
      }

      const html = await response.text();
      const content = this.extractTextFromHTML(html);
      
      if (!content || content.trim().length === 0) {
        console.warn(`Meta URL에서 텍스트 추출 실패: ${url}`);
        return null;
      }

      return {
        title: this.extractTitleFromHTML(html) || url,
        content: content,
        url: url,
        type: this.determineDocumentType(url),
        lastUpdated: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Meta 공식 URL 크롤링 실패: ${url}`, error);
      return null;
    }
  }

  /**
   * HTML에서 텍스트 추출
   */
  private extractTextFromHTML(html: string): string {
    // HTML 태그 제거
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<[^>]+>/g, ' ');
    
    // 특수 문자 정리
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    
    // 공백 정리
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  /**
   * HTML에서 제목 추출
   */
  private extractTitleFromHTML(html: string): string | null {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
    
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match) {
      return h1Match[1].trim();
    }
    
    return null;
  }

  /**
   * URL 기반으로 문서 타입 결정
   */
  private determineDocumentType(url: string): 'policy' | 'help' | 'guide' {
    if (url.includes('/policies/')) return 'policy';
    if (url.includes('/help/')) return 'help';
    return 'guide';
  }

  /**
   * 모든 Meta 문서 크롤링
   */
  async crawlAllMetaDocuments(): Promise<MetaDocument[]> {
    const urls = this.getMetaDocumentUrls();
    const results: MetaDocument[] = [];

    console.log(`Meta 문서 크롤링 시작: ${urls.length}개 URL`);

    for (const url of urls) {
      try {
        const document = await this.crawlMetaDocument(url);
        if (document) {
          results.push(document);
          console.log(`✅ 성공: ${document.title}`);
        } else {
          console.log(`❌ 실패: ${url}`);
        }
        
        // 요청 간격 조절 (Rate Limiting 방지)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`URL 처리 중 오류: ${url}`, error);
      }
    }

    console.log(`Meta 문서 크롤링 완료: ${results.length}/${urls.length}개 성공`);
    return results;
  }
}

export const metaCrawlingService = new MetaCrawlingService();
