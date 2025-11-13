-- API 토큰 사용량 추적 테이블 생성
-- Claude와 GPT API의 토큰 사용량을 추적하기 위한 테이블

CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'gpt')),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) DEFAULT 0,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_provider ON api_usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_created_at ON api_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_id ON api_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_conversation_id ON api_usage_logs(conversation_id);

-- RLS 정책 설정
ALTER TABLE api_usage_logs ENABLE ROW LEVEL SECURITY;

-- 관리자는 모든 로그 조회 가능 (admin_users 테이블 기반)
CREATE POLICY "관리자는 모든 API 사용량 로그 조회 가능"
  ON api_usage_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.user_id = auth.uid()
      AND admin_users.is_active = true
    )
  );

-- 서비스 역할은 모든 작업 가능
CREATE POLICY "서비스 역할은 모든 API 사용량 로그 작업 가능"
  ON api_usage_logs
  FOR ALL
  USING (auth.role() = 'service_role');

-- 일일 API 사용량 통계 조회 함수
CREATE OR REPLACE FUNCTION get_daily_api_usage(
  start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  date DATE,
  provider TEXT,
  total_requests BIGINT,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  total_tokens BIGINT,
  total_cost_usd NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE(created_at) as date,
    provider,
    COUNT(*)::BIGINT as total_requests,
    SUM(input_tokens)::BIGINT as total_input_tokens,
    SUM(output_tokens)::BIGINT as total_output_tokens,
    SUM(total_tokens)::BIGINT as total_tokens,
    SUM(cost_usd) as total_cost_usd
  FROM api_usage_logs
  WHERE DATE(created_at) BETWEEN start_date AND end_date
  GROUP BY DATE(created_at), provider
  ORDER BY date DESC, provider;
END;
$$;

-- 월간 API 사용량 통계 조회 함수
CREATE OR REPLACE FUNCTION get_monthly_api_usage(
  months_back INTEGER DEFAULT 3
)
RETURNS TABLE (
  month DATE,
  provider TEXT,
  total_requests BIGINT,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  total_tokens BIGINT,
  total_cost_usd NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    DATE_TRUNC('month', created_at)::DATE as month,
    provider,
    COUNT(*)::BIGINT as total_requests,
    SUM(input_tokens)::BIGINT as total_input_tokens,
    SUM(output_tokens)::BIGINT as total_output_tokens,
    SUM(total_tokens)::BIGINT as total_tokens,
    SUM(cost_usd) as total_cost_usd
  FROM api_usage_logs
  WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE) - (months_back || ' months')::INTERVAL
  GROUP BY DATE_TRUNC('month', created_at), provider
  ORDER BY month DESC, provider;
END;
$$;

-- 데이터베이스 크기 조회 함수
CREATE OR REPLACE FUNCTION get_database_size()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  db_size BIGINT;
  db_size_pretty TEXT;
BEGIN
  SELECT pg_database_size(current_database()) INTO db_size;
  SELECT pg_size_pretty(db_size) INTO db_size_pretty;
  RETURN db_size_pretty;
END;
$$;

-- 함수 실행 권한 부여
GRANT EXECUTE ON FUNCTION get_daily_api_usage TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_monthly_api_usage TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_database_size TO anon, authenticated;

-- 완료 로그
DO $$
BEGIN
  RAISE NOTICE '✅ API 사용량 추적 테이블 및 함수 생성 완료';
  RAISE NOTICE '완료 시간: %', NOW();
END $$;

