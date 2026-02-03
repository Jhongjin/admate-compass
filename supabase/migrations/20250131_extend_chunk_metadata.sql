-- 청크 메타데이터 스키마 확장
-- 작성일: 2025-01-31
-- 목적: 적응적 청킹 시스템의 향상된 메타데이터를 저장하기 위한 스키마 확장

-- 1. document_chunks 테이블의 metadata JSONB 컬럼이 이미 존재하는지 확인
-- (이미 존재한다면 추가 작업 없음)

-- 2. 메타데이터 스키마 검증 함수 생성
CREATE OR REPLACE FUNCTION validate_chunk_metadata(metadata_json JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- 필수 필드 확인
  IF NOT (metadata_json ? 'document_id' AND metadata_json ? 'chunk_index') THEN
    RETURN FALSE;
  END IF;
  
  -- 선택적 필드 타입 검증
  IF metadata_json ? 'chunk_type' THEN
    IF NOT (metadata_json->>'chunk_type' IN ('text', 'table', 'image', 'title', 'qa', 'article', 'section')) THEN
      RETURN FALSE;
    END IF;
  END IF;
  
  IF metadata_json ? 'importance' THEN
    IF (metadata_json->>'importance')::float < 0 OR (metadata_json->>'importance')::float > 1 THEN
      RETURN FALSE;
    END IF;
  END IF;
  
  IF metadata_json ? 'confidence' THEN
    IF (metadata_json->>'confidence')::float < 0 OR (metadata_json->>'confidence')::float > 1 THEN
      RETURN FALSE;
    END IF;
  END IF;
  
  RETURN TRUE;
END;
$$;

-- 3. 메타데이터 인덱스 생성 (검색 성능 향상)
-- chunk_type 인덱스 (B-tree 사용, TEXT 타입이므로)
CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata_chunk_type
ON document_chunks ((metadata->>'chunk_type'))
WHERE (metadata->>'chunk_type') IS NOT NULL;

-- importance 인덱스 (높은 중요도 청크 우선 검색)
CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata_importance
ON document_chunks (((metadata->>'importance')::float) DESC NULLS LAST)
WHERE (metadata->>'importance') IS NOT NULL;

-- section_title 인덱스 (B-tree 사용, TEXT 타입이므로)
CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata_section_title
ON document_chunks ((metadata->>'section_title'))
WHERE (metadata->>'section_title') IS NOT NULL;

-- keywords 인덱스 (JSONB 배열이므로 GIN 사용, jsonb_path_ops 지정)
CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata_keywords
ON document_chunks USING GIN ((metadata->'keywords') jsonb_path_ops)
WHERE (metadata->'keywords') IS NOT NULL;

-- 4. 메타데이터 통계 함수 생성
CREATE OR REPLACE FUNCTION get_chunk_metadata_stats()
RETURNS TABLE (
  chunk_type TEXT,
  total_count BIGINT,
  avg_importance NUMERIC,
  avg_confidence NUMERIC,
  avg_chunk_size NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(metadata->>'chunk_type', 'unknown')::TEXT as chunk_type,
    COUNT(*)::BIGINT as total_count,
    ROUND(AVG((metadata->>'importance')::NUMERIC), 3) as avg_importance,
    ROUND(AVG((metadata->>'confidence')::NUMERIC), 3) as avg_confidence,
    ROUND(AVG(LENGTH(content))::NUMERIC, 0) as avg_chunk_size
  FROM document_chunks
  GROUP BY metadata->>'chunk_type'
  ORDER BY total_count DESC;
END;
$$;

-- 5. 중요도 기반 검색 함수 (향후 활용)
CREATE OR REPLACE FUNCTION search_chunks_by_importance(
  query_embedding vector(1024),
  min_importance float DEFAULT 0.5,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  chunk_id TEXT,
  content TEXT,
  metadata JSONB,
  similarity float,
  importance float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity,
    COALESCE((dc.metadata->>'importance')::float, 0.5) as importance
  FROM document_chunks dc
  WHERE 1 - (dc.embedding <=> query_embedding) > 0.7
    AND COALESCE((dc.metadata->>'importance')::float, 0.5) >= min_importance
  ORDER BY 
    COALESCE((dc.metadata->>'importance')::float, 0.5) DESC,
    dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 6. 청크 타입별 검색 함수
CREATE OR REPLACE FUNCTION search_chunks_by_type(
  query_embedding vector(1024),
  chunk_type_filter TEXT[] DEFAULT NULL,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  chunk_id TEXT,
  content TEXT,
  metadata JSONB,
  similarity float,
  chunk_type TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity,
    COALESCE(dc.metadata->>'chunk_type', 'text')::TEXT as chunk_type
  FROM document_chunks dc
  WHERE 1 - (dc.embedding <=> query_embedding) > 0.7
    AND (chunk_type_filter IS NULL OR COALESCE(dc.metadata->>'chunk_type', 'text') = ANY(chunk_type_filter))
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 7. 함수 권한 설정
GRANT EXECUTE ON FUNCTION validate_chunk_metadata(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION get_chunk_metadata_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION search_chunks_by_importance(vector(1024), float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION search_chunks_by_type(vector(1024), TEXT[], int) TO authenticated;

-- 8. 통계 업데이트
ANALYZE document_chunks;

-- 사용법:
-- 메타데이터 통계 확인: SELECT * FROM get_chunk_metadata_stats();
-- 중요도 기반 검색: SELECT * FROM search_chunks_by_importance(query_vector, 0.7, 10);
-- 타입별 검색: SELECT * FROM search_chunks_by_type(query_vector, ARRAY['qa', 'article'], 10);

