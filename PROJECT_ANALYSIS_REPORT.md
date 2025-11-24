# Meta FAQ Chatbot 프로젝트 분석 보고서

## 1. 프로젝트 개요
- **프로젝트명**: meta-faq-chatbot
- **목적**: Meta 광고 정책 및 가이드를 위한 RAG(Retrieval-Augmented Generation) 기반 AI 챗봇 시스템
- **핵심 기능**: 문서 업로드 및 처리, 벡터 검색, 멀티 LLM 지원(Claude, OpenAI, Gemini), 벤더별(Meta, Google 등) 정책 안내

## 2. 기술 스택 (Tech Stack)

### Frontend & Framework
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS, Radix UI (Headless UI), Framer Motion (Animation)
- **State Management**: Zustand, React Query

### Backend & Infrastructure
- **Database**: Supabase (PostgreSQL + pgvector)
- **API**: Next.js API Routes
- **Deployment**: Vercel (추정)

### AI & ML
- **LLM Integration**:
  - **Main**: Anthropic Claude 3.5 Sonnet (복잡한 추론 및 답변 생성)
  - **Auxiliary**: OpenAI GPT-4o-mini (보조 및 비용 효율적 작업)
  - **Search/Fallback**: Google Gemini (검색 요약 및 백업)
- **Embeddings**:
  - **Primary**: OpenAI `text-embedding-3-small`
  - **Secondary/Local**: BGE-M3 (On-device/Edge 지원)
  - **Fallback**: Hash Embedding (테스트/긴급용)
- **Framework**: LangChain (Text Splitter 등 유틸리티 활용)

## 3. 프로젝트 구조 분석

### 디렉토리 구조
```
/src
├── app/                 # Next.js App Router 페이지 및 API
│   ├── api/             # 백엔드 API 엔드포인트 (chat, admin, upload 등)
│   ├── admin/           # 관리자 페이지
│   └── page.tsx         # 메인 채팅 인터페이스
├── lib/                 # 핵심 로직 및 유틸리티
│   ├── services/        # 비즈니스 로직 (RAG, Crawling, Embedding 등)
│   ├── supabase/        # Database 클라이언트 설정
│   └── utils/           # 공통 유틸리티
├── components/          # UI 컴포넌트
└── hooks/               # Custom React Hooks
```

## 4. 핵심 모듈 상세 분석

### A. RAG 프로세서 (`src/lib/services/RAGProcessor.ts`)
문서 처리 및 임베딩을 담당하는 핵심 서비스입니다.
- **청킹(Chunking)**: `RecursiveCharacterTextSplitter`를 사용하여 텍스트를 의미 단위로 분할 (기본 800자, overlap 100자).
- **임베딩 전략**:
  1. **OpenAI**: API 키가 있을 경우 우선 사용 (Batch 처리로 효율성 증대).
  2. **BGE-M3**: 로컬/서버리스 환경에서 고품질 임베딩 생성. 초기화 타임아웃 및 하트비트 모니터링 기능 포함.
  3. **Edge Function**: Supabase Edge Function을 통한 분산 처리 지원.
  4. **Hash (Fallback)**: 긴급 상황 시 결정적 해시 기반 벡터 생성.
- **정규화**: OpenAI 토큰 제한을 고려한 청크 크기 자동 조절 로직 포함.

### B. RAG 검색 서비스 (`src/lib/services/RAGSearchService.ts`)
사용자 질문에 대한 관련 문서를 검색하고 답변을 생성합니다.
- **검색 로직**:
  - Supabase `document_chunks` 테이블에서 코사인 유사도 검색.
  - **하이브리드 랭킹**: 벡터 유사도(70%) + 키워드 매칭(30%) 가중치 적용.
  - 복합 키워드(예: "전환 API") 및 중요 키워드 가중치 부여.
- **Fallback 시스템**: DB 연결 실패나 검색 결과 없음 시, 하드코딩된 벤더별(Naver, Kakao, Meta 등) 기본 답변 제공.
- **답변 생성**: 검색된 컨텍스트를 바탕으로 Gemini를 호출하여 답변 생성 (비용 절감 및 속도 최적화).

### C. 채팅 API (`src/app/api/chat/route.ts`)
클라이언트와 AI 간의 인터페이스 역할을 합니다.
- **멀티 벤더 지원**: 질문에서 벤더(Meta, Google, Naver 등)를 식별하여 필터링.
- **LLM 오케스트레이션**: Claude, OpenAI, Gemini를 상황에 맞게 선택적으로 사용.
- **로깅**: 토큰 사용량 및 비용을 `api_usage_logs` 테이블에 기록.

## 5. 데이터 흐름 (Data Flow)

1. **문서 업로드**: 관리자가 PDF/DOCX 업로드 -> 텍스트 추출 -> 청킹 -> 임베딩 -> Supabase 저장.
2. **질문 처리**:
   - 사용자 질문 입력
   - `RAGSearchService`가 질문을 임베딩
   - Supabase에서 유사 청크 검색 (Vector Search)
   - 키워드 매칭으로 결과 재정렬 (Re-ranking)
3. **답변 생성**:
   - 검색된 청크를 컨텍스트로 구성
   - 시스템 프롬프트와 함께 LLM(Claude/Gemini)에 전송
   - 최종 답변 및 출처(Source)를 사용자에게 반환

## 6. 특이 사항 및 강점
- **견고한 에러 처리**: API 키 누락, DB 연결 실패, 모델 로딩 지연 등 다양한 실패 시나리오에 대한 Fallback 로직이 매우 꼼꼼하게 구현됨.
- **하이브리드 검색**: 단순 벡터 검색을 넘어 키워드 매칭을 결합하여 검색 정확도 향상.
- **비용 최적화**: OpenAI Batch API 활용 및 모델별 비용 로깅 시스템 구축.
