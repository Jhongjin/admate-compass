import { getOllamaEndpointStatus, resolveOllamaEndpoint } from './ollamaEndpoint';

export type CompassAnswerProvider = 'openrouter' | 'ollama';
export type CompassEvidenceDecision = 'verified' | 'weak' | 'rejected';

export interface CompassGroundingSource {
  chunk_id?: string;
  id?: string;
  content: string;
  similarity?: number;
  score?: number;
  hybridScore?: number;
  corpus?: string;
  evidenceType?: string;
  evidenceDecision?: CompassEvidenceDecision | string;
  evidenceDecisionReason?: string[];
  rankReason?: string[];
  retrievalMethod?: string;
  documentId?: string;
  documentTitle?: string;
  documentUrl?: string;
  sourceVendor?: string;
  sourceQuality?: {
    isFallback?: boolean;
    qualityScore?: number;
    warnings?: string[];
  };
  metadata?: Record<string, any>;
}

export interface CompassAnswerResult {
  answer: string;
  provider: CompassAnswerProvider;
  model: string;
}

interface OpenRouterChatResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

const DEFAULT_OPENROUTER_MODELS = [
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-5-mini',
  'google/gemini-2.5-pro',
];

function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.COMPASS_OPENROUTER_API_KEY);
}

function resolveProvider(): CompassAnswerProvider {
  const configured = String(process.env.COMPASS_ANSWER_PROVIDER || 'ollama').trim().toLowerCase();

  if (configured === 'openrouter') return 'openrouter';
  if (configured === 'ollama') return 'ollama';

  return 'ollama';
}

function resolveOpenRouterModels(): string[] {
  const configured = process.env.COMPASS_ANSWER_MODELS || process.env.COMPASS_ANSWER_MODEL;
  const models = configured
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return models && models.length > 0 ? models : DEFAULT_OPENROUTER_MODELS;
}

function resolveOpenRouterBaseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
}

function resolveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getCompassAnswerRuntimeStatus() {
  const provider = resolveProvider();
  const openrouterModels = resolveOpenRouterModels();
  const ollamaModel = process.env.OLLAMA_DEFAULT_MODEL || process.env.OLLAMA_MODEL || 'mistral:7b';

  return {
    provider,
    openrouterConfigured: hasOpenRouterKey(),
    modelLabel: provider === 'openrouter' ? openrouterModels.join(' -> ') : `ollama/${ollamaModel}`,
    ollama: getOllamaEndpointStatus(),
  };
}

export async function generateCompassAnswer(
  message: string,
  searchResults: CompassGroundingSource[],
): Promise<CompassAnswerResult> {
  const provider = resolveProvider();

  if (provider === 'openrouter') {
    return generateOpenRouterAnswer(message, searchResults);
  }

  return generateOllamaAnswer(message, searchResults);
}

function buildSystemPrompt(): string {
  return [
    'You are the AdMate Compass policy intelligence lead.',
    'Answer in Korean for an advertising operations team.',
    'Use only supplied evidence blocks whose decision is verified. Do not add policy facts from general memory.',
    'Weak, rejected, fallback, placeholder, or empty evidence is outside the answer boundary.',
    'If verified evidence is missing, say the provided documents do not confirm it.',
    'Cite the supporting evidence labels like [S1] or [S2] inside the answer.',
    'Keep the answer concise, operational, and suitable for campaign decision support.',
  ].join('\n');
}

function buildEvidencePrompt(message: string, searchResults: CompassGroundingSource[]): string {
  const evidence = searchResults
    .filter((result) => {
      const decision = result.evidenceDecision || result.metadata?.evidenceDecision;
      const isFallback = result.retrievalMethod === 'fallback'
        || result.sourceQuality?.isFallback === true
        || result.metadata?.type === 'fallback';
      return result.content?.trim() && decision === 'verified' && !isFallback;
    })
    .slice(0, 5)
    .map((result, index) => {
      const label = `S${index + 1}`;
      const title = result.documentTitle || result.metadata?.title || result.metadata?.originalTitle || '광고 정책 문서';
      const vendor = result.sourceVendor || result.metadata?.sourceVendor || 'UNKNOWN';
      const decision = result.evidenceDecision || result.metadata?.evidenceDecision || 'weak';
      const reasons = result.evidenceDecisionReason || result.metadata?.evidenceDecisionReason || [];
      const excerpt = result.content.replace(/\s+/g, ' ').trim().slice(0, 900);
      return [
        `[${label}]`,
        `title: ${title}`,
        `vendor: ${vendor}`,
        `decision: ${decision}`,
        `decisionReasons: ${reasons.join(', ') || 'none'}`,
        `retrievalMethod: ${result.retrievalMethod || result.metadata?.retrievalMethod || 'unknown'}`,
        `url: ${result.documentUrl || result.metadata?.source_url || result.metadata?.document_url || result.metadata?.url || 'none'}`,
        `excerpt: ${excerpt}`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    `사용자 질문: ${message}`,
    '',
    '검증된 근거:',
    evidence || '(제공된 검증 근거 없음)',
    '',
    '답변 규칙:',
    '- 위 근거에서 확인되는 내용만 답변하세요.',
    '- 근거가 충분하지 않으면 "현재 제공된 문서에서는 확인되지 않습니다"라고 답하세요.',
    '- 매체/플랫폼이 다르면 혼합해서 답하지 마세요.',
    '- 마지막에 짧은 "근거" 줄을 포함하고 사용한 출처 라벨을 적으세요.',
  ].join('\n');
}

async function generateOpenRouterAnswer(
  message: string,
  searchResults: CompassGroundingSource[],
): Promise<CompassAnswerResult> {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.COMPASS_OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured.');
  }

  const models = resolveOpenRouterModels();
  const body: Record<string, any> = {
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildEvidencePrompt(message, searchResults) },
    ],
    temperature: resolveNumber(process.env.COMPASS_ANSWER_TEMPERATURE, 0.1),
    top_p: resolveNumber(process.env.COMPASS_ANSWER_TOP_P, 0.85),
    max_tokens: Math.max(256, Math.floor(resolveNumber(process.env.COMPASS_ANSWER_MAX_TOKENS, 1200))),
    provider: {
      allow_fallbacks: true,
      require_parameters: true,
      data_collection: 'deny',
    },
  };

  if (models.length > 1) {
    body.models = models;
  } else {
    body.model = models[0];
  }

  const response = await fetch(`${resolveOpenRouterBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || process.env.NEXT_PUBLIC_SITE_URL || 'https://compass.admate.ai.kr',
      'X-Title': process.env.OPENROUTER_APP_TITLE || 'AdMate Compass',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.floor(resolveNumber(process.env.COMPASS_ANSWER_TIMEOUT_MS, 45000))),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenRouter answer generation failed: ${response.status} ${detail.slice(0, 240)}`);
  }

  const data = await response.json() as OpenRouterChatResponse;
  const content = data.choices?.[0]?.message?.content;
  const answer = Array.isArray(content)
    ? content.map((part) => part.text || '').join('').trim()
    : String(content || '').trim();

  if (!answer) {
    throw new Error('OpenRouter answer generation returned an empty answer.');
  }

  return {
    answer,
    provider: 'openrouter',
    model: data.model || models[0],
  };
}

async function generateOllamaAnswer(
  message: string,
  searchResults: CompassGroundingSource[],
): Promise<CompassAnswerResult> {
  const ollamaEndpoint = resolveOllamaEndpoint();
  if (!ollamaEndpoint.baseUrl) {
    throw new Error('Ollama endpoint is not configured for this environment.');
  }

  const model = process.env.OLLAMA_DEFAULT_MODEL || process.env.OLLAMA_MODEL || 'mistral:7b';
  const response = await fetch(`${ollamaEndpoint.baseUrl}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'AdMate-Compass/1.0',
      Connection: 'keep-alive',
    },
    body: JSON.stringify({
      model,
      prompt: `${buildSystemPrompt()}\n\n${buildEvidencePrompt(message, searchResults)}`,
      stream: false,
      options: {
        temperature: 0.1,
        top_p: 0.85,
        num_predict: 1000,
      },
    }),
    signal: AbortSignal.timeout(Math.floor(resolveNumber(process.env.COMPASS_ANSWER_TIMEOUT_MS, 60000))),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ollama answer generation failed: ${response.status} ${detail.slice(0, 240)}`);
  }

  const data = await response.json() as { response?: string };
  const answer = data.response?.trim();
  if (!answer) {
    throw new Error('Ollama answer generation returned an empty answer.');
  }

  return {
    answer,
    provider: 'ollama',
    model: `ollama/${model}`,
  };
}
