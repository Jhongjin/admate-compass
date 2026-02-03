// Supabase Edge Function: embedding-bge-m3 (Plan B Proxy)
// - Delegates embedding generation to a Hugging Face Scale-to-Zero endpoint

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type EmbedRequest = {
  texts: string[];
  normalize?: boolean;
  jobId?: string;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-edge-embedding-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EDGE_TOKEN = Deno.env.get("EDGE_EMBEDDING_TOKEN") ?? "";
const HF_ENDPOINT_URL = Deno.env.get("HUGGINGFACE_ENDPOINT_URL") ?? "";
const HF_API_KEY = Deno.env.get("HUGGINGFACE_API_KEY") ?? "";
const HF_TIMEOUT_MS = Number(Deno.env.get("HUGGINGFACE_TIMEOUT_MS") ?? "120000");

function sanitizeText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().replace(/\s+/g, " ").slice(0, 4000);
}

async function callHuggingFace(texts: string[], normalize: boolean) {
  if (!HF_ENDPOINT_URL || !HF_API_KEY) {
    throw new Error("Hugging Face endpoint 환경변수가 설정되지 않았습니다.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);

  try {
    const response = await fetch(HF_ENDPOINT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: texts.map((text) => sanitizeText(text)),
        parameters: {
          normalize,
        },
        options: {
          wait_for_model: true, // Scale-to-zero cold start 허용
        },
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("[embedding-bge-m3] HF error payload:", payload);
      throw new Error(payload?.error || payload?.message || `Hugging Face 호출 실패 (${response.status})`);
    }

    if (!payload) {
      throw new Error("Hugging Face 응답이 비어 있습니다.");
    }

    const embeddings: number[][] = parseEmbeddings(payload);
    return embeddings;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Hugging Face 호출이 시간 초과되었습니다.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseEmbeddings(payload: unknown): number[][] {
  if (Array.isArray(payload)) {
    if (Array.isArray(payload[0])) {
      return payload as number[][];
    }
    return (payload as any[]).map((item) => item?.embedding ?? item ?? []);
  }
  if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.embeddings)) {
      return obj.embeddings as number[][];
    }
  }
  throw new Error("Hugging Face 응답 형식을 파싱할 수 없습니다.");
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  if (EDGE_TOKEN && req.headers.get("x-edge-embedding-token") !== EDGE_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  let payload: EmbedRequest;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON payload" }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  const texts = Array.isArray(payload.texts) ? payload.texts : [];
  if (texts.length === 0) {
    return new Response(JSON.stringify({ error: "texts must be a non-empty array" }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  }

  const normalize = payload.normalize ?? true;
  const jobId = payload.jobId;

  try {
    const embeddings = await callHuggingFace(texts, normalize);
    const dimension = embeddings.find((item) => item.length > 0)?.length ?? 0;
    return new Response(
      JSON.stringify({
        embeddings,
        dimension,
        model: "huggingface:bge-m3",
        jobId,
        count: embeddings.length,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("[embedding-bge-m3] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        jobId,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
}

serve(handleRequest);

