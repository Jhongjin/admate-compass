/**
 * Vercel 서버리스 환경에 최적화된 문서 처리 서비스
 * PDF, DOCX, TXT 파일을 처리하여 텍스트를 추출합니다.
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
   * PDF 파일 처리 (서버리스 환경용)
   */
  async processPdfFile(buffer: Buffer, filename: string): Promise<ProcessedDocument> {
    try {
      console.log(`PDF 파일 처리 시작: ${filename} (${buffer.length} bytes)`);
      
      // 서버리스 환경에서는 PDF 텍스트 추출이 제한적이므로
      // 기본적인 메타데이터와 함께 파일 정보를 저장
      const content = `PDF 파일: ${filename}\n\n파일 크기: ${this.formatFileSize(buffer.length)}\n업로드 시간: ${new Date().toLocaleString('ko-KR')}\n\n이 PDF 파일은 서버리스 환경에서 텍스트 추출이 제한됩니다. 관리자에게 문의하여 수동으로 텍스트를 추출해주세요.`;
      
      return {
        content: this.cleanText(content),
        metadata: {
          title: this.extractTitleFromFilename(filename),
          type: 'pdf',
          size: buffer.length,
          pages: 1, // 서버리스 환경에서는 페이지 수를 정확히 알 수 없음
          extractedAt: new Date().toISOString(),
          source: filename,
        }
      };
    } catch (error) {
      console.error(`PDF 처리 실패: ${filename}`, error);
      
      // 오류 발생 시 기본 메시지 반환
      const content = `PDF 파일: ${filename}\n\nPDF 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`;
      
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
  }

  /**
   * 파일 크기 포맷팅
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
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
    throw new Error(`URL crawling is not available in the serverless document processing path: ${this.extractTitleFromUrl(url || title || '')}`);
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
