/**
 * HTML 구조 정보 추출 유틸리티
 * URL 크롤링 콘텐츠에서 HTML 구조 정보(헤딩, 섹션 등)를 추출하여 메타데이터로 보강
 * 
 * 목적:
 * - 청크에 섹션 제목, 헤딩 레벨 등 구조 정보 포함
 * - RAG 검색 시 컨텍스트 이해도 향상
 */

export interface HTMLStructureInfo {
  headings: Array<{
    text: string;
    level: number; // 1-6 (h1-h6)
    position: number; // 텍스트 내 위치
  }>;
  sections: Array<{
    title: string;
    start: number;
    end: number;
    level: number;
  }>;
  hasLists: boolean;
  hasTables: boolean;
}

/**
 * 텍스트 콘텐츠에서 HTML 구조 정보 추출
 * (URL 크롤링 시 이미 텍스트로 변환된 콘텐츠에서 구조 정보 추론)
 */
export function extractHTMLStructureFromText(content: string): HTMLStructureInfo {
  const headings: Array<{ text: string; level: number; position: number }> = [];
  const sections: Array<{ title: string; start: number; end: number; level: number }> = [];
  
  // 줄 단위로 분석
  const lines = content.split('\n');
  let currentPosition = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineStart = currentPosition;
    const lineEnd = currentPosition + lines[i].length;
    
    // 1. 마크다운 스타일 제목 감지 (# 기반)
    const markdownHeading = line.match(/^(#{1,6})\s+(.+)$/);
    if (markdownHeading) {
      const level = markdownHeading[1].length;
      const text = markdownHeading[2].trim();
      headings.push({ text, level, position: lineStart });
      sections.push({ title: text, start: lineStart, end: lineEnd, level });
      currentPosition = lineEnd + 1;
      continue;
    }
    
    // 2. 번호 제목 감지 (1., 2., 3. 등)
    const numberedHeading = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedHeading && line.length <= 100) {
      const text = numberedHeading[2].trim();
      headings.push({ text, level: 2, position: lineStart });
      sections.push({ title: text, start: lineStart, end: lineEnd, level: 2 });
      currentPosition = lineEnd + 1;
      continue;
    }
    
    // 3. 짧은 줄을 제목으로 감지 (50자 이하, 다음 줄이 비어있거나 긴 경우)
    if (line.length > 0 && line.length <= 50 && !line.match(/[.!?]$/)) {
      const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : '';
      const prevLine = i > 0 ? lines[i - 1].trim() : '';
      
      // 제목 조건: 다음 줄이 비어있거나, 이전 줄이 비어있거나, 다음 줄이 훨씬 긴 경우
      const isLikelyHeading = 
        (nextLine === '' || prevLine === '') ||
        (nextLine.length > line.length * 2) ||
        (line.match(/^[A-Z가-힣][^.!?]*$/) && line.length <= 30);
      
      if (isLikelyHeading) {
        // 이미 감지된 섹션과 겹치지 않는지 확인
        const overlaps = sections.some(s => 
          (lineStart >= s.start && lineStart < s.end) ||
          (lineEnd > s.start && lineEnd <= s.end)
        );
        
        if (!overlaps) {
          headings.push({ text: line, level: 2, position: lineStart });
          sections.push({ title: line, start: lineStart, end: lineEnd, level: 2 });
        }
      }
    }
    
    currentPosition = lineEnd + 1;
  }
  
  // 리스트 감지 (불릿 포인트, 번호 목록)
  const hasLists = /^[\s]*[-*•]\s+|^[\s]*\d+[.)]\s+/m.test(content);
  
  // 테이블 감지 (여러 줄에 걸친 패턴)
  const hasTables = /\|\s*.+\s*\|/m.test(content) && content.split('|').length > 3;
  
  return {
    headings,
    sections,
    hasLists,
    hasTables,
  };
}

/**
 * 청크가 속한 섹션 정보 찾기
 */
export function findSectionForChunk(
  chunkStart: number,
  chunkEnd: number,
  sections: Array<{ title: string; start: number; end: number; level: number }>
): { title: string; level: number } | null {
  // 청크가 포함된 섹션 찾기 (가장 가까운 상위 섹션)
  let bestMatch: { title: string; level: number } | null = null;
  let bestDistance = Infinity;
  
  for (const section of sections) {
    // 청크가 섹션 범위 내에 있거나, 섹션 바로 앞에 있는 경우
    if (chunkStart >= section.start && chunkStart < section.end) {
      const distance = chunkStart - section.start;
      if (distance < bestDistance) {
        bestMatch = { title: section.title, level: section.level };
        bestDistance = distance;
      }
    }
  }
  
  return bestMatch;
}

