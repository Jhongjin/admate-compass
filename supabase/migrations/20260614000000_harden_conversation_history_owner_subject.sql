-- Harden Compass conversation history for Core product handoff sessions.
-- Product sessions use a signed subject string that is not guaranteed to be
-- a Supabase auth.users UUID, so history ownership must not depend only on
-- conversations.user_id. Compass runtime uses COMPASS_DB_SCHEMA=compass.

CREATE SCHEMA IF NOT EXISTS compass;

CREATE TABLE IF NOT EXISTS compass.conversations (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    owner_subject TEXT,
    conversation_id TEXT NOT NULL,
    user_message TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    sources JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE compass.conversations
    ADD COLUMN IF NOT EXISTS owner_subject TEXT;

UPDATE compass.conversations
SET owner_subject = user_id::text
WHERE owner_subject IS NULL
  AND user_id IS NOT NULL;

UPDATE compass.conversations
SET owner_subject = 'legacy:' || id::text
WHERE owner_subject IS NULL;

ALTER TABLE compass.conversations
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE compass.conversations
    ALTER COLUMN owner_subject SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_owner_subject_created_at
    ON compass.conversations(owner_subject, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_owner_subject_conversation_id
    ON compass.conversations(owner_subject, conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversations_conversation_id
    ON compass.conversations(conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversations_created_at
    ON compass.conversations(created_at DESC);

ALTER TABLE compass.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own conversations" ON compass.conversations;
DROP POLICY IF EXISTS "Users can insert their own conversations" ON compass.conversations;
DROP POLICY IF EXISTS "Users can update their own conversations" ON compass.conversations;
DROP POLICY IF EXISTS "Users can delete their own conversations" ON compass.conversations;
DROP POLICY IF EXISTS "Admin can manage all conversations" ON compass.conversations;

CREATE POLICY "Users can view their own conversations" ON compass.conversations
    FOR SELECT USING (
        auth.uid() IS NOT NULL
        AND (
            auth.uid() = user_id
            OR auth.uid()::text = owner_subject
        )
    );

CREATE POLICY "Users can insert their own conversations" ON compass.conversations
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
        AND owner_subject = auth.uid()::text
        AND (user_id IS NULL OR user_id = auth.uid())
    );

CREATE POLICY "Users can update their own conversations" ON compass.conversations
    FOR UPDATE USING (
        auth.uid() IS NOT NULL
        AND (
            auth.uid() = user_id
            OR auth.uid()::text = owner_subject
        )
    )
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND owner_subject = auth.uid()::text
        AND (user_id IS NULL OR user_id = auth.uid())
    );

CREATE POLICY "Users can delete their own conversations" ON compass.conversations
    FOR DELETE USING (
        auth.uid() IS NOT NULL
        AND (
            auth.uid() = user_id
            OR auth.uid()::text = owner_subject
        )
    );

CREATE POLICY "Admin can manage all conversations" ON compass.conversations
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE VIEW compass.conversation_stats AS
SELECT
    owner_subject AS user_id,
    COUNT(*) AS total_conversations,
    COUNT(DISTINCT conversation_id) AS unique_conversations,
    MIN(created_at) AS first_conversation,
    MAX(created_at) AS last_conversation
FROM compass.conversations
GROUP BY owner_subject;

ANALYZE compass.conversations;
