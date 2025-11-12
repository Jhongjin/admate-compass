import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
  keepSeparator?: boolean;
}

export interface ChunkedDocument {
  chunks: DocumentChunk[];
  metadata: {
    totalChunks: number;
    averageChunkSize: number;
    originalLength: number;
  };
}

export interface DocumentChunk {
  content: string;
  metadata: {
    chunkIndex: number;
    startChar: number;
    endChar: number;
    pageNumber?: number;
    chunkType?: 'text' | 'table' | 'image' | 'title';
  };
}

export class TextChunkingService {
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor(options: ChunkingOptions = {}) {
    const {
      chunkSize = 800, // 표준 청크 크기 (800자)
      chunkOverlap = 100, // 표준 겹침 크기 (100자)
      separators = [
        '\n\n', // 문단 구분
        '\n',   // 줄 구분
        '. ',   // 문장 구분
        '! ',   // 감탄문 구분
        '? ',   // 의문문 구분
        ' ',    // 단어 구분
        ''      // 문자 구분
      ],
      keepSeparator = true
    } = options;

    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators,
      keepSeparator
    });
  }

  /**
   * 텍스트를 청크로 분할
   */
  async chunkText(
    text: string, 
    metadata: Record<string, any> = {}
  ): Promise<ChunkedDocument> {
    try {
      // LangChain을 사용한 청킹
      const documents = await this.textSplitter.createDocuments([text], [metadata]);
      
      const chunks: DocumentChunk[] = documents.map((doc, index) => ({
        content: doc.pageContent,
        metadata: {
          chunkIndex: index,
          startChar: 0, // LangChain에서는 정확한 위치를 제공하지 않음
          endChar: doc.pageContent.length,
          ...doc.metadata
        }
      }));

      // 청크 타입 분류
      const classifiedChunks = this.classifyChunkTypes(chunks);

      return {
        chunks: classifiedChunks,
        metadata: {
          totalChunks: chunks.length,
          averageChunkSize: Math.round(
            chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunks.length
          ),
          originalLength: text.length
        }
      };
    } catch (error) {
      throw new Error(`텍스트 청킹 중 오류 발생: ${error}`);
    }
  }

  /**
   * 청크 타입을 분류 (텍스트, 테이블, 이미지, 제목)
   */
  private classifyChunkTypes(chunks: DocumentChunk[]): DocumentChunk[] {
    return chunks.map(chunk => {
      const content = chunk.content;
      let chunkType: 'text' | 'table' | 'image' | 'title' = 'text';

      // 테이블 감지
      if (content.includes('|') && content.split('\n').length > 2) {
        chunkType = 'table';
      }
      // 이미지 텍스트 감지
      else if (content.includes('[이미지 텍스트]')) {
        chunkType = 'image';
      }
      // 제목 감지 (짧고 특정 패턴)
      else if (content.length < 100 && (
        content.includes('제') && content.includes('장') ||
        content.includes('Chapter') ||
        content.includes('##') ||
        content.match(/^\d+\.\s/) ||
        content.match(/^[가-힣\s]+$/) && content.length < 50
      )) {
        chunkType = 'title';
      }

      return {
        ...chunk,
        metadata: {
          ...chunk.metadata,
          chunkType
        }
      };
    });
  }

  /**
   * 한국어 특화 청킹 (문장 경계 고려)
   */
  async chunkKoreanText(
    text: string,
    metadata: Record<string, any> = {}
  ): Promise<ChunkedDocument> {
    try {
      // UTF-8 인코딩 보장
      let cleanText = text;
      try {
        cleanText = Buffer.from(text, 'utf-8').toString('utf-8');
      } catch (error) {
        console.warn('⚠️ 텍스트 인코딩 변환 실패, 원본 사용:', error);
        cleanText = text;
      }

      // 한국어 문장 구분자 추가
      const koreanSeparators = [
        '\n\n', // 문단 구분
        '\n',   // 줄 구분
        '. ',   // 마침표
        '! ',   // 감탄부
        '? ',   // 의문부
        '。',   // 일본식 마침표
        '！',   // 일본식 감탄부
        '？',   // 일본식 의문부
        ' ',    // 공백
        ''      // 문자 단위
      ];

      const koreanSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
        separators: koreanSeparators,
        keepSeparator: true
      });

      const documents = await koreanSplitter.createDocuments([cleanText], [metadata]);
      
      const chunks: DocumentChunk[] = documents.map((doc, index) => ({
        content: doc.pageContent,
        metadata: {
          chunkIndex: index,
          startChar: 0,
          endChar: doc.pageContent.length,
          ...doc.metadata
        }
      }));

      const classifiedChunks = this.classifyChunkTypes(chunks);

      return {
        chunks: classifiedChunks,
        metadata: {
          totalChunks: chunks.length,
          averageChunkSize: Math.round(
            chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunks.length
          ),
          originalLength: cleanText.length
        }
      };
    } catch (error) {
      throw new Error(`한국어 텍스트 청킹 중 오류 발생: ${error}`);
    }
  }

  /**
   * 테이블 데이터 특화 청킹
   */
  async chunkTableData(
    tableText: string,
    metadata: Record<string, any> = {}
  ): Promise<ChunkedDocument> {
    try {
      // 테이블은 행 단위로 청킹
      const rows = tableText.split('\n').filter(row => row.trim());
      const chunks: DocumentChunk[] = [];
      
      let currentChunk = '';
      let chunkIndex = 0;
      let startChar = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        
        // 청크 크기 확인
        if (currentChunk.length + row.length > 1000 && currentChunk.length > 0) {
          chunks.push({
            content: currentChunk.trim(),
            metadata: {
              chunkIndex,
              startChar,
              endChar: startChar + currentChunk.length,
              chunkType: 'table' as const,
              ...metadata
            }
          });
          
          startChar += currentChunk.length;
          currentChunk = row + '\n';
          chunkIndex++;
        } else {
          currentChunk += row + '\n';
        }
      }

      // 마지막 청크 추가
      if (currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          metadata: {
            chunkIndex,
            startChar,
            endChar: startChar + currentChunk.length,
            chunkType: 'table' as const,
            ...metadata
          }
        });
      }

      return {
        chunks,
        metadata: {
          totalChunks: chunks.length,
          averageChunkSize: Math.round(
            chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunks.length
          ),
          originalLength: tableText.length
        }
      };
    } catch (error) {
      throw new Error(`테이블 데이터 청킹 중 오류 발생: ${error}`);
    }
  }

  /**
   * 문서 타입에 따라 적절한 청킹 방법 선택
   */
  async chunkDocument(
    text: string,
    documentType: 'pdf' | 'docx' | 'txt' | 'url',
    metadata: Record<string, any> = {}
  ): Promise<ChunkedDocument> {
    switch (documentType) {
      case 'pdf':
      case 'docx':
      case 'txt':
        return this.chunkKoreanText(text, metadata);
      case 'url':
        // URL은 다양한 콘텐츠 타입이 섞여있으므로 일반 청킹 사용
        return this.chunkText(text, metadata);
      default:
        return this.chunkText(text, metadata);
    }
  }
}

// 싱글톤 인스턴스
export const textChunkingService = new TextChunkingService();

