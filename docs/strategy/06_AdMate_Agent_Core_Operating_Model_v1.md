# AdMate Agent Core Operating Model v1

작성일: 2026-04-30
문서 상태: 초안 v1
작성 목적: AdMate Agent Core의 역할, 내부 구성, Openclaw/Hermes 책임 분리, Agent 운영 방식, 권한/감사/학습 원칙, 플랫폼 Tool 연계 구조를 정의한다.

---

## 1. Executive Summary

AdMate Agent Core는 AdMate 생태계의 지능과 자동화를 담당하는 공통 운영 레이어다.

AdMate Compass, Sentinel, Lens, Foresight가 각각 정책, 검수/모니터링, 캡처, 플래닝이라는 전문 기능을 제공한다면, Agent Core는 이 네 플랫폼을 연결하고 실행하고 기록하고 학습하게 만든다.

Agent Core는 내부적으로 두 축으로 구성된다.

```text
Openclaw
= 업무를 실행하는 자동화 실행 엔진

Hermes
= 지식을 축적하고 판단 기준을 고도화하는 지능/메모리 엔진
```

쉽게 말하면:

```text
Openclaw는 손과 발이다.
Hermes는 기억하고 판단하는 두뇌다.
AdMate Agent Core는 이 둘을 묶어 AdMate 전체 플랫폼에 지능과 자동화를 제공한다.
```

Agent Core의 목적은 AI가 단순히 답변만 하는 구조를 넘어, 실제 광고 운영 업무에서 다음을 수행하게 만드는 것이다.

- 정해진 스케줄과 조건에 따라 업무 실행
- 캠페인 상태 모니터링
- Slack/Email 알림
- 운영자 액션 수집
- 외부 플랫폼 Tool 호출
- 판단 결과와 피드백 기록
- Hermes 학습 반영
- 비용, 권한, 감사 로그 관리

---

## 2. Agent Core가 필요한 이유

AdMate의 각 제품은 독립적으로도 업무 가치를 제공한다.

- Compass는 정책을 답한다.
- Sentinel은 캠페인을 검수하고 감지한다.
- Lens는 캡처와 증빙을 만든다.
- Foresight는 다음 성과를 예측한다.

그러나 각 제품이 따로 존재하면 다음 한계가 생긴다.

| 한계 | 설명 |
|---|---|
| 업무 흐름 단절 | 정책, 검수, 캡처, 예측 결과가 서로 연결되지 않음 |
| 피드백 손실 | 운영자가 내린 판단이 다음 운영 기준으로 축적되지 않음 |
| 자동화 한계 | 사람이 매번 각 도구를 직접 실행해야 함 |
| 감사 어려움 | 누가 어떤 판단과 실행을 했는지 추적하기 어려움 |
| 비용 통제 어려움 | 어떤 기능이 어떤 LLM/API 비용을 쓰는지 파악하기 어려움 |

Agent Core는 이 한계를 해결한다.

```text
개별 AI 도구
→ Agent Core로 연결된 업무 흐름
→ 실행/기록/학습 가능한 운영 시스템
```

---

## 3. Agent Core의 핵심 원칙

## 3.1 Human-in-the-loop

AdMate Agent Core는 모든 것을 자율적으로 실행하는 시스템이 아니다.

중요한 의사결정과 위험 액션에는 사람의 확인과 승인이 필요하다.

예시:

- 캠페인 알림 종료
- 학습 기준 반영
- 예산 관련 기준 변경
- 권한 변경
- 비용이 큰 LLM/이미지/비디오 작업 실행
- 외부 시스템에 영향을 주는 action

## 3.2 Record everything

Agent가 실행한 일, 사용자가 누른 버튼, 시스템이 보낸 알림, Hermes가 학습한 내용은 기록되어야 한다.

기본 기록 대상:

- operator_actions
- audit_logs
- alert_events
- alert_deliveries
- feedback events
- LLM usage events
- tool execution events

## 3.3 Learn only from trusted signals

모든 사용자 행동이 Hermes 학습에 반영되면 안 된다.

학습 반영은 권한 있는 사용자의 명시적 피드백 또는 검증된 운영 이벤트 중심으로 이루어져야 한다.

권한 구조:

| 역할 | 학습 반영 |
|---|---|
| Super Admin | 가능 |
| Admin | 제한적 가능 |
| Reviewer | 승인된 범위 내 가능 |
| User | 기본적으로 학습 제외 |

## 3.4 Explainable automation

Agent가 자동으로 수행한 작업은 설명 가능해야 한다.

예시:

```text
왜 이 알림이 발생했는가?
어떤 기준으로 이상이라고 판단했는가?
누가 알림을 중지했는가?
어떤 피드백이 학습 후보가 되었는가?
이 작업에 어떤 LLM/API 비용이 발생했는가?
```

## 3.5 Security by design

광고 운영 데이터와 캠페인 성과 데이터는 민감하다.

따라서 Agent Core는 초기 설계부터 다음 원칙을 따른다.

- raw campaign-level 데이터는 LLM에 직접 전달하지 않는다.
- 필요 시 집계/요약/익명화된 데이터만 사용한다.
- API key와 service role key는 브라우저에 노출하지 않는다.
- 모든 권한 변경은 audit log에 남긴다.
- 외부 Tool 호출은 권한과 목적을 확인한 뒤 실행한다.

---

## 4. Openclaw의 역할

Openclaw는 Agent Core의 실행 엔진이다.

Openclaw는 조건과 스케줄에 따라 업무를 실행하고, 외부 시스템과 API를 연결하고, 결과를 기록한다.

### 4.1 주요 책임

- 스케줄 기반 workflow 실행
- 캠페인 상태 모니터링
- 알림 생성
- Slack/Email 발송
- Slack button action 처리
- 외부 API 호출
- n8n workflow orchestration
- operator_actions 기록
- alert_events / alert_deliveries 관리
- 플랫폼 Tool 호출
- 관리자 콘솔 API 제공

### 4.2 Openclaw가 담당하는 대표 작업

```text
매일 오전 캠페인 상태 점검
캠페인 KPI 이상 감지
Slack 알림 발송
운영자 버튼 액션 처리
알림 보류/중지/재개 적용
Daily Review Report 발송
Lens 캡처 생성 요청
Compass 정책 질의 요청
Foresight 시뮬레이션 요청
```

### 4.3 Openclaw가 담당하지 않는 것

Openclaw는 판단 기준 자체를 장기적으로 학습하는 레이어가 아니다.

Openclaw는 실행하고 기록한다.
판단 기준의 축적과 개선은 Hermes가 담당한다.

---

## 5. Hermes의 역할

Hermes는 Agent Core의 지능/메모리 엔진이다.

Hermes는 AI와 사용자 이벤트, 운영자 피드백, 캠페인 이벤트를 학습해 회사 고유의 광고 운영 지식과 판단 기준을 축적한다.

### 5.1 주요 책임

- 운영자 피드백 저장
- 추천 품질 평가
- false positive / true positive 판단 축적
- 업종/목표/매체별 예외 기준 관리
- 캠페인 운영 지식 저장
- 반복 이슈 탐지
- 추천 신뢰도 평가
- 학습 권한 반영
- 다음 알림/추천 기준 개선

### 5.2 Hermes가 학습해야 하는 것

- 어떤 알림이 실제로 중요한 알림이었는가
- 어떤 알림이 과도한 오탐이었는가
- 특정 업종/목표에서 허용 가능한 KPI 변동 범위는 무엇인가
- 어떤 세팅 오류가 반복되는가
- 어떤 정책 질문이 자주 발생하는가
- 어떤 캡처 요청이 반복되는가
- Foresight 예측과 실제 성과가 얼마나 차이 나는가
- 어떤 운영자 피드백이 신뢰할 만한가

### 5.3 Hermes가 바로 자동 반영하면 안 되는 것

Hermes는 학습 후보를 만들 수 있지만, 모든 기준을 즉시 자동 변경하면 안 된다.

다음 항목은 관리자 승인 또는 검토 단계가 필요하다.

- 전역 기준값 변경
- 캠페인 기준값 변경
- 알림 민감도 조정
- 예측 모델 기준 반영
- 비용 정책 변경
- 권한/학습 범위 변경

---

## 6. Agent Core 운영 흐름

## 6.1 기본 이벤트 흐름

```text
Event 발생
→ Openclaw가 감지/수집
→ 필요 시 Tool 호출
→ 결과 분석
→ Slack/Web Console에 알림
→ 운영자 action
→ operator_actions 기록
→ Hermes 학습 후보 생성
→ 관리자 검토
→ 기준 반영
```

## 6.2 캠페인 모니터링 흐름

```text
Schedule 실행
→ 캠페인 데이터 수집
→ Sentinel Live Monitoring 기준 적용
→ 이상 감지
→ 중복/억제 조건 확인
→ Slack/Email 발송
→ alert_events / alert_deliveries 기록
→ 운영자 버튼 action
→ Hermes 피드백 저장
```

## 6.3 사전 검수 흐름

```text
캠페인 등록
→ 미디어믹스/기획안 데이터 수집
→ 매체 플랫폼 세팅값 수집
→ Sentinel Pre-launch Validation 비교
→ 오류/주의/정상 분류
→ 검수 리포트 생성
→ 운영자 승인
→ Live Monitoring 시작
```

## 6.4 정책 질의 흐름

```text
사용자 질문 또는 시스템 이슈 발생
→ Agent Core가 campaign context 확인
→ Compass Tool 호출
→ 정책/가이드 검색
→ 답변 및 근거 생성
→ Slack/Web Console 응답
→ 질문/답변 이력 저장
```

## 6.5 캡처 생성 흐름

```text
캠페인 또는 리포트 이벤트 발생
→ Agent Core가 캡처 필요 여부 확인
→ Lens Tool 호출
→ 캡처 생성
→ 결과 이미지 저장
→ 캠페인 기록에 연결
```

## 6.6 플래닝 예측 흐름

```text
캠페인 기획 요청
→ Foresight Tool 호출
→ 업종/목표/예산/기간 입력
→ 과거 데이터 기반 예상 지표 계산
→ Hermes 운영 피드백 보정
→ 예상 성과와 근거 제공
```

---

## 7. Agent 유형 정의

Agent Core 안에서 다음과 같은 전문 Agent를 둘 수 있다.

| Agent | 역할 | 주요 Tool |
|---|---|---|
| Campaign Monitor Agent | 캠페인 상태와 KPI 이상 감지 | Sentinel |
| Setup Validation Agent | 시작 전 세팅값 검수 | Sentinel |
| Policy QA Agent | 정책/가이드 근거 검색 및 답변 | Compass |
| Capture Generation Agent | 광고 캡처 및 증빙 생성 | Lens |
| Planning Simulation Agent | 예상 성과 시뮬레이션 | Foresight |
| Operator Feedback Agent | 운영자 피드백 수집/정리 | Hermes |
| Audit & Compliance Agent | 권한/감사/보안 점검 | Audit logs |
| Cost Control Agent | LLM/API 비용 감시 | Cost Center |
| Intelligence Research Agent | 최신 기술/시장 변화 조사 | Deep Search |

각 Agent는 독립 제품이 아니라 Agent Core 내부 역할로 정의한다.

---

## 8. Tool/API 운영 모델

각 제품은 사람이 사용하는 UI와 별도로 Agent Core가 호출할 수 있는 Tool API를 가져야 한다.

### 8.1 Compass Tool

```text
POST /tools/compass/query
```

입력:

- question
- platform
- campaign_context
- policy_domain
- user_id

출력:

- answer
- confidence
- sources
- policy_risk_level
- follow_up_questions

### 8.2 Sentinel Tool

```text
POST /tools/sentinel/validate-setup
POST /tools/sentinel/monitor/start
POST /tools/sentinel/monitor/status
POST /tools/sentinel/suppressions
```

입력:

- campaign_id
- media_mix
- platform_settings
- thresholds
- user_id

출력:

- validation_status
- detected_issues
- monitoring_status
- alert_required
- suppression_status

### 8.3 Lens Tool

```text
POST /tools/lens/generate-capture
GET /tools/lens/captures/{id}
```

입력:

- campaign_id
- platform
- placement_type
- creative_info
- output_format

출력:

- capture_id
- image_url
- status
- generated_at
- error_reason

### 8.4 Foresight Tool

```text
POST /tools/foresight/simulate
GET /tools/foresight/benchmarks
```

입력:

- platform
- industry
- objective
- budget
- period
- country
- creative_type

출력:

- expected_cpm
- expected_cpc
- expected_ctr
- expected_vtr
- confidence_range
- benchmark_basis

### 8.5 Hermes Feedback Tool

```text
POST /tools/hermes/feedback/apply
GET /tools/hermes/recommendations
GET /tools/hermes/learning-summary
```

입력:

- feedback_type
- campaign_id
- recommendation_key
- operator_action
- reason
- actor_id

출력:

- learning_candidate
- reliability_score
- next_action
- audit_id

---

## 9. 권한 모델

Agent Core는 사용자 권한과 학습 권한을 분리해야 한다.

### 9.1 시스템 권한

| 역할 | 권한 |
|---|---|
| Super Admin | 전체 시스템/권한/학습 관리 |
| Admin | 관리 범위 내 사용자/캠페인/설정 관리 |
| Reviewer | 추천 검토 및 제한적 학습 피드백 제공 |
| User | 일반 사용. 기본적으로 학습 반영 제외 |

### 9.2 Agent 실행 권한

| Action | 필요 권한 |
|---|---|
| 정책 질문 | User 이상 |
| 캠페인 상태 조회 | User 이상 + 캠페인 접근권한 |
| 알림 확인 | User 이상 |
| 알림 보류/오늘 중지 | Reviewer 이상 또는 담당자 권한 |
| 알림 종료 | Admin 이상 또는 담당자 승인 |
| 기준값 변경 | Admin 이상 |
| 학습 반영 | Reviewer 이상 + can_train_hermes |
| 사용자 권한 변경 | Super Admin |
| LLM 비용 정책 변경 | Super Admin |

---

## 10. 감사 로그와 운영 기록

Agent Core는 모든 주요 action을 기록해야 한다.

### 10.1 operator_actions

운영자가 수행한 업무 action을 기록한다.

예시:

- report_acknowledge
- report_review
- alert_snooze
- alert_stop_today
- alert_campaign_off
- alert_resume
- hermes_recommendation_action
- learning_authority_change

### 10.2 audit_logs

시스템 보안/권한/설정 변경을 기록한다.

예시:

- 사용자 권한 변경
- 학습 권한 변경
- 전역 기준값 변경
- 캠페인 기준값 변경
- API key 관련 설정 변경
- Agent 실행 정책 변경

### 10.3 tool_execution_events

Agent가 호출한 Tool 실행 이력을 기록한다.

예시:

- Compass query 실행
- Sentinel validation 실행
- Lens capture 생성
- Foresight simulation 실행
- Hermes feedback 적용

### 10.4 llm_usage_events

LLM/API 비용 추적을 위해 다음을 기록한다.

- provider
- model
- platform
- feature
- prompt_tokens
- completion_tokens
- total_tokens
- estimated_cost
- user_id
- campaign_id
- request_status
- error_reason

---

## 11. Hermes 학습 운영 모델

Hermes 학습은 다음 단계를 따른다.

```text
이벤트 발생
→ 운영자 판단
→ 피드백 기록
→ 학습 후보 생성
→ 신뢰도 평가
→ 관리자 검토
→ 기준 반영
→ 효과 모니터링
```

### 11.1 학습 후보의 종류

- 알림 오탐 여부
- 이상 감지 기준 조정 후보
- 업종별 예외 기준
- 캠페인 목표별 KPI 허용 범위
- 추천 품질 평가
- Foresight 예측 보정 후보
- 반복 정책 질문 요약

### 11.2 신뢰도 평가 요소

- 피드백 제공자의 권한
- 동일 이슈 반복 여부
- 적용 후 성과 변화
- 다른 운영자 피드백과의 일관성
- 최근 데이터 여부
- 캠페인 규모와 영향도

### 11.3 학습 반영 원칙

- 하나의 피드백으로 전역 기준을 즉시 변경하지 않는다.
- smoke test 데이터는 기본 학습 집계에서 제외한다.
- 오래된 데이터는 기본 판단 기준에서 제외하거나 참고용으로 분리한다.
- 최근 최대 6개월 이내 캠페인 데이터를 우선 사용한다.
- raw campaign-level 데이터는 LLM에 직접 전달하지 않는다.

---

## 12. Slack 운영 UX

Slack은 미디어플래너와 Agent Core가 만나는 핵심 인터페이스다.

### 12.1 Slack에서 가능한 작업

```text
@AdMate 이 캠페인 상태 요약해줘
@AdMate 이 캠페인 왜 CPC가 높아졌어?
@AdMate 이 소재 Meta 정책 문제 있어?
@AdMate 이 캠페인 캡처 만들어줘
@AdMate 다음주 예산 30% 늘리면 예상 CPC 어떻게 돼?
@AdMate 이 캠페인 미디어믹스와 실제 세팅값 비교해줘
```

### 12.2 Slack 버튼 액션

- 확인 완료
- 검토 필요
- 1시간 보류
- 오늘 중지
- 알림 종료
- 알림 재개
- 상세 로그 보기
- 캡처 생성
- 정책 확인
- 예측 보기

### 12.3 Slack UX 원칙

- 짧고 명확한 한글 문구
- 위험 action은 확인 버튼 사용
- 근거/상세 정보는 접거나 링크로 제공
- 모든 버튼 action은 operator_actions 기록
- 권한 없는 사용자는 민감 action 차단

---

## 13. LLM Cost Center 운영 모델

Agent Core는 LLM/API 비용을 추적해야 한다.

### 13.1 비용 수집 대상

- Compass RAG 답변
- Sentinel 진단/요약
- Lens 이미지/비전 처리
- Foresight 분석/예측
- Hermes 추천/학습 요약
- Weekly Intelligence Deep Search
- Embedding
- Reranker
- Vision
- TTS/이미지/영상 모델

### 13.2 대시보드 지표

- 오늘 비용
- 이번 주 비용
- 이번 달 비용
- 플랫폼별 비용
- 모델별 비용
- 기능별 비용
- 사용자별 비용
- 캠페인별 비용
- 실패 요청 비용
- 캐시 절감액
- 예산 대비 사용률
- 비용 급증 알림

### 13.3 비용 정책

- 단순 질문은 경량 모델 사용
- 복잡한 판단은 고성능 모델 사용
- 동일 질문/동일 문서 검색은 캐시 활용
- 고비용 작업은 승인 또는 rate limit 적용
- 관리자 화면에서 비용 현황 확인

---

## 14. Weekly Intelligence Loop 운영 모델

Agent Core는 최신 기술 변화에 대응하기 위한 주간 루틴을 가져야 한다.

### 14.1 목적

빠르게 변하는 AI/MarTech/광고 플랫폼 기술을 조사하고, AdMate에 적용 가능한 개선 후보를 선정한다.

### 14.2 루틴

```text
매주 Deep Search 실행
→ 기술/가격/API 변화 수집
→ Hermes가 요약
→ 적용 가능성 평가
→ 비용 절감/성능 개선/보안 리스크 판단
→ backlog 등록
→ Codex/Openclaw 작업화
→ 적용 결과 기록
```

### 14.3 산출물

- Weekly Intelligence Report
- 적용 후보 목록
- 비용 절감 후보
- 보안 리스크 알림
- 모델 교체 후보
- 신규 기능 제안
- Codex 작업 프롬프트

---

## 15. 장애/오류 처리 원칙

Agent Core는 자동화 시스템이므로 실패를 전제로 설계해야 한다.

### 15.1 실패 유형

- 외부 API 실패
- LLM 응답 실패
- 비용 초과
- 인증/권한 오류
- Slack 발송 실패
- Email 발송 실패
- 캡처 생성 실패
- 데이터 수집 실패
- 잘못된 알림 생성

### 15.2 처리 원칙

- 실패도 기록한다.
- 실패 원인을 운영자가 이해할 수 있는 한글 문구로 표시한다.
- 실패한 delivery는 failed로 기록한다.
- 억제된 알림은 skipped로 기록한다.
- 데이터 수집 실패 시 0값 기반 가짜 알림을 만들지 않는다.
- 재시도 가능/불가능 여부를 구분한다.

---

## 16. 구현 우선순위

### Phase 1. 현재 기반 안정화

- Sentinel Live Monitoring 안정화
- Slack action 안정화
- operator_actions / audit_logs 정리
- 사용자 권한과 학습 권한 분리
- /users 관리 화면 정리
- Hermes Applied Quality 고도화

### Phase 2. Agent Core 명확화

- Agent Core 개념 문서화
- Openclaw/Hermes 역할 분리
- 각 플랫폼 Tool API 설계
- Slack Agent UX 정의

### Phase 3. Cost Center

- llm_usage_events 설계
- provider/model/feature/cost 기록
- 관리자 비용 대시보드
- 비용 급증 알림

### Phase 4. Weekly Intelligence Loop

- 주간 Deep Search 루틴 설계
- 기술 리포트 템플릿
- 적용 후보 평가 기준
- Codex 작업 이관 방식

### Phase 5. 제품 간 Tool 연계

- Compass Tool 연동
- Sentinel Pre-launch 연동
- Lens Tool 연동
- Foresight Tool 연동
- 통합 Slack Agent 적용

---

## 17. 운영 원칙 요약

AdMate Agent Core는 다음 원칙을 따른다.

```text
1. 사람의 판단을 대체하지 않고 보조한다.
2. 위험한 action은 사람 승인 후 실행한다.
3. 모든 action은 기록한다.
4. 학습은 권한 있는 신뢰 신호만 반영한다.
5. raw campaign data는 보호한다.
6. 비용은 실시간으로 추적한다.
7. 실패도 정상적인 운영 이벤트로 기록한다.
8. 각 제품은 전문 Tool로, Agent Core는 연결/실행/학습 레이어로 유지한다.
```

---

## 18. 다음 문서로 연결

이 문서는 다음 문서의 기준이 된다.

1. AdMate AI Operations Manual v1
2. AdMate Unified Data & Learning Governance v1
3. AdMate Homepage IA & Brand Copy v1
4. Compass/Sentinel/Lens/Foresight Tool API 설계서
5. Slack Agent UX 시나리오 문서
6. LLM Cost Center PRD
7. Weekly Intelligence Loop 운영 문서

---

## 19. 최종 요약

AdMate Agent Core의 핵심은 다음과 같다.

```text
Openclaw는 실행한다.
Hermes는 기억하고 판단한다.
Agent Core는 이를 하나로 묶어 AdMate 전체 플랫폼이 연결되고 학습하도록 만든다.
```

AdMate가 단순한 AI 도구 묶음이 아니라 광고 운영 자동화 플랫폼이 되려면, Agent Core가 반드시 중심에 있어야 한다.

Compass, Sentinel, Lens, Foresight는 전문 기능을 제공하고, Agent Core는 이 기능들을 연결해 실행·기록·학습 가능한 광고 운영 Agent loop를 만든다.
