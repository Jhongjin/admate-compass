# CASCADE 삭제 수정 - 영구적 해결책

## 문제 상황
woolela@nasmedia.co.kr 사용자가 회원탈퇴했지만 관련 테이블(profiles, admin_users)에 데이터가 남아있는 문제가 발생했습니다.

## 원인 분석
Supabase Auth에서 사용자를 삭제할 때 `supabase.auth.admin.deleteUser()`를 사용하는데, 이는 데이터베이스의 CASCADE와는 별개로 작동하여 관련 데이터가 자동으로 삭제되지 않습니다.

## 영구적 해결책

### 1. 마이그레이션 파일 적용
생성된 마이그레이션 파일 `supabase/migrations/20250125_fix_cascade_deletion.sql`을 Supabase에 적용하세요.

**Supabase Dashboard에서 실행:**
1. Supabase Dashboard → SQL Editor로 이동
2. `supabase/migrations/20250125_fix_cascade_deletion.sql` 파일 내용을 복사하여 실행

### 2. 마이그레이션 내용
- **Auth 사용자 삭제 트리거**: Auth 사용자 삭제 시 관련 데이터를 자동으로 정리하는 트리거 생성
- **외래키 제약조건 재생성**: 모든 관련 테이블의 CASCADE 삭제 제약조건 강화
- **기존 고아 데이터 정리**: woolela@nasmedia.co.kr의 남은 데이터 정리

### 3. 적용 후 효과
- ✅ Auth 사용자 삭제 시 profiles, admin_users, conversations, feedback 테이블의 데이터가 자동으로 삭제됨
- ✅ 향후 회원탈퇴 시 고아 데이터가 생성되지 않음
- ✅ 데이터 일관성 보장

## 현재 상태
- **고아 데이터 정리**: ✅ 완료 (API를 통해 처리됨)
- **트리거 생성**: ⏳ 마이그레이션 파일 적용 필요
- **외래키 재생성**: ⏳ 마이그레이션 파일 적용 필요

## 다음 단계
1. `supabase/migrations/20250125_fix_cascade_deletion.sql` 파일을 Supabase Dashboard의 SQL Editor에서 실행
2. 마이그레이션 완료 후 테스트 사용자로 회원가입/회원탈퇴 테스트 수행
3. 동기화 상태 확인

## 테스트 방법
마이그레이션 적용 후:
```bash
# 테스트 사용자 회원가입
curl -X POST http://localhost:3000/api/test/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser2@nasmedia.co.kr","password":"testpass123!","name":"테스트사용자2"}'

# Auth 사용자 삭제 (트리거 테스트)
curl -X POST http://localhost:3000/api/test/delete-woolela-auth \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser2@nasmedia.co.kr"}'

# 동기화 상태 확인
curl "http://localhost:3000/api/test/detailed-sync-check"
```

이 마이그레이션을 적용하면 향후 모든 회원탈퇴에서 자동으로 관련 데이터가 정리되어 동기화 문제가 발생하지 않습니다.








