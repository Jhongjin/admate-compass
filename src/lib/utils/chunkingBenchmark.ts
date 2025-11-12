/**
 * 청킹 성능 벤치마크 도구
 * 다양한 문서 크기와 타입에서 청킹 성능을 측정
 */

import { unifiedChunkingService, UnifiedChunkingOptions } from '../services/UnifiedChunkingService';

export interface BenchmarkResult {
  testName: string;
  documentSize: number;
  documentType: 'pdf' | 'docx' | 'txt' | 'url';
  contentType: 'technical' | 'marketing' | 'policy' | 'faq' | 'general';
  options: UnifiedChunkingOptions;
  result: {
    totalChunks: number;
    averageChunkSize: number;
    coverage: number;
    processingTimeMs: number;
    performance: {
      encodingTimeMs: number;
      chunkingTimeMs: number;
      totalTimeMs: number;
      chunksPerSecond: number;
      memoryUsageMB?: number;
    };
  };
  timestamp: string;
}

export interface BenchmarkSuite {
  name: string;
  results: BenchmarkResult[];
  summary: {
    totalTests: number;
    averageProcessingTime: number;
    averageChunksPerSecond: number;
    averageMemoryUsage?: number;
    fastestTest: string;
    slowestTest: string;
  };
}

/**
 * 테스트 문서 생성기
 */
class TestDocumentGenerator {
  /**
   * 지정된 크기의 테스트 문서 생성
   */
  static generateDocument(size: number, contentType: 'technical' | 'marketing' | 'policy' | 'faq' | 'general' = 'general'): string {
    const baseText = this.getBaseText(contentType);
    const repeatCount = Math.ceil(size / baseText.length);
    return baseText.repeat(repeatCount).substring(0, size);
  }

  private static getBaseText(contentType: 'technical' | 'marketing' | 'policy' | 'faq' | 'general'): string {
    switch (contentType) {
      case 'faq':
        return `질문: 자주 묻는 질문입니다.
답변: 이것은 자주 묻는 질문에 대한 답변입니다. 상세한 설명을 포함하여 사용자가 이해하기 쉽도록 작성되었습니다.

질문: 또 다른 질문입니다.
답변: 이것은 또 다른 질문에 대한 답변입니다. `;

      case 'policy':
        return `정책 제목: 중요한 정책입니다.
정책 내용: 이것은 중요한 정책 내용입니다. 모든 사용자는 이 정책을 준수해야 합니다. 정책 위반 시 제재를 받을 수 있습니다.

정책 제목: 또 다른 정책입니다.
정책 내용: 이것은 또 다른 정책 내용입니다. `;

      case 'technical':
        return `API 엔드포인트: /api/v1/example
설명: 이것은 API 엔드포인트에 대한 기술 문서입니다. 요청 방법, 파라미터, 응답 형식 등을 포함합니다.

설정 방법:
1. 환경 변수 설정
2. 데이터베이스 연결
3. 서버 시작 `;

      case 'marketing':
        return `프로모션 제목: 특별 할인 이벤트
내용: 지금 바로 특별 할인을 받아보세요! 제한된 시간 동안만 제공되는 특별 혜택입니다.

캠페인 제목: 새로운 기능 출시
내용: 새로운 기능이 출시되었습니다. 더 나은 경험을 제공합니다. `;

      default:
        return `문서 제목: 일반 문서입니다.
문서 내용: 이것은 일반 문서의 내용입니다. 다양한 정보를 포함하고 있으며, 사용자에게 유용한 정보를 제공합니다.

섹션 제목: 추가 섹션
섹션 내용: 이것은 추가 섹션의 내용입니다. `;
    }
  }
}

/**
 * 청킹 벤치마크 실행
 */
export class ChunkingBenchmark {
  /**
   * 단일 테스트 실행
   */
  static async runSingleTest(
    testName: string,
    documentSize: number,
    documentType: 'pdf' | 'docx' | 'txt' | 'url',
    contentType: 'technical' | 'marketing' | 'policy' | 'faq' | 'general',
    options: UnifiedChunkingOptions = {}
  ): Promise<BenchmarkResult> {
    console.log(`\n🧪 벤치마크 테스트 시작: ${testName}`);
    console.log(`   문서 크기: ${documentSize}자`);
    console.log(`   문서 타입: ${documentType}`);
    console.log(`   콘텐츠 타입: ${contentType}`);

    // 테스트 문서 생성
    const content = TestDocumentGenerator.generateDocument(documentSize, contentType);
    const documentId = `benchmark_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const documentTitle = `벤치마크 테스트: ${testName}`;

    // 청킹 실행
    const startTime = Date.now();
    const result = await unifiedChunkingService.chunkDocument(
      content,
      documentId,
      documentTitle,
      {
        ...options,
        documentType,
        contentType,
      }
    );
    const endTime = Date.now();

    const benchmarkResult: BenchmarkResult = {
      testName,
      documentSize,
      documentType,
      contentType,
      options,
      result: {
        totalChunks: result.metadata.totalChunks,
        averageChunkSize: result.metadata.averageChunkSize,
        coverage: result.metadata.coverage,
        processingTimeMs: result.metadata.processingTimeMs,
        performance: result.metadata.performance,
      },
      timestamp: new Date().toISOString(),
    };

    console.log(`✅ 테스트 완료: ${testName}`);
    console.log(`   청크 수: ${result.metadata.totalChunks}`);
    console.log(`   평균 청크 크기: ${result.metadata.averageChunkSize}자`);
    console.log(`   커버리지: ${result.metadata.coverage}%`);
    console.log(`   처리 시간: ${result.metadata.processingTimeMs}ms`);
    console.log(`   초당 청크 수: ${result.metadata.performance.chunksPerSecond}`);

    return benchmarkResult;
  }

  /**
   * 벤치마크 스위트 실행
   */
  static async runSuite(
    suiteName: string = '기본 벤치마크 스위트'
  ): Promise<BenchmarkSuite> {
    console.log(`\n🚀 벤치마크 스위트 시작: ${suiteName}`);
    console.log('=' .repeat(60));

    const results: BenchmarkResult[] = [];

    // 다양한 문서 크기 테스트
    const documentSizes = [1000, 5000, 10000, 50000, 100000];
    const contentTypes: Array<'technical' | 'marketing' | 'policy' | 'faq' | 'general'> = [
      'general',
      'faq',
      'policy',
      'technical',
    ];

    for (const size of documentSizes) {
      for (const contentType of contentTypes) {
        const testName = `${contentType}_${size}자`;
        try {
          const result = await this.runSingleTest(
            testName,
            size,
            'txt',
            contentType,
            {
              chunkSize: 800,
              chunkOverlap: 100,
            }
          );
          results.push(result);
        } catch (error) {
          console.error(`❌ 테스트 실패: ${testName}`, error);
        }
      }
    }

    // 요약 계산
    const summary = this.calculateSummary(results);

    console.log('\n' + '='.repeat(60));
    console.log(`✅ 벤치마크 스위트 완료: ${suiteName}`);
    console.log(`   총 테스트 수: ${summary.totalTests}`);
    console.log(`   평균 처리 시간: ${summary.averageProcessingTime.toFixed(2)}ms`);
    console.log(`   평균 초당 청크 수: ${summary.averageChunksPerSecond.toFixed(2)}`);
    if (summary.averageMemoryUsage) {
      console.log(`   평균 메모리 사용량: ${summary.averageMemoryUsage.toFixed(2)}MB`);
    }
    console.log(`   가장 빠른 테스트: ${summary.fastestTest}`);
    console.log(`   가장 느린 테스트: ${summary.slowestTest}`);

    return {
      name: suiteName,
      results,
      summary,
    };
  }

  /**
   * 요약 계산
   */
  private static calculateSummary(results: BenchmarkResult[]): BenchmarkSuite['summary'] {
    if (results.length === 0) {
      return {
        totalTests: 0,
        averageProcessingTime: 0,
        averageChunksPerSecond: 0,
        fastestTest: 'N/A',
        slowestTest: 'N/A',
      };
    }

    const totalProcessingTime = results.reduce(
      (sum, r) => sum + r.result.processingTimeMs,
      0
    );
    const totalChunksPerSecond = results.reduce(
      (sum, r) => sum + r.result.performance.chunksPerSecond,
      0
    );
    const totalMemoryUsage = results
      .filter((r) => r.result.performance.memoryUsageMB !== undefined)
      .reduce(
        (sum, r) => sum + (r.result.performance.memoryUsageMB || 0),
        0
      );
    const memoryUsageCount = results.filter(
      (r) => r.result.performance.memoryUsageMB !== undefined
    ).length;

    const fastest = results.reduce((min, r) =>
      r.result.processingTimeMs < min.result.processingTimeMs ? r : min
    );
    const slowest = results.reduce((max, r) =>
      r.result.processingTimeMs > max.result.processingTimeMs ? r : max
    );

    return {
      totalTests: results.length,
      averageProcessingTime: totalProcessingTime / results.length,
      averageChunksPerSecond: totalChunksPerSecond / results.length,
      averageMemoryUsage:
        memoryUsageCount > 0 ? totalMemoryUsage / memoryUsageCount : undefined,
      fastestTest: fastest.testName,
      slowestTest: slowest.testName,
    };
  }

  /**
   * 결과를 JSON으로 내보내기
   */
  static exportResults(suite: BenchmarkSuite): string {
    return JSON.stringify(suite, null, 2);
  }

  /**
   * 결과를 CSV로 내보내기
   */
  static exportResultsCSV(suite: BenchmarkSuite): string {
    const headers = [
      'Test Name',
      'Document Size',
      'Document Type',
      'Content Type',
      'Total Chunks',
      'Average Chunk Size',
      'Coverage (%)',
      'Processing Time (ms)',
      'Encoding Time (ms)',
      'Chunking Time (ms)',
      'Chunks Per Second',
      'Memory Usage (MB)',
      'Timestamp',
    ];

    const rows = suite.results.map((r) => [
      r.testName,
      r.documentSize.toString(),
      r.documentType,
      r.contentType,
      r.result.totalChunks.toString(),
      r.result.averageChunkSize.toString(),
      r.result.coverage.toString(),
      r.result.processingTimeMs.toString(),
      r.result.performance.encodingTimeMs.toString(),
      r.result.performance.chunkingTimeMs.toString(),
      r.result.performance.chunksPerSecond.toString(),
      r.result.performance.memoryUsageMB?.toString() || 'N/A',
      r.timestamp,
    ]);

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }
}

