# AdMate Product Map v1

작성일: 2026-04-30
문서 상태: 초안 v1
작성 목적: AdMate 생태계 내 제품군의 역할, 명칭, 사용자 가치, Agent Core 연계 방식, 현재 구현 단계, 향후 확장 방향을 한눈에 정리한다. 본 문서는 임원 보고, 미디어플래너 발표, 홈페이지 IA, 제품별 PRD 작성의 기준 문서로 활용한다.

---

## 1. Product Map Summary

AdMate는 **AI Agent 기반 광고 운영 자동화 플랫폼**이다.

AdMate는 네 개의 전문 제품과 하나의 공통 Agent Core로 구성된다.

```text
AdMate
├─ Compass   정책/가이드 지식
├─ Sentinel  캠페인 사전 검수 + 실시간 운영 감지
├─ Lens      광고 캡처/증빙 자동화
├─ Foresight 미디어 플래닝 예측
└─ Agent Core 지능/자동화/학습/감사 공통 레이어
```

각 제품은 독립적으로도 업무 가치를 제공하지만, 최종 목표는 이 제품들이 AdMate Agent Core를 통해 연결되는 것이다.

즉, AdMate는 단순한 제품 묶음이 아니라 캠페인 운영 생애주기를 연결하는 Agent 기반 운영 플랫폼이다.

---

## 2. 제품군 한눈에 보기

| 제품명 | 기존/내부명 | 한 줄 정의 | 주요 사용자 | 핵심 가치 |
|---|---|---|---|---|
| AdMate Compass | AdMate Guide | 광고 플랫폼 정책과 가이드의 방향을 잡아주는 Policy Intelligence Agent | 미디어플래너, AE, 운영 담당자 | 정책 확인 시간 단축, 리스크 감소 |
| AdMate Sentinel | Sentinel beta + Openclaw Sentinel 영역 | 캠페인 시작 전 검수와 집행 후 실시간 감지를 통합한 Campaign Validation & Live Monitoring 플랫폼 | 미디어플래너, 운영 담당자, 관리자 | 캠페인 사고 예방, 운영 이상 조기 감지 |
| AdMate Lens | AdMate Capture Pro | 광고 게재 화면과 보고서 증빙을 자동 생성하는 Capture Automation 솔루션 | 미디어플래너, 리포트 담당자 | 캡처/보고 리소스 절감 |
| AdMate Foresight | AdMate Planner | 과거 광고 데이터 기반 캠페인 성과 예측 및 플래닝 지원 솔루션 | 미디어플래너, 전략/제안 담당자 | 기획 의사결정 시간 단축, 예측 기준 자산화 |
| AdMate Agent Core | Openclaw + Hermes | 지능, 자동화, 기억, 실행, 학습, 감사 로그를 담당하는 공통 Agent 레이어 | 관리자, 시스템 운영자, 전체 플랫폼 | 플랫폼 간 연결, 학습, 자동화 |

---

## 3. 제품별 역할과 경계

## 3.1 AdMate Compass

### 역할

AdMate Compass는 광고 정책과 가이드 확인을 담당한다.

Compass는 Meta, Google, Naver, Kakao, X 등 여러 광고 플랫폼의 공식 가이드와 정책 문서를 수집·정제·검색하여, 사용자 질문에 근거 기반 답변을 제공한다.

### 담당 범위

- 광고 정책 질의응답
- 매체별 가이드 검색
- 업종/소재/랜딩/표현 규정 확인
- 정책 근거 제공
- RAG 기반 답변 생성
- 향후 Multi-LLM 검증을 통한 답변 신뢰도 향상

### 담당하지 않는 범위

- 실제 캠페인 세팅값 비교
- 캠페인 운영 수치 이상 감지
- 광고 게재 화면 캡처 생성
- 성과 예측 모델링

### 대표 질문

```text
이 소재 Meta 정책상 문제 있을까?
Google Ads에서 랜딩 페이지 관련 정책 확인해줘.
Naver 검색광고에서 병의원 업종 제한 사항 알려줘.
Kakao 광고 심사에서 주의해야 할 표현 알려줘.
```

### Agent Core 연계

Compass는 AdMate Agent Core가 호출하는 **Policy QA Tool**이 된다.

예시:

```text
Sentinel이 캠페인 랜딩 URL 문제를 감지
→ Agent Core가 Compass에 관련 정책 확인 요청
→ Compass가 정책 근거 제공
→ Slack에서 운영자에게 요약 답변
```

---

## 3.2 AdMate Sentinel

### 역할

AdMate Sentinel은 캠페인 사고 방지를 담당한다.

Sentinel은 캠페인 시작 전 세팅값을 검수하고, 캠페인 시작 후에는 운영 상태와 주요 성과 지표의 이상을 감지한다.

### 두 가지 영역

```text
Pre-launch Validation
= 캠페인 시작 전 검수

Live Monitoring
= 캠페인 시작 후 실시간 운영 감지
```

### 담당 범위

사전 검수:

- 미디어믹스와 실제 매체 세팅값 비교
- 예산, 기간, 타겟, 랜딩 URL, 상태 오류 확인
- 캠페인 시작 전 검수 결과 기록
- 검수 완료 리포트 생성

실시간 운영 감지:

- 캠페인 상태 모니터링
- 예산 소진/지연 감지
- CTR/CPC/CPM 등 KPI 이상 감지
- Slack/Email 알림
- 알림 보류/중지/종료/재개
- 운영자 대응 이력 기록
- Hermes 학습 피드백 연결

### 담당하지 않는 범위

- 매체 정책 전문 답변 생성
- 광고 게재 화면 이미지 생성
- 다음 캠페인 예상 성과 시뮬레이션

### 대표 질문/상황

```text
이 캠페인 세팅값이 미디어믹스와 일치해?
오늘 예산 소진 속도가 이상하지 않아?
CPC가 전일 대비 급등했는데 확인해줘.
이 알림은 오늘 더 이상 받고 싶지 않아.
```

### Agent Core 연계

Sentinel은 AdMate Agent Core가 호출하는 **Campaign Validation & Monitoring Tool**이 된다.

예시:

```text
캠페인 등록
→ Sentinel이 사전 검수 실행
→ 검수 통과 후 Live Monitoring 시작
→ 이상 감지 시 Slack 알림
→ 운영자 대응을 Hermes가 학습
```

---

## 3.3 AdMate Lens

### 역할

AdMate Lens는 광고 캡처와 증빙 생성을 담당한다.

Lens는 광고 게재 화면, 지면, 네이티브 UI, 상품 화면, 보고서용 증빙 이미지를 자동으로 생성한다.

### 담당 범위

- 광고 게재 화면 캡처
- 데스크톱/모바일 광고 UI 렌더링
- 네이티브 광고 UI 합성
- 보고서용 고해상도 이미지 생성
- 매체/상품/지면별 캡처 템플릿 관리
- 캡처 결과물 저장 및 이력 관리

### 담당하지 않는 범위

- 정책 질의응답
- 캠페인 세팅 검수
- 캠페인 성과 이상 감지
- 플래닝 성과 예측

### 주의 사항

Lens는 실제 매체 화면과의 시각적 일치가 중요하다. 따라서 AdMate 공통 디자인을 적용하더라도, 광고 미리보기/캡처 결과물 자체의 픽셀 매칭 UI는 임의로 변경하지 않는다.

공통 디자인 적용 대상은 다음으로 제한한다.

- 관리자 화면
- 입력 폼
- 캡처 요청 목록
- 작업 이력
- 설정 화면
- 결과 관리 화면

### 대표 질문/상황

```text
이 캠페인 YouTube 인피드 캡처 만들어줘.
모바일 네이티브 광고 화면으로 보고서용 이미지 생성해줘.
광고주 제출용 증빙 캡처 다시 만들어줘.
```

### Agent Core 연계

Lens는 AdMate Agent Core가 호출하는 **Capture Generation Tool**이 된다.

예시:

```text
Sentinel이 캠페인 등록을 확인
→ Agent Core가 매체/상품 정보를 Lens에 전달
→ Lens가 캡처 생성
→ 캡처 결과가 캠페인 기록에 저장
```

---

## 3.4 AdMate Foresight

### 역할

AdMate Foresight는 캠페인 기획과 성과 예측을 담당한다.

Foresight는 과거 광고 데이터와 시장 트렌드를 기반으로 업종/목표/예산별 예상 성과를 제공한다.

### 담당 범위

- Meta 중심 과거 광고 데이터 분석
- 업종/목표별 예상 CPM/CPC/CTR/VTR/CPV 제공
- 예산 대비 예상 성과 시뮬레이션
- 시즌성/시장 상황 반영
- 업종별 단가 트렌드 시각화
- 향후 Google, Naver 등 타 매체 확장

### 담당하지 않는 범위

- 정책/가이드 답변
- 캠페인 세팅 검수
- 실시간 이상 감지
- 광고 캡처 생성

### 대표 질문/상황

```text
뷰티 업종 Meta 캠페인 예산 3천만원이면 예상 CPC는?
인지도 캠페인에서 예상 CPM 범위 알려줘.
지난 6개월 내 유사 업종 캠페인 기준 CTR은 어느 정도야?
다음 캠페인 예산을 30% 늘리면 성과가 어떻게 바뀔까?
```

### Agent Core 연계

Foresight는 AdMate Agent Core가 호출하는 **Planning Intelligence Tool**이 된다.

예시:

```text
캠페인 종료
→ 실제 성과와 운영자 피드백이 Hermes에 저장
→ 다음 제안 시 Foresight가 유사 캠페인 예측
→ Hermes가 운영 피드백을 보정 근거로 제공
```

---

## 3.5 AdMate Agent Core

### 역할

AdMate Agent Core는 네 개 플랫폼을 연결하는 공통 지능/자동화 레이어다.

Agent Core는 내부적으로 Openclaw와 Hermes로 구성된다.

```text
Openclaw
= 스케줄과 조건에 따라 업무를 실행하고 외부 시스템을 연결하는 자동화 실행 엔진

Hermes
= AI와 사용자 이벤트를 학습해 운영 지식과 판단 기준을 축적하는 지능/메모리 엔진
```

### 담당 범위

- 캠페인 이벤트 수집
- 워크플로우 실행
- Slack/Email 알림
- 사용자 버튼 액션 처리
- operator_actions 기록
- audit_logs 기록
- Hermes 피드백 학습
- 각 플랫폼 Tool API 호출
- LLM 비용/사용량 추적
- 권한/학습 범위 통제

### 담당하지 않는 범위

Agent Core는 개별 제품 기능을 직접 대체하지 않는다. 대신 각 제품의 전문 기능을 호출하고, 그 결과를 연결·기록·학습한다.

### 대표 질문/상황

```text
이 캠페인 상태 요약해줘.
이 알림은 1시간 보류해줘.
이 판단을 다음 기준에 반영해줘.
이 캠페인과 관련된 정책, 성과, 캡처, 운영 이력을 한 번에 보여줘.
```

---

## 4. 캠페인 생애주기와 제품 배치

AdMate 제품군은 캠페인 생애주기 전체에 배치된다.

| 단계 | 제품 | 주요 기능 | 사용자 가치 |
|---|---|---|---|
| 기획 | Foresight | 예상 성과/단가 기준 제공 | 제안 준비 시간 단축 |
| 정책 확인 | Compass | 정책/가이드 질의응답 | 정책 리스크 감소 |
| 세팅 검수 | Sentinel | 미디어믹스 vs 실제 세팅 비교 | 캠페인 사고 예방 |
| 집행 시작 | Sentinel | 모니터링 시작 | 운영 안정성 확보 |
| 운영 중 | Sentinel + Agent Core | 이상 감지/알림/대응 기록 | 대응 속도 향상 |
| 캡처/보고 | Lens | 증빙 이미지 자동 생성 | 보고 리소스 절감 |
| 학습 | Hermes | 운영자 판단 학습 | 회사 지식 자산화 |
| 다음 기획 | Foresight + Hermes | 실제 성과/피드백 반영 | 예측 품질 향상 |

---

## 5. 제품 간 연결 시나리오

## 5.1 캠페인 등록 후 자동 검수/모니터링

```text
캠페인 등록
→ Sentinel이 세팅값 검수
→ 검수 통과 시 Live Monitoring 시작
→ 이상 발생 시 Slack 알림
→ 운영자 대응 기록
→ Hermes 학습
```

## 5.2 정책 이슈가 포함된 운영 알림

```text
Sentinel이 랜딩 URL 문제 감지
→ Agent Core가 Compass에 관련 정책 확인 요청
→ Compass가 정책 근거 제공
→ Slack에서 알림 + 정책 근거 함께 제공
```

## 5.3 보고서 준비 자동화

```text
캠페인 운영 이력 확인
→ Agent Core가 Lens에 캡처 생성 요청
→ Lens가 보고서용 증빙 이미지 생성
→ 캠페인 기록에 연결
```

## 5.4 다음 캠페인 기획 보정

```text
캠페인 종료
→ 실제 성과 저장
→ 운영자 피드백 Hermes에 축적
→ Foresight가 다음 캠페인 예측 시 반영
```

---

## 6. 현재 구현/진행 상태 기준

현재 구현 상태는 과장하지 않고 다음처럼 관리한다.

| 제품 | 상태 구분 | 설명 |
|---|---|---|
| Compass | 기반 구축/고도화 단계 | 멀티 플랫폼 크롤링, 본문 추출, RAG 구조 기반. 정확도/검증 고도화 필요 |
| Sentinel | 일부 핵심 구현 진행 | Live Monitoring/알림/운영자 action/Hermes 연계 구조 구현. Pre-launch Validation은 별도 연계 필요 |
| Lens | 기능 구현 진행 | 캡처/렌더링 기능 기반 존재. 운영 콘솔/Agent 연계 필요 |
| Foresight | 기획/PoC 설계 단계 | Meta 중심 예측 모델과 시뮬레이터 설계 필요 |
| Agent Core | 핵심 구조 구현 진행 | Openclaw/Hermes 기반 실행/학습/권한/감사 구조 구축 중 |

상태 구분은 다음 네 단계로 통일한다.

```text
기획/설계
PoC
구현 진행
운영/고도화
```

---

## 7. 홈페이지/브랜드 카드 표현

홈페이지에서는 각 제품을 다음과 같이 간결하게 소개한다.

## 7.1 AdMate Compass

```text
정책과 가이드의 방향을 잡다

Meta, Google, Naver, Kakao, X의 광고 정책과 가이드를 기반으로
캠페인 집행 전 필요한 정책 판단을 빠르게 지원합니다.
```

## 7.2 AdMate Sentinel

```text
캠페인 사고를 사전에 막고 실시간으로 감지하다

캠페인 시작 전에는 세팅 오류를 검수하고,
집행 후에는 예산·성과·상태 이상을 실시간으로 감지합니다.
```

## 7.3 AdMate Lens

```text
광고 게재 화면과 증빙을 자동으로 만들다

광고 게재 화면과 지면 노출 이미지를 자동 생성해
캡처·증빙·보고 업무에 투입되는 반복 리소스를 줄입니다.
```

## 7.4 AdMate Foresight

```text
다음 캠페인의 성과를 미리 예측하다

과거 캠페인 데이터와 시장 트렌드를 기반으로
캠페인 기획 단계에서 예상 성과와 전략 방향을 제안합니다.
```

## 7.5 AdMate Agent Core

```text
지능과 자동화를 연결하다

Openclaw의 실행 자동화와 Hermes의 학습/기억 구조를 기반으로
AdMate 플랫폼 전반의 업무 흐름을 연결하고 고도화합니다.
```

---

## 8. 제품별 KPI 후보

| 제품 | 핵심 KPI 후보 |
|---|---|
| Compass | 정책 질문 응답 시간, 답변 정확도, 근거 제공률, 재질문율 |
| Sentinel | 검수 시간 절감률, 오류 탐지 수, 사고 예방 건수, 알림 대응 시간 |
| Lens | 캡처 생성 시간, 수동 캡처 대체 건수, 보고서 준비 시간 절감률 |
| Foresight | 예측 정확도, 제안 준비 시간, 업종/목표별 벤치마크 커버리지 |
| Agent Core | 자동화 실행 건수, 운영자 피드백 수, 학습 반영 건수, LLM 비용 대비 절감 효과 |

---

## 9. 제품 간 역할 충돌 방지 원칙

AdMate 제품군이 확장될수록 역할 충돌을 방지해야 한다.

### 원칙 1. 정책 답변은 Compass가 담당한다.

Sentinel이 정책 관련 이상을 감지하더라도, 정책 근거 검색과 답변 생성은 Compass가 담당한다.

### 원칙 2. 캠페인 검수/감지는 Sentinel이 담당한다.

Foresight가 예측을 제공하더라도, 실제 운영 중 이상 여부 판단과 알림은 Sentinel이 담당한다.

### 원칙 3. 시각 증빙은 Lens가 담당한다.

Sentinel이나 Foresight가 캡처를 요청할 수는 있지만, 캡처 생성과 이미지 관리 기능은 Lens가 담당한다.

### 원칙 4. 예측과 시뮬레이션은 Foresight가 담당한다.

Sentinel이 실제 수치를 감지하더라도, 다음 캠페인 예상 성과와 시뮬레이션은 Foresight가 담당한다.

### 원칙 5. 연결과 학습은 Agent Core가 담당한다.

각 플랫폼이 만든 결과를 연결하고, 운영자 피드백을 기록하고, Hermes 학습으로 이어주는 것은 Agent Core가 담당한다.

---

## 10. 향후 Tool/API 전환 방향

각 제품은 UI뿐 아니라 Agent Core가 호출할 수 있는 Tool/API를 가져야 한다.

```text
Compass
POST /tools/compass/query

Sentinel
POST /tools/sentinel/validate-setup
POST /tools/sentinel/monitor/start
POST /tools/sentinel/monitor/status

Lens
POST /tools/lens/generate-capture
GET /tools/lens/captures/{id}

Foresight
POST /tools/foresight/simulate
GET /tools/foresight/benchmarks

Agent Core
POST /tools/agent-core/action
POST /tools/hermes/feedback/apply
```

Tool/API 설계 원칙:

- 사람이 쓰는 UI와 Agent가 호출하는 API를 분리한다.
- 모든 Agent action은 audit log에 남긴다.
- 위험하거나 비용이 큰 작업은 승인 단계를 둔다.
- LLM/API 비용은 Cost Center에 기록한다.
- 권한 없는 사용자는 민감 작업을 실행할 수 없다.

---

## 11. 우선순위 제안

AdMate 제품군의 다음 우선순위는 다음과 같다.

### 1순위. Agent Core 안정화

- 사용자 권한
- 학습 권한
- operator_actions
- audit_logs
- Sentinel Live Monitoring
- Slack action
- LLM Cost Center 기반 설계

### 2순위. 브랜드/홈페이지 구조 정리

- Compass / Sentinel / Lens / Foresight 명칭 확정
- 홈페이지 IA 설계
- 제품별 카드 문구 정리
- 공통 UI/UX 테마 적용

### 3순위. Sentinel 통합 정의 완성

- Pre-launch Validation과 Live Monitoring을 하나의 Sentinel로 정리
- 외부/임원/미디어플래너 발표에서 명칭 혼동 제거

### 4순위. Lens와 Compass UI 통일

- 기존 기능은 유지
- Openclaw/AdMate 테마 적용
- 관리자 화면 중심 정리

### 5순위. Foresight PoC 설계

- Meta 데이터 기준 정의
- 업종/목표 태깅 기준
- 최근 최대 6개월 데이터 기준
- 마크업/Net/Gross 기준 확인

---

## 12. 다음 문서로 연결

이 Product Map은 다음 문서들의 기준이 된다.

1. AdMate Agent Core Operating Model v1
2. AdMate AI Operations Manual v1
3. AdMate Unified Data & Learning Governance v1
4. AdMate Homepage IA & Brand Copy v1
5. Compass/Sentinel/Lens/Foresight 개별 PRD

---

## 13. 최종 요약

AdMate Product Map의 핵심은 다음과 같다.

```text
Compass는 정책을 답한다.
Sentinel은 캠페인 사고를 막고 감지한다.
Lens는 캡처와 증빙을 만든다.
Foresight는 다음 성과를 예측한다.
Agent Core는 이 모든 흐름을 연결하고 학습한다.
```

이 구조가 유지되어야 AdMate는 단순한 기능 묶음이 아니라, 광고 운영 생애주기 전체를 연결하는 AI Agent 기반 자동화 플랫폼으로 성장할 수 있다.
