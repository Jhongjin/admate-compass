# 📧 Supabase Pro 이메일 알림 자동화 설정 가이드

## 🎯 개요

이 가이드는 **방법 3: 완전 자동화 (Database Trigger + Edge Function)**를 설정하는 방법을 설명합니다.

## 📋 사전 준비사항

1. ✅ Supabase Pro 플랜 활성화
2. ✅ Resend 계정 생성 및 API 키 발급
3. ✅ Supabase Edge Functions 활성화 확인

## 🚀 설정 단계

### 1단계: Resend API 키 발급

1. https://resend.com 접속
2. 계정 생성 또는 로그인
3. **API Keys** 메뉴에서 새 API 키 생성
4. API 키 복사 (예: `re_xxxxxxxxxxxxx`)

### 2단계: Supabase Secrets 설정

Supabase Dashboard에서 환경 변수 설정:

1. **Supabase Dashboard** → **Settings** → **Edge Functions** → **Secrets**
2. 다음 Secrets 추가:

```
RESEND_API_KEY=re_xxxxxxxxxxxxx
ALERT_FROM_EMAIL=noreply@yourdomain.com
ALERT_TO_EMAIL=adso@nasmedia.co.kr
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

**또는** Supabase CLI 사용:
```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
supabase secrets set ALERT_FROM_EMAIL=noreply@yourdomain.com
supabase secrets set ALERT_TO_EMAIL=adso@nasmedia.co.kr
supabase secrets set NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

### 3단계: Edge Function 배포

1. **Supabase Dashboard** → **Edge Functions** → **New Function**
2. Function 이름: `send-email-alert`
3. `supabase/functions/send-email-alert/index.ts` 파일 내용 복사
4. 배포

**또는** Supabase CLI 사용:
```bash
supabase functions deploy send-email-alert
```

### 4단계: Database Migration 실행

1. **Supabase Dashboard** → **SQL Editor**
2. 다음 마이그레이션 파일들을 순서대로 실행:
   - `supabase/migrations/20250202_add_email_alert_automation.sql`
   - `supabase/migrations/20250202_configure_email_alert_settings.sql`

3. **또는** Supabase CLI 사용:
```bash
supabase db push
```

### 5단계: 설정 값 업데이트

마이그레이션 실행 후, 다음 SQL을 실행하여 실제 프로젝트 URL 설정:

```sql
-- Supabase URL 설정 (실제 프로젝트 URL로 변경)
UPDATE app_settings 
SET value = 'https://your-project-id.supabase.co'
WHERE key = 'supabase_url';

-- Service Role Key 설정 (Supabase Dashboard → Settings → API에서 복사)
-- 주의: 이 방법보다는 Supabase Secrets 사용을 권장합니다
UPDATE app_settings 
SET value = 'your-service-role-key-here'
WHERE key = 'service_role_key';
```

**더 안전한 방법: Supabase Secrets 사용**

Service Role Key는 Supabase Secrets에 저장하고, 트리거 함수에서 환경 변수로 읽도록 설정:

```sql
-- 트리거 함수가 자동으로 환경 변수에서 읽도록 이미 설정되어 있습니다
-- Supabase Secrets에 설정만 하면 됩니다
```

### 6단계: 테스트

1. **Supabase Dashboard** → **SQL Editor**
2. 테스트 알림 생성:

```sql
INSERT INTO log_alerts (
  log_id,
  log_level,
  log_type,
  log_message,
  log_timestamp,
  alert_status
) VALUES (
  'test_' || extract(epoch from now()),
  'error',
  'system',
  '테스트 이메일 알림입니다.',
  NOW(),
  'pending'
);
```

3. 이메일 수신 확인
4. Supabase Dashboard → **Edge Functions** → **Logs**에서 실행 로그 확인

## 🔧 트러블슈팅

### 문제 1: 이메일이 발송되지 않음

**확인 사항:**
1. Resend API 키가 올바르게 설정되었는지 확인
2. Edge Function 로그 확인 (Supabase Dashboard → Edge Functions → Logs)
3. Database Trigger가 실행되었는지 확인:

```sql
-- 최근 알림 확인
SELECT * FROM log_alerts 
ORDER BY created_at DESC 
LIMIT 5;

-- Trigger 실행 로그 확인
SELECT * FROM pg_stat_user_functions 
WHERE funcname = 'trigger_send_email_alert_final';
```

### 문제 2: Edge Function 호출 실패

**해결 방법:**
1. Edge Function URL이 올바른지 확인:

```sql
SELECT get_edge_function_url();
```

2. Service Role Key가 올바른지 확인:

```sql
-- 키가 설정되어 있는지만 확인 (실제 값은 표시되지 않음)
SELECT 
  CASE 
    WHEN get_service_role_key() IS NOT NULL THEN '설정됨'
    ELSE '설정 안됨'
  END as service_key_status;
```

### 문제 3: HTTP 확장이 활성화되지 않음

**해결 방법:**
Supabase Pro에서는 HTTP 확장이 기본적으로 활성화되어 있습니다. 
만약 활성화되지 않은 경우:

```sql
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
```

## 📊 모니터링

### 이메일 발송 상태 확인

```sql
-- 최근 알림 및 발송 상태
SELECT 
  id,
  log_level,
  log_message,
  alert_status,
  email_count,
  last_sent_at,
  next_send_at,
  created_at
FROM log_alerts
ORDER BY created_at DESC
LIMIT 10;
```

### 발송 실패 알림 확인

```sql
-- 발송되지 않은 알림 확인
SELECT *
FROM log_alerts
WHERE alert_status = 'pending'
  AND (last_sent_at IS NULL OR last_sent_at < NOW() - INTERVAL '1 hour')
ORDER BY created_at DESC;
```

## 🔒 보안 고려사항

1. **Service Role Key 보호**
   - Supabase Secrets에 저장 (권장)
   - 설정 테이블에 저장하지 않기
   - Git에 커밋하지 않기

2. **RLS 정책 확인**
   - `app_settings` 테이블은 관리자만 접근 가능
   - `log_alerts` 테이블은 관리자만 조회 가능

3. **Edge Function 인증**
   - Service Role Key를 통한 인증 필수
   - CORS 설정 확인

## 📝 다음 단계

1. ✅ Edge Function 배포 완료
2. ✅ Database Migration 실행 완료
3. ✅ 환경 변수 설정 완료
4. ⏳ 테스트 알림 생성 및 이메일 수신 확인
5. ⏳ 실제 로그 생성 시 자동 이메일 발송 확인

## 🔗 참고 자료

- [Supabase Edge Functions 문서](https://supabase.com/docs/guides/functions)
- [Supabase Secrets 관리](https://supabase.com/docs/guides/functions/secrets)
- [Resend API 문서](https://resend.com/docs)
- [PostgreSQL HTTP 확장](https://github.com/pramsey/pgsql-http)

