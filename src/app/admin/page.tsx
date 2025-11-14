"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import AdminLayout from "@/components/layouts/AdminLayout";
import { useAuth } from "@/hooks/useAuth";
import Statistics from "@/components/admin/Statistics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  TrendingUp, 
  Users, 
  FileText, 
  Activity, 
  Database, 
  BarChart3,
  Zap,
  Shield,
  Server,
  ArrowRight,
  Sparkles,
  Info,
  Settings,
  Bell,
  Eye,
  RefreshCw,
  PieChart,
  FileSearch
} from "lucide-react";
import Link from "next/link";
import { dashboardDataService, DashboardStats } from "@/lib/services/DashboardDataService";
import TeamStats from "@/components/admin/TeamStats";
import QueueSummaryPanel from "@/components/admin/QueueSummaryPanel";

export default function AdminDashboardPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  
  // State management
  const [showAdvancedMetrics, setShowAdvancedMetrics] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<{ id: string; title: string } | null>(null);

  // 데이터 로드 함수
  const loadDashboardData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const stats = await dashboardDataService.getDashboardStats();
      setDashboardStats(stats);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다.';
      setError(errorMessage);
      toast({
        title: "데이터 로드 실패",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // 자동 새로고침 설정
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadDashboardData();
    }, 30000); // 30초마다 새로고침

    return () => clearInterval(interval);
  }, [autoRefresh, loadDashboardData]);

  // 데이터가 없을 때 기본값 사용
  const stats = dashboardStats || {
    totalDocuments: 0,
    completedDocuments: 0,
    pendingDocuments: 0,
    processingDocuments: 0,
    totalChunks: 0,
    totalEmbeddings: 0,
    systemStatus: {
      overall: 'error' as const,
      database: 'disconnected' as const,
      llm: 'error' as const,
      vectorStore: 'error' as const,
      lastUpdate: '알 수 없음'
    },
    recentActivity: [],
    performanceMetrics: [],
    weeklyStats: {
      questions: 0,
      users: 0,
      satisfaction: 0,
      documents: 0
    }
  };

  // 모든 hooks는 early return 이전에 호출되어야 함
  const systemStatus = useMemo(() => stats.systemStatus, [stats.systemStatus]);
  
  const quickActions = useMemo(() => [
    {
      title: "문서 관리",
      description: "문서 업로드 및 URL 크롤링 관리",
      href: "/admin/docs",
      icon: <FileText className="w-6 h-6" />,
      color: "from-blue-500 to-blue-600",
      hoverColor: "from-blue-600 to-blue-700",
      stats: `${stats.totalDocuments}개 문서`,
      trend: "+0%"
    },
    {
      title: "처리 큐 모니터링",
      description: "processing_jobs 상태 확인 및 수동 처리",
      href: "/admin/queues",
      icon: <Activity className="w-6 h-6" />,
      color: "from-teal-500 to-cyan-600",
      hoverColor: "from-teal-600 to-cyan-700",
      stats: "큐 상태 보기",
      trend: "+0%"
    },
    {
      title: "사용자 관리",
      description: "사용자 권한 및 접근 설정 관리",
      href: "/admin/users",
      icon: <Users className="w-6 h-6" />,
      color: "from-green-500 to-green-600",
      hoverColor: "from-green-600 to-green-700",
      stats: `${stats.weeklyStats?.users || 0}명 활성`,
      trend: "+0%"
    },
    {
      title: "시스템 모니터링",
      description: "실시간 시스템 상태 및 성능 확인",
      href: "/admin/monitoring",
      icon: <TrendingUp className="w-6 h-6" />,
      color: "from-purple-500 to-purple-600",
      hoverColor: "from-purple-600 to-purple-700",
      stats: `${stats.completedDocuments}/${stats.totalDocuments} 완료`,
      trend: "+0%"
    },
    {
      title: "통계 및 분석",
      description: "질문 통계, 사용자 활동 및 성능 분석",
      href: "/admin/stats",
      icon: <PieChart className="w-6 h-6" />,
      color: "from-orange-500 to-red-600",
      hoverColor: "from-orange-600 to-red-700",
      stats: `${stats.weeklyStats?.questions || 0}개 질문`,
      trend: "+0%"
    },
    {
      title: "로그 및 감사",
      description: "시스템 로그, 활동 기록 및 감사 추적",
      href: "/admin/logs",
      icon: <FileSearch className="w-6 h-6" />,
      color: "from-indigo-500 to-blue-600",
      hoverColor: "from-indigo-600 to-blue-700",
      stats: "로그 조회",
      trend: "+0%"
    },
  ], [stats.totalDocuments, stats.completedDocuments, stats.weeklyStats?.users, stats.weeklyStats?.questions]);

  const performanceMetrics = useMemo(() => stats.performanceMetrics || [], [stats.performanceMetrics]);

  const getStatusIcon = useCallback((status: string) => {
    switch (status) {
      case "healthy":
      case "connected":
      case "operational":
      case "indexed":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "warning":
        return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case "error":
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  }, []);

  // 데이터가 없을 때 로딩 상태 표시
  if (isLoading && !dashboardStats) {
    return (
      <AdminLayout currentPage="dashboard">
        <div className="space-y-4 sm:space-y-6 p-4 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="card-enhanced" role="status" aria-label="로딩 중">
                <CardContent className="p-4 sm:p-6">
                  <Skeleton className="h-4 w-20 mb-2" />
                  <Skeleton className="h-8 w-16 mb-2" />
                  <Skeleton className="h-3 w-12" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="text-center text-gray-400 text-sm" aria-live="polite">
            데이터를 불러오는 중...
          </div>
        </div>
      </AdminLayout>
    );
  }

  // 에러 상태 표시
  if (error) {
    return (
      <AdminLayout currentPage="dashboard">
        <div className="p-4 sm:p-6">
          <Alert className="bg-red-900/20 border-red-500/30 text-red-100" role="alert">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertTitle>데이터 로드 오류</AlertTitle>
            <AlertDescription className="mt-2">
              {error}
              <Button
                onClick={loadDashboardData}
                variant="outline"
                size="sm"
                className="mt-4 bg-red-800/50 border-red-500/50 text-red-100 hover:bg-red-700/50"
                aria-label="데이터 다시 로드 시도"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </AdminLayout>
    );
  }

  // 로딩 중이거나 로그인하지 않은 경우 (모든 hooks 호출 후 early return)
  if (loading) {
    return (
      <AdminLayout currentPage="dashboard">
        <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">로그인 상태를 확인하는 중...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (!user) {
    return (
      <AdminLayout currentPage="dashboard">
        <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
          <div className="text-center">
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              <p className="font-bold">관리자 권한이 필요합니다</p>
              <p className="text-sm">관리자 페이지에 접근하려면 먼저 로그인해주세요.</p>
            </div>
            <p className="text-gray-600">잠시 후 메인 페이지로 이동합니다...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout currentPage="dashboard">
      {/* System Alerts */}
      <motion.div 
        className="mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Alert className="alert-enhanced alert-info">
          <Info className="h-4 w-4 text-blue-300" />
          <AlertTitle className="text-primary-enhanced font-semibold">✅ 시스템 상태</AlertTitle>
          <AlertDescription className="text-secondary-enhanced">
            🟢 모든 시스템이 정상적으로 작동 중입니다. 마지막 업데이트: {systemStatus.lastUpdate}
          </AlertDescription>
        </Alert>
      </motion.div>

      {/* Header */}
      <motion.div 
        className="mb-6 sm:mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex-1">
            <motion.h1 
              className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-white via-blue-100 to-blue-200 bg-clip-text text-transparent mb-2 text-enhanced"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              📊 관리자 대시보드
            </motion.h1>
            <motion.p 
              className="text-secondary-enhanced text-sm sm:text-base md:text-lg"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              🔧 시스템 전반의 상태를 모니터링하고 관리 작업을 수행하세요.
            </motion.p>
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4 w-full sm:w-auto"
          >
            <Button
              onClick={loadDashboardData}
              disabled={isLoading}
              variant="outline"
              size="sm"
              className="bg-gray-800/50 border-gray-600 text-white hover:bg-gray-700/50 disabled:opacity-50 w-full sm:w-auto"
              aria-label="대시보드 데이터 새로고침"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              새로고침
            </Button>
            <div className="flex items-center justify-center sm:justify-start space-x-2 bg-gradient-to-r from-blue-500/10 to-purple-500/10 backdrop-blur-sm rounded-xl p-3 sm:p-4 border border-blue-500/20">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
              <span className="text-xs sm:text-sm font-medium text-blue-300">실시간 모니터링</span>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Advanced Settings Panel */}
      <motion.div 
        className="mb-6 sm:mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card className="card-enhanced">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <Settings className="w-5 h-5 text-white flex-shrink-0" />
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-white">고급 설정</h3>
                  <p className="text-xs sm:text-sm text-gray-300">시스템 모니터링 및 알림 설정</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
                <div className="flex items-center justify-between sm:justify-start space-x-2">
                  <Bell className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  <span className="text-sm text-gray-300">알림</span>
                  <Switch
                    checked={notificationsEnabled}
                    onCheckedChange={setNotificationsEnabled}
                    aria-label="알림 활성화/비활성화"
                  />
                </div>
                <div className="flex items-center justify-between sm:justify-start space-x-2">
                  <RefreshCw className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  <span className="text-sm text-gray-300">자동 새로고침</span>
                  <Switch
                    checked={autoRefresh}
                    onCheckedChange={setAutoRefresh}
                    aria-label="자동 새로고침 활성화/비활성화"
                  />
                </div>
                <div className="flex items-center justify-between sm:justify-start space-x-2">
                  <BarChart3 className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  <span className="text-sm text-gray-300">고급 지표</span>
                  <Switch
                    checked={showAdvancedMetrics}
                    onCheckedChange={setShowAdvancedMetrics}
                    aria-label="고급 지표 표시/숨김"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* System Status Overview */}
      <motion.div 
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        role="region"
        aria-label="시스템 상태 개요"
      >
        <motion.div
          whileHover={{ scale: 1.02, y: -2 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="card-enhanced group">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
                  <Shield className="w-4 h-4 text-white" />
                </div>
                <CardTitle className="text-sm font-medium text-primary-enhanced">전체 상태</CardTitle>
              </div>
              {getStatusIcon(systemStatus.overall)}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary-enhanced capitalize mb-1 text-enhanced">
                {systemStatus.overall}
              </div>
              <p className="text-xs text-muted-enhanced">시스템 전반 상태</p>
              <div className="mt-3 progress-with-percentage">
                <div className="progress-enhanced progress-success">
                  <div className="progress-fill" style={{ width: `${systemStatus.overall === 'healthy' ? 100 : systemStatus.overall === 'warning' ? 70 : 0}%` }}></div>
                </div>
                <div className="progress-percentage">{systemStatus.overall === 'healthy' ? 100 : systemStatus.overall === 'warning' ? 70 : 0}%</div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02, y: -2 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="card-enhanced group">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-lg flex items-center justify-center">
                  <Database className="w-4 h-4 text-white" />
                </div>
                <CardTitle className="text-sm font-medium text-gray-300">데이터베이스</CardTitle>
              </div>
              {getStatusIcon(systemStatus.database)}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white capitalize mb-1">
                {systemStatus.database}
              </div>
              <p className="text-xs text-gray-400">PostgreSQL 연결 상태</p>
              <div className="mt-3 progress-with-percentage">
                <div className="progress-enhanced progress-success">
                  <div className="progress-fill" style={{ width: `${systemStatus.database === 'connected' ? 100 : 0}%` }}></div>
                </div>
                <div className="progress-percentage">{systemStatus.database === 'connected' ? 100 : 0}%</div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02, y: -2 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="card-enhanced group">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <CardTitle className="text-sm font-medium text-gray-300">LLM 서비스</CardTitle>
              </div>
              {getStatusIcon(systemStatus.llm)}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white capitalize mb-1">
                {systemStatus.llm}
              </div>
              <p className="text-xs text-gray-400">AI 모델 응답 상태</p>
              <div className="mt-3 progress-with-percentage">
                <div className="progress-enhanced progress-purple">
                  <div className="progress-fill" style={{ width: `${systemStatus.llm === 'operational' ? 98 : 0}%` }}></div>
                </div>
                <div className="progress-percentage">{systemStatus.llm === 'operational' ? 98 : 0}%</div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02, y: -2 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="card-enhanced group">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center">
                  <Server className="w-4 h-4 text-white" />
                </div>
                <CardTitle className="text-sm font-medium text-gray-300">벡터 저장소</CardTitle>
              </div>
              {getStatusIcon(systemStatus.vectorStore)}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white capitalize mb-1">
                {systemStatus.vectorStore}
              </div>
              <p className="text-xs text-gray-400">pgvector 인덱싱 상태</p>
              <div className="mt-3 progress-with-percentage">
                <div className="progress-enhanced progress-warning">
                  <div className="progress-fill" style={{ width: `${systemStatus.vectorStore === 'indexed' ? 100 : systemStatus.vectorStore === 'indexing' ? 50 : 0}%` }}></div>
                </div>
                <div className="progress-percentage">{systemStatus.vectorStore === 'indexed' ? 100 : systemStatus.vectorStore === 'indexing' ? 50 : 0}%</div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Advanced Performance Metrics Table */}
      {showAdvancedMetrics && (
        <motion.div 
          className="mb-6 sm:mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          role="region"
          aria-label="고급 성능 지표"
        >
          <div className="text-center mb-4 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">고급 성능 지표</h2>
            <p className="text-sm sm:text-base text-gray-300">시스템의 상세한 성능 데이터를 확인하세요</p>
          </div>
          
          <Card className="card-enhanced">
            <CardContent className="p-4 sm:p-6 overflow-x-auto">
              <div className="min-w-full">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-700">
                      <TableHead className="text-white font-semibold text-sm sm:text-base">지표</TableHead>
                      <TableHead className="text-white font-semibold text-sm sm:text-base hidden sm:table-cell">현재 값</TableHead>
                      <TableHead className="text-white font-semibold text-sm sm:text-base hidden md:table-cell">변화율</TableHead>
                      <TableHead className="text-white font-semibold text-sm sm:text-base">상태</TableHead>
                      <TableHead className="text-white font-semibold text-sm sm:text-base hidden lg:table-cell">액션</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performanceMetrics.length > 0 ? (
                      performanceMetrics.map((item, index) => (
                        <TableRow key={index} className="border-gray-700">
                          <TableCell className="text-gray-300 font-medium text-sm sm:text-base">
                            <div className="sm:hidden">
                              <div className="font-semibold mb-1">{item.metric}</div>
                              <div className="text-white text-xs">{item.value}</div>
                            </div>
                            <span className="hidden sm:inline">{item.metric}</span>
                          </TableCell>
                          <TableCell className="text-white font-semibold text-sm sm:text-base hidden sm:table-cell">{item.value}</TableCell>
                          <TableCell className="text-green-400 text-sm sm:text-base hidden md:table-cell">{item.trend}</TableCell>
                          <TableCell>
                            <Badge 
                              variant={item.status === 'excellent' ? 'default' : 'secondary'}
                              className={
                                item.status === 'excellent' 
                                  ? 'bg-green-500/20 text-green-400 border-green-400/30' 
                                  : 'bg-blue-500/20 text-blue-400 border-blue-400/30'
                              }
                              aria-label={`상태: ${item.status === 'excellent' ? '우수' : '양호'}`}
                            >
                              {item.status === 'excellent' ? '우수' : '양호'}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="text-gray-400 hover:text-white"
                                    aria-label={`${item.metric} 상세 정보 보기`}
                                  >
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>상세 정보 보기</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-gray-400 py-8">
                          성능 지표 데이터가 없습니다.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Quick Actions */}
      <motion.div 
        className="mb-6 sm:mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        role="region"
        aria-label="빠른 작업"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-white">빠른 작업</h2>
          <Badge variant="outline" className="text-blue-300 border-blue-500/30">
            <Activity className="w-3 h-3 mr-1" />
            실시간 업데이트
          </Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {quickActions.map((action, index) => (
            <TooltipProvider key={index}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href={action.href}>
                    <motion.div
                      whileHover={{ scale: 1.03, y: -4 }}
                      whileTap={{ scale: 0.97 }}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.1 * index }}
                    >
                <Card className="card-enhanced cursor-pointer group overflow-hidden">
                  <CardContent className="p-6 relative">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-white/5 to-transparent rounded-full -translate-y-16 translate-x-16 group-hover:scale-150 transition-transform duration-500" />
                    
                    <div className="relative z-10">
                      <div className={`w-16 h-16 bg-gradient-to-br ${action.color} rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg group-hover:shadow-xl transition-all duration-300 group-hover:scale-110`}>
                        <div className="text-white">{action.icon}</div>
                      </div>
                      
                      <h3 className="text-xl font-bold text-white mb-2 group-hover:text-gray-100 transition-colors">
                        {action.title}
                      </h3>
                      <p className="text-gray-400 group-hover:text-gray-300 transition-colors mb-4 text-sm leading-relaxed">
                        {action.description}
                      </p>
                      
                      <div className="flex items-center justify-between">
                        <div className="text-sm">
                          <div className="text-gray-500 text-xs">현재 상태</div>
                          <div className="text-white font-medium">{action.stats}</div>
                        </div>
                        <div className="flex items-center space-x-1">
                          <TrendingUp className="w-3 h-3 text-green-400" />
                          <span className="text-green-400 text-xs font-medium">{action.trend}</span>
                        </div>
                      </div>
                      
                      <div className="mt-4 flex items-center text-blue-400 text-sm font-medium group-hover:text-blue-300 transition-colors">
                        <span>자세히 보기</span>
                        <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                    </motion.div>
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{action.description}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      </motion.div>


      {/* Statistics */}
      <motion.div 
        className="mb-6 sm:mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        role="region"
        aria-label="사용 통계"
      >
        <h2 className="text-lg sm:text-xl font-semibold text-white mb-3 sm:mb-4">사용 통계</h2>
        <Statistics stats={{
          totalQuestions: stats.weeklyStats.questions,
          activeUsers: stats.weeklyStats.users,
          avgResponseTime: stats.performanceMetrics?.find(m => m.metric === '평균 응답 시간')?.value || "데이터 없음",
          satisfactionRate: stats.weeklyStats.satisfaction,
          weeklyChange: {
            questions: 0,
            users: 0,
            responseTime: 0,
            satisfaction: 0,
          }
        }} />
      </motion.div>

      {/* System Info */}
      <motion.div 
        className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-8 sm:mb-10 mt-6 sm:mt-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        role="region"
        aria-label="시스템 정보"
      >
        <Card className="card-enhanced performance-card hover:shadow-2xl transition-all duration-300">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-primary-enhanced">
              <Clock className="w-5 h-5 text-blue-400" />
              <span>📊 시스템 정보</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-enhanced font-semibold">마지막 업데이트:</span>
              <span className="text-sm font-bold text-primary-enhanced">{systemStatus.lastUpdate}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-enhanced font-semibold">시스템 버전:</span>
              <span className="text-sm font-bold text-primary-enhanced">v1.0.0</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-enhanced font-semibold">데이터베이스 크기:</span>
              <span className="text-sm font-bold text-primary-enhanced">계산 중</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-enhanced font-semibold">인덱싱된 문서:</span>
              <span className="text-sm font-bold text-primary-enhanced">{stats.completedDocuments || 0}개</span>
            </div>
          </CardContent>
        </Card>

        <Card className="card-enhanced performance-card hover:shadow-2xl transition-all duration-300">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-primary-enhanced">
              <TrendingUp className="w-5 h-5 text-green-400" />
              <span>⚡ 성능 지표</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-enhanced font-semibold">평균 응답 시간:</span>
              <span className="text-sm font-bold text-primary-enhanced">
                {stats.performanceMetrics?.find(m => m.metric === '평균 응답 시간')?.value || '데이터 없음'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-enhanced font-semibold">동시 사용자:</span>
              <span className="text-sm font-bold text-primary-enhanced">{stats.weeklyStats?.users || 0}명</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-enhanced font-semibold">CPU 사용률:</span>
              <span className="text-sm font-bold text-primary-enhanced">N/A</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-secondary-enhanced font-semibold">메모리 사용률:</span>
              <span className="text-sm font-bold text-primary-enhanced">N/A</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* API 사용량 통계 */}
      {'apiUsage' in stats && stats.apiUsage && (
        <motion.div 
          className="mb-6 sm:mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          role="region"
          aria-label="API 사용량 통계"
        >
          <Card className="card-enhanced">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-primary-enhanced text-lg sm:text-xl">
                <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
                <span>💰 API 사용량 (최근 30일)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 rounded-lg p-4 border border-purple-500/20">
                  <div className="text-sm text-gray-300 mb-2">Claude API</div>
                  <div className="text-2xl font-bold text-white mb-1">
                    {stats.apiUsage.claude.totalRequests.toLocaleString()}회
                  </div>
                  <div className="text-xs text-gray-400">
                    {stats.apiUsage.claude.totalTokens.toLocaleString()} 토큰
                  </div>
                  <div className="text-xs text-purple-300 mt-1">
                    ${stats.apiUsage.claude.totalCost.toFixed(2)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-green-500/10 to-green-600/10 rounded-lg p-4 border border-green-500/20">
                  <div className="text-sm text-gray-300 mb-2">GPT API</div>
                  <div className="text-2xl font-bold text-white mb-1">
                    {stats.apiUsage.gpt.totalRequests.toLocaleString()}회
                  </div>
                  <div className="text-xs text-gray-400">
                    {stats.apiUsage.gpt.totalTokens.toLocaleString()} 토큰
                  </div>
                  <div className="text-xs text-green-300 mt-1">
                    ${stats.apiUsage.gpt.totalCost.toFixed(2)}
                  </div>
                </div>
                <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 rounded-lg p-4 border border-blue-500/20">
                  <div className="text-sm text-gray-300 mb-2">전체</div>
                  <div className="text-2xl font-bold text-white mb-1">
                    {stats.apiUsage.total.totalRequests.toLocaleString()}회
                  </div>
                  <div className="text-xs text-gray-400">
                    {stats.apiUsage.total.totalTokens.toLocaleString()} 토큰
                  </div>
                  <div className="text-xs text-blue-300 mt-1">
                    ${stats.apiUsage.total.totalCost.toFixed(2)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Team Statistics */}
      <motion.div 
        className="mb-10 mt-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <TeamStats 
          teamStats={dashboardStats?.teamStats || []} 
          teamQuestionStats={dashboardStats?.teamQuestionStats || []} 
        />
      </motion.div>

      {/* Queue Summary Panel */}
      <motion.div 
        className="mb-10 mt-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <QueueSummaryPanel />
      </motion.div>

      {/* 문서 삭제 확인 다이얼로그 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문서 삭제 확인</DialogTitle>
            <DialogDescription>
              {documentToDelete && (
                <>
                  "{documentToDelete.title}" 문서를 삭제하시겠습니까?
                  <br />
                  <br />
                  이 작업은 되돌릴 수 없으며, 관련된 모든 임베딩 데이터도 함께 삭제됩니다.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setDocumentToDelete(null);
              }}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!documentToDelete) return;
                
                try {
                  const response = await fetch(`/api/admin/upload?documentId=${documentToDelete.id}`, {
                    method: 'DELETE',
                  });

                  const result = await response.json();

                  if (!response.ok) {
                    throw new Error(result.error || '문서 삭제에 실패했습니다.');
                  }

                  toast({
                    title: "문서 삭제 완료",
                    description: `문서가 성공적으로 삭제되었습니다. (청크: ${result.data.deletedChunks}개, 임베딩: ${result.data.deletedEmbeddings}개)`,
                  });
                  
                  setDeleteDialogOpen(false);
                  setDocumentToDelete(null);
                  loadDashboardData();
                } catch (error) {
                  toast({
                    title: "문서 삭제 실패",
                    description: error instanceof Error ? error.message : '문서 삭제 중 오류가 발생했습니다.',
                    variant: "destructive",
                  });
                }
              }}
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
