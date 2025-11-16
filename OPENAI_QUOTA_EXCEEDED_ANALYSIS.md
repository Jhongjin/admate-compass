# OpenAI Embeddings API 할당량 초과 원인 분석

## ⚠️ 중요: ChatGPT Plus와 OpenAI API는 별개 서비스

**ChatGPT Plus 구독 ≠ OpenAI API 사용량**

- **ChatGPT Plus**: `chat.openai.com` 웹 애플리케이션 사용을 위한 구독 서비스
- **OpenAI API**: 별도의 사용량 기반 과금 서비스 (구독과 무관)

**따라서 ChatGPT Plus를 구독하더라도 OpenAI API는 별도의 할당량 제한이 적용됩니다.**

---

## 🔍 할당량 초과 원인 분석

### 1. **무료 티어 사용 중**

**가능성: 높음**

OpenAI API는 기본적으로 **무료 티어**를 제공합니다:
- **월 $5 크레딧** (신규 사용자)
- 또는 **제한된 할당량** (RPM, TPM)

**확인 방법:**
1. [OpenAI Platform](https://platform.openai.com/usage) 접속
2. Usage 페이지에서 현재 사용량 확인
3. Billing 페이지에서 현재 플랜 확인

**해결 방법:**
- **Pay-as-you-go 플랜으로 업그레이드** (필요한 만큼만 과금)
- 또는 **할당량 증가 요청** (OpenAI 지원팀에 문의)

---

### 2. **사용량 급증**

**로그 분석 결과:**

```
메인 페이지: 13개 청크
하위 페이지 1: 8개 청크
하위 페이지 2: 3개 청크
하위 페이지 3: 3개 청크
하위 페이지 4: 3개 청크
...
총 41개 하위 페이지 예상
```

**예상 사용량:**
- 메인 페이지: 13개 청크
- 하위 페이지: 약 100-200개 청크 (41개 페이지 × 평균 3-5개 청크)
- **총 약 113-213개 청크**

**비용 계산:**
- `text-embedding-3-small`: $0.00002/1K tokens
- 청크당 평균 200자 (약 50 tokens)
- 200개 청크 × 50 tokens = 10,000 tokens
- **비용: 약 $0.0002 (거의 무료)**

**하지만 할당량 제한:**
- 무료 티어: **월 $5 크레딧** 또는 **제한된 RPM/TPM**
- 크롤링 중 **짧은 시간 내에 많은 요청** 발생
- **Rate Limit (RPM) 초과 가능성**

---

### 3. **Rate Limit (RPM/TPM) 초과**

**OpenAI API Rate Limits:**

| 플랜 | RPM (Requests Per Minute) | TPM (Tokens Per Minute) |
|------|---------------------------|-------------------------|
| 무료 티어 | 3-60 | 40,000-1,000,000 |
| Pay-as-you-go | 500-10,000 | 1,000,000-10,000,000 |

**현재 코드:**
```typescript
// 배치 크기: 100개
const BATCH_SIZE = 100;
// 병렬 처리: 여러 배치 동시 처리
const allBatchPromises = batches.map(async (batch, batchIndex) => {
  // ...
});
```

**문제점:**
- 크롤링 중 **여러 문서가 동시에 처리**됨
- 각 문서마다 **배치 요청 발생**
- **RPM 제한 초과 가능성 높음**

**예시:**
- 8개 하위 페이지 동시 처리
- 각 페이지당 1개 배치 요청
- **8개 요청이 동시에 발생** → RPM 제한 초과

---

### 4. **API 키 설정 문제**

**가능성: 중간**

- API 키가 **무료 티어 계정**에 연결되어 있을 수 있음
- 또는 **테스트/개발용 API 키** 사용 중

**확인 방법:**
1. [OpenAI Platform](https://platform.openai.com/api-keys) 접속
2. 사용 중인 API 키 확인
3. 해당 계정의 플랜 및 할당량 확인

---

## 💡 해결 방안

### 즉시 해결 (이미 적용됨)

**BGE-M3 자동 Fallback:**
- OpenAI API 실패 시 자동으로 BGE-M3로 전환
- 할당량 초과 시에도 크롤링 계속 진행

**코드:**
```typescript
catch (openAIError: any) {
  const isQuotaError = errorMessage.includes('429') || 
                      errorMessage.includes('quota') || 
                      errorMessage.includes('insufficient_quota');
  
  if (isQuotaError) {
    console.error(`❌ OpenAI API 할당량 초과 (429). BGE-M3로 자동 전환합니다.`);
    // BGE-M3로 fallback
  }
}
```

---

### 근본 해결

#### 옵션 1: Pay-as-you-go 플랜으로 업그레이드 (권장)

**장점:**
- ✅ 무제한 사용 (할당량 제한 없음)
- ✅ 사용한 만큼만 과금 ($0.00002/1K tokens)
- ✅ Rate Limit 증가 (RPM 500-10,000)

**비용:**
- 문서 1개 (13개 청크): 약 $0.0000013
- 문서 100개: 약 $0.00013
- 문서 10,000개: 약 $0.013

**설정 방법:**
1. [OpenAI Platform](https://platform.openai.com/account/billing) 접속
2. Billing → Payment method 추가
3. Pay-as-you-go 플랜 활성화

---

#### 옵션 2: Rate Limit 조정

**현재 코드 개선:**
```typescript
// 배치 크기 감소 (100 → 50)
const BATCH_SIZE = 50;

// 요청 간 지연 추가
await new Promise(resolve => setTimeout(resolve, 100)); // 100ms 지연
```

**장점:**
- ✅ Rate Limit 초과 방지
- ✅ 안정적인 처리

**단점:**
- ❌ 처리 시간 증가

---

#### 옵션 3: BGE-M3를 기본값으로 사용

**현재 상태:**
- 기본값: OpenAI (할당량 초과 시 BGE-M3로 fallback)

**변경:**
```typescript
// 기본값을 BGE-M3로 변경
const provider = (process.env.EMBEDDING_PROVIDER || 'bge-m3').toLowerCase();
```

**장점:**
- ✅ 비용 없음
- ✅ 할당량 제한 없음
- ✅ 정확도 높음 (90-95%)

**단점:**
- ❌ 초기화 시간 40-90초 (서버리스 환경)
- ❌ 처리 시간 증가

---

## 📊 사용량 모니터링

### 현재 사용량 확인

1. **OpenAI Platform Dashboard:**
   - [Usage](https://platform.openai.com/usage)
   - [Billing](https://platform.openai.com/account/billing)

2. **로그 분석:**
   ```
   청크 개수: 13개 (메인 페이지)
   청크 개수: 8개 (하위 페이지 1)
   청크 개수: 3개 (하위 페이지 2)
   ...
   ```

### 예상 사용량 계산

**공식:**
```
총 청크 수 × 평균 토큰 수 = 총 토큰 수
총 토큰 수 × $0.00002/1K tokens = 총 비용
```

**예시:**
- 크롤링 1회: 200개 청크
- 평균 토큰: 50 tokens/청크
- 총 토큰: 10,000 tokens
- **비용: $0.0002**

---

## 🎯 권장 사항

### 단기 해결
1. ✅ **BGE-M3 자동 Fallback** (이미 적용됨)
2. ✅ 할당량 초과 시에도 크롤링 계속 진행

### 장기 해결
1. **Pay-as-you-go 플랜으로 업그레이드** (권장)
   - 비용: 거의 무료 ($0.013/10,000개 문서)
   - 안정성: 높음
   - 처리 속도: 빠름

2. **사용량 모니터링**
   - OpenAI Platform에서 사용량 추적
   - 비용 알림 설정

3. **Rate Limit 최적화**
   - 배치 크기 조정
   - 요청 간 지연 추가 (필요 시)

---

## 📝 참고 자료

- [OpenAI API Pricing](https://openai.com/api/pricing/)
- [OpenAI API Rate Limits](https://platform.openai.com/docs/guides/rate-limits)
- [OpenAI Usage Dashboard](https://platform.openai.com/usage)
- [OpenAI Billing](https://platform.openai.com/account/billing)

