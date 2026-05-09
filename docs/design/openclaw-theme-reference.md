# Openclaw Theme Reference v1

작성일: 2026-04-30
목적: AdMate 계열 프로젝트의 UI/UX를 Openclaw Monitor / Sentinel 운영 콘솔 테마와 맞추기 위한 디자인 기준 문서

## 1. 핵심 원칙

Openclaw 테마는 화려한 마케팅 사이트가 아니라 실무형 운영 콘솔이다.

- 기능 변경 금지
- API / 데이터 구조 변경 금지
- 라우팅 변경 금지
- 이벤트 핸들러 변경 최소화
- 기존 기능 제거 금지
- 관리자/운영자 화면의 레이아웃, 색상, 카드, 버튼, 폼, 배지, 테이블 위주로 정리

## 2. Openclaw 색상 토큰

- app background: #F7F7F7
- surface/card: #FFFFFF
- hover: #F4F4F4
- active: #ECECEC
- border: #E5E5E5
- primary text: #0D0D0D
- secondary text: #5E5E5E
- muted text: #9A9A9A
- purple: #5E6AD2
- purple light: #ECEDF9
- red: #D93025 / #FEF2F1 / #FAD3D1
- green: #177D4E / #EFFAF4 / #9FE5C1
- amber: #9E5700 / #FFF8EC / #F5CE8B

## 3. 폰트

기본 폰트는 Inter, -apple-system, BlinkMacSystemFont, sans-serif를 사용한다.

권장 크기:
- Topbar title: 13px
- Sidebar label: 12~13px
- Section label: 11px
- Body text: 13~14px
- Helper text: 11~12px
- Summary number: 22~28px

## 4. 레이아웃

- 좌측 고정 Sidebar: 220px
- 상단 Topbar: 44px
- 본문 배경: #F7F7F7
- 본문 content max-width: 1100~1280px
- 페이지 구조: Topbar → 요약 카드 → 주요 리스트/테이블 → 상세 Drawer 또는 collapsible

## 5. Sidebar

- width: 220px
- background: #FFFFFF
- border-right: 1px solid #E5E5E5
- 메뉴명은 짧게
- 현재 페이지 active 표시
- 내부 개발 용어 대신 한국어 운영 문구 사용

## 6. Topbar

- height: 44px
- background: rgba(247,247,247,0.9)
- border-bottom: 1px solid #E5E5E5
- position: sticky
- 구성: 페이지 제목, 상태/시간, 액션 버튼

## 7. Card

- background: #FFFFFF
- border: 1px solid #E5E5E5
- border-radius: 8px ~ 12px
- padding: 14px ~ 20px
- 그림자보다 border 중심
- 상태 강조는 badge로 처리

## 8. Button

- 기본: inline-flex, align-items center, gap 6px
- padding: 6px 12px
- border-radius: 4px ~ 6px
- font-size: 12px
- primary: #0D0D0D background / white text
- secondary: white background / #5E5E5E text / #E5E5E5 border
- 버튼 문구는 짧은 한국어 동사형 사용

## 9. Badge

- Alert: #FEF2F1 / #D93025 / #FAD3D1
- Normal: #EFFAF4 / #177D4E / #9FE5C1
- Warning: #FFF8EC / #9E5700 / #F5CE8B
- Info: #ECEDF9 / #5E6AD2 / #CBD0EF

## 10. Form

- input background: #FFFFFF
- border: 1px solid #E5E5E5
- focus border: #5E6AD2
- focus ring: #ECEDF9
- 구조: Label → Input/Select → Helper text → Error text

## 11. Table / List

- background: #FFFFFF
- border: 1px solid #E5E5E5
- border-radius: 8px
- header background: #F7F7F7
- row hover: #F4F4F4
- 상태는 badge로 표시
- raw JSON/debug는 기본 노출 금지

## 12. Codex 작업 지시 원칙

이 문서를 기준으로 Openclaw 테마를 적용한다.
기능/비즈니스 로직/API/데이터 구조/라우팅은 변경하지 않는다.
디자인 토큰, 레이아웃, 카드, 버튼, 폼, 배지, 테이블 스타일만 정리한다.
먼저 분석과 수정 계획을 보고한 뒤, 승인 후 코드 수정한다.

## 13. 검증 기준

- npm run build
- 주요 페이지 렌더링
- 기존 버튼 동작
- 기존 폼 저장 동작
- 기존 API 호출
- 기존 라우팅
- 모바일/데스크톱 깨짐 여부
