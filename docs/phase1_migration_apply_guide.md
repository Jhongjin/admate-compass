# Phase 1 마이그레이션 적용 가이드

**목적**: Phase 1 인프라 준비를 위한 마이그레이션 파일 적용

---

## 🔍 현재 상태

**에러 메시지**: `relation "public.document_splits" does not exist`

**의미**: Phase 1 마이그레이션이 아직 적용되지 않았습니다.

---

## 📋 적용할 마이그레이션 파일

**파일 경로**: `supabase/migrations/20250131_add_chunk_process_support.sql`

**내용 요약**:
1. `CHUNK_PROCESS` job 타입 추가
2. `document_splits` 테이블 생성
3. `documents.split_status` 컬럼 추가
4. 인덱스 생성
5. RLS 활성화

---

## 🚀 적용 방법

### 방법 1: Supabase SQL Editor 사용 (권장)

1. **Supabase Dashboard 접속**
   - https://supabase.com/dashboard
   - 프로젝트 선택

2. **SQL Editor 열기**
   - 왼쪽 메뉴에서 "SQL Editor" 클릭
   - "New query" 버튼 클릭

3. **마이그레이션 파일 내용 복사**
   - 로컬 파일 열기: `supabase/migrations/20250131_add_chunk_process_support.sql`
   - 전체 내용 복사 (Ctrl+A, Ctrl+C)

4. **SQL Editor에 붙여넣기**
   - SQL Editor에 붙여넣기 (Ctrl+V)

5. **실행**
   - "Run" 버튼 클릭 또는 `Ctrl+Enter`
   - 실행 결과 확인

6. **확인**
   - 확인 SQL 실행: `supabase/queries/check_phase1_infrastructure.sql`
   - 모든 항목이 통과하는지 확인

---

### 방법 2: Supabase CLI 사용 (선택사항)

만약 Supabase CLI를 사용 중이라면:

```bash
# 마이그레이션 적용
supabase db push

# 또는 특정 마이그레이션만 적용
supabase migration up
```

---

## ⚠️ 주의사항

### 마이그레이션 순서

다음 마이그레이션 파일이 먼저 적용되어 있어야 합니다:

1. ✅ `20251014_000001_vendor_and_jobs.sql` - `processing_jobs` 테이블 생성
2. ✅ `20250131_add_chunk_process_support.sql` - Phase 1 인프라 (이 파일)

만약 `processing_jobs` 테이블이 없다면 먼저 적용해야 합니다.

### 확인 사항

마이그레이션 적용 전 확인:

```sql
-- processing_jobs 테이블 존재 확인
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'processing_jobs'
) AS processing_jobs_exists;

-- documents 테이블 존재 확인
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'documents'
) AS documents_exists;
```

둘 다 `true`여야 합니다.

---

## ✅ 적용 후 확인

마이그레이션 적용 후 다음 SQL로 확인:

```sql
-- 1. document_splits 테이블 존재 확인
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'document_splits'
) AS table_exists;

-- 2. CHUNK_PROCESS job 타입 확인
SELECT 
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.processing_jobs'::regclass
  AND conname = 'processing_jobs_job_type_check';

-- 3. split_status 컬럼 확인
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'documents'
  AND column_name = 'split_status';
```

**예상 결과**:
- `table_exists`: `true`
- `constraint_definition`: `CHUNK_PROCESS` 포함
- `column_name`: `split_status` 존재

---

## 🔧 문제 해결

### 문제 1: "relation processing_jobs does not exist"

**원인**: `processing_jobs` 테이블이 없음

**해결**:
1. `supabase/migrations/20251014_000001_vendor_and_jobs.sql` 파일 확인
2. 해당 마이그레이션을 먼저 적용

### 문제 2: "relation documents does not exist"

**원인**: `documents` 테이블이 없음

**해결**:
1. `supabase/migrations/20250102000000_create_document_tables.sql` 파일 확인
2. 해당 마이그레이션을 먼저 적용

### 문제 3: "constraint already exists"

**원인**: 일부 마이그레이션이 이미 적용됨

**해결**:
- 마이그레이션 파일은 `IF NOT EXISTS`를 사용하므로 안전하게 재실행 가능
- 전체 마이그레이션을 다시 실행해도 문제 없음

---

## 📝 마이그레이션 파일 내용 요약

```sql
-- 1. CHUNK_PROCESS job 타입 추가
ALTER TABLE IF EXISTS public.processing_jobs
DROP CONSTRAINT IF EXISTS processing_jobs_job_type_check;

ALTER TABLE IF EXISTS public.processing_jobs
ADD CONSTRAINT processing_jobs_job_type_check 
CHECK (job_type IN ('OCR','PDF_PARSE','DOCX_PARSE','CRAWL','EMBEDDING','CHUNK_PROCESS'));

-- 2. document_splits 테이블 생성
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

-- 3. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_document_splits_document_id ON public.document_splits(document_id);
CREATE INDEX IF NOT EXISTS idx_document_splits_status ON public.document_splits(status);
CREATE INDEX IF NOT EXISTS idx_document_splits_job_id ON public.document_splits(job_id);

-- 4. documents.split_status 컬럼 추가
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS split_status JSONB;

-- 5. RLS 활성화
ALTER TABLE public.document_splits ENABLE ROW LEVEL SECURITY;
```

---

## ✅ 완료 체크리스트

마이그레이션 적용 후:

- [ ] 마이그레이션 파일 실행 완료 (에러 없음)
- [ ] `document_splits` 테이블 존재 확인
- [ ] `CHUNK_PROCESS` job 타입 확인
- [ ] `documents.split_status` 컬럼 확인
- [ ] 인덱스 생성 확인
- [ ] 확인 SQL 재실행 (에러 없음)

**모든 항목 체크 완료 시 Phase 1 인프라 준비 완료!**

---

## 📚 다음 단계

Phase 1 마이그레이션 적용 완료 후:

1. ✅ 확인 SQL 재실행: `supabase/queries/check_phase1_infrastructure.sql`
2. ✅ 모든 항목 통과 확인
3. ✅ Phase 2 구현 시작: `docs/mid_term_phase1_2_detailed_plan.md` 참고

