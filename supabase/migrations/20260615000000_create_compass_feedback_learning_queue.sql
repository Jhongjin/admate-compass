-- Compass answer feedback and Hermes learning candidate queue.
-- Hermes learning is intentionally staged: candidate -> human review -> approved/applied.

CREATE SCHEMA IF NOT EXISTS compass;

CREATE TABLE IF NOT EXISTS compass.feedback (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    owner_subject TEXT NOT NULL,
    user_email TEXT,
    user_name TEXT,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    helpful BOOLEAN NOT NULL,
    question TEXT,
    answer TEXT,
    sources JSONB DEFAULT '[]'::jsonb,
    model TEXT,
    confidence NUMERIC,
    review_pipeline JSONB,
    learning_target TEXT DEFAULT 'hermes',
    learning_status TEXT DEFAULT 'candidate',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(owner_subject, message_id)
);

CREATE INDEX IF NOT EXISTS idx_compass_feedback_owner_subject_created_at
    ON compass.feedback(owner_subject, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compass_feedback_conversation_id
    ON compass.feedback(conversation_id);

CREATE INDEX IF NOT EXISTS idx_compass_feedback_message_id
    ON compass.feedback(message_id);

CREATE INDEX IF NOT EXISTS idx_compass_feedback_helpful
    ON compass.feedback(helpful);

CREATE TABLE IF NOT EXISTS compass.learning_feedback (
    id BIGSERIAL PRIMARY KEY,
    owner_subject TEXT NOT NULL,
    product TEXT NOT NULL DEFAULT 'compass',
    event_type TEXT NOT NULL DEFAULT 'answer_feedback',
    feedback_key TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    helpful BOOLEAN NOT NULL,
    question TEXT,
    answer TEXT,
    sources JSONB DEFAULT '[]'::jsonb,
    model TEXT,
    confidence NUMERIC,
    review_pipeline JSONB,
    learning_target TEXT NOT NULL DEFAULT 'hermes',
    learning_status TEXT NOT NULL DEFAULT 'candidate',
    learning_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    reviewed_by TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    applied_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(feedback_key, created_at)
);

CREATE INDEX IF NOT EXISTS idx_learning_feedback_owner_subject_created_at
    ON compass.learning_feedback(owner_subject, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_feedback_status_created_at
    ON compass.learning_feedback(learning_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learning_feedback_conversation_id
    ON compass.learning_feedback(conversation_id);

CREATE INDEX IF NOT EXISTS idx_learning_feedback_message_id
    ON compass.learning_feedback(message_id);

ALTER TABLE compass.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE compass.learning_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own compass feedback" ON compass.feedback;
DROP POLICY IF EXISTS "Users can insert their own compass feedback" ON compass.feedback;
DROP POLICY IF EXISTS "Users can update their own compass feedback" ON compass.feedback;
DROP POLICY IF EXISTS "Users can delete their own compass feedback" ON compass.feedback;
DROP POLICY IF EXISTS "Service role can manage compass feedback" ON compass.feedback;

CREATE POLICY "Users can view their own compass feedback" ON compass.feedback
    FOR SELECT USING (auth.uid() IS NOT NULL AND auth.uid()::text = owner_subject);

CREATE POLICY "Users can insert their own compass feedback" ON compass.feedback
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND auth.uid()::text = owner_subject);

CREATE POLICY "Users can update their own compass feedback" ON compass.feedback
    FOR UPDATE USING (auth.uid() IS NOT NULL AND auth.uid()::text = owner_subject)
    WITH CHECK (auth.uid() IS NOT NULL AND auth.uid()::text = owner_subject);

CREATE POLICY "Users can delete their own compass feedback" ON compass.feedback
    FOR DELETE USING (auth.uid() IS NOT NULL AND auth.uid()::text = owner_subject);

CREATE POLICY "Service role can manage compass feedback" ON compass.feedback
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can view own learning feedback candidates" ON compass.learning_feedback;
DROP POLICY IF EXISTS "Service role can manage learning feedback candidates" ON compass.learning_feedback;

CREATE POLICY "Users can view own learning feedback candidates" ON compass.learning_feedback
    FOR SELECT USING (auth.uid() IS NOT NULL AND auth.uid()::text = owner_subject);

CREATE POLICY "Service role can manage learning feedback candidates" ON compass.learning_feedback
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION compass.update_feedback_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_compass_feedback_updated_at ON compass.feedback;
CREATE TRIGGER update_compass_feedback_updated_at
    BEFORE UPDATE ON compass.feedback
    FOR EACH ROW
    EXECUTE FUNCTION compass.update_feedback_updated_at_column();

DROP TRIGGER IF EXISTS update_learning_feedback_updated_at ON compass.learning_feedback;
CREATE TRIGGER update_learning_feedback_updated_at
    BEFORE UPDATE ON compass.learning_feedback
    FOR EACH ROW
    EXECUTE FUNCTION compass.update_feedback_updated_at_column();

ANALYZE compass.feedback;
ANALYZE compass.learning_feedback;
