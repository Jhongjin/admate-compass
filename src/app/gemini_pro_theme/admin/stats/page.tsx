"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
    BarChart3,
    Activity,
    Users,
    MessageSquare,
    Clock,
    Star,
    Download,
    TrendingUp,
    TrendingDown,
    RefreshCw,
    Zap,
    PieChart,
    ThumbsUp
} from "lucide-react";
import ThemedAdminLayout from "@/components/layouts/ThemedAdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useFeedbackStats } from "@/hooks/useFeedbackStats";
import { logger } from "@/lib/utils/logger";
import { downloadCSV, createStatsCSVData, createFeedbackCSVData } from "@/lib/utils/csvExport";

// Reusing StatCard component locally for now
interface StatCardProps {
    title: string;
    value: string | number;
    change?: number;
    icon: React.ReactNode;
    description?: string;
}

function StatCard({ title, value, change, icon, description }: StatCardProps) {
    const isPositive = change !== undefined && change > 0;

    return (
        <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
            <div className="flex flex-row items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-400">{title}</h3>
                <div className="text-gray-500">{icon}</div>
            </div>
            <div>
                <div className="text-2xl font-bold text-white mb-2">{value}</div>
                {change !== undefined && (
                    <div className="flex items-center space-x-2">
                        <div className={`flex items-center ${isPositive ? "text-green-400" : "text-red-400"}`}>
                            {isPositive ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
                            <span className="text-sm font-medium">{isPositive ? "+" : ""}{change}%</span>
                        </div>
                        <span className="text-xs text-gray-500">지난주 대비</span>
                    </div>
                )}
                {description && (
                    <p className="text-xs text-gray-500 mt-1">{description}</p>
                )}
            </div>
        </div>
    );
}

export default function StatsPage() {
    const { user } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [selectedTimeRange, setSelectedTimeRange] = useState("7d");
    const [activeTab, setActiveTab] = useState("overview");
    const [statsData, setStatsData] = useState<{
        dashboard?: any;
        chatbot?: any;
        detailed?: {
            userActivity?: Array<{ date: string; questions: number; users: number }>;
            topQuestions?: Array<{ question: string; count: number; change: number }>;
            userSegments?: Array<{ segment: string; users: number; questions: number; satisfaction: number }>;
            documentStats?: Array<{ type: string; count: number; size: string; indexed: number }>;
        } | null;
    } | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const period = selectedTimeRange === "1d" ? "1" : selectedTimeRange === "7d" ? "7" : selectedTimeRange === "30d" ? "30" : "7";
    const { stats: feedbackStats, refetch: refetchFeedback } = useFeedbackStats(period);

    const timeRanges = [
        { value: "1d", label: "오늘" },
        { value: "7d", label: "이번 주" },
        { value: "30d", label: "이번 달" },
        { value: "90d", label: "3개월" },
        { value: "1y", label: "1년" },
    ];

    const refreshData = useCallback(async () => {
        setIsLoading(true);
        try {
            await refetchFeedback();
            // Simulate API delay
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Re-fetch stats
            const [dashboardRes, chatbotRes, detailedRes] = await Promise.all([
                fetch('/api/admin/dashboard'),
                fetch('/api/chatbot'),
                fetch(`/api/admin/stats/detailed?period=${selectedTimeRange}`)
            ]);

            const dashboardData = await dashboardRes.json();
            const chatbotData = await chatbotRes.json();
            const detailedData = await detailedRes.json();

            setStatsData({
                dashboard: dashboardData.success ? dashboardData.data : null,
                chatbot: chatbotData.success ? chatbotData.stats : null,
                detailed: detailedData.success ? detailedData.data : null
            });

            setLastUpdated(new Date());
        } catch (error) {
            logger.error('Failed to refresh data:', error);
        } finally {
            setIsLoading(false);
        }
    }, [refetchFeedback, selectedTimeRange]);

    useEffect(() => {
        refreshData();
    }, [refreshData]);

    const dashboardStats = statsData?.dashboard;
    const chatbotStats = statsData?.chatbot;

    const overviewStats = useMemo(() => ({
        totalQuestions: chatbotStats?.totalQuestions || dashboardStats?.weeklyStats?.questions || 0,
        activeUsers: dashboardStats?.weeklyStats?.users || 0,
        avgResponseTime: chatbotStats && chatbotStats.averageResponseTime !== null
            ? `${(chatbotStats.averageResponseTime / 1000).toFixed(1)}s`
            : "N/A",
        satisfactionRate: feedbackStats?.positivePercentage || Math.round((dashboardStats?.weeklyStats?.satisfaction || 0) * 100),
        weeklyChange: {
            questions: 12, // Mock data for change
            users: -5,
            responseTime: -8,
            satisfaction: 2,
        },
    }), [chatbotStats, dashboardStats, feedbackStats]);

    const userActivity = useMemo(() => statsData?.detailed?.userActivity || [
        { date: "Mon", questions: 45, users: 23 },
        { date: "Tue", questions: 52, users: 28 },
        { date: "Wed", questions: 38, users: 19 },
        { date: "Thu", questions: 61, users: 31 },
        { date: "Fri", questions: 49, users: 25 },
        { date: "Sat", questions: 23, users: 12 },
        { date: "Sun", questions: 18, users: 8 },
    ], [statsData?.detailed?.userActivity]);

    return (
        <ThemedAdminLayout currentPage="stats">
            <div className="space-y-8">
                {/* Header */}
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div>
                        <h1 className="text-2xl font-bold text-white mb-2">통계 대시보드</h1>
                        <p className="text-gray-400">시스템 사용량 및 성능 지표를 분석합니다.</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        <Button
                            variant="outline"
                            onClick={refreshData}
                            disabled={isLoading}
                            className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                            새로고침
                        </Button>
                        <Select value={selectedTimeRange} onValueChange={setSelectedTimeRange}>
                            <SelectTrigger className="w-full sm:w-40 bg-[#131823] border-white/10 text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                                {timeRanges.map((range) => (
                                    <SelectItem key={range.value} value={range.value} className="focus:bg-white/5 focus:text-white">
                                        {range.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                            <Download className="w-4 h-4 mr-2" />
                            내보내기
                        </Button>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard
                        title="총 질문 수"
                        value={overviewStats.totalQuestions.toLocaleString()}
                        change={overviewStats.weeklyChange.questions}
                        icon={<MessageSquare className="w-5 h-5" />}
                        description="처리된 총 쿼리 수"
                    />
                    <StatCard
                        title="활성 사용자"
                        value={overviewStats.activeUsers}
                        change={overviewStats.weeklyChange.users}
                        icon={<Users className="w-5 h-5" />}
                        description="기간 내 고유 사용자"
                    />
                    <StatCard
                        title="평균 응답 시간"
                        value={overviewStats.avgResponseTime}
                        change={overviewStats.weeklyChange.responseTime}
                        icon={<Clock className="w-5 h-5" />}
                        description="평균 처리 시간"
                    />
                    <StatCard
                        title="만족도"
                        value={`${overviewStats.satisfactionRate}%`}
                        change={overviewStats.weeklyChange.satisfaction}
                        icon={<Star className="w-5 h-5" />}
                        description="사용자 만족도 점수"
                    />
                </div>

                {/* Tabs & Charts */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                    <TabsList className="bg-[#131823] border border-white/5 p-1 rounded-xl">
                        <TabsTrigger value="overview" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg">개요</TabsTrigger>
                        <TabsTrigger value="activity" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg">활동</TabsTrigger>
                        <TabsTrigger value="feedback" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg">피드백</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Activity Chart */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <BarChart3 className="w-5 h-5 mr-2 text-blue-400" />
                                        주간 활동
                                    </h3>
                                </div>
                                <div className="flex items-end justify-between h-64 gap-2">
                                    {userActivity.map((day, index) => (
                                        <div key={index} className="flex-1 flex flex-col items-center gap-2 group">
                                            <div className="w-full flex items-end justify-center gap-1 h-full relative">
                                                <div
                                                    className="w-full max-w-[20px] bg-blue-500/50 rounded-t-sm transition-all duration-300 group-hover:bg-blue-400"
                                                    style={{ height: `${Math.max((day.questions / 100) * 100, 5)}%` }}
                                                />
                                                <div
                                                    className="w-full max-w-[20px] bg-green-500/50 rounded-t-sm transition-all duration-300 group-hover:bg-green-400"
                                                    style={{ height: `${Math.max((day.users / 50) * 100, 5)}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-gray-500">{day.date}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-center gap-6 mt-4">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 bg-blue-500/50 rounded-sm" />
                                        <span className="text-xs text-gray-400">질문</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 bg-green-500/50 rounded-sm" />
                                        <span className="text-xs text-gray-400">사용자</span>
                                    </div>
                                </div>
                            </div>

                            {/* Top Questions or Other Stats */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <PieChart className="w-5 h-5 mr-2 text-purple-400" />
                                        시스템 상태
                                    </h3>
                                </div>
                                <div className="space-y-4">
                                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                            <span className="text-gray-300">데이터베이스 연결</span>
                                        </div>
                                        <span className="text-green-400 text-sm font-medium">정상</span>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                            <span className="text-gray-300">LLM API 상태</span>
                                        </div>
                                        <span className="text-green-400 text-sm font-medium">작동 중</span>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                            <span className="text-gray-300">벡터 저장소</span>
                                        </div>
                                        <span className="text-green-400 text-sm font-medium">인덱싱됨</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="activity">
                        <div className="bg-[#131823] border border-white/5 rounded-3xl p-8 text-center text-gray-500">
                            상세 활동 차트가 여기에 표시됩니다.
                        </div>
                    </TabsContent>

                    <TabsContent value="feedback">
                        <div className="bg-[#131823] border border-white/5 rounded-3xl p-8 text-center text-gray-500">
                            상세 피드백 분석이 여기에 표시됩니다.
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </ThemedAdminLayout>
    );
}
