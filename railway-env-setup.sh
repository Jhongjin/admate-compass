#!/bin/bash

# Railway 환경변수 설정 스크립트

echo "🚂 Railway 환경변수 설정 시작..."

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

# 프로젝트 선택
echo "📁 Railway 프로젝트 선택..."
railway link

# Supabase 환경변수 설정
echo "🔧 Supabase 환경변수 설정..."
railway variables set NEXT_PUBLIC_SUPABASE_URL=https://renjseslaqgfoxslxlyu.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Ollama 환경변수 설정
echo "🤖 Ollama 환경변수 설정..."
railway variables set OLLAMA_BASE_URL=http://141.164.52.52:11434
railway variables set OLLAMA_DEFAULT_MODEL=mistral:7b

# RAG 환경변수 설정
echo "🔍 RAG 환경변수 설정..."
railway variables set EMBEDDING_DIM=1024
railway variables set TOP_K=5

# Railway Ollama URL 설정 (자동 생성된 URL로 교체)
echo "🔗 Railway Ollama URL 설정..."
railway variables set RAILWAY_OLLAMA_URL=https://your-railway-app.up.railway.app

echo "✅ Railway 환경변수 설정 완료!"
echo "📝 다음 단계:"
echo "1. Railway 대시보드에서 SUPABASE_SERVICE_ROLE_KEY를 실제 값으로 업데이트"
echo "2. Railway Ollama URL을 실제 생성된 URL로 업데이트"
echo "3. Railway 서비스 재배포"






