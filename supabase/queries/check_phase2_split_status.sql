-- Phase 2 분할 처리 상태 확인 쿼리
-- 큰 파일 분할 처리 후 실행하여 상태를 확인하세요

-- ============================================
-- 1. 분할 처리 중인 문서 목록
-- ============================================
SELECT 
  d.id,
  d.title,
  d.status as document_status,
  d.chunk_count,
  d.split_status->>'total_splits' as total_splits,
  d.split_status->>'completed_splits' as completed_splits,
  d.split_status->>'failed_splits' as failed_splits,
  d.split_status->>'method' as split_method,
  d.updated_at
FROM documents d
WHERE d.split_status IS NOT NULL
ORDER BY d.updated_at DESC;

-- ============================================
-- 2. 특정 문서의 분할 상세 정보
-- ============================================
-- YOUR_DOCUMENT_ID를 실제 문서 ID로 변경하세요
SELECT 
  ds.split_index,
  ds.split_count,
  ds.status,
  LENGTH(ds.content) as content_length,
  ds.start_char,
  ds.end_char,
  ds.job_id,
  ds.created_at,
  ds.updated_at,
  pj.status as job_status,
  pj.attempts,
  pj.error
FROM document_splits ds
LEFT JOIN processing_jobs pj ON ds.job_id = pj.id
WHERE ds.document_id = 'YOUR_DOCUMENT_ID'  -- 여기에 문서 ID 입력
ORDER BY ds.split_index;

-- ============================================
-- 3. CHUNK_PROCESS job 상태
-- ============================================
SELECT 
  pj.id,
  pj.document_id,
  pj.status,
  pj.attempts,
  pj.max_attempts,
  pj.payload->>'split_index' as split_index,
  pj.started_at,
  pj.finished_at,
  pj.error,
  pj.result
FROM processing_jobs pj
WHERE pj.job_type = 'CHUNK_PROCESS'
ORDER BY pj.created_at DESC
LIMIT 20;

-- ============================================
-- 4. 특정 문서의 CHUNK_PROCESS job 상태
-- ============================================
-- YOUR_DOCUMENT_ID를 실제 문서 ID로 변경하세요
SELECT 
  pj.id,
  pj.status,
  pj.attempts,
  pj.payload->>'split_index' as split_index,
  pj.started_at,
  pj.finished_at,
  pj.error,
  pj.result->>'chunk_count' as chunk_count,
  pj.result->>'process_time_ms' as process_time_ms
FROM processing_jobs pj
WHERE pj.job_type = 'CHUNK_PROCESS'
  AND pj.document_id = 'YOUR_DOCUMENT_ID'  -- 여기에 문서 ID 입력
ORDER BY CAST(pj.payload->>'split_index' AS INTEGER);

-- ============================================
-- 5. 분할 처리 진행률 요약
-- ============================================
SELECT 
  d.id,
  d.title,
  d.status as document_status,
  d.chunk_count,
  d.split_status->>'total_splits' as total_splits,
  d.split_status->>'completed_splits' as completed_splits,
  d.split_status->>'failed_splits' as failed_splits,
  COUNT(DISTINCT ds.id) as actual_split_count,
  COUNT(DISTINCT ds.id) FILTER (WHERE ds.status = 'completed') as actual_completed,
  COUNT(DISTINCT ds.id) FILTER (WHERE ds.status = 'failed') as actual_failed,
  COUNT(DISTINCT pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS') as chunk_process_jobs,
  COUNT(DISTINCT pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS' AND pj.status = 'completed') as completed_jobs,
  COUNT(DISTINCT pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS' AND pj.status = 'failed') as failed_jobs,
  CASE 
    WHEN d.split_status->>'completed_splits' = d.split_status->>'total_splits' 
    THEN '✅ 완료'
    WHEN d.split_status->>'completed_splits'::int > 0 
    THEN '🔄 진행 중'
    ELSE '⏳ 대기'
  END as progress_status
FROM documents d
LEFT JOIN document_splits ds ON d.id = ds.document_id
LEFT JOIN processing_jobs pj ON d.id = pj.document_id AND pj.job_type = 'CHUNK_PROCESS'
WHERE d.split_status IS NOT NULL
GROUP BY d.id, d.title, d.status, d.chunk_count, d.split_status
ORDER BY d.updated_at DESC;

-- ============================================
-- 6. 분할별 청크 수 확인
-- ============================================
-- 특정 문서의 각 분할이 생성한 청크 수 확인
-- YOUR_DOCUMENT_ID를 실제 문서 ID로 변경하세요
SELECT 
  ds.split_index,
  ds.status,
  COUNT(DISTINCT dc.chunk_id) as chunks_created
FROM document_splits ds
LEFT JOIN document_chunks dc ON ds.document_id = dc.document_id
  AND dc.metadata->>'chunk_index' IS NOT NULL
WHERE ds.document_id = 'YOUR_DOCUMENT_ID'  -- 여기에 문서 ID 입력
GROUP BY ds.split_index, ds.status
ORDER BY ds.split_index;

