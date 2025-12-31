/**
 * 잘린 텍스트 필터링 유틸리티
 * 검색 결과에서 잘린 텍스트 패턴을 감지하고 필터링
 * 
 * 목적:
 * - RAG 검색 결과 품질 향상
 * - 할루시네이션 방지 (잘린 숫자/텍스트로 인한 오해 방지)
 */

export interface TruncatedTextPattern {
  pattern: RegExp;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

/**
 * 잘린 텍스트 패턴 정의
 */
export const TRUNCATED_TEXT_PATTERNS: TruncatedTextPattern[] = [
  // 파이프로 구분된 숫자 (예: "3 | 500만")
  {
    pattern: /\d+\s*\|\s*\d+/g,
    description: '파이프로 구분된 숫자 (잘린 텍스트)',
    severity: 'high',
  },
  // 공백으로 구분된 숫자 (예: "3 500만")
  {
    pattern: /\d+\s+\d+[\s가-힣]/g,
    description: '공백으로 구분된 숫자 (잘린 텍스트 가능성)',
    severity: 'medium',
  },
  // 문장 중간에 갑자기 끝나는 패턴 (예: "500만...", "3,500만...")
  {
    pattern: /\d{1,3}(?:,\d{3})*(?:만|억|조|원|명|개|건|%|퍼센트)?\.{3,}/g,
    description: '숫자 뒤 생략 표시 (잘린 텍스트)',
    severity: 'high',
  },
  // 문장이 갑자기 끝나는 패턴 (예: "광고 등록 방법을")
  {
    pattern: /[가-힣A-Za-z]+\s*$/m,
    description: '문장이 갑자기 끝나는 패턴 (잘린 텍스트 가능성)',
    severity: 'low',
  },
  // 특수문자로 구분된 숫자 (예: "3-500만", "3_500만")
  {
    pattern: /\d+[-_]\d+/g,
    description: '특수문자로 구분된 숫자 (잘린 텍스트 가능성)',
    severity: 'medium',
  },
];

/**
 * 텍스트에 잘린 패턴이 있는지 확인
 */
export function hasTruncatedText(text: string): {
  hasTruncated: boolean;
  patterns: Array<{ pattern: string; description: string; severity: string }>;
} {
  const foundPatterns: Array<{ pattern: string; description: string; severity: string }> = [];
  
  for (const truncatedPattern of TRUNCATED_TEXT_PATTERNS) {
    const matches = text.match(truncatedPattern.pattern);
    if (matches && matches.length > 0) {
      foundPatterns.push({
        pattern: matches[0],
        description: truncatedPattern.description,
        severity: truncatedPattern.severity,
      });
    }
  }
  
  return {
    hasTruncated: foundPatterns.length > 0,
    patterns: foundPatterns,
  };
}

/**
 * 검색 결과에서 잘린 텍스트 필터링
 * severity가 'high'인 경우만 필터링 (중요한 잘린 텍스트만 제외)
 */
export function filterTruncatedSearchResults<T extends { content: string }>(
  results: T[],
  options: {
    filterHighSeverityOnly?: boolean; // true: high severity만 필터링, false: 모든 severity 필터링
    keepIfHasKeywords?: string[]; // 이 키워드가 있으면 필터링하지 않음
  } = {}
): {
  valid: T[];
  filtered: Array<{ result: T; reason: string }>;
} {
  const { filterHighSeverityOnly = true, keepIfHasKeywords = [] } = options;
  
  const valid: T[] = [];
  const filtered: Array<{ result: T; reason: string }> = [];
  
  for (const result of results) {
    const truncatedCheck = hasTruncatedText(result.content);
    
    // 키워드가 있으면 필터링하지 않음
    if (keepIfHasKeywords.length > 0) {
      const contentLower = result.content.toLowerCase();
      const hasKeywords = keepIfHasKeywords.some(keyword => 
        contentLower.includes(keyword.toLowerCase())
      );
      
      if (hasKeywords) {
        valid.push(result);
        continue;
      }
    }
    
    // 필터링 조건 확인
    if (truncatedCheck.hasTruncated) {
      const highSeverityPatterns = truncatedCheck.patterns.filter(p => p.severity === 'high');
      
      if (filterHighSeverityOnly) {
        // high severity만 필터링
        if (highSeverityPatterns.length > 0) {
          filtered.push({
            result,
            reason: highSeverityPatterns.map(p => p.description).join(', '),
          });
          continue;
        }
      } else {
        // 모든 severity 필터링
        filtered.push({
          result,
          reason: truncatedCheck.patterns.map(p => p.description).join(', '),
        });
        continue;
      }
    }
    
    valid.push(result);
  }
  
  return { valid, filtered };
}

