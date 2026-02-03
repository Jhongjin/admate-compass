-- discovered_urls 테이블 생성
-- URL 탐색 결과를 임시로 저장하는 테이블
CREATE TABLE IF NOT EXISTS discovered_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES processing_jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  depth INTEGER NOT NULL,
  parent_url TEXT,
  path JSONB DEFAULT '[]'::jsonb, -- seed부터 현재까지 경로 배열
  source TEXT NOT NULL, -- 'sitemap' | 'robots' | 'links' | 'pattern'
  selected BOOLEAN DEFAULT false, -- 사용자가 선택했는지 여부
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_discovered_urls_job_id ON discovered_urls(job_id);
CREATE INDEX IF NOT EXISTS idx_discovered_urls_url ON discovered_urls(url);
CREATE INDEX IF NOT EXISTS idx_discovered_urls_depth ON discovered_urls(depth);
CREATE INDEX IF NOT EXISTS idx_discovered_urls_selected ON discovered_urls(selected);

-- updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_discovered_urls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_discovered_urls_updated_at
  BEFORE UPDATE ON discovered_urls
  FOR EACH ROW
  EXECUTE FUNCTION update_discovered_urls_updated_at();

-- 오래된 탐색 결과 자동 삭제 (90일 이상 된 데이터)
-- 주기적으로 실행할 수 있도록 함수 생성
CREATE OR REPLACE FUNCTION cleanup_old_discovered_urls()
RETURNS void AS $$
BEGIN
  DELETE FROM discovered_urls
  WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;

-- 주석 추가
COMMENT ON TABLE discovered_urls IS 'URL 탐색 결과를 임시로 저장하는 테이블. 사용자가 선택한 페이지만 크롤링에 사용됨.';
COMMENT ON COLUMN discovered_urls.job_id IS 'processing_jobs 테이블의 DISCOVER_URLS 작업 ID';
COMMENT ON COLUMN discovered_urls.depth IS 'seed URL로부터의 깊이 (0: seed, 1: 직접 링크, 2: 2단계 링크, ...)';
COMMENT ON COLUMN discovered_urls.path IS 'seed부터 현재 URL까지의 경로 배열';
COMMENT ON COLUMN discovered_urls.selected IS '사용자가 크롤링을 위해 선택했는지 여부';

