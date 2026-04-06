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
     * 1단계: 벤더(플랫폼) 중복 확인
     * 2단계: 동일 벤더 내 상품 중복 확인
     */
    detectClarificationNeed(searchResults: SearchResult[]): ClarificationResult {
        const highSimilarityResults = searchResults.filter(r => r.similarity > 0.4);

        if (highSimilarityResults.length === 0) {
            return { type: 'none', options: [], question: '' };
        }

        // 1단계: 벤더(플랫폼) 중복 확인
        const vendors = new Set<string>();
        highSimilarityResults.forEach(r => {
            let vendor = r.metadata?.source_vendor;
            // 벤더가 'OTHER'이거나 없는 경우 제목에서 추론
            if (!vendor || vendor.toUpperCase() === 'OTHER') {
                const inferred = this.inferVendorFromTitle(r.documentTitle || '');
                if (inferred) vendor = inferred;
            }
            if (vendor) vendors.add(vendor.toUpperCase());
        });

        if (vendors.size > 1) {
            const sortedVendors = Array.from(vendors).sort();
            const vendorNames = sortedVendors.map(v => this.getVendorDisplayName(v));
            return {
                type: 'vendor',
                options: sortedVendors,
                question: `${vendorNames.join('와(과) ')} 중 어느 플랫폼의 정책을 확인하시겠습니까?`
            };
        }

        // 2단계: 동일 벤더 내 상품 중복 확인
        // 제목에서 관보성 있는 키워드(상품명) 추출
        const productTitles = new Set<string>();
        highSimilarityResults.forEach(r => {
            const title = r.documentTitle || '';
            // 제목에서 핵심 상품명 추출 로직 (보통 대괄호나 특정 패턴 사용)
            // 예: "[성과형 디스플레이 광고] 정책 가이드" -> "성과형 디스플레이 광고"
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
        if (lowerTitle.includes('네이버') || lowerTitle.includes('naver')) return 'NAVER';
        if (lowerTitle.includes('카카오') || lowerTitle.includes('kakao')) return 'KAKAO';
        if (lowerTitle.includes('메타') || lowerTitle.includes('meta') || lowerTitle.includes('facebook') || lowerTitle.includes('instagram')) return 'META';
        if (lowerTitle.includes('구글') || lowerTitle.includes('google')) return 'GOOGLE';
        if (lowerTitle.includes('트위터') || lowerTitle.includes('twitter') || lowerTitle.includes(' x ') || lowerTitle.includes('엑스')) return 'X(TWITTER)';
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
            'X(TWITTER)': 'X(트위터)',
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
