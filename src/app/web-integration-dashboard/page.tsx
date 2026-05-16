'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, AlertTriangle, Bot, Database, Cloud, RefreshCw } from 'lucide-react';

interface ServiceStatus {
  status: 'healthy' | 'unhealthy' | 'ready' | 'not_configured' | 'error';
  priority: 'primary' | 'backup' | 'support';
  description: string;
}

interface WebIntegrationStatus {
  overall: {
    status: 'operational' | 'degraded' | 'critical' | 'error';
    message: string;
  };
  services: {
    answer: ServiceStatus;
    rag: ServiceStatus;
  };
  environment: {
    answer: {
      provider: string;
      modelLabel: string;
      configured: boolean;
    };
    openrouter: {
      configured: boolean;
      modelsConfigured: boolean;
    };
    ollama: {
      baseUrl: string;
      defaultModel: string;
      configured: boolean;
    };
    supabase: {
      url: boolean;
      serviceKey: boolean;
      configured: boolean;
    };
  };
  timestamp: string;
  version: string;
}

export default function WebIntegrationDashboardPage() {
  const [status, setStatus] = useState<WebIntegrationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/web-integration-status');
      const data = await response.json();
      setStatus(data);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('상태 조회 실패:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // 30초마다 자동 새로고침
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'operational':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'ready':
        return <CheckCircle className="h-5 w-5 text-blue-500" />;
      case 'degraded':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'unhealthy':
      case 'critical':
      case 'error':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'not_configured':
        return <XCircle className="h-5 w-5 text-gray-500" />;
      default:
        return <AlertTriangle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'operational':
        return <Badge variant="default" className="bg-green-500">정상</Badge>;
      case 'ready':
        return <Badge variant="outline" className="border-blue-500 text-blue-500">준비됨</Badge>;
      case 'degraded':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-500">성능 저하</Badge>;
      case 'unhealthy':
      case 'critical':
      case 'error':
        return <Badge variant="destructive">오류</Badge>;
      case 'not_configured':
        return <Badge variant="outline" className="border-gray-500 text-gray-500">미설정</Badge>;
      default:
        return <Badge variant="outline">알 수 없음</Badge>;
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'primary':
        return <Bot className="h-4 w-4 text-blue-500" />;
      case 'backup':
        return <Cloud className="h-4 w-4 text-orange-500" />;
      case 'support':
        return <Database className="h-4 w-4 text-green-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
    }
  };

  if (isLoading && !status) {
    return (
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">웹 통합 서비스 상태를 확인하는 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">웹 통합 서비스 대시보드</h1>
            <p className="text-muted-foreground">
              Compass RAG와 답변 LLM 런타임의 실시간 상태를 모니터링합니다.
            </p>
          </div>
          <Button onClick={fetchStatus} disabled={isLoading} className="flex items-center gap-2">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            새로고침
          </Button>
        </div>
        {lastUpdated && (
          <p className="text-sm text-muted-foreground mt-2">
            마지막 업데이트: {lastUpdated.toLocaleString()}
          </p>
        )}
      </div>

      {status && (
        <div className="grid gap-6">
          {/* 전체 상태 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {getStatusIcon(status.overall.status)}
                전체 서비스 상태
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{status.overall.message}</p>
                  <p className="text-sm text-muted-foreground">
                    버전: {status.version} | 확인 시간: {new Date(status.timestamp).toLocaleString()}
                  </p>
                </div>
                {getStatusBadge(status.overall.status)}
              </div>
            </CardContent>
          </Card>

          {/* 서비스별 상태 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(status.services).map(([serviceName, serviceStatus]) => (
              <Card key={serviceName}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {getStatusIcon(serviceStatus.status)}
                    {serviceName === 'answer' ? '답변 LLM' :
                     serviceName === 'rag' ? 'RAG 시스템' : serviceName}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    {getPriorityIcon(serviceStatus.priority)}
                    {serviceStatus.priority === 'primary' ? '주 서비스' :
                     serviceStatus.priority === 'backup' ? '백업 서비스' :
                     serviceStatus.priority === 'support' ? '지원 서비스' : serviceStatus.priority}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">상태</span>
                      {getStatusBadge(serviceStatus.status)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {serviceStatus.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 환경 설정 상태 */}
          <Card>
            <CardHeader>
              <CardTitle>환경 설정 상태</CardTitle>
              <CardDescription>
                각 서비스의 환경 변수 설정 상태를 확인합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Answer runtime 설정 */}
                <div className="space-y-2">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Bot className="h-4 w-4" />
                    답변 LLM
                  </h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>런타임:</span>
                      <Badge variant={status.environment.answer.configured ? "default" : "outline"}>
                        {status.environment.answer.provider}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      모델: {status.environment.answer.modelLabel}
                    </div>
                  </div>
                </div>

                {/* OpenRouter 설정 */}
                <div className="space-y-2">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Cloud className="h-4 w-4" />
                    OpenRouter
                  </h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>API:</span>
                      <Badge variant={status.environment.openrouter.configured ? "default" : "outline"}>
                        {status.environment.openrouter.configured ? "설정됨" : "미설정"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      모델 목록: {status.environment.openrouter.modelsConfigured ? "환경 지정" : "기본 순서"}
                    </div>
                  </div>
                </div>

                {/* Ollama 설정 */}
                <div className="space-y-2">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Bot className="h-4 w-4" />
                    Ollama 대체
                  </h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Base URL:</span>
                      <Badge variant={status.environment.ollama.configured ? "default" : "outline"}>
                        {status.environment.ollama.configured ? "설정됨" : "미설정"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {status.environment.ollama.baseUrl}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      모델: {status.environment.ollama.defaultModel}
                    </div>
                  </div>
                </div>

                {/* Supabase 설정 */}
                <div className="space-y-2">
                  <h4 className="font-semibold flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Supabase 설정
                  </h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>연결:</span>
                      <Badge variant={status.environment.supabase.configured ? "default" : "outline"}>
                        {status.environment.supabase.configured ? "설정됨" : "미설정"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      RAG 시스템 지원
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

