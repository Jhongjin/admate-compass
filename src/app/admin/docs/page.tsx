"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /admin/docs → /gemini_pro_theme/admin/documents 리다이렉트
 * 문서 관리 페이지는 gemini_pro_theme 경로에 구현되어 있음
 */
export default function AdminDocsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/gemini_pro_theme/admin/documents");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0F17]">
      <p className="text-gray-400 animate-pulse">문서 관리 페이지로 이동 중...</p>
    </div>
  );
}
