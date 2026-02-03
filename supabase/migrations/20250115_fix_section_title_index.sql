-- section_title 인덱스 크기 제한 문제 해결
-- 작성일: 2025-01-15
-- 목적: section_title 인덱스가 너무 큰 값으로 인해 실패하는 문제 해결

-- 1. 기존 인덱스 제거 (크기 제한 초과로 인해 실패할 수 있음)
DROP INDEX IF EXISTS idx_document_chunks_metadata_section_title;

-- 2. 함수 인덱스로 재생성 (MD5 해시 사용 또는 부분 문자열 사용)
-- 옵션 1: MD5 해시 인덱스 (정확한 매칭은 불가하지만 존재 여부 확인 가능)
-- CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata_section_title_hash
-- ON document_chunks (md5(metadata->>'section_title'))
-- WHERE (metadata->>'section_title') IS NOT NULL;

-- 옵션 2: 부분 문자열 인덱스 (처음 100자만 인덱싱, 가장 실용적)
CREATE INDEX IF NOT EXISTS idx_document_chunks_metadata_section_title
ON document_chunks (LEFT(metadata->>'section_title', 100))
WHERE (metadata->>'section_title') IS NOT NULL;

-- 3. 전체 텍스트 검색을 위한 GIN 인덱스 (이미 존재하는 경우 스킵)
-- metadata 전체에 대한 GIN 인덱스가 이미 있으므로 section_title 검색도 가능
-- 하지만 특정 section_title로 필터링할 때는 위의 부분 문자열 인덱스가 유용함

-- 참고: 
-- - LEFT() 함수는 처음 100자만 인덱싱하므로 인덱스 크기 제한을 피할 수 있음
-- - 100자 이상의 section_title은 인덱스에서 부분적으로만 매칭됨
-- - 정확한 매칭이 필요한 경우 GIN 인덱스를 사용하거나 애플리케이션 레벨에서 필터링

