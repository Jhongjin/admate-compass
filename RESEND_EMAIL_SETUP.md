# 📧 Resend 이메일 발신 주소 설정 가이드

## 🎯 ALERT_FROM_EMAIL 설정 방법

`ALERT_FROM_EMAIL`은 Resend를 통해 이메일을 발송할 때 사용되는 **발신자 이메일 주소**입니다.

## 📋 두 가지 방법

### 방법 1: Resend 테스트 도메인 사용 (테스트/개발용) ⭐ **가장 간단**

**장점:**
- 도메인 인증 불필요
- 즉시 사용 가능
- 테스트에 최적

**설정 값:**
```
ALERT_FROM_EMAIL=onboarding@resend.dev
```

**또는 다른 Resend 테스트 이메일:**
- `delivered@resend.dev`
- `hello@resend.dev`

**주의사항:**
- 테스트 도메인은 실제 프로덕션 환경에서는 권장되지 않습니다
- 일부 이메일 클라이언트에서 스팸으로 분류될 수 있습니다

---

### 방법 2: 자신의 도메인 사용 (프로덕션용) ⭐ **권장**

**장점:**
- 브랜드 일관성 유지
- 높은 전송률
- 스팸 필터 통과율 향상

**설정 단계:**

#### 1단계: Resend에서 도메인 추가

1. **Resend Dashboard** 접속: https://resend.com
2. **Domains** 메뉴 클릭
3. **Add Domain** 버튼 클릭
4. 도메인 입력 (예: `nasmedia.co.kr`)
5. **Add** 클릭

#### 2단계: DNS 레코드 설정

Resend가 제공하는 DNS 레코드를 도메인 관리자 페이지에 추가:

**필수 DNS 레코드:**
```
Type: TXT
Name: @ (또는 도메인명)
Value: [Resend가 제공하는 인증 값]
```

**SPF 레코드 (선택사항):**
```
Type: TXT
Name: @
Value: v=spf1 include:resend.com ~all
```

**DKIM 레코드 (선택사항):**
```
Type: TXT
Name: resend._domainkey
Value: [Resend가 제공하는 DKIM 값]
```

#### 3단계: 도메인 인증 확인

1. DNS 레코드 추가 후 **Resend Dashboard**에서 **Verify** 클릭
2. 인증 완료까지 몇 분~몇 시간 소요될 수 있습니다
3. 인증 완료 후 도메인 상태가 **Verified**로 변경됩니다

#### 4단계: 이메일 주소 설정

인증된 도메인을 사용하여 이메일 주소 설정:

```
ALERT_FROM_EMAIL=noreply@nasmedia.co.kr
```

**또는 다른 주소:**
- `alerts@nasmedia.co.kr`
- `system@nasmedia.co.kr`
- `notifications@nasmedia.co.kr`

---

## 🚀 Supabase Secrets에 설정하기

### Supabase Dashboard에서 설정:

1. **Supabase Dashboard** → **Settings** → **Edge Functions** → **Secrets**
2. **New Secret** 클릭
3. **Key**: `ALERT_FROM_EMAIL`
4. **Value**: 선택한 이메일 주소 입력
   - 테스트용: `onboarding@resend.dev`
   - 프로덕션용: `noreply@nasmedia.co.kr`
5. **Save** 클릭

### Supabase CLI로 설정:

```bash
# 테스트용
supabase secrets set ALERT_FROM_EMAIL=onboarding@resend.dev

# 프로덕션용 (도메인 인증 후)
supabase secrets set ALERT_FROM_EMAIL=noreply@nasmedia.co.kr
```

---

## 📝 현재 코드의 기본값

현재 Edge Function 코드에는 다음 기본값이 설정되어 있습니다:

```typescript
const ALERT_FROM_EMAIL = Deno.env.get('ALERT_FROM_EMAIL') || 'noreply@nasmedia.co.kr'
```

**즉, Secrets에 `ALERT_FROM_EMAIL`을 설정하지 않으면 `noreply@nasmedia.co.kr`이 사용됩니다.**

---

## ✅ 추천 설정

### 테스트 단계:
```
ALERT_FROM_EMAIL=onboarding@resend.dev
```

### 프로덕션 단계:
```
ALERT_FROM_EMAIL=noreply@nasmedia.co.kr
```
(도메인 인증 필요)

---

## 🔍 확인 방법

### 1. Resend Dashboard에서 확인
- **Emails** → **Logs**에서 발송된 이메일 확인
- **From** 필드에 설정한 주소가 표시되는지 확인

### 2. 수신 이메일에서 확인
- 받은 이메일의 **From** 필드 확인
- 발신자 주소가 올바르게 표시되는지 확인

---

## ⚠️ 주의사항

1. **도메인 인증 전 사용 시**
   - Resend가 이메일 발송을 거부할 수 있습니다
   - 에러 메시지: "Domain not verified"

2. **테스트 도메인 사용 시**
   - 프로덕션 환경에서는 피하는 것이 좋습니다
   - 일부 이메일 클라이언트에서 차단될 수 있습니다

3. **이메일 주소 형식**
   - 유효한 이메일 형식이어야 합니다
   - 특수문자나 공백은 사용할 수 없습니다

---

## 🐛 트러블슈팅

### 문제: "Domain not verified" 오류

**해결 방법:**
1. Resend Dashboard에서 도메인 인증 상태 확인
2. DNS 레코드가 올바르게 설정되었는지 확인
3. DNS 전파 시간 대기 (최대 48시간)

### 문제: 이메일이 스팸으로 분류됨

**해결 방법:**
1. SPF, DKIM 레코드 추가
2. DMARC 정책 설정
3. Resend의 도메인 인증 완료 확인

---

## 📚 참고 자료

- [Resend 도메인 인증 가이드](https://resend.com/docs/dashboard/domains/introduction)
- [Resend DNS 설정 가이드](https://resend.com/docs/dashboard/domains/verify-your-domain)
- [Supabase Secrets 문서](https://supabase.com/docs/guides/functions/secrets)




