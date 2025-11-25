"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
    Search,
    Filter,
    AlertTriangle,
    Info,
    CheckCircle,
    Clock,
    RefreshCw,
    Loader2,
    ChevronLeft,
    ChevronRight
} from "lucide-react";
import ThemedAdminLayout from "@/components/layouts/ThemedAdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";

interface LogEntry {
    id: string;
    log_level: 'info' | 'warning' | 'error' | 'success';
    log_type: string;
    message: string;
    created_at: string;
    metadata?: any;
}

export default function LogsPage() {
    const [page, setPage] = useState(1);
    const [limit] = useState(50);
    const [logLevel, setLogLevel] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['admin-logs', page, logLevel],
        queryFn: async () => {
            const params = new URLSearchParams();
            params.append('limit', limit.toString());
            params.append('offset', ((page - 1) * limit).toString());
            if (logLevel !== 'all') params.append('level', logLevel);

            const res = await fetch(`/api/admin/logs/list?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch logs');
            return res.json();
        },
        // Add retry logic
        retry: 1
    });

    const logs = data?.data?.logs || [];
    const total = data?.data?.pagination?.total || 0;
    const totalPages = Math.ceil(total / limit);

    const filteredLogs = logs.filter((log: LogEntry) =>
        log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.log_type.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const getLevelIcon = (level: string) => {
        switch (level) {
            case 'error': return <AlertTriangle className="w-4 h-4 text-red-400" />;
            case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
            case 'success': return <CheckCircle className="w-4 h-4 text-green-400" />;
            default: return <Info className="w-4 h-4 text-blue-400" />;
        }
    };

    const getLevelColor = (level: string) => {
        switch (level) {
            case 'error': return "bg-red-500/10 text-red-400 border-red-500/20";
            case 'warning': return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
            case 'success': return "bg-green-500/10 text-green-400 border-green-500/20";
            default: return "bg-blue-500/10 text-blue-400 border-blue-500/20";
        }
    };

    return (
        <ThemedAdminLayout currentPage="logs">
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white mb-2">시스템 로그</h1>
                        <p className="text-gray-400">시스템 활동 및 잠재적인 문제를 모니터링합니다.</p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={() => refetch()}
                        className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                        새로고침
                    </Button>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-4 bg-[#131823] p-4 rounded-2xl border border-white/5">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <Input
                            placeholder="로그 검색..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 bg-[#0B0F17] border-white/10 text-white placeholder:text-gray-600 focus:border-blue-500/50"
                        />
                    </div>
                    <Select value={logLevel} onValueChange={setLogLevel}>
                        <SelectTrigger className="w-full sm:w-40 bg-[#0B0F17] border-white/10 text-white">
                            <SelectValue placeholder="로그 레벨" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                            <SelectItem value="all">모든 레벨</SelectItem>
                            <SelectItem value="info">정보</SelectItem>
                            <SelectItem value="warning">경고</SelectItem>
                            <SelectItem value="error">오류</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Logs List */}
                <div className="bg-[#131823] border border-white/5 rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-white/5 bg-white/[0.02]">
                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">레벨</th>
                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">유형</th>
                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">메시지</th>
                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">시간</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                            로그를 불러오는 중...
                                        </td>
                                    </tr>
                                ) : filteredLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                                            로그가 없습니다.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredLogs.map((log: LogEntry) => (
                                        <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <Badge variant="outline" className={`flex w-fit items-center gap-1 ${getLevelColor(log.log_level)}`}>
                                                    {getLevelIcon(log.log_level)}
                                                    <span className="capitalize">{log.log_level}</span>
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                                {log.log_type}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-300 max-w-md truncate" title={log.message}>
                                                {log.message}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                {new Date(log.created_at).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
                        <div className="text-sm text-gray-500">
                            전체 {total}개 중 {((page - 1) * limit) + 1} - {Math.min(page * limit, total)} 표시
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="bg-[#0B0F17] border-white/10 text-white hover:bg-white/5 disabled:opacity-50"
                            >
                                <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                                className="bg-[#0B0F17] border-white/10 text-white hover:bg-white/5 disabled:opacity-50"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </ThemedAdminLayout>
    );
}
