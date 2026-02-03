#!/bin/bash

# Railway 배포 스크립트

echo "🚂 Railway 배포 시작..."

# Railway CLI 설치 확인
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI가 설치되지 않았습니다."
    echo "다음 명령어로 설치하세요:"
    echo "npm install -g @railway/cli"
    exit 1
fi

# Railway 로그인
echo "🔐 Railway 로그인..."
railway login

# 프로젝트 생성 또는 선택
echo "📁 Railway 프로젝트 설정..."
if [ ! -f ".railway/project.json" ]; then
    echo "새 프로젝트 생성..."
    railway init
else
    echo "기존 프로젝트 사용..."
fi

# 환경변수 설정
echo "🔧 환경변수 설정..."
echo "⚠️  다음 환경변수들을 Railway 대시보드에서 수동으로 설정해주세요:"
echo ""
echo "NEXT_PUBLIC_SUPABASE_URL=https://renjseslaqgfoxslxlyu.supabase.co"
echo "SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here"
echo "OLLAMA_BASE_URL=http://141.164.52.52:11434"
echo "OLLAMA_DEFAULT_MODEL=mistral:7b"
echo "EMBEDDING_DIM=1024"
echo "TOP_K=5"
echo "RAILWAY_OLLAMA_URL=https://your-ollama-service.up.railway.app"
echo ""

# 배포
echo "🚀 Railway 배포 시작..."
railway up

echo "✅ Railway 배포 완료!"
echo "📝 다음 단계:"
echo "1. Railway 대시보드에서 환경변수 설정"
echo "2. Ollama 전용 서비스 생성"
echo "3. 모델 설치: ollama pull mistral:7b"
echo "4. Vercel에서 Railway URL 사용"






