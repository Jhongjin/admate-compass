-- 문서 계층 구조 확인 쿼리
-- 메인 페이지와 하위 페이지 관계를 확인합니다.

-- 1. URL 타입 문서들의 경로 분석
WITH url_docs AS (
  SELECT 
    id,
    title,
    url,
    type,
    status,
    updated_at,
    -- URL 경로를 분리
    CASE 
      WHEN url IS NOT NULL THEN string_to_array(trim(both '/' from (regexp_replace(url, '^https?://[^/]+', ''))), '/')
      ELSE NULL
    END as path_parts,
    -- 경로 깊이 계산
    CASE 
      WHEN url IS NOT NULL THEN array_length(string_to_array(trim(both '/' from (regexp_replace(url, '^https?://[^/]+', ''))), '/'), 1)
      ELSE NULL
    END as path_depth
  FROM documents
  WHERE type = 'url' 
    AND url IS NOT NULL
    AND url LIKE '%developers.facebook.com/docs/marketing-api%'
  ORDER BY updated_at DESC
  LIMIT 30
),
-- 2. 부모-자식 관계 찾기
hierarchy AS (
  SELECT 
    d1.id as child_id,
    d1.title as child_title,
    d1.url as child_url,
    d1.path_depth as child_depth,
    d2.id as parent_id,
    d2.title as parent_title,
    d2.url as parent_url,
    d2.path_depth as parent_depth
  FROM url_docs d1
  CROSS JOIN url_docs d2
  WHERE d1.id != d2.id
    AND d1.path_depth > d2.path_depth
    -- d1의 경로가 d2의 경로로 시작하는지 확인
    AND (
      SELECT bool_and(d1.path_parts[i] = d2.path_parts[i])
      FROM generate_series(1, d2.path_depth) i
    )
  ORDER BY d1.path_depth, d2.path_depth DESC
)
-- 3. 결과 표시
SELECT 
  '메인 페이지' as doc_type,
  parent_id as id,
  parent_title as title,
  parent_url as url,
  parent_depth as depth,
  COUNT(DISTINCT child_id) as sub_page_count
FROM hierarchy
GROUP BY parent_id, parent_title, parent_url, parent_depth
UNION ALL
SELECT 
  '하위 페이지' as doc_type,
  child_id as id,
  child_title as title,
  child_url as url,
  child_depth as depth,
  0 as sub_page_count
FROM hierarchy
WHERE child_id NOT IN (SELECT DISTINCT parent_id FROM hierarchy WHERE parent_id IS NOT NULL)
ORDER BY doc_type, depth, title;

-- 4. 간단한 요약
SELECT 
  '요약' as info,
  COUNT(DISTINCT CASE WHEN path_depth = 2 THEN id END) as main_pages,
  COUNT(DISTINCT CASE WHEN path_depth > 2 THEN id END) as sub_pages,
  COUNT(*) as total_url_docs
FROM url_docs;

