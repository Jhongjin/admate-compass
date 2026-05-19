"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Activity, 
  Server, 
  Database, 
  Cpu, 
  HardDrive, 
  Network, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  RefreshCw,
  TrendingUp,
  TrendingDown,
  BarChart3,
  FileText,
  Zap,
  Shield,
  Globe,
  Users,
  Settings,
  Bell,
  Eye,
  Filter,
  Search,
  Download,
  Play,
  Pause,
  Square
} from "lucide-react";
// Chart components removed - using placeholder data instead
import { ChartErrorBoundary } from "@/components/admin/ChartErrorBoundary";

interface SystemMetrics {
  timestamp: string;
  cpu: {
    usage: number;
    cores: number;
    load: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
  database: {
    connections: number;
    queries: number;
    responseTime: number;
  };
  vectorStore: {
    totalVectors: number;
    indexSize: number;
    queryTime: number;
  };
}

interface SystemLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  details?: any;
}

interface MonitoringData {
  systemStatus: {
    overall: 'healthy' | 'warning' | 'error';
    database: 'connected' | 'disconnected' | 'error';
    llm: 'operational' | 'degraded' | 'error';
    vectorStore: 'indexed' | 'indexing' | 'error';
    lastUpdate: string;
  };
  metrics: SystemMetrics;
  recentLogs: SystemLog[];
  alerts: Array<{
    id: string;
    type: 'warning' | 'error' | 'info';
    title: string;
    message: string;
    timestamp: string;
    resolved: boolean;
  }>;
  performance: {
    avgResponseTime: number;
    requestsPerMinute: number;
    errorRate: number;
    uptime: number;
  };
}

export default function SystemMonitoringPage() {
  const [monitoringData, setMonitoringData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [timeRange, setTimeRange] = useState("1h");
  const [logLevel, setLogLevel] = useState("all");
  const [logSearch, setLogSearch] = useState("");

  // 모니터링 데이터 로드
  const loadMonitoringData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams({
        timeRange,
        logLevel
      });

      const response = await fetch(`/api/admin/monitoring?${params}`);
      const data = await response.json();

      if (data.success) {
        setMonitoringData(data.data);
      } else {
        throw new Error(data.error || '모니터링 데이터를 불러오는데 실패했습니다.');
      }
    } catch (err) {
      console.error('모니터링 데이터 로드 오류:', err);
      setError(err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    loadMonitoringData();
  }, [timeRange, logLevel]);

  // 자동 새로고침
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      loadMonitoringData();
    }, 30000); // 30초마다 새로고침

    return () => clearInterval(interval);
  }, [autoRefresh, timeRange, logLevel]);

  // 상태 아이콘 반환
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
      case "connected":
      case "operational":
      case "indexed":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "warning":
      case "degraded":
      case "indexing":
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case "error":
      case "disconnected":
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  // 상태 색상 반환
  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy":
      case "connected":
      case "operational":
      case "indexed":
        return "text-green-500";
      case "warning":
      case "degraded":
      case "indexing":
        return "text-yellow-500";
      case "error":
      case "disconnected":
        return "text-red-500";
      default:
        return "text-gray-400";
    }
  };

  // 로그 레벨 색상
  const getLogLevelColor = (level: string) => {
    switch (level) {
      case "error":
        return "text-red-500 bg-red-100";
      case "warn":
        return "text-yellow-500 bg-yellow-100";
      case "info":
        return "text-blue-500 bg-blue-100";
      case "debug":
        return "text-gray-500 bg-gray-100";
      default:
        return "text-gray-500 bg-gray-100";
    }
  };

  // 바이트 포맷팅
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 시간 포맷팅
  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours}h ${minutes}m ${secs}s`;
  };

  // 필터링된 로그
  const filteredLogs = monitoringData?.recentLogs.filter(log => 
    logSearch === "" || 
    log.message.toLowerCase().includes(logSearch.toLowerCase()) ||
    log.source.toLowerCase().includes(logSearch.toLowerCase())
  ) || [];

  if (loading && !monitoringData) {
    return (
      <AdminLayout currentPage="monitoring">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">시스템 모니터링</h1>
              <p className="text-gray-300 mt-2">실시간 시스템 상태 및 성능 모니터링</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (error) {
    return (
      <AdminLayout currentPage="monitoring">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">시스템 모니터링</h1>
              <p className="text-gray-300 mt-2">실시간 시스템 상태 및 성능 모니터링</p>
            </div>
          </div>
          <Alert className="bg-red-900/20 border-red-500/50">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>오류 발생</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout currentPage="monitoring">
      <div className="space-y-6">
        {/* 헤더 */}
        <motion.div 
          className="flex items-center justify-between"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div>
            <h1 className="text-3xl font-bold text-white">시스템 모니터링</h1>
            <p className="text-gray-300 mt-2">실시간 시스템 상태 및 성능 모니터링</p>
          </div>
          <div className="flex items-center space-x-4">
            <Button
              onClick={loadMonitoringData}
              disabled={loading}
              variant="outline"
              size="sm"
              className="border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </Button>
            <Button
              onClick={() => setAutoRefresh(!autoRefresh)}
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              className={autoRefresh ? "bg-green-600 hover:bg-green-700" : "border-gray-600 text-gray-300 hover:bg-gray-700"}
            >
              {autoRefresh ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              {autoRefresh ? '자동 새로고침 중' : '자동 새로고침 시작'}
            </Button>
          </div>
        </motion.div>

        {/* 시스템 상태 카드 */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-4 gap-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg text-white">
                <Activity className="w-5 h-5" />
                전체 상태
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-2">
                {getStatusIcon(monitoringData?.systemStatus.overall || 'error')}
                <span className={`font-medium ${getStatusColor(monitoringData?.systemStatus.overall || 'error')}`}>
                  {monitoringData?.systemStatus.overall === 'healthy' ? '정상' : 
                   monitoringData?.systemStatus.overall === 'warning' ? '주의' : '오류'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg text-white">
                <Database className="w-5 h-5" />
                데이터베이스
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-2">
                {getStatusIcon(monitoringData?.systemStatus.database || 'error')}
                <span className={`font-medium ${getStatusColor(monitoringData?.systemStatus.database || 'error')}`}>
                  {monitoringData?.systemStatus.database === 'connected' ? '연결됨' : 
                   monitoringData?.systemStatus.database === 'disconnected' ? '연결 끊김' : '오류'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg text-white">
                <Zap className="w-5 h-5" />
                답변 생성 상태
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-2">
                {getStatusIcon(monitoringData?.systemStatus.llm || 'error')}
                <span className={`font-medium ${getStatusColor(monitoringData?.systemStatus.llm || 'error')}`}>
                  {monitoringData?.systemStatus.llm === 'operational' ? '정상' : 
                   monitoringData?.systemStatus.llm === 'degraded' ? '성능 저하' : '오류'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg text-white">
                <BarChart3 className="w-5 h-5" />
                근거 검색 상태
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-2">
                {getStatusIcon(monitoringData?.systemStatus.vectorStore || 'error')}
                <span className={`font-medium ${getStatusColor(monitoringData?.systemStatus.vectorStore || 'error')}`}>
                  {monitoringData?.systemStatus.vectorStore === 'indexed' ? '검색 준비 완료' :
                   monitoringData?.systemStatus.vectorStore === 'indexing' ? '검색 준비 중' : '오류'}
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* 탭 컨텐츠 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Tabs defaultValue="metrics" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4 bg-gray-800/80 border-gray-700">
              <TabsTrigger value="metrics" className="data-[state=active]:bg-gray-700">성능 지표</TabsTrigger>
              <TabsTrigger value="logs" className="data-[state=active]:bg-gray-700">시스템 로그</TabsTrigger>
              <TabsTrigger value="alerts" className="data-[state=active]:bg-gray-700">알림</TabsTrigger>
              <TabsTrigger value="performance" className="data-[state=active]:bg-gray-700">성능 통계</TabsTrigger>
            </TabsList>

            {/* 성능 메트릭 탭 */}
            <TabsContent value="metrics" className="space-y-6">
              {/* 실시간 차트 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Cpu className="w-5 h-5" />
                      CPU 사용률 추이
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <Cpu className="w-12 h-12 mx-auto mb-2" />
                        <p>CPU 사용률 차트</p>
                        <p className="text-sm">차트 데이터를 로딩 중입니다...</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <HardDrive className="w-5 h-5" />
                      메모리 사용률 추이
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <HardDrive className="w-12 h-12 mx-auto mb-2" />
                        <p>메모리 사용률 차트</p>
                        <p className="text-sm">차트 데이터를 로딩 중입니다...</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Network className="w-5 h-5" />
                      네트워크 트래픽
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <Network className="w-12 h-12 mx-auto mb-2" />
                        <p>네트워크 트래픽 차트</p>
                        <p className="text-sm">차트 데이터를 로딩 중입니다...</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <TrendingUp className="w-5 h-5" />
                      요청 처리율
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <TrendingUp className="w-12 h-12 mx-auto mb-2" />
                        <p>요청 처리율 차트</p>
                        <p className="text-sm">차트 데이터를 로딩 중입니다...</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* 리소스 사용률 개요 */}
              <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                <CardHeader>
                  <CardTitle className="text-white">리소스 사용률 개요</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-lg font-medium text-white mb-4">시스템 리소스</h4>
                      <div className="h-64 flex items-center justify-center text-gray-400">
                        <div className="text-center">
                          <BarChart3 className="w-12 h-12 mx-auto mb-2" />
                          <p>리소스 사용률 파이 차트</p>
                          <p className="text-sm">차트 데이터를 로딩 중입니다...</p>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-lg font-medium text-white mb-4">오류율 추이</h4>
                      <div className="h-64 flex items-center justify-center text-gray-400">
                        <div className="text-center">
                          <AlertTriangle className="w-12 h-12 mx-auto mb-2" />
                          <p>오류율 추이 차트</p>
                          <p className="text-sm">차트 데이터를 로딩 중입니다...</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 개별 메트릭 카드 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* CPU 사용률 */}
                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Cpu className="w-5 h-5" />
                      CPU 사용률
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">사용률</span>
                        <span className="text-white font-medium">
                          {monitoringData?.metrics.cpu.usage.toFixed(1)}%
                        </span>
                      </div>
                      <Progress 
                        value={monitoringData?.metrics.cpu.usage || 0} 
                        className="h-2"
                      />
                      <div className="text-xs text-gray-400">
                        코어: {monitoringData?.metrics.cpu.cores}개
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 메모리 사용률 */}
                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <HardDrive className="w-5 h-5" />
                      메모리 사용률
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">사용량</span>
                        <span className="text-white font-medium">
                          {formatBytes(monitoringData?.metrics.memory.used || 0)}
                        </span>
                      </div>
                      <Progress 
                        value={((monitoringData?.metrics.memory.used || 0) / (monitoringData?.metrics.memory.total || 1)) * 100} 
                        className="h-2"
                      />
                      <div className="text-xs text-gray-400">
                        총 {formatBytes(monitoringData?.metrics.memory.total || 0)}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 디스크 사용률 */}
                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <HardDrive className="w-5 h-5" />
                      디스크 사용률
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">사용량</span>
                        <span className="text-white font-medium">
                          {formatBytes(monitoringData?.metrics.disk.used || 0)}
                        </span>
                      </div>
                      <Progress 
                        value={((monitoringData?.metrics.disk.used || 0) / (monitoringData?.metrics.disk.total || 1)) * 100} 
                        className="h-2"
                      />
                      <div className="text-xs text-gray-400">
                        총 {formatBytes(monitoringData?.metrics.disk.total || 0)}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 네트워크 */}
                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Network className="w-5 h-5" />
                      네트워크
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">수신</span>
                        <span className="text-white font-medium">
                          {formatBytes(monitoringData?.metrics.network.bytesIn || 0)}/s
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">송신</span>
                        <span className="text-white font-medium">
                          {formatBytes(monitoringData?.metrics.network.bytesOut || 0)}/s
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 데이터베이스 */}
                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Database className="w-5 h-5" />
                      데이터베이스
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">연결 수</span>
                        <span className="text-white font-medium">
                          {monitoringData?.metrics.database.connections}개
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">응답 시간</span>
                        <span className="text-white font-medium">
                          {monitoringData?.metrics.database.responseTime.toFixed(1)}ms
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 근거 검색 */}
                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <BarChart3 className="w-5 h-5" />
                      근거 검색
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">검색 근거 수</span>
                        <span className="text-white font-medium">
                          {monitoringData?.metrics.vectorStore.totalVectors.toLocaleString()}개
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">검색 자료 크기</span>
                        <span className="text-white font-medium">
                          {formatBytes(monitoringData?.metrics.vectorStore.indexSize || 0)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* 시스템 로그 탭 */}
            <TabsContent value="logs" className="space-y-6">
              <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white">시스템 로그</CardTitle>
                    <div className="flex items-center space-x-4">
                      <Select value={timeRange} onValueChange={setTimeRange}>
                        <SelectTrigger className="w-32 bg-gray-700 border-gray-600 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-800 border-gray-700">
                          <SelectItem value="15m">최근 15분</SelectItem>
                          <SelectItem value="1h">최근 1시간</SelectItem>
                          <SelectItem value="6h">최근 6시간</SelectItem>
                          <SelectItem value="24h">최근 24시간</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={logLevel} onValueChange={setLogLevel}>
                        <SelectTrigger className="w-32 bg-gray-700 border-gray-600 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-gray-800 border-gray-700">
                          <SelectItem value="all">모든 레벨</SelectItem>
                          <SelectItem value="error">오류</SelectItem>
                          <SelectItem value="warn">경고</SelectItem>
                          <SelectItem value="info">정보</SelectItem>
                          <SelectItem value="debug">디버그</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <Input
                          placeholder="로그 검색..."
                          value={logSearch}
                          onChange={(e) => setLogSearch(e.target.value)}
                          className="pl-10 w-64 bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                        />
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {filteredLogs.map((log) => (
                      <div key={log.id} className="flex items-start space-x-3 p-3 rounded-lg bg-gray-700/50">
                        <div className="flex-shrink-0">
                          <Badge className={`text-xs ${getLogLevelColor(log.level)}`}>
                            {log.level.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 text-sm">
                            <span className="text-gray-400">{log.source}</span>
                            <span className="text-gray-500">•</span>
                            <span className="text-gray-400">
                              {new Date(log.timestamp).toLocaleString('ko-KR')}
                            </span>
                          </div>
                          <p className="text-white text-sm mt-1">{log.message}</p>
                          {log.details && (
                            <details className="mt-2">
                              <summary className="text-gray-400 text-xs cursor-pointer">상세 정보</summary>
                              <pre className="text-xs text-gray-300 mt-1 bg-gray-800 p-2 rounded">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    ))}
                    {filteredLogs.length === 0 && (
                      <div className="text-center py-8 text-gray-400">
                        로그가 없습니다.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* 알림 탭 */}
            <TabsContent value="alerts" className="space-y-6">
              <div className="space-y-4">
                {monitoringData?.alerts.map((alert) => (
                  <Alert 
                    key={alert.id} 
                    className={`${
                      alert.type === 'error' ? 'bg-red-900/20 border-red-500/50' :
                      alert.type === 'warning' ? 'bg-yellow-900/20 border-yellow-500/50' :
                      'bg-blue-900/20 border-blue-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {alert.type === 'error' ? <AlertTriangle className="h-4 w-4 text-red-500" /> :
                         alert.type === 'warning' ? <AlertTriangle className="h-4 w-4 text-yellow-500" /> :
                         <Bell className="h-4 w-4 text-blue-500" />}
                        <AlertTitle className="text-white">{alert.title}</AlertTitle>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge className={alert.resolved ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                          {alert.resolved ? '해결됨' : '미해결'}
                        </Badge>
                        <span className="text-gray-400 text-sm">
                          {new Date(alert.timestamp).toLocaleString('ko-KR')}
                        </span>
                      </div>
                    </div>
                    <AlertDescription className="text-gray-300 mt-2">
                      {alert.message}
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            </TabsContent>

            {/* 성능 통계 탭 */}
            <TabsContent value="performance" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Clock className="w-5 h-5" />
                      평균 응답 시간
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">
                      {monitoringData?.performance.avgResponseTime.toFixed(1)}ms
                    </div>
                    <div className="text-sm text-gray-400">응답 시간</div>
                  </CardContent>
                </Card>

                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <TrendingUp className="w-5 h-5" />
                      분당 요청 수
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">
                      {monitoringData?.performance.requestsPerMinute}
                    </div>
                    <div className="text-sm text-gray-400">분당 요청</div>
                  </CardContent>
                </Card>

                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <AlertTriangle className="w-5 h-5" />
                      오류율
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">
                      {monitoringData?.performance.errorRate.toFixed(2)}%
                    </div>
                    <div className="text-sm text-gray-400">에러 발생률</div>
                  </CardContent>
                </Card>

                <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Server className="w-5 h-5" />
                      가동 시간
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">
                      {formatUptime(monitoringData?.performance.uptime || 0)}
                    </div>
                    <div className="text-sm text-gray-400">시스템 가동 시간</div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </AdminLayout>
  );
}
