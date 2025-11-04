# 큐 처리 문제 원인 분석

## 문제 1: 처리 큐 요약 패널이 상태를 제대로 표시하지 않음

### 원인
1. **자동 새로고침 없음**: `QueueMiniPanel`의 `useQuery`에 `refetchInterval`이 없어서 자동으로 상태를 갱신하지 않음
2. **refetch 함수 누락**: 버튼 클릭 시 `refetch()`를 호출하지만, `useQuery`에서 `refetch`를 구조 분해하지 않음
3. **vendor 필터링 작동 안 함**: `processing_jobs` 테이블에 `vendor` 컬럼이 없고, `payload` JSONB에만 있음

### 해결 방법
- `refetchInterval` 추가 (5초마다 자동 갱신)
- `useQuery`에서 `refetch` 함수 구조 분해
- `retrying` 상태도 카운트에 포함

---

## 문제 2: 큐 처리 시간 초과

### 원인
1. **큐 워커 미실행**: Vercel Cron이 실행되지 않거나, 큐 워커가 작동하지 않으면 작업이 영원히 `queued` 상태로 남음
2. **폴링 타임아웃**: 클라이언트에서 5분(60회 × 5초) 후 타임아웃하지만, 큐 작업 자체는 실패 상태로 업데이트되지 않음
3. **Stuck 상태**: 큐 워커가 실행되지 않으면 `queued` → `processing` 전환이 안 되어 작업이 멈춤

### 해결 방법
1. **타임아웃 시 큐 상태 업데이트**: 클라이언트에서 타임아웃 발생 시 해당 작업을 `failed` 상태로 업데이트하는 API 호출
2. **큐 워커 실행 확인**: Vercel Cron이 실제로 실행되는지 확인
3. **장기간 stuck 작업 감지**: `queued` 상태로 10분 이상 머무는 작업은 자동으로 `failed` 처리

---

## 해결 방안

### 즉시 수정
1. ✅ `QueueMiniPanel`에 `refetchInterval` 추가
2. ✅ `refetch` 함수 구조 분해
3. ✅ 타임아웃 시 큐 상태를 `failed`로 업데이트하는 로직 추가

### 장기 개선
1. 큐 워커 모니터링 대시보드
2. Stuck 작업 자동 감지 및 재시도
3. 큐 처리 성능 메트릭 수집

