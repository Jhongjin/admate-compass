import { clarificationService } from '../src/lib/services/search/ClarificationService';
import { SearchResult } from '../src/lib/services/RAGSearchService';

const mockResults: SearchResult[] = [
    {
        id: '1',
        content: '네이버 쇼핑검색광고 가이드',
        similarity: 0.7,
        documentId: 'doc1',
        documentTitle: '네이버 쇼핑검색광고 (1페이지)',
        chunkIndex: 0,
        metadata: { source_vendor: 'NAVER' }
    },
    {
        id: '2',
        content: '사이트검색광고란 무엇인가',
        similarity: 0.65,
        documentId: 'doc2',
        documentTitle: '사이트검색광고란? (1페이지)',
        chunkIndex: 0,
        metadata: { source_vendor: 'NAVER' }
    }
];

function testRule1() {
    console.log('--- Test Rule 1: Product mentioned in prompt ---');
    const query = '네이버 쇼핑검색광고는 무엇인가요?';
    const result = clarificationService.detectClarificationNeed(mockResults, query);
    console.log(`Query: "${query}"`);
    console.log(`Clarification Type: ${result.type} (Expected: none)`);
    if (result.type === 'none') console.log('✅ Pass');
    else console.log('❌ Fail');
}

function testRule2_Extraction() {
    console.log('--- Test Rule 2: Extraction logic ---');
    // @ts-ignore - access private for test
    const productName = clarificationService.extractProductName('네이버 쇼핑검색광고 (1페이지)');
    console.log(`Extracted: "${productName}" (Expected: 네이버 쇼핑검색광고)`);
    if (productName === '네이버 쇼핑검색광고') console.log('✅ Pass');
    else console.log('❌ Fail');
}

testRule1();
testRule2_Extraction();
