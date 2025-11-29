"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchWithTimeout } from "@/lib/utils/fetchWithTimeout";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, AlertTriangle, Trash2, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface QueueStats {
  queued: number;
  processing: number;
  failed: number;
  stuck?: number; // 멈춘 작업 개수 (30분 이상 진행 중인 processing 작업)
}

interface QueueSummaryPanelProps {
  selectedVendors?: string[];
}

export default function QueueSummaryPanel({ selectedVendors = [] }: QueueSummaryPanelProps) {
  const supabase = createClient();
  const [processing, setProcessing] = useState(false);

  // 큐 통계 조회
  const { data: stats, refetch, isLoading } = useQuery<QueueStats>({
    queryKey: ['queue-stats', selectedVendors],
    queryFn: async () => {
      // vendor 필터링 (payload JSONB에서)
      if (selectedVendors.length > 0) {
        // Supabase에서는 JSONB 필터링이 복잡하므로 클라이언트에서 필터링
        const { data: allJobs } = await supabase
          .from('processing_jobs')
          .select('status, payload')
          .eq('job_type', 'CRAWL_SEED');
        
        const filteredJobs = (allJobs || []).filter(job => {
          const vendor = job.payload?.vendor;
          return !vendor || selectedVendors.includes(vendor);
        });

        const now = Date.now();
        const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2시간 (10시간 지연 문제 해결)
        
        return {
          queued: filteredJobs.filter(j => ['queued', 'retrying'].includes(j.status)).length,
          processing: filteredJobs.filter(j => j.status === 'processing').length,
          failed: filteredJobs.filter(j => j.status === 'failed').length,
          stuck: filteredJobs.filter(j => 
            j.status === 'processing' && 
            j.payload?.started_at && 
            (now - new Date(j.payload.started_at).getTime()) > STUCK_THRESHOLD_MS
          ).length,
        };
      }

      // 정확한 상태 조회를 위해 개별 쿼리 대신 전체 조회 후 필터링
      const { data: allJobs, error: allJobsError } = await supabase
        .from('processing_jobs')
        .select('id, status, started_at, finished_at')
        .eq('job_type', 'CRAWL_SEED')
        .limit(1000); // 충분한 수의 Seed 크롤 작업 조회
      
      if (allJobsError) {
        console.error('큐 통계 조회 오류:', allJobsError);
        return { queued: 0, processing: 0, failed: 0, stuck: 0 };
      }
      
      const now = Date.now();
      const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2시간 (10시간 지연 문제 해결)
      
      // 상태별 카운트 계산
      const queued = (allJobs || []).filter(j => ['queued', 'retrying'].includes(j.status)).length;
      const processing = (allJobs || []).filter(j => j.status === 'processing').length;
      const failed = (allJobs || []).filter(j => j.status === 'failed').length;
      
      // 멈춘 작업 개수 계산 (2시간 이상 진행 중인 processing 작업)
      const stuck = (allJobs || []).filter(job => {
        if (job.status !== 'processing' || !job.started_at) return false;
        const elapsed = now - new Date(job.started_at).getTime();
        return elapsed > STUCK_THRESHOLD_MS;
      }).length;

      return {
        queued,
        processing,
        failed,
        stuck,
      };
    },
    refetchInterval: 5000, // 5초마다 자동 갱신
  });

  // 즉시 처리
  const handleProcessImmediately = async () => {
    try {
      setProcessing(true);
      const res = await fetchWithTimeout('/api/jobs/consume', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        await refetch();
      }
    } catch (err) {
      console.error('즉시 처리 오류:', err);
      alert('처리 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  // 강제 동기화 (processing_jobs와 documents 테이블 비교)
  const handleForceSync = async () => {
    try {
      setProcessing(true);
      const res = await fetchWithTimeout('/api/admin/force-sync-jobs', { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        alert(`동기화 완료: ${result.synced}개 작업이 완료 상태로 업데이트되었습니다.`);
        await refetch();
        // 페이지 새로고침하여 UI 업데이트
        window.location.reload();
      } else {
        alert(`동기화 실패: ${result.error}`);
      }
    } catch (err) {
      console.error('강제 동기화 오류:', err);
      alert('동기화 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  // 실패 작업 재시작
  const handleRetryFailed = async () => {
    try {
      setProcessing(true);
      // 실패한 작업들을 queued 상태로 변경
      const { data: failedJobs } = await supabase
        .from('processing_jobs')
        .select('id')
        .eq('status', 'failed')
        .limit(10);

      if (!failedJobs || failedJobs.length === 0) {
        alert('재시작할 실패 작업이 없습니다.');
        return;
      }

      for (const job of failedJobs) {
        await fetchWithTimeout('/api/jobs/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: job.id, action: 'retry' })
        });
      }

      alert(`${failedJobs.length}개 실패 작업을 재시작했습니다.`);
      await refetch();
    } catch (err) {
      console.error('실패 재시작 오류:', err);
      alert('재시작 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  // 대기 작업 일괄 삭제
  const handleDeleteQueued = async () => {
    if (!confirm('대기 중인 모든 작업을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    try {
      setProcessing(true);
      const { data: queuedJobs } = await supabase
        .from('processing_jobs')
        .select('id')
        .in('status', ['queued', 'retrying']);

      if (!queuedJobs || queuedJobs.length === 0) {
        alert('삭제할 대기 작업이 없습니다.');
        return;
      }

      const res = await fetchWithTimeout('/api/jobs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: queuedJobs[0].id,
          action: 'delete',
          jobIds: queuedJobs.map(j => j.id)
        })
      });

      const result = await res.json();
      if (result.success) {
        alert(result.message || `${result.deleted}개 작업이 삭제되었습니다.`);
        await refetch();
      } else {
        alert(result.error || '삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('대기 작업 삭제 오류:', err);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  // 실패 작업 일괄 삭제
  const handleDeleteFailed = async () => {
    if (!confirm('실패한 모든 작업을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    try {
      setProcessing(true);
      const { data: failedJobs } = await supabase
        .from('processing_jobs')
        .select('id')
        .eq('status', 'failed');

      if (!failedJobs || failedJobs.length === 0) {
        alert('삭제할 실패 작업이 없습니다.');
        return;
      }

      const res = await fetchWithTimeout('/api/jobs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: failedJobs[0].id,
          action: 'delete',
          jobIds: failedJobs.map(j => j.id)
        })
      });

      const result = await res.json();
      if (result.success) {
        alert(result.message || `${result.deleted}개 작업이 삭제되었습니다.`);
        await refetch();
      } else {
        alert(result.error || '삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('실패 작업 삭제 오류:', err);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  // 멈춘 작업 일괄 삭제 (30분 이상 진행 중인 processing 작업)
  const handleDeleteStuck = async () => {
    if (!confirm('30분 이상 진행 중인 멈춘 작업을 모두 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    try {
      setProcessing(true);
      const now = Date.now();
      const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2시간 (10시간 지연 문제 해결)
      
      const { data: allProcessingJobs } = await supabase
        .from('processing_jobs')
        .select('id, started_at')
        .eq('status', 'processing')
        .not('started_at', 'is', null);

      if (!allProcessingJobs || allProcessingJobs.length === 0) {
        alert('삭제할 멈춘 작업이 없습니다.');
        return;
      }

      const stuckJobs = allProcessingJobs.filter(job => {
        if (!job.started_at) return false;
        const elapsed = now - new Date(job.started_at).getTime();
        return elapsed > STUCK_THRESHOLD_MS;
      });

      if (stuckJobs.length === 0) {
        alert('30분 이상 진행 중인 멈춘 작업이 없습니다.');
        return;
      }

      const res = await fetchWithTimeout('/api/jobs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: stuckJobs[0].id,
          action: 'delete',
          jobIds: stuckJobs.map(j => j.id)
        })
      });

      const result = await res.json();
      if (result.success) {
        alert(result.message || `${result.deleted}개 멈춘 작업이 삭제되었습니다.`);
        await refetch();
      } else {
        alert(result.error || '삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('멈춘 작업 삭제 오류:', err);
      alert('삭제 중 오류가 발생했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  const queueStats = stats || { queued: 0, processing: 0, failed: 0, stuck: 0 };

  return (
    <Card className="card-enhanced bg-gradient-to-br from-slate-900/80 via-slate-900/60 to-slate-950/90 border border-white/10 shadow-xl text-sm text-gray-200">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-blue-400" />
          처리 큐 (요약)
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading || processing}
            className="h-7 w-7 p-0 ml-2 hover:bg-gray-700/50"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {selectedVendors.length > 0 && (
          <div className="font-medium text-gray-300 mb-3 pb-3 border-b border-gray-700/50">
            선택 벤더: <span className="text-blue-300">{selectedVendors.join(', ')}</span>
          </div>
        )}

        {/* 상태 카드 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="flex items-center justify-between p-4 bg-blue-500/15 rounded-lg border border-blue-500/30 hover:border-blue-500/50 transition-all text-sm">
            <div>
              <div className="text-3xl font-bold text-white mb-1">{queueStats.queued}</div>
              <div className="text-xs font-semibold text-gray-300 uppercase tracking-wide">대기</div>
            </div>
            <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center border border-blue-500/30">
              <AlertTriangle className="w-5 h-5 text-blue-400" />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-purple-500/15 rounded-lg border border-purple-500/30 hover:border-purple-500/50 transition-all text-sm">
            <div>
              <div className="text-3xl font-bold text-white mb-1">{queueStats.processing}</div>
              <div className="text-xs font-semibold text-gray-300 uppercase tracking-wide">진행 중</div>
            </div>
            <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center border border-purple-500/30">
              <RefreshCw className={`w-5 h-5 text-purple-400 ${queueStats.processing > 0 ? 'animate-spin' : ''}`} />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-red-500/15 rounded-lg border border-red-500/30 hover:border-red-500/50 transition-all text-sm">
            <div>
              <div className="text-3xl font-bold text-white mb-1">{queueStats.failed}</div>
              <div className="text-xs font-semibold text-gray-300 uppercase tracking-wide">실패</div>
            </div>
            <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center border border-red-500/30">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="space-y-3 pt-2 border-t border-gray-700/50">
          <Button
            onClick={handleProcessImmediately}
            disabled={processing || queueStats.queued === 0}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold h-11"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${processing ? 'animate-spin' : ''}`} />
            즉시 처리
          </Button>
          
          <Button
            onClick={handleForceSync}
            disabled={processing}
            variant="outline"
            className="w-full bg-orange-900/20 border-orange-600/50 text-orange-300 hover:bg-orange-800/30 hover:text-orange-200 h-10 font-semibold"
            title="processing_jobs와 documents 테이블을 비교하여 실제로 완료된 작업을 강제로 동기화합니다"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${processing ? 'animate-spin' : ''}`} />
            강제 동기화 (재배포 불필요)
          </Button>
          
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={handleRetryFailed}
              disabled={processing || queueStats.failed === 0}
              variant="outline"
              className="bg-gray-800/50 border-gray-600 text-white hover:bg-gray-700/50 h-10"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              실패 재시작
            </Button>
            
            <Button
              onClick={handleDeleteFailed}
              disabled={processing || queueStats.failed === 0}
              variant="outline"
              className="bg-gray-800/50 border-gray-600 text-white hover:bg-gray-700/50 text-red-300 hover:text-red-200 h-10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              실패 삭제
            </Button>
          </div>

          {(queueStats.stuck ?? 0) > 0 && (
            <Button
              onClick={handleDeleteStuck}
              disabled={processing}
              variant="outline"
              className="w-full bg-gray-800/50 border-orange-600/50 text-white hover:bg-orange-700/20 text-orange-300 hover:text-orange-200 h-10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              멈춘 작업 삭제 ({queueStats.stuck ?? 0}개)
            </Button>
          )}

          {queueStats.queued > 0 && (
            <Button
              onClick={handleDeleteQueued}
              disabled={processing}
              variant="outline"
              className="w-full bg-gray-800/50 border-gray-600 text-white hover:bg-gray-700/50 text-orange-300 hover:text-orange-200 h-10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              대기 작업 삭제 ({queueStats.queued}개)
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

