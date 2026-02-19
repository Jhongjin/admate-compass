-- 이메일 알림 자동화 설정 초기화
-- Supabase Dashboard에서 실제 값으로 업데이트 필요
-- Created: 2025-02-02

-- 주의: 실제 프로덕션 환경에서는 Supabase Secrets를 사용하는 것을 권장합니다
-- 이 마이그레이션은 개발/테스트 환경용 기본 설정입니다

-- 1. Supabase URL 설정 (환경 변수에서 가져오거나 수동 설정)
-- 실제 프로젝트 URL로 변경 필요
UPDATE app_settings 
SET value = COALESCE(
  current_setting('app.settings.supabase_url', true),
  '' -- 여기에 실제 Supabase URL 입력: https://your-project.supabase.co
)
WHERE key = 'supabase_url';

-- 2. Edge Function URL 자동 구성
UPDATE app_settings 
SET value = (
  SELECT CASE 
    WHEN value != '' THEN value || '/functions/v1/send-email-alert'
    ELSE ''
  END
  FROM app_settings
  WHERE key = 'supabase_url'
)
WHERE key = 'edge_function_url';

-- 3. Service Role Key는 Supabase Secrets에 저장하는 것을 권장
-- 또는 Supabase Dashboard → Settings → API → service_role key 복사 후
-- 다음 명령으로 설정:
-- SELECT update_app_setting('service_role_key', 'your-service-role-key-here');

-- 4. 환경 변수 기반 설정 함수 (더 안전한 방법)
CREATE OR REPLACE FUNCTION get_edge_function_url()
RETURNS TEXT AS $$
DECLARE
  supabase_url TEXT;
BEGIN
  -- 환경 변수에서 가져오기 시도
  BEGIN
    supabase_url := current_setting('app.settings.supabase_url', true);
  EXCEPTION WHEN OTHERS THEN
    supabase_url := NULL;
  END;

  -- 설정 테이블에서 가져오기
  IF supabase_url IS NULL OR supabase_url = '' THEN
    SELECT value INTO supabase_url
    FROM app_settings
    WHERE key = 'supabase_url';
  END IF;

  -- Edge Function URL 구성
  IF supabase_url IS NOT NULL AND supabase_url != '' THEN
    RETURN supabase_url || '/functions/v1/send-email-alert';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Service Role Key 가져오기 함수 (환경 변수 우선)
CREATE OR REPLACE FUNCTION get_service_role_key()
RETURNS TEXT AS $$
DECLARE
  service_key TEXT;
BEGIN
  -- 환경 변수에서 가져오기 시도
  BEGIN
    service_key := current_setting('app.settings.service_role_key', true);
  EXCEPTION WHEN OTHERS THEN
    service_key := NULL;
  END;

  -- 설정 테이블에서 가져오기
  IF service_key IS NULL OR service_key = '' THEN
    SELECT value INTO service_key
    FROM app_settings
    WHERE key = 'service_role_key';
  END IF;

  RETURN service_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. 트리거 함수 최종 버전 (환경 변수 및 설정 테이블 모두 지원)
CREATE OR REPLACE FUNCTION trigger_send_email_alert_final()
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

  -- Edge Function URL 가져오기
  edge_function_url := get_edge_function_url();
  
  IF edge_function_url IS NULL OR edge_function_url = '' THEN
    RAISE WARNING 'Edge Function URL이 설정되지 않았습니다. Alert ID: %', NEW.id;
    RETURN NEW;
  END IF;

  -- Service Role Key 가져오기
  service_role_key := get_service_role_key();
  
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

-- 7. 트리거를 최종 버전으로 교체
DROP TRIGGER IF EXISTS on_log_alert_created ON log_alerts;
CREATE TRIGGER on_log_alert_created
  AFTER INSERT ON log_alerts
  FOR EACH ROW
  WHEN (NEW.alert_status = 'pending')
  EXECUTE FUNCTION trigger_send_email_alert_final();

-- 8. 주석 업데이트
COMMENT ON FUNCTION trigger_send_email_alert_final() IS 
  'log_alerts 테이블에 새로운 pending 상태 알림이 생성되면 자동으로 Edge Function을 호출하여 이메일 발송. 환경 변수 및 설정 테이블 모두 지원.';

