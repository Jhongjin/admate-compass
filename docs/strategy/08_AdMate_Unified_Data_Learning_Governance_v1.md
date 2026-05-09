# AdMate Unified Data & Learning Governance v1

작성일: 2026-04-30
문서 상태: 초안 v1
작성 목적: AdMate 생태계 전체에서 공통으로 사용해야 할 데이터 모델, Campaign Intelligence 구조, Hermes 학습 원칙, 권한/감사/보안 기준, ISMS 관점 데이터 처리 원칙을 정의한다.

---

## 1. Executive Summary

AdMate는 AI Agent 기반 광고 운영 자동화 플랫폼이다.

AdMate가 단순한 기능 묶음이 아니라 장기적으로 회사 고유의 광고 운영 지능을 축적하는 플랫폼이 되기 위해서는, 제품별 데이터가 분산되어서는 안 된다.

AdMate Compass, Sentinel, Lens, Foresight, Agent Core는 모두 서로 다른 기능을 수행하지만, 최종적으로는 하나의 캠페인, 하나의 광고주, 하나의 운영 이력, 하나의 학습 구조로 연결되어야 한다.

이 문서의 핵심은 다음과 같다.

```text
1. 모든 플랫폼은 공통 Campaign Identity를 기준으로 연결한다.
2. 운영자 action과 AI action은 모두 기록한다.
3. Hermes 학습은 권한 있는 신뢰 신호만 반영한다.
4. raw campaign-level 데이터는 보호하고, LLM에는 최소·요약·익명화 데이터만 전달한다.
5. 비용, 권한, 감사, 학습 이력은 추적 가능해야 한다.
6. AdMate의 장기 경쟁력은 데이터와 피드백이 누적되는 구조에서 나온다.
```

---

## 2. 왜 통합 데이터 거버넌스가 필요한가

AdMate 제품군은 각각 다른 문제를 해결한다.

- Compass는 정책/가이드 질문에 답한다.
- Sentinel은 캠페인 세팅과 운영 이상을 감지한다.
- Lens는 광고 게재 화면과 증빙 이미지를 만든다.
- Foresight는 다음 캠페인의 성과를 예측한다.
- Agent Core는 이 흐름을 실행하고 기록하고 학습한다.

하지만 각 제품이 별도 데이터 구조로 운영되면 다음 문제가 발생한다.

| 문제 | 설명 |
|---|---|
| 캠페인 맥락 단절 | 정책 질문, 검수 결과, 캡처, 예측이 같은 캠페인으로 연결되지 않음 |
| 학습 품질 저하 | 운영자 피드백이 어떤 캠페인/업종/목표에 대한 것인지 불명확함 |
| 감사 어려움 | 누가 어떤 action을 했고 어떤 결과가 있었는지 추적하기 어려움 |
| 비용 분석 한계 | 어떤 캠페인/플랫폼/기능에서 AI 비용이 발생했는지 알기 어려움 |
| 보안 리스크 | 민감 데이터가 불필요하게 LLM이나 외부 시스템에 전달될 수 있음 |
| 확장성 저하 | 제품이 늘어날수록 데이터 연결 비용이 커짐 |

따라서 AdMate는 초기부터 공통 데이터 모델과 학습 거버넌스를 가져야 한다.

---

## 3. 핵심 설계 원칙

## 3.1 Campaign-first

AdMate의 모든 데이터는 가능하면 캠페인을 중심으로 연결한다.

```text
campaign
→ media mix
→ setup validation
→ monitoring events
→ policy questions
→ capture assets
→ planner predictions
→ actual performance
→ operator feedback
→ Hermes learning
```

Campaign Identity가 없으면 데이터는 쌓여도 지식으로 연결되기 어렵다.

## 3.2 Event-based 기록

AdMate는 결과값만 저장하지 않고 이벤트를 기록해야 한다.

예시:

```text
캠페인이 등록되었다.
검수가 실행되었다.
오류가 발견되었다.
Slack 알림이 발송되었다.
운영자가 1시간 보류를 눌렀다.
Hermes가 학습 후보를 생성했다.
관리자가 학습 반영을 승인했다.
```

이벤트 기반 기록은 감사, 분석, 학습, 비용 산정의 기반이 된다.

## 3.3 Learning is governed

학습은 자동으로 무분별하게 이루어지면 안 된다.

Hermes는 모든 데이터를 참고할 수는 있지만, 실제 판단 기준에 반영하는 데이터는 권한과 신뢰도 기준을 통과해야 한다.

## 3.4 Minimal data to LLM

LLM에 전달되는 데이터는 최소화해야 한다.

원칙:

```text
원문 전체 전달 금지
필요한 필드만 전달
가능하면 요약/집계/익명화
민감 정보 제거
권한 확인 후 전달
전달 내역 기록
```

## 3.5 Audit by default

권한 변경, 기준 변경, 학습 반영, Agent 실행, 외부 Tool 호출은 기본적으로 감사 가능해야 한다.

---

## 4. 공통 데이터 객체 모델

AdMate 전체에서 공통으로 관리해야 할 핵심 객체는 다음과 같다.

| 객체 | 설명 |
|---|---|
| organization | 회사/조직 단위. 초기에는 나스미디어 내부 기준 |
| user | AdMate 사용자 |
| advertiser | 광고주 |
| brand | 브랜드 |
| campaign | 캠페인 중심 객체 |
| platform_account | Meta/Google/Naver 등 매체 계정 |
| media_mix | 기획안/미디어믹스 데이터 |
| setup_snapshot | 실제 매체 세팅값 snapshot |
| validation_result | Sentinel 사전 검수 결과 |
| monitoring_event | Sentinel 운영 감지 이벤트 |
| alert_event | 알림 이벤트 |
| alert_delivery | Slack/Email 발송 이력 |
| policy_query | Compass 정책 질문 이력 |
| capture_asset | Lens 캡처 결과물 |
| planner_prediction | Foresight 예측 결과 |
| actual_performance | 실제 운영 성과 |
| operator_action | 운영자 action 기록 |
| hermes_feedback | Hermes 학습 후보/피드백 |
| learning_decision | 학습 반영/보류/거절 결정 |
| llm_usage_event | LLM/API 비용 이벤트 |
| audit_log | 보안/권한/설정 감사 로그 |

---

## 5. Campaign Intelligence Object

AdMate의 중심 데이터 구조는 Campaign Intelligence Object다.

하나의 캠페인에 대해 다음 정보가 연결되어야 한다.

```text
campaign_id
campaign_pk
platform
platform_campaign_id
advertiser
brand
objective
industry
country
manager_user_id
team
budget
period
creative_info
landing_url
media_mix
setup_snapshot
validation_result
policy_context
capture_assets
monitoring_events
alert_events
operator_actions
planner_predictions
actual_performance
learning_feedback
cost_events
```

이 구조를 통해 다음 질문에 답할 수 있어야 한다.

```text
이 캠페인은 시작 전 세팅에는 문제가 없었는가?
운영 중 어떤 이상이 발생했는가?
어떤 Slack 알림이 발송되었고 누가 대응했는가?
운영자는 왜 이 알림을 이상이 아니라고 판단했는가?
관련 정책/가이드 이슈는 무엇이었는가?
광고 게재 화면 캡처는 생성되었는가?
예측 성과와 실제 성과는 얼마나 차이 났는가?
이 캠페인에서 발생한 AI 비용은 얼마인가?
다음 유사 캠페인에서는 어떤 기준을 적용해야 하는가?
```

---

## 6. 사용자와 권한 모델

AdMate는 사용자 권한과 Hermes 학습 권한을 분리해서 관리해야 한다.

## 6.1 사용자 기본 정보

사용자 객체는 다음 필드를 포함한다.

```text
user_id
name
email
team
role
system_role
is_active
created_at
updated_at
```

여기서 기존 조직/직무 역할과 시스템 권한은 분리한다.

```text
role
= team_lead, team_manager 등 조직/직무 역할

system_role
= super_admin, admin, reviewer, user 등 시스템 권한
```

## 6.2 Hermes 학습 권한

Hermes 학습 권한은 별도 필드로 관리한다.

```text
hermes_reviewer_enabled
can_train_hermes
feedback_weight
learning_scope
```

| 필드 | 설명 |
|---|---|
| hermes_reviewer_enabled | Hermes 추천/학습 검토 가능 여부 |
| can_train_hermes | 실제 학습 반영 가능 여부 |
| feedback_weight | 피드백 신뢰 가중치 |
| learning_scope | 전체/관리 범위/학습 제외 등 범위 |

## 6.3 권한 단계

| system_role | 설명 | 기본 학습 권한 |
|---|---|---|
| super_admin | 시스템 전체 관리자 | 가능 |
| admin | 관리 범위 내 관리자 | 제한적 가능 |
| reviewer | 검토자 | 승인 범위 내 가능 |
| user | 일반 사용자 | 기본 제외 |

## 6.4 권한 운영 원칙

- 신규 사용자는 기본적으로 user로 생성한다.
- Super Admin은 최소 인원으로 운영한다.
- Admin/Reviewer 권한은 Super Admin이 부여한다.
- 모든 권한 변경은 audit log에 기록한다.
- 일반 사용자의 모든 action을 Hermes 학습 신호로 쓰지 않는다.

---

## 7. Operator Actions 모델

operator_actions는 사람이 시스템 안에서 수행한 의미 있는 action을 기록하는 테이블이다.

## 7.1 기록 목적

- 운영자 대응 이력 보존
- Slack 버튼 action 추적
- 학습 후보 생성
- 감사 및 문제 추적
- 추천 품질 평가

## 7.2 대표 action_type

```text
report_sent
report_acknowledge
report_review
alert_snooze
alert_stop_today
alert_campaign_off
alert_resume
hermes_recommendation_action
recommendation_applied
recommendation_rejected
post_feedback_submitted
learning_authority_change
setting_update
campaign_update
```

## 7.3 필수 필드 예시

```text
id
created_at
action_source
action_type
action_status
actor_user_id
actor_name
campaign_id
campaign_pk
alert_event_id
recommendation_key
slack_channel_id
slack_message_ts
result_payload
metadata
```

## 7.4 운영 원칙

- Slack 버튼 action은 반드시 operator_actions에 기록한다.
- 시스템이 자동으로 보낸 리포트도 report_sent 등으로 기록한다.
- 테스트 action은 test_source 또는 actor_name으로 명확히 구분한다.
- smoke test 데이터는 기본 학습 집계에서 제외한다.

---

## 8. Hermes Feedback & Learning 모델

Hermes 학습은 AdMate의 핵심 경쟁력이다.

## 8.1 학습 대상

Hermes가 학습해야 하는 데이터는 다음과 같다.

| 학습 대상 | 예시 |
|---|---|
| 알림 판단 | 이 알림은 실제 이상인가, 오탐인가 |
| 운영자 이유 | 왜 정상/이상으로 판단했는가 |
| 업종별 기준 | 특정 업종에서 허용 가능한 KPI 변동 |
| 목표별 기준 | traffic/awareness 등 목적별 정상 범위 |
| 세팅 오류 패턴 | 자주 발생하는 예산/URL/기간 오류 |
| 정책 질문 패턴 | 반복되는 정책 문의 |
| 캡처 요청 패턴 | 자주 요청되는 매체/지면 캡처 |
| 예측 오차 | Foresight 예측과 실제 성과 차이 |

## 8.2 학습 단계

```text
1. 이벤트 발생
2. 운영자 action 기록
3. Hermes feedback 후보 생성
4. 신뢰도 평가
5. 관리자/Reviewer 검토
6. 학습 반영 또는 보류
7. 적용 후 품질 모니터링
```

## 8.3 learning_status

학습 후보는 다음 상태를 가진다.

| 상태 | 설명 |
|---|---|
| candidate | 학습 후보 생성 |
| reviewing | 검토 중 |
| approved | 반영 승인 |
| applied | 학습 반영 완료 |
| rejected | 반영 거절 |
| stale | 오래되어 기본 판단 기준에서 제외 |
| test_excluded | 테스트 데이터로 기본 집계 제외 |

## 8.4 학습 신뢰도 평가 요소

- 피드백 제공자의 system_role
- can_train_hermes 여부
- feedback_weight
- 동일 이슈 반복 횟수
- 실제 성과 변화
- 최근성
- 캠페인 규모
- 다른 운영자 피드백과의 일관성
- 테스트 데이터 여부

---

## 9. 데이터 기간과 벤치마크 원칙

AdMate Foresight와 Hermes 학습은 과거 데이터를 참고하지만, 광고 매체 환경은 빠르게 변한다.

따라서 제안/운영 판단에 사용할 벤치마크 데이터는 기본적으로 **조회/제안 시점 기준 최대 6개월 이내의 캠페인 데이터**를 우선한다.

## 9.1 원칙

```text
최근 최대 6개월 이내 데이터
= 기본 판단/제안 기준

6개월 초과 데이터
= 장기 추세 참고용으로만 분리
```

## 9.2 이유

- 매체 알고리즘이 빠르게 변함
- 광고 상품과 지면이 자주 바뀜
- 정책과 심사 기준이 바뀜
- 시장 단가와 경쟁 상황이 변동됨
- 오래된 성과가 현재 제안 기준에 부적합할 수 있음

## 9.3 메타데이터 관리

벤치마크 데이터에는 다음 메타데이터가 필요하다.

```text
조회기간
플랫폼
국가
구매유형
캠페인 목표
업종
노출위치
비드타입
소재형태
통화
마크업률
Net/Gross 기준
데이터 보정 여부
필터 옵션
```

특히 마크업, Net/Gross, 수수료 기준은 내부 확인 후 명확히 정의해야 한다.

---

## 10. LLM 데이터 전달 원칙

AdMate는 LLM을 사용하지만, 모든 데이터를 LLM에 직접 전달해서는 안 된다.

## 10.1 전달 금지 데이터

- API key/token/password
- service role key
- raw campaign-level 민감 데이터 전체
- 광고주별 계약/단가 정보 원문
- 개인 식별 정보
- 내부 비공개 전략 문서 원문
- 접근 권한이 없는 캠페인 데이터

## 10.2 전달 가능 데이터

권한과 목적이 명확할 때 다음 형태로 전달할 수 있다.

- 익명화된 캠페인 요약
- 집계된 성과 지표
- 캠페인명 제거 또는 마스킹된 데이터
- 업종/목표/기간 등 범주형 정보
- 필요한 필드만 추출한 최소 데이터
- 사용자에게 이미 노출 가능한 정보

## 10.3 LLM 요청 기록

LLM 요청은 다음 메타데이터를 기록해야 한다.

```text
provider
model
feature
request_type
user_id
campaign_id
input_summary
output_summary
sensitive_data_flag
prompt_tokens
completion_tokens
estimated_cost
status
error_reason
```

원문 prompt와 response를 저장할지는 보안 정책에 따라 별도로 결정한다.

---

## 11. Audit Log 모델

audit_logs는 보안, 권한, 설정 변경 등 시스템 통제와 관련된 이벤트를 기록한다.

## 11.1 감사 대상

- 사용자 권한 변경
- Hermes 학습 권한 변경
- Super Admin/Admin 부여
- 전역 기준값 변경
- 캠페인 기준값 변경
- Agent action 정책 변경
- LLM 모델 라우팅 변경
- API credential 관련 설정 변경
- 데이터 export
- 고비용 작업 승인
- 학습 반영 승인

## 11.2 필수 필드

```text
id
created_at
audit_type
actor_user_id
actor_name
target_type
target_id
before_value
after_value
reason
ip_address
user_agent
metadata
```

## 11.3 감사 원칙

- 변경 전/후 값을 남긴다.
- 사람 action과 시스템 action을 구분한다.
- 보안상 민감한 값은 원문 저장하지 않는다.
- 권한 변경은 별도 중요 이벤트로 취급한다.
- 감사 로그는 일반 사용자에게 노출하지 않는다.

---

## 12. Capture Asset Governance

AdMate Lens가 생성하는 캡처 결과물은 캠페인 기록의 일부가 된다.

## 12.1 capture_asset 필드

```text
capture_id
campaign_id
platform
placement_type
creative_type
image_url
storage_path
status
generated_at
requested_by
request_source
error_reason
metadata
```

## 12.2 관리 원칙

- 캡처 결과물은 캠페인과 연결한다.
- 광고주 제출용 결과물은 버전을 관리한다.
- 실패한 캡처도 기록한다.
- 재생성 이력을 남긴다.
- 캡처 이미지에 민감 정보가 포함될 수 있으므로 접근 권한을 제한한다.

---

## 13. Planner Prediction Governance

AdMate Foresight의 예측 결과는 향후 실제 성과와 비교되어야 한다.

## 13.1 planner_prediction 필드

```text
prediction_id
campaign_id
platform
industry
objective
budget
period
country
creative_type
expected_cpm
expected_cpc
expected_ctr
expected_vtr
expected_cpv
confidence_range
benchmark_period
benchmark_filters
markup_rate
net_gross_basis
created_by
created_at
model_version
metadata
```

## 13.2 actual_performance 연결

예측 이후 실제 캠페인 성과를 연결한다.

```text
prediction_id
campaign_id
actual_spend
actual_impressions
actual_clicks
actual_ctr
actual_cpc
actual_cpm
actual_vtr
actual_cpv
performance_period
variance_summary
```

## 13.3 예측 품질 평가

Foresight는 다음 항목으로 품질을 평가한다.

- 예측 CPC와 실제 CPC 차이
- 예측 CPM과 실제 CPM 차이
- 예측 CTR과 실제 CTR 차이
- 업종별 오차
- 목표별 오차
- 데이터 기간별 오차
- 마크업/Net/Gross 기준별 오차

---

## 14. Data Retention & Lifecycle

데이터는 목적에 따라 보관 기간과 처리 방식이 달라야 한다.

## 14.1 데이터 유형별 보관 방향

| 데이터 | 보관 방향 |
|---|---|
| audit_logs | 장기 보관 필요 |
| operator_actions | 장기 보관. 학습/감사에 활용 |
| alert_events | 운영 분석용 장기 보관 |
| alert_deliveries | 발송 추적용 보관 |
| llm_usage_events | 비용 분석용 보관 |
| raw external API response | 최소 보관 또는 요약 후 폐기 |
| capture_assets | 캠페인/보고 목적에 따라 보관 정책 필요 |
| planner_predictions | 실제 성과 비교를 위해 보관 |
| smoke test data | 실제 운영 집계에서 제외, 일정 기간 후 정리 가능 |

## 14.2 생애주기 단계

```text
생성
→ 사용
→ 학습 후보화
→ 검토
→ 반영/보류/폐기
→ 보관
→ 필요 시 익명화/삭제
```

---

## 15. Data Quality 기준

AdMate의 학습 품질은 데이터 품질에 따라 결정된다.

## 15.1 품질 기준

- campaign_id 연결 여부
- user_id 연결 여부
- action_type 명확성
- timestamp 정확성
- source 구분
- test data 여부
- 필수 메타데이터 존재 여부
- 중복 이벤트 여부
- 값의 단위 명확성
- Net/Gross/마크업 기준 명확성

## 15.2 품질 점검 예시

```text
캠페인 없는 operator_action 비율
action_type이 unknown인 이벤트 수
test_source가 없는 smoke test 데이터
created_at 기준 시간대 오류
campaign_id와 campaign_pk 불일치
llm_usage_events 중 cost 누락 비율
planner_prediction 중 benchmark_period 누락 비율
```

---

## 16. 제품별 데이터 책임

| 제품 | 생성 데이터 | 주요 책임 |
|---|---|---|
| Compass | policy_query, answer, source references | 정책 답변 근거와 품질 관리 |
| Sentinel | validation_result, monitoring_event, alert_event | 검수/감지 이벤트 정확성 |
| Lens | capture_asset | 캡처 결과물과 캠페인 연결 |
| Foresight | planner_prediction, benchmark_summary | 예측 기준과 실제 성과 비교 |
| Agent Core | operator_action, audit_log, llm_usage_event | 실행/학습/비용/감사 기록 |
| Hermes | feedback, learning_decision, recommendation | 학습 후보와 반영 이력 관리 |

---

## 17. 구현 우선순위

## Phase 1. 현재 Openclaw/Hermes 기반 정리

- users 권한 필드 안정화
- operator_actions 정리
- audit_logs 설계
- Hermes learning authority 관리
- smoke test 데이터 제외 정책
- alert_events / alert_deliveries 품질 정리

## Phase 2. Cost & LLM Usage 데이터 추가

- llm_usage_events 설계
- provider/model/feature/cost 기록
- Cost Center 대시보드 기반 마련

## Phase 3. Campaign Intelligence Object 확장

- campaign 중심 연결 강화
- media_mix / setup_snapshot / validation_result 구조 설계
- capture_asset 연결
- planner_prediction 연결

## Phase 4. Hermes Learning Governance 고도화

- learning_status 도입
- feedback 신뢰도 평가
- 관리자 승인 기반 반영
- 학습 품질 summary

## Phase 5. 전체 AdMate 통합 데이터 모델

- Compass/Sentinel/Lens/Foresight Tool API 연계
- 통합 campaign context 제공
- Slack Agent 질의 응답에 공통 context 적용

---

## 18. 최종 요약

AdMate의 장기 경쟁력은 단순 기능 개발이 아니라 데이터와 학습 구조에서 나온다.

```text
Compass의 정책 질문,
Sentinel의 검수/감지 이벤트,
Lens의 캡처 결과,
Foresight의 예측,
Agent Core의 실행 기록,
Hermes의 학습 판단이
하나의 Campaign Intelligence 구조로 연결되어야 한다.
```

이 구조가 정착되면 AdMate는 사용할수록 더 똑똑해지는 광고 운영 자동화 플랫폼이 된다.

운영자의 판단은 개인의 경험으로 사라지지 않고, 회사의 광고 운영 지식으로 축적된다.

이것이 AdMate와 Hermes가 만들어야 할 가장 중요한 데이터 자산이다.
