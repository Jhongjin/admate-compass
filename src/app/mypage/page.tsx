"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { User, Camera, Save, Lock, Trash2, ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PasswordChangeModal } from "@/components/layouts/PasswordChangeModal";
import { DeleteAccountModal } from "@/components/layouts/DeleteAccountModal";

const TEAM_OPTIONS = [
  "1실", "2실", "3실", "4실", "5실", "6실", 
  "3본부", "미디어본부", "플랫폼본부", "경영본부"
];

export default function MyPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [profileData, setProfileData] = useState({
    name: "",
    email: "",
    team: "",
    avatar_url: ""
  });

  // 로그인하지 않은 경우 리다이렉트 (인증 로딩 완료 후에만)
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  // 프로필 데이터 로드
  useEffect(() => {
    if (user) {
      loadProfile();
    }
  }, [user]);

  // 이벤트 리스너 등록
  useEffect(() => {
    const handlePasswordChangeModal = () => setShowPasswordModal(true);
    const handleDeleteAccountModal = () => setShowDeleteModal(true);

    window.addEventListener('openPasswordChangeModal', handlePasswordChangeModal);
    window.addEventListener('openDeleteAccountModal', handleDeleteAccountModal);

    return () => {
      window.removeEventListener('openPasswordChangeModal', handlePasswordChangeModal);
      window.removeEventListener('openDeleteAccountModal', handleDeleteAccountModal);
    };
  }, []);

  const loadProfile = async () => {
    try {
      const supabase = createClient();
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user?.id)
        .single();

      if (error) {
        console.error('프로필 로드 오류:', error);
        return;
      }

      setProfileData({
        name: profile?.name || user?.user_metadata?.name || "",
        email: profile?.email || user?.email || "",
        team: profile?.team || "미디어본부",
        avatar_url: profile?.avatar_url || ""
      });
    } catch (error) {
      console.error('프로필 로드 오류:', error);
    }
  };

  const handleProfileUpdate = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          name: profileData.name,
          team: profileData.team,
          avatar_url: profileData.avatar_url,
          updated_at: new Date().toISOString()
        });

      if (error) {
        throw error;
      }

      toast({
        title: "✅ 프로필 업데이트 성공",
        description: "프로필이 성공적으로 업데이트되었습니다.",
      });

      // 프로필 업데이트 이벤트 발생
      window.dispatchEvent(new CustomEvent('profileUpdated'));
    } catch (error) {
      console.error('프로필 업데이트 오류:', error);
      toast({
        title: "❌ 프로필 업데이트 실패",
        description: "프로필 업데이트 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    // 파일 크기 체크 (5MB 제한)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "❌ 파일 크기 초과",
        description: "프로필 사진은 5MB 이하로 업로드해주세요.",
        variant: "destructive"
      });
      return;
    }

    // 파일 타입 체크
    if (!file.type.startsWith('image/')) {
      toast({
        title: "❌ 잘못된 파일 형식",
        description: "이미지 파일만 업로드 가능합니다.",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      
      // 기존 아바타 파일이 있으면 삭제
      if (profileData.avatar_url) {
        try {
          const url = new URL(profileData.avatar_url);
          const pathParts = url.pathname.split('/');
          const bucketName = pathParts[2];
          const filePath = pathParts.slice(3).join('/');
          
          if (bucketName === 'avatars') {
            await supabase.storage
              .from('avatars')
              .remove([filePath]);
          }
        } catch (error) {
          console.warn('기존 아바타 삭제 실패:', error);
          // 기존 파일 삭제 실패해도 계속 진행
        }
      }
      
      // 파일을 Supabase Storage에 업로드 (폴더 구조 사용)
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;
      
      console.log('Supabase Storage 업로드 시도:', { filePath, bucket: 'avatars' });
      
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) {
        console.error('업로드 오류:', uploadError);
        throw uploadError;
      }

      // 업로드된 파일의 공개 URL 가져오기
      const { data } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // 프로필에 새로운 아바타 URL 저장
      setProfileData(prev => ({
        ...prev,
        avatar_url: data.publicUrl
      }));

      toast({
        title: "✅ 프로필 사진 업데이트 성공",
        description: "프로필 사진이 성공적으로 업데이트되었습니다.",
      });

      // 프로필 업데이트 이벤트 발생
      window.dispatchEvent(new CustomEvent('profileUpdated'));
    } catch (error: any) {
      console.error('아바타 업로드 오류:', error);
      
      let errorMessage = "프로필 사진 업로드 중 오류가 발생했습니다.";
      
      if (error.message) {
        if (error.message.includes('Bucket not found')) {
          errorMessage = "스토리지 버킷을 찾을 수 없습니다. 관리자에게 문의해주세요.";
        } else if (error.message.includes('Permission denied')) {
          errorMessage = "파일 업로드 권한이 없습니다. 다시 로그인해주세요.";
        } else if (error.message.includes('File too large')) {
          errorMessage = "파일 크기가 너무 큽니다. 5MB 이하의 파일을 선택해주세요.";
        } else {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: "❌ 프로필 사진 업로드 실패",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = () => {
    setShowPasswordModal(true);
  };

  const handleDeleteAccount = () => {
    setShowDeleteModal(true);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push("/");
    } catch (error) {
      console.error('로그아웃 오류:', error);
    }
  };

  // 인증 로딩 중
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 flex items-center justify-center">
        <div className="text-white text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <h1 className="text-2xl font-bold mb-4">인증 확인 중...</h1>
        </div>
      </div>
    );
  }

  // 로그인하지 않은 경우
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 flex items-center justify-center">
        <div className="text-white text-center">
          <h1 className="text-2xl font-bold mb-4">로그인이 필요합니다</h1>
          <Button onClick={() => router.push("/")}>
            홈으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <div className="container mx-auto px-4 py-8">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/")}
              className="text-white hover:bg-white/10"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              홈으로
            </Button>
            <h1 className="text-3xl font-bold text-white">마이페이지</h1>
          </div>
        </div>

        <div className="max-w-2xl mx-auto space-y-6">
          {/* 프로필 정보 카드 */}
          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center">
                <User className="w-5 h-5 mr-2" />
                프로필 정보
              </CardTitle>
              <CardDescription className="text-gray-400">
                개인 정보를 수정하고 프로필 사진을 변경할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 프로필 사진 */}
              <div className="flex items-center space-x-6">
                <div className="relative">
                  <Avatar className="w-20 h-20">
                    <AvatarImage src={profileData.avatar_url} alt="프로필 사진" />
                    <AvatarFallback className="bg-blue-600 text-white text-xl">
                      {profileData.name?.charAt(0) || user?.email?.charAt(0) || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <label
                    htmlFor="avatar-upload"
                    className="absolute -bottom-2 -right-2 bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-full cursor-pointer transition-colors"
                  >
                    <Camera className="w-4 h-4" />
                    <input
                      id="avatar-upload"
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarChange}
                      className="hidden"
                      disabled={loading}
                    />
                  </label>
                </div>
                <div>
                  <h3 className="text-white font-medium">프로필 사진</h3>
                  <p className="text-gray-400 text-sm">클릭하여 프로필 사진을 변경하세요</p>
                </div>
              </div>

              {/* 이름 */}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-white">이름</Label>
                <Input
                  id="name"
                  value={profileData.name}
                  onChange={(e) => setProfileData(prev => ({ ...prev, name: e.target.value }))}
                  className="bg-gray-700 border-gray-600 text-white"
                  placeholder="이름을 입력하세요"
                />
              </div>

              {/* 이메일 (읽기 전용) */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-white">이메일</Label>
                <Input
                  id="email"
                  value={profileData.email}
                  disabled
                  className="bg-gray-600 border-gray-600 text-gray-400"
                />
                <p className="text-gray-400 text-sm">이메일은 변경할 수 없습니다.</p>
              </div>

              {/* 소속 */}
              <div className="space-y-2">
                <Label htmlFor="team" className="text-white">소속</Label>
                <Select
                  value={profileData.team}
                  onValueChange={(value) => setProfileData(prev => ({ ...prev, team: value }))}
                >
                  <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                    <SelectValue placeholder="소속을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    {TEAM_OPTIONS.map((team) => (
                      <SelectItem key={team} value={team} className="text-white hover:bg-gray-700">
                        {team}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 저장 버튼 */}
              <Button
                onClick={handleProfileUpdate}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                <Save className="w-4 h-4 mr-2" />
                {loading ? "저장 중..." : "프로필 저장"}
              </Button>
            </CardContent>
          </Card>

          {/* 계정 관리 카드 */}
          <Card className="bg-gray-800/50 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white">계정 관리</CardTitle>
              <CardDescription className="text-gray-400">
                비밀번호 변경 및 계정 삭제를 관리할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handlePasswordChange}
                variant="outline"
                className="w-full border-gray-600 text-white hover:bg-gray-700"
              >
                <Lock className="w-4 h-4 mr-2" />
                비밀번호 변경
              </Button>

              <Button
                onClick={handleDeleteAccount}
                variant="outline"
                className="w-full border-red-600 text-red-400 hover:bg-red-600/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                회원탈퇴
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Password Change Modal */}
      <PasswordChangeModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        user={user}
      />

      {/* Delete Account Modal */}
      <DeleteAccountModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        user={user}
        onSignOut={handleSignOut}
      />
    </div>
  );
}
