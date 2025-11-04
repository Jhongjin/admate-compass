"use client";

import { useEffect, useState } from "react";
import AdminLayout from "@/components/layouts/AdminLayout";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Play, AlertTriangle, RotateCcw, XCircle } from "lucide-react";

type Job = {
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
};

export default function AdminQueuesPage() {
  const supabase = createClient();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [consuming, setConsuming] = useState(false);

  const loadJobs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('processing_jobs')
        .select('id, document_id, job_type, status, attempts, max_attempts, priority, scheduled_at, started_at, finished_at')
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

  useEffect(() => {
    loadJobs();
    const t = setInterval(loadJobs, 10000);
    return () => clearInterval(t);
  }, []);

  const consumeOne = async () => {
    try {
      setConsuming(true);
      const res = await fetch('/api/jobs/consume', { method: 'POST' });
      await res.json();
      await loadJobs();
    } catch (err) {
      console.error('consume 호출 오류:', err);
    } finally {
      setConsuming(false);
    }
  };

  const postAction = async (jobId: string, action: 'retry' | 'cancel' | 'reprocess') => {
    try {
      await fetch('/api/jobs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, action })
      });
      await loadJobs();
    } catch (err) {
      console.error('job action 오류:', err);
    }
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

  return (
    <AdminLayout currentPage="queues">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">처리 큐 모니터링</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadJobs} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />새로고침
          </Button>
          <Button onClick={consumeOne} disabled={consuming}>
            <Play className="w-4 h-4 mr-2" /> 1건 처리
          </Button>
        </div>
      </div>

      <Card className="card-enhanced">
        <CardHeader>
          <CardTitle className="text-white">Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="border-gray-700">
                <TableHead className="text-white">ID</TableHead>
                <TableHead className="text-white">문서</TableHead>
                <TableHead className="text-white">타입</TableHead>
                <TableHead className="text-white">상태</TableHead>
                <TableHead className="text-white">우선순위</TableHead>
                <TableHead className="text-white">시작</TableHead>
                <TableHead className="text-white">종료</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-gray-400">
                    <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>대기 중인 작업이 없습니다.</div>
                  </TableCell>
                </TableRow>
              ) : jobs.map(j => (
                <TableRow key={j.id} className="border-gray-700">
                  <TableCell className="text-gray-300">{j.id.slice(0,8)}…</TableCell>
                  <TableCell className="text-gray-300">{j.document_id}</TableCell>
                  <TableCell className="text-gray-300">{j.job_type}</TableCell>
                  <TableCell className="text-gray-300">
                    <Badge variant={statusVariant(j.status)}>{j.status}</Badge>
                  </TableCell>
                  <TableCell className="text-gray-300">{j.priority}</TableCell>
                  <TableCell className="text-gray-400 text-sm">{j.started_at ?? '-'}</TableCell>
                  <TableCell className="text-gray-400 text-sm">
                    <div className="flex items-center gap-2">
                      <span>{j.finished_at ?? '-'}</span>
                      <Button variant="outline" size="sm" onClick={() => postAction(j.id, 'retry')}>
                        <RotateCcw className="w-3 h-3 mr-1"/>재시도
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => postAction(j.id, 'reprocess')}>
                        <Play className="w-3 h-3 mr-1"/>재처리
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => postAction(j.id, 'cancel')}>
                        <XCircle className="w-3 h-3 mr-1"/>취소
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminLayout>
  );
}


