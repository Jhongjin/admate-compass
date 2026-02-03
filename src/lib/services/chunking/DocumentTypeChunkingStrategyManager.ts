/**
 * 문서 타입별 청킹 전략 관리자
 * 각 문서 타입에 최적화된 청킹 전략을 선택하고 실행
 * 
 * 사용법:
 * 1. 새로운 문서 타입 전략 추가 시 이 파일에 전략을 등록
 * 2. 각 문서 타입별 전략은 독립적으로 관리되므로 새로운 타입 추가 시 기존 로직에 영향 없음
 */

import type { DocumentTypeChunkingStrategy, ChunkingResult } from './DocumentTypeChunkingStrategy';
import { PDFChunkingStrategy } from './strategies/PDFChunkingStrategy';
import { DOCXChunkingStrategy } from './strategies/DOCXChunkingStrategy';
import { TXTChunkingStrategy } from './strategies/TXTChunkingStrategy';
import { URLChunkingStrategy } from './strategies/URLChunkingStrategy';

export class DocumentTypeChunkingStrategyManager {
  private strategies: DocumentTypeChunkingStrategy[] = [];

  constructor() {
    // 문서 타입별 전략 등록
    this.strategies.push(new PDFChunkingStrategy());
    this.strategies.push(new DOCXChunkingStrategy());
    this.strategies.push(new TXTChunkingStrategy());
    this.strategies.push(new URLChunkingStrategy());
  }

  /**
   * 문서 타입에 적합한 전략을 찾아 청킹 실행
   * @param content 콘텐츠
   * @param documentId 문서 ID
   * @param documentTitle 문서 제목
   * @param documentType 문서 타입
   * @param options 추가 옵션
   * @returns 청킹 결과
   */
  async chunkDocument(
    content: string,
    documentId: string,
    documentTitle: string,
    documentType: string,
    options?: {
      contentType?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<ChunkingResult> {
    // 등록된 전략을 순서대로 확인하여 적용 가능한 첫 번째 전략 사용
    for (const strategy of this.strategies) {
      if (strategy.canHandle(documentType, content)) {
        console.log(`📌 [ChunkingStrategy] ${strategy.getDocumentType()} 전략 적용: ${documentType}`);
        try {
          const result = await strategy.chunk(content, documentId, documentTitle, options);
          return result;
        } catch (error) {
          console.error(`❌ [ChunkingStrategy] ${strategy.getDocumentType()} 전략 실행 오류:`, error);
          // 오류 발생 시 다음 전략으로 fallback
          continue;
        }
      }
    }

    // 모든 전략이 실패한 경우 기본 전략 사용 (TXT 전략)
    console.warn(`⚠️ [ChunkingStrategy] 적용 가능한 전략을 찾을 수 없음, 기본 전략 사용: ${documentType}`);
    const defaultStrategy = new TXTChunkingStrategy();
    return await defaultStrategy.chunk(content, documentId, documentTitle, options);
  }

  /**
   * 새로운 전략 등록 (런타임에 동적으로 추가 가능)
   * @param strategy 청킹 전략
   * @param priority 우선순위 (낮을수록 먼저 적용, 기본값: strategies.length)
   */
  registerStrategy(strategy: DocumentTypeChunkingStrategy, priority?: number): void {
    if (priority !== undefined) {
      this.strategies.splice(priority, 0, strategy);
    } else {
      this.strategies.push(strategy);
    }
    console.log(`✅ [ChunkingStrategy] ${strategy.getDocumentType()} 전략 등록됨`);
  }
}

// 싱글톤 인스턴스 (전역에서 공유)
export const documentTypeChunkingStrategyManager = new DocumentTypeChunkingStrategyManager();

