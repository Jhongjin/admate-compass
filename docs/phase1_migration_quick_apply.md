# Phase 1 마이그레이션 빠른 적용 가이드

**현재 상태**: "No rows returned" = Phase 1 마이그레이션이 아직 적용되지 않음

---

## 🚀 빠른 적용 방법

### 단계 1: 마이그레이션 파일 복사

아래 전체 SQL을 복사하세요:

```sql
-- Phase 1: 인프라 준비 - CHUNK_PROCESS job 타입 및 document_splits 테이블 추가
-- Created at: 2025-01-31

-- 1.1 processing_jobs 테이블에 CHUNK_PROCESS 타입 추가
-- CHECK 제약조건을 수정하여 CHUNK_PROCESS 추가
ALTER TABLE IF EXISTS public.processing_jobs
DROP CONSTRAINT IF EXISTS processing_jobs_job_type_check;

ALTER TABLE IF EXISTS public.processing_jobs
ADD CONSTRAINT processing_jobs_job_type_check 
CHECK (job_type IN ('OCR','PDF_PARSE','DOCX_PARSE','CRAWL','EMBEDDING','CHUNK_PROCESS'));

-- 1.2 문서 분할 상태 추적 테이블 생성
CREATE TABLE IF NOT EXISTS public.document_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  split_index INTEGER NOT NULL,
  split_count INTEGER NOT NULL,
  content TEXT NOT NULL,
  start_char INTEGER,
  end_char INTEGER,
  page_number INTEGER,
  section_title TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  job_id UUID REFERENCES public.processing_jobs(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(document_id, split_index)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_document_splits_document_id ON public.document_splits(document_id);
CREATE INDEX IF NOT EXISTS idx_document_splits_status ON public.document_splits(status);
CREATE INDEX IF NOT EXISTS idx_document_splits_job_id ON public.document_splits(job_id);

-- 1.3 documents 테이블에 split_status 컬럼 추가
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS split_status JSONB;

-- split_status 예시: { "total_splits": 5, "completed_splits": 3, "failed_splits": 0, "method": "page" }

-- RLS 활성화
ALTER TABLE public.document_splits ENABLE ROW LEVEL SECURITY;

-- 주석 추가
COMMENT ON TABLE public.document_splits IS '큰 문서를 분할 처리하기 위한 테이블';
COMMENT ON COLUMN public.document_splits.split_index IS '분할 인덱스 (0부터 시작)';
COMMENT ON COLUMN public.document_splits.split_count IS '전체 분할 개수';
COMMENT ON COLUMN public.document_splits.status IS '분할 처리 상태: pending, processing, completed, failed';
COMMENT ON COLUMN public.documents.split_status IS '문서 분할 진행 상황 (JSONB): { total_splits, completed_splits, failed_splits, method }';
```

### 단계 2: Supabase SQL Editor에서 실행

1. Supabase Dashboard → SQL Editor
2. "New query" 클릭
3. 위 SQL 전체를 붙여넣기
4. "Run" 버튼 클릭 (또는 Ctrl+Enter)
5. "Success" 메시지 확인

### 단계 3: 확인 SQL 재실행

1. `supabase/queries/check_phase1_infrastructure.sql` 파일 열기
2. 전체 내용 복사
3. SQL Editor에 붙여넣기
4. 실행
5. 결과 확인

---

## ✅ 예상 결과

마이그레이션 적용 후 확인 SQL 실행 시:

### 1.1 CHUNK_PROCESS job 타입
```
constraint_name: processing_jobs_job_type_check
constraint_definition: CHECK (job_type IN ('OCR','PDF_PARSE','DOCX_PARSE','CRAWL','EMBEDDING','CHUNK_PROCESS'))
```

### 1.2 document_splits 테이블 존재
```
table_exists: true
```

### 1.3 document_splits 테이블 구조
```
id | uuid
document_id | text
split_index | integer
split_count | integer
content | text
status | text
job_id | uuid
created_at | timestamptz
updated_at | timestamptz
```

### 1.6 documents.split_status 컬럼
```
column_name: split_status
data_type: jsonb
```

---

## ⚠️ 주의사항

### 마이그레이션 순서 확인

다음 테이블이 먼저 존재해야 합니다:

```sql
-- 확인 쿼리
SELECT 
  EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'processing_jobs') AS has_processing_jobs,
  EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'documents') AS has_documents;
```

둘 다 `true`여야 합니다.

---

## 🔧 문제 해결

### 에러: "relation processing_jobs does not exist"

**해결**: `processing_jobs` 테이블이 없으므로 먼저 생성해야 합니다.

```sql
-- 20251014_000001_vendor_and_jobs.sql 파일을 먼저 적용하세요
```

### 에러: "relation documents does not exist"

**해결**: `documents` 테이블이 없으므로 먼저 생성해야 합니다.

---

## 📝 완료 체크리스트

마이그레이션 적용 후:

- [ ] 마이그레이션 SQL 실행 완료 (Success)
- [ ] 확인 SQL 재실행 (에러 없음)
- [ ] `document_splits` 테이블 존재 확인 (true)
- [ ] `CHUNK_PROCESS` job 타입 확인 (포함됨)
- [ ] `documents.split_status` 컬럼 확인 (존재)

**모든 항목 체크 완료 시 Phase 1 완료!**

---

## 🎯 다음 단계

Phase 1 완료 후:

1. ✅ Phase 2 구현 시작: `docs/mid_term_phase1_2_detailed_plan.md` 참고
2. ✅ SimpleTextSplitter 서비스 구현
3. ✅ 큐 워커에 분할 로직 추가

