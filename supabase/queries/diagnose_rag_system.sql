-- RAG 시스템 진단 쿼리
-- 임베딩, 청킹, 검색 상태를 종합적으로 확인

-- 1. 전체 문서 및 청크 통계
SELECT 
    '전체 통계' as category,
    COUNT(DISTINCT d.id) as total_documents,
    COUNT(DISTINCT dc.chunk_id) as total_chunks,
    COUNT(DISTINCT CASE WHEN dc.embedding IS NOT NULL THEN dc.chunk_id END) as chunks_with_embedding,
    COUNT(DISTINCT CASE WHEN dc.embedding IS NULL THEN dc.chunk_id END) as chunks_without_embedding,
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN dc.embedding IS NOT NULL THEN dc.chunk_id END) / NULLIF(COUNT(DISTINCT dc.chunk_id), 0), 2) as embedding_coverage_percent
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.status = 'indexed';

-- 2. 문서 타입별 통계
SELECT 
    '타입별 통계' as category,
    d.type,
    d.source_vendor,
    COUNT(DISTINCT d.id) as document_count,
    COUNT(DISTINCT dc.chunk_id) as chunk_count,
    COUNT(DISTINCT CASE WHEN dc.embedding IS NOT NULL THEN dc.chunk_id END) as embedded_chunks,
    ROUND(AVG(LENGTH(dc.content)), 0) as avg_chunk_length
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.status = 'indexed'
GROUP BY d.type, d.source_vendor
ORDER BY d.type, d.source_vendor;

-- 3. 임베딩 차원 확인 (샘플)
SELECT 
    '임베딩 차원 확인' as category,
    dc.chunk_id,
    d.title,
    -- 벡터를 텍스트로 변환하여 차원 추정 (쉼표 개수 + 1)
    (LENGTH(dc.embedding::text) - LENGTH(REPLACE(dc.embedding::text, ',', '')) + 1) as estimated_dimension,
    -- 벡터가 모두 0인지 확인
    CASE 
        WHEN dc.embedding::text = REPEAT('0,', (LENGTH(dc.embedding::text) - LENGTH(REPLACE(dc.embedding::text, ',', '')))) || '0' 
        THEN '모두 0'
        ELSE '정상'
    END as embedding_status
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE dc.embedding IS NOT NULL
  AND d.status = 'indexed'
LIMIT 10;

-- 4. 청크 크기 분포
SELECT 
    '청크 크기 분포' as category,
    CASE 
        WHEN LENGTH(dc.content) < 100 THEN '0-100자'
        WHEN LENGTH(dc.content) < 500 THEN '100-500자'
        WHEN LENGTH(dc.content) < 1000 THEN '500-1000자'
        WHEN LENGTH(dc.content) < 2000 THEN '1000-2000자'
        ELSE '2000자 이상'
    END as chunk_size_range,
    COUNT(*) as chunk_count,
    ROUND(AVG(LENGTH(dc.content)), 0) as avg_length,
    MIN(LENGTH(dc.content)) as min_length,
    MAX(LENGTH(dc.content)) as max_length
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE d.status = 'indexed'
GROUP BY chunk_size_range
ORDER BY 
    CASE chunk_size_range
        WHEN '0-100자' THEN 1
        WHEN '100-500자' THEN 2
        WHEN '500-1000자' THEN 3
        WHEN '1000-2000자' THEN 4
        ELSE 5
    END;

-- 5. 벤더별 문서 및 청크 통계
SELECT 
    '벤더별 통계' as category,
    COALESCE(d.source_vendor, 'UNKNOWN') as vendor,
    COUNT(DISTINCT d.id) as document_count,
    COUNT(DISTINCT dc.chunk_id) as chunk_count,
    COUNT(DISTINCT CASE WHEN dc.embedding IS NOT NULL THEN dc.chunk_id END) as embedded_chunks,
    ROUND(AVG(LENGTH(dc.content)), 0) as avg_chunk_length
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.status = 'indexed'
GROUP BY d.source_vendor
ORDER BY document_count DESC;

-- 6. 최근 처리된 문서 (상위 10개)
SELECT 
    '최근 문서' as category,
    d.id,
    d.title,
    d.type,
    d.source_vendor,
    d.status,
    d.chunk_count,
    d.updated_at,
    COUNT(dc.chunk_id) as actual_chunk_count,
    COUNT(CASE WHEN dc.embedding IS NOT NULL THEN 1 END) as embedded_count
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.status = 'indexed'
GROUP BY d.id, d.title, d.type, d.source_vendor, d.status, d.chunk_count, d.updated_at
ORDER BY d.updated_at DESC
LIMIT 10;

-- 7. 임베딩 품질 확인 (모두 0인 임베딩 검사)
SELECT 
    '임베딩 품질' as category,
    COUNT(*) as total_chunks,
    COUNT(CASE WHEN dc.embedding::text LIKE REPEAT('0,', 1023) || '0' THEN 1 END) as zero_embeddings,
    COUNT(CASE WHEN dc.embedding::text NOT LIKE REPEAT('0,', 1023) || '0' THEN 1 END) as valid_embeddings,
    ROUND(100.0 * COUNT(CASE WHEN dc.embedding::text NOT LIKE REPEAT('0,', 1023) || '0' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as valid_percent
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE dc.embedding IS NOT NULL
  AND d.status = 'indexed';

-- 8. 청크 중복 확인
SELECT 
    '청크 중복 확인' as category,
    dc.document_id,
    COUNT(*) as total_chunks,
    COUNT(DISTINCT dc.content) as unique_contents,
    COUNT(*) - COUNT(DISTINCT dc.content) as duplicate_count
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE d.status = 'indexed'
GROUP BY dc.document_id
HAVING COUNT(*) - COUNT(DISTINCT dc.content) > 0
ORDER BY duplicate_count DESC
LIMIT 10;


