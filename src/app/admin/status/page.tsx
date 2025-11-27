'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle, Clock, AlertCircle, FileText, Database } from 'lucide-react';
import { fetchWithTimeout } from '@/lib/utils/fetchWithTimeout';

interface DocumentStatus {
  id: string;
  title: string;
  url: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
  actual_chunk_count: number;
  metadata_status: string;
  metadata_chunk_count: number;
  processed_at?: string;
}

interface StatusStats {
  total: number;
  completed: number;
  pending: number;
  processing: number;
  totalChunks: number;
}

export default function StatusPage() {
  const [documents, setDocuments] = useState<DocumentStatus[]>([]);
  const [stats, setStats] = useState<StatusStats>({
    total: 0,
    completed: 0,
    pending: 0,
    processing: 0,
    totalChunks: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetchWithTimeout('/api/admin/status');
      const data = await response.json();
      
      if (data.success) {
        setDocuments(data.documents);
        setStats(data.stats);
      } else {
        setError(data.error || '상태 조회에 실패했습니다.');
      }
    } catch (err) {
      setError('상태 조회 중 오류가 발생했습니다.');
      console.error('Status fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'indexed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'processing':
        return <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />;
      default:
        return <AlertCircle className="w-4 h-4 text-red-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'indexed':
        return <Badge className="bg-green-100 text-green-800">완료</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800">대기</Badge>;
      case 'processing':
        return <Badge className="bg-blue-100 text-blue-800">처리중</Badge>;
      default:
        return <Badge className="bg-red-100 text-red-800">오류</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ko-KR');
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">문서 인덱싱 상태</h1>
          <Button onClick={fetchStatus} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </Button>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="w-5 h-5" />
                총 문서
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle className="w-5 h-5 text-green-600" />
                완료
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="w-5 h-5 text-yellow-600" />
                대기
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <RefreshCw className="w-5 h-5 text-blue-600" />
                처리중
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{stats.processing}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="w-5 h-5" />
                총 청크
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalChunks}</div>
            </CardContent>
          </Card>
        </div>

        {/* 오류 메시지 */}
        {error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-red-800">
                <AlertCircle className="w-5 h-5" />
                {error}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 문서 목록 */}
        <Card>
          <CardHeader>
            <CardTitle>문서 상세 상태</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
                <p>상태를 조회하는 중...</p>
              </div>
            ) : (
              <div className="space-y-4">
                {documents.map((doc) => (
                  <div key={doc.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="font-medium text-lg">{doc.title}</h3>
                        <p className="text-sm text-gray-600 break-all">{doc.url}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(doc.status)}
                        {getStatusBadge(doc.status)}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="font-medium">타입:</span> {doc.type}
                      </div>
                      <div>
                        <span className="font-medium">실제 청크:</span> {doc.actual_chunk_count}개
                      </div>
                      <div>
                        <span className="font-medium">메타데이터 청크:</span> {doc.metadata_chunk_count}개
                      </div>
                      <div>
                        <span className="font-medium">메타데이터 상태:</span> {doc.metadata_status}
                      </div>
                    </div>
                    
                    <div className="mt-2 text-xs text-gray-500">
                      <div>생성: {formatDate(doc.created_at)}</div>
                      <div>수정: {formatDate(doc.updated_at)}</div>
                      {doc.processed_at && (
                        <div>처리완료: {formatDate(doc.processed_at)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

