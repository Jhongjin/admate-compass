"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sparkles, Send, Search, Check } from "lucide-react";

const VENDORS = ["Meta", "Naver", "Kakao", "Google", "X(Twitter)"] as const;
const VENDOR_PRESETS = [
  { label: "전체 (5)", value: "all" },
  { label: "Meta", value: "meta" },
  { label: "Naver", value: "naver" },
  { label: "Kakao", value: "kakao" },
  { label: "Google", value: "google" },
  { label: "X(Twitter)", value: "twitter" },
  { label: "Meta + Google", value: "meta,google" },
] as const;

export default function UIPreviewPage() {
  const [version, setVersion] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-pink-900 p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white/10 backdrop-blur rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">UI 미리보기 버전 선택</h2>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6].map((v) => (
              <Button
                key={v}
                variant={version === v ? "default" : "outline"}
                onClick={() => setVersion(v as any)}
                className="text-white"
              >
                버전 {v}
              </Button>
            ))}
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur rounded-lg p-4 text-white text-sm">
          {version === 1 && <p>1. 단일 선택 Segmented Control — 항상 1개만 선택하는 가로형 세그먼트</p>}
          {version === 2 && <p>2. 멀티 선택 Chip Group + 적용 버튼 — 칩으로 여러 개 선택, 우측에 적용 버튼</p>}
          {version === 3 && <p>3. 벤더 프리셋 드롭다운 — 드롭다운에서 프리셋 선택(전체, 단일, 조합), 고급 설정 모달</p>}
          {version === 4 && <p>4. 탭 + 보조 퀵필터 — 상단 탭으로 주 벤더 선택, 하단에 다른 벤더 추가 모달</p>}
          {version === 5 && <p>5. 검색어 기반 자동 감지 — 질문 입력 시 자동 벤더 추천, 수동 오버라이드 가능</p>}
          {version === 6 && <p>6. 벤더 카드형 선택 — 로고+설명 카드 중 선택, 여러 벤더 비교 토글</p>}
        </div>

        <div className="bg-white rounded-lg shadow-xl p-8">
          {version === 1 && <Version1 />}
          {version === 2 && <Version2 />}
          {version === 3 && <Version3 />}
          {version === 4 && <Version4 />}
          {version === 5 && <Version5 />}
          {version === 6 && <Version6 />}
        </div>
      </div>
    </div>
  );
}

function Version1() {
  const [selected, setSelected] = useState("Meta");
  
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <Badge variant="secondary" className="px-3 py-1">
          <Sparkles className="w-3 h-3 mr-1" />
          AI 기반 멀티 벤더 광고 정책 챗봇
        </Badge>
        <h1 className="text-4xl font-bold text-gray-900">
          Meta • Naver • Kakao • Google • X 정책
        </h1>
        <h2 className="text-3xl font-bold text-blue-600">대화로 해결하세요</h2>
        <p className="text-gray-600">
          멀티 벤더 공식 문서를 기반으로 정확한 답변과 출처·최신일자를 제공합니다.
        </p>
      </div>

      <div className="bg-gray-100 rounded-lg p-2 inline-flex mx-auto block w-fit">
        {VENDORS.map((v) => (
          <button
            key={v}
            onClick={() => setSelected(v)}
            className={`px-6 py-2 rounded-md font-medium transition-all ${
              selected === v
                ? "bg-blue-600 text-white shadow-md"
                : "text-gray-600 hover:bg-gray-200"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <p className="text-center text-sm text-gray-500">선택된 벤더: {selected}</p>

      <div className="flex gap-2 max-w-2xl mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            placeholder="예) 네이버 검색광고 전환 측정 요건"
            className="pl-10 h-12 text-base"
          />
        </div>
        <Button size="lg" className="px-8">
          <Send className="w-5 h-5 mr-2" />
          질문하기
        </Button>
      </div>
    </div>
  );
}

function Version2() {
  const [selected, setSelected] = useState<string[]>(["Meta", "Google"]);
  const [query, setQuery] = useState("");
  const router = useRouter();
  
  const toggle = (v: string) => {
    setSelected(prev => 
      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
    );
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    if (selected.length === 0) {
      alert('최소 1개 벤더를 선택해주세요.');
      return;
    }
    
    const vendorsParam = `&vendors=${selected.map(v => encodeURIComponent(v)).join(',')}`;
    router.push(`/chat?q=${encodeURIComponent(query.trim())}${vendorsParam}`);
  };
  
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <Badge variant="secondary" className="px-3 py-1">
          <Sparkles className="w-3 h-3 mr-1" />
          AI 기반 멀티 벤더 광고 정책 챗봇
        </Badge>
        <h1 className="text-4xl font-bold text-gray-900">
          하나의 질문으로 여러 벤더 정책을 비교하세요
        </h1>
        <p className="text-gray-600">
          공식 문서/공지 기준으로 출처와 최신일자를 제공합니다.
        </p>
      </div>

      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">벤더 선택</label>
        <div className="flex flex-wrap gap-2 items-center">
          {VENDORS.map((v) => (
            <button
              key={v}
              onClick={() => toggle(v)}
              className={`px-4 py-2 rounded-full border-2 transition-all flex items-center gap-2 ${
                selected.includes(v)
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white border-gray-300 text-gray-700 hover:border-blue-400"
              }`}
            >
              {selected.includes(v) && <Check className="w-4 h-4" />}
              {v}
            </button>
          ))}
        </div>
        {selected.length === 0 && (
          <p className="text-sm text-red-500">최소 1개 벤더를 선택해주세요.</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 max-w-2xl mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예) 카카오 비즈보드 소재 제한 / 인스타그램 쇼핑 태그 요건"
            className="pl-10 h-12 text-base"
          />
        </div>
        <Button type="submit" size="lg" className="px-8" disabled={selected.length === 0}>
          <Send className="w-5 h-5 mr-2" />
          질문하기
        </Button>
      </form>
    </div>
  );
}

function Version3() {
  const [preset, setPreset] = useState("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedSelected, setAdvancedSelected] = useState<string[]>(["Meta", "Google"]);
  const [query, setQuery] = useState("");
  const router = useRouter();
  
  const getVendorsFromPreset = (p: string): string[] => {
    if (p === "all") return [...VENDORS];
    if (p.includes(",")) return p.split(",").map(v => v.trim());
    return [p];
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    const vendors = preset === "all" 
      ? advancedSelected.length > 0 ? advancedSelected : [...VENDORS]
      : getVendorsFromPreset(preset);
    
    if (vendors.length === 0) {
      alert('최소 1개 벤더를 선택해주세요.');
      return;
    }
    
    const vendorsParam = `&vendors=${vendors.map(v => encodeURIComponent(v)).join(',')}`;
    router.push(`/chat?q=${encodeURIComponent(query.trim())}${vendorsParam}`);
  };
  
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <Badge variant="secondary" className="px-3 py-1">
          <Sparkles className="w-3 h-3 mr-1" />
          AI 기반 멀티 벤더 광고 정책 챗봇
        </Badge>
        <h1 className="text-4xl font-bold text-gray-900">
          하나의 질문으로 여러 벤더 정책을 비교하세요
        </h1>
        <p className="text-gray-600">
          공식 문서/공지 기준으로 출처와 최신일자를 제공합니다.
        </p>
      </div>

      <div className="flex gap-3 items-end max-w-md mx-auto">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-2">벤더 선택</label>
          <Select value={preset} onValueChange={setPreset}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VENDOR_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">고급 설정</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>벤더 고급 선택</DialogTitle>
              <DialogDescription>
                여러 벤더를 자유롭게 조합하세요
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2 py-4">
              {VENDORS.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setAdvancedSelected(prev => 
                      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
                    );
                  }}
                  className={`px-4 py-2 rounded-full border-2 flex items-center gap-2 ${
                    advancedSelected.includes(v)
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "bg-white border-gray-300 text-gray-700"
                  }`}
                >
                  {advancedSelected.includes(v) && <Check className="w-4 h-4" />}
                  {v}
                </button>
              ))}
            </div>
            <Button onClick={() => setAdvancedOpen(false)}>적용</Button>
          </DialogContent>
        </Dialog>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 max-w-2xl mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예) 카카오 비즈보드 소재 제한 / 인스타그램 쇼핑 태그 요건"
            className="pl-10 h-12 text-base"
          />
        </div>
        <Button type="submit" size="lg" className="px-8">
          <Send className="w-5 h-5 mr-2" />
          질문하기
        </Button>
      </form>
    </div>
  );
}

function Version4() {
  const [activeTab, setActiveTab] = useState("Meta");
  const [additionalVendors, setAdditionalVendors] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    const vendors = [activeTab, ...additionalVendors].filter(Boolean);
    if (vendors.length === 0) {
      alert('최소 1개 벤더를 선택해주세요.');
      return;
    }
    
    const vendorsParam = `&vendors=${vendors.map(v => encodeURIComponent(v)).join(',')}`;
    router.push(`/chat?q=${encodeURIComponent(query.trim())}${vendorsParam}`);
  };
  
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <Badge variant="secondary" className="px-3 py-1">
          <Sparkles className="w-3 h-3 mr-1" />
          AI 기반 멀티 벤더 광고 정책 챗봇
        </Badge>
        <h1 className="text-4xl font-bold text-gray-900">
          벤더별 정책을 쉽게 비교하세요
        </h1>
        <p className="text-gray-600">
          주 벤더를 선택하고, 필요시 다른 벤더를 추가해 비교할 수 있습니다.
        </p>
      </div>

      <div className="border-b border-gray-200">
        <div className="flex gap-2">
          {VENDORS.map((v) => (
            <button
              key={v}
              onClick={() => setActiveTab(v)}
              className={`px-6 py-3 font-medium border-b-2 transition-colors ${
                activeTab === v
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {additionalVendors.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">추가 비교:</span>
          {additionalVendors.map((v) => (
            <Badge key={v} variant="secondary">{v}</Badge>
          ))}
        </div>
      )}

      <div className="flex justify-center">
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">+ 다른 벤더 추가</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>추가 벤더 선택</DialogTitle>
              <DialogDescription>
                비교하고 싶은 벤더를 선택하세요
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2 py-4">
              {VENDORS.filter(v => v !== activeTab).map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setAdditionalVendors(prev => 
                      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
                    );
                  }}
                  className={`px-4 py-2 rounded-full border-2 flex items-center gap-2 ${
                    additionalVendors.includes(v)
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "bg-white border-gray-300 text-gray-700"
                  }`}
                >
                  {additionalVendors.includes(v) && <Check className="w-4 h-4" />}
                  {v}
                </button>
              ))}
            </div>
            <Button onClick={() => setModalOpen(false)}>적용</Button>
          </DialogContent>
        </Dialog>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 max-w-2xl mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`예) ${activeTab} 광고 집행 정책`}
            className="pl-10 h-12 text-base"
          />
        </div>
        <Button type="submit" size="lg" className="px-8">
          <Send className="w-5 h-5 mr-2" />
          질문하기
        </Button>
      </form>
    </div>
  );
}

function Version5() {
  const [query, setQuery] = useState("");
  const [detected, setDetected] = useState<string[]>([]);
  const [manualOverride, setManualOverride] = useState(false);
  const [manualSelected, setManualSelected] = useState<string[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const router = useRouter();
  
  const handleQueryChange = async (value: string) => {
    setQuery(value);
    if (!manualOverride && value.trim().length > 3) {
      setIsDetecting(true);
      try {
        const res = await fetch('/api/detect-vendors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: value }),
        });
        const data = await res.json();
        if (data.vendors && Array.isArray(data.vendors)) {
          setDetected(data.vendors);
        }
      } catch (e) {
        console.error('벤더 감지 오류:', e);
      } finally {
        setIsDetecting(false);
      }
    }
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    const vendorsToUse = manualOverride ? manualSelected : detected;
    const vendorsParam = vendorsToUse.length > 0 
      ? `&vendors=${vendorsToUse.map(v => encodeURIComponent(v)).join(',')}`
      : '';
    
    router.push(`/chat?q=${encodeURIComponent(query.trim())}${vendorsParam}`);
  };
  
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <Badge variant="secondary" className="px-3 py-1">
          <Sparkles className="w-3 h-3 mr-1" />
          AI 기반 멀티 벤더 광고 정책 챗봇
        </Badge>
        <h1 className="text-4xl font-bold text-gray-900">
          질문만 입력하면 자동으로 벤더를 감지합니다
        </h1>
        <p className="text-gray-600">
          검색어에서 벤더를 자동 감지하거나, 수동으로 변경할 수 있습니다.
        </p>
      </div>

      {detected.length > 0 && !manualOverride && !isDetecting && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-600" />
              <span className="text-blue-800 font-medium">자동 감지된 벤더:</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setManualOverride(true)}>
              변경
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {detected.map((v) => (
              <Badge key={v} variant="default" className="bg-blue-600">
                {v}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {isDetecting && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-gray-600">
          벤더 감지 중...
        </div>
      )}

      {manualOverride && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">벤더 선택</label>
            <Button variant="ghost" size="sm" onClick={() => {
              setManualOverride(false);
              setManualSelected([]);
            }}>
              자동 감지로 전환
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {VENDORS.map((v) => (
              <button
                key={v}
                onClick={() => {
                  setManualSelected(prev => 
                    prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
                  );
                }}
                className={`px-4 py-2 rounded-full border-2 transition-all flex items-center gap-2 ${
                  manualSelected.includes(v)
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-gray-300 text-gray-700 hover:border-blue-400"
                }`}
              >
                {manualSelected.includes(v) && <Check className="w-4 h-4" />}
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 max-w-2xl mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="예) 인스타그램 광고 집행 정책 / 네이버 검색광고 요건"
            className="pl-10 h-12 text-base"
          />
        </div>
        <Button type="submit" size="lg" className="px-8">
          <Send className="w-5 h-5 mr-2" />
          질문하기
        </Button>
      </form>
    </div>
  );
}

function Version6() {
  const [selected, setSelected] = useState<string[]>([]);
  const [multiMode, setMultiMode] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  
  const toggle = (v: string) => {
    if (multiMode) {
      setSelected(prev => 
        prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
      );
    } else {
      setSelected([v]);
    }
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    if (selected.length === 0) {
      alert('최소 1개 벤더를 선택해주세요.');
      return;
    }
    
    const vendorsParam = `&vendors=${selected.map(v => encodeURIComponent(v)).join(',')}`;
    router.push(`/chat?q=${encodeURIComponent(query.trim())}${vendorsParam}`);
  };
  
  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <Badge variant="secondary" className="px-3 py-1">
          <Sparkles className="w-3 h-3 mr-1" />
          AI 기반 멀티 벤더 광고 정책 챗봇
        </Badge>
        <h1 className="text-4xl font-bold text-gray-900">
          벤더를 선택하고 정책을 확인하세요
        </h1>
        <p className="text-gray-600">
          원하는 벤더 카드를 선택하여 정책을 조회할 수 있습니다.
        </p>
      </div>

      <div className="flex justify-center items-center gap-3">
        <span className="text-sm text-gray-600">단일 선택</span>
        <button
          onClick={() => {
            setMultiMode(!multiMode);
            if (!multiMode) setSelected([]);
          }}
          className={`relative w-14 h-7 rounded-full transition-colors ${
            multiMode ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
              multiMode ? "translate-x-7" : "translate-x-0"
            }`}
          />
        </button>
        <span className="text-sm text-gray-600">여러 벤더 비교</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 max-w-5xl mx-auto">
        {VENDORS.map((v) => (
          <button
            key={v}
            onClick={() => toggle(v)}
            className={`p-6 rounded-lg border-2 transition-all text-left ${
              selected.includes(v)
                ? "border-blue-600 bg-blue-50 shadow-md"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-white ${
                v === "Meta" ? "bg-blue-600" :
                v === "Naver" ? "bg-green-600" :
                v === "Kakao" ? "bg-yellow-500" :
                v === "Google" ? "bg-red-600" :
                "bg-gray-700"
              }`}>
                {v[0]}
              </div>
              {selected.includes(v) && (
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
                  <Check className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
            <h3 className="font-semibold text-gray-900 mb-1">{v}</h3>
            <p className="text-xs text-gray-500">
              {v === "Meta" && "Facebook, Instagram 정책"}
              {v === "Naver" && "네이버 검색광고 정책"}
              {v === "Kakao" && "카카오 비즈보드 정책"}
              {v === "Google" && "구글 광고 정책"}
              {v === "X(Twitter)" && "트위터 광고 정책"}
            </p>
          </button>
        ))}
      </div>

      {selected.length > 0 && (
        <p className="text-center text-sm text-gray-600">
          선택된 벤더: {selected.join(", ")}
        </p>
      )}

      {selected.length === 0 && (
        <p className="text-center text-sm text-red-500">
          최소 1개 벤더를 선택해주세요.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 max-w-2xl mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예) 광고 집행 정책 질문"
            className="pl-10 h-12 text-base"
          />
        </div>
        <Button type="submit" size="lg" className="px-8" disabled={selected.length === 0}>
          <Send className="w-5 h-5 mr-2" />
          질문하기
        </Button>
      </form>
    </div>
  );
}

