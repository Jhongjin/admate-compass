-- 로그 알림 테이블 생성
CREATE TABLE IF NOT EXISTS log_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    log_id VARCHAR(255) NOT NULL,
    log_level VARCHAR(50) NOT NULL,
    log_type VARCHAR(50) NOT NULL,
    log_message TEXT NOT NULL,
    log_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    user_id VARCHAR(255),
    ip_address INET,
    alert_status VARCHAR(50) DEFAULT 'pending' CHECK (alert_status IN ('pending', 'acknowledged', 'resolved')),
    first_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    next_send_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '1 hour',
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    email_count INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_log_alerts_status ON log_alerts(alert_status);
CREATE INDEX IF NOT EXISTS idx_log_alerts_next_send ON log_alerts(next_send_at);
CREATE INDEX IF NOT EXISTS idx_log_alerts_log_level ON log_alerts(log_level);
CREATE INDEX IF NOT EXISTS idx_log_alerts_created_at ON log_alerts(created_at);

-- 업데이트 트리거
CREATE OR REPLACE FUNCTION update_log_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_log_alerts_updated_at
    BEFORE UPDATE ON log_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_log_alerts_updated_at();


