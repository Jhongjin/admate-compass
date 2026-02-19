/**
 * 대안 크롤링 서비스
 * Puppeteer가 실패할 경우 사용할 수 있는 대안 방법들
 */

export interface AlternativeDocument {
  title: string;
  content: string;
  url: string;
  type: 'policy' | 'help' | 'guide' | 'general';
  lastUpdated: string;
  contentLength: number;
}

export class AlternativeCrawlingService {
  
  /**
   * 방법 1: 공개 API 활용
   */
  async crawlWithPublicAPIs(): Promise<AlternativeDocument[]> {
    const documents: AlternativeDocument[] = [];
    
    try {
      // Wikipedia API 활용
      const wikipediaUrls = [
        'https://ko.wikipedia.org/wiki/Facebook',
        'https://ko.wikipedia.org/wiki/Instagram',
        'https://ko.wikipedia.org/wiki/Meta_Platforms'
      ];
      
      for (const url of wikipediaUrls) {
        try {
          const response = await fetch(url);
          if (response.ok) {
            const html = await response.text();
            const content = this.extractTextFromHTML(html);
            const title = this.extractTitleFromHTML(html);
            
            if (content && content.length > 100) {
              documents.push({
                title: title || url,
                content,
                url,
                type: 'general',
                lastUpdated: new Date().toISOString(),
                contentLength: content.length
              });
            }
          }
        } catch (error) {
          console.error(`Wikipedia API 크롤링 실패: ${url}`, error);
        }
      }
      
    } catch (error) {
      console.error('공개 API 크롤링 실패:', error);
    }
    
    return documents;
  }
  
  /**
   * 방법 2: 정적 데이터 활용
   */
  async getStaticMetaData(): Promise<AlternativeDocument[]> {
    return [
      {
        title: 'Facebook 광고 정책 가이드',
        content: `Facebook 광고 정책

1. 금지된 콘텐츠
- 성인 콘텐츠
- 폭력적 콘텐츠
- 불법 상품
- 허위 정보

2. 제한된 콘텐츠
- 알코올
- 담배
- 건강 관련 제품
- 정치적 광고

3. 승인 요구사항
- 모든 광고는 Facebook의 승인을 받아야 합니다
- 정책 위반 시 계정이 제한될 수 있습니다

4. 광고 품질
- 관련성 높은 콘텐츠
- 명확한 호출 행동
- 적절한 타겟팅

이 가이드는 Facebook 광고 정책의 핵심 내용을 요약한 것입니다.`,
        url: 'https://www.facebook.com/policies/ads/',
        type: 'policy',
        lastUpdated: new Date().toISOString(),
        contentLength: 500
      },
      {
        title: 'Instagram 비즈니스 도움말',
        content: `Instagram 비즈니스 계정 관리

1. 비즈니스 계정 설정
- 프로필을 비즈니스 계정으로 전환
- 연락처 정보 추가
- 웹사이트 링크 설정

2. 콘텐츠 전략
- 일관된 브랜드 이미지
- 고품질 사진 및 비디오
- 해시태그 활용

3. 인사이트 활용
- 팔로워 분석
- 게시물 성과 확인
- 최적 게시 시간 파악

4. 광고 관리
- Instagram 광고 생성
- 타겟 오디언스 설정
- 예산 및 입찰 관리

5. 고객 상호작용
- 댓글 및 DM 응답
- 스토리 활용
- 라이브 방송

이 가이드는 Instagram 비즈니스 계정 운영의 기본 사항을 다룹니다.`,
        url: 'https://business.instagram.com/help/',
        type: 'help',
        lastUpdated: new Date().toISOString(),
        contentLength: 600
      }
    ];
  }
  
  /**
   * 방법 3: RSS 피드 활용
   */
  async crawlRSSFeeds(): Promise<AlternativeDocument[]> {
    const documents: AlternativeDocument[] = [];
    
    try {
      // Meta 공식 블로그 RSS (예시)
      const rssUrls = [
        'https://about.fb.com/news/rss/',
        'https://developers.facebook.com/blog/rss/'
      ];
      
      for (const rssUrl of rssUrls) {
        try {
          const response = await fetch(rssUrl);
          if (response.ok) {
            const xml = await response.text();
            const items = this.parseRSSFeed(xml);
            
            for (const item of items) {
              documents.push({
                title: item.title,
                content: item.description,
                url: item.link,
                type: 'guide',
                lastUpdated: item.pubDate,
                contentLength: item.description.length
              });
            }
          }
        } catch (error) {
          console.error(`RSS 피드 크롤링 실패: ${rssUrl}`, error);
        }
      }
      
    } catch (error) {
      console.error('RSS 피드 크롤링 실패:', error);
    }
    
    return documents;
  }
  
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
  
  private parseRSSFeed(xml: string): Array<{title: string, description: string, link: string, pubDate: string}> {
    const items: Array<{title: string, description: string, link: string, pubDate: string}> = [];
    
    try {
      // 간단한 RSS 파싱 (실제로는 더 정교한 파서 필요)
      const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi);
      
      if (itemMatches) {
        for (const item of itemMatches) {
          const titleMatch = item.match(/<title[^>]*>([^<]+)<\/title>/i);
          const descMatch = item.match(/<description[^>]*>([^<]+)<\/description>/i);
          const linkMatch = item.match(/<link[^>]*>([^<]+)<\/link>/i);
          const dateMatch = item.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i);
          
          if (titleMatch && descMatch && linkMatch) {
            items.push({
              title: titleMatch[1].trim(),
              description: descMatch[1].trim(),
              link: linkMatch[1].trim(),
              pubDate: dateMatch ? dateMatch[1].trim() : new Date().toISOString()
            });
          }
        }
      }
    } catch (error) {
      console.error('RSS 파싱 오류:', error);
    }
    
    return items;
  }
}

export const alternativeCrawlingService = new AlternativeCrawlingService();

