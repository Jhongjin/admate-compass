'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
  Download,
  Eye,
  Trash2,
  Globe,
  Link,
  CheckCircle2,
  Check,
  Square
} from 'lucide-react';

interface CrawlJobStatus {
  status: 'queued' | 'retrying' | 'processing' | 'completed' | 'failed';
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
}

interface GroupedDocument {
  id: string;
  title: string;
  url: string;
  type: string;
  status: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  isMainUrl: boolean;
  parentUrl?: string;
  crawlJobStatus?: CrawlJobStatus | null;
  discoveredUrls?: Array<{
    url: string;
    title?: string;
    source: 'sitemap' | 'robots' | 'links' | 'pattern';
    depth: number;
  }>;
}

interface DocumentGroup {
  domain: string;
  mainUrl: string;
  mainDocument: GroupedDocument;
  subPages: GroupedDocument[];
  totalChunks: number;
  isExpanded: boolean;
  selectedSubPages: string[];
}

interface GroupedDocumentListProps {
  groups: DocumentGroup[];
  onToggleGroupExpansion: (groupIndex: number) => void;
  onToggleSubPageSelection: (groupIndex: number, subPageUrl: string) => void;
  onToggleAllSubPages: (groupIndex: number) => void;
  onReindexDocument: (id: string, title: string) => void;
  onDownloadDocument: (id: string, title: string) => void;
  onDeleteDocument: (id: string, title: string) => void;
  onSelectAll: () => void;
  onSelectDocument: (id: string | string[]) => void;
  onBulkDelete: () => void;
  selectedDocuments: Set<string>;
  isAllSelected: boolean;
  actionLoading: { [key: string]: boolean };
  deletingDocument: string | null;
}

export default function GroupedDocumentList({
  groups,
  onToggleGroupExpansion,
  onToggleSubPageSelection,
  onToggleAllSubPages,
  onReindexDocument,
  onDownloadDocument,
  onDeleteDocument,
  onSelectAll,
  onSelectDocument,
  onBulkDelete,
  selectedDocuments,
  isAllSelected,
  actionLoading,
  deletingDocument
}: GroupedDocumentListProps) {

  // 디버깅: 컴포넌트 마운트 시 onReindexDocument 확인
  useEffect(() => {
    console.log('🔍 [GroupedDocumentList] 컴포넌트 마운트됨');
    console.log('🔍 [GroupedDocumentList] onReindexDocument 타입:', typeof onReindexDocument);
    console.log('🔍 [GroupedDocumentList] onReindexDocument 값:', onReindexDocument);
    console.log('🔍 [GroupedDocumentList] onReindexDocument 함수 본문:', onReindexDocument?.toString?.()?.substring(0, 500));
  }, [onReindexDocument]);

  // 크롤링 작업 상태를 우선적으로 확인하는 헬퍼 함수
  const getEffectiveStatus = (doc: GroupedDocument): { status: string; isCrawling: boolean } => {
    // 🔥 크롤링 작업 상태가 있으면 우선 사용 (processing_jobs가 진실의 소스)
    if (doc.crawlJobStatus) {
      const jobStatus = doc.crawlJobStatus.status;
      if (jobStatus === 'queued' || jobStatus === 'retrying') {
        return { status: 'queued', isCrawling: true };
      } else if (jobStatus === 'processing') {
        // processing_jobs가 processing이면 무조건 '처리중'으로 표시
        return { status: 'processing', isCrawling: true };
      } else if (jobStatus === 'completed') {
        return { status: 'completed', isCrawling: false };
      } else if (jobStatus === 'failed') {
        return { status: 'failed', isCrawling: false };
      }
    }

    // 크롤링 작업 상태가 없으면 문서 상태 사용
    // 🔥 pending 상태 문서도 처리 중일 수 있으므로 processing_jobs 확인 필요
    // 하지만 여기서는 문서 상태만 사용 (프론트엔드에서 polling으로 업데이트)
    if (doc.status === 'pending') {
      // pending 상태는 '대기'로 표시하되, 실제로는 큐에서 처리 중일 수 있음
      return { status: 'pending', isCrawling: false };
    }

    return { status: doc.status, isCrawling: false };
  };

  const getStatusIcon = (status: string, isCrawling: boolean = false) => {
    switch (status) {
      case "indexed":
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-300" />;
      case "indexing":
      case "crawling":
      case "processing":
        return <RefreshCw className={`w-4 h-4 text-blue-300 ${isCrawling ? 'animate-spin' : ''}`} />;
      case "queued":
        return <Clock className="w-4 h-4 text-gray-300" />;
      case "error":
        return <AlertTriangle className="w-4 h-4 text-yellow-300" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-300" />;
      default:
        return <Clock className="w-4 h-4 text-gray-300" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "indexed":
      case "completed":
        return "완료";
      case "indexing":
        return "인덱싱";
      case "crawling":
        return "크롤링 중";
      case "processing":
        return "처리중";
      case "queued":
      case "pending":
        return "대기";
      case "error":
        return "오류";
      case "failed":
        return "실패";
      default:
        return "대기";
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'sitemap':
        return <FileText className="w-3 h-3 text-blue-400" />;
      case 'robots':
        return <Globe className="w-3 h-3 text-green-400" />;
      case 'links':
        return <Link className="w-3 h-3 text-purple-400" />;
      case 'pattern':
        return <CheckCircle2 className="w-3 h-3 text-orange-400" />;
      default:
        return <FileText className="w-3 h-3 text-gray-400" />;
    }
  };

  const getSourceText = (source: string | null | undefined) => {
    if (!source) return '알 수 없음';
    switch (source) {
      case 'sitemap':
        return 'Sitemap';
      case 'robots':
        return 'Robots.txt';
      case 'links':
        return '페이지 링크';
      case 'pattern':
        return 'URL 패턴';
      default:
        // URL일 경우 도메인 표시
        try {
          if (source.startsWith('http')) {
            return new URL(source).hostname;
          }
        } catch (e) { }
        return source;
    }
  };

  if (groups.length === 0) {
    return (
      <Card className="bg-gray-800/50 border-gray-700">
        <CardContent className="p-8 text-center">
          <FileText className="w-12 h-12 text-gray-500 mx-auto mb-4" />
          <p className="text-gray-400">크롤링된 URL 문서가 없습니다.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 w-full max-w-full overflow-hidden">
      {/* 전체선택 및 선택삭제 헤더 */}
      <Card className="bg-[#131823] border border-white/5">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={onSelectAll}
                className="p-2 hover:bg-gray-700/50"
              >
                {isAllSelected ? (
                  <Check className="w-4 h-4 text-blue-400" />
                ) : (
                  <Square className="w-4 h-4 text-gray-400" />
                )}
              </Button>
              <span className="text-sm text-gray-300">
                {isAllSelected ? '전체 해제' : '전체 선택'}
              </span>
            </div>

            {selectedDocuments && selectedDocuments.size > 0 && (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-300">
                  {selectedDocuments.size}개 선택됨
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('🗑️ [GroupedDocumentList] 선택 삭제 버튼 클릭됨');
                    console.log('🗑️ [GroupedDocumentList] selectedDocuments:', selectedDocuments);
                    console.log('🗑️ [GroupedDocumentList] selectedDocuments.size:', selectedDocuments?.size);
                    console.log('🗑️ [GroupedDocumentList] onBulkDelete 함수 존재:', !!onBulkDelete);
                    console.log('🗑️ [GroupedDocumentList] onBulkDelete 타입:', typeof onBulkDelete);
                    console.log('🗑️ [GroupedDocumentList] onBulkDelete 함수 내용:', onBulkDelete?.toString().substring(0, 200));

                    if (onBulkDelete) {
                      console.log('🗑️ [GroupedDocumentList] onBulkDelete 직접 호출 시작');
                      try {
                        onBulkDelete();
                        console.log('🗑️ [GroupedDocumentList] onBulkDelete 호출 완료');
                      } catch (error) {
                        console.error('❌ [GroupedDocumentList] onBulkDelete 호출 중 오류:', error);
                      }
                    } else {
                      console.error('❌ [GroupedDocumentList] onBulkDelete 함수가 전달되지 않음');
                    }
                  }}
                  className="h-8 px-4"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  선택 삭제
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {groups.map((group, groupIndex) => (
        <Card key={group.domain} className="bg-[#131823] border border-white/5 hover:bg-white/[0.02] transition-colors w-full max-w-full overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between w-full max-w-full overflow-hidden">
              <div className="flex items-center space-x-3 flex-1 min-w-0 max-w-full overflow-hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onToggleGroupExpansion(groupIndex)}
                  className="p-1 hover:bg-gray-700/50"
                >
                  {group.isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  )}
                </Button>

                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <Globe className="w-5 h-5 text-white" />
                </div>

                <div className="flex-1 min-w-0 max-w-full">
                  <div className="flex items-center space-x-2 mb-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        // 그룹 전체 선택/해제를 위한 모든 ID 수집
                        const allIds = [group.mainDocument.id, ...group.subPages.map((sub: GroupedDocument) => sub.id)];
                        const allSelected = allIds.every(id => selectedDocuments?.has(id));

                        // 한 번에 모든 ID를 배열로 전달하여 처리
                        if (allSelected) {
                          // 모두 선택되어 있으면 해제 - 배열로 전달
                          onSelectDocument(allIds);
                        } else {
                          // 일부만 선택되어 있거나 모두 해제되어 있으면 전체 선택 - 배열로 전달
                          onSelectDocument(allIds);
                        }
                      }}
                      className="p-1 h-6 w-6 hover:bg-gray-700/50 flex-shrink-0"
                    >
                      {selectedDocuments?.has(group.mainDocument.id) &&
                        group.subPages.every((sub: GroupedDocument) => selectedDocuments?.has(sub.id)) ? (
                        <Check className="w-4 h-4 text-blue-400" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400" />
                      )}
                    </Button>
                    <div className="p-2 rounded-lg bg-white/5 mr-2 flex-shrink-0">
                      <Globe className="w-4 h-4 text-green-400" />
                    </div>
                    <h3 className="font-semibold text-white text-sm truncate min-w-0 flex-1">
                      {group.mainDocument.title}
                    </h3>
                    <a
                      href={group.mainDocument.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-blue-400 transition-colors flex-shrink-0"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                  <div className="flex items-center space-x-4 text-xs text-gray-400 mt-1">
                    <p className="truncate text-left max-w-[400px] min-w-0" title={group.mainDocument?.url || group.mainUrl}>
                      {(() => {
                        const url = group.mainDocument?.url || group.mainUrl;
                        if (url.length > 50) {
                          return url.substring(0, 50) + '...';
                        }
                        return url;
                      })()}
                    </p>
                    {group.mainDocument.created_at && (
                      <span className="whitespace-nowrap flex-shrink-0">
                        {new Date(group.mainDocument.created_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="flex items-center space-x-2">
                    {(() => {
                      // 크롤링 작업 상태 우선 확인
                      const effectiveStatus = getEffectiveStatus(group.mainDocument);

                      // 하위 페이지가 모두 완료되었는지 확인
                      const allSubPagesCompleted = group.subPages.length > 0 &&
                        group.subPages.every((sub: GroupedDocument) => {
                          const subEffectiveStatus = getEffectiveStatus(sub);
                          return subEffectiveStatus.status === 'indexed' ||
                            subEffectiveStatus.status === 'completed';
                        });

                      // 메인 문서가 처리중이지만 하위 페이지가 모두 완료된 경우 → 완료로 표시
                      const isMainProcessing = effectiveStatus.status === 'processing' ||
                        effectiveStatus.status === 'indexing' ||
                        effectiveStatus.status === 'crawling';

                      const shouldShowCompleted = isMainProcessing && allSubPagesCompleted;
                      const displayStatus = shouldShowCompleted ? 'indexed' : effectiveStatus.status;
                      const isCrawling = effectiveStatus.isCrawling && displayStatus === 'crawling';

                      return (
                        <>
                          {getStatusIcon(displayStatus, isCrawling)}
                          <span className="text-sm text-gray-300">
                            {getStatusText(displayStatus)}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {group.totalChunks}개 청크
                  </p>
                </div>

                <div className="flex items-center space-x-1">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* URL 크롤링 문서는 다운로드 기능 숨김 */}
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>다운로드</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            console.log('🔄 [GroupedDocumentList] 메인 문서 재인덱싱 버튼 클릭:', { id: group.mainDocument.id, title: group.mainDocument.title, status: group.mainDocument.status });
                            console.log('🔄 [GroupedDocumentList] onReindexDocument 타입:', typeof onReindexDocument);
                            console.log('🔄 [GroupedDocumentList] onReindexDocument 값:', onReindexDocument);
                            console.log('🔄 [GroupedDocumentList] onReindexDocument 함수 본문:', onReindexDocument?.toString?.()?.substring(0, 500));

                            if (!onReindexDocument) {
                              console.error('❌ [GroupedDocumentList] onReindexDocument 핸들러가 없음');
                              alert('재인덱싱 핸들러가 연결되지 않았습니다. 페이지를 새로고침해주세요.');
                              return;
                            }

                            if (typeof onReindexDocument !== 'function') {
                              console.error('❌ [GroupedDocumentList] onReindexDocument가 함수가 아님:', typeof onReindexDocument);
                              alert(`재인덱싱 핸들러가 함수가 아닙니다: ${typeof onReindexDocument}`);
                              return;
                            }

                            try {
                              console.log('🔄 [GroupedDocumentList] onReindexDocument 호출 시작:', { id: group.mainDocument.id, title: group.mainDocument.title });
                              onReindexDocument(group.mainDocument.id, group.mainDocument.title);
                              console.log('🔄 [GroupedDocumentList] onReindexDocument 호출 완료');
                            } catch (error) {
                              console.error('❌ [GroupedDocumentList] onReindexDocument 호출 중 에러:', error);
                              console.error('❌ [GroupedDocumentList] 에러 스택:', error instanceof Error ? error.stack : 'No stack');
                              alert(`재인덱싱 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
                            }
                          }}
                          disabled={actionLoading[`${group.mainDocument.id}_reindex`] || group.mainDocument.status === "processing"}
                          className="text-gray-400 hover:text-blue-400 hover:bg-blue-500/10"
                        >
                          {actionLoading[`${group.mainDocument.id}_reindex`] ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>재인덱싱</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDeleteDocument(group.mainDocument.id, group.mainDocument.title)}
                          disabled={actionLoading[`${group.mainDocument.id}_delete`] || group.mainDocument.status === "processing"}
                          className="text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                        >
                          {actionLoading[`${group.mainDocument.id}_delete`] ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>삭제</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </div>
          </CardHeader>

          <AnimatePresence>
            {group.isExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                <CardContent className="pt-0">
                  {group.subPages.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-gray-300">
                          하위 페이지 ({group.subPages.length}개)
                        </h4>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              // 하위 페이지 전체 선택/해제
                              const allSubPageIds = group.subPages.map(sub => sub.id);
                              const allSelected = allSubPageIds.every(id => selectedDocuments?.has(id));

                              if (allSelected) {
                                // 모두 선택되어 있으면 해제
                                allSubPageIds.forEach(id => onSelectDocument(id));
                              } else {
                                // 일부만 선택되어 있으면 전체 선택
                                allSubPageIds.forEach(id => onSelectDocument(id));
                              }
                            }}
                            className="p-1 h-6 w-6 hover:bg-gray-700/50"
                          >
                            {group.subPages.every(sub => selectedDocuments?.has(sub.id)) ? (
                              <Check className="w-4 h-4 text-blue-400" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-400" />
                            )}
                          </Button>
                          <span className="text-xs text-gray-400">전체 선택</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {group.subPages.map((subPage, subIndex) => (
                          <motion.div
                            key={subPage.id}
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: subIndex * 0.05 }}
                            className="flex items-center space-x-3 p-3 bg-white/[0.02] rounded-lg hover:bg-white/[0.03] transition-colors border border-white/5"
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onSelectDocument(subPage.id)}
                              className="p-1 h-6 w-6 hover:bg-gray-700/50"
                            >
                              {selectedDocuments?.has(subPage.id) ? (
                                <Check className="w-4 h-4 text-blue-400" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-400" />
                              )}
                            </Button>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2 mb-1">
                                <div className="p-1.5 rounded bg-white/5 mr-1">
                                  <Globe className="w-3 h-3 text-green-400" />
                                </div>
                                <p className="text-sm font-medium text-white truncate">
                                  {subPage.title}
                                </p>
                                <a
                                  href={subPage.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 hover:text-blue-400 transition-colors"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>

                              <div className="flex items-center space-x-3 text-xs text-gray-400 mt-1">
                                <div className="flex items-center space-x-1">
                                  {(() => {
                                    const effectiveStatus = getEffectiveStatus(subPage);
                                    return (
                                      <>
                                        {getStatusIcon(effectiveStatus.status, effectiveStatus.isCrawling && effectiveStatus.status === 'crawling')}
                                        <span>{getStatusText(effectiveStatus.status)}</span>
                                      </>
                                    );
                                  })()}
                                </div>
                                <span>{subPage.chunk_count}개 청크</span>
                                {subPage.created_at && (
                                  <span className="whitespace-nowrap">
                                    {new Date(subPage.created_at).toLocaleDateString()}
                                  </span>
                                )}
                                {subPage.discoveredUrls && subPage.discoveredUrls.length > 0 && (
                                  <div className="flex items-center space-x-1">
                                    {getSourceIcon(subPage.discoveredUrls[0].source)}
                                    <span>{getSourceText(subPage.discoveredUrls[0].source)}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center space-x-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    {/* URL 크롤링 문서는 다운로드 기능 숨김 */}
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>다운로드</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>

                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        console.log('🔄 [GroupedDocumentList] 재인덱싱 버튼 클릭:', { id: subPage.id, title: subPage.title, status: subPage.status });
                                        console.log('🔄 [GroupedDocumentList] onReindexDocument 타입:', typeof onReindexDocument);
                                        console.log('🔄 [GroupedDocumentList] onReindexDocument 값:', onReindexDocument);
                                        console.log('🔄 [GroupedDocumentList] onReindexDocument 함수 본문:', onReindexDocument?.toString?.()?.substring(0, 500));

                                        if (!onReindexDocument) {
                                          console.error('❌ [GroupedDocumentList] onReindexDocument 핸들러가 없음');
                                          alert('재인덱싱 핸들러가 연결되지 않았습니다. 페이지를 새로고침해주세요.');
                                          return;
                                        }

                                        if (typeof onReindexDocument !== 'function') {
                                          console.error('❌ [GroupedDocumentList] onReindexDocument가 함수가 아님:', typeof onReindexDocument);
                                          alert(`재인덱싱 핸들러가 함수가 아닙니다: ${typeof onReindexDocument}`);
                                          return;
                                        }

                                        try {
                                          console.log('🔄 [GroupedDocumentList] onReindexDocument 호출 시작:', { id: subPage.id, title: subPage.title });
                                          onReindexDocument(subPage.id, subPage.title);
                                          console.log('🔄 [GroupedDocumentList] onReindexDocument 호출 완료');
                                        } catch (error) {
                                          console.error('❌ [GroupedDocumentList] onReindexDocument 호출 중 에러:', error);
                                          console.error('❌ [GroupedDocumentList] 에러 스택:', error instanceof Error ? error.stack : 'No stack');
                                          alert(`재인덱싱 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`);
                                        }
                                      }}
                                      disabled={actionLoading[`${subPage.id}_reindex`] || subPage.status === "processing"}
                                      className="text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 p-1"
                                    >
                                      {actionLoading[`${subPage.id}_reindex`] ? (
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <RefreshCw className="w-3 h-3" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>재인덱싱</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>

                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => onDeleteDocument(subPage.id, subPage.title)}
                                      disabled={actionLoading[`${subPage.id}_delete`] || subPage.status === "processing"}
                                      className="text-gray-400 hover:text-red-400 hover:bg-red-500/10 p-1"
                                    >
                                      {actionLoading[`${subPage.id}_delete`] ? (
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="w-3 h-3" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>삭제</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {group.subPages.length === 0 && (
                    <div className="text-center py-4">
                      <p className="text-sm text-gray-400">하위 페이지가 없습니다.</p>
                    </div>
                  )}
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      ))
      }
    </div >
  );
}


