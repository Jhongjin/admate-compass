-- 대화 히스토리를 위한 conversations 테이블 생성
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    user_message TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    sources JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_conversation_id ON conversations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);

-- RLS (Row Level Security) 활성화
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 대화만 조회/수정/삭제할 수 있도록 정책 설정
CREATE POLICY "Users can view their own conversations" ON conversations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own conversations" ON conversations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations" ON conversations
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations" ON conversations
    FOR DELETE USING (auth.uid() = user_id);

-- 관리자는 모든 대화에 접근 가능하도록 정책 설정
CREATE POLICY "Admin can manage all conversations" ON conversations
    FOR ALL USING (auth.role() = 'service_role');

-- updated_at 자동 업데이트를 위한 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- updated_at 트리거 생성
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 통계를 위한 뷰 생성
CREATE OR REPLACE VIEW conversation_stats AS
SELECT 
    user_id,
    COUNT(*) as total_conversations,
    COUNT(DISTINCT conversation_id) as unique_conversations,
    MIN(created_at) as first_conversation,
    MAX(created_at) as last_conversation
FROM conversations
GROUP BY user_id;

-- 성능 최적화를 위한 통계 업데이트
ANALYZE conversations;
