-- DOCX 파일 청크 0 문제 디버깅 쿼리
-- 특정 문서 ID로 실행하여 상태 확인

-- ============================================
-- 1. 문서 기본 정보 확인
-- ============================================
SELECT 
  id,
  title,
  type,
  file_size,
  file_size / (1024 * 1024) as file_size_mb,
  status,
  chunk_count,
  split_status,
  LENGTH(content) as content_length,
  CASE 
    WHEN content IS NULL THEN 'NULL'
    WHEN content = '' THEN 'EMPTY'
    WHEN content LIKE 'BINARY_DATA:%' THEN 'BINARY_DATA'
    ELSE 'TEXT'
  END as content_type,
  LEFT(content, 50) as content_preview,
  created_at,
  updated_at
FROM documents
WHERE id = 'doc_1762397028761'  -- 여기에 문서 ID 입력
ORDER BY created_at DESC;

-- ============================================
-- 2. 처리 작업(job) 상태 확인
-- ============================================
SELECT 
  id,
  document_id,
  job_type,
  status,
  attempts,
  max_attempts,
  priority,
  payload->>'fileName' as file_name,
  payload->>'fileSize' as file_size,
  payload->>'split_index' as split_index,
  error,
  result,
  created_at,
  started_at,
  finished_at
FROM processing_jobs
WHERE document_id = 'doc_1762397028761'  -- 여기에 문서 ID 입력
ORDER BY created_at DESC;

-- ============================================
-- 3. 분할(split) 상태 확인
-- ============================================
SELECT 
  id,
  document_id,
  split_index,
  split_count,
  status,
  LENGTH(content) as split_content_length,
  job_id,
  created_at,
  updated_at
FROM document_splits
WHERE document_id = 'doc_1762397028761'  -- 여기에 문서 ID 입력
ORDER BY split_index;

-- ============================================
-- 4. 실제 청크 개수 확인
-- ============================================
SELECT 
  COUNT(*) as actual_chunk_count,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL AND jsonb_array_length(embedding::jsonb) > 0) as chunks_with_embedding
FROM document_chunks
WHERE document_id = 'doc_1762397028761';  -- 여기에 문서 ID 입력

-- ============================================
-- 5. 청크 상세 정보 (최대 10개)
-- ============================================
SELECT 
  chunk_id,
  LENGTH(content) as content_length,
  LEFT(content, 100) as content_preview,
  metadata->>'chunk_index' as chunk_index,
  metadata->>'source' as source,
  created_at
FROM document_chunks
WHERE document_id = 'doc_1762397028761'  -- 여기에 문서 ID 입력
ORDER BY CAST(metadata->>'chunk_index' AS INTEGER)
LIMIT 10;

-- ============================================
-- 6. 처리 메트릭 확인
-- ============================================
SELECT 
  job_id,
  document_id,
  bytes,
  dl_ms,
  parse_ms,
  total_ms,
  text_length,
  chunks,
  note
FROM processing_metrics
WHERE document_id = 'doc_1762397028761'  -- 여기에 문서 ID 입력
ORDER BY created_at DESC;

-- ============================================
-- 7. 종합 진단
-- ============================================
SELECT 
  '문서 정보' as category,
  d.id,
  d.title,
  d.status,
  d.chunk_count as db_chunk_count,
  LENGTH(d.content) as content_length,
  CASE 
    WHEN d.content LIKE 'BINARY_DATA:%' THEN '❌ BINARY_DATA (청킹 불가)'
    WHEN d.content IS NULL OR d.content = '' THEN '❌ 빈 텍스트'
    ELSE '✅ 텍스트'
  END as content_status
FROM documents d
WHERE d.id = 'doc_1762397028761'  -- 여기에 문서 ID 입력

UNION ALL

SELECT 
  '청크 개수' as category,
  d.id,
  d.title,
  d.status,
  COUNT(dc.chunk_id) as actual_chunk_count,
  NULL,
  CASE 
    WHEN COUNT(dc.chunk_id) = 0 THEN '❌ 청크 0개'
    WHEN COUNT(dc.chunk_id) = d.chunk_count THEN '✅ 일치'
    ELSE '⚠️ 불일치'
  END as status_check
FROM documents d
LEFT JOIN document_chunks dc ON d.id = dc.document_id
WHERE d.id = 'doc_1762397028761'  -- 여기에 문서 ID 입력
GROUP BY d.id, d.title, d.status, d.chunk_count

UNION ALL

SELECT 
  '분할 상태' as category,
  d.id,
  d.title,
  d.status,
  COUNT(ds.id) as split_count,
  NULL,
  CASE 
    WHEN d.split_status IS NULL THEN '✅ 분할 없음 (일반 처리)'
    WHEN COUNT(ds.id) = 0 THEN '❌ 분할 저장 실패'
    ELSE CONCAT('✅ 분할 ', COUNT(ds.id), '개')
  END as split_status
FROM documents d
LEFT JOIN document_splits ds ON d.id = ds.document_id
WHERE d.id = 'doc_1762397028761'  -- 여기에 문서 ID 입력
GROUP BY d.id, d.title, d.status, d.split_status

UNION ALL

SELECT 
  'CHUNK_PROCESS job' as category,
  d.id,
  d.title,
  d.status,
  COUNT(pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS') as chunk_process_jobs,
  NULL,
  CASE 
    WHEN COUNT(pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS') = 0 THEN '✅ 분할 없음 (일반 처리)'
    WHEN COUNT(pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS' AND pj.status = 'completed') = COUNT(pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS') THEN '✅ 모든 분할 완료'
    ELSE CONCAT('⚠️ 진행 중: ', COUNT(pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS' AND pj.status = 'queued'), '개 대기, ', COUNT(pj.id) FILTER (WHERE pj.job_type = 'CHUNK_PROCESS' AND pj.status = 'processing'), '개 처리중')
  END as chunk_process_status
FROM documents d
LEFT JOIN processing_jobs pj ON d.id = pj.document_id
WHERE d.id = 'doc_1762397028761'  -- 여기에 문서 ID 입력
GROUP BY d.id, d.title, d.status;

