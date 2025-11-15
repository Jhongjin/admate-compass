"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  FileText, 
  Image, 
  Table, 
  ExternalLink, 
  Calendar, 
  Download,
  Eye,
  BookOpen,
  Globe,
  Shield,
  CheckCircle
} from "lucide-react";
import { motion } from "framer-motion";
import AnswerSummary from "./AnswerSummary";
import RelatedQuestions from "./RelatedQuestions";
import LearningResources from "./LearningResources";

interface ResourceItem {
  id: string;
  title: string;
  type: 'document' | 'image' | 'table' | 'guide';
  description: string;
  url?: string;
  updatedAt: string;
  content?: string;
  imageUrl?: string;
  tableData?: Array<{ [key: string]: string }>;
  tags: string[];
  sourceType?: 'file' | 'url';
  documentType?: string;
  similarity?: number; // 유사도 정보 추가
}

interface RelatedResourcesProps {
  resources?: ResourceItem[];
  isLoading?: boolean;
  userQuestion?: string;
  aiResponse?: string;
  sources?: Array<{
    id: string;
    title: string;
    url?: string;
    updatedAt: string;
    excerpt: string;
    sourceType?: 'file' | 'url';
    documentType?: string;
    similarity?: number;
  }>;
  relatedQuestions?: string[];
  onQuestionClick?: (question: string) => void;
}

// 샘플 데이터
const sampleResources: ResourceItem[] = [
  {
    id: "1",
    title: "Meta 광고 정책 가이드",
    type: "document",
    description: "Meta 광고 정책에 대한 상세한 가이드입니다.",
    url: "/documents/meta-ad-policy.pdf",
    updatedAt: "2024-01-15",
    content: "Meta 광고 정책에 대한 상세한 내용을 포함한 가이드 문서입니다.",
    tags: ["정책", "가이드", "Meta"]
  },
  {
    id: "2",
    type: "image",
    title: "광고 승인 프로세스 플로우차트",
    description: "광고 승인 과정을 시각적으로 보여주는 플로우차트입니다.",
    imageUrl: "https://picsum.photos/400/300?random=1",
    updatedAt: "2024-01-10",
    tags: ["승인", "프로세스", "플로우차트"]
  },
  {
    id: "3",
    type: "table",
    title: "광고 타입별 제한사항",
    description: "각 광고 타입별 제한사항을 정리한 표입니다.",
    updatedAt: "2024-01-12",
    tableData: [
      { "광고 타입": "이미지 광고", "최대 크기": "1200x628px", "파일 형식": "JPG, PNG" },
      { "광고 타입": "비디오 광고", "최대 크기": "1920x1080px", "파일 형식": "MP4, MOV" },
      { "광고 타입": "카드 광고", "최대 크기": "1200x628px", "파일 형식": "JPG, PNG" }
    ],
    tags: ["제한사항", "표", "광고타입"]
  },
  {
    id: "4",
    type: "guide",
    title: "광고 승인 체크리스트",
    description: "광고 승인을 위한 필수 체크 항목들을 단계별로 정리한 가이드입니다.",
    content: "광고 승인을 위한 필수 체크 항목들을 단계별로 정리한 가이드입니다.",
    tags: ["승인", "체크리스트", "가이드"],
    updatedAt: "2024-01-15"
  }
];

export default function RelatedResources({ 
  resources, 
  isLoading = false, 
  userQuestion, 
  aiResponse, 
  sources = [],
  relatedQuestions,
  onQuestionClick
}: RelatedResourcesProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // 강력한 텍스트 디코딩 함수
  const decodeText = (text: string | undefined): string => {
    if (!text) return '';
    
    try {
      // 1. null 문자 제거
      let cleanText = text.replace(/\0/g, '');
      
      // 2. 제어 문자 제거 (탭, 줄바꿈, 캐리지 리턴 제외)
      cleanText = cleanText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      
      // 3. UTF-8 인코딩 보장
      cleanText = Buffer.from(cleanText, 'utf-8').toString('utf-8');
      
      // 4. 연속된 공백을 하나로 정리
      cleanText = cleanText.replace(/\s+/g, ' ');
      
      // 5. 앞뒤 공백 제거
      cleanText = cleanText.trim();
      
      // 6. 추가 한글 텍스트 정리 (깨진 문자 패턴 수정)
      cleanText = cleanText
        .replace(/[^\x20-\x7E\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g, '') // 한글과 기본 ASCII만 유지
        .replace(/\s+/g, ' ')
        .trim();
      
      console.log(`🔧 RelatedResources 텍스트 정리: "${cleanText.substring(0, 30)}..."`);
      return cleanText;
    } catch (error) {
      console.warn('⚠️ 텍스트 디코딩 실패, 기본 정리만 적용:', error);
      // 기본 정리만 적용
      return text.replace(/\0/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
    }
  };

  // 파일 다운로드 핸들러
  const handleFileDownload = async (resource: ResourceItem) => {
    try {
      if (!resource.url) {
        console.error('다운로드 URL이 없습니다:', resource);
        alert('다운로드할 파일을 찾을 수 없습니다.');
        return;
      }

      console.log(`📥 파일 다운로드 시작: ${resource.title}`);
      
      // API 호출로 실제 파일 다운로드
      const response = await fetch(resource.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // 파일명에서 _chunk_0 패턴을 _page_1로 변경
      let fileName = resource.title.replace(/_chunk_\d+/g, (match) => {
        const chunkNumber = match.match(/\d+/)?.[0] || '1';
        return `_page_${chunkNumber}`;
      });
      
      // 확장자 추가 (원본 파일 확장자 유지)
      if (!fileName.includes('.')) {
        // 원본 파일명에서 확장자 추출 시도
        const originalFileName = resource.title;
        const lastDotIndex = originalFileName.lastIndexOf('.');
        if (lastDotIndex > 0) {
          const extension = originalFileName.substring(lastDotIndex);
          fileName += extension;
        } else {
          fileName += '.txt'; // 기본값
        }
      }
      
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      console.log(`📥 파일 다운로드 완료: ${fileName}`);
    } catch (error) {
      console.error('❌ 파일 다운로드 실패:', error);
      alert('파일 다운로드 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    }
  };

  // URL 링크 핸들러
  const handleUrlOpen = (resource: ResourceItem) => {
    if (resource.url) {
      console.log(`🌐 웹페이지 열기: ${resource.url}`);
      
      // URL이 상대 경로인 경우 절대 URL로 변환
      let targetUrl = resource.url;
      if (targetUrl.startsWith('/api/') || targetUrl.startsWith('/download/')) {
        // API 경로인 경우 실제 URL로 변환 시도
        console.log('⚠️ API 경로 감지, 실제 URL 찾기 시도');
        // 실제 URL을 찾을 수 없는 경우 알림
        alert('이 문서는 다운로드 전용입니다. 파일 다운로드를 사용해주세요.');
        return;
      }
      
      // URL이 유효한지 확인
      try {
        new URL(targetUrl);
        window.open(targetUrl, '_blank');
      } catch {
        // URL이 유효하지 않은 경우 상대 경로로 처리
        window.open(targetUrl, '_blank');
      }
    } else {
      console.error('웹페이지 URL이 없습니다:', resource);
      alert('열 수 있는 웹페이지 URL을 찾을 수 없습니다.');
    }
  };

  // 실제 소스 데이터를 기반으로 리소스 생성 (중복 제거)
  const generateResourcesFromSources = (): ResourceItem[] => {
    console.log('RelatedResources - sources:', sources); // 디버깅용
    console.log('RelatedResources - sources length:', sources?.length); // 디버깅용
    
    if (!sources || sources.length === 0) {
      console.log('RelatedResources - sources가 없어서 샘플 데이터 사용');
      return sampleResources; // 기본 샘플 데이터 사용
    }

    // 중복 제거를 위한 Map 사용 (제목과 URL을 기준으로 중복 제거)
    const uniqueSources = new Map();
    
    sources
      .filter(source => source && (source.title || source.excerpt)) // 유효한 소스만 필터링
      .forEach((source, index) => {
        const excerpt = source.excerpt || '';
        let title = source.title || `관련 문서 ${index + 1}`;
        
        // 제목 개선 로직
        if (source.sourceType === 'url') {
          // URL 크롤링 데이터: 도메인 + 페이지 제목 + 페이지 번호
          try {
            const url = new URL(source.url || '');
            const domain = url.hostname.replace('www.', '');
            const chunkIndex = source.id?.match(/_chunk_(\d+)/)?.[1] || '0';
            const pageNumber = Math.floor(parseInt(chunkIndex) / 5) + 1;
            
            // 실제 제목이 있는 경우 처리
            let actualTitle = title;
            if (title && !title.startsWith('url_') && title !== source.id) {
              // 제목이 너무 길면 줄이기
              if (actualTitle.length > 50) {
                actualTitle = actualTitle.substring(0, 47) + '...';
              }
            } else {
              // 문서 ID와 제목이 같은 경우 도메인별로 의미있는 제목 생성
              if (domain.includes('facebook.com')) {
                if (url.pathname.includes('/policies/ads')) {
                  actualTitle = 'Facebook 광고 정책';
                } else if (url.pathname.includes('/business/help')) {
                  actualTitle = 'Facebook 비즈니스 도움말';
                } else {
                  actualTitle = 'Facebook 가이드';
                }
              } else if (domain.includes('instagram.com')) {
                if (url.pathname.includes('/help')) {
                  actualTitle = 'Instagram 비즈니스 도움말';
                } else {
                  actualTitle = 'Instagram 비즈니스 가이드';
                }
              } else if (domain.includes('developers.facebook.com')) {
                actualTitle = 'Facebook 개발자 문서';
              } else {
                actualTitle = 'Meta 광고 가이드';
              }
            }
            
            title = `${domain} - ${actualTitle} (${pageNumber}페이지)`;
          } catch {
            const chunkIndex = source.id?.match(/_chunk_(\d+)/)?.[1] || '0';
            const pageNumber = Math.floor(parseInt(chunkIndex) / 5) + 1;
            title = `${title} (${pageNumber}페이지)`;
          }
        } else {
          // 파일 데이터: 파일명 + 페이지 번호
          const chunkIndex = source.id?.match(/_chunk_(\d+)/)?.[1] || '0';
          const pageNumber = Math.floor(parseInt(chunkIndex) / 5) + 1;
          
          // 파일 확장자 제거
          let nameWithoutExt = title.replace(/\.(pdf|docx|txt)$/i, '');
          
          // 파일명이 너무 길면 줄이기
          if (nameWithoutExt.length > 40) {
            nameWithoutExt = nameWithoutExt.substring(0, 37) + '...';
          }
          
          title = `${nameWithoutExt} (${pageNumber}페이지)`;
        }

        // 중복 제거를 위한 키 생성 (제목과 URL 조합)
        const resourceKey = `${title}_${source.url || source.id}`;
        
        if (!uniqueSources.has(resourceKey)) {
          uniqueSources.set(resourceKey, {
            id: source.id || `source-${index}`,
            title: title,
            type: 'document' as const,
            description: '', // 중간 텍스트 제거
            url: source.url || `/api/download/${source.id}`,
            updatedAt: source.updatedAt || new Date().toISOString(),
            content: excerpt,
            tags: ['문서', '관련자료'],
            sourceType: source.sourceType || 'file',
            documentType: source.documentType || 'document',
            similarity: source.similarity // 유사도 정보 추가
          });
        }
      });

    console.log('RelatedResources - 생성된 리소스 수:', uniqueSources.size);
    return Array.from(uniqueSources.values());
  };

  // 표시할 리소스 결정
  const displayResources = resources && resources.length > 0 ? resources : generateResourcesFromSources();

  // 아이콘 반환 함수
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'document':
        return <FileText className="w-4 h-4" />;
      case 'image':
        return <Image className="w-4 h-4" />;
      case 'table':
        return <Table className="w-4 h-4" />;
      case 'guide':
        return <BookOpen className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  // 타입별 색상 반환 함수
  const getTypeColor = (type: string) => {
    switch (type) {
      case 'document':
        return "bg-blue-500";
      case 'image':
        return "bg-green-500";
      case 'table':
        return "bg-purple-500";
      case 'guide':
        return "bg-orange-500";
      default:
        return "bg-gray-500";
    }
  };

  // 확장/축소 토글 함수
  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  if (isLoading) {
    return (
      <Card className="w-full bg-gradient-to-br from-white/95 to-[#FAF8F3]/95 backdrop-blur-sm border-orange-200/30 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center space-x-2 text-gray-800 text-sm font-medium">
            <BookOpen className="w-4 h-4 text-orange-500" />
            <span>관련 자료</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center space-y-3">
              <div className="w-6 h-6 border-2 border-orange-400 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-gray-600">관련 자료를 찾는 중...</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!displayResources || displayResources.length === 0) {
    return (
      <Card className="w-full bg-gradient-to-br from-white/95 to-[#FAF8F3]/95 backdrop-blur-sm border-orange-200/30 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center space-x-2 text-gray-800 text-sm font-medium">
            <BookOpen className="w-4 h-4 text-orange-500" />
            <span>관련 자료</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center space-y-3 text-center">
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-orange-500" />
              </div>
              <h4 className="text-sm font-medium text-gray-700">관련 자료가 없습니다</h4>
              <p className="text-xs text-gray-500">질문에 대한 관련 자료를 찾을 수 없습니다.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 답변 핵심 요약 */}
      {userQuestion && aiResponse && (
        <AnswerSummary 
          aiResponse={aiResponse}
          sources={sources}
          userQuestion={userQuestion}
        />
      )}

      {/* 관련 질문 예측 */}
      {userQuestion && aiResponse && (
        <RelatedQuestions 
          userQuestion={userQuestion}
          aiResponse={aiResponse}
          relatedQuestions={relatedQuestions}
          onQuestionClick={onQuestionClick}
        />
      )}

      {/* 추가 학습 자료 */}
      {userQuestion && aiResponse && (
        <LearningResources 
          userQuestion={userQuestion}
          aiResponse={aiResponse}
        />
      )}

    </div>
  );
}