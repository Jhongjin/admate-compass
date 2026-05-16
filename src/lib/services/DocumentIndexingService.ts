import { documentProcessingService, ProcessedDocument } from './DocumentProcessingService';
import { textChunkingService, ChunkedDocument } from './TextChunkingService';
import { embeddingService, EmbeddingResult } from './EmbeddingService';
import { vectorStorageService, DocumentRecord } from './VectorStorageService';

export interface IndexingResult {
  documentId: string;
  status: 'success' | 'failed';
  chunksProcessed: number;
  embeddingsGenerated: number;
  processingTime: number;
  error?: string;
}

export interface IndexingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingModel?: 'bge-m3' | 'all-MiniLM-L6-v2';
  batchSize?: number;
}

export class DocumentIndexingService {
  /**
   * 문서명을 한글로 변환
   */
  private translateTitleToKorean(title: string, url: string): string {
    // URL 자체인 경우는 그대로 반환
    if (title === url || title.startsWith('http')) {
      return title;
    }

    // 영어 제목을 한글로 변환하는 매핑
    const titleMappings: { [key: string]: string } = {
      'Marketing API': '마케팅 API',
      'Facebook Marketing API': '페이스북 마케팅 API',
      'Instagram Marketing API': '인스타그램 마케팅 API',
      'Meta Marketing API': '메타 마케팅 API',
      'Advertising Policies': '광고 정책',
      'Facebook Advertising Policies': '페이스북 광고 정책',
      'Instagram Advertising Policies': '인스타그램 광고 정책',
      'Meta Advertising Policies': '메타 광고 정책',
      'Business Help Center': '비즈니스 도움말 센터',
      'Facebook Business Help Center': '페이스북 비즈니스 도움말 센터',
      'Instagram Business Help Center': '인스타그램 비즈니스 도움말 센터',
      'Meta Business Help Center': '메타 비즈니스 도움말 센터',
      'Community Standards': '커뮤니티 가이드라인',
      'Facebook Community Standards': '페이스북 커뮤니티 가이드라인',
      'Instagram Community Guidelines': '인스타그램 커뮤니티 가이드라인',
      'Meta Community Standards': '메타 커뮤니티 가이드라인',
      'Terms of Service': '서비스 약관',
      'Privacy Policy': '개인정보 보호정책',
      'Data Policy': '데이터 정책',
      'Cookie Policy': '쿠키 정책',
      'Developer Documentation': '개발자 문서',
      'API Documentation': 'API 문서',
      'Business Manager': '비즈니스 관리자',
      'Ads Manager': '광고 관리자',
      'Campaign Manager': '캠페인 관리자',
      'Creative Hub': '크리에이티브 허브',
      'Audience Network': '오디언스 네트워크',
      'Facebook Audience Network': '페이스북 오디언스 네트워크',
      'Instagram Shopping': '인스타그램 쇼핑',
      'Facebook Shop': '페이스북 쇼핑',
      'WhatsApp Business': '왓츠앱 비즈니스',
      'Messenger Platform': '메신저 플랫폼',
      'Facebook Login': '페이스북 로그인',
      'Instagram Basic Display API': '인스타그램 기본 표시 API',
      'Instagram Graph API': '인스타그램 그래프 API',
      'Facebook Graph API': '페이스북 그래프 API',
      'Meta Graph API': '메타 그래프 API',
      'Webhooks': '웹훅',
      'OAuth': 'OAuth 인증',
      'Access Tokens': '액세스 토큰',
      'App Review': '앱 검토',
      'App Review Process': '앱 검토 프로세스',
      'Permissions': '권한',
      'Scopes': '스코프',
      'Rate Limits': '속도 제한',
      'Error Codes': '오류 코드',
      'SDK': 'SDK',
      'SDKs': 'SDK',
      'JavaScript SDK': '자바스크립트 SDK',
      'iOS SDK': 'iOS SDK',
      'Android SDK': '안드로이드 SDK',
      'React Native': '리액트 네이티브',
      'Unity': '유니티',
      'Flutter': '플러터',
      'Node.js': 'Node.js',
      'Python': '파이썬',
      'PHP': 'PHP',
      'Java': '자바',
      'C#': 'C#',
      'Ruby': '루비',
      'Go': '고',
      'Swift': '스위프트',
      'Kotlin': '코틀린',
      'REST API': 'REST API',
      'GraphQL': 'GraphQL',
      'Real-time Updates': '실시간 업데이트',
      'Batch Requests': '배치 요청',
      'Bulk Operations': '대량 작업',
      'Insights': '인사이트',
      'Analytics': '분석',
      'Reporting': '리포팅',
      'Metrics': '메트릭',
      'KPIs': '핵심 성과 지표',
      'ROI': '투자 수익률',
      'ROAS': '광고 지출 수익률',
      'CPM': '천회 노출당 비용',
      'CPC': '클릭당 비용',
      'CPA': '전환당 비용',
      'CTR': '클릭률',
      'CVR': '전환율',
      'Frequency': '노출 빈도',
      'Reach': '도달',
      'Impressions': '노출',
      'Clicks': '클릭',
      'Conversions': '전환',
      'Leads': '리드',
      'Sales': '판매',
      'Revenue': '수익',
      'Cost': '비용',
      'Budget': '예산',
      'Bid': '입찰',
      'Bidding': '입찰',
      'Auction': '경매',
      'Ad Rank': '광고 순위',
      'Quality Score': '품질 점수',
      'Relevance Score': '관련성 점수',
      'Engagement Rate': '참여율',
      'Video Views': '동영상 조회수',
      'Video Completion Rate': '동영상 완료율',
      'Thumb Stop Rate': '썸네일 정지율',
      'Link Clicks': '링크 클릭',
      'Page Likes': '페이지 좋아요',
      'Page Follows': '페이지 팔로우',
      'Comments': '댓글',
      'Shares': '공유',
      'Saves': '저장',
      'Reactions': '반응',
      'Story Views': '스토리 조회수',
      'Story Replies': '스토리 답글',
      'Direct Messages': '다이렉트 메시지',
      'Customer Service': '고객 서비스',
      'Support': '지원',
      'Help Center': '도움말 센터',
      'FAQ': '자주 묻는 질문',
      'Tutorial': '튜토리얼',
      'Guide': '가이드',
      'Best Practices': '모범 사례',
      'Case Studies': '사례 연구',
      'Success Stories': '성공 사례',
      'White Papers': '백서',
      'Research': '연구',
      'Studies': '연구',
      'Reports': '보고서',
      'Updates': '업데이트',
      'News': '뉴스',
      'Blog': '블로그',
      'Resources': '리소스',
      'Tools': '도구',
      'Templates': '템플릿',
      'Examples': '예제',
      'Samples': '샘플',
      'Code Examples': '코드 예제',
      'Sample Code': '샘플 코드',
      'Getting Started': '시작하기',
      'Quick Start': '빠른 시작',
      'Setup': '설정',
      'Configuration': '구성',
      'Installation': '설치',
      'Integration': '통합',
      'Implementation': '구현',
      'Deployment': '배포',
      'Testing': '테스트',
      'Debugging': '디버깅',
      'Troubleshooting': '문제 해결',
      'Common Issues': '일반적인 문제',
      'Known Issues': '알려진 문제',
      'Limitations': '제한사항',
      'Requirements': '요구사항',
      'Prerequisites': '전제 조건',
      'Compatibility': '호환성',
      'Version': '버전',
      'Changelog': '변경 로그',
      'Release Notes': '릴리스 노트',
      'Migration Guide': '마이그레이션 가이드',
      'Deprecation': '사용 중단',
      'Breaking Changes': '주요 변경사항',
      'New Features': '새로운 기능',
      'Improvements': '개선사항',
      'Bug Fixes': '버그 수정',
      'Security Updates': '보안 업데이트',
      'Performance Improvements': '성능 개선',
      'UI/UX Updates': 'UI/UX 업데이트',
      'Mobile': '모바일',
      'Desktop': '데스크톱',
      'Web': '웹',
      'iOS': 'iOS',
      'Android': '안드로이드',
      'Windows': '윈도우',
      'macOS': 'macOS',
      'Linux': '리눅스',
      'Cross-platform': '크로스 플랫폼',
      'Responsive': '반응형',
      'Accessibility': '접근성',
      'Internationalization': '국제화',
      'Localization': '현지화',
      'Multi-language': '다국어',
      'Korean': '한국어',
      'English': '영어',
      'Japanese': '일본어',
      'Chinese': '중국어',
      'Spanish': '스페인어',
      'French': '프랑스어',
      'German': '독일어',
      'Portuguese': '포르투갈어',
      'Italian': '이탈리아어',
      'Russian': '러시아어',
      'Arabic': '아랍어',
      'Hindi': '힌디어',
      'Thai': '태국어',
      'Vietnamese': '베트남어',
      'Indonesian': '인도네시아어',
      'Malay': '말레이어',
      'Filipino': '필리핀어',
      'Dutch': '네덜란드어',
      'Swedish': '스웨덴어',
      'Norwegian': '노르웨이어',
      'Danish': '덴마크어',
      'Finnish': '핀란드어',
      'Polish': '폴란드어',
      'Czech': '체코어',
      'Hungarian': '헝가리어',
      'Romanian': '루마니아어',
      'Bulgarian': '불가리아어',
      'Croatian': '크로아티아어',
      'Slovak': '슬로바키아어',
      'Slovenian': '슬로베니아어',
      'Estonian': '에스토니아어',
      'Latvian': '라트비아어',
      'Lithuanian': '리투아니아어',
      'Greek': '그리스어',
      'Turkish': '터키어',
      'Hebrew': '히브리어',
      'Persian': '페르시아어',
      'Urdu': '우르두어',
      'Bengali': '벵골어',
      'Tamil': '타밀어',
      'Telugu': '텔루구어',
      'Gujarati': '구자라트어',
      'Kannada': '칸나다어',
      'Malayalam': '말라얄람어',
      'Punjabi': '펀자브어',
      'Marathi': '마라티어',
      'Odia': '오디아어',
      'Assamese': '아삼어',
      'Nepali': '네팔어',
      'Sinhala': '싱할라어',
      'Burmese': '미얀마어',
      'Khmer': '크메르어',
      'Lao': '라오어',
      'Mongolian': '몽골어',
      'Tibetan': '티베트어',
      'Uyghur': '위구르어',
      'Kazakh': '카자흐어',
      'Kyrgyz': '키르기스어',
      'Tajik': '타지크어',
      'Turkmen': '투르크멘어',
      'Uzbek': '우즈베크어',
      'Azerbaijani': '아제르바이잔어',
      'Georgian': '조지아어',
      'Armenian': '아르메니아어',
      'Amharic': '암하라어',
      'Swahili': '스와힐리어',
      'Yoruba': '요루바어',
      'Igbo': '이그보어',
      'Hausa': '하우사어',
      'Zulu': '줄루어',
      'Afrikaans': '아프리칸스어',
      'Xhosa': '코사어',
      'Sesotho': '세소토어',
      'Tswana': '츠와나어',
      'Venda': '벤다어',
      'Tsonga': '총가어',
      'Ndebele': '은데벨레어',
      'Shona': '쇼나어',
      'Malagasy': '말라가시어',
      'Somali': '소말리어',
      'Oromo': '오로모어',
      'Tigrinya': '티그리냐어',
      'Wolof': '월로프어',
      'Fulani': '풀라니어',
      'Mandinka': '만딩카어',
      'Bambara': '밤바라어',
      'Dogon': '도곤어',
      'Songhai': '송하이어',
      'Kanuri': '카누리어',
      'Ewe': '에웨어',
      'Twi': '트위어',
      'Ga': '가어',
      'Fante': '판테어',
      'Akan': '아칸어',
      'Mossi': '모시어',
      'Dagbani': '다그바니어',
      'Gonja': '곤자어',
      'Kasem': '카셈어',
      'Nawuri': '나우리어',
      'Konkomba': '콘콤바어',
      'Bimoba': '비모바어',
      'Mamprusi': '맘프루시어',
      'Dagomba': '다곰바어',
      'Nanumba': '나눔바어',
      'Kusasi': '쿠사시어',
      'Talensi': '탈렌시어',
      'Nabdam': '나브담어',
      'Bulsa': '불사어',
      'Kassena': '카세나어',
      'Nankani': '난카니어',
      'Frafra': '프라프라어',
      'Gurenne': '구렌네어',
      'Dagaare': '다가레어',
      'Birifor': '비리포어',
      'Sisaala': '시사알라어',
      'Chakali': '차칼리어',
      'Vagla': '바글라어',
      'Tampulma': '탐풀마어',
      'Safaliba': '사팔리바어',
      'Hanga': '한가어',
      'Kamara': '카마라어'
    };

    // 정확한 매칭 시도
    if (titleMappings[title]) {
      return titleMappings[title];
    }

    // 부분 매칭 시도 (대소문자 무시)
    const lowerTitle = title.toLowerCase();
    for (const [english, korean] of Object.entries(titleMappings)) {
      if (lowerTitle.includes(english.toLowerCase()) || english.toLowerCase().includes(lowerTitle)) {
        return korean;
      }
    }

    // 매칭되지 않으면 원본 제목 반환
    return title;
  }

  /**
   * 파일을 인덱싱
   */
  async indexFile(
    file: File,
    options: IndexingOptions = {},
    existingDocumentId?: string
  ): Promise<IndexingResult> {
    const startTime = Date.now();
    let documentId = existingDocumentId || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log(`파일 인덱싱 시작: ${file.name}`);

      // 1. 파일 중복 체크 (재인덱싱이 아닌 경우에만)
      if (!existingDocumentId) {
        const duplicateCheck = await vectorStorageService.checkFileExists(file.name, file.size);
        if (duplicateCheck.exists) {
          console.log(`⚠️ 중복 파일 발견: ${file.name} (기존 문서 ID: ${duplicateCheck.documentId})`);
          
          // 기존 문서가 완료 상태인 경우 건너뛰기
          if (duplicateCheck.document?.status === 'indexed') {
            console.log(`✅ 기존 파일이 이미 완료 상태입니다. 건너뜀: ${file.name}`);
            return {
              documentId: duplicateCheck.documentId!,
              status: 'success',
              chunksProcessed: duplicateCheck.document?.chunk_count || 0,
              embeddingsGenerated: duplicateCheck.document?.chunk_count || 0,
              processingTime: 0
            };
          }
          
          // 기존 문서가 실패 상태인 경우 재시도
          if (duplicateCheck.document?.status === 'failed') {
            console.log(`🔄 기존 파일이 실패 상태입니다. 재시도: ${file.name}`);
            // 기존 문서를 삭제하고 새로 생성
            await vectorStorageService.deleteDocument(duplicateCheck.documentId!);
          } else {
            console.log(`⏳ 기존 파일이 처리 중입니다. 건너뜀: ${file.name}`);
            return {
              documentId: duplicateCheck.documentId!,
              status: 'success',
              chunksProcessed: 0,
              embeddingsGenerated: 0,
              processingTime: 0
            };
          }
        }
      } else {
        console.log(`🔄 재인덱싱 모드: 기존 문서 ID 사용 - ${existingDocumentId}`);
      }

      // 6. 원본 파일 데이터 저장 (다운로드를 위해)
      const fileBuffer = await file.arrayBuffer();
      
      // Buffer 생성 시 안전한 방법 사용
      let buffer: Buffer;
      try {
        buffer = Buffer.from(fileBuffer);
      } catch (bufferError) {
        console.error('Buffer 생성 실패:', bufferError);
        // Uint8Array를 사용한 대안 방법
        const uint8Array = new Uint8Array(fileBuffer);
        buffer = Buffer.from(uint8Array);
      }
      
      const base64Data = buffer.toString('base64');

      // documents 테이블은 'file' 또는 'url'만 허용
      // 2. 문서 메타데이터 먼저 저장 (재인덱싱이 아닌 경우에만)
      if (!existingDocumentId) {
        await vectorStorageService.saveDocument({
          id: documentId,
          title: file.name,
          type: 'file', // documents 테이블은 'file' 또는 'url'만 허용
          uploadedAt: new Date().toISOString(),
          size: file.size, // 파일 크기 추가
          fileData: base64Data // 원본 파일 데이터 추가
        } as any); // 타입 오류 해결을 위한 임시 처리
      } else {
        console.log(`🔄 재인덱싱 모드: 문서 메타데이터 저장 건너뜀`);
      }

      // 2. 처리 로그 저장
      try {
        await vectorStorageService.saveProcessingLog(
          documentId,
          'file_processing',
          'started',
          `파일 처리 시작: ${file.name}`
        );
      } catch (logError) {
        console.warn('처리 로그 저장 실패:', logError);
      }

      // 3. 문서 처리 (텍스트 추출)
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
      let processedDoc;
      
      if (fileExtension === '.pdf') {
        processedDoc = await documentProcessingService.processPdfFile(buffer, file.name);
      } else if (fileExtension === '.docx') {
        processedDoc = await documentProcessingService.processDocxFile(buffer, file.name);
      } else {
        processedDoc = await documentProcessingService.processTextFile(buffer, file.name);
      }
      console.log(`문서 처리 완료: ${processedDoc.metadata.title}`);

      // 4. 텍스트 청킹
      const chunkedDoc = await textChunkingService.chunkDocument(
        processedDoc.content,
        processedDoc.metadata.type,
        {
          title: processedDoc.metadata.title,
          type: processedDoc.metadata.type,
          pages: processedDoc.metadata.pages
        }
      );
      console.log(`텍스트 청킹 완료: ${chunkedDoc.chunks.length}개 청크`);

      // 5. 임베딩 생성
      await embeddingService.initialize(options.embeddingModel || 'bge-m3');
      
      const chunkTexts = chunkedDoc.chunks.map(chunk => chunk.content);
      const embeddings = await embeddingService.generateBatchEmbeddings(
        chunkTexts,
        { batchSize: options.batchSize || 10 }
      );
      console.log(`임베딩 생성 완료: ${embeddings.length}개`);


      // 7. 벡터 저장
      await vectorStorageService.saveChunks(documentId, chunkedDoc.chunks, embeddings);

      // 8. 성공 로그 저장
      await vectorStorageService.saveProcessingLog(
        documentId,
        'indexing_complete',
        'completed',
        `인덱싱 완료: ${chunkedDoc.chunks.length}개 청크, ${embeddings.length}개 임베딩`
      );

      const processingTime = Date.now() - startTime;

      console.log(`파일 인덱싱 완료: ${file.name} (${processingTime}ms)`);

      return {
        documentId,
        status: 'success',
        chunksProcessed: chunkedDoc.chunks.length,
        embeddingsGenerated: embeddings.length,
        processingTime
      };
    } catch (error) {
      console.error(`파일 인덱싱 실패: ${file.name}`, error);
      console.error('오류 상세:', error instanceof Error ? error.stack : String(error));

      // 실패 로그 저장
      try {
        await vectorStorageService.saveProcessingLog(
          documentId,
          'indexing_failed',
          'failed',
          `인덱싱 실패: ${file.name}`,
          error instanceof Error ? error.message : String(error)
        );
      } catch (logError) {
        console.error('로그 저장 실패:', logError);
      }

      // 문서 상태를 실패로 업데이트
      try {
        await vectorStorageService.updateDocumentStatus(documentId, 'failed');
      } catch (statusError) {
        console.error('문서 상태 업데이트 실패:', statusError);
      }

      return {
        documentId,
        status: 'failed',
        chunksProcessed: 0,
        embeddingsGenerated: 0,
        processingTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 크롤링된 콘텐츠로 직접 인덱싱 (Puppeteer용)
   */
  async indexCrawledContent(
    url: string, 
    crawledContent: string, 
    title: string, 
    metadata: any
  ): Promise<void> {
    // 재인덱싱의 경우 기존 documentId 사용, 새 인덱싱의 경우 새로 생성
    let documentId = metadata?.documentId || `url_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`🔍 크롤링된 콘텐츠 인덱싱 시작: ${title}`);
      console.log(`📝 URL: ${url}`);
      console.log(`📄 콘텐츠 길이: ${crawledContent.length}자`);
      console.log(`📋 받은 메타데이터:`, metadata);
      console.log(`🆔 사용할 문서 ID: ${documentId}`);

      // 1. URL 중복 체크 (재인덱싱이 아닌 경우에만)
      if (!metadata?.documentId) {
        const duplicateCheck = await vectorStorageService.checkUrlExists(url);
        if (duplicateCheck.exists) {
          console.log(`⚠️ 중복 URL 발견: ${url} (기존 문서 ID: ${duplicateCheck.documentId})`);
          
          // 기존 문서가 완료 상태인 경우 건너뛰기
          if (duplicateCheck.document?.status === 'indexed') {
            console.log(`✅ 기존 문서가 이미 완료 상태입니다. 건너뜀: ${title}`);
            return;
          }
          
          // 기존 문서가 실패 상태인 경우 재시도
          if (duplicateCheck.document?.status === 'failed') {
            console.log(`🔄 기존 문서가 실패 상태입니다. 재시도: ${title}`);
            // 기존 문서를 삭제하고 새로 생성
            await vectorStorageService.deleteDocument(duplicateCheck.documentId!);
          } else {
            console.log(`⏳ 기존 문서가 처리 중입니다. 건너뜀: ${title}`);
            return;
          }
        }
      } else {
        console.log(`🔄 재인덱싱 모드: 중복 체크 건너뜀`);
      }

      // 2. 문서명을 한글로 변환
      const koreanTitle = this.translateTitleToKorean(title, url);
      console.log(`📝 한글 제목 변환: ${koreanTitle}`);

      // 3. 문서 메타데이터 저장 (재인덱싱이 아닌 경우에만)
      if (!metadata?.documentId) {
        console.log(`💾 문서 메타데이터 저장 시작: ${documentId}`);
        await vectorStorageService.saveDocument({
          id: documentId,
          title: koreanTitle,
          type: 'url',
          url: url,
          uploadedAt: new Date().toISOString()
        });
        console.log(`✅ 문서 메타데이터 저장 완료: ${documentId}`);
      } else {
        console.log(`🔄 재인덱싱 모드: 문서 메타데이터 저장 건너뜀`);
      }

      // 4. 텍스트 청킹
      console.log(`📄 텍스트 청킹 시작: ${crawledContent.length}자`);
      const chunkedDoc = await textChunkingService.chunkDocument(
        crawledContent,
        'url',
        {
          title: koreanTitle,
          url: url,
          type: 'url',
          ...metadata
        }
      );
      console.log(`✅ 텍스트 청킹 완료: ${chunkedDoc.chunks.length}개 청크`);

      // 5. 임베딩 생성
      console.log(`🧠 임베딩 서비스 초기화 시작`);
      await embeddingService.initialize('bge-m3');
      console.log(`✅ 임베딩 서비스 초기화 완료`);
      
      const chunkTexts = chunkedDoc.chunks.map(chunk => chunk.content);
      console.log(`🔢 임베딩 생성 시작: ${chunkTexts.length}개 청크`);
      const embeddings = await embeddingService.generateBatchEmbeddings(
        chunkTexts,
        { batchSize: 10 }
      );
      console.log(`✅ 임베딩 생성 완료: ${embeddings.length}개`);

      // 6. 벡터 저장
      console.log(`💾 벡터 저장 시작: ${documentId}`);
      await vectorStorageService.saveChunks(documentId, chunkedDoc.chunks, embeddings);
      console.log(`✅ 벡터 저장 완료: ${documentId}`);

      // 6. URL 정보를 메타데이터에 저장 (VectorStorageService에 saveDocumentMetadata 메서드가 없으므로 제거)
      // await vectorStorageService.saveDocumentMetadata(documentId, {
      //   url: url,
      //   title: koreanTitle,
      //   type: 'url',
      //   crawledAt: new Date().toISOString(),
      //   ...metadata
      // });

      // 7. 문서 상태 업데이트
      console.log(`🔄 문서 상태 업데이트 시작: ${documentId}`);
      await vectorStorageService.updateDocumentStatus(documentId, 'completed', chunkedDoc.chunks.length);
      console.log(`✅ 문서 상태 업데이트 완료: ${documentId}`);

      console.log(`🎉 크롤링된 콘텐츠 인덱싱 완료: ${title}`);

    } catch (error) {
      console.error(`❌ 크롤링된 콘텐츠 인덱싱 실패: ${title}`, error);
      console.error(`❌ 에러 상세:`, error);
      
      // 실패한 경우 문서 상태를 실패로 업데이트
      try {
        console.log(`🔄 실패 상태로 업데이트 시도: ${documentId}`);
        await vectorStorageService.updateDocumentStatus(documentId, 'failed');
        console.log(`✅ 실패 상태 업데이트 완료: ${documentId}`);
      } catch (updateError) {
        console.error('❌ 문서 상태 업데이트 실패:', updateError);
      }
      
      throw error;
    }
  }

  /**
   * URL을 인덱싱
   */
  async indexURL(
    url: string,
    options: IndexingOptions = {}
  ): Promise<IndexingResult> {
    const startTime = Date.now();
    let documentId = `url_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log(`URL 인덱싱 시작: ${url}`);

      // 1. URL 중복 체크
      const duplicateCheck = await vectorStorageService.checkUrlExists(url);
      if (duplicateCheck.exists) {
        console.log(`⚠️ 중복 URL 발견: ${url} (기존 문서 ID: ${duplicateCheck.documentId})`);
        
        // 기존 문서가 완료 상태인 경우 건너뛰기
        if (duplicateCheck.document?.status === 'indexed') {
          console.log(`✅ 기존 문서가 이미 완료 상태입니다. 건너뜀: ${url}`);
          return {
            documentId: duplicateCheck.documentId!,
            status: 'success',
            chunksProcessed: duplicateCheck.document?.chunk_count || 0,
            embeddingsGenerated: duplicateCheck.document?.chunk_count || 0,
            processingTime: 0
          };
        }
        
        // 기존 문서가 실패 상태인 경우 재시도
        if (duplicateCheck.document?.status === 'failed') {
          console.log(`🔄 기존 문서가 실패 상태입니다. 재시도: ${url}`);
          // 기존 문서를 삭제하고 새로 생성
          await vectorStorageService.deleteDocument(duplicateCheck.documentId!);
        } else {
          console.log(`⏳ 기존 문서가 처리 중입니다. 건너뜀: ${url}`);
          return {
            documentId: duplicateCheck.documentId!,
            status: 'success',
            chunksProcessed: 0,
            embeddingsGenerated: 0,
            processingTime: 0
          };
        }
      }

      // 2. 문서 메타데이터 먼저 저장
      await vectorStorageService.saveDocument({
        id: documentId,
        title: url,
        type: 'url',
        url: url,
        uploadedAt: new Date().toISOString()
      });

      // 2. 처리 로그 저장
      try {
        await vectorStorageService.saveProcessingLog(
          documentId,
          'url_processing',
          'started',
          `URL 처리 시작: ${url}`
        );
      } catch (logError) {
        console.warn('처리 로그 저장 실패:', logError);
      }

      // 3. URL 크롤링 및 텍스트 추출
      const processedDoc = await documentProcessingService.processUrl(url);
      console.log(`URL 처리 완료: ${processedDoc.metadata.title}`);

      // 4. 문서명을 한글로 변환
      const koreanTitle = this.translateTitleToKorean(processedDoc.metadata.title, url);

      // 5. 문서 제목 업데이트
      await vectorStorageService.updateDocumentTitle(documentId, koreanTitle);

      // 6. 텍스트 청킹
      const chunkedDoc = await textChunkingService.chunkDocument(
        processedDoc.content,
        'url',
        {
          title: koreanTitle,
          url: url,
          type: 'url'
        }
      );
      console.log(`텍스트 청킹 완료: ${chunkedDoc.chunks.length}개 청크`);

      // 7. 임베딩 생성
      await embeddingService.initialize(options.embeddingModel || 'bge-m3');
      
      const chunkTexts = chunkedDoc.chunks.map(chunk => chunk.content);
      const embeddings = await embeddingService.generateBatchEmbeddings(
        chunkTexts,
        { batchSize: options.batchSize || 10 }
      );
      console.log(`임베딩 생성 완료: ${embeddings.length}개`);

      // 8. 벡터 저장
      await vectorStorageService.saveChunks(documentId, chunkedDoc.chunks, embeddings);

      // 9. URL 정보를 메타데이터에 저장 (VectorStorageService에 saveDocumentMetadata 메서드가 없으므로 제거)
      // await vectorStorageService.saveDocumentMetadata(documentId, {
      //   url: url,
      //   title: koreanTitle,
      //   type: 'url',
      //   crawledAt: new Date().toISOString()
      // });

      // 10. 성공 로그 저장
      await vectorStorageService.saveProcessingLog(
        documentId,
        'indexing_complete',
        'completed',
        `인덱싱 완료: ${chunkedDoc.chunks.length}개 청크, ${embeddings.length}개 임베딩`
      );

      const processingTime = Date.now() - startTime;

      console.log(`URL 인덱싱 완료: ${url} (${processingTime}ms)`);

      return {
        documentId,
        status: 'success',
        chunksProcessed: chunkedDoc.chunks.length,
        embeddingsGenerated: embeddings.length,
        processingTime
      };
    } catch (error) {
      console.error(`URL 인덱싱 실패: ${url}`, error);

      // 실패 로그 저장
      await vectorStorageService.saveProcessingLog(
        documentId,
        'indexing_failed',
        'failed',
        `인덱싱 실패: ${url}`,
        error instanceof Error ? error.message : String(error)
      );

      // 문서 상태를 실패로 업데이트
      await vectorStorageService.updateDocumentStatus(documentId, 'failed');

      return {
        documentId,
        status: 'failed',
        chunksProcessed: 0,
        embeddingsGenerated: 0,
        processingTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 여러 파일을 배치 인덱싱
   */
  async indexFiles(
    files: File[],
    options: IndexingOptions = {}
  ): Promise<IndexingResult[]> {
    console.log(`${files.length}개 파일 배치 인덱싱 시작`);

    const results: IndexingResult[] = [];

    for (const file of files) {
      try {
        const result = await this.indexFile(file, options);
        results.push(result);
      } catch (error) {
        console.error(`파일 인덱싱 실패: ${file.name}`, error);
        results.push({
          documentId: `failed_${Date.now()}`,
          status: 'failed',
          chunksProcessed: 0,
          embeddingsGenerated: 0,
          processingTime: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.log(`배치 인덱싱 완료: ${results.length}개 파일 처리`);
    return results;
  }

  /**
   * 여러 URL을 배치 인덱싱
   */
  async indexURLs(
    urls: string[],
    options: IndexingOptions = {}
  ): Promise<IndexingResult[]> {
    console.log(`${urls.length}개 URL 배치 인덱싱 시작`);

    const results: IndexingResult[] = [];

    for (const url of urls) {
      try {
        const result = await this.indexURL(url, options);
        results.push(result);
      } catch (error) {
        console.error(`URL 인덱싱 실패: ${url}`, error);
        results.push({
          documentId: `failed_${Date.now()}`,
          status: 'failed',
          chunksProcessed: 0,
          embeddingsGenerated: 0,
          processingTime: 0,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    console.log(`배치 인덱싱 완료: ${results.length}개 URL 처리`);
    return results;
  }

  /**
   * 문서 검색
   */
  async searchDocuments(
    query: string,
    options: {
      matchThreshold?: number;
      matchCount?: number;
      documentTypes?: string[];
    } = {}
  ) {
    try {
      // 1. 쿼리 임베딩 생성
      await embeddingService.initialize();
      const queryEmbedding = await embeddingService.generateEmbedding(query);

      // 2. 유사도 검색
      const results = await vectorStorageService.searchSimilarChunks(
        queryEmbedding.embedding,
        options
      );

      return results;
    } catch (error) {
      console.error('문서 검색 실패:', error);
      throw new Error(`문서 검색 실패: ${error}`);
    }
  }

  /**
   * 리소스 정리
   */
  async cleanup(): Promise<void> {
    try {
      // documentProcessingService에 cleanup 메서드가 없으므로 제거
      // await documentProcessingService.cleanup();
      await embeddingService.cleanup();
      console.log('문서 인덱싱 서비스 정리 완료');
    } catch (error) {
      console.error('리소스 정리 실패:', error);
    }
  }
}

// 싱글톤 인스턴스
export const documentIndexingService = new DocumentIndexingService();
