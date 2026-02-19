-- 최근 처리된 문서들의 임베딩 저장 상태 확인

-- 1. 최근 처리된 문서 목록 (최근 1시간 내)
SELECT 
  d.id,
  d.title,
  d.type,
  d.status,
  d.chunk_count,
  d.created_at,
  COUNT(dc.id) as actual_chunk_count,
  COUNT(CASE WHEN dc.embedding IS NOT NULL THEN 1 END) as chunks_with_embedding,
  COUNT(CASE WHEN dc.embedding IS NULL THEN 1 END) as chunks_without_embedding
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.created_at >= NOW() - INTERVAL '1 hour'
GROUP BY d.id, d.title, d.type, d.status, d.chunk_count, d.created_at
ORDER BY d.created_at DESC;

-- 2. 임베딩이 없는 청크 확인
SELECT 
  dc.id,
  dc.document_id,
  dc.chunk_id,
  d.title as document_title,
  LENGTH(dc.content) as content_length,
  dc.embedding IS NULL as embedding_is_null,
  CASE 
    WHEN dc.embedding IS NULL THEN '임베딩 없음'
    ELSE '임베딩 정상'
  END as embedding_status,
  dc.created_at
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE d.created_at >= NOW() - INTERVAL '1 hour'
  AND dc.embedding IS NULL
ORDER BY dc.created_at DESC;

-- 3. 임베딩 차원 확인 (최근 처리된 청크들)
-- Note: pgvector의 vector 타입은 array_length를 지원하지 않으므로 텍스트로 변환 후 차원 추출
SELECT 
  dc.document_id,
  d.title as document_title,
  dc.chunk_id,
  CASE 
    WHEN dc.embedding IS NULL THEN 'NULL'
    ELSE (
      -- 텍스트로 변환 후 쉼표 개수로 차원 추정 (정확하지 않을 수 있음)
      -- 더 정확한 방법: (array_length(string_to_array(dc.embedding::text, ','), 1) - 1)
      -- 또는 정규식으로 추출
      (LENGTH(dc.embedding::text) - LENGTH(REPLACE(dc.embedding::text, ',', '')) + 1)::text || '차원 (추정)'
    )
  END as embedding_dimension,
  LENGTH(dc.content) as content_length,
  LEFT(dc.embedding::text, 50) as embedding_preview,
  dc.created_at
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE d.created_at >= NOW() - INTERVAL '1 hour'
ORDER BY dc.created_at DESC
LIMIT 50;

-- 4. 임베딩이 0으로만 채워진 청크 확인 (비정상적인 경우)
-- Note: vector 타입은 직접 배열로 변환하기 어려우므로 텍스트로 변환 후 파싱
SELECT 
  dc.document_id,
  d.title as document_title,
  dc.chunk_id,
  (LENGTH(dc.embedding::text) - LENGTH(REPLACE(dc.embedding::text, ',', '')) + 1) as embedding_dimension_estimate,
  CASE 
    WHEN dc.embedding::text LIKE '[0,0,0%' OR dc.embedding::text = '[0]' OR dc.embedding::text LIKE '[0.0,0.0,0.0%' THEN '⚠️ 모든 값이 0일 가능성'
    WHEN dc.embedding::text LIKE '[%,%,%' THEN '✅ 정상 (값 확인 필요)'
    ELSE '⚠️ 형식 확인 필요'
  END as embedding_quality,
  LEFT(dc.embedding::text, 100) as embedding_preview,
  dc.created_at
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE d.created_at >= NOW() - INTERVAL '1 hour'
  AND dc.embedding IS NOT NULL
ORDER BY dc.created_at DESC
LIMIT 50;

-- 5. 특정 문서의 임베딩 상세 확인 (최근 처리된 문서 ID 사용)
-- 예: doc_1762921250128_6lia1dr, doc_1762921252241_srqfrrj
SELECT 
  dc.id,
  dc.document_id,
  d.title as document_title,
  dc.chunk_id,
  LEFT(dc.content, 100) as content_preview,
  LENGTH(dc.content) as content_length,
  CASE 
    WHEN dc.embedding IS NULL THEN 'NULL'
    ELSE (LENGTH(dc.embedding::text) - LENGTH(REPLACE(dc.embedding::text, ',', '')) + 1)::text || '차원 (추정)'
  END as embedding_info,
  CASE 
    WHEN dc.embedding IS NULL THEN '❌ 임베딩 없음'
    WHEN dc.embedding::text = '' OR dc.embedding::text = '[]' THEN '❌ 빈 임베딩'
    WHEN dc.embedding::text LIKE '[0,0,0%' OR dc.embedding::text LIKE '[0.0,0.0,0.0%' THEN '⚠️ 모든 값이 0일 가능성'
    WHEN (LENGTH(dc.embedding::text) - LENGTH(REPLACE(dc.embedding::text, ',', '')) + 1) < 100 THEN '⚠️ 차원이 너무 작음'
    ELSE '✅ 정상'
  END as embedding_status,
  LEFT(dc.embedding::text, 150) as embedding_preview,
  dc.created_at
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
WHERE dc.document_id IN (
  'doc_1762921250128_6lia1dr',
  'doc_1762921252241_srqfrrj'
)
ORDER BY dc.document_id, dc.chunk_id;

-- 6. 전체 통계 요약
SELECT 
  COUNT(DISTINCT d.id) as total_documents,
  COUNT(dc.id) as total_chunks,
  COUNT(CASE WHEN dc.embedding IS NOT NULL THEN 1 END) as chunks_with_embedding,
  COUNT(CASE WHEN dc.embedding IS NULL THEN 1 END) as chunks_without_embedding,
  ROUND(
    COUNT(CASE WHEN dc.embedding IS NOT NULL THEN 1 END)::numeric / 
    NULLIF(COUNT(dc.id), 0) * 100, 
    2
  ) as embedding_coverage_percent,
  ROUND(AVG(CASE 
    WHEN dc.embedding IS NOT NULL 
    THEN (LENGTH(dc.embedding::text) - LENGTH(REPLACE(dc.embedding::text, ',', '')) + 1)
    ELSE NULL 
  END), 1) as avg_embedding_dimension_estimate
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.created_at >= NOW() - INTERVAL '1 hour';

