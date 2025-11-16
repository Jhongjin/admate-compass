# 📧 Supabase Pro 이메일 서비스 통합 가이드

## 📋 현재 구현 상태

### ✅ 구현된 기능
1. **로그 알림 시스템**: `EmailAlertService` 클래스로 로그 알림 관리
2. **이메일 서비스**: `EmailService` 클래스로 여러 프로바이더 지원
   - SendGrid
   - Resend (Supabase 추천)
   - EmailJS
   - Nodemailer (SMTP)
   - Console (개발용)

### ⚠️ 현재 상태
- 이메일 알림 기능이 **비활성화**되어 있음 (`console` 모드)
- 로그 생성 시 알림 트리거가 주석 처리됨
- 실제 이메일 발송은 되지 않고 콘솔에만 로그 출력

## 🚀 Supabase Pro 이메일 서비스 활용 방안

### 방법 1: Resend 통합 (권장) ⭐

**장점:**
- Supabase 공식 문서에서 추천하는 이메일 서비스
- 간단한 API, 높은 전송률
- Supabase Pro에서 무료 할당량 제공 가능
- Edge Functions와 완벽 호환

**구현 단계:**

1. **Resend 계정 생성 및 API 키 발급**
   - https://resend.com 접속
   - API 키 생성
   - 도메인 인증 (선택사항)

2. **환경 변수 설정**
   ```bash
   RESEND_API_KEY=re_xxxxxxxxxxxxx
   ALERT_FROM_EMAIL=noreply@yourdomain.com
   ALERT_TO_EMAIL=adso@nasmedia.co.kr
   ```

3. **EmailService 활성화**
   - `src/lib/services/EmailService.ts`에서 `provider`를 `'resend'`로 변경

4. **로그 알림 트리거 활성화**
   - `src/app/api/admin/logs/create/route.ts`에서 주석 해제

### 방법 2: Supabase Edge Functions 활용

**장점:**
- Supabase 인프라 내에서 실행
- Database Webhooks와 연동 가능
- 자동 스케일링

**구현 단계:**

1. **Edge Function 생성**
   ```typescript
   // supabase/functions/send-email-alert/index.ts
   import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
   import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

   serve(async (req) => {
     const { alertId, to, subject, html } = await req.json()
     
     // Resend API 호출
     const resendResponse = await fetch('https://api.resend.com/emails', {
       method: 'POST',
       headers: {
         'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify({
         from: Deno.env.get('ALERT_FROM_EMAIL'),
         to: [to],
         subject,
         html,
       }),
     })

     return new Response(JSON.stringify({ success: resendResponse.ok }), {
       headers: { 'Content-Type': 'application/json' },
     })
   })
   ```

2. **Database Webhook 설정**
   - `log_alerts` 테이블에 INSERT 시 Edge Function 호출
   - Supabase Dashboard → Database → Webhooks에서 설정

### 방법 3: Database Trigger + Edge Function (완전 자동화)

**장점:**
- 로그 생성 시 자동으로 이메일 발송
- 별도 API 호출 불필요
- 실시간 처리

**구현 단계:**

1. **Edge Function 생성** (방법 2와 동일)

2. **PostgreSQL Trigger 생성**
   ```sql
   -- supabase/migrations/xxxxx_add_email_alert_trigger.sql
   CREATE OR REPLACE FUNCTION trigger_send_email_alert()
   RETURNS TRIGGER AS $$
   BEGIN
     -- Edge Function 호출
     PERFORM
       net.http_post(
         url := 'https://your-project.supabase.co/functions/v1/send-email-alert',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
         ),
         body := jsonb_build_object(
           'alertId', NEW.id,
           'to', 'adso@nasmedia.co.kr',
           'subject', '[' || NEW.log_level || '] 시스템 로그 알림',
           'html', '<html>...</html>'
         )
       );
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER on_log_alert_created
     AFTER INSERT ON log_alerts
     FOR EACH ROW
     WHEN (NEW.alert_status = 'pending')
     EXECUTE FUNCTION trigger_send_email_alert();
   ```

## 📊 비교표

| 방법 | 난이도 | 자동화 | 비용 | 추천도 |
|------|--------|--------|------|--------|
| **방법 1: Resend 직접 통합** | ⭐ 쉬움 | ⭐⭐ | 무료/유료 | ⭐⭐⭐⭐⭐ |
| **방법 2: Edge Functions** | ⭐⭐ 보통 | ⭐⭐⭐ | 무료/유료 | ⭐⭐⭐⭐ |
| **방법 3: Trigger + Edge Function** | ⭐⭐⭐ 어려움 | ⭐⭐⭐⭐⭐ | 무료/유료 | ⭐⭐⭐ |

## 🎯 권장 구현 방법

**즉시 적용 가능한 방법: 방법 1 (Resend 직접 통합)**

1. Resend API 키 발급
2. 환경 변수 설정
3. `EmailService.ts` 수정
4. 로그 알림 트리거 활성화

**장기적으로 고려할 방법: 방법 3 (완전 자동화)**

- Database 레벨에서 자동 처리
- API 호출 오버헤드 감소
- 더 안정적인 이메일 발송

## 📝 다음 단계

1. ✅ 현재 구현 상태 확인 완료
2. ⏳ Resend 계정 생성 및 API 키 발급
3. ⏳ 환경 변수 설정
4. ⏳ 코드 수정 및 활성화
5. ⏳ 테스트 및 검증

## 🔗 참고 자료

- [Resend 공식 문서](https://resend.com/docs)
- [Supabase Edge Functions 가이드](https://supabase.com/docs/guides/functions)
- [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks)




