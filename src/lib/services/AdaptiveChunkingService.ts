import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { processTextEncoding } from '../utils/textEncoding';
import { semanticChunkingService, SemanticChunkingConfig } from './SemanticChunkingService';
import { hierarchicalChunkingService, HierarchicalChunk } from './HierarchicalChunkingService';

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
  optimizeForSpeed?: boolean; // 분할 처리 시 속도 최적화 (더 큰 청크 크기)
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
  
  // 계층 정보
  hierarchyLevel?: 'document' | 'section' | 'paragraph' | 'sentence';
  parentChunkId?: string;
  childrenChunkIds?: string[];
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
    const { documentType, contentLength, contentType, language, optimizeForSpeed } = config;

    // 분할 처리 최적화: 더 큰 청크 크기로 청크 수 감소 (처리 시간 단축)
    const speedMultiplier = optimizeForSpeed ? 1.5 : 1.0; // 50% 증가

    // 콘텐츠 유형별 특화 전략
    if (contentType === 'faq') {
      return this.getFAQStrategy(contentLength, speedMultiplier);
    }
    
    if (contentType === 'policy') {
      return this.getPolicyStrategy(contentLength, speedMultiplier);
    }
    
    if (contentType === 'marketing') {
      return this.getMarketingStrategy(contentLength, speedMultiplier);
    }

    // 문서 크기에 따른 기본 전략 (분할 처리 최적화 적용)
    if (contentLength < 1000) {
      return {
        chunkSize: Math.floor(200 * speedMultiplier),
        chunkOverlap: Math.floor(20 * speedMultiplier),
        separators: ['\n\n', '\n', '. ', '! ', '? ', ' '],
        maxChunks: 50,
        minChunkSize: 50
      };
    } else if (contentLength < 10000) {
      return {
        chunkSize: Math.floor(500 * speedMultiplier),
        chunkOverlap: Math.floor(50 * speedMultiplier),
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' '],
        maxChunks: 100,
        minChunkSize: 100
      };
    } else if (contentLength < 100000) {
      return {
        chunkSize: Math.floor(1000 * speedMultiplier),
        chunkOverlap: Math.floor(100 * speedMultiplier),
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' '],
        maxChunks: 200,
        minChunkSize: 200
      };
    } else if (contentLength < 500000) {
      // 10만자 ~ 50만자: 중간 크기 문서
      return {
        chunkSize: Math.floor(1500 * speedMultiplier),
        chunkOverlap: Math.floor(150 * speedMultiplier),
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' '],
        maxChunks: 400,
        minChunkSize: 300
      };
    } else if (contentLength < 2000000) {
      // 50만자 ~ 200만자: 큰 문서
      return {
        chunkSize: Math.floor(2000 * speedMultiplier),
        chunkOverlap: Math.floor(200 * speedMultiplier),
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' '],
        maxChunks: 800,
        minChunkSize: 400
      };
    } else {
      // 200만자 이상: 매우 큰 문서
      return {
        chunkSize: Math.floor(3000 * speedMultiplier),
        chunkOverlap: Math.floor(300 * speedMultiplier),
        separators: ['\n\n', '\n', '. ', '! ', '? ', '; ', ' '],
        maxChunks: 1000,
        minChunkSize: 500
      };
    }
  }

  /**
   * FAQ 문서 전용 청킹 전략
   * 질문-답변 쌍을 하나의 청크로 유지
   */
  private getFAQStrategy(contentLength: number, speedMultiplier: number = 1.0): ChunkingStrategy {
    return {
      chunkSize: Math.floor(800 * speedMultiplier),
      chunkOverlap: Math.floor(100 * speedMultiplier),
      separators: ['\n\n', '\n', 'Q:', 'A:', '질문:', '답변:', '. ', '! ', '? '],
      maxChunks: Math.ceil(contentLength / (800 * speedMultiplier)),
      minChunkSize: 200
    };
  }

  /**
   * 정책 문서 전용 청킹 전략
   * 조항별로 청킹
   */
  private getPolicyStrategy(contentLength: number, speedMultiplier: number = 1.0): ChunkingStrategy {
    return {
      chunkSize: Math.floor(1200 * speedMultiplier),
      chunkOverlap: Math.floor(150 * speedMultiplier),
      separators: ['\n\n', '제', '조', '항', '장', '절', '\n', '. ', '! ', '? '],
      maxChunks: Math.ceil(contentLength / (1200 * speedMultiplier)),
      minChunkSize: 300
    };
  }

  /**
   * 마케팅 문서 전용 청킹 전략
   * 섹션별로 청킹
   */
  private getMarketingStrategy(contentLength: number, speedMultiplier: number = 1.0): ChunkingStrategy {
    return {
      chunkSize: Math.floor(1000 * speedMultiplier),
      chunkOverlap: Math.floor(100 * speedMultiplier),
      separators: ['\n\n', '##', '###', '# ', '\n', '. ', '! ', '? '],
      maxChunks: Math.ceil(contentLength / (1000 * speedMultiplier)),
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
   * 의미 기반 청킹 (하이브리드: 규칙 기반 + 의미 기반)
   * 큰 문서는 규칙 기반, 작은 문서는 의미 기반 사용
   */
  private async chunkBySemanticBoundaries(
    content: string,
    strategy: ChunkingStrategy
  ): Promise<string[]> {
    // 큰 문서는 규칙 기반 청킹 사용 (성능 최적화)
    const useSemanticChunking = content.length < 50000; // 50KB 미만만 의미 기반 사용
    
    if (useSemanticChunking) {
      try {
        console.log('🔮 의미 기반 청킹 시도 (문서 크기:', content.length, '자)');
        
        const semanticConfig: SemanticChunkingConfig = {
          minChunkSize: strategy.minChunkSize || 50,
          maxChunkSize: strategy.chunkSize,
          minSimilarity: 0.7, // 유사도가 0.7 미만이면 경계로 간주
          sentenceOverlap: Math.floor(strategy.chunkOverlap / 100), // 청크 간 겹치는 문장 수
        };
        
        const semanticChunks = await semanticChunkingService.chunkBySemanticBoundaries(
          content,
          semanticConfig
        );
        
        if (semanticChunks.length > 0) {
          console.log('✅ 의미 기반 청킹 성공:', semanticChunks.length, '개 청크');
          return semanticChunks;
        } else {
          console.log('⚠️ 의미 기반 청킹 결과 없음, 규칙 기반으로 폴백');
        }
      } catch (error) {
        console.warn('⚠️ 의미 기반 청킹 실패, 규칙 기반으로 폴백:', error);
      }
    } else {
      console.log('📏 큰 문서 감지 - 규칙 기반 청킹 사용 (문서 크기:', content.length, '자)');
    }
    
    // 규칙 기반 청킹 (폴백 또는 큰 문서용)
    return this.chunkByRuleBoundaries(content, strategy);
  }

  /**
   * 규칙 기반 청킹 (문장 경계 우선 고려)
   */
  private chunkByRuleBoundaries(
    content: string,
    strategy: ChunkingStrategy
  ): string[] {
    const chunks: string[] = [];
    let start = 0;
    let iterationCount = 0;
    // 큰 파일 처리: 최대 청크 수 제한 증가 및 청크 크기 최적화
    // 매우 큰 파일은 더 큰 청크로 분할하여 청크 수를 줄임
    const isVeryLarge = content.length > 1500000; // 1.5MB 이상
    let adjustedChunkSize = strategy.chunkSize;
    
    if (isVeryLarge) {
      // 매우 큰 파일은 청크 크기를 100% 증가 (청크 수 50% 감소)
      adjustedChunkSize = Math.floor(strategy.chunkSize * 2.0);
      console.log(`📏 매우 큰 파일 감지 - 청크 크기 조정: ${strategy.chunkSize} → ${adjustedChunkSize}자 (청크 수 50% 감소 예상)`);
    }
    
    // 최대 청크 수 제한: 큰 파일은 800개로 제한 (임베딩/저장 시간 단축)
    const maxChunks = strategy.maxChunks || (content.length > 1000000 ? 800 : 500); // 1MB 이상이면 800개까지 (1000 → 800으로 감소)
    const maxIterations = maxChunks * 2;

    while (start < content.length && iterationCount < maxIterations) {
      const end = Math.min(start + adjustedChunkSize, content.length);
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
        if (lastParagraphEnd > adjustedChunkSize * 0.3) {
          cutPoint = lastParagraphEnd;
        } else if (lastSentenceEnd > adjustedChunkSize * 0.5) {
          cutPoint = lastSentenceEnd;
        } else if (lastLineEnd > adjustedChunkSize * 0.7) {
          cutPoint = lastLineEnd;
        }

        if (cutPoint > 0) {
          chunk = chunk.slice(0, cutPoint + 1);
        }
      }

      const trimmedChunk = chunk.trim();
      const minSize = strategy.minChunkSize || 50;
      
      // 청크 추가 여부 추적
      let chunkAdded = false;
      
      // 최소 크기보다 작은 청크도 허용 (마지막 청크인 경우)
      if (trimmedChunk.length >= minSize) {
        chunks.push(trimmedChunk);
        chunkAdded = true;
      } else if (trimmedChunk.length > 0 && (end >= content.length || chunks.length === 0)) {
        // 마지막 청크이거나 아직 청크가 없는 경우 최소 크기보다 작아도 허용
        console.log(`📝 최소 크기보다 작은 청크 추가 (${trimmedChunk.length}자, 최소: ${minSize}자) - 마지막 청크 또는 첫 청크`);
        chunks.push(trimmedChunk);
        chunkAdded = true;
      } else if (trimmedChunk.length > 0) {
        // 최소 크기보다 작지만 내용이 있는 경우, 이전 청크에 병합 시도
        if (chunks.length > 0) {
          // 이전 청크에 병합
          chunks[chunks.length - 1] += ' ' + trimmedChunk;
          chunkAdded = true;
          console.log(`📝 작은 청크를 이전 청크에 병합 (${trimmedChunk.length}자)`);
        } else {
          // 첫 청크인 경우 최소 크기보다 작아도 추가
          chunks.push(trimmedChunk);
          chunkAdded = true;
          console.log(`📝 첫 청크 추가 (최소 크기 미만, ${trimmedChunk.length}자)`);
        }
      }

      // 다음 청크 시작 위치 (overlap 고려)
      // 청크가 추가되었거나 마지막인 경우에만 start 이동
      if (chunkAdded || end >= content.length) {
        const nextStart = start + chunk.length - strategy.chunkOverlap;
        start = Math.max(nextStart, start + 1);
      } else {
        // 청크가 추가되지 않은 경우 최소한 1자씩은 이동 (무한 루프 방지)
        start = Math.max(start + 1, start + Math.floor(adjustedChunkSize * 0.1));
        console.warn(`⚠️ 청크 추가 실패 - start 위치 강제 이동: ${start}`);
      }

      iterationCount++;

      // 최대 청크 수 제한
      if (chunks.length >= maxChunks) {
        console.warn(`⚠️ 최대 청크 수 도달 (${maxChunks}), 청킹 중단`);
        break;
      }
      
      // 큰 파일 처리: 진행 상황 로깅 (100개 청크마다)
      if (chunks.length % 100 === 0 && chunks.length > 0) {
        console.log(`📊 청킹 진행 중: ${chunks.length}개 청크 생성 (${Math.round((start / content.length) * 100)}% 완료)`);
      }
    }

    if (iterationCount >= maxIterations) {
      console.warn(`⚠️ 최대 반복 횟수 도달 (${maxIterations}), 청킹 중단. 생성된 청크: ${chunks.length}개`);
    }
    
    if (chunks.length === 0 && content.length > 0) {
      console.warn('⚠️ 청킹 결과가 비어있습니다. 최소 크기 제한으로 인한 것일 수 있습니다.');
      // 최소 크기 제한을 무시하고 최소한 1개 청크는 생성
      chunks.push(content.trim());
    }
    
    // 청크가 1개만 생성되었는데 내용이 긴 경우 경고 및 강제 분할
    if (chunks.length === 1 && content.length > 10000) {
      const firstChunkSize = chunks[0]?.length || 0;
      const coverage = content.length > 0 ? (firstChunkSize / content.length) * 100 : 0;
      
      console.error('❌ 청킹 최적화 실패: 내용이 긴데 청크가 1개만 생성되었습니다.', {
        contentLength: content.length,
        chunkSize: firstChunkSize,
        coverage: `${coverage.toFixed(1)}%`,
        strategy: {
          chunkSize: strategy.chunkSize,
          adjustedChunkSize,
          maxChunks,
          minChunkSize: strategy.minChunkSize
        },
        iterationCount,
        maxIterations
      });
      
      // 강제로 여러 청크로 분할 시도 (더 작은 청크 크기로)
      console.log('🔄 AdaptiveChunkingService: 강제 청킹 시도...');
      const forcedChunks: string[] = [];
      // 내용 길이에 따라 동적으로 청크 크기 결정 (최소 500자, 최대 2000자)
      // 목표: 최소 10개 이상의 청크 생성
      const targetChunkCount = Math.max(10, Math.min(50, Math.floor(content.length / 1000)));
      const forcedChunkSize = Math.max(500, Math.min(2000, Math.floor(content.length / targetChunkCount)));
      
      console.log(`📏 AdaptiveChunkingService: 강제 청킹 설정:`, {
        targetChunkCount,
        forcedChunkSize,
        contentLength: content.length,
        calculation: `Math.max(10, Math.min(50, Math.floor(${content.length} / 1000))) = ${targetChunkCount}, Math.max(500, Math.min(2000, Math.floor(${content.length} / ${targetChunkCount}))) = ${forcedChunkSize}`
      });
      
      let loopCount = 0;
      for (let i = 0; i < content.length; i += forcedChunkSize) {
        loopCount++;
        const forcedChunk = content.slice(i, i + forcedChunkSize).trim();
        if (forcedChunk.length > 0) {
          forcedChunks.push(forcedChunk);
        }
      }
      
      console.log(`📊 AdaptiveChunkingService: 강제 청킹 루프 완료:`, {
        loopCount,
        forcedChunksLength: forcedChunks.length,
        contentLength: content.length,
        forcedChunkSize,
        expectedChunks: Math.ceil(content.length / forcedChunkSize)
      });
      
      if (forcedChunks.length > 1) {
        console.log(`✅ AdaptiveChunkingService: 강제 청킹 완료: ${forcedChunks.length}개 청크 생성 (기존: ${chunks.length}개, 목표: ${targetChunkCount}개)`, {
          beforeChunkCount: chunks.length,
          afterChunkCount: forcedChunks.length,
          targetChunkCount,
          contentLength: content.length
        });
        return forcedChunks;
      } else {
        console.warn('⚠️ 강제 청킹 실패: 여전히 1개 청크만 생성됨. 더 작은 청크 크기로 재시도...');
        // 더 작은 청크 크기로 재시도
        const smallerChunkSize = Math.max(200, Math.floor(forcedChunkSize / 2));
        const smallerForcedChunks: string[] = [];
        for (let i = 0; i < content.length; i += smallerChunkSize) {
          const smallerChunk = content.slice(i, i + smallerChunkSize).trim();
          if (smallerChunk.length > 0) {
            smallerForcedChunks.push(smallerChunk);
          }
        }
        
        if (smallerForcedChunks.length > 1) {
          console.log(`✅ 강제 청킹 재시도 성공: ${smallerForcedChunks.length}개 청크 생성`);
          return smallerForcedChunks;
        }
      }
    }
    
    // 최종 청크 수 로깅
    if (chunks.length > 0) {
      const avgChunkSize = Math.round(chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length);
      console.log(`📊 청킹 완료: ${chunks.length}개 청크 생성 (평균 ${avgChunkSize}자/청크, 전체 ${content.length}자)`);
    }

    return chunks;
  }

  /**
   * FAQ 문서 특화 청킹 (질문-답변 쌍 유지) - 개선 버전
   */
  private chunkFAQDocument(content: string): string[] {
    const chunks: string[] = [];
    
    // 개선된 FAQ 패턴 감지 (다중 언어 지원)
    const qaPatterns = [
      // 한국어 패턴
      /(?:^|\n)(?:Q|질문|Q\.|질문\.)[:\s]*\d*[\.\)]?\s*(.+?)\s*(?:\n\s*(?:A|답변|A\.|답변\.)[:\s]*\s*(.+?)(?=\n\s*(?:Q|질문)|$))/gims,
      /(?:^|\n)(?:Q|질문)[:\s]*(.+?)\s*(?:\n\s*(?:A|답변)[:\s]*(.+?)(?=\n\s*(?:Q|질문)|$))/gims,
      // 영어 패턴
      /(?:^|\n)(?:Q|Question|Q\.)[:\s]*\d*[\.\)]?\s*(.+?)\s*(?:\n\s*(?:A|Answer|A\.)[:\s]*\s*(.+?)(?=\n\s*(?:Q|Question)|$))/gims,
      // 번호 패턴 (1. 질문 2. 답변 형식)
      /(?:^|\n)\d+[\.\)]\s*(.+?)\s*\?\s*(?:\n\s*\d+[\.\)]\s*(.+?)(?=\n\s*\d+[\.\)]|$))/gims,
      // 마크다운 형식 (### Q: ... ### A: ...)
      /(?:^|\n)###\s*(?:Q|질문)[:\s]*(.+?)\s*###\s*(?:A|답변)[:\s]*(.+?)(?=\n###|$)/gims,
    ];

    const matchedPairs = new Set<string>(); // 중복 제거용

    for (const pattern of qaPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const question = match[1]?.trim() || '';
        const answer = match[2]?.trim() || '';
        
        if (question && answer) {
          const qaPair = `Q: ${question}\n\nA: ${answer}`;
          const pairKey = `${question.slice(0, 50)}_${answer.slice(0, 50)}`; // 중복 검사용 키
          
          if (!matchedPairs.has(pairKey) && qaPair.length > 100) {
            chunks.push(qaPair);
            matchedPairs.add(pairKey);
          }
        } else if (match[0]) {
          // 질문과 답변이 한 번에 매칭된 경우
          const qaPair = match[0].trim();
          if (qaPair.length > 100 && !matchedPairs.has(qaPair.slice(0, 100))) {
            chunks.push(qaPair);
            matchedPairs.add(qaPair.slice(0, 100));
          }
        }
      }
    }

    // 질문-답변 쌍 완전성 검증 및 정리
    const validatedChunks: string[] = [];
    for (const chunk of chunks) {
      const hasQuestion = /(?:^|\n)(?:Q|질문|Question|Q\.)[:\s]/.test(chunk);
      const hasAnswer = /(?:^|\n)(?:A|답변|Answer|A\.)[:\s]/.test(chunk);
      
      if (hasQuestion && hasAnswer) {
        validatedChunks.push(chunk);
      } else if (chunk.includes('?') && chunk.length > 200) {
        // 질문 마크가 없어도 ?가 있고 충분한 길이면 포함
        validatedChunks.push(chunk);
      }
    }

    console.log(`📋 FAQ 청킹 결과: ${validatedChunks.length}개 질문-답변 쌍 발견`);

    // 패턴 매칭 실패 또는 결과가 적으면 일반 청킹으로 폴백
    if (validatedChunks.length === 0 || validatedChunks.length < chunks.length * 0.3) {
      console.log('⚠️ FAQ 패턴 매칭 결과 부족, 일반 청킹으로 폴백');
      return this.chunkByRuleBoundaries(content, this.getFAQStrategy(content.length));
    }

    return validatedChunks;
  }

  /**
   * 정책 문서 특화 청킹 (조항별) - 개선 버전
   */
  private chunkPolicyDocument(content: string): string[] {
    const chunks: string[] = [];
    
    // 개선된 조항 패턴 감지 (장/절/항/목 계층 구조 인식)
    const articlePatterns = [
      // 장 제목 패턴
      /(?:^|\n)(제\s*\d+\s*장)[:\s]*(.+?)(?=\n(?:제\s*\d+\s*(?:절|조))|$)/gims,
      // 절 제목 패턴
      /(?:^|\n)(제\s*\d+\s*절)[:\s]*(.+?)(?=\n(?:제\s*\d+\s*(?:조|절))|$)/gims,
      // 조 항목 패턴
      /(?:^|\n)(제\s*\d+\s*조)[:\s]*(.+?)(?=\n(?:제\s*\d+\s*(?:조|장|절))|$)/gims,
      // 항 목 패턴
      /(?:^|\n)(제\s*\d+\s*항)[:\s]*(.+?)(?=\n(?:제\s*\d+\s*(?:항|조|목))|$)/gims,
      // 목 패턴
      /(?:^|\n)(제\s*\d+\s*목)[:\s]*(.+?)(?=\n(?:제\s*\d+\s*(?:목|항|조))|$)/gims,
      // 영어 패턴 (Article, Chapter, Section)
      /(?:^|\n)(?:Article|Chapter|Section)\s*\d+[:\s]*(.+?)(?=\n(?:Article|Chapter|Section)\s*\d+|$)/gims,
    ];

    const matchedArticles = new Map<string, { content: string; level: number; number: number }>();

    for (const pattern of articlePatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const fullMatch = match[0].trim();
        const level = this.determinePolicyLevel(fullMatch);
        const number = this.extractPolicyNumber(fullMatch);
        const articleKey = `${level}_${number}`;
        
        if (fullMatch.length > 200 && !matchedArticles.has(articleKey)) {
          matchedArticles.set(articleKey, {
            content: fullMatch,
            level,
            number,
          });
        }
      }
    }

    // 법률 용어 감지 및 가중치 적용
    const legalTerms = ['법', '규칙', '법령', '법률', '규정', '법규', '조례', '시행령', '시행규칙'];
    const chunksWithTerms = Array.from(matchedArticles.values())
      .map(article => {
        const termCount = legalTerms.filter(term => 
          article.content.toLowerCase().includes(term)
        ).length;
        return {
          ...article,
          termWeight: termCount,
        };
      })
      .sort((a, b) => {
        // 레벨 우선 정렬 (낮은 레벨 = 높은 우선순위)
        if (a.level !== b.level) return a.level - b.level;
        // 번호 순 정렬
        if (a.number !== b.number) return a.number - b.number;
        // 용어 가중치
        return b.termWeight - a.termWeight;
      });

    chunks.push(...chunksWithTerms.map(a => a.content));

    console.log(`📜 정책 문서 청킹 결과: ${chunks.length}개 조항 발견 (장/절/조/항/목)`);

    // 패턴 매칭 실패 시 일반 청킹으로 폴백
    if (chunks.length === 0) {
      console.log('⚠️ 정책 문서 패턴 매칭 실패, 일반 청킹으로 폴백');
      return this.chunkByRuleBoundaries(content, this.getPolicyStrategy(content.length));
    }

    return chunks;
  }

  /**
   * 정책 문서 레벨 결정 (1: 장, 2: 절, 3: 조, 4: 항, 5: 목)
   */
  private determinePolicyLevel(text: string): number {
    if (/제\s*\d+\s*장/.test(text)) return 1;
    if (/제\s*\d+\s*절/.test(text)) return 2;
    if (/제\s*\d+\s*조/.test(text)) return 3;
    if (/제\s*\d+\s*항/.test(text)) return 4;
    if (/제\s*\d+\s*목/.test(text)) return 5;
    if (/Chapter\s*\d+/i.test(text)) return 1;
    if (/Section\s*\d+/i.test(text)) return 2;
    if (/Article\s*\d+/i.test(text)) return 3;
    return 3; // 기본값: 조
  }

  /**
   * 정책 문서 번호 추출
   */
  private extractPolicyNumber(text: string): number {
    const match = text.match(/(?:제\s*)?(\d+)\s*(?:장|절|조|항|목|Chapter|Section|Article)/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * 마케팅 문서 특화 청킹 (섹션별) - 개선 버전
   */
  private chunkMarketingDocument(content: string): string[] {
    const chunks: string[] = [];
    
    // 개선된 섹션 패턴 감지 (마크다운 헤딩 + CTA 섹션)
    const headingPattern = /^(#{1,6})\s+(.+)$/gm;
    const headings: Array<{ level: number; title: string; position: number }> = [];
    
    let match;
    while ((match = headingPattern.exec(content)) !== null) {
      headings.push({
        level: match[1].length,
        title: match[2].trim(),
        position: match.index || 0,
      });
    }

    // 섹션별로 분할
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      const nextHeading = headings[i + 1];
      const startPos = heading.position;
      const endPos = nextHeading ? nextHeading.position : content.length;
      
      let sectionContent = content.substring(startPos, endPos).trim();
      
      // CTA (Call to Action) 섹션 감지
      const ctaPatterns = [
        /(?:지금|지금 바로|바로|즉시|지금 즉시|당장)\s*(?:주문|구매|신청|가입|시작|체험|다운로드)/g,
        /(?:click|order|buy|apply|join|start|try|download)\s*(?:now|here|today)/gi,
        /(?:무료|무료로|무료 체험|무료 다운로드)/g,
        /(?:지금|Now)\s*(?:시작|Start)/g,
      ];
      
      const hasCTA = ctaPatterns.some(pattern => pattern.test(sectionContent));
      
      // 섹션 내용 정리
      if (sectionContent.length > 200) {
        // CTA가 있는 섹션은 중요도 높게 표시
        if (hasCTA) {
          sectionContent = `[CTA 섹션] ${sectionContent}`;
        }
        chunks.push(sectionContent);
      }
    }

    // 헤딩이 없는 경우 문단 기반 분할
    if (chunks.length === 0) {
      const paragraphs = content.split(/\n\n+/);
      for (const para of paragraphs) {
        const trimmed = para.trim();
        if (trimmed.length > 200) {
          chunks.push(trimmed);
        }
      }
    }

    // 섹션별 중요도 계산
    const chunksWithImportance = chunks.map(chunk => {
      let importance = 0.5;
      
      // CTA 포함 여부
      if (/\[CTA 섹션\]/.test(chunk)) {
        importance += 0.3;
      }
      
      // 마케팅 키워드 포함 여부
      const marketingKeywords = ['프로모션', '할인', '이벤트', '특가', '혜택', '신규', '추천'];
      const keywordCount = marketingKeywords.filter(kw => 
        chunk.toLowerCase().includes(kw)
      ).length;
      importance += keywordCount * 0.05;
      
      return {
        content: chunk,
        importance: Math.min(importance, 1.0),
      };
    });

    // 중요도 순 정렬
    chunksWithImportance.sort((a, b) => b.importance - a.importance);

    console.log(`📢 마케팅 문서 청킹 결과: ${chunksWithImportance.length}개 섹션 발견`);

    // 패턴 매칭 실패 시 일반 청킹으로 폴백
    if (chunksWithImportance.length === 0) {
      console.log('⚠️ 마케팅 문서 패턴 매칭 실패, 일반 청킹으로 폴백');
      return this.chunkByRuleBoundaries(content, this.getMarketingStrategy(content.length));
    }

    return chunksWithImportance.map(c => c.content);
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

      // 계층적 청킹 사용 여부 결정
      // 큰 문서이거나 구조가 명확한 문서는 계층적 청킹 사용
      const useHierarchicalChunking = 
        cleanContent.length > 5000 || // 5KB 이상
        structure.sections.length > 0 || // 섹션이 있는 경우
        config.contentType === 'policy' || // 정책 문서
        config.contentType === 'marketing'; // 마케팅 문서

      let chunkTexts: string[] = [];
      let hierarchicalChunks: HierarchicalChunk[] = [];
      let useHierarchical = false;

      if (useHierarchicalChunking) {
        try {
          console.log('📊 계층적 청킹 시도 (문서 크기:', cleanContent.length, '자, 섹션:', structure.sections.length, '개)');
          
          hierarchicalChunks = hierarchicalChunkingService.createHierarchicalChunks(
            cleanContent,
            documentId,
            documentTitle
          );
          
          if (hierarchicalChunks.length > 0) {
            chunkTexts = hierarchicalChunks.map(c => c.content);
            useHierarchical = true;
            console.log('✅ 계층적 청킹 성공:', hierarchicalChunks.length, '개 청크');
          } else {
            console.log('⚠️ 계층적 청킹 결과 없음, 일반 청킹으로 폴백');
          }
        } catch (error) {
          console.warn('⚠️ 계층적 청킹 실패, 일반 청킹으로 폴백:', error);
        }
      }

      // 계층적 청킹 실패 또는 사용하지 않는 경우 일반 청킹
      if (!useHierarchical) {
        if (config.contentType === 'faq') {
          chunkTexts = this.chunkFAQDocument(cleanContent);
        } else if (config.contentType === 'policy') {
          chunkTexts = this.chunkPolicyDocument(cleanContent);
        } else if (config.contentType === 'marketing') {
          chunkTexts = this.chunkMarketingDocument(cleanContent);
        } else {
          // 일반 적응적 청킹 (의미 기반 + 규칙 기반 하이브리드)
          const strategy = this.getChunkingStrategy(config);
          chunkTexts = await this.chunkBySemanticBoundaries(cleanContent, strategy);
        }
      }

      // 청크 메타데이터 생성
      const chunks: AdaptiveChunk[] = [];

      if (useHierarchical && hierarchicalChunks.length > 0) {
        // 계층적 청킹 결과 사용
        for (const hierarchicalChunk of hierarchicalChunks) {
          const chunkType = this.classifyChunkType(hierarchicalChunk.content);
          const keywords = this.extractKeywords(hierarchicalChunk.content, 5);

          const chunk: AdaptiveChunk = {
            id: hierarchicalChunk.id,
            content: hierarchicalChunk.content,
            metadata: {
              documentId,
              documentTitle,
              documentType: config.documentType,
              chunkIndex: hierarchicalChunk.metadata.chunkIndex,
              chunkType,
              startChar: hierarchicalChunk.metadata.startChar,
              endChar: hierarchicalChunk.metadata.endChar,
              originalLength: hierarchicalChunk.content.length,
              sectionTitle: hierarchicalChunk.metadata.sectionTitle,
              headingLevel: hierarchicalChunk.metadata.headingLevel,
              paragraphIndex: hierarchicalChunk.metadata.paragraphIndex,
              keywords,
              importance: hierarchicalChunk.metadata.importance || this.calculateImportance(hierarchicalChunk.content, chunkType),
              confidence: hierarchicalChunk.metadata.confidence || 0.8,
              hierarchyLevel: hierarchicalChunk.hierarchyLevel,
              parentChunkId: hierarchicalChunk.parentId,
              childrenChunkIds: hierarchicalChunk.children,
            }
          };

          chunks.push(chunk);
        }
      } else {
        // 일반 청킹 결과 사용 (계층 정보도 포함)
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

          // 계층 레벨 결정 (섹션에 속하면 section, 아니면 paragraph)
          const hierarchyLevel = relatedSection 
            ? 'section' 
            : (chunkText.includes('\n\n') ? 'paragraph' : 'sentence');

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
              // 계층 정보 추가 (일반 청킹에서도 계층 정보 포함)
              hierarchyLevel: hierarchyLevel as 'document' | 'section' | 'paragraph' | 'sentence',
              // 첫 번째 청크는 최상위, 나머지는 이전 청크를 부모로 설정 (간단한 계층 구조)
              parentChunkId: i > 0 ? `${documentId}_chunk_${i - 1}` : undefined,
            }
          };

          chunks.push(chunk);
          currentCharIndex = endChar;
        }
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

