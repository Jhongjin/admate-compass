"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Play, AlertTriangle, RotateCcw, XCircle, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import Link from "next/link";
import Image from "next/image";
import { BarChart3, Activity, Users, MessageSquare, Zap, PieChart } from "lucide-react";

// 테스트 페이지용 레이아웃 (gemini_pro_theme 스타일)
function TestQueuesLayout({ children, currentPage = "queues" }: { children: React.ReactNode; currentPage?: string }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const navigation = [
        { name: "대시보드", href: "/test/admin-theme", icon: BarChart3, current: currentPage === "dashboard" },
        { name: "문서 관리", href: "/admin/docs", icon: MessageSquare, current: currentPage === "docs" },
        { name: "처리 큐", href: "/test/admin-queues-theme", icon: Activity, current: currentPage === "queues" },
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
                                <span className="text-gray-300">Admin Queues (Test)</span>
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

type Job = {
    id: string;
    document_id: string;
    job_type: string;
    status: string;
    attempts: number;
    max_attempts: number;
    priority: number;
    scheduled_at: string | null;
    started_at: string | null;
    finished_at: string | null;
    result?: {
        url?: string;
        documentId?: string;
        title?: string;
        chunkCount?: number;
        subPageProgress?: {
            processed: number;
            total: number;
        };
        subPages?: Array<{
            url: string;
            title?: string;
            status?: 'pending' | 'processing' | 'completed' | 'failed';
            success?: boolean;
            chunkCount?: number;
            error?: string;
        }>;
    };
};

export default function AdminQueuesPage() {
    const supabase = createClient();
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(false);
    const [consuming, setConsuming] = useState(false);
    const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
    const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());

    const loadJobs = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('processing_jobs')
                .select('id, document_id, job_type, status, attempts, max_attempts, priority, scheduled_at, started_at, finished_at, result')
                .order('scheduled_at', { ascending: true })
                .limit(100);
            if (error) throw error;
            setJobs(data || []);
        } catch (err) {
            console.error('큐 조회 오류:', err);
        } finally {
            setLoading(false);
        }
    };

    const formatToSeoulTime = (dateString: string | null): string => {
        if (!dateString) return '-';
        try {
            const date = new Date(dateString);
            return date.toLocaleString('ko-KR', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
        } catch {
            return dateString;
        }
    };

    useEffect(() => {
        loadJobs();
        const t = setInterval(loadJobs, 10000);
        return () => clearInterval(t);
    }, []);

    const consumeOne = async () => {
        try {
            setConsuming(true);
            const res = await fetch('/api/jobs/consume', { method: 'POST' });
            await res.json();
            await loadJobs();
        } catch (err) {
            console.error('consume 호출 오류:', err);
        } finally {
            setConsuming(false);
        }
    };

    const postAction = async (jobId: string, action: 'retry' | 'cancel' | 'reprocess' | 'delete') => {
        try {
            if (action === 'delete') {
                if (!confirm('이 작업을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.')) {
                    return;
                }
            }

            const res = await fetch('/api/jobs/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId, action })
            });

            const result = await res.json();
            if (result.success) {
                if (action === 'delete') {
                    alert(result.message || '작업이 삭제되었습니다.');
                }
                await loadJobs();
                setSelectedJobs(new Set());
            } else {
                alert(result.error || '작업 실행에 실패했습니다.');
            }
        } catch (err) {
            console.error('job action 오류:', err);
            alert('작업 실행 중 오류가 발생했습니다.');
        }
    };

    const deleteSelectedJobs = async () => {
        if (selectedJobs.size === 0) {
            alert('삭제할 작업을 선택해주세요.');
            return;
        }

        const jobIds = Array.from(selectedJobs);
        const deletableJobs = jobs.filter(j =>
            jobIds.includes(j.id) &&
            ['queued', 'failed', 'cancelled', 'retrying'].includes(j.status)
        );

        if (deletableJobs.length === 0) {
            alert('삭제 가능한 작업이 없습니다. (대기, 실패, 취소, 재시도 중인 작업만 삭제 가능)');
            return;
        }

        if (!confirm(`${deletableJobs.length}개 작업을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
            return;
        }

        try {
            const res = await fetch('/api/jobs/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId: deletableJobs[0].id,
                    action: 'delete',
                    jobIds: deletableJobs.map(j => j.id)
                })
            });

            const result = await res.json();
            if (result.success) {
                alert(result.message || `${result.deleted}개 작업이 삭제되었습니다.`);
                await loadJobs();
                setSelectedJobs(new Set());
            } else {
                alert(result.error || '삭제에 실패했습니다.');
            }
        } catch (err) {
            console.error('일괄 삭제 오류:', err);
            alert('삭제 중 오류가 발생했습니다.');
        }
    };

    const toggleJobSelection = (jobId: string) => {
        const newSelected = new Set(selectedJobs);
        if (newSelected.has(jobId)) {
            newSelected.delete(jobId);
        } else {
            newSelected.add(jobId);
        }
        setSelectedJobs(newSelected);
    };

    const selectJobsByStatus = (status: string) => {
        const newSelected = new Set(selectedJobs);
        jobs.forEach(job => {
            if (job.status === status && ['queued', 'failed', 'cancelled', 'retrying'].includes(job.status)) {
                newSelected.add(job.id);
            }
        });
        setSelectedJobs(newSelected);
    };

    const statusVariant = ((s: string) => {
        switch (s) {
            case 'queued': return 'secondary';
            case 'processing': return 'outline';
            case 'retrying': return 'destructive';
            case 'completed': return 'default';
            case 'failed': return 'destructive';
            default: return 'secondary';
        }
    }) as any;

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'queued': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            case 'processing': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
            case 'retrying': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
            case 'completed': return 'bg-green-500/20 text-green-400 border-green-500/30';
            case 'failed': return 'bg-red-500/20 text-red-400 border-red-500/30';
            case 'cancelled': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
            default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
        }
    };

    return (
        <TestQueuesLayout currentPage="queues">
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                    <div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-2 sm:mb-3 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                            처리 큐 모니터링
                        </h1>
                        <p className="text-gray-400 text-sm sm:text-base">
                            문서 처리 작업의 상태를 모니터링하고 관리합니다.
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                        <Button
                            variant="outline"
                            onClick={loadJobs}
                            disabled={loading}
                            className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                        >
                            <RefreshCw className={`w-4 h-4 sm:mr-2 ${loading ? 'animate-spin' : ''}`} />
                            <span className="hidden sm:inline">새로고침</span>
                        </Button>
                        <Button
                            onClick={consumeOne}
                            disabled={consuming}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            <Play className="w-4 h-4 sm:mr-2" />
                            <span className="hidden sm:inline">1건 처리</span>
                        </Button>
                        {selectedJobs.size > 0 && (
                            <Button
                                variant="destructive"
                                onClick={deleteSelectedJobs}
                                className="bg-red-600 hover:bg-red-700 text-white"
                            >
                                <Trash2 className="w-4 h-4 sm:mr-2" />
                                <span className="hidden sm:inline">선택 삭제 ({selectedJobs.size})</span>
                            </Button>
                        )}
                    </div>
                </div>

                {/* 상태별 일괄 선택 */}
                <div className="flex gap-2 flex-wrap">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => selectJobsByStatus('queued')}
                        className="text-xs bg-[#131823] border-white/10 text-white hover:bg-white/5"
                    >
                        대기 작업 모두 선택
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => selectJobsByStatus('failed')}
                        className="text-xs bg-[#131823] border-white/10 text-white hover:bg-white/5"
                    >
                        실패 작업 모두 선택
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedJobs(new Set())}
                        className="text-xs bg-[#131823] border-white/10 text-white hover:bg-white/5"
                    >
                        선택 해제
                    </Button>
                </div>

                {/* Jobs Table */}
                <Card className="bg-[#131823] border border-white/5 rounded-3xl">
                    <CardHeader>
                        <CardTitle className="text-white">처리 작업 목록</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-white/5 hover:bg-transparent">
                                        <TableHead className="text-gray-300 w-12">
                                            <input
                                                type="checkbox"
                                                checked={selectedJobs.size > 0 && selectedJobs.size === jobs.filter(j => ['queued', 'failed', 'cancelled', 'retrying'].includes(j.status)).length}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        const deletableJobIds = jobs
                                                            .filter(j => ['queued', 'failed', 'cancelled', 'retrying'].includes(j.status))
                                                            .map(j => j.id);
                                                        setSelectedJobs(new Set(deletableJobIds));
                                                    } else {
                                                        setSelectedJobs(new Set());
                                                    }
                                                }}
                                                className="cursor-pointer"
                                            />
                                        </TableHead>
                                        <TableHead className="text-gray-300">ID</TableHead>
                                        <TableHead className="text-gray-300">문서</TableHead>
                                        <TableHead className="text-gray-300">타입</TableHead>
                                        <TableHead className="text-gray-300">상태</TableHead>
                                        <TableHead className="text-gray-300">우선순위</TableHead>
                                        <TableHead className="text-gray-300">시작</TableHead>
                                        <TableHead className="text-gray-300">진행 상황</TableHead>
                                        <TableHead className="text-gray-300">작업</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {jobs.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={9} className="text-gray-400 text-center py-8">
                                                <div className="flex flex-col items-center gap-2">
                                                    <AlertTriangle className="w-8 h-8 text-gray-500" />
                                                    <span>대기 중인 작업이 없습니다.</span>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : jobs.map(j => {
                                        const isDeletable = ['queued', 'failed', 'cancelled', 'retrying'].includes(j.status);
                                        const isSelected = selectedJobs.has(j.id);

                                        return (
                                            <TableRow key={j.id} className="border-white/5 hover:bg-white/5 transition-colors">
                                                <TableCell className="text-gray-300">
                                                    {isDeletable ? (
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleJobSelection(j.id)}
                                                            className="cursor-pointer"
                                                        />
                                                    ) : (
                                                        <span className="text-gray-500">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-gray-300 font-mono text-xs">{j.id.slice(0, 8)}…</TableCell>
                                                <TableCell className="text-gray-300 font-mono text-xs">{j.document_id}</TableCell>
                                                <TableCell className="text-gray-300 text-sm">{j.job_type}</TableCell>
                                                <TableCell className="text-gray-300">
                                                    <Badge
                                                        variant="outline"
                                                        className={getStatusColor(j.status)}
                                                    >
                                                        {j.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-gray-300">{j.priority}</TableCell>
                                                <TableCell className="text-gray-400 text-sm">{formatToSeoulTime(j.started_at)}</TableCell>
                                                <TableCell className="text-gray-400 text-sm">
                                                    {j.result?.subPageProgress ? (
                                                        <Collapsible
                                                            open={expandedJobs.has(j.id)}
                                                            onOpenChange={(open) => {
                                                                if (open) {
                                                                    setExpandedJobs(prev => new Set(prev).add(j.id));
                                                                } else {
                                                                    setExpandedJobs(prev => {
                                                                        const next = new Set(prev);
                                                                        next.delete(j.id);
                                                                        return next;
                                                                    });
                                                                }
                                                            }}
                                                        >
                                                            <CollapsibleTrigger className="flex items-center gap-1 text-xs hover:text-blue-400 transition-colors cursor-pointer">
                                                                {expandedJobs.has(j.id) ? (
                                                                    <ChevronDown className="w-3 h-3" />
                                                                ) : (
                                                                    <ChevronRight className="w-3 h-3" />
                                                                )}
                                                                <span>
                                                                    하위 페이지: {j.result.subPageProgress.processed}/{j.result.subPageProgress.total} ({Math.round((j.result.subPageProgress.processed / j.result.subPageProgress.total) * 100)}%)
                                                                </span>
                                                            </CollapsibleTrigger>
                                                            {j.job_type === 'CRAWL_SEED' && j.status === 'processing' && (
                                                                <div className="w-full bg-white/10 rounded-full h-1.5 mt-1">
                                                                    <div
                                                                        className="bg-blue-500 h-1.5 rounded-full transition-all"
                                                                        style={{ width: `${(j.result.subPageProgress.processed / j.result.subPageProgress.total) * 100}%` }}
                                                                    />
                                                                </div>
                                                            )}
                                                            <CollapsibleContent className="mt-2">
                                                                <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
                                                                    {j.result.subPages && j.result.subPages.length > 0 ? (
                                                                        j.result.subPages.map((subPage, idx) => {
                                                                            const status = subPage.status || (subPage.success ? 'completed' : 'failed');
                                                                            const statusColors = {
                                                                                pending: 'text-gray-400',
                                                                                processing: 'text-blue-400',
                                                                                completed: 'text-green-400',
                                                                                failed: 'text-red-400'
                                                                            };
                                                                            const statusLabels = {
                                                                                pending: '대기',
                                                                                processing: '처리 중',
                                                                                completed: '완료',
                                                                                failed: '실패'
                                                                            };
                                                                            return (
                                                                                <div key={idx} className="flex items-start gap-2 text-xs border-b border-white/5 pb-1">
                                                                                    <div className={`flex-1 min-w-0 ${statusColors[status]}`}>
                                                                                        <div className="font-medium truncate">{subPage.title || subPage.url}</div>
                                                                                        <div className="text-gray-500 text-[10px] truncate">{subPage.url}</div>
                                                                                        <div className="flex items-center gap-2 mt-0.5">
                                                                                            <span className={statusColors[status]}>{statusLabels[status]}</span>
                                                                                            {subPage.chunkCount !== undefined && (
                                                                                                <span className="text-gray-500">({subPage.chunkCount} 청크)</span>
                                                                                            )}
                                                                                            {subPage.error && (
                                                                                                <span className="text-red-400 text-[10px] truncate" title={subPage.error}>
                                                                                                    {subPage.error.substring(0, 30)}...
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })
                                                                    ) : (
                                                                        <div className="text-xs text-gray-500">하위 페이지 정보 없음</div>
                                                                    )}
                                                                </div>
                                                            </CollapsibleContent>
                                                        </Collapsible>
                                                    ) : j.status === 'processing' && j.job_type === 'CRAWL_SEED' ? (
                                                        <span className="text-xs text-gray-500">진행 중...</span>
                                                    ) : (
                                                        '-'
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-gray-400 text-sm">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        {j.status === 'queued' || j.status === 'retrying' ? (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => postAction(j.id, 'retry')}
                                                                className="bg-[#131823] border-white/10 text-white hover:bg-white/5 text-xs"
                                                            >
                                                                <RotateCcw className="w-3 h-3 mr-1" />
                                                                재시도
                                                            </Button>
                                                        ) : null}
                                                        {j.status === 'failed' ? (
                                                            <>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => postAction(j.id, 'reprocess')}
                                                                    className="bg-[#131823] border-white/10 text-white hover:bg-white/5 text-xs"
                                                                >
                                                                    <Play className="w-3 h-3 mr-1" />
                                                                    재처리
                                                                </Button>
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => postAction(j.id, 'delete')}
                                                                    className="bg-red-500/20 border-red-500/30 text-red-400 hover:bg-red-500/30 text-xs"
                                                                >
                                                                    <Trash2 className="w-3 h-3 mr-1" />
                                                                    삭제
                                                                </Button>
                                                            </>
                                                        ) : null}
                                                        {isDeletable && j.status !== 'failed' ? (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => postAction(j.id, 'delete')}
                                                                className="bg-red-500/20 border-red-500/30 text-red-400 hover:bg-red-500/30 text-xs"
                                                            >
                                                                <Trash2 className="w-3 h-3 mr-1" />
                                                                삭제
                                                            </Button>
                                                        ) : null}
                                                        {j.status === 'queued' ? (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => postAction(j.id, 'cancel')}
                                                                className="bg-[#131823] border-white/10 text-white hover:bg-white/5 text-xs"
                                                            >
                                                                <XCircle className="w-3 h-3 mr-1" />
                                                                취소
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </TestQueuesLayout>
    );
}




