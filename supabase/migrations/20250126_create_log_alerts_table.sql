-- log_alerts 테이블 생성
CREATE TABLE IF NOT EXISTS log_alerts (
    id SERIAL PRIMARY KEY,
    log_id TEXT NOT NULL,
    log_level TEXT NOT NULL,
    log_type TEXT NOT NULL,
    log_message TEXT NOT NULL,
    log_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    user_id TEXT,
    ip_address TEXT,
    alert_status TEXT DEFAULT 'pending' CHECK (alert_status IN ('pending', 'acknowledged', 'resolved')),
    first_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_sent_at TIMESTAMP WITH TIME ZONE,
    next_send_at TIMESTAMP WITH TIME ZONE,
    email_count INTEGER DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_log_alerts_status ON log_alerts(alert_status);
CREATE INDEX IF NOT EXISTS idx_log_alerts_log_level ON log_alerts(log_level);
CREATE INDEX IF NOT EXISTS idx_log_alerts_next_send ON log_alerts(next_send_at);

-- RLS 정책 설정
ALTER TABLE log_alerts ENABLE ROW LEVEL SECURITY;

-- 관리자만 접근 가능 (기존 정책이 있으면 삭제 후 생성)
DROP POLICY IF EXISTS "Admin can manage log alerts" ON log_alerts;
CREATE POLICY "Admin can manage log alerts" ON log_alerts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM admin_users 
            WHERE admin_users.user_id = auth.uid()
        )
    );

-- updated_at 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 트리거가 이미 있으면 삭제 후 생성
DROP TRIGGER IF EXISTS update_log_alerts_updated_at ON log_alerts;
CREATE TRIGGER update_log_alerts_updated_at 
    BEFORE UPDATE ON log_alerts 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
