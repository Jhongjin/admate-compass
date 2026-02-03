'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, AlertTriangle, CheckCircle, XCircle, Database, Wrench } from 'lucide-react';
import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';

interface EmbeddingStats {
  totalChunks: number;
  validEmbeddings: number;
  invalidEmbeddings: number;
  stringEmbeddings: number;
  arrayEmbeddings: number;
  zeroLengthEmbeddings: number;
}

interface ValidationResult {
  isValid: boolean;
  issues: string[];
  recommendations: string[];
  canBeFixed: boolean;
}

interface FixResult {
  success: boolean;
  fixedCount: number;
  errorCount: number;
  errors: Array<{ chunkId: string; error: string }>;
}

export default function EmbeddingHealthDashboard() {
  const [stats, setStats] = useState<EmbeddingStats | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch validation data
      const validationResponse = await fetchWithTimeout('/api/validate-embeddings');
      const validationData = await validationResponse.json();
      
      if (validationData.success) {
        setValidation(validationData.validation);
        setStats(validationData.stats);
        setLastUpdate(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch embedding data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fixEmbeddingFormats = async () => {
    setFixing(true);
    try {
      const response = await fetchWithTimeout('/api/fix-embedding-formats', {
        method: 'POST',
      });
      const result: { success: boolean; result: FixResult } = await response.json();
      
      if (result.success) {
        await fetchData(); // Refresh data
        alert(`임베딩 형식 수정 완료: ${result.result.fixedCount}개 성공, ${result.result.errorCount}개 실패`);
      } else {
        alert('임베딩 형식 수정 실패');
      }
    } catch (error) {
      console.error('Failed to fix embedding formats:', error);
      alert('임베딩 형식 수정 중 오류 발생');
    } finally {
      setFixing(false);
    }
  };

  const regenerateEmbeddings = async () => {
    setRegenerating(true);
    try {
      const response = await fetchWithTimeout('/api/regenerate-embeddings', {
        method: 'POST',
      });
      const result: { success: boolean; result: FixResult } = await response.json();
      
      if (result.success) {
        await fetchData(); // Refresh data
        alert(`임베딩 재생성 완료: ${result.result.fixedCount}개 성공, ${result.result.errorCount}개 실패`);
      } else {
        alert('임베딩 재생성 실패');
      }
    } catch (error) {
      console.error('Failed to regenerate embeddings:', error);
      alert('임베딩 재생성 중 오류 발생');
    } finally {
      setRegenerating(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getHealthStatus = () => {
    if (!stats) return 'unknown';
    if (stats.validEmbeddings === stats.totalChunks) return 'healthy';
    if (stats.validEmbeddings > stats.totalChunks * 0.8) return 'warning';
    return 'critical';
  };

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'critical': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
      case 'critical': return <XCircle className="h-5 w-5 text-red-600" />;
      default: return <Database className="h-5 w-5 text-gray-600" />;
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="h-6 w-6 animate-spin" />
        <span className="ml-2">임베딩 상태 확인 중...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">임베딩 상태 대시보드</h2>
          <p className="text-gray-600">벡터 임베딩의 상태를 모니터링하고 문제를 해결합니다</p>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      {/* Health Status */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {getHealthIcon(getHealthStatus())}
              임베딩 상태
            </CardTitle>
            <CardDescription>
              마지막 업데이트: {lastUpdate?.toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{stats.totalChunks}</div>
                <div className="text-sm text-gray-600">전체 청크</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{stats.validEmbeddings}</div>
                <div className="text-sm text-gray-600">유효한 임베딩</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{stats.invalidEmbeddings}</div>
                <div className="text-sm text-gray-600">유효하지 않은 임베딩</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">{stats.zeroLengthEmbeddings}</div>
                <div className="text-sm text-gray-600">길이 0인 임베딩</div>
              </div>
            </div>
            
            {stats.totalChunks > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-sm mb-1">
                  <span>임베딩 유효성</span>
                  <span>{Math.round((stats.validEmbeddings / stats.totalChunks) * 100)}%</span>
                </div>
                <Progress 
                  value={(stats.validEmbeddings / stats.totalChunks) * 100} 
                  className="h-2"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Validation Results */}
      {validation && (
        <Card>
          <CardHeader>
            <CardTitle>유효성 검사 결과</CardTitle>
            <CardDescription>
              임베딩 데이터의 상태를 분석한 결과입니다
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={validation.isValid ? "default" : "destructive"}>
                {validation.isValid ? "정상" : "문제 발견"}
              </Badge>
              <Badge variant={validation.canBeFixed ? "default" : "secondary"}>
                {validation.canBeFixed ? "수정 가능" : "수정 불가"}
              </Badge>
            </div>

            {validation.issues.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">발견된 문제:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {validation.issues.map((issue, index) => (
                      <li key={index} className="text-sm">{issue}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {validation.recommendations.length > 0 && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">권장 사항:</div>
                  <ul className="list-disc list-inside space-y-1">
                    {validation.recommendations.map((rec, index) => (
                      <li key={index} className="text-sm">{rec}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      <Card>
        <CardHeader>
          <CardTitle>임베딩 수정 도구</CardTitle>
          <CardDescription>
            발견된 문제를 해결하기 위한 도구들입니다
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button 
              onClick={fixEmbeddingFormats} 
              disabled={fixing || !validation?.canBeFixed}
              variant="outline"
            >
              <Wrench className="h-4 w-4 mr-2" />
              {fixing ? '수정 중...' : '임베딩 형식 수정'}
            </Button>
            
            <Button 
              onClick={regenerateEmbeddings} 
              disabled={regenerating}
              variant="outline"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${regenerating ? 'animate-spin' : ''}`} />
              {regenerating ? '재생성 중...' : '문제 임베딩 재생성'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Statistics */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle>상세 통계</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold mb-2">임베딩 형식</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>문자열 형식:</span>
                    <Badge variant="outline">{stats.stringEmbeddings}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>배열 형식:</span>
                    <Badge variant="outline">{stats.arrayEmbeddings}</Badge>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold mb-2">임베딩 상태</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>유효한 임베딩:</span>
                    <Badge variant="default">{stats.validEmbeddings}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>유효하지 않은 임베딩:</span>
                    <Badge variant="destructive">{stats.invalidEmbeddings}</Badge>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
