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
3. **출처 명시 필수**: 모든 답변의 해당 문장 끝 또는 문단 끝에 \`[출처 X]\` 형태로 출처를 반드시 명시하세요. (예: ...라고 명시되어 있습니다. [출처 1])
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
  buildDocumentBasedAnswerRules(query: string, questionKeywords: string[] = []): string {
    return `**중요 안내:**
- 위의 "참고 문서"에 포함된 모든 정보를 충분히 검토하세요.
- 사용자 질문과 관련된 모든 내용을 찾아 답변에 포함하세요.
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
   */
  buildAnswerFormatGuidelines(query: string): string {
    return `**답변 작성 가이드라인 (가독성 최우선):**

**1. 답변 구조 (반드시 준수):**
아래 구조를 따라 답변을 작성하세요. 각 섹션 사이에는 적합한 여백을 두어 시각적 위계를 확보하세요.

---
### [핵심 요약]
- 전체 답변 내용을 2줄 내외의 핵심 포인트로 요약하세요.

### [핵심 답변]
- 질문("${query}")에 대한 **최종 결론 및 가장 중요한 핵심 내용**을 여기에 작성하세요. 이 섹션은 사용자에게 가장 먼저 강조되어야 합니다.

### [상세 설명]
- **범주별 조직화**: 정보의 범주가 바뀔 때는 반드시 **소제목(###)**을 작성하고 그 아래에 상세 내용을 불렛 포인트(-)로 조직화하세요.
- **가독성**: 긴 문장보다는 핵심 위주의 간결한 문장을 사용하세요. 문단 사이에는 적절한 여백을 두세요.

### [참고자료]
- 답변에 사용된 모든 출처의 목록을 나열하세요. 질문에 직접적인 답변의 근거가 되는 문서들만 포함하세요.
---

**2. 시각적 위계 확보 (매우 중요):**
- **소제목 의무화**: 정보를 구분할 때 단순히 **굵은 글씨**만 사용하지 말고, 반드시 \`### 소제목\` 형식을 사용하여 시각적 위계를 만드세요.
- **불렛 포인트 활용**: 상세 나열 단계에서는 반드시 불렛 포인트를 사용하여 가독성을 높이세요.
- **핵심 정보 강조**: 숫자나 핵심 키워드는 **두껍게** 표시하세요.

**3. 기타 주의사항:**
- **검증 계획 (비공개)**: 답변을 작성하기 전, 문서 내의 어떤 구체적인 부분이 질문에 대한 근거가 되는지 스스로 먼저 확인하세요.
- **정보 부족 시**: 질문과 관련된 정보가 문서에 없거나 불완전하면 절대 추측하지 말고 "제공된 문서에서 관련 정보를 찾을 수 없습니다. 추가 정보가 필요하시면 담당팀에 문의해주세요"라고 답변하세요.
- **자가 진단**: 답변의 각 문장이 실제 문서의 몇 행/몇 단락에 근거하는지 스스로 확인하고, 확신이 80% 미만인 정보는 제외하세요.`;
  }

  /**
   * 검색 결과를 참고 문서 형식으로 변환
   */
  buildReferenceDocuments(searchResults: SearchResult[], excludedSources: string[] = [], suspiciousNumberPatterns: string[] = []): string {
    const validResults = searchResults.filter((result, index) => {
      // 제외된 출처 필터링
      const sourceTitle = result.documentTitle || '';
      const isExcluded = excludedSources.some(excluded => sourceTitle.includes(excluded));

      // 의심스러운 숫자 패턴이 있는 출처 필터링
      const hasSuspiciousPattern = suspiciousNumberPatterns.some(pattern => sourceTitle.includes(pattern));

      return !isExcluded && !hasSuspiciousPattern;
    });

    if (validResults.length === 0) {
      return '**참고 문서:**\n(관련 문서가 없습니다.)\n';
    }

    const documents = validResults.map((result, index) => {
      const content = result.content || '';
      const title = result.documentTitle || '문서';
      const source = result.documentUrl || result.url || result.metadata?.source || '';

      return `[출처 ${index + 1}] ${title}${source ? ` (${source})` : ''}\n${content.substring(0, 800)}`;
    }).join('\n\n---\n\n');

    return `**참고 문서:**\n\n${documents}\n\n`;
  }

  /**
   * 최종 확인 체크리스트 생성
   */
  buildFinalChecklist(query: string, excludedSources: string[] = []): string {
    return `**답변 전 최종 확인 체크리스트:**
1. 답변에 포함된 모든 정보가 "참고 문서"에 명시되어 있는가?
2. 답변의 모든 내용이 사용자 질문("${query}")과 직접 관련이 있는가?
3. 숫자나 금액 정보가 완전한 형태로 문서에 명시되어 있는가? 
   - 잘린 텍스트 아님 (예: "3 | 500만" 같은 패턴 제외)
   - 파이프(|) 문자나 공백으로 구분된 숫자는 사용하지 않았는가?
4. 모든 정보에 출처가 명시되어 있는가?
5. 문서에 없는 정보를 추론하거나 생성하지 않았는가?
${excludedSources.length > 0 ? `6. **제외된 출처 목록에 있는 출처를 참조하지 않았는가?** (제외된 출처: ${excludedSources.join(', ')})` : ''}`;
  }

  /**
   * 전체 프롬프트 생성
   */
  buildPrompt(options: PromptBuilderOptions): string {
    const { query, searchResults, vendors = [], components = {} } = options;

    // 검색 결과를 참고 문서로 변환
    const referenceDocuments = this.buildReferenceDocuments(
      searchResults,
      components.excludedSources || [],
      components.suspiciousNumberPatterns || []
    );

    // 각 컴포넌트 생성
    const documentBasedAnswer = components.documentBasedAnswer || this.buildDocumentBasedAnswerRules(query, components.questionKeywords);
    const vendorGuidelines = components.vendorSpecificGuidelines || this.buildVendorSpecificGuidelines(vendors);
    const hallucinationPrevention = components.hallucinationPrevention || this.buildHallucinationPreventionRules();
    const answerFormat = components.answerFormat || this.buildAnswerFormatGuidelines(query);
    const finalChecklist = this.buildFinalChecklist(query, components.excludedSources || []);

    // 프롬프트 조합
    let prompt = `${referenceDocuments}\n\n${documentBasedAnswer}\n\n`;

    if (vendorGuidelines) {
      prompt += `${vendorGuidelines}\n\n`;
    }

    prompt += `${hallucinationPrevention}\n\n${answerFormat}\n\n${finalChecklist}\n\n**⚠️ 절대 사용 금지 예시:**\n`;
    prompt += `- "3 | 500만" → 이것은 잘린 텍스트입니다. "500만"이라고 추론하지 마세요.\n`;
    prompt += `- 위와 같은 패턴이 있으면 해당 숫자 정보는 완전히 무시하고, "제공된 문서에서 해당 정보를 찾을 수 없습니다"라고 답변하세요.\n\n`;
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
