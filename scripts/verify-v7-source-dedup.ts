async function verifyAggressiveSourceDeduplication() {
    console.log('🧪 V7 강화된 출처 중복 제거 로직 정밀 검증 시작...');

    // Mock 검색 결과 (제목이 같거나 미묘하게 다른 상황 + documentId가 다른 상황)
    const mockSearchResults = [
        { similarity: 0.90, documentId: 'doc_1', documentTitle: '제한 업종 (1페이지)' },
        { similarity: 0.88, documentId: 'doc_999', documentTitle: '제한 업종 (1페이지)' }, // 다른 ID지만 같은 제목
        { similarity: 0.85, documentId: 'doc_1', documentTitle: '제한 업종 (1페이지)' },
        { similarity: 0.80, documentId: 'doc_2', documentTitle: '카카오모먼트 결제 가이드 (1페이지)' },
        { similarity: 0.78, documentId: 'doc_2', documentTitle: '카카오모먼트 결제 가이드 (2페이지)' }
    ];

    console.log(`- 초기 검색 결과: ${mockSearchResults.length}개`);

    // route.ts의 V7 중복 제거 로직 시뮬레이션
    const finalLimit = 8;
    const uniqueDocs = new Map<string, any>();

    mockSearchResults
        .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
        .forEach(result => {
            // 1. 제목 정규화
            const rawTitle = result.documentTitle || '';
            const normalizedTitle = rawTitle.replace(/\s*\(\d+페이지\)$/, '').trim();

            // 2. 공백 및 특수문자 제거하여 고유 키 생성 (제한 업종 == 제한업종)
            const docKey = normalizedTitle.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');

            if (docKey && !uniqueDocs.has(docKey)) {
                uniqueDocs.set(docKey, result);
            }
        });

    const filteredResults = Array.from(uniqueDocs.values()).slice(0, finalLimit);

    console.log(`- 중복 제거 후 결과: ${filteredResults.length}개`);
    console.log('- 필터링된 문서 목록:');
    filteredResults.forEach((r, i) => {
        console.log(`  [${i + 1}] ${r.documentTitle} (Similarity: ${r.similarity}, Key: ${r.documentTitle.replace(/\s*\(\d+페이지\)$/, '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '')})`);
    });

    // 이제 반드시 2개여야 함! (제한 업종, 카카오모먼트)
    const isSuccess = filteredResults.length === 2 &&
        filteredResults[0].documentTitle.includes('제한 업종') &&
        filteredResults[1].documentTitle.includes('카카오모먼트');

    console.log(`\n결과 검증: ${isSuccess ? '✅ 성공' : '❌ 실패'}`);
}

verifyAggressiveSourceDeduplication().catch(console.error);
