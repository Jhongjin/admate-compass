# 🚀 AdMate Guide: Meta Ads FAQ AI Chatbot

![AdMate Guide Banner](https://via.placeholder.com/1200x400?text=AdMate+Guide+RAG+System)

> **복합 매체 광고 가이드 및 정책을 가장 스마트하게 탐색하는 방법.**  
> AdMate Guide는 RAG(Retrieval-Augmented Generation) 기술을 활용하여 흩어져 있는 광고 플랫폼의 방대한 가이드를 통합하고, 사용자 질문에 가장 가깝고 정확한 답변을 제공합니다.

---

## ✨ Key Features

- 🛰️ **Multi-Platform Crawler**: Meta(Instagram), Google, Naver, Kakao, X(twitter)  등 주요 매체 헬프센터 자동 동기화.
- 🧠 **Hybrid Search Engine**: 벡터 기반 의미 검색(Semantic Search)과 키워드 검색을 결합한 하이브리드 아키텍처.
- 🛡️ **Reliable Responses**: Multi-LLM Ops 기반의 답변 검증(Validation) 프로세스를 통한 할루시네이션 방지.
- 📊 **Structured Knowledge**: 비정규화된 HTML/PDF 데이터를 의미 단위로 구조화하여 최적의 지식 베이스 구축.

---

## 🛠 Tech Stack

### Frontend & App Framework
- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS** & **Framer Motion** (Modern UI/UX)
- **Shadcn/UI** (Components)

### AI & Data Pipeline
- **Supabase** (PostgreSQL + pgvector)
- **LangChain** (RAG Orchestration)
- **LLMs**: Anthropic Claude 3.5, Google Gemini 1.5/2.0, OpenAI GPT-4o
- **Crawling**: Puppeteer & Cheerio

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (version 22.x recommended)
- Supabase Account & Project
- API Keys (OpenAI, Anthropic, Gemini 등)

### 2. Environment Setup
`.env.example` 파일을 복사하여 `.env.local`을 생성하고 필요한 API Key를 설정하세요.

```bash
cp .env.example .env.local
```

### 3. Installation
```bash
npm install
```

### 4. Run Development Server
```bash
npm run dev
```

---

## 📂 Project Structure

- `src/app`: Next.js App Router 기반의 페이지 및 API 라우트
- `src/lib/crawler-v2`: 고도화된 크롤링 엔진 핵심 로직
- `src/components`: 재사용 가능한 UI 컴포넌트
- `scripts`: 데이터 적재 및 사이트맵 등록 스크립트
- `supabase`: 데이터베이스 스키마 및 마이그레이션 파일

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
*"AdMate Team - Empowering Advertisers with AI Intelligence"*
