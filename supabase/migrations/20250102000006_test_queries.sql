-- 테스트 쿼리 모음

-- 1. 문서 통계 확인
SELECT '=== 문서 통계 ===' as test_section;
SELECT * FROM document_stats;

-- 2. 테스트 검색 실행 (간단한 텍스트 검색)
SELECT '=== 테스트 검색 결과 ===' as test_section;
SELECT * FROM test_search_documents('테스트', 0.5, 5);

-- 3. 벡터 검색 테스트 (1024차원)
SELECT '=== 벡터 검색 결과 ===' as test_section;
SELECT * FROM search_documents(
    ARRAY_FILL(0.15, ARRAY[1024])::vector(1024),
    0.5,
    5
);

-- 4. 문서별 청크 수 확인
SELECT '=== 문서별 청크 수 ===' as test_section;
SELECT 
    d.title,
    d.type,
    COUNT(dc.id) as chunk_count,
    d.status
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
GROUP BY d.id, d.title, d.type, d.status
ORDER BY d.created_at;

-- 5. 처리 로그 확인
SELECT '=== 처리 로그 ===' as test_section;
SELECT 
    document_id,
    step,
    status,
    message,
    created_at
FROM document_processing_logs
ORDER BY created_at DESC;

-- 6. 임베딩 차원 확인
SELECT '=== 임베딩 차원 확인 ===' as test_section;
SELECT 
    chunk_id,
    length(content) as content_length,
    CASE 
        WHEN embedding IS NOT NULL THEN '1024차원 벡터 존재'
        ELSE '벡터 없음'
    END as embedding_status
FROM document_chunks
LIMIT 3;

-- 7. 벡터 유사도 계산 테스트
SELECT '=== 벡터 유사도 테스트 ===' as test_section;
SELECT 
    dc1.chunk_id as chunk1,
    dc2.chunk_id as chunk2,
    (1 - (dc1.embedding <=> dc2.embedding))::numeric(4,3) as similarity
FROM document_chunks dc1
CROSS JOIN document_chunks dc2
WHERE dc1.chunk_id != dc2.chunk_id
ORDER BY similarity DESC
LIMIT 5;
