# 📧 이메일 알림 테스트 가이드

## 🎯 개요

로그 알림 시스템의 이메일 발송 기능을 테스트하는 방법을 안내합니다.

## 📋 사전 준비사항

### 1. Resend API 키 설정

1. **Resend 계정 생성**
   - https://resend.com 접속
   - 계정 생성 또는 로그인

2. **API 키 발급**
   - Dashboard → API Keys → Create API Key
   - API 키 복사 (예: `re_xxxxxxxxxxxxx`)

3. **Supabase Secrets 설정**
   ```bash
   # Supabase CLI 사용
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
   supabase secrets set ALERT_FROM_EMAIL=noreply@yourdomain.com
   supabase secrets set ALERT_TO_EMAIL=adso@nasmedia.co.kr
   supabase secrets set NEXT_PUBLIC_SITE_URL=https://your-domain.com
   ```

   **또는 Supabase Dashboard:**
   - Settings → Edge Functions → Secrets
   - 다음 Secrets 추가:
     - `RESEND_API_KEY`
     - `ALERT_FROM_EMAIL`
     - `ALERT_TO_EMAIL`
     - `NEXT_PUBLIC_SITE_URL`

### 2. Edge Function 배포

```bash
# Supabase CLI 사용
supabase functions deploy send-email-alert

# 또는 Supabase Dashboard에서:
# Edge Functions → New Function → send-email-alert
```

### 3. Database Migration 실행

Supabase Dashboard → SQL Editor에서 다음 순서로 실행:

1. `supabase/migrations/20250202_enable_pg_net_extension.sql`
2. `supabase/migrations/20250202_add_email_alert_automation.sql`
3. `supabase/migrations/20250202_configure_email_alert_settings.sql`

## 🧪 테스트 방법

### 방법 1: 관리자 페이지에서 테스트 (가장 간단)

1. **로그 페이지 접속**
   - `/admin/logs` 페이지로 이동

2. **테스트 로그 생성**
   - "테스트 로그" 버튼 클릭
   - 경고 레벨 로그가 자동 생성됨

3. **이메일 발송 확인**
   - Database Trigger가 자동으로 Edge Function 호출
   - Edge Function이 Resend API를 통해 이메일 발송
   - 설정된 이메일 주소(`ALERT_TO_EMAIL`)로 이메일 수신 확인

4. **활성 알림 확인**
   - 활성 알림 섹션에 새 알림 표시 확인
   - 이메일 발송 횟수 및 시간 확인

### 방법 2: API 직접 호출

```bash
# 테스트 로그 생성
curl -X POST https://your-domain.com/api/admin/logs/create \
  -H "Content-Type: application/json" \
  -d '{
    "log_id": "test_manual_001",
    "log_level": "error",
    "log_type": "system",
    "log_message": "수동 테스트용 오류 로그입니다.",
    "log_timestamp": "2025-02-02T18:00:00Z",
    "user_id": "test_user",
    "ip_address": "192.168.1.100"
  }'
```

### 방법 3: Supabase SQL 직접 실행

```sql
-- 테스트 알림 직접 생성
INSERT INTO log_alerts (
  log_id,
  log_level,
  log_type,
  log_message,
  log_timestamp,
  alert_status
) VALUES (
  'test_sql_' || extract(epoch from now()),
  'error',
  'system',
  'SQL을 통한 테스트 알림입니다.',
  NOW(),
  'pending'
);
```

## 🔍 확인 사항

### 1. 이메일 수신 확인
- 설정한 `ALERT_TO_EMAIL` 주소로 이메일 수신 여부 확인
- 스팸 폴더도 확인

### 2. Edge Function 로그 확인
- Supabase Dashboard → Edge Functions → Logs
- `send-email-alert` 함수 실행 로그 확인
- 에러 메시지 확인

### 3. Database Trigger 확인
- Supabase Dashboard → Database → Logs
- `trigger_send_email_alert_final` 함수 실행 여부 확인

### 4. 알림 상태 확인
```sql
-- 최근 알림 확인
SELECT 
  id,
  log_level,
  log_message,
  alert_status,
  email_count,
  last_sent_at,
  created_at
FROM log_alerts
ORDER BY created_at DESC
LIMIT 5;
```

## 🐛 트러블슈팅

### 문제 1: 이메일이 발송되지 않음

**확인 사항:**
1. Resend API 키가 올바르게 설정되었는지 확인
2. Edge Function이 배포되었는지 확인
3. Database Trigger가 생성되었는지 확인

**해결 방법:**
```sql
-- Trigger 확인
SELECT * FROM pg_trigger WHERE tgname = 'on_log_alert_created';

-- Edge Function URL 확인
SELECT get_edge_function_url();

-- Service Role Key 확인 (값은 표시되지 않음)
SELECT 
  CASE 
    WHEN get_service_role_key() IS NOT NULL THEN '설정됨'
    ELSE '설정 안됨'
  END as service_key_status;
```

### 문제 2: Edge Function 호출 실패

**확인 사항:**
1. Edge Function URL이 올바른지 확인
2. Service Role Key가 설정되었는지 확인
3. pg_net 또는 http 확장이 활성화되었는지 확인

**해결 방법:**
```sql
-- 확장 확인
SELECT * FROM pg_extension WHERE extname IN ('pg_net', 'http');

-- 설정 확인
SELECT * FROM app_settings;
```

### 문제 3: Resend API 오류

**확인 사항:**
1. Resend API 키가 유효한지 확인
2. 도메인 인증이 완료되었는지 확인 (선택사항)
3. API 할당량이 남아있는지 확인

**해결 방법:**
- Resend Dashboard에서 API 사용량 확인
- API 키 재발급 후 Secrets 업데이트

## 📊 테스트 체크리스트

- [ ] Resend API 키 설정 완료
- [ ] Supabase Secrets 설정 완료
- [ ] Edge Function 배포 완료
- [ ] Database Migration 실행 완료
- [ ] 테스트 로그 생성 성공
- [ ] 이메일 수신 확인
- [ ] 활성 알림 섹션에 알림 표시 확인
- [ ] 알림 확인 버튼 작동 확인
- [ ] 이메일 발송 횟수 증가 확인

## 🎯 예상 결과

### 성공 시:
1. 테스트 로그 생성 후 즉시 이메일 발송
2. 활성 알림 섹션에 새 알림 표시
3. 이메일 내용:
   - 제목: `[ERROR] 시스템 로그 알림 - 2025.02.02 18:00:00`
   - HTML 형식의 구조화된 이메일
   - 로그 정보, 발생 시간, 사용자 정보 포함
   - "알림 확인하기" 버튼 포함

### 실패 시:
- Edge Function 로그에 에러 메시지 표시
- Database 로그에 경고 메시지 표시
- 이메일은 발송되지 않지만 알림은 생성됨

## 📝 참고 사항

1. **이메일 발송 주기**: 관리자가 확인할 때까지 1시간마다 재발송
2. **알림 상태**: `pending` → `acknowledged` → `resolved`
3. **발송 횟수**: `email_count` 필드에 기록
4. **마지막 발송 시간**: `last_sent_at` 필드에 기록

## 🔗 관련 문서

- [Supabase Edge Functions 가이드](https://supabase.com/docs/guides/functions)
- [Resend API 문서](https://resend.com/docs)
- [SUPABASE_EMAIL_SETUP_INSTRUCTIONS.md](./SUPABASE_EMAIL_SETUP_INSTRUCTIONS.md)




