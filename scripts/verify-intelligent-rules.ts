import { clarificationService } from '../src/lib/services/search/ClarificationService';

async function verifyIntelligentRules() {
    console.log('🧪 지능형 재확인 규칙(V3) 정밀 검증 시작...');

    // Rule 1: 질문 내 상품명 명시 시 재확인 생략
    const promptWithProduct = '카카오 비즈보드 (MO) 가이드 알려줘';
    const multipleVendors = [
        { similarity: 0.55, metadata: { source_vendor: 'KAKAO' }, documentTitle: '카카오 비즈보드 (MO)' },
        { similarity: 0.52, metadata: { source_vendor: 'NAVER' }, documentTitle: '네이버 검색광고 가이드' }
    ];
    const res1 = clarificationService.detectClarificationNeed(multipleVendors as any, promptWithProduct);
    console.log(`Rule 1 (상품명 명시 생략): ${res1.type === 'none' ? '✅' : '❌'} (${res1.type})`);

    // Rule 1 테스트 2 (공백 차이)
    const res1b = clarificationService.detectClarificationNeed(multipleVendors as any, '비즈보드 모바일 알려주세요');
    // '비즈보드 (MO)' 와 '비즈보드 모바일'은 다르지만, '비즈보드' 키워드로 체크될 수도 있음. 
    // 여기선 정확한 매칭 위주로 짬. 
    console.log(`Rule 1b (키워드 부분 매칭): ${res1b.type === 'none' ? '✅' : '❌'} (${res1b.type})`);

    // Rule 2 & 3는 route.ts 로직이므로 유닛 테스트로는 한계가 있으나,
    // ClarificationService의 currentVendorFilter 작동 확인
    const res2 = clarificationService.detectClarificationNeed(multipleVendors as any, '어떤가요?', ['KAKAO']);
    console.log(`Rule 2 (컨텍스트 상속 시 벤더 재확인 스킵): ${res2.type === 'none' ? '✅' : '❌'} (${res2.type})`);

    console.log('✨ 지능형 규칙 검증 완료');
}

verifyIntelligentRules().catch(console.error);
