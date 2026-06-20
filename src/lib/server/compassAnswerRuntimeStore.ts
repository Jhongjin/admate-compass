import { createCompassServiceClient } from '@/lib/supabase/compass';

export type CompassAnswerDurableCacheStatus = 'HIT' | 'MISS' | 'BYPASS';

export type CompassAnswerDurableCacheEntry = {
  body: Record<string, unknown>;
  status: number;
  expiresAt: string;
};

export type CompassAnswerDurableRuntimeEvent = {
  cacheStatus: CompassAnswerDurableCacheStatus;
  cacheKey?: string | null;
  processingTimeMs?: number | null;
  retrievalDurationMs?: number | null;
  answerGenerationDurationMs?: number | null;
  retrievalTimedOut?: boolean;
  retrievalChannelTimedOut?: boolean;
  noDataFound?: boolean;
  errorResponse?: boolean;
  model?: string | null;
  sourceCount?: number | null;
  graphLikeSourceCount?: number | null;
  slowestChannel?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export type CompassAnswerDurableMetricsSnapshot = {
  status: 'ready' | 'disabled' | 'unavailable';
  windowStart?: string;
  windowEnd?: string;
  completedRequestCount?: number;
  cacheableRequestCount?: number;
  hitCount?: number;
  missCount?: number;
  bypassedRequestCount?: number;
  cacheHitRatio?: number | null;
  errorResponseCount?: number;
  noDataResponseCount?: number;
  retrievalLimitedResponseCount?: number;
  avgProcessingTimeMs?: number | null;
  avgRetrievalDurationMs?: number | null;
  avgAnswerGenerationDurationMs?: number | null;
  retrievalSampleCount?: number;
  answerGenerationSampleCount?: number;
  lastEventAt?: string | null;
  lastSlowestChannel?: Record<string, unknown> | null;
  cacheEntryCount?: number;
  reason?: string;
};

const DURABLE_STORE_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.COMPASS_DURABLE_ANSWER_STORE_TIMEOUT_MS || 700), 200),
  2500,
);
const DURABLE_STORE_SUPPRESSION_MS = Math.min(
  Math.max(Number(process.env.COMPASS_DURABLE_ANSWER_STORE_SUPPRESSION_MS || 60000), 5000),
  300000,
);

let durableStoreUnavailableUntil = 0;
let durableStoreLastError: {
  area: string;
  at: string;
  name: string;
  code?: string;
  message?: string;
} | null = null;

function hasCompassDurableStoreConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isDurableCacheEnabled() {
  return process.env.COMPASS_DURABLE_ANSWER_CACHE_ENABLED !== 'false';
}

function isDurableMetricsEnabled() {
  return process.env.COMPASS_DURABLE_ANSWER_METRICS_ENABLED !== 'false';
}

function isDurableStoreSuppressed() {
  return durableStoreUnavailableUntil > Date.now();
}

function toErrorMetadata(error: unknown, area: string) {
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return {
    area,
    at: new Date().toISOString(),
    name: String(candidate?.name || 'CompassDurableStoreError'),
    code: candidate?.code ? String(candidate.code) : undefined,
    message: candidate?.message ? String(candidate.message).slice(0, 180) : undefined,
  };
}

function markDurableStoreUnavailable(error: unknown, area: string) {
  durableStoreUnavailableUntil = Date.now() + DURABLE_STORE_SUPPRESSION_MS;
  durableStoreLastError = toErrorMetadata(error, area);
  console.warn('Compass durable answer store temporarily unavailable', {
    area: durableStoreLastError.area,
    name: durableStoreLastError.name,
    code: durableStoreLastError.code,
    suppressedMs: DURABLE_STORE_SUPPRESSION_MS,
  });
}

async function withDurableStoreTimeout<T>(
  operation: PromiseLike<T>,
  area: string,
): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), DURABLE_STORE_TIMEOUT_MS);
    });
    const result = await Promise.race([Promise.resolve(operation), timeout]);
    if (result === null) {
      markDurableStoreUnavailable(new Error('durable store operation timed out'), area);
    }
    return result;
  } catch (error) {
    markDurableStoreUnavailable(error, area);
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function shouldUseDurableStore(feature: 'cache' | 'metrics') {
  if (!hasCompassDurableStoreConfig()) return false;
  if (isDurableStoreSuppressed()) return false;
  return feature === 'cache' ? isDurableCacheEnabled() : isDurableMetricsEnabled();
}

function normalizeCachedBody(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeCacheStatus(value: unknown): number {
  const status = Number(value);
  return Number.isFinite(status) && status >= 100 && status < 600 ? Math.floor(status) : 200;
}

export function getCompassAnswerDurableStoreStatus() {
  const unavailableUntil = durableStoreUnavailableUntil > Date.now()
    ? new Date(durableStoreUnavailableUntil).toISOString()
    : null;

  return {
    configured: hasCompassDurableStoreConfig(),
    cacheEnabled: isDurableCacheEnabled(),
    metricsEnabled: isDurableMetricsEnabled(),
    available: hasCompassDurableStoreConfig() && !isDurableStoreSuppressed(),
    timeoutMs: DURABLE_STORE_TIMEOUT_MS,
    unavailableUntil,
    lastError: durableStoreLastError,
  };
}

export async function readCompassAnswerDurableCache(
  cacheKey: string,
): Promise<CompassAnswerDurableCacheEntry | null> {
  if (!shouldUseDurableStore('cache')) return null;

  const supabase = createCompassServiceClient();
  const response = await withDurableStoreTimeout(
    supabase
      .from('answer_response_cache')
      .select('body,status,expires_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle(),
    'cache_read',
  );

  if (!response) return null;
  if (response.error) {
    if (response.error.code !== 'PGRST116') {
      markDurableStoreUnavailable(response.error, 'cache_read');
    }
    return null;
  }

  const row = response.data as Record<string, unknown> | null;
  const body = normalizeCachedBody(row?.body);
  if (!row || !body) return null;

  return {
    body,
    status: normalizeCacheStatus(row.status),
    expiresAt: String(row.expires_at || ''),
  };
}

export async function writeCompassAnswerDurableCache({
  cacheKey,
  body,
  status,
  expiresAt,
}: {
  cacheKey: string;
  body: Record<string, unknown>;
  status: number;
  expiresAt: Date;
}): Promise<boolean> {
  if (!shouldUseDurableStore('cache')) return false;

  const supabase = createCompassServiceClient();
  const response = await withDurableStoreTimeout(
    supabase
      .from('answer_response_cache')
      .upsert(
        {
          cache_key: cacheKey,
          body,
          status: normalizeCacheStatus(status),
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'cache_key' },
      ),
    'cache_write',
  );

  if (!response) return false;
  if (response.error) {
    markDurableStoreUnavailable(response.error, 'cache_write');
    return false;
  }
  return true;
}

export async function recordCompassAnswerDurableRuntimeEvent(
  event: CompassAnswerDurableRuntimeEvent,
): Promise<boolean> {
  if (!shouldUseDurableStore('metrics')) return false;

  const supabase = createCompassServiceClient();
  const response = await withDurableStoreTimeout(
    supabase
      .from('answer_runtime_events')
      .insert({
        event_type: 'request_completed',
        cache_status: event.cacheStatus,
        cache_key: event.cacheKey || null,
        processing_time_ms: event.processingTimeMs ?? null,
        retrieval_duration_ms: event.cacheStatus === 'HIT' ? null : event.retrievalDurationMs ?? null,
        answer_generation_duration_ms: event.cacheStatus === 'HIT' ? null : event.answerGenerationDurationMs ?? null,
        retrieval_timed_out: event.retrievalTimedOut === true,
        retrieval_channel_timed_out: event.retrievalChannelTimedOut === true,
        no_data_found: event.noDataFound === true,
        error_response: event.errorResponse === true,
        model: event.model || null,
        source_count: event.sourceCount ?? null,
        graph_like_source_count: event.graphLikeSourceCount ?? null,
        slowest_channel: event.slowestChannel || null,
        metadata: event.metadata || {},
      }),
    'metrics_write',
  );

  if (!response) return false;
  if (response.error) {
    markDurableStoreUnavailable(response.error, 'metrics_write');
    return false;
  }
  return true;
}

export async function readCompassAnswerDurableMetricsSnapshot(
  windowHours = 24,
): Promise<CompassAnswerDurableMetricsSnapshot> {
  if (!isDurableMetricsEnabled()) {
    return { status: 'disabled', reason: 'COMPASS_DURABLE_ANSWER_METRICS_ENABLED=false' };
  }
  if (!hasCompassDurableStoreConfig()) {
    return { status: 'unavailable', reason: 'Supabase service environment is not configured.' };
  }
  if (isDurableStoreSuppressed()) {
    return {
      status: 'unavailable',
      reason: 'Durable store is temporarily suppressed after a recent failure.',
    };
  }

  const safeWindowHours = Math.min(Math.max(Math.floor(windowHours), 1), 168);
  const since = new Date(Date.now() - safeWindowHours * 60 * 60 * 1000).toISOString();
  const supabase = createCompassServiceClient();
  const response = await withDurableStoreTimeout(
    supabase.rpc('get_answer_runtime_metrics', { p_since: since }),
    'metrics_read',
  );

  if (!response) {
    return { status: 'unavailable', reason: 'Durable metrics read timed out.' };
  }
  if (response.error) {
    markDurableStoreUnavailable(response.error, 'metrics_read');
    return { status: 'unavailable', reason: 'Durable metrics table or function is not readable.' };
  }

  const data = response.data;
  if (!data || typeof data !== 'object') {
    return { status: 'unavailable', reason: 'Durable metrics function returned an empty payload.' };
  }

  return data as CompassAnswerDurableMetricsSnapshot;
}
