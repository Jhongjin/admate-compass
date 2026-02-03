"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Palette, Sun, Moon, RotateCcw, Eye, Droplets, Contrast, RotateCw } from "lucide-react";

interface ColorPreset {
  name: string;
  colors: {
    top: string;
    middle: string;
    bottom: string;
  };
  description: string;
}

const colorPresets: ColorPreset[] = [
  {
    name: "Original",
    colors: {
      top: "#0d1421",
      middle: "#512da8",
      bottom: "#cc4125"
    },
    description: "기본 오렌지 그라데이션"
  },
  {
    name: "Blue Harmony",
    colors: {
      top: "#0d1421",
      middle: "#1e40af",
      bottom: "#3b82f6"
    },
    description: "블루 계열 조화"
  },
  {
    name: "Purple Dream",
    colors: {
      top: "#0d1421",
      middle: "#7c3aed",
      bottom: "#a855f7"
    },
    description: "보라색 그라데이션"
  },
  {
    name: "Ocean Deep",
    colors: {
      top: "#0d1421",
      middle: "#0f766e",
      bottom: "#14b8a6"
    },
    description: "딥 오션 컬러"
  },
  {
    name: "Sunset Glow",
    colors: {
      top: "#0d1421",
      middle: "#dc2626",
      bottom: "#f59e0b"
    },
    description: "선셋 글로우"
  },
  {
    name: "Midnight Blue",
    colors: {
      top: "#0d1421",
      middle: "#1e3a8a",
      bottom: "#1d4ed8"
    },
    description: "미드나이트 블루"
  },
  {
    name: "Forest Green",
    colors: {
      top: "#0d1421",
      middle: "#166534",
      bottom: "#22c55e"
    },
    description: "숲속 그린"
  },
  {
    name: "Rose Gold",
    colors: {
      top: "#0d1421",
      middle: "#be185d",
      bottom: "#f472b6"
    },
    description: "로즈 골드"
  },
  {
    name: "Electric Blue",
    colors: {
      top: "#0d1421",
      middle: "#0ea5e9",
      bottom: "#06b6d4"
    },
    description: "일렉트릭 블루"
  },
  {
    name: "Warm Sunset",
    colors: {
      top: "#0d1421",
      middle: "#ea580c",
      bottom: "#fbbf24"
    },
    description: "따뜻한 선셋"
  },
  {
    name: "Deep Purple",
    colors: {
      top: "#0d1421",
      middle: "#581c87",
      bottom: "#8b5cf6"
    },
    description: "딥 퍼플"
  },
  {
    name: "Emerald",
    colors: {
      top: "#0d1421",
      middle: "#047857",
      bottom: "#10b981"
    },
    description: "에메랄드"
  },
  {
    name: "Crimson",
    colors: {
      top: "#0d1421",
      middle: "#991b1b",
      bottom: "#ef4444"
    },
    description: "크림슨"
  },
  {
    name: "Sky Blue",
    colors: {
      top: "#0d1421",
      middle: "#0369a1",
      bottom: "#38bdf8"
    },
    description: "스카이 블루"
  },
  {
    name: "Golden Hour",
    colors: {
      top: "#0d1421",
      middle: "#d97706",
      bottom: "#fde047"
    },
    description: "골든 아워"
  },
  {
    name: "Lavender",
    colors: {
      top: "#0d1421",
      middle: "#7c2d12",
      bottom: "#c084fc"
    },
    description: "라벤더"
  },
  {
    name: "Teal",
    colors: {
      top: "#0d1421",
      middle: "#0f766e",
      bottom: "#5eead4"
    },
    description: "틸"
  },
  {
    name: "Coral",
    colors: {
      top: "#0d1421",
      middle: "#c2410c",
      bottom: "#fb7185"
    },
    description: "코랄"
  }
];

export default function TestPage() {
  const [selectedPreset, setSelectedPreset] = useState<ColorPreset>(colorPresets[0]);
  const [brightness, setBrightness] = useState([100]);
  const [saturation, setSaturation] = useState([100]);
  const [contrast, setContrast] = useState([100]);
  const [hue, setHue] = useState([0]);
  const [isPreviewMode, setIsPreviewMode] = useState(true);
  const [isMainPagePreview, setIsMainPagePreview] = useState(false);
  const [isMainPageApplied, setIsMainPageApplied] = useState(false);
  const [customColors, setCustomColors] = useState({
    top: "#0d1421",
    middle: "#512da8",
    bottom: "#cc4125"
  });

  // 색상 밝기 조정 함수
  const adjustColorBrightness = (hex: string, brightness: number) => {
    // 6자리 hex 색상만 처리
    if (hex.length !== 7 || !hex.startsWith('#')) {
      console.warn('Invalid hex color:', hex);
      return hex;
    }
    
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    
    const newR = Math.min(255, Math.max(0, Math.round(r * brightness)));
    const newG = Math.min(255, Math.max(0, Math.round(g * brightness)));
    const newB = Math.min(255, Math.max(0, Math.round(b * brightness)));
    
    const result = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    console.log('밝기 조정:', hex, '->', result, 'brightness:', brightness);
    return result;
  };

  // 색상 채도 조정 함수
  const adjustColorSaturation = (hex: string, saturation: number) => {
    // 6자리 hex 색상만 처리
    if (hex.length !== 7 || !hex.startsWith('#')) {
      console.warn('Invalid hex color:', hex);
      return hex;
    }
    
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    
    // RGB를 HSL로 변환
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    
    if (max === min) {
      return hex; // 회색조
    }
    
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    // 채도 조정
    const newS = Math.min(1, Math.max(0, s * saturation));
    
    // HSL을 다시 RGB로 변환
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + newS) : l + newS - l * newS;
    const p = 2 * l - q;
    
    const h = (() => {
      if (max === r) return (g - b) / d + (g < b ? 6 : 0);
      if (max === g) return (b - r) / d + 2;
      return (r - g) / d + 4;
    })() / 6;
    
    const newR = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const newG = Math.round(hue2rgb(p, q, h) * 255);
    const newB = Math.round(hue2rgb(p, q, h - 1/3) * 255);
    
    const result = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    console.log('채도 조정:', hex, '->', result, 'saturation:', saturation);
    return result;
  };

  // 색상 대비 조정 함수
  const adjustColorContrast = (hex: string, contrast: number) => {
    // 6자리 hex 색상만 처리
    if (hex.length !== 7 || !hex.startsWith('#')) {
      console.warn('Invalid hex color:', hex);
      return hex;
    }
    
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    
    // 대비 조정을 더 부드럽게 처리
    const contrastFactor = (contrast - 100) / 100; // -1 to 1 범위로 정규화
    
    const newR = Math.min(255, Math.max(0, Math.round(r + (r - 128) * contrastFactor * 0.5)));
    const newG = Math.min(255, Math.max(0, Math.round(g + (g - 128) * contrastFactor * 0.5)));
    const newB = Math.min(255, Math.max(0, Math.round(b + (b - 128) * contrastFactor * 0.5)));
    
    const result = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    console.log('대비 조정:', hex, '->', result, 'contrast:', contrast);
    return result;
  };

  // 색상 색조 조정 함수
  const adjustColorHue = (hex: string, hueShift: number) => {
    // 6자리 hex 색상만 처리
    if (hex.length !== 7 || !hex.startsWith('#')) {
      console.warn('Invalid hex color:', hex);
      return hex;
    }
    
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    
    // RGB를 HSL로 변환
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    
    if (max === min) {
      return hex; // 회색조
    }
    
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    let h = (() => {
      if (max === r) return (g - b) / d + (g < b ? 6 : 0);
      if (max === g) return (b - r) / d + 2;
      return (r - g) / d + 4;
    })() / 6;
    
    // 색조 조정
    h = (h + hueShift / 360) % 1;
    if (h < 0) h += 1;
    
    // HSL을 다시 RGB로 변환
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    
    const newR = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const newG = Math.round(hue2rgb(p, q, h) * 255);
    const newB = Math.round(hue2rgb(p, q, h - 1/3) * 255);
    
    const result = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
    console.log('색조 조정:', hex, '->', result, 'hueShift:', hueShift);
    return result;
  };

  // 종합 색상 조정 함수
  const adjustColor = (hex: string) => {
    console.log('색상 조정 시작:', hex);
    let adjustedColor = hex;
    
    // 밝기 조정
    adjustedColor = adjustColorBrightness(adjustedColor, brightness[0] / 100);
    
    // 채도 조정
    adjustedColor = adjustColorSaturation(adjustedColor, saturation[0] / 100);
    
    // 대비 조정
    adjustedColor = adjustColorContrast(adjustedColor, contrast[0]);
    
    // 색조 조정
    adjustedColor = adjustColorHue(adjustedColor, hue[0]);
    
    console.log('최종 조정된 색상:', adjustedColor);
    return adjustedColor;
  };

  // 배경 스타일 계산
  const getBackgroundStyle = () => {
    console.log('배경 스타일 계산:', { isPreviewMode, selectedPreset: selectedPreset.name });
    
    if (!isPreviewMode) {
      // 프리뷰 모드가 비활성화되어 있을 때는 기본 배경 사용
      console.log('프리뷰 모드 비활성화 - 기본 배경 사용');
      return {};
    }
    
    const adjustedColors = {
      top: adjustColor(selectedPreset.colors.top),
      middle: adjustColor(selectedPreset.colors.middle),
      bottom: adjustColor(selectedPreset.colors.bottom)
    };

    const backgroundStyle = {
      background: `linear-gradient(180deg, ${adjustedColors.top} 0%, ${adjustedColors.middle} 50%, ${adjustedColors.bottom} 100%)`
    };
    
    console.log('적용된 배경 스타일:', backgroundStyle);
    return backgroundStyle;
  };

  // 프리셋 변경 핸들러
  const handlePresetChange = (preset: ColorPreset) => {
    console.log('프리셋 변경:', preset.name, preset.colors);
    setSelectedPreset(preset);
    setCustomColors(preset.colors);
    // 프리셋 변경 시 자동으로 프리뷰 모드 활성화
    setIsPreviewMode(true);
  };


  // 프리뷰 모드 토글
  const togglePreviewMode = () => {
    setIsPreviewMode(!isPreviewMode);
  };

  // 리셋 핸들러
  const handleReset = () => {
    setSelectedPreset(colorPresets[0]);
    setBrightness([100]);
    setSaturation([100]);
    setContrast([100]);
    setHue([0]);
    setIsPreviewMode(false);
    setIsMainPagePreview(false);
    setIsMainPageApplied(false);
    setCustomColors(colorPresets[0].colors);
    
    // 메인페이지 배경색도 원래대로 복원
    document.body.style.background = '';
    document.body.style.backgroundAttachment = '';
    document.body.style.backgroundSize = '';
    
    // localStorage와 CSS 변수도 초기화
    localStorage.removeItem('custom-background');
    document.documentElement.style.removeProperty('--main-background');
  };

  // 메인페이지 미리보기 함수
  const handleMainPagePreview = () => {
    setIsMainPagePreview(!isMainPagePreview);
  };

  // 메인페이지에 배경색 적용 함수
  const handleApplyToMainPage = () => {
    const adjustedColors = {
      top: adjustColor(selectedPreset.colors.top),
      middle: adjustColor(selectedPreset.colors.middle),
      bottom: adjustColor(selectedPreset.colors.bottom)
    };

    const newBackground = `linear-gradient(180deg, ${adjustedColors.top} 0%, ${adjustedColors.middle} 50%, ${adjustedColors.bottom} 100%)`;
    
    console.log('메인페이지에 적용할 배경:', newBackground);
    
    // CSS 변수로 저장 (다른 페이지에서도 사용할 수 있도록)
    document.documentElement.style.setProperty('--main-background', newBackground);
    
    // localStorage에도 저장하여 페이지 새로고침 시에도 유지
    localStorage.setItem('custom-background', newBackground);
    
    // 모든 페이지의 body 스타일도 직접 변경
    document.body.style.background = newBackground;
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundRepeat = 'no-repeat';
    
    setIsMainPageApplied(true);
    
    // 성공 메시지 표시
    alert(`메인페이지 배경색이 적용되었습니다!\n\n프리셋: ${selectedPreset.name}\n밝기: ${brightness[0]}%\n채도: ${saturation[0]}%\n대비: ${contrast[0]}%\n색조: ${hue[0]}°\n\n메인페이지로 이동하여 확인해보세요.`);
  };

  // 메인페이지 배경 스타일 계산
  const getMainPageBackgroundStyle = () => {
    if (!isMainPagePreview) return {};
    
    const adjustedColors = {
      top: adjustColor(selectedPreset.colors.top),
      middle: adjustColor(selectedPreset.colors.middle),
      bottom: adjustColor(selectedPreset.colors.bottom)
    };

    return {
      background: `linear-gradient(180deg, ${adjustedColors.top} 0%, ${adjustedColors.middle} 50%, ${adjustedColors.bottom} 100%)`
    };
  };

  return (
    <div 
      className="min-h-screen transition-all duration-1000 ease-in-out"
      style={getBackgroundStyle()}
    >
      <div className="container mx-auto px-4 py-8">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-4 flex items-center justify-center gap-3">
            <Palette className="w-8 h-8" />
            배경색 커스터마이저
          </h1>
          <p className="text-gray-300 text-lg">
            메인페이지 배경색을 실시간으로 테스트해보세요
          </p>
        </div>

        {/* 컨트롤 패널 */}
        <div className="max-w-4xl mx-auto">
          <Card className="bg-white/10 backdrop-blur-md border-white/20">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Eye className="w-5 h-5" />
                배경색 설정
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 프리뷰 모드 토글 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button
                    onClick={togglePreviewMode}
                    variant={isPreviewMode ? "default" : "outline"}
                    className={isPreviewMode ? "bg-green-600 hover:bg-green-700" : "border-white/30 text-white hover:bg-white/10"}
                  >
                    {isPreviewMode ? (
                      <>
                        <Eye className="w-4 h-4 mr-2" />
                        프리뷰 활성화됨
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 mr-2" />
                        프리뷰 시작
                      </>
                    )}
                  </Button>
                  
                  <Button
                    onClick={handleMainPagePreview}
                    variant={isMainPagePreview ? "default" : "outline"}
                    className={isMainPagePreview ? "bg-blue-600 hover:bg-blue-700" : "border-white/30 text-white hover:bg-white/10"}
                  >
                    {isMainPagePreview ? (
                      <>
                        <Sun className="w-4 h-4 mr-2" />
                        메인페이지 미리보기 ON
                      </>
                    ) : (
                      <>
                        <Moon className="w-4 h-4 mr-2" />
                        메인페이지 미리보기
                      </>
                    )}
                  </Button>
                  
                  <Button
                    onClick={handleApplyToMainPage}
                    variant={isMainPageApplied ? "default" : "outline"}
                    className={isMainPageApplied ? "bg-green-600 hover:bg-green-700" : "border-white/30 text-white hover:bg-white/10"}
                  >
                    {isMainPageApplied ? (
                      <>
                        <Palette className="w-4 h-4 mr-2" />
                        메인페이지에 적용됨
                      </>
                    ) : (
                      <>
                        <Palette className="w-4 h-4 mr-2" />
                        메인페이지에 적용
                      </>
                    )}
                  </Button>
                  
                  {isPreviewMode && (
                    <Badge className="bg-green-500/20 text-green-300 border-green-400/30">
                      실시간 미리보기
                    </Badge>
                  )}
                  {isMainPagePreview && (
                    <Badge className="bg-blue-500/20 text-blue-300 border-blue-400/30">
                      메인페이지 미리보기
                    </Badge>
                  )}
                  {isMainPageApplied && (
                    <Badge className="bg-green-500/20 text-green-300 border-green-400/30">
                      메인페이지에 적용됨
                    </Badge>
                  )}
                </div>
                <Button
                  onClick={handleReset}
                  variant="outline"
                  size="sm"
                  className="border-white/30 text-white hover:bg-white/10"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  리셋
                </Button>
              </div>

              {/* 색상 프리셋 */}
              <div>
                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <Palette className="w-4 h-4" />
                  색상 프리셋
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {colorPresets.map((preset, index) => (
                    <Button
                      key={index}
                      onClick={() => handlePresetChange(preset)}
                      variant={selectedPreset.name === preset.name ? "default" : "outline"}
                      className={`h-auto p-4 flex flex-col items-start ${
                        selectedPreset.name === preset.name 
                          ? "bg-blue-600 hover:bg-blue-700" 
                          : "border-white/30 text-white hover:bg-white/10"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div 
                          className="w-4 h-4 rounded-full border border-white/30"
                          style={{ backgroundColor: preset.colors.top }}
                        />
                        <div 
                          className="w-4 h-4 rounded-full border border-white/30"
                          style={{ backgroundColor: preset.colors.middle }}
                        />
                        <div 
                          className="w-4 h-4 rounded-full border border-white/30"
                          style={{ backgroundColor: preset.colors.bottom }}
                        />
                      </div>
                      <div className="text-left">
                        <div className="font-semibold text-sm">{preset.name}</div>
                        <div className="text-xs opacity-80">{preset.description}</div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>

              {/* 색상 조절 슬라이더들 */}
              <div className="space-y-6">
                {/* 밝기 조절 */}
                <div>
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Sun className="w-4 h-4" />
                    밝기 조절
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <Moon className="w-4 h-4 text-gray-400" />
                      <Slider
                        value={brightness}
                        onValueChange={setBrightness}
                        max={200}
                        min={20}
                        step={10}
                        className="flex-1"
                      />
                      <Sun className="w-4 h-4 text-yellow-400" />
                    </div>
                    <div className="text-center">
                      <Badge className="bg-blue-500/20 text-blue-300 border-blue-400/30">
                        {brightness[0]}%
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* 채도 조절 */}
                <div>
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Droplets className="w-4 h-4" />
                    채도 조절
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="w-4 h-4 rounded-full bg-gray-400" />
                      <Slider
                        value={saturation}
                        onValueChange={setSaturation}
                        max={200}
                        min={0}
                        step={10}
                        className="flex-1"
                      />
                      <div className="w-4 h-4 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-blue-500" />
                    </div>
                    <div className="text-center">
                      <Badge className="bg-green-500/20 text-green-300 border-green-400/30">
                        {saturation[0]}%
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* 대비 조절 */}
                <div>
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Contrast className="w-4 h-4" />
                    대비 조절
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="w-4 h-4 rounded bg-gray-500" />
                      <Slider
                        value={contrast}
                        onValueChange={setContrast}
                        max={200}
                        min={50}
                        step={10}
                        className="flex-1"
                      />
                      <div className="w-4 h-4 rounded bg-gradient-to-r from-black to-white" />
                    </div>
                    <div className="text-center">
                      <Badge className="bg-purple-500/20 text-purple-300 border-purple-400/30">
                        {contrast[0]}%
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* 색조 조절 */}
                <div>
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <RotateCw className="w-4 h-4" />
                    색조 조절
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <div className="w-4 h-4 rounded-full bg-red-500" />
                      <Slider
                        value={hue}
                        onValueChange={setHue}
                        max={360}
                        min={-360}
                        step={15}
                        className="flex-1"
                      />
                      <div className="w-4 h-4 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-blue-500 via-purple-500 to-red-500" />
                    </div>
                    <div className="text-center">
                      <Badge className="bg-orange-500/20 text-orange-300 border-orange-400/30">
                        {hue[0]}°
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              {/* 현재 설정 정보 */}
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <h4 className="text-white font-semibold mb-2">현재 설정</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-gray-300">프리셋</div>
                    <div className="text-white font-medium">{selectedPreset.name}</div>
                  </div>
                  <div>
                    <div className="text-gray-300">상태</div>
                    <div className="text-white font-medium">
                      {isPreviewMode ? "프리뷰 활성화" : "프리뷰 비활성화"}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-300">메인페이지 적용</div>
                    <div className="text-white font-medium">
                      {isMainPageApplied ? "적용됨" : "미적용"}
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-gray-300">밝기</div>
                    <div className="text-white font-medium">{brightness[0]}%</div>
                  </div>
                  <div>
                    <div className="text-gray-300">채도</div>
                    <div className="text-white font-medium">{saturation[0]}%</div>
                  </div>
                  <div>
                    <div className="text-gray-300">대비</div>
                    <div className="text-white font-medium">{contrast[0]}%</div>
                  </div>
                  <div>
                    <div className="text-gray-300">색조</div>
                    <div className="text-white font-medium">{hue[0]}°</div>
                  </div>
                </div>
              </div>

              {/* 메인페이지 미리보기 영역 */}
              {isMainPagePreview && (
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <h4 className="text-white font-semibold mb-4 flex items-center gap-2">
                    <Sun className="w-5 h-5 text-blue-400" />
                    메인페이지 미리보기
                  </h4>
                  <div 
                    className="w-full h-32 rounded-lg border-2 border-dashed border-white/30 flex items-center justify-center transition-all duration-1000 ease-in-out"
                    style={getMainPageBackgroundStyle()}
                  >
      <div className="text-center">
                      <div className="text-white/80 text-sm font-medium mb-1">
                        메인페이지 배경색 미리보기
                      </div>
                      <div className="text-white/60 text-xs">
                        {selectedPreset.name} • 밝기 {brightness[0]}% • 채도 {saturation[0]}% • 대비 {contrast[0]}% • 색조 {hue[0]}°
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-gray-400">
                    💡 이 색상이 메인페이지에 적용됩니다
                  </div>
                </div>
              )}

              {/* 사용법 안내 */}
              <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-400/20">
                <h4 className="text-blue-300 font-semibold mb-2">사용법</h4>
                <ul className="text-blue-200 text-sm space-y-1">
                  <li>• "프리뷰 시작" 버튼을 클릭하여 실시간 미리보기를 활성화하세요</li>
                  <li>• "메인페이지 미리보기" 버튼으로 메인페이지에 적용될 색상을 확인하세요</li>
                  <li>• "메인페이지에 적용" 버튼으로 실제 메인페이지 배경색을 변경하세요</li>
                  <li>• 18가지 색상 프리셋을 선택하여 다양한 배경색을 테스트해보세요</li>
                  <li>• 밝기, 채도, 대비, 색조 슬라이더로 세밀한 색상 조절이 가능합니다</li>
                  <li>• "리셋" 버튼으로 모든 설정을 기본값으로 되돌릴 수 있습니다</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
