"use client";

import "@/app/admin/globals.admin.css";
import AdminLayout from "@/components/layouts/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  Search, Filter, Download, RefreshCw, AlertTriangle, Info, CheckCircle, Clock, 
  User, MessageSquare, HelpCircle, Eye, FileText, Shield, Zap, Activity,
  TrendingUp, TrendingDown, Minus, Calendar, Clock3, Users, Server, Mail, Bell
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { logger } from "@/lib/utils/logger";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { ko } from "date-fns/locale";

export default function LogsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvancedLogs, setShowAdvancedLogs] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    errors: 0,
    warnings: 0,
    info: 0,
    userActivity: 0,
  });

  // Dummy data for demonstration
  const logLevels = [
    { value: "all", label: "모든 레벨" },
    { value: "error", label: "오류" },
    { value: "warning", label: "경고" },
    { value: "info", label: "정보" },
    { value: "debug", label: "디버그" },
  ];

  const logTypes = [
    { value: "all", label: "모든 유형" },
    { value: "user", label: "사용자 활동" },
    { value: "system", label: "시스템" },
    { value: "security", label: "보안" },
    { value: "performance", label: "성능" },
  ];

  // 알림 목록 조회
  const fetchAlerts = useCallback(async () => {
    setAlertsLoading(true);
    try {
      const response = await fetch('/api/admin/logs/alerts?limit=10');
      const result = await response.json();
      if (result.success) {
        setAlerts(result.data.alerts);
      }
    } catch (error) {
      logger.error('알림 목록 조회 실패:', error);
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  // 로그 목록 조회
  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedLevel !== 'all') params.append('level', selectedLevel);
      if (selectedType !== 'all') params.append('type', selectedType);
      if (userId) params.append('userId', userId);
      if (searchQuery) params.append('search', searchQuery);
      params.append('limit', '100');

      const response = await fetch(`/api/admin/logs/list?${params.toString()}`);
      const result = await response.json();
      
      if (result.success) {
        // log_alerts 데이터를 logs 형식으로 변환
        const transformedLogs = (result.data.logs || []).map((log: any) => ({
          id: log.id.toString(),
          timestamp: log.log_timestamp,
          level: log.log_level,
          type: log.log_type,
          message: log.log_message,
          userId: log.user_id || null,
          ip: log.ip_address || null,
          details: {
            log_id: log.log_id,
            alert_status: log.alert_status,
            email_count: log.email_count,
          },
        }));
        
        setLogs(transformedLogs);
        setStats(result.data.stats || {
          total: 0,
          errors: 0,
          warnings: 0,
          info: 0,
          userActivity: 0,
        });
      }
    } catch (error) {
      logger.error('로그 목록 조회 실패:', error);
    } finally {
      setLogsLoading(false);
    }
  }, [selectedLevel, selectedType, userId, searchQuery]);

  // 테스트 로그 생성
  const createTestLog = useCallback(async () => {
    try {
      const testLogData = {
        log_id: `test_${Date.now()}`,
        log_level: 'warning',
        log_type: 'system',
        log_message: '테스트용 경고 로그가 생성되었습니다. 이메일 알림이 발송됩니다.',
        log_timestamp: new Date().toISOString(),
        user_id: 'test_user',
        ip_address: '192.168.1.100'
      };

      const response = await fetch('/api/admin/logs/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testLogData),
      });

      const result = await response.json();
      
      if (result.success) {
        logger.log('✅ 테스트 로그 생성 완료');
        // 알림 목록 및 로그 목록 새로고침
        setTimeout(() => {
          fetchAlerts();
          fetchLogs();
        }, 1000);
      } else {
        logger.error('테스트 로그 생성 실패:', result.error);
      }
    } catch (error) {
      logger.error('테스트 로그 생성 실패:', error);
    }
  }, [fetchAlerts, fetchLogs]);

  // 클라이언트 사이드 렌더링 확인
  useEffect(() => {
    setIsClient(true);
    setLastUpdated(new Date());
    fetchAlerts();
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 필터 변경 시 로그 다시 조회 (디바운스)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchLogs();
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLevel, selectedType, searchQuery, userId]);

  // 데이터 새로고침 함수
  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      setLastUpdated(new Date());
      await Promise.all([fetchAlerts(), fetchLogs()]);
      logger.log('로그 데이터 새로고침 완료');
    } catch (error) {
      logger.error('로그 데이터 새로고침 실패:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchAlerts, fetchLogs]);

  // 날짜 포맷팅 함수
  const formatTimestamp = useCallback((timestamp: string) => {
    try {
      const date = parseISO(timestamp);
      return format(date, 'yyyy.MM.dd HH:mm:ss', { locale: ko });
    } catch {
      return timestamp;
    }
  }, []);

  const formatRelativeTime = useCallback((timestamp: string) => {
    try {
      const date = parseISO(timestamp);
      return formatDistanceToNow(date, { addSuffix: true, locale: ko });
    } catch {
      return timestamp;
    }
  }, []);

  const getLevelIcon = useCallback((level: string) => {
    switch (level) {
      case "error":
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case "info":
        return <Info className="w-4 h-4 text-blue-600" />;
      case "debug":
        return <Info className="w-4 h-4 text-gray-600" />;
      default:
        return <Info className="w-4 h-4 text-gray-300" />;
    }
  }, []);

  const getLevelBadge = useCallback((level: string) => {
    switch (level) {
      case "error":
        return <Badge className="bg-red-500/20 text-red-300 border-red-400/50 text-xs px-3 py-1 font-semibold">오류</Badge>;
      case "warning":
        return <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-400/50 text-xs px-3 py-1 font-semibold">경고</Badge>;
      case "info":
        return <Badge className="bg-blue-500/20 text-blue-300 border-blue-400/50 text-xs px-3 py-1 font-semibold">정보</Badge>;
      case "debug":
        return <Badge className="bg-gray-500/20 text-gray-300 border-gray-400/50 text-xs px-3 py-1 font-semibold">디버그</Badge>;
      default:
        return <Badge className="bg-gray-500/20 text-gray-300 border-gray-400/50 text-xs px-3 py-1 font-semibold">알 수 없음</Badge>;
    }
  }, []);

  const getTypeBadge = useCallback((type: string) => {
    switch (type) {
      case "user":
        return <Badge className="bg-blue-500/20 text-blue-300 border-blue-400/50 text-xs px-3 py-1 font-semibold">사용자</Badge>;
      case "system":
        return <Badge className="bg-gray-500/20 text-gray-300 border-gray-400/50 text-xs px-3 py-1 font-semibold">시스템</Badge>;
      case "security":
        return <Badge className="bg-red-500/20 text-red-300 border-red-400/50 text-xs px-3 py-1 font-semibold">보안</Badge>;
      case "performance":
        return <Badge className="bg-purple-500/20 text-purple-300 border-purple-400/50 text-xs px-3 py-1 font-semibold">성능</Badge>;
      default:
        return <Badge className="bg-gray-500/20 text-gray-300 border-gray-400/50 text-xs px-3 py-1 font-semibold">기타</Badge>;
    }
  }, []);

  // CSV 내보내기 함수
  const exportToCSV = useCallback(() => {
    const csvData = [
      ['시간', '레벨', '유형', '메시지', '사용자 ID', 'IP 주소'],
      ...logs.map(log => [
        log.timestamp,
        log.level,
        log.type,
        log.message,
        log.userId || '',
        log.ip || ''
      ])
    ];

    const BOM = '\uFEFF';
    const csvContent = BOM + csvData.map(row => 
      row.map(cell => `"${cell}"`).join(',')
    ).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `시스템_로그_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logger.log('CSV 파일이 다운로드되었습니다.');
  }, [logs]);

  // JSON 내보내기 함수
  const exportToJSON = useCallback(() => {
    const jsonData = {
      exportDate: new Date().toISOString(),
      totalLogs: logs.length,
      logs: logs,
      summary: {
        errors: logs.filter(log => log.level === "error").length,
        warnings: logs.filter(log => log.level === "warning").length,
        info: logs.filter(log => log.level === "info").length,
        userActivity: logs.filter(log => log.type === "user").length,
        systemLogs: logs.filter(log => log.type === "system").length,
        securityLogs: logs.filter(log => log.type === "security").length,
        performanceLogs: logs.filter(log => log.type === "performance").length
      }
    };

    const jsonContent = JSON.stringify(jsonData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `시스템_로그_${new Date().toISOString().split('T')[0]}.json`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logger.log('JSON 파일이 다운로드되었습니다.');
  }, [logs]);

  return (
    <AdminLayout currentPage="logs">
      {/* System Alert */}
      <div className="mb-6">
        <Alert className="alert-enhanced bg-gradient-to-r from-slate-800/95 to-slate-700/95 border-slate-500/40 text-white backdrop-blur-md shadow-xl">
          <Activity className="h-5 w-5 text-green-400" />
          <AlertTitle className="text-white font-bold text-lg">🔍 실시간 로그 모니터링</AlertTitle>
          <AlertDescription className="text-slate-100 font-medium">
            시스템 활동과 사용자 행동을 실시간으로 모니터링하여 문제를 조기에 발견하고 대응하세요.
            <br />
            {isClient && lastUpdated && (
              <span className="text-white font-bold text-sm bg-green-600/20 px-2 py-1 rounded-md mt-2 inline-block">
                마지막 업데이트: {lastUpdated.toLocaleString()}
              </span>
            )}
          </AlertDescription>
        </Alert>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-white via-blue-100 to-purple-100 bg-clip-text text-transparent">
                시스템 로그
              </h1>
            </div>
            <p className="text-gray-100 text-lg">
              시스템 활동과 사용자 행동을 실시간으로 모니터링하여 문제를 조기에 발견하고 대응하세요.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    onClick={refreshData}
                    disabled={isLoading}
                    className="bg-gray-800/50 border-gray-600 text-white hover:bg-gray-700/50"
                    aria-label="로그 데이터 새로고침"
                  >
                    <RefreshCw className={`w-4 h-4 sm:mr-2 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span className="hidden sm:inline">새로고침</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>로그 데이터를 새로고침합니다</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    onClick={createTestLog}
                    className="bg-yellow-800/50 border-yellow-600 text-yellow-100 hover:bg-yellow-700/50"
                    aria-label="테스트 로그 생성"
                  >
                    <AlertTriangle className="w-4 h-4 sm:mr-2" aria-hidden="true" />
                    <span className="hidden sm:inline">테스트 로그</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>테스트용 경고 로그를 생성합니다</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="relative group">
              <Button 
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                aria-label="데이터 내보내기 메뉴"
                aria-expanded="false"
              >
                <Download className="w-4 h-4 sm:mr-2" aria-hidden="true" />
                <span className="hidden sm:inline">내보내기</span>
              </Button>
              <div className="absolute top-full left-0 mt-1 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50" role="menu" aria-label="내보내기 옵션">
                <div className="p-2">
                  <button 
                    onClick={exportToCSV}
                    className="w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-700 rounded flex items-center"
                    role="menuitem"
                    aria-label="CSV 형식으로 내보내기"
                  >
                    <Download className="w-4 h-4 mr-2 text-blue-400" aria-hidden="true" />
                    CSV 다운로드
                  </button>
                  <button 
                    onClick={exportToJSON}
                    className="w-full text-left px-3 py-2 text-sm text-white hover:bg-gray-700 rounded flex items-center"
                    role="menuitem"
                    aria-label="JSON 형식으로 내보내기"
                  >
                    <Download className="w-4 h-4 mr-2 text-purple-400" aria-hidden="true" />
                    JSON 데이터
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <div className="mb-6">
          <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50 shadow-lg rounded-xl">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-white">
                <div className="p-1.5 bg-gradient-to-r from-orange-500/20 to-red-500/20 rounded-lg border border-orange-500/30">
                  <Bell className="w-5 h-5 text-orange-400" />
                </div>
                <span className="text-lg font-bold">활성 알림</span>
                <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/50 text-xs px-2 py-0.5 font-semibold">
                  {alerts.filter(alert => alert.alert_status === 'pending').length}개
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alerts.filter(alert => alert.alert_status === 'pending').slice(0, 3).map((alert) => (
                  <div 
                    key={alert.id} 
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-gray-700/40 rounded-lg border border-gray-600/50 hover:bg-gray-700/60 transition-all duration-200"
                  >
                    <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                      <div className={`p-1.5 rounded-lg flex-shrink-0 ${
                        alert.log_level === 'error' 
                          ? 'bg-red-500/20 border border-red-500/30' 
                          : 'bg-yellow-500/20 border border-yellow-500/30'
                      }`}>
                        <AlertTriangle className={`w-4 h-4 ${
                          alert.log_level === 'error' ? 'text-red-400' : 'text-yellow-400'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm sm:text-base leading-relaxed break-words mb-2">
                          {alert.log_message}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={`text-xs font-semibold px-2 py-0.5 ${
                            alert.log_level === 'error'
                              ? 'bg-red-500/20 text-red-300 border-red-500/50'
                              : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50'
                          }`}>
                            {alert.log_level.toUpperCase()}
                          </Badge>
                          <span className="text-gray-400 text-xs">
                            {alert.email_count}회 발송
                          </span>
                          <span className="text-gray-500 text-xs">
                            {alert.last_sent_at ? formatRelativeTime(alert.last_sent_at) : '발송 정보 없음'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white flex-shrink-0 w-full sm:w-auto shadow-md"
                      onClick={async () => {
                        try {
                          const response = await fetch('/api/admin/logs/alerts', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'acknowledge',
                              alertId: alert.id,
                              acknowledgedBy: 'admin'
                            })
                          });
                          const result = await response.json();
                          if (result.success) {
                            fetchAlerts();
                            fetchLogs();
                          }
                        } catch (error) {
                          logger.error('알림 확인 실패:', error);
                        }
                      }}
                    >
                      <CheckCircle className="w-4 h-4 sm:mr-2" />
                      <span className="hidden sm:inline">확인</span>
                    </Button>
                  </div>
                ))}
                {alerts.filter(alert => alert.alert_status === 'pending').length > 3 && (
                  <div className="text-center pt-2">
                    <p className="text-gray-400 text-sm font-medium">
                      +{alerts.filter(alert => alert.alert_status === 'pending').length - 3}개의 추가 알림
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8" role="region" aria-label="로그 통계 개요">
        <Card className="log-card bg-gradient-to-br from-blue-900/40 to-blue-800/30 border-blue-500/50 backdrop-blur-sm shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-primary-enhanced">📊 총 로그 수</CardTitle>
            <MessageSquare className="h-5 w-5 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-white text-enhanced">{stats.total}</div>
            <p className="text-xs text-secondary-enhanced font-semibold mt-1">전체 로그 수</p>
          </CardContent>
        </Card>

        <Card className="log-card bg-gradient-to-br from-red-900/40 to-red-800/30 border-red-500/50 backdrop-blur-sm shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-primary-enhanced">🚨 오류</CardTitle>
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-white text-enhanced">
              {stats.errors}
            </div>
            <p className="text-xs text-secondary-enhanced font-semibold mt-1">주의가 필요한 로그</p>
          </CardContent>
        </Card>

        <Card className="log-card bg-gradient-to-br from-yellow-900/40 to-yellow-800/30 border-yellow-500/50 backdrop-blur-sm shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-primary-enhanced">⚠️ 경고</CardTitle>
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-white text-enhanced">
              {stats.warnings}
            </div>
            <p className="text-xs text-secondary-enhanced font-semibold mt-1">모니터링 필요</p>
          </CardContent>
        </Card>

        <Card className="log-card bg-gradient-to-br from-green-900/40 to-green-800/30 border-green-500/50 backdrop-blur-sm shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-primary-enhanced">👤 사용자 활동</CardTitle>
            <User className="h-5 w-5 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-white text-enhanced">
              {stats.userActivity}
            </div>
            <p className="text-xs text-secondary-enhanced font-semibold mt-1">사용자 행동 로그</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50 shadow-lg rounded-xl">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-white">
              <Filter className="w-5 h-5" />
              <span>필터 및 검색</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4" role="region" aria-label="필터 및 검색 옵션">
              <div>
                <label className="text-sm font-medium text-gray-100 mb-2 block">로그 레벨</label>
                <Select value={selectedLevel} onValueChange={setSelectedLevel}>
                  <SelectTrigger className="bg-gray-700/50 border-gray-600 text-white" aria-label="로그 레벨 선택">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {logLevels.map((level) => (
                      <SelectItem key={level.value} value={level.value}>
                        {level.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-100 mb-2 block">로그 유형</label>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger className="bg-gray-700/50 border-gray-600 text-white" aria-label="로그 유형 선택">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {logTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-100 mb-2 block">사용자 ID</label>
                <Input 
                  placeholder="사용자 ID 입력..." 
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="bg-gray-700/50 border-gray-600 text-white placeholder-gray-400"
                  aria-label="사용자 ID 검색"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium text-gray-100 mb-2 block">검색</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-300 w-4 h-4" />
                  <Input 
                    placeholder="로그 메시지 검색..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-gray-700/50 border-gray-600 text-white placeholder-gray-400" 
                    aria-label="로그 메시지 검색"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logs Table */}
      <div className="mb-8">
        <Card className="bg-gray-800/80 backdrop-blur-sm border-gray-700/50 shadow-lg rounded-xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <FileText className="w-5 h-5" />
                로그 목록
              </CardTitle>
              <div className="flex items-center space-x-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={refreshData}
                        disabled={isLoading}
                        className="text-gray-300 border-gray-600 hover:bg-gray-700"
                      >
                        <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                        새로고침
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>로그 목록 새로고침</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading || logsLoading ? (
              <div className="p-6 space-y-4">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center space-x-4">
                    <Skeleton className="w-8 h-8 rounded" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="w-16 h-6" />
                  </div>
                ))}
              </div>
            ) : (
              <Table role="table" aria-label="로그 목록">
                <TableHeader>
                  <TableRow className="border-gray-700">
                    <TableHead className="text-white font-semibold w-24">레벨</TableHead>
                    <TableHead className="text-white font-semibold w-28">유형</TableHead>
                    <TableHead className="text-white font-semibold">메시지</TableHead>
                    <TableHead className="hidden md:table-cell text-white font-semibold w-32">사용자</TableHead>
                    <TableHead className="hidden lg:table-cell text-white font-semibold w-32">IP</TableHead>
                    <TableHead className="hidden sm:table-cell text-white font-semibold w-40">시간</TableHead>
                    <TableHead className="text-white font-semibold w-24">액션</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12">
                        <div className="flex flex-col items-center gap-3">
                          <FileText className="w-12 h-12 text-gray-500" />
                          <p className="text-gray-400 text-base font-medium">로그 데이터가 없습니다</p>
                          <p className="text-gray-500 text-sm">필터 조건을 변경하거나 테스트 로그를 생성해보세요</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => (
                    <TableRow key={log.id} className="border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                      <TableCell className="py-4">
                        <div className="flex items-center space-x-2 min-w-0">
                          {getLevelIcon(log.level)}
                          <span className="text-sm whitespace-nowrap">
                            {getLevelBadge(log.level)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="min-w-0">
                          <span className="text-sm whitespace-nowrap">
                            {getTypeBadge(log.type)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="max-w-md">
                          <p className="text-sm text-white font-medium leading-relaxed break-words">{log.message}</p>
                          {log.details && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-200 font-medium transition-colors">
                                상세 정보 보기
                              </summary>
                              <pre className="mt-2 text-xs text-gray-300 whitespace-pre-wrap bg-gray-900/50 p-3 rounded border border-gray-700/50 max-h-48 overflow-y-auto">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 hidden md:table-cell">
                        <span className="text-gray-200 text-sm font-medium">
                          {log.userId || <span className="text-gray-500">-</span>}
                        </span>
                      </TableCell>
                      <TableCell className="py-4 hidden lg:table-cell">
                        <span className="text-gray-200 text-sm font-mono">
                          {log.ip || <span className="text-gray-500">-</span>}
                        </span>
                      </TableCell>
                      <TableCell className="py-4 hidden sm:table-cell">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-gray-200 text-sm font-medium">
                            {formatTimestamp(log.timestamp)}
                          </span>
                          <span className="text-gray-500 text-xs">
                            {formatRelativeTime(log.timestamp)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-gray-300 hover:text-blue-400 hover:bg-blue-500/10"
                                  aria-label={`${log.message} 상세 정보 보기`}
                                >
                                  <Info className="w-4 h-4" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>상세 정보</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-gray-300 hover:text-green-400 hover:bg-green-500/10"
                                  aria-label={`${log.message} 로그 다운로드`}
                                >
                                  <Download className="w-4 h-4" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>로그 다운로드</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                    </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Export Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 bg-gray-800/50 border border-gray-700/50 rounded-xl">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-gray-300">
            <Calendar className="w-4 h-4" />
            <span className="text-sm font-medium">총 {stats.total}개의 로그</span>
            {logs.length < stats.total && (
              <span className="text-xs text-gray-500">(표시: {logs.length}개)</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-gray-300">
            <Clock3 className="w-4 h-4" />
            <span className="text-sm">실시간 업데이트</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            onClick={exportToCSV}
            className="bg-gray-700/50 border-gray-600 text-white hover:bg-gray-600/50"
          >
            <Download className="w-4 h-4 mr-2" />
            CSV 내보내기
          </Button>
          <Button 
            variant="outline" 
            onClick={exportToJSON}
            className="bg-gray-700/50 border-gray-600 text-white hover:bg-gray-600/50"
          >
            <Download className="w-4 h-4 mr-2" />
            JSON 내보내기
          </Button>
        </div>
      </div>
    </AdminLayout>
  );
}