-- documents 테이블의 status 제약 조건 수정
-- completed 상태를 허용하도록 제약 조건 업데이트

-- 기존 제약 조건 삭제
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;

-- 새로운 제약 조건 추가 (completed 상태 포함)
ALTER TABLE documents ADD CONSTRAINT documents_status_check 
CHECK (status IN ('pending', 'processing', 'indexed', 'completed', 'failed', 'error'));

-- 기존 데이터의 상태 정리
-- processing 상태인 문서들을 completed로 변경 (이미 완료된 것으로 간주)
UPDATE documents 
SET status = 'completed', updated_at = NOW()
WHERE status = 'processing' 
AND id IN (
  SELECT d.id 
  FROM documents d
  LEFT JOIN document_metadata dm ON d.id = dm.id
  WHERE d.status = 'processing' 
  AND (dm.status = 'completed' OR dm.chunk_count > 0)
);

-- indexed 상태인 문서들을 completed로 통일
UPDATE documents 
SET status = 'completed', updated_at = NOW()
WHERE status = 'indexed';










