# Vercel Pro & Supabase Pro 최적화 가이드

## 📋 개요

Vercel과 Supabase가 Pro 플랜으로 업그레이드되었으므로, 추가 과금 없이 프로젝트 성능을 최적화하기 위한 설정 가이드를 제공합니다.

---

## 🔧 Vercel Pro 플랜 최적화

### 1. 서버리스 함수 타임아웃 설정 최적화

**현재 상황:**
- Pro 플랜 기본 타임아웃: **60초**
- Enterprise 플랜까지 확장 가능: **300초** (5분)

**최적화 방안:**
- 대용량 파일 처리 API는 `maxDuration` 설정을 활용
- RAG 파이프라인, 문서 인덱싱 등 시간 소요 작업에 적용

**권장 설정:**

```typescript
// src/app/api/admin/upload-new/route.ts
export const maxDuration = 300; // 5분 (Pro 플랜 최대값)

// src/app/api/rag/route.ts
export const maxDuration = 120; // 2분

// src/app/api/chatbot/route.ts
export const maxDuration = 60; // 1분 (기본값)
```

### 2. 빌드 최적화 설정

**Next.js 빌드 성능 향상:**

```javascript
// next.config.js 업데이트 권장 사항
const nextConfig = {
  // ... 기존 설정 ...
  
  // 컴파일러 최적화
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn']
    } : false,
  },
  
  // 프로덕션 빌드 최적화
  productionBrowserSourceMaps: false, // 소스맵 비활성화로 빌드 시간 단축
  
  // 실험적 기능 (Next.js 15)
  experimental: {
    optimizeCss: true, // CSS 최적화
    optimizePackageImports: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'], // 트리 쉐이킹 개선
  },
  
  // 출력 설정
  output: 'standalone', // 독립 실행 파일 생성으로 배포 속도 향상
};
```

### 3. Vercel 설정 파일 최적화

**vercel.json 업데이트:**

```json
{
  "crons": [
    {
      "path": "/api/admin/logs/process-alerts",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/jobs/consume",
      "schedule": "*/1 * * * *"
    }
  ],
  "functions": {
    "src/app/api/admin/upload-new/route.ts": {
      "maxDuration": 300
    },
    "src/app/api/rag/route.ts": {
      "maxDuration": 120
    },
    "src/app/api/chatbot/route.ts": {
      "maxDuration": 60
    },
    "src/app/api/admin/docs/upload/route.ts": {
      "maxDuration": 300
    }
  },
  "regions": ["icn1"], // 서울 리전 설정 (한국 사용자 최적화)
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        }
      ]
    }
  ]
}
```

### 4. 캐싱 전략 개선

**React Query 캐싱 설정:**

```typescript
// src/app/providers.tsx 업데이트
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5분 (Pro 플랜에서 더 긴 캐싱 가능)
      cacheTime: 30 * 60 * 1000, // 30분
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

**API 라우트 캐싱 헤더:**

```typescript
// src/app/api/latest-update/route.ts 예시
export async function GET() {
  const response = NextResponse.json(data);
  
  // Pro 플랜에서 Edge Cache 활용
  response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  
  return response;
}
```

### 5. 환경 변수 최적화

**Vercel 대시보드에서 설정 권장:**

1. **빌드 최적화 변수:**
   - `NEXT_PUBLIC_ENABLE_SENTRY=false` (모니터링 비활성화 시)
   - `NODE_ENV=production`

2. **성능 모니터링:**
   - Vercel Analytics 활성화 (Pro 플랜 포함)
   - Web Vitals 모니터링

---

## 🗄️ Supabase Pro 플랜 최적화

### 1. 데이터베이스 연결 풀링 설정

**현재 상황:**
- Pro 플랜: 최대 80개 동시 연결
- 연결 풀링 미활성화 가능성

**최적화 방안:**

```typescript
// src/lib/supabase/server.ts 업데이트
import { createClient } from '@supabase/supabase-js';

// 연결 풀링 설정
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(supabaseUrl!, supabaseKey!, {
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'x-client-info': 'meta-faq-chatbot',
    },
  },
  // 연결 재사용 최적화
  auth: {
    persistSession: false, // 서버 사이드에서는 세션 불필요
    autoRefreshToken: false,
  },
});
```

### 2. 벡터 검색 인덱스 최적화

**pgvector 인덱스 최적화 마이그레이션:**

```sql
-- supabase/migrations/YYYYMMDD_optimize_vector_indexes.sql

-- 1. 기존 인덱스 확인
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('document_chunks', 'documents')
ORDER BY tablename, indexname;

-- 2. 벡터 인덱스 재생성 (Pro 플랜에서 더 많은 리소스 활용)
DROP INDEX IF EXISTS idx_document_chunks_embedding;

-- HNSW 인덱스 생성 (IVFFlat보다 빠름, Pro 플랜에서 권장)
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
ON document_chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 3. 복합 인덱스 최적화
CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_vendor_status
ON document_chunks (document_id, metadata)
WHERE metadata->>'vendor' IS NOT NULL;

-- 4. 통계 업데이트 (Pro 플랜에서 더 자주 실행 가능)
ANALYZE document_chunks;
ANALYZE documents;

-- 5. 쿼리 성능 모니터링을 위한 함수
CREATE OR REPLACE FUNCTION get_vector_index_stats()
RETURNS TABLE (
  table_name TEXT,
  index_name TEXT,
  index_size TEXT,
  index_usage_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.tablename::TEXT,
    i.indexname::TEXT,
    pg_size_pretty(pg_relation_size(i.indexrelid))::TEXT,
    (SELECT COUNT(*) FROM pg_stat_user_indexes WHERE indexrelid = i.indexrelid)::BIGINT
  FROM pg_indexes i
  JOIN pg_tables t ON i.tablename = t.tablename
  WHERE i.tablename IN ('document_chunks', 'documents')
    AND i.indexname LIKE '%embedding%';
END;
$$ LANGUAGE plpgsql;
```

### 3. 검색 함수 성능 최적화

**벤더 필터링 검색 함수 개선:**

```sql
-- supabase/migrations/YYYYMMDD_optimize_search_function.sql

CREATE OR REPLACE FUNCTION search_documents(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    vendor_filter TEXT[] DEFAULT NULL
)
RETURNS TABLE (
    chunk_id TEXT,
    content TEXT,
    metadata JSONB,
    similarity float,
    document_id TEXT,
    title TEXT,
    source_vendor TEXT
)
LANGUAGE plpgsql
STABLE -- 함수가 데이터를 변경하지 않음을 명시 (쿼리 최적화)
AS $$
BEGIN
    RETURN QUERY
    WITH vendor_filtered AS (
        SELECT d.id
        FROM documents d
        WHERE d.status = 'indexed'
          AND (vendor_filter IS NULL OR COALESCE(d.source_vendor::TEXT, 'META') = ANY(vendor_filter))
    )
    SELECT 
        dc.chunk_id,
        dc.content,
        dc.metadata,
        1 - (dc.embedding <=> query_embedding) as similarity,
        dc.document_id,
        d.title,
        COALESCE(d.source_vendor::TEXT, 'META') as source_vendor
    FROM document_chunks dc
    JOIN vendor_filtered vf ON dc.document_id = vf.id
    JOIN documents d ON dc.document_id = d.id
    WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- 함수 권한 재설정
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION search_documents(vector(1024), float, int, TEXT[]) TO anon;
```

### 4. 데이터베이스 파라미터 튜닝

**Supabase 대시보드에서 설정할 수 있는 파라미터:**

1. **메모리 설정:**
   - `shared_buffers`: 데이터베이스 메모리의 25% (Pro 플랜에서 증가 가능)
   - `effective_cache_size`: 메모리의 50-75%

2. **쿼리 성능:**
   - `work_mem`: 복잡한 쿼리를 위한 작업 메모리 (현재: 16MB → Pro: 64MB 권장)
   - `maintenance_work_mem`: 인덱스 생성/유지보수 메모리 (현재: 64MB → Pro: 256MB 권장)

3. **벡터 검색 최적화:**
   - `max_parallel_workers_per_gather`: 병렬 쿼리 작업자 수

**참고:** Supabase Pro 플랜은 일부 파라미터를 직접 조정할 수 없지만, 지원팀에 요청하여 최적화 가능합니다.

### 5. 자동 백업 설정 확인

**Pro 플랜 백업 설정:**

- 자동 백업: 7일간 보관 (기본값)
- Point-in-time Recovery: 필요시 활성화 가능

**확인 방법:**
1. Supabase Dashboard → Settings → Database → Backups
2. 백업 스케줄 확인 및 필요시 조정

### 6. 연결 풀 설정 (Supabase PgBouncer)

**현재 설정 확인:**

```typescript
// Connection String 확인
// Transaction Pool (기본): 빠른 연결 재사용
// Session Pool: 세션 유지 필요시 사용

// 환경 변수 예시
// NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
// SUPABASE_SERVICE_ROLE_KEY=xxx
```

**최적화 권장사항:**
- 대부분의 쿼리는 Transaction Pool 사용 (기본값 유지)
- 세션이 필요한 경우에만 Session Pool 사용

### 7. RLS (Row Level Security) 정책 최적화

**현재 RLS 정책 성능 확인:**

```sql
-- RLS 정책 성능 모니터링 쿼리
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

**최적화 권장사항:**
- 인덱스와 호환되는 RLS 정책 사용
- 불필요한 정책 제거
- 복잡한 정책은 함수로 분리

---

## 📊 모니터링 및 알림 설정

### Vercel 모니터링

1. **Vercel Dashboard → Analytics**
   - Web Vitals 모니터링 활성화
   - Function 실행 시간 추적
   - 에러 로그 확인

2. **알림 설정:**
   - Functions 실행 시간 초과
   - 빌드 실패
   - 사용량 임계값 초과

### Supabase 모니터링

1. **Supabase Dashboard → Database → Performance**
   - 느린 쿼리 확인
   - 인덱스 사용률 모니터링
   - 연결 수 모니터링

2. **알림 설정:**
   - 데이터베이스 용량 80% 이상
   - 연결 수 임계값 초과
   - 백업 실패

---

## ✅ 최적화 체크리스트

### Vercel Pro 최적화
- [ ] 서버리스 함수 `maxDuration` 설정 확인 및 업데이트
- [ ] `vercel.json`에 함수별 타임아웃 설정
- [ ] Next.js 빌드 최적화 설정 적용
- [ ] Edge 캐싱 헤더 설정
- [ ] React Query 캐싱 시간 조정
- [ ] 지역 설정 (서울 리전) 확인
- [ ] Analytics 활성화

### Supabase Pro 최적화
- [ ] 벡터 인덱스 최적화 마이그레이션 실행
- [ ] 검색 함수 성능 개선
- [ ] 복합 인덱스 생성
- [ ] 통계 업데이트 (ANALYZE) 스케줄 확인
- [ ] 백업 설정 확인
- [ ] RLS 정책 성능 검토
- [ ] 연결 풀링 설정 확인
- [ ] 모니터링 대시보드 설정

---

## 🔍 직접 확인 방법

### Vercel 대시보드 접속
1. https://vercel.com 접속
2. 프로젝트 선택
3. Settings → Functions: 함수 타임아웃 확인
4. Settings → General: 지역 설정 확인
5. Analytics: 성능 메트릭 확인

### Supabase 대시보드 접속
1. https://supabase.com 접속
2. 프로젝트 선택
3. Database → Indexes: 인덱스 상태 확인
4. Database → Performance: 쿼리 성능 확인
5. Settings → Database: 백업 설정 확인

---

## 📝 참고 문서

- [Vercel Pro 플랜 가이드](https://vercel.com/docs/plans/pro-plan)
- [Supabase Pro 플랜 가이드](https://supabase.com/docs/guides/platform/limits)
- [pgvector 인덱싱 최적화](https://github.com/pgvector/pgvector#indexing)
- [Next.js 프로덕션 최적화](https://nextjs.org/docs/pages/building-your-application/optimizing)

---

## ⚠️ 주의사항

1. **추가 과금 방지:**
   - Vercel: 월 $20 크레딧 사용량 모니터링
   - Supabase: Spend Cap 활성화 확인

2. **백업 확인:**
   - 마이그레이션 실행 전 백업 권장
   - 프로덕션 환경에서 직접 테스트 전 스테이징 환경 검증

3. **점진적 적용:**
   - 한 번에 모든 최적화를 적용하지 말고 단계적으로 적용
   - 각 변경사항에 대해 성능 측정 및 모니터링

---

**작성일:** 2025-01-XX  
**적용 대상:** Vercel Pro, Supabase Pro 플랜

