"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
    Search,
    Users,
    UserPlus,
    Shield,
    ShieldCheck,
    UserCheck,
    UserX,
    Edit,
    Trash2,
    RefreshCw,
    SortAsc,
    SortDesc,
    Crown,
    AlertTriangle,
    CheckCircle,
    Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchWithTimeout } from "@/lib/utils/fetchWithTimeout";
import AdminThemeLayout from "@/components/layouts/AdminThemeLayout";

const TEAM_OPTIONS = [
    "1실",
    "2실",
    "3실",
    "4실",
    "5실",
    "6실",
    "3본부",
    "미디어본부",
    "플랫폼본부",
    "경영본부"
];

interface User {
    id: string;
    email: string;
    name: string;
    avatar_url?: string;
    team: string;
    is_admin: boolean;
    is_active: boolean;
    last_sign_in?: string;
    created_at: string;
    updated_at: string;
    conversation_count: number;
}

interface UserStats {
    totalUsers: number;
    activeUsers: number;
    adminUsers: number;
    newUsersThisWeek: number;
}

export default function UserManagementPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [stats, setStats] = useState<UserStats>({
        totalUsers: 0,
        activeUsers: 0,
        adminUsers: 0,
        newUsersThisWeek: 0
    });
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [sortBy, setSortBy] = useState("created_at");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [addUserDialogOpen, setAddUserDialogOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState<{ [key: string]: boolean }>({});
    const [addUserLoading, setAddUserLoading] = useState(false);
    const { toast } = useToast();

    const [newUser, setNewUser] = useState({
        email: '',
        password: '',
        name: '',
        team: '미디어본부',
        isAdmin: false
    });

    const loadUsers = async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams({
                search: searchQuery,
                filter,
                sortBy,
                sortOrder,
                page: page.toString(),
                limit: "20"
            });

      const response = await fetchWithTimeout(`/api/admin/users?${params}`);
            const data = await response.json();

            if (data.success) {
                setUsers(data.data.users);
                setTotalPages(data.data.pagination.totalPages);

                const allUsers = data.data.users;
                const activeUsers = allUsers.filter((user: User) => user.is_active).length;
                const adminUsers = allUsers.filter((user: User) => user.is_admin).length;
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                const newUsersThisWeek = allUsers.filter((user: User) =>
                    new Date(user.created_at) > oneWeekAgo
                ).length;

                setStats({
                    totalUsers: data.data.pagination.total,
                    activeUsers,
                    adminUsers,
                    newUsersThisWeek
                });
            } else {
                throw new Error(data.error || '사용자 목록 조회에 실패했습니다.');
            }
        } catch (error) {
            console.error('사용자 목록 로드 오류:', error);
            toast({
                title: "오류",
                description: error instanceof Error ? error.message : "사용자 목록을 불러오는데 실패했습니다.",
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, [searchQuery, filter, sortBy, sortOrder, page]);

    const handleUpdateUser = async (userId: string, updates: Partial<User>) => {
        try {
            setActionLoading(prev => ({ ...prev, [userId]: true }));

      const response = await fetchWithTimeout('/api/admin/users', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId,
                    updates
                })
            });

            const data = await response.json();

            if (data.success) {
                toast({
                    title: "성공",
                    description: "사용자 정보가 업데이트되었습니다."
                });
                loadUsers();
            } else {
                throw new Error(data.error || '사용자 정보 업데이트에 실패했습니다.');
            }
        } catch (error) {
            console.error('사용자 정보 업데이트 오류:', error);
            toast({
                title: "오류",
                description: error instanceof Error ? error.message : "사용자 정보 업데이트에 실패했습니다.",
                variant: "destructive"
            });
        } finally {
            setActionLoading(prev => ({ ...prev, [userId]: false }));
        }
    };

    const handleUserPermission = async (userId: string, action: string) => {
        try {
            setActionLoading(prev => ({ ...prev, [userId]: true }));

      const response = await fetchWithTimeout('/api/admin/users/permissions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    userId,
                    action
                })
            });

            const data = await response.json();

            if (data.success) {
                toast({
                    title: "성공",
                    description: data.data.message
                });
                loadUsers();
            } else {
                throw new Error(data.error || '사용자 권한 관리에 실패했습니다.');
            }
        } catch (error) {
            console.error('사용자 권한 관리 오류:', error);
            toast({
                title: "오류",
                description: error instanceof Error ? error.message : "사용자 권한 관리에 실패했습니다.",
                variant: "destructive"
            });
        } finally {
            setActionLoading(prev => ({ ...prev, [userId]: false }));
        }
    };

    const handleDeleteUser = async (user: User) => {
        if (!confirm(`"${user.name}" 사용자를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 사용자의 모든 데이터가 삭제됩니다.`)) {
            return;
        }

        await handleUserPermission(user.id, 'delete');
    };

    const handleAdminPermission = async (user: User) => {
        const action = user.is_admin ? 'revoke_admin' : 'grant_admin';
        const actionText = user.is_admin ? '관리자 권한을 해제' : '관리자 권한을 부여';

        if (!confirm(`"${user.name}" 사용자에게 ${actionText}하시겠습니까?`)) {
            return;
        }

        await handleUserPermission(user.id, action);
    };

    const handleEditUser = (user: User) => {
        setSelectedUser(user);
        setEditDialogOpen(true);
    };

    const handleAddUser = async () => {
        try {
            setAddUserLoading(true);

            const userData = {
                ...newUser,
                email: newUser.email.includes('@') ? newUser.email : `${newUser.email}@nasmedia.co.kr`
            };

      const response = await fetchWithTimeout('/api/admin/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(userData)
            });

            const data = await response.json();

            if (data.success) {
                toast({
                    title: "성공",
                    description: data.data.message
                });

                setNewUser({
                    email: '',
                    password: '',
                    name: '',
                    team: '미디어본부',
                    isAdmin: false
                });

                setAddUserDialogOpen(false);
                loadUsers();
            } else {
                throw new Error(data.error || '사용자 추가에 실패했습니다.');
            }
        } catch (error) {
            console.error('사용자 추가 오류:', error);
            toast({
                title: "오류",
                description: error instanceof Error ? error.message : "사용자 추가에 실패했습니다.",
                variant: "destructive"
            });
        } finally {
            setAddUserLoading(false);
        }
    };

    const getStatusIcon = (user: User) => {
        if (user.is_admin) {
            return <Crown className="w-4 h-4 text-yellow-400" />;
        }
        if (user.is_active) {
            return <CheckCircle className="w-4 h-4 text-green-400" />;
        }
        return <Clock className="w-4 h-4 text-gray-400" />;
    };

    const getStatusBadge = (user: User) => {
        if (user.is_admin) {
            return <Badge variant="outline" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs whitespace-nowrap">관리자</Badge>;
        }
        if (user.is_active) {
            return <Badge variant="outline" className="bg-green-500/20 text-green-400 border-green-500/30 text-xs whitespace-nowrap">활성</Badge>;
        }
        return <Badge variant="outline" className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs whitespace-nowrap">비활성</Badge>;
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString('ko-KR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <AdminThemeLayout currentPage="users" pageTitle="사용자 관리">
            <div className="space-y-6">
                {/* 헤더 */}
                <motion.div
                    className="flex items-center justify-between"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <div>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-2 sm:mb-3 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                            사용자 관리
                        </h1>
                        <p className="text-gray-400 text-sm sm:text-base">사용자 계정을 관리하고 권한을 설정하세요.</p>
                    </div>
                    <div className="flex items-center space-x-3">
                        <Button
                            onClick={() => setAddUserDialogOpen(true)}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                            <UserPlus className="w-4 h-4 mr-2" />
                            사용자 추가
                        </Button>
                        <Button
                            onClick={loadUsers}
                            disabled={loading}
                            variant="outline"
                            size="sm"
                            className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                        >
                            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                            새로고침
                        </Button>
                    </div>
                </motion.div>

                {/* 통계 카드 */}
                <motion.div
                    className="grid grid-cols-1 md:grid-cols-4 gap-4 sm:gap-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 }}
                >
                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <Users className="w-5 h-5 text-gray-400" />
                            <h3 className="text-sm font-medium text-gray-400">총 사용자</h3>
                        </div>
                        <div className="text-2xl font-bold text-white">{stats.totalUsers}</div>
                    </div>

                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <UserCheck className="w-5 h-5 text-green-400" />
                            <h3 className="text-sm font-medium text-gray-400">활성 사용자</h3>
                        </div>
                        <div className="text-2xl font-bold text-green-400">{stats.activeUsers}</div>
                    </div>

                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <Crown className="w-5 h-5 text-yellow-400" />
                            <h3 className="text-sm font-medium text-gray-400">관리자</h3>
                        </div>
                        <div className="text-2xl font-bold text-yellow-400">{stats.adminUsers}</div>
                    </div>

                    <div className="bg-[#131823] border border-white/5 rounded-3xl p-6 hover:border-white/10 transition-all duration-300">
                        <div className="flex items-center gap-2 mb-4">
                            <UserPlus className="w-5 h-5 text-blue-400" />
                            <h3 className="text-sm font-medium text-gray-400">이번 주 신규</h3>
                        </div>
                        <div className="text-2xl font-bold text-blue-400">{stats.newUsersThisWeek}</div>
                    </div>
                </motion.div>

                {/* 검색 및 필터 */}
                <motion.div
                    className="flex flex-col sm:flex-row gap-4"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                >
                    <div className="flex-1">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <Input
                                placeholder="사용자 이름이나 이메일로 검색..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-10 bg-[#131823] border-white/10 text-white placeholder-gray-500"
                            />
                        </div>
                    </div>

                    <Select value={filter} onValueChange={setFilter}>
                        <SelectTrigger className="w-full sm:w-48 bg-[#131823] border-white/10 text-white">
                            <SelectValue placeholder="필터 선택" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                            <SelectItem value="all" className="focus:bg-white/5">전체 사용자</SelectItem>
                            <SelectItem value="admin" className="focus:bg-white/5">관리자</SelectItem>
                            <SelectItem value="active" className="focus:bg-white/5">활성 사용자</SelectItem>
                            <SelectItem value="inactive" className="focus:bg-white/5">비활성 사용자</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={sortBy} onValueChange={setSortBy}>
                        <SelectTrigger className="w-full sm:w-48 bg-[#131823] border-white/10 text-white">
                            <SelectValue placeholder="정렬 기준" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                            <SelectItem value="created_at" className="focus:bg-white/5">가입일</SelectItem>
                            <SelectItem value="name" className="focus:bg-white/5">이름</SelectItem>
                            <SelectItem value="email" className="focus:bg-white/5">이메일</SelectItem>
                            <SelectItem value="team" className="focus:bg-white/5">소속</SelectItem>
                            <SelectItem value="last_sign_in" className="focus:bg-white/5">최근 로그인</SelectItem>
                        </SelectContent>
                    </Select>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                        className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                    >
                        {sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
                    </Button>
                </motion.div>

                {/* 사용자 목록 */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                >
                    <Card className="bg-[#131823] border border-white/5 rounded-3xl">
                        <CardHeader>
                            <CardTitle className="text-white">사용자 목록</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <div className="space-y-4">
                                    {Array.from({ length: 5 }).map((_, i) => (
                                        <div key={i} className="flex items-center space-x-4">
                                            <Skeleton className="h-10 w-10 rounded-full bg-white/10" />
                                            <div className="space-y-2 flex-1">
                                                <Skeleton className="h-4 w-1/4 bg-white/10" />
                                                <Skeleton className="h-3 w-1/2 bg-white/10" />
                                            </div>
                                            <Skeleton className="h-6 w-16 bg-white/10" />
                                        </div>
                                    ))}
                                </div>
                            ) : users.length === 0 ? (
                                <div className="text-center py-8">
                                    <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                    <p className="text-gray-400">사용자가 없습니다.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-white/5 hover:bg-transparent">
                                                <TableHead className="text-gray-300">사용자</TableHead>
                                                <TableHead className="text-gray-300 min-w-[100px]">소속</TableHead>
                                                <TableHead className="text-gray-300 min-w-[80px]">상태</TableHead>
                                                <TableHead className="text-gray-300">대화 수</TableHead>
                                                <TableHead className="text-gray-300">가입일</TableHead>
                                                <TableHead className="text-gray-300">최근 로그인</TableHead>
                                                <TableHead className="text-gray-300">작업</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {users.map((user) => (
                                                <TableRow key={user.id} className="border-white/5 hover:bg-white/5 transition-colors">
                                                    <TableCell>
                                                        <div className="flex items-center space-x-3">
                                                            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                                                                {user.avatar_url ? (
                                                                    <img
                                                                        src={user.avatar_url}
                                                                        alt={user.name}
                                                                        className="w-10 h-10 rounded-full"
                                                                    />
                                                                ) : (
                                                                    <span className="text-white font-medium">
                                                                        {user.name.charAt(0).toUpperCase()}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <div className="font-medium text-white">{user.name}</div>
                                                                <div className="text-sm text-gray-400">{user.email}</div>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-gray-300 text-sm whitespace-nowrap min-w-[100px]">
                                                        {user.team}
                                                    </TableCell>
                                                    <TableCell className="min-w-[80px]">
                                                        <div className="flex items-center space-x-2">
                                                            {getStatusIcon(user)}
                                                            {getStatusBadge(user)}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-gray-300">
                                                        {user.conversation_count}
                                                    </TableCell>
                                                    <TableCell className="text-gray-300 text-sm">
                                                        {formatDate(user.created_at)}
                                                    </TableCell>
                                                    <TableCell className="text-gray-300 text-sm">
                                                        {user.last_sign_in ? formatDate(user.last_sign_in) : '없음'}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center space-x-2">
                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            onClick={() => handleEditUser(user)}
                                                                            className="text-gray-400 hover:text-white hover:bg-white/5"
                                                                            disabled={actionLoading[user.id]}
                                                                        >
                                                                            <Edit className="w-4 h-4" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <p>사용자 정보 편집</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>

                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            onClick={() => handleAdminPermission(user)}
                                                                            className={user.is_admin ? "text-yellow-400 hover:text-yellow-300 hover:bg-white/5" : "text-blue-400 hover:text-blue-300 hover:bg-white/5"}
                                                                            disabled={actionLoading[user.id]}
                                                                        >
                                                                            {user.is_admin ? <Shield className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <p>{user.is_admin ? '관리자 권한 해제' : '관리자 권한 부여'}</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>

                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            onClick={() => handleUserPermission(user.id, user.is_active ? 'deactivate' : 'activate')}
                                                                            className="text-gray-400 hover:text-white hover:bg-white/5"
                                                                            disabled={actionLoading[user.id]}
                                                                        >
                                                                            {user.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <p>{user.is_active ? '사용자 비활성화' : '사용자 활성화'}</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>

                                                            <TooltipProvider>
                                                                <Tooltip>
                                                                    <TooltipTrigger asChild>
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            onClick={() => handleDeleteUser(user)}
                                                                            className="text-red-400 hover:text-red-300 hover:bg-white/5"
                                                                            disabled={actionLoading[user.id]}
                                                                        >
                                                                            <Trash2 className="w-4 h-4" />
                                                                        </Button>
                                                                    </TooltipTrigger>
                                                                    <TooltipContent>
                                                                        <p>사용자 삭제</p>
                                                                    </TooltipContent>
                                                                </Tooltip>
                                                            </TooltipProvider>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>

                {/* 페이지네이션 */}
                {totalPages > 1 && (
                    <motion.div
                        className="flex justify-center items-center space-x-2"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.4 }}
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(page - 1)}
                            disabled={page === 1}
                            className="bg-[#131823] border-white/10 text-white hover:bg-white/5 disabled:opacity-50"
                        >
                            이전
                        </Button>
                        <span className="text-gray-300 px-4">
                            {page} / {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(page + 1)}
                            disabled={page === totalPages}
                            className="bg-[#131823] border-white/10 text-white hover:bg-white/5 disabled:opacity-50"
                        >
                            다음
                        </Button>
                    </motion.div>
                )}

                {/* 사용자 편집 다이얼로그 */}
                <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                    <DialogContent className="bg-[#131823] border-white/10 text-white">
                        <DialogHeader>
                            <DialogTitle>사용자 정보 편집</DialogTitle>
                            <DialogDescription className="text-gray-400">
                                {selectedUser?.name}의 정보를 편집하세요.
                            </DialogDescription>
                        </DialogHeader>
                        {selectedUser && (
                            <div className="space-y-4">
                                <div>
                                    <Label htmlFor="name" className="text-gray-300">이름</Label>
                                    <Input
                                        id="name"
                                        value={selectedUser.name}
                                        onChange={(e) => setSelectedUser({ ...selectedUser, name: e.target.value })}
                                        className="bg-[#0B0F17] border-white/10 text-white"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="email" className="text-gray-300">이메일</Label>
                                    <Input
                                        id="email"
                                        value={selectedUser.email}
                                        disabled
                                        className="bg-[#0B0F17] border-white/10 text-gray-400"
                                    />
                                    <p className="text-sm text-gray-400 mt-1">이메일은 변경할 수 없습니다.</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        id="is_admin"
                                        checked={selectedUser.is_admin}
                                        disabled
                                        className="data-[state=checked]:bg-yellow-500"
                                    />
                                    <Label htmlFor="is_admin" className="text-gray-300">
                                        관리자 권한
                                    </Label>
                                    <p className="text-sm text-gray-400">관리자 권한은 코드에서 설정됩니다.</p>
                                </div>
                            </div>
                        )}
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => setEditDialogOpen(false)}
                                className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                            >
                                취소
                            </Button>
                            <Button
                                onClick={() => {
                                    if (selectedUser) {
                                        handleUpdateUser(selectedUser.id, { name: selectedUser.name });
                                        setEditDialogOpen(false);
                                    }
                                }}
                                disabled={actionLoading[selectedUser?.id || '']}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                {actionLoading[selectedUser?.id || ''] ? (
                                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                ) : null}
                                저장
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* 사용자 추가 다이얼로그 */}
                <Dialog open={addUserDialogOpen} onOpenChange={setAddUserDialogOpen}>
                    <DialogContent className="bg-[#131823] border-white/10 text-white">
                        <DialogHeader>
                            <DialogTitle>새 사용자 추가</DialogTitle>
                            <DialogDescription className="text-gray-400">
                                새로운 사용자 계정을 생성하세요.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="new-email" className="text-gray-300">이메일 *</Label>
                                <div className="flex items-center">
                                    <Input
                                        id="new-email"
                                        type="text"
                                        value={newUser.email}
                                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                                        placeholder="사용자명"
                                        className="bg-[#0B0F17] border-white/10 text-white rounded-r-none"
                                    />
                                    <div className="bg-white/5 text-gray-300 px-3 py-2 border border-l-0 border-white/10 rounded-r-md">
                                        @nasmedia.co.kr
                                    </div>
                                </div>
                                <p className="text-sm text-gray-400 mt-1">@nasmedia.co.kr 도메인만 사용 가능합니다.</p>
                            </div>
                            <div>
                                <Label htmlFor="new-password" className="text-gray-300">비밀번호 *</Label>
                                <Input
                                    id="new-password"
                                    type="password"
                                    value={newUser.password}
                                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                                    placeholder="최소 6자 이상"
                                    className="bg-[#0B0F17] border-white/10 text-white"
                                />
                            </div>
                            <div>
                                <Label htmlFor="new-name" className="text-gray-300">이름 *</Label>
                                <Input
                                    id="new-name"
                                    value={newUser.name}
                                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                                    placeholder="홍길동"
                                    className="bg-[#0B0F17] border-white/10 text-white"
                                />
                            </div>
                            <div>
                                <Label htmlFor="new-team" className="text-gray-300">소속 *</Label>
                                <Select
                                    value={newUser.team}
                                    onValueChange={(value) => setNewUser({ ...newUser, team: value })}
                                >
                                    <SelectTrigger className="bg-[#0B0F17] border-white/10 text-white">
                                        <SelectValue placeholder="소속을 선택하세요" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#1A1F2C] border-white/10 text-white">
                                        {TEAM_OPTIONS.map((team) => (
                                            <SelectItem
                                                key={team}
                                                value={team}
                                                className="focus:bg-white/5"
                                            >
                                                {team}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="new-is-admin"
                                    checked={newUser.isAdmin}
                                    onCheckedChange={(checked) => setNewUser({ ...newUser, isAdmin: checked })}
                                    className="data-[state=checked]:bg-yellow-500"
                                />
                                <Label htmlFor="new-is-admin" className="text-gray-300">
                                    관리자 권한 부여
                                </Label>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setAddUserDialogOpen(false);
                                    setNewUser({
                                        email: '',
                                        password: '',
                                        name: '',
                                        team: '미디어본부',
                                        isAdmin: false
                                    });
                                }}
                                className="bg-[#131823] border-white/10 text-white hover:bg-white/5"
                            >
                                취소
                            </Button>
                            <Button
                                onClick={handleAddUser}
                                disabled={addUserLoading || !newUser.email || !newUser.password || !newUser.name}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                {addUserLoading ? (
                                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                    <UserPlus className="w-4 h-4 mr-2" />
                                )}
                                사용자 추가
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </AdminThemeLayout>
    );
}

