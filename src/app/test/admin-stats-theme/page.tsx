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
    ThumbsUp,
    ThumbsDown,
    Info,
    AlertTriangle,
    Eye,
    Calendar
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useFeedbackStats } from "@/hooks/useFeedbackStats";
import { downloadCSV, createStatsCSVData, createFeedbackCSVData } from "@/lib/utils/csvExport";
import { logger } from "@/lib/utils/logger";
import Link from "next/link";
import Image from "next/image";

// 테스트 페이지용 레이아웃 (gemini_pro_theme 스타일)
function TestStatsLayout({ children, currentPage = "stats" }: { children: React.ReactNode; currentPage?: string }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const navigation = [
        { name: "대시보드", href: "/test/admin-theme", icon: BarChart3, current: currentPage === "dashboard" },
        { name: "문서 관리", href: "/admin/docs", icon: MessageSquare, current: currentPage === "docs" },
        { name: "처리 큐", href: "/admin/queues", icon: Activity, current: currentPage === "queues" },
        { name: "사용자 관리", href: "/admin/users", icon: Users, current: currentPage === "users" },
        { name: "시스템 모니터링", href: "/admin/monitoring", icon: Zap, current: currentPage === "monitoring" },
        { name: "통계 및 분석", href: "/test/admin-stats-theme", icon: PieChart, current: currentPage === "stats" },
        { name: "로그 및 감사", href: "/admin/logs", icon: Activity, current: currentPage === "logs" },
        { name: "비용 모니터링", href: "/admin/cost-monitoring", icon: BarChart3, current: currentPage === "cost" },
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
                                <span className="text-gray-300">Admin Statistics (Test)</span>
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

// StatCard 컴포넌트 (gemini_pro_theme 스타일)
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

export default function StatisticsPage() {
    const { user, loading } = useAuth();

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
    const [isClient, setIsClient] = useState(false);

    const period = selectedTimeRange === "1d" ? "1" : selectedTimeRange === "7d" ? "7" : selectedTimeRange === "30d" ? "30" : "7";
    const { stats: feedbackStats, isLoading: feedbackLoading, error: feedbackError, refetch: refetchFeedback } = useFeedbackStats(period);

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
            await new Promise(resolve => setTimeout(resolve, 1000));
            
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
            logger.log(`데이터 새로고침 완료: ${selectedTimeRange} 범위`);
        } catch (error) {
            logger.error('데이터 새로고침 실패:', error);
        } finally {
            setIsLoading(false);
        }
    }, [refetchFeedback, selectedTimeRange]);

    const handleTimeRangeChange = useCallback((value: string) => {
        setSelectedTimeRange(value);
        refreshData();
    }, [refreshData]);

    useEffect(() => {
        setIsClient(true);
        setLastUpdated(new Date());
        refreshData();
    }, [selectedTimeRange]);

    const dashboardStats = statsData?.dashboard;
    const chatbotStats = statsData?.chatbot;

    const overviewStats = useMemo(() => ({
        totalQuestions: chatbotStats?.totalQuestions || dashboardStats?.weeklyStats?.questions || 0,
        activeUsers: dashboardStats?.weeklyStats?.users || 0,
        avgResponseTime: chatbotStats && chatbotStats.averageResponseTime !== null && chatbotStats.averageResponseTime !== undefined
            ? `${(chatbotStats.averageResponseTime / 1000).toFixed(1)}초`
            : "데이터 없음",
        satisfactionRate: feedbackStats?.positivePercentage || Math.round((dashboardStats?.weeklyStats?.satisfaction || 0) * 100),
        totalDocuments: dashboardStats?.totalDocuments || 0,
        indexedDocuments: dashboardStats?.completedDocuments || 0,
        totalFeedback: feedbackStats?.total || 0,
        positiveFeedback: feedbackStats?.positive || 0,
        negativeFeedback: feedbackStats?.negative || 0,
        weeklyChange: {
            questions: 0,
            users: 0,
            responseTime: 0,
            satisfaction: 0,
        },
    }), [chatbotStats, dashboardStats, feedbackStats]);

    const detailedStats = statsData?.detailed;
    const userActivity = useMemo(() => detailedStats?.userActivity || [
        { date: "월", questions: 0, users: 0 },
        { date: "화", questions: 0, users: 0 },
        { date: "수", questions: 0, users: 0 },
        { date: "목", questions: 0, users: 0 },
        { date: "금", questions: 0, users: 0 },
        { date: "토", questions: 0, users: 0 },
        { date: "일", questions: 0, users: 0 },
    ], [detailedStats?.userActivity]);

    const topQuestions = useMemo(() => detailedStats?.topQuestions || [], [detailedStats?.topQuestions]);
    const userSegments = useMemo(() => detailedStats?.userSegments || [], [detailedStats?.userSegments]);
    const documentStats = useMemo(() => detailedStats?.documentStats || [], [detailedStats?.documentStats]);

    const exportToCSV = useCallback(() => {
        try {
            const statsData = createStatsCSVData(overviewStats);
            let allData = [...statsData];

            if (feedbackStats) {
                allData.push(['', '', '', '']);
                allData.push(['=== 피드백 통계 ===', '', '', '']);
                const feedbackData = createFeedbackCSVData(feedbackStats);
                allData = [...allData, ...feedbackData];
            }

            allData.push(['', '', '', '']);
            allData.push(['=== 주간 활동 현황 ===', '', '', '']);
            allData.push(['요일', '질문 수', '사용자 수', '설명']);
            userActivity.forEach(day => {
                allData.push([day.date, day.questions, day.users, `${day.date} 활동량`]);
            });

            allData.push(['', '', '', '']);
            allData.push(['=== 인기 질문 TOP 5 ===', '', '', '']);
            allData.push(['순위', '질문', '질문 수', '변화율']);
            topQuestions.forEach((question, index) => {
                allData.push([index + 1, question.question, question.count, `${question.change}%`]);
            });

            const filename = `통계_데이터_${new Date().toISOString().split('T')[0]}.csv`;
            downloadCSV(allData, filename, { includeBOM: true });
        } catch (error) {
            logger.error('CSV 내보내기 오류:', error);
            const basicData = createStatsCSVData(overviewStats);
            downloadCSV(basicData, `통계_데이터_${new Date().toISOString().split('T')[0]}.csv`);
        }
    }, [overviewStats, feedbackStats, userActivity, topQuestions]);

    const exportToPDF = useCallback(async () => {
        try {
            const [{ default: jsPDF }] = await Promise.all([
                import('jspdf')
            ]);

            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            let yPosition = 20;

            pdf.setFontSize(20);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Statistics Dashboard Report', pageWidth / 2, yPosition, { align: 'center' });
            yPosition += 15;

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'normal');
            pdf.text(`Generated: ${new Date().toLocaleString('en-US')}`, pageWidth / 2, yPosition, { align: 'center' });
            yPosition += 20;

            pdf.setFontSize(16);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Key Performance Indicators', 20, yPosition);
            yPosition += 10;

            const statsData = [
                ['Metric', 'Value', 'Change'],
                ['Total Questions', overviewStats.totalQuestions.toLocaleString(), `${overviewStats.weeklyChange.questions}%`],
                ['Active Users', overviewStats.activeUsers.toString(), `${overviewStats.weeklyChange.users}%`],
                ['Avg Response Time', overviewStats.avgResponseTime, `${overviewStats.weeklyChange.responseTime}%`],
                ['Satisfaction Rate', `${overviewStats.satisfactionRate}%`, `${overviewStats.weeklyChange.satisfaction}%`],
                ['Total Documents', overviewStats.totalDocuments.toString(), '0%'],
                ['Indexed Documents', overviewStats.indexedDocuments.toString(), '0%'],
            ];

            const tableTop = yPosition;
            const cellHeight = 8;
            const colWidths = [60, 40, 30];
            const tableLeft = 20;

            pdf.setFillColor(240, 240, 240);
            pdf.rect(tableLeft, tableTop, colWidths.reduce((a, b) => a + b, 0), cellHeight, 'F');

            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'bold');
            let xPos = tableLeft;
            statsData[0].forEach((header, index) => {
                pdf.text(header, xPos + 2, tableTop + 6);
                xPos += colWidths[index];
            });

            pdf.setFont('helvetica', 'normal');
            statsData.slice(1).forEach((row, rowIndex) => {
                const rowY = tableTop + cellHeight + (rowIndex * cellHeight);
                if (rowIndex % 2 === 0) {
                    pdf.setFillColor(250, 250, 250);
                    pdf.rect(tableLeft, rowY, colWidths.reduce((a, b) => a + b, 0), cellHeight, 'F');
                }
                xPos = tableLeft;
                row.forEach((cell, colIndex) => {
                    pdf.text(cell.toString(), xPos + 2, rowY + 6);
                    xPos += colWidths[colIndex];
                });
            });

            const fileName = `Statistics_Report_${new Date().toISOString().split('T')[0]}.pdf`;
            pdf.save(fileName);
        } catch (error) {
            logger.error('PDF 생성 오류:', error);
            window.print();
        }
    }, [overviewStats]);

    const exportToJSON = useCallback(() => {
        const jsonData = {
            exportDate: new Date().toISOString(),
            exportInfo: {
                version: '1.0',
                generatedBy: 'Meta FAQ AI 챗봇 관리자 대시보드',
                timeRange: selectedTimeRange,
                lastUpdated: lastUpdated?.toISOString()
            },
            overviewStats,
            feedbackStats,
            userActivity,
            topQuestions,
            userSegments,
            documentStats,
        };

        const jsonContent = JSON.stringify(jsonData, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `통계_데이터_${new Date().toISOString().split('T')[0]}.json`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [overviewStats, feedbackStats, userActivity, topQuestions, userSegments, documentStats, selectedTimeRange, lastUpdated]);

    if (loading) {
        return (
            <TestStatsLayout currentPage="stats">
                <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-gray-400">로그인 상태를 확인하는 중...</p>
                    </div>
                </div>
            </TestStatsLayout>
        );
    }

    if (!user) {
        return (
            <TestStatsLayout currentPage="stats">
                <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
                    <div className="text-center">
                        <div className="bg-red-900/20 border border-red-500/30 text-red-100 px-4 py-3 rounded mb-4">
                            <p className="font-bold">관리자 권한이 필요합니다</p>
                            <p className="text-sm">통계 페이지에 접근하려면 먼저 로그인해주세요.</p>
                        </div>
                    </div>
                </div>
            </TestStatsLayout>
        );
    }

    return (
        <TestStatsLayout currentPage="stats">
            <div className="space-y-8">
                {/* System Alert */}
                <Alert className="bg-[#131823] border-white/5 text-white">
                    <Info className="h-5 w-5 text-blue-400" />
                    <AlertTitle className="text-white font-bold text-lg">📊 실시간 통계 업데이트</AlertTitle>
                    <AlertDescription className="text-gray-300">
                        통계 데이터는 5분마다 자동으로 업데이트됩니다. 실시간 데이터를 보려면 새로고침 버튼을 클릭하세요.
                        {isClient && lastUpdated && (
                            <span className="text-white font-bold text-sm bg-blue-600/20 px-2 py-1 rounded-md mt-2 inline-block ml-2">
                                마지막 업데이트: {lastUpdated.toLocaleString('ko-KR')}
                            </span>
                        )}
                    </AlertDescription>
                </Alert>

                {/* Header */}
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-2 sm:mb-3 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                            📈 사용 통계 대시보드
                        </h1>
                        <p className="text-gray-400 text-sm sm:text-base lg:text-lg">
                            시스템 사용 현황과 성과 지표를 분석하여 개선점을 파악하세요.
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
                                        className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                                    >
                                        <RefreshCw className={`w-4 h-4 sm:mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                                        <span className="hidden sm:inline">새로고침</span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>통계 데이터를 새로고침합니다</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <Select value={selectedTimeRange} onValueChange={handleTimeRangeChange}>
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
                        <div className="relative group">
                            <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                                <Download className="w-4 h-4 sm:mr-2" />
                                <span className="hidden sm:inline">내보내기</span>
                            </Button>
                            <div className="absolute top-full left-0 mt-1 w-48 bg-[#1A1F2C] border border-white/10 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
                                <div className="p-2">
                                    <button
                                        onClick={exportToCSV}
                                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/5 rounded flex items-center"
                                    >
                                        <Download className="w-4 h-4 mr-2 text-blue-400" />
                                        CSV 다운로드
                                    </button>
                                    <button
                                        onClick={exportToPDF}
                                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/5 rounded flex items-center"
                                    >
                                        <Download className="w-4 h-4 mr-2 text-green-400" />
                                        PDF 리포트
                                    </button>
                                    <button
                                        onClick={exportToJSON}
                                        className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/5 rounded flex items-center"
                                    >
                                        <Download className="w-4 h-4 mr-2 text-purple-400" />
                                        JSON 데이터
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Overview Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                    {isLoading ? (
                        Array.from({ length: 4 }).map((_, index) => (
                            <div key={index} className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <Skeleton className="h-4 w-24 mb-2 bg-white/10" />
                                <Skeleton className="h-8 w-20 mb-2 bg-white/10" />
                                <Skeleton className="h-3 w-16 bg-white/10" />
                            </div>
                        ))
                    ) : (
                        <>
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
                        </>
                    )}
                </div>

                {/* Tabs & Charts */}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                    <TabsList className="bg-[#131823] border border-white/5 p-1 rounded-xl overflow-x-auto flex-nowrap">
                        <TabsTrigger value="overview" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg whitespace-nowrap">
                            <BarChart3 className="w-4 h-4 sm:mr-2" />
                            <span className="hidden sm:inline">개요</span>
                        </TabsTrigger>
                        <TabsTrigger value="activity" className="data-[state=active]:bg-green-600 data-[state=active]:text-white text-gray-400 rounded-lg whitespace-nowrap">
                            <Activity className="w-4 h-4 sm:mr-2" />
                            <span className="hidden sm:inline">활동 현황</span>
                        </TabsTrigger>
                        <TabsTrigger value="feedback" className="data-[state=active]:bg-orange-600 data-[state=active]:text-white text-gray-400 rounded-lg whitespace-nowrap">
                            <ThumbsUp className="w-4 h-4 sm:mr-2" />
                            <span className="hidden sm:inline">피드백</span>
                        </TabsTrigger>
                        <TabsTrigger value="performance" className="data-[state=active]:bg-purple-600 data-[state=active]:text-white text-gray-400 rounded-lg whitespace-nowrap">
                            <Zap className="w-4 h-4 sm:mr-2" />
                            <span className="hidden sm:inline">성능 지표</span>
                        </TabsTrigger>
                        <TabsTrigger value="analytics" className="data-[state=active]:bg-yellow-600 data-[state=active]:text-white text-gray-400 rounded-lg whitespace-nowrap">
                            <PieChart className="w-4 h-4 sm:mr-2" />
                            <span className="hidden sm:inline">분석</span>
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Weekly Activity Chart */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <BarChart3 className="w-5 h-5 mr-2 text-blue-400" />
                                        주간 활동 현황
                                    </h3>
                                </div>
                                <div className="flex items-end justify-between h-64 gap-2">
                                    {userActivity.map((day, index) => (
                                        <div key={index} className="flex-1 flex flex-col items-center gap-2 group">
                                            <div className="w-full flex items-end justify-center gap-1 h-full relative">
                                                <div
                                                    className="w-full max-w-[20px] bg-blue-500/50 rounded-t-sm transition-all duration-300 group-hover:bg-blue-400"
                                                    style={{ height: `${Math.max((day.questions / 70) * 100, 5)}%` }}
                                                />
                                                <div
                                                    className="w-full max-w-[20px] bg-green-500/50 rounded-t-sm transition-all duration-300 group-hover:bg-green-400"
                                                    style={{ height: `${Math.max((day.users / 35) * 100, 5)}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-gray-400">{day.date}</span>
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

                            {/* Top Questions Table */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <MessageSquare className="w-5 h-5 mr-2 text-green-400" />
                                        인기 질문 TOP 5
                                    </h3>
                                </div>
                                <div className="space-y-3">
                                    {topQuestions.length > 0 ? (
                                        topQuestions.map((item, index) => (
                                            <div key={index} className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                                                        index === 0 ? "bg-yellow-500 text-yellow-900" :
                                                        index === 1 ? "bg-gray-400 text-gray-900" :
                                                        index === 2 ? "bg-orange-500 text-orange-900" :
                                                        "bg-blue-500 text-blue-900"
                                                    }`}>
                                                        {index + 1}
                                                    </div>
                                                    <p className="text-sm font-medium text-white">{item.question}</p>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm text-gray-300">{item.count}회</span>
                                                    {item.change > 0 ? (
                                                        <TrendingUp className="w-4 h-4 text-green-400" />
                                                    ) : (
                                                        <TrendingDown className="w-4 h-4 text-red-400" />
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                            <p>아직 질문 데이터가 없습니다.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="activity" className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* User Segments */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <Users className="w-5 h-5 mr-2 text-blue-400" />
                                        부서별 사용 현황
                                    </h3>
                                </div>
                                <div className="space-y-4">
                                    {userSegments.length > 0 ? (
                                        userSegments.map((segment, index) => (
                                            <div key={index} className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                                                <div>
                                                    <p className="font-medium text-white">{segment.segment}</p>
                                                    <p className="text-sm text-gray-400">{segment.users}명</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-medium text-white">{segment.questions}질문</p>
                                                    <div className="flex items-center space-x-3 mt-1">
                                                        <div className="w-20 h-2 bg-white/10 rounded-full overflow-hidden">
                                                            <div className="h-full bg-blue-500" style={{ width: `${segment.satisfaction}%` }}></div>
                                                        </div>
                                                        <span className="text-sm font-semibold text-white min-w-[3rem]">{segment.satisfaction}%</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                            <p>아직 사용자 세그먼트 데이터가 없습니다.</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* System Status */}
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

                    <TabsContent value="feedback" className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Feedback Stats */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <ThumbsUp className="w-5 h-5 mr-2 text-orange-400" />
                                        피드백 통계
                                    </h3>
                                </div>
                                {feedbackLoading ? (
                                    <div className="space-y-4">
                                        <Skeleton className="h-4 w-full bg-white/10" />
                                        <Skeleton className="h-4 w-3/4 bg-white/10" />
                                        <Skeleton className="h-4 w-1/2 bg-white/10" />
                                    </div>
                                ) : feedbackError ? (
                                    <div className="text-center py-8">
                                        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                                        <p className="text-red-400 text-sm">{feedbackError}</p>
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="text-center p-4 bg-white/5 rounded-lg">
                                                <div className="text-2xl font-bold text-white mb-1">
                                                    {feedbackStats?.total || 0}
                                                </div>
                                                <p className="text-sm text-gray-400">총 피드백</p>
                                            </div>
                                            <div className="text-center p-4 bg-green-500/20 rounded-lg">
                                                <div className="text-2xl font-bold text-green-400 mb-1">
                                                    {feedbackStats?.positive || 0}
                                                </div>
                                                <p className="text-sm text-gray-400">도움됨</p>
                                            </div>
                                            <div className="text-center p-4 bg-red-500/20 rounded-lg">
                                                <div className="text-2xl font-bold text-red-400 mb-1">
                                                    {feedbackStats?.negative || 0}
                                                </div>
                                                <p className="text-sm text-gray-400">도움안됨</p>
                                            </div>
                                        </div>
                                        <div className="text-center p-4 bg-white/5 rounded-lg">
                                            <div className="text-3xl font-bold text-orange-400 mb-1">
                                                {feedbackStats?.positivePercentage || 0}%
                                            </div>
                                            <p className="text-sm text-gray-400">만족도</p>
                                            <div className="w-full bg-white/10 rounded-full h-2 mt-2">
                                                <div
                                                    className="bg-orange-500 h-2 rounded-full transition-all duration-500"
                                                    style={{ width: `${feedbackStats?.positivePercentage || 0}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Daily Feedback Chart */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <BarChart3 className="w-5 h-5 mr-2 text-blue-400" />
                                        일별 피드백 추이
                                    </h3>
                                </div>
                                {feedbackLoading ? (
                                    <div className="space-y-4">
                                        <Skeleton className="h-4 w-full bg-white/10" />
                                        <Skeleton className="h-4 w-3/4 bg-white/10" />
                                    </div>
                                ) : feedbackError ? (
                                    <div className="text-center py-8">
                                        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                                        <p className="text-red-400 text-sm">{feedbackError}</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between text-sm text-gray-400">
                                            <span>최근 {period}일간 피드백</span>
                                            <div className="flex items-center space-x-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 bg-green-500 rounded" />
                                                    <span>도움됨</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-3 h-3 bg-red-500 rounded" />
                                                    <span>도움안됨</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-end justify-between h-48 gap-2">
                                            {feedbackStats?.dailyStats?.slice(-7).map((day, index) => (
                                                <div key={index} className="flex-1 flex flex-col items-center gap-2 group">
                                                    <div className="w-full flex items-end justify-center gap-1 h-full relative">
                                                        <div
                                                            className="w-full max-w-[20px] bg-green-500/50 rounded-t-sm transition-all duration-300 group-hover:bg-green-400"
                                                            style={{ height: `${Math.max((day.positive / Math.max(day.total, 1)) * 100, 5)}%` }}
                                                        />
                                                        <div
                                                            className="w-full max-w-[20px] bg-red-500/50 rounded-t-sm transition-all duration-300 group-hover:bg-red-400"
                                                            style={{ height: `${Math.max((day.negative / Math.max(day.total, 1)) * 100, 5)}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-xs text-gray-400">
                                                        {new Date(day.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                                                    </span>
                                                </div>
                                            )) || []}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Recent Feedback List */}
                        <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-lg font-bold text-white flex items-center">
                                    <MessageSquare className="w-5 h-5 mr-2 text-green-400" />
                                    최근 피드백
                                </h3>
                            </div>
                            {feedbackLoading ? (
                                <div className="space-y-4">
                                    {Array.from({ length: 5 }).map((_, index) => (
                                        <div key={index} className="flex items-center space-x-4 p-4 bg-white/5 rounded-lg">
                                            <Skeleton className="w-8 h-8 rounded-full bg-white/10" />
                                            <div className="flex-1 space-y-2">
                                                <Skeleton className="h-4 w-3/4 bg-white/10" />
                                                <Skeleton className="h-3 w-1/2 bg-white/10" />
                                            </div>
                                            <Skeleton className="w-16 h-6 bg-white/10" />
                                        </div>
                                    ))}
                                </div>
                            ) : feedbackError ? (
                                <div className="text-center py-8">
                                    <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                                    <p className="text-red-400 text-sm">{feedbackError}</p>
                                </div>
                            ) : feedbackStats?.recentFeedback?.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    <p>아직 피드백이 없습니다.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {feedbackStats?.recentFeedback?.slice(0, 10).map((feedback) => (
                                        <div key={feedback.id} className="flex items-center space-x-4 p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                                            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white/5">
                                                {feedback.helpful ? (
                                                    <ThumbsUp className="w-4 h-4 text-green-400" />
                                                ) : (
                                                    <ThumbsDown className="w-4 h-4 text-red-400" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-white truncate">
                                                    {feedback.conversations?.user_message || '사용자 질문'}
                                                </p>
                                                <p className="text-xs text-gray-400 truncate">
                                                    {feedback.conversations?.ai_response || 'AI 응답'}
                                                </p>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Badge
                                                    variant="outline"
                                                    className={`${
                                                        feedback.helpful
                                                            ? 'border-green-500 text-green-400'
                                                            : 'border-red-500 text-red-400'
                                                    }`}
                                                >
                                                    {feedback.helpful ? '도움됨' : '도움안됨'}
                                                </Badge>
                                                <span className="text-xs text-gray-500">
                                                    {new Date(feedback.created_at).toLocaleDateString('ko-KR')}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="performance" className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Performance Metrics */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <Zap className="w-5 h-5 mr-2 text-purple-400" />
                                        시스템 성능 지표
                                    </h3>
                                </div>
                                <div className="space-y-4">
                                    <div className="text-center p-4 bg-white/5 rounded-lg">
                                        <div className="text-3xl font-black text-white mb-1">99.2%</div>
                                        <p className="text-sm text-gray-400">시스템 가동률</p>
                                        <div className="w-full bg-white/10 rounded-full h-2 mt-2">
                                            <div className="bg-green-500 h-2 rounded-full" style={{ width: '99.2%' }}></div>
                                        </div>
                                    </div>
                                    <div className="text-center p-4 bg-white/5 rounded-lg">
                                        <div className="text-3xl font-black text-white mb-1">2.3초</div>
                                        <p className="text-sm text-gray-400">평균 응답 시간</p>
                                        <div className="w-full bg-white/10 rounded-full h-2 mt-2">
                                            <div className="bg-blue-500 h-2 rounded-full" style={{ width: '76%' }}></div>
                                        </div>
                                    </div>
                                    <div className="text-center p-4 bg-white/5 rounded-lg">
                                        <div className="text-3xl font-black text-white mb-1">50명</div>
                                        <p className="text-sm text-gray-400">최대 동시 사용자</p>
                                        <div className="w-full bg-white/10 rounded-full h-2 mt-2">
                                            <div className="bg-purple-500 h-2 rounded-full" style={{ width: '83%' }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Resource Usage */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <PieChart className="w-5 h-5 mr-2 text-yellow-400" />
                                        리소스 사용률
                                    </h3>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                                        <span className="text-white">CPU</span>
                                        <span className="text-blue-400">45%</span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                                        <span className="text-white">메모리</span>
                                        <span className="text-green-400">62%</span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                                        <span className="text-white">디스크</span>
                                        <span className="text-yellow-400">28%</span>
                                    </div>
                                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                                        <span className="text-white">네트워크</span>
                                        <span className="text-red-400">15%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="analytics" className="space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Document Statistics */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <MessageSquare className="w-5 h-5 mr-2 text-blue-400" />
                                        문서 유형별 통계
                                    </h3>
                                </div>
                                <div className="space-y-4">
                                    {documentStats.length > 0 ? (
                                        documentStats.map((doc, index) => (
                                            <div key={index} className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
                                                <div className="flex items-center space-x-3">
                                                    <Badge variant="outline" className="border-white/10 text-gray-300">{doc.type}</Badge>
                                                    <div>
                                                        <p className="text-sm font-medium text-white">{doc.count}개</p>
                                                        <p className="text-xs text-gray-400">{doc.size}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-medium text-white">{doc.indexed}개</p>
                                                    <p className="text-xs text-gray-400">인덱싱 완료</p>
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-8 text-gray-500">
                                            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                            <p>아직 문서 통계 데이터가 없습니다.</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Export Options */}
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-lg font-bold text-white flex items-center">
                                        <Download className="w-5 h-5 mr-2 text-blue-400" />
                                        데이터 내보내기
                                    </h3>
                                </div>
                                <div className="space-y-3">
                                    <Button
                                        variant="outline"
                                        className="w-full h-20 flex-col space-y-2 bg-white/5 border-white/10 text-white hover:bg-white/10"
                                        onClick={exportToCSV}
                                    >
                                        <Download className="w-6 h-6 text-blue-400" />
                                        <span className="font-bold">CSV 내보내기</span>
                                        <span className="text-xs text-gray-400">엑셀에서 분석</span>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="w-full h-20 flex-col space-y-2 bg-white/5 border-white/10 text-white hover:bg-white/10"
                                        onClick={exportToPDF}
                                    >
                                        <Download className="w-6 h-6 text-green-400" />
                                        <span className="font-bold">PDF 리포트</span>
                                        <span className="text-xs text-gray-400">공식 문서용</span>
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="w-full h-20 flex-col space-y-2 bg-white/5 border-white/10 text-white hover:bg-white/10"
                                        onClick={exportToJSON}
                                    >
                                        <Download className="w-6 h-6 text-purple-400" />
                                        <span className="font-bold">JSON 데이터</span>
                                        <span className="text-xs text-gray-400">개발자용</span>
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </TestStatsLayout>
    );
}













