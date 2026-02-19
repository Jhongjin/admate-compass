-- url_templates 테이블에 vendor 컬럼 추가
-- Created: 2025-01-31

-- 1) vendor_enum 타입이 없으면 생성
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'vendor_enum'
  ) THEN
    CREATE TYPE vendor_enum AS ENUM ('META', 'NAVER', 'KAKAO', 'GOOGLE', 'OTHER');
  END IF;
END $$;

-- 2) vendor 컬럼 추가 (기본값 없이)
ALTER TABLE IF EXISTS public.url_templates
ADD COLUMN IF NOT EXISTS vendor TEXT;

-- 3) 기존 템플릿의 vendor를 META로 설정
UPDATE public.url_templates
SET vendor = 'META'
WHERE vendor IS NULL OR vendor = '';

-- 4) vendor 컬럼을 vendor_enum 타입으로 변경 (기본값 제거 후 타입 변경)
ALTER TABLE IF EXISTS public.url_templates
ALTER COLUMN vendor DROP DEFAULT;

ALTER TABLE IF EXISTS public.url_templates
ALTER COLUMN vendor TYPE vendor_enum USING (
  CASE
    WHEN vendor IN ('META','NAVER','KAKAO','GOOGLE','OTHER') THEN vendor::vendor_enum
    ELSE 'META'::vendor_enum
  END
);

-- 5) vendor 컬럼에 기본값 설정
ALTER TABLE IF EXISTS public.url_templates
ALTER COLUMN vendor SET DEFAULT 'META'::vendor_enum;

-- 6) vendor 컬럼에 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_url_templates_vendor ON public.url_templates(vendor);

