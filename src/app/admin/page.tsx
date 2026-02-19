"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import AdminThemeLayout from "@/components/layouts/AdminThemeLayout";
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
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
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
    FileSearch,
    DollarSign,
    MessageSquare,
    Star,
    Upload,
    Building2,
    Trash2,
    RotateCcw,
    TrendingDown
} from "lucide-react";
import Link from "next/link";
import { dashboardDataService, DashboardStats } from "@/lib/services/DashboardDataService";
import Statistics from "@/components/admin/Statistics";
import TeamStats from "@/components/admin/TeamStats";
import QueueSummaryPanel from "@/components/admin/QueueSummaryPanel";
import { fetchWithTimeout } from "@/lib/utils/fetchWithTimeout";


// --- Themed Statistics Component (gemini_pro_theme 스타일) ---
interface StatCardProps {
    title: string;
    value: string | number;
    change?: number;
    icon: React.ReactNode;
    description?: string;
}

function ThemedStatCard({ title, value, change, icon, description }: StatCardProps) {
    const isPositive = change && change > 0;

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

function ThemedStatistics({ stats }: { stats: any }) {
    const chartData = [
        { date: "월", questions: 45, users: 23 },
        { date: "화", questions: 52, users: 28 },
        { date: "수", questions: 38, users: 19 },
        { date: "목", questions: 61, users: 31 },
        { date: "금", questions: 49, users: 25 },
        { date: "토", questions: 23, users: 12 },
        { date: "일", questions: 18, users: 8 },
    ];

    const recentActivity = [
        { type: "Question", content: "광고 정책 변경 문의", time: "2분 전", user: "김마케팅" },
        { type: "Upload", content: "2024 4분기 가이드라인.pdf", time: "15분 전", user: "관리자" },
        { type: "Feedback", content: "응답 품질 요청", time: "1시간 전", user: "이성과" },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <ThemedStatCard
                    title="총 질문 수"
                    value={stats.totalQuestions.toLocaleString()}
                    change={stats.weeklyChange.questions}
                    icon={<MessageSquare className="w-5 h-5" />}
                    description="12% 증가"
                />
                <ThemedStatCard
                    title="활성 사용자"
                    value={stats.activeUsers}
                    change={stats.weeklyChange.users}
                    icon={<Users className="w-5 h-5" />}
                    description="3명 감소"
                />
                <ThemedStatCard
                    title="평균 응답 시간"
                    value={stats.avgResponseTime}
                    change={stats.weeklyChange.responseTime}
                    icon={<Clock className="w-5 h-5" />}
                    description="8% 개선됨"
                />
                <ThemedStatCard
                    title="만족도"
                    value={`${stats.satisfactionRate}%`}
                    change={stats.weeklyChange.satisfaction}
                    icon={<Star className="w-5 h-5" />}
                    description="2% 증가"
                />
            </div>

            {/* Weekly Chart */}
            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                <h3 className="text-lg font-bold text-white mb-6">주간 활동</h3>
                <div className="flex items-end justify-between h-48 gap-2">
                    {chartData.map((day, index) => (
                        <div key={index} className="flex-1 flex flex-col items-center gap-2">
                            <div className="w-full flex items-end justify-center gap-1 h-full">
                                <div className="w-3 bg-blue-500/50 rounded-t-sm" style={{ height: `${(day.questions / 70) * 100}%` }} />
                                <div className="w-3 bg-green-500/50 rounded-t-sm" style={{ height: `${(day.users / 35) * 100}%` }} />
                            </div>
                            <span className="text-xs text-gray-500">{day.date}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                <h3 className="text-lg font-bold text-white mb-4">최근 활동</h3>
                <div className="space-y-4">
                    {recentActivity.map((activity, index) => (
                        <div key={index} className="flex items-center gap-4 p-3 rounded-xl bg-white/5 border border-white/5">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${activity.type === "Question" ? "bg-blue-500/20 text-blue-400" :
                                activity.type === "Upload" ? "bg-purple-500/20 text-purple-400" :
                                    "bg-gray-500/20 text-gray-400"
                                }`}>
                                {activity.type === "Question" ? <MessageSquare className="w-4 h-4" /> :
                                    activity.type === "Upload" ? <Upload className="w-4 h-4" /> :
                                        <Activity className="w-4 h-4" />}
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium text-white">{activity.content}</p>
                                <p className="text-xs text-gray-500">{activity.user} • {activity.time}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// --- Themed TeamStats Component (gemini_pro_theme 스타일) ---
function ThemedTeamStats({ teamStats, teamQuestionStats }: { teamStats: any[], teamQuestionStats: any[] }) {
    const combinedStats = teamStats.map(teamStat => {
        const questionStat = teamQuestionStats.find(q => q.team === teamStat.team);
        return {
            ...teamStat,
            question_count: questionStat?.question_count || 0,
            questions_30d: questionStat?.questions_30d || 0,
            questions_7d: questionStat?.questions_7d || 0,
            avg_response_time: questionStat?.avg_response_time || null
        };
    });

    const totalUsers = teamStats.reduce((sum, team) => sum + team.user_count, 0);
    const totalQuestions = teamQuestionStats.reduce((sum, team) => sum + team.question_count, 0);

    return (
        <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-400" />
                부서별 사용량
            </h3>
            <div className="space-y-4">
                {combinedStats.map((team) => {
                    const userPercentage = totalUsers > 0 ? (team.user_count / totalUsers) * 100 : 0;
                    const questionPercentage = totalQuestions > 0 ? (team.question_count / totalQuestions) * 100 : 0;

                    return (
                        <div key={team.team} className="p-4 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-all">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
                                        {team.team}
                                    </Badge>
                                    <span className="text-sm font-medium text-white">{team.user_count}명</span>
                                </div>
                                <div className="text-right">
                                    <div className="text-sm font-bold text-white">{team.question_count}건</div>
                                    <div className="text-xs text-gray-500">{Math.round(questionPercentage)}%</div>
                                </div>
                            </div>

                            <div className="space-y-2 mb-3">
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>사용자 점유율</span>
                                    <span>{Math.round(userPercentage)}%</span>
                                </div>
                                <Progress value={userPercentage} className="h-1.5 bg-white/10" />
                            </div>

                            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5">
                                <div className="text-center">
                                    <div className="text-xs text-gray-500">신규 (7일)</div>
                                    <div className="text-sm font-bold text-green-400">{team.new_users_7d}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-xs text-gray-500">신규 (30일)</div>
                                    <div className="text-sm font-bold text-blue-400">{team.new_users_30d}</div>
                                </div>
                                <div className="text-center">
                                    <div className="text-xs text-gray-500">질문 (7일)</div>
                                    <div className="text-sm font-bold text-purple-400">{team.questions_7d}</div>
                                </div>
                            </div>
                        </div>
                    );
                })}
                {combinedStats.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                        <Building2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p>부서 데이터가 없습니다.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

// --- Themed QueueSummaryPanel Component (gemini_pro_theme 스타일) ---
interface QueueStats {
    queued: number;
    processing: number;
    failed: number;
    stuck?: number;
}

function ThemedQueueSummaryPanel({ selectedVendors = [] }: { selectedVendors?: string[] }) {
    const supabase = createClient();
    const { data: stats, refetch, isLoading } = useQuery<QueueStats>({
        queryKey: ['queue-stats', selectedVendors],
        queryFn: async () => {
            
            try {
                let query = supabase.from('processing_jobs').select('status', { count: 'exact', head: true });
                
                if (selectedVendors.length > 0) {
                    const { data: allJobs } = await supabase.from('processing_jobs').select('status, payload');
                    const filteredJobs = (allJobs || []).filter((job: any) => {
                        const vendor = job.payload?.vendor;
                        return !vendor || selectedVendors.includes(vendor);
                    });
                    const now = Date.now();
                    const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
                    return {
                        queued: filteredJobs.filter((j: any) => ['queued', 'retrying'].includes(j.status)).length,
                        processing: filteredJobs.filter((j: any) => j.status === 'processing').length,
                        failed: filteredJobs.filter((j: any) => j.status === 'failed').length,
                        stuck: filteredJobs.filter((j: any) => j.status === 'processing' && j.payload?.started_at && (now - new Date(j.payload.started_at).getTime()) > STUCK_THRESHOLD_MS).length,
                    };
                }

                const { data: queuedData } = await query.in('status', ['queued', 'retrying']);
                const { data: processingData } = await supabase.from('processing_jobs').select('status', { count: 'exact', head: true }).eq('status', 'processing');
                const { data: failedData } = await supabase.from('processing_jobs').select('status', { count: 'exact', head: true }).eq('status', 'failed');

                const now = Date.now();
                const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
                const { data: processingJobsWithTime } = await supabase.from('processing_jobs').select('id, started_at').eq('status', 'processing').not('started_at', 'is', null);
                const stuckCount = (processingJobsWithTime || []).filter((job: any) => {
                    if (!job.started_at) return false;
                    const elapsed = now - new Date(job.started_at).getTime();
                    return elapsed > STUCK_THRESHOLD_MS;
                }).length;

                return {
                    queued: queuedData?.length || 0,
                    processing: processingData?.length || 0,
                    failed: failedData?.length || 0,
                    stuck: stuckCount,
                };
            } catch (e) {
                console.error(e);
                return { queued: 0, processing: 0, failed: 0, stuck: 0 };
            }
        },
        refetchInterval: 5000,
    });

    const [processing, setProcessing] = useState(false);
    const queueStats = stats || { queued: 0, processing: 0, failed: 0, stuck: 0 };

    const handleProcessImmediately = async () => {
        setProcessing(true);
        try {
            await fetchWithTimeout('/api/jobs/consume', { method: 'POST' });
            await refetch();
        } catch (e) {
            console.error(e);
        } finally {
            setProcessing(false);
        }
    };

    return (
        <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 text-blue-400" />
                    처리 대기열
                </h3>
                <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading || processing} className="text-gray-400 hover:text-white">
                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20">
                    <div className="text-2xl font-bold text-white mb-1">{queueStats.queued}</div>
                    <div className="text-xs font-bold text-blue-400 uppercase">대기 중</div>
                </div>
                <div className="p-4 bg-purple-500/10 rounded-2xl border border-purple-500/20">
                    <div className="text-2xl font-bold text-white mb-1">{queueStats.processing}</div>
                    <div className="text-xs font-bold text-purple-400 uppercase">처리 중</div>
                </div>
                <div className="p-4 bg-red-500/10 rounded-2xl border border-red-500/20">
                    <div className="text-2xl font-bold text-white mb-1">{queueStats.failed}</div>
                    <div className="text-xs font-bold text-red-400 uppercase">실패</div>
                </div>
            </div>

            <Button
                onClick={handleProcessImmediately}
                disabled={processing || queueStats.queued === 0}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold h-12 rounded-xl"
            >
                {processing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                즉시 처리 시작
            </Button>
        </div>
    );
}

export default function TestAdminThemePage() {
    const { user, loading } = useAuth();
    const { toast } = useToast();

    // State management (원본 admin의 모든 상태 유지)
    const [showAdvancedMetrics, setShowAdvancedMetrics] = useState(false);
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [documentToDelete, setDocumentToDelete] = useState<{ id: string; title: string } | null>(null);

    // 데이터 로드 함수 (원본 백엔드 그대로 사용)
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
        }, 30000);

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
        },
        apiUsage: {
            claude: { totalRequests: 0, totalTokens: 0, totalCost: 0 },
            gpt: { totalRequests: 0, totalTokens: 0, totalCost: 0 },
            total: { totalRequests: 0, totalTokens: 0, totalCost: 0 }
        }
    };

    const systemStatus = useMemo(() => stats.systemStatus, [stats.systemStatus]);

    // 원본 admin의 모든 빠른 작업 메뉴 포함
    const quickActions = useMemo(() => [
        {
            title: "문서 관리",
            description: "문서 업로드 및 URL 크롤링 관리",
            href: "/admin/docs",
            icon: <FileText className="w-6 h-6" />,
            color: "text-blue-400",
            bg: "bg-blue-400/10",
            stats: `${stats.totalDocuments}개 문서`,
            trend: "+0%"
        },
        {
            title: "처리 큐 모니터링",
            description: "processing_jobs 상태 확인 및 수동 처리",
            href: "/admin/queues",
            icon: <Activity className="w-6 h-6" />,
            color: "text-teal-400",
            bg: "bg-teal-400/10",
            stats: "큐 상태 보기",
            trend: "+0%"
        },
        {
            title: "사용자 관리",
            description: "사용자 권한 및 접근 설정 관리",
            href: "/admin/users",
            icon: <Users className="w-6 h-6" />,
            color: "text-green-400",
            bg: "bg-green-400/10",
            stats: `${stats.weeklyStats?.users || 0}명 활성`,
            trend: "+0%"
        },
        {
            title: "시스템 모니터링",
            description: "실시간 시스템 상태 및 성능 확인",
            href: "/admin/monitoring",
            icon: <TrendingUp className="w-6 h-6" />,
            color: "text-purple-400",
            bg: "bg-purple-400/10",
            stats: `${stats.completedDocuments}/${stats.totalDocuments} 완료`,
            trend: "+0%"
        },
        {
            title: "통계 및 분석",
            description: "질문 통계, 사용자 활동 및 성능 분석",
            href: "/admin/stats",
            icon: <PieChart className="w-6 h-6" />,
            color: "text-orange-400",
            bg: "bg-orange-400/10",
            stats: `${stats.weeklyStats?.questions || 0}개 질문`,
            trend: "+0%"
        },
        {
            title: "로그 및 감사",
            description: "시스템 로그, 활동 기록 및 감사 추적",
            href: "/admin/logs",
            icon: <FileSearch className="w-6 h-6" />,
            color: "text-indigo-400",
            bg: "bg-indigo-400/10",
            stats: "로그 조회",
            trend: "+0%"
        },
        {
            title: "비용 모니터링",
            description: "Supabase 및 Vercel 사용량 추적 및 예산 관리",
            href: "/admin/cost-monitoring",
            icon: <DollarSign className="w-6 h-6" />,
            color: "text-emerald-400",
            bg: "bg-emerald-400/10",
            stats: "비용 확인",
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
                return <CheckCircle className="w-5 h-5 text-green-400" />;
            case "warning":
                return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
            case "error":
                return <AlertTriangle className="w-5 h-5 text-red-400" />;
            default:
                return <Clock className="w-5 h-5 text-gray-500" />;
        }
    }, []);

    const getStatusText = (status: string) => {
        switch (status) {
            case "healthy": return "정상";
            case "connected": return "연결됨";
            case "operational": return "작동 중";
            case "indexed": return "인덱싱됨";
            case "warning": return "주의";
            case "error": return "오류";
            default: return status;
        }
    };

    // 로딩 상태
    if (isLoading && !dashboardStats) {
        return (
            <AdminThemeLayout currentPage="dashboard">
                <div className="space-y-4 sm:space-y-6 p-4 sm:p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <Skeleton className="h-4 w-20 mb-2 bg-white/10" />
                                <Skeleton className="h-8 w-16 mb-2 bg-white/10" />
                                <Skeleton className="h-3 w-12 bg-white/10" />
                            </div>
                        ))}
                    </div>
                    <div className="text-center text-gray-400 text-sm" aria-live="polite">
                        데이터를 불러오는 중...
                    </div>
                </div>
            </AdminThemeLayout>
        );
    }

    // 에러 상태
    if (error) {
        return (
            <AdminThemeLayout currentPage="dashboard">
                <div className="p-4 sm:p-6">
                    <Alert className="bg-red-900/20 border-red-500/30 text-red-100">
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
            </AdminThemeLayout>
        );
    }

    // 로딩 중이거나 로그인하지 않은 경우
    if (loading) {
        return (
            <AdminThemeLayout currentPage="dashboard">
                <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                        <p className="text-gray-400">로그인 상태를 확인하는 중...</p>
                    </div>
                </div>
            </AdminThemeLayout>
        );
    }

    if (!user) {
        return (
            <AdminThemeLayout currentPage="dashboard">
                <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
                    <div className="text-center">
                        <div className="bg-red-900/20 border border-red-500/30 text-red-100 px-4 py-3 rounded mb-4">
                            <p className="font-bold">관리자 권한이 필요합니다</p>
                            <p className="text-sm">관리자 페이지에 접근하려면 먼저 로그인해주세요.</p>
                        </div>
                        <p className="text-gray-400">잠시 후 메인 페이지로 이동합니다...</p>
                    </div>
                </div>
            </AdminThemeLayout>
        );
    }

    return (
        <AdminThemeLayout currentPage="dashboard">
            {/* System Alerts */}
            <motion.div
                className="mb-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <Alert className="bg-blue-500/10 border-blue-500/30 text-blue-100">
                    <Info className="h-4 w-4 text-blue-300" />
                    <AlertTitle className="text-blue-200 font-semibold">✅ 시스템 상태</AlertTitle>
                    <AlertDescription className="text-blue-100">
                        모든 시스템이 정상적으로 작동 중입니다. 마지막 업데이트: {systemStatus.lastUpdate}
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
                            className="text-3xl md:text-4xl font-bold text-white mb-2"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.6, delay: 0.1 }}
                        >
                            대시보드 개요
                        </motion.h1>
                        <motion.p
                            className="text-gray-400 text-sm sm:text-base md:text-lg"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.6, delay: 0.2 }}
                        >
                            시스템 성능을 모니터링하고 리소스를 실시간으로 관리합니다.
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
                            className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white disabled:opacity-50 w-full sm:w-auto"
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
                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
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
                </div>
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
                {[
                    { title: "전체 상태", status: systemStatus.overall, icon: Shield, color: "text-green-400", bg: "bg-green-400/10" },
                    { title: "데이터베이스", status: systemStatus.database, icon: Database, color: "text-blue-400", bg: "bg-blue-400/10" },
                    { title: "LLM 서비스", status: systemStatus.llm, icon: Zap, color: "text-purple-400", bg: "bg-purple-400/10" },
                    { title: "벡터 저장소", status: systemStatus.vectorStore, icon: Server, color: "text-orange-400", bg: "bg-orange-400/10" }
                ].map((item, index) => (
                    <motion.div
                        key={index}
                        whileHover={{ scale: 1.02, y: -2 }}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: index * 0.1 }}
                    >
                        <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                            <div className="flex justify-between items-start mb-4">
                                <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center`}>
                                    <item.icon className={`w-5 h-5 ${item.color}`} />
                                </div>
                                {getStatusIcon(item.status)}
                            </div>
                            <h3 className="text-gray-400 text-sm font-medium mb-1">{item.title}</h3>
                            <p className="text-xl font-bold text-white capitalize">{getStatusText(item.status)}</p>
                        </div>
                    </motion.div>
                ))}
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

                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 overflow-x-auto">
                        <div className="min-w-full">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-white/5">
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
                                            <TableRow key={index} className="border-white/5">
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
                    </div>
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
                                            <div className="h-full bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300 group relative overflow-hidden cursor-pointer">
                                                <div className={`absolute top-0 right-0 w-32 h-32 ${action.bg} rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 opacity-0 group-hover:opacity-50 transition-opacity duration-500`} />
                                                <div className="relative z-10">
                                                    <div className={`w-12 h-12 rounded-2xl ${action.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                                                        <div className={action.color}>{action.icon}</div>
                                                    </div>
                                                    <h3 className="text-lg font-bold text-white mb-2">{action.title}</h3>
                                                    <p className="text-sm text-gray-400 mb-4 line-clamp-2">{action.description}</p>
                                                    <div className="flex items-center justify-between pt-4 border-t border-white/5">
                                                        <span className="text-xs font-medium text-gray-500">{action.stats}</span>
                                                        <ArrowRight className={`w-4 h-4 ${action.color} transform group-hover:translate-x-1 transition-transform`} />
                                                    </div>
                                                </div>
                                            </div>
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
                <ThemedStatistics stats={{
                    totalQuestions: stats.weeklyStats.questions,
                    activeUsers: stats.weeklyStats.users,
                    avgResponseTime: stats.performanceMetrics?.find((m: any) => m.metric === '평균 응답 시간')?.value || "0.8s",
                    satisfactionRate: stats.weeklyStats.satisfaction,
                    weeklyChange: {
                        questions: 12,
                        users: -3,
                        responseTime: 8,
                        satisfaction: 2
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
                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:shadow-2xl transition-all duration-300">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-blue-400" />
                        시스템 정보
                    </h3>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400 font-semibold">마지막 업데이트:</span>
                            <span className="text-sm font-bold text-white">{systemStatus.lastUpdate}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400 font-semibold">시스템 버전:</span>
                            <span className="text-sm font-bold text-white">v1.0.0</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400 font-semibold">데이터베이스 크기:</span>
                            <span className="text-sm font-bold text-white">계산 중</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400 font-semibold">인덱싱된 문서:</span>
                            <span className="text-sm font-bold text-white">{stats.completedDocuments || 0}개</span>
                        </div>
                    </div>
                </div>

                <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:shadow-2xl transition-all duration-300">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-green-400" />
                        성능 지표
                    </h3>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400 font-semibold">평균 응답 시간:</span>
                            <span className="text-sm font-bold text-white">
                                {stats.performanceMetrics?.find((m: any) => m.metric === '평균 응답 시간')?.value || '데이터 없음'}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400 font-semibold">동시 사용자:</span>
                            <span className="text-sm font-bold text-white">{stats.weeklyStats?.users || 0}명</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400 font-semibold">CPU 사용률:</span>
                            <span className="text-sm font-bold text-white">N/A</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-400 font-semibold">메모리 사용률:</span>
                            <span className="text-sm font-bold text-white">N/A</span>
                        </div>
                    </div>
                </div>
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
                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                        <div className="flex items-center gap-2 mb-6">
                            <Activity className="w-5 h-5 text-blue-400" />
                            <h3 className="text-lg font-bold text-white">API 사용량 (최근 30일)</h3>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-4">
                                <div className="text-sm text-gray-400 mb-2">Claude API</div>
                                <div className="text-2xl font-bold text-white mb-1">
                                    {stats.apiUsage.claude.totalRequests.toLocaleString()} 요청
                                </div>
                                <div className="text-xs text-gray-500 mb-2">
                                    {stats.apiUsage.claude.totalTokens.toLocaleString()} 토큰
                                </div>
                                <div className="text-sm font-medium text-purple-400">
                                    ${stats.apiUsage.claude.totalCost.toFixed(2)}
                                </div>
                            </div>
                            <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4">
                                <div className="text-sm text-gray-400 mb-2">GPT API</div>
                                <div className="text-2xl font-bold text-white mb-1">
                                    {stats.apiUsage.gpt.totalRequests.toLocaleString()} 요청
                                </div>
                                <div className="text-xs text-gray-500 mb-2">
                                    {stats.apiUsage.gpt.totalTokens.toLocaleString()} 토큰
                                </div>
                                <div className="text-sm font-medium text-green-400">
                                    ${stats.apiUsage.gpt.totalCost.toFixed(2)}
                                </div>
                            </div>
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4">
                                <div className="text-sm text-gray-400 mb-2">전체</div>
                                <div className="text-2xl font-bold text-white mb-1">
                                    {stats.apiUsage.total.totalRequests.toLocaleString()} 요청
                                </div>
                                <div className="text-xs text-gray-500 mb-2">
                                    {stats.apiUsage.total.totalTokens.toLocaleString()} 토큰
                                </div>
                                <div className="text-sm font-medium text-blue-400">
                                    ${stats.apiUsage.total.totalCost.toFixed(2)}
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* Team Statistics */}
            <motion.div
                className="mb-10 mt-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
            >
                <ThemedTeamStats
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
                <ThemedQueueSummaryPanel selectedVendors={[]} />
            </motion.div>

            {/* 문서 삭제 확인 다이얼로그 */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent className="bg-[#131823] border-white/5 text-white">
                    <DialogHeader>
                        <DialogTitle>문서 삭제 확인</DialogTitle>
                        <DialogDescription className="text-gray-400">
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
                            className="border-white/10 bg-white/5 text-white hover:bg-white/10"
                        >
                            취소
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={async () => {
                                if (!documentToDelete) return;

                                try {
                                    const response = await fetchWithTimeout(`/api/admin/upload?documentId=${documentToDelete.id}`, {
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
        </AdminThemeLayout>
    );
}

