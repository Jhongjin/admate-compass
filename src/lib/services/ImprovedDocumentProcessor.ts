/**
 * 개선된 문서 처리 서비스
 * 원본 데이터 무결성을 보장하는 통합된 문서 처리
 * 
 * @deprecated 이 서비스는 현재 사용되지 않습니다.
 * 대신 다음 서비스를 사용하세요:
 * - 통합 청킹: unifiedChunkingService
 * - 문서 처리: RAGProcessor
 * - URL 크롤링: NewDocumentProcessor
 * 
 * 향후 필요시 재활성화할 수 있도록 보관 중입니다.
 */

import { processTextEncoding, TextEncodingResult } from '@/lib/utils/textEncoding';
import { serverSideTextExtractor, ExtractionResult } from './ServerSideTextExtractor';

export interface ProcessedDocument {
  id: string;
  title: string;
  content: string;
  type: 'file' | 'url';
  status: 'success' | 'partial' | 'failed';
  metadata: {
    originalFileName?: string;
    fileSize?: number;
    fileType?: string;
    url?: string;
    extractedAt: string;
    encoding: string;
    hasIssues: boolean;
    issues: string[];
    quality: {
      score: number;
      recommendations: string[];
    };
  };
  chunks: Array<{
    content: string;
    metadata: Record<string, any>;
  }>;
}

export class ImprovedDocumentProcessor {
  private supabase: any;

  constructor() {
    // Supabase 클라이언트 초기화는 필요시에만
  }

  /**
   * 파일을 안전하게 처리
   */
  async processFile(file: File): Promise<ProcessedDocument> {
    const documentId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`📄 파일 처리 시작: ${file.name}`);
      
      // 1. 파일을 ArrayBuffer로 변환
      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);
      
      // 2. 서버사이드 텍스트 추출
      const extractionResult = await serverSideTextExtractor.extractText(
        fileBuffer,
        file.name,
        file.type
      );
      
      // 3. 제목 정리
      const titleResult = processTextEncoding(file.name, { strictMode: true });
      
      // 4. 청킹 처리
      const chunks = await this.createChunks(extractionResult.content, {
        documentId,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size
      });
      
      // 5. 결과 반환
      const processedDocument: ProcessedDocument = {
        id: documentId,
        title: titleResult.cleanedText,
        content: extractionResult.content,
        type: 'file',
        status: extractionResult.success ? 'success' : 'partial',
        metadata: {
          originalFileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          extractedAt: extractionResult.metadata.extractedAt,
          encoding: extractionResult.metadata.encoding,
          hasIssues: extractionResult.metadata.hasIssues,
          issues: extractionResult.metadata.issues,
          quality: extractionResult.quality
        },
        chunks
      };
      
      console.log(`✅ 파일 처리 완료: ${file.name} (${chunks.length}개 청크)`);
      return processedDocument;
      
    } catch (error) {
      console.error(`❌ 파일 처리 실패: ${file.name}`, error);
      
      return {
        id: documentId,
        title: file.name,
        content: `[파일 처리 오류: ${file.name}]`,
        type: 'file',
        status: 'failed',
        metadata: {
          originalFileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          extractedAt: new Date().toISOString(),
          encoding: 'error',
          hasIssues: true,
          issues: [`processing error: ${error instanceof Error ? error.message : 'unknown'}`],
          quality: {
            score: 0,
            recommendations: ['파일 처리 오류 해결 필요']
          }
        },
        chunks: []
      };
    }
  }

  /**
   * URL을 안전하게 처리
   */
  async processUrl(url: string): Promise<ProcessedDocument> {
    const documentId = `url_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`🌐 URL 처리 시작: ${url}`);
      
      // 1. URL에서 텍스트 추출
      const extractionResult = await serverSideTextExtractor.extractFromURL(url);
      
      // 2. 제목 정리
      const titleResult = processTextEncoding(extractionResult.metadata.fileName, { strictMode: true });
      
      // 3. 청킹 처리
      const chunks = await this.createChunks(extractionResult.content, {
        documentId,
        url,
        extractedAt: extractionResult.metadata.extractedAt
      });
      
      // 4. 결과 반환
      const processedDocument: ProcessedDocument = {
        id: documentId,
        title: titleResult.cleanedText,
        content: extractionResult.content,
        type: 'url',
        status: extractionResult.success ? 'success' : 'partial',
        metadata: {
          url,
          extractedAt: extractionResult.metadata.extractedAt,
          encoding: extractionResult.metadata.encoding,
          hasIssues: extractionResult.metadata.hasIssues,
          issues: extractionResult.metadata.issues,
          quality: extractionResult.quality
        },
        chunks
      };
      
      console.log(`✅ URL 처리 완료: ${url} (${chunks.length}개 청크)`);
      return processedDocument;
      
    } catch (error) {
      console.error(`❌ URL 처리 실패: ${url}`, error);
      
      return {
        id: documentId,
        title: url,
        content: `[URL 처리 오류: ${url}]`,
        type: 'url',
        status: 'failed',
        metadata: {
          url,
          extractedAt: new Date().toISOString(),
          encoding: 'error',
          hasIssues: true,
          issues: [`processing error: ${error instanceof Error ? error.message : 'unknown'}`],
          quality: {
            score: 0,
            recommendations: ['URL 처리 오류 해결 필요']
          }
        },
        chunks: []
      };
    }
  }

  /**
   * 텍스트를 청크로 분할
   */
  private async createChunks(
    content: string,
    metadata: Record<string, any>
  ): Promise<Array<{ content: string; metadata: Record<string, any> }>> {
    try {
      // 한국어 특화 청킹 (표준화)
      const chunkSize = 800; // 표준 청크 크기 (800자)
      const chunkOverlap = 100; // 표준 겹침 크기 (100자)
      
      const chunks: Array<{ content: string; metadata: Record<string, any> }> = [];
      let startIndex = 0;
      let chunkIndex = 0;
      
      while (startIndex < content.length) {
        const endIndex = Math.min(startIndex + chunkSize, content.length);
        let chunkContent = content.substring(startIndex, endIndex);
        
        // 문장 경계에서 자르기 시도
        if (endIndex < content.length) {
          const lastSentenceEnd = Math.max(
            chunkContent.lastIndexOf('.'),
            chunkContent.lastIndexOf('!'),
            chunkContent.lastIndexOf('?'),
            chunkContent.lastIndexOf('\n')
          );
          
          if (lastSentenceEnd > chunkSize * 0.5) {
            chunkContent = chunkContent.substring(0, lastSentenceEnd + 1);
          }
        }
        
        // 청크 내용 정리
        const chunkResult = processTextEncoding(chunkContent, { strictMode: true });
        
        chunks.push({
          content: chunkResult.cleanedText,
          metadata: {
            ...metadata,
            chunkIndex,
            startChar: startIndex,
            endChar: startIndex + chunkContent.length,
            hasIssues: chunkResult.hasIssues,
            issues: chunkResult.issues
          }
        });
        
        startIndex += chunkContent.length - chunkOverlap;
        chunkIndex++;
      }
      
      return chunks;
    } catch (error) {
      console.error('❌ 청킹 처리 실패:', error);
      return [{
        content: content.substring(0, 1000),
        metadata: {
          ...metadata,
          chunkIndex: 0,
          hasIssues: true,
          issues: [`chunking error: ${error instanceof Error ? error.message : 'unknown'}`]
        }
      }];
    }
  }

  /**
   * 데이터베이스에 저장
   */
  async saveToDatabase(document: ProcessedDocument): Promise<boolean> {
    try {
      // TODO: Supabase에 저장하는 로직 구현
      console.log(`💾 데이터베이스 저장: ${document.title}`);
      
      // 1. documents 테이블에 저장
      // 2. document_chunks 테이블에 청크 저장
      // 3. 임베딩 생성 및 저장
      
      return true;
    } catch (error) {
      console.error('❌ 데이터베이스 저장 실패:', error);
      return false;
    }
  }

  /**
   * 처리 결과 검증
   */
  validateProcessingResult(document: ProcessedDocument): {
    isValid: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // 기본 검증
    if (document.status === 'failed') {
      issues.push('문서 처리 실패');
      recommendations.push('파일 형식이나 URL을 확인하세요');
    }
    
    if (document.content.length === 0) {
      issues.push('내용이 비어있음');
      recommendations.push('파일이 손상되었거나 비어있을 수 있습니다');
    }
    
    if (document.chunks.length === 0) {
      issues.push('청크가 생성되지 않음');
      recommendations.push('텍스트가 너무 짧거나 처리에 실패했습니다');
    }
    
    // 품질 검증
    if (document.metadata.hasIssues) {
      issues.push('인코딩 문제 감지');
      recommendations.push('텍스트 인코딩을 확인하세요');
    }
    
    if (document.metadata.quality.score < 50) {
      issues.push('텍스트 품질이 낮음');
      recommendations.push(...document.metadata.quality.recommendations);
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      recommendations
    };
  }
}

// 싱글톤 인스턴스
export const improvedDocumentProcessor = new ImprovedDocumentProcessor();
