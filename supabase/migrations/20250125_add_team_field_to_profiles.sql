-- 팀 필드 추가 마이그레이션
-- 실행 날짜: 2025-01-25
-- 목적: profiles 테이블에 team 필드 추가 및 기존 사용자 데이터 업데이트

-- 1. profiles 테이블에 team 컬럼 추가
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS team TEXT DEFAULT '미디어본부';

-- 2. team 컬럼에 대한 인덱스 생성 (통계 조회 성능 향상)
CREATE INDEX IF NOT EXISTS profiles_team_idx ON profiles(team);

-- 3. 기존 사용자들의 team을 '미디어본부'로 설정
UPDATE profiles 
SET team = '미디어본부' 
WHERE team IS NULL OR team = '';

-- 4. team 컬럼을 NOT NULL로 설정 (기본값이 있으므로 안전)
ALTER TABLE profiles 
ALTER COLUMN team SET NOT NULL;

-- 5. team 필드에 대한 제약 조건 추가 (허용된 팀만 선택 가능)
ALTER TABLE profiles 
ADD CONSTRAINT profiles_team_check 
CHECK (team IN (
  '1실', '2실', '3실', '4실', '5실', '6실', 
  '3본부', '미디어본부', '플랫폼본부', '경영본부'
));

-- 6. handle_new_user 함수 업데이트 (새 사용자 생성 시 team 필드 포함)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- RLS를 우회하여 profiles 테이블에 직접 삽입
  INSERT INTO public.profiles (id, email, name, team, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'team', '미디어본부'),
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

-- 7. 팀별 사용자 통계를 위한 뷰 생성
CREATE OR REPLACE VIEW team_user_stats AS
SELECT 
  team,
  COUNT(*) as user_count,
  COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_users_30d,
  COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as new_users_7d,
  MIN(created_at) as first_user_created,
  MAX(created_at) as last_user_created
FROM profiles
GROUP BY team
ORDER BY 
  CASE team
    WHEN '1실' THEN 1
    WHEN '2실' THEN 2
    WHEN '3실' THEN 3
    WHEN '4실' THEN 4
    WHEN '5실' THEN 5
    WHEN '6실' THEN 6
    WHEN '3본부' THEN 7
    WHEN '미디어본부' THEN 8
    WHEN '플랫폼본부' THEN 9
    WHEN '경영본부' THEN 10
    ELSE 99
  END;

-- 8. 팀별 사용자 통계 조회를 위한 함수 생성
CREATE OR REPLACE FUNCTION get_team_user_stats()
RETURNS TABLE (
  team TEXT,
  user_count BIGINT,
  new_users_30d BIGINT,
  new_users_7d BIGINT,
  first_user_created TIMESTAMP WITH TIME ZONE,
  last_user_created TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM team_user_stats;
END;
$$;

-- 함수에 대한 실행 권한 부여
GRANT EXECUTE ON FUNCTION get_team_user_stats() TO anon, authenticated;

-- 9. 팀별 질문 통계를 위한 뷰 생성 (conversations 테이블과 조인)
CREATE OR REPLACE VIEW team_question_stats AS
SELECT 
  p.team,
  COUNT(c.id) as question_count,
  COUNT(CASE WHEN c.created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as questions_30d,
  COUNT(CASE WHEN c.created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as questions_7d,
  NULL::NUMERIC as avg_response_time  -- response_time 컬럼이 없으므로 NULL로 설정
FROM profiles p
LEFT JOIN conversations c ON p.id = c.user_id
GROUP BY p.team
ORDER BY 
  CASE p.team
    WHEN '1실' THEN 1
    WHEN '2실' THEN 2
    WHEN '3실' THEN 3
    WHEN '4실' THEN 4
    WHEN '5실' THEN 5
    WHEN '6실' THEN 6
    WHEN '3본부' THEN 7
    WHEN '미디어본부' THEN 8
    WHEN '플랫폼본부' THEN 9
    WHEN '경영본부' THEN 10
    ELSE 99
  END;

-- 10. 팀별 질문 통계 조회를 위한 함수 생성
CREATE OR REPLACE FUNCTION get_team_question_stats()
RETURNS TABLE (
  team TEXT,
  question_count BIGINT,
  questions_30d BIGINT,
  questions_7d BIGINT,
  avg_response_time NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM team_question_stats;
END;
$$;

-- 함수에 대한 실행 권한 부여
GRANT EXECUTE ON FUNCTION get_team_question_stats() TO anon, authenticated;
