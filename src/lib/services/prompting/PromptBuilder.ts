/**
 * 프롬프트 빌더
 * 모듈화된 프롬프트 컴포넌트를 조합하여 최종 프롬프트 생성
 * 
 * 목적:
 * - 프롬프트 구조 개선으로 유지보수성 향상
 * - 할루시네이션 방지 규칙 중앙 관리
 * - 벤더별 템플릿 지원
 */

// SearchResult 타입은 chat/route.ts와 호환되도록 정의
export interface SearchResult {
  id?: string;
  content: string;
  similarity?: number;
  documentId?: string;
  documentTitle?: string;
  documentUrl?: string;
  url?: string;
  chunkIndex?: number;
  sourceVendor?: string;
  metadata?: any;
}

export interface PromptComponents {
  hallucinationPrevention?: string;
  documentBasedAnswer?: string;
  vendorSpecificGuidelines?: string;
  answerFormat?: string;
  questionKeywords?: string[];
  excludedSources?: string[];
  suspiciousNumberPatterns?: string[];
}

export interface PromptBuilderOptions {
  query: string;
  originalQuery?: string;
  searchResults: SearchResult[];
  vendors?: string[];
  components?: PromptComponents;
}

export class PromptBuilder {
  /**
   * 할루시네이션 방지 규칙 생성
   */
  buildHallucinationPreventionRules(): string {
    return `🚨 **할루시네이션 방지 - 엄격한 규칙:**

**절대 금지 사항:**
1. **문서 외 정보 사용 금지**: 위에 제공된 "참고 문서"에 없는 모든 정보는 절대 사용하지 마세요
2. **추측 금지**: 문서에 명시되지 않은 내용을 "아마도", "추정됩니다", "일반적으로" 등의 표현으로 추측하지 마세요
3. **웹 검색 금지**: 인터넷 검색이나 외부 지식을 사용하지 마세요. 오직 제공된 문서만 사용하세요
4. **추론 금지**: 문서에 없는 정보를 논리적으로 추론하여 생성하지 마세요
5. **일반 지식 사용 금지**: 일반적인 광고 지식이나 업계 상식을 사용하지 마세요
6. **숫자/금액 정보 추론 금지**: 
   - 문서에 명시된 정확한 숫자나 금액만 사용하세요
   - 잘린 텍스트(예: "500만...", "3 | 500만")나 불완전한 숫자 정보는 절대 추론하거나 완성하지 마세요
   - **특히 주의**: "3 | 500만"처럼 파이프(|) 문자나 공백으로 구분된 숫자는 잘린 텍스트입니다. 절대 사용하지 마세요.
   - 문서에 "500만원"이라고 명시되지 않았다면, "500만"이라는 부분만 보고 "500만원"이라고 추론하지 마세요
   - 숫자나 금액이 불완전하거나 명확하지 않으면 "제공된 문서에서 해당 정보를 찾을 수 없습니다"라고 답변하세요
   - **숫자 패턴 검증**: "숫자 | 숫자" 또는 "숫자 | 문자" 형태는 잘린 텍스트로 간주하고 무시하세요

**필수 준수 사항:**
1. **문서 기반 답변만**: 반드시 위의 "참고 문서" 섹션에 있는 내용만을 바탕으로 답변하세요
2. **모르면 솔직히 말하기**: 문서에 없는 정보는 "제공된 문서에서 해당 정보를 찾을 수 없습니다" 또는 "문서에 명시되지 않았습니다"라고 솔직히 말하세요
3. **인라인 출처 표기 금절**: 답변 본문 내에는 \`[출처 X]\` 또는 \`(출처 X)\`와 같은 어떠한 형태의 출처 마커도 **절대** 사용하지 마세요. 출처는 답변 최하단의 [참고자료] 섹션에만 링크 형태로 나열하세요.
4. **불확실한 정보 거부**: 문서에 명확하지 않은 내용은 "문서에서 확인할 수 없습니다"라고 답변하세요
5. **숫자/금액 검증 필수**: 
   - 답변에 포함할 모든 숫자나 금액은 반드시 "참고 문서"에서 완전한 형태로 명시되어 있어야 합니다
   - "500만원", "최소 집행 금액 500만원"처럼 완전한 문장으로 명시된 경우에만 사용하세요
   - 잘린 텍스트나 불완전한 정보는 절대 사용하지 마세요
   - 의심스러우면 "제공된 문서에서 해당 정보를 찾을 수 없습니다"라고 답변하세요`;
  }

  /**
   * 문서 기반 답변 규칙 생성
   */
  buildDocumentBasedAnswerRules(query: string, originalQuery?: string, questionKeywords: string[] = []): string {
    const queryContext = originalQuery && originalQuery !== query
      ? `원본 질문: "${originalQuery}"\n추가 답변: "${query}"`
      : `질문: "${query}"`;

    return `**중요 안내:**
- 위의 "참고 문서"에 포함된 모든 정보를 충분히 검토하세요.
- 사용자 질문(${queryContext})과 관련된 모든 내용을 찾아 답변에 포함하세요.
- 예를 들어, 질문이 "연동형/비연동형"에 대한 것이라면, 참고 문서에서 "연동형", "비연동형", "방식", "지급시점", "지급방법", "정산기준", "단가" 등의 키워드가 포함된 모든 내용을 찾아 답변에 포함하세요.
- 질문이 "집행금액"에 대한 것이라면, "최소집행", "집행금액", "500만원" 등의 키워드가 포함된 모든 내용을 찾아 답변에 포함하세요.
- 참고 문서에 관련 정보가 있으면 반드시 답변에 포함하고, "찾을 수 없습니다"라고 답변하지 마세요.

${questionKeywords.length > 0 ? `**질문 핵심 키워드:** ${questionKeywords.join(', ')}\n\n` : ''}`;
  }

  /**
   * 벤더별 가이드라인 생성
   */
  buildVendorSpecificGuidelines(vendors: string[]): string | null {
    if (!vendors || vendors.length === 0) {
      return null;
    }

    const guidelines: string[] = [];

    if (vendors.includes('META')) {
      guidelines.push('- Meta (Facebook, Instagram, Threads): 각 플랫폼별 정책 차이를 명확히 구분하여 설명하세요.');
    }

    if (vendors.includes('NAVER')) {
      guidelines.push('- Naver: 네이버 광고 플랫폼의 특정 기능과 정책을 정확히 반영하세요.');
    }

    if (vendors.includes('KAKAO')) {
      guidelines.push('- Kakao: 카카오 비즈보드의 특정 기능과 정책을 정확히 반영하세요.');
    }

    if (vendors.includes('GOOGLE')) {
      guidelines.push('- Google: Google Ads의 특정 기능과 정책을 정확히 반영하세요.');
    }

    return guidelines.length > 0
      ? `**플랫폼별 특성:**\n${guidelines.join('\n')}\n`
      : null;
  }

  /**
   * 답변 형식 가이드라인 생성
   * 질문의 유형(단순/상세)에 따라 다른 지침 반환
   */
  buildAnswerFormatGuidelines(query: string, originalQuery?: string, isSimple: boolean = false): string {
    const queryContext = originalQuery && originalQuery !== query
      ? `"${originalQuery}" + "${query}"`
      : `"${query}"`;

    if (isSimple) {
      return `**답변 작성 가이드라인 (단순/확인형 질문용):**

**1. 답변 구조:**
- **핵심 답변**: 질문(${queryContext})에 대해 2~4문장 내외로 간결하고 정확하게 답변하세요. 불필요한 서술은 생략합니다.
- **[참고자료]**: 답변의 근거가 된 문서 제목을 나열하세요. (중복 제거 필수)

**2. 주의사항:**
- 간결함이 최우선입니다. 장황한 요약이나 상세 설명을 생략하고 즉각적인 정보만 제공하세요.`;
    }

    return `**답변 작성 가이드라인 (상세/절차형 질문용):**

**1. 답변 구조 (반드시 준수):**
아래 구조를 따라 답변을 작성하세요. 각 섹션 사이에는 적합한 여백을 두어 시각적 위계를 확보하세요.

---
### [핵심 요약]
- 전체 답변 내용을 2줄 내외의 핵심 포인트로 요약하세요.

### [핵심 답변]
- 질문(${queryContext})에 대한 **최종 결론 및 가장 중요한 핵심 내용**을 여기에 작성하세요. 이 섹션은 사용자에게 가장 먼저 강조되어야 합니다.

### [상세 설명]
- **논리적 위계**: 정보가 절차나 순서를 포함할 경우 **반드시 1, 2, 3... 순서대로 숫자를 증가**시켜 번호를 매기세요.
- **범주별 조직화**: 정보의 범주가 바뀔 때는 **소제목(###)**을 작성하고 그 아래에 상세 내용을 불렛 포인트(-)로 조직화하세요.
- **가독성**: 긴 문장보다는 핵심 위주의 간결한 문장을 사용하세요.

### [참고자료]
- 답변에 사용된 모든 출처의 목록을 나열하세요. 질문에 직접적인 답변의 근거가 되는 문서들만 포함하세요.
- **중복 제거**: 동일한 문서의 여러 페이지가 참조된 경우, 문서 제목으로 중복을 제거하여 **문서당 한 줄씩만** 나열세요.
---

**2. 시각적 위계 확보 (매우 중요):**
- **인라인 출처 표기 금지**: 답변 본문 중간에 \`[출처 X]\`, \`(출처 X)\` 등의 기호를 **절대 삽입하지 마세요.**
- **소제목 의무화**: 정보를 구분할 때 반드시 \`### 소제목\` 형식을 사용하세요.
- **번호 매기기 규칙**: 절차형 답변의 경우 \`1.\`, \`2.\`, \`3.\`과 같이 순차적으로 번호를 매기세요. **절대 \`1.\`을 반복하지 마세요.**`;
  }


  /**
   * 검색 결과를 참고 문서 형식으로 변환 (문장 단위 절삭 개선)
   */
  buildReferenceDocuments(searchResults: SearchResult[], excludedSources: string[] = [], suspiciousNumberPatterns: string[] = []): string {
    const validResults = searchResults.filter((result) => {
      const sourceTitle = result.documentTitle || '';
      const isExcluded = excludedSources.some(excluded => sourceTitle.includes(excluded));
      const hasSuspiciousPattern = suspiciousNumberPatterns.some(pattern => sourceTitle.includes(pattern));
      return !isExcluded && !hasSuspiciousPattern;
    });

    if (validResults.length === 0) {
      return '**참고 문서:**\n(관련 문서가 없습니다.)\n';
    }

    const MAX_LEN = 800;
    const MIN_SENTENCE_BOUND = Math.floor(MAX_LEN * 0.6); // 480자

    const documents = validResults.map((result, index) => {
      let content = result.content || '';
      const title = result.documentTitle || '문서';
      const source = result.documentUrl || result.url || result.metadata?.source || '';

      if (content.length > MAX_LEN) {
        const truncated = content.substring(0, MAX_LEN);
        // 한국어 문장 종결 및 영문 마침표 기준 마지막 위치 탐색
        const lastSentenceEnd = Math.max(
          truncated.lastIndexOf('다. '),
          truncated.lastIndexOf('요. '),
          truncated.lastIndexOf('.\n'),
          truncated.lastIndexOf('. ')
        );

        // 60% 지점(480자) 이후에 문장 종결점이 있는 경우에만 문장 단위 절삭 적용
        if (lastSentenceEnd > MIN_SENTENCE_BOUND) {
          content = truncated.substring(0, lastSentenceEnd + 1) + ' [이하 생략]';
        } else {
          // 문장 종결점을 찾지 못하면 해당 청크는 신뢰도가 낮으므로 제외 처리 (개선안 반영)
          return null;
        }
      }

      return `[출처 ${index + 1}] ${title}${source ? ` (${source})` : ''}\n${content}`;
    }).filter(doc => doc !== null).join('\n\n---\n\n');

    return `**참고 문서:**\n\n${documents || '(신뢰할 수 있는 참고 문장이 부족하여 제외되었습니다.)'}\n\n`;
  }

  /**
   * 질문 유형(단순/상세) 판별 로직
   */
  private isSimpleQuery(query: string): boolean {
    const simpleKeywords = ['있나요', '인가요', '인가요?', '있습니까', '금액은', '어디서', '언제', '누가', '무엇', '얼마'];
    const complexKeywords = ['방법', '절차', '가이드', '차이', '비교', '설명', '특징', '이유'];

    const hasSimpleKeyword = simpleKeywords.some(k => query.includes(k));
    const hasComplexKeyword = complexKeywords.some(k => query.includes(k));

    // 질문이 짧고 단순 키워드를 포함하며 복잡 키워드가 없는 경우
    return (query.length < 25 && hasSimpleKeyword && !hasComplexKeyword);
  }

  /**
   * 최종 확인 체크리스트 생성
   */
  buildFinalChecklist(query: string, excludedSources: string[] = []): string {
    return `**답변 전 최종 확인 체크리스트:**
1. 답변에 포함된 모든 정보가 "참고 문서"에 정확히 명시되어 있는가?
2. 숫자나 금액 정보가 문장 속에서 완전한 형태로 존재하는가? (잘린 텍스트 "3 | 500만" 등 사용 금지)
3. **답변 본문 내에 인라인 출처 마커([출처 X])가 절대 포함되지 않았는가?**
4. 질문("${query}")의 의도에 직결되는 정보 위주로 작성되었는가?
5. 문서에 없는 내용을 상식이나 추측으로 보완하지 않았는가?`;
  }

  /**
   * 전체 프롬프트 생성 (순서 최적화: 문서 -> 체크리스트 -> 규칙 -> 포맷)
   */
  buildPrompt(options: PromptBuilderOptions): string {
    const { query, searchResults, vendors = [], components = {} } = options;

    // 질문 유형 판별
    const isSimple = this.isSimpleQuery(query);

    // 1. 참고 문서 (문장 단위 절삭 적용)
    const referenceDocuments = this.buildReferenceDocuments(
      searchResults,
      components.excludedSources || [],
      components.suspiciousNumberPatterns || []
    );

    // 2. 최종 확인 체크리스트 (참고 문서 직후로 이동 - 개선안 3)
    const finalChecklist = this.buildFinalChecklist(query, components.excludedSources || []);

    // 3. 답변 및 할루시네이션 방지 규칙
    const documentBasedAnswer = components.documentBasedAnswer || this.buildDocumentBasedAnswerRules(query, options.originalQuery, components.questionKeywords);
    const hallucinationPrevention = components.hallucinationPrevention || this.buildHallucinationPreventionRules();

    // 4. 벤더별 가이드라인
    const vendorGuidelines = components.vendorSpecificGuidelines || this.buildVendorSpecificGuidelines(vendors);

    // 5. 답변 형식 가이드라인 (단순/상세 구분 - 개선안 2)
    const answerFormat = components.answerFormat || this.buildAnswerFormatGuidelines(query, options.originalQuery, isSimple);

    // 프롬프트 조합
    let prompt = `${referenceDocuments}\n\n${finalChecklist}\n\n${documentBasedAnswer}\n\n`;

    if (vendorGuidelines) {
      prompt += `${vendorGuidelines}\n\n`;
    }

    prompt += `${hallucinationPrevention}\n\n${answerFormat}\n\n`;
    prompt += `**⚠️ 금지 사항 리마인드:** 잘린 숫자(예: "3 | 500만")는 절대 사용하지 마세요.\n\n`;
    prompt += `답변:`;

    return prompt;
  }

  /**
   * 다중 상품 매칭 시 재확인 질문 생성을 위한 프롬프트
   */
  buildClarificationPrompt(query: string, options: string[]): string {
    return `당신은 사용자의 질문이 여러 상품에 해당할 때, 어떤 상품에 대해 알고 싶은지 정중하게 되묻는 AI 조수입니다.

**사용자 질문:** ${query}
**감지된 선택지:** ${options.join(', ')}

**미션:**
사용자가 위 선택지 중 하나를 선택할 수 있도록 유도하는 재확인 질문을 1줄로 작성하세요.

**작성 가이드라인:**
1. **간결성**: 부연 설명 없이 질문만 명확하게 작성하세요.
2. **친절함**: 전문적이고 정중한 톤을 유지하세요.
3. **명확성**: 선택지들이 무엇인지 질문에 포함하세요.
4. **출력**: 오직 질문 텍스트만 출력하세요. (예: "네이버 검색광고와 파워링크 중 어느 상품에 대해 안내해 드릴까요?")

질문:`;
  }
}

// 싱글톤 인스턴스
export const promptBuilder = new PromptBuilder();
