# Vercel 로그 확인 가이드

## Vercel 로그 위치

### 1. Vercel 대시보드 접속
1. [Vercel Dashboard](https://vercel.com/dashboard) 접속
2. 프로젝트 선택
3. 상단 메뉴에서 **"Logs"** 탭 클릭

### 2. 로그 필터링
- **Function**: `/api/jobs/consume` 선택
- **Time Range**: 최근 10분 또는 1시간 선택
- **Search**: 키워드로 검색

## 확인해야 할 로그 키워드

### 1. 큐 워커 실행 여부
```
🚀 큐 처리 시작
🔍 큐에서 작업 조회 중...
📋 작업 조회 완료
✅ 작업 선택됨
```

### 2. Storage 다운로드
```
📥 Storage 다운로드 시작
✅ Storage 다운로드 완료: XXMB (XXms)
❌ Storage 다운로드 실패
```

### 3. DOCX 파싱
```
📄 DOCX 파싱 시작: XXMB
✅ DOCX 파싱 완료: XXKB (XXms)
❌ DOCX 파싱 실패
```

### 4. 텍스트 추출 검증
```
📊 텍스트 추출 검증: { rawLength, cleanedLength, textPreview }
```

### 5. 청킹
```
📄 문서 청킹 시작...
✅ 문서 청킹 완료: { chunkCount, time, avgChunkSize }
```

### 6. 임베딩 생성
```
🔮 임베딩 생성 시작...
✅ 임베딩 생성 완료: { chunkCount, time, avgTimePerChunk }
```

### 7. 저장
```
💾 문서 저장 시작
✅ 문서 데이터베이스 저장 완료: { time }
💾 작은 파일 청크 저장 시작
✅ 청크 저장 완료: { chunkCount, time, avgTimePerChunk }
```

### 8. 에러
```
❌ 큐 처리 시간 초과
❌ DOCX 파싱 실패
❌ 청크 저장 오류
```

## 로그 확인 체크리스트

### 큐 워커가 실행되고 있는지 확인
- [ ] `🚀 큐 처리 시작` 로그가 최근 1분 내에 있는지
- [ ] `✅ 작업 선택됨` 로그가 있는지
- [ ] `DOCX_PARSE` 작업이 선택되었는지

### 어느 단계에서 느린지 확인
- [ ] Storage 다운로드 시간: `✅ Storage 다운로드 완료`의 ms 값
- [ ] DOCX 파싱 시간: `✅ DOCX 파싱 완료`의 ms 값
- [ ] 청킹 시간: `✅ 문서 청킹 완료`의 time 값
- [ ] 임베딩 시간: `✅ 임베딩 생성 완료`의 time 값
- [ ] 저장 시간: `✅ 청크 저장 완료`의 time 값

### 에러 확인
- [ ] 타임아웃 에러가 있는지
- [ ] 파싱 에러가 있는지
- [ ] 저장 에러가 있는지

## 예상 로그 예시

### 정상 처리 (작은 파일)
```
🚀 큐 처리 시작: 2025-01-XX...
📋 작업 조회 완료: 50ms
✅ 작업 선택됨: { jobType: 'DOCX_PARSE', documentId: '...' }
📥 Storage 다운로드 시작: documents/...
✅ Storage 다운로드 완료: 0.5MB (200ms)
📄 DOCX 파싱 시작: 0.5MB
✅ DOCX 파싱 완료: 50KB (300ms)
📊 텍스트 추출 검증: { rawLength: 50000, cleanedLength: 49000 }
📄 문서 청킹 시작...
✅ 문서 청킹 완료: { chunkCount: 10, time: '500ms' }
🔮 임베딩 생성 시작...
✅ 임베딩 생성 완료: { chunkCount: 10, time: '1000ms', avgTimePerChunk: '100ms' }
💾 작은 파일 청크 저장 시작: 10개 청크
✅ 청크 저장 완료: 10개 청크 (800ms)
```

### 느린 처리 (문제 발생)
```
🚀 큐 처리 시작: 2025-01-XX...
📥 Storage 다운로드 시작: documents/...
✅ Storage 다운로드 완료: 0.5MB (5000ms)  ← 여기서 느림!
📄 DOCX 파싱 시작: 0.5MB
✅ DOCX 파싱 완료: 50KB (300ms)
...
```

## 문제 진단

### 로그가 전혀 없는 경우
- Vercel Cron Job이 실행되지 않고 있음
- 수동으로 "1건 처리" 버튼 클릭 필요

### Storage 다운로드가 느린 경우
- Supabase Storage 연결 문제
- 네트워크 지연
- 파일 크기 문제

### DOCX 파싱이 느린 경우
- mammoth 라이브러리 문제
- 파일 손상
- 메모리 부족

### 임베딩 생성이 느린 경우
- `generateSimpleEmbedding` 함수 문제
- 청크 개수가 예상보다 많음

### 저장이 느린 경우
- 데이터베이스 연결 문제
- 배치 처리 로직 문제
- 인덱스 문제

