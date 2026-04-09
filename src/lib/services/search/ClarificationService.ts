import { SearchResult } from '../RAGSearchService';

export type ClarificationType = 'none' | 'vendor' | 'product';

export interface ClarificationResult {
    type: ClarificationType;
    options: string[];
    question: string;
}

export class ClarificationService {
    /**
     * [LLM 기반] 검색 결과에서 재확인이 필요한지 판별합니다. (비동기)
     * 비용 최적화를 위해 명확한 케이스는 LLM 없이 즉시 통과시킵니다.
     */
    async detectClarificationNeedWithLLM(
        searchResults: SearchResult[],
        prompt: string = '',
        currentVendorFilter: string[] | null = null
    ): Promise<ClarificationResult> {
        if (searchResults.length === 0) {
            return { type: 'none', options: [], question: '' };
        }

        // --- 단계 1: LLM 호출 없이 통과되는 '명확한 케이스' 선별 (비용 및 속도 최적화) ---

        // 1.1. 질문 내 상품명 명시 확인 (Rule 1)
        if (this.isProductMentioned(prompt, searchResults)) {
            console.log(`[ClarificationLLM] Product name recognized in prompt, bypassing LLM.`);
            return { type: 'none', options: [], question: '' };
        }

        // 1.2. 강한 매칭(Strong Match) 확인
        if (searchResults[0].similarity > 0.8) {
            console.log(`[ClarificationLLM] Strong match (${searchResults[0].similarity.toFixed(2)}), bypassing LLM.`);
            return { type: 'none', options: [], question: '' };
        }

        // 1.3. 검색 결과 벤더가 모두 동일하거나 이미 필터링된 상태 (Rule 2)
        const activeVendors = new Set(
            searchResults
                .filter(r => r.similarity > 0.2)
                .map(r => r.metadata?.source_vendor)
                .filter(v => v && v !== 'OTHER')
        );

        if (activeVendors.size <= 1 || (currentVendorFilter && currentVendorFilter.length === 1)) {
            const vendor = currentVendorFilter?.[0] || Array.from(activeVendors)[0];
            console.log(`[ClarificationLLM] Single vendor focus detected (${vendor || 'ALL'}), bypassing LLM.`);

            // 단일 벤더 내 상품 중복만 체크 (동기 방식 재사용)
            const result = this.detectClarificationNeed(searchResults, prompt, currentVendorFilter);
            if (result.type === 'vendor') return { type: 'none', options: [], question: '' }; // 벤더 재확인은 불필요
            return result;
        }

        // --- 단계 2: 모호한 경우에만 LLM(Claude Haiku) 호출 ---

        // 상위 5개 결과 요약
        const topTitles = searchResults
            .slice(0, 5)
            .map(r => `- [${r.metadata?.source_vendor || '불명'}] ${r.documentTitle} (유사도: ${r.similarity.toFixed(2)})`)
            .join('\n');

        console.log(`[ClarificationLLM] Ambiguity detected. Calling LLM for intent analysis...`);
        const judgement = await this.askLLMForClarification(prompt, topTitles);

        if (!judgement.needsClarification) {
            return { type: 'none', options: [], question: '' };
        }

        return {
            type: judgement.type,
            options: judgement.options,
            question: judgement.question
        };
    }

    /**
     * LLM(Claude Haiku)에게 재확인 필요 여부 문의
     */
    private async askLLMForClarification(
        userPrompt: string,
        searchSummary: string
    ): Promise<{
        needsClarification: boolean;
        type: 'none' | 'vendor' | 'product';
        options: string[];
        question: string;
    }> {
        // 환경변수에서 Anthropic API 키 확인
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            console.warn('[ClarificationLLM] No Anthropic API key found, bypassing clarification.');
            return { needsClarification: false, type: 'none', options: [], question: '' };
        }

        const systemPrompt = `
당신은 광고 플랫폼 AI 어시스턴트의 의도 분석 모듈입니다.
사용자의 질문과 검색된 문서 목록을 보고, 추가 확인(Clarification)이 필요한지 판단하세요.

[판단 규칙]
1. 사용자 질문이 특정 플랫폼(네이버/카카오/메타/구글/X)을 이미 명시했다면 -> needsClarification: false
2. 사용자 질문이 특정 상품/기능을 명시했다면 -> needsClarification: false
   (예: "릴스 소재", "파워링크 키워드", "카카오 비즈보드", "전환 API" 등)
3. 검색 결과가 동일한 플랫폼의 같은 주제를 다루고 있다면 -> needsClarification: false
4. 검색 결과에 여러 플랫폼(벤더)이 혼재되어 질문 의도가 어느 쪽인지 모호한 경우 -> type: "vendor"
5. 동일 플랫폼 내에서 서로 무관한 여러 상품이 매칭되어 선택이 필요한 경우 -> type: "product"

응답은 반드시 아래 JSON 형식으로만 답하세요.
{
  "needsClarification": boolean,
  "type": "none" | "vendor" | "product",
  "options": string[],
  "question": "사용자에게 보여줄 정중한 재확인 질문"
}
`.trim();

        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001', // 사용자의 시나리오(2025년 이후)에 대응하는 최신 모델로 수정
                    max_tokens: 300,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: `사용자 질문: "${userPrompt}"\n\n검색된 문서 목록 (상위 5개):\n${searchSummary}` }
                    ],
                    temperature: 0
                })
            });

            const data = await response.json();

            // 에러 응답 처리 (예: overloaded_error)
            if (data.error || !data.content || data.content.length === 0) {
                console.warn('[ClarificationLLM] Claude API returned error or empty response, trying fallback:', data.error);
                return await this.askGPTForClarification(userPrompt, searchSummary, systemPrompt);
            }

            const text = data.content[0].text;

            // JSON 파싱 (코드 블록 제거 등 정제)
            const cleanJson = text.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            return {
                needsClarification: parsed.needsClarification || false,
                type: parsed.type || 'none',
                options: parsed.options || [],
                question: parsed.question || ''
            };
        } catch (error) {
            console.error('[ClarificationLLM] Error calling Claude LLM, trying fallback:', error);
            return await this.askGPTForClarification(userPrompt, searchSummary, systemPrompt);
        }
    }

    /**
     * Claude 장애 시 GPT를 사용하여 의도 분석 수행
     */
    private async askGPTForClarification(
        userPrompt: string,
        searchSummary: string,
        systemPrompt: string
    ): Promise<{
        needsClarification: boolean;
        type: 'none' | 'vendor' | 'product';
        options: string[];
        question: string;
    }> {
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            return { needsClarification: false, type: 'none', options: [], question: '' };
        }

        try {
            const OpenAI = (await import('openai')).default;
            const openai = new OpenAI({ apiKey: openaiKey });

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `사용자 질문: "${userPrompt}"\n\n검색된 문서 목록 (상위 5개):\n${searchSummary}` }
                ],
                temperature: 0,
                response_format: { type: 'json_object' }
            });

            const content = completion.choices[0].message.content || '{}';
            const parsed = JSON.parse(content);

            return {
                needsClarification: parsed.needsClarification || false,
                type: parsed.type || 'none',
                options: parsed.options || [],
                question: parsed.question || ''
            };
        } catch (error) {
            console.error('[ClarificationLLM] GPT Fallback failed:', error);
            return { needsClarification: false, type: 'none', options: [], question: '' };
        }
    }

    /**
     * 검색 결과에서 재확인이 필요한지 판별합니다.
     * ① 질문 내 상품명 명시 시 재확인 생략 (우선순위 높음)
     * ② 강한 매칭(0.8+) 시 생략
     * ③ 벤더 상위 3개 편향 시 생략
     */
    detectClarificationNeed(searchResults: SearchResult[], prompt: string = '', currentVendorFilter: string[] | null = null): ClarificationResult {
        if (searchResults.length === 0) {
            return { type: 'none', options: [], question: '' };
        }

        // [Rule 1] 질문 내 상품명 명시 확인
        if (this.isProductMentioned(prompt, searchResults)) {
            console.log(`[Clarification] Product name explicitly mentioned in prompt, skipping clarification.`);
            return { type: 'none', options: [], question: '' };
        }

        // [최우선순위] 강한 매칭(Strong Match) 확인
        // 최상위 결과의 유사도가 0.8 이상이면 사용자 의도가 명확한 것으로 간주하여 재확인 생략
        if (searchResults[0].similarity > 0.8) {
            console.log(`[Clarification] Strong match detected (${searchResults[0].similarity.toFixed(2)}), skipping clarification.`);
            return { type: 'none', options: [], question: '' };
        }

        // 벤더 판별을 위한 임계값 (모호한 질문 대응)
        const vendorCheckResults = searchResults.filter(r => r.similarity > 0.2);
        // 상품 판별을 위한 임계값 (조금 더 엄격)
        const productCheckResults = searchResults.filter(r => r.similarity > 0.4);

        if (vendorCheckResults.length === 0) {
            return { type: 'none', options: [], question: '' };
        }

        // 1단계: 벤더(플랫폼) 중복 확인
        // 이미 벤더 필터가 적용된 상태라면 벤더 재확인은 건너뜀
        const vendors = new Set<string>();
        if (!currentVendorFilter || currentVendorFilter.length === 0) {
            vendorCheckResults.forEach(r => {
                let vendor = r.metadata?.source_vendor;
                if (!vendor || vendor.toUpperCase() === 'OTHER') {
                    const inferred = this.inferVendorFromTitle(r.documentTitle || '');
                    if (inferred) vendor = inferred;
                    else vendor = null;
                }
                if (vendor && vendor.toUpperCase() !== 'OTHER') {
                    vendors.add(vendor.toUpperCase());
                }
            });

            // [추가] 상위 N개 벤더 편향 체크 (Top 3 Bias)
            // 상위 3개 결과가 모두 동일한 벤더에서 왔다면 하향 임계값에 걸린 다른 벤더 노이즈 무시
            const top3Vendors = new Set(searchResults.slice(0, 3).map(r => r.metadata?.source_vendor).filter(v => v && v !== 'OTHER'));
            if (top3Vendors.size === 1 && vendors.size > 1) {
                const dominantVendor = Array.from(top3Vendors)[0];
                console.log(`[Clarification] Dominant vendor detected (${dominantVendor}) in top 3, skipping vendor clarification.`);
                vendors.clear();
                vendors.add(dominantVendor);
            }
        }

        if (vendors.size > 1) {
            const sortedVendors = Array.from(vendors).sort();
            const vendorNames = sortedVendors.map(v => this.getVendorDisplayName(v));
            return {
                type: 'vendor',
                options: sortedVendors,
                question: `${vendorNames.join('와(과) ')} 중 어느 플랫폼의 정책을 확인하시겠습니까?`
            };
        }

        // 2단계: 동일 벤더 내 상품 중복 확인 (이미 벤더가 하나로 좁혀진 경우)
        const productTitles = new Set<string>();
        productCheckResults.forEach(r => {
            const title = r.documentTitle || '';
            const productName = this.extractProductName(title);
            if (productName) productTitles.add(productName);
        });

        if (productTitles.size > 1) {
            const options = Array.from(productTitles).sort();
            return {
                type: 'product',
                options,
                question: `문의하신 내용과 관련하여 ${options.join(', ')} 등 여러 상품이 확인됩니다. 어떤 상품에 대해 알려드릴까요?`
            };
        }

        return { type: 'none', options: [], question: '' };
    }

    /**
     * 제목에서 벤더명 추론
     */
    private inferVendorFromTitle(title: string): string | null {
        const lowerTitle = title.toLowerCase();
        // 네이버
        if (lowerTitle.includes('네이버') || lowerTitle.includes('naver')) return 'NAVER';
        // 카카오
        if (lowerTitle.includes('카카오') || lowerTitle.includes('kakao') || lowerTitle.includes('kakaobusiness')) return 'KAKAO';
        // 메타/페이스북/인스타그램
        if (lowerTitle.includes('메타') || lowerTitle.includes('meta') ||
            lowerTitle.includes('페이스북') || lowerTitle.includes('facebook') ||
            lowerTitle.includes('인스타그램') || lowerTitle.includes('instagram') ||
            lowerTitle.includes('인스타')) return 'META';
        // 구글
        if (lowerTitle.includes('구글') || lowerTitle.includes('google')) return 'GOOGLE';
        // X (트위터)
        if (lowerTitle.includes('트위터') || lowerTitle.includes('twitter') ||
            lowerTitle.includes(' x ') || lowerTitle.startsWith('x ') ||
            lowerTitle.includes('엑스')) return 'X(TWITTER)';

        return null;
    }

    /**
     * 사용자 질문에 검색 결과 중 특정 상품 이름이 포함되어 있는지 확인합니다.
     */
    private isProductMentioned(prompt: string, searchResults: SearchResult[]): boolean {
        if (!prompt) return false;

        const cleanPrompt = prompt.replace(/\s+/g, '').toLowerCase();

        // 0. 질문 자체가 이미 특정 상품명(예: 쇼핑검색광고, 파워링크)을 포함하고 있는지 체크
        // 검색 결과에 의존하기 전에 주요 브랜드 및 상품 키워드 확인 (재확인 생략 유도)
        const commonProducts = [
            // NAVER
            '쇼핑검색광고', '사이트검색광고', '파워링크', '쇼핑윈도', '플레이스광고', '성과형디스플레이', 'GFA', '브랜드검색', '신제품검색',
            // KAKAO
            '비즈보드', '카카오모먼트', '디스플레이광고', '메시지광고', '카카오톡채널', '싱크', 'Sync', '픽셀', 'SDK',
            // META
            '릴스', 'Reels', '인스타그램', 'Instagram', '페이스북', 'Facebook', '타겟', '맞춤타겟', '유사타겟', '픽셀', 'Pixel', '전환API', 'CAPI',
            // GOOGLE / ETC
            '검색광고', '유튜브', 'YouTube', '디스플레이', 'GDN', '앱광고', 'SA', 'DA'
        ];

        for (const p of commonProducts) {
            const cleanP = p.replace(/\s+/g, '').toLowerCase();
            if (cleanPrompt.includes(cleanP)) {
                console.log(`[Clarification] common product "${p}" found in prompt context.`);
                return true;
            }
        }

        // 상위 10개 결과의 제목 확인 (유사도 0.25 이상으로 확대)
        const candidates = searchResults
            .filter(r => r.similarity > 0.25)
            .slice(0, 10);

        for (const res of candidates) {
            const title = res.documentTitle || '';
            const cleanTitle = title.replace(/\s+/g, '').toLowerCase()
                .replace(/\(\d+페이지\)$/, ''); // 페이지 정보 제거

            if (cleanTitle.length < 2) continue;

            // 1. 전체 매칭: 제목이 질문에 포함되어 있거나 그 반대
            if (cleanPrompt.includes(cleanTitle) || cleanTitle.includes(cleanPrompt)) {
                console.log(`[Clarification] Title match found: "${cleanTitle}" in prompt.`);
                return true;
            }

            // 2. 키워드 매칭: 상세 상품명 내 핵심 단어가 포함되었는지 확인
            const productName = this.extractProductName(title);
            if (productName && productName.length >= 2) {
                const cleanProductName = productName.replace(/\s+/g, '').toLowerCase();
                if (cleanPrompt.includes(cleanProductName)) {
                    console.log(`[Clarification] Product name match found: "${cleanProductName}" in prompt.`);
                    return true;
                }

                // 상품명을 단어 단위로 쪼개어 핵심 키워드 추출
                const keywords = productName.split(/[\s()]/).filter(k => k.length >= 2);
                for (const keyword of keywords) {
                    const cleanKeyword = keyword.toLowerCase();
                    if (cleanPrompt.includes(cleanKeyword)) {
                        console.log(`[Clarification] Keyword match found: "${keyword}" in prompt.`);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * 벤더 표시 이름 반환
     */
    private getVendorDisplayName(vendor: string): string {
        const names: Record<string, string> = {
            'NAVER': '네이버',
            'KAKAO': '카카오',
            'META': '메타(페이스북/인스타그램)',
            'GOOGLE': '구글',
            'X(TWITTER)': '트위터',
        };
        return names[vendor] || vendor;
    }

    /**
     * 문서 제목에서 상품명 추출
     * 패턴: [상품명] ... 또는 (상품명) ... 등
     */
    private extractProductName(title: string): string {
        // 우선순위 0: (N페이지) 형식 제거
        let cleanTitle = title.replace(/\s*\(\d+페이지\)$/, '').trim();

        // 1. 대괄호 패턴: [상품명]
        const bracketMatch = cleanTitle.match(/\[(.*?)\]/);
        if (bracketMatch && bracketMatch[1]) {
            return bracketMatch[1].trim();
        }

        // 2. 하이픈/콜론/파이프 구분: 상품명 - ... 또는 상품명 | ...
        const splitMatch = cleanTitle.split(/[-:|]/);
        if (splitMatch.length > 1 && splitMatch[0].length < 30) {
            return splitMatch[0].trim();
        }

        // 3. 기본값: 전체 제목 (너무 길면 자름)
        return cleanTitle.length > 25 ? cleanTitle.substring(0, 25).trim() : cleanTitle;
    }

    /**
     * 사용자의 메시지가 선택지 중 하나인지 확인합니다.
     */
    findSelectedOption(message: string, options: string[]): string | null {
        const cleanMessage = message.replace(/\s+/g, '').toLowerCase();

        for (const option of options) {
            const cleanOption = option.replace(/\s+/g, '').toLowerCase();
            // 완전 일치 또는 메시지에 옵션이 포함됨
            if (cleanMessage === cleanOption || cleanMessage.includes(cleanOption)) {
                return option;
            }

            // 벤더의 경우 한글 이름도 체크
            const displayName = this.getVendorDisplayName(option).replace(/\s+/g, '').toLowerCase();
            if (cleanMessage.includes(displayName)) {
                return option;
            }
        }

        return null;
    }
}

export const clarificationService = new ClarificationService();
