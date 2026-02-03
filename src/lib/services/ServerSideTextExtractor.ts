/**
 * 서버사이드 텍스트 추출 서비스
 * PDF, DOCX 등 복잡한 파일 형식을 서버에서 안전하게 처리
 */

import { processTextEncoding, TextEncodingResult } from '@/lib/utils/textEncoding';

export interface ExtractionResult {
  success: boolean;
  content: string;
  metadata: {
    fileName: string;
    fileSize: number;
    fileType: string;
    extractedAt: string;
    encoding: string;
    hasIssues: boolean;
    issues: string[];
  };
  quality: {
    score: number;
    recommendations: string[];
  };
}

export class ServerSideTextExtractor {
  private static instance: ServerSideTextExtractor;

  private constructor() {}

  public static getInstance(): ServerSideTextExtractor {
    if (!ServerSideTextExtractor.instance) {
      ServerSideTextExtractor.instance = new ServerSideTextExtractor();
    }
    return ServerSideTextExtractor.instance;
  }

  /**
   * PDF 파일에서 텍스트 추출
   */
  async extractFromPDF(fileBuffer: Buffer, fileName: string): Promise<ExtractionResult> {
    try {
      // TODO: pdf-parse 라이브러리 사용
      // const pdfParse = require('pdf-parse');
      // const pdfData = await pdfParse(fileBuffer);
      
      // 현재는 플레이스홀더 반환
      const placeholderContent = `PDF 파일: ${fileName}
      
이 PDF 파일은 업로드되었지만 서버사이드 PDF 처리 라이브러리가 설치되지 않았습니다.

설치 방법:
npm install pdf-parse
npm install @types/pdf-parse

그 후 이 서비스를 업데이트하여 실제 PDF 텍스트 추출을 활성화하세요.`;

      const encodingResult = processTextEncoding(placeholderContent, { strictMode: true });
      
      return {
        success: false, // 실제 추출이 아니므로 false
        content: encodingResult.cleanedText,
        metadata: {
          fileName,
          fileSize: fileBuffer.length,
          fileType: 'application/pdf',
          extractedAt: new Date().toISOString(),
          encoding: encodingResult.encoding,
          hasIssues: encodingResult.hasIssues,
          issues: [...encodingResult.issues, 'PDF processing not implemented']
        },
        quality: {
          score: 0,
          recommendations: ['PDF 처리 라이브러리 설치 필요']
        }
      };
    } catch (error) {
      return this.createErrorResult(fileName, 'PDF', error);
    }
  }

  /**
   * DOCX 파일에서 텍스트 추출
   */
  async extractFromDOCX(fileBuffer: Buffer, fileName: string): Promise<ExtractionResult> {
    try {
      // TODO: mammoth 라이브러리 사용
      // const mammoth = require('mammoth');
      // const result = await mammoth.extractRawText({ buffer: fileBuffer });
      
      // 현재는 플레이스홀더 반환
      const placeholderContent = `DOCX 파일: ${fileName}
      
이 DOCX 파일은 업로드되었지만 서버사이드 DOCX 처리 라이브러리가 설치되지 않았습니다.

설치 방법:
npm install mammoth

그 후 이 서비스를 업데이트하여 실제 DOCX 텍스트 추출을 활성화하세요.`;

      const encodingResult = processTextEncoding(placeholderContent, { strictMode: true });
      
      return {
        success: false, // 실제 추출이 아니므로 false
        content: encodingResult.cleanedText,
        metadata: {
          fileName,
          fileSize: fileBuffer.length,
          fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          extractedAt: new Date().toISOString(),
          encoding: encodingResult.encoding,
          hasIssues: encodingResult.hasIssues,
          issues: [...encodingResult.issues, 'DOCX processing not implemented']
        },
        quality: {
          score: 0,
          recommendations: ['DOCX 처리 라이브러리 설치 필요']
        }
      };
    } catch (error) {
      return this.createErrorResult(fileName, 'DOCX', error);
    }
  }

  /**
   * TXT 파일에서 텍스트 추출
   */
  async extractFromTXT(fileBuffer: Buffer, fileName: string): Promise<ExtractionResult> {
    try {
      // 다양한 인코딩 시도
      const encodings: BufferEncoding[] = ['utf-8', 'latin1'];
      let bestResult: TextEncodingResult | null = null;
      let bestScore = 0;

      for (const encoding of encodings) {
        try {
          const text = fileBuffer.toString(encoding);
          const result = processTextEncoding(text, { strictMode: true });
          
          // 한글 비율로 최적 인코딩 선택
          const koreanChars = (text.match(/[\uAC00-\uD7AF]/g) || []).length;
          const totalChars = text.length;
          const koreanRatio = totalChars > 0 ? koreanChars / totalChars : 0;
          
          if (koreanRatio > bestScore) {
            bestScore = koreanRatio;
            bestResult = result;
          }
        } catch (error) {
          // 인코딩 실패 시 다음 시도
          continue;
        }
      }

      if (!bestResult) {
        throw new Error('모든 인코딩 시도 실패');
      }

      return {
        success: true,
        content: bestResult.cleanedText,
        metadata: {
          fileName,
          fileSize: fileBuffer.length,
          fileType: 'text/plain',
          extractedAt: new Date().toISOString(),
          encoding: bestResult.encoding,
          hasIssues: bestResult.hasIssues,
          issues: bestResult.issues
        },
        quality: {
          score: bestScore * 100,
          recommendations: bestResult.hasIssues ? ['텍스트 정리 필요'] : []
        }
      };
    } catch (error) {
      return this.createErrorResult(fileName, 'TXT', error);
    }
  }

  /**
   * URL에서 텍스트 추출 (Puppeteer 사용)
   */
  async extractFromURL(url: string): Promise<ExtractionResult> {
    try {
      // PuppeteerCrawlingService 사용
      const { PuppeteerCrawlingService } = await import('./PuppeteerCrawlingService');
      const crawler = new PuppeteerCrawlingService();
      
      const result = await crawler.crawlMetaPage(url);
      
      if (!result || !result.content) {
        throw new Error('URL 크롤링 실패');
      }

      const encodingResult = processTextEncoding(result.content, { strictMode: true });
      
      return {
        success: true,
        content: encodingResult.cleanedText,
        metadata: {
          fileName: result.title || url,
          fileSize: result.content.length,
          fileType: 'text/html',
          extractedAt: new Date().toISOString(),
          encoding: encodingResult.encoding,
          hasIssues: encodingResult.hasIssues,
          issues: encodingResult.issues
        },
        quality: {
          score: encodingResult.hasIssues ? 70 : 90,
          recommendations: encodingResult.hasIssues ? ['텍스트 정리 필요'] : []
        }
      };
    } catch (error) {
      return this.createErrorResult(url, 'URL', error);
    }
  }

  /**
   * 파일 타입에 따라 적절한 추출 방법 선택
   */
  async extractText(
    fileBuffer: Buffer,
    fileName: string,
    fileType?: string
  ): Promise<ExtractionResult> {
    const extension = fileName.toLowerCase().split('.').pop();
    
    switch (extension) {
      case 'pdf':
        return this.extractFromPDF(fileBuffer, fileName);
      case 'docx':
        return this.extractFromDOCX(fileBuffer, fileName);
      case 'txt':
        return this.extractFromTXT(fileBuffer, fileName);
      default:
        // 기본적으로 텍스트로 처리 시도
        return this.extractFromTXT(fileBuffer, fileName);
    }
  }

  /**
   * 오류 결과 생성
   */
  private createErrorResult(
    fileName: string,
    fileType: string,
    error: unknown
  ): ExtractionResult {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
    
    return {
      success: false,
      content: `[파일 처리 오류: ${fileName}] - ${errorMessage}`,
      metadata: {
        fileName,
        fileSize: 0,
        fileType,
        extractedAt: new Date().toISOString(),
        encoding: 'error',
        hasIssues: true,
        issues: [`extraction error: ${errorMessage}`]
      },
      quality: {
        score: 0,
        recommendations: ['파일 처리 오류 해결 필요']
      }
    };
  }
}

// 싱글톤 인스턴스 내보내기
export const serverSideTextExtractor = ServerSideTextExtractor.getInstance();
