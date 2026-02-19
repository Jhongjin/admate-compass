-- 계층적 청킹 시스템 마이그레이션
-- 작성일: 2025-01-31
-- 목적: 문서 구조를 유지하면서 청킹 (문서 > 섹션 > 문단 > 문장)

-- 1. document_chunks 테이블에 계층 정보 컬럼 추가
-- parent_chunk_id: 부모 청크 참조 (NULL이면 최상위 레벨)
ALTER TABLE IF EXISTS public.document_chunks
ADD COLUMN IF NOT EXISTS parent_chunk_id TEXT;

-- hierarchy_level: 계층 레벨 (document, section, paragraph, sentence)
ALTER TABLE IF EXISTS public.document_chunks
ADD COLUMN IF NOT EXISTS hierarchy_level TEXT 
CHECK (hierarchy_level IN ('document', 'section', 'paragraph', 'sentence') OR hierarchy_level IS NULL);

-- 2. parent_chunk_id 외래키 제약조건 추가 (자기 참조)
-- 참고: chunk_id는 단독으로 UNIQUE가 아니고 (document_id, chunk_id) 복합 UNIQUE만 있습니다.
-- 따라서 복합 외래키를 사용하거나 외래키 제약조건 없이 사용해야 합니다.
-- 
-- 해결책: 복합 외래키 사용
-- parent_chunk_id는 같은 document_id 내에서만 유효하므로,
-- (document_id, parent_chunk_id) → (document_id, chunk_id) 복합 외래키 사용

DO $$
BEGIN
  -- 외래키 제약조건이 없으면 복합 외래키 추가
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_constraint 
    WHERE conname = 'document_chunks_parent_chunk_id_fkey'
  ) THEN
    -- 복합 외래키: (document_id, parent_chunk_id) → (document_id, chunk_id)
    ALTER TABLE public.document_chunks
    ADD CONSTRAINT document_chunks_parent_chunk_id_fkey
    FOREIGN KEY (document_id, parent_chunk_id) 
    REFERENCES public.document_chunks(document_id, chunk_id) 
    ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- 복합 외래키 생성 실패 시 (예: 기존 데이터 문제)
    -- 외래키 제약조건 없이 사용 (애플리케이션 레벨에서 검증)
    RAISE NOTICE '외래키 제약조건 생성 실패, 애플리케이션 레벨에서 검증 필요: %', SQLERRM;
END $$;

-- 3. 인덱스 생성 (계층 구조 검색 성능 향상)
CREATE INDEX IF NOT EXISTS idx_document_chunks_parent_chunk_id
ON public.document_chunks(parent_chunk_id)
WHERE parent_chunk_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_chunks_hierarchy_level
ON public.document_chunks(hierarchy_level)
WHERE hierarchy_level IS NOT NULL;

-- 복합 인덱스 (문서별 계층 구조 조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_hierarchy
ON public.document_chunks(document_id, hierarchy_level, parent_chunk_id)
WHERE hierarchy_level IS NOT NULL;

-- 4. 계층 구조 조회 함수 생성
CREATE OR REPLACE FUNCTION get_chunk_hierarchy(
  p_document_id TEXT,
  p_chunk_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id TEXT,
  content TEXT,
  hierarchy_level TEXT,
  parent_chunk_id TEXT,
  metadata JSONB,
  depth INTEGER,
  path TEXT[]
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_path TEXT[];
BEGIN
  RETURN QUERY
  WITH RECURSIVE chunk_tree AS (
    -- 루트 청크 (parent_chunk_id가 NULL인 청크)
    SELECT 
      dc.chunk_id,
      dc.content,
      dc.hierarchy_level,
      dc.parent_chunk_id,
      dc.metadata,
      dc.document_id,
      0 as depth,
      ARRAY[dc.chunk_id] as path
    FROM public.document_chunks dc
    WHERE dc.document_id = p_document_id
      AND (p_chunk_id IS NULL OR dc.chunk_id = p_chunk_id)
      AND dc.parent_chunk_id IS NULL
    
    UNION ALL
    
    -- 자식 청크 (복합 키로 조인: document_id와 parent_chunk_id)
    SELECT 
      dc.chunk_id,
      dc.content,
      dc.hierarchy_level,
      dc.parent_chunk_id,
      dc.metadata,
      dc.document_id,
      ct.depth + 1,
      ct.path || dc.chunk_id
    FROM public.document_chunks dc
    JOIN chunk_tree ct ON dc.document_id = ct.document_id 
      AND dc.parent_chunk_id = ct.chunk_id
    WHERE dc.document_id = p_document_id
  )
  SELECT 
    ct.chunk_id,
    ct.content,
    ct.hierarchy_level,
    ct.parent_chunk_id,
    ct.metadata,
    ct.depth,
    ct.path
  FROM chunk_tree ct
  ORDER BY ct.path;
END;
$$;

-- 5. 특정 레벨의 청크 조회 함수
CREATE OR REPLACE FUNCTION get_chunks_by_level(
  p_document_id TEXT,
  p_level TEXT
)
RETURNS TABLE (
  chunk_id TEXT,
  content TEXT,
  metadata JSONB,
  parent_chunk_id TEXT,
  sibling_count BIGINT
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
    dc.parent_chunk_id,
    COUNT(*) OVER (PARTITION BY dc.parent_chunk_id) as sibling_count
  FROM public.document_chunks dc
  WHERE dc.document_id = p_document_id
    AND dc.hierarchy_level = p_level
  ORDER BY dc.chunk_id;
END;
$$;

-- 6. 계층 구조 통계 함수
CREATE OR REPLACE FUNCTION get_hierarchy_stats(
  p_document_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  document_id TEXT,
  hierarchy_level TEXT,
  chunk_count BIGINT,
  avg_content_length NUMERIC,
  max_depth INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE chunk_tree AS (
    -- 루트 청크
    SELECT 
      dc.chunk_id,
      dc.document_id,
      dc.hierarchy_level,
      LENGTH(dc.content) as content_length,
      0 as depth
    FROM public.document_chunks dc
    WHERE (p_document_id IS NULL OR dc.document_id = p_document_id)
      AND dc.parent_chunk_id IS NULL
    
    UNION ALL
    
    -- 자식 청크 (복합 키로 조인: document_id와 parent_chunk_id)
    SELECT 
      dc.chunk_id,
      dc.document_id,
      dc.hierarchy_level,
      LENGTH(dc.content) as content_length,
      ct.depth + 1
    FROM public.document_chunks dc
    JOIN chunk_tree ct ON dc.document_id = ct.document_id 
      AND dc.parent_chunk_id = ct.chunk_id
    WHERE (p_document_id IS NULL OR dc.document_id = p_document_id)
  )
  SELECT 
    ct.document_id,
    COALESCE(ct.hierarchy_level, 'unknown')::TEXT as hierarchy_level,
    COUNT(*)::BIGINT as chunk_count,
    ROUND(AVG(ct.content_length)::NUMERIC, 0) as avg_content_length,
    MAX(ct.depth)::INTEGER as max_depth
  FROM chunk_tree ct
  GROUP BY ct.document_id, ct.hierarchy_level
  ORDER BY ct.document_id, ct.hierarchy_level;
END;
$$;

-- 7. 주석 추가
COMMENT ON COLUMN public.document_chunks.parent_chunk_id IS '부모 청크 ID (NULL이면 최상위 레벨)';
COMMENT ON COLUMN public.document_chunks.hierarchy_level IS '계층 레벨: document, section, paragraph, sentence';
COMMENT ON FUNCTION get_chunk_hierarchy IS '청크의 계층 구조를 재귀적으로 조회';
COMMENT ON FUNCTION get_chunks_by_level IS '특정 레벨의 모든 청크 조회';
COMMENT ON FUNCTION get_hierarchy_stats IS '문서별 계층 구조 통계 조회';

-- 8. 기존 데이터 마이그레이션 (선택사항)
-- 기존 청크는 최상위 레벨(document)로 설정
-- UPDATE public.document_chunks
-- SET hierarchy_level = 'document'
-- WHERE hierarchy_level IS NULL;

