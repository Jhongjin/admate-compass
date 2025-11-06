# 중기 계획: Phase 1-2 세부 구현 계획서

**작성일**: 2025-11-06  
**목적**: 큰 파일 처리 문제 해결을 위한 고정 크기 분할 시스템 구현  
**기간**: 1-2주  
**목표**: 10MB+ 파일의 타임아웃 문제 해결

---

## 📋 전체 개요

### 구현 범위
- **Phase 1**: 인프라 준비 (이미 완료 - 확인 필요)
- **Phase 2**: 고정 크기 분할 로직 구현 (1-2주)

### 핵심 목표
1. 10MB 이상 파일 자동 분할 감지
2. 500KB 단위 고정 크기 분할
3. 각 분할을 독립적으로 처리
4. 부분 실패 허용 (일부 분할 실패해도 나머지 처리)

---

## Phase 1: 인프라 준비 확인 및 보완

### 현재 상태 확인

#### ✅ 1.1 CHUNK_PROCESS job 타입
**파일**: `supabase/migrations/20250131_add_chunk_process_support.sql`

**확인 사항**:
```sql
-- 이미 완료되어 있어야 함
CHECK (job_type IN ('OCR','PDF_PARSE','DOCX_PARSE','CRAWL','EMBEDDING','CHUNK_PROCESS'))
```

**확인 방법**:
```sql
-- Supabase SQL Editor에서 실행
SELECT 
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.processing_jobs'::regclass
  AND conname = 'processing_jobs_job_type_check';
```

**예상 결과**: `CHUNK_PROCESS`가 포함되어 있어야 함

#### ✅ 1.2 document_splits 테이블
**확인 사항**:
```sql
-- 테이블 존재 확인
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'document_splits'
);
```

**필수 컬럼 확인**:
- `id` (UUID, PRIMARY KEY)
- `document_id` (TEXT, REFERENCES documents(id))
- `split_index` (INTEGER)
- `split_count` (INTEGER)
- `content` (TEXT)
- `status` (TEXT, CHECK: pending/processing/completed/failed)
- `job_id` (UUID, REFERENCES processing_jobs(id))

**인덱스 확인**:
```sql
-- 인덱스 확인
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'document_splits';
```

필요한 인덱스:
- `idx_document_splits_document_id`
- `idx_document_splits_status`
- `idx_document_splits_job_id`

#### ✅ 1.3 documents.split_status 컬럼
**확인 사항**:
```sql
-- 컬럼 존재 확인
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'documents' 
  AND column_name = 'split_status';
```

**예상 데이터 구조**:
```json
{
  "total_splits": 5,
  "completed_splits": 3,
  "failed_splits": 0,
  "method": "fixed-size"
}
```

### Phase 1 보완 작업 (필요 시)

만약 위 확인 사항 중 하나라도 누락되었다면:

**1단계: 마이그레이션 파일 확인**
```bash
# 마이그레이션 파일이 이미 존재하는지 확인
ls supabase/migrations/20250131_add_chunk_process_support.sql
```

**2단계: Supabase에 적용**
- Supabase Dashboard → SQL Editor
- 마이그레이션 파일 내용 복사/붙여넣기
- 실행

**3단계: 확인**
- 위의 확인 SQL 실행
- 모든 항목이 정상인지 검증

---

## Phase 2: 고정 크기 분할 로직 구현 (1-2주)

### 작업 단계별 분해

#### **Day 1-2: 텍스트 분할 서비스 구현**

**파일**: `src/lib/services/SimpleTextSplitter.ts` (신규 생성)

**구현 내용**:

```typescript
'use client';

export interface TextSplit {
  index: number;
  content: string;
  startChar: number;
  endChar: number;
  sizeBytes: number;
}

export interface SplitOptions {
  maxSize: number; // 기본값: 500KB (500 * 1024)
  overlap?: number; // 기본값: 0 (중기에는 overlap 없음)
}

export class SimpleTextSplitter {
  /**
   * 고정 크기로 텍스트 분할
   * @param content 원본 텍스트
   * @param options 분할 옵션
   * @returns 분할된 텍스트 배열
   */
  splitByFixedSize(
    content: string,
    options: SplitOptions = { maxSize: 500 * 1024 }
  ): TextSplit[] {
    const splits: TextSplit[] = [];
    const maxSize = options.maxSize;
    const overlap = options.overlap || 0;
    
    if (!content || content.length === 0) {
      return [];
    }
    
    let index = 0;
    let start = 0;
    
    while (start < content.length) {
      const end = Math.min(start + maxSize, content.length);
      const splitContent = content.slice(start, end);
      
      // 마지막 분할이 너무 작으면 이전 분할에 병합
      if (end < content.length && (content.length - end) < maxSize * 0.3) {
        // 마지막 부분을 이전 분할에 포함
        const lastSplit = splits[splits.length - 1];
        if (lastSplit) {
          lastSplit.content = content.slice(lastSplit.startChar);
          lastSplit.endChar = content.length;
          lastSplit.sizeBytes = Buffer.byteLength(lastSplit.content, 'utf8');
          break;
        }
      }
      
      splits.push({
        index: index++,
        content: splitContent,
        startChar: start,
        endChar: end,
        sizeBytes: Buffer.byteLength(splitContent, 'utf8')
      });
      
      // 다음 분할 시작 위치 (overlap 고려)
      start = end - overlap;
      
      // 마지막 분할인 경우 종료
      if (end >= content.length) {
        break;
      }
    }
    
    return splits;
  }
  
  /**
   * 분할 크기 검증
   */
  validateSplitSize(splits: TextSplit[], maxSize: number): boolean {
    return splits.every(split => split.sizeBytes <= maxSize * 1.1); // 10% 여유
  }
}

// 싱글톤 인스턴스
export const simpleTextSplitter = new SimpleTextSplitter();
```

**테스트 코드** (선택사항):
```typescript
// src/lib/services/__tests__/SimpleTextSplitter.test.ts
import { simpleTextSplitter } from '../SimpleTextSplitter';

describe('SimpleTextSplitter', () => {
  it('should split text into fixed-size chunks', () => {
    const text = 'a'.repeat(1500 * 1024); // 1.5MB
    const splits = simpleTextSplitter.splitByFixedSize(text, { maxSize: 500 * 1024 });
    
    expect(splits.length).toBe(3);
    expect(splits[0].sizeBytes).toBeLessThanOrEqual(500 * 1024);
  });
});
```

---

#### **Day 3-4: 큐 워커에서 큰 파일 감지 및 분할**

**파일**: `src/app/api/jobs/consume/route.ts`

**수정 위치**: `PDF_PARSE` / `DOCX_PARSE` 처리 로직

**구현 내용**:

```typescript
// src/app/api/jobs/consume/route.ts 상단에 import 추가
import { simpleTextSplitter, TextSplit } from '@/lib/services/SimpleTextSplitter';

// processQueue 함수 내부, PDF_PARSE/DOCX_PARSE 처리 부분에 추가
if (job.job_type === 'PDF_PARSE' || job.job_type === 'DOCX_PARSE') {
  // ... 기존 텍스트 추출 로직 ...
  
  // 🔥 새로운 로직: 큰 파일 감지 및 분할
  const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
  const LARGE_TEXT_THRESHOLD = 500 * 1024; // 500KB 텍스트
  const isLargeFile = fileSize > LARGE_FILE_THRESHOLD || extractedText.length > LARGE_TEXT_THRESHOLD;
  
  if (isLargeFile) {
    console.log('📦 큰 파일 감지 - 분할 처리 시작:', {
      fileName,
      fileSizeMB: fileSizeMB,
      textLength: extractedText.length,
      textLengthKB: (extractedText.length / 1024).toFixed(2)
    });
    
    try {
      // 1. 텍스트 분할 (500KB 단위)
      const splits = simpleTextSplitter.splitByFixedSize(extractedText, {
        maxSize: 500 * 1024 // 500KB
      });
      
      console.log('✂️ 텍스트 분할 완료:', {
        totalSplits: splits.length,
        avgSizeKB: (splits.reduce((sum, s) => sum + s.sizeBytes, 0) / splits.length / 1024).toFixed(2)
      });
      
      // 2. document_splits 테이블에 분할 저장
      const splitInserts = splits.map((split, idx) => ({
        document_id: job.document_id,
        split_index: idx,
        split_count: splits.length,
        content: split.content,
        start_char: split.startChar,
        end_char: split.endChar,
        status: 'pending'
      }));
      
      const { data: insertedSplits, error: splitInsertError } = await supabase
        .from('document_splits')
        .insert(splitInserts)
        .select('id');
      
      if (splitInsertError) {
        throw new Error(`분할 저장 실패: ${splitInsertError.message}`);
      }
      
      console.log('💾 분할 저장 완료:', insertedSplits?.length || 0, '개');
      
      // 3. 각 분할에 대해 CHUNK_PROCESS job 등록
      const chunkJobs = insertedSplits!.map((split, idx) => ({
        document_id: job.document_id,
        job_type: 'CHUNK_PROCESS',
        status: 'queued',
        priority: 5, // 일반 우선순위
        payload: {
          split_id: split.id,
          split_index: idx,
          original_job_id: job.id,
          original_job_type: job.job_type,
          fileName: fileName,
          fileSize: fileSize
        },
        attempts: 0,
        max_attempts: 3,
        scheduled_at: new Date().toISOString()
      }));
      
      const { data: insertedJobs, error: jobInsertError } = await supabase
        .from('processing_jobs')
        .insert(chunkJobs)
        .select('id');
      
      if (jobInsertError) {
        throw new Error(`CHUNK_PROCESS job 등록 실패: ${jobInsertError.message}`);
      }
      
      console.log('📋 CHUNK_PROCESS job 등록 완료:', insertedJobs?.length || 0, '개');
      
      // 4. documents 테이블 상태 업데이트
      await supabase
        .from('documents')
        .update({
          split_status: {
            total_splits: splits.length,
            completed_splits: 0,
            failed_splits: 0,
            method: 'fixed-size'
          },
          status: 'processing'
        })
        .eq('id', job.document_id);
      
      // 5. 원본 PDF_PARSE/DOCX_PARSE job 완료 처리
      await supabase
        .from('processing_jobs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          result: {
            note: 'split_into_chunks',
            total_splits: splits.length,
            fileSize: fileSize,
            textLength: extractedText.length
          }
        })
        .eq('id', job.id)
        .eq('status', 'processing');
      
      console.log('✅ 큰 파일 분할 완료 - CHUNK_PROCESS job들이 큐에 등록됨');
      
      return NextResponse.json({
        success: true,
        message: `큰 파일을 ${splits.length}개 분할로 처리했습니다.`,
        splits: splits.length
      }, { status: 200 });
      
    } catch (splitError: any) {
      console.error('❌ 큰 파일 분할 실패:', splitError);
      
      // 분할 실패 시 기존 방식으로 폴백 (전체 파일 처리 시도)
      console.log('⚠️ 분할 실패 - 기존 방식으로 폴백');
      // ... 기존 처리 로직 계속 ...
    }
  }
  
  // 작은 파일은 기존 로직대로 처리
  // ... 기존 처리 로직 ...
}
```

**주요 고려사항**:
1. **에러 처리**: 분할 실패 시 기존 방식으로 폴백
2. **트랜잭션**: 분할 저장과 job 등록이 실패하면 롤백 고려
3. **로깅**: 각 단계별 상세 로깅으로 디버깅 용이성 확보

---

#### **Day 5-6: CHUNK_PROCESS job 처리 로직**

**파일**: `src/app/api/jobs/consume/route.ts`

**구현 내용**:

```typescript
// processQueue 함수 내부, job_type 분기 처리 부분에 추가
if (job.job_type === 'CHUNK_PROCESS') {
  console.log('🔧 CHUNK_PROCESS job 처리 시작:', {
    jobId: job.id,
    documentId: job.document_id,
    splitIndex: job.payload?.split_index
  });
  
  try {
    const splitId = job.payload?.split_id as string;
    const splitIndex = job.payload?.split_index as number;
    const splitContent = job.payload?.content as string;
    
    if (!splitId || splitContent === undefined) {
      throw new Error('CHUNK_PROCESS job payload에 필수 정보가 없습니다.');
    }
    
    // 1. document_splits 상태를 processing으로 업데이트
    await supabase
      .from('document_splits')
      .update({
        status: 'processing',
        job_id: job.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', splitId)
      .eq('status', 'pending');
    
    // 2. 문서 정보 조회
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, title, type, created_at, updated_at, source_vendor')
      .eq('id', job.document_id)
      .single();
    
    if (docError || !doc) {
      throw new Error(`문서 조회 실패: ${docError?.message || '문서 없음'}`);
    }
    
    // 3. DocumentData 준비 (분할 콘텐츠만 포함)
    const docData: DocumentData = {
      id: doc.id,
      title: `${doc.title} (분할 ${splitIndex + 1})`,
      content: splitContent,
      type: doc.type || 'pdf',
      file_size: Buffer.byteLength(splitContent, 'utf8'),
      file_type: doc.type === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      source_vendor: doc.source_vendor || 'META',
      created_at: doc.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // 4. RAG 처리 (청킹, 임베딩, 저장)
    const processStartMs = Date.now();
    const result = await ragProcessor.processDocument(docData, true);
    const processMs = Date.now() - processStartMs;
    
    if (!result.success) {
      throw new Error(`RAG 처리 실패: ${result.error || '알 수 없는 오류'}`);
    }
    
    console.log('✅ 분할 처리 완료:', {
      splitIndex,
      chunkCount: result.chunkCount,
      processTimeMs: processMs
    });
    
    // 5. document_splits 상태를 completed로 업데이트
    await supabase
      .from('document_splits')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', splitId)
      .eq('status', 'processing');
    
    // 6. 문서 전체 완료 여부 확인
    const { count: completedCount, error: countError } = await supabase
      .from('document_splits')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', job.document_id)
      .eq('status', 'completed');
    
    const { count: totalCount } = await supabase
      .from('document_splits')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', job.document_id);
    
    if (countError) {
      console.warn('⚠️ 분할 완료 수 조회 실패:', countError);
    }
    
    // 7. 모든 분할 완료 시 문서 상태 업데이트
    if (completedCount === totalCount && totalCount! > 0) {
      // 전체 청크 수 조회
      const { count: totalChunks } = await supabase
        .from('document_chunks')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', job.document_id);
      
      await supabase
        .from('documents')
        .update({
          status: 'indexed',
          chunk_count: totalChunks || 0,
          split_status: {
            total_splits: totalCount,
            completed_splits: completedCount,
            failed_splits: 0,
            method: 'fixed-size'
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', job.document_id);
      
      console.log('🎉 모든 분할 처리 완료 - 문서 인덱싱 완료:', {
        documentId: job.document_id,
        totalSplits: totalCount,
        totalChunks: totalChunks || 0
      });
    } else {
      // 부분 완료 상태 업데이트
      await supabase
        .from('documents')
        .update({
          split_status: {
            total_splits: totalCount,
            completed_splits: completedCount,
            failed_splits: (totalCount || 0) - (completedCount || 0),
            method: 'fixed-size'
          }
        })
        .eq('id', job.document_id);
    }
    
    // 8. CHUNK_PROCESS job 완료 처리
    await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        result: {
          note: 'chunk_process_completed',
          split_index: splitIndex,
          chunk_count: result.chunkCount,
          process_time_ms: processMs
        }
      })
      .eq('id', job.id)
      .eq('status', 'processing');
    
    return NextResponse.json({
      success: true,
      message: `분할 ${splitIndex + 1} 처리 완료`,
      chunkCount: result.chunkCount
    }, { status: 200 });
    
  } catch (error: any) {
    console.error('❌ CHUNK_PROCESS 처리 실패:', error);
    
    // document_splits 상태를 failed로 업데이트
    const splitId = job.payload?.split_id as string;
    if (splitId) {
      await supabase
        .from('document_splits')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString()
        })
        .eq('id', splitId);
    }
    
    // documents.split_status 업데이트 (failed_splits 증가)
    const { count: failedCount } = await supabase
      .from('document_splits')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', job.document_id)
      .eq('status', 'failed');
    
    const { count: totalCount } = await supabase
      .from('document_splits')
      .select('*', { count: 'exact', head: true })
      .eq('document_id', job.document_id);
    
    await supabase
      .from('documents')
      .update({
        split_status: {
          total_splits: totalCount,
          failed_splits: failedCount,
          method: 'fixed-size'
        }
      })
      .eq('id', job.document_id);
    
    // job 실패 처리 (재시도 로직은 기존과 동일)
    throw error;
  }
}
```

---

#### **Day 7-10: 테스트 및 디버깅**

**테스트 시나리오**:

1. **작은 파일 (10MB 이하)**
   - 기존 로직대로 처리되는지 확인
   - 분할 로직이 실행되지 않는지 확인

2. **큰 파일 (10MB 이상)**
   - 분할 감지 확인
   - document_splits 테이블에 저장 확인
   - CHUNK_PROCESS job 등록 확인
   - 각 분할 처리 확인
   - 전체 완료 시 documents.status 업데이트 확인

3. **부분 실패 시나리오**
   - 일부 분할 실패 시 나머지 처리 계속되는지 확인
   - failed_splits 카운트 정확한지 확인

4. **재시도 로직**
   - CHUNK_PROCESS job 실패 시 재시도되는지 확인
   - max_attempts 초과 시 failed 상태 확인

**디버깅 도구**:

```sql
-- 분할 진행 상황 확인
SELECT 
  d.id,
  d.title,
  d.status,
  d.split_status,
  COUNT(ds.id) FILTER (WHERE ds.status = 'completed') as completed_splits,
  COUNT(ds.id) FILTER (WHERE ds.status = 'failed') as failed_splits,
  COUNT(ds.id) as total_splits
FROM documents d
LEFT JOIN document_splits ds ON d.id = ds.document_id
WHERE d.split_status IS NOT NULL
GROUP BY d.id, d.title, d.status, d.split_status;

-- CHUNK_PROCESS job 상태 확인
SELECT 
  id,
  document_id,
  status,
  attempts,
  payload->>'split_index' as split_index,
  started_at,
  finished_at
FROM processing_jobs
WHERE job_type = 'CHUNK_PROCESS'
ORDER BY created_at DESC
LIMIT 20;
```

---

#### **Day 11-14: UI 개선 (선택사항)**

**파일**: `src/app/admin/docs/page.tsx`

**구현 내용**:

1. **문서 목록에 분할 진행 상황 표시**
```typescript
// 문서 카드에 분할 진행률 표시
{doc.split_status && (
  <div className="text-xs text-gray-500">
    분할 처리: {doc.split_status.completed_splits} / {doc.split_status.total_splits}
  </div>
)}
```

2. **DocumentDetailDialog에 분할 정보 탭 추가**
```typescript
// 메타데이터 탭에 분할 정보 추가
{doc.split_status && (
  <div className="space-y-2">
    <div className="font-semibold">분할 처리 정보</div>
    <div>전체 분할: {doc.split_status.total_splits}</div>
    <div>완료: {doc.split_status.completed_splits}</div>
    <div>실패: {doc.split_status.failed_splits}</div>
    <div>방법: {doc.split_status.method}</div>
  </div>
)}
```

---

## 📝 구현 체크리스트

### Phase 1: 인프라 준비
- [ ] `CHUNK_PROCESS` job 타입 확인
- [ ] `document_splits` 테이블 확인
- [ ] `documents.split_status` 컬럼 확인
- [ ] 인덱스 확인
- [ ] RLS 정책 확인 (필요 시)

### Phase 2: 분할 로직 구현
- [ ] `SimpleTextSplitter` 서비스 생성
- [ ] 큐 워커에 큰 파일 감지 로직 추가
- [ ] 텍스트 분할 로직 구현
- [ ] `document_splits` 저장 로직
- [ ] `CHUNK_PROCESS` job 등록 로직
- [ ] `CHUNK_PROCESS` job 처리 로직
- [ ] 전체 완료 확인 로직
- [ ] 에러 처리 및 폴백 로직
- [ ] 로깅 추가

### 테스트
- [ ] 작은 파일 테스트 (10MB 이하)
- [ ] 큰 파일 테스트 (10MB 이상)
- [ ] 부분 실패 시나리오 테스트
- [ ] 재시도 로직 테스트
- [ ] SQL 쿼리로 상태 확인

### UI 개선 (선택)
- [ ] 문서 목록에 분할 진행률 표시
- [ ] 상세 다이얼로그에 분할 정보 표시

---

## 🎯 예상 효과

### 성공률
- **현재**: 15MB PDF → 0% (타임아웃)
- **중기 적용 후**: 15MB PDF → 90%+ (분할 처리)

### 처리 시간
- **현재**: 10분+ (타임아웃)
- **중기 적용 후**: 2-3분 (병렬 처리 시)

### 검색 품질
- 약간 저하 가능 (문맥이 끊길 수 있음)
- 하지만 큰 파일 처리 가능성이 우선

---

## ⚠️ 주의사항

1. **문맥 보존 없음**: 고정 크기 분할은 문맥을 끊을 수 있음
2. **메모리 사용**: 각 분할은 독립적으로 처리되므로 메모리 사용량 증가 가능
3. **재시도 로직**: 분할 실패 시 재시도는 기존 로직 활용
4. **트랜잭션**: 분할 저장과 job 등록의 원자성 보장 필요

---

## 📚 참고 문서

- `docs/long_term_plan_page_section_splitting.md` - 전체 계획
- `docs/page_splitting_short_mid_term_comparison.md` - 단기/중기/장기 비교
- `supabase/migrations/20250131_add_chunk_process_support.sql` - Phase 1 마이그레이션

---

## 🚀 다음 단계 (장기 계획)

Phase 2 완료 후, 장기 계획으로 진행:
- PDF 구조 분석 (페이지/섹션 감지)
- 의미 단위 분할
- 검색 품질 향상

---

**작성자**: AI Assistant  
**검토 필요**: 구현 전 기술 리뷰 권장

