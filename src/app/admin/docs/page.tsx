"use client";

import { useState, useMemo, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AdminThemeLayout from "@/components/layouts/AdminThemeLayout";
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
    ArrowUpDown,
    Sparkles,
    XCircle
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import NewDocumentUpload from "@/components/admin/NewDocumentUpload";
import { AdminUrlCrawler } from "@/components/admin/crawler/AdminUrlCrawler";
import GroupedDocumentList from "@/components/admin/GroupedDocumentList";
import QueueSummaryPanel from "@/components/admin/QueueSummaryPanel";
import QueueMonitoringPanel from "@/components/admin/QueueMonitoringPanel";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { Separator } from "@/components/ui/separator";
import { fetchWithTimeout } from "@/lib/utils/fetchWithTimeout";

const ALL_VENDORS = ["Meta", "Naver", "Kakao", "Google", "X(Twitter)"] as const;

// UI 벤더 이름을 DB ENUM 값으로 변환하는 매핑
const VENDOR_TO_DB_MAP: Record<string, string> = {
    "Meta": "META",
    "Naver": "NAVER",
    "Kakao": "KAKAO",
    "Google": "GOOGLE",
    "X(Twitter)": "OTHER",
};

// DB ENUM 값을 UI 벤더 이름으로 변환하는 역매핑
const DB_TO_VENDOR_MAP: Record<string, string> = {
    "META": "Meta",
    "NAVER": "Naver",
    "KAKAO": "Kakao",
    "GOOGLE": "Google",
    "OTHER": "X(Twitter)",
};

// UI 벤더 배열을 DB 값 배열로 변환
function convertVendorsToDB(vendors: string[]): string[] {
    return vendors.map(v => VENDOR_TO_DB_MAP[v] || "META").filter(Boolean);
}

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

function VendorScopeBar({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
    const toggle = (v: string) => {
        if (selected.includes(v)) onChange(selected.filter(x => x !== v));
        else onChange([...selected, v]);
    };

    return (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 bg-[#131823] border border-white/5 rounded-lg">
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-gray-400 font-medium uppercase tracking-wider whitespace-nowrap">벤더</span>
                <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap overflow-x-auto sm:overflow-x-visible">
                    {ALL_VENDORS.map(v => (
                        <button
                            key={v}
                            onClick={() => toggle(v)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                                selected.includes(v)
                                    ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                                    : "bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white"
                            }`}
                            aria-label={`${v} ${selected.includes(v) ? '선택됨' : '선택 안됨'}`}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>
            {selected.length > 0 && (
                <>
                    <Separator orientation="vertical" className="hidden sm:block h-4 bg-white/10" />
                    <Separator orientation="horizontal" className="sm:hidden w-full bg-white/10" />
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                        <span className="text-blue-400 font-semibold">{selected.length}</span> 개 선택됨
                    </span>
                </>
            )}
        </div>
    );
}

function AdminDocsPageContent() {
    const router = useRouter();
    const params = useSearchParams();
    const [activeTab, setActiveTab] = useState("documents");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
    const [selectedType, setSelectedType] = useState<string>("all");
    const [selectedVendors, setSelectedVendors] = useState<string[]>([]);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [detailDoc, setDetailDoc] = useState<Document | null>(null);
    const [bulkAction, setBulkAction] = useState<'reindex' | 'delete' | null>(null);
    const [isBulkLoading, setIsBulkLoading] = useState(false);
    const [isClient, setIsClient] = useState(false);

    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
    const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
    const [actionLoading, setActionLoading] = useState<{ [key: string]: boolean }>({});

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const supabase = useMemo(() => createClient(), []);
    const vendorSelectValue = selectedVendors.length === 0 ? "all" : selectedVendors.length === 1 ? selectedVendors[0] : "multiple";
    const handleVendorSelectChange = (value: string) => {
        if (value === "multiple") return;
        if (value === "all") {
            setSelectedVendors([]);
        } else {
            setSelectedVendors([value]);
        }
    };

    // 클라이언트 마운트 확인
    useEffect(() => {
        setIsClient(true);
    }, []);

    // URL 파라미터에서 vendors 읽기
    useEffect(() => {
        if (!isClient) return;
        const fromUrl = params.get("vendors");
        if (fromUrl) {
            const vendors = decodeURIComponent(fromUrl).split(",").filter(Boolean);
            if (vendors.length > 0) {
                setSelectedVendors(vendors);
            }
        }
    }, [isClient, params]);

    // 벤더 변경 시 URL 업데이트
    useEffect(() => {
        if (!isClient) return;
        const q = selectedVendors.length ? `?vendors=${encodeURIComponent(selectedVendors.join(","))}` : "";
        router.replace(`/admin/docs${q}`);
    }, [selectedVendors, router, isClient]);

    // 문서 목록 조회
    const { data, isLoading, refetch } = useQuery({
        queryKey: ['admin-documents', selectedVendors, selectedStatus],
        queryFn: async () => {
            if (!selectedVendors || selectedVendors.length === 0) {
                return { data: { documents: [] } };
            }

            const dbVendors = convertVendorsToDB(selectedVendors);
            let q = supabase
                .from("documents")
                .select("id,title,type,status,updated_at,chunk_count,source_vendor,url,document_url,main_document_id,file_size,created_at,metadata")
                .order("updated_at", { ascending: false })
                .limit(1000);

            if (dbVendors.length > 0) {
                q = q.in("source_vendor", dbVendors);
            }

            if (selectedStatus && selectedStatus !== "all") {
                q = q.eq("status", selectedStatus);
            }

            const { data: documents, error } = await q;

            if (error) {
                console.error('문서 조회 오류:', error);
                throw new Error('문서 조회 실패');
            }

            return { data: { documents: documents || [] } };
        },
        enabled: isClient && selectedVendors.length > 0,
        // 처리중인 문서가 있으면 3초마다 자동 새로고침
        refetchInterval: (query) => {
            const documents = query.state.data?.data?.documents || [];
            const hasProcessing = documents.some((doc: any) => doc.status === 'processing' || doc.status === 'queued');
            return hasProcessing ? 3000 : false;
        },
    });
    
    // 새로고침 시 문서 상태 자동 동기화 (useEffect 사용)
    useEffect(() => {
        if (data?.data?.documents) {
            const documents = data.data.documents;
            // processing 상태이지만 chunk_count > 0인 문서 자동 수정
            const stuckDocs = documents.filter((doc: any) => 
                doc.status === 'processing' && doc.chunk_count > 0
            );
            if (stuckDocs.length > 0) {
                // 백그라운드에서 자동 수정 (사용자 경험 방해 없음)
                fetch('/api/admin/sync-status', { method: 'POST' }).catch(() => {});
            }
        }
    }, [data]);

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error: chunksError } = await supabase
                .from('document_chunks')
                .delete()
                .eq('document_id', id);

            if (chunksError) {
                console.warn('청크 삭제 오류:', chunksError);
            }

            const { error: docError } = await supabase
                .from('documents')
                .delete()
                .eq('id', id);

            if (docError) {
                throw new Error(docError.message);
            }
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

    // 재인덱싱 mutation
    const reindexMutation = useMutation({
        mutationFn: async ({ documentId, title }: { documentId: string; title: string }) => {
            const loadingKey = `${documentId}_reindex`;
            console.log('🔄 [reindexMutation] mutationFn 시작:', { documentId, title });
            
            // 로딩 상태 즉시 설정
            setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
            
            // 문서 상태를 즉시 'processing'으로 업데이트 (UI 반응성 향상)
            try {
                const { error: statusError } = await supabase
                    .from('documents')
                    .update({ 
                        status: 'processing',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', documentId);
                
                if (statusError) {
                    console.warn('⚠️ 상태 업데이트 실패 (계속 진행):', statusError);
                } else {
                    console.log('✅ 문서 상태를 processing으로 업데이트 완료');
                    // 쿼리 무효화하여 UI 즉시 반영
                    queryClient.invalidateQueries({ 
                        queryKey: ['admin-documents'],
                        exact: false
                    });
                }
            } catch (statusUpdateError) {
                console.warn('⚠️ 상태 업데이트 중 오류 (계속 진행):', statusUpdateError);
            }
            
            const res = await fetch(`/api/admin/upload/${documentId}/reindex`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            
            console.log('📡 재인덱싱 응답 상태:', res.status, res.statusText);
            
            if (!res.ok) {
                // 에러 시 로딩 상태 해제
                setActionLoading(prev => {
                    const newState = { ...prev };
                    delete newState[loadingKey];
                    return newState;
                });
                
                let errorMessage = '재인덱싱에 실패했습니다.';
                let errorDetails = '';
                try {
                    const errorData = await res.json();
                    errorMessage = errorData.error || errorData.message || errorMessage;
                    errorDetails = errorData.details || '';
                    console.error('❌ 재인덱싱 오류 응답:', errorData);
                    
                    // details가 있으면 메시지에 포함
                    if (errorDetails) {
                        errorMessage = `${errorMessage}\n\n${errorDetails}`;
                    }
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
        },
        onSuccess: (data, variables) => {
            const loadingKey = `${variables.documentId}_reindex`;
            console.log('✅ [reindexMutation] onSuccess 호출:', { data, variables });
            
            // 로딩 상태 해제
            setActionLoading(prev => {
                const newState = { ...prev };
                delete newState[loadingKey];
                return newState;
            });
            
            // 모든 admin-documents 쿼리 무효화
            queryClient.invalidateQueries({ 
                queryKey: ['admin-documents'],
                exact: false
            });
            
            // 명시적으로 refetch 호출
            refetch();
            
            toast({
                title: "재인덱싱 완료",
                description: `${variables.title} 문서의 재인덱싱이 완료되었습니다. (${data.document?.chunkCount || data.chunkCount || 0}개 청크)`,
            });
        },
        onError: (error, variables) => {
            const loadingKey = `${variables.documentId}_reindex`;
            console.error('❌ [reindexMutation] onError 호출:', { error, variables });
            
            // 에러 시 로딩 상태 해제
            setActionLoading(prev => {
                const newState = { ...prev };
                delete newState[loadingKey];
                return newState;
            });
            
            // 쿼리 무효화하여 상태 복구
            queryClient.invalidateQueries({ 
                queryKey: ['admin-documents'],
                exact: false
            });
            
            toast({
                title: "재인덱싱 실패",
                description: error.message || '재인덱싱 중 오류가 발생했습니다.',
                variant: "destructive",
            });
        }
    });

    // 재인덱싱 핸들러
    const handleReindexDocument = useCallback((id: string, title: string) => {
        console.log('🔄 [handleReindexDocument] ====== 함수 호출 시작 ======');
        console.log('🔄 [handleReindexDocument] 파라미터:', { id, title });
        
        if (!id || !title) {
            console.error('❌ [handleReindexDocument] 잘못된 파라미터:', { id, title });
            toast({
                title: "재인덱싱 실패",
                description: '문서 ID 또는 제목이 없습니다.',
                variant: "destructive",
            });
            return;
        }
        
        if (!reindexMutation?.mutate) {
            console.error('❌ [handleReindexDocument] reindexMutation.mutate가 없음');
            toast({
                title: "재인덱싱 실패",
                description: '재인덱싱 기능이 초기화되지 않았습니다. 페이지를 새로고침해주세요.',
                variant: "destructive",
            });
            return;
        }
        
        // 이미 처리 중인 경우 중복 요청 방지
        if (reindexMutation.isPending) {
            console.warn('⚠️ [handleReindexDocument] 이미 재인덱싱이 진행 중입니다.');
            toast({
                title: "재인덱싱 진행 중",
                description: '이미 재인덱싱이 진행 중입니다. 잠시 후 다시 시도해주세요.',
                variant: "default",
            });
            return;
        }
        
        try {
            console.log('🔄 [handleReindexDocument] mutation.mutate 호출 직전');
            console.log('🔄 [handleReindexDocument] 전달할 데이터:', { documentId: id, title });
            
            // mutate 호출
            reindexMutation.mutate({ documentId: id, title });
            
            console.log('🔄 [handleReindexDocument] mutation.mutate 호출 완료 (비동기이므로 즉시 반환됨)');
        } catch (error) {
            console.error('❌ [handleReindexDocument] mutation 호출 중 동기 에러:', error);
            console.error('❌ [handleReindexDocument] 에러 스택:', error instanceof Error ? error.stack : 'No stack');
            toast({
                title: "재인덱싱 실패",
                description: `재인덱싱 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
                variant: "destructive",
            });
        }
        
        console.log('🔄 [handleReindexDocument] ====== 함수 호출 종료 ======');
    }, [reindexMutation, toast]);

    const documents = data?.data?.documents || [];

    const filteredDocs = useMemo(() => {
        return documents.filter((doc: Document) => {
            const matchesSearch = doc.title.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesTab = activeTab === "documents" ? doc.type !== 'url' : doc.type === 'url';
            const matchesType = selectedType === "all" || 
                (selectedType === "pdf" && doc.type === "pdf") ||
                (selectedType === "docx" && doc.type === "docx") ||
                (selectedType === "txt" && doc.type === "txt") ||
                (selectedType === "url" && doc.type === "url");
            return matchesSearch && matchesTab && matchesType;
        });
    }, [documents, searchQuery, activeTab, selectedType]);
    useEffect(() => {
        setSelectedDocs((prev) => {
            const validIds = new Set(filteredDocs.map((doc: Document) => doc.id));
            const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
            if (next.size === prev.size) {
                return prev;
            }
            return next;
        });
    }, [filteredDocs]);

    const documentGroups = useMemo(() => {
        if (activeTab !== "crawling") return [];

        // URL 정규화 함수 (trailing slash 제거, 소문자 변환)
        const normalizeUrlForGrouping = (url: string | null | undefined): string | null => {
            if (!url) return null;
            try {
                const urlObj = new URL(url);
                // origin + pathname (trailing slash 제거, 쿼리/프래그먼트 제거)
                return `${urlObj.origin}${urlObj.pathname.replace(/\/$/, '')}`.toLowerCase();
            } catch (e) {
                // URL 파싱 실패 시 기본 정규화
                return url.replace(/\/$/, '').trim().toLowerCase();
            }
        };

        const groupMap = new Map<string, any>();
        const urlToDocMap = new Map<string, Document>(); // 정규화된 URL -> Document 매핑

        // 1단계: 모든 문서를 정규화하여 매핑
        filteredDocs.forEach((doc: Document) => {
            if (doc.url) {
                const normalizedUrl = normalizeUrlForGrouping(doc.url);
                if (normalizedUrl) {
                    urlToDocMap.set(normalizedUrl, doc);
                }
            }
        });

        // 2단계: 그룹화
        filteredDocs.forEach((doc: Document) => {
            const metadata = doc.metadata || {};
            const parentUrl = metadata.parentUrl || null;
            const isSubPage = !!parentUrl;
            
            // 그룹 키 결정: 하위 페이지면 부모 URL (정규화), 아니면(메인 페이지) 본인 URL (정규화)
            const rawGroupKey = parentUrl || doc.url;
            const groupKey = normalizeUrlForGrouping(rawGroupKey);
            
            if (!groupKey) return;

            if (!groupMap.has(groupKey)) {
                let domain = 'Unknown';
                try {
                    const urlObj = new URL(groupKey);
                    domain = urlObj.hostname;
                } catch (e) { }

                // 메인 문서 찾기 (정규화된 URL로 매칭)
                const mainDoc = urlToDocMap.get(groupKey);
                
                groupMap.set(groupKey, {
                    domain,
                    mainUrl: mainDoc?.url || rawGroupKey || groupKey, // 원본 URL 사용
                    mainDocument: mainDoc ? {
                        ...mainDoc,
                        url: mainDoc.url || '',
                        updated_at: mainDoc.updated_at || mainDoc.created_at,
                        isMainUrl: true
                    } : null,
                    subPages: [],
                    totalChunks: 0,
                    isExpanded: false,
                    selectedSubPages: []
                });
            }

            const group = groupMap.get(groupKey);
            
            const groupedDoc = {
                ...doc,
                url: doc.url || '',
                updated_at: doc.updated_at || doc.created_at,
                isMainUrl: !isSubPage
            };

            if (isSubPage) {
                // 하위 페이지는 메인 문서가 아니면 추가
                if (normalizeUrlForGrouping(doc.url) !== groupKey) {
                    group.subPages.push(groupedDoc);
                }
            } else {
                // 메인 문서는 이미 그룹 생성 시 설정되었거나, 여기서 설정
                if (!group.mainDocument) {
                    group.mainDocument = groupedDoc;
                }
            }
            
            group.totalChunks += (doc.chunk_count || 0);
        });

        const resultGroups: any[] = [];
        groupMap.forEach((group) => {
            // 메인 문서가 없고 하위 페이지만 있는 경우 처리
            if (!group.mainDocument && group.subPages.length > 0) {
                const firstSub = group.subPages[0];
                group.mainDocument = { 
                    ...firstSub, 
                    title: `[원본 없음] ${firstSub.title}`,
                    url: group.mainUrl,
                    isMainUrl: true
                };
                group.subPages = group.subPages.slice(1);
            }

            if (group.mainDocument) {
                resultGroups.push(group);
            }
        });

        return resultGroups.map((group, index) => ({
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

    const getDocumentTypeLabel = (type: string) => {
        switch (type) {
            case 'pdf':
                return 'PDF';
            case 'docx':
                return 'DOCX';
            case 'txt':
                return 'TXT';
            case 'url':
                return 'URL';
            default:
                return type?.toUpperCase() || 'FILE';
        }
    };

const getDocumentTypeBadgeClass = (type: string) => {
        switch (type) {
            case 'pdf':
                return 'bg-red-500/15 text-red-200 border-red-500/30';
            case 'docx':
                return 'bg-blue-500/15 text-blue-200 border-blue-500/30';
            case 'txt':
                return 'bg-gray-500/15 text-gray-200 border-gray-500/30';
            case 'url':
                return 'bg-green-500/15 text-green-200 border-green-500/30';
            default:
                return 'bg-white/10 text-white border-white/20';
        }
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

    const handleDocumentRowClick = (doc: Document) => {
        setDetailDoc(doc);
    };

    const performBulkAction = async (ids: string[], action: 'reindex' | 'delete') => {
        if (ids.length === 0) return;
        setBulkAction(action);
        setIsBulkLoading(true);
        try {
            if (action === 'reindex') {
                await Promise.all(
                    ids.map(async (id) => {
                        const res = await fetchWithTimeout(`/api/admin/document-actions?action=reindex&documentId=${id}`);
                        if (!res.ok) {
                            const data = await res.json().catch(() => ({}));
                            throw new Error(data.error || '재처리 요청 실패');
                        }
                    })
                );
                toast({
                    title: "재처리 요청 완료",
                    description: `${ids.length}개의 문서 재처리를 요청했습니다.`,
                });
            } else {
                await Promise.all(
                    ids.map(async (id) => {
                        const res = await fetchWithTimeout(`/api/admin/upload-new?documentId=${id}`, { method: 'DELETE' });
                        if (!res.ok) {
                            const data = await res.json().catch(() => ({}));
                            throw new Error(data.error || '삭제 실패');
                        }
                    })
                );
                toast({
                    title: "삭제 완료",
                    description: `${ids.length}개의 문서를 삭제했습니다.`,
                });
            }
            setSelectedDocs((prev) => {
                const next = new Set(prev);
                ids.forEach((id) => next.delete(id));
                return next;
            });
            await refetch();
            if (action === 'delete') {
                setDetailDoc(null);
            }
        } catch (error) {
            toast({
                title: action === 'reindex' ? "재처리 실패" : "삭제 실패",
                description: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
                variant: "destructive",
            });
        } finally {
            setIsBulkLoading(false);
            setBulkAction(null);
        }
    };

    const handleBulkReprocess = () => performBulkAction(Array.from(selectedDocs), 'reindex');
    const handleBulkDelete = () => performBulkAction(Array.from(selectedDocs), 'delete');

    const totalChunks = filteredDocs.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0);
    const selectedChunkCount = filteredDocs.reduce((sum, doc) => sum + (selectedDocs.has(doc.id) ? (doc.chunk_count || 0) : 0), 0);
    const allSelected = filteredDocs.length > 0 && selectedDocs.size === filteredDocs.length;
    const selectionState = allSelected ? true : selectedDocs.size === 0 ? false : 'indeterminate';

    // 벤더 선택이 없을 때 표시
    if (!isClient || selectedVendors.length === 0) {
        return (
            <AdminThemeLayout currentPage="docs" pageTitle="문서 관리">
                <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-white mb-2">문서 관리</h1>
                            <p className="text-gray-400">AI 학습에 사용되는 문서와 URL을 관리합니다.</p>
                        </div>
                    </div>

                    <VendorScopeBar selected={selectedVendors} onChange={setSelectedVendors} />

                    <div className="bg-[#131823] border border-white/5 rounded-2xl p-8 text-center">
                        <p className="text-lg font-semibold text-white mb-2">벤더를 선택해주세요</p>
                        <p className="text-gray-400">문서를 보려면 상단에서 벤더를 선택하세요.</p>
                    </div>
                </div>
            </AdminThemeLayout>
        );
    }

    return (
        <AdminThemeLayout currentPage="docs" pageTitle="문서 관리">
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white mb-2">문서 관리</h1>
                        <p className="text-gray-400">AI 학습에 사용되는 문서와 URL을 관리합니다.</p>
                    </div>
                </div>

                <VendorScopeBar selected={selectedVendors} onChange={setSelectedVendors} />

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
                                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
                                    <h2 className="text-lg font-semibold text-white flex items-center">
                                        <Upload className="w-5 h-5 mr-2 text-blue-400" />
                                        새 문서 업로드
                                    </h2>
                                    <div className="flex items-center gap-2 text-sm text-gray-400">
                                        <span className="hidden sm:inline-block">벤더 선택:</span>
                                        <Select value={vendorSelectValue} onValueChange={handleVendorSelectChange}>
                                            <SelectTrigger className="w-[200px] bg-[#0B0F17] border-white/10 text-white">
                                                <div className="flex-1 text-left">
                                                    {vendorSelectValue === "all"
                                                        ? "전체 벤더"
                                                        : vendorSelectValue === "multiple"
                                                            ? `${selectedVendors.length}개 선택됨`
                                                            : vendorSelectValue}
                                                </div>
                                            </SelectTrigger>
                                            <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                                                <SelectItem value="all">전체 벤더</SelectItem>
                                                <SelectItem value="multiple" disabled>
                                                    {selectedVendors.length}개 선택됨
                                                </SelectItem>
                                                {ALL_VENDORS.map((vendor) => (
                                                    <SelectItem key={vendor} value={vendor}>
                                                        {vendor}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <NewDocumentUpload
                                    onUpload={() => refetch()}
                                    vendor={selectedVendors.length === 1 ? convertVendorsToDB(selectedVendors)[0] : undefined}
                                    hideList={true}
                                />
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="crawling" className="space-y-6">
                        <AdminUrlCrawler
                            defaultVendor={selectedVendors}
                            onVendorChange={(vendors) => {
                                // URL 크롤링 페이지에서 벤더 선택 변경 시 상단 벤더와 동기화
                                setSelectedVendors(vendors);
                            }}
                            onSuccess={async () => {
                                // 문서 목록 새로고침 및 캐시 무효화
                                await queryClient.invalidateQueries({ queryKey: ['admin-documents'], exact: false });
                                // 약간의 지연 후 새로고침 (DB 업데이트 완료 대기)
                                setTimeout(async () => {
                                    await refetch();
                                }, 2000);
                            }}
                        />

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
                                onReindexDocument={handleReindexDocument}
                                onDownloadDocument={() => { }}
                                onDeleteDocument={(id) => setDeleteId(id)}
                                onSelectAll={handleSelectAll}
                                onSelectDocument={handleSelectDocument}
                                onBulkDelete={handleBulkDelete}
                                selectedDocuments={selectedDocs}
                                isAllSelected={selectedDocs.size > 0 && selectedDocs.size === filteredDocs.length}
                                actionLoading={actionLoading}
                                deletingDocument={deleteId}
                            />
                        </div>
                    </TabsContent>
                </Tabs>

                {/* 문서 리스트 섹션 (하단) */}
                {activeTab === "documents" && (
                    <div className="space-y-6">
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
                                <Select value={selectedType} onValueChange={setSelectedType}>
                                    <SelectTrigger className="w-[140px] bg-[#0B0F17] border-white/10 text-white">
                                        <div className="flex items-center gap-2">
                                            <ArrowUpDown className="w-4 h-4 text-gray-400" />
                                            <SelectValue placeholder="유형" />
                                        </div>
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                                        <SelectItem value="all">전체</SelectItem>
                                        <SelectItem value="pdf">PDF</SelectItem>
                                        <SelectItem value="docx">DOCX</SelectItem>
                                        <SelectItem value="txt">TXT</SelectItem>
                                        <SelectItem value="url">URL</SelectItem>
                                    </SelectContent>
                                </Select>
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

                        {viewMode === 'list' ? (
                            <div className="bg-[#131823] border border-white/5 rounded-3xl overflow-hidden">
                                <div className="flex flex-col gap-4 px-6 pt-6 pb-4 border-b border-white/5">
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-sm text-gray-400">
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <Checkbox
                                                checked={selectionState}
                                                onCheckedChange={handleSelectAll}
                                                className="bg-[#1D2340] border-[#2F3B66] hover:border-blue-400 hover:bg-[#1F2A4F] data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-400 data-[state=indeterminate]:bg-blue-500 data-[state=indeterminate]:border-blue-400"
                                            />
                                            <span>총 {filteredDocs.length}</span>
                                            <span>/ 선택 {selectedDocs.size}</span>
                                            <span>• 총 청크 {totalChunks}</span>
                                            <span>• 선택 청크 {selectedChunkCount}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={handleBulkReprocess}
                                                disabled={selectedDocs.size === 0 || (isBulkLoading && bulkAction !== null)}
                                            >
                                                {isBulkLoading && bulkAction === 'reindex' ? '재처리 중...' : '재처리'}
                                            </Button>
                                            <Button
                                                variant="destructive"
                                                size="sm"
                                                onClick={handleBulkDelete}
                                                disabled={selectedDocs.size === 0 || (isBulkLoading && bulkAction !== null)}
                                            >
                                                {isBulkLoading && bulkAction === 'delete' ? '삭제 중...' : '삭제'}
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => refetch()}>
                                                <RefreshCw className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-white/5 bg-white/[0.02]">
                                                <th className="px-4 py-4 w-12 text-center text-xs font-medium text-gray-400 uppercase tracking-wider"></th>
                                            <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">문서명</th>
                                            <th className="px-6 py-4 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">유형</th>
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
                                                <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                                                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                                    데이터를 불러오는 중...
                                                </td>
                                            </tr>
                                        ) : filteredDocs.length === 0 ? (
                                            <tr>
                                                <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                                                    등록된 문서가 없습니다.
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredDocs.map((doc: Document) => (
                                                <tr
                                                    key={doc.id}
                                                    className="hover:bg-white/[0.02] transition-colors"
                                                >
                                                    <td className="px-4 py-4 w-12 text-center" onClick={(e) => e.stopPropagation()}>
                                                        <Checkbox
                                                            checked={selectedDocs.has(doc.id)}
                                                            onCheckedChange={() => handleSelectDocument(doc.id)}
                                                            className="bg-[#1D2340] border-[#2F3B66] hover:border-blue-400 hover:bg-[#1F2A4F] data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-400"
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="flex items-center">
                                                            <div className="p-2 rounded-lg bg-white/5 mr-3">
                                                                {getFileIcon(doc.type)}
                                                            </div>
                                                            <div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDocumentRowClick(doc)}
                                                                    className="text-sm font-medium text-white hover:underline"
                                                                >
                                                                    {doc.title}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <Badge variant="outline" className={`text-xs font-semibold ${getDocumentTypeBadgeClass(doc.type)}`}>
                                                            {getDocumentTypeLabel(doc.type)}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <Badge variant="secondary" className="bg-white/5 text-gray-300 border-white/10">
                                                            {doc.source_vendor ? (DB_TO_VENDOR_MAP[doc.source_vendor] || doc.source_vendor) : 'Unknown'}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <Badge variant="outline" className={getStatusColor(doc.status)}>
                                                            {getStatusText(doc.status)}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                                                        {doc.file_size ? formatSize(doc.file_size) : '-'}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                                                        {doc.chunk_count || 0}
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
                        ) : (
                            <div className="bg-[#131823] border border-white/5 rounded-3xl p-6">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {isLoading ? (
                                        <div className="col-span-full text-center py-8 text-gray-500">
                                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                            데이터를 불러오는 중...
                                        </div>
                                    ) : filteredDocs.length === 0 ? (
                                        <div className="col-span-full text-center py-8 text-gray-500">
                                            등록된 문서가 없습니다.
                                        </div>
                                    ) : (
                                        filteredDocs.map((doc: Document) => (
                                            <div
                                                key={doc.id}
                                                className="bg-[#0B0F17] border border-white/5 rounded-xl p-4 hover:border-blue-500/30 hover:bg-white/[0.02] transition-all cursor-pointer"
                                            >
                                                <div className="flex items-start justify-between mb-3">
                                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                                        <div className="p-2 rounded-lg bg-white/5 flex-shrink-0">
                                                            {getFileIcon(doc.type)}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <h3 className="text-sm font-medium text-white truncate mb-1">
                                                                {doc.title}
                                                            </h3>
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <Badge variant="outline" className={`${getDocumentTypeBadgeClass(doc.type)} text-xs`}>
                                                                    {getDocumentTypeLabel(doc.type)}
                                                                </Badge>
                                                                <Badge variant="secondary" className="bg-white/5 text-gray-300 border-white/10 text-xs">
                                                                    {doc.source_vendor ? (DB_TO_VENDOR_MAP[doc.source_vendor] || doc.source_vendor) : 'Unknown'}
                                                                </Badge>
                                                                <Badge variant="outline" className={`${getStatusColor(doc.status)} text-xs`}>
                                                                    {getStatusText(doc.status)}
                                                                </Badge>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white flex-shrink-0">
                                                                <MoreVertical className="w-4 h-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end" className="bg-[#1A1F2C] border-white/10 text-white">
                                                            <DropdownMenuItem
                                                                className="hover:bg-white/5 cursor-pointer"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDocumentRowClick(doc);
                                                                }}
                                                            >
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
                                                </div>
                                                <div className="space-y-2 text-xs text-gray-400">
                                                    <div className="flex items-center justify-between">
                                                        <span>크기:</span>
                                                        <span className="text-gray-300">{doc.file_size ? formatSize(doc.file_size) : '-'}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span>청크:</span>
                                                        <span className="text-gray-300">{doc.chunk_count || 0}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span>등록일:</span>
                                                        <span className="text-gray-300">{new Date(doc.created_at).toLocaleDateString()}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* 처리 큐 영역 (테마 적용, 좌우 배치) */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <div className="bg-gradient-to-br from-[#1F2640] via-[#141A2B] to-[#0B0F17] p-[1px] rounded-3xl shadow-[0_20px_60px_rgba(5,9,20,0.55)]">
                        <div className="bg-[#0B0F17]/95 rounded-3xl p-4 sm:p-6 border border-white/5">
                            <QueueSummaryPanel selectedVendors={selectedVendors} />
                        </div>
                    </div>
                    <div className="bg-gradient-to-br from-[#1F2640] via-[#141A2B] to-[#0B0F17] p-[1px] rounded-3xl shadow-[0_20px_60px_rgba(5,9,20,0.55)]">
                        <div className="bg-[#0B0F17]/95 rounded-3xl p-4 sm:p-6 border border-white/5">
                            <QueueMonitoringPanel vendors={selectedVendors} defaultOpen={false} />
                        </div>
                    </div>
                </div>

                {/* 문서 처리 현황 카드 (최하단) */}
                <DocumentStatsPanel documents={documents} />

                <DocumentDetailDialog
                    detail={detailDoc}
                    onClose={() => setDetailDoc(null)}
                    onBulkAction={performBulkAction}
                    isProcessing={isBulkLoading}
                    formatSize={formatSize}
                    getStatusColor={getStatusColor}
                    getStatusText={getStatusText}
                />
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
        </AdminThemeLayout>
    );
}

function DocumentStatsPanel({ documents }: { documents: Document[] }) {
    const stats = useMemo(() => {
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

        const totalDocuments = documents.length;
        const recentUploads = documents.filter(doc => {
            const createdAt = new Date(doc.created_at).getTime();
            return createdAt >= oneDayAgo;
        }).length;
        const processing = documents.filter(doc => 
            doc.status === 'processing' || doc.status === 'queued'
        ).length;
        const failedLast7Days = documents.filter(doc => {
            const updatedAt = doc.updated_at ? new Date(doc.updated_at).getTime() : new Date(doc.created_at).getTime();
            return doc.status === 'failed' && updatedAt >= sevenDaysAgo;
        }).length;

        return {
            totalDocuments,
            recentUploads,
            processing,
            failedLast7Days
        };
    }, [documents]);

    return (
        <div className="bg-[#131823] border border-white/5 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-6 flex items-center">
                <BarChart3 className="w-5 h-5 mr-2 text-blue-400" />
                문서 처리 현황
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 총 문서 수 */}
                <div className="bg-[#0B0F17] border border-white/5 rounded-xl p-6 hover:border-blue-500/30 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-gray-400">총 문서 수</h3>
                        <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center border border-blue-500/30">
                            <FileText className="w-5 h-5 text-blue-400" />
                        </div>
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">{stats.totalDocuments}</div>
                    <p className="text-xs text-gray-500">전체 인덱싱 문서</p>
                </div>

                {/* 최근 24시간 */}
                <div className="bg-[#0B0F17] border border-white/5 rounded-xl p-6 hover:border-purple-500/30 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-gray-400">최근 24시간</h3>
                        <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center border border-purple-500/30">
                            <Sparkles className="w-5 h-5 text-purple-400" />
                        </div>
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">{stats.recentUploads}</div>
                    <p className="text-xs text-gray-500">최근 업로드 수</p>
                </div>

                {/* 처리 중 */}
                <div className="bg-[#0B0F17] border border-white/5 rounded-xl p-6 hover:border-cyan-500/30 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-gray-400">처리 중</h3>
                        <div className="w-10 h-10 bg-cyan-500/20 rounded-lg flex items-center justify-center border border-cyan-500/30">
                            <RefreshCw className={`w-5 h-5 text-cyan-400 ${stats.processing > 0 ? 'animate-spin' : ''}`} />
                        </div>
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">{stats.processing}</div>
                    <p className="text-xs text-gray-500">대기 및 진행 중</p>
                </div>

                {/* 실패 (7일) */}
                <div className="bg-[#0B0F17] border border-white/5 rounded-xl p-6 hover:border-red-500/30 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-medium text-gray-400">실패 (7일)</h3>
                        <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center border border-red-500/30">
                            <XCircle className="w-5 h-5 text-red-400" />
                        </div>
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">{stats.failedLast7Days}</div>
                    <p className="text-xs text-gray-500">최근 7일 실패 문서</p>
                </div>
            </div>
        </div>
    );
}

interface DocumentDetailDialogProps {
    detail: Document | null;
    onClose: () => void;
    onBulkAction: (ids: string[], action: 'reindex' | 'delete') => Promise<void>;
    isProcessing: boolean;
    formatSize: (bytes: number) => string;
    getStatusColor: (status: string) => string;
    getStatusText: (status: string) => string;
}

function DocumentDetailDialog({
    detail,
    onClose,
    onBulkAction,
    isProcessing,
    formatSize,
    getStatusColor,
    getStatusText,
}: DocumentDetailDialogProps) {
    const supabase = useMemo(() => createClient(), []);

    const { data: fullDoc, isLoading: fullDocLoading } = useQuery({
        queryKey: ["document-detail", detail?.id],
        enabled: !!detail?.id,
        queryFn: async () => {
            if (!detail?.id) return null;
            const { data, error } = await supabase
                .from("documents")
                .select("id,title,type,status,chunk_count,file_size,created_at,updated_at,source_vendor")
                .eq("id", detail.id)
                .single();
            if (error) throw error;
            return data;
        }
    });

    const { data: metadata, isLoading: metadataLoading } = useQuery({
        queryKey: ["document-metadata", detail?.id],
        enabled: !!detail?.id,
        queryFn: async () => {
            if (!detail?.id) return null;
            const { data, error } = await supabase
                .from("document_metadata")
                .select("metadata")
                .eq("id", detail.id)
                .maybeSingle();
            if (error) return null;
            return data?.metadata ?? data;
        }
    });

    const { data: previewChunks, isLoading: previewLoading } = useQuery({
        queryKey: ["document-chunks", detail?.id],
        enabled: !!detail?.id,
        queryFn: async () => {
            if (!detail?.id) return [];
            const { data, error } = await supabase
                .from("document_chunks")
                .select("content, metadata")
                .eq("document_id", detail.id)
                .order("metadata->chunk_index", { ascending: true })
                .limit(5);
            if (error) return [];
            return data || [];
        }
    });

    const { data: jobLogs, isLoading: jobLoading } = useQuery({
        queryKey: ["document-jobs", detail?.id],
        enabled: !!detail?.id,
        queryFn: async () => {
            if (!detail?.id) return [];
            const { data, error } = await supabase
                .from("processing_jobs")
                .select("id, job_type, status, attempts, max_attempts, created_at, started_at, finished_at, result, error")
                .eq("document_id", detail.id)
                .order("created_at", { ascending: false })
                .limit(5);
            if (error) return [];
            return data || [];
        }
    });

    if (!detail) {
        return null;
    }

    const formatDate = (value?: string | null) => {
        if (!value) return "-";
        return new Date(value).toLocaleString();
    };

    const jsonString = (value: unknown) => {
        if (!value) return "데이터가 없습니다.";
        try {
            return JSON.stringify(value, null, 2);
        } catch {
            return String(value);
        }
    };

    const documentInfo = fullDoc || detail;

    return (
        <Dialog open={!!detail} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl bg-[#0E1424] text-white border border-white/10 max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-semibold truncate">{detail.title}</DialogTitle>
                    <DialogDescription className="text-gray-400">
                        문서 메타데이터, 미리보기, 처리 로그를 확인할 수 있습니다.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="metadata" className="w-full">
                    <TabsList className="grid grid-cols-3 bg-white/5 rounded-xl mb-4">
                        <TabsTrigger value="metadata" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                            메타데이터
                        </TabsTrigger>
                        <TabsTrigger value="preview" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                            미리보기
                        </TabsTrigger>
                        <TabsTrigger value="logs" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                            처리 로그
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="metadata" className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                                <p className="text-xs text-gray-400 mb-1">문서 ID</p>
                                <p className="font-mono text-sm break-all">{documentInfo?.id}</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                                <p className="text-xs text-gray-400 mb-1">벤더</p>
                                <p className="text-sm">{documentInfo?.source_vendor || "Unknown"}</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                                <p className="text-xs text-gray-400 mb-1">유형</p>
                                <p className="text-sm uppercase">{documentInfo?.type}</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                                <p className="text-xs text-gray-400 mb-1">상태</p>
                                <Badge variant="outline" className={getStatusColor(documentInfo?.status || "unknown")}>
                                    {getStatusText(documentInfo?.status || "unknown")}
                                </Badge>
                            </div>
                            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                                <p className="text-xs text-gray-400 mb-1">생성일</p>
                                <p className="text-sm">{formatDate(documentInfo?.created_at)}</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                                <p className="text-xs text-gray-400 mb-1">업데이트</p>
                                <p className="text-sm">{formatDate(documentInfo?.updated_at)}</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                                <p className="text-xs text-gray-400 mb-1">청크 수</p>
                                <p className="text-sm">{documentInfo?.chunk_count ?? 0}</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                                <p className="text-xs text-gray-400 mb-1">파일 크기</p>
                                <p className="text-sm">{documentInfo?.file_size ? formatSize(documentInfo.file_size) : "-"}</p>
                            </div>
                        </div>

                        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                            <p className="text-xs text-gray-400 mb-2">추가 메타데이터</p>
                            {metadataLoading ? (
                                <p className="text-sm text-gray-400">불러오는 중...</p>
                            ) : (
                                <pre className="bg-black/30 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                                    {jsonString(metadata)}
                                </pre>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-3 justify-end">
                            <Button
                                variant="secondary"
                                onClick={() => onBulkAction([detail.id], 'reindex')}
                                disabled={isProcessing}
                            >
                                재처리
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => onBulkAction([detail.id], 'delete')}
                                disabled={isProcessing}
                            >
                                삭제
                            </Button>
                        </div>
                    </TabsContent>

                    <TabsContent value="preview" className="space-y-4">
                        {previewLoading ? (
                            <p className="text-sm text-gray-400">불러오는 중...</p>
                        ) : previewChunks && previewChunks.length > 0 ? (
                            previewChunks.map((chunk: any, index: number) => (
                                <div key={index} className="bg-white/5 rounded-lg p-4 border border-white/10 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-400">청크 {index + 1}</span>
                                        <span className="text-xs text-gray-400">
                                            {chunk?.metadata?.chunk_index !== undefined ? `인덱스 ${chunk.metadata.chunk_index}` : ''}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                                        {chunk.content || '내용 없음'}
                                    </p>
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-gray-400">미리보기 데이터가 없습니다.</p>
                        )}
                    </TabsContent>

                    <TabsContent value="logs" className="space-y-4">
                        {jobLoading ? (
                            <p className="text-sm text-gray-400">불러오는 중...</p>
                        ) : jobLogs && jobLogs.length > 0 ? (
                            jobLogs.map((job: any) => (
                                <div key={job.id} className="bg-white/5 rounded-lg p-4 border border-white/10 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <p className="text-sm font-semibold text-white">{job.job_type}</p>
                                            <p className="text-xs text-gray-400">생성일 {formatDate(job.created_at)}</p>
                                        </div>
                                        <Badge variant="outline" className={getStatusColor(job.status)}>
                                            {getStatusText(job.status)}
                                        </Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-xs text-gray-300">
                                        <div>시도 횟수: {job.attempts}/{job.max_attempts}</div>
                                        <div>시작일: {formatDate(job.started_at)}</div>
                                        <div>완료일: {formatDate(job.finished_at)}</div>
                                        <div>에러: {job.error ? job.error : '-'}</div>
                                    </div>
                                    {job.result && (
                                        <pre className="bg-black/30 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                                            {jsonString(job.result)}
                                        </pre>
                                    )}
                                </div>
                            ))
                        ) : (
                            <p className="text-sm text-gray-400">처리 로그가 없습니다.</p>
                        )}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

export default function AdminDocsPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        }>
            <AdminDocsPageContent />
        </Suspense>
    );
}

