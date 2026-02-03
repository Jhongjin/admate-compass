/**
 * Vercel 서버리스 환경에 최적화된 간단한 문서 처리 서비스
 * 무거운 패키지 없이 기본적인 텍스트 처리만 수행
 */

export interface ProcessedDocument {
  id: string;
  title: string;
  content: string;
  type: 'text' | 'url';
  metadata: {
    size: number;
    processedAt: string;
    source?: string;
  };
}

export class SimpleDocumentProcessingService {
  /**
   * 텍스트 문서 처리 (기본적인 정리만)
   */
  async processTextDocument(content: string, title: string): Promise<ProcessedDocument> {
    // 기본적인 텍스트 정리
    const cleanedContent = this.cleanText(content);
    
    return {
      id: `doc_${Date.now()}`,
      title: title || 'Untitled Document',
      content: cleanedContent,
      type: 'text',
      metadata: {
        size: cleanedContent.length,
        processedAt: new Date().toISOString(),
      }
    };
  }

  /**
   * URL 문서 처리 (기본적인 메타데이터만)
   */
  async processUrlDocument(url: string, title?: string): Promise<ProcessedDocument> {
    return {
      id: `url_${Date.now()}`,
      title: title || this.extractTitleFromUrl(url),
      content: `URL: ${url}\n\n이 문서는 URL 형태로 저장되었습니다. 실제 내용은 관리자가 별도로 처리해야 합니다.`,
      type: 'url',
      metadata: {
        size: url.length,
        processedAt: new Date().toISOString(),
        source: url,
      }
    };
  }

  /**
   * 텍스트 정리
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // 여러 공백을 하나로
      .replace(/\n\s*\n/g, '\n\n') // 여러 줄바꿈을 두 개로
      .trim();
  }

  /**
   * URL에서 제목 추출
   */
  private extractTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const segments = pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] || 'Untitled Document';
    } catch {
      return 'Untitled Document';
    }
  }
}

export const simpleDocumentProcessingService = new SimpleDocumentProcessingService();
