"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Sparkles,
    Search,
    ArrowRight,
    MessageSquare,
    Shield,
    Zap,
    Globe,
    CheckCircle2,
    Menu,
    X,
    Bot,
    Cpu,
    Share2,
    Brain,
    Users,
    TrendingUp,
    FileText
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// --- Mock Data & Components ---

const VENDORS = [
    { name: "Meta", color: "#1877F2" },
    { name: "Google", color: "#4285F4" },
    { name: "Naver", color: "#03C75A" },
    { name: "Kakao", color: "#FEE500" },
    { name: "X (Twitter)", color: "#000000" },
];

const FEATURES = [
    {
        title: "Multi-Platform Intelligence",
        description: "Meta, Google, Naver 등 다양한 매체의 광고 정책을 하나의 AI 어시스턴트로 통합 관리하세요.",
        icon: Globe,
        color: "text-blue-400",
        bg: "bg-blue-400/10"
    },
    {
        title: "Real-Time Policy Updates",
        description: "더 이상 정책 변경을 놓치지 마세요. AI가 최신 광고 가이드라인을 실시간으로 학습하고 동기화합니다.",
        icon: Zap,
        color: "text-yellow-400",
        bg: "bg-yellow-400/10"
    },
    {
        title: "Enterprise-Grade Security",
        description: "강력한 암호화와 엄격한 접근 제어로 귀하의 데이터와 캠페인 전략을 안전하게 보호합니다.",
        icon: Shield,
        color: "text-green-400",
        bg: "bg-green-400/10"
    },
    {
        title: "Context-Aware Answers",
        description: "광고 캠페인의 맥락과 목표를 정확히 이해하고, 상황에 딱 맞는 맞춤형 답변을 제공합니다.",
        icon: Brain,
        color: "text-purple-400",
        bg: "bg-purple-400/10"
    }
];

const MOCK_UPDATES = [
    { vendor: "Meta", date: "2024.03.15", message: "AI 생성 콘텐츠 라벨링에 대한 가이드라인이 업데이트되었습니다." },
    { vendor: "Google", date: "2024.03.10", message: "금융 서비스 광고에 대한 새로운 제한 사항이 적용되었습니다." },
    { vendor: "Naver", date: "2024.03.05", message: "의료 서비스 검색 광고 키워드 정책이 개정되었습니다." },
    { vendor: "Kakao", date: "2024.02.28", message: "비즈보드 소재 제작 가이드가 업데이트되었습니다." },
    { vendor: "X (Twitter)", date: "2024.02.20", message: "정치적 콘텐츠 프로모션 정책이 변경되었습니다." }
];

const STATISTICS = [
    {
        label: "활성 사용자",
        value: "1,200+",
        subtext: "전사 직원들이 매일 사용",
        icon: Users,
        color: "text-blue-400",
        bg: "bg-blue-400/10"
    },
    {
        label: "평균 응답 시간",
        value: "0.8s",
        subtext: "빠른 답변으로 업무 효율 향상",
        icon: Zap,
        color: "text-yellow-400",
        bg: "bg-yellow-400/10"
    },
    {
        label: "사용자 만족도",
        value: "98%",
        subtext: "정확하고 유용한 답변 제공",
        icon: TrendingUp,
        color: "text-green-400",
        bg: "bg-green-400/10"
    },
    {
        label: "문서 데이터베이스",
        value: "50,000+",
        subtext: "최신 정책과 가이드라인",
        icon: FileText,
        color: "text-purple-400",
        bg: "bg-purple-400/10"
    }
];

// --- Components ---

function TechSpecsModal({ onClose }: { onClose: () => void }) {
    const specs = [
        {
            icon: Brain,
            title: "RAG (검색 증강 생성) 기술",
            desc: "최신 광고 정책 문서를 실시간으로 참조하여 99.9%의 정확도를 제공합니다. 할루시네이션(거짓 답변)을 최소화하고 근거 있는 답변만을 생성합니다.",
            color: "text-purple-400",
            bg: "bg-purple-400/10"
        },
        {
            icon: Cpu,
            title: "멀티 모델 오케스트레이션",
            desc: "Gemini Pro와 GPT-4 등 최적의 LLM을 상황에 맞춰 교차 검증합니다. 복잡한 정책 질문에도 가장 논리적이고 정확한 해석을 제공합니다.",
            color: "text-blue-400",
            bg: "bg-blue-400/10"
        },
        {
            icon: Shield,
            title: "엔터프라이즈급 보안",
            desc: "모든 대화와 데이터는 AES-256으로 암호화되며, 엄격한 접근 제어를 통해 귀사의 캠페인 전략과 데이터를 안전하게 보호합니다.",
            color: "text-green-400",
            bg: "bg-green-400/10"
        },
        {
            icon: Zap,
            title: "실시간 정책 동기화",
            desc: "매일 변경되는 각 매체의 정책을 자동으로 크롤링하고 학습합니다. 언제나 가장 최신의 가이드를 기준으로 답변합니다.",
            color: "text-yellow-400",
            bg: "bg-yellow-400/10"
        }
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-4xl bg-[#0B0F17] border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
            >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-transparent to-purple-900/20 pointer-events-none" />

                <div className="relative p-8 md:p-12">
                    <button
                        onClick={onClose}
                        className="absolute top-6 right-6 p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                    >
                        <X className="w-6 h-6" />
                    </button>

                    <div className="text-center mb-12">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">AdMate</span> Core Technologies
                        </h2>
                        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
                            단순한 챗봇이 아닙니다. 광고 전문가를 위한 강력한 AI 엔진입니다.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {specs.map((spec, i) => (
                            <div key={i} className="flex gap-5 p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                                <div className={`w-12 h-12 rounded-xl ${spec.bg} flex items-center justify-center flex-shrink-0`}>
                                    <spec.icon className={`w-6 h-6 ${spec.color}`} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white mb-2">{spec.title}</h3>
                                    <p className="text-sm text-gray-400 leading-relaxed">{spec.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-10 text-center">
                        <Button onClick={onClose} className="px-8 py-6 text-lg bg-white text-black hover:bg-gray-200 rounded-full">
                            체험해보기
                        </Button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

function DocsModal({ onClose }: { onClose: () => void }) {
    const [activeTab, setActiveTab] = useState<'channels' | 'guide'>('channels');

    const channels = [
        {
            name: "Meta (Facebook/Instagram)",
            desc: "광고 표준 및 정책 위반 사례, 크리에이티브 사양 가이드",
            items: ["개인적 특성 정책", "비포/애프터 이미지 규정", "텍스트 오버레이 규칙"],
            color: "text-blue-500",
            bg: "bg-blue-500/10"
        },
        {
            name: "Google Ads",
            desc: "Google 광고 정책, 금지된 콘텐츠 및 제한된 비즈니스",
            items: ["금융 서비스 정책", "의료 및 의약품 규정", "상표권 사용 가이드"],
            color: "text-red-500",
            bg: "bg-red-500/10"
        },
        {
            name: "Naver",
            desc: "검색광고 및 디스플레이 광고 운영 가이드",
            items: ["키워드 등록 기준", "브랜드 검색 소재 가이드", "업종별 제한 사항"],
            color: "text-green-500",
            bg: "bg-green-500/10"
        },
        {
            name: "Kakao",
            desc: "카카오 비즈보드 및 모먼트 운영 정책",
            items: ["비즈보드 소재 가이드", "카카오톡 채널 메시지 규정", "금융/의료 심사 기준"],
            color: "text-yellow-500",
            bg: "bg-yellow-500/10"
        },
        {
            name: "X (Twitter)",
            desc: "실시간 대화 및 트렌드 중심의 광고 정책",
            items: ["정치적 콘텐츠 정책", "해시태그 사용 규정", "브랜드 안전성 가이드"],
            color: "text-white",
            bg: "bg-white/10"
        }
    ];

    const guides = [
        {
            icon: MessageSquare,
            title: "AI 정책 분석 채팅",
            desc: "자연어로 질문하면 AI가 각 매체의 공식 문서를 분석하여 답변합니다. '인스타그램 다이어트 광고 규정 알려줘'와 같이 물어보세요."
        },
        {
            icon: Brain,
            title: "우측 패널 정보",
            desc: "답변의 근거가 되는 공식 정책 원문을 우측 패널에서 실시간으로 확인할 수 있습니다. 출처가 명확한 정보만 제공합니다."
        },
        {
            icon: Share2,
            title: "대화 내역 저장 및 공유",
            desc: "모든 분석 내용은 히스토리에 자동 저장되며, 팀원들과 링크로 공유하여 협업할 수 있습니다."
        },
        {
            icon: Shield,
            title: "전문가 검토 요청",
            desc: "AI 답변이 불충분하거나 모호한 경우, '담당자 문의' 버튼을 통해 전문 운영팀에게 이메일로 직접 문의할 수 있습니다."
        }
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-4xl bg-[#0B0F17] border border-white/10 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-transparent to-purple-900/20 pointer-events-none" />

                <div className="relative p-8 md:p-10 flex-1 overflow-y-auto custom-scrollbar">
                    <button
                        onClick={onClose}
                        className="absolute top-6 right-6 p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-full transition-colors z-10"
                    >
                        <X className="w-6 h-6" />
                    </button>

                    <div className="text-center mb-10">
                        <h2 className="text-3xl font-bold mb-4">Documentation & Guide</h2>
                        <p className="text-gray-400">AdMate가 제공하는 정보 범위와 사용 방법을 확인하세요.</p>
                    </div>

                    {/* Tabs */}
                    <div className="flex justify-center mb-10">
                        <div className="bg-white/5 p-1 rounded-xl flex gap-1">
                            <button
                                onClick={() => setActiveTab('channels')}
                                className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'channels'
                                    ? 'bg-blue-600 text-white shadow-lg'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                지원 매체 및 정보
                            </button>
                            <button
                                onClick={() => setActiveTab('guide')}
                                className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'guide'
                                    ? 'bg-blue-600 text-white shadow-lg'
                                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                사용 가이드
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="min-h-[300px]">
                        <AnimatePresence mode="wait">
                            {activeTab === 'channels' ? (
                                <motion.div
                                    key="channels"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    transition={{ duration: 0.2 }}
                                    className="grid grid-cols-1 md:grid-cols-2 gap-6"
                                >
                                    {channels.map((channel, i) => (
                                        <div key={i} className="p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                                            <div className="flex items-center gap-3 mb-4">
                                                <div className={`w-3 h-3 rounded-full ${channel.bg.replace('/10', '')}`} />
                                                <h3 className="text-lg font-bold text-white">{channel.name}</h3>
                                            </div>
                                            <p className="text-sm text-gray-400 mb-4">{channel.desc}</p>
                                            <ul className="space-y-2">
                                                {channel.items.map((item, j) => (
                                                    <li key={j} className="flex items-center gap-2 text-sm text-gray-300">
                                                        <CheckCircle2 className="w-3 h-3 text-blue-400" />
                                                        {item}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="guide"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    transition={{ duration: 0.2 }}
                                    className="space-y-4"
                                >
                                    {guides.map((guide, i) => (
                                        <div key={i} className="flex gap-5 p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                                            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                                                <guide.icon className="w-6 h-6 text-blue-400" />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-bold text-white mb-2">{guide.title}</h3>
                                                <p className="text-sm text-gray-400 leading-relaxed">{guide.desc}</p>
                                            </div>
                                        </div>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}



// --- Main Page Component ---

export default function GeminiProThemePage() {
    const [isScrolled, setIsScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [showFeaturesModal, setShowFeaturesModal] = useState(false);
    const [showDocsModal, setShowDocsModal] = useState(false);
    const [showSolutionsDropdown, setShowSolutionsDropdown] = useState(false);
    const [chatInput, setChatInput] = useState("");
    const [activeVendor, setActiveVendor] = useState(0);

    // Scroll effect for header
    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    // Auto-rotate vendors
    useEffect(() => {
        const interval = setInterval(() => {
            setActiveVendor((prev) => (prev + 1) % VENDORS.length);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="min-h-screen bg-[#0B0F17] text-white font-sans selection:bg-blue-500/30 overflow-x-hidden" style={{ fontFamily: "'Noto Sans KR', sans-serif" }}>

            {/* Background Effects */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] animate-pulse delay-1000" />
                <div className="absolute top-[20%] right-[20%] w-[20%] h-[20%] bg-cyan-500/10 rounded-full blur-[80px]" />
                <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-[0.03]" />
            </div>

            {/* Navigation */}
            <nav
                className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled ? "bg-[#0B0F17]/80 backdrop-blur-md border-b border-white/5 py-4" : "bg-transparent py-6"
                    }`}
            >
                <div className="max-w-7xl mx-auto px-6 flex items-center justify-between relative">
                    <Link href="/gemini_pro_theme" className="flex items-center gap-2 group z-10">
                        <motion.div
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            className="relative h-16 w-auto"
                        >
                            <Image
                                src="/admate-logo.png"
                                alt="AdMate"
                                width={200}
                                height={64}
                                className="h-16 w-auto object-contain"
                                priority
                            />
                        </motion.div>
                    </Link>

                    {/* Desktop Menu - Absolutely Centered */}
                    <div className="hidden md:flex items-center gap-8 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                        <button onClick={() => setShowFeaturesModal(true)} className="text-sm text-gray-400 hover:text-white transition-colors">Features</button>

                        {/* Solutions Dropdown */}
                        <div
                            className="relative"
                            onMouseEnter={() => setShowSolutionsDropdown(true)}
                            onMouseLeave={() => setShowSolutionsDropdown(false)}
                        >
                            <button className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1">
                                Solutions
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            <AnimatePresence>
                                {showSolutionsDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        transition={{ duration: 0.2 }}
                                        className="absolute top-full left-0 mt-2 w-56 bg-[#131823] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50"
                                    >
                                        <div className="py-2">
                                            <Link href="#" className="block px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                                                Ad Guidelines
                                            </Link>
                                            <Link href="#" className="block px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                                                Ad Insights
                                            </Link>
                                            <Link href="#" className="block px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                                                Ad Capture Archive
                                            </Link>
                                            <Link href="#" className="block px-4 py-3 text-sm text-gray-300 hover:bg-white/5 hover:text-white transition-colors">
                                                Ad Design Studio
                                            </Link>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        <button onClick={() => setShowDocsModal(true)} className="text-sm text-gray-400 hover:text-white transition-colors">Docs</button>
                    </div>

                    <div className="hidden md:flex items-center gap-4 z-10">
                        <Button variant="ghost" className="text-gray-400 hover:text-white hover:bg-white/5">
                            Sign In
                        </Button>
                        <Button className="bg-white text-black hover:bg-gray-200 rounded-full px-6 font-medium transition-all duration-300 hover:scale-105">
                            Sign Up
                        </Button>
                    </div>

                    {/* Mobile Menu Toggle */}
                    <button
                        className="md:hidden text-gray-400 hover:text-white"
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    >
                        {mobileMenuOpen ? <X /> : <Menu />}
                    </button>
                </div>
            </nav>

            {/* Mobile Menu Overlay */}
            <AnimatePresence>
                {mobileMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="fixed inset-0 z-40 bg-[#0B0F17] pt-24 px-6 md:hidden"
                    >
                        <div className="flex flex-col gap-6">
                            <Link href="#" className="text-lg text-gray-300">Features</Link>
                            <Link href="#" className="text-lg text-gray-300">Solutions</Link>
                            <Link href="#" className="text-lg text-gray-300">Pricing</Link>
                            <Link href="#" className="text-lg text-gray-300">Docs</Link>
                            <div className="h-px bg-white/10 my-2" />
                            <Button className="w-full bg-white text-black">Sign Up</Button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Hero Section */}
            <main className="relative z-10 pt-32 pb-20 px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col items-center text-center mb-16">

                        {/* Announcement Pill */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-white/5 border border-white/10 mb-8 hover:bg-white/10 transition-colors cursor-pointer group"
                        >
                            <Globe className="w-4 h-4 text-blue-400" />
                            <span className="text-sm text-gray-300 group-hover:text-white transition-colors font-medium">AI로 완성하는 멀티 플랫폼 광고 가이드</span>
                        </motion.div>

                        {/* Main Headline */}
                        <motion.h1
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.1 }}
                            className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-8"
                        >
                            <span className="block text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60 pb-2">
                                Master Ad Policies
                            </span>
                            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400">
                                With AI Precision
                            </span>
                        </motion.h1>

                        <motion.p
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                            className="text-lg md:text-xl text-gray-400 max-w-2xl mb-12 leading-relaxed"
                        >
                            Meta, Google 등 복잡한 광고 정책, 이제 AI로 완벽하게 대응하세요.
                            실시간 규정 진단부터 승인 최적화 가이드까지, AdMate가 가장 확실한 해답을 제시합니다.
                        </motion.p>

                        {/* Interactive Search Bar */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.5, delay: 0.3 }}
                            className="w-full max-w-3xl relative group"
                        >
                            <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 rounded-2xl opacity-30 group-hover:opacity-50 blur-lg transition-opacity duration-500" />
                            <div className="relative bg-[#131823] border border-white/10 rounded-2xl p-2 flex items-center shadow-2xl">
                                <div className="pl-4 text-gray-400">
                                    <Sparkles className="w-6 h-6 text-blue-400" />
                                </div>
                                <Input
                                    type="text"
                                    placeholder="Ask about ad policies (e.g., 'Instagram image text ratio rules')..."
                                    className="border-0 bg-transparent text-lg py-6 text-white placeholder:text-gray-500 focus-visible:ring-0"
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                />
                                <Button className="h-12 px-8 rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium shadow-lg shadow-blue-500/20 transition-all duration-300 hover:scale-105">
                                    Ask AI
                                </Button>
                            </div>

                            {/* Quick Suggestions */}
                            <div className="flex flex-wrap justify-center gap-3 mt-6">
                                {["Facebook Ad Specs", "Google Policy Violations", "Naver Search Ads", "Kakao BizBoard"].map((tag, i) => (
                                    <button
                                        key={i}
                                        className="px-4 py-2 rounded-full bg-white/5 border border-white/5 text-sm text-gray-400 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all duration-300"
                                    >
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    </div>

                    {/* Vendor Ticker */}
                    <div className="w-full overflow-hidden border-y border-white/5 bg-white/[0.02] py-8 mb-24">
                        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between text-gray-500">
                            <span className="text-sm font-medium uppercase tracking-wider mr-8">Trusted Sources</span>
                            <div className="flex-1 flex justify-around items-center opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
                                {VENDORS.map((vendor, i) => (
                                    <div key={i} className="flex items-center gap-2 group cursor-pointer hover:opacity-100 transition-opacity">
                                        <div className={`w-2 h-2 rounded-full`} style={{ backgroundColor: vendor.color }} />
                                        <span className="font-semibold group-hover:text-white transition-colors">{vendor.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Features Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-32">
                        {FEATURES.map((feature, index) => (
                            <motion.div
                                key={index}
                                initial={{ opacity: 0, y: 20 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.5, delay: index * 0.1 }}
                                viewport={{ once: true }}
                                className="group relative p-8 rounded-3xl bg-[#131823] border border-white/5 hover:border-white/10 transition-all duration-300 hover:-translate-y-2"
                            >
                                <div className={`w-14 h-14 rounded-2xl ${feature.bg} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}>
                                    <feature.icon className={`w-7 h-7 ${feature.color}`} />
                                </div>
                                <h3 className="text-xl font-bold mb-3 text-white group-hover:text-blue-400 transition-colors">{feature.title}</h3>
                                <p className="text-gray-400 leading-relaxed">{feature.description}</p>

                                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                            </motion.div>
                        ))}
                    </div>

                    {/* Real-time Statistics Section */}
                    <div className="mb-32">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl font-bold mb-4">실시간 통계</h2>
                            <p className="text-gray-400">시스템 사용 현황과 성능 지표를 확인하세요</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {STATISTICS.map((stat, index) => (
                                <motion.div
                                    key={index}
                                    initial={{ opacity: 0, y: 20 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.5, delay: index * 0.1 }}
                                    viewport={{ once: true }}
                                    className="p-8 rounded-3xl bg-[#131823] border border-white/5 hover:border-white/10 hover:-translate-y-2 transition-all duration-300 group text-center"
                                >
                                    <div className={`w-12 h-12 mx-auto rounded-xl ${stat.bg} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}>
                                        <stat.icon className={`w-6 h-6 ${stat.color}`} />
                                    </div>
                                    <div className="text-4xl font-bold text-white mb-2">{stat.value}</div>
                                    <div className="text-lg font-medium text-gray-300 mb-4">{stat.label}</div>
                                    <p className="text-sm text-gray-500">{stat.subtext}</p>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    {/* Latest Updates Section */}
                    <div className="mb-32">
                        <div className="flex items-center justify-between mb-8">
                            <h2 className="text-2xl font-bold">Latest Policy Updates</h2>
                            <Button variant="ghost" className="text-blue-400 hover:text-blue-300">View All <ArrowRight className="w-4 h-4 ml-2" /></Button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {MOCK_UPDATES.slice(0, 3).map((update, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 20 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.5, delay: i * 0.1 }}
                                    viewport={{ once: true }}
                                    className="p-6 rounded-2xl bg-[#131823] border border-white/5 hover:border-white/10 transition-all group"
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <Badge variant="outline" className="border-white/10 text-gray-400">{update.vendor}</Badge>
                                        <span className="text-xs text-gray-500">{update.date}</span>
                                    </div>
                                    <p className="text-gray-300 group-hover:text-white transition-colors line-clamp-2">{update.message}</p>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    {/* Mock Chat Interface Section */}
                    <div className="flex flex-col lg:flex-row items-center gap-16 mb-32">
                        <div className="flex-1 space-y-8">
                            <h2 className="text-4xl md:text-5xl font-bold leading-tight">
                                Experience the Future of <br />
                                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">Ad Compliance</span>
                            </h2>
                            <p className="text-lg text-gray-400 leading-relaxed">
                                정책 위반으로 캠페인이 지연되는 것을 막으세요. AdMate는 수천 개의 규정을 밀리초 단위로 분석하여 즉각적인 피드백을 제공합니다.
                            </p>

                            <div className="space-y-4">
                                {[
                                    "즉각적인 정책 위반 여부 확인",
                                    "매체별 교차 호환성 점검",
                                    "반려 시 소명 자료 자동 생성 제안",
                                    "과거 정책 변경 이력 추적"
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center gap-3">
                                        <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                                            <CheckCircle2 className="w-4 h-4 text-green-400" />
                                        </div>
                                        <span className="text-gray-300">{item}</span>
                                    </div>
                                ))}
                            </div>

                            <Button variant="outline" className="h-12 px-8 border-white/20 text-white hover:bg-white/10 rounded-xl mt-4">
                                View Documentation
                            </Button>
                        </div>

                        <div className="flex-1 w-full">
                            <div className="relative rounded-3xl bg-[#0B0F17] border border-white/10 shadow-2xl overflow-hidden">
                                {/* Chat Header */}
                                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#131823]">
                                    <div className="flex items-center gap-3">
                                        <div className="w-3 h-3 rounded-full bg-red-500" />
                                        <div className="w-3 h-3 rounded-full bg-yellow-500" />
                                        <div className="w-3 h-3 rounded-full bg-green-500" />
                                    </div>
                                    <div className="text-sm text-gray-400 font-medium">AdMate AI Assistant</div>
                                    <Share2 className="w-4 h-4 text-gray-500" />
                                </div>

                                {/* Chat Content */}
                                <div className="p-6 space-y-6 min-h-[400px] bg-gradient-to-b from-[#131823] to-[#0B0F17]">
                                    {/* User Message */}
                                    <div className="flex justify-end">
                                        <div className="bg-blue-600 text-white px-6 py-3 rounded-2xl rounded-tr-sm max-w-[80%]">
                                            <p>페이스북 다이어트 광고에 '비포 & 애프터' 사진을 써도 되나요?</p>
                                        </div>
                                    </div>

                                    {/* AI Response */}
                                    <div className="flex gap-4">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                                            <Bot className="w-6 h-6 text-white" />
                                        </div>
                                        <div className="space-y-3 max-w-[85%]">
                                            <div className="bg-[#1E2330] border border-white/5 text-gray-200 px-6 py-4 rounded-2xl rounded-tl-sm">
                                                <p className="mb-3">Meta 광고 표준, 특히 개인 건강 및 외모 관련 규정에 따르면: <span className="text-blue-400 font-semibold">Meta Advertising Standards</span></p>
                                                <div className="bg-red-500/10 border-l-2 border-red-500 p-3 mb-3 rounded-r-lg">
                                                    <p className="text-sm text-red-200">
                                                        <span className="font-bold">제한 사항:</span> 광고에는 '비포 & 애프터' 이미지나 예상치 못한/비현실적인 결과를 포함하는 이미지를 사용할 수 없습니다.
                                                    </p>
                                                </div>
                                                <p className="text-sm text-gray-400">
                                                    권장 사항: 신체적 변화 결과보다는 건강한 라이프스타일, 식단 계획, 운동 루틴 자체에 초점을 맞추세요.
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button size="sm" variant="ghost" className="text-xs text-gray-500 hover:text-white h-8">
                                                    <CheckCircle2 className="w-3 h-3 mr-1" /> 검증됨
                                                </Button>
                                                <Button size="sm" variant="ghost" className="text-xs text-gray-500 hover:text-white h-8">
                                                    출처: Meta 정책 12.1
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CTA Section */}
                    <div className="relative rounded-3xl overflow-hidden p-12 text-center">
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-900/50 to-purple-900/50" />
                        <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-10" />

                        <div className="relative z-10 max-w-3xl mx-auto">
                            <h2 className="text-3xl md:text-4xl font-bold mb-6">Ready to streamline your ad operations?</h2>
                            <p className="text-gray-300 mb-8 text-lg">수많은 선도적인 에이전시와 마케터들이 AdMate와 함께 할 예정입니다. 지금 바로 시작하세요.</p>
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                                <Button className="h-14 px-8 text-lg rounded-full bg-white text-black hover:bg-gray-200 w-full sm:w-auto">
                                    Start Chat
                                </Button>
                                <Button variant="outline" className="h-14 px-8 text-lg rounded-full border-white/20 text-white hover:bg-white/10 w-full sm:w-auto">
                                    Contact Us
                                </Button>
                            </div>
                        </div>
                    </div>

                </div>
            </main>

            {/* Footer */}
            <footer className="border-t border-white/5 bg-[#0B0F17] pt-20 pb-10">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-16">
                        <div className="col-span-2 md:col-span-1">
                            <div className="flex items-center gap-2 mb-6">
                                <div className="relative h-8 w-auto">
                                    <Image
                                        src="/admate-logo.png"
                                        alt="AdMate"
                                        width={150}
                                        height={50}
                                        className="h-10 w-auto object-contain"
                                    />
                                </div>
                            </div>
                            <p className="text-gray-500 text-sm leading-relaxed">
                                AI-powered advertising policy assistant for modern marketing teams.
                            </p>
                        </div>

                        <div>
                            <h4 className="font-bold text-white mb-6">Product</h4>
                            <ul className="space-y-4 text-sm text-gray-500">
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Features</Link></li>
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Integrations</Link></li>
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Pricing</Link></li>
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Changelog</Link></li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="font-bold text-white mb-6">Resources</h4>
                            <ul className="space-y-4 text-sm text-gray-500">
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Documentation</Link></li>
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">API Reference</Link></li>
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Community</Link></li>
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Blog</Link></li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="font-bold text-white mb-6">Company</h4>
                            <ul className="space-y-4 text-sm text-gray-500">
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">About</Link></li>
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Careers</Link></li>
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Legal</Link></li>
                                <li><Link href="#" className="hover:text-blue-400 transition-colors">Contact</Link></li>
                            </ul>
                        </div>
                    </div>

                    <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
                        <p className="text-gray-600 text-sm">© 2025 AdMate Inc. All rights reserved.</p>
                        <div className="flex gap-6">
                            <Link href="#" className="text-gray-600 hover:text-white transition-colors"><span className="sr-only">Twitter</span><Share2 className="w-5 h-5" /></Link>
                            <Link href="#" className="text-gray-600 hover:text-white transition-colors"><span className="sr-only">GitHub</span><Cpu className="w-5 h-5" /></Link>
                        </div>
                    </div>
                </div>
            </footer>

            {/* Modals */}
            <AnimatePresence>
                {showFeaturesModal && (
                    <TechSpecsModal key="features-modal" onClose={() => setShowFeaturesModal(false)} />
                )}
                {showDocsModal && (
                    <DocsModal key="docs-modal" onClose={() => setShowDocsModal(false)} />
                )}
            </AnimatePresence>
        </div>
    );
}
