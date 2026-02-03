import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  title: {
    default: "AdMate - AI 기반 멀티 벤더 광고 정책 챗봇",
    template: "%s | AdMate"
  },
  description: "Meta, Naver, Kakao, Google, X(Twitter) 등 멀티 플랫폼 광고 정책을 AI가 자동으로 분석해 정확한 답변을 제공하는 RAG 기반 챗봇",
  keywords: [
    "AI 챗봇",
    "광고 정책",
    "Meta 광고",
    "네이버 광고",
    "카카오 광고",
    "구글 광고",
    "RAG",
    "FAQ",
    "광고 집행",
    "광고 가이드라인"
  ],
  authors: [{ name: "AdMate Team" }],
  creator: "AdMate Team",
  publisher: "AdMate",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://admate.vercel.app'),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: '/',
    title: 'AdMate - AI 기반 멀티 벤더 광고 정책 챗봇',
    description: 'Meta, Naver, Kakao, Google, X(Twitter) 등 멀티 플랫폼 광고 정책을 AI가 자동으로 분석해 정확한 답변을 제공합니다',
    siteName: 'AdMate',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'AdMate - AI 기반 멀티 벤더 광고 정책 챗봇',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AdMate - AI 기반 멀티 벤더 광고 정책 챗봇',
    description: 'Meta, Naver, Kakao, Google, X(Twitter) 등 멀티 플랫폼 광고 정책을 AI가 자동으로 분석해 정확한 답변을 제공합니다',
    images: ['/og-image.png'],
    creator: '@admate',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
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
          <SonnerToaster 
            position="top-right" 
            theme="dark"
            toastOptions={{
              className: 'bg-[#1A1F2C] border border-gray-700/50 text-gray-100 shadow-xl',
              style: {
                background: '#1A1F2C',
                border: '1px solid rgba(55, 65, 81, 0.5)',
                color: '#F3F4F6',
              },
            }}
          />
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
