-- 관리자 권한 관리를 위한 admin_users 테이블 생성
CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 고유 제약 조건
  UNIQUE(user_id),
  UNIQUE(email)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_admin_users_user_id ON admin_users(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_is_active ON admin_users(is_active);

-- RLS (Row Level Security) 활성화
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- 관리자는 모든 관리자 정보에 접근 가능
CREATE POLICY "Admin can manage all admin users" ON admin_users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- 서비스 역할은 모든 관리자 정보에 접근 가능
CREATE POLICY "Service role can manage all admin users" ON admin_users
  FOR ALL USING (auth.role() = 'service_role');

-- updated_at 자동 업데이트를 위한 트리거 함수
CREATE OR REPLACE FUNCTION update_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- updated_at 트리거 생성
CREATE TRIGGER update_admin_users_updated_at
    BEFORE UPDATE ON admin_users
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_users_updated_at();

-- 기존 하드코딩된 관리자 이메일들을 테이블에 삽입
INSERT INTO admin_users (user_id, email, is_active, granted_at)
SELECT 
  au.id as user_id,
  au.email,
  true as is_active,
  NOW() as granted_at
FROM auth.users au
WHERE au.email IN (
  'secho@nasmedia.co.kr',
  'woolela@nasmedia.co.kr',
  'dsko@nasmedia.co.kr',
  'hjchoi@nasmedia.co.kr',
  'sunjung@nasmedia.co.kr',
  'sy230@nasmedia.co.kr',
  'jeng351@nasmedia.co.kr'
)
ON CONFLICT (email) DO NOTHING;

-- 관리자 권한 확인을 위한 함수 생성
CREATE OR REPLACE FUNCTION is_admin_user(user_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_users 
    WHERE email = user_email AND is_active = true
  );
END;
$$;

-- 함수에 대한 실행 권한 부여
GRANT EXECUTE ON FUNCTION is_admin_user(TEXT) TO anon, authenticated;
