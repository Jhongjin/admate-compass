'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';

export default function PaginationDetectionTestPage() {
  const [url, setUrl] = useState('https://ads.naver.com/help/faq?categorySeq=136');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    if (!url.trim()) {
      setError('URL을 입력해주세요');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/test/pagination-detection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '테스트 실패');
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Pagination 감지 테스트 (Phase 1)</CardTitle>
          <CardDescription>
            페이지에서 pagination 정보를 감지하고 URL 목록을 생성합니다
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* URL 입력 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">테스트 URL</label>
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://ads.naver.com/help/faq?categorySeq=136"
                className="flex-1"
              />
              <Button onClick={handleTest} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    테스트 중...
                  </>
                ) : (
                  '테스트'
                )}
              </Button>
            </div>
          </div>

          {/* 에러 표시 */}
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-center gap-2 text-red-400">
                <XCircle className="h-5 w-5" />
                <span className="font-medium">오류</span>
              </div>
              <p className="mt-2 text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* 결과 표시 */}
          {result && (
            <div className="space-y-4">
              {/* 감지 결과 요약 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">감지 결과</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    {result.result.success ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-green-400" />
                        <span className="font-medium text-green-400">감지 성공</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-5 w-5 text-red-400" />
                        <span className="font-medium text-red-400">감지 실패</span>
                      </>
                    )}
                  </div>

                  {result.result.error && (
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                      <p className="text-sm text-yellow-300">{result.result.error}</p>
                    </div>
                  )}

                  {result.result.pagination && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-sm text-gray-400">현재 페이지</span>
                          <p className="text-lg font-semibold">
                            {result.result.pagination.currentPage}
                          </p>
                        </div>
                        <div>
                          <span className="text-sm text-gray-400">전체 페이지</span>
                          <p className="text-lg font-semibold">
                            {result.result.pagination.totalPages}
                          </p>
                        </div>
                      </div>
                      <div>
                        <span className="text-sm text-gray-400">URL 패턴</span>
                        <p className="text-sm font-mono bg-gray-800 p-2 rounded mt-1 break-all">
                          {result.result.pagination.pageUrlPattern}
                        </p>
                      </div>
                      <div>
                        <span className="text-sm text-gray-400">페이지 파라미터</span>
                        <p className="text-sm font-mono bg-gray-800 p-2 rounded mt-1">
                          {result.result.pagination.pageParamName}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 디버깅 정보 */}
                  {result.result.debugInfo && (
                    <div className="mt-4 p-3 bg-gray-800 rounded">
                      <p className="text-sm font-medium mb-2">디버깅 정보</p>
                      <div className="space-y-1 text-xs">
                        <div>
                          <span className="text-gray-400">발견된 요소:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {result.result.debugInfo.foundElements?.map((el: string, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {el}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-400">추출된 숫자:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {result.result.debugInfo.extractedNumbers?.map((num: number, i: number) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {num}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 생성된 URL 목록 */}
              {result.generatedUrls && result.generatedUrls.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">
                      생성된 URL 목록 ({result.generatedUrls.length}개)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-96 overflow-y-auto space-y-1">
                      {result.generatedUrls.map((generatedUrl: string, index: number) => (
                        <div
                          key={index}
                          className="flex items-center gap-2 p-2 bg-gray-800 rounded hover:bg-gray-700 transition-colors"
                        >
                          <span className="text-xs text-gray-400 w-8">{index + 1}</span>
                          <a
                            href={generatedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex-1 text-sm font-mono text-blue-400 hover:text-blue-300 hover:underline break-all"
                          >
                            {generatedUrl}
                          </a>
                          <ExternalLink className="h-3 w-3 text-gray-500 flex-shrink-0" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

