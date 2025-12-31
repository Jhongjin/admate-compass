/**
 * 청크 경계 조정 유틸리티
 * 잘린 텍스트(특히 숫자)를 방지하기 위해 청크 경계를 조정
 */

/**
 * 청크 경계를 조정하여 잘린 텍스트 방지
 */
export function adjustChunkBoundary(
  content: string,
  chunkStart: number,
  chunkEnd: number,
  options: {
    minChunkSize?: number;
    maxChunkSize?: number;
    preserveNumbers?: boolean;
    preserveSentences?: boolean;
  } = {}
): { start: number; end: number } {
  const { 
    minChunkSize = 100, 
    maxChunkSize = 2000,
    preserveNumbers = true,
    preserveSentences = true 
  } = options;

  let adjustedStart = chunkStart;
  let adjustedEnd = chunkEnd;

  // 1. 숫자 패턴 보호
  if (preserveNumbers) {
    // 청크 시작 부분: 숫자 앞에서 시작하지 않도록
    const beforeStart = content.slice(Math.max(0, chunkStart - 50), chunkStart);
    const numberBeforePattern = /(\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?)\s*$/;
    const numberBeforeMatch = beforeStart.match(numberBeforePattern);
    if (numberBeforeMatch) {
      // 숫자 시작 위치로 조정
      const numberStart = chunkStart - beforeStart.length + (numberBeforeMatch.index || 0);
      if (numberStart < chunkStart && numberStart >= chunkStart - 100) {
        adjustedStart = numberStart;
      }
    }

    // 청크 끝 부분: 숫자 중간에서 끝나지 않도록
    const nearEnd = content.slice(
      Math.max(0, chunkEnd - 100), 
      Math.min(content.length, chunkEnd + 100)
    );
    
    // 잘린 숫자 패턴 감지 (예: "3 | 500만", "3 500만")
    const truncatedNumberPatterns = [
      /\d+\s*\|\s*\d+/,           // 파이프로 구분
      /\d+\s+\d+[\s가-힣]/,       // 공백으로 구분
      /\d+[-_]\d+/,                // 특수문자로 구분
    ];

    for (const pattern of truncatedNumberPatterns) {
      if (pattern.test(nearEnd)) {
        // 숫자 패턴 앞뒤로 경계 확장
        const numberPattern = /(\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?)\s*$/;
        const numberMatch = content.slice(adjustedStart, adjustedEnd).match(numberPattern);
        
        if (numberMatch && numberMatch.index !== undefined) {
          const numberEnd = adjustedStart + numberMatch.index + numberMatch[0].length;
          // 숫자 끝까지 포함하도록 조정 (최대 200자 확장)
          if (numberEnd > adjustedEnd && numberEnd < adjustedEnd + 200) {
            adjustedEnd = numberEnd;
          }
        }

        // 다음 숫자 시작까지 포함하도록 조정
        const nextNumberMatch = content.slice(adjustedEnd).match(/^\s*(\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?)/);
        if (nextNumberMatch && nextNumberMatch.index !== undefined) {
          const nextNumberEnd = adjustedEnd + nextNumberMatch.index + nextNumberMatch[0].length;
          if (nextNumberEnd < adjustedEnd + 200) {
            adjustedEnd = nextNumberEnd;
          }
        }
      }
    }
  }

  // 2. 문장 경계 보호
  if (preserveSentences) {
    // 청크 시작: 문장 시작으로 조정
    const beforeStart = content.slice(Math.max(0, adjustedStart - 200), adjustedStart);
    const lastSentenceEnd = Math.max(
      beforeStart.lastIndexOf('. '),
      beforeStart.lastIndexOf('! '),
      beforeStart.lastIndexOf('? '),
      beforeStart.lastIndexOf('\n\n'),
      beforeStart.lastIndexOf('\n')
    );
    
    if (lastSentenceEnd > 0 && lastSentenceEnd > beforeStart.length - 150) {
      const sentenceStart = adjustedStart - beforeStart.length + lastSentenceEnd + 2;
      if (sentenceStart < adjustedStart && sentenceStart >= adjustedStart - 150) {
        adjustedStart = sentenceStart;
      }
    }

    // 청크 끝: 문장 끝으로 조정
    const afterEnd = content.slice(adjustedEnd, Math.min(content.length, adjustedEnd + 200));
    const nextSentenceEnd = Math.min(
      afterEnd.indexOf('. ') !== -1 ? afterEnd.indexOf('. ') + 2 : Infinity,
      afterEnd.indexOf('! ') !== -1 ? afterEnd.indexOf('! ') + 2 : Infinity,
      afterEnd.indexOf('? ') !== -1 ? afterEnd.indexOf('? ') + 2 : Infinity,
      afterEnd.indexOf('\n\n') !== -1 ? afterEnd.indexOf('\n\n') + 2 : Infinity,
      afterEnd.indexOf('\n') !== -1 ? afterEnd.indexOf('\n') + 1 : Infinity
    );

    if (nextSentenceEnd < Infinity && nextSentenceEnd < 150) {
      adjustedEnd = adjustedEnd + nextSentenceEnd;
    }
  }

  // 3. 최소/최대 크기 제한
  const chunkSize = adjustedEnd - adjustedStart;
  if (chunkSize < minChunkSize) {
    // 최소 크기 확보를 위해 확장
    adjustedEnd = Math.min(content.length, adjustedStart + minChunkSize);
  } else if (chunkSize > maxChunkSize) {
    // 최대 크기 제한
    adjustedEnd = adjustedStart + maxChunkSize;
  }

  return {
    start: Math.max(0, adjustedStart),
    end: Math.min(content.length, adjustedEnd),
  };
}

/**
 * 청크 배열의 경계를 일괄 조정
 */
export function adjustChunkBoundaries(
  content: string,
  chunks: Array<{ startChar: number; endChar: number }>,
  options: {
    minChunkSize?: number;
    maxChunkSize?: number;
    preserveNumbers?: boolean;
    preserveSentences?: boolean;
  } = {}
): Array<{ start: number; end: number }> {
  return chunks.map(chunk => 
    adjustChunkBoundary(
      content,
      chunk.startChar,
      chunk.endChar,
      options
    )
  );
}

