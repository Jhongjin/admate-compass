'use client';

import { useState } from 'react';
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
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "indexed":
      case "completed":
        return <CheckCircle className="w-4 h-4 text-green-300" />;
      case "indexing":
      case "crawling":
      case "processing":
        return <RefreshCw className="w-4 h-4 text-blue-300 animate-spin" />;
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
        return "크롤링";
      case "processing":
        return "처리중";
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

  const getSourceText = (source: string) => {
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
        return '알 수 없음';
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
    <div className="space-y-4">
      {/* 전체선택 및 선택삭제 헤더 */}
      <Card className="bg-gray-800/50 border-gray-700">
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
        <Card key={group.domain} className="bg-gray-800/50 border-gray-700 hover:bg-gray-800/70 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3 flex-1 min-w-0">
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
                
                <div className="flex-1 min-w-0">
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
                      className="p-1 h-6 w-6 hover:bg-gray-700/50"
                    >
                      {selectedDocuments?.has(group.mainDocument.id) && 
                       group.subPages.every((sub: GroupedDocument) => selectedDocuments?.has(sub.id)) ? (
                        <Check className="w-4 h-4 text-blue-400" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400" />
                      )}
                    </Button>
                    <h3 className="font-semibold text-white text-lg truncate">
                      {group.mainDocument.title}
                    </h3>
                    <a 
                      href={group.mainDocument.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-blue-400 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                  <p className="text-sm text-gray-400 truncate">{group.domain}</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="flex items-center space-x-2">
                    {getStatusIcon(group.mainDocument.status)}
                    <span className="text-sm text-gray-300">
                      {getStatusText(group.mainDocument.status)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    총 {group.totalChunks}개 청크
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
                          onClick={() => onReindexDocument(group.mainDocument.id, group.mainDocument.title)}
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
                          disabled={deletingDocument === group.mainDocument.id}
                          className="text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                        >
                          {deletingDocument === group.mainDocument.id ? (
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
                            className="flex items-center space-x-3 p-3 bg-gray-700/30 rounded-lg hover:bg-gray-700/50 transition-colors"
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
                              
                              <div className="flex items-center space-x-3 text-xs text-gray-400">
                                <div className="flex items-center space-x-1">
                                  {getStatusIcon(subPage.status)}
                                  <span>{getStatusText(subPage.status)}</span>
                                </div>
                                <span>{subPage.chunk_count}개 청크</span>
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
                                      onClick={() => onReindexDocument(subPage.id, subPage.title)}
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
                                      disabled={deletingDocument === subPage.id}
                                      className="text-gray-400 hover:text-red-400 hover:bg-red-500/10 p-1"
                                    >
                                      {deletingDocument === subPage.id ? (
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
      ))}
    </div>
  );
}


