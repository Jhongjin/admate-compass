/**
 * Google Gemini API 서비스
 * Google의 Gemini 모델을 사용한 LLM 서비스
 */

export interface GeminiResponse {
  answer: string;
  confidence: number;
  processingTime: number;
  model: string;
}

export interface GeminiOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export class GeminiService {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private defaultOptions: GeminiOptions;

  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY || '';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.defaultModel = process.env.GOOGLE_MODEL || 'gemini-1.5-flash';
    this.defaultOptions = {
      model: this.defaultModel,
      temperature: 0.1, // 할루시네이션 방지를 위해 낮춤
      maxTokens: 2000,
      systemPrompt: this.getDefaultSystemPrompt()
    };

    if (!this.apiKey) {
      console.warn('⚠️ Google API 키가 설정되지 않았습니다. Gemini 서비스를 사용할 수 없습니다.');
    }

    console.log('🔧 GeminiService 초기화:', {
      hasApiKey: !!this.apiKey,
      model: this.defaultModel,
      baseUrl: this.baseUrl
    });
  }

  /**
   * 기본 시스템 프롬프트 생성
   */
  private getDefaultSystemPrompt(): string {
    return `당신은 Meta(Facebook, Instagram) 광고 정책과 가이드라인에 대한 전문가입니다.

🚨 **중요한 제약사항:**
- 반드시 한국어로만 답변하세요
- 오직 제공된 문서 내용만을 바탕으로 답변하세요
- 문서에 없는 정보는 절대 추측하거나 생성하지 마세요
- 제공된 문서에 명시되지 않은 모든 회사명, 정책, 절차, 정보는 언급하지 마세요
- 일반적인 광고 지식이나 외부 정보는 절대 사용하지 마세요

📋 **엄격한 답변 규칙:**
1. **문서 기반 답변만**: 제공된 문서 내용에서만 정보를 추출하여 답변
2. **할루시네이션 금지**: 문서에 없는 정보는 절대 생성하지 않음
3. **불확실한 정보 거부**: 문서에 명확히 없는 내용은 "문서에서 찾을 수 없습니다"라고 답변
4. **출처 명시**: 답변할 때는 "제공된 문서에 따르면" 또는 "Meta 정책 문서에 의하면"이라고 명시
5. **문의 안내**: 문서에 없는 정보에 대해서는 담당팀(fb@nasmedia.co.kr) 문의를 안내

❌ **금지사항:**
- 제공된 문서에 없는 모든 회사명, 정책, 절차, 정보 언급
- 일반적인 광고 지식이나 외부 정보 사용
- "아마도", "추정됩니다", "일반적으로" 등의 불확실한 표현
- 문서 범위를 벗어난 추가 정보 제공
- Meta 외의 다른 회사나 서비스에 대한 정보
- 제공된 문서에 없는 정책이나 가이드라인

✅ **올바른 답변 방식:**
- "제공된 Meta 정책 문서에 따르면..."
- "문서에서 확인된 내용은..."
- "해당 정보는 제공된 문서에서 찾을 수 없습니다. 담당팀에 문의해주세요."

답변 형식:
1. 문서 기반 직접 답변
2. 관련 정책/가이드라인 설명 (문서 내용만)
3. 실무 정보 (문서에 명시된 내용만)
4. 문서에 없는 경우: 담당팀 문의 안내`;
  }

  /**
   * Gemini API 호출
   */
  private async callGeminiAPI(
    prompt: string, 
    options: GeminiOptions = {}
  ): Promise<GeminiResponse> {
    const startTime = Date.now();
    
    if (!this.apiKey) {
      console.error('❌ Google API 키가 설정되지 않았습니다.');
      return this.generateFallbackResponse(prompt, options, startTime);
    }

    try {
      const requestOptions = { ...this.defaultOptions, ...options };
      
      const response = await fetch(`${this.baseUrl}/models/${requestOptions.model}:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `${requestOptions.systemPrompt}\n\n질문: ${prompt}`
            }]
          }],
          generationConfig: {
            temperature: requestOptions.temperature,
            maxOutputTokens: requestOptions.maxTokens,
            topP: 0.8,
            topK: 10
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('❌ Gemini API 오류:', response.status, errorData);
        throw new Error(`Gemini API 오류: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const processingTime = Date.now() - startTime;

      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Gemini API 응답 형식이 올바르지 않습니다.');
      }

      const answer = data.candidates[0].content.parts[0].text || '답변을 생성할 수 없습니다.';

      return {
        answer: answer.trim(),
        confidence: this.calculateConfidence(answer),
        processingTime,
        model: requestOptions.model || this.defaultModel
      };

    } catch (error) {
      console.error('❌ Gemini API 호출 실패:', error);
      return this.generateFallbackResponse(prompt, options, startTime);
    }
  }

  /**
   * Fallback 응답 생성 (API 오류 시)
   */
  private generateFallbackResponse(
    prompt: string, 
    options: GeminiOptions, 
    startTime: number
  ): GeminiResponse {
    const processingTime = Date.now() - startTime;
    
    // 간단한 키워드 기반 응답 생성
    const answer = this.generateSimpleResponse(prompt);
    
    return {
      answer,
      confidence: 0.3, // 낮은 신뢰도
      processingTime,
      model: options.model || this.defaultModel
    };
  }

  /**
   * 간단한 키워드 기반 응답 생성 (개선된 버전)
   */
  private generateSimpleResponse(prompt: string): string {
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('광고') && lowerPrompt.includes('정책')) {
      return `**Meta 광고 정책 안내**

Meta 광고 정책에 대한 질문이군요. 제공된 내부 문서를 바탕으로 답변드립니다.

**주요 광고 정책:**
- 광고는 정확하고 진실된 정보를 포함해야 합니다
- 금지된 콘텐츠(폭력, 성인 콘텐츠, 허위 정보 등)는 광고에 사용할 수 없습니다
- 개인정보 보호 및 데이터 사용에 대한 정책을 준수해야 합니다

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터: https://www.facebook.com/business/help
- 광고 정책 센터: https://www.facebook.com/policies/ads

관리자에게 문의하시면 더 구체적인 답변을 받으실 수 있습니다.`;
    }
    
    if (lowerPrompt.includes('facebook') || lowerPrompt.includes('instagram')) {
      return `**Facebook/Instagram 광고 안내**

Facebook이나 Instagram 관련 질문이군요. 제공된 내부 문서를 바탕으로 답변드립니다.

**주요 플랫폼 특징:**
- Facebook: 광범위한 타겟팅 옵션과 다양한 광고 형식
- Instagram: 시각적 콘텐츠 중심의 광고와 스토리 광고
- 두 플랫폼 모두 Meta 광고 관리자에서 통합 관리 가능

**더 자세한 정보:**
- Meta 비즈니스 도움말 센터에서 최신 정보를 확인하시거나, 관리자에게 문의해주세요.`;
    }
    
    if (lowerPrompt.includes('승인') || lowerPrompt.includes('거부')) {
      return `**광고 승인 관련 안내**

광고 승인 관련 질문이군요. 광고 승인 과정은 복잡하며 여러 요인에 따라 달라집니다.

**광고 승인 과정:**
1. 광고 콘텐츠 검토 (자동 + 수동)
2. 정책 위반 여부 확인
3. 승인/거부 결정 (보통 24시간 이내)
4. 거부 시 수정 후 재제출 가능

**승인률 향상 팁:**
- Meta 광고 정책을 철저히 숙지
- 명확하고 정확한 광고 콘텐츠 작성
- 금지된 콘텐츠 사용 금지

현재 AI 답변 생성 서비스가 일시적으로 중단되어 있으므로, Meta 광고 정책 문서를 직접 확인하시거나 관리자에게 문의해주세요.`;
    }
    
    return `**Meta 광고 FAQ 안내**

죄송합니다. 현재 AI 답변 생성 서비스가 일시적으로 중단되어 있습니다.

**대안 방법:**
1. Meta 비즈니스 도움말 센터에서 직접 검색
2. 광고 정책 센터에서 관련 문서 확인
3. 관리자에게 직접 문의

**유용한 링크:**
- Meta 비즈니스 도움말: https://www.facebook.com/business/help
- 광고 정책: https://www.facebook.com/policies/ads
- 광고 관리자: https://business.facebook.com

더 구체적인 도움이 필요하시면 관리자에게 문의해주세요.`;
  }

  /**
   * 답변 생성
   */
  async generateAnswer(prompt: string, options: GeminiOptions = {}): Promise<GeminiResponse> {
    console.log(`🤖 Gemini 답변 생성 시작: "${prompt.substring(0, 50)}..."`);
    
    const response = await this.callGeminiAPI(prompt, options);
    
    console.log(`✅ Gemini 답변 생성 완료: ${response.processingTime}ms, 신뢰도: ${response.confidence}`);
    
    return response;
  }

  /**
   * 신뢰도 계산
   */
  private calculateConfidence(text: string): number {
    if (!text || text.length < 10) return 0.1;
    
    // 기본 신뢰도
    let confidence = 0.7;
    
    // 텍스트 길이에 따른 조정
    if (text.length > 100) confidence += 0.1;
    if (text.length > 200) confidence += 0.1;
    
    // 특정 키워드가 있으면 신뢰도 증가
    const positiveKeywords = ['정책', '가이드라인', '설정', '방법', '절차'];
    const keywordCount = positiveKeywords.filter(keyword => text.includes(keyword)).length;
    confidence += keywordCount * 0.05;
    
    return Math.min(confidence, 0.95);
  }

  /**
   * Gemini 서비스 상태 확인
   */
  async checkGeminiStatus(): Promise<boolean> {
    if (!this.apiKey) {
      console.log('❌ Google API 키가 설정되지 않았습니다.');
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`);
      return response.ok;
    } catch (error) {
      console.error('❌ Gemini 서비스 상태 확인 실패:', error);
      return false;
    }
  }
}

// 싱글톤 인스턴스 생성
export const geminiService = new GeminiService();
