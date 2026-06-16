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
    chunkingStrategy?: string;
    contentLength?: number;
    originalLength?: number;
    signalScore?: number;
    sourceTitle?: string;
    sourceUrl?: string;
    sourceChunkId?: string;
    sourceRowId?: string | number | null;
    sourceCorpus?: string;
    pageNumber?: number;
    chunkType?: 'text' | 'table' | 'image' | 'title';
  };
}

const POLICY_CHUNKING_STRATEGY = 'policy-recursive-v2';
const URL_POLICY_CHUNKING_STRATEGY = 'url-policy-recursive-v2';

export class TextChunkingService {
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor(options: ChunkingOptions = {}) {
    const {
      chunkSize = 1000,
      chunkOverlap = 200,
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
      const normalizedText = this.normalizeTextForChunking(text);
      const enrichedMetadata = this.enrichChunkMetadata(metadata, POLICY_CHUNKING_STRATEGY, text.length);

      // LangChain을 사용한 청킹
      const documents = await this.textSplitter.createDocuments([normalizedText], [enrichedMetadata]);
      
      const chunks = this.createChunksWithOffsets(normalizedText, documents);

      // 청크 타입 분류
      const classifiedChunks = this.classifyChunkTypes(chunks);

      return {
        chunks: classifiedChunks,
        metadata: {
          totalChunks: chunks.length,
          averageChunkSize: chunks.length > 0
            ? Math.round(chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunks.length)
            : 0,
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
      const normalizedText = this.normalizeTextForChunking(text);
      const enrichedMetadata = this.enrichChunkMetadata(metadata, metadata.chunkingStrategy || POLICY_CHUNKING_STRATEGY, text.length);

      // 한국어 문장 구분자 추가
      const koreanSeparators = [
        '\n\n', // 문단 구분
        '\n',   // 줄 구분
        '다. ',  // 한국어 서술문
        '요. ',  // 한국어 구어체
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

      const documents = await koreanSplitter.createDocuments([normalizedText], [enrichedMetadata]);
      
      const chunks = this.createChunksWithOffsets(normalizedText, documents);

      const classifiedChunks = this.classifyChunkTypes(chunks);

      return {
        chunks: classifiedChunks,
        metadata: {
          totalChunks: chunks.length,
          averageChunkSize: chunks.length > 0
            ? Math.round(chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) / chunks.length)
            : 0,
          originalLength: text.length
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
        return this.chunkKoreanText(text, {
          ...metadata,
          chunkingStrategy: URL_POLICY_CHUNKING_STRATEGY
        });
      default:
        return this.chunkText(text, metadata);
    }
  }

  private enrichChunkMetadata(
    metadata: Record<string, any>,
    chunkingStrategy: string,
    originalLength: number
  ): Record<string, any> {
    return {
      ...metadata,
      chunkingStrategy,
      originalLength,
      sourceTitle: metadata.sourceTitle || metadata.title,
      sourceUrl: metadata.sourceUrl || metadata.url || metadata.source_url || metadata.document_url
    };
  }

  private createChunksWithOffsets(
    sourceText: string,
    documents: Array<{ pageContent: string; metadata: Record<string, any> }>
  ): DocumentChunk[] {
    const offsets = this.calculateChunkOffsets(sourceText, documents.map((doc) => doc.pageContent));

    return documents.map((doc, index) => ({
      content: doc.pageContent,
      metadata: {
        ...doc.metadata,
        chunkIndex: index,
        startChar: offsets[index].startChar,
        endChar: offsets[index].endChar,
        contentLength: doc.pageContent.length,
        signalScore: this.calculateSignalScore(doc.pageContent)
      }
    }));
  }

  private calculateChunkOffsets(
    sourceText: string,
    chunkTexts: string[]
  ): Array<{ startChar: number; endChar: number }> {
    let previousStartChar = -1;

    return chunkTexts.map((chunkText, index) => {
      if (!chunkText) {
        throw new Error(`청크 ${index}의 내용이 비어 있어 offset을 계산할 수 없습니다`);
      }

      const searchStart = Math.max(0, previousStartChar + 1);
      const startChar = sourceText.indexOf(chunkText, searchStart);

      if (startChar < 0) {
        throw new Error(`청크 ${index}의 내용을 normalized source text에서 찾을 수 없습니다`);
      }

      const endChar = startChar + chunkText.length;
      const sourceSlice = sourceText.slice(startChar, endChar);

      if (
        startChar < 0 ||
        endChar <= startChar ||
        endChar > sourceText.length ||
        sourceSlice !== chunkText
      ) {
        throw new Error(`청크 ${index}의 offset 계약 검증에 실패했습니다`);
      }

      previousStartChar = startChar;

      return {
        startChar,
        endChar
      };
    });
  }

  private normalizeTextForChunking(text: string): string {
    const normalizedLines = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !this.isLikelyBoilerplateLine(line))
      .join('\n');

    return normalizedLines
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private isLikelyBoilerplateLine(line: string): boolean {
    const normalized = line.toLowerCase();
    const exactBoilerplate = new Set([
      'login',
      'sign up',
      'menu',
      'close',
      'search',
      '로그인',
      '회원가입',
      '메뉴',
      '닫기',
      '검색'
    ]);

    if (exactBoilerplate.has(normalized)) return true;
    if (/^(\|?\s*){6,}$/.test(line)) return true;
    if (/^[-_=*]{6,}$/.test(line)) return true;

    return false;
  }

  private calculateSignalScore(content: string): number {
    const normalized = content.toLowerCase();
    const policyTerms = [
      '광고', '정책', '심사', '승인', '반려', '집행', '소재', '제한', '금지',
      'meta', 'facebook', 'instagram', 'kakao', 'naver', 'google', 'youtube'
    ];
    const boilerplateTerms = ['cookie', 'privacy settings', '로그인', '회원가입', '메뉴', '__next_data__'];
    const lengthScore = Math.min(content.trim().length / 800, 1);
    const policyScore = policyTerms.filter((term) => normalized.includes(term)).length / 5;
    const boilerplatePenalty = boilerplateTerms.filter((term) => normalized.includes(term)).length * 0.15;
    const hangulRatio = (content.match(/[\u3131-\u3163\uac00-\ud7a3]/g)?.length || 0) / Math.max(content.length, 1);
    const languageScore = Math.min(hangulRatio * 2, 0.3);

    return Math.max(0, Math.min(1, lengthScore * 0.45 + policyScore * 0.4 + languageScore - boilerplatePenalty));
  }
}

// 싱글톤 인스턴스
export const textChunkingService = new TextChunkingService();

