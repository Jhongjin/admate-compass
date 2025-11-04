import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { processTextEncoding } from '../utils/textEncoding';

/**
 * 적응적 청킹 서비스
 * 문서 유형, 크기, 내용에 따라 최적화된 청킹 전략을 제공
 * 서버 사이드에서만 사용 (API 라우트)
 */

export interface AdaptiveChunkingConfig {
  documentType: 'pdf' | 'docx' | 'txt' | 'url';
  contentLength: number;
  language: 'ko' | 'en' | 'mixed';
  contentType?: 'technical' | 'marketing' | 'policy' | 'faq' | 'general';
}

export interface EnhancedChunkMetadata {
  // 기본 정보
  documentId: string;
  documentTitle: string;
  documentType: string;
  chunkIndex: number;
  
  // 구조적 정보
  sectionTitle?: string;
  headingLevel?: number;
  paragraphIndex?: number;
  
  // 의미적 정보
  keywords?: string[];
  entities?: string[];
  topics?: string[];
  
  // 품질 정보
  confidence?: number;
  importance?: number;
  readability?: number;
  
  // 청킹 정보
  chunkType?: 'text' | 'table' | 'image' | 'title' | 'qa' | 'article' | 'section';
  startChar: number;
  endChar: number;
  originalLength: number;
}

export interface AdaptiveChunk {
  id: string;
  content: string;
  metadata: EnhancedChunkMetadata;
}

export interface ChunkingStrategy {
  chunkSize: number;
  chunkOverlap: number;
  separators: string[];
  maxChunks?: number;
  minChunkSize?: number;
}

export class AdaptiveChunkingService {
  /**
   * 문서 유형에 따른 청킹 전략 결정
   */
  getChunkingStrategy(config: AdaptiveChunkingConfig): ChunkingStrategy {
    const { documentType, contentLength, contentType, language } = config;

    // 콘텐츠 유형별 특화 전략
    if (contentType === 'faq') {
      return this.getFAQStrategy(contentLength);
    }
    
    if (contentType === 'policy') {
      return this.getPolicyStrategy(contentLength);
    }
    
    if (contentType === 'marketing') {
      return this.getMarketingStrategy(contentLength);
    }

    // 문서 크기에 따른 기본 전략
    if (contentLength < 1000) {
      return {
        chunkSize: 200,
        chunkOverlap: 20,
        separators: ['\n\n', '\n', '. ', '! ', '? ', ' '],
        maxChunks: 50,
        minChunkSize: 50
      };
    } else if (contentLength < 10000) {
      return {
        chunkSize: 500,
        chunkOverlap: 50,
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' '],
        maxChunks: 100,
        minChunkSize: 100
      };
    } else if (contentLength < 100000) {
      return {
        chunkSize: 1000,
        chunkOverlap: 100,
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' '],
        maxChunks: 200,
        minChunkSize: 200
      };
    } else {
      return {
        chunkSize: 2000,
        chunkOverlap: 200,
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' '],
        maxChunks: 500,
        minChunkSize: 400
      };
    }
  }

  /**
   * FAQ 문서 전용 청킹 전략
   * 질문-답변 쌍을 하나의 청크로 유지
   */
  private getFAQStrategy(contentLength: number): ChunkingStrategy {
    return {
      chunkSize: 800,
      chunkOverlap: 100,
      separators: ['\n\n', '\n', 'Q:', 'A:', '질문:', '답변:', '. ', '! ', '? '],
      maxChunks: Math.ceil(contentLength / 800),
      minChunkSize: 200
    };
  }

  /**
   * 정책 문서 전용 청킹 전략
   * 조항별로 청킹
   */
  private getPolicyStrategy(contentLength: number): ChunkingStrategy {
    return {
      chunkSize: 1200,
      chunkOverlap: 150,
      separators: ['\n\n', '제', '조', '항', '장', '절', '\n', '. ', '! ', '? '],
      maxChunks: Math.ceil(contentLength / 1200),
      minChunkSize: 300
    };
  }

  /**
   * 마케팅 문서 전용 청킹 전략
   * 섹션별로 청킹
   */
  private getMarketingStrategy(contentLength: number): ChunkingStrategy {
    return {
      chunkSize: 1000,
      chunkOverlap: 100,
      separators: ['\n\n', '##', '###', '# ', '\n', '. ', '! ', '? '],
      maxChunks: Math.ceil(contentLength / 1000),
      minChunkSize: 200
    };
  }

  /**
   * 문서 구조 분석 (제목, 섹션, 문단 등)
   */
  private analyzeDocumentStructure(content: string): {
    sections: Array<{ title: string; start: number; end: number; level: number }>;
    paragraphs: number[];
  } {
    const sections: Array<{ title: string; start: number; end: number; level: number }> = [];
    const paragraphs: number[] = [];

    // 제목 패턴 감지 (마크다운, 번호 등)
    const headingPatterns = [
      /^#{1,6}\s+(.+)$/gm, // 마크다운 제목
      /^제\s*\d+\s*장\s*[:\s]*(.+)$/gmi, // 장 제목
      /^제\s*\d+\s*절\s*[:\s]*(.+)$/gmi, // 절 제목
      /^제\s*\d+\s*조\s*[:\s]*(.+)$/gmi, // 조 제목
    ];

    let match;
    for (const pattern of headingPatterns) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        const level = match[0].match(/^#+/)?.[0]?.length || 3;
        sections.push({
          title: match[1]?.trim() || match[0],
          start: match.index,
          end: match.index + match[0].length,
          level
        });
      }
    }

    // 문단 구분 찾기
    const paragraphMatches = content.matchAll(/\n\n+/g);
    for (const match of paragraphMatches) {
      paragraphs.push(match.index || 0);
    }

    return { sections, paragraphs };
  }

  /**
   * 의미 기반 청킹 (문장 경계 우선 고려)
   */
  private chunkBySemanticBoundaries(
    content: string,
    strategy: ChunkingStrategy
  ): string[] {
    const chunks: string[] = [];
    let start = 0;
    let iterationCount = 0;
    const maxIterations = (strategy.maxChunks || 500) * 2;

    while (start < content.length && iterationCount < maxIterations) {
      const end = Math.min(start + strategy.chunkSize, content.length);
      let chunk = content.slice(start, end);

      // 의미적 경계 찾기 (문단 > 문장 > 단어)
      if (end < content.length) {
        // 1순위: 문단 경계
        const lastParagraphEnd = chunk.lastIndexOf('\n\n');
        
        // 2순위: 문장 경계
        const sentenceEndings = ['. ', '! ', '? ', '。', '！', '？'];
        let lastSentenceEnd = -1;
        for (const ending of sentenceEndings) {
          const pos = chunk.lastIndexOf(ending);
          if (pos > lastSentenceEnd) {
            lastSentenceEnd = pos + ending.length - 1;
          }
        }

        // 3순위: 줄 경계
        const lastLineEnd = chunk.lastIndexOf('\n');

        // 우선순위에 따라 자르기
        let cutPoint = -1;
        if (lastParagraphEnd > strategy.chunkSize * 0.3) {
          cutPoint = lastParagraphEnd;
        } else if (lastSentenceEnd > strategy.chunkSize * 0.5) {
          cutPoint = lastSentenceEnd;
        } else if (lastLineEnd > strategy.chunkSize * 0.7) {
          cutPoint = lastLineEnd;
        }

        if (cutPoint > 0) {
          chunk = chunk.slice(0, cutPoint + 1);
        }
      }

      const trimmedChunk = chunk.trim();
      const minSize = strategy.minChunkSize || 50;
      
      if (trimmedChunk.length >= minSize) {
        chunks.push(trimmedChunk);
      }

      // 다음 청크 시작 위치 (overlap 고려)
      const nextStart = start + chunk.length - strategy.chunkOverlap;
      start = Math.max(nextStart, start + 1);

      iterationCount++;

      // 최대 청크 수 제한
      if (chunks.length >= (strategy.maxChunks || 500)) {
        break;
      }
    }

    return chunks;
  }

  /**
   * FAQ 문서 특화 청킹 (질문-답변 쌍 유지)
   */
  private chunkFAQDocument(content: string): string[] {
    const chunks: string[] = [];
    
    // FAQ 패턴 감지
    const qaPatterns = [
      /(?:Q|질문)[:\s]*(.+?)(?:\n\n|\nA|답변|$)/gis,
      /(?:Q|질문)[:\s]*(.+?)(?:A|답변)[:\s]*(.+?)(?=\n\n(?:Q|질문)|$)/gis,
    ];

    let match;
    for (const pattern of qaPatterns) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        const qaPair = match[0].trim();
        if (qaPair.length > 100) { // 최소 길이 보장
          chunks.push(qaPair);
        }
      }
    }

    // 패턴 매칭 실패 시 일반 청킹으로 폴백
    if (chunks.length === 0) {
      return this.chunkBySemanticBoundaries(content, this.getFAQStrategy(content.length));
    }

    return chunks;
  }

  /**
   * 정책 문서 특화 청킹 (조항별)
   */
  private chunkPolicyDocument(content: string): string[] {
    const chunks: string[] = [];
    
    // 조항 패턴 감지
    const articlePattern = /(?:제\s*\d+\s*조|제\s*\d+\s*장|제\s*\d+\s*절)[:\s]*(.+?)(?=(?:제\s*\d+\s*(?:조|장|절))|$)/gis;

    let match;
    while ((match = articlePattern.exec(content)) !== null) {
      const article = match[0].trim();
      if (article.length > 200) {
        chunks.push(article);
      }
    }

    // 패턴 매칭 실패 시 일반 청킹으로 폴백
    if (chunks.length === 0) {
      return this.chunkBySemanticBoundaries(content, this.getPolicyStrategy(content.length));
    }

    return chunks;
  }

  /**
   * 마케팅 문서 특화 청킹 (섹션별)
   */
  private chunkMarketingDocument(content: string): string[] {
    const chunks: string[] = [];
    
    // 섹션 패턴 감지 (마크다운 헤딩)
    const sectionPattern = /(?:^#{1,6}\s+.+$)/gm;
    const sections = content.split(sectionPattern);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i].trim();
      if (section.length > 200) {
        chunks.push(section);
      }
    }

    // 패턴 매칭 실패 시 일반 청킹으로 폴백
    if (chunks.length === 0) {
      return this.chunkBySemanticBoundaries(content, this.getMarketingStrategy(content.length));
    }

    return chunks;
  }

  /**
   * 청크 타입 분류
   */
  private classifyChunkType(content: string): EnhancedChunkMetadata['chunkType'] {
    // FAQ 감지
    if (/^[Qq질문][:\s]/.test(content) || /[Aa답변][:\s]/.test(content)) {
      return 'qa';
    }

    // 제목 감지
    if (content.length < 100 && (
      /^#{1,6}\s/.test(content) ||
      /^제\s*\d+\s*(?:조|장|절)/.test(content) ||
      /^\d+\.\s/.test(content)
    )) {
      return 'title';
    }

    // 테이블 감지
    if (content.includes('|') && content.split('\n').filter(l => l.includes('|')).length > 2) {
      return 'table';
    }

    // 정책 조항 감지
    if (/^제\s*\d+\s*조/.test(content)) {
      return 'article';
    }

    // 섹션 감지
    if (/^#{1,6}\s/.test(content) || content.split('\n\n').length > 3) {
      return 'section';
    }

    return 'text';
  }

  /**
   * 주요 키워드 추출 (간단한 버전)
   */
  private extractKeywords(content: string, maxKeywords: number = 5): string[] {
    // 한국어 조사 제거 및 빈도 계산
    const koreanParticles = ['은', '는', '이', '가', '을', '를', '의', '와', '과', '도', '만', '에서', '에게'];
    const words = content
      .replace(/[^\w\s가-힣]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1 && !koreanParticles.includes(word));

    // 빈도 계산
    const wordFreq = new Map<string, number>();
    words.forEach(word => {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    });

    // 빈도순 정렬 및 반환
    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([word]) => word);
  }

  /**
   * 메인 청킹 메서드
   */
  async chunkDocument(
    content: string,
    documentId: string,
    documentTitle: string,
    config: AdaptiveChunkingConfig
  ): Promise<AdaptiveChunk[]> {
    try {
      // UTF-8 인코딩 보장
      let cleanContent = content;
      try {
        const encodingResult = processTextEncoding(content, { strictMode: true });
        cleanContent = encodingResult.cleanedText;
      } catch (error) {
        console.warn('⚠️ 텍스트 인코딩 변환 실패, 원본 사용:', error);
      }

      if (!cleanContent || cleanContent.trim() === '') {
        console.warn('⚠️ 문서 내용이 비어있습니다.');
        return [];
      }

      // 문서 구조 분석
      const structure = this.analyzeDocumentStructure(cleanContent);

      // 콘텐츠 유형별 특화 청킹
      let chunkTexts: string[];
      
      if (config.contentType === 'faq') {
        chunkTexts = this.chunkFAQDocument(cleanContent);
      } else if (config.contentType === 'policy') {
        chunkTexts = this.chunkPolicyDocument(cleanContent);
      } else if (config.contentType === 'marketing') {
        chunkTexts = this.chunkMarketingDocument(cleanContent);
      } else {
        // 일반 적응적 청킹
        const strategy = this.getChunkingStrategy(config);
        chunkTexts = this.chunkBySemanticBoundaries(cleanContent, strategy);
      }

      // 청크 메타데이터 생성
      const chunks: AdaptiveChunk[] = [];
      let currentCharIndex = 0;

      for (let i = 0; i < chunkTexts.length; i++) {
        const chunkText = chunkTexts[i];
        const startChar = cleanContent.indexOf(chunkText, currentCharIndex);
        const endChar = startChar + chunkText.length;

        // 청크 타입 분류
        const chunkType = this.classifyChunkType(chunkText);

        // 관련 섹션 찾기
        const relatedSection = structure.sections.find(
          s => s.start <= startChar && s.end >= endChar
        );

        // 키워드 추출
        const keywords = this.extractKeywords(chunkText, 5);

        const chunk: AdaptiveChunk = {
          id: `${documentId}_chunk_${i}`,
          content: chunkText,
          metadata: {
            documentId,
            documentTitle,
            documentType: config.documentType,
            chunkIndex: i,
            chunkType,
            startChar,
            endChar,
            originalLength: chunkText.length,
            sectionTitle: relatedSection?.title,
            headingLevel: relatedSection?.level,
            keywords,
            importance: this.calculateImportance(chunkText, chunkType),
            confidence: 0.8, // 기본 신뢰도 (향후 개선 가능)
          }
        };

        chunks.push(chunk);
        currentCharIndex = endChar;
      }

      console.log(`📄 적응적 청킹 완료: ${chunks.length}개 청크 생성`, {
        documentType: config.documentType,
        contentType: config.contentType,
        originalLength: cleanContent.length,
        averageChunkSize: Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length)
      });

      return chunks;
    } catch (error) {
      console.error('❌ 적응적 청킹 실패:', error);
      throw error;
    }
  }

  /**
   * 청크 중요도 계산
   */
  private calculateImportance(content: string, chunkType: EnhancedChunkMetadata['chunkType']): number {
    let importance = 0.5; // 기본값

    // 청크 타입별 가중치
    switch (chunkType) {
      case 'title':
        importance = 0.9;
        break;
      case 'qa':
        importance = 0.8;
        break;
      case 'article':
        importance = 0.7;
        break;
      case 'section':
        importance = 0.6;
        break;
      default:
        importance = 0.5;
    }

    // 키워드 밀도에 따른 가중치
    const keywordDensity = this.extractKeywords(content, 10).length / content.length * 1000;
    if (keywordDensity > 5) {
      importance += 0.1;
    }

    return Math.min(importance, 1.0);
  }
}

// 싱글톤 인스턴스
export const adaptiveChunkingService = new AdaptiveChunkingService();

