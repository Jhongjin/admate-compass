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

    // 섹션을 시작 위치순으로 정렬
    sections.sort((a, b) => a.start - b.start);

    // 2. 문단 구분 찾기
    const paragraphMatches = Array.from(content.matchAll(/\n\n+/g));
    const paragraphStarts: number[] = paragraphMatches.map(m => m.index || 0);
    
    // 각 문단의 시작과 끝 위치 계산
    for (let i = 0; i < paragraphStarts.length; i++) {
      const start = paragraphStarts[i];
      const end = i < paragraphStarts.length - 1 
        ? paragraphStarts[i + 1] 
        : content.length;
      
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

