/**
 * 메모리 모니터링 유틸리티
 * 대량 크롤링 시 메모리 사용량 추적 및 관리
 */

interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  timestamp: number;
}

export class MemoryMonitor {
  private stats: MemoryStats[] = [];
  private maxStatsHistory = 100;
  private warningThreshold = 0.8; // 80% 사용 시 경고
  private criticalThreshold = 0.9; // 90% 사용 시 위험

  /**
   * 현재 메모리 사용량 가져오기
   */
  getCurrentMemory(): MemoryStats | null {
    if (typeof process === 'undefined' || !process.memoryUsage) {
      return null;
    }

    const usage = process.memoryUsage();
    const stats: MemoryStats = {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external || 0,
      rss: usage.rss,
      timestamp: Date.now(),
    };

    // 히스토리 저장 (최대 개수 제한)
    this.stats.push(stats);
    if (this.stats.length > this.maxStatsHistory) {
      this.stats.shift();
    }

    return stats;
  }

  /**
   * 메모리 사용량을 사람이 읽기 쉬운 형식으로 변환
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * 메모리 상태 확인 및 경고
   */
  checkMemory(): {
    status: 'ok' | 'warning' | 'critical';
    message: string;
    stats: MemoryStats | null;
  } {
    const stats = this.getCurrentMemory();

    if (!stats) {
      return {
        status: 'ok',
        message: '메모리 모니터링 불가 (Node.js 환경 아님)',
        stats: null,
      };
    }

    const heapUsageRatio = stats.heapUsed / stats.heapTotal;
    const rssUsageRatio = stats.rss / (4 * 1024 * 1024 * 1024); // 4GB 기준

    let status: 'ok' | 'warning' | 'critical' = 'ok';
    let message = '';

    if (heapUsageRatio >= this.criticalThreshold || rssUsageRatio >= 0.9) {
      status = 'critical';
      message = `⚠️ 메모리 사용량 위험: Heap ${(heapUsageRatio * 100).toFixed(1)}%, RSS ${this.formatBytes(stats.rss)}`;
    } else if (heapUsageRatio >= this.warningThreshold || rssUsageRatio >= 0.7) {
      status = 'warning';
      message = `⚠️ 메모리 사용량 경고: Heap ${(heapUsageRatio * 100).toFixed(1)}%, RSS ${this.formatBytes(stats.rss)}`;
    } else {
      message = `✅ 메모리 사용량 정상: Heap ${(heapUsageRatio * 100).toFixed(1)}%, RSS ${this.formatBytes(stats.rss)}`;
    }

    return { status, message, stats };
  }

  /**
   * 가비지 컬렉션 강제 실행 (가능한 경우)
   */
  forceGC(): boolean {
    if (global.gc && typeof global.gc === 'function') {
      try {
        global.gc();
        console.log('🧹 가비지 컬렉션 강제 실행');
        return true;
      } catch (error) {
        console.warn('⚠️ 가비지 컬렉션 실행 실패:', error);
        return false;
      }
    }

    console.log('ℹ️ 가비지 컬렉션 사용 불가 (--expose-gc 플래그 필요)');
    return false;
  }

  /**
   * 메모리 히스토리 가져오기
   */
  getHistory(): MemoryStats[] {
    return [...this.stats];
  }

  /**
   * 메모리 사용량 추세 분석
   */
  analyzeTrend(): {
    trend: 'increasing' | 'decreasing' | 'stable';
    average: number;
    peak: number;
  } {
    if (this.stats.length < 2) {
      return {
        trend: 'stable',
        average: 0,
        peak: 0,
      };
    }

    const heapUsages = this.stats.map((s) => s.heapUsed);
    const average = heapUsages.reduce((a, b) => a + b, 0) / heapUsages.length;
    const peak = Math.max(...heapUsages);

    // 최근 10개와 이전 10개 비교
    const recent = this.stats.slice(-10);
    const previous = this.stats.slice(-20, -10);

    if (recent.length === 0 || previous.length === 0) {
      return { trend: 'stable', average, peak };
    }

    const recentAvg =
      recent.reduce((sum, s) => sum + s.heapUsed, 0) / recent.length;
    const previousAvg =
      previous.reduce((sum, s) => sum + s.heapUsed, 0) / previous.length;

    const diff = recentAvg - previousAvg;
    const threshold = average * 0.1; // 10% 변화량 기준

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (diff > threshold) {
      trend = 'increasing';
    } else if (diff < -threshold) {
      trend = 'decreasing';
    }

    return { trend, average, peak };
  }

  /**
   * 메모리 정리 권장 여부 확인
   */
  shouldCleanup(): boolean {
    const check = this.checkMemory();
    const trend = this.analyzeTrend();

    return (
      check.status === 'critical' ||
      (check.status === 'warning' && trend.trend === 'increasing')
    );
  }
}

// 싱글톤 인스턴스
export const memoryMonitor = new MemoryMonitor();

