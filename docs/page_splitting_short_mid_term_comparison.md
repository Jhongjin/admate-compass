# 페이지 분할 계획: 단기 vs 중기 vs 장기 상세 비교

**작성일**: 2025-11-06  
**목적**: 페이지 분할 계획의 단기, 중기, 장기 접근법의 차이를 명확히 구분

---

## 📊 전체 개요

| 구분 | 단기 (즉시) | 중기 (1-2주) | 장기 (7주) |
|------|------------|-------------|-----------|
| **기간** | 즉시 적용 | 1-2주 | 7주 |
| **복잡도** | 낮음 | 중간 | 높음 |
| **효과** | 부분 완화 | 근본 해결 시작 | 완전 해결 |
| **비용** | 최소 | 중간 | 높음 |
| **위험** | 낮음 | 중간 | 높음 |

---

## 1️⃣ 단기 (즉시 적용 가능)

### 목표
타임아웃 문제를 **임시로 완화**하여 큰 파일 처리 실패율을 줄임

### 접근 방법
**파일 크기 제한 강화** - 근본 원인 해결이 아닌 문제 회피

### 구체적 조치

#### 1.1 파일 크기 제한 조정
```typescript
// 현재: 15MB
// 단기: 10MB로 강화
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
```

**장점**:
- ✅ 즉시 적용 가능 (코드 몇 줄 수정)
- ✅ 타임아웃 발생 가능성 크게 감소
- ✅ 구현 복잡도 없음
- ✅ 추가 비용 없음

**단점**:
- ❌ 큰 파일 처리 불가 (근본 해결 아님)
- ❌ 사용자 제약 (10MB 이상 파일 업로드 불가)
- ❌ 타임아웃 문제 완전 해결 불가

#### 1.2 재시도 로직 활용
```typescript
// 이미 구현됨: 타임아웃 발생 시 자동 재시도
if (currentAttempts < maxAttempts) {
  // retrying 상태로 변경하고 재시도
}
```

**효과**: 재시도로 성공률 30-50% 향상

---

## 2️⃣ 중기 (1-2주 구현)

### 목표
페이지 분할 시스템의 **핵심 인프라와 기본 로직**을 구현하여 큰 파일 처리 시작

### 접근 방법
**단순한 고정 크기 분할** - 페이지 구조 분석 없이 텍스트를 고정 크기로 분할

### 구체적 구현 (Phase 1-2 핵심 부분)

#### 2.1 Phase 1: 인프라 준비 (1주)

**데이터베이스 스키마**
```sql
-- 1. CHUNK_PROCESS job 타입 추가
ALTER TYPE job_type_enum ADD VALUE IF NOT EXISTS 'CHUNK_PROCESS';

-- 2. document_splits 테이블 생성
CREATE TABLE document_splits (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  split_index INTEGER,
  split_count INTEGER,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. documents 테이블에 split_status 추가
ALTER TABLE documents ADD COLUMN split_status JSONB;
```

**예상 효과**: 분할 추적 인프라 구축 완료

#### 2.2 Phase 2: 단순 분할 로직 (1주)

**고정 크기 분할 구현**
```typescript
// src/lib/services/SimpleTextSplitter.ts
export class SimpleTextSplitter {
  splitByFixedSize(
    content: string,
    maxSize: number = 500 * 1024 // 500KB
  ): TextSplit[] {
    const splits: TextSplit[] = [];
    let index = 0;
    
    // 고정 크기로 텍스트 분할 (의미 단위 고려 없음)
    for (let i = 0; i < content.length; i += maxSize) {
      const splitContent = content.slice(i, i + maxSize);
      splits.push({
        index: index++,
        content: splitContent,
        startChar: i,
        endChar: Math.min(i + maxSize, content.length)
      });
    }
    
    return splits;
  }
}
```

**큐 워커 수정**
```typescript
// src/app/api/jobs/consume/route.ts
if (job.job_type === 'PDF_PARSE' || job.job_type === 'DOCX_PARSE') {
  const extractedText = await processPdfBuffer(fileBuffer);
  
  // 큰 파일 감지 (10MB 이상 또는 500KB 텍스트 이상)
  if (fileSize > 10 * 1024 * 1024 || extractedText.length > 500 * 1024) {
    // 1. 고정 크기로 분할 (500KB 단위)
    const splits = simpleTextSplitter.splitByFixedSize(extractedText, 500 * 1024);
    
    // 2. 각 분할을 document_splits에 저장
    for (const split of splits) {
      await supabase.from('document_splits').insert({
        document_id: job.document_id,
        split_index: split.index,
        split_count: splits.length,
        content: split.content,
        status: 'pending'
      });
      
      // 3. CHUNK_PROCESS job 등록
      await supabase.from('processing_jobs').insert({
        document_id: job.document_id,
        job_type: 'CHUNK_PROCESS',
        status: 'queued',
        payload: {
          split_id: split.id,
          split_index: split.index,
          content: split.content
        }
      });
    }
    
    // 4. 문서 상태 업데이트
    await supabase.from('documents').update({
      split_status: {
        total_splits: splits.length,
        completed_splits: 0
      },
      status: 'processing'
    });
    
    return; // 원본 PDF_PARSE job은 완료
  }
}
```

**CHUNK_PROCESS 처리**
```typescript
if (job.job_type === 'CHUNK_PROCESS') {
  const splitContent = job.payload.content;
  
  // 각 분할에 대해 청킹/임베딩/저장
  const result = await ragProcessor.processDocument({
    ...docData,
    content: splitContent
  });
  
  // 분할 상태 업데이트
  await supabase.from('document_splits').update({
    status: 'completed'
  }).eq('id', job.payload.split_id);
  
  // 전체 완료 확인
  // 모든 분할 완료 시 documents.status = 'indexed'
}
```

**예상 효과**:
- ✅ 큰 파일(10MB+) 처리 가능
- ✅ 타임아웃 문제 해결 (각 분할은 1-2분 내 처리)
- ✅ 부분 실패 허용 (일부 분할 실패해도 나머지 처리)

**제한사항**:
- ⚠️ 의미 단위 분할 아님 (문맥이 끊길 수 있음)
- ⚠️ 페이지 경계 고려 안 함
- ⚠️ 섹션 구조 보존 안 함

---

## 3️⃣ 장기 (7주 전체 구현)

### 목표
**의미 단위(페이지/섹션) 분할**을 통해 타임아웃 해결과 검색 품질 향상 동시 달성

### 접근 방법
**지능형 구조 분석 기반 분할** - PDF 구조를 분석하여 의미 단위로 분할

### 구체적 구현 (Phase 1-5 전체)

#### 3.1 Phase 1: 인프라 준비 (1주)
- 중기와 동일

#### 3.2 Phase 2: PDF 구조 분석 (2주)
```typescript
// PDF 구조 분석 서비스
export class PDFStructureAnalyzer {
  async analyzeStructure(pdfBuffer: Buffer): Promise<PDFStructure> {
    // 1. 페이지별 텍스트 추출
    const pages = await this.extractPages(pdfBuffer);
    
    // 2. 섹션/챕터 감지
    const sections = await this.detectSections(pages);
    
    // 3. 목차 정보 추출
    const toc = await this.extractTableOfContents(pages);
    
    return {
      pages,
      sections,
      toc,
      hasStructure: sections.length > 0
    };
  }
  
  private detectSections(pages: Page[]): Section[] {
    // 제목 패턴 감지
    // - "Chapter 1", "Section 1.1", "제 1장"
    // - 헤딩 레벨 분석 (H1, H2, H3)
    // - 페이지 번호 기반 섹션 경계 추정
  }
}
```

#### 3.3 Phase 3: 분할 처리 로직 (2주)
```typescript
// 지능형 분할 전략 결정
function determineSplitStrategy(
  fileSize: number,
  pageCount: number,
  hasStructure: boolean
): SplitStrategy {
  if (hasStructure && pageCount > 0) {
    // 페이지 단위 분할 (최적)
    return { 
      method: 'page', 
      maxSize: 500 * 1024, 
      preserveContext: true 
    };
  } else if (hasStructure) {
    // 섹션 단위 분할 (차선)
    return { 
      method: 'section', 
      maxSize: 500 * 1024, 
      preserveContext: true 
    };
  } else {
    // 고정 크기 분할 (fallback - 중기와 동일)
    return { 
      method: 'fixed-size', 
      maxSize: 500 * 1024, 
      preserveContext: false 
    };
  }
}
```

#### 3.4 Phase 4: UI 개선 (1주)
- 분할 진행 상황 표시
- 각 분할별 상태 표시

#### 3.5 Phase 5: 테스트 및 최적화 (1주)
- 다양한 PDF 테스트
- 성능 최적화

**예상 효과**:
- ✅ 타임아웃 문제 완전 해결
- ✅ 검색 품질 향상 (문맥 보존)
- ✅ 사용자 경험 개선 (진행 상황 표시)

---

## 🔍 주요 차이점 비교

### 1. **구현 복잡도**

| 항목 | 단기 | 중기 | 장기 |
|------|------|------|------|
| 코드 수정 | 10줄 이하 | 500-1000줄 | 2000-3000줄 |
| 데이터베이스 변경 | 없음 | 마이그레이션 1개 | 마이그레이션 1개 |
| 새 서비스/컴포넌트 | 없음 | 1-2개 | 3-5개 |
| 테스트 필요 | 최소 | 중간 | 높음 |

### 2. **해결 효과**

| 항목 | 단기 | 중기 | 장기 |
|------|------|------|------|
| 타임아웃 해결 | 부분 완화 | ✅ 완전 해결 | ✅ 완전 해결 |
| 큰 파일 처리 | 불가 (10MB 제한) | ✅ 가능 | ✅ 가능 |
| 검색 품질 | 변화 없음 | 약간 저하 가능 | ✅ 향상 |
| 문맥 보존 | 변화 없음 | ❌ 없음 | ✅ 있음 |
| 사용자 경험 | 변화 없음 | 중간 | ✅ 향상 |

### 3. **구현 시간**

| 단계 | 단기 | 중기 | 장기 |
|------|------|------|------|
| 계획 | 1시간 | 1일 | 1주 |
| 구현 | 즉시 | 1-2주 | 7주 |
| 테스트 | 1일 | 1주 | 2주 |
| 배포 | 즉시 | 1주 | 2주 |
| **총 소요** | **1일** | **2-3주** | **9-10주** |

### 4. **비용 및 리스크**

| 항목 | 단기 | 중기 | 장기 |
|------|------|------|------|
| 개발 비용 | 최소 | 중간 | 높음 |
| 유지보수 비용 | 낮음 | 중간 | 높음 |
| 기술적 리스크 | 없음 | 낮음 | 중간 |
| 사용자 영향 | 제약 증가 | 제약 해소 | 개선 |

---

## 💡 권장 접근법

### 최적 전략: **단계적 접근**

#### Phase A: 단기 (즉시)
1. 파일 크기 제한 10MB로 강화
2. 재시도 로직 활용 (이미 구현됨)
3. **효과**: 타임아웃 실패율 50% 감소 예상

#### Phase B: 중기 (1-2주 후)
1. Phase 1 인프라 준비
2. 고정 크기 분할 로직 구현
3. **효과**: 큰 파일 처리 가능, 타임아웃 문제 해결

#### Phase C: 장기 (3-4주 후)
1. PDF 구조 분석 구현
2. 의미 단위 분할 구현
3. UI 개선
4. **효과**: 검색 품질 향상, 완전한 해결

---

## 📊 예상 효과 비교

### 큰 파일(15MB PDF) 처리 성공률

| 접근법 | 성공률 | 처리 시간 | 검색 품질 |
|--------|--------|----------|-----------|
| **현재** | 0% (타임아웃) | 10분+ | - |
| **단기** | 0% (업로드 불가) | - | - |
| **중기** | 90%+ | 2-3분 | 보통 |
| **장기** | 95%+ | 2-3분 | 우수 |

### 타임아웃 실패율

| 접근법 | 실패율 | 재시도 성공률 |
|--------|--------|--------------|
| **현재** | 100% | 0% |
| **단기** | 50% (10MB 이하만) | 30-50% |
| **중기** | 0% | - |
| **장기** | 0% | - |

---

## 🎯 결론 및 권장사항

### 즉시 적용 (단기)
- ✅ 파일 크기 제한 10MB로 강화
- ✅ 재시도 로직 활용
- **효과**: 타임아웃 실패율 50% 감소

### 1-2주 내 구현 (중기)
- ✅ 고정 크기 분할 시스템 구현
- ✅ 핵심 인프라 구축
- **효과**: 큰 파일 처리 가능, 타임아웃 문제 해결

### 3-4주 내 구현 (장기)
- ✅ PDF 구조 분석 추가
- ✅ 의미 단위 분할 구현
- ✅ UI 개선
- **효과**: 검색 품질 향상, 완전한 해결

---

## 📝 요약

### 단기 (즉시)
- **목적**: 문제 회피 (임시 완화)
- **방법**: 파일 크기 제한
- **효과**: 부분 완화
- **복잡도**: 매우 낮음

### 중기 (1-2주)
- **목적**: 근본 해결 시작
- **방법**: 고정 크기 분할
- **효과**: 타임아웃 해결, 큰 파일 처리 가능
- **복잡도**: 중간

### 장기 (7주)
- **목적**: 완전한 해결 및 품질 향상
- **방법**: 의미 단위 분할
- **효과**: 타임아웃 해결 + 검색 품질 향상
- **복잡도**: 높음

**권장**: 단기 → 중기 → 장기 순서로 단계적 접근

