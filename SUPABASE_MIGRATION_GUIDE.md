# Supabase 마이그레이션 적용 가이드

## 현재 상황
✅ Supabase Dashboard → Database → Migrations 페이지에 접속하셨습니다.

## 마이그레이션 적용 방법

### 방법 1: Supabase CLI 사용 (권장)

#### 1단계: 프로젝트 연결
```bash
# 이미지에서 확인된 프로젝트 참조 ID 사용
supabase link --project-ref renjseslaqgfoxslxlyu
```

#### 2단계: 로컬 마이그레이션 파일 확인
프로젝트 루트에서 다음 파일들이 있는지 확인:
- `supabase/migrations/20250131_optimize_vector_indexes.sql`
- `supabase/migrations/20250131_optimize_search_function.sql`

#### 3단계: 마이그레이션 적용
```bash
# 모든 새 마이그레이션 적용
supabase db push

# 또는 특정 마이그레이션만 확인
supabase migration list
```

### 방법 2: SQL Editor를 통한 직접 실행

#### 1단계: SQL Editor 접속
1. Supabase Dashboard에서 **SQL Editor** 클릭
2. **New query** 버튼 클릭

#### 2단계: 첫 번째 마이그레이션 실행
1. `supabase/migrations/20250131_optimize_vector_indexes.sql` 파일 내용 복사
2. SQL Editor에 붙여넣기
3. **Run** 버튼 클릭하여 실행

#### 3단계: 두 번째 마이그레이션 실행
1. `supabase/migrations/20250131_optimize_search_function.sql` 파일 내용 복사
2. SQL Editor에 붙여넣기
3. **Run** 버튼 클릭하여 실행

#### 4단계: 결과 확인
SQL Editor에서 다음 쿼리로 확인:
```sql
-- 인덱스 생성 확인
SELECT * FROM get_vector_index_stats();

-- 함수 생성 확인
SELECT 
  proname as function_name,
  pg_get_functiondef(oid) as function_definition
FROM pg_proc 
WHERE proname = 'search_documents';
```

### 방법 3: Migration History 페이지에서 확인

현재 페이지(Database → Migrations)에서:
1. 마이그레이션이 성공적으로 적용되면 목록에 표시됩니다
2. 각 마이그레이션의 상태(성공/실패)를 확인할 수 있습니다
3. 마이그레이션 파일명이 타임스탬프 순서로 정렬됩니다

## 마이그레이션 파일 내용 요약

### 1. optimize_vector_indexes.sql
- **목적**: 벡터 검색 성능 개선
- **변경사항**: 
  - HNSW 인덱스 생성 (빠른 벡터 검색)
  - 복합 인덱스 생성 (벤더 필터링 성능 향상)
  - 인덱스 통계 모니터링 함수

### 2. optimize_search_function.sql
- **목적**: 검색 함수 성능 최적화
- **변경사항**:
  - STABLE 함수 선언으로 쿼리 최적화
  - CTE 활용으로 쿼리 성능 개선
  - 벤더 필터링 최적화

## 주의사항

⚠️ **프로덕션 환경 적용 전:**
1. 백업 확인 (Supabase Pro는 7일 자동 백업)
2. 스테이징 환경에서 먼저 테스트 권장
3. 적용 시간: 각 마이그레이션 약 1-3분 소요 (데이터 양에 따라 다름)

## 문제 해결

### 마이그레이션 실행 오류 시:
1. SQL Editor에서 오류 메시지 확인
2. 기존 인덱스/함수가 있는지 확인:
   ```sql
   -- 기존 인덱스 확인
   SELECT indexname FROM pg_indexes 
   WHERE tablename = 'document_chunks';
   
   -- 기존 함수 확인
   SELECT proname FROM pg_proc 
   WHERE proname = 'search_documents';
   ```
3. 필요시 기존 객체 삭제 후 재실행

### 성능 확인:
```sql
-- 인덱스 사용 통계 확인
SELECT * FROM get_vector_index_stats();

-- 검색 성능 테스트
SELECT AVG(execution_time_ms) as avg_time_ms
FROM test_search_performance(
  (SELECT embedding FROM document_chunks LIMIT 1)::vector(1024),
  10
);
```

## 다음 단계

마이그레이션 적용 후:
1. ✅ Database → Indexes에서 새 인덱스 확인
2. ✅ Database → Functions에서 새 함수 확인
3. ✅ Database → Performance에서 쿼리 성능 모니터링
4. ✅ 애플리케이션에서 벡터 검색 기능 테스트

