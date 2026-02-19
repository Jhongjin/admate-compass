-- URL 템플릿 테이블 생성
CREATE TABLE IF NOT EXISTS url_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  urls TEXT[] NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 기본 템플릿 데이터 삽입
INSERT INTO url_templates (name, urls) VALUES
('Facebook Business (한국어)', ARRAY['https://ko-kr.facebook.com/business']),
('Instagram Business (한국어)', ARRAY['https://business.instagram.com/help/ko/']),
('Meta 개발자 문서 (한국어)', ARRAY['https://developers.facebook.com/docs/marketing-api/ko/']),
('Facebook Help (영어)', ARRAY['https://www.facebook.com/help/']),
('Facebook Business (영어)', ARRAY['https://www.facebook.com/business/help/']),
('Instagram Business (영어)', ARRAY['https://business.instagram.com/help/']),
('Meta 개발자 문서 (영어)', ARRAY['https://developers.facebook.com/docs/marketing-api/'])
ON CONFLICT (name) DO NOTHING;

-- 업데이트 시간 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_url_templates_updated_at 
    BEFORE UPDATE ON url_templates 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
