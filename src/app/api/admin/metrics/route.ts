import { NextResponse } from 'next/server';
import { createPureClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const hoursParam = Number(searchParams.get('hours') || '0');
    const supabase = await createPureClient();
    let query = supabase
      .from('processing_metrics')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (hoursParam > 0) {
      const gte = new Date(Date.now() - hoursParam * 3600 * 1000).toISOString();
      // @ts-ignore
      query = query.gte('created_at', gte);
    }
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data || []) as any[];
    const docIds = Array.from(new Set(rows.map(r => r.document_id).filter(Boolean)));

    let vendorByDoc: Record<string, string> = {};
    if (docIds.length) {
      const { data: docs } = await supabase
        .from('documents')
        .select('id, source_vendor')
        .in('id', docIds);
      (docs || []).forEach((d: any) => { vendorByDoc[d.id] = d.source_vendor || 'UNKNOWN'; });
    }

    function avg(ns: number[]) { return ns.length ? Math.round(ns.reduce((a,b)=>a+b,0)/ns.length) : 0; }
    function max(ns: number[]) { return ns.length ? Math.max(...ns) : 0; }
    function p95(ns: number[]) {
      if (!ns.length) return 0; const s=[...ns].sort((a,b)=>a-b); const idx=Math.floor(0.95*(s.length-1)); return s[idx];
    }
    function p90(ns: number[]) { if (!ns.length) return 0; const s=[...ns].sort((a,b)=>a-b); const idx=Math.floor(0.90*(s.length-1)); return s[idx]; }
    function p99(ns: number[]) { if (!ns.length) return 0; const s=[...ns].sort((a,b)=>a-b); const idx=Math.floor(0.99*(s.length-1)); return s[idx]; }

    const nums = (k: string) => rows.map(r => Number(r[k]||0)).filter(n => Number.isFinite(n));
    const overall = {
      count: rows.length,
      avgTotalMs: avg(nums('total_ms')),
      p90TotalMs: p90(nums('total_ms')),
      p95TotalMs: p95(nums('total_ms')),
      p99TotalMs: p99(nums('total_ms')),
      maxTotalMs: max(nums('total_ms')),
      avgOcrMs: avg(nums('ocr_ms')),
      p90OcrMs: p90(nums('ocr_ms')),
      p95OcrMs: p95(nums('ocr_ms')),
      p99OcrMs: p99(nums('ocr_ms')),
      maxOcrMs: max(nums('ocr_ms')),
      avgEmbMs: avg(nums('emb_ms')),
      p90EmbMs: p90(nums('emb_ms')),
      p95EmbMs: p95(nums('emb_ms')),
      p99EmbMs: p99(nums('emb_ms')),
      maxEmbMs: max(nums('emb_ms')),
    };

    const byVendor: Record<string, any> = {};
    rows.forEach(r => {
      const v = vendorByDoc[r.document_id] || 'UNKNOWN';
      (byVendor[v] ||= []).push(r);
    });
    const vendorAggregates = Object.entries(byVendor).map(([vendor, arr]: [string, any[]]) => ({
      vendor,
      count: arr.length,
      avgTotalMs: avg(arr.map(x=>Number(x.total_ms||0))),
      p90TotalMs: p90(arr.map(x=>Number(x.total_ms||0))),
      p95TotalMs: p95(arr.map(x=>Number(x.total_ms||0))),
      p99TotalMs: p99(arr.map(x=>Number(x.total_ms||0))),
      maxTotalMs: max(arr.map(x=>Number(x.total_ms||0))),
      avgOcrMs: avg(arr.map(x=>Number(x.ocr_ms||0))),
      p90OcrMs: p90(arr.map(x=>Number(x.ocr_ms||0))),
      p95OcrMs: p95(arr.map(x=>Number(x.ocr_ms||0))),
      p99OcrMs: p99(arr.map(x=>Number(x.ocr_ms||0))),
      maxOcrMs: max(arr.map(x=>Number(x.ocr_ms||0))),
      avgEmbMs: avg(arr.map(x=>Number(x.emb_ms||0))),
      p90EmbMs: p90(arr.map(x=>Number(x.emb_ms||0))),
      p95EmbMs: p95(arr.map(x=>Number(x.emb_ms||0))),
      p99EmbMs: p99(arr.map(x=>Number(x.emb_ms||0))),
      maxEmbMs: max(arr.map(x=>Number(x.emb_ms||0))),
    }));

    return NextResponse.json({ data: rows, overall, vendorAggregates }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'unknown' }, { status: 500 });
  }
}


