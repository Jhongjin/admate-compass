import { getOllamaEndpointStatus, resolveOllamaEndpoint } from './ollamaEndpoint';

export type CompassAnswerProvider = 'openrouter' | 'ollama' | 'openai';
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
  sourceKind?: string;
  graphPath?: string;
  documentId?: string;
  documentTitle?: string;
  documentUrl?: string;
  sourceVendor?: string;
  answerMode?: string;
  questionIntent?: string;
  answerEvidenceRole?: string;
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

interface OpenAIChatResponse {
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

function hasOpenAIKey(): boolean {
  return Boolean(process.env.COMPASS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
}

function resolveProvider(): CompassAnswerProvider {
  const configured = String(process.env.COMPASS_ANSWER_PROVIDER || 'ollama').trim().toLowerCase();

  if (configured === 'openrouter') return 'openrouter';
  if (configured === 'openai') return 'openai';
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

function resolveOpenAIModels(): string[] {
  const candidates = [
    process.env.COMPASS_OPENAI_MODEL,
    process.env.OPENAI_IDEA_MODEL,
    'gpt-4o-mini',
    'gpt-4.1-mini',
  ]
    .map((model) => model?.trim())
    .filter((model): model is string => Boolean(model));

  return Array.from(new Set(candidates));
}

function resolveOpenAIModel(): string {
  return resolveOpenAIModels()[0] || 'gpt-4o-mini';
}

function resolveOpenAIBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function resolveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function usesDefaultSamplingOnly(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('o') || normalized.startsWith('gpt-5');
}

export function getCompassAnswerRuntimeStatus() {
  const provider = resolveProvider();
  const openrouterModels = resolveOpenRouterModels();
  const ollamaModel = process.env.OLLAMA_DEFAULT_MODEL || process.env.OLLAMA_MODEL || 'mistral:7b';

  return {
    provider,
    openrouterConfigured: hasOpenRouterKey(),
    openaiConfigured: hasOpenAIKey(),
    modelLabel: provider === 'openrouter'
      ? openrouterModels.join(' -> ')
      : provider === 'openai'
        ? `openai/${resolveOpenAIModel()}`
        : `ollama/${ollamaModel}${hasOpenAIKey() ? ' -> openai fallback' : ''}`,
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

  if (provider === 'openai') {
    return generateOpenAIAnswer(message, searchResults);
  }

  try {
    return await generateOllamaAnswer(message, searchResults);
  } catch (error) {
    if (!hasOpenAIKey()) {
      throw error;
    }

    console.warn('Ollama answer generation unavailable; using OpenAI fallback', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return generateOpenAIAnswer(message, searchResults);
  }
}

function buildSystemPrompt(): string {
  return [
    'You are the AdMate Compass policy intelligence lead.',
    'Answer in Korean for an advertising operations team.',
    'Use only supplied evidence blocks whose decision is verified. Do not add policy facts from general memory.',
    'Weak, rejected, fallback, placeholder, or empty evidence is outside the answer boundary.',
    'If verified evidence is missing, say the provided documents do not confirm it.',
    'Never change or guess an evidence block vendor. If a block says vendor: KAKAO, do not describe it as NAVER or Google.',
    'Treat official_doc evidence as official policy/guide evidence. Treat resolved_case evidence only as an approved operational case, not as a universal policy.',
    'If official_doc and resolved_case evidence conflict, the official_doc evidence wins and the resolved case must be framed as a past handling example.',
    'For comparison questions, separate the answer by vendor first, then summarize the practical difference.',
    'Cite the supporting evidence labels like [S1] or [S2] inside the answer.',
    'Do not reuse a canned overview when the user asks about a specific ad product, setup step, creative guide, registration rule, or policy check.',
    'Keep the answer operational and specific enough for campaign decision support.',
  ].join('\n');
}

function buildEvidencePrompt(message: string, searchResults: CompassGroundingSource[]): string {
  const answerModeHint = searchResults.find(result => result.answerMode || result.metadata?.answerMode)?.answerMode
    || searchResults.find(result => result.metadata?.answerMode)?.metadata?.answerMode
    || 'auto';
  const questionIntentHint = searchResults.find(result => result.questionIntent || result.metadata?.questionIntent)?.questionIntent
    || searchResults.find(result => result.metadata?.questionIntent)?.metadata?.questionIntent
    || 'auto';
  const evidence = searchResults
    .filter((result) => {
      const decision = result.evidenceDecision || result.metadata?.evidenceDecision;
      const isFallback = result.retrievalMethod === 'fallback'
        || result.sourceQuality?.isFallback === true
        || result.metadata?.type === 'fallback';
      return result.content?.trim() && decision === 'verified' && !isFallback;
    })
    .slice(0, 9)
    .map((result, index) => {
      const label = `S${index + 1}`;
      const title = result.documentTitle || result.metadata?.title || result.metadata?.originalTitle || '광고 정책 문서';
      const vendor = result.sourceVendor || result.metadata?.sourceVendor || 'UNKNOWN';
      const decision = result.evidenceDecision || result.metadata?.evidenceDecision || 'weak';
      const reasons = result.evidenceDecisionReason || result.metadata?.evidenceDecisionReason || [];
      const sourceKind = result.sourceKind || result.metadata?.source_kind || 'official_doc';
      const answerEvidenceRole = result.answerEvidenceRole
        || result.metadata?.answerEvidenceRole
        || result.metadata?.answer_evidence_role
        || 'general';
      const graphPath = result.graphPath || result.metadata?.graphPath || result.metadata?.graph_path || 'none';
      const claimType = result.metadata?.claimType || result.metadata?.claim_type || 'unknown';
      const excerpt = result.content.replace(/\s+/g, ' ').trim().slice(0, 900);
      return [
        `[${label}]`,
        `title: ${title}`,
        `vendor: ${vendor}`,
        `sourceKind: ${sourceKind}`,
        `answerEvidenceRole: ${answerEvidenceRole}`,
        `claimType: ${claimType}`,
        `graphPath: ${graphPath}`,
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
    `답변 모드 힌트: ${answerModeHint}`,
    `질문 처리 힌트: ${questionIntentHint}`,
    '',
    '검증된 근거:',
    evidence || '(제공된 검증 근거 없음)',
    '',
    '답변 규칙:',
    '- 위 근거에서 확인되는 내용만 답변하세요.',
    '- 검증 근거가 하나도 없을 때만 "현재 제공된 문서에서는 확인되지 않습니다"라고 답하세요.',
    '- 검증 근거가 일부라도 있으면 전체 부정으로 시작하지 말고, "제공된 근거 기준으로는"처럼 확인 가능한 범위를 먼저 밝히세요.',
    '- "현재 제공된 문서에서는 확인되지 않습니다"라고 말한 뒤 확인되지 않은 세부 내용을 이어서 작성하지 마세요.',
    '- sourceKind가 official_doc인 근거는 공식 광고 가이드/정책 기준으로 답하세요.',
    '- sourceKind가 resolved_case인 근거는 "실무 처리 사례 기준으로는" 또는 "과거 유사 이슈에서는"처럼 표현하세요. 공식 정책처럼 단정하지 마세요.',
    '- official_doc과 resolved_case가 함께 있으면 "공식 기준"을 먼저 쓰고, 그 다음 "실무 처리 사례"를 별도 문단으로 분리하세요.',
    '- answerEvidenceRole이 mode_detail 또는 db_detail인 근거를 답변의 1차 근거로 사용하세요. 해당 근거에 있는 절차, 조건, 소재 사양, 지면 정보를 먼저 정리해야 합니다.',
    '- answerEvidenceRole이 official_graph인 근거는 공식 문서/상품 관계를 보강하는 용도입니다. mode_detail 또는 db_detail 근거가 있으면 official_graph만으로 넓은 상품 개요를 만들지 마세요.',
    '- answerEvidenceRole이 product_context인 근거는 배경 범위 보강용입니다. product_context만으로 특정 상품 질문을 전체 상품 구조나 캠페인 목표 목록으로 바꾸지 마세요.',
    '- 오류, 연동, 반려, 세팅, SDK, MMP, tracking_specs, 카탈로그, 픽셀, 노출, 소진처럼 실제 집행 이슈를 물으면 "확인 순서 / 가능한 원인 / 조치 방법 / 추가 확인 필요 항목" 순서로 정리하세요.',
    '- 답변 모드 힌트가 auto가 아니면 그 모드를 우선 적용하세요. 질문 처리 힌트를 무시하고 넓은 상품 개요로 되돌아가지 마세요.',
    '- 내부적으로 answer_mode를 하나만 선택하세요: product_overview, product_selection, product_detail, execution_guide, setup_procedure, creative_guide, policy_screening, operational_issue. answer_mode 이름은 출력하지 말고, 선택한 모드에 맞는 골격만 사용하세요.',
    '- execution_guide는 특정 상품의 집행 절차와 소재 조건을 함께 묻는 질문입니다. 이때는 준비 순서, 필수 설정/연동, 소재 조건, 확인해야 할 제한사항을 나눠 답하세요.',
    '- product_detail, execution_guide, setup_procedure, policy_screening, operational_issue 질문에는 product_overview 구조를 반복하지 마세요. 특히 캠페인 목표 목록을 기본 답변으로 되풀이하지 마세요.',
    '- 특정 상품 질문의 첫 문장은 반드시 사용자가 물은 상품명/지면/절차를 직접 언급해야 합니다. 예: "네이버 DA는...", "Meta 앱 인스톨 광고는...", "Google 리드 양식은..."처럼 시작하세요.',
    '- 특정 상품 질문에서 근거가 부족하면 다른 상품군의 일반 개요로 대체하지 마세요. 확인된 근거와 부족한 범위를 분리하고, 관련 없는 캠페인 목표/상품군 목록은 쓰지 마세요.',
    '- product_detail은 "무엇인지 / 어디에 노출되는지 / 언제 쓰는지 / 운영 전 확인할 조건" 순서로 답하세요. 소재 규격이나 정책만 근거에 있으면 그 한계를 명시하세요.',
    '- setup_procedure는 "준비 항목 / 설정 또는 연동 순서 / 담당자나 원문 확인이 필요한 범위" 순서로 답하세요. 앱·카탈로그·DB URL·EP·MMP·SDK 질문은 이 규칙을 우선 적용하세요.',
    '- creative_guide는 "필수 소재 요소 / 규격·비율·파일 조건 / 문구·랜딩·심사 주의사항" 순서로 답하세요. 상품 선택 기준을 반복하지 마세요.',
    '- policy_screening은 "심사 전 확인 기준 / 제한 또는 반려 가능 사유 / 추가 확인 자료" 순서로 답하세요. 질문과 무관한 일반 금지 조항을 길게 나열하지 마세요.',
    '- 사용자가 광고 상품/종류/구조를 물으면 질문 의도를 먼저 구분하세요: 전체 상품 개요, 목적별 선택 기준, 특정 상품 상세, 정책 심사 체크, 실무 이슈 해결. 서로 다른 모드를 하나의 고정 템플릿으로 합치지 마세요.',
    '- 전체 상품 개요 질문에는 근거에서 확인되는 상품군, 지면, 캠페인 유형을 먼저 나누고 각 항목이 언제 쓰이는지 짧게 설명하세요. 근거에 없는 상품군은 추정하지 마세요.',
    '- 목적별 선택 질문에는 "우선 목표를 정하고 / 그 목표에 맞는 상품군과 지면을 고르고 / 운영 전 조건을 확인한다"는 순서로 정리하세요.',
    '- 사용자가 "DA도 있지 않아?", "동영상 광고 상품", "앱 인스톨", "DB URL"처럼 특정 상품이나 누락된 상품군을 물으면 전체 상품 구조를 반복하지 말고 그 항목에 직접 답하세요. 첫 문장부터 질문한 항목을 다루세요.',
    '- 광고 상품/종류 질문에서 검증 근거가 소재 크기·파일 형식·비율만 확인한다면 "제공된 근거에서는 소재 형식/사양 범위만 확인됩니다"라고 먼저 밝히고, 그 범위로만 답하세요.',
    '- 특정 광고 상품을 물으면 개요 템플릿을 반복하지 말고, "무엇인지 / 언제 쓰는지 / 운영 또는 등록 절차 / 필요한 소재와 설정 / 심사·주의사항" 중 근거로 확인되는 항목만 골라 답하세요.',
    '- 등록, DB URL, 상품 DB, 카탈로그, 앱 등록, 추적 툴, 리드 양식, 제작 가이드, 소재 조건을 물으면 절차형 또는 체크리스트형으로 답하세요. 단순히 광고 목표 목록으로 돌려 말하지 마세요.',
    '- 사용자가 DB URL, 상품 DB, EP, 상품등록을 물으면 EP, 상품 가격, 배송비, 쿠폰, 할인 정보, 쇼핑몰 연동, 쇼핑파트너센터처럼 상품 데이터 운영과 직접 연결되는 근거를 우선 설명하세요. 정확한 DB URL 형식이 근거에 없을 때만 그 세부 형식은 확인되지 않는다고 분리해서 말하세요.',
    '- 제작 가이드 질문에는 이미지·동영상 비율, 문구·랜딩·업종 제한, 선검수·승인 조건처럼 실제 제작 전에 확인할 항목을 우선 정리하세요.',
    '- 정책 또는 주의사항 질문에는 "확인할 기준 / 왜 중요한지 / 운영 전에 확인할 자료 또는 담당자 확인 필요 범위" 순서로 정리하세요. 질문과 무관한 일반 금지 표현을 맨 앞에 반복하지 마세요.',
    '- 근거 제목을 그대로 나열하는 추출식 답변을 피하고, 사용자가 바로 행동할 수 있는 문장으로 다시 구성하세요.',
    '- 매체/플랫폼이 다르면 혼합해서 답하지 마세요.',
    '- 비교 질문이면 먼저 매체별로 나누어 정리하고, 마지막에 실무 차이를 1~2문장으로 요약하세요.',
    '- 근거 블록의 vendor 값을 절대 다른 매체명으로 바꿔 쓰지 마세요. 예: vendor가 KAKAO인 근거를 네이버 근거처럼 설명하면 안 됩니다.',
    '- 핵심 문장에는 가능한 한 [S1], [S2]처럼 출처 라벨을 붙이세요.',
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

async function generateOpenAIAnswer(
  message: string,
  searchResults: CompassGroundingSource[],
): Promise<CompassAnswerResult> {
  const apiKey = process.env.COMPASS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key is not configured.');
  }

  let lastError: unknown;
  for (const model of resolveOpenAIModels()) {
    try {
      return await requestOpenAIAnswer({
        apiKey,
        model,
        message,
        searchResults,
      });
    } catch (error) {
      lastError = error;
      console.warn('OpenAI answer generation candidate failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI answer generation failed.');
}

async function requestOpenAIAnswer({
  apiKey,
  model,
  message,
  searchResults,
}: {
  apiKey: string;
  model: string;
  message: string;
  searchResults: CompassGroundingSource[];
}): Promise<CompassAnswerResult> {
  const tokenBudget = Math.max(256, Math.floor(resolveNumber(process.env.COMPASS_ANSWER_MAX_TOKENS, 1200)));
  const requestBody: Record<string, any> = {
    model,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildEvidencePrompt(message, searchResults) },
    ],
  };

  if (usesDefaultSamplingOnly(model)) {
    requestBody.max_completion_tokens = tokenBudget;
  } else {
    requestBody.temperature = resolveNumber(process.env.COMPASS_ANSWER_TEMPERATURE, 0.1);
    requestBody.top_p = resolveNumber(process.env.COMPASS_ANSWER_TOP_P, 0.85);
    requestBody.max_tokens = tokenBudget;
  }

  const response = await fetch(`${resolveOpenAIBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(Math.floor(resolveNumber(process.env.COMPASS_ANSWER_TIMEOUT_MS, 45000))),
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`OpenAI answer generation failed: ${response.status} ${detail.slice(0, 240)}`);
    error.name = `OpenAIStatus${response.status}Error`;
    throw error;
  }

  const data = await response.json() as OpenAIChatResponse;
  const content = data.choices?.[0]?.message?.content;
  const answer = Array.isArray(content)
    ? content.map((part) => part.text || '').join('').trim()
    : String(content || '').trim();

  if (!answer) {
    throw new Error('OpenAI answer generation returned an empty answer.');
  }

  return {
    answer,
    provider: 'openai',
    model: `openai/${data.model || model}`,
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
