/**
 * 재시도 관리자
 * 실패한 크롤링 작업 자동 재시도
 */

export interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
}

export class RetryManager {
  private defaultOptions: Required<RetryOptions> = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
    retryableErrors: [
      'timeout',
      'network',
      'connection',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
    ],
  };

  /**
   * 재시도 가능한 에러인지 확인
   */
  isRetryableError(error: Error, retryableErrors?: string[]): boolean {
    const errors = retryableErrors || this.defaultOptions.retryableErrors;
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    return errors.some(
      (retryable) =>
        errorMessage.includes(retryable.toLowerCase()) ||
        errorName.includes(retryable.toLowerCase())
    );
  }

  /**
   * 재시도 로직 실행
   */
  async retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
  ): Promise<T> {
    const config = { ...this.defaultOptions, ...options };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 마지막 시도면 에러 던지기
        if (attempt >= config.maxRetries) {
          throw lastError;
        }

        // 재시도 불가능한 에러면 즉시 던지기
        if (!this.isRetryableError(lastError, config.retryableErrors)) {
          throw lastError;
        }

        // 지수 백오프로 대기 시간 계산
        const delay =
          config.retryDelay * Math.pow(config.backoffMultiplier, attempt);

        console.log(
          `🔄 재시도 ${attempt + 1}/${config.maxRetries}: ${lastError.message} (${delay}ms 후)`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('재시도 실패');
  }

  /**
   * 재시도 횟수에 따른 지연 시간 계산
   */
  calculateDelay(attempt: number, options: RetryOptions = {}): number {
    const config = { ...this.defaultOptions, ...options };
    return (
      config.retryDelay * Math.pow(config.backoffMultiplier, attempt)
    );
  }
}

// 싱글톤 인스턴스
export const retryManager = new RetryManager();
