import { clarificationService } from '../src/lib/services/search/ClarificationService';

async function verifyIntelligentRulesV4() {
    console.log('🧪 지능형 재확인 규칙(V4) 최종 검증 시작...');

    // Rule 1: 질문 내 상품명 명시 시 재확인 생략 (부분 일치 강화)
    const multipleVendors = [
        { similarity: 0.55, metadata: { source_vendor: 'KAKAO' }, documentTitle: '[카카오 비즈보드 (MO)] 가이드' },
        { similarity: 0.52, metadata: { source_vendor: 'NAVER' }, documentTitle: '[네이버 검색광고] 가이드' }
    ];

    // "비즈보드 모바일" -> "비즈보드 (MO)" 매칭 확인
    const res1 = clarificationService.detectClarificationNeed(multipleVendors as any, '비즈보드 모바일 알려주세요');
    console.log(`Rule 1 (상품 키워드 매칭): ${res1.type === 'none' ? '✅' : '❌'} (${res1.type})`);

    // Rule 2: 컨텍스트 상속 (route.ts에서 searchMessage로 보정된 상황 가정)
    // searchMessage가 "카카오 비즈보드 (MO) 1페이지" 인 경우
    const res2 = clarificationService.detectClarificationNeed(multipleVendors as any, '카카오 비즈보드 (MO) 1페이지');
    console.log(`Rule 2 (컨텍스트 보정 시 스킵): ${res2.type === 'none' ? '✅' : '❌'} (${res2.type})`);

    console.log('✨ 최종 지능형 규칙 검증 완료');
}

verifyIntelligentRulesV4().catch(console.error);
