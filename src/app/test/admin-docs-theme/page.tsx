"use client";

import { useState, useMemo } from "react";
import {
    FileText,
    Upload,
    Search,
    MoreVertical,
    Trash2,
    Download,
    Eye,
    RefreshCw,
    File,
    Globe,
    Loader2,
    LayoutGrid,
    List,
    BarChart3,
    MessageSquare,
    Activity,
    Users,
    PieChart,
    Zap,
    Menu
} from "lucide-react";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import NewDocumentUpload from "@/components/admin/NewDocumentUpload";
import HybridCrawlingManager from "@/components/admin/HybridCrawlingManager";
import GroupedDocumentList from "@/components/admin/GroupedDocumentList";
import Link from "next/link";
import Image from "next/image";

interface Document {
    id: string;
    title: string;
    type: string;
    status: string;
    file_size: number;
    created_at: string;
    updated_at?: string;
    chunk_count: number;
    source_vendor?: string;
    url?: string;
    metadata?: any;
}

const VENDORS = [
    { id: "all", name: "전체 벤더" },
    { id: "Meta", name: "Meta" },
    { id: "Naver", name: "Naver" },
    { id: "Kakao", name: "Kakao" },
    { id: "Google", name: "Google" },
    { id: "X", name: "X (Twitter)" },
];

function TestDocsLayout({ children, currentPage = "docs" }: { children: React.ReactNode; currentPage?: string }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const navigation = [
        { name: "대시보드", href: "/test/admin-theme", icon: BarChart3, current: currentPage === "dashboard" },
        { name: "문서 관리", href: "/test/admin-docs-theme", icon: MessageSquare, current: currentPage === "docs" },
        { name: "처리 큐", href: "/test/admin-queues-theme", icon: Activity, current: currentPage === "queues" },
        { name: "사용자 관리", href: "/test/admin-users-theme", icon: Users, current: currentPage === "users" },
        { name: "시스템 모니터링", href: "/test/admin-monitoring-theme", icon: Zap, current: currentPage === "monitoring" },
        { name: "통계 및 분석", href: "/test/admin-stats-theme", icon: PieChart, current: currentPage === "stats" },
        { name: "로그 및 감사", href: "/test/admin-logs-theme", icon: Activity, current: currentPage === "logs" },
        { name: "비용 모니터링", href: "/test/admin-cost-monitoring-theme", icon: BarChart3, current: currentPage === "cost" },
    ];

    return (
        <div className="min-h-screen bg-[#0B0F17] text-white font-sans selection:bg-blue-500/30">
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F17]/80 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-20">
                        <div className="flex items-center gap-8">
                            <Link href="/" className="flex items-center gap-2 group">
                                <div className="relative w-8 h-8">
                                    <Image
                                        src="/admate-logo.png"
                                        alt="AdMate"
                                        fill
                                        className="object-contain"
                                    />
                                </div>
                                <span className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">AdMate</span>
                            </Link>
                            <div className="hidden md:flex items-center text-sm text-gray-500">
                                <span className="px-2">/</span>
                                <span className="text-gray-300">문서 관리 (테스트)</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-full bg-white/5 border border-white/5">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-xs font-medium text-gray-300">시스템 정상 가동 중</span>
                            </div>
                            <Button variant="ghost" size="icon" className="md:hidden text-gray-400 hover:text-white" onClick={() => setSidebarOpen(!sidebarOpen)}>
                                <Menu className="w-5 h-5" />
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            <div className="pt-20 flex max-w-[1600px] mx-auto">
                {/* Sidebar (Desktop) */}
                <aside className="hidden md:block w-64 fixed h-[calc(100vh-5rem)] border-r border-white/5 bg-[#0B0F17]/50 backdrop-blur-sm">
                    <nav className="p-4 space-y-2">
                        {navigation.map((item) => (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                                    item.current
                                        ? "bg-blue-600/10 text-blue-400 border border-blue-500/20"
                                        : "text-gray-400 hover:bg-white/5 hover:text-white"
                                }`}
                            >
                                <item.icon className={`w-5 h-5 ${item.current ? "text-blue-400" : "text-gray-500"}`} />
                                {item.name}
                            </Link>
                        ))}
                    </nav>
                    <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/5">
                        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs font-bold">
                                AD
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white truncate">관리자</p>
                                <p className="text-xs text-gray-500 truncate">admin@admate.ai</p>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 md:pl-64 min-h-[calc(100vh-5rem)]">
                    <div className="p-6 lg:p-10 space-y-8">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}

export default function AdminDocsPage() {
    const [activeTab, setActiveTab] = useState("documents");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
    const [selectedVendor, setSelectedVendor] = useState<string>("all");
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
    const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['admin-documents', selectedStatus],
        queryFn: async () => {
            const params = new URLSearchParams();
            params.append('limit', '1000');
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
            if (deleteId && selectedDocs.has(deleteId)) {
                const newSelected = new Set(selectedDocs);
                newSelected.delete(deleteId);
                setSelectedDocs(newSelected);
            }
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

    const filteredDocs = useMemo(() => {
        return documents.filter((doc: Document) => {
            const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesVendor = selectedVendor === "all" || doc.source_vendor === selectedVendor;
            const matchesTab = activeTab === "documents" ? doc.type !== 'url' : doc.type === 'url';

            return matchesSearch && matchesVendor && matchesTab;
        });
    }, [documents, searchQuery, selectedVendor, activeTab]);

    const documentGroups = useMemo(() => {
        if (activeTab !== "crawling") return [];

        const groups: any[] = [];
        const domainMap = new Map<string, any>();

        filteredDocs.forEach((doc: Document) => {
            let domain = 'Unknown';
            try {
                if (doc.url) {
                    domain = new URL(doc.url).hostname;
                }
            } catch (e) { }

            const groupedDoc = {
                ...doc,
                url: doc.url || '',
                updated_at: doc.updated_at || doc.created_at,
                isMainUrl: false
            };

            if (!domainMap.has(domain)) {
                domainMap.set(domain, {
                    domain,
                    mainUrl: doc.url || '',
                    mainDocument: { ...groupedDoc, isMainUrl: true },
                    subPages: [],
                    totalChunks: doc.chunk_count || 0,
                    isExpanded: false,
                    selectedSubPages: []
                });
                groups.push(domainMap.get(domain));
            } else {
                const group = domainMap.get(domain);
                group.subPages.push({ ...groupedDoc, isMainUrl: false });
                group.totalChunks += (doc.chunk_count || 0);
            }
        });

        return groups.map((group, index) => ({
            ...group,
            isExpanded: expandedGroups.has(index)
        }));
    }, [filteredDocs, activeTab, expandedGroups]);

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

    const handleToggleGroupExpansion = (index: number) => {
        const newExpanded = new Set(expandedGroups);
        if (newExpanded.has(index)) {
            newExpanded.delete(index);
        } else {
            newExpanded.add(index);
        }
        setExpandedGroups(newExpanded);
    };

    const handleSelectDocument = (id: string | string[]) => {
        const newSelected = new Set(selectedDocs);
        const ids = Array.isArray(id) ? id : [id];
        
        // 모든 ID가 선택되어 있는지 확인
        const allSelected = ids.every(docId => newSelected.has(docId));
        
        if (allSelected) {
            // 모두 선택되어 있으면 모두 해제
            ids.forEach(docId => newSelected.delete(docId));
        } else {
            // 일부만 선택되어 있거나 모두 해제되어 있으면 모두 선택
            ids.forEach(docId => newSelected.add(docId));
        }
        
        setSelectedDocs(newSelected);
    };

    const handleSelectAll = () => {
        if (selectedDocs.size === filteredDocs.length) {
            setSelectedDocs(new Set());
        } else {
            setSelectedDocs(new Set(filteredDocs.map((d: Document) => d.id)));
        }
    };

    return (
        <TestDocsLayout currentPage="docs">
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white mb-2">문서 관리</h1>
                        <p className="text-gray-400">AI 학습에 사용되는 문서와 URL을 관리합니다.</p>
                    </div>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="bg-[#131823] border border-white/5 p-1 rounded-xl mb-6">
                        <TabsTrigger
                            value="documents"
                            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg px-6"
                        >
                            <FileText className="w-4 h-4 mr-2" />
                            문서 파일
                        </TabsTrigger>
                        <TabsTrigger
                            value="crawling"
                            className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400 rounded-lg px-6"
                        >
                            <Globe className="w-4 h-4 mr-2" />
                            URL 크롤링
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="documents" className="space-y-6">
                        <div className="grid grid-cols-1 gap-6">
                            <div className="bg-[#131823] border border-white/5 rounded-2xl p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-lg font-semibold text-white flex items-center">
                                        <Upload className="w-5 h-5 mr-2 text-blue-400" />
                                        새 문서 업로드
                                    </h2>
                                    <div className="flex items-center space-x-2">
                                        <span className="text-sm text-gray-400">벤더 선택:</span>
                                        <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                                            <SelectTrigger className="w-[180px] bg-[#0B0F17] border-white/10 text-white">
                                                <SelectValue placeholder="벤더 선택" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                                                {VENDORS.map((vendor) => (
                                                    <SelectItem key={vendor.id} value={vendor.id}>
                                                        {vendor.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <NewDocumentUpload
                                    onUpload={() => refetch()}
                                    vendor={selectedVendor === 'all' ? undefined : selectedVendor}
                                    hideList={true}
                                />
                            </div>
                        </div>

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
                                    size="icon"
                                    className={`border-white/10 ${viewMode === 'list' ? 'bg-blue-600/20 text-blue-400' : 'bg-[#0B0F17] text-gray-400'}`}
                                    onClick={() => setViewMode('list')}
                                >
                                    <List className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className={`border-white/10 ${viewMode === 'grid' ? 'bg-blue-600/20 text-blue-400' : 'bg-[#0B0F17] text-gray-400'}`}
                                    onClick={() => setViewMode('grid')}
                                >
                                    <LayoutGrid className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="bg-[#131823] border border-white/5 rounded-3xl overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-white/5 bg-white/[0.02]">
                                            <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">문서명</th>
                                            <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">벤더</th>
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
                                                <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                                                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                                    데이터를 불러오는 중...
                                                </td>
                                            </tr>
                                        ) : filteredDocs.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
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
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <Badge variant="secondary" className="bg-white/5 text-gray-300 border-white/10">
                                                            {doc.source_vendor || 'Unknown'}
                                                        </Badge>
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
                    </TabsContent>

                    <TabsContent value="crawling" className="space-y-6">
                        <HybridCrawlingManager onCrawlingComplete={() => refetch()} />

                        <div className="mt-8">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xl font-bold text-white">크롤링된 문서 목록</h2>
                                <Button variant="outline" onClick={() => refetch()} className="border-white/10 text-gray-400 hover:text-white">
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    새로고침
                                </Button>
                            </div>

                            <GroupedDocumentList
                                groups={documentGroups}
                                onToggleGroupExpansion={handleToggleGroupExpansion}
                                onToggleSubPageSelection={() => { }}
                                onToggleAllSubPages={() => { }}
                                onReindexDocument={() => { }}
                                onDownloadDocument={() => { }}
                                onDeleteDocument={(id) => setDeleteId(id)}
                                onSelectAll={handleSelectAll}
                                onSelectDocument={handleSelectDocument}
                                onBulkDelete={() => { }}
                                selectedDocuments={selectedDocs}
                                isAllSelected={selectedDocs.size > 0 && selectedDocs.size === filteredDocs.length}
                                actionLoading={{}}
                                deletingDocument={deleteId}
                            />
                        </div>
                    </TabsContent>
                </Tabs>
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
        </TestDocsLayout>
    );
}
