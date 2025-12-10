# 크롤링 시스템 백업 계획

## 📋 백업 개요

크롤링부터 인덱싱까지 정상적으로 작동하는 코드를 단계별로 백업합니다.

## 📁 백업 구조

```
crawler_success_temp/
├── 01_crawling/          # 크롤링 단계
│   ├── crawler-v2/       # 크롤러 V2 (최신, 정상 작동)
│   ├── PuppeteerCrawlingService.ts
│   └── SitemapDiscoveryService.ts
├── 02_embedding/         # 임베딩 단계
│   ├── EmbeddingService.ts
│   └── OpenAIEmbeddingService.ts
├── 03_chunking/         # 청킹 단계
│   ├── RAGProcessor.ts
│   └── TextChunkingService.ts
├── 04_indexing/         # 인덱싱 단계
│   ├── DocumentIndexingService.ts
│   └── VectorStorageService.ts
├── 05_api/              # API 엔드포인트
│   ├── crawler-v2/crawl/route.ts
│   ├── puppeteer-crawl/route.ts
│   └── jobs/consume/route.ts
├── 06_utils/            # 유틸리티 함수
│   ├── url-utils.ts
│   └── html-utils.ts
└── docs/                # 문서
    ├── BACKUP_PLAN.md
    ├── MAXDEPTH_FILTERING_LOGIC.md
    └── CRAWLER_V2_MAXDEPTH_FIX.md
```

## ✅ 단계별 정상 작동 확인

### 1단계: 크롤링 ✅
- **crawler-v2**: 정상 작동 확인
  - BrowserManager: 브라우저 관리 정상
  - ContentExtractor: 콘텐츠 추출 정상
  - CrawlerEngine: 메인 엔진 정상
  - UrlDiscovery: URL 발견 정상 (maxDepth 필터링 포함)
  - SitemapParser: 사이트맵 파싱 정상
- **PuppeteerCrawlingService**: 정상 작동
- **SitemapDiscoveryService**: 정상 작동 (maxDepth 필터링 포함)

**테스트 결과:**
- maxDepth 3: 35개 발견 ✅
- maxDepth 4: 67개 발견 ✅

### 2단계: 임베딩 ✅
- **EmbeddingService**: BGE-M3 모델 정상 작동
- **OpenAIEmbeddingService**: OpenAI API 정상 작동

### 3단계: 청킹 ✅
- **RAGProcessor**: 텍스트 분할 및 청킹 정상 작동
- **TextChunkingService**: 한국어 특화 청킹 정상 작동

### 4단계: 인덱싱 ✅
- **DocumentIndexingService**: 문서 인덱싱 정상 작동
- **VectorStorageService**: 벡터 저장 정상 작동

### 5단계: API ✅
- **/api/crawler-v2/crawl**: 크롤러 V2 API 정상 작동
- **/api/puppeteer-crawl**: Puppeteer 크롤링 API 정상 작동
- **/api/jobs/consume**: 큐 처리 API 정상 작동

## 🔄 백업 주기

### 자동 백업 (권장)
- **주기**: 주요 기능 완료 시마다
- **트리거**: 
  - 크롤링 기능 개선 완료 시
  - 임베딩/청킹 로직 변경 완료 시
  - 인덱싱 성능 개선 완료 시

### 수동 백업
- **시점**: 
  - 배포 전
  - 대규모 리팩토링 전
  - 버그 수정 후 정상 작동 확인 시

## 📝 백업 체크리스트

### 크롤링 단계
- [x] crawler-v2 전체 폴더 백업
- [x] PuppeteerCrawlingService.ts 백업
- [x] SitemapDiscoveryService.ts 백업
- [x] maxDepth 필터링 로직 포함 확인

### 임베딩 단계
- [x] EmbeddingService.ts 백업
- [x] OpenAIEmbeddingService.ts 백업

### 청킹 단계
- [x] RAGProcessor.ts 백업
- [x] TextChunkingService.ts 백업

### 인덱싱 단계
- [x] DocumentIndexingService.ts 백업
- [x] VectorStorageService.ts 백업

### API 단계
- [x] crawler-v2 API 백업
- [x] puppeteer-crawl API 백업
- [x] jobs/consume API 백업

### 유틸리티
- [x] url-utils.ts 백업
- [x] html-utils.ts 백업

## 🚀 복원 방법

### 전체 복원
```bash
# 1. 크롤링 복원
cp -r crawler_success_temp/01_crawling/* src/lib/

# 2. 임베딩 복원
cp crawler_success_temp/02_embedding/* src/lib/services/

# 3. 청킹 복원
cp crawler_success_temp/03_chunking/* src/lib/services/

# 4. 인덱싱 복원
cp crawler_success_temp/04_indexing/* src/lib/services/

# 5. API 복원
cp crawler_success_temp/05_api/* src/app/api/
```

### 단계별 복원
```bash
# 특정 단계만 복원
cp crawler_success_temp/01_crawling/* src/lib/
```

## 📊 백업 상태

**최종 업데이트**: 2025-12-03
**백업 버전**: v1.0
**상태**: ✅ 완료

## 🔍 검증 방법

### 크롤링 검증
```bash
# 테스트 URL로 크롤링 실행
curl -X POST http://localhost:3000/api/crawler-v2/crawl \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://ads.naver.com/"], "options": {"discoverSubPages": true, "maxDepth": 4}}'
```

### 임베딩 검증
- RAGProcessor의 generateEmbeddings() 메서드 테스트
- EmbeddingService의 generateEmbedding() 메서드 테스트

### 청킹 검증
- RAGProcessor의 chunkText() 메서드 테스트
- TextChunkingService의 chunkKoreanText() 메서드 테스트

### 인덱싱 검증
- DocumentIndexingService의 indexDocument() 메서드 테스트
- VectorStorageService의 storeChunks() 메서드 테스트

## 📌 주의사항

1. **의존성 확인**: 백업된 코드는 특정 버전의 라이브러리에 의존할 수 있습니다.
2. **환경 변수**: 백업된 코드는 특정 환경 변수가 필요할 수 있습니다.
3. **데이터베이스 스키마**: 인덱싱 코드는 특정 DB 스키마를 가정할 수 있습니다.

## 🔗 관련 문서

- [MAXDEPTH_FILTERING_LOGIC.md](./docs/MAXDEPTH_FILTERING_LOGIC.md)
- [CRAWLER_V2_MAXDEPTH_FIX.md](./docs/CRAWLER_V2_MAXDEPTH_FIX.md)
- [크롤러 V2 README](../src/lib/crawler-v2/README.md)



