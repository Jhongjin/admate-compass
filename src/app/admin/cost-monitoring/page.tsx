"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import AdminLayout from "@/components/layouts/AdminLayout";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  CheckCircle, 
  Database, 
  Server,
  RefreshCw,
  BarChart3,
  PieChart,
  Activity
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

interface CostMetrics {
  supabase: {
    database: {
      size: number;
      sizeFormatted: string;
      estimatedCost: number;
      estimatedCostFormatted: string;
    };
    storage: {
      size: number;
      sizeFormatted: string;
      estimatedCost: number;
      estimatedCostFormatted: string;
    };
    bandwidth: {
      usage: number;
      usageFormatted: string;
      estimatedCost: number;
      estimatedCostFormatted: string;
    };
    total: {
      estimatedCost: number;
      estimatedCostFormatted: string;
    };
  };
  vercel: {
    functionInvocations: {
      count: number;
      estimatedCost: number;
      estimatedCostFormatted: string;
    };
    bandwidth: {
      usage: number;
      usageFormatted: string;
      estimatedCost: number;
      estimatedCostFormatted: string;
    };
    total: {
      estimatedCost: number;
      estimatedCostFormatted: string;
    };
  };
  total: {
    estimatedCost: number;
    estimatedCostFormatted: string;
    budgetUsage: number;
    budgetRemaining: number;
    status: 'healthy' | 'warning' | 'critical';
  };
  trends: {
    daily: Array<{
      date: string;
      supabase: number;
      vercel: number;
      total: number;
    }>;
    monthly: Array<{
      month: string;
      supabase: number;
      vercel: number;
      total: number;
    }>;
  };
  alerts: Array<{
    type: 'budget' | 'usage' | 'anomaly';
    severity: 'info' | 'warning' | 'critical';
    message: string;
    timestamp: string;
  }>;
}

interface CostMetadata {
  documentCount: number;
  chunkCount: number;
  jobCount: number;
  monthlyBudget: number;
  lastUpdated: string;
}

export default function CostMonitoringPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [costMetrics, setCostMetrics] = useState<CostMetrics | null>(null);
  const [metadata, setMetadata] = useState<CostMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadCostData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch('/api/admin/cost-monitoring');
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || '비용 데이터를 불러오는데 실패했습니다.');
      }
      
      setCostMetrics(data.data);
      setMetadata(data.metadata);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다.';
      setError(errorMessage);
      toast({
        title: "비용 데이터 로드 실패",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCostData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      loadCostData();
    }, 60000); // 1분마다 새로고침
    
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const getStatusColor = (status: 'healthy' | 'warning' | 'critical') => {
    switch (status) {
      case 'healthy':
        return 'text-green-400 bg-green-500/20 border-green-400/30';
      case 'warning':
        return 'text-yellow-400 bg-yellow-500/20 border-yellow-400/30';
      case 'critical':
        return 'text-red-400 bg-red-500/20 border-red-400/30';
    }
  };

  const getStatusIcon = (status: 'healthy' | 'warning' | 'critical') => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="w-5 h-5" />;
      case 'warning':
      case 'critical':
        return <AlertTriangle className="w-5 h-5" />;
    }
  };

  if (loading || isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6 p-6">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AdminLayout>
    );
  }

  if (error || !costMetrics || !metadata) {
    return (
      <AdminLayout>
        <div className="space-y-6 p-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>오류</AlertTitle>
            <AlertDescription>{error || '비용 데이터를 불러올 수 없습니다.'}</AlertDescription>
          </Alert>
          <Button onClick={loadCostData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            다시 시도
          </Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6 p-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-primary-enhanced flex items-center gap-2">
              <DollarSign className="w-8 h-8" />
              비용 모니터링
            </h1>
            <p className="text-muted-enhanced mt-2">
              Supabase 및 Vercel 사용량 추적 및 예산 관리
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
              {autoRefresh ? '자동 새로고침 활성화' : '자동 새로고침 비활성화'}
            </Button>
            <Button variant="outline" size="sm" onClick={loadCostData}>
              <RefreshCw className="w-4 h-4 mr-2" />
              새로고침
            </Button>
          </div>
        </div>

        {/* 알림 */}
        {costMetrics.alerts.length > 0 && (
          <div className="space-y-2">
            {costMetrics.alerts.map((alert, idx) => (
              <Alert
                key={idx}
                variant={alert.severity === 'critical' ? 'destructive' : 'default'}
                className={alert.severity === 'warning' ? 'bg-yellow-500/20 border-yellow-400/30' : ''}
              >
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  {alert.severity === 'critical' ? '긴급' : alert.severity === 'warning' ? '경고' : '알림'}
                </AlertTitle>
                <AlertDescription>{alert.message}</AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* 총 비용 및 예산 사용률 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-secondary-enhanced">월 총 예상 비용</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary-enhanced">
                {costMetrics.total.estimatedCostFormatted}
              </div>
              <div className="text-sm text-muted-enhanced mt-2">
                예상 월 비용
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-secondary-enhanced">예산 사용률</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary-enhanced">
                {costMetrics.total.budgetUsage.toFixed(1)}%
              </div>
              <div className="w-full bg-gray-700 rounded-full h-2 mt-4">
                <div
                  className={`h-2 rounded-full ${
                    costMetrics.total.budgetUsage >= 90
                      ? 'bg-red-500'
                      : costMetrics.total.budgetUsage >= 70
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(costMetrics.total.budgetUsage, 100)}%` }}
                />
              </div>
              <div className="text-sm text-muted-enhanced mt-2">
                예산: ${metadata.monthlyBudget} / 사용: {costMetrics.total.estimatedCostFormatted}
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-secondary-enhanced">예산 잔액</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary-enhanced">
                ${costMetrics.total.budgetRemaining.toFixed(2)}
              </div>
              <Badge className={`mt-2 ${getStatusColor(costMetrics.total.status)}`}>
                {getStatusIcon(costMetrics.total.status)}
                <span className="ml-2">
                  {costMetrics.total.status === 'healthy' ? '정상' : 
                   costMetrics.total.status === 'warning' ? '주의' : '위험'}
                </span>
              </Badge>
            </CardContent>
          </Card>
        </div>

        {/* Supabase 비용 상세 */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-secondary-enhanced flex items-center gap-2">
              <Database className="w-5 h-5" />
              Supabase 비용
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <div className="text-sm text-muted-enhanced">데이터베이스</div>
                <div className="text-xl font-semibold text-primary-enhanced">
                  {costMetrics.supabase.database.sizeFormatted}
                </div>
                <div className="text-sm text-muted-enhanced">
                  {costMetrics.supabase.database.estimatedCostFormatted}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-enhanced">Storage</div>
                <div className="text-xl font-semibold text-primary-enhanced">
                  {costMetrics.supabase.storage.sizeFormatted}
                </div>
                <div className="text-sm text-muted-enhanced">
                  {costMetrics.supabase.storage.estimatedCostFormatted}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-enhanced">Bandwidth</div>
                <div className="text-xl font-semibold text-primary-enhanced">
                  {costMetrics.supabase.bandwidth.usageFormatted}
                </div>
                <div className="text-sm text-muted-enhanced">
                  {costMetrics.supabase.bandwidth.estimatedCostFormatted}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-enhanced">총 비용</div>
                <div className="text-xl font-semibold text-primary-enhanced">
                  {costMetrics.supabase.total.estimatedCostFormatted}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Vercel 비용 상세 */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-secondary-enhanced flex items-center gap-2">
              <Server className="w-5 h-5" />
              Vercel 비용
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-muted-enhanced">Function Invocations</div>
                <div className="text-xl font-semibold text-primary-enhanced">
                  {costMetrics.vercel.functionInvocations.count.toLocaleString()}회
                </div>
                <div className="text-sm text-muted-enhanced">
                  {costMetrics.vercel.functionInvocations.estimatedCostFormatted}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-enhanced">Bandwidth</div>
                <div className="text-xl font-semibold text-primary-enhanced">
                  {costMetrics.vercel.bandwidth.usageFormatted}
                </div>
                <div className="text-sm text-muted-enhanced">
                  {costMetrics.vercel.bandwidth.estimatedCostFormatted}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-enhanced">총 비용</div>
                <div className="text-xl font-semibold text-primary-enhanced">
                  {costMetrics.vercel.total.estimatedCostFormatted}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 통계 정보 */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-secondary-enhanced flex items-center gap-2">
              <Activity className="w-5 h-5" />
              시스템 통계
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-muted-enhanced">총 문서 수</div>
                <div className="text-2xl font-semibold text-primary-enhanced">
                  {metadata.documentCount.toLocaleString()}개
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-enhanced">총 청크 수</div>
                <div className="text-2xl font-semibold text-primary-enhanced">
                  {metadata.chunkCount.toLocaleString()}개
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-enhanced">처리 작업 수</div>
                <div className="text-2xl font-semibold text-primary-enhanced">
                  {metadata.jobCount.toLocaleString()}개
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-700">
              <div className="text-sm text-muted-enhanced">
                마지막 업데이트: {format(new Date(metadata.lastUpdated), 'yyyy-MM-dd HH:mm:ss', { locale: ko })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 트렌드 차트 (간단한 표시) */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle className="text-secondary-enhanced flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              비용 트렌드 (최근 7일)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {costMetrics.trends.daily.map((day, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 bg-gray-700/30 rounded">
                  <div className="text-sm text-muted-enhanced">
                    {format(new Date(day.date), 'MM월 dd일', { locale: ko })}
                  </div>
                  <div className="text-sm font-semibold text-primary-enhanced">
                    ${day.total.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

