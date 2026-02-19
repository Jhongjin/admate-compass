-- 로그 알림 자동 이메일 발송 시스템 (방법 3: 완전 자동화)
-- Database Trigger + Edge Function을 통한 자동 이메일 발송
-- Created: 2025-02-02
-- 
-- 주의사항:
-- 1. Supabase Pro 플랜 필요
-- 2. Resend API 키 필요 (https://resend.com)
-- 3. Edge Function 배포 필요 (supabase/functions/send-email-alert)
-- 4. pg_net 또는 http 확장 필요 (Supabase Pro에서는 기본 제공)

-- 1. 이메일 발송 카운트 증가 함수
CREATE OR REPLACE FUNCTION increment_email_count(alert_id INTEGER)
RETURNS INTEGER AS $$
DECLARE
  current_count INTEGER;
BEGIN
  SELECT email_count INTO current_count
  FROM log_alerts
  WHERE id = alert_id;
  
  RETURN COALESCE(current_count, 0) + 1;
END;
$$ LANGUAGE plpgsql;

-- 2. Edge Function 호출을 위한 HTTP 확장 활성화 (필요한 경우)
-- Supabase Pro에서는 이미 활성화되어 있을 수 있음
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- 3. 이메일 발송 트리거 함수
CREATE OR REPLACE FUNCTION trigger_send_email_alert()
RETURNS TRIGGER AS $$
DECLARE
  edge_function_url TEXT;
  service_role_key TEXT;
  alert_payload JSONB;
  http_response http_response;
BEGIN
  -- pending 상태인 알림만 처리
  IF NEW.alert_status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- Edge Function URL 구성
  -- 환경 변수에서 가져오거나 직접 설정
  edge_function_url := current_setting('app.settings.edge_function_url', true);
  
  -- 설정이 없으면 기본값 사용 (실제 프로젝트 URL로 변경 필요)
  IF edge_function_url IS NULL OR edge_function_url = '' THEN
    edge_function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-email-alert';
  END IF;

  -- Service Role Key 가져오기
  service_role_key := current_setting('app.settings.service_role_key', true);

  -- Service Role Key가 없으면 트리거 실행 중단
  IF service_role_key IS NULL OR service_role_key = '' THEN
    RAISE WARNING 'Service Role Key가 설정되지 않아 이메일 발송을 건너뜁니다. Alert ID: %', NEW.id;
    RETURN NEW;
  END IF;

  -- 알림 페이로드 구성
  alert_payload := jsonb_build_object(
    'alertId', NEW.id,
    'logId', NEW.log_id,
    'logLevel', NEW.log_level,
    'logType', NEW.log_type,
    'logMessage', NEW.log_message,
    'logTimestamp', NEW.log_timestamp,
    'userId', NEW.user_id,
    'ipAddress', NEW.ip_address
  );

  -- Edge Function 호출 (비동기 처리)
  -- http 확장을 사용하여 Edge Function 호출
  BEGIN
    SELECT * INTO http_response
    FROM http((
      'POST',
      edge_function_url,
      ARRAY[
        http_header('Content-Type', 'application/json'),
        http_header('Authorization', 'Bearer ' || service_role_key)
      ],
      'application/json',
      alert_payload::text
    )::http_request);

    -- 응답 로깅 (선택사항)
    IF http_response.status = 200 THEN
      RAISE LOG '✅ 이메일 발송 성공: Alert ID %', NEW.id;
    ELSE
      RAISE WARNING '⚠️ 이메일 발송 실패: Alert ID %, Status: %', NEW.id, http_response.status;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- 에러 발생 시에도 트리거는 계속 진행 (알림은 생성됨)
    RAISE WARNING '⚠️ Edge Function 호출 실패: Alert ID %, Error: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 트리거 생성 (log_alerts 테이블에 INSERT 시 자동 실행)
DROP TRIGGER IF EXISTS on_log_alert_created ON log_alerts;
CREATE TRIGGER on_log_alert_created
  AFTER INSERT ON log_alerts
  FOR EACH ROW
  WHEN (NEW.alert_status = 'pending')
  EXECUTE FUNCTION trigger_send_email_alert();

-- 5. 설정 테이블 생성 (Edge Function URL 및 Service Role Key 저장)
-- 주의: 실제 프로덕션에서는 환경 변수나 Supabase Secrets를 사용하는 것이 더 안전합니다
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 기본 설정값 삽입 (실제 값은 Supabase Dashboard에서 설정)
INSERT INTO app_settings (key, value, description)
VALUES 
  ('edge_function_url', '', 'Supabase Edge Function URL (예: https://your-project.supabase.co/functions/v1/send-email-alert)'),
  ('service_role_key', '', 'Supabase Service Role Key (Supabase Secrets에 저장 권장)'),
  ('supabase_url', '', 'Supabase Project URL')
ON CONFLICT (key) DO NOTHING;

-- 6. 설정 조회 함수
CREATE OR REPLACE FUNCTION get_app_setting(setting_key TEXT)
RETURNS TEXT AS $$
DECLARE
  setting_value TEXT;
BEGIN
  SELECT value INTO setting_value
  FROM app_settings
  WHERE key = setting_key;
  
  RETURN setting_value;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. 설정 업데이트 함수 (관리자만 사용 가능)
CREATE OR REPLACE FUNCTION update_app_setting(setting_key TEXT, setting_value TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- 관리자 권한 확인
  IF NOT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = auth.uid() 
    AND is_active = true
  ) THEN
    RAISE EXCEPTION '관리자 권한이 필요합니다.';
  END IF;

  INSERT INTO app_settings (key, value, updated_at)
  VALUES (setting_key, setting_value, NOW())
  ON CONFLICT (key) 
  DO UPDATE SET 
    value = EXCLUDED.value,
    updated_at = NOW();
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. RLS 정책 설정
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- 관리자만 설정 조회 가능
DROP POLICY IF EXISTS "Admin can view app settings" ON app_settings;
CREATE POLICY "Admin can view app settings" ON app_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.user_id = auth.uid()
      AND admin_users.is_active = true
    )
  );

-- 서비스 역할은 모든 작업 가능
DROP POLICY IF EXISTS "Service role can manage app settings" ON app_settings;
CREATE POLICY "Service role can manage app settings" ON app_settings
  FOR ALL
  USING (auth.role() = 'service_role');

-- 9. 트리거 함수 개선 (설정 테이블에서 값 가져오기)
CREATE OR REPLACE FUNCTION trigger_send_email_alert_v2()
RETURNS TRIGGER AS $$
DECLARE
  edge_function_url TEXT;
  service_role_key TEXT;
  supabase_url TEXT;
  alert_payload JSONB;
  http_response http_response;
BEGIN
  -- pending 상태인 알림만 처리
  IF NEW.alert_status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- 설정값 가져오기
  supabase_url := get_app_setting('supabase_url');
  edge_function_url := get_app_setting('edge_function_url');
  service_role_key := get_app_setting('service_role_key');

  -- Edge Function URL이 없으면 Supabase URL로부터 구성
  IF edge_function_url IS NULL OR edge_function_url = '' THEN
    IF supabase_url IS NOT NULL AND supabase_url != '' THEN
      edge_function_url := supabase_url || '/functions/v1/send-email-alert';
    ELSE
      RAISE WARNING 'Edge Function URL이 설정되지 않았습니다. Alert ID: %', NEW.id;
      RETURN NEW;
    END IF;
  END IF;

  -- Service Role Key 확인
  IF service_role_key IS NULL OR service_role_key = '' THEN
    RAISE WARNING 'Service Role Key가 설정되지 않아 이메일 발송을 건너뜁니다. Alert ID: %', NEW.id;
    RETURN NEW;
  END IF;

  -- 알림 페이로드 구성
  alert_payload := jsonb_build_object(
    'alertId', NEW.id,
    'logId', NEW.log_id,
    'logLevel', NEW.log_level,
    'logType', NEW.log_type,
    'logMessage', NEW.log_message,
    'logTimestamp', NEW.log_timestamp,
    'userId', NEW.user_id,
    'ipAddress', NEW.ip_address
  );

  -- Edge Function 호출 (pg_net 또는 http 확장 사용)
  BEGIN
    -- pg_net 확장이 있는 경우 사용 (Supabase 권장)
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
      PERFORM net.http_post(
        url := edge_function_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || service_role_key
        ),
        body := alert_payload::text
      );
      
      RAISE LOG '✅ 이메일 발송 요청 전송 (pg_net): Alert ID %', NEW.id;
      
      -- 발송 요청 전송 시 상태 업데이트 (비동기 처리)
      UPDATE log_alerts
      SET 
        last_sent_at = NOW(),
        email_count = COALESCE(email_count, 0) + 1,
        next_send_at = NOW() + INTERVAL '1 hour',
        updated_at = NOW()
      WHERE id = NEW.id;
      
    -- http 확장이 있는 경우 사용
    ELSIF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'http') THEN
      SELECT * INTO http_response
      FROM http((
        'POST',
        edge_function_url,
        ARRAY[
          http_header('Content-Type', 'application/json'),
          http_header('Authorization', 'Bearer ' || service_role_key)
        ],
        'application/json',
        alert_payload::text
      )::http_request);

      IF http_response.status = 200 THEN
        RAISE LOG '✅ 이메일 발송 성공: Alert ID %', NEW.id;
        
        -- 발송 성공 시 상태 업데이트
        UPDATE log_alerts
        SET 
          last_sent_at = NOW(),
          email_count = COALESCE(email_count, 0) + 1,
          next_send_at = NOW() + INTERVAL '1 hour',
          updated_at = NOW()
        WHERE id = NEW.id;
      ELSE
        RAISE WARNING '⚠️ 이메일 발송 실패: Alert ID %, Status: %', NEW.id, http_response.status;
      END IF;
    ELSE
      RAISE WARNING 'HTTP 또는 pg_net 확장이 활성화되지 않았습니다. Alert ID: %', NEW.id;
      RETURN NEW;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '⚠️ Edge Function 호출 실패: Alert ID %, Error: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. 트리거를 새 버전으로 교체
DROP TRIGGER IF EXISTS on_log_alert_created ON log_alerts;
CREATE TRIGGER on_log_alert_created
  AFTER INSERT ON log_alerts
  FOR EACH ROW
  WHEN (NEW.alert_status = 'pending')
  EXECUTE FUNCTION trigger_send_email_alert_v2();

-- 11. 주석 추가
COMMENT ON FUNCTION trigger_send_email_alert_v2() IS 
  'log_alerts 테이블에 새로운 pending 상태 알림이 생성되면 자동으로 Edge Function을 호출하여 이메일 발송';

COMMENT ON TRIGGER on_log_alert_created ON log_alerts IS 
  '로그 알림 생성 시 자동으로 이메일 발송 트리거';

