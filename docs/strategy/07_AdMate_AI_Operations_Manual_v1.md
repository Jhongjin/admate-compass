# AdMate AI Operations Manual v1

작성일: 2026-04-30
문서 상태: 초안 v1
작성 목적: AdMate 생태계를 지속 가능하게 운영하기 위한 AI 운영 체계, LLM 비용 관리, 주간 기술 인텔리전스 루프, 모델 라우팅, 보안/감사, 작업 이관 방식을 정의한다.

---

## 1. Executive Summary

AdMate는 AI Agent 기반 광고 운영 자동화 플랫폼이다.

AdMate가 단순한 PoC나 내부 자동화 도구에 머무르지 않고 지속 가능한 사내 플랫폼으로 성장하려면, 기능 개발만큼 중요한 것이 **AI 운영 체계**다.

AI 운영 체계는 다음 질문에 답해야 한다.

```text
어떤 LLM을 어디에 쓰는가?
비용은 얼마나 발생하는가?
비용이 급증하면 누가 확인하는가?
새로운 AI 기술은 어떻게 탐색하고 반영하는가?
모델 변경은 누가 승인하는가?
AI가 만든 결과는 어떻게 검증하는가?
운영자 피드백은 어떻게 학습에 반영하는가?
보안/ISMS 관점에서 어떤 데이터를 보호해야 하는가?
Codex/Paperclip 같은 개발 Agent에게 작업은 어떻게 넘기는가?
```

AdMate AI Operations Manual은 위 질문에 대한 운영 기준을 정의한다.

핵심 구성은 다음과 같다.

1. **LLM Cost Control Center**
   유료 LLM/API 비용을 실시간으로 추적하고 통제하는 관리자 대시보드

2. **Model Routing & Usage Policy**
   기능별로 적절한 모델을 선택하고 비용/성능을 최적화하는 정책

3. **Weekly Intelligence Upgrade Loop**
   매주 최신 AI/MarTech/광고 플랫폼 기술을 조사하고 AdMate에 반영할 후보를 선정하는 루틴

4. **AI Change Management**
   모델, 프롬프트, RAG, Agent action 변경을 안전하게 관리하는 절차

5. **Security / ISMS / Audit**
   데이터 보호, 권한, 감사 로그, 학습 통제 기준

6. **Builder Agent Handoff**
   Codex/Paperclip 등 개발 Agent에게 작업을 넘기고 결과를 검증하는 방식

---

## 2. 운영 대상 범위

AdMate AI Operations는 다음 제품과 내부 레이어를 모두 포함한다.

| 영역 | 운영 대상 |
|---|---|
| AdMate Compass | RAG 검색, 정책 답변, 근거 제공, 답변 검증 모델 |
| AdMate Sentinel | 사전 검수, 실시간 모니터링, 이상 감지, 알림 요약 |
| AdMate Lens | 캡처 생성, 이미지 처리, 비전 모델, 렌더링 자동화 |
| AdMate Foresight | 성과 예측, 벤치마크 분석, 시뮬레이션 모델 |
| AdMate Agent Core | Openclaw 실행 자동화, Hermes 학습/메모리, Slack Agent |
| Weekly Intelligence | Deep Search, 기술 리서치, 적용 후보 평가 |
| Builder Agents | Codex, Paperclip, 개발/기획 Agent 작업 루프 |

운영 체계의 목적은 단순 비용 절감이 아니다.

```text
비용을 통제하면서도,
정확도와 업무 효율을 높이고,
보안과 감사 가능성을 확보하며,
기술 변화에 빠르게 대응하는 것
```

---

## 3. 운영 원칙

## 3.1 비용은 기능 단위로 추적한다

LLM 비용은 단순히 전체 합계만 보면 안 된다.

다음 단위로 추적해야 한다.

- 플랫폼별
- 기능별
- 모델별
- 사용자별
- 캠페인별
- 요청 유형별
- 성공/실패별

예시:

```text
Compass / 정책 질문 / GPT-4.1 / 1,200 tokens / 35원
Sentinel / 이상 감지 요약 / Claude Sonnet / 2,500 tokens / 120원
Lens / 이미지 분석 / Vision model / 1 request / 80원
Foresight / 예측 리포트 / Gemini / 3,000 tokens / 90원
```

## 3.2 모델은 비싼 것이 아니라 적절한 것을 쓴다

모든 작업에 고성능 모델을 사용할 필요는 없다.

기본 원칙:

```text
단순 분류/요약/포맷팅
→ 경량 모델

정책 판단/복잡한 추론/임원 보고 문서
→ 고성능 모델

RAG 검색 전처리/키워드 확장
→ 저비용 모델 또는 룰 기반 처리

검증/팩트체크
→ 생성 모델과 분리된 검증 모델
```

## 3.3 자동화는 기록되어야 한다

AI가 수행한 모든 주요 작업은 기록되어야 한다.

- 어떤 기능이 호출되었는가
- 어떤 모델을 사용했는가
- 비용은 얼마인가
- 입력/출력의 요약은 무엇인가
- 누가 요청했는가
- 어떤 캠페인과 연결되는가
- 오류가 발생했는가
- 후속 action이 있었는가

## 3.4 학습은 신뢰 가능한 신호만 반영한다

Hermes는 모든 사용자 행동을 무조건 학습하면 안 된다.

학습 가능한 신호는 다음 조건을 충족해야 한다.

- 권한 있는 사용자 또는 검증된 시스템 이벤트
- 명확한 action type
- 캠페인/기능/맥락이 연결된 데이터
- smoke test 또는 디버그 데이터가 아닌 실제 운영 데이터
- 필요 시 관리자 승인 완료

## 3.5 보안이 비용보다 우선한다

비용을 줄이기 위해 보안 원칙을 낮추면 안 된다.

- raw campaign-level 데이터는 LLM에 직접 전달하지 않는다.
- API key/token/service role key는 절대 로그나 UI에 노출하지 않는다.
- 외부 LLM에 전달하는 데이터는 최소화한다.
- 내부 정책/광고주 데이터는 권한 기반으로 보호한다.

---

## 4. LLM Cost Control Center

## 4.1 목적

LLM Cost Control Center는 AdMate 전체에서 발생하는 AI 비용을 실시간으로 확인하고 통제하는 관리자 대시보드다.

관리자는 다음을 확인할 수 있어야 한다.

```text
오늘 얼마를 썼는가?
이번 달 예상 비용은 얼마인가?
어떤 플랫폼이 가장 많은 비용을 쓰는가?
어떤 모델이 비싼가?
어떤 기능에서 비용이 급증했는가?
비용 대비 업무 절감 효과는 있는가?
```

## 4.2 주요 지표

| 지표 | 설명 |
|---|---|
| Today Cost | 오늘 발생한 AI 비용 |
| Weekly Cost | 이번 주 누적 비용 |
| Monthly Cost | 이번 달 누적 비용 |
| Projected Month-end Cost | 월말 예상 비용 |
| Platform Cost | Compass/Sentinel/Lens/Foresight/Agent Core별 비용 |
| Model Cost | GPT/Claude/Gemini/Embedding/Vision 등 모델별 비용 |
| Feature Cost | 정책 답변, 이상 감지, 캡처, 예측 등 기능별 비용 |
| User Cost | 사용자별 요청 비용 |
| Campaign Cost | 캠페인별 AI 처리 비용 |
| Failed Request Cost | 실패 요청에서 발생한 비용 |
| Cache Savings | 캐시로 절감된 예상 비용 |
| Cost per Successful Task | 성공 작업 1건당 평균 비용 |

## 4.3 대시보드 구성

관리자 화면은 다음 카드로 구성할 수 있다.

```text
상단 Summary
- 오늘 비용
- 이번 달 비용
- 월말 예상 비용
- 예산 대비 사용률

중단 Breakdown
- 플랫폼별 비용
- 모델별 비용
- 기능별 비용
- 사용자별 비용

하단 Operations
- 비용 급증 이벤트
- 실패 요청
- 고비용 요청 Top 10
- 캐시 절감 효과
- 모델 교체 후보
```

## 4.4 비용 알림 기준

비용 알림은 다음 기준으로 설정할 수 있다.

| 알림 유형 | 조건 예시 |
|---|---|
| Daily Budget Warning | 일일 예산의 80% 초과 |
| Daily Budget Critical | 일일 예산의 100% 초과 |
| Spike Alert | 최근 7일 평균 대비 200% 이상 증가 |
| High Cost Request | 단일 요청 비용이 기준값 초과 |
| Failed Cost Alert | 실패 요청 비용이 일정 금액 초과 |
| Model Drift Cost | 특정 모델 비용이 급증했으나 성능 개선이 없음 |

## 4.5 비용 데이터 스키마 초안

```text
llm_usage_events
- id
- created_at
- platform
- feature
- provider
- model
- request_type
- prompt_tokens
- completion_tokens
- total_tokens
- estimated_cost
- currency
- user_id
- campaign_id
- status
- error_code
- error_message
- cache_hit
- latency_ms
- metadata
```

---

## 5. Model Routing & Usage Policy

## 5.1 모델 라우팅 목적

모델 라우팅은 비용과 품질의 균형을 맞추기 위한 정책이다.

좋은 라우팅은 다음을 만족해야 한다.

```text
간단한 작업은 저렴하게 처리한다.
복잡한 판단은 정확한 모델을 사용한다.
검증이 필요한 답변은 별도 검증 단계를 둔다.
반복 요청은 캐시를 활용한다.
비용이 큰 작업은 승인 또는 제한을 둔다.
```

## 5.2 기능별 모델 사용 원칙

| 기능 | 권장 모델 유형 | 이유 |
|---|---|---|
| 단순 분류 | 경량 모델 | 비용 절감 |
| 짧은 요약 | 경량 모델 | 속도/비용 우선 |
| 정책 답변 생성 | 중상급 모델 | 정확도 필요 |
| 정책 답변 검증 | 별도 검증 모델 | 할루시네이션 감소 |
| 이상 감지 요약 | 중급 모델 | 맥락 이해 필요 |
| 임원 보고 문서 | 고성능 모델 | 품질/논리 중요 |
| 미디어플래너 답변 | 중급 모델 | 명확한 한글 응답 필요 |
| 이미지/캡처 분석 | Vision 모델 | 시각 정보 필요 |
| 예측 설명 | 중상급 모델 | 수치 해석 필요 |
| Weekly Deep Search | 검색 특화 모델/도구 | 최신성 필요 |

## 5.3 모델 선택 기준

모델 선택 시 다음 기준을 사용한다.

- 정확도
- 비용
- 응답 속도
- 한국어 품질
- 긴 컨텍스트 처리 능력
- RAG 근거 활용 능력
- JSON/구조화 출력 안정성
- 보안/데이터 정책
- 사용량 한도
- 장애 대응 가능성

## 5.4 캐시 정책

반복 요청은 비용을 줄이기 위해 캐시한다.

캐시 후보:

- 동일 정책 질문
- 동일 문서 요약
- 동일 캠페인 일일 요약
- 동일 캡처 요청 결과
- 동일 벤치마크 조회 결과
- Weekly Intelligence에서 반복 조회되는 기술 정보

캐시 주의점:

- 정책/광고 플랫폼 정보는 최신성이 중요하므로 TTL을 둔다.
- 캠페인 운영 데이터는 실시간성이 중요하므로 캐시 시간을 짧게 둔다.
- 사용자 권한에 따라 캐시 공유 범위를 제한한다.

---

## 6. Weekly Intelligence Upgrade Loop

## 6.1 정의

Weekly Intelligence Upgrade Loop는 매주 빠르게 변하는 AI, MarTech, 광고 플랫폼, 개발 도구 정보를 조사하고, AdMate에 적용할 수 있는 업그레이드 후보를 선정하는 운영 루틴이다.

이 루틴의 목표는 다음과 같다.

```text
AdMate가 한 번 만든 플랫폼으로 멈추지 않고,
최신 기술 변화와 시장 변화를 계속 흡수하도록 만드는 것
```

## 6.2 조사 범위

주간 리서치 대상은 다음과 같다.

| 카테고리 | 예시 |
|---|---|
| LLM 모델 | OpenAI, Anthropic, Google, Meta, Mistral, Qwen 등 |
| Agent Framework | LangChain, LlamaIndex, CrewAI, AutoGen, Paperclip 등 |
| Workflow | n8n, Vercel, Supabase, FastAPI, Queue/Worker 도구 |
| RAG | embedding, reranking, hybrid search, vector DB 개선 |
| Vision/Image | 이미지 분석, 캡처 검증, 디자인 생성 모델 |
| Video/TTS | 영상 생성, TTS, 리포트 자동화 가능성 |
| Ad Platform API | Meta, Google, Naver, Kakao, X API 변경 |
| Security | AI 보안, prompt injection, data leakage, ISMS 관련 이슈 |
| Competitor/Market | 광고 운영 자동화 솔루션, 마케팅 AI SaaS |

## 6.3 주간 운영 절차

```text
1. 월요일 오전 Deep Search 실행
2. 최신 기술/가격/API/보안 변경 수집
3. Hermes가 요약 및 분류
4. AdMate 적용 가능성 평가
5. 비용 절감/성능 개선/보안 리스크 평가
6. 적용 후보 우선순위화
7. 이번 주 적용 / Backlog / 보류 / 폐기 분류
8. Codex/Paperclip 작업 프롬프트 생성
9. 적용 결과 기록
```

## 6.4 평가 기준

각 기술/아이디어는 다음 기준으로 평가한다.

| 기준 | 질문 |
|---|---|
| 관련성 | AdMate 제품군에 직접 도움이 되는가? |
| 효과 | 업무 효율/정확도/비용 절감 효과가 있는가? |
| 난이도 | 구현 난이도는 어느 정도인가? |
| 비용 | 추가 비용이 발생하는가? 절감 가능한가? |
| 보안 | 민감 데이터 노출 위험은 없는가? |
| 안정성 | 운영 환경에 적용 가능한 수준인가? |
| 우선순위 | 이번 주에 할 만큼 중요한가? |

## 6.5 산출물 템플릿

주간 리포트는 다음 구조로 만든다.

```text
# Weekly Intelligence Report YYYY-MM-DD

## 1. 이번 주 핵심 요약

## 2. 주요 기술/모델 업데이트

## 3. 광고 플랫폼/API 변경

## 4. AdMate 적용 후보

| 후보 | 대상 플랫폼 | 기대 효과 | 난이도 | 우선순위 |

## 5. 비용 절감 후보

## 6. 보안/리스크 이슈

## 7. 이번 주 실행 과제

## 8. Codex/Paperclip 작업 프롬프트
```

---

## 7. AI Change Management

## 7.1 변경 관리가 필요한 이유

AI 시스템은 모델, 프롬프트, RAG 데이터, Agent action이 바뀌면 결과 품질이 크게 달라질 수 있다.

따라서 다음 변경은 반드시 기록하고 검증해야 한다.

- 모델 변경
- 프롬프트 변경
- RAG 검색 방식 변경
- embedding/reranker 변경
- Agent action 추가
- Slack 버튼 action 변경
- 학습 기준 변경
- 비용 정책 변경

## 7.2 변경 단계

```text
변경 제안
→ 영향 범위 분석
→ 테스트 계획
→ 개발/수정
→ 빌드/검증
→ smoke test
→ 운영 반영
→ 결과 모니터링
→ 문서화
```

## 7.3 변경 기록 항목

- 변경 일자
- 변경자
- 변경 대상
- 변경 이유
- 영향 범위
- 테스트 결과
- rollback 방법
- 비용 영향
- 보안 영향
- 관련 commit/document

## 7.4 프롬프트 변경 원칙

프롬프트는 코드만큼 중요하게 관리한다.

원칙:

- 버전을 붙인다.
- 변경 이유를 남긴다.
- 출력 schema를 명확히 한다.
- downstream validator가 있다면 함께 업데이트한다.
- 실패 케이스를 문서화한다.
- 운영 프롬프트에 secret이나 민감 정보를 넣지 않는다.

---

## 8. Builder Agent Handoff 운영

## 8.1 목적

Codex, Paperclip, 기타 개발 Agent는 AdMate 개발 속도를 높이는 도구다.

하지만 Agent에게 작업을 넘길 때는 명확한 문맥과 제약 조건이 필요하다.

## 8.2 기본 원칙

- 작업 목적을 먼저 설명한다.
- 관련 문서를 먼저 읽게 한다.
- 코드 수정 전 분석 결과를 보고하게 한다.
- 기능 변경 금지/허용 범위를 명시한다.
- .env, API key, token을 출력하지 못하게 한다.
- git commit/push는 명시 승인 전 금지한다.
- build/test 결과를 반드시 보고하게 한다.

## 8.3 Codex 작업 프롬프트 기본 구조

```text
이 프로젝트는 AdMate 생태계의 일부입니다.
먼저 다음 문서를 읽어주세요.

1. AGENTS.md
2. docs/design/openclaw-theme-reference.md
3. docs/tasks 또는 docs/strategy 관련 문서

작업 목표:
- ...

제약 조건:
- 기능/비즈니스 로직 변경 금지
- API/DB schema 변경 금지
- 라우팅 변경 금지
- .env/API key/token 출력 금지
- commit/push는 승인 전 금지

먼저 다음을 보고해주세요.
1. 현재 구조 요약
2. 수정 후보 파일
3. 위험 요소
4. 작업 계획
```

## 8.4 작업 완료 보고 기준

Codex/Paperclip은 작업 후 다음을 보고해야 한다.

- 변경 파일 목록
- 변경 이유
- 테스트/빌드 결과
- 남은 이슈
- rollback 방법
- commit 메시지 제안
- 다음 작업 제안

---

## 9. 보안/ISMS 운영 원칙

## 9.1 민감 정보 관리

절대 출력/커밋하면 안 되는 값:

- SUPABASE_SERVICE_ROLE_KEY
- OPENCLAW_INGEST_KEY
- Slack bot token
- Meta access token
- Google API key
- SMTP password
- Supabase Auth 초기 비밀번호
- .env.local
- n8n credentials
- LLM provider API key

## 9.2 LLM에 전달하면 안 되는 데이터

- 광고주 민감 정보 원문
- raw campaign-level 상세 데이터
- 개인 식별 정보
- 인증 정보
- 내부 계약/단가 정보 원문
- 비공개 전략 문서 원문

필요 시 다음 형태로 변환한다.

```text
익명화
집계
요약
범주화
샘플링
권한 확인 후 제한 전달
```

## 9.3 감사 대상

- 권한 변경
- 학습 반영
- 전역 기준값 변경
- 캠페인 기준값 변경
- Agent action 실행
- 외부 API 호출
- 비용 급증
- 실패 이벤트
- 관리자 로그인

---

## 10. 장애/비용/품질 운영 대응

## 10.1 장애 유형

| 유형 | 예시 |
|---|---|
| API 장애 | Meta API 실패, Supabase 오류, Slack 발송 실패 |
| LLM 장애 | timeout, rate limit, malformed JSON |
| 비용 장애 | 요청 폭증, 고비용 모델 오사용 |
| 품질 장애 | 잘못된 답변, hallucination, 과도한 알림 |
| 데이터 장애 | 0값 기반 가짜 알림, 누락된 캠페인 데이터 |
| 권한 장애 | 비인가 사용자 action, 세션 오류 |

## 10.2 대응 원칙

- 실패를 숨기지 않는다.
- 운영자가 이해 가능한 한글 메시지로 표시한다.
- 실패 이벤트도 로그에 남긴다.
- 비용이 큰 재시도는 제한한다.
- 외부 API 실패 시 가짜 정상/가짜 이상 결과를 만들지 않는다.
- 자동 복구 가능한 경우와 수동 조치가 필요한 경우를 구분한다.

## 10.3 품질 이슈 대응

Compass 답변 오류:

```text
오류 답변 기록
→ 근거 문서 확인
→ RAG 검색 품질 점검
→ prompt/model/reranker 개선 후보 등록
```

Sentinel 오탐:

```text
오탐 action 기록
→ Hermes learning candidate 생성
→ 반복 여부 확인
→ 기준 조정 후보 생성
```

Foresight 예측 오류:

```text
예측값과 실제값 비교
→ 업종/목표/기간 기준 확인
→ 데이터 기간/마크업/Net-Gross 기준 점검
```

---

## 11. 운영 리듬

## 11.1 일간 운영

- Sentinel 알림 상태 확인
- 실패 delivery 확인
- 주요 비용 급증 여부 확인
- Slack action 오류 확인
- 시스템 로그 이상 확인

## 11.2 주간 운영

- Weekly Intelligence Report 생성
- LLM 비용 주간 리포트 확인
- Hermes 학습 후보 검토
- 반복 오탐/반복 질문 확인
- Codex/Paperclip 작업 backlog 정리

## 11.3 월간 운영

- 월간 LLM 비용 리뷰
- 플랫폼별 사용량 리뷰
- 모델 라우팅 정책 점검
- 보안/권한 감사
- 임원/팀장 보고용 요약 작성
- 다음 달 우선순위 확정

---

## 12. 운영 역할과 책임

| 역할 | 책임 |
|---|---|
| Super Admin | 전체 권한, 비용 정책, 학습 정책, 보안 기준 관리 |
| Admin | 관리 범위 내 사용자/캠페인/설정 운영 |
| Reviewer | Hermes 학습 후보 검토, 추천 품질 평가 |
| Media Planner | 실제 업무 사용, 알림 대응, 피드백 제공 |
| Data Analytics Team | 플랫폼 기획, 운영 정책, 분석/자동화 고도화 |
| Builder Agent | 승인된 범위 내 코드/문서/테스트 작업 수행 |
| Hermes | 운영 지식 저장, 피드백 학습, 추천 품질 평가 |
| Openclaw | workflow 실행, 알림, 외부 Tool 호출, 기록 |

---

## 13. KPI 및 성공 지표

AdMate AI Operations의 성공은 단순 사용량이 아니라 운영 품질로 평가해야 한다.

| 영역 | KPI 후보 |
|---|---|
| 비용 | 월간 LLM 비용, 작업당 평균 비용, 캐시 절감액 |
| 품질 | 답변 정확도, 알림 오탐률, 추천 신뢰도 |
| 효율 | 정책 확인 시간 감소, 검수 시간 감소, 캡처 시간 감소 |
| 안정성 | 실패 요청률, 재시도 성공률, API 장애 대응 시간 |
| 학습 | 유효 피드백 수, 학습 반영 건수, recurring issue 감소 |
| 보안 | 권한 오류 건수, audit 누락 건수, secret 노출 0건 |
| 기술 진화 | 주간 리서치 후보 수, 실제 적용 건수, 비용 절감 효과 |

---

## 14. 우선 구축 항목

AI Operations 체계에서 우선 구축할 항목은 다음과 같다.

### 1순위. 비용 이벤트 로깅

- llm_usage_events 테이블 설계
- provider/model/feature/cost 기록
- 실패 요청도 기록

### 2순위. 관리자 Cost Dashboard

- 오늘/이번 달 비용
- 플랫폼별 비용
- 모델별 비용
- 고비용 요청
- 비용 급증 알림

### 3순위. Weekly Intelligence 템플릿

- 주간 리서치 문서 포맷
- 적용 후보 평가 기준
- Codex 작업 이관 프롬프트

### 4순위. Model Routing Policy

- 기능별 기본 모델
- 고비용 작업 승인 기준
- 캐시 정책
- fallback 모델

### 5순위. AI Change Log

- 모델 변경 기록
- 프롬프트 변경 기록
- RAG 변경 기록
- Agent action 변경 기록

---

## 15. 최종 요약

AdMate는 AI를 활용한 개별 도구가 아니라, 지속적으로 운영되고 고도화되어야 하는 AI Agent 기반 광고 운영 자동화 플랫폼이다.

따라서 기능 개발과 함께 다음 운영 체계가 반드시 필요하다.

```text
LLM 비용을 실시간으로 관리한다.
모델을 기능별로 적절히 라우팅한다.
최신 기술을 매주 탐색하고 반영한다.
AI 변경 사항을 기록하고 검증한다.
Codex/Paperclip 작업을 안전하게 이관한다.
보안/권한/감사 기준을 초기부터 설계한다.
Hermes 학습은 신뢰 가능한 신호만 반영한다.
```

이 운영 체계가 있어야 AdMate는 단기 PoC가 아니라, 나스미디어의 장기 경쟁력이 되는 AI 운영 플랫폼으로 성장할 수 있다.
