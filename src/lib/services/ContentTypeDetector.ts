/**
 * 문서 콘텐츠 타입 자동 감지 서비스
 * FAQ, 정책, 마케팅, 기술 문서 등을 자동으로 분류
 * 서버 사이드에서만 사용 (API 라우트)
 */

export type ContentType = 'technical' | 'marketing' | 'policy' | 'faq' | 'general';

export interface ContentTypeDetectionResult {
  type: ContentType;
  confidence: number;
  reasoning: string;
}

export class ContentTypeDetector {
  /**
   * 문서 콘텐츠 타입 감지
   */
  detectContentType(content: string, title: string = ''): ContentTypeDetectionResult {
    const fullText = `${title}\n${content}`.toLowerCase();
    
    // FAQ 감지
    const faqScore = this.detectFAQ(fullText);
    if (faqScore > 0.7) {
      return {
        type: 'faq',
        confidence: faqScore,
        reasoning: 'FAQ 패턴 (질문/답변 형식) 감지'
      };
    }

    // 정책 문서 감지
    const policyScore = this.detectPolicy(fullText);
    if (policyScore > 0.7) {
      return {
        type: 'policy',
        confidence: policyScore,
        reasoning: '정책 문서 패턴 (조항, 장, 절 구조) 감지'
      };
    }

    // 마케팅 문서 감지
    const marketingScore = this.detectMarketing(fullText);
    if (marketingScore > 0.7) {
      return {
        type: 'marketing',
        confidence: marketingScore,
        reasoning: '마케팅 문서 패턴 (섹션, CTA 포함) 감지'
      };
    }

    // 기술 문서 감지
    const technicalScore = this.detectTechnical(fullText);
    if (technicalScore > 0.6) {
      return {
        type: 'technical',
        confidence: technicalScore,
        reasoning: '기술 문서 패턴 (코드, API, 설정 등) 감지'
      };
    }

    // 기본값
    return {
      type: 'general',
      confidence: 0.5,
      reasoning: '일반 문서로 분류'
    };
  }

  /**
   * FAQ 문서 감지
   */
  private detectFAQ(text: string): number {
    let score = 0;

    // 질문 패턴
    const questionPatterns = [
      /(?:^|\n)(?:q|질문)[:\s]/gmi,
      /(?:^|\n)\d+[\.\)]\s*[가-힣\w\s]+\?/g,
      /(?:^|\n).*\?/g,
      /(?:^|\n)(?:what|how|why|when|where|무엇|어떻게|왜|언제|어디)/gmi,
    ];
    questionPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) score += matches.length * 0.1;
    });

    // 답변 패턴
    const answerPatterns = [
      /(?:^|\n)(?:a|답변)[:\s]/gmi,
      /(?:^|\n)(?:answer|응답)[:\s]/gmi,
    ];
    answerPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) score += matches.length * 0.15;
    });

    // Q&A 쌍 비율
    const qaPairPattern = /(?:q|질문)[:\s].*?(?:a|답변)[:\s]/gmis;
    const qaPairs = text.match(qaPairPattern);
    if (qaPairs) {
      score += qaPairs.length * 0.2;
    }

    return Math.min(score, 1.0);
  }

  /**
   * 정책 문서 감지
   */
  private detectPolicy(text: string): number {
    let score = 0;

    // 정책 관련 키워드
    const policyKeywords = [
      '정책', '규정', '규칙', '지침', '가이드라인', '약관', '조건',
      '제', '조', '장', '절', '항', '목',
      'policy', 'regulation', 'rule', 'guideline', 'terms', 'condition',
      'article', 'chapter', 'section', 'clause'
    ];
    policyKeywords.forEach(keyword => {
      const regex = new RegExp(keyword, 'gi');
      const matches = text.match(regex);
      if (matches) score += matches.length * 0.05;
    });

    // 조항 구조 패턴
    const articlePatterns = [
      /제\s*\d+\s*조/g,
      /제\s*\d+\s*장/g,
      /제\s*\d+\s*절/g,
      /제\s*\d+\s*항/g,
      /article\s*\d+/gi,
      /chapter\s*\d+/gi,
      /section\s*\d+/gi,
    ];
    articlePatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) score += matches.length * 0.1;
    });

    // 법률/규정 관련 용어
    const legalTerms = ['법', '규칙', '법령', '법률', '규정', '법규'];
    legalTerms.forEach(term => {
      if (text.includes(term)) score += 0.1;
    });

    return Math.min(score, 1.0);
  }

  /**
   * 마케팅 문서 감지
   */
  private detectMarketing(text: string): number {
    let score = 0;

    // 마케팅 관련 키워드
    const marketingKeywords = [
      '프로모션', '할인', '이벤트', '특가', '혜택', '신규', '추천',
      '광고', '캠페인', '마케팅', '브랜드', '제품', '서비스',
      'promotion', 'discount', 'event', 'sale', 'benefit', 'new', 'recommend',
      'advertisement', 'campaign', 'marketing', 'brand', 'product', 'service'
    ];
    marketingKeywords.forEach(keyword => {
      const regex = new RegExp(keyword, 'gi');
      const matches = text.match(regex);
      if (matches) score += matches.length * 0.05;
    });

    // CTA (Call to Action) 패턴
    const ctaPatterns = [
      /(?:지금|지금 바로|바로|즉시|지금 즉시|당장)\s*(?:주문|구매|신청|가입|시작|체험|다운로드)/g,
      /(?:click|order|buy|apply|join|start|try|download)\s*(?:now|here|today)/gi,
      /(?:무료|무료로|무료 체험|무료 다운로드)/g,
    ];
    ctaPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) score += matches.length * 0.15;
    });

    // 마크다운 헤딩 (마케팅 문서에서 많이 사용)
    const headingCount = (text.match(/^#{1,6}\s/gm) || []).length;
    if (headingCount > 3) {
      score += 0.2;
    }

    // 이모지/특수문자 (마케팅 문서 특징)
    const emojiPattern = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    const emojiCount = (text.match(emojiPattern) || []).length;
    if (emojiCount > 0) {
      score += Math.min(emojiCount * 0.1, 0.3);
    }

    return Math.min(score, 1.0);
  }

  /**
   * 기술 문서 감지
   */
  private detectTechnical(text: string): number {
    let score = 0;

    // 기술 관련 키워드
    const technicalKeywords = [
      'api', 'sdk', 'endpoint', 'request', 'response', 'json', 'xml',
      '함수', '메서드', '클래스', '인터페이스', '모듈', '라이브러리',
      'function', 'method', 'class', 'interface', 'module', 'library',
      '설정', '환경변수', 'config', 'environment', 'variable',
      '코드', '예제', 'sample', 'example', 'tutorial'
    ];
    technicalKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) score += matches.length * 0.05;
    });

    // 코드 블록 패턴
    const codeBlockPatterns = [
      /```[\s\S]*?```/g,
      /`[^`]+`/g,
      /function\s*\(/g,
      /const\s+\w+\s*=/g,
      /class\s+\w+/g,
    ];
    codeBlockPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) score += matches.length * 0.1;
    });

    // URL/도메인 패턴
    const urlPattern = /https?:\/\/[\w\.-]+/g;
    const urlCount = (text.match(urlPattern) || []).length;
    if (urlCount > 0) {
      score += Math.min(urlCount * 0.1, 0.3);
    }

    // JSON/XML 구조
    if (/\{[\s\S]*\}/.test(text) || /<[\w\s\/]+>/.test(text)) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }
}

// 싱글톤 인스턴스
export const contentTypeDetector = new ContentTypeDetector();

