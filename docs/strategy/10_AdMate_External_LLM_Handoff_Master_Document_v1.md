# AdMate External LLM Handoff Master Document v1

작성일: 2026-05-01
문서 상태: 초안 v1
작성 목적: 향후 다른 LLM, Codex, Paperclip, 개발 Agent, 외부 협업자 또는 신규 담당자가 AdMate 프로젝트의 맥락을 잃지 않고 이어갈 수 있도록, 전체 비전·제품 구조·기술 철학·문서 체계·현재 진행 방향·주의사항을 상세히 인수인계한다.

---

## 1. 이 문서를 읽는 대상

이 문서는 다음 대상을 위해 작성되었다.

- AdMate 프로젝트를 새로 이어받는 LLM
- Codex Desktop / Codex CLI
- Paperclip 기반 개발/기획 Agent
- 데이터분석팀 신규 담당자
- 향후 AdMate 관련 문서나 슬라이드를 만드는 AI
- AdMate 제품군의 전략/기획/개발을 이어갈 협업자

이 문서의 목적은 단순 요약이 아니다.

AdMate가 왜 필요한지, 어떤 제품군으로 구성되는지, Openclaw/Hermes가 어떤 의미인지, 각 문서가 어떤 역할을 하는지, 앞으로 어떤 순서로 사고해야 하는지를 최대한 명확하게 전달하는 것이다.

---

## 2. 최상위 프로젝트 정의

AdMate는 나스미디어 데이터분석팀이 구축하는 **AI Agent 기반 광고 운영 자동화 플랫폼**이다.

AdMate는 단순 챗봇이나 개별 업무 자동화 도구가 아니다.

AdMate의 본질은 다음과 같다.

```text
광고 캠페인의 기획, 정책 확인, 세팅 검수, 운영 모니터링,
캡처/증빙, 성과 예측, 운영자 피드백 학습을
하나의 AI Agent 기반 업무 흐름으로 연결하는 통합 플랫폼
```

AdMate는 광고 운영 업무를 사람의 수작업과 개인 경험에만 의존하지 않도록 만들고, 운영자의 판단과 캠페인 데이터를 회사의 지식 자산으로 축적하는 것을 목표로 한다.

---

## 3. 최상위 브랜드 메시지

AdMate의 공식적인 최상위 메시지는 다음 방향으로 사용한다.

```text
AdMate
AI Agent 기반 광고 운영 자동화 플랫폼

기획부터 운영, 검수, 캡처, 학습까지
광고 운영의 전 과정을 AI Agent가 연결합니다.
```

보조 카피 후보:

```text
광고 운영의 반복 업무는 줄이고,
캠페인 판단과 실행은 더 정확하게.
AdMate는 AI Agent가 광고 운영 전 과정을 연결하는 자동화 플랫폼입니다.
```

영문/한글 혼합 카피 후보:

```text
Plan. Validate. Monitor. Capture. Learn.
광고 운영의 전 과정을 AI Agent로 연결합니다.
```

---

## 4. AdMate 제품군 최종 명칭

AdMate 제품군은 다음 명칭을 기준으로 정리한다.

| 최종 브랜드명 | 기존/내부명 | 역할 |
|---|---|---|
| AdMate Compass | AdMate Guide | 광고 정책/가이드 기반 Policy Intelligence Agent |
| AdMate Sentinel | Sentinel beta + Openclaw Sentinel 영역 | 캠페인 시작 전 세팅 검수 + 시작 후 실시간 모니터링/알림 |
| AdMate Lens | AdMate Capture Pro | 광고 게재 화면과 보고서 증빙 이미지 자동 생성 |
| AdMate Foresight | AdMate Planner | 과거 광고 데이터 기반 성과 예측/플래닝 지원 |
| AdMate Agent Core | Openclaw + Hermes | 지능, 자동화, 기억, 실행, 학습, 감사 로그 공통 레이어 |

기존 repo명이나 내부 개발명은 당장 모두 변경하지 않아도 된다.

우선 문서, 발표, 홈페이지, 브랜드 메시지에서 위 명칭을 사용하고, 코드와 repo명은 단계적으로 맞춘다.

---

## 5. 각 제품의 한 줄 정의

## 5.1 AdMate Compass

광고 플랫폼 정책과 가이드의 방향을 잡아주는 Policy Intelligence Agent다.

Meta, Google, Naver, Kakao, X 등 여러 광고 플랫폼의 정책과 가이드를 RAG 기반으로 검색하고 답변한다.

홈페이지/슬라이드 표현:

```text
정책과 가이드의 방향을 잡다

Meta, Google, Naver, Kakao, X의 광고 정책과 가이드를 기반으로
캠페인 집행 전 필요한 정책 판단을 빠르게 지원합니다.
```

## 5.2 AdMate Sentinel

캠페인 사고를 사전에 막고 실시간으로 감지하는 Campaign Validation & Live Monitoring 플랫폼이다.

Sentinel은 두 영역을 모두 포함한다.

```text
Pre-launch Validation
= 캠페인 시작 전 미디어믹스와 실제 매체 세팅값 비교, 오류 검수, 승인 리포트

Live Monitoring
= 캠페인 시작 후 예산·성과·상태 이상 실시간 감지, Slack/Email 알림, 운영자 피드백 학습
```

중요: Sentinel beta라는 표현은 가능하면 외부 문서에서 제거한다. 그냥 AdMate Sentinel로 부른다.

## 5.3 AdMate Lens

광고 게재 화면과 보고서 증빙을 자동으로 만드는 Creative & Placement Capture Automation 솔루션이다.

주의: 캡처 결과물 자체의 광고 미리보기 UI는 실제 매체 화면과 픽셀 매칭이 중요하므로 임의로 디자인을 바꾸면 안 된다. 공통 디자인 적용은 관리자 화면, 입력 폼, 결과 목록, 작업 이력, 설정 화면에 한정한다.

## 5.4 AdMate Foresight

과거 캠페인 데이터와 시장 트렌드를 기반으로 다음 캠페인의 예상 성과를 예측하는 Media Planning Intelligence 솔루션이다.

1차 PoC는 Meta를 우선 대상으로 한다.

주요 지표:

- CPM
- CPC
- CTR
- VTR
- CPV

## 5.5 AdMate Agent Core

AdMate 플랫폼 전반의 지능과 자동화를 담당하는 공통 엔진이다.

내부적으로 Openclaw와 Hermes로 구성된다.

```text
Openclaw
= 스케줄과 조건에 따라 업무를 실행하고 외부 시스템을 연결하는 자동화 실행 엔진

Hermes
= AI와 사용자 이벤트를 학습해 운영 지식과 판단 기준을 축적하는 지능/메모리 엔진
```

외부/임원 대상 설명에서는 Openclaw와 Hermes를 각각 깊게 설명하기보다는, AdMate Agent Core의 내부 엔진으로 설명한다.

---

## 6. AdMate가 해결하려는 핵심 문제

미디어플래너와 광고 운영 조직은 캠페인 운영 과정에서 많은 반복 업무를 수행한다.

대표적인 문제:

- 매체 정책과 가이드가 분산되어 있음
- 캠페인 세팅값 검수가 수작업에 의존함
- 예산, 기간, 타겟, 랜딩 URL 오류가 사고로 이어질 수 있음
- 광고 게재 화면 캡처와 보고서 증빙 제작에 시간이 듦
- 운영 중 KPI/예산/상태 이상을 사람이 수시 확인해야 함
- 과거 성과 데이터와 다음 제안이 체계적으로 연결되지 않음
- 운영자 판단이 개인 경험으로만 남고 회사 지식으로 축적되지 않음

AdMate의 해결 방향:

```text
정책 확인
→ 세팅 검수
→ 운영 모니터링
→ 캡처/증빙
→ 성과 예측
→ 운영자 피드백 학습
```

이 흐름을 하나의 캠페인 생애주기로 연결한다.

---

## 7. Openclaw/Hermes를 설명할 때의 원칙

Openclaw/Hermes는 AdMate의 핵심이지만, 외부 발표나 미디어플래너 대상 설명에서 너무 기술적으로 설명하지 않는다.

권장 설명:

```text
AdMate Agent Core는 AdMate 생태계의 지능과 자동화를 담당하는 공통 엔진입니다.
Openclaw는 정해진 조건과 스케줄에 따라 업무를 실행하고, 알림과 외부 시스템 연동을 처리합니다.
Hermes는 AI와 사용자의 이벤트를 학습해 운영 지식과 판단 기준을 축적합니다.
```

더 쉬운 표현:

```text
Openclaw는 움직이는 손과 발,
Hermes는 기억하고 판단하는 두뇌입니다.
두 엔진이 AdMate Agent Core를 구성해 각 플랫폼이 서로 연결되고 학습하도록 만듭니다.
```

피해야 할 표현:

```text
Openclaw와 Hermes가 별도의 외부 제품처럼 보이는 설명
AI가 사람 승인 없이 모든 것을 자동 결정한다는 표현
AI가 회사 운영을 대신한다는 표현
```

---

## 8. 임원 보고 관점

임원 대상 문서는 기능 설명보다 회사 경쟁력, 업무 효율, 리스크 절감, 데이터 자산화에 초점을 맞춘다.

권장 스토리라인:

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

임원용 핵심 문장:

```text
AdMate는 나스미디어의 광고 운영 지식을 AI Agent가 실행 가능한 형태로 바꾸는 광고 운영 자동화 플랫폼입니다.
```

3문장 요약:

```text
AdMate는 정책 확인, 세팅 검수, 광고 캡처, 성과 예측, 운영 모니터링을 하나로 연결하는 AI Agent 기반 광고 운영 자동화 플랫폼입니다.

데이터분석팀은 이를 통해 미디어플래너의 반복 업무를 줄이고, 캠페인 사고를 예방하며, 회사 고유의 광고 운영 지식을 데이터 자산으로 축적하고자 합니다.

장기적으로 AdMate는 AI 비용 통제, 최신 기술 반영, 신규 솔루션 기회 발굴까지 확장 가능한 나스미디어의 광고 운영 지능 기반이 될 수 있습니다.
```

---

## 9. 미디어플래너 대상 설명 관점

미디어플래너 대상 설명은 회사 경쟁력보다 실제 업무 편의성에 초점을 맞춘다.

핵심 메시지:

```text
AdMate는 미디어플래너를 대체하는 도구가 아니라,
반복 확인·검수·캡처·정책 검색·이상 감지를 대신 처리해
플래너가 전략과 판단에 집중하게 만드는 AI 업무 파트너입니다.
```

권장 스토리라인:

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

미디어플래너용 한 문장:

```text
AdMate는 기획부터 운영까지 미디어플래너의 반복 업무를 줄여주는 AI 업무 파트너입니다.
```

---

## 10. 현재 구현 상태를 말할 때의 기준

현재 구현 상태는 과장하지 않는다.

권장 상태 구분:

```text
기획/설계
PoC
구현 진행
운영/고도화
```

현재 기준 설명:

| 제품 | 상태 표현 |
|---|---|
| Compass | 기반 구축/고도화 단계 |
| Sentinel | Live Monitoring 영역 구현 진행/완료 범위 존재, Pre-launch Validation은 연계 필요 |
| Lens | 기능 구현 진행, 운영 콘솔화와 Agent 연계 필요 |
| Foresight | 기획/PoC 설계 단계 |
| Agent Core | Openclaw/Hermes 기반 핵심 구조 구현 진행 |

권장 표현:

```text
현재는 각 플랫폼의 핵심 기능과 Agent Core의 기반 구조를 구축하는 단계이며,
향후 이들을 하나의 AdMate 생태계로 연결해 통합 운영 자동화 플랫폼으로 확장할 계획입니다.
```

---

## 11. 공통 데이터와 학습 구조

AdMate의 장기 경쟁력은 데이터와 학습 구조에서 나온다.

모든 플랫폼은 가능하면 공통 Campaign Identity를 기준으로 연결해야 한다.

Campaign Intelligence Object에 포함될 정보:

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

이 구조가 있어야 다음 질문에 답할 수 있다.

```text
이 캠페인은 시작 전 세팅에는 문제가 없었는가?
운영 중 어떤 이상이 발생했는가?
관련 정책 이슈는 무엇인가?
광고 게재 화면 캡처는 생성되었는가?
예측 성과와 실제 성과는 얼마나 차이 났는가?
운영자는 왜 이 알림을 이상이 아니라고 판단했는가?
다음 유사 캠페인에서는 어떤 기준을 적용해야 하는가?
```

---

## 12. Hermes 학습 원칙

Hermes는 모든 데이터를 무분별하게 학습하지 않는다.

학습 원칙:

```text
1. 권한 있는 사용자 또는 검증된 시스템 이벤트를 우선한다.
2. 일반 user action은 기본적으로 학습 신호에서 제외한다.
3. smoke test 데이터는 기본 학습 집계에서 제외한다.
4. 하나의 피드백으로 전역 기준을 즉시 바꾸지 않는다.
5. 학습 후보 → 검토 → 승인 → 반영 단계를 둔다.
6. raw campaign-level 데이터는 LLM에 직접 전달하지 않는다.
```

사용자 권한:

| 역할 | 학습 반영 |
|---|---|
| Super Admin | 가능 |
| Admin | 제한적 가능 |
| Reviewer | 승인 범위 내 가능 |
| User | 기본적으로 제외 |

---

## 13. 보안/ISMS 원칙

AdMate는 광고 운영 데이터, 캠페인 성과 데이터, 사용자 행동, 운영자 피드백, LLM 요청 로그를 다룬다.

따라서 보안과 감사 가능성이 핵심이다.

원칙:

- raw campaign-level 데이터는 LLM에 직접 전달하지 않는다.
- 필요 시 익명화/집계/요약 후 전달한다.
- API key/token/service role key는 절대 노출하지 않는다.
- 권한 변경, 기준 변경, 학습 반영, Agent action은 audit log에 기록한다.
- 외부 LLM/API 사용 시 전달 데이터를 최소화한다.
- 신규 사용자는 기본적으로 user로 생성한다.
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

## 14. LLM Cost Center

AdMate는 유료 LLM과 외부 AI API를 사용할 가능성이 크다.

따라서 관리자 화면에서 비용을 추적해야 한다.

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

목적:

```text
AI를 확대하되,
비용 구조를 실시간으로 관리하고,
ROI를 확인할 수 있는 운영 체계를 만든다.
```

임원 보고에서는 마지막 부분에 한 장 분량으로 포함한다.

---

## 15. Weekly Intelligence Upgrade Loop

사용자는 이 기능을 매우 중요하게 본다.

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

## 16. Business Opportunity Discovery & Build Loop

이것은 장기 비전으로만 다룬다.

현재 핵심 실행 범위에는 깊게 포함하지 않는다.

정의:

```text
Hermes에 축적된 내부 업무 지식과 외부 시장 정보를 결합해,
우리 회사가 직접 구축할 가치가 있는 신규 솔루션 후보를 발굴하고,
사람 승인 하에 PoC 개발과 제품화로 연결하는 장기 전략 루프
```

사업성의 의미:

- 직접 수익화 가능성
- 광고주에게 더 양질의 서비스를 제공할 가능성
- 현재 유료로 사용하는 외부 플랫폼 대체 가능성
- 내부 업무 시간 절감 가능성
- 회사 고유 데이터 자산 활용 가능성

임원 보고에서는 간략히 다음처럼 표현한다.

```text
장기적으로 AdMate는 내부 업무 데이터와 시장 정보를 기반으로
신규 솔루션 기회를 탐색하고 PoC 개발로 연결하는 전략 엔진으로 확장될 수 있습니다.
```

---

## 17. 문서 체계

현재까지 생성한 핵심 문서는 다음과 같다.

| 문서 | 목적 |
|---|---|
| AdMate Unified Agent Architecture v1.1 | 전체 기준 문서. AdMate 생태계와 Agent Core 구조 정의 |
| AdMate Executive Brief v1 | 임원 보고용 문서. 회사 경쟁력과 플랫폼 가치 설명 |
| AdMate Media Planner Brief v1 | 미디어플래너 대상 문서. 실제 업무 편의성 중심 설명 |
| AdMate Product Map v1 | 제품군 역할, 명칭, 경계, 연계 방식 정리 |
| AdMate Agent Core Operating Model v1 | Openclaw/Hermes와 Agent Core 운영 구조 정의 |
| AdMate AI Operations Manual v1 | LLM 비용, 모델 라우팅, Weekly Intelligence, 작업 이관 운영 기준 |
| AdMate Unified Data & Learning Governance v1 | 데이터 모델, Campaign Intelligence, Hermes 학습, 보안/감사 기준 |
| AdMate Future Strategy Loop v1 | 장기 사업 기회 탐색 및 PoC 개발 루프 정의 |
| AdMate External LLM Handoff Master Document v1 | 다른 LLM/Agent에게 전체 맥락을 넘기기 위한 최종 인수인계 문서 |

새로운 LLM은 최소한 다음 순서로 문서를 읽어야 한다.

```text
1. AdMate External LLM Handoff Master Document v1
2. AdMate Unified Agent Architecture v1.1
3. AdMate Product Map v1
4. AdMate Agent Core Operating Model v1
5. AdMate Unified Data & Learning Governance v1
6. AdMate AI Operations Manual v1
7. AdMate Executive Brief v1
8. AdMate Media Planner Brief v1
9. AdMate Future Strategy Loop v1
```

---

## 18. Codex/Paperclip 작업 시 주의사항

Codex 또는 Paperclip에게 작업을 시킬 때는 반드시 아래 원칙을 전달한다.

```text
이 프로젝트는 AdMate 생태계의 일부다.
먼저 관련 문서를 읽고 현재 구조를 요약하라.
기능 변경 범위와 금지 사항을 명확히 지켜라.
.env/API key/token/service role key를 출력하지 마라.
비즈니스 로직을 임의로 바꾸지 마라.
UI 변경 시 기능과 데이터 구조를 건드리지 마라.
작업 전 수정 후보 파일과 위험 요소를 먼저 보고하라.
작업 후 변경 파일, 빌드 결과, 테스트 결과, 롤백 방법을 보고하라.
commit/push는 명시 승인 전 하지 마라.
```

기본 프롬프트 구조:

```text
너는 AdMate 생태계 개발 Agent다.
먼저 다음 문서를 읽어라.

1. AGENTS.md
2. AdMate Unified Agent Architecture v1.1
3. AdMate Product Map v1
4. AdMate Agent Core Operating Model v1
5. 해당 repo의 README 및 docs

작업 목표:
...

제약 조건:
- 기능/비즈니스 로직 변경 금지 또는 명시 범위 내 변경
- API/DB schema 변경 금지, 필요한 경우 사전 보고
- .env/API key/token 출력 금지
- build/test 필수
- commit/push는 승인 전 금지

먼저 보고할 것:
1. 현재 구조 요약
2. 수정 후보 파일
3. 위험 요소
4. 작업 계획
```

---

## 19. 홈페이지/브랜드 문서로 확장할 때

AdMate 홈페이지는 단순 소개 페이지가 아니라 생태계 소개 페이지가 되어야 한다.

추천 홈페이지 구조:

```text
1. Hero: AdMate란 무엇인가
2. Problem: 광고 운영 업무의 반복과 리스크
3. Ecosystem: Compass / Sentinel / Lens / Foresight / Agent Core
4. Campaign Lifecycle: 기획 → 정책 확인 → 검수 → 운영 감지 → 캡처 → 다음 기획
5. Product Cards: 각 플랫폼 기능 소개
6. Agent Core: Openclaw + Hermes 기반 지능/자동화 레이어
7. Expected Impact: 업무 효율, 사고 예방, 리소스 절감, 데이터 자산화
8. Roadmap: Cost Center, Weekly Intelligence Loop, 장기 사업 기회 탐색
```

홈페이지에서는 Openclaw/Hermes를 너무 기술적으로 설명하지 않는다.

---

## 20. 향후 발표 일정 관점

사용자는 약 2주 후 임원 대상 발표를 준비해야 한다.

임원 발표 목적:

```text
데이터분석팀이 어떤 플랫폼을 개발하고 있으며,
이 플랫폼이 회사에 어떤 경쟁력을 가져다줄 수 있는지 설명한다.
```

그 다음 주에는 미디어플래너 대상 발표를 준비해야 한다.

미디어플래너 발표 목적:

```text
AdMate가 실제 업무에서 어떤 반복 업무를 줄이고,
정책 확인/세팅 검수/캡처/운영 모니터링/다음 기획을 어떻게 편하게 만드는지 설명한다.
```

발표 관점 차이:

| 대상 | 핵심 메시지 |
|---|---|
| 임원 | 회사 경쟁력, 데이터 자산화, 사고 예방, AI 운영 체계 |
| 미디어플래너 | 내 업무가 어떻게 줄어드는가, 어떤 실수를 막아주는가 |

---

## 21. 절대 잊지 말아야 할 전략적 판단

1. AdMate는 단순 AI 툴 모음이 아니다.
2. AdMate는 AI Agent 기반 광고 운영 자동화 플랫폼이다.
3. Sentinel은 사전 검수와 실시간 모니터링을 모두 포함한다.
4. Openclaw/Hermes는 외부 제품명이 아니라 Agent Core의 내부 핵심 엔진이다.
5. Compass/Lens/Foresight는 기존 Guide/Capture Pro/Planner의 브랜드 확장명이다.
6. Hermes 학습은 권한과 신뢰도 기반으로 통제해야 한다.
7. ISMS와 보안은 초기 설계부터 반영한다.
8. LLM 비용은 기능 단위로 추적해야 한다.
9. Weekly Intelligence Loop는 AdMate를 계속 진화시키는 핵심 운영 루틴이다.
10. Business Opportunity Loop는 장기 비전으로 품되, 현재 실행 범위에는 과도하게 넣지 않는다.

---

## 22. 다음 LLM에게 주는 첫 지시문 예시

다른 LLM에게 이 프로젝트를 이어가게 할 때는 다음처럼 시작하면 된다.

```text
너는 지금부터 AdMate 프로젝트의 전략/기획/문서화 파트너다.

AdMate는 나스미디어 데이터분석팀이 구축하는 AI Agent 기반 광고 운영 자동화 플랫폼이다.
제품군은 AdMate Compass, Sentinel, Lens, Foresight, Agent Core로 구성된다.

먼저 이 문서를 읽고 다음을 요약해라.
1. AdMate의 최상위 비전
2. 각 제품의 역할
3. Agent Core와 Openclaw/Hermes의 관계
4. 임원 보고 관점
5. 미디어플래너 보고 관점
6. 보안/학습/비용 운영 원칙
7. 지금 당장 이어서 해야 할 문서 또는 작업

답변 전에는 새로운 방향을 임의로 제안하지 말고, 먼저 기존 구조를 정확히 이해했는지 확인해라.
```

---

## 23. 최종 요약

AdMate는 다음 한 문장으로 정의된다.

```text
AdMate는 나스미디어의 광고 운영 지식을 AI Agent가 실행 가능한 형태로 바꾸는 광고 운영 자동화 플랫폼이다.
```

제품 구조는 다음과 같다.

```text
Compass는 정책을 답한다.
Sentinel은 캠페인 사고를 막고 감지한다.
Lens는 캡처와 증빙을 만든다.
Foresight는 다음 성과를 예측한다.
Agent Core는 이 모든 흐름을 연결하고 학습한다.
```

Agent Core의 본질은 다음과 같다.

```text
Openclaw는 실행한다.
Hermes는 기억하고 판단한다.
Agent Core는 이를 하나로 묶어 AdMate 전체 플랫폼이 연결되고 학습하도록 만든다.
```

AdMate의 장기 경쟁력은 다음에서 나온다.

```text
반복 업무 자동화
캠페인 사고 예방
광고주 서비스 품질 향상
회사 고유 운영 지식 자산화
AI 비용 통제
지속적 기술 고도화
장기 신규 솔루션 기회 발굴
```

이 문서를 읽은 LLM이나 Agent는 위 구조를 유지한 상태에서, 문서화·기획·개발 지원을 이어가야 한다.
