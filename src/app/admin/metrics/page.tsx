"use client";

import { useEffect, useMemo, useState } from 'react';

type Metric = {
  id: string;
  created_at: string;
  job_id: string;
  document_id: string | null;
  bytes: number | null;
  dl_ms: number | null;
  parse_ms: number | null;
  ocr_ms: number | null;
  emb_ms: number | null;
  total_ms: number | null;
  text_length: number | null;
  chunks: number | null;
  note: string | null;
};

type Overall = {
  count: number;
  avgTotalMs: number; p95TotalMs: number; maxTotalMs: number;
  avgOcrMs: number; p95OcrMs: number; maxOcrMs: number;
  avgEmbMs: number; p95EmbMs: number; maxEmbMs: number;
};

type VendorAgg = {
  vendor: string; count: number;
  avgTotalMs: number; p95TotalMs: number; maxTotalMs: number;
  avgOcrMs: number; p95OcrMs: number; maxOcrMs: number;
  avgEmbMs: number; p95EmbMs: number; maxEmbMs: number;
};

export default function MetricsPage() {
  const [rows, setRows] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overall, setOverall] = useState<Overall | null>(null);
  const [vendorAggs, setVendorAggs] = useState<VendorAgg[]>([]);
  const [hours, setHours] = useState<number>(24);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/metrics?hours=${hours}` , { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'failed to load metrics');
        if (alive) {
          setRows((json?.data as Metric[]) || []);
          setOverall(json?.overall || null);
          setVendorAggs((json?.vendorAggregates as VendorAgg[]) || []);
        }
      } catch (e: any) {
        if (alive) setError(e?.message || 'unknown error');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [hours]);

  const stats = useMemo(() => {
    if (!rows.length) return null;
    const n = rows.length;
    const avg = (arr: (number | null | undefined)[]) => {
      const vals = arr.filter((v): v is number => typeof v === 'number');
      if (!vals.length) return 0;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    };
    return {
      count: n,
      avgTotalMs: avg(rows.map(r => r.total_ms)),
      avgDlMs: avg(rows.map(r => r.dl_ms)),
      avgParseMs: avg(rows.map(r => r.parse_ms)),
      avgOcrMs: avg(rows.map(r => r.ocr_ms)),
      avgEmbMs: avg(rows.map(r => r.emb_ms)),
      avgBytesKb: Math.round(avg(rows.map(r => r.bytes)) / 1024),
      avgTextLen: avg(rows.map(r => r.text_length)),
    };
  }, [rows]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">처리 메트릭 대시보드</h1>
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">기간</label>
        <select className="border rounded px-2 py-1 text-sm" value={hours} onChange={(e)=>setHours(parseInt(e.target.value))}>
          <option value={24}>최근 24시간</option>
          <option value={168}>최근 7일</option>
          <option value={0}>전체</option>
        </select>
      </div>
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card label="최근 측정 수" value={stats.count} />
          <Card label="평균 총 처리(ms)" value={stats.avgTotalMs} />
          <Card label="평균 다운로드(ms)" value={stats.avgDlMs} />
          <Card label="평균 파싱(ms)" value={stats.avgParseMs} />
          <Card label="평균 OCR(ms)" value={stats.avgOcrMs} />
          <Card label="평균 임베딩(ms)" value={stats.avgEmbMs} />
          <Card label="평균 파일 크기(KB)" value={stats.avgBytesKb} />
          <Card label="평균 텍스트 길이" value={stats.avgTextLen} />
        </div>
      )}

      {overall && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card label="P90 총 처리(ms)" value={(overall as any).p90TotalMs || 0} />
          <Card label="P95 총 처리(ms)" value={overall.p95TotalMs} />
          <Card label="P99 총 처리(ms)" value={(overall as any).p99TotalMs || 0} />
          <Card label="Max 총 처리(ms)" value={overall.maxTotalMs} />
          <Card label="P90 OCR(ms)" value={(overall as any).p90OcrMs || 0} />
          <Card label="P95 OCR(ms)" value={overall.p95OcrMs} />
          <Card label="P99 OCR(ms)" value={(overall as any).p99OcrMs || 0} />
          <Card label="Max OCR(ms)" value={overall.maxOcrMs} />
          <Card label="P90 임베딩(ms)" value={(overall as any).p90EmbMs || 0} />
          <Card label="P95 임베딩(ms)" value={overall.p95EmbMs} />
          <Card label="P99 임베딩(ms)" value={(overall as any).p99EmbMs || 0} />
          <Card label="Max 임베딩(ms)" value={overall.maxEmbMs} />
        </div>
      )}

      {!!vendorAggs.length && (
        <div className="mt-4">
          <h2 className="text-lg font-semibold mb-2">벤더별 집계</h2>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th>벤더</Th>
                  <Th>count</Th>
                  <Th>avg total</Th>
                  <Th>p90 total</Th>
                  <Th>p95 total</Th>
                  <Th>p99 total</Th>
                  <Th>max total</Th>
                  <Th>avg ocr</Th>
                  <Th>p90 ocr</Th>
                  <Th>p95 ocr</Th>
                  <Th>p99 ocr</Th>
                  <Th>max ocr</Th>
                  <Th>avg emb</Th>
                  <Th>p90 emb</Th>
                  <Th>p95 emb</Th>
                  <Th>p99 emb</Th>
                  <Th>max emb</Th>
                </tr>
              </thead>
              <tbody>
                {vendorAggs.map(v => (
                  <tr key={v.vendor} className="border-t">
                    <Td>{v.vendor}</Td>
                    <Td>{v.count}</Td>
                    <Td>{v.avgTotalMs}</Td>
                    <Td>{(v as any).p90TotalMs || 0}</Td>
                    <Td>{v.p95TotalMs}</Td>
                    <Td>{(v as any).p99TotalMs || 0}</Td>
                    <Td>{v.maxTotalMs}</Td>
                    <Td>{v.avgOcrMs}</Td>
                    <Td>{(v as any).p90OcrMs || 0}</Td>
                    <Td>{v.p95OcrMs}</Td>
                    <Td>{(v as any).p99OcrMs || 0}</Td>
                    <Td>{v.maxOcrMs}</Td>
                    <Td>{v.avgEmbMs}</Td>
                    <Td>{(v as any).p90EmbMs || 0}</Td>
                    <Td>{v.p95EmbMs}</Td>
                    <Td>{(v as any).p99EmbMs || 0}</Td>
                    <Td>{v.maxEmbMs}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className="text-red-600 text-sm">오류: {error}</div>
      )}
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>시간</Th>
              <Th>job</Th>
              <Th>doc</Th>
              <Th>note</Th>
              <Th>bytes</Th>
              <Th>dl</Th>
              <Th>parse</Th>
              <Th>ocr</Th>
              <Th>emb</Th>
              <Th>total</Th>
              <Th>text</Th>
              <Th>chunks</Th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className="p-3" colSpan={12}>로딩 중…</td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="border-t">
                <Td>{new Date(r.created_at).toLocaleString()}</Td>
                <Td className="font-mono text-xs">{r.job_id}</Td>
                <Td className="font-mono text-xs">{r.document_id}</Td>
                <Td>{r.note}</Td>
                <Td>{r.bytes}</Td>
                <Td>{r.dl_ms}</Td>
                <Td>{r.parse_ms}</Td>
                <Td>{r.ocr_ms}</Td>
                <Td>{r.emb_ms}</Td>
                <Td>{r.total_ms}</Td>
                <Td>{r.text_length}</Td>
                <Td>{r.chunks}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left font-medium text-gray-600">{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}



