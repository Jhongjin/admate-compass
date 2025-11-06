# DOCX 타임아웃 근본 원인 분석

## 문제 상황
작은 DOCX 파일도 10분 타임아웃 에러 발생

## 근본 원인

### 1. 잘못된 큰 파일 판단 기준
```typescript
// 현재 코드 (문제)
const LARGE_TEXT_THRESHOLD = 500 * 1024; // 500KB
const isLargeFile = fileSize > LARGE_FILE_THRESHOLD || normalizedText.length > LARGE_TEXT_THRESHOLD;
const isLargeDocument = docData.content.length > 500 * 1024 || fileSize > 10 * 1024 * 1024;
```

**문제점**:
- 파일 크기가 작아도 텍스트가 500KB를 넘으면 "큰 파일"로 분류
- 작은 DOCX 파일도 텍스트가 많으면 분할 처리 로직이 실행됨
- `isLargeDocument` 조건도 500KB 텍스트 기준으로 적용되어 10분 타임아웃 적용

### 2. DOCX 파일의 특성
- DOCX 파일은 압축된 XML 형식
- 작은 파일 크기(예: 100KB)에도 텍스트가 500KB를 초과할 수 있음
- 서식 정보, 이미지 메타데이터 등이 포함되어 텍스트 양이 파일 크기보다 클 수 있음

### 3. 타임아웃 설정 문제
```typescript
// 현재 코드
const MAX_PROCESS_TIME = 600000; // 10분 (모든 큰 파일에 적용)
```

**문제점**:
- 작은 파일도 텍스트가 500KB를 넘으면 10분 타임아웃 적용
- 작은 파일은 보통 1-2분 내에 처리 가능한데 불필요하게 긴 타임아웃

### 4. 분할 처리 로직의 부작용
- 작은 파일도 분할 처리를 시도하면 추가 오버헤드 발생
- 분할 저장, job 등록 등 추가 작업으로 시간 소모

## 해결 방안

### 1. 파일 크기와 텍스트 길이를 함께 고려
```typescript
// 개선된 로직
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
const LARGE_TEXT_THRESHOLD = 2 * 1024 * 1024; // 2MB (파일 크기와 함께 고려)
const isLargeFile = fileSize > LARGE_FILE_THRESHOLD && normalizedText.length > LARGE_TEXT_THRESHOLD;
```

### 2. DOCX 파일 특성 반영
```typescript
// DOCX 파일은 파일 크기 기준으로만 판단
if (job.job_type === 'DOCX_PARSE') {
  const isLargeFile = fileSize > 10 * 1024 * 1024; // 10MB 이상만 큰 파일
  const isLargeDocument = fileSize > 10 * 1024 * 1024;
}
```

### 3. 타임아웃 설정 개선
```typescript
// 작은 파일: 2분, 중간 파일: 5분, 큰 파일: 10분
const timeoutMs = 
  fileSize < 5 * 1024 * 1024 ? 120000 :  // 5MB 미만: 2분
  fileSize < 10 * 1024 * 1024 ? 300000 : // 10MB 미만: 5분
  600000; // 10MB 이상: 10분
```

### 4. 분할 처리 조건 엄격화
```typescript
// 파일 크기와 텍스트 길이 모두 큰 경우에만 분할
const shouldSplit = fileSize > 10 * 1024 * 1024 && normalizedText.length > 2 * 1024 * 1024;
```

## 예상 효과
- 작은 DOCX 파일: 1-2분 내 처리 완료
- 중간 DOCX 파일: 3-5분 내 처리 완료
- 큰 DOCX 파일: 분할 처리 또는 10분 타임아웃 적용

