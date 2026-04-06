import { SearchResult } from '../RAGSearchService';

export type ClarificationType = 'none' | 'vendor' | 'product';

export interface ClarificationResult {
    type: ClarificationType;
    options: string[];
    question: string;
}

export class ClarificationService {
    /**
     * 검색 결과에서 재확인이 필요한지 판별합니다.
     * 1단계: 벤더(플랫폼) 중복 확인 (이미 필터링된 경우 스킵)
     * 2단계: 동일 벤더 내 상품 중복 확인
     */
    detectClarificationNeed(searchResults: SearchResult[], currentVendorFilter: string[] | null = null): ClarificationResult {
        if (searchResults.length === 0) {
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
        // 1. 대괄호 패턴: [상품명]
        const bracketMatch = title.match(/\[(.*?)\]/);
        if (bracketMatch && bracketMatch[1]) {
            return bracketMatch[1].trim();
        }

        // 2. 하이픈/콜론 구분: 상품명 - ...
        const splitMatch = title.split(/[-:]/);
        if (splitMatch.length > 1 && splitMatch[0].length < 30) {
            return splitMatch[0].trim();
        }

        // 3. 기본값: 전체 제목 (너무 길면 자름)
        return title.length > 20 ? title.substring(0, 20).trim() : title;
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
