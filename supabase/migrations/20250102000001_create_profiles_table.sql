-- Create profiles table for user profile information
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 이메일 중복 확인을 위한 RLS 정책 추가
-- 회원가입 시 이메일 중복 확인을 위해 익명 사용자도 이메일 존재 여부를 확인할 수 있도록 허용
CREATE POLICY "Allow email existence check for registration" ON profiles
  FOR SELECT USING (true);

-- 트리거 함수가 profiles 테이블에 INSERT할 수 있도록 허용
CREATE POLICY "Allow trigger to insert profiles" ON profiles
  FOR INSERT WITH CHECK (true);

-- Create function to handle user creation
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- RLS를 우회하여 profiles 테이블에 직접 삽입
  INSERT INTO public.profiles (id, email, name, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    NOW(),
    NOW()
  );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- 에러 발생 시 로그를 남기고 계속 진행
    RAISE LOG 'Error creating profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user creation
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 이메일 중복 확인을 위한 함수 생성
CREATE OR REPLACE FUNCTION check_email_exists(input_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- auth.users 테이블과 profiles 테이블 모두에서 이메일 존재 확인
  RETURN EXISTS (
    SELECT 1 FROM auth.users WHERE email = input_email
  ) OR EXISTS (
    SELECT 1 FROM profiles WHERE email = input_email
  );
END;
$$;

-- 함수에 대한 실행 권한 부여
GRANT EXECUTE ON FUNCTION check_email_exists(TEXT) TO anon, authenticated;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles(email);
CREATE INDEX IF NOT EXISTS profiles_name_idx ON profiles(name);