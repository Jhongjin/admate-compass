"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchWithTimeout } from "@/lib/utils/fetchWithTimeout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Play, AlertTriangle, RotateCcw, XCircle, Trash2, ChevronDown, ChevronUp, Activity } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Job {
  id: string;
  document_id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  priority: number;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  result?: {
    url?: string;
    documentId?: string;
    title?: string;
    chunkCount?: number;
    subPageProgress?: {
      processed: number;
      total: number;
    };
    subPages?: Array<{ url: string; success: boolean; chunkCount?: number; error?: string }>;
  };
}

interface QueueMonitoringPanelProps {
  vendors?: string[];
  defaultOpen?: boolean;
}

export default function QueueMonitoringPanel({ vendors = [], defaultOpen = false }: QueueMonitoringPanelProps) {
  const supabase = createClient();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [consuming, setConsuming] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return defaultOpen;
    const saved = window.localStorage.getItem('queueMonitoringOpen');
    return saved !== null ? saved === 'true' : defaultOpen;
  });

  // 로컬 스토리지에 상태 저장
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('queueMonitoringOpen', String(isOpen));
    }
  }, [isOpen]);

  const loadJobs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('processing_jobs')
        .select('id, document_id, job_type, status, attempts, max_attempts, priority, scheduled_at, started_at, finished_at, result')
        .order('scheduled_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      setJobs(data || []);
    } catch (err) {
      console.error('큐 조회 오류:', err);
    } finally {
      setLoading(false);
    }
  };

  // GMT+9 Seoul 시간으로 변환
  const formatToSeoulTime = (dateString: string | null): string => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return dateString;
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadJobs();
      const interval = setInterval(loadJobs, 10000); // 10초마다 자동 새로고침
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const consumeOne = async () => {
    try {
      setConsuming(true);
      const res = await fetchWithTimeout('/api/jobs/consume', { method: 'POST' });
      await res.json();
      await loadJobs();
    } catch (err) {
      console.error('consume 호출 오류:', err);
    } finally {
      setConsuming(false);
    }
  };

  const postAction = async (jobId: string, action: 'retry' | 'cancel' | 'reprocess' | 'delete') => {
    try {
      if (action === 'delete') {
        if (!confirm('이 작업을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.')) {
          return;
        }
      }
      
      const res = await fetchWithTimeout('/api/jobs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, action })
      });
      
      const result = await res.json();
      if (result.success) {
        if (action === 'delete') {
          alert(result.message || '작업이 삭제되었습니다.');
        }
        await loadJobs();
        setSelectedJobs(new Set());
      } else {
        alert(result.error || '작업 실행에 실패했습니다.');
      }
    } catch (err) {
      console.error('job action 오류:', err);
      alert('작업 실행 중 오류가 발생했습니다.');
    }
  };

  const deleteSelectedJobs = async () => {
    if (selectedJobs.size === 0) {
      alert('삭제할 작업을 선택해주세요.');
      return;
    }

    const jobIds = Array.from(selectedJobs);
    // 멈춘 작업 감지: processing 상태이지만 started_at이 30분 이상 지난 경우
    const stuckJobs = jobs.filter(j => 
      jobIds.includes(j.id) && 
      j.status === 'processing' && 
      j.started_at && 
      (Date.now() - new Date(j.started_at).getTime()) > 30 * 60 * 1000
    );
    
    const deletableJobs = jobs.filter(j => {
      if (!jobIds.includes(j.id)) return false;
      // 일반 삭제 가능한 상태
      if (['queued', 'failed', 'cancelled', 'retrying'].includes(j.status)) return true;
      // 멈춘 작업
      if (j.status === 'processing' && j.started_at && 
          (Date.now() - new Date(j.started_at).getTime()) > 30 * 60 * 1000) return true;
      return false;
    });

    if (deletableJobs.length === 0) {
      alert('삭제 가능한 작업이 없습니다. (대기, 실패, 취소, 재시도 중인 작업 또는 30분 이상 진행 중인 멈춘 작업만 삭제 가능)');
      return;
    }

    const stuckCount = stuckJobs.length;
    const normalCount = deletableJobs.length - stuckCount;
    const confirmMessage = stuckCount > 0
      ? `${deletableJobs.length}개 작업을 삭제하시겠습니까?\n\n- 일반 작업: ${normalCount}개\n- 멈춘 작업: ${stuckCount}개\n\n이 작업은 되돌릴 수 없습니다.`
      : `${deletableJobs.length}개 작업을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      // 멈춘 작업은 먼저 cancelled 상태로 변경 후 삭제
      if (stuckCount > 0) {
        const stuckJobIds = stuckJobs.map(j => j.id);
        const { error: cancelError } = await supabase
          .from('processing_jobs')
          .update({ status: 'cancelled', finished_at: new Date().toISOString() })
          .in('id', stuckJobIds)
          .eq('status', 'processing');
        
        if (cancelError) {
          console.warn('멈춘 작업 취소 오류:', cancelError);
        }
      }

      const res = await fetchWithTimeout('/api/jobs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          jobId: deletableJobs[0].id,
          action: 'delete',
          jobIds: deletableJobs.map(j => j.id)
        })
      });

      const result = await res.json();
      if (result.success) {
        alert(result.message || `${result.deleted}개 작업이 삭제되었습니다.`);
        await loadJobs();
        setSelectedJobs(new Set());
      } else {
        alert(result.error || '삭제에 실패했습니다.');
      }
    } catch (err) {
      console.error('일괄 삭제 오류:', err);
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  const toggleJobSelection = (jobId: string) => {
    const newSelected = new Set(selectedJobs);
    if (newSelected.has(jobId)) {
      newSelected.delete(jobId);
    } else {
      newSelected.add(jobId);
    }
    setSelectedJobs(newSelected);
  };

  const selectJobsByStatus = (status: string) => {
    const newSelected = new Set(selectedJobs);
    jobs.forEach(job => {
      if (status === 'stuck') {
        // 멈춘 작업 선택: processing 상태이지만 started_at이 30분 이상 지난 경우
        if (job.status === 'processing' && job.started_at && 
            (Date.now() - new Date(job.started_at).getTime()) > 30 * 60 * 1000) {
          newSelected.add(job.id);
        }
      } else if (job.status === status && ['queued', 'failed', 'cancelled', 'retrying'].includes(job.status)) {
        newSelected.add(job.id);
      }
    });
    setSelectedJobs(newSelected);
  };

  const statusVariant = ((s: string) => {
    switch (s) {
      case 'queued': return 'secondary';
      case 'processing': return 'outline';
      case 'retrying': return 'destructive';
      case 'completed': return 'default';
      case 'failed': return 'destructive';
      default: return 'secondary';
    }
  }) as any;

  // 큐 통계 계산
  const queueStats = {
    queued: jobs.filter(j => ['queued', 'retrying'].includes(j.status)).length,
    processing: jobs.filter(j => j.status === 'processing').length,
    failed: jobs.filter(j => j.status === 'failed').length,
    stuck: jobs.filter(j => 
      j.status === 'processing' && 
      j.started_at && 
      (Date.now() - new Date(j.started_at).getTime()) > 30 * 60 * 1000
    ).length,
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="card-enhanced text-sm text-gray-200">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-800/30 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-primary-enhanced text-base">
                <Activity className="w-5 h-5" />
                처리 큐 모니터링
                {!isOpen && (queueStats.queued > 0 || queueStats.failed > 0) && (
                  <Badge variant="destructive" className="ml-2">
                    {queueStats.queued + queueStats.failed}
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                {isOpen ? (
                  <ChevronUp className="w-4 h-4 text-gray-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4 text-sm">
            {/* 큐 통계 요약 */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-blue-500/10 rounded border border-blue-500/20 text-center">
                <div className="text-lg font-bold text-white">{queueStats.queued}</div>
                <div className="text-xs text-gray-400">대기</div>
              </div>
              <div className="p-2 bg-purple-500/10 rounded border border-purple-500/20 text-center">
                <div className="text-lg font-bold text-white">{queueStats.processing}</div>
                <div className="text-xs text-gray-400">진행 중</div>
              </div>
              <div className="p-2 bg-red-500/10 rounded border border-red-500/20 text-center">
                <div className="text-lg font-bold text-white">{queueStats.failed}</div>
                <div className="text-xs text-gray-400">실패</div>
              </div>
            </div>

            {/* 액션 버튼 */}
            <div className="flex gap-2 flex-wrap">
              <Button 
                variant="outline" 
                size="sm"
                onClick={loadJobs} 
                disabled={loading}
                className="flex-1"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                새로고침
              </Button>
              <Button 
                size="sm"
                onClick={consumeOne} 
                disabled={consuming}
                className="flex-1"
              >
                <Play className="w-4 h-4 mr-2" />
                즉시 처리
              </Button>
            </div>

            {/* 상태별 일괄 선택 */}
            {(queueStats.queued > 0 || queueStats.failed > 0 || queueStats.stuck > 0) && (
              <div className="flex gap-2 flex-wrap">
                {queueStats.queued > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => selectJobsByStatus('queued')}
                    className="text-xs"
                  >
                    대기 모두 선택
                  </Button>
                )}
                {queueStats.failed > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => selectJobsByStatus('failed')}
                    className="text-xs"
                  >
                    실패 모두 선택
                  </Button>
                )}
                {queueStats.stuck > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => selectJobsByStatus('stuck')}
                    className="text-xs text-orange-400 border-orange-500/50 hover:bg-orange-500/10"
                  >
                    멈춘 작업 모두 선택 ({queueStats.stuck})
                  </Button>
                )}
                {selectedJobs.size > 0 && (
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={deleteSelectedJobs}
                    className="text-xs bg-red-600 hover:bg-red-700"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    선택 삭제 ({selectedJobs.size})
                  </Button>
                )}
                {selectedJobs.size > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setSelectedJobs(new Set())}
                    className="text-xs"
                  >
                    선택 해제
                  </Button>
                )}
              </div>
            )}

            {/* 작업 목록 */}
            <div className="max-h-96 overflow-y-auto custom-scrollbar">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-700">
                    <TableHead className="text-white w-12">
                      <input
                        type="checkbox"
                        checked={selectedJobs.size > 0 && selectedJobs.size === jobs.filter(j => {
                          if (['queued', 'failed', 'cancelled', 'retrying'].includes(j.status)) return true;
                          // 멈춘 작업도 포함
                          if (j.status === 'processing' && j.started_at && 
                              (Date.now() - new Date(j.started_at).getTime()) > 30 * 60 * 1000) return true;
                          return false;
                        }).length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const deletableJobIds = jobs
                              .filter(j => {
                                if (['queued', 'failed', 'cancelled', 'retrying'].includes(j.status)) return true;
                                // 멈춘 작업도 포함
                                if (j.status === 'processing' && j.started_at && 
                                    (Date.now() - new Date(j.started_at).getTime()) > 30 * 60 * 1000) return true;
                                return false;
                              })
                              .map(j => j.id);
                            setSelectedJobs(new Set(deletableJobIds));
                          } else {
                            setSelectedJobs(new Set());
                          }
                        }}
                        className="cursor-pointer"
                      />
                    </TableHead>
                    <TableHead className="text-white text-xs">ID</TableHead>
                    <TableHead className="text-white text-xs">타입</TableHead>
                    <TableHead className="text-white text-xs">상태</TableHead>
                    <TableHead className="text-white text-xs">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-gray-400 text-center py-4">
                        <div className="flex items-center justify-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          대기 중인 작업이 없습니다.
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : jobs.map(j => {
                    // 멈춘 작업 감지: processing 상태이지만 started_at이 30분 이상 지난 경우
                    const isStuck = j.status === 'processing' && j.started_at && 
                      (Date.now() - new Date(j.started_at).getTime()) > 30 * 60 * 1000; // 30분
                    
                    const isDeletable = ['queued', 'failed', 'cancelled', 'retrying'].includes(j.status) || isStuck;
                    const isSelected = selectedJobs.has(j.id);
                    
                    return (
                      <TableRow key={j.id} className="border-gray-700">
                        <TableCell className="text-gray-300">
                          {isDeletable ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleJobSelection(j.id)}
                              className="cursor-pointer"
                            />
                          ) : (
                            <span className="text-gray-500">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-gray-300 text-xs">{j.id.slice(0,8)}…</TableCell>
                        <TableCell className="text-gray-300 text-xs">{j.job_type}</TableCell>
                        <TableCell className="text-gray-300">
                          <Badge variant={statusVariant(j.status)} className="text-xs">
                            {j.status}
                            {isStuck && (
                              <span className="ml-1 text-orange-400" title="30분 이상 진행 중인 멈춘 작업">
                                (멈춤)
                              </span>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-400 text-xs">
                          <div className="flex items-center gap-1 flex-wrap">
                            {j.status === 'queued' || j.status === 'retrying' ? (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => postAction(j.id, 'retry')}
                                className="h-6 px-2 text-xs"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </Button>
                            ) : null}
                            {j.status === 'failed' ? (
                              <>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={() => postAction(j.id, 'reprocess')}
                                  className="h-6 px-2 text-xs"
                                >
                                  <Play className="w-3 h-3" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  onClick={() => postAction(j.id, 'delete')} 
                                  className="h-6 px-2 text-xs text-red-400 hover:text-red-300"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </>
                            ) : null}
                            {isStuck ? (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => postAction(j.id, 'delete')} 
                                className="h-6 px-2 text-xs text-orange-400 hover:text-orange-300"
                                title="멈춘 작업 삭제"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            ) : null}
                            {isDeletable && j.status !== 'failed' && !isStuck ? (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => postAction(j.id, 'delete')} 
                                className="h-6 px-2 text-xs text-red-400 hover:text-red-300"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            ) : null}
                            {j.status === 'queued' ? (
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={() => postAction(j.id, 'cancel')}
                                className="h-6 px-2 text-xs"
                              >
                                <XCircle className="w-3 h-3" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

