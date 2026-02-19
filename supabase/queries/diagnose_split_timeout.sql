-- 타임아웃 원인 진단 쿼리
-- 큰 파일 업로드 후 실행하여 분할 처리 상태 확인

-- ============================================
-- 1. 최근 업로드된 큰 파일 확인
-- ============================================
SELECT 
  id,
  title,
  file_size,
  file_size / (1024 * 1024) as file_size_mb,
  LENGTH(content) as text_length,
  LENGTH(content) / 1024 as text_length_kb,
  status,
  chunk_count,
  split_status,
  created_at,
  updated_at
FROM documents
WHERE file_size > 10 * 1024 * 1024  -- 10MB 이상
   OR (content IS NOT NULL AND LENGTH(content) > 500 * 1024)  -- 500KB 텍스트 이상
ORDER BY created_at DESC
LIMIT 10;

-- ============================================
-- 2. 분할이 발생했는지 확인
-- ============================================
-- 특정 문서 ID로 확인 (YOUR_DOCUMENT_ID 변경 필요)
SELECT 
  d.id,
  d.title,
  d.file_size / (1024 * 1024) as file_size_mb,
  LENGTH(d.content) / 1024 as text_length_kb,
  d.status,
  d.split_status,
  COUNT(ds.id) as split_count,
  CASE 
    WHEN d.split_status IS NOT NULL THEN '✅ 분할 발생'
    WHEN d.file_size > 10 * 1024 * 1024 THEN '❌ 분할 미발생 (파일 크기 조건)'
    WHEN LENGTH(d.content) > 500 * 1024 THEN '❌ 분할 미발생 (텍스트 길이 조건)'
    ELSE '❓ 분할 조건 미충족'
  END as split_status_check
FROM documents d
LEFT JOIN document_splits ds ON d.id = ds.document_id
WHERE d.id = 'YOUR_DOCUMENT_ID'  -- 여기에 문서 ID 입력
GROUP BY d.id, d.title, d.file_size, d.content, d.status, d.split_status;

-- ============================================
-- 3. CHUNK_PROCESS job 등록 여부 확인
-- ============================================
SELECT 
  pj.id,
  pj.document_id,
  pj.job_type,
  pj.status,
  pj.attempts,
  pj.max_attempts,
  pj.payload->>'split_index' as split_index,
  pj.scheduled_at,
  pj.created_at,
  pj.started_at,
  pj.finished_at,
  pj.error,
  CASE 
    WHEN pj.status = 'queued' THEN '⏳ 대기 중'
    WHEN pj.status = 'processing' THEN '🔄 처리 중'
    WHEN pj.status = 'completed' THEN '✅ 완료'
    WHEN pj.status = 'failed' THEN '❌ 실패'
    WHEN pj.status = 'retrying' THEN '🔄 재시도 중'
    ELSE '❓ 알 수 없음'
  END as status_description
FROM processing_jobs pj
WHERE pj.job_type = 'CHUNK_PROCESS'
ORDER BY pj.created_at DESC
LIMIT 20;

-- ============================================
-- 4. 분할 처리 진행 상황 상세 확인
-- ============================================
SELECT 
  ds.document_id,
  ds.split_index,
  ds.split_count,
  ds.status as split_status,
  LENGTH(ds.content) / 1024 as split_size_kb,
  ds.job_id,
  ds.created_at as split_created,
  ds.updated_at as split_updated,
  pj.status as job_status,
  pj.attempts,
  pj.started_at,
  pj.finished_at,
  EXTRACT(EPOCH FROM (pj.finished_at - pj.started_at)) as process_time_seconds,
  pj.error,
  CASE 
    WHEN ds.status = 'completed' THEN '✅ 완료'
    WHEN ds.status = 'processing' AND pj.status = 'processing' THEN '🔄 처리 중'
    WHEN ds.status = 'processing' AND pj.status = 'failed' THEN '❌ 처리 실패'
    WHEN ds.status = 'pending' AND pj.status = 'queued' THEN '⏳ 대기 중'
    WHEN ds.status = 'failed' THEN '❌ 실패'
    ELSE '❓ 상태 불명확'
  END as status_summary
FROM document_splits ds
LEFT JOIN processing_jobs pj ON ds.job_id = pj.id
WHERE ds.document_id = 'YOUR_DOCUMENT_ID'  -- 여기에 문서 ID 입력
ORDER BY ds.split_index;

-- ============================================
-- 5. 타임아웃 원인 분석
-- ============================================
-- 분할이 발생했지만 처리되지 않는 경우
SELECT 
  '분할은 발생했지만 CHUNK_PROCESS job이 처리되지 않음' as issue_type,
  COUNT(*) as count,
  STRING_AGG(DISTINCT d.id::text, ', ') as document_ids
FROM documents d
INNER JOIN document_splits ds ON d.id = ds.document_id
LEFT JOIN processing_jobs pj ON ds.job_id = pj.id
WHERE d.split_status IS NOT NULL
  AND ds.status != 'completed'
  AND (pj.status IS NULL OR pj.status = 'queued')
GROUP BY issue_type

UNION ALL

-- 분할이 발생하지 않은 큰 파일
SELECT 
  '큰 파일인데 분할이 발생하지 않음' as issue_type,
  COUNT(*) as count,
  STRING_AGG(d.id::text, ', ') as document_ids
FROM documents d
WHERE (d.file_size > 10 * 1024 * 1024 OR LENGTH(d.content) > 500 * 1024)
  AND d.split_status IS NULL
  AND d.status = 'failed'
GROUP BY issue_type

UNION ALL

-- CHUNK_PROCESS job이 실패한 경우
SELECT 
  'CHUNK_PROCESS job 처리 실패' as issue_type,
  COUNT(*) as count,
  STRING_AGG(DISTINCT pj.document_id::text, ', ') as document_ids
FROM processing_jobs pj
WHERE pj.job_type = 'CHUNK_PROCESS'
  AND pj.status = 'failed'
  AND pj.error LIKE '%타임아웃%'
GROUP BY issue_type;

-- ============================================
-- 6. 분할 크기별 처리 시간 분석
-- ============================================
SELECT 
  ds.split_index,
  LENGTH(ds.content) / 1024 as split_size_kb,
  ds.status,
  EXTRACT(EPOCH FROM (pj.finished_at - pj.started_at)) as process_time_seconds,
  pj.error
FROM document_splits ds
LEFT JOIN processing_jobs pj ON ds.job_id = pj.id
WHERE ds.document_id = 'YOUR_DOCUMENT_ID'  -- 여기에 문서 ID 입력
  AND pj.status = 'completed'
ORDER BY ds.split_index;

