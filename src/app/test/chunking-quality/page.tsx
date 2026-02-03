'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface ChunkingQualityMetrics {
  documentId: string;
  documentTitle: string;
  documentType: string;
  totalChunks: number;
  averageChunkSize: number;
  minChunkSize: number;
  maxChunkSize: number;
  coverage: number;
  hasMetadata: boolean;
  metadataFields: string[];
  processingTimeMs: number;
  chunksPerSecond: number;
  strategy: string;
  qualityScore: number;
  issues: string[];
}

interface SearchQualityMetrics {
  query: string;
  totalResults: number;
  averageSimilarity: number;
  filteredResults: number;
  rerankedResults: number;
  optimizedResults: number;
  hasTruncatedText: boolean;
  truncatedFiltered: number;
  processingTimeMs: number;
  qualityScore: number;
  issues: string[];
}

export default function ChunkingQualityTestPage() {
  const [loading, setLoading] = useState(false);
  const [testType, setTestType] = useState<'chunking' | 'search' | 'all'>('all');
  const [results, setResults] = useState<{
    chunkingTests?: ChunkingQualityMetrics[];
    searchTests?: SearchQualityMetrics[];
    summary: {
      totalTests: number;
      passedTests: number;
      failedTests: number;
      averageQualityScore: number;
    };
  } | null>(null);

  const runTest = async () => {
    setLoading(true);
    setResults(null);

    try {
      const response = await fetch('/api/test/chunking-quality', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testType,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResults(data.data);
      } else {
        console.error('테스트 실패:', data.error);
        alert(`테스트 실패: ${data.error}`);
      }
    } catch (error) {
      console.error('테스트 오류:', error);
      alert(`테스트 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    } finally {
      setLoading(false);
    }
  };

  const getQualityBadgeColor = (score: number) => {
    if (score >= 0.8) return 'bg-green-500';
    if (score >= 0.6) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getQualityLabel = (score: number) => {
    if (score >= 0.8) return '우수';
    if (score >= 0.6) return '양호';
    return '개선 필요';
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">청킹/검색 품질 검증</h1>
          <p className="text-muted-foreground mt-2">
            실제 데이터로 청킹 및 검색 품질을 종합적으로 테스트합니다.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>테스트 설정</CardTitle>
          <CardDescription>테스트할 항목을 선택하고 실행하세요.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button
              variant={testType === 'chunking' ? 'default' : 'outline'}
              onClick={() => setTestType('chunking')}
            >
              청킹만
            </Button>
            <Button
              variant={testType === 'search' ? 'default' : 'outline'}
              onClick={() => setTestType('search')}
            >
              검색만
            </Button>
            <Button
              variant={testType === 'all' ? 'default' : 'outline'}
              onClick={() => setTestType('all')}
            >
              전체
            </Button>
          </div>
          <Button onClick={runTest} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                테스트 실행 중...
              </>
            ) : (
              '테스트 실행'
            )}
          </Button>
        </CardContent>
      </Card>

      {results && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>요약</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">전체 테스트</div>
                  <div className="text-2xl font-bold">{results.summary.totalTests}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">통과</div>
                  <div className="text-2xl font-bold text-green-600">
                    {results.summary.passedTests}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">실패</div>
                  <div className="text-2xl font-bold text-red-600">
                    {results.summary.failedTests}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">평균 품질 점수</div>
                  <div className="text-2xl font-bold">
                    {(results.summary.averageQualityScore * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {results.chunkingTests && results.chunkingTests.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>청킹 품질 테스트 결과</CardTitle>
                <CardDescription>
                  {results.chunkingTests.length}개 문서에 대한 청킹 품질 검증 결과
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {results.chunkingTests.map((test, index) => (
                  <div key={index} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{test.documentTitle}</h3>
                        <p className="text-sm text-muted-foreground">
                          {test.documentType} • {test.totalChunks}개 청크
                        </p>
                      </div>
                      <Badge
                        className={getQualityBadgeColor(test.qualityScore)}
                      >
                        {getQualityLabel(test.qualityScore)} (
                        {(test.qualityScore * 100).toFixed(1)}%)
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">평균 청크 크기</div>
                        <div className="font-medium">{test.averageChunkSize}자</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">커버리지</div>
                        <div className="font-medium">{test.coverage}%</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">처리 시간</div>
                        <div className="font-medium">{test.processingTimeMs}ms</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">메타데이터</div>
                        <div className="font-medium">
                          {test.hasMetadata ? '✅' : '❌'} (
                          {test.metadataFields.length}개 필드)
                        </div>
                      </div>
                    </div>
                    {test.issues.length > 0 && (
                      <div className="mt-2">
                        <div className="text-sm font-medium text-red-600">이슈:</div>
                        <ul className="list-disc list-inside text-sm text-muted-foreground">
                          {test.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {results.searchTests && results.searchTests.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>검색 품질 테스트 결과</CardTitle>
                <CardDescription>
                  {results.searchTests.length}개 쿼리에 대한 검색 품질 검증 결과
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {results.searchTests.map((test, index) => (
                  <div key={index} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{test.query}</h3>
                        <p className="text-sm text-muted-foreground">
                          {test.totalResults}개 결과 • 평균 유사도:{' '}
                          {(test.averageSimilarity * 100).toFixed(1)}%
                        </p>
                      </div>
                      <Badge
                        className={getQualityBadgeColor(test.qualityScore)}
                      >
                        {getQualityLabel(test.qualityScore)} (
                        {(test.qualityScore * 100).toFixed(1)}%)
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">처리 시간</div>
                        <div className="font-medium">{test.processingTimeMs}ms</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">잘린 텍스트</div>
                        <div className="font-medium">
                          {test.hasTruncatedText ? '⚠️ 감지됨' : '✅ 없음'}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">필터링됨</div>
                        <div className="font-medium">{test.truncatedFiltered}개</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">최적화됨</div>
                        <div className="font-medium">{test.optimizedResults}개</div>
                      </div>
                    </div>
                    {test.issues.length > 0 && (
                      <div className="mt-2">
                        <div className="text-sm font-medium text-red-600">이슈:</div>
                        <ul className="list-disc list-inside text-sm text-muted-foreground">
                          {test.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

