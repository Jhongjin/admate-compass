# 배포 명령어

## 수정 사항
- 문서 일괄 삭제 기능 개선
- 무한 대기 문제 해결 (setTimeout 제거, invalidateQueries만 사용)

## 배포 단계

### 1. 변경사항 확인
```bash
git status
```

### 2. 변경사항 스테이징
```bash
git add src/app/gemini_pro_theme/admin/documents/page.tsx
```

### 3. 커밋
```bash
git commit -m "fix: 문서 일괄 삭제 기능 수정 - 무한 대기 문제 해결 및 쿼리 캐시 무효화 개선"
```

### 4. 푸시 및 배포
```bash
git push origin Admate_9m_final
```

Vercel이 자동으로 배포를 시작합니다.

## 배포 확인
1. Vercel 대시보드에서 배포 상태 확인
2. 배포 완료 후 테스트:
   - 문서 선택
   - 일괄 삭제 실행
   - 삭제 후 목록 자동 갱신 확인

