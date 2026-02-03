
/**
 * 고정 크기 텍스트 분할 서비스
 * 중기 계획: Phase 2 구현
 * 큰 파일을 고정 크기(500KB)로 분할하여 타임아웃 문제 해결
 */

export interface TextSplit {
  index: number;
  content: string;
  startChar: number;
  endChar: number;
  sizeBytes: number;
}

export interface SplitOptions {
  maxSize: number; // 기본값: 500KB (500 * 1024)
  overlap?: number; // 기본값: 0 (중기에는 overlap 없음)
}

export class SimpleTextSplitter {
  /**
   * 고정 크기로 텍스트 분할
   * @param content 원본 텍스트
   * @param options 분할 옵션
   * @returns 분할된 텍스트 배열
   */
  splitByFixedSize(
    content: string,
    options: SplitOptions = { maxSize: 500 * 1024 }
  ): TextSplit[] {
    const splits: TextSplit[] = [];
    const maxSize = options.maxSize;
    const overlap = options.overlap || 0;
    
    if (!content || content.length === 0) {
      return [];
    }
    
    // 텍스트가 maxSize보다 작으면 분할 없이 반환
    const contentSizeBytes = Buffer.byteLength(content, 'utf8');
    if (contentSizeBytes <= maxSize) {
      return [{
        index: 0,
        content: content,
        startChar: 0,
        endChar: content.length,
        sizeBytes: contentSizeBytes
      }];
    }
    
    let index = 0;
    let start = 0;
    
    while (start < content.length) {
      const end = Math.min(start + maxSize, content.length);
      let splitContent = content.slice(start, end);
      
      // 바이트 크기 확인
      let splitSizeBytes = Buffer.byteLength(splitContent, 'utf8');
      
      // 마지막 분할이 너무 작으면 이전 분할에 병합
      if (end < content.length && (contentSizeBytes - start) < maxSize * 0.3) {
        // 마지막 부분을 이전 분할에 포함
        const lastSplit = splits[splits.length - 1];
        if (lastSplit) {
          lastSplit.content = content.slice(lastSplit.startChar);
          lastSplit.endChar = content.length;
          lastSplit.sizeBytes = Buffer.byteLength(lastSplit.content, 'utf8');
          break;
        }
      }
      
      splits.push({
        index: index++,
        content: splitContent,
        startChar: start,
        endChar: end,
        sizeBytes: splitSizeBytes
      });
      
      // 다음 분할 시작 위치 (overlap 고려)
      start = end - overlap;
      
      // 마지막 분할인 경우 종료
      if (end >= content.length) {
        break;
      }
    }
    
    return splits;
  }
  
  /**
   * 분할 크기 검증
   * @param splits 분할된 텍스트 배열
   * @param maxSize 최대 크기
   * @returns 검증 통과 여부
   */
  validateSplitSize(splits: TextSplit[], maxSize: number): boolean {
    return splits.every(split => split.sizeBytes <= maxSize * 1.1); // 10% 여유
  }
  
  /**
   * 분할 통계 정보
   */
  getSplitStats(splits: TextSplit[]): {
    totalSplits: number;
    totalSizeBytes: number;
    avgSizeBytes: number;
    minSizeBytes: number;
    maxSizeBytes: number;
  } {
    if (splits.length === 0) {
      return {
        totalSplits: 0,
        totalSizeBytes: 0,
        avgSizeBytes: 0,
        minSizeBytes: 0,
        maxSizeBytes: 0
      };
    }
    
    const sizes = splits.map(s => s.sizeBytes);
    const totalSizeBytes = sizes.reduce((sum, size) => sum + size, 0);
    
    return {
      totalSplits: splits.length,
      totalSizeBytes,
      avgSizeBytes: Math.round(totalSizeBytes / splits.length),
      minSizeBytes: Math.min(...sizes),
      maxSizeBytes: Math.max(...sizes)
    };
  }
}

// 싱글톤 인스턴스
export const simpleTextSplitter = new SimpleTextSplitter();

