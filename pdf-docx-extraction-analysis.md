# PDF/DOCX 텍스트 추출 제한 문제 분석 및 해결 계획

## 🔍 문제 원인 분석

### 1. 현재 상황
- **PDF/DOCX 텍스트 추출이 비활성화**되어 있음
- 파일은 업로드되지만 **실제 내용 추출은 되지 않음**
- 대신 **플레이스홀더 텍스트**만 저장됨

### 2. 기술적 원인

#### A. 라이브러리 설치 상태
```json
// package.json에서 확인된 라이브러리들
"mammoth": "^1.11.0",        // ✅ DOCX 처리용 - 설치됨
"pdf-parse": "^1.1.1",       // ✅ PDF 처리용 - 설치됨
"@types/pdf-parse": "^1.1.5" // ✅ 타입 정의 - 설치됨
```

#### B. 코드 구현 상태
- **PDF 처리**: `pdf-parse` 라이브러리가 설치되어 있지만 **코드에서 비활성화**됨
- **DOCX 처리**: `mammoth` 라이브러리가 설치되어 있고 **일부 API에서 활성화**됨
- **서버리스 환경**: Vercel의 30초 타임아웃 제약으로 인한 **의도적 비활성화**

#### C. 서비스별 구현 상태

| 서비스 | PDF 처리 | DOCX 처리 | 상태 |
|--------|----------|-----------|------|
| `RAGProcessor.ts` | ❌ 비활성화 | ❌ 비활성화 | 플레이스홀더만 반환 |
| `ServerSideTextExtractor.ts` | ❌ TODO 주석 | ❌ TODO 주석 | 미구현 |
| `DocumentProcessingService.ts` | ❌ 비활성화 | ❌ 비활성화 | 서버리스 제약 언급 |
| `NewDocumentProcessor.ts` | ❌ 비활성화 | ❌ 비활성화 | 서버사이드 처리 필요 언급 |
| `extract-pdf/route.ts` | ✅ 활성화 | - | 동적 import 사용 |
| `extract-docx/route.ts` | - | ✅ 활성화 | mammoth 라이브러리 사용 |

### 3. 근본 원인

#### A. 서버리스 환경 제약
- **Vercel 타임아웃**: 30초 제한으로 대용량 파일 처리 불가
- **메모리 제한**: 서버리스 함수의 메모리 제약
- **Cold Start**: 라이브러리 로딩 시간으로 인한 지연

#### B. 의도적 비활성화
- 개발자가 **서버리스 환경의 제약**을 인식하고 의도적으로 비활성화
- **안정성 우선**: 오류 발생 방지를 위해 플레이스홀더 방식 채택

#### C. 코드 일관성 부족
- 일부 API는 활성화되어 있지만 **메인 프로세서들은 비활성화**
- **통합된 처리 방식** 부재

## 🛠️ 해결 계획

### Phase 1: 즉시 해결 가능한 문제들

#### 1.1 코드 활성화 (Low Risk)
```typescript
// RAGProcessor.ts에서 PDF 처리 활성화
case 'pdf':
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const pdfData = await pdfParse(fileBuffer);
    return processTextEncoding(pdfData.text, { strictMode: true });
  } catch (error) {
    // 폴백 처리
  }
```

#### 1.2 DOCX 처리 통합
```typescript
// RAGProcessor.ts에서 DOCX 처리 활성화
case 'docx':
  try {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return processTextEncoding(result.value, { strictMode: true });
  } catch (error) {
    // 폴백 처리
  }
```

### Phase 2: 서버리스 환경 최적화

#### 2.1 파일 크기 제한
- **PDF**: 5MB 이하만 처리
- **DOCX**: 10MB 이하만 처리
- **큰 파일**: 별도 처리 큐로 이동

#### 2.2 타임아웃 관리
```typescript
const EXTRACTION_TIMEOUT = 25000; // 25초 (5초 여유)

const timeoutPromise = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('Extraction timeout')), EXTRACTION_TIMEOUT)
);

const extractionPromise = extractTextFromFile(fileBuffer, fileName, fileType);

return Promise.race([extractionPromise, timeoutPromise]);
```

#### 2.3 메모리 최적화
- **스트리밍 처리**: 대용량 파일을 청크 단위로 처리
- **가비지 컬렉션**: 처리 후 메모리 정리
- **압축**: 임시 데이터 압축 저장

### Phase 3: 아키텍처 개선

#### 3.1 백그라운드 처리
```typescript
// 대용량 파일은 백그라운드에서 처리
if (fileBuffer.length > LARGE_FILE_THRESHOLD) {
  // 큐에 추가하고 즉시 응답
  await addToProcessingQueue(fileId, fileBuffer);
  return { status: 'queued', message: '파일이 처리 큐에 추가되었습니다.' };
}
```

#### 3.2 외부 서비스 활용
- **Supabase Edge Functions**: 더 긴 실행 시간
- **AWS Lambda**: 더 큰 메모리 할당
- **Google Cloud Functions**: PDF/DOCX 전용 처리

#### 3.3 클라이언트 사이드 처리
```typescript
// 작은 파일은 클라이언트에서 처리
if (file.size < CLIENT_SIDE_THRESHOLD) {
  const text = await extractTextOnClient(file);
  return { text, processed: true };
}
```

### Phase 4: 모니터링 및 품질 관리

#### 4.1 처리 성공률 모니터링
```typescript
const processingStats = {
  totalFiles: 0,
  successfulExtractions: 0,
  failedExtractions: 0,
  averageProcessingTime: 0
};
```

#### 4.2 품질 검증
```typescript
const qualityScore = validateExtractedText(text);
if (qualityScore < MINIMUM_QUALITY_THRESHOLD) {
  // 수동 검토 큐에 추가
  await addToManualReviewQueue(fileId, text);
}
```

## 📊 우선순위 및 일정

### 즉시 실행 (1-2일)
1. ✅ **RAGProcessor.ts 활성화**: PDF/DOCX 처리 코드 활성화
2. ✅ **에러 처리 강화**: 타임아웃 및 메모리 오류 처리
3. ✅ **파일 크기 제한**: 서버리스 환경에 맞는 제한 설정

### 단기 개선 (1주)
1. 🔄 **통합 테스트**: 모든 파일 형식에 대한 테스트
2. 🔄 **성능 모니터링**: 처리 시간 및 성공률 추적
3. 🔄 **사용자 피드백**: 처리 실패 시 명확한 안내

### 중기 개선 (2-4주)
1. 📋 **백그라운드 처리**: 대용량 파일 처리 큐 구현
2. 📋 **외부 서비스 연동**: Supabase Edge Functions 활용
3. 📋 **캐싱 시스템**: 처리된 결과 캐싱

### 장기 개선 (1-3개월)
1. 🎯 **AI 기반 품질 검증**: 추출된 텍스트 품질 자동 평가
2. 🎯 **다국어 지원**: 다양한 언어의 PDF/DOCX 처리
3. 🎯 **실시간 동기화**: 문서 변경사항 자동 반영

## 🎯 성공 지표

### 기술적 지표
- **처리 성공률**: 95% 이상
- **평균 처리 시간**: 10초 이하
- **메모리 사용량**: 512MB 이하
- **타임아웃 발생률**: 5% 이하

### 사용자 경험 지표
- **파일 업로드 성공률**: 98% 이상
- **텍스트 추출 품질**: 90% 이상
- **사용자 만족도**: 4.5/5.0 이상
- **지원 요청 감소**: 50% 이상

---

*분석 일시: 2025년 1월 2일*
*분석자: AI Assistant*
*우선순위: High (핵심 기능 개선)*









