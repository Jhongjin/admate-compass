# AdMate Strategy Docs Package Index v1

작성일: 2026-05-01
문서 상태: 초안 v1
작성 목적: 지금까지 정리한 AdMate 전략/운영/인수인계 문서들을 하나의 패키지로 관리하기 위한 문서 목록, 읽는 순서, 활용 목적, 저장 구조, 후속 작업 기준을 정의한다.

---

## 1. 패키지 목적

AdMate 전략 문서 패키지는 AdMate 생태계의 비전, 제품군, Agent Core, 데이터/학습/보안, AI 운영 체계, 장기 전략, 외부 LLM 인수인계 내용을 한곳에 모아 관리하기 위한 기준 문서 묶음이다.

이 패키지는 다음 상황에서 사용한다.

- 임원 보고 자료를 만들 때
- 미디어플래너 대상 설명 자료를 만들 때
- Codex/Paperclip에게 개발 작업을 이관할 때
- 다른 LLM에게 프로젝트 맥락을 이어줄 때
- AdMate 홈페이지/브랜드 카피를 만들 때
- 각 제품별 PRD를 작성할 때
- Openclaw/Hermes 기반 Agent Core 작업을 이어갈 때

---

## 2. 패키지 권장 폴더 구조

```text
AdMate_Strategy_Docs_v1/
├─ 00_README_AdMate_Strategy_Docs_Package_Index_v1.md
├─ 01_AdMate_Unified_Agent_Architecture_v1_1.md
├─ 01_AdMate_Unified_Agent_Architecture_v1_1.docx
├─ 02_AdMate_Executive_Brief_v1.md
├─ 02_AdMate_Executive_Brief_v1.docx
├─ 03_AdMate_Media_Planner_Brief_v1.md
├─ 03_AdMate_Media_Planner_Brief_v1.docx
├─ 04_AdMate_Product_Map_v1.md
├─ 04_AdMate_Product_Map_v1.docx
├─ 05_AdMate_Agent_Core_Operating_Model_v1.md
├─ 05_AdMate_Agent_Core_Operating_Model_v1.docx
├─ 06_AdMate_AI_Operations_Manual_v1.md
├─ 06_AdMate_AI_Operations_Manual_v1.docx
├─ 07_AdMate_Unified_Data_Learning_Governance_v1.md
├─ 07_AdMate_Unified_Data_Learning_Governance_v1.docx
├─ 08_AdMate_Future_Strategy_Loop_v1.md
├─ 08_AdMate_Future_Strategy_Loop_v1.docx
├─ 09_AdMate_External_LLM_Handoff_Master_Document_v1.md
└─ 09_AdMate_External_LLM_Handoff_Master_Document_v1.docx
```

향후 추가될 문서는 다음 번호부터 이어간다.

```text
10_AdMate_Executive_Slide_Storyboard_v1
11_AdMate_Media_Planner_Slide_Storyboard_v1
12_AdMate_Homepage_IA_Brand_Copy_v1
13_AdMate_Repo_Codex_Integration_Guide_v1
```

---

## 3. 현재 문서 목록

| 번호 | 문서명 | 목적 | 주요 독자 |
|---|---|---|---|
| 00 | AdMate Strategy Docs Package Index | 전체 문서 묶음의 사용법과 읽는 순서 정의 | 전체 |
| 01 | AdMate Unified Agent Architecture v1.1 | AdMate 생태계 전체 기준 문서 | 임원, 기획자, LLM, 개발 Agent |
| 02 | AdMate Executive Brief v1 | 임원 보고용 원본 문서 | 임원, 팀장, 발표자 |
| 03 | AdMate Media Planner Brief v1 | 미디어플래너 대상 설명 원본 문서 | 미디어플래너, 운영 실무자 |
| 04 | AdMate Product Map v1 | 제품군 역할, 명칭, 경계, 연결 구조 정리 | 기획자, 개발자, 홈페이지 제작자 |
| 05 | AdMate Agent Core Operating Model v1 | Openclaw/Hermes와 Agent Core 운영 방식 정의 | 개발자, Agent 설계자 |
| 06 | AdMate AI Operations Manual v1 | LLM 비용, 모델 라우팅, Weekly Intelligence 운영 기준 | 관리자, 운영자, 개발 Agent |
| 07 | AdMate Unified Data & Learning Governance v1 | 데이터 모델, Hermes 학습, 권한/감사/보안 기준 | 데이터/보안/개발 담당자 |
| 08 | AdMate Future Strategy Loop v1 | 장기 사업 기회 탐색 및 PoC 개발 루프 정의 | 임원, 전략/기획 담당자 |
| 09 | AdMate External LLM Handoff Master Document v1 | 다른 LLM/Agent에게 전체 맥락을 넘기는 인수인계 문서 | LLM, Codex, Paperclip |

---

## 4. 문서별 핵심 요약

## 4.1 AdMate Unified Agent Architecture v1.1

AdMate 전체 기준 문서다.

핵심 내용:

- AdMate = AI Agent 기반 광고 운영 자동화 플랫폼
- Compass / Sentinel / Lens / Foresight / Agent Core 정의
- Sentinel은 사전 검수와 실시간 모니터링을 모두 포함
- Openclaw/Hermes는 Agent Core의 내부 엔진
- 캠페인 생애주기 기반 통합 흐름
- LLM Cost Center, Weekly Intelligence Loop, 장기 비전 포함

읽어야 하는 경우:

- 프로젝트 전체 방향을 이해해야 할 때
- 신규 LLM/Agent가 맥락을 잡아야 할 때
- 슬라이드/홈페이지/PRD의 기준을 만들 때

## 4.2 AdMate Executive Brief v1

임원 보고용 문서다.

핵심 내용:

- 왜 데이터분석팀이 AdMate를 만드는가
- 회사 경쟁력 관점의 AdMate 가치
- 플랫폼 구성과 현재 구현 수준
- 업무 효율, 사고 예방, 데이터 자산화
- LLM Cost Center와 Weekly Intelligence Loop
- 장기 Business Opportunity Loop

읽어야 하는 경우:

- 임원 발표 자료를 만들 때
- 회사 경쟁력/ROI 관점 메시지를 정리할 때

## 4.3 AdMate Media Planner Brief v1

미디어플래너 대상 설명 문서다.

핵심 내용:

- AdMate는 플래너를 대체하지 않고 반복 업무를 줄이는 AI 업무 파트너
- 정책 확인 → 세팅 검수 → 운영 감지 → 캡처 → 다음 기획 흐름
- 실제 업무 시나리오와 Before/After
- 플래너의 판단이 Hermes에 학습되는 구조

읽어야 하는 경우:

- 현업 설명회/베타 온보딩 자료를 만들 때
- 실무자에게 기능 가치를 설명할 때

## 4.4 AdMate Product Map v1

제품군 역할과 경계를 정리한 문서다.

핵심 내용:

- Compass는 정책을 답한다.
- Sentinel은 캠페인 사고를 막고 감지한다.
- Lens는 캡처와 증빙을 만든다.
- Foresight는 다음 성과를 예측한다.
- Agent Core는 이 모든 흐름을 연결하고 학습한다.

읽어야 하는 경우:

- 홈페이지 제품 카드 작성
- 제품별 PRD 작성
- 기능 중복/역할 충돌 방지

## 4.5 AdMate Agent Core Operating Model v1

Agent Core의 작동 구조를 정의한 문서다.

핵심 내용:

- Openclaw = 실행 엔진
- Hermes = 지능/메모리 엔진
- Agent Core = 지능과 자동화의 공통 레이어
- Tool/API 모델
- 권한, 감사, Slack UX, 비용 추적, Weekly Intelligence

읽어야 하는 경우:

- Openclaw/Hermes 개발 작업
- Slack Agent UX 설계
- Tool/API 설계

## 4.6 AdMate AI Operations Manual v1

AI 운영 체계 문서다.

핵심 내용:

- LLM Cost Center
- 모델 라우팅 정책
- Weekly Intelligence Upgrade Loop
- AI 변경 관리
- Codex/Paperclip 작업 이관
- 보안/ISMS 운영 기준

읽어야 하는 경우:

- AI 비용 관리 기능 설계
- 모델/프롬프트 변경 관리
- 주간 기술 리서치 루틴 설계

## 4.7 AdMate Unified Data & Learning Governance v1

데이터와 학습 거버넌스 문서다.

핵심 내용:

- Campaign Intelligence Object
- operator_actions / audit_logs / llm_usage_events
- Hermes 학습 권한과 신뢰도
- 최근 최대 6개월 데이터 기준
- LLM 데이터 전달 최소화
- ISMS 관점 데이터 처리

읽어야 하는 경우:

- DB 설계
- Hermes 학습 품질 개선
- 보안/감사 설계

## 4.8 AdMate Future Strategy Loop v1

장기 전략 문서다.

핵심 내용:

- Business Opportunity Discovery & Build Loop
- Hermes 도메인 지식 기반 신규 솔루션 후보 발굴
- 사업성 = 수익화 + 광고주 서비스 품질 + 외부 도구 대체
- 사람 승인 기반 PoC 개발 루프

읽어야 하는 경우:

- 장기 로드맵 작성
- 임원 비전 장표 작성
- 신규 솔루션 아이디어 평가

## 4.9 AdMate External LLM Handoff Master Document v1

외부 LLM/Agent 인수인계 문서다.

핵심 내용:

- 전체 비전
- 제품명과 역할
- Openclaw/Hermes 설명 원칙
- 임원/미디어플래너 메시지
- 보안/비용/학습 원칙
- Codex/Paperclip 작업 지시 예시

읽어야 하는 경우:

- 다른 LLM으로 프로젝트를 이어갈 때
- Codex/Paperclip에게 큰 맥락을 넘길 때

---

## 5. 추천 읽는 순서

## 5.1 전체를 처음 이해하는 사람

```text
1. External LLM Handoff Master Document
2. Unified Agent Architecture
3. Product Map
4. Executive Brief
5. Media Planner Brief
```

## 5.2 개발/Agent 작업자

```text
1. External LLM Handoff Master Document
2. Product Map
3. Agent Core Operating Model
4. Data & Learning Governance
5. AI Operations Manual
```

## 5.3 임원 발표 준비자

```text
1. Executive Brief
2. Unified Agent Architecture
3. Product Map
4. Future Strategy Loop
5. AI Operations Manual의 Cost/Intelligence 부분
```

## 5.4 미디어플래너 발표 준비자

```text
1. Media Planner Brief
2. Product Map
3. Unified Agent Architecture
4. Agent Core Operating Model의 Slack UX 부분
```

## 5.5 홈페이지/브랜드 제작자

```text
1. Unified Agent Architecture
2. Product Map
3. Executive Brief
4. Media Planner Brief
```

---

## 6. 문서 활용 원칙

## 6.1 이름은 통일한다

앞으로 외부/발표/홈페이지 문서에서는 다음 이름을 우선 사용한다.

```text
AdMate Compass
AdMate Sentinel
AdMate Lens
AdMate Foresight
AdMate Agent Core
```

기존명은 필요할 때만 괄호로 병기한다.

```text
AdMate Compass (기존 AdMate Guide)
AdMate Lens (기존 AdMate Capture Pro)
AdMate Foresight (기존 AdMate Planner)
```

## 6.2 Sentinel beta 표현은 줄인다

외부/발표 문서에서는 Sentinel beta 대신 AdMate Sentinel을 사용한다.

Sentinel은 다음 두 영역을 모두 포함한다.

```text
Pre-launch Validation
Live Monitoring
```

## 6.3 Openclaw/Hermes는 내부 엔진으로 설명한다

외부용 문서에서는 Openclaw/Hermes를 별도 제품처럼 강조하지 않는다.

권장 표현:

```text
AdMate Agent Core는 Openclaw의 실행 자동화와 Hermes의 학습/기억 구조를 기반으로 동작합니다.
```

## 6.4 기능 구현 상태를 과장하지 않는다

구현 상태는 다음 네 단계로 표현한다.

```text
기획/설계
PoC
구현 진행
운영/고도화
```

## 6.5 보안 원칙은 모든 문서에서 유지한다

다음 원칙은 모든 문서/프롬프트/작업에서 유지한다.

- raw campaign-level 데이터는 LLM에 직접 전달하지 않는다.
- secret/API key/token은 출력하지 않는다.
- 학습은 권한 있는 신호만 반영한다.
- audit log를 기본 전제로 둔다.

---

## 7. 후속 작업 목록

이 패키지 이후 남은 주요 산출물은 다음과 같다.

| 우선순위 | 문서/작업 | 목적 |
|---|---|---|
| 1 | Executive Slide Storyboard | 임원 보고용 슬라이드 구조와 장표별 메시지 확정 |
| 2 | Media Planner Slide Storyboard | 실무자 대상 발표 구조와 업무 시나리오 확정 |
| 3 | Homepage IA & Brand Copy | AdMate 홈페이지 구조와 카피 작성 |
| 4 | Repo/Codex Integration Guide | 각 repo에 문서/디자인 기준을 반영하는 방법 정리 |
| 5 | Unified ZIP/Folder Packaging | DOCX/MD 파일을 배포 가능한 폴더/ZIP으로 정리 |

---

## 8. 파일명 규칙

권장 파일명 규칙:

```text
번호_문서명_버전.확장자
```

예시:

```text
01_AdMate_Unified_Agent_Architecture_v1_1.md
01_AdMate_Unified_Agent_Architecture_v1_1.docx
```

날짜를 붙이는 경우:

```text
2026-05-01_AdMate_Executive_Slide_Storyboard_v1.md
```

버전 업데이트 시:

```text
v1
v1_1
v2
```

---

## 9. 다음 LLM/Agent에게 전달할 요약

다음 LLM 또는 Agent에게 문서 패키지를 전달할 때는 다음 문장을 함께 전달한다.

```text
이 문서 패키지는 AdMate 프로젝트의 전체 전략/제품/Agent/데이터/운영/인수인계 기준 문서입니다.
AdMate는 나스미디어 데이터분석팀이 구축하는 AI Agent 기반 광고 운영 자동화 플랫폼이며,
제품군은 Compass, Sentinel, Lens, Foresight, Agent Core로 구성됩니다.

먼저 09_External_LLM_Handoff 문서를 읽고 전체 맥락을 이해한 뒤,
작업 목적에 따라 Executive Brief, Media Planner Brief, Product Map, Agent Core Operating Model을 참고하세요.
```

---

## 10. 최종 요약

AdMate Strategy Docs Package v1은 AdMate 프로젝트의 1차 전략 문서 세트다.

이 패키지를 통해 다음을 유지한다.

```text
브랜드 메시지 일관성
제품명 일관성
Openclaw/Hermes 설명 기준
Sentinel 범위 통일
임원/미디어플래너 메시지 분리
데이터/학습/보안 운영 원칙
다른 LLM/Agent로의 인수인계 가능성
```

앞으로 모든 슬라이드, 홈페이지, 개발 문서, Codex 작업 프롬프트는 이 패키지를 기준으로 작성한다.
