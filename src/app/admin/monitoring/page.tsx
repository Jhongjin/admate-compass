"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
    Zap,
    Bell,
    Search,
    Play,
    Pause,
    Users,
    PieChart,
    BarChart3
} from "lucide-react";
import AdminThemeLayout from "@/components/layouts/AdminThemeLayout";
import { fetchWithTimeout } from "@/lib/utils/fetchWithTimeout";

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

    const loadMonitoringData = async () => {
        try {
            setLoading(true);
            setError(null);

            const params = new URLSearchParams({
                timeRange,
                logLevel
            });

            const response = await fetchWithTimeout(`/api/admin/monitoring?${params}`);
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

    useEffect(() => {
        loadMonitoringData();
    }, [timeRange, logLevel]);

    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            loadMonitoringData();
        }, 30000);

        return () => clearInterval(interval);
    }, [autoRefresh, timeRange, logLevel]);

    const getStatusIcon = (status: string) => {
        switch (status) {
            case "healthy":
            case "connected":
            case "operational":
            case "indexed":
                return <CheckCircle className="w-5 h-5 text-green-400" />;
            case "warning":
            case "degraded":
            case "indexing":
                return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
            case "error":
            case "disconnected":
                return <AlertTriangle className="w-5 h-5 text-red-400" />;
            default:
                return <Clock className="w-5 h-5 text-gray-400" />;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case "healthy":
            case "connected":
            case "operational":
            case "indexed":
                return "text-green-400";
            case "warning":
            case "degraded":
            case "indexing":
                return "text-yellow-400";
            case "error":
            case "disconnected":
                return "text-red-400";
            default:
                return "text-gray-400";
        }
    };

    const getLogLevelColor = (level: string) => {
        switch (level) {
            case "error":
                return "bg-red-500/20 text-red-400 border-red-500/30";
            case "warn":
                return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
            case "info":
                return "bg-blue-500/20 text-blue-400 border-blue-500/30";
            case "debug":
                return "bg-gray-500/20 text-gray-400 border-gray-500/30";
            default:
                return "bg-gray-500/20 text-gray-400 border-gray-500/30";
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatUptime = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours}h ${minutes}m ${secs}s`;
    };

    const filteredLogs = monitoringData?.recentLogs.filter(log =>
        logSearch === "" ||
        log.message.toLowerCase().includes(logSearch.toLowerCase()) ||
        log.source.toLowerCase().includes(logSearch.toLowerCase())
    ) || [];

    if (loading && !monitoringData) {
        return (
            <AdminThemeLayout currentPage="monitoring" pageTitle="시스템 모니터링">
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-white">시스템 모니터링</h1>
                            <p className="text-gray-400 mt-2">실시간 시스템 상태 및 성능 모니터링</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-32 bg-white/10 rounded-3xl" />
                        ))}
                    </div>
                </div>
            </AdminThemeLayout>
        );
    }

    if (error) {
        return (
            <AdminThemeLayout currentPage="monitoring" pageTitle="시스템 모니터링">
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-white">시스템 모니터링</h1>
                            <p className="text-gray-400 mt-2">실시간 시스템 상태 및 성능 모니터링</p>
                        </div>
                    </div>
                    <Alert className="bg-red-900/20 border-red-500/30 text-white">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>오류 발생</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                </div>
            </AdminThemeLayout>
        );
    }

    return (
        <AdminThemeLayout currentPage="monitoring" pageTitle="시스템 모니터링">
            <div className="space-y-6">
                {/* 헤더 */}
                <motion.div
                    className="flex items-center justify-between"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-2 sm:mb-3 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                            시스템 모니터링
                        </h1>
                        <p className="text-gray-400 text-sm sm:text-base">실시간 시스템 상태 및 성능 모니터링</p>
                    </div>
                    <div className="flex items-center space-x-4">
                        <Button
                            onClick={loadMonitoringData}
                            disabled={loading}
                            variant="outline"
                            size="sm"
                            className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            새로고침
                        </Button>
                        <Button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            variant={autoRefresh ? "default" : "outline"}
                            size="sm"
                            className={autoRefresh ? "bg-green-600 hover:bg-green-700" : "bg-[#131823] border-white/10 text-white hover:bg-white/5"}
                        >
                            {autoRefresh ? <Pause className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                            {autoRefresh ? '자동 새로고침 중' : '자동 새로고침 시작'}
                        </Button>
                    </div>
                </motion.div>

                {/* 시스템 상태 카드 */}
                <motion.div
                    className="grid grid-cols-1 md:grid-cols-4 gap-4 sm:gap-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                >
                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <Activity className="w-5 h-5 text-gray-400" />
                            <h3 className="text-sm font-medium text-gray-400">전체 상태</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                            {getStatusIcon(monitoringData?.systemStatus.overall || 'error')}
                            <span className={`font-medium ${getStatusColor(monitoringData?.systemStatus.overall || 'error')}`}>
                                {monitoringData?.systemStatus.overall === 'healthy' ? '정상' :
                                    monitoringData?.systemStatus.overall === 'warning' ? '주의' : '오류'}
                            </span>
                        </div>
                    </div>

                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <Database className="w-5 h-5 text-gray-400" />
                            <h3 className="text-sm font-medium text-gray-400">데이터베이스</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                            {getStatusIcon(monitoringData?.systemStatus.database || 'error')}
                            <span className={`font-medium ${getStatusColor(monitoringData?.systemStatus.database || 'error')}`}>
                                {monitoringData?.systemStatus.database === 'connected' ? '연결됨' :
                                    monitoringData?.systemStatus.database === 'disconnected' ? '연결 끊김' : '오류'}
                            </span>
                        </div>
                    </div>

                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <Zap className="w-5 h-5 text-gray-400" />
                            <h3 className="text-sm font-medium text-gray-400">LLM 서비스</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                            {getStatusIcon(monitoringData?.systemStatus.llm || 'error')}
                            <span className={`font-medium ${getStatusColor(monitoringData?.systemStatus.llm || 'error')}`}>
                                {monitoringData?.systemStatus.llm === 'operational' ? '정상' :
                                    monitoringData?.systemStatus.llm === 'degraded' ? '성능 저하' : '오류'}
                            </span>
                        </div>
                    </div>

                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <BarChart3 className="w-5 h-5 text-gray-400" />
                            <h3 className="text-sm font-medium text-gray-400">벡터 스토어</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                            {getStatusIcon(monitoringData?.systemStatus.vectorStore || 'error')}
                            <span className={`font-medium ${getStatusColor(monitoringData?.systemStatus.vectorStore || 'error')}`}>
                                {monitoringData?.systemStatus.vectorStore === 'indexed' ? '인덱싱 완료' :
                                    monitoringData?.systemStatus.vectorStore === 'indexing' ? '인덱싱 중' : '오류'}
                            </span>
                        </div>
                    </div>
                </motion.div>

                {/* 탭 컨텐츠 */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                >
                    <Tabs defaultValue="metrics" className="space-y-6">
                        <TabsList className="grid w-full grid-cols-4 bg-[#131823] border border-white/5 p-1 rounded-xl">
                            <TabsTrigger value="metrics" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg">성능 메트릭</TabsTrigger>
                            <TabsTrigger value="logs" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg">시스템 로그</TabsTrigger>
                            <TabsTrigger value="alerts" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg">알림</TabsTrigger>
                            <TabsTrigger value="performance" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg">성능 통계</TabsTrigger>
                        </TabsList>

                        {/* 성능 메트릭 탭 */}
                        <TabsContent value="metrics" className="space-y-6">
                            {/* 실시간 차트 */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Cpu className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-lg font-bold text-white">CPU 사용률 추이</h3>
                                    </div>
                                    <div className="h-64 flex items-center justify-center text-gray-400">
                                        <div className="text-center">
                                            <Cpu className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">CPU 사용률 차트</p>
                                            <p className="text-xs text-gray-500 mt-1">차트 데이터를 로딩 중입니다...</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <HardDrive className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-lg font-bold text-white">메모리 사용률 추이</h3>
                                    </div>
                                    <div className="h-64 flex items-center justify-center text-gray-400">
                                        <div className="text-center">
                                            <HardDrive className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">메모리 사용률 차트</p>
                                            <p className="text-xs text-gray-500 mt-1">차트 데이터를 로딩 중입니다...</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Network className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-lg font-bold text-white">네트워크 트래픽</h3>
                                    </div>
                                    <div className="h-64 flex items-center justify-center text-gray-400">
                                        <div className="text-center">
                                            <Network className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">네트워크 트래픽 차트</p>
                                            <p className="text-xs text-gray-500 mt-1">차트 데이터를 로딩 중입니다...</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <TrendingUp className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-lg font-bold text-white">요청 처리율</h3>
                                    </div>
                                    <div className="h-64 flex items-center justify-center text-gray-400">
                                        <div className="text-center">
                                            <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">요청 처리율 차트</p>
                                            <p className="text-xs text-gray-500 mt-1">차트 데이터를 로딩 중입니다...</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 리소스 사용률 개요 */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <h3 className="text-lg font-bold text-white mb-6">리소스 사용률 개요</h3>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div>
                                        <h4 className="text-base font-medium text-gray-400 mb-4">시스템 리소스</h4>
                                        <div className="h-64 flex items-center justify-center text-gray-400">
                                            <div className="text-center">
                                                <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                                <p className="text-sm">리소스 사용률 파이 차트</p>
                                                <p className="text-xs text-gray-500 mt-1">차트 데이터를 로딩 중입니다...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="text-base font-medium text-gray-400 mb-4">오류율 추이</h4>
                                        <div className="h-64 flex items-center justify-center text-gray-400">
                                            <div className="text-center">
                                                <AlertTriangle className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                                <p className="text-sm">오류율 추이 차트</p>
                                                <p className="text-xs text-gray-500 mt-1">차트 데이터를 로딩 중입니다...</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 개별 메트릭 카드 */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                                {/* CPU 사용률 */}
                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Cpu className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">CPU 사용률</h3>
                                    </div>
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
                                </div>

                                {/* 메모리 사용률 */}
                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <HardDrive className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">메모리 사용률</h3>
                                    </div>
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
                                </div>

                                {/* 디스크 사용률 */}
                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <HardDrive className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">디스크 사용률</h3>
                                    </div>
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
                                </div>

                                {/* 네트워크 */}
                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Network className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">네트워크</h3>
                                    </div>
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
                                </div>

                                {/* 데이터베이스 */}
                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Database className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">데이터베이스</h3>
                                    </div>
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
                                </div>

                                {/* 벡터 스토어 */}
                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <BarChart3 className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">벡터 스토어</h3>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-300">벡터 수</span>
                                            <span className="text-white font-medium">
                                                {monitoringData?.metrics.vectorStore.totalVectors.toLocaleString()}개
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-300">인덱스 크기</span>
                                            <span className="text-white font-medium">
                                                {formatBytes(monitoringData?.metrics.vectorStore.indexSize || 0)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        {/* 시스템 로그 탭 */}
                        <TabsContent value="logs" className="space-y-6">
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white">시스템 로그</h3>
                                    <div className="flex items-center space-x-4">
                                        <Select value={timeRange} onValueChange={setTimeRange}>
                                            <SelectTrigger className="w-32 bg-[#0B0F17] border-white/10 text-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                                                <SelectItem value="15m">최근 15분</SelectItem>
                                                <SelectItem value="1h">최근 1시간</SelectItem>
                                                <SelectItem value="6h">최근 6시간</SelectItem>
                                                <SelectItem value="24h">최근 24시간</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={logLevel} onValueChange={setLogLevel}>
                                            <SelectTrigger className="w-32 bg-[#0B0F17] border-white/10 text-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
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
                                                className="pl-10 w-64 bg-[#0B0F17] border-white/10 text-white placeholder-gray-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-2 max-h-96 overflow-y-auto">
                                    {filteredLogs.map((log) => (
                                        <div key={log.id} className="flex items-start space-x-3 p-3 rounded-lg bg-white/5">
                                            <div className="flex-shrink-0">
                                                <Badge variant="outline" className={`text-xs ${getLogLevelColor(log.level)}`}>
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
                                                        <pre className="text-xs text-gray-300 mt-1 bg-[#0B0F17] p-2 rounded">
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
                            </div>
                        </TabsContent>

                        {/* 알림 탭 */}
                        <TabsContent value="alerts" className="space-y-6">
                            <div className="space-y-4">
                                {monitoringData?.alerts && monitoringData.alerts.length > 0 ? (
                                    monitoringData.alerts.map((alert) => (
                                        <Alert
                                            key={alert.id}
                                            className={`bg-[#131823] border ${
                                                alert.type === 'error' ? 'border-red-500/30' :
                                                    alert.type === 'warning' ? 'border-yellow-500/30' :
                                                        'border-blue-500/30'
                                            } rounded-3xl`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center space-x-2">
                                                    {alert.type === 'error' ? <AlertTriangle className="h-4 w-4 text-red-400" /> :
                                                        alert.type === 'warning' ? <AlertTriangle className="h-4 w-4 text-yellow-400" /> :
                                                            <Bell className="h-4 w-4 text-blue-400" />}
                                                    <AlertTitle className="text-white">{alert.title}</AlertTitle>
                                                </div>
                                                <div className="flex items-center space-x-2">
                                                    <Badge variant="outline" className={alert.resolved ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                                                        {alert.resolved ? '해결됨' : '미해결'}
                                                    </Badge>
                                                    <span className="text-gray-400 text-sm">
                                                        {new Date(alert.timestamp).toLocaleString('ko-KR')}
                                                    </span>
                                                </div>
                                            </div>
                                            <AlertDescription className="text-gray-400 mt-2">
                                                {alert.message}
                                            </AlertDescription>
                                        </Alert>
                                    ))
                                ) : (
                                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-8 text-center">
                                        <Bell className="w-12 h-12 mx-auto mb-4 text-gray-500 opacity-50" />
                                        <p className="text-gray-400">알림이 없습니다.</p>
                                    </div>
                                )}
                            </div>
                        </TabsContent>

                        {/* 성능 통계 탭 */}
                        <TabsContent value="performance" className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Clock className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">평균 응답 시간</h3>
                                    </div>
                                    <div className="text-2xl font-bold text-white">
                                        {monitoringData?.performance.avgResponseTime.toFixed(1)}ms
                                    </div>
                                    <div className="text-sm text-gray-400">API 응답 시간</div>
                                </div>

                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <TrendingUp className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">분당 요청 수</h3>
                                    </div>
                                    <div className="text-2xl font-bold text-white">
                                        {monitoringData?.performance.requestsPerMinute}
                                    </div>
                                    <div className="text-sm text-gray-400">RPM</div>
                                </div>

                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <AlertTriangle className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">오류율</h3>
                                    </div>
                                    <div className="text-2xl font-bold text-white">
                                        {monitoringData?.performance.errorRate.toFixed(2)}%
                                    </div>
                                    <div className="text-sm text-gray-400">에러 발생률</div>
                                </div>

                                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Server className="w-5 h-5 text-gray-400" />
                                        <h3 className="text-sm font-medium text-gray-400">가동 시간</h3>
                                    </div>
                                    <div className="text-2xl font-bold text-white">
                                        {formatUptime(monitoringData?.performance.uptime || 0)}
                                    </div>
                                    <div className="text-sm text-gray-400">시스템 가동 시간</div>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                </motion.div>
            </div>
        </AdminThemeLayout>
    );
}

