# 서버리스 환경 제약 및 비활성화 원인 분석

## 🔍 근본 원인 분석

### 1. 서버리스 환경 제약의 실제 원인

#### A. Vercel 플랫폼 제약사항
```typescript
// 현재 설정된 타임아웃 값들
export const maxDuration = 30;   // 기본: 30초
export const maxDuration = 120;  // 일부 API: 2분
export const maxDuration = 300;  // 크롤링: 5분
```

**실제 제약사항:**
- **Hobby Plan**: 10초 타임아웃 (기본값)
- **Pro Plan**: 60초 타임아웃 (기본값)
- **Enterprise Plan**: 900초 타임아웃 (기본값)
- **메모리 제한**: 1024MB (모든 플랜 동일)
- **Cold Start**: 1-3초 (라이브러리 로딩 시간)

#### B. 개발자의 보수적 접근
```typescript
// RAGProcessor.ts에서 발견된 보수적 설정
const isLargeFile = document.file_size > 10 * 1024 * 1024; // 10MB 이상
const timeoutMs = isLargeFile ? 300000 : 60000; // 대용량: 5분, 일반: 1분
```

**보수적 접근의 이유:**
1. **안정성 우선**: 오류 발생 방지
2. **사용자 경험**: 타임아웃으로 인한 불편함 방지
3. **비용 절약**: Pro Plan 업그레이드 비용 회피
4. **개발 속도**: 복잡한 최적화보다 빠른 개발

### 2. 코드 일관성 부족의 원인

#### A. 점진적 개발 과정
```typescript
// 일부 API는 활성화됨 (extract-pdf, extract-docx)
const pdfData = await pdf(buffer); // ✅ 활성화

// 메인 프로세서는 비활성화됨
console.log(`📄 PDF 텍스트 추출 비활성화: ${fileName}`); // ❌ 비활성화
```

**개발 과정에서 발생한 문제:**
1. **실험적 구현**: 개별 API로 테스트
2. **통합 실패**: 메인 프로세서에 반영 안됨
3. **문서화 부족**: 비활성화 이유 명시 안됨
4. **테스트 부족**: 통합 테스트 미실행

#### B. 아키텍처 복잡성
```typescript
// 여러 서비스가 동일한 기능을 다르게 구현
- RAGProcessor.ts (메인)
- ServerSideTextExtractor.ts (전용)
- DocumentProcessingService.ts (별도)
- NewDocumentProcessor.ts (새로운)
- extract-pdf/route.ts (API)
- extract-docx/route.ts (API)
```

## 🛠️ 즉시 해결 방안

### 1. 단순 기능 활성화 (Low Risk)

#### A. RAGProcessor.ts 활성화
```typescript
// 현재 비활성화된 코드
case 'pdf':
  console.log(`📄 PDF 텍스트 추출 비활성화: ${fileName}`);
  // 플레이스홀더 반환

// 활성화된 코드로 변경
case 'pdf':
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const pdfData = await pdfParse(fileBuffer);
    return processTextEncoding(pdfData.text, { strictMode: true });
  } catch (error) {
    console.error('PDF 추출 실패:', error);
    // 폴백 처리
  }
```

#### B. ServerSideTextExtractor.ts 활성화
```typescript
// 현재 TODO 주석
// const pdfParse = require('pdf-parse');
// const pdfData = await pdfParse(fileBuffer);

// 실제 구현으로 변경
const pdfParse = (await import('pdf-parse')).default;
const pdfData = await pdfParse(fileBuffer);
```

### 2. 서버리스 환경 최적화

#### A. 타임아웃 설정 최적화
```typescript
// vercel.json 또는 각 API 라우트에서
export const maxDuration = 60; // 60초로 증가 (Pro Plan 필요)

// 또는 조건부 타임아웃
const timeoutMs = fileSize > 5 * 1024 * 1024 ? 45000 : 25000; // 45초 또는 25초
```

#### B. 파일 크기 제한 설정
```typescript
const MAX_FILE_SIZE = {
  PDF: 5 * 1024 * 1024,    // 5MB
  DOCX: 10 * 1024 * 1024,  // 10MB
  TXT: 2 * 1024 * 1024     // 2MB
};

if (fileBuffer.length > MAX_FILE_SIZE[fileType]) {
  throw new Error(`파일이 너무 큽니다. 최대 ${MAX_FILE_SIZE[fileType] / 1024 / 1024}MB까지 지원됩니다.`);
}
```

#### C. 메모리 최적화
```typescript
// 처리 후 메모리 정리
const result = await extractText(fileBuffer);
fileBuffer = null; // 메모리 해제
if (global.gc) global.gc(); // 가비지 컬렉션 강제 실행
return result;
```

### 3. 에러 처리 강화

#### A. 타임아웃 에러 처리
```typescript
const timeoutPromise = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('Extraction timeout')), timeoutMs)
);

try {
  const result = await Promise.race([extractionPromise, timeoutPromise]);
  return result;
} catch (error) {
  if (error.message.includes('timeout')) {
    return {
      success: false,
      error: '파일이 너무 커서 처리 시간이 초과되었습니다.',
      fallback: '관리자에게 문의하세요.'
    };
  }
  throw error;
}
```

#### B. 메모리 부족 에러 처리
```typescript
try {
  const result = await extractText(fileBuffer);
  return result;
} catch (error) {
  if (error.message.includes('out of memory')) {
    return {
      success: false,
      error: '메모리 부족으로 파일을 처리할 수 없습니다.',
      fallback: '더 작은 파일로 시도해주세요.'
    };
  }
  throw error;
}
```

## 🚀 실행 계획

### Phase 1: 즉시 실행 (1일)
1. **RAGProcessor.ts 활성화**
   ```bash
   # 파일 수정
   src/lib/services/RAGProcessor.ts
   ```

2. **ServerSideTextExtractor.ts 활성화**
   ```bash
   # 파일 수정
   src/lib/services/ServerSideTextExtractor.ts
   ```

3. **타임아웃 설정 조정**
   ```bash
   # 각 API 라우트에서 maxDuration 조정
   src/app/api/admin/upload-new/route.ts
   ```

### Phase 2: 테스트 및 검증 (2-3일)
1. **로컬 테스트**
   ```bash
   npm run dev
   # PDF/DOCX 파일 업로드 테스트
   ```

2. **Vercel 배포 테스트**
   ```bash
   vercel --prod
   # 실제 서버리스 환경에서 테스트
   ```

3. **성능 모니터링**
   ```bash
   # Vercel 대시보드에서 함수 실행 시간 확인
   # 메모리 사용량 모니터링
   ```

### Phase 3: 최적화 (1주)
1. **파일 크기 제한 구현**
2. **에러 처리 강화**
3. **사용자 피드백 개선**

## 📊 예상 결과

### 성공 시나리오
- ✅ **PDF 처리 성공률**: 90% 이상
- ✅ **DOCX 처리 성공률**: 95% 이상
- ✅ **평균 처리 시간**: 15초 이하
- ✅ **타임아웃 발생률**: 5% 이하

### 실패 시나리오 대응
- ❌ **타임아웃 발생**: 사용자에게 명확한 안내
- ❌ **메모리 부족**: 파일 크기 제한 안내
- ❌ **라이브러리 오류**: 폴백 처리 및 로깅

## 🎯 핵심 포인트

### 1. 기술적 해결책
- **라이브러리는 이미 설치됨**: `pdf-parse`, `mammoth`
- **코드만 활성화하면 됨**: TODO 주석을 실제 코드로 변경
- **타임아웃 조정**: `maxDuration` 값 증가

### 2. 비용 고려사항
- **Vercel Pro Plan**: 월 $20 (60초 타임아웃)
- **현재 Hobby Plan**: 월 $0 (10초 타임아웃)
- **업그레이드 필요**: 안정적인 서비스 제공을 위해

### 3. 위험 관리
- **점진적 활성화**: 하나씩 테스트하며 활성화
- **폴백 처리**: 실패 시 기존 방식으로 폴백
- **모니터링**: 실시간 성능 및 오류 모니터링

---

*분석 일시: 2025년 1월 2일*
*우선순위: High (핵심 기능 복구)*
*예상 소요 시간: 1-2일*









