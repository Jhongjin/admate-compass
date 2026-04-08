import { clarificationService } from '../src/lib/services/search/ClarificationService';

async function verifyLogic() {
    console.log('🧪 재확인 정밀 로직 검증 시작...');

    // 1. 벤더 표기 및 선택 확인
    const vendorOptions = ['NAVER', 'KAKAO', 'META', 'GOOGLE', 'X(TWITTER)'];
    const test1 = clarificationService.findSelectedOption('트위터 선택함', vendorOptions);
    console.log(`Test 1 (트위터 선택): ${test1 === 'X(TWITTER)' ? '✅' : '❌'} (${test1})`);

    // 2. 강한 매칭 시 재확인 생략 확인
    const strongMatch = [
        { similarity: 0.85, metadata: { source_vendor: 'KAKAO' }, documentTitle: '카카오 비즈보드 가이드' },
        { similarity: 0.30, metadata: { source_vendor: 'NAVER' }, documentTitle: '네이버 검색광고 가이드' }
    ];
    const res1 = clarificationService.detectClarificationNeed(strongMatch as any);
    console.log(`Test 2 (강한 매칭 생략): ${res1.type === 'none' ? '✅' : '❌'} (${res1.type})`);

    // 3. 상위 3개 벤더 편향 확인
    const biasedMatch = [
        { similarity: 0.65, metadata: { source_vendor: 'KAKAO' } },
        { similarity: 0.62, metadata: { source_vendor: 'KAKAO' } },
        { similarity: 0.61, metadata: { source_vendor: 'KAKAO' } },
        { similarity: 0.25, metadata: { source_vendor: 'NAVER' } }
    ];
    const res2 = clarificationService.detectClarificationNeed(biasedMatch as any);
    console.log(`Test 3 (벤더 편향 생략): ${res2.type === 'none' ? '✅' : '❌'} (${res2.type})`);

    // 4. 컨텍스트 상속 상황 (이미 벤더 필터가 있는 경우)
    const multipleVendors = [
        { similarity: 0.55, metadata: { source_vendor: 'KAKAO' } },
        { similarity: 0.52, metadata: { source_vendor: 'NAVER' } }
    ];
    const res3 = clarificationService.detectClarificationNeed(multipleVendors as any, ['KAKAO']);
    console.log(`Test 4 (벤더 필터 적용 시 스킵): ${res3.type === 'none' ? '✅' : '❌'} (${res3.type})`);

    console.log('✨ 검증 완료');
}

verifyLogic().catch(console.error);
