import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "AdMate Compass - Policy Intelligence Agent",
  description: "AdMate Compass는 광고 플랫폼 정책과 가이드를 검색하고 답하는 RAG 기반 Policy Intelligence Agent입니다.",
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
