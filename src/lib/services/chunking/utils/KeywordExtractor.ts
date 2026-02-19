/**
 * 키워드 추출 유틸리티
 * TF-IDF 기반 키워드 추출 및 중요도 점수 계산
 */

export interface KeywordExtractionResult {
  keywords: string[];
  importance: number; // 청크의 중요도 점수 (0-1)
}

/**
 * 텍스트에서 키워드 추출 (TF-IDF 기반)
 */
export function extractKeywords(
  content: string,
  maxKeywords: number = 5,
  documentContext?: {
    allChunks?: string[];
    documentTitle?: string;
  }
): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  // 한국어 조사 및 불용어 제거
  const koreanParticles = [
    '은', '는', '이', '가', '을', '를', '의', '와', '과', '도', '만',
    '에서', '에게', '으로', '로', '에', '의', '와', '과', '도', '만',
    '이다', '이다', '있다', '없다', '되다', '하다', '이다', '이다'
  ];

  const commonStopWords = [
    '그', '이', '저', '것', '수', '등', '및', '또한', '또는', '그리고',
    '하지만', '그러나', '따라서', '그래서', '그런데', '그러면',
    '때문', '위해', '대해', '관련', '경우', '때문', '위해'
  ];

  // 텍스트 전처리
  const processedText = content
    .replace(/[^\w\s가-힣]/g, ' ') // 특수문자 제거
    .replace(/\s+/g, ' ') // 여러 공백을 하나로
    .trim()
    .toLowerCase();

  // 단어 분리 및 필터링
  const words = processedText
    .split(/\s+/)
    .filter(word => 
      word.length > 1 && 
      !koreanParticles.includes(word) &&
      !commonStopWords.includes(word) &&
      !/^\d+$/.test(word) // 순수 숫자 제외
    );

  // 단어 빈도 계산 (TF)
  const wordFreq = new Map<string, number>();
  words.forEach(word => {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  });

  // TF-IDF 계산 (문서 컨텍스트가 있으면 IDF 적용)
  let scoredWords: Array<{ word: string; score: number }> = [];
  
  if (documentContext?.allChunks) {
    // IDF 계산을 위한 전체 문서 단어 집합
    const allWords = new Set<string>();
    documentContext.allChunks.forEach(chunk => {
      chunk.split(/\s+/).forEach(word => allWords.add(word));
    });

    // TF-IDF 점수 계산
    wordFreq.forEach((freq, word) => {
      const tf = freq / words.length; // Term Frequency
      const df = documentContext.allChunks!.filter(chunk => 
        chunk.toLowerCase().includes(word)
      ).length;
      const idf = Math.log(documentContext.allChunks!.length / (df + 1)); // Inverse Document Frequency
      const tfidf = tf * idf;
      scoredWords.push({ word, score: tfidf });
    });
  } else {
    // 단순 빈도 기반 (TF만 사용)
    wordFreq.forEach((freq, word) => {
      scoredWords.push({ word, score: freq / words.length });
    });
  }

  // 점수순 정렬 및 상위 키워드 반환
  return scoredWords
    .sort((a, b) => b.score - a.score)
    .slice(0, maxKeywords)
    .map(item => item.word);
}

/**
 * 청크의 중요도 점수 계산 (0-1)
 */
export function calculateChunkImportance(
  chunk: {
    content: string;
    position: number; // 문서 내 위치 (0-1)
    hasTitle: boolean;
    hasKeywords: boolean;
    sectionTitle?: string;
    headingLevel?: number;
  },
  documentContext?: {
    totalLength: number;
    averageChunkSize: number;
  }
): number {
  let importance = 0.5; // 기본 중요도

  // 1. 문서 위치 가중치 (앞부분이 더 중요)
  const positionWeight = 1 - (chunk.position * 0.3); // 앞부분에 가중치
  importance += positionWeight * 0.2;

  // 2. 제목 포함 여부
  if (chunk.hasTitle) {
    importance += 0.15;
  }

  // 3. 섹션 제목 포함 여부
  if (chunk.sectionTitle) {
    importance += 0.1;
  }

  // 4. 헤딩 레벨 (h1 > h2 > h3)
  if (chunk.headingLevel) {
    const headingWeight = (4 - chunk.headingLevel) / 3; // h1=1.0, h2=0.67, h3=0.33
    importance += headingWeight * 0.1;
  }

  // 5. 키워드 포함 여부
  if (chunk.hasKeywords) {
    importance += 0.05;
  }

  // 6. 청크 크기 (너무 작거나 크면 중요도 감소)
  if (documentContext) {
    const sizeRatio = chunk.content.length / documentContext.averageChunkSize;
    if (sizeRatio >= 0.7 && sizeRatio <= 1.3) {
      importance += 0.05; // 적정 크기
    }
  }

  return Math.min(1, Math.max(0, importance));
}

