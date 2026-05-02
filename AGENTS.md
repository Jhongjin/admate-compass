# AdMate Project Director Handoff & AGENTS.md v1

작성일: 2026-05-02  
목적: 다음 LLM, Codex, Paperclip, 신규 담당자가 AdMate 전체 프로젝트의 “총괄 지휘자” 역할을 이어받을 수 있도록 비전, 제품 구조, 기술 방향, repo 운영 기준, 문서 체계, 작업 원칙을 한 번에 인수인계한다.

---

## 1. 최상위 정의

AdMate는 나스미디어 데이터분석팀이 구축하는 **AI Agent 기반 광고 운영 자동화 플랫폼**이다.

AdMate는 단순 챗봇이나 개별 자동화 도구가 아니라, 광고 캠페인의 전 생애주기인 기획, 정책 확인, 세팅 검수, 운영 모니터링, 캡처/증빙, 성과 예측, 운영자 피드백 학습을 하나의 Agent 기반 업무 흐름으로 연결하는 통합 생태계다.

공식 핵심 메시지:

```text
AdMate
AI Agent 기반 광고 운영 자동화 플랫폼

기획부터 운영, 검수, 캡처, 학습까지
광고 운영의 전 과정을 AI Agent가 연결합니다.
```

AdMate의 장기 목표는 나스미디어의 광고 운영 지식을 AI Agent가 실행 가능한 형태로 바꾸고, 운영자 판단과 캠페인 데이터를 회사 고유의 지식 자산으로 축적하는 것이다.

---

## 2. 제품군 구조

AdMate는 4개 제품 플랫폼과 하나의 Agent Core로 구성된다.

| 최종명 | 기존/내부명 | 역할 |
|---|---|---|
| AdMate Compass | AdMate Guide | 광고 플랫폼 정책/가이드 기반 RAG 챗봇, Policy Intelligence Agent |
| AdMate Sentinel | Sentinel beta + Openclaw Sentinel 영역 | 캠페인 시작 전 세팅 검수 + 집행 후 실시간 모니터링/알림 |
| AdMate Lens | AdMate Capture Pro | 광고 게재 화면과 보고서 증빙 이미지 자동 생성 |
| AdMate Foresight | AdMate Planner | 과거 광고 데이터 기반 캠페인 성과 예측/미디어 플래닝 |
| AdMate Agent Core | Openclaw + Hermes | 지능, 자동화, 실행, 기억, 학습, 감사 로그 공통 레이어 |

핵심 한 문장:

```text
Compass는 정책을 답한다.
Sentinel은 캠페인 사고를 막고 감지한다.
Lens는 캡처와 증빙을 만든다.
Foresight는 다음 성과를 예측한다.
Agent Core는 이 모든 흐름을 연결하고 학습한다.
```

---

## 3. AdMate Agent Core

AdMate Agent Core는 AdMate 생태계의 중심이다.

Openclaw와 Hermes는 외부에 별도 제품처럼 설명하지 말고, Agent Core를 구성하는 내부 엔진으로 설명한다.

```text
Openclaw
= 스케줄과 조건에 따라 업무를 실행하고 외부 시스템을 연결하는 자동화 실행 엔진

Hermes
= AI와 사용자 이벤트를 학습해 운영 지식과 판단 기준을 축적하는 지능/메모리 엔진
```

쉬운 비유:

```text
Openclaw는 움직이는 손과 발,
Hermes는 기억하고 판단하는 두뇌다.
AdMate Agent Core는 이 둘을 묶어 전체 플랫폼이 연결되고 학습하도록 만든다.
```

Agent Core의 주요 책임:

- 워크플로우 실행
- 캠페인 모니터링
- Slack/Email 알림
- Slack button action 처리
- operator_actions 기록
- audit_logs 기록
- Hermes 피드백 학습
- Compass/Sentinel/Lens/Foresight Tool 호출
- LLM/API 비용 추적
- 권한/학습 범위 통제

---

## 4. 제품별 상세 맥락

### 4.1 AdMate Compass

목적: Meta, Google, Naver, Kakao, X 등 광고 플랫폼 정책과 가이드를 RAG 기반으로 검색하고 답변한다.

주요 기능:

- 멀티 플랫폼 크롤링
- 핵심 본문 추출
- 하이브리드 검색
- RAG 기반 답변
- 향후 Multi-LLM Validation
- 할루시네이션 최소화
- 경량/고성능 모델 라우팅

핵심 가치:

- 정책 확인 시간 단축
- 광고 정책 리스크 감소
- 광고주 문의 대응 속도 향상
- 정책 지식 자산화

### 4.2 AdMate Sentinel

Sentinel은 beta가 아니라 최종적으로 “AdMate Sentinel”이다.

Sentinel은 두 영역을 모두 포함한다.

```text
Pre-launch Validation
= 캠페인 시작 전 미디어믹스/엑셀과 실제 매체 세팅값 비교

Live Monitoring
= 캠페인 시작 후 예산, KPI, 상태 이상 실시간 감지 및 Slack/Email 알림
```

사전 검수 항목:

- 예산
- 기간
- 타겟
- 캠페인 상태
- 랜딩 URL
- 캠페인명/광고세트명
- 구매 유형
- 캠페인 목표

운영 감지 항목:

- 예산 소진/지연
- CTR/CPC/CPM 이상
- 캠페인 상태 변화
- Slack/Email 알림
- 1시간 보류/오늘 중지/알림 종료/재개
- 운영자 대응 이력
- Hermes 피드백 학습

### 4.3 AdMate Lens

기존 Capture Pro. 광고 게재 화면과 보고서용 증빙 이미지를 자동 생성한다.

중요 주의사항:

```text
Lens의 캡처 결과물 자체는 실제 매체 화면과 픽셀 매칭이 중요하므로 임의로 디자인을 변경하면 안 된다.
AdMate/Openclaw 테마 적용 대상은 관리자 화면, 입력 폼, 목록, 작업 이력, 설정 화면이다.
```

### 4.4 AdMate Foresight

기존 Planner. 과거 광고 데이터와 시장 트렌드를 기반으로 캠페인 기획 단계의 예상 성과를 제공한다.

초기 PoC는 Meta 우선.

예상 지표:

- CPM
- CPC
- CTR
- VTR
- CPV

중요 원칙:

```text
제안/운영 판단에 사용하는 벤치마크 데이터는 조회/제안 시점 기준 최대 6개월 이내 데이터를 우선한다.
6개월 초과 데이터는 장기 추세 참고용으로 분리한다.
마크업, Net/Gross, 통화, 조회기간, 필터 옵션은 반드시 메타데이터로 남긴다.
```

---

## 5. 캠페인 생애주기 흐름

AdMate는 다음 흐름을 하나로 연결한다.

```text
기획
→ 정책 확인
→ 세팅 검수
→ 집행 시작
→ 운영 모니터링
→ 캡처/증빙
→ 성과 평가
→ 운영자 피드백 학습
→ 다음 기획 반영
```

제품 배치:

| 단계 | 제품 |
|---|---|
| 기획 | Foresight |
| 정책 확인 | Compass |
| 세팅 검수 | Sentinel Pre-launch |
| 운영 모니터링 | Sentinel Live Monitoring |
| 캡처/보고 | Lens |
| 학습/자동화 | Agent Core / Hermes / Openclaw |

---

## 6. 데이터와 학습 거버넌스

AdMate의 장기 경쟁력은 데이터와 학습 구조에서 나온다.

모든 제품은 가능하면 공통 Campaign Identity로 연결한다.

Campaign Intelligence Object 후보:

```text
campaign_id
platform
advertiser
brand
objective
industry
country
manager
team
budget
period
creative
landing_url
media_mix
setup_validation_result
policy_check_result
capture_assets
monitoring_events
alert_events
operator_actions
planner_predictions
actual_performance
learning_feedback
cost_events
```

Hermes 학습 원칙:

```text
1. 권한 있는 사용자 또는 검증된 시스템 이벤트를 우선한다.
2. 일반 user action은 기본적으로 학습 신호에서 제외한다.
3. smoke test 데이터는 기본 학습 집계에서 제외한다.
4. 하나의 피드백으로 전역 기준을 즉시 바꾸지 않는다.
5. 학습 후보 → 검토 → 승인 → 반영 단계를 둔다.
6. raw campaign-level 데이터는 LLM에 직접 전달하지 않는다.
```

권한 구조:

| 역할 | 의미 |
|---|---|
| Super Admin | 시스템 전체 관리자, 학습 반영 가능 |
| Admin | 관리 범위 내 관리자 |
| Reviewer | Hermes 추천/학습 검토자 |
| User | 일반 사용자, 기본적으로 학습 미반영 |

---

## 7. 보안/ISMS 원칙

AdMate는 광고 운영 데이터, 캠페인 성과, 사용자 행동, 운영자 피드백, LLM 요청 로그를 다룬다.

절대 원칙:

- raw campaign-level 데이터는 LLM에 직접 전달하지 않는다.
- 필요 시 익명화/집계/요약 후 전달한다.
- API key/token/service role key는 출력하지 않는다.
- .env.local은 커밋하지 않는다.
- 권한 변경, 기준 변경, 학습 반영, Agent action은 audit log에 기록한다.
- 외부 LLM/API 사용 시 전달 데이터를 최소화한다.
- 신규 사용자는 기본 user로 생성한다.
- Super Admin은 최소 인원으로 운영한다.

절대 출력/커밋 금지:

```text
SUPABASE_SERVICE_ROLE_KEY
OPENCLAW_INGEST_KEY
Slack bot token
Meta access token
Google API key
SMTP password
.env.local
n8n credentials
LLM provider API key
```

---

## 8. LLM Cost Center

AdMate는 유료 LLM과 외부 AI API를 사용하므로 비용 관리가 필수다.

추적 단위:

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
- 비용 급증 알림

목표:

```text
AI 활용을 확대하되, 비용 구조를 실시간으로 관리하고 ROI를 확인할 수 있는 운영 체계를 만든다.
```

---

## 9. Weekly Intelligence Upgrade Loop

사용자가 매우 중요하게 보는 기능이다.

목적:

```text
빠르게 변하는 AI/MarTech/광고 플랫폼 기술을 매주 조사하고,
AdMate에 적용 가능한 업그레이드 후보를 선정해
Codex/Openclaw 작업 backlog로 연결한다.
```

조사 대상:

- OpenAI
- Anthropic
- Google/Gemini
- Meta
- Perplexity
- Vercel
- Supabase
- n8n
- LangChain
- LlamaIndex
- OpenRouter
- 광고 플랫폼 API 변경
- RAG/Agent/Workflow best practice
- 이미지/영상/TTS 모델

루틴:

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

---

## 10. Business Opportunity Discovery & Build Loop

장기 비전이다. 현재 핵심 실행 범위에는 과도하게 포함하지 않는다.

정의:

```text
Hermes에 축적된 내부 업무 지식과 외부 시장 정보를 결합해,
회사에 직접 구축할 가치가 있는 신규 솔루션 후보를 발굴하고,
사람 승인 하에 PoC 개발과 제품화로 연결하는 장기 전략 루프
```

사업성의 의미:

- 직접 수익화 가능성
- 광고주에게 더 양질의 서비스를 제공할 가능성
- 현재 유료로 사용하는 외부 플랫폼 대체 가능성
- 내부 업무 시간 절감 가능성
- 회사 고유 데이터 자산 활용 가능성

---

## 11. 임원 보고 메시지

임원 대상 핵심 문장:

```text
AdMate는 나스미디어의 광고 운영 지식을 AI Agent가 실행 가능한 형태로 바꾸는 광고 운영 자동화 플랫폼입니다.
```

임원 보고 흐름:

```text
1. 데이터분석팀은 왜 AdMate를 만들고 있는가
2. AdMate란 무엇인가
3. AdMate를 구성하는 네 개 플랫폼
4. Agent Core가 왜 핵심인가
5. 현재 구현 수준은 어디까지인가
6. 플랫폼 간 연결이 어떤 경쟁력을 만드는가
7. AI 비용과 기술 변화는 어떻게 관리할 것인가
8. 장기적으로 어떤 확장 가능성이 있는가
```

---

## 12. 미디어플래너 대상 메시지

핵심 문장:

```text
AdMate는 미디어플래너를 대체하는 도구가 아니라,
반복 확인·검수·캡처·정책 검색·이상 감지를 대신 처리해
플래너가 전략과 판단에 집중하게 만드는 AI 업무 파트너입니다.
```

발표 흐름:

```text
1. 왜 AdMate가 필요한가
2. 캠페인 운영에서 반복 업무가 발생하는 지점
3. AdMate가 연결하는 캠페인 운영 사이클
4. Compass: 정책 확인
5. Sentinel: 사전 검수와 실시간 모니터링
6. Lens: 캡처 자동화
7. Foresight: 다음 캠페인 예측
8. Agent Core: 내 판단이 다음 기준이 되는 구조
9. 실제 업무 시나리오
10. 앞으로 함께 고도화할 방향
```

---

## 13. 현재/주요 repo 구성

로컬 기준:

```text
C:\Users\Administrator\projects\
├─ openclaw-monitor
├─ admate-capture-pro
├─ Jhongjin-admate-guide-codex
└─ admate-homepage
```

역할:

| repo | 역할 |
|---|---|
| openclaw-monitor | AdMate Agent Core / Openclaw / Hermes / Sentinel Live Monitoring 중심 |
| admate-capture-pro | AdMate Lens, 캡처/증빙 자동화 |
| Jhongjin-admate-guide-codex | AdMate Compass, 정책/가이드 RAG |
| admate-homepage | AdMate 대표 홈페이지 |

---

## 14. Codex/Agent 작업 공통 원칙

모든 Codex/Agent 작업에 공통으로 적용한다.

```text
1. 먼저 문서를 읽고 repo 구조를 요약한다.
2. 아직 파일을 수정하지 않는다.
3. 수정 후보 파일, 위험 요소, 작업 계획을 먼저 보고한다.
4. 사용자가 승인한 뒤 수정한다.
5. .env/API key/token/credential 값은 절대 출력하지 않는다.
6. main에 직접 push하지 않는다.
7. commit/push/PR 생성은 사용자 승인 전 금지한다.
8. build/test 결과를 보고한다.
9. 변경 파일 목록과 rollback 방법을 보고한다.
```

---

## 15. repo별 첫 프롬프트 요약

### openclaw-monitor

역할: Openclaw/Sentinel/Agent Core 개발 Agent

먼저 읽을 것:

- README.md
- AGENTS.md
- docs/strategy/*
- docs/design/openclaw-theme-reference.md
- package.json
- src/app 주요 route
- src/components 주요 컴포넌트

먼저 보고할 것:

- repo 목적
- AdMate 생태계에서의 역할
- 주요 페이지/API
- Openclaw/Hermes/Sentinel 핵심 파일
- build/test 방법
- 위험 요소
- 다음 작업 계획

### admate-capture-pro

역할: AdMate Lens 개발 Agent

주의:

- 캡처 결과물/광고 미리보기/픽셀 매칭 UI는 임의 변경 금지
- 운영자 UI만 AdMate/Openclaw 톤으로 정리 가능

먼저 보고할 것:

- 캡처 결과물과 운영자 UI의 경계
- 건드리면 안 되는 파일/영역
- UI 정렬 후보 파일
- 위험 요소
- build/test 방법

### admate-homepage

역할: AdMate 대표 홈페이지 제작

최우선 문서:

- AdMate_Homepage_IA_Brand_Copy_v1.md
- AdMate_Product_Map_v1.md
- AdMate_Unified_Agent_Architecture_v1_1.md
- openclaw-theme-reference.md

필수 섹션:

- Hero
- Problem
- Ecosystem
- Product Cards
- Campaign Lifecycle
- Agent Core
- Impact
- Operations/Roadmap
- Final CTA

디자인 방향:

```text
운영 콘솔의 신뢰감
+ 브랜드 랜딩 페이지의 전달력
+ AI Agent 플랫폼의 미래감
```

---

## 16. 다음 LLM에게 주는 첫 지시문

다른 LLM에게 이 프로젝트를 이어가게 할 때는 아래를 그대로 전달한다.

```text
너는 지금부터 AdMate 프로젝트의 전략/기획/개발 총괄 파트너다.

AdMate는 나스미디어 데이터분석팀이 구축하는 AI Agent 기반 광고 운영 자동화 플랫폼이다.
제품군은 AdMate Compass, AdMate Sentinel, AdMate Lens, AdMate Foresight, AdMate Agent Core로 구성된다.

먼저 이 문서와 첨부된 전략 문서들을 읽고 아래를 요약해라.

1. AdMate의 최상위 비전
2. 각 제품의 역할
3. Agent Core와 Openclaw/Hermes의 관계
4. 임원 보고 관점
5. 미디어플래너 보고 관점
6. 보안/학습/비용 운영 원칙
7. 현재 repo 구조와 각 repo의 역할
8. 지금 당장 이어서 해야 할 작업

새로운 방향을 임의로 제안하지 말고, 먼저 기존 구조를 정확히 이해했는지 확인해라.
```

---

## 17. 반드시 첨부하거나 repo에 넣을 문서

다음 문서들은 `docs/strategy` 또는 별도 `admate-docs` 폴더에 보관한다.

```text
AdMate_Unified_Agent_Architecture_v1_1.md
AdMate_Product_Map_v1.md
AdMate_Agent_Core_Operating_Model_v1.md
AdMate_AI_Operations_Manual_v1.md
AdMate_Unified_Data_Learning_Governance_v1.md
AdMate_External_LLM_Handoff_Master_Document_v1.md
AdMate_Homepage_IA_Brand_Copy_v1.md
AdMate_Repo_Codex_Integration_Guide_v1.md
```

디자인 기준:

```text
docs/design/openclaw-theme-reference.md
```

---

## 18. 영구 저장 방식 추천

가장 안전한 영구 저장 방식은 다음 3단계다.

### 1단계: 각 repo 루트에 AGENTS.md 저장

각 repo에 repo별 AGENTS.md를 둔다.

- openclaw-monitor/AGENTS.md
- admate-capture-pro/AGENTS.md
- admate-homepage/AGENTS.md
- Jhongjin-admate-guide-codex/AGENTS.md

### 2단계: 공통 전략 문서를 docs/strategy에 저장

각 repo에 필요한 문서만 넣는다.

### 3단계: 별도 중앙 문서 repo 또는 admate-docs 폴더 운영

전체 전략 문서 패키지는 중앙에서 관리한다.

권장:

```text
admate-docs/
├─ strategy/
├─ design/
├─ prompts/
└─ handoff/
```

---

## 19. 최종 요약

AdMate는 다음 한 문장으로 정의된다.

```text
AdMate는 나스미디어의 광고 운영 지식을 AI Agent가 실행 가능한 형태로 바꾸는 광고 운영 자동화 플랫폼이다.
```

이 프로젝트를 이어받는 AI는 다음 원칙을 절대 잊으면 안 된다.

```text
AdMate는 단순 AI 툴 모음이 아니다.
AdMate는 광고 운영 생애주기 전체를 연결하는 Agent 생태계다.
Compass, Sentinel, Lens, Foresight는 전문 제품이다.
Openclaw와 Hermes는 Agent Core의 내부 엔진이다.
Hermes 학습은 보안/권한/신뢰도 기반으로 통제해야 한다.
ISMS와 비용 통제는 초기 설계부터 핵심이다.
Codex/Agent 작업은 문서 읽기 → 계획 보고 → 승인 → 수정 → 검증 → 보고 순서로 진행한다.
```
