# 자산 저장소 정책 (Asset Storage Policy)

이 문서는 AdMate 프로젝트의 샘플 파일, 테스트 자산, 임시 스크립트 등의 보관 및 관리 정책을 설명합니다.

## 📁 디렉터리 구조

### `fixtures/` - 표준 샘플 자산

프로젝트에 포함되어 버전 관리되는 공식 테스트/샘플 파일입니다.

#### `fixtures/uploads/`
- **목적**: 문서 업로드 기능 테스트용 샘플 파일
- **용도**: 개발/QA 단계에서 업로드 기능 검증
- **포함 파일**:
  - `Introducing+Ads+in+Threads_KR.pdf`: Meta Threads 광고 가이드 샘플
  - `test.pdf`: 일반 PDF 업로드 테스트용
  - `Threads 피드 내 광고의 예.docx`: DOCX 형식 샘플
  - `브랜드가(또는크리에이터가) 파트너십광고를진행하려면어떤조건이있나요.txt`: TXT 형식 샘플
- **관리 규칙**:
  - ✅ Git에 포함되어 버전 관리됨
  - ✅ 프로덕션 코드에서 직접 참조하지 않음 (수동 테스트용)
  - ✅ 파일명은 의미 있는 이름 사용 (한글 포함 가능)
  - ✅ 불필요한 파일은 정기적으로 정리

#### `fixtures/tests/`
- **목적**: RAG 파이프라인 및 API 테스트용 샘플 데이터
- **용도**: 통합 테스트, E2E 테스트, 수동 검증
- **포함 파일**:
  - `curl-download.docx`: URL 크롤링 다운로드 테스트용
  - `RAG_Pipeline_Test.txt`: RAG 처리 파이프라인 검증용
- **관리 규칙**:
  - ✅ Git에 포함되어 버전 관리됨
  - ✅ 테스트 스크립트에서 참조 가능
  - ✅ 테스트 실패 시 디버깅에 활용

### `temp/` - 임시 작업 자산

개발 중 임시로 생성된 스크립트, SQL, 문서 등입니다. **프로덕션 코드에서 참조하지 않습니다.**

#### `temp/docs/`
- **목적**: 개발 중 작성된 임시 문서/메모
- **예시**: `GEMINI.md` (Gemini API 사용 가이드 등)
- **관리 규칙**:
  - ⚠️ Git에 포함되지만 프로덕션에 영향 없음
  - ⚠️ 정기적으로 정리하거나 `docs/`로 이동 검토
  - ⚠️ 중요한 내용은 공식 문서로 전환 권장

#### `temp/scripts/`
- **목적**: 일회성 작업용 스크립트
- **예시**: 
  - `clear-supabase-data.js`: 데이터 초기화 스크립트
  - `test-rag-powershell.ps1`: PowerShell 테스트 스크립트
- **관리 규칙**:
  - ⚠️ Git에 포함되지만 프로덕션 빌드에 포함되지 않음
  - ⚠️ 재사용 가능한 스크립트는 `scripts/` 디렉터리로 이동 검토
  - ⚠️ 사용하지 않는 스크립트는 삭제

#### `temp/sql/`
- **목적**: 수동 실행용 임시 SQL 쿼리
- **예시**: 
  - `add_woolela_user.sql`: 사용자 생성 쿼리
  - `check_woolela_status.sql`: 상태 확인 쿼리
  - `cleanup_orphaned_users_safe.sql`: 데이터 정리 쿼리
- **관리 규칙**:
  - ⚠️ Git에 포함되지만 Supabase 마이그레이션으로 전환 권장
  - ⚠️ 재사용 가능한 쿼리는 `supabase/migrations/`로 이동
  - ⚠️ 일회성 쿼리는 실행 후 삭제 또는 주석 처리

## 🔄 자산 추가/이동 가이드

### 새 샘플 파일 추가
1. 파일을 `fixtures/uploads/` 또는 `fixtures/tests/`에 추가
2. 의미 있는 파일명 사용 (한글 포함 가능, UTF-8 인코딩)
3. `git add` 후 커밋

### 임시 파일을 표준 자산으로 전환
1. `temp/` 내 파일의 재사용 가치 평가
2. 적절한 위치로 이동:
   - 문서 → `docs/`
   - 스크립트 → `scripts/`
   - SQL → `supabase/migrations/`
   - 테스트 파일 → `fixtures/tests/`
3. `git mv` 사용하여 히스토리 보존

### 불필요한 파일 삭제
1. 코드베이스 전체에서 참조 여부 확인 (`rg` 또는 `grep` 사용)
2. 참조가 없으면 삭제
3. `git rm` 사용하여 삭제 커밋

## 📋 정기 정리 체크리스트

매월 또는 주요 릴리스 전에 다음 항목을 점검하세요:

- [ ] `temp/docs/`: 공식 문서로 전환 가능한 항목 확인
- [ ] `temp/scripts/`: 재사용 가능한 스크립트를 `scripts/`로 이동
- [ ] `temp/sql/`: Supabase 마이그레이션으로 전환 가능한 쿼리 확인
- [ ] `fixtures/`: 사용하지 않는 샘플 파일 삭제
- [ ] 루트 디렉터리: 임시 파일이 남아있지 않은지 확인

## 🚫 금지 사항

- ❌ 프로덕션 코드에서 `temp/` 내 파일 직접 참조
- ❌ `fixtures/` 파일을 프로덕션 데이터로 사용
- ❌ 대용량 파일(>10MB)을 Git에 포함
- ❌ 민감한 정보(API 키, 비밀번호 등)가 포함된 샘플 파일 커밋

## 📚 관련 문서

- [프로젝트 구조 가이드](../README.md#프로젝트-구조)
- [Supabase 마이그레이션 가이드](./supabase_migration_check_guide.md)
- [배포 체크리스트](./DEPLOYMENT_TEST_CHECKLIST.md)

