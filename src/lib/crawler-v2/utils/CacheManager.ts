/**
 * 크롤링 결과 캐시 관리자
 * 동일 URL 재크롤링 시 캐시 활용
 */

import type { CrawlResult } from '../types';
import { normalizeUrl } from './url-utils';

interface CacheEntry {
  result: CrawlResult;
  cachedAt: number;
  expiresAt: number;
}

export class CacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private defaultTTL: number = 24 * 60 * 60 * 1000; // 24시간 (밀리초)

  /**
   * 캐시에서 결과 가져오기
   */
  get(url: string, maxAge?: number): CrawlResult | null {
    const normalizedUrl = normalizeUrl(url);
    const entry = this.cache.get(normalizedUrl);

    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.cachedAt;
    const maxAgeMs = maxAge ? maxAge * 1000 : this.defaultTTL;

    // 캐시 만료 확인
    if (age > maxAgeMs || now > entry.expiresAt) {
      this.cache.delete(normalizedUrl);
      return null;
    }

    console.log(`💾 캐시에서 로드: ${normalizedUrl} (${Math.round(age / 1000)}초 전 캐시)`);
    return entry.result;
  }

  /**
   * 캐시에 결과 저장
   */
  set(url: string, result: CrawlResult, ttl?: number): void {
    const normalizedUrl = normalizeUrl(url);
    const now = Date.now();
    const ttlMs = ttl ? ttl * 1000 : this.defaultTTL;

    this.cache.set(normalizedUrl, {
      result: {
        ...result,
        metadata: {
          ...result.metadata,
          cached: true,
          cachedAt: new Date().toISOString(),
        },
      },
      cachedAt: now,
      expiresAt: now + ttlMs,
    });

    console.log(`💾 캐시에 저장: ${normalizedUrl} (TTL: ${ttl || 24}시간)`);
  }

  /**
   * 캐시에서 제거
   */
  delete(url: string): void {
    const normalizedUrl = normalizeUrl(url);
    this.cache.delete(normalizedUrl);
  }

  /**
   * 캐시 무효화 (특정 URL 또는 전체)
   */
  invalidate(url?: string): void {
    if (url) {
      this.delete(url);
    } else {
      this.cache.clear();
      console.log('🗑️ 전체 캐시 무효화');
    }
  }

  /**
   * 만료된 캐시 정리
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [url, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(url);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 만료된 캐시 ${cleaned}개 정리`);
    }

    return cleaned;
  }

  /**
   * 캐시 통계
   */
  getStats(): {
    total: number;
    valid: number;
    expired: number;
    memoryUsage: number;
  } {
    const now = Date.now();
    let valid = 0;
    let expired = 0;

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expired++;
      } else {
        valid++;
      }
    }

    // 대략적인 메모리 사용량 추정 (바이트)
    const memoryUsage = this.cache.size * 1024; // 각 엔트리 약 1KB 추정

    return {
      total: this.cache.size,
      valid,
      expired,
      memoryUsage,
    };
  }

  /**
   * 캐시 크기 제한 (메모리 관리)
   */
  limitSize(maxSize: number): void {
    if (this.cache.size <= maxSize) {
      return;
    }

    // 오래된 캐시부터 제거
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt);

    const toRemove = this.cache.size - maxSize;
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }

    console.log(`📊 캐시 크기 제한: ${toRemove}개 항목 제거 (최대 ${maxSize}개)`);
  }
}

// 싱글톤 인스턴스
export const cacheManager = new CacheManager();

// 주기적으로 만료된 캐시 정리 (10분마다)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    cacheManager.cleanup();
  }, 10 * 60 * 1000);
}
