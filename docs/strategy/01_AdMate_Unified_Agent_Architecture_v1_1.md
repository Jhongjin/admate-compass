# AdMate Unified Agent Architecture v1

작성일: 2026-04-30
문서 상태: 초안 v1.1
작성 목적: AdMate 생태계 전체 구조, 플랫폼별 브랜드/역할, AdMate Agent Core의 중심 역할, Agent 운영 구조, 비용/기술 인텔리전스/장기 확장 전략을 통합적으로 정의한다.

---

## 1. Executive Summary

AdMate는 나스미디어 데이터분석팀이 구축하는 **AI Agent 기반 광고 운영 자동화 플랫폼 생태계**다.

AdMate의 목적은 단순히 개별 업무를 AI로 보조하는 것이 아니라, 미디어플래너와 광고 운영 조직이 수행하는 정책 확인, 캠페인 세팅 검수, 광고 캡처/증빙, 미디어 플래닝, 운영 모니터링, 이상 감지, 운영자 피드백 학습을 하나의 흐름으로 연결하는 것이다.

AdMate의 최상위 브랜드 메시지는 다음과 같이 정의한다.

```text
AdMate
AI Agent 기반 광고 운영 자동화 플랫폼

기획부터 운영, 검수, 캡처, 학습까지
광고 운영의 전 과정을 AI Agent가 연결합니다.
```

AdMate 생태계는 네 개의 제품 플랫폼과 하나의 공통 Agent Core로 구성된다.

1. **AdMate Compass**
   광고 플랫폼 정책과 가이드의 방향을 잡아주는 Policy Intelligence Agent

2. **AdMate Sentinel**
   캠페인 시작 전 세팅 검수와 캠페인 시작 후 실시간 모니터링/알림을 모두 포함하는 Campaign Validation & Live Monitoring 플랫폼

3. **AdMate Lens**
   광고 게재 화면과 보고서용 증빙 이미지를 자동 생성하는 Creative & Placement Capture Automation 솔루션

4. **AdMate Foresight**
   과거 광고 데이터와 시장 트렌드를 기반으로 캠페인 성과를 예측하고 기획을 지원하는 Media Planning Intelligence 솔루션

5. **AdMate Agent Core**
   Openclaw/Hermes 기술을 기반으로 지능, 기억, 자동화, 실행, 학습, 감사 로그를 담당하는 공통 Agent 운영 레이어

각 제품 플랫폼은 사람이 직접 사용하는 업무 도구이면서, 동시에 AdMate Agent Core가 호출할 수 있는 전문 Tool이다. AdMate의 최종 방향은 단순한 도구 묶음이 아니라, 광고 운영 생애주기 전체를 Agent loop로 연결하는 것이다.

```text
AdMate Compass / Sentinel / Lens / Foresight
= 각 업무 영역의 전문 플랫폼

AdMate Agent Core
= 지능, 기억, 자동화, 실행, 학습, 감사 로그를 담당하는 공통 Agent 레이어

Openclaw
= 스케줄과 조건에 따라 업무를 실행하고 외부 시스템을 연결하는 자동화 실행 엔진

Hermes
= AI와 사용자 이벤트를 학습해 운영 지식과 판단 기준을 축적하는 지능/메모리 엔진

AdMate
= 이 모든 것을 하나의 광고 운영 Agent 생태계로 묶는 통합 브랜드
```

장기적으로 AdMate는 캠페인 등록부터 정책 질의, 사전 검수, 운영 모니터링, 캡처 생성, 성과 분석, 다음 기획까지 이어지는 전 과정을 Agent 기반으로 연결한다.

---

## 2. 왜 AdMate가 필요한가

### 2.1 현재 광고 운영 업무의 문제

미디어플래너와 광고 운영 조직은 캠페인 집행 전후로 매우 많은 반복 업무를 수행한다.

대표적인 업무 병목은 다음과 같다.

- 매체 정책/가이드 확인
- 캠페인 세팅값 검수
- 미디어믹스와 실제 매체 설정 비교
- 예산, 타겟, 기간, 랜딩 URL 오류 확인
- 광고 게재 화면 캡처 및 보고서용 증빙 생성
- 캠페인 운영 중 예산 소진/성과 이상 확인
- Slack/Email 기반 알림 대응
- 광고주 문의 대응
- 다음 캠페인 기획 시 과거 성과 기준 확인
- 업종/목표별 예상 효율 산출
- 동일한 실수와 예외 기준의 반복 처리

현재 이런 업무는 사람의 경험, 수작업, 개별 파일, 개별 시스템에 많이 의존한다.

그 결과 다음 문제가 발생한다.

| 문제 | 설명 |
|---|---|
| 업무 파편화 | 정책 확인, 세팅 검수, 캡처, 플래닝, 모니터링이 서로 다른 도구와 문서에서 수행됨 |
| 반복 작업 과다 | 사람이 계속 확인하고 복사하고 캡처하고 비교해야 함 |
| 실수 위험 | 예산 단위, 랜딩 URL, 기간, 상태, 타겟 오류가 캠페인 사고로 이어질 수 있음 |
| 지식 축적 부재 | 운영자가 어떤 판단을 했는지 구조화되어 남지 않음 |
| 플래닝 기준 분산 | 과거 성과 데이터와 실제 운영 판단 기준이 연결되지 않음 |
| AI 활용의 단절 | 개별 AI 기능은 있어도 스스로 행동하고 학습하는 Agent 구조가 없음 |

### 2.2 AdMate의 해결 방향

AdMate는 위 문제를 다음 방식으로 해결한다.

```text
사람 중심 수작업
→ AI 기반 업무 보조
→ Agent 기반 업무 연결
→ 운영자 피드백 학습
→ 회사 고유의 광고 운영 지능 축적
```

AdMate는 단순한 챗봇이나 자동화 도구가 아니라, 나스미디어의 광고 운영 업무를 데이터화하고, Agent가 실행 가능한 형태로 바꾸는 **AI Agent 기반 광고 운영 자동화 플랫폼**이다.

---

## 3. AdMate 생태계 정의

AdMate는 광고 운영 생애주기 전체를 대상으로 하는 통합 AI 플랫폼 생태계다.

```text
기획 전 / 기획 단계
→ AdMate Foresight

정책 확인
→ AdMate Compass

캠페인 세팅 / 시작 전 검수
→ AdMate Sentinel - Pre-launch Validation

집행 후 운영 모니터링
→ AdMate Sentinel - Live Monitoring

캡처 / 보고서 증빙
→ AdMate Lens

운영 판단 / 학습 / 자동화
→ AdMate Agent Core
```

AdMate의 목표는 개별 기능을 많이 만드는 것이 아니라, 광고 운영 업무의 전후 맥락을 하나의 Agent loop로 연결하는 것이다.

### 3.1 제품명 정리

| 최종 브랜드명 | 기존/내부명 | 역할 |
|---|---|---|
| AdMate Compass | AdMate Guide | 정책/가이드 RAG, Policy Intelligence Agent |
| AdMate Sentinel | Sentinel beta + Openclaw Sentinel 영역 | 사전 세팅 검수 + 실시간 모니터링/알림 |
| AdMate Lens | AdMate Capture Pro | 광고 캡처/증빙 자동화 |
| AdMate Foresight | AdMate Planner | 미디어 플래닝 예측/시뮬레이션 |
| AdMate Agent Core | Openclaw + Hermes | 지능/자동화/기억/실행/학습 공통 레이어 |

현재 GitHub repo나 내부 개발 명칭은 당장 모두 변경하지 않아도 된다. 우선 외부/발표/홈페이지 브랜드명부터 위 기준으로 정리하고, 코드/레포/문서명은 단계적으로 맞춘다.

---

## 4. 4대 플랫폼 역할 정의

## 4.1 AdMate Compass

### 서비스 정의

AdMate Compass는 복잡한 글로벌 광고 플랫폼 정책 및 가이드를 통합 관리하고, 사용자 질문에 대해 근거 기반 답변을 제공하는 RAG 기반 Policy Intelligence Agent다.

기존 AdMate Guide의 브랜드명을 Compass로 확장한다. Compass는 복잡한 정책과 가이드 속에서 올바른 캠페인 집행 방향을 잡아준다는 의미를 갖는다.

대상 플랫폼:

- Meta
- Google
- Naver
- Kakao
- X

### 핵심 목적

광고 집행 과정에서 발생하는 정책 관련 병목을 줄이고, 공식 가이드 기반 답변으로 마케팅 리스크를 낮춘다.

### 현재 AS-IS

- 멀티 플랫폼 자동 크롤링
- 네비게이션/헤더 제거 기반 핵심 본문 추출
- 키워드 + 의미 검색 기반 하이브리드 RAG
- 광고 전문 용어와 대화형 질문 동시 대응

### TO-BE

- Hybrid Search & Re-ranking
- Multi-LLM Validation
- 답변 생성 모델과 검증 모델 분리
- 할루시네이션 최소화
- 단순 질문은 경량 모델, 복잡 질문은 고성능 모델로 라우팅
- 운영 비용 최적화

### Agent 관점 역할

Compass는 사람이 직접 사용하는 정책 챗봇이면서, 동시에 AdMate Agent Core가 호출하는 **Policy QA Tool**이다.

예시:

```text
@AdMate 이 소재 Meta 정책상 문제 있어?
→ Agent Core가 campaign context 확인
→ Compass가 공식 정책/가이드 검색
→ 근거 기반 답변 생성
```

### 홈페이지/슬라이드 표현

```text
AdMate Compass
정책과 가이드의 방향을 잡다

Meta, Google, Naver, Kakao, X의 광고 정책과 가이드를 기반으로
캠페인 집행 전 필요한 정책 판단을 빠르게 지원합니다.
```

---

## 4.2 AdMate Sentinel

### 서비스 정의

AdMate Sentinel은 캠페인 시작 전 사전 검수와 캠페인 시작 후 운영 모니터링/실시간 이상 감지를 모두 포함하는 캠페인 검수·운영 감지 플랫폼이다.

기존에 별도로 표현하던 Sentinel beta는 Sentinel의 **사전 검수 영역**으로 정리한다. 우리가 Openclaw/Hermes 기반으로 함께 구현한 캠페인 시작 후 모니터링 및 실시간 이상 감지는 Sentinel의 **운영 감지 영역**으로 포함한다.

### Sentinel의 두 영역

```text
AdMate Sentinel - Pre-launch Validation
= 캠페인 시작 전 미디어믹스와 매체 세팅값 비교, 오류 검수, 승인 리포트

AdMate Sentinel - Live Monitoring
= 캠페인 시작 후 운영 상태 모니터링, 실시간 이상 감지, 알림 통제, 운영자 피드백 학습
```

### 핵심 목적

Sentinel은 캠페인의 시작 전과 시작 후를 모두 감시한다.

시작 전에는 인적 오류를 줄이고, 예산/기간/타겟/랜딩/상태/매체 설정 오류로 인한 사고를 예방한다.

시작 후에는 예산 소진, 성과 이상, 캠페인 상태 변화, KPI 변동을 감지하고 운영자가 빠르게 대응할 수 있도록 한다.

### 핵심 기능

사전 검수 영역:

- 미디어믹스 데이터와 매체 API 데이터 비교
- 예산 단위 오류, 랜딩 URL 오류, 타겟/기간/상태 불일치 감지
- Green / Yellow / Red 기반 검수 대시보드
- 자동 승인/검수 리포트 생성
- 검수 시점 timestamp 저장

운영 감지 영역:

- 캠페인 상태 모니터링
- 예산 소진/지연 감지
- CTR/CPC/CPM 등 KPI 이상 감지
- Slack/Email 알림
- 알림 보류/오늘 중지/알림 종료/재개
- 운영자 대응 이력 기록
- Hermes 기반 피드백 학습

### Agent 관점 역할

Sentinel은 사람이 직접 검수하고 모니터링하는 화면이면서, AdMate Agent Core가 자동 호출할 수 있는 **Campaign Validation & Monitoring Tool**이다.

예시:

```text
캠페인 등록
→ Sentinel이 미디어믹스와 매체 세팅값 비교
→ 오류가 없으면 모니터링 시작
→ 운영 중 이상 감지 시 Slack 알림
→ 운영자 판단을 Hermes가 학습
```

### 홈페이지/슬라이드 표현

```text
AdMate Sentinel
캠페인 사고를 사전에 막고 실시간으로 감지하다

캠페인 시작 전에는 세팅 오류를 검수하고,
집행 후에는 예산·성과·상태 이상을 실시간으로 감지합니다.
```

---

## 4.3 AdMate Lens

### 서비스 정의

AdMate Lens는 광고 게재 화면, 상품, 지면, 네이티브 UI, 보고서용 증빙 이미지를 자동으로 생성하는 캡처/렌더링 솔루션이다.

기존 AdMate Capture Pro의 브랜드명을 Lens로 확장한다. Lens는 광고가 실제로 어떻게 보이는지 확인하고 증빙한다는 의미를 갖는다.

### 핵심 목적

미디어플래너가 반복적으로 수행하는 광고 게재 화면 캡처 업무를 자동화하고, 광고주 제출용 고품질 증빙 이미지를 빠르게 생성한다.

### 주요 기능 방향

- YouTube/GDN 등 광고 게재 화면 캡처
- 데스크톱/모바일 광고 UI 렌더링
- 네이티브 광고 UI 합성
- 고해상도 보고서 이미지 생성
- 캠페인/상품/매체별 캡처 자동화

### 주의 사항

Lens의 캡처 결과물 UI는 매체별 실제 화면과의 픽셀 매칭이 중요하다. 따라서 Openclaw 테마를 적용하더라도 캡처 결과물 자체의 광고 미리보기/플랫폼 UI는 임의로 변경하지 않는다.

Openclaw 스타일 이식 대상은 다음으로 제한한다.

- 관리자 화면
- 입력 폼
- 결과 목록
- 캡처 요청 관리 화면
- 설정 화면
- 작업 이력 화면

### Agent 관점 역할

Lens는 사람이 직접 캡처를 생성하는 도구이면서, AdMate Agent Core가 캠페인 상태나 리포트 시점에 자동 호출할 수 있는 **Capture Generation Tool**이다.

예시:

```text
캠페인 등록
→ Agent Core가 매체/상품/지면 정보 확인
→ Lens에 캡처 생성 요청
→ 결과 이미지 저장
→ 리포트 또는 Slack에서 사용
```

### 홈페이지/슬라이드 표현

```text
AdMate Lens
광고 게재 화면과 증빙을 자동으로 만들다

광고 게재 화면과 지면 노출 이미지를 자동 생성해
캡처·증빙·보고 업무에 투입되는 반복 리소스를 줄입니다.
```

---

## 4.4 AdMate Foresight

### 서비스 정의

AdMate Foresight는 과거 광고 데이터와 시장 트렌드를 기반으로 캠페인 기획 단계에서 예산 대비 예상 성과를 예측하고, 업종 및 목적별 최적 전략 수립을 지원하는 Media Planning Intelligence 솔루션이다.

기존 AdMate Planner의 브랜드명을 Foresight로 확장한다. Foresight는 다음 캠페인의 성과를 미리 내다보고 기획 방향을 제안한다는 의미를 갖는다.

### 1차 PoC 범위

Meta(Facebook/Instagram)를 1차 PoC 대상으로 한다.

선정 이유:

- 전사적으로 데이터 누적량이 가장 많음
- 캠페인 목적/지표 구조가 비교적 표준화되어 있음
- 업종·국가·소재 유형별 비교가 용이

### 주요 예측 지표

- CPM
- CPC
- CTR
- VTR
- CPV

### 업종 대분류

- 식음료
- 뷰티
- 패션
- 생활/잡화
- 주류
- 의약/건기식
- 병의원
- 금융
- 앱/사이트
- 서비스
- 방송통신
- 건설
- 부동산
- 주택/가구
- 수송
- 공공기관
- 기관/단체
- 교육
- 엔터테인먼트
- 게임
- 기타

### Agent 관점 역할

Foresight는 사람이 직접 기획 시뮬레이션을 수행하는 도구이면서, Hermes가 운영 성과와 피드백 학습 결과를 반영하여 다음 캠페인 전략을 추천할 때 호출하는 **Planning Intelligence Tool**이다.

예시:

```text
@AdMate 다음 캠페인 예산 3천만원이면 Meta에서 예상 CPC/CTR은?
→ Foresight가 과거 데이터 기반 예상 효율 계산
→ Hermes가 유사 캠페인 운영 피드백 반영
→ Slack에서 기획 가이드 제공
```

### 홈페이지/슬라이드 표현

```text
AdMate Foresight
다음 캠페인의 성과를 미리 예측하다

과거 캠페인 데이터와 시장 트렌드를 기반으로
캠페인 기획 단계에서 예상 성과와 전략 방향을 제안합니다.
```

---

## 5. AdMate Agent Core와 Openclaw/Hermes의 역할

AdMate 생태계의 핵심은 AdMate Agent Core다.

4대 플랫폼이 각각 AI를 활용한 서비스라면, AdMate Agent Core는 이들을 연결하고 실제로 행동하고 학습하는 지능형 Agent Layer다. Openclaw와 Hermes는 이 Agent Core를 구성하는 내부 기술/엔진명이다.

외부 사용자나 임원 보고에서는 Openclaw/Hermes를 각각 독립 제품명으로 강조하기보다, 다음처럼 설명하는 것이 적합하다.

```text
AdMate Agent Core
= AdMate 플랫폼 전반에 지능, 자동화, 기억, 실행, 학습, 감사 기능을 제공하는 공통 Agent Core
```

## 5.1 Hermes = Brain / Memory / Judgment

Hermes의 역할:

- 도메인 지식 축적
- 운영자 피드백 학습
- 캠페인별 판단 기준 저장
- 추천 신뢰도 평가
- 반복 이슈 탐지
- 사용자별 학습 권한 반영
- 운영 기준/예외 사례 관리
- 회사 고유 광고 운영 지식 자산화

Hermes는 단순한 RAG 저장소가 아니라, 광고 운영 판단의 맥락과 이유를 학습하는 메모리 레이어다.

외부 설명에서는 다음처럼 표현한다.

```text
Hermes는 AI와 사용자 이벤트를 학습해 운영 지식과 판단 기준을 축적하는 지능/메모리 엔진입니다.
```

## 5.2 Openclaw = Hands / Feet / Execution

Openclaw의 역할:

- 캠페인 모니터링
- 이상 감지
- 알림 발송
- Slack action 처리
- n8n workflow orchestration
- Compass/Sentinel/Lens/Foresight tool 호출
- operator_actions 기록
- audit_logs 기록
- 관리자 콘솔 제공

Openclaw는 Hermes의 판단과 정책을 실제 운영 workflow로 실행하는 손과 발이다.

외부 설명에서는 다음처럼 표현한다.

```text
Openclaw는 스케줄과 조건에 따라 업무를 실행하고 외부 시스템을 연결하는 자동화 실행 엔진입니다.
```

## 5.3 AdMate Agent Core = Intelligence + Automation

AdMate Agent Core는 Hermes의 지능/기억과 Openclaw의 실행/자동화를 하나로 묶은 공통 레이어다.

```text
Hermes
= 기억과 판단

Openclaw
= 실행과 자동화

AdMate Agent Core
= Hermes + Openclaw 기반 통합 지능/자동화 레이어
```

## 5.4 관계 정의

```text
Hermes가 기억하고 판단한다.
Openclaw가 실행하고 기록한다.
AdMate Agent Core가 이를 하나의 지능형 자동화 레이어로 묶는다.
운영자가 승인하고 피드백한다.
Hermes가 다시 학습한다.
```

---

## 6. 캠페인 생애주기 기반 통합 흐름

AdMate는 캠페인 생애주기 전체를 연결해야 한다.

```text
1. 기획
2. 정책 확인
3. 세팅
4. 사전 검수
5. 집행 시작
6. 운영 모니터링
7. 이상 감지 및 대응
8. 캡처/증빙
9. 성과 평가
10. 학습
11. 다음 기획 반영
```

### 6.1 단계별 플랫폼 배치

| 캠페인 단계 | 담당 플랫폼 | AdMate Agent Core 역할 |
|---|---|---|
| 기획 | Foresight | 과거 성과/학습 피드백 연결 |
| 정책 확인 | Compass | 캠페인 맥락 기반 정책 QA 호출 |
| 세팅 | 매체 플랫폼 / 미디어믹스 | 캠페인 identity 생성 |
| 사전 검수 | Sentinel - Pre-launch Validation | 자동 검수 실행 및 결과 기록 |
| 집행 시작 | Sentinel - Live Monitoring | 모니터링 시작 |
| 운영 중 | Sentinel + Agent Core | 이상 감지, 알림, Slack action |
| 대응 | Hermes | 운영자 판단 학습 |
| 캡처 | Lens | 필요한 캡처 자동 요청 |
| 다음 기획 | Foresight + Hermes | 실제 성과와 피드백 반영 |

### 6.2 최종 사용 흐름 예시

```text
캠페인 등록
→ Sentinel이 사전 세팅 검수
→ 검수 통과 시 Sentinel Live Monitoring 시작
→ 운영 중 이상 감지 시 Slack 알림
→ 운영자가 확인/보류/종료/피드백
→ Hermes가 판단 기준 학습
→ Lens가 관련 광고 캡처 생성
→ Compass가 정책 질문 대응
→ Foresight가 다음 제안에 학습 결과 반영
```

---

## 7. Agent Operating Layer

AdMate의 Agent Operating Layer는 AdMate Agent Core를 중심으로 여러 전문 Agent와 Tool을 연결하는 구조다.

### 7.1 주요 Agent 후보

| Agent | 역할 |
|---|---|
| Campaign Monitor Agent | 운영 중 캠페인 상태 감지 |
| Setup Validation Agent | 시작 전 세팅값 검수 |
| Policy QA Agent | 정책/가이드 근거 검색 및 답변 |
| Capture Generation Agent | 광고 캡처 및 증빙 생성 |
| Planner Simulation Agent | 예산/성과 시뮬레이션 |
| Operator Feedback Agent | 운영자 피드백 수집 및 정리 |
| Audit & Compliance Agent | 권한, 감사, 보안 로그 점검 |
| Cost Control Agent | LLM/API 비용 감시 |
| Intelligence Research Agent | 최신 기술/시장 변화 조사 |

### 7.2 Tool/API 전환 방향

각 플랫폼은 사람이 쓰는 UI 외에 AdMate Agent Core가 호출할 수 있는 Tool API를 가져야 한다.

예시:

```text
POST /tools/compass/query
POST /tools/sentinel/validate-setup
POST /tools/sentinel/monitor/start
POST /tools/lens/generate-capture
POST /tools/foresight/simulate
POST /tools/hermes/feedback/apply
```

중요 원칙:

- 사람용 UI와 Agent용 API를 분리한다.
- 모든 Agent action은 operator_actions 또는 audit_logs에 기록한다.
- 자동 실행 범위는 권한/승인 정책에 따라 제한한다.
- 위험 액션은 사람 승인 후 실행한다.

---

## 8. 공통 데이터 모델

AdMate 생태계가 하나로 연결되기 위해서는 공통 campaign identity가 필요하다.

### 8.1 핵심 객체

```text
advertiser
brand
campaign
platform_account
media_mix
setup_snapshot
policy_context
capture_asset
monitoring_event
operator_action
recommendation
planner_prediction
actual_performance
learning_feedback
```

### 8.2 Campaign Intelligence Object

하나의 캠페인을 중심으로 다음 정보가 연결되어야 한다.

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
```

이 구조가 있어야 다음 질문에 답할 수 있다.

```text
이 캠페인은 시작 전 세팅에는 문제가 없었는가?
운영 중 어떤 이상이 발생했는가?
운영자는 왜 이상이 아니라고 판단했는가?
관련 정책 이슈는 없었는가?
실제 광고 게재 화면은 어땠는가?
예측 성과와 실제 성과는 얼마나 차이 났는가?
다음 캠페인에서는 기준을 어떻게 조정해야 하는가?
```

---

## 9. Hermes Memory & Learning Loop

Hermes의 핵심 차별점은 운영자의 실제 판단을 학습하는 것이다.

### 9.1 학습 대상

- 이상 감지에 대한 운영자 판단
- false positive / true positive 여부
- 특정 업종/목표/매체에서 허용 가능한 KPI 변동 범위
- 세팅 오류 빈도
- 반복 정책 질문
- 캡처 요청 패턴
- Foresight 예측과 실제 성과 차이

### 9.2 학습 권한

모든 사용자 행동을 Hermes 학습 신호로 사용하면 안 된다.

권한 구조:

| 역할 | 학습 반영 여부 |
|---|---|
| Super Admin | 가능 |
| Admin | 제한적 가능 |
| Reviewer | 승인된 범위 내 가능 |
| User | 기본적으로 학습 미반영 |

### 9.3 학습 루프

```text
이상 감지 발생
→ 운영자 판단
→ operator_actions 기록
→ Hermes가 피드백 분석
→ 유사 캠페인 기준 업데이트 후보 생성
→ 관리자 검토
→ 기준 반영
→ 이후 추천/알림 품질 개선
```

---

## 10. Slack 중심 업무 UX

AdMate의 핵심 사용자 접점은 웹 콘솔과 Slack이다.

미디어플래너 입장에서는 Slack에서 자연어로 질문하고 결과를 받는 흐름이 중요하다.

예시:

```text
@AdMate 이 캠페인 상태 요약해줘
@AdMate 이 캠페인 왜 CPC가 높아졌어?
@AdMate 이 소재 Meta 정책 문제 있어?
@AdMate 이 캠페인 캡처 만들어줘
@AdMate 다음주 예산 30% 늘리면 예상 CPC 어떻게 돼?
@AdMate 이 캠페인 미디어믹스와 실제 세팅값 비교해줘
```

Slack UX 원칙:

- 답변은 짧고 명확하게
- 근거는 접거나 링크로 제공
- 위험 액션은 버튼으로 승인
- 모든 버튼 액션은 기록
- 권한 없는 사용자는 민감 액션 차단

---

## 11. LLM Cost Control Center

AdMate가 확장될수록 LLM/API 비용 통제가 중요해진다.

### 11.1 목적

각 유료 LLM, 벤더, 모델, 기능별 실시간 비용 현황을 관리자 화면에서 확인하고 통제한다.

### 11.2 주요 지표

- 오늘 비용
- 이번 주 비용
- 이번 달 비용
- 플랫폼별 비용
- 모델별 비용
- 사용자별 비용
- 기능별 비용
- 요청 수
- 토큰 사용량
- 평균 요청 비용
- 실패 요청 비용
- 캐시 절감액
- 예산 대비 사용률
- 비용 급증 알림

### 11.3 플랫폼별 비용 구분

```text
Compass: 정책/RAG 답변 비용
Sentinel: 검수/진단/운영 감지 비용
Lens: 이미지/비전/캡처 관련 비용
Foresight: 예측/분석/시뮬레이션 비용
Agent Core: 모니터링, 판단, 학습, Slack Agent 비용
```

### 11.4 기대 효과

- AI 비용 투명화
- 과금 폭증 방지
- 모델 라우팅 최적화
- 임원 보고용 ROI 근거 확보
- 비용 대비 업무 절감 효과 산출

---

## 12. Weekly Intelligence Upgrade Loop

### 12.1 정의

Weekly Intelligence Upgrade Loop는 매주 빠르게 변하는 AI/MarTech/광고 플랫폼/개발 도구 정보를 조사하고, AdMate에 적용 가능한 업그레이드 후보를 선정하여 구현 backlog로 전환하는 루틴이다.

### 12.2 조사 대상

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

### 12.3 루틴

```text
매주 Deep Search 실행
→ 최신 기술/가격/API 변경 수집
→ Hermes가 요약 및 영향 평가
→ 적용 가능성/비용 절감/성능 개선/리스크 평가
→ 이번 주 적용 / 백로그 / 보류 / 폐기 분류
→ Codex/Openclaw 작업으로 전환
→ 결과 기록
```

### 12.4 기대 효과

- 플랫폼의 지속적 진화
- 빠른 기술 변화 대응
- 비용 절감 기회 포착
- 경쟁사 대비 기술 민첩성 확보
- 데이터분석팀의 기술 리더십 강화

---

## 13. 권한/보안/ISMS 감사 구조

AdMate는 광고 운영 데이터, 캠페인 성과 데이터, 사용자 행동, 운영자 피드백, LLM 요청 로그를 다룬다.

따라서 초기 설계부터 ISMS와 보안 감사 가능성을 고려해야 한다.

### 13.1 원칙

- raw campaign-level 데이터는 LLM에 직접 전달하지 않는다.
- 필요 시 익명화/집계/요약 후 전달한다.
- 민감 데이터 접근은 권한 기반으로 제한한다.
- 모든 Agent action은 audit log에 남긴다.
- 학습 반영 가능한 사용자를 제한한다.
- 외부 API key/token은 환경변수 또는 credential store에서만 관리한다.
- 브라우저에는 service role key나 ingest key를 노출하지 않는다.

### 13.2 기록 대상

- 사용자 로그인
- 권한 변경
- 캠페인 등록/수정
- 알림 발송
- Slack 버튼 액션
- 추천 적용/거절
- Hermes 학습 반영
- LLM 요청/응답 메타데이터
- 비용 이벤트
- Agent 실행 이력

---

## 14. 단계별 로드맵

### Phase 1. 통합 브랜딩 및 운영 콘솔 정렬

- 각 플랫폼 UI/UX 톤 정리
- Openclaw 스타일 기반 공통 디자인 기준 적용
- Compass / Sentinel / Lens / Foresight / Agent Core 명칭 정리
- 플랫폼 역할 정의
- 기본 문서 체계화

### Phase 2. AdMate Agent Core 운영 레이어 안정화

- 캠페인 모니터링
- 알림 통제
- Slack action
- 사용자 권한
- Hermes feedback loop
- Applied Quality / learning authority

### Phase 3. 플랫폼 Tool/API 전환

- Compass Tool API
- Sentinel Validation & Monitoring API
- Lens Capture Generation API
- Foresight Simulation API
- AdMate Agent Core Orchestrator 연결

### Phase 4. 통합 Slack Agent UX

- 캠페인 기반 질문
- 정책 QA
- 캡처 생성 요청
- 운영 상태 요약
- Foresight 시뮬레이션
- 승인 기반 action 실행

### Phase 5. LLM Cost Center / Weekly Intelligence Loop

- 비용 수집
- 모델별/플랫폼별 비용 대시보드
- 주간 기술 리서치 루틴
- 적용 후보 backlog화

### Phase 6. 고도화 및 사업 확장

- 내부 운영 지식 기반 신규 솔루션 발굴
- 유료 외부 플랫폼 대체 가능성 검토
- 광고주 대상 고급 서비스화 검토
- Paperclip/CEO/CMO/Builder Agent 기반 기획·개발 루프

---

## 15. Future Expansion: Business Opportunity Discovery & Build Loop

이 기능은 당장 구현 범위는 아니지만, AdMate의 장기 확장 전략으로 반드시 품고 가야 한다.

### 15.1 정의

Hermes가 나스미디어의 광고 운영 도메인 지식, 미디어플래너 업무 흐름, 반복 이슈, 외부 시장/경쟁사 정보, 유료 솔루션 사용 현황을 학습한 뒤, 회사에 필요한 신규 솔루션 후보를 발굴하고 사업성을 평가하는 전략 루프다.

### 15.2 사업성의 의미

여기서 사업성은 단순 매출만 의미하지 않는다.

```text
1. 직접 수익화 가능성
2. 광고주에게 더 양질의 서비스를 제공할 가능성
3. 현재 유료로 사용하는 외부 플랫폼을 대체할 가능성
4. 내부 업무 시간을 절감할 가능성
5. 회사 고유 데이터 자산을 활용한 차별화 가능성
```

### 15.3 루프 구조

```text
Hermes 도메인 지식 축적
→ 내부 pain point mining
→ 외부 경쟁사/솔루션 조사
→ 회사에 필요한 솔루션 후보 발굴
→ 사업성 평가
→ 사람 승인
→ 기획안 생성
→ Codex/Paperclip Builder Agent 작업화
→ PoC 구축
→ 결과 평가
→ 정식 제품화 여부 결정
```

### 15.4 표현 원칙

이 루프는 “AI가 알아서 회사를 운영한다”가 아니다.

정확한 표현은 다음과 같다.

```text
AI가 시장·경쟁사·내부 업무 데이터를 분석해 솔루션 기회를 제안하고,
사람의 승인 하에 PoC 기획과 개발 작업으로 전환한다.
```

---

## 16. 임원 보고용 핵심 메시지

임원 대상 메시지는 기능 설명보다 회사 경쟁력과 조직 변화에 초점을 맞춘다.

### 핵심 메시지

```text
데이터분석팀은 단순 분석 지원 조직을 넘어,
광고 운영 업무를 자동화하고 회사 고유의 운영 지식을 축적하는
AI Agent 기반 광고 운영 자동화 플랫폼을 구축하고 있습니다.
```

### 권장 설명 흐름

```text
1. AdMate란 무엇인가
2. 어떤 플랫폼이 있는가
3. 각 플랫폼은 무엇을 하는가
4. 현재 구현 상태는 어느 정도인가
5. 각 플랫폼은 어떻게 연결되는가
6. AdMate Agent Core가 어떤 세계관을 만드는가
7. 회사에 어떤 경쟁력을 제공하는가
8. LLM Cost Center / Weekly Intelligence Loop
9. 장기 비전
```

### 강조 포인트

- 반복 업무 자동화
- 운영 사고 예방
- 업무 효율 향상
- 정책/세팅/캡처/플래닝/모니터링 연결
- 회사 고유 데이터 자산화
- AI 비용 통제
- ISMS 대응 가능한 감사 구조
- 향후 대외 서비스화 가능성

### 임원용 한 문장 정의

```text
AdMate는 나스미디어의 광고 운영 지식을 AI Agent가 실행 가능한 형태로 바꾸는 광고 운영 자동화 플랫폼입니다.
```

### 마지막 장에 포함할 내용

LLM Cost Center와 Weekly Intelligence Loop는 임원 보고의 마지막 부분에서 한 장 분량으로 다룬다.

```text
AI를 도입하는 것에서 끝나는 것이 아니라,
비용을 통제하고 최신 기술을 지속적으로 반영하는 운영 체계까지 함께 설계하고 있습니다.
```

Business Opportunity Discovery Loop는 장기 비전으로 간략히 언급한다.

---

## 17. 미디어플래너 대상 핵심 메시지

미디어플래너 대상 메시지는 회사 경쟁력보다 실제 업무 편의성에 초점을 맞춘다.

### 핵심 메시지

```text
AdMate는 미디어플래너를 대체하는 도구가 아니라,
반복 확인·검수·캡처·정책 검색·이상 감지를 대신 처리해
플래너가 전략과 판단에 집중하게 만드는 AI 업무 파트너입니다.
```

### 권장 설명 흐름

```text
1. 캠페인 기획 단계
   Foresight로 업종/목표별 예상 효율 확인

2. 정책 확인 단계
   Compass로 Meta/Google/Naver/Kakao/X 정책 확인

3. 세팅 전후 검수 단계
   Sentinel로 미디어믹스와 실제 매체 세팅 비교

4. 집행 중 운영 단계
   Sentinel Live Monitoring으로 예산/KPI/상태 이상 감지

5. 캡처/보고 단계
   Lens로 광고 게재 화면 자동 캡처

6. 다음 캠페인 준비
   실제 운영 결과와 Hermes 학습 데이터를 Foresight에 반영
```

### 강조 포인트

- 정책 확인 시간 단축
- 세팅 오류 사전 차단
- 광고 캡처 자동 생성
- 운영 중 이상 자동 감지
- Slack에서 바로 질문/확인
- 내 판단이 다음 알림 기준에 반영
- 반복 업무보다 전략 판단에 집중

### 미디어플래너용 한 문장 정의

```text
AdMate는 기획부터 운영까지 미디어플래너의 반복 업무를 줄여주는 AI 업무 파트너입니다.
```

---

## 18. 홈페이지/브랜드 메시지 초안

AdMate 홈페이지는 단순 서비스 소개 페이지가 아니라, AdMate 생태계를 소개하는 브랜드/제품군 페이지가 되어야 한다.

### Hero 메시지 후보

```text
AdMate
AI Agent 기반 광고 운영 자동화 플랫폼

기획부터 운영, 검수, 캡처, 학습까지
광고 운영의 전 과정을 AI Agent가 연결합니다.
```

### 보조 카피 후보

```text
광고 운영의 반복 업무는 줄이고,
캠페인 판단과 실행은 더 정확하게.
AdMate는 AI Agent가 광고 운영 전 과정을 연결하는 자동화 플랫폼입니다.
```

### 영문/한글 혼합 카피 후보

```text
Plan. Validate. Monitor. Capture. Learn.
광고 운영의 전 과정을 AI Agent로 연결합니다.
```

### 홈페이지 구성 추천

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

---

## 19. 다음 문서로 파생될 항목

이 문서는 전체 기준 문서다.

다음 문서는 이 문서에서 파생된다.

1. AdMate Executive Brief v1
2. AdMate Media Planner Brief v1
3. AdMate Product Map v1
4. AdMate Agent Core Operating Model v1
5. AdMate AI Operations Manual v1
6. AdMate Unified Data & Learning Governance v1
7. AdMate Future Strategy Loop v1
8. AdMate External LLM Handoff Master Document v1

---

## 20. 검토해야 할 질문

다음 단계에서 함께 검토할 질문은 다음과 같다.

1. Compass / Sentinel / Lens / Foresight 명칭을 공식 브랜드명으로 확정할 것인가?
2. 기존 repo/코드/내부 문서명은 언제부터 새 명칭으로 점진 변경할 것인가?
3. 홈페이지에서는 Agent Core를 어느 깊이까지 설명할 것인가?
4. 임원 보고에서는 각 플랫폼의 구현 수준을 어떤 기준으로 표현할 것인가?
5. 미디어플래너 대상 발표에서는 어떤 실제 업무 시나리오를 가장 앞에 둘 것인가?
6. LLM Cost Center와 Weekly Intelligence Loop는 임원 보고에 어느 정도 포함할 것인가?
7. Business Opportunity Discovery Loop는 장기 비전으로만 언급할 것인가?

---

## 21. 현재 문서의 위치

이 문서는 AdMate 생태계 전체의 기준 문서다.

다른 문서나 슬라이드는 이 문서를 기반으로 청중과 목적에 맞게 재구성한다.

```text
전체 기준 문서
→ 임원 보고용 문서
→ 미디어플래너용 문서
→ 제품별 기획서
→ Agent 운영 문서
→ 데이터/보안/학습 문서
→ 장기 전략 문서
→ 외부 LLM 인수인계 문서
```
