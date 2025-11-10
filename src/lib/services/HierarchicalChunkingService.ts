/**
 * 계층적 청킹 서비스
 * 문서 구조를 유지하면서 청킹 (문서 > 섹션 > 문단 > 문장)
 * 서버 사이드에서만 사용 (API 라우트)
 */

export type HierarchyLevel = 'document' | 'section' | 'paragraph' | 'sentence';

export interface HierarchicalChunk {
  id: string;
  content: string;
  hierarchyLevel: HierarchyLevel;
  parentId?: string;
  children: string[];
  metadata: {
    documentId: string;
    documentTitle: string;
    chunkIndex: number;
    startChar: number;
    endChar: number;
    sectionTitle?: string;
    headingLevel?: number;
    paragraphIndex?: number;
    importance?: number;
    confidence?: number;
  };
}

export interface DocumentStructure {
  sections: Array<{
    title: string;
    start: number;
    end: number;
    level: number;
    paragraphs: number[];
  }>;
  paragraphs: Array<{
    start: number;
    end: number;
    sentences: number[];
  }>;
}

export class HierarchicalChunkingService {
  /**
   * 문서 구조 분석 강화
   * 제목, 섹션, 문단, 문장 레벨까지 분석
   */
  analyzeDocumentStructure(content: string): DocumentStructure {
    const sections: Array<{
      title: string;
      start: number;
      end: number;
      level: number;
      paragraphs: number[];
    }> = [];
    
    const paragraphs: Array<{
      start: number;
      end: number;
      sentences: number[];
    }> = [];

    // 1. 제목/섹션 감지
    const headingPatterns = [
      /^#{1,6}\s+(.+)$/gm, // 마크다운 제목
      /^제\s*\d+\s*장\s*[:\s]*(.+)$/gmi, // 장 제목
      /^제\s*\d+\s*절\s*[:\s]*(.+)$/gmi, // 절 제목
      /^제\s*\d+\s*조\s*[:\s]*(.+)$/gmi, // 조 제목
      /^[IVX]+\.\s+(.+)$/gmi, // 로마 숫자 제목
      /^\d+\.\s+(.+)$/gm, // 번호 제목
    ];

    let match;
    for (const pattern of headingPatterns) {
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        const level = match[0].match(/^#+/)?.[0]?.length || 
                     (match[0].match(/^제\s*\d+\s*장/)) ? 1 :
                     (match[0].match(/^제\s*\d+\s*절/)) ? 2 :
                     (match[0].match(/^제\s*\d+\s*조/)) ? 3 : 3;
        
        sections.push({
          title: match[1]?.trim() || match[0],
          start: match.index || 0,
          end: (match.index || 0) + match[0].length,
          level,
          paragraphs: [], // 문단 정보는 나중에 채움
        });
      }
    }

    // 1-1. 줄바꿈으로 구분된 짧은 줄을 제목으로 감지 (URL 크롤링 텍스트용)
    const lines = content.split('\n');
    let currentPos = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineStart = currentPos;
      const lineEnd = currentPos + lines[i].length;
      
      // 짧은 줄(50자 이하)을 제목 후보로 간주
      if (line.length > 0 && line.length <= 50) {
        const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : '';
        const prevLine = i > 0 ? lines[i - 1].trim() : '';
        
        // 제목 조건: 다음 줄이 비어있거나, 이전 줄이 비어있거나, 줄이 짧고 다음 줄이 긴 경우
        // 또는 문장 끝이 없는 짧은 구문 (제목 특징)
        const isLikelyHeading = 
          (nextLine === '' || prevLine === '') ||
          (nextLine.length > line.length * 2) ||
          (line.match(/^[A-Z가-힣][^.!?]*$/) && !line.match(/[.!?]$/) && line.length <= 30);
        
        if (isLikelyHeading) {
          // 이미 감지된 섹션과 겹치지 않는지 확인
          const overlaps = sections.some(s => 
            (lineStart >= s.start && lineStart < s.end) ||
            (lineEnd > s.start && lineEnd <= s.end)
          );
          
          if (!overlaps) {
            sections.push({
              title: line,
              start: lineStart,
              end: lineEnd,
              level: 2, // 기본 레벨 2
              paragraphs: [],
            });
          }
        }
      }
      
      currentPos = lineEnd + 1; // +1 for \n
    }
    
    // 1-2. 공백으로 구분된 짧은 구문을 제목으로 감지 (개선: 문장 시작 지점 감지)
    // 예: "마케팅 API 개요 시작하기 광고 크리에이티브 Bidding..." -> 각각을 제목으로
    // 패턴: 문장 끝이 없고, 짧은 구문(2-40자) 다음에 긴 문장이 시작되는 경우
    const words = content.split(/\s+/);
    let currentPos = 0;
    let potentialHeading = '';
    let potentialHeadingStart = 0;
    
    // 문장 시작을 나타내는 패턴 (조사, 동사 등)
    const sentenceStartPattern = /^(는|은|와|과|를|을|가|이|에|에서|로|으로|의|부터|까지)$/;
    const longWordThreshold = 15; // 긴 단어로 간주하는 길이
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const wordStart = content.indexOf(word, currentPos);
      const wordEnd = wordStart + word.length;
      
      // 단어가 짧고(20자 이하), 문장 끝이 없으면 제목 후보
      const isShortWord = word.length <= 20;
      const hasNoSentenceEnd = !word.match(/[.!?]$/);
      const isCapitalized = /^[A-Z가-힣]/.test(word);
      const isSentenceStart = sentenceStartPattern.test(word);
      const isLongWord = word.length > longWordThreshold;
      
      // 문장이 시작되는 지점 감지 (조사가 나오거나, 긴 단어가 나오면 문장 시작)
      if (isSentenceStart || (isLongWord && potentialHeading.length > 0)) {
        // 제목 후보가 있고, 길이가 적절하면 섹션으로 추가
        if (potentialHeading.length >= 2 && potentialHeading.length <= 40) {
          const headingEnd = wordStart;
          
          // 이미 감지된 섹션과 겹치지 않는지 확인
          const overlaps = sections.some(s => 
            (potentialHeadingStart >= s.start && potentialHeadingStart < s.end) ||
            (headingEnd > s.start && headingEnd <= s.end)
          );
          
          if (!overlaps) {
            sections.push({
              title: potentialHeading,
              start: potentialHeadingStart,
              end: headingEnd,
              level: 3, // 하위 레벨
              paragraphs: [],
            });
          }
        }
        potentialHeading = '';
      } else if (isShortWord && hasNoSentenceEnd && isCapitalized) {
        // 제목 후보에 추가
        if (potentialHeading === '') {
          potentialHeading = word;
          potentialHeadingStart = wordStart;
        } else {
          potentialHeading += ' ' + word;
        }
      } else {
        // 제목 후보가 있고, 길이가 적절하면 섹션으로 추가
        if (potentialHeading.length >= 2 && potentialHeading.length <= 40) {
          const headingEnd = wordStart;
          
          // 이미 감지된 섹션과 겹치지 않는지 확인
          const overlaps = sections.some(s => 
            (potentialHeadingStart >= s.start && potentialHeadingStart < s.end) ||
            (headingEnd > s.start && headingEnd <= s.end)
          );
          
          if (!overlaps) {
            sections.push({
              title: potentialHeading,
              start: potentialHeadingStart,
              end: headingEnd,
              level: 3, // 하위 레벨
              paragraphs: [],
            });
          }
        }
        potentialHeading = '';
      }
      
      currentPos = wordEnd;
    }
    
    // 마지막 제목 후보 처리
    if (potentialHeading.length >= 2 && potentialHeading.length <= 40) {
      const headingEnd = content.length;
      const overlaps = sections.some(s => 
        (potentialHeadingStart >= s.start && potentialHeadingStart < s.end) ||
        (headingEnd > s.start && headingEnd <= s.end)
      );
      
      if (!overlaps) {
        sections.push({
          title: potentialHeading,
          start: potentialHeadingStart,
          end: headingEnd,
          level: 3,
          paragraphs: [],
        });
      }
    }

    // 섹션을 시작 위치순으로 정렬
    sections.sort((a, b) => a.start - b.start);
    
    // 디버깅: 감지된 섹션 로그
    if (sections.length > 0) {
      console.error('[CRITICAL] 🔍 감지된 섹션:', {
        sectionsCount: sections.length,
        sections: sections.map(s => ({
          title: s.title,
          start: s.start,
          end: s.end,
          level: s.level,
          preview: content.substring(s.start, Math.min(s.end, s.start + 50))
        })),
        timestamp: new Date().toISOString()
      });
    } else {
      console.error('[CRITICAL] ⚠️ 섹션 감지 실패:', {
        contentLength: content.length,
        contentPreview: content.substring(0, 200),
        linesCount: content.split('\n').length,
        wordsCount: content.split(/\s+/).length,
        timestamp: new Date().toISOString()
      });
    }

    // 2. 문단 구분 찾기 (개선: 단일 줄바꿈도 인식)
    // 연속된 줄바꿈(\n\n+) 또는 단일 줄바꿈(\n)으로 구분된 블록을 문단으로 인식
    const lines2 = content.split('\n');
    let paragraphStart = 0;
    
    // 각 줄의 시작 위치를 미리 계산
    const lineStarts: number[] = [0];
    for (let k = 0; k < lines2.length - 1; k++) {
      lineStarts.push(lineStarts[k] + lines2[k].length + 1); // +1 for \n
    }
    
    for (let i = 0; i < lines2.length; i++) {
      const line = lines2[i];
      const lineTrimmed = line.trim();
      const isLastLine = i === lines2.length - 1;
      const nextLine = i < lines2.length - 1 ? lines2[i + 1].trim() : '';
      
      // 빈 줄이거나, 다음 줄이 비어있으면 문단 끝
      if (lineTrimmed === '' || (nextLine === '' && !isLastLine)) {
        if (paragraphStart < i) {
          // 이전 줄까지가 하나의 문단
          const paragraphLines = lines2.slice(paragraphStart, i);
          const paragraphContent = paragraphLines.join('\n');
          
          if (paragraphContent.trim().length > 0) {
            const start = lineStarts[paragraphStart];
            const end = start + paragraphContent.length;
            
            // 문장 경계 찾기
            const sentences: number[] = [];
            const sentenceEndings = ['. ', '! ', '? ', '。', '！', '？', '\n'];
            
            for (let j = start; j < end; j++) {
              for (const ending of sentenceEndings) {
                if (content.substring(j, j + ending.length) === ending) {
                  sentences.push(j + ending.length);
                  break;
                }
              }
            }
            
            paragraphs.push({
              start,
              end,
              sentences,
            });
          }
        }
        paragraphStart = i + 1;
      }
    }
    
    // 마지막 문단 처리
    if (paragraphStart < lines2.length) {
      const paragraphLines = lines2.slice(paragraphStart);
      const paragraphContent = paragraphLines.join('\n');
      
      if (paragraphContent.trim().length > 0) {
        const start = lineStarts[paragraphStart];
        const end = start + paragraphContent.length;
        
        const sentences: number[] = [];
        const sentenceEndings = ['. ', '! ', '? ', '。', '！', '？', '\n'];
        
        for (let j = start; j < end; j++) {
          for (const ending of sentenceEndings) {
            if (content.substring(j, j + ending.length) === ending) {
              sentences.push(j + ending.length);
              break;
            }
          }
        }
        
        paragraphs.push({
          start,
          end,
          sentences,
        });
      }
    }

    // 3. 섹션별 문단 매핑
    for (const section of sections) {
      section.paragraphs = paragraphs
        .map((p, idx) => ({ ...p, idx }))
        .filter(p => p.start >= section.start && p.start < section.end)
        .map(p => p.idx);
    }

    return { sections, paragraphs };
  }

  /**
   * 계층적 청크 생성
   * 문서 > 섹션 > 문단 > 문장 구조 유지
   */
  createHierarchicalChunks(
    content: string,
    documentId: string,
    documentTitle: string
  ): HierarchicalChunk[] {
    // CRITICAL: 계층적 청킹 시작 로그
    console.error('[CRITICAL] 🚀 HierarchicalChunkingService.createHierarchicalChunks 시작:', {
      documentId,
      documentTitle,
      contentLength: content.length,
      timestamp: new Date().toISOString()
    });
    
    const chunks: HierarchicalChunk[] = [];
    const structure = this.analyzeDocumentStructure(content);
    
    // CRITICAL: 문서 구조 분석 결과 로그
    console.error('[CRITICAL] 📊 문서 구조 분석 결과:', {
      sectionsCount: structure.sections.length,
      paragraphsCount: structure.paragraphs.length,
      sections: structure.sections.map(s => ({
        title: s.title,
        start: s.start,
        end: s.end,
        level: s.level,
        paragraphsCount: s.paragraphs.length
      })),
      paragraphs: structure.paragraphs.slice(0, 5).map((p, i) => ({
        index: i,
        start: p.start,
        end: p.end,
        length: p.end - p.start,
        sentencesCount: p.sentences.length
      })),
      timestamp: new Date().toISOString()
    });
    
    let chunkIndex = 0;
    const chunkMap = new Map<string, HierarchicalChunk>();

    // 1. 문서 레벨 청크 (최상위)
    const documentChunk: HierarchicalChunk = {
      id: `${documentId}_doc_0`,
      content: content.substring(0, Math.min(500, content.length)), // 문서 요약 (처음 500자)
      hierarchyLevel: 'document',
      children: [],
      metadata: {
        documentId,
        documentTitle,
        chunkIndex: chunkIndex++,
        startChar: 0,
        endChar: Math.min(500, content.length),
        importance: 1.0,
        confidence: 1.0,
      },
    };
    chunks.push(documentChunk);
    chunkMap.set(documentChunk.id, documentChunk);

    // 2. 섹션 레벨 청크
    for (const section of structure.sections) {
      const sectionContent = content.substring(section.start, section.end);
      
      const sectionChunk: HierarchicalChunk = {
        id: `${documentId}_section_${chunkIndex}`,
        content: sectionContent,
        hierarchyLevel: 'section',
        parentId: documentChunk.id,
        children: [],
        metadata: {
          documentId,
          documentTitle,
          chunkIndex: chunkIndex++,
          startChar: section.start,
          endChar: section.end,
          sectionTitle: section.title,
          headingLevel: section.level,
          importance: 0.8,
          confidence: 0.9,
        },
      };
      
      chunks.push(sectionChunk);
      chunkMap.set(sectionChunk.id, sectionChunk);
      documentChunk.children.push(sectionChunk.id);

      // 3. 문단 레벨 청크
      for (const paraIdx of section.paragraphs) {
        const paragraph = structure.paragraphs[paraIdx];
        if (!paragraph) continue;

        const paraContent = content.substring(paragraph.start, paragraph.end).trim();
        if (paraContent.length < 50) continue; // 최소 50자 이상인 문단만

        const paragraphChunk: HierarchicalChunk = {
          id: `${documentId}_para_${chunkIndex}`,
          content: paraContent,
          hierarchyLevel: 'paragraph',
          parentId: sectionChunk.id,
          children: [],
          metadata: {
            documentId,
            documentTitle,
            chunkIndex: chunkIndex++,
            startChar: paragraph.start,
            endChar: paragraph.end,
            sectionTitle: section.title,
            paragraphIndex: paraIdx,
            importance: 0.6,
            confidence: 0.8,
          },
        };

        chunks.push(paragraphChunk);
        chunkMap.set(paragraphChunk.id, paragraphChunk);
        sectionChunk.children.push(paragraphChunk.id);

        // 4. 문장 레벨 청크 (선택적, 큰 문단만)
        if (paraContent.length > 500 && paragraph.sentences.length > 0) {
          for (let i = 0; i < paragraph.sentences.length - 1; i++) {
            const sentenceStart = i === 0 ? paragraph.start : paragraph.sentences[i];
            const sentenceEnd = paragraph.sentences[i + 1];
            const sentenceContent = content.substring(sentenceStart, sentenceEnd).trim();

            if (sentenceContent.length < 20) continue; // 최소 20자 이상인 문장만

            const sentenceChunk: HierarchicalChunk = {
              id: `${documentId}_sent_${chunkIndex}`,
              content: sentenceContent,
              hierarchyLevel: 'sentence',
              parentId: paragraphChunk.id,
              children: [],
              metadata: {
                documentId,
                documentTitle,
                chunkIndex: chunkIndex++,
                startChar: sentenceStart,
                endChar: sentenceEnd,
                sectionTitle: section.title,
                paragraphIndex: paraIdx,
                importance: 0.5,
                confidence: 0.7,
              },
            };

            chunks.push(sentenceChunk);
            chunkMap.set(sentenceChunk.id, sentenceChunk);
            paragraphChunk.children.push(sentenceChunk.id);
          }
        }
      }
    }

    // 섹션이 없는 경우: 문단만 생성
    if (structure.sections.length === 0) {
      // CRITICAL: 섹션이 없어서 문단만 생성하는 경로
      console.error('[CRITICAL] 📋 섹션이 없어서 문단만 생성하는 경로:', {
        paragraphsCount: structure.paragraphs.length,
        willProcessParagraphs: structure.paragraphs.length > 0,
        timestamp: new Date().toISOString()
      });
      
      for (const paragraph of structure.paragraphs) {
        const paraContent = content.substring(paragraph.start, paragraph.end).trim();
        if (paraContent.length < 50) {
          console.log(`⚠️ 문단 건너뜀 (길이 ${paraContent.length}자 < 50자)`);
          continue;
        }

        const paragraphChunk: HierarchicalChunk = {
          id: `${documentId}_para_${chunkIndex}`,
          content: paraContent,
          hierarchyLevel: 'paragraph',
          parentId: documentChunk.id,
          children: [],
          metadata: {
            documentId,
            documentTitle,
            chunkIndex: chunkIndex++,
            startChar: paragraph.start,
            endChar: paragraph.end,
            paragraphIndex: chunks.length,
            importance: 0.6,
            confidence: 0.8,
          },
        };

        chunks.push(paragraphChunk);
        chunkMap.set(paragraphChunk.id, paragraphChunk);
        documentChunk.children.push(paragraphChunk.id);
      }
    }

    // CRITICAL: 계층적 청킹 완료 로그
    console.error('[CRITICAL] 📊 계층적 청킹 완료:', {
      totalChunks: chunks.length,
      document: chunks.filter(c => c.hierarchyLevel === 'document').length,
      sections: chunks.filter(c => c.hierarchyLevel === 'section').length,
      paragraphs: chunks.filter(c => c.hierarchyLevel === 'paragraph').length,
      sentences: chunks.filter(c => c.hierarchyLevel === 'sentence').length,
      firstChunkPreview: chunks[0]?.content?.substring(0, 100) || '없음',
      lastChunkPreview: chunks[chunks.length - 1]?.content?.substring(0, 100) || '없음',
      timestamp: new Date().toISOString(),
      note: chunks.length === 1 ? '⚠️ 1개만 생성됨 - 문단 감지 실패 가능성' : '✅ 정상'
    });

    return chunks;
  }

  /**
   * 부모-자식 관계 추적
   */
  buildHierarchyTree(chunks: HierarchicalChunk[]): Map<string, HierarchicalChunk> {
    const chunkMap = new Map<string, HierarchicalChunk>();
    
    // 모든 청크를 맵에 추가
    for (const chunk of chunks) {
      chunkMap.set(chunk.id, { ...chunk, children: [] });
    }

    // 부모-자식 관계 설정
    for (const chunk of chunks) {
      if (chunk.parentId) {
        const parent = chunkMap.get(chunk.parentId);
        if (parent) {
          parent.children.push(chunk.id);
        }
      }
    }

    return chunkMap;
  }
}

// 싱글톤 인스턴스
export const hierarchicalChunkingService = new HierarchicalChunkingService();

