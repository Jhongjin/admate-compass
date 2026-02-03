/**
 * Vercel 서버리스 환경에 최적화된 문서 처리 서비스
 * 무거운 패키지 없이 기본적인 텍스트 처리만 수행
 */

export interface ProcessedDocument {
  content: string;
  metadata: {
    title: string;
    type: 'pdf' | 'docx' | 'txt' | 'url';
    size: number;
    pages?: number;
    extractedAt: string;
    source: string;
  };
}

export class DocumentProcessingService {
  /**
   * 텍스트 파일 처리
   */
  async processTextFile(buffer: Buffer, filename: string): Promise<ProcessedDocument> {
    const content = buffer.toString('utf-8');
    const cleanedContent = this.cleanText(content);
    
    return {
      content: cleanedContent,
      metadata: {
        title: this.extractTitleFromFilename(filename),
        type: 'txt',
        size: cleanedContent.length,
        extractedAt: new Date().toISOString(),
        source: filename,
      }
    };
  }

  /**
   * PDF 파일 처리 (기본적인 텍스트만)
   */
  async processPdfFile(buffer: Buffer, filename: string): Promise<ProcessedDocument> {
    // PDF 처리는 서버리스 환경에서 제한적이므로 기본 메시지만 반환
    const content = `PDF 파일: ${filename}\n\n이 PDF 파일은 서버리스 환경에서 처리할 수 없습니다. 관리자에게 문의하세요.`;
    
    return {
      content,
      metadata: {
        title: this.extractTitleFromFilename(filename),
        type: 'pdf',
        size: buffer.length,
        pages: 1,
        extractedAt: new Date().toISOString(),
        source: filename,
      }
    };
  }

  /**
   * DOCX 파일 처리 (기본적인 텍스트만)
   */
  async processDocxFile(buffer: Buffer, filename: string): Promise<ProcessedDocument> {
    // DOCX 처리는 서버리스 환경에서 제한적이므로 기본 메시지만 반환
    const content = `DOCX 파일: ${filename}\n\n이 DOCX 파일은 서버리스 환경에서 처리할 수 없습니다. 관리자에게 문의하세요.`;
    
    return {
      content,
      metadata: {
        title: this.extractTitleFromFilename(filename),
        type: 'docx',
        size: buffer.length,
        pages: 1,
        extractedAt: new Date().toISOString(),
        source: filename,
      }
    };
  }

  /**
   * URL 처리
   */
  async processUrl(url: string, title?: string): Promise<ProcessedDocument> {
    const content = `URL: ${url}\n\n이 URL은 서버리스 환경에서 크롤링할 수 없습니다. 관리자에게 문의하세요.`;
    
    return {
      content,
      metadata: {
        title: title || this.extractTitleFromUrl(url),
        type: 'url',
        size: url.length,
        extractedAt: new Date().toISOString(),
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
   * 파일명에서 제목 추출
   */
  private extractTitleFromFilename(filename: string): string {
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    return nameWithoutExt || 'Untitled Document';
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

export const documentProcessingService = new DocumentProcessingService();