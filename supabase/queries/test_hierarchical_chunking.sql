-- Phase 1.1 적응적 청킹 시스템 테스트 쿼리 모음
-- 작성일: 2025-01-31

-- ============================================
-- 1. 기본 정보 조회
-- ============================================

-- 최근 업로드된 문서 목록
SELECT 
  id,
  title,
  type,
  status,
  chunk_count,
  created_at
FROM documents
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- 2. FAQ 문서 테스트
-- ============================================

-- FAQ 패턴 감지 확인
SELECT 
  dc.chunk_id,
  dc.document_id,
  d.title as document_title,
  LEFT(dc.content, 150) as content_preview,
  dc.metadata->>'chunk_type' as chunk_type,
  dc.metadata->>'importance' as importance,
  dc.hierarchy_level
FROM document_chunks dc
JOIN documents d ON d.id = dc.document_id
WHERE dc.content ILIKE '%Q:%' 
   OR dc.content ILIKE '%질문:%'
   OR dc.content ILIKE '%A:%'
   OR dc.content ILIKE '%답변:%'
   OR dc.metadata->>'chunk_type' = 'qa'
ORDER BY dc.document_id, dc.chunk_id
LIMIT 20;

-- FAQ 청크 통계
SELECT 
  d.id as document_id,
  d.title as document_title,
  COUNT(*) as total_chunks,
  COUNT(CASE WHEN dc.metadata->>'chunk_type' = 'qa' THEN 1 END) as qa_chunks,
  COUNT(CASE WHEN dc.content ILIKE '%Q:%' OR dc.content ILIKE '%질문:%' THEN 1 END) as faq_pattern_chunks,
  ROUND(AVG(LENGTH(dc.content))::numeric, 0) as avg_chunk_size
FROM documents d
LEFT JOIN document_chunks dc ON dc.document_id = d.id
WHERE d.type IN ('pdf', 'docx', 'txt')
GROUP BY d.id, d.title
HAVING COUNT(*) > 0
ORDER BY qa_chunks DESC, total_chunks DESC;

-- ============================================
-- 3. 정책 문서 테스트
-- ============================================

-- 조항별 청킹 확인
SELECT 
  dc.chunk_id,
  dc.document_id,
  d.title as document_title,
  LEFT(dc.content, 200) as content_preview,
  dc.metadata->>'section_title' as section_title,
  dc.hierarchy_level,
  dc.parent_chunk_id
FROM document_chunks dc
JOIN documents d ON d.id = dc.document_id
WHERE (dc.content LIKE '%제%조%' 
   OR dc.content LIKE '%제%장%' 
   OR dc.content LIKE '%제%절%'
   OR dc.content LIKE '%Article%'
   OR dc.content LIKE '%Chapter%')
  AND dc.metadata->>'section_title' IS NOT NULL
ORDER BY dc.document_id, dc.chunk_id
LIMIT 20;

-- 정책 문서 계층 구조 통계
SELECT 
  d.id as document_id,
  d.title as document_title,
  dc.hierarchy_level,
  COUNT(*) as chunk_count,
  ROUND(AVG(LENGTH(dc.content))::numeric, 0) as avg_length,
  MIN(dc.metadata->>'importance')::float as min_importance,
  MAX(dc.metadata->>'importance')::float as max_importance
FROM documents d
JOIN document_chunks dc ON dc.document_id = d.id
WHERE d.type IN ('pdf', 'docx', 'txt')
  AND dc.hierarchy_level IS NOT NULL
GROUP BY d.id, d.title, dc.hierarchy_level
ORDER BY d.id, 
  CASE dc.hierarchy_level
    WHEN 'document' THEN 1
    WHEN 'section' THEN 2
    WHEN 'paragraph' THEN 3
    WHEN 'sentence' THEN 4
  END;

-- ============================================
-- 4. 마케팅 문서 테스트
-- ============================================

-- CTA 섹션 감지 확인
SELECT 
  dc.chunk_id,
  dc.document_id,
  d.title as document_title,
  LEFT(dc.content, 200) as content_preview,
  dc.metadata->>'importance' as importance,
  CASE 
    WHEN dc.content LIKE '%[CTA 섹션]%' THEN 'CTA 감지됨'
    WHEN dc.content ILIKE '%지금%주문%' OR dc.content ILIKE '%지금%구매%' THEN 'CTA 키워드 발견'
    ELSE 'CTA 없음'
  END as cta_status
FROM document_chunks dc
JOIN documents d ON d.id = dc.document_id
WHERE dc.metadata->>'importance' IS NOT NULL
ORDER BY (dc.metadata->>'importance')::float DESC NULLS LAST
LIMIT 20;

-- 중요도별 청크 분포
SELECT 
  CASE 
    WHEN (metadata->>'importance')::float >= 0.8 THEN '높음 (0.8+)'
    WHEN (metadata->>'importance')::float >= 0.5 THEN '보통 (0.5-0.8)'
    ELSE '낮음 (<0.5)'
  END as importance_level,
  COUNT(*) as chunk_count,
  ROUND(AVG((metadata->>'importance')::float)::numeric, 3) as avg_importance
FROM document_chunks
WHERE metadata->>'importance' IS NOT NULL
GROUP BY 
  CASE 
    WHEN (metadata->>'importance')::float >= 0.8 THEN '높음 (0.8+)'
    WHEN (metadata->>'importance')::float >= 0.5 THEN '보통 (0.5-0.8)'
    ELSE '낮음 (<0.5)'
  END
ORDER BY avg_importance DESC;

-- ============================================
-- 5. 계층 구조 전체 확인
-- ============================================

-- 특정 문서의 계층 구조 (함수 사용)
-- 사용법: 'YOUR_DOCUMENT_ID'를 실제 문서 ID로 교체
-- SELECT * FROM get_chunk_hierarchy('YOUR_DOCUMENT_ID');

-- 계층 레벨별 청크 개수 (전체)
SELECT 
  hierarchy_level,
  COUNT(*) as chunk_count,
  COUNT(DISTINCT document_id) as document_count,
  ROUND(AVG(LENGTH(content))::numeric, 0) as avg_length,
  MIN(LENGTH(content)) as min_length,
  MAX(LENGTH(content)) as max_length
FROM document_chunks
WHERE hierarchy_level IS NOT NULL
GROUP BY hierarchy_level
ORDER BY 
  CASE hierarchy_level
    WHEN 'document' THEN 1
    WHEN 'section' THEN 2
    WHEN 'paragraph' THEN 3
    WHEN 'sentence' THEN 4
  END;

-- 부모-자식 관계 확인
SELECT 
  p.document_id,
  d.title as document_title,
  p.chunk_id as parent_chunk_id,
  LEFT(p.content, 100) as parent_content_preview,
  p.hierarchy_level as parent_level,
  COUNT(c.chunk_id) as child_count,
  STRING_AGG(c.hierarchy_level, ', ') as child_levels
FROM document_chunks p
LEFT JOIN document_chunks c ON c.document_id = p.document_id 
  AND c.parent_chunk_id = p.chunk_id
JOIN documents d ON d.id = p.document_id
WHERE p.parent_chunk_id IS NULL
GROUP BY p.document_id, d.title, p.chunk_id, p.content, p.hierarchy_level
HAVING COUNT(c.chunk_id) > 0
ORDER BY child_count DESC
LIMIT 20;

-- ============================================
-- 6. 메타데이터 통계
-- ============================================

-- 청크 타입별 통계
SELECT 
  COALESCE(metadata->>'chunk_type', 'unknown') as chunk_type,
  COUNT(*) as chunk_count,
  ROUND(AVG(LENGTH(content))::numeric, 0) as avg_length,
  ROUND(AVG((metadata->>'importance')::float)::numeric, 3) as avg_importance,
  ROUND(AVG((metadata->>'confidence')::float)::numeric, 3) as avg_confidence
FROM document_chunks
WHERE metadata->>'chunk_type' IS NOT NULL
GROUP BY metadata->>'chunk_type'
ORDER BY chunk_count DESC;

-- 섹션 제목 통계
SELECT 
  metadata->>'section_title' as section_title,
  COUNT(*) as chunk_count,
  COUNT(DISTINCT document_id) as document_count
FROM document_chunks
WHERE metadata->>'section_title' IS NOT NULL
GROUP BY metadata->>'section_title'
ORDER BY chunk_count DESC
LIMIT 20;

-- ============================================
-- 7. 검색 테스트 (예시)
-- ============================================

-- 특정 키워드로 검색 (키워드 기반)
-- 사용법: '검색어'를 실제 검색어로 교체
-- SELECT 
--   dc.chunk_id,
--   dc.document_id,
--   d.title as document_title,
--   LEFT(dc.content, 200) as content_preview,
--   dc.metadata->>'importance' as importance,
--   dc.metadata->>'confidence' as confidence,
--   dc.hierarchy_level
-- FROM document_chunks dc
-- JOIN documents d ON d.id = dc.document_id
-- WHERE dc.content ILIKE '%검색어%'
-- ORDER BY (dc.metadata->>'importance')::float DESC NULLS LAST
-- LIMIT 10;

-- ============================================
-- 8. 문제 진단 쿼리
-- ============================================

-- 계층 구조가 없는 문서 찾기
SELECT 
  d.id,
  d.title,
  d.type,
  COUNT(dc.id) as chunk_count,
  COUNT(CASE WHEN dc.hierarchy_level IS NULL THEN 1 END) as chunks_without_hierarchy
FROM documents d
LEFT JOIN document_chunks dc ON dc.document_id = d.id
WHERE d.status = 'indexed'
GROUP BY d.id, d.title, d.type
HAVING COUNT(dc.id) > 0 AND COUNT(CASE WHEN dc.hierarchy_level IS NULL THEN 1 END) = COUNT(dc.id)
ORDER BY chunk_count DESC;

-- parent_chunk_id가 잘못 참조된 경우 찾기
SELECT 
  dc.document_id,
  dc.chunk_id,
  dc.parent_chunk_id,
  CASE 
    WHEN p.chunk_id IS NULL THEN '부모 청크를 찾을 수 없음'
    WHEN p.document_id != dc.document_id THEN '다른 문서의 청크 참조'
    ELSE '정상'
  END as status
FROM document_chunks dc
LEFT JOIN document_chunks p ON p.document_id = dc.document_id 
  AND p.chunk_id = dc.parent_chunk_id
WHERE dc.parent_chunk_id IS NOT NULL
  AND (p.chunk_id IS NULL OR p.document_id != dc.document_id)
LIMIT 20;

