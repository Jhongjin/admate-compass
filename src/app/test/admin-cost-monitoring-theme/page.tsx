"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
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
    Activity,
    BarChart3 as BarChart3Icon,
    MessageSquare,
    Users,
    Zap
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import Link from "next/link";
import Image from "next/image";

// 테스트 페이지용 레이아웃
function TestCostLayout({ children, currentPage = "cost" }: { children: React.ReactNode; currentPage?: string }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const navigation = [
        { name: "대시보드", href: "/test/admin-theme", icon: BarChart3Icon, current: currentPage === "dashboard" },
        { name: "문서 관리", href: "/admin/docs", icon: MessageSquare, current: currentPage === "docs" },
        { name: "처리 큐", href: "/test/admin-queues-theme", icon: Activity, current: currentPage === "queues" },
        { name: "사용자 관리", href: "/test/admin-users-theme", icon: Users, current: currentPage === "users" },
        { name: "시스템 모니터링", href: "/test/admin-monitoring-theme", icon: Zap, current: currentPage === "monitoring" },
        { name: "통계 및 분석", href: "/test/admin-stats-theme", icon: PieChart, current: currentPage === "stats" },
        { name: "로그 및 감사", href: "/test/admin-logs-theme", icon: Activity, current: currentPage === "logs" },
        { name: "비용 모니터링", href: "/test/admin-cost-monitoring-theme", icon: BarChart3Icon, current: currentPage === "cost" },
    ];

    return (
        <div className="min-h-screen bg-[#0B0F17] text-white font-sans selection:bg-blue-500/30">
            <header className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F17]/80 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-20">
                        <div className="flex items-center gap-8">
                            <Link href="/" className="flex items-center gap-2 group">
                                <div className="relative w-8 h-8">
                                    <Image src="/admate-logo.png" alt="AdMate" fill className="object-contain" />
                                </div>
                                <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">AdMate</span>
                            </Link>
                            <div className="hidden md:flex items-center text-sm text-gray-500">
                                <span className="px-2">/</span>
                                <span className="text-gray-300">Admin Cost Monitoring (Test)</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-full bg-white/5 border border-white/5">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-xs font-medium text-gray-300">System Operational</span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>
            <div className="pt-20 flex max-w-[1600px] mx-auto">
                <aside className="hidden md:block w-64 fixed h-[calc(100vh-5rem)] border-r border-white/5 bg-[#0B0F17]/50 backdrop-blur-sm">
                    <nav className="p-4 space-y-2">
                        {navigation.map((item) => (
                            <Link key={item.name} href={item.href} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${item.current ? "bg-blue-600/10 text-blue-400 border border-blue-500/20" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}>
                                <item.icon className={`w-5 h-5 ${item.current ? "text-blue-400" : "text-gray-500"}`} />
                                {item.name}
                            </Link>
                        ))}
                    </nav>
                </aside>
                <main className="flex-1 md:pl-64 min-h-[calc(100vh-5rem)]">
                    <div className="p-6 lg:p-10 space-y-8">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}

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
        }, 60000);

        return () => clearInterval(interval);
    }, [autoRefresh]);

    const getStatusColor = (status: 'healthy' | 'warning' | 'critical') => {
        switch (status) {
            case 'healthy':
                return 'bg-green-500/20 text-green-400 border-green-500/30';
            case 'warning':
                return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
            case 'critical':
                return 'bg-red-500/20 text-red-400 border-red-500/30';
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
            <TestCostLayout currentPage="cost">
                <div className="space-y-6">
                    <Skeleton className="h-12 w-64 bg-white/10 rounded-3xl" />
                    <Skeleton className="h-64 w-full bg-white/10 rounded-3xl" />
                    <Skeleton className="h-64 w-full bg-white/10 rounded-3xl" />
                </div>
            </TestCostLayout>
        );
    }

    if (error || !costMetrics || !metadata) {
        return (
            <TestCostLayout currentPage="cost">
                <div className="space-y-6">
                    <Alert className="bg-red-900/20 border-red-500/30 text-white">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>오류</AlertTitle>
                        <AlertDescription>{error || '비용 데이터를 불러올 수 없습니다.'}</AlertDescription>
                    </Alert>
                    <Button onClick={loadCostData} className="bg-blue-600 hover:bg-blue-700">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        다시 시도
                    </Button>
                </div>
            </TestCostLayout>
        );
    }

    return (
        <TestCostLayout currentPage="cost">
            <div className="space-y-6">
                {/* 헤더 */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-2 sm:mb-3 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
                            <DollarSign className="w-8 h-8" />
                            비용 모니터링
                        </h1>
                        <p className="text-gray-400 text-sm sm:text-base">
                            Supabase 및 Vercel 사용량 추적 및 예산 관리
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
                            {autoRefresh ? '자동 새로고침 활성화' : '자동 새로고침 비활성화'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={loadCostData} className="bg-[#131823] border-white/10 text-white hover:bg-white/5">
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
                                className={`${
                                    alert.severity === 'critical' ? 'bg-red-900/20 border-red-500/30' :
                                        alert.severity === 'warning' ? 'bg-yellow-900/20 border-yellow-500/30' :
                                            'bg-blue-900/20 border-blue-500/30'
                                }`}
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <DollarSign className="w-5 h-5 text-gray-400" />
                            <h3 className="text-sm font-medium text-gray-400">월 총 예상 비용</h3>
                        </div>
                        <div className="text-3xl font-bold text-white">
                            {costMetrics.total.estimatedCostFormatted}
                        </div>
                        <div className="text-sm text-gray-400 mt-2">
                            예상 월 비용
                        </div>
                    </div>

                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <BarChart3 className="w-5 h-5 text-gray-400" />
                            <h3 className="text-sm font-medium text-gray-400">예산 사용률</h3>
                        </div>
                        <div className="text-3xl font-bold text-white">
                            {costMetrics.total.budgetUsage.toFixed(1)}%
                        </div>
                        <div className="w-full bg-white/10 rounded-full h-2 mt-4">
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
                        <div className="text-sm text-gray-400 mt-2">
                            예산: ${metadata.monthlyBudget} / 사용: {costMetrics.total.estimatedCostFormatted}
                        </div>
                    </div>

                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <TrendingUp className="w-5 h-5 text-gray-400" />
                            <h3 className="text-sm font-medium text-gray-400">예산 잔액</h3>
                        </div>
                        <div className="text-3xl font-bold text-white">
                            ${costMetrics.total.budgetRemaining.toFixed(2)}
                        </div>
                        <Badge variant="outline" className={`mt-2 ${getStatusColor(costMetrics.total.status)}`}>
                            {getStatusIcon(costMetrics.total.status)}
                            <span className="ml-2">
                                {costMetrics.total.status === 'healthy' ? '정상' :
                                    costMetrics.total.status === 'warning' ? '주의' : '위험'}
                            </span>
                        </Badge>
                    </div>
                </div>

                {/* Supabase 비용 상세 */}
                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                    <div className="flex items-center gap-2 mb-6">
                        <Database className="w-5 h-5 text-gray-400" />
                        <h3 className="text-lg font-bold text-white">Supabase 비용</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <div className="text-sm text-gray-400">데이터베이스</div>
                            <div className="text-xl font-semibold text-white">
                                {costMetrics.supabase.database.sizeFormatted}
                            </div>
                            <div className="text-sm text-gray-400">
                                {costMetrics.supabase.database.estimatedCostFormatted}
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-400">Storage</div>
                            <div className="text-xl font-semibold text-white">
                                {costMetrics.supabase.storage.sizeFormatted}
                            </div>
                            <div className="text-sm text-gray-400">
                                {costMetrics.supabase.storage.estimatedCostFormatted}
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-400">Bandwidth</div>
                            <div className="text-xl font-semibold text-white">
                                {costMetrics.supabase.bandwidth.usageFormatted}
                            </div>
                            <div className="text-sm text-gray-400">
                                {costMetrics.supabase.bandwidth.estimatedCostFormatted}
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-400">총 비용</div>
                            <div className="text-xl font-semibold text-white">
                                {costMetrics.supabase.total.estimatedCostFormatted}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Vercel 비용 상세 */}
                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                    <div className="flex items-center gap-2 mb-6">
                        <Server className="w-5 h-5 text-gray-400" />
                        <h3 className="text-lg font-bold text-white">Vercel 비용</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <div className="text-sm text-gray-400">Function Invocations</div>
                            <div className="text-xl font-semibold text-white">
                                {costMetrics.vercel.functionInvocations.count.toLocaleString()}회
                            </div>
                            <div className="text-sm text-gray-400">
                                {costMetrics.vercel.functionInvocations.estimatedCostFormatted}
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-400">Bandwidth</div>
                            <div className="text-xl font-semibold text-white">
                                {costMetrics.vercel.bandwidth.usageFormatted}
                            </div>
                            <div className="text-sm text-gray-400">
                                {costMetrics.vercel.bandwidth.estimatedCostFormatted}
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-400">총 비용</div>
                            <div className="text-xl font-semibold text-white">
                                {costMetrics.vercel.total.estimatedCostFormatted}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 통계 정보 */}
                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                    <div className="flex items-center gap-2 mb-6">
                        <Activity className="w-5 h-5 text-gray-400" />
                        <h3 className="text-lg font-bold text-white">시스템 통계</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <div className="text-sm text-gray-400">총 문서 수</div>
                            <div className="text-2xl font-semibold text-white">
                                {metadata.documentCount.toLocaleString()}개
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-400">총 청크 수</div>
                            <div className="text-2xl font-semibold text-white">
                                {metadata.chunkCount.toLocaleString()}개
                            </div>
                        </div>
                        <div>
                            <div className="text-sm text-gray-400">처리 작업 수</div>
                            <div className="text-2xl font-semibold text-white">
                                {metadata.jobCount.toLocaleString()}개
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-white/5">
                        <div className="text-sm text-gray-400">
                            마지막 업데이트: {format(new Date(metadata.lastUpdated), 'yyyy-MM-dd HH:mm:ss', { locale: ko })}
                        </div>
                    </div>
                </div>

                {/* 트렌드 차트 */}
                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                    <div className="flex items-center gap-2 mb-6">
                        <BarChart3 className="w-5 h-5 text-gray-400" />
                        <h3 className="text-lg font-bold text-white">비용 트렌드 (최근 7일)</h3>
                    </div>
                    <div className="space-y-2">
                        {costMetrics.trends.daily.map((day, idx) => (
                            <div key={idx} className="flex items-center justify-between p-2 bg-white/5 rounded-lg">
                                <div className="text-sm text-gray-400">
                                    {format(new Date(day.date), 'MM월 dd일', { locale: ko })}
                                </div>
                                <div className="text-sm font-semibold text-white">
                                    ${day.total.toFixed(2)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </TestCostLayout>
    );
}

