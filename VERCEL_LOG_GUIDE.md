# Vercel에서 processQueue 로그 확인 가이드

## 방법 1: Vercel 대시보드에서 확인 (가장 쉬움)

### 단계:
1. **Vercel 대시보드 접속**
   - https://vercel.com/dashboard 접속
   - 프로젝트 선택

2. **Deployments 탭**
   - 상단 메뉴에서 "Deployments" 클릭
   - 최근 배포 선택

3. **Functions 탭**
   - 배포 상세 페이지에서 "Functions" 탭 클릭
   - `/api/jobs/consume` 함수 찾기

4. **Logs 탭**
   - 함수 상세 페이지에서 "Logs" 탭 클릭
   - 또는 배포 상세 페이지에서 직접 "Logs" 탭 클릭

5. **필터링**
   - 검색창에 `processQueue` 또는 `CRITICAL` 입력
   - 또는 `[CRITICAL]` 검색

### 로그 확인 포인트:
- `🚀 processQueue 함수 진입` - 함수 시작
- `✅ Supabase 클라이언트 생성 완료` - Supabase 연결 성공
- `🔍 타임아웃된 작업 감지 시작...` - 타임아웃 체크 시작
- `🔍 started_at 기준 타임아웃 작업 조회 중...` - 타임아웃 작업 조회
- `🚀 큐 처리 시작` - 실제 큐 처리 시작
- `❌ 큐 처리 실패` - 에러 발생 시

## 방법 2: Vercel CLI 사용 (터미널)

### 설치 및 로그인:
```bash
# Vercel CLI 설치 (이미 설치되어 있으면 생략)
npm i -g vercel

# 로그인
vercel login

# 프로젝트 연결
vercel link
```

### 로그 확인:
```bash
# 실시간 로그 확인
vercel logs --follow

# 특정 함수의 로그만 확인
vercel logs --follow --function /api/jobs/consume

# 최근 100줄 로그 확인
vercel logs --limit 100

# 특정 키워드 필터링
vercel logs --follow | grep "processQueue"
vercel logs --follow | grep "CRITICAL"
```

## 방법 3: Vercel 대시보드 - 실시간 로그

### 단계:
1. **프로젝트 대시보드**
   - 프로젝트 선택
   - 좌측 메뉴에서 "Logs" 클릭

2. **실시간 로그 스트림**
   - 실시간으로 로그 확인 가능
   - 필터: `Function: /api/jobs/consume`
   - 또는 검색: `processQueue` 또는 `CRITICAL`

## 방법 4: 특정 작업 ID로 검색

### 작업 ID로 로그 찾기:
```
작업 ID: eeec3b56-cd8a-4779-b357-0c7089ac97db
```

Vercel 로그에서 검색:
- `eeec3b56-cd8a-4779-b357-0c7089ac97db`
- 또는 `큐 워커 트리거 시작`

## 현재 로그 분석

### 로그가 중단된 위치:
```
2025-12-07 15:32:29.461 [error] [CRITICAL] 🔍 started_at 기준 타임아웃 작업 조회 중...
```

### 가능한 원인:
1. **타임아웃 작업 조회 쿼리가 타임아웃됨**
   - 3초 타임아웃 설정되어 있음
   - 쿼리가 3초 이상 걸리면 타임아웃 발생

2. **Supabase 쿼리 성능 문제**
   - `processing_jobs` 테이블이 커서 쿼리가 느림
   - 인덱스 부족 가능성

3. **Vercel 함수 타임아웃**
   - 함수 실행 시간이 너무 길어서 중단됨

## 로그 확인 체크리스트

### 확인해야 할 로그:
- [ ] `🚀 processQueue 함수 진입` - 함수 시작 확인
- [ ] `✅ Supabase 클라이언트 생성 완료` - Supabase 연결 확인
- [ ] `🔍 타임아웃된 작업 감지 시작...` - 타임아웃 체크 시작
- [ ] `✅ started_at 기준 조회 완료` 또는 `⚠️ started_at 기준 조회 타임아웃` - 타임아웃 작업 조회 결과
- [ ] `✅ created_at 기준 조회 완료` - created_at 기준 조회 결과
- [ ] `🚀 큐 처리 시작` - 실제 큐 처리 시작
- [ ] `🔍 큐에서 작업 조회 중...` - 작업 조회
- [ ] `📋 작업 조회 완료` - 작업 조회 결과
- [ ] `✅ 작업 선택됨` - 작업 선택
- [ ] `❌ 큐 처리 실패` - 에러 발생 시

### 에러 로그 확인:
- `❌` 또는 `ERROR` 레벨 로그 확인
- `타임아웃` 키워드 검색
- `실패` 또는 `failed` 키워드 검색

## 문제 해결 팁

### 로그가 보이지 않는 경우:
1. **시간 범위 확인**
   - 로그는 최근 24시간만 표시됨
   - 더 오래된 로그는 Vercel Pro 플랜 필요

2. **필터 확인**
   - 필터가 너무 제한적일 수 있음
   - 필터 제거 후 전체 로그 확인

3. **배포 확인**
   - 최신 배포의 로그인지 확인
   - 이전 배포의 로그일 수 있음

### 로그가 중단된 경우:
1. **타임아웃 확인**
   - 함수 실행 시간이 `maxDuration` 초과했는지 확인
   - 현재 설정: 300초 (5분)

2. **메모리 부족**
   - 함수 메모리 사용량 확인
   - Vercel Pro 플랜: 최대 3008MB

3. **에러 발생**
   - try-catch 블록에서 에러가 발생했지만 로그가 출력되지 않았을 수 있음
   - 최상위 catch 블록 로그 확인

## 빠른 확인 명령어

```bash
# 최근 50줄 로그 확인
vercel logs --limit 50 | grep -E "(processQueue|CRITICAL|ERROR)"

# 특정 작업 ID로 검색
vercel logs --limit 200 | grep "eeec3b56-cd8a-4779-b357-0c7089ac97db"

# 에러만 확인
vercel logs --limit 100 | grep -E "(ERROR|❌|실패)"
```



