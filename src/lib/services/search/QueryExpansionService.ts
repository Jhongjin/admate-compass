/**
 * 쿼리 확장 서비스
 * 동의어/관련어를 추가하여 검색 품질 향상
 * 
 * 전략:
 * - 동의어 사전 기반 확장
 * - LLM 기반 쿼리 확장 (선택적)
 * - 도메인 특화 키워드 추가
 */

export interface QueryExpansionOptions {
  useLLM?: boolean; // LLM 기반 확장 사용 여부
  maxExpansions?: number; // 최대 확장 키워드 개수
  domain?: 'meta' | 'naver' | 'kakao' | 'google' | 'general'; // 도메인 특화 확장
}

/**
 * 동의어 사전 (도메인별)
 */
const SYNONYM_DICTIONARY: Record<string, Record<string, string[]>> = {
  meta: {
    '광고': ['광고', '애드', 'ad', 'ads', 'advertising'],
    '계정': ['계정', '어카운트', 'account'],
    '정책': ['정책', 'policy', '규정', '가이드라인'],
    '전환': ['전환', 'conversion', '컨버전'],
    'api': ['api', 'API', '에이피아이'],
    'facebook': ['facebook', '페이스북', 'fb'],
    'instagram': ['instagram', '인스타그램', 'ig'],
    'threads': ['threads', '스레드'],
  },
  naver: {
    '광고': ['광고', '애드', 'ad', 'ads'],
    '계정': ['계정', '어카운트', 'account'],
    '정책': ['정책', 'policy', '규정'],
    '검색광고': ['검색광고', '사이트검색광고', 'SA'],
    '디스플레이광고': ['디스플레이광고', '배너광고', 'DA'],
    '쇼핑광고': ['쇼핑광고', '쇼핑검색광고'],
    'advoost': ['advoost', '드부스트', 'ADVoost'],
  },
  kakao: {
    '광고': ['광고', '애드', 'ad'],
    '계정': ['계정', '어카운트'],
    '정책': ['정책', 'policy'],
  },
  google: {
    '광고': ['광고', '애드', 'ad', 'ads'],
    '계정': ['계정', '어카운트', 'account'],
    '정책': ['정책', 'policy'],
    'dv360': ['dv360', 'DV360', '디브이360'],
  },
  general: {
    '광고': ['광고', '애드', 'ad', 'ads'],
    '계정': ['계정', '어카운트', 'account'],
    '정책': ['정책', 'policy', '규정'],
  },
};

/**
 * 도메인 특화 키워드 (자동 추가)
 */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  meta: ['meta', 'facebook', 'instagram', 'threads', '페이스북', '인스타그램'],
  naver: ['naver', '네이버', 'advoost', '드부스트'],
  kakao: ['kakao', '카카오'],
  google: ['google', '구글', 'dv360'],
};

/**
 * 쿼리 확장 (동의어 사전 기반)
 */
export function expandQueryWithSynonyms(
  query: string,
  options: QueryExpansionOptions = {}
): string {
  const { domain = 'general', maxExpansions = 5 } = options;
  
  const synonyms = SYNONYM_DICTIONARY[domain] || SYNONYM_DICTIONARY.general;
  const queryLower = query.toLowerCase();
  const expandedTerms: string[] = [query]; // 원본 쿼리 포함
  
  // 각 단어에 대해 동의어 찾기
  const words = queryLower.split(/\s+/);
  
  for (const word of words) {
    // 정확한 매칭
    if (synonyms[word]) {
      expandedTerms.push(...synonyms[word].slice(0, maxExpansions));
    }
    
    // 부분 매칭 (키워드가 동의어 사전의 키에 포함되는 경우)
    for (const [key, values] of Object.entries(synonyms)) {
      if (word.includes(key) || key.includes(word)) {
        expandedTerms.push(...values.slice(0, maxExpansions));
      }
    }
  }
  
  // 중복 제거 및 원본 쿼리 우선
  const uniqueTerms = Array.from(new Set(expandedTerms));
  return uniqueTerms.join(' ');
}

/**
 * 도메인 특화 키워드 추가
 */
export function addDomainKeywords(
  query: string,
  domain: 'meta' | 'naver' | 'kakao' | 'google' | 'general' = 'general'
): string {
  const domainKeywords = DOMAIN_KEYWORDS[domain] || [];
  
  // 쿼리에 도메인 키워드가 이미 포함되어 있는지 확인
  const queryLower = query.toLowerCase();
  const hasDomainKeyword = domainKeywords.some(keyword => 
    queryLower.includes(keyword.toLowerCase())
  );
  
  // 도메인 키워드가 없으면 추가하지 않음 (노이즈 방지)
  // 대신 쿼리 자체를 반환
  return query;
}

/**
 * 쿼리 확장 (통합)
 */
export function expandQuery(
  query: string,
  options: QueryExpansionOptions = {}
): string {
  const { domain = 'general' } = options;
  
  // 1. 동의어 확장
  let expanded = expandQueryWithSynonyms(query, options);
  
  // 2. 도메인 특화 키워드는 추가하지 않음 (노이즈 방지)
  // 필요시 쿼리에서 도메인을 감지하여 자동으로 추가할 수 있음
  
  // 3. 중복 제거 및 정리
  const terms = expanded.split(/\s+/).filter(term => term.length > 0);
  const uniqueTerms = Array.from(new Set(terms));
  
  // 원본 쿼리를 첫 번째로 유지
  const originalTerms = query.split(/\s+/);
  const additionalTerms = uniqueTerms.filter(term => 
    !originalTerms.some(original => 
      original.toLowerCase() === term.toLowerCase()
    )
  );
  
  // 원본 + 추가 키워드 결합
  return [query, ...additionalTerms].join(' ').trim();
}

/**
 * LLM 기반 쿼리 확장 (선택적, 향후 구현)
 */
export async function expandQueryWithLLM(
  query: string,
  options: {
    llmService?: any; // LLM 서비스 (Claude, GPT 등)
    maxExpansions?: number;
  } = {}
): Promise<string> {
  // 향후 구현: LLM을 사용하여 쿼리 확장
  // 예: "Meta 광고 정책" → "Meta advertising policy, Facebook ad guidelines, Instagram ad rules"
  
  // 현재는 동의어 사전 기반 확장만 사용
  return expandQuery(query, { domain: 'general' });
}

