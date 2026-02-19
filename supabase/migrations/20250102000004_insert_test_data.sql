-- 테스트 데이터 삽입 (1024차원 벡터 사용)

-- 테스트용 문서 데이터 삽입
INSERT INTO documents (id, title, type, status, chunk_count) VALUES
('test_doc_001', '테스트 PDF 문서', 'file', 'indexed', 3),
('test_doc_002', '테스트 URL 문서', 'url', 'indexed', 2);

-- 테스트용 메타데이터 삽입
INSERT INTO document_metadata (id, title, type, size, uploaded_at, status, chunk_count, embedding_count) VALUES
('test_doc_001', '테스트 PDF 문서', 'pdf', 1024, NOW(), 'completed', 3, 3),
('test_doc_002', '테스트 URL 문서', 'url', 512, NOW(), 'completed', 2, 2);

-- 테스트용 청크 데이터 삽입 (1024차원 Mock 벡터)
-- 실제로는 BGE-M3 모델이 생성한 벡터를 사용해야 하지만, 테스트용으로 랜덤 벡터 생성
INSERT INTO document_chunks (document_id, chunk_id, content, embedding, metadata) VALUES
('test_doc_001', 'test_doc_001_chunk_0', '첫 번째 청크 내용입니다. 이는 테스트용 PDF 문서의 첫 번째 부분입니다.', 
 ARRAY_FILL(0.1, ARRAY[1024])::vector(1024), 
 '{"chunkIndex": 0, "chunkType": "text", "pageNumber": 1}'),
('test_doc_001', 'test_doc_001_chunk_1', '두 번째 청크 내용입니다. 이는 테스트용 PDF 문서의 두 번째 부분입니다.', 
 ARRAY_FILL(0.2, ARRAY[1024])::vector(1024), 
 '{"chunkIndex": 1, "chunkType": "text", "pageNumber": 1}'),
('test_doc_001', 'test_doc_001_chunk_2', '세 번째 청크 내용입니다. 이는 테스트용 PDF 문서의 세 번째 부분입니다.', 
 ARRAY_FILL(0.3, ARRAY[1024])::vector(1024), 
 '{"chunkIndex": 2, "chunkType": "text", "pageNumber": 2}'),
('test_doc_002', 'test_doc_002_chunk_0', 'URL에서 추출한 첫 번째 청크입니다. 웹페이지의 메인 콘텐츠입니다.', 
 ARRAY_FILL(0.4, ARRAY[1024])::vector(1024), 
 '{"chunkIndex": 0, "chunkType": "text", "url": "https://example.com"}'),
('test_doc_002', 'test_doc_002_chunk_1', 'URL에서 추출한 두 번째 청크입니다. 웹페이지의 부가 정보입니다.', 
 ARRAY_FILL(0.5, ARRAY[1024])::vector(1024), 
 '{"chunkIndex": 1, "chunkType": "text", "url": "https://example.com"}');

-- 테스트용 처리 로그 삽입
INSERT INTO document_processing_logs (document_id, step, status, message, metadata) VALUES
('test_doc_001', 'file_processing', 'completed', 'PDF 파일 처리 완료', '{"fileName": "test.pdf", "pages": 2}'),
('test_doc_001', 'text_chunking', 'completed', '텍스트 청킹 완료', '{"chunks": 3}'),
('test_doc_001', 'embedding_generation', 'completed', '임베딩 생성 완료', '{"embeddings": 3}'),
('test_doc_002', 'url_processing', 'completed', 'URL 크롤링 완료', '{"url": "https://example.com"}'),
('test_doc_002', 'text_chunking', 'completed', '텍스트 청킹 완료', '{"chunks": 2}'),
('test_doc_002', 'embedding_generation', 'completed', '임베딩 생성 완료', '{"embeddings": 2}');

