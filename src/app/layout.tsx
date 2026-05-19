import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "AdMate Compass - 광고 정책 확인 도구",
  description: "AdMate Compass는 광고 플랫폼 정책과 가이드를 검색하고, 정책 근거 확인을 돕는 도구입니다.",
  alternates: {
    canonical: "https://compass.admate.ai.kr",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
