-- 피드백을 위한 feedback 테이블 생성
CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    helpful BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, message_id) -- 사용자당 메시지당 하나의 피드백만 허용
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_conversation_id ON feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_feedback_message_id ON feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_feedback_helpful ON feedback(helpful);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);

-- RLS (Row Level Security) 활성화
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 피드백만 조회/수정/삭제할 수 있도록 정책 설정
CREATE POLICY "Users can view their own feedback" ON feedback
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own feedback" ON feedback
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own feedback" ON feedback
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own feedback" ON feedback
    FOR DELETE USING (auth.uid() = user_id);

-- 관리자는 모든 피드백에 접근 가능하도록 정책 설정
CREATE POLICY "Admin can manage all feedback" ON feedback
    FOR ALL USING (auth.role() = 'service_role');

-- updated_at 자동 업데이트를 위한 트리거 함수
CREATE OR REPLACE FUNCTION update_feedback_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- updated_at 트리거 생성
CREATE TRIGGER update_feedback_updated_at
    BEFORE UPDATE ON feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_feedback_updated_at_column();

-- 피드백 통계를 위한 뷰 생성
CREATE OR REPLACE VIEW feedback_stats AS
SELECT 
    DATE(created_at) as date,
    helpful,
    COUNT(*) as count
FROM feedback
GROUP BY DATE(created_at), helpful
ORDER BY date DESC;

-- 전체 피드백 통계 뷰
CREATE OR REPLACE VIEW total_feedback_stats AS
SELECT 
    COUNT(*) as total_feedback,
    COUNT(CASE WHEN helpful = true THEN 1 END) as positive_feedback,
    COUNT(CASE WHEN helpful = false THEN 1 END) as negative_feedback,
    ROUND(
        COUNT(CASE WHEN helpful = true THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 
        2
    ) as positive_percentage
FROM feedback;

-- 성능 최적화를 위한 통계 업데이트
ANALYZE feedback;
