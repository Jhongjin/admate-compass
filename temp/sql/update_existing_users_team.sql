-- 기존 사용자들의 팀 정보를 '미디어본부'로 업데이트
UPDATE profiles 
SET team = '미디어본부' 
WHERE team IS NULL OR team = '';

-- 업데이트 결과 확인
SELECT id, email, name, team, created_at 
FROM profiles 
ORDER BY created_at DESC;
