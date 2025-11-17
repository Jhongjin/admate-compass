// pipeline은 동적으로 import

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimension: number;
  processingTime: number;
}

export interface EmbeddingOptions {
  model?: 'bge-m3' | 'all-MiniLM-L6-v2' | 'openai';
  batchSize?: number;
  normalize?: boolean;
}

export type HeartbeatCallback = (elapsed: number, remaining: number) => Promise<void>;

export class EmbeddingService {
  private pipeline: any = null;
  private currentModel: string | null = null;
  private isInitialized = false;
  private heartbeatCallback: HeartbeatCallback | null = null;

  // 초기화 상태 확인용 getter (서버리스 환경에서 캐싱 확인)
  get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * 하트비트 콜백 설정 (DB 업데이트용)
   */
  setHeartbeatCallback(callback: HeartbeatCallback | null): void {
    this.heartbeatCallback = callback;
  }

  /**
   * 임베딩 모델 초기화
   */
  async initialize(model: string = 'bge-m3', initTimeout: number = 10 * 60 * 1000): Promise<void> {
    try {
      if (this.isInitialized && this.currentModel === model) {
        console.log('임베딩 모델이 이미 초기화됨:', model);
        return;
      }

      console.log(`🔄 임베딩 모델 초기화 중: ${model} (처음 로드 시 시간이 걸릴 수 있습니다)`);
      
      // Vercel 서버리스 환경 감지: /tmp 디렉토리 사용 가능 여부 확인
      const isVercel = process.env.VERCEL === '1' || typeof process.env.VERCEL !== 'undefined';
      const cacheDir = isVercel ? '/tmp/.cache/transformers' : './.cache/transformers';
      
      // 캐시 디렉토리 생성 (필요한 경우)
      if (isVercel) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const cachePath = path.dirname(cacheDir);
          if (!fs.existsSync(cachePath)) {
            fs.mkdirSync(cachePath, { recursive: true });
            console.log(`📁 캐시 디렉토리 생성: ${cachePath}`);
          }
        } catch (mkdirError) {
          console.warn('⚠️ 캐시 디렉토리 생성 실패 (계속 진행):', mkdirError);
        }
      }
      
      console.log(`📂 임베딩 모델 캐시 경로: ${cacheDir} (Vercel: ${isVercel})`);
      
      // 환경 변수 설정 (Xenova Transformers가 사용)
      if (isVercel) {
        process.env.HF_HOME = '/tmp/.cache';
        process.env.TRANSFORMERS_CACHE = cacheDir;
        console.log(`🔧 환경 변수 설정: HF_HOME=/tmp/.cache, TRANSFORMERS_CACHE=${cacheDir}`);
      }
      
      // 동적으로 pipeline을 import하여 빌드 시 오류 방지
      const initStartMs = Date.now();
      console.log('📦 @xenova/transformers 모듈 로딩 중...');
      const { pipeline } = await import('@xenova/transformers');
      const importMs = Date.now() - initStartMs;
      console.log(`✅ 모듈 로딩 완료: ${importMs}ms`);
      
      // BGE-M3 모델 초기화 (동기 방식 + 진행 상황 추적)
      const modelInitStartMs = Date.now();
      console.log('🔄 BGE-M3 모델 초기화 시작 (다운로드/로딩 중...)');
      console.log(`📂 캐시 디렉토리: ${cacheDir}`);
      
      // 진행 상황 추적을 위한 하트비트 로깅 및 DB 업데이트 (15초마다)
      let lastHeartbeatTime = modelInitStartMs;
      let heartbeatCount = 0;
      
      // 하트비트 실행 함수 (재사용)
      const executeHeartbeat = async () => {
        const now = Date.now();
        const elapsed = now - modelInitStartMs;
        const elapsedSeconds = (elapsed / 1000).toFixed(1);
        const remaining = Math.max(0, initTimeout - elapsed);
        const remainingSeconds = (remaining / 1000).toFixed(1);
        heartbeatCount++;
        
        // 하트비트 로깅 및 DB 업데이트
        console.log(`⏳ BGE-M3 모델 초기화 진행 중... (경과: ${elapsedSeconds}초, 하트비트: ${heartbeatCount}회, 캐시: ${cacheDir})`);
        lastHeartbeatTime = now;
        
        // DB 업데이트 콜백 실행 (있는 경우)
        if (this.heartbeatCallback) {
          try {
            console.log(`[CRITICAL] 💓 하트비트 콜백 실행 시작... (경과: ${elapsedSeconds}초, 남은 시간: ${remainingSeconds}초)`);
            await this.heartbeatCallback(elapsed, remaining);
            console.log(`[CRITICAL] ✅ 하트비트 콜백 실행 완료`);
          } catch (err) {
            console.warn('[CRITICAL] ⚠️ 하트비트 콜백 실행 실패 (계속 진행):', err);
          }
        } else {
          console.log(`[CRITICAL] ℹ️ 하트비트 콜백이 설정되지 않음 (jobId가 없거나 콜백이 제거됨)`);
        }
        
        // 30초 이상 경과 시 경고 로그 추가
        if (elapsed > 30000) {
          console.warn(`⚠️ BGE-M3 모델 초기화가 오래 걸리고 있습니다 (${elapsedSeconds}초 경과). 서버리스 환경에서 모델 다운로드가 느릴 수 있습니다.`);
        }
        
        // 60초 이상 경과 시 추가 경고
        if (elapsed > 60000) {
          console.warn(`⚠️ BGE-M3 모델 초기화가 매우 오래 걸리고 있습니다 (${elapsedSeconds}초 경과). 네트워크 상태를 확인해주세요.`);
        }
      };
      
      // 즉시 첫 하트비트 실행 (진행 상황을 즉시 반영)
      console.log(`[CRITICAL] 🚀 첫 하트비트 즉시 실행 (초기화 시작 직후)`);
      await executeHeartbeat().catch((err) => {
        console.warn('[CRITICAL] ⚠️ 첫 하트비트 실행 실패 (계속 진행):', err);
      });
      
      // 15초마다 하트비트 실행
      let heartbeatIntervalId: NodeJS.Timeout | null = null;
      let heartbeatIntervalCount = 0;
      
      const startHeartbeatInterval = () => {
        heartbeatIntervalCount++;
        console.log(`[CRITICAL] ⏰ 하트비트 인터벌 시작 (${heartbeatIntervalCount}번째 설정)`);
        
        heartbeatIntervalId = setInterval(async () => {
          const triggerTime = new Date().toISOString();
          const elapsedSinceInit = Date.now() - modelInitStartMs;
          console.log(`[CRITICAL] ⏰ 하트비트 인터벌 트리거됨 (${triggerTime}, 경과: ${(elapsedSinceInit / 1000).toFixed(1)}초, 인터벌 카운트: ${heartbeatIntervalCount})`);
          
          await executeHeartbeat().catch((err) => {
            console.warn('[CRITICAL] ⚠️ 하트비트 실행 실패 (계속 진행):', err);
          });
        }, 15000);
        
        console.log(`[CRITICAL] ⏰ 하트비트 인터벌 설정 완료: intervalId=${heartbeatIntervalId ? '설정됨' : 'NULL'}, 15초마다 실행 예정`);
      };
      
      startHeartbeatInterval();
      
      // 하트비트 루프: pipeline() 호출과 병렬로 실행되어 블로킹되지 않도록 함
      // 서버리스 환경에서 setInterval이 신뢰성 있게 실행되지 않을 수 있으므로, 재귀적 setTimeout 사용
      let heartbeatLoopActive = true;
      let heartbeatLoopCount = 0;
      
      const runHeartbeatLoop = async (): Promise<void> => {
        if (!heartbeatLoopActive) return;
        
        heartbeatLoopCount++;
        const elapsed = Date.now() - modelInitStartMs;
        const timeSinceLastHeartbeat = elapsed - (lastHeartbeatTime - modelInitStartMs);
        
        // 15초마다 하트비트 실행
        if (timeSinceLastHeartbeat >= 15000) {
          console.log(`[CRITICAL] 💓 하트비트 루프 실행 (${heartbeatLoopCount}회): 경과 ${(elapsed / 1000).toFixed(1)}초, 마지막 하트비트로부터 ${(timeSinceLastHeartbeat / 1000).toFixed(1)}초 경과`);
          await executeHeartbeat().catch((err) => {
            console.warn('[CRITICAL] ⚠️ 하트비트 루프 실행 실패:', err);
          });
        }
        
        // 다음 하트비트를 5초 후에 스케줄링 (재귀적 호출)
        if (heartbeatLoopActive) {
          setTimeout(() => runHeartbeatLoop(), 5000);
        }
      };
      
      // 하트비트 루프 시작 (비동기로 실행되어 pipeline() 호출을 블로킹하지 않음)
      runHeartbeatLoop().catch((err) => {
        console.warn('[CRITICAL] ⚠️ 하트비트 루프 시작 실패:', err);
      });
      
      console.log(`[CRITICAL] 🔄 하트비트 루프 시작: 5초마다 확인, 15초마다 정기 하트비트 실행 (pipeline() 호출과 병렬 실행)`);
      
      try {
        console.log(`📥 BGE-M3 모델 다운로드/로딩 시작 (quantized: true, cache: ${cacheDir})`);
        console.log(`[CRITICAL] 📥 모델 다운로드 시작 - 하트비트는 pipeline() 호출과 병렬로 실행됩니다.`);
        console.log(`[CRITICAL] ⏱️ 예상 소요 시간: 40-90초 (서버리스 환경, 네트워크 상태에 따라 다름)`);
        
        // 모델 초기화 진행 (하트비트 루프와 병렬로 실행)
        const pipelineStartTime = Date.now();
        this.pipeline = await pipeline('feature-extraction', 'Xenova/bge-m3', {
          // 모델 로딩 최적화
          quantized: true,
          // 캐시 사용 (Vercel 환경에서는 /tmp 사용)
          cache_dir: cacheDir,
          // 추가 옵션
          local_files_only: false,
          revision: 'main'
        });
        
        const pipelineElapsed = Date.now() - pipelineStartTime;
        console.log(`[CRITICAL] ✅ pipeline() 호출 완료: ${pipelineElapsed}ms (${(pipelineElapsed / 1000).toFixed(1)}초)`);
        
        // pipeline() 완료 후 하트비트 루프 및 인터벌 정리
        heartbeatLoopActive = false;
        if (heartbeatIntervalId) {
          clearInterval(heartbeatIntervalId);
          console.log(`[CRITICAL] 🧹 하트비트 인터벌 정리 완료`);
        }
        
        const modelInitMs = Date.now() - modelInitStartMs;
        const modelInitSeconds = (modelInitMs / 1000).toFixed(1);
        console.log(`✅ BGE-M3 파이프라인 인스턴스 생성 완료`);
        console.log(`✅ BGE-M3 모델 초기화 완료: ${modelInitMs}ms (${modelInitSeconds}초)`);
      } catch (error) {
        // 하트비트 루프 및 인터벌 정리
        heartbeatLoopActive = false;
        if (heartbeatIntervalId) {
          clearInterval(heartbeatIntervalId);
          console.log(`[CRITICAL] 🧹 하트비트 인터벌 정리 완료 (에러 발생)`);
        }
        const elapsed = Date.now() - modelInitStartMs;
        const elapsedSeconds = (elapsed / 1000).toFixed(1);
        console.error(`❌ BGE-M3 모델 초기화 실패 (경과: ${elapsedSeconds}초):`, error);
        throw error;
      }
      this.currentModel = model;
      this.isInitialized = true;
      
      console.log('✅ 임베딩 모델 초기화 완료 - BGE-M3 (1024차원)');
    } catch (error) {
      console.error('❌ 임베딩 모델 초기화 실패:', error);
      console.error('상세 오류:', error);
      
      // 초기화 실패 시 더미 모드로 전환하지 않고 오류를 던짐
      throw new Error(`임베딩 모델 초기화 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 단일 텍스트에 대한 임베딩 생성
   */
  async generateEmbedding(
    text: string,
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();
    
    try {
      if (!this.isInitialized) {
        console.log('🔄 임베딩 서비스 초기화 중...');
        await this.initialize(options.model);
      }

      if (!this.pipeline) {
        throw new Error('임베딩 파이프라인이 초기화되지 않았습니다.');
      }

      // 텍스트 전처리
      const processedText = this.preprocessText(text);
      
      // 빈 텍스트 검증
      if (!processedText || processedText.trim().length === 0) {
        throw new Error('빈 텍스트는 임베딩을 생성할 수 없습니다.');
      }
      
      console.log(`🔄 임베딩 생성 중: "${processedText.substring(0, 50)}..."`);
      
      // 임베딩 생성
      const result = await this.pipeline(processedText, {
        pooling: 'mean',
        normalize: options.normalize ?? true
      });

      // 결과 검증
      if (!result || !result.data) {
        throw new Error('임베딩 생성 결과가 유효하지 않습니다.');
      }

      // 결과 처리
      const embedding = Array.from(result.data) as number[];
      
      // 임베딩 유효성 검증
      if (!embedding || embedding.length === 0) {
        throw new Error('생성된 임베딩이 비어있습니다.');
      }

      // 차원 수 검증 (BGE-M3는 1024차원, OpenAI text-embedding-3-small는 1536차원)
      const expectedDimension = this.currentModel === 'bge-m3' ? 1024 : 1536;
      if (embedding.length !== expectedDimension) {
        console.warn(`⚠️ 임베딩 차원 수 불일치: ${embedding.length} (예상: ${expectedDimension}, 모델: ${this.currentModel})`);
        // 차원이 다르더라도 계속 진행 (호환성을 위해)
      }

      // 숫자 배열 검증
      if (!embedding.every(item => typeof item === 'number' && !isNaN(item))) {
        throw new Error('임베딩에 유효하지 않은 숫자가 포함되어 있습니다.');
      }

      const dimension = embedding.length;
      const processingTime = Date.now() - startTime;

      console.log(`✅ 임베딩 생성 성공: ${dimension}차원, ${processingTime}ms`);

      return {
        embedding,
        model: this.currentModel || 'bge-m3',
        dimension,
        processingTime
      };
    } catch (error) {
      console.error('❌ 임베딩 생성 실패:', error);
      
      // 초기화 실패인 경우 더미 모드로 전환
      if (error instanceof Error && error.message.includes('초기화 실패')) {
        console.warn('⚠️ 임베딩 모델 초기화 실패로 더미 모드로 전환합니다.');
        
        const dummyEmbedding = new Array(1536).fill(0).map(() => Math.random() - 0.5);
        
        return {
          embedding: dummyEmbedding,
          model: 'dummy',
          dimension: 1536,
          processingTime: Date.now() - startTime
        };
      }
      
      // 다른 오류는 그대로 던짐
      throw error;
    }
  }

  /**
   * 여러 텍스트에 대한 배치 임베딩 생성
   */
  async generateBatchEmbeddings(
    texts: string[],
    options: EmbeddingOptions = {}
  ): Promise<EmbeddingResult[]> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 10;
    const results: EmbeddingResult[] = [];

    try {
      if (!this.isInitialized) {
        await this.initialize(options.model);
      }

      if (!this.pipeline) {
        throw new Error('임베딩 파이프라인이 초기화되지 않았습니다.');
      }

      // 배치 처리
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const processedBatch = batch.map(text => this.preprocessText(text));
        
        console.log(`배치 처리 중: ${i + 1}-${Math.min(i + batchSize, texts.length)}/${texts.length}`);
        
        const batchResults = await Promise.all(
          processedBatch.map(async (text) => {
            const result = await this.pipeline!(text, {
              pooling: 'mean',
              normalize: options.normalize ?? true
            });
            
            return {
              embedding: Array.from(result.data) as number[],
              model: this.currentModel || 'bge-m3',
              dimension: result.data.length,
              processingTime: Date.now() - startTime
            };
          })
        );
        
        results.push(...batchResults);
      }

      console.log(`배치 임베딩 생성 완료: ${texts.length}개 텍스트, ${Date.now() - startTime}ms`);
      return results;
    } catch (error) {
      console.error('배치 임베딩 생성 실패:', error);
      throw new Error(`배치 임베딩 생성 실패: ${error}`);
    }
  }

  /**
   * 텍스트 전처리 (한국어 최적화)
   */
  private preprocessText(text: string): string {
    return text
      .trim()
      // 불필요한 공백 제거
      .replace(/\s+/g, ' ')
      // 특수 문자 정리
      .replace(/[^\w\s가-힣.,!?;:()\[\]{}"'`~@#$%^&*+=|\\/<>]/g, '')
      // 연속된 구두점 정리
      .replace(/[.]{2,}/g, '.')
      .replace(/[!]{2,}/g, '!')
      .replace(/[?]{2,}/g, '?')
      // 최대 길이 제한 (BGE-M3는 8192 토큰 제한)
      .slice(0, 4000);
  }

  /**
   * 임베딩 유사도 계산 (코사인 유사도)
   */
  calculateSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('임베딩 차원이 일치하지 않습니다.');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * 벡터 정규화
   */
  normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude === 0 ? vector : vector.map(val => val / magnitude);
  }

  /**
   * 임베딩 차원 확인
   */
  getEmbeddingDimension(): number {
    // BGE-M3는 1024차원
    return 1024;
  }

  /**
   * 모델 정보 반환
   */
  getModelInfo(): { name: string; dimension: number; maxTokens: number } {
    return {
      name: this.currentModel || 'bge-m3',
      dimension: this.getEmbeddingDimension(),
      maxTokens: 8192
    };
  }

  /**
   * 리소스 정리
   */
  async cleanup(): Promise<void> {
    if (this.pipeline) {
      // Transformers.js는 명시적인 cleanup이 필요하지 않음
      this.pipeline = null;
      this.isInitialized = false;
      this.currentModel = null;
    }
  }
}

// 싱글톤 인스턴스
export const embeddingService = new EmbeddingService();
