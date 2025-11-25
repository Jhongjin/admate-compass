"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    FileText,
    Upload,
    Search,
    Filter,
    MoreVertical,
    Trash2,
    Download,
    Eye,
    RefreshCw,
    File,
    FileCode,
    Globe,
    CheckCircle2,
    AlertCircle,
    Clock,
    Loader2
} from "lucide-react";
import ThemedAdminLayout from "@/components/layouts/ThemedAdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface Document {
    id: string;
    title: string;
    type: string;
    status: string;
    file_size: number;
    created_at: string;
    chunk_count: number;
    source_vendor?: string;
}

export default function DocumentsPage() {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data, isLoading } = useQuery({
        queryKey: ['admin-documents', selectedStatus],
        queryFn: async () => {
            const params = new URLSearchParams();
            params.append('limit', '100');
            if (selectedStatus) params.append('status', selectedStatus);

            const res = await fetch(`/api/admin/upload-new?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch documents');
            return res.json();
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/admin/upload-new?documentId=${id}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error('Failed to delete document');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-documents'] });
            toast({
                title: "문서 삭제 완료",
                description: "문서가 성공적으로 삭제되었습니다.",
            });
            setDeleteId(null);
        },
        onError: (error) => {
            toast({
                title: "삭제 실패",
                description: error.message,
                variant: "destructive",
            });
        }
    });

    const documents = data?.data?.documents || [];
    const filteredDocs = documents.filter((doc: Document) =>
        doc.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const formatSize = (bytes: number) => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed':
            case 'indexed':
                return "bg-green-500/10 text-green-400 border-green-500/20";
            case 'processing':
                return "bg-blue-500/10 text-blue-400 border-blue-500/20";
            case 'failed':
                return "bg-red-500/10 text-red-400 border-red-500/20";
            default:
                return "bg-gray-500/10 text-gray-400 border-gray-500/20";
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'completed': return "완료됨";
            case 'indexed': return "인덱싱됨";
            case 'processing': return "처리중";
            case 'failed': return "실패";
            default: return status;
        }
    };

    const getFileIcon = (type: string) => {
        if (type === 'pdf') return <FileText className="w-4 h-4 text-red-400" />;
        if (type === 'docx') return <FileText className="w-4 h-4 text-blue-400" />;
        if (type === 'txt') return <FileText className="w-4 h-4 text-gray-400" />;
        if (type === 'url') return <Globe className="w-4 h-4 text-green-400" />;
        return <File className="w-4 h-4 text-gray-400" />;
    };

    return (
        <ThemedAdminLayout currentPage="docs">
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white mb-2">문서 관리</h1>
                        <p className="text-gray-400">AI 학습에 사용되는 문서를 관리합니다.</p>
                    </div>
                    <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                        <Upload className="w-4 h-4 mr-2" />
                        문서 업로드
                    </Button>
                </div>

                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-4 bg-[#131823] p-4 rounded-2xl border border-white/5">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <Input
                            placeholder="문서 검색..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 bg-[#0B0F17] border-white/10 text-white placeholder:text-gray-600 focus:border-blue-500/50"
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            className={`border-white/10 ${!selectedStatus ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' : 'bg-[#0B0F17] text-gray-400 hover:text-white'}`}
                            onClick={() => setSelectedStatus(null)}
                        >
                            전체
                        </Button>
                        <Button
                            variant="outline"
                            className={`border-white/10 ${selectedStatus === 'completed' ? 'bg-green-600/20 text-green-400 border-green-500/30' : 'bg-[#0B0F17] text-gray-400 hover:text-white'}`}
                            onClick={() => setSelectedStatus('completed')}
                        >
                            완료됨
                        </Button>
                        <Button
                            variant="outline"
                            className={`border-white/10 ${selectedStatus === 'processing' ? 'bg-blue-600/20 text-blue-400 border-blue-500/30' : 'bg-[#0B0F17] text-gray-400 hover:text-white'}`}
                            onClick={() => setSelectedStatus('processing')}
                        >
                            처리중
                        </Button>
                    </div>
                </div>

                {/* Document List */}
                <div className="bg-[#131823] border border-white/5 rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-white/5 bg-white/[0.02]">
                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">문서명</th>
                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">상태</th>
                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">크기</th>
                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">청크</th>
                                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">등록일</th>
                                    <th className="px-6 py-4 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">관리</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {isLoading ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                            데이터를 불러오는 중...
                                        </td>
                                    </tr>
                                ) : filteredDocs.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                            등록된 문서가 없습니다.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredDocs.map((doc: Document) => (
                                        <tr key={doc.id} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    <div className="p-2 rounded-lg bg-white/5 mr-3">
                                                        {getFileIcon(doc.type)}
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-medium text-white">{doc.title}</div>
                                                        <div className="text-xs text-gray-500">{doc.source_vendor || 'Unknown Source'}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <Badge variant="outline" className={getStatusColor(doc.status)}>
                                                    {getStatusText(doc.status)}
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                                                {formatSize(doc.file_size)}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                                                {doc.chunk_count}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                                                {new Date(doc.created_at).toLocaleDateString()}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
                                                            <MoreVertical className="w-4 h-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="bg-[#1A1F2C] border-white/10 text-white">
                                                        <DropdownMenuItem className="hover:bg-white/5 cursor-pointer">
                                                            <Eye className="w-4 h-4 mr-2" />
                                                            상세 보기
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem className="hover:bg-white/5 cursor-pointer">
                                                            <Download className="w-4 h-4 mr-2" />
                                                            다운로드
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            className="text-red-400 hover:bg-red-500/10 cursor-pointer"
                                                            onClick={() => setDeleteId(doc.id)}
                                                        >
                                                            <Trash2 className="w-4 h-4 mr-2" />
                                                            삭제
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent className="bg-[#1A1F2C] border-white/10 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle>문서를 삭제하시겠습니까?</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            이 작업은 되돌릴 수 없습니다. 문서와 관련된 모든 데이터(청크, 임베딩)가 영구적으로 삭제됩니다.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-transparent border-white/10 text-white hover:bg-white/5 hover:text-white">취소</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? "삭제 중..." : "삭제"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ThemedAdminLayout>
    );
}
