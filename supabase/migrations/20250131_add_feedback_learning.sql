-- 피드백 기반 학습을 위한 테이블 및 기능 추가
-- Created: 2025-01-31

-- 1. feedback 테이블에 sources 정보 추가
DO $$
BEGIN
  -- sources 컬럼 추가 (JSONB 타입으로 문서 ID, 청크 ID 저장)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'feedback' 
    AND column_name = 'sources'
  ) THEN
    ALTER TABLE public.feedback ADD COLUMN sources JSONB DEFAULT '[]'::jsonb;
    CREATE INDEX IF NOT EXISTS idx_feedback_sources ON public.feedback USING GIN (sources);
    COMMENT ON COLUMN public.feedback.sources IS '피드백이 제공된 답변에 사용된 문서/청크 정보 (document_id, chunk_id 배열)';
  END IF;
END $$;

-- 2. document_chunk_weights 테이블 생성 (문서/청크별 가중치 관리)
CREATE TABLE IF NOT EXISTS document_chunk_weights (
    id SERIAL PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    positive_feedback_count INTEGER DEFAULT 0,
    negative_feedback_count INTEGER DEFAULT 0,
    weight_score NUMERIC(10, 4) DEFAULT 1.0, -- 기본 가중치 1.0
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(document_id, chunk_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_chunk_weights_document_id ON document_chunk_weights(document_id);
CREATE INDEX IF NOT EXISTS idx_chunk_weights_chunk_id ON document_chunk_weights(chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunk_weights_weight_score ON document_chunk_weights(weight_score DESC);
CREATE INDEX IF NOT EXISTS idx_chunk_weights_last_updated ON document_chunk_weights(last_updated DESC);

-- 3. 가중치 계산 함수
CREATE OR REPLACE FUNCTION calculate_chunk_weight(
    positive_count INTEGER,
    negative_count INTEGER
) RETURNS NUMERIC(10, 4) AS $$
DECLARE
    total_count INTEGER;
    positive_ratio NUMERIC;
    calculated_weight NUMERIC(10, 4);
BEGIN
    total_count := positive_count + negative_count;
    
    -- 피드백이 없는 경우 기본 가중치 1.0
    IF total_count = 0 THEN
        RETURN 1.0;
    END IF;
    
    -- 긍정 비율 계산
    positive_ratio := positive_count::NUMERIC / total_count::NUMERIC;
    
    -- 가중치 계산 공식:
    -- - 긍정 비율 100%: 가중치 1.5 (최대)
    -- - 긍정 비율 50%: 가중치 1.0 (기본)
    -- - 긍정 비율 0%: 가중치 0.5 (최소)
    -- - 피드백 수가 많을수록 가중치 영향 증가 (신뢰도 반영)
    calculated_weight := 0.5 + (positive_ratio * 1.0) + 
                        (LEAST(total_count, 10)::NUMERIC / 10.0 * 0.2); -- 최대 0.2 추가 보너스
    
    -- 가중치 범위 제한 (0.3 ~ 1.8)
    calculated_weight := GREATEST(0.3, LEAST(1.8, calculated_weight));
    
    RETURN calculated_weight;
END;
$$ LANGUAGE plpgsql;

-- 4. 피드백 저장 시 가중치 자동 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_chunk_weights_on_feedback()
RETURNS TRIGGER AS $$
DECLARE
    source_item JSONB;
    doc_id TEXT;
    chunk_id TEXT;
    current_positive INTEGER;
    current_negative INTEGER;
    new_positive INTEGER;
    new_negative INTEGER;
    new_weight NUMERIC(10, 4);
BEGIN
    -- sources 배열 순회
    IF NEW.sources IS NOT NULL AND jsonb_array_length(NEW.sources) > 0 THEN
        FOR source_item IN SELECT * FROM jsonb_array_elements(NEW.sources)
        LOOP
            doc_id := source_item->>'document_id';
            chunk_id := source_item->>'chunk_id';
            
            IF doc_id IS NOT NULL AND chunk_id IS NOT NULL THEN
                -- 기존 가중치 레코드 조회
                SELECT 
                    COALESCE(positive_feedback_count, 0),
                    COALESCE(negative_feedback_count, 0)
                INTO current_positive, current_negative
                FROM document_chunk_weights
                WHERE document_id = doc_id AND chunk_id = chunk_id;
                
                -- 피드백 카운트 업데이트
                IF NEW.helpful = true THEN
                    new_positive := current_positive + 1;
                    new_negative := current_negative;
                ELSE
                    new_positive := current_positive;
                    new_negative := current_negative + 1;
                END IF;
                
                -- 가중치 재계산
                new_weight := calculate_chunk_weight(new_positive, new_negative);
                
                -- UPSERT (존재하면 업데이트, 없으면 생성)
                INSERT INTO document_chunk_weights (
                    document_id,
                    chunk_id,
                    positive_feedback_count,
                    negative_feedback_count,
                    weight_score,
                    last_updated
                ) VALUES (
                    doc_id,
                    chunk_id,
                    new_positive,
                    new_negative,
                    new_weight,
                    NOW()
                )
                ON CONFLICT (document_id, chunk_id)
                DO UPDATE SET
                    positive_feedback_count = EXCLUDED.positive_feedback_count,
                    negative_feedback_count = EXCLUDED.negative_feedback_count,
                    weight_score = EXCLUDED.weight_score,
                    last_updated = NOW();
            END IF;
        END LOOP;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. 피드백 INSERT/UPDATE 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_chunk_weights_on_feedback ON feedback;
CREATE TRIGGER trigger_update_chunk_weights_on_feedback
    AFTER INSERT OR UPDATE OF helpful, sources ON feedback
    FOR EACH ROW
    WHEN (NEW.helpful IS NOT NULL AND NEW.sources IS NOT NULL)
    EXECUTE FUNCTION update_chunk_weights_on_feedback();

-- 6. 피드백 삭제 시 가중치 업데이트 트리거 함수
CREATE OR REPLACE FUNCTION update_chunk_weights_on_feedback_delete()
RETURNS TRIGGER AS $$
DECLARE
    source_item JSONB;
    doc_id TEXT;
    chunk_id TEXT;
    current_positive INTEGER;
    current_negative INTEGER;
    new_positive INTEGER;
    new_negative INTEGER;
    new_weight NUMERIC(10, 4);
BEGIN
    -- 삭제된 피드백의 sources 배열 순회
    IF OLD.sources IS NOT NULL AND jsonb_array_length(OLD.sources) > 0 THEN
        FOR source_item IN SELECT * FROM jsonb_array_elements(OLD.sources)
        LOOP
            doc_id := source_item->>'document_id';
            chunk_id := source_item->>'chunk_id';
            
            IF doc_id IS NOT NULL AND chunk_id IS NOT NULL THEN
                -- 기존 가중치 레코드 조회
                SELECT 
                    COALESCE(positive_feedback_count, 0),
                    COALESCE(negative_feedback_count, 0)
                INTO current_positive, current_negative
                FROM document_chunk_weights
                WHERE document_id = doc_id AND chunk_id = chunk_id;
                
                -- 피드백 카운트 감소
                IF OLD.helpful = true THEN
                    new_positive := GREATEST(0, current_positive - 1);
                    new_negative := current_negative;
                ELSE
                    new_positive := current_positive;
                    new_negative := GREATEST(0, current_negative - 1);
                END IF;
                
                -- 가중치 재계산
                new_weight := calculate_chunk_weight(new_positive, new_negative);
                
                -- 업데이트
                UPDATE document_chunk_weights
                SET
                    positive_feedback_count = new_positive,
                    negative_feedback_count = new_negative,
                    weight_score = new_weight,
                    last_updated = NOW()
                WHERE document_id = doc_id AND chunk_id = chunk_id;
                
                -- 카운트가 모두 0이면 레코드 삭제 (선택사항)
                IF new_positive = 0 AND new_negative = 0 THEN
                    DELETE FROM document_chunk_weights
                    WHERE document_id = doc_id AND chunk_id = chunk_id;
                END IF;
            END IF;
        END LOOP;
    END IF;
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 7. 피드백 DELETE 트리거 생성
DROP TRIGGER IF EXISTS trigger_update_chunk_weights_on_feedback_delete ON feedback;
CREATE TRIGGER trigger_update_chunk_weights_on_feedback_delete
    AFTER DELETE ON feedback
    FOR EACH ROW
    WHEN (OLD.helpful IS NOT NULL AND OLD.sources IS NOT NULL)
    EXECUTE FUNCTION update_chunk_weights_on_feedback_delete();

-- 8. 가중치 기반 검색을 위한 search_documents 함수 확장 (선택사항)
-- 기존 search_documents 함수는 유지하고, 가중치를 적용한 버전을 별도로 생성
-- 기존 함수가 있으면 삭제
DROP FUNCTION IF EXISTS search_documents_with_weights(vector(1024), float, int);
DROP FUNCTION IF EXISTS search_documents_with_weights(vector(1024), float, int, TEXT[]);

CREATE OR REPLACE FUNCTION search_documents_with_weights(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    vendor_filter TEXT[] DEFAULT NULL
)
RETURNS TABLE (
    chunk_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity float,
    document_id TEXT,
    title TEXT,
    source_vendor TEXT,
    document_type TEXT,
    weighted_similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dc.chunk_id::TEXT,  -- 명시적으로 TEXT로 캐스팅
        dc.content,
        dc.metadata,
        1 - (dc.embedding <=> query_embedding) as similarity,
        dc.document_id,
        d.title,
        COALESCE(d.source_vendor::TEXT, 'META') as source_vendor,
        COALESCE(d.type::TEXT, 'file') as document_type,
        -- 가중치 적용된 유사도 계산
        (1 - (dc.embedding <=> query_embedding)) * COALESCE(dcw.weight_score, 1.0) as weighted_similarity
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    LEFT JOIN document_chunk_weights dcw ON dc.document_id = dcw.document_id 
        AND dc.chunk_id::TEXT = dcw.chunk_id  -- chunk_id를 TEXT로 캐스팅하여 비교
    WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
      AND d.status = 'indexed'
      AND (vendor_filter IS NULL OR COALESCE(d.source_vendor::TEXT, 'META') = ANY(vendor_filter))
    ORDER BY weighted_similarity DESC  -- 가중치 적용된 유사도로 정렬
    LIMIT match_count;
END;
$$;

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION search_documents_with_weights(vector(1024), float, int, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION search_documents_with_weights(vector(1024), float, int, TEXT[]) TO anon;

-- 9. 통계 뷰 생성
CREATE OR REPLACE VIEW chunk_weight_stats AS
SELECT 
    COUNT(*) as total_chunks_with_weights,
    AVG(weight_score) as avg_weight,
    MAX(weight_score) as max_weight,
    MIN(weight_score) as min_weight,
    SUM(positive_feedback_count) as total_positive_feedback,
    SUM(negative_feedback_count) as total_negative_feedback
FROM document_chunk_weights;

-- 성능 최적화
ANALYZE document_chunk_weights;
ANALYZE feedback;

