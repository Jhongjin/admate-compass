"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
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
    Loader2,
    LayoutGrid,
    List
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

export default function DocumentsPage() {
    const [activeTab, setActiveTab] = useState("documents");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
    const [selectedVendor, setSelectedVendor] = useState<string>("all");
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    // GroupedDocumentList states
    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
    const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
    const [actionLoading, setActionLoading] = useState<{ [key: string]: boolean }>({});
    
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['admin-documents', selectedStatus],
        queryFn: async () => {
            const params = new URLSearchParams();
            params.append('limit', '1000'); // Fetch more to handle client-side filtering/grouping effectively
            if (selectedStatus) params.append('status', selectedStatus);

            const res = await fetch(`/api/admin/upload-new?${params.toString()}`);
            if (!res.ok) throw new Error('Failed to fetch documents');
            return res.json();
        },
        // 크롤링 상태를 실시간으로 반영하기 위해 3초마다 자동 새로고침
        refetchInterval: 3000,
        // 백그라운드에서도 새로고침 (탭이 활성화되어 있을 때)
        refetchIntervalInBackground: false
    });

    // 재인덱싱 mutation
    const reindexMutation = useMutation({
        mutationFn: async ({ documentId, title }: { documentId: string; title: string }) => {
            console.log('🔄 [reindexMutation] mutationFn 시작:', { documentId, title });
            const loadingKey = `${documentId}_reindex`;
            console.log('🔄 [reindexMutation] loadingKey 설정:', loadingKey);
            setActionLoading(prev => {
                const newState = { ...prev, [loadingKey]: true };
                console.log('🔄 [reindexMutation] actionLoading 업데이트:', newState);
                return newState;
            });
            
            try {
                console.log('🔄 [reindexMutation] API 호출 시작:', { documentId, title });
                
                const res = await fetch(`/api/admin/upload/${documentId}/reindex`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });
                
                console.log('📡 재인덱싱 응답 상태:', res.status, res.statusText);
                
                if (!res.ok) {
                    let errorMessage = '재인덱싱에 실패했습니다.';
                    try {
                        const errorData = await res.json();
                        errorMessage = errorData.error || errorData.message || errorMessage;
                        console.error('❌ 재인덱싱 오류 응답:', errorData);
                    } catch (parseError) {
                        const errorText = await res.text().catch(() => '알 수 없는 오류');
                        console.error('❌ 재인덱싱 오류 (JSON 파싱 실패):', errorText);
                        errorMessage = `서버 오류 (${res.status}): ${errorText.substring(0, 200)}`;
                    }
                    throw new Error(errorMessage);
                }
                
                const result = await res.json();
                console.log('✅ 재인덱싱 성공:', result);
                return result;
            } catch (error) {
                console.error('❌ 재인덱싱 요청 실패:', error);
                throw error;
            } finally {
                setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
            }
        },
        onSuccess: (data, variables) => {
            // 모든 admin-documents 쿼리 무효화 (selectedStatus 포함)
            queryClient.invalidateQueries({ 
                queryKey: ['admin-documents'],
                exact: false // 부분 매칭으로 모든 admin-documents 쿼리 무효화
            });
            // 명시적으로 refetch 호출
            refetch();
            toast({
                title: "재인덱싱 완료",
                description: `${variables.title} 문서의 재인덱싱이 완료되었습니다. (${data.document?.chunkCount || 0}개 청크)`,
            });
        },
        onError: (error, variables) => {
            toast({
                title: "재인덱싱 실패",
                description: error.message || '재인덱싱 중 오류가 발생했습니다.',
                variant: "destructive",
            });
        }
    });

    const handleReindexDocument = (id: string, title: string) => {
        console.log('🔄 [handleReindexDocument] 호출됨:', { id, title });
        
        if (!id || !title) {
            console.error('❌ [handleReindexDocument] 잘못된 파라미터:', { id, title });
            toast({
                title: "재인덱싱 실패",
                description: '문서 ID 또는 제목이 없습니다.',
                variant: "destructive",
            });
            return;
        }
        
        if (!reindexMutation) {
            console.error('❌ [handleReindexDocument] reindexMutation이 없음');
            toast({
                title: "재인덱싱 실패",
                description: '재인덱싱 기능이 초기화되지 않았습니다. 페이지를 새로고침해주세요.',
                variant: "destructive",
            });
            return;
        }
        
        if (!reindexMutation.mutate) {
            console.error('❌ [handleReindexDocument] reindexMutation.mutate가 없음');
            toast({
                title: "재인덱싱 실패",
                description: '재인덱싱 mutation이 제대로 초기화되지 않았습니다.',
                variant: "destructive",
            });
            return;
        }
        
        try {
            console.log('🔄 [handleReindexDocument] mutation 호출 시작:', { documentId: id, title });
            reindexMutation.mutate({ documentId: id, title });
            console.log('🔄 [handleReindexDocument] mutation 호출 완료');
        } catch (error) {
            console.error('❌ [handleReindexDocument] mutation 호출 중 에러:', error);
            toast({
                title: "재인덱싱 실패",
                description: `재인덱싱 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
                variant: "destructive",
            });
        }
    };

    // 디버깅: 컴포넌트 마운트 시 확인
    useEffect(() => {
        console.log('🔍 [DocumentsPage] useEffect 실행됨 - handleReindexDocument 확인');
        console.log('🔍 [DocumentsPage] handleReindexDocument 타입:', typeof handleReindexDocument);
        console.log('🔍 [DocumentsPage] handleReindexDocument 값:', handleReindexDocument);
        console.log('🔍 [DocumentsPage] handleReindexDocument 함수 본문:', handleReindexDocument?.toString?.()?.substring(0, 500));
        console.log('🔍 [DocumentsPage] reindexMutation 타입:', typeof reindexMutation);
        console.log('🔍 [DocumentsPage] reindexMutation 값:', reindexMutation);
        console.log('🔍 [DocumentsPage] reindexMutation.mutate 타입:', typeof reindexMutation?.mutate);
    }, [handleReindexDocument, reindexMutation]);
    
    // 컴포넌트 마운트 시 한 번만 실행
    useEffect(() => {
        console.log('🔍 [DocumentsPage] 컴포넌트 마운트됨 (한 번만 실행)');
    }, []);

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
            // Clear selection if deleted
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

    // Filter documents based on search, vendor, and tab
    const filteredDocs = useMemo(() => {
        return documents.filter((doc: Document) => {
            const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesVendor = selectedVendor === "all" || doc.source_vendor === selectedVendor;
            const matchesTab = activeTab === "documents" ? doc.type !== 'url' : doc.type === 'url';

            return matchesSearch && matchesVendor && matchesTab;
        });
    }, [documents, searchQuery, selectedVendor, activeTab]);

    // Group documents for URL tab
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
                updated_at: doc.updated_at || doc.created_at, // Fallback to created_at if updated_at is missing
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

        // Apply expansion state
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

    // Handlers for GroupedDocumentList
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

    // 그룹 전체 선택/해제 (부모 + 하위 페이지)
    const handleSelectGroup = (groupIndex: number) => {
        const group = documentGroups[groupIndex];
        if (!group) return;

        const allIds = [
            group.mainDocument.id,
            ...group.subPages.map((sub: Document) => sub.id)
        ];
        const allSelected = allIds.every(id => selectedDocs.has(id));

        const newSelected = new Set(selectedDocs);
        if (allSelected) {
            // 모두 선택되어 있으면 해제
            allIds.forEach(id => newSelected.delete(id));
        } else {
            // 일부만 선택되어 있거나 모두 해제되어 있으면 전체 선택
            allIds.forEach(id => newSelected.add(id));
        }
        setSelectedDocs(newSelected);
    };

    const handleSelectAll = () => {
        // URL 크롤링 탭인 경우 그룹의 모든 문서 포함
        if (activeTab === "crawling") {
            const allDocIds = new Set<string>();
            documentGroups.forEach(group => {
                allDocIds.add(group.mainDocument.id);
                group.subPages.forEach((sub: Document) => allDocIds.add(sub.id));
            });
            
            if (selectedDocs.size === allDocIds.size && allDocIds.size > 0) {
                setSelectedDocs(new Set());
            } else {
                setSelectedDocs(allDocIds);
            }
        } else {
            // 일반 문서 탭
            if (selectedDocs.size === filteredDocs.length) {
                setSelectedDocs(new Set());
            } else {
                setSelectedDocs(new Set(filteredDocs.map((d: Document) => d.id)));
            }
        }
    };

    const bulkDeleteMutation = useMutation({
        mutationFn: async (ids: string[]) => {
            console.log('🗑️ [bulkDeleteMutation] mutationFn 시작:', { count: ids.length, ids });
            const results = [];
            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                console.log(`🗑️ [bulkDeleteMutation] 문서 ${i + 1}/${ids.length} 삭제 시도:`, id);
                try {
                    const url = `/api/admin/upload-new?documentId=${id}`;
                    console.log(`🗑️ [bulkDeleteMutation] API 호출:`, url);
                    const res = await fetch(url, {
                        method: 'DELETE'
                    });
                    console.log(`🗑️ [bulkDeleteMutation] API 응답:`, { status: res.status, ok: res.ok, id });
                    if (!res.ok) {
                        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
                        console.error(`❌ [bulkDeleteMutation] API 오류:`, { id, status: res.status, error: errorData });
                        throw new Error(errorData.error || 'Failed to delete document');
                    }
                    const responseData = await res.json().catch(() => ({}));
                    console.log(`✅ [bulkDeleteMutation] 문서 삭제 성공:`, { id, response: responseData });
                    results.push({ id, success: true });
                } catch (error) {
                    console.error(`❌ [bulkDeleteMutation] 문서 삭제 실패:`, { id, error });
                    results.push({ 
                        id, 
                        success: false, 
                        error: error instanceof Error ? error.message : '알 수 없는 오류' 
                    });
                }
            }
            console.log('🗑️ [bulkDeleteMutation] mutationFn 완료:', { 
                total: ids.length, 
                success: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results 
            });
            return results;
        },
        onSuccess: async (results) => {
            const successCount = results.filter(r => r.success).length;
            const failCount = results.filter(r => !r.success).length;
            
            console.log('🗑️ [bulkDeleteMutation] onSuccess 호출:', { successCount, failCount, results });
            
            // 선택 상태 먼저 초기화 (무한 루프 방지)
            setSelectedDocs(new Set());
            
            // 쿼리 무효화 (모든 admin-documents 쿼리)
            await queryClient.invalidateQueries({ 
                queryKey: ['admin-documents'],
                exact: false // 부분 매칭으로 모든 admin-documents 쿼리 무효화
            });
            
            // 명시적으로 리프레시
            await refetch();
            
            console.log('✅ [bulkDeleteMutation] 쿼리 무효화 및 리프레시 완료');
            
            if (failCount === 0) {
                toast({
                    title: "선택 삭제 완료",
                    description: `${successCount}개의 문서가 성공적으로 삭제되었습니다.`,
                });
            } else {
                toast({
                    title: "일부 삭제 실패",
                    description: `${successCount}개 성공, ${failCount}개 실패`,
                    variant: "destructive",
                });
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

    const handleBulkDelete = () => {
        console.log('🚨🚨🚨 [handleBulkDelete] ========== 함수 호출 시작 ========== 🚨🚨🚨');
        console.log('🗑️ [handleBulkDelete] selectedDocs:', selectedDocs);
        console.log('🗑️ [handleBulkDelete] selectedDocs.size:', selectedDocs?.size || 0);
        console.log('🗑️ [handleBulkDelete] bulkDeleteMutation:', bulkDeleteMutation);
        console.log('🗑️ [handleBulkDelete] bulkDeleteMutation.mutate:', bulkDeleteMutation?.mutate);
        
        if (!selectedDocs || selectedDocs.size === 0) {
            console.warn('⚠️ [handleBulkDelete] 선택된 문서 없음');
            toast({
                title: "선택된 문서 없음",
                description: "삭제할 문서를 선택해주세요.",
                variant: "destructive",
            });
            return;
        }
        
        const selectedArray = Array.from(selectedDocs);
        console.log('🗑️ [handleBulkDelete] 선택 삭제 요청:', { 
            count: selectedArray.length, 
            ids: selectedArray.slice(0, 5)
        });
        
        const confirmMessage = `선택한 ${selectedArray.length}개의 문서를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`;
        const confirmed = window.confirm(confirmMessage);
        
        if (!confirmed) {
            console.log('❌ [handleBulkDelete] 사용자가 취소함');
            return;
        }

        console.log('🗑️ [handleBulkDelete] bulkDeleteMutation.mutate 호출 시작:', selectedArray);
        if (bulkDeleteMutation && bulkDeleteMutation.mutate) {
            bulkDeleteMutation.mutate(selectedArray);
            console.log('✅ [handleBulkDelete] bulkDeleteMutation.mutate 호출 완료');
        } else {
            console.error('❌ [handleBulkDelete] bulkDeleteMutation.mutate가 없습니다!');
            toast({
                title: "삭제 실패",
                description: "삭제 기능을 초기화할 수 없습니다.",
                variant: "destructive",
            });
        }
        console.log('🚨🚨🚨 [handleBulkDelete] ========== 함수 종료 ========== 🚨🚨🚨');
    };

    // 디버깅: handleBulkDelete 정의 후 확인
    useEffect(() => {
        console.log('🔍 [DocumentsPage] handleBulkDelete 정의 확인:', handleBulkDelete);
        console.log('🔍 [DocumentsPage] handleBulkDelete.toString():', handleBulkDelete?.toString().substring(0, 500));
    }, [handleBulkDelete]);

    return (
        <ThemedAdminLayout currentPage="docs">
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white mb-2">문서 관리</h1>
                        <p className="text-gray-400">AI 학습에 사용되는 문서와 URL을 관리합니다.</p>
                    </div>
                </div>

                {/* Main Tabs */}
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

                    {/* Documents Tab */}
                    <TabsContent value="documents" className="space-y-6">
                        {/* Upload Section with Vendor Selection */}
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

                        {/* Filters & List */}
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

                        {/* Document List Table */}
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

                    {/* URL Crawling Tab */}
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
                                onToggleSubPageSelection={() => { }} // Not fully implemented in this view
                                onToggleAllSubPages={() => { }}
                                onReindexDocument={handleReindexDocument}
                                onDownloadDocument={() => { }} // Placeholder
                                onDeleteDocument={(id) => setDeleteId(id)}
                                onSelectAll={handleSelectAll}
                                onSelectDocument={handleSelectDocument}
                                onBulkDelete={(() => {
                                    const func = handleBulkDelete;
                                    console.log('🔍🔍🔍 [DocumentsPage] onBulkDelete prop 렌더링:', func);
                                    console.log('🔍🔍🔍 [DocumentsPage] func.toString():', func?.toString().substring(0, 300));
                                    return func;
                                })()}
                                selectedDocuments={selectedDocs}
                                isAllSelected={selectedDocs.size > 0 && selectedDocs.size === filteredDocs.length}
                                actionLoading={actionLoading}
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
        </ThemedAdminLayout>
    );
}
