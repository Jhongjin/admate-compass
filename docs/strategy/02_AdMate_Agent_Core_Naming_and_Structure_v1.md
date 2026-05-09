# AdMate Agent Core 명칭 및 구조 정리 v1

작성일: 2026-04-30
목적: AdMate 전체 프로젝트에서 사용할 핵심 명칭과 구조를 정리한다. 특히 AdMate의 최상위 정의, Sentinel의 범위, Openclaw/Hermes의 노출 방식, AdMate Agent Core의 역할을 확정한다.

---

## 1. 최상위 정의

AdMate는 **AI Agent 기반 광고 운영 자동화 플랫폼**이다.

이 정의가 가장 적합한 이유는 다음과 같다.

- AdMate는 단순 AI 챗봇이나 개별 자동화 툴이 아니다.
- 광고 운영 업무 전반을 연결하는 플랫폼이다.
- 핵심 차별점은 AI가 질문에 답하는 수준을 넘어, 판단하고 실행하고 기록하고 학습하는 Agent 구조에 있다.
- 미디어플래너의 정책 확인, 세팅 검수, 캡처, 플래닝, 운영 모니터링, 이상 감지, 피드백 학습을 하나의 업무 흐름으로 연결한다.

외부 설명용 한 문장:

> AdMate는 나스미디어의 광고 운영 지식을 AI Agent가 실행 가능한 형태로 바꾸는 광고 운영 자동화 플랫폼이다.

---

## 2. AdMate 생태계 구성

AdMate는 네 개의 업무 플랫폼과 하나의 Agent Core로 구성한다.

| 구성 요소 | 역할 |
|---|---|
| AdMate Guide | 글로벌 광고 플랫폼 정책/가이드 통합 RAG 챗봇 |
| AdMate Sentinel | 캠페인 시작 전 사전 검수와 시작 후 모니터링/실시간 이상 감지 |
| AdMate Capture Pro | 광고 게재 화면, 상품, 소재, 지면 캡처 및 보고서용 증빙 생성 |
| AdMate Planner | 과거 광고 데이터와 시장 트렌드 기반 기획/예측/시뮬레이션 |
| AdMate Agent Core | 지능, 기억, 자동화, 실행, 학습, 감사 로그를 담당하는 공통 Agent 레이어 |

핵심 관점:

```text
Guide / Sentinel / Capture Pro / Planner
= 각 업무 영역의 전문 플랫폼

AdMate Agent Core
= 이 플랫폼들을 연결하고 자동화하는 지능형 공통 엔진
```

---

## 3. Sentinel 명칭 및 범위 정리

기존에는 캠페인 시작 전 검수 솔루션을 Sentinel beta로, 캠페인 시작 후 운영 모니터링/실시간 감지 시스템을 Openclaw Sentinel로 구분해 표현했다.

앞으로는 외부 설명과 문서에서는 다음처럼 정리한다.

```text
AdMate Sentinel
= 캠페인 시작 전 사전 검수 + 캠페인 시작 후 운영 모니터링/실시간 이상 감지
```

Sentinel 내부에는 두 영역이 있다.

| Sentinel 영역 | 설명 |
|---|---|
| Pre-launch Validation | 캠페인 시작 전 미디어믹스와 매체 세팅값 비교, 오류 검수, 승인 리포트 |
| Live Monitoring | 캠페인 시작 후 운영 상태 모니터링, 실시간 이상 감지, 알림 통제, 운영자 피드백 학습 |

따라서 발표나 문서에서는 다음처럼 설명한다.

> AdMate Sentinel은 캠페인의 시작 전과 시작 후를 모두 감시하는 캠페인 검수·운영 감지 플랫폼이다.

---

## 4. AdMate Agent Core 정의

AdMate Agent Core는 AdMate 생태계 전체에 지능과 자동화를 제공하는 공통 Agent 운영 레이어다.

주요 역할:

- 캠페인 맥락 이해
- 플랫폼 간 데이터 연결
- Guide / Sentinel / Capture Pro / Planner 호출
- Slack 기반 사용자 질의 처리
- 운영 알림 및 승인 action 처리
- 운영자 피드백 기록
- Hermes 학습 루프 연결
- LLM 비용 및 사용량 로깅
- 권한 및 감사 로그 관리

외부 설명용 정의:

> AdMate Agent Core는 AdMate 플랫폼 전반에 지능, 자동화, 기억, 실행, 학습, 감사 기능을 제공하는 공통 Agent Core다.

---

## 5. Openclaw와 Hermes의 위치

Openclaw와 Hermes는 외부에 독립 제품처럼 강조하기보다, AdMate Agent Core를 구성하는 내부 기술/엔진명으로 정리한다.

| 내부 엔진 | 역할 |
|---|---|
| Openclaw | 실행, 모니터링, 알림, Slack action, API orchestration, workflow control |
| Hermes | 기억, 판단 기준, 피드백 학습, 추천 신뢰도, 도메인 지식 |

관계 정의:

```text
Hermes가 기억하고 판단한다.
Openclaw가 실행하고 기록한다.
AdMate Agent Core가 이를 하나의 지능형 자동화 레이어로 묶는다.
운영자가 승인하고 피드백한다.
Hermes가 다시 학습한다.
```

---

## 6. 캠페인 생애주기 내 배치

AdMate는 캠페인 생애주기 전체를 연결한다.

| 캠페인 단계 | 담당 플랫폼 | Agent Core 역할 |
|---|---|---|
| 기획 | Planner | 과거 성과/학습 피드백 연결 |
| 정책 확인 | Guide | 캠페인 맥락 기반 정책 QA 호출 |
| 세팅 | 매체 플랫폼 / 미디어믹스 | campaign identity 생성 |
| 사전 검수 | Sentinel Pre-launch Validation | 자동 검수 실행 및 결과 기록 |
| 집행 시작 | Sentinel Live Monitoring | 모니터링 시작 |
| 운영 중 | Sentinel Live Monitoring + Agent Core | 이상 감지, 알림, Slack action |
| 대응 | Hermes | 운영자 판단 학습 |
| 캡처 | Capture Pro | 필요한 캡처 자동 요청 |
| 다음 기획 | Planner + Hermes | 실제 성과와 피드백 반영 |

---

## 7. 앞으로 문서에서 사용할 권장 표현

### 임원 보고용

> 데이터분석팀은 단순 분석 지원 조직을 넘어, 광고 운영 업무를 자동화하고 회사 고유의 운영 지능을 축적하는 AI Agent 기반 광고 운영 자동화 플랫폼을 구축하고 있습니다.

### 미디어플래너 대상

> AdMate는 미디어플래너를 대체하는 도구가 아니라, 반복 확인·검수·캡처·정책 검색·이상 감지를 대신 처리해 플래너가 전략과 판단에 집중하게 만드는 AI 업무 파트너입니다.

### 내부 개발/아키텍처 문서용

> AdMate Agent Core는 Openclaw와 Hermes 기반의 공통 Agent 운영 레이어이며, 각 AdMate 플랫폼을 Tool/API로 연결해 판단, 실행, 기록, 학습을 수행한다.

---

## 8. 최종 정리

이번 정리의 핵심은 다음과 같다.

1. 최상위 브랜드 정의는 **AI Agent 기반 광고 운영 자동화 플랫폼**으로 한다.
2. Sentinel은 캠페인 시작 전 사전 검수와 시작 후 모니터링/실시간 감지를 모두 포함한다.
3. Openclaw와 Hermes는 외부 제품명보다는 AdMate Agent Core 내부 엔진명으로 정리한다.
4. AdMate Agent Core는 지능과 자동화를 포함하는 공통 Agent 레이어다.
5. 향후 임원/미디어플래너 대상 문서는 이 명칭 체계를 기준으로 작성한다.
