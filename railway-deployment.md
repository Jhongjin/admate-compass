# Railway + Ollama 배포 가이드

> Historical note: 이 문서는 과거 Railway/Ollama 실험 기록입니다. 현재 공개 답변 API의 canonical route는 `/api/compass-answer`이며, Railway diagnostic route는 운영 표면에서 제거되었습니다. 실제 runtime URL이나 env 값은 이 문서에 기록하지 않습니다.

## 🚂 Railway에 Ollama 배포하기

### 1. Railway 계정 생성 및 프로젝트 생성

1. [Railway.app](https://railway.app)에 접속하여 GitHub 계정으로 로그인
2. "New Project" 클릭
3. "Deploy from GitHub repo" 선택
4. `meta-faq-chatbot` 저장소 선택

### 2. Ollama 서비스 배포

Railway에서 새 서비스를 생성하고 다음 설정을 적용:

#### Dockerfile 생성
```dockerfile
FROM ollama/ollama:latest

# Ollama 서비스 시작
CMD ["ollama", "serve"]
```

#### Railway 환경변수 설정
```
OLLAMA_HOST=0.0.0.0
OLLAMA_ORIGINS=*
```

### 3. 모델 설치

Railway 콘솔에서 다음 명령어 실행:

```bash
# mistral:7b 모델 설치
ollama pull mistral:7b

# 모델 확인
ollama list
```

### 4. Vercel 환경변수 업데이트

과거 실험에서는 별도 런타임 URL을 Vercel 환경변수로 연결했습니다. 현재 운영 경로는 `/api/compass-answer`를 기준으로 정리하며, 실제 runtime URL이나 env 값은 문서와 로그에 남기지 않습니다.

### 5. 테스트

Railway 서비스가 정상 작동하는지 확인:

```bash
curl -X POST "<private-runtime-url>/api/generate" \
  -H "Content-Type: application/json" \
  -d '{"model":"mistral:7b","prompt":"안녕하세요","stream":false}'
```

## 🔄 Vercel에서 Railway 사용

Railway 배포 완료 후 앱에서 사용하는 공개 답변 경로는 `/api/compass-answer`입니다. 과거 diagnostic route는 운영 표면에서 제거되었으며, 이 문서는 해당 이력 확인용으로만 유지합니다.

### 장점:
- ✅ Vercel 타임아웃 제한 없음
- ✅ 안정적인 Ollama 서비스
- ✅ 자동 스케일링
- ✅ HTTPS 지원

### 비용:
- Railway 무료 플랜: 월 $5 크레딧
- Ollama 모델: 약 $2-3/월
