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
  modelBreakdown?: CompassAnswerDurableMetricsBreakdownItem[];
  slowestChannelBreakdown?: CompassAnswerDurableChannelBreakdownItem[];
  fastAnswerFallbackBreakdown?: CompassAnswerDurableCountBreakdownItem[];
  reason?: string;
};

export type CompassAnswerDurableMetricsBreakdownItem = {
  key: string;
  count: number;
  hitCount: number;
  missCount: number;
  bypassCount: number;
  avgProcessingTimeMs: number | null;
  avgRetrievalDurationMs: number | null;
  avgAnswerGenerationDurationMs: number | null;
};

export type CompassAnswerDurableChannelBreakdownItem = {
  label: string;
  count: number;
  timedOutCount: number;
  failedCount: number;
  avgDurationMs: number | null;
};

export type CompassAnswerDurableCountBreakdownItem = {
  key: string;
  count: number;
};

export type CompassAnswerDurableMaintenanceResult = {
  status: 'ready' | 'disabled' | 'unavailable';
  cacheDeletedCount?: number;
  eventDeletedCount?: number;
  eventRetentionHours?: number;
  reason?: string;
};

type CompassAnswerDurableStoreArea =
  | 'cache_read'
  | 'cache_write'
  | 'metrics_write'
  | 'metrics_read'
  | 'maintenance';

function resolveDurableStoreTimeoutMs(
  envName: string,
  fallbackMs: number,
  maxMs: number,
) {
  const parsed = Number(
    process.env[envName]
    || process.env.COMPASS_DURABLE_ANSWER_STORE_TIMEOUT_MS
    || fallbackMs,
  );
  const timeoutMs = Number.isFinite(parsed) ? parsed : fallbackMs;
  return Math.min(Math.max(Math.floor(timeoutMs), 500), maxMs);
}

const DURABLE_STORE_TIMEOUTS_MS: Record<CompassAnswerDurableStoreArea, number> = {
  cache_read: resolveDurableStoreTimeoutMs(
    'COMPASS_DURABLE_ANSWER_STORE_CACHE_READ_TIMEOUT_MS',
    1500,
    5000,
  ),
  cache_write: resolveDurableStoreTimeoutMs(
    'COMPASS_DURABLE_ANSWER_STORE_CACHE_WRITE_TIMEOUT_MS',
    2000,
    7000,
  ),
  metrics_write: resolveDurableStoreTimeoutMs(
    'COMPASS_DURABLE_ANSWER_STORE_METRICS_WRITE_TIMEOUT_MS',
    2000,
    7000,
  ),
  metrics_read: resolveDurableStoreTimeoutMs(
    'COMPASS_DURABLE_ANSWER_STORE_METRICS_READ_TIMEOUT_MS',
    2000,
    7000,
  ),
  maintenance: resolveDurableStoreTimeoutMs(
    'COMPASS_DURABLE_ANSWER_STORE_MAINTENANCE_TIMEOUT_MS',
    3000,
    10000,
  ),
};
const DURABLE_STORE_TIMEOUT_MS = Math.max(...Object.values(DURABLE_STORE_TIMEOUTS_MS));
const DURABLE_STORE_SUPPRESSION_MS = Math.min(
  Math.max(Number(process.env.COMPASS_DURABLE_ANSWER_STORE_SUPPRESSION_MS || 60000), 5000),
  300000,
);
const DURABLE_METRICS_BREAKDOWN_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.COMPASS_DURABLE_ANSWER_METRICS_BREAKDOWN_TIMEOUT_MS || 900), 200),
  2500,
);

const durableStoreUnavailableUntilByArea: Partial<Record<CompassAnswerDurableStoreArea, number>> = {};
let durableStoreLastError: {
  area: CompassAnswerDurableStoreArea;
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

function isDurableStoreSuppressed(area: CompassAnswerDurableStoreArea) {
  return (durableStoreUnavailableUntilByArea[area] || 0) > Date.now();
}

function getDurableStoreSuppressedAreas() {
  const now = Date.now();
  return Object.entries(durableStoreUnavailableUntilByArea)
    .filter((entry): entry is [CompassAnswerDurableStoreArea, number] => (
      Number(entry[1]) > now
    ))
    .map(([area, unavailableUntil]) => ({
      area,
      unavailableUntil: new Date(unavailableUntil).toISOString(),
    }));
}

function toErrorMetadata(error: unknown, area: CompassAnswerDurableStoreArea) {
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return {
    area,
    at: new Date().toISOString(),
    name: String(candidate?.name || 'CompassDurableStoreError'),
    code: candidate?.code ? String(candidate.code) : undefined,
    message: candidate?.message ? String(candidate.message).slice(0, 180) : undefined,
  };
}

function markDurableStoreUnavailable(error: unknown, area: CompassAnswerDurableStoreArea) {
  durableStoreUnavailableUntilByArea[area] = Date.now() + DURABLE_STORE_SUPPRESSION_MS;
  durableStoreLastError = toErrorMetadata(error, area);
  console.warn('Compass durable answer store temporarily unavailable', {
    area: durableStoreLastError.area,
    name: durableStoreLastError.name,
    code: durableStoreLastError.code,
    timeoutMs: DURABLE_STORE_TIMEOUTS_MS[area],
    suppressedMs: DURABLE_STORE_SUPPRESSION_MS,
  });
}

async function withDurableStoreTimeout<T>(
  operation: PromiseLike<T>,
  area: CompassAnswerDurableStoreArea,
): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = DURABLE_STORE_TIMEOUTS_MS[area];
  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });
    const result = await Promise.race([Promise.resolve(operation), timeout]);
    if (result === null) {
      markDurableStoreUnavailable(new Error(`durable store operation timed out after ${timeoutMs}ms`), area);
    }
    return result;
  } catch (error) {
    markDurableStoreUnavailable(error, area);
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function withOptionalDurableStoreTimeout<T>(
  operation: PromiseLike<T>,
): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), DURABLE_METRICS_BREAKDOWN_TIMEOUT_MS);
    });
    return await Promise.race([Promise.resolve(operation), timeout]);
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function shouldUseDurableStore(
  feature: 'cache' | 'metrics',
  area: CompassAnswerDurableStoreArea,
) {
  if (!hasCompassDurableStoreConfig()) return false;
  if (isDurableStoreSuppressed(area)) return false;
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

function normalizeOptionalMetricNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveOptionalMetricAverage(total: number, count: number): number | null {
  return count > 0 ? Math.round(total / count) : null;
}

function resolveMaintenanceRetentionHours() {
  const configured = Number(process.env.COMPASS_DURABLE_ANSWER_METRICS_RETENTION_HOURS || 336);
  const retentionHours = Number.isFinite(configured) ? Math.floor(configured) : 336;
  return Math.min(Math.max(retentionHours, 24), 2160);
}

export function getCompassAnswerDurableStoreStatus() {
  const suppressedAreas = getDurableStoreSuppressedAreas();
  const unavailableUntil = suppressedAreas.reduce<string | null>((latest, entry) => (
    latest && latest > entry.unavailableUntil ? latest : entry.unavailableUntil
  ), null);
  const configured = hasCompassDurableStoreConfig();

  return {
    configured,
    cacheEnabled: isDurableCacheEnabled(),
    metricsEnabled: isDurableMetricsEnabled(),
    available: configured && suppressedAreas.length === 0,
    partiallyAvailable: configured
      && suppressedAreas.length > 0
      && suppressedAreas.length < Object.keys(DURABLE_STORE_TIMEOUTS_MS).length,
    timeoutMs: DURABLE_STORE_TIMEOUT_MS,
    timeoutsMs: DURABLE_STORE_TIMEOUTS_MS,
    unavailableUntil,
    suppressedAreas,
    lastError: durableStoreLastError,
  };
}

export async function readCompassAnswerDurableCache(
  cacheKey: string,
): Promise<CompassAnswerDurableCacheEntry | null> {
  if (!shouldUseDurableStore('cache', 'cache_read')) return null;

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
  if (!shouldUseDurableStore('cache', 'cache_write')) return false;

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
  if (!shouldUseDurableStore('metrics', 'metrics_write')) return false;

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
  if (isDurableStoreSuppressed('metrics_read')) {
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

  const snapshot = data as CompassAnswerDurableMetricsSnapshot;
  const breakdown = await readCompassAnswerDurableMetricsBreakdown(since);
  return {
    ...snapshot,
    ...breakdown,
  };
}

async function readCompassAnswerDurableMetricsBreakdown(
  since: string,
): Promise<Pick<
  CompassAnswerDurableMetricsSnapshot,
  'modelBreakdown' | 'slowestChannelBreakdown' | 'fastAnswerFallbackBreakdown'
>> {
  if (process.env.COMPASS_DURABLE_ANSWER_METRICS_BREAKDOWN_ENABLED === 'false') {
    return {};
  }
  if (isDurableStoreSuppressed('metrics_read')) return {};

  const limit = Math.min(
    Math.max(Number(process.env.COMPASS_DURABLE_ANSWER_METRICS_BREAKDOWN_LIMIT || 200), 25),
    500,
  );
  const supabase = createCompassServiceClient();
  const response = await withOptionalDurableStoreTimeout(
    supabase
      .from('answer_runtime_events')
      .select('cache_status,processing_time_ms,retrieval_duration_ms,answer_generation_duration_ms,model,slowest_channel,metadata')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit),
  );

  if (!response || response.error || !Array.isArray(response.data)) return {};
  return summarizeCompassAnswerDurableMetricsBreakdown(response.data as Record<string, unknown>[]);
}

function summarizeCompassAnswerDurableMetricsBreakdown(
  rows: Record<string, unknown>[],
): Pick<
  CompassAnswerDurableMetricsSnapshot,
  'modelBreakdown' | 'slowestChannelBreakdown' | 'fastAnswerFallbackBreakdown'
> {
  const modelStats = new Map<string, {
    count: number;
    hitCount: number;
    missCount: number;
    bypassCount: number;
    processingTotal: number;
    processingCount: number;
    retrievalTotal: number;
    retrievalCount: number;
    answerGenerationTotal: number;
    answerGenerationCount: number;
  }>();
  const channelStats = new Map<string, {
    count: number;
    timedOutCount: number;
    failedCount: number;
    durationTotal: number;
    durationCount: number;
  }>();
  const fastAnswerFallbackCounts = new Map<string, number>();

  rows.forEach((row) => {
    const cacheStatus = String(row.cache_status || '');
    const model = String(row.model || 'unknown');
    const modelEntry = modelStats.get(model) || {
      count: 0,
      hitCount: 0,
      missCount: 0,
      bypassCount: 0,
      processingTotal: 0,
      processingCount: 0,
      retrievalTotal: 0,
      retrievalCount: 0,
      answerGenerationTotal: 0,
      answerGenerationCount: 0,
    };
    modelEntry.count += 1;
    if (cacheStatus === 'HIT') modelEntry.hitCount += 1;
    if (cacheStatus === 'MISS') modelEntry.missCount += 1;
    if (cacheStatus === 'BYPASS') modelEntry.bypassCount += 1;

    const processingTimeMs = normalizeOptionalMetricNumber(row.processing_time_ms);
    const retrievalDurationMs = normalizeOptionalMetricNumber(row.retrieval_duration_ms);
    const answerGenerationDurationMs = normalizeOptionalMetricNumber(row.answer_generation_duration_ms);
    if (processingTimeMs !== null) {
      modelEntry.processingTotal += processingTimeMs;
      modelEntry.processingCount += 1;
    }
    if (retrievalDurationMs !== null && cacheStatus !== 'HIT') {
      modelEntry.retrievalTotal += retrievalDurationMs;
      modelEntry.retrievalCount += 1;
    }
    if (answerGenerationDurationMs !== null && cacheStatus !== 'HIT') {
      modelEntry.answerGenerationTotal += answerGenerationDurationMs;
      modelEntry.answerGenerationCount += 1;
    }
    modelStats.set(model, modelEntry);

    const slowestChannel = row.slowest_channel && typeof row.slowest_channel === 'object'
      ? row.slowest_channel as Record<string, unknown>
      : null;
    const label = String(slowestChannel?.label || '');
    if (label) {
      const channelEntry = channelStats.get(label) || {
        count: 0,
        timedOutCount: 0,
        failedCount: 0,
        durationTotal: 0,
        durationCount: 0,
      };
      channelEntry.count += 1;
      if (slowestChannel?.timedOut === true) channelEntry.timedOutCount += 1;
      if (slowestChannel?.failed === true) channelEntry.failedCount += 1;
      const durationMs = normalizeOptionalMetricNumber(slowestChannel?.durationMs);
      if (durationMs !== null) {
        channelEntry.durationTotal += durationMs;
        channelEntry.durationCount += 1;
      }
      channelStats.set(label, channelEntry);
    }

    const metadata = row.metadata && typeof row.metadata === 'object'
      ? row.metadata as Record<string, unknown>
      : {};
    const fastAnswerFallback = String(metadata.fastAnswerFallback || '');
    if (fastAnswerFallback) {
      fastAnswerFallbackCounts.set(
        fastAnswerFallback,
        (fastAnswerFallbackCounts.get(fastAnswerFallback) || 0) + 1,
      );
    }
  });

  return {
    modelBreakdown: Array.from(modelStats.entries())
      .map(([key, entry]) => ({
        key,
        count: entry.count,
        hitCount: entry.hitCount,
        missCount: entry.missCount,
        bypassCount: entry.bypassCount,
        avgProcessingTimeMs: resolveOptionalMetricAverage(entry.processingTotal, entry.processingCount),
        avgRetrievalDurationMs: resolveOptionalMetricAverage(entry.retrievalTotal, entry.retrievalCount),
        avgAnswerGenerationDurationMs: resolveOptionalMetricAverage(
          entry.answerGenerationTotal,
          entry.answerGenerationCount,
        ),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    slowestChannelBreakdown: Array.from(channelStats.entries())
      .map(([label, entry]) => ({
        label,
        count: entry.count,
        timedOutCount: entry.timedOutCount,
        failedCount: entry.failedCount,
        avgDurationMs: resolveOptionalMetricAverage(entry.durationTotal, entry.durationCount),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    fastAnswerFallbackBreakdown: Array.from(fastAnswerFallbackCounts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  };
}

export async function runCompassAnswerDurableMaintenance(): Promise<CompassAnswerDurableMaintenanceResult> {
  if (!isDurableCacheEnabled() && !isDurableMetricsEnabled()) {
    return {
      status: 'disabled',
      reason: 'Durable cache and metrics are disabled.',
    };
  }
  if (!hasCompassDurableStoreConfig()) {
    return {
      status: 'unavailable',
      reason: 'Supabase service environment is not configured.',
    };
  }
  if (isDurableStoreSuppressed('maintenance')) {
    return {
      status: 'unavailable',
      reason: 'Durable store maintenance is temporarily suppressed after a recent failure.',
    };
  }

  const supabase = createCompassServiceClient();
  let cacheDeletedCount = 0;
  let eventDeletedCount = 0;

  if (isDurableCacheEnabled()) {
    const cachePruneResponse = await withDurableStoreTimeout(
      supabase.rpc('prune_expired_answer_response_cache'),
      'maintenance',
    );

    if (!cachePruneResponse) {
      return {
        status: 'unavailable',
        reason: 'Durable cache prune timed out.',
      };
    }
    if (cachePruneResponse.error) {
      markDurableStoreUnavailable(cachePruneResponse.error, 'maintenance');
      return {
        status: 'unavailable',
        reason: 'Durable cache prune failed.',
      };
    }

    cacheDeletedCount = Number(cachePruneResponse.data || 0);
  }

  if (isDurableMetricsEnabled()) {
    const retentionHours = resolveMaintenanceRetentionHours();
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
    const eventPruneResponse = await withDurableStoreTimeout(
      supabase
        .from('answer_runtime_events')
        .delete({ count: 'exact' })
        .lt('created_at', cutoff),
      'maintenance',
    );

    if (!eventPruneResponse) {
      return {
        status: 'unavailable',
        cacheDeletedCount,
        eventRetentionHours: retentionHours,
        reason: 'Durable metrics prune timed out.',
      };
    }
    if (eventPruneResponse.error) {
      markDurableStoreUnavailable(eventPruneResponse.error, 'maintenance');
      return {
        status: 'unavailable',
        cacheDeletedCount,
        eventRetentionHours: retentionHours,
        reason: 'Durable metrics prune failed.',
      };
    }

    eventDeletedCount = Number(eventPruneResponse.count || 0);
    return {
      status: 'ready',
      cacheDeletedCount,
      eventDeletedCount,
      eventRetentionHours: retentionHours,
    };
  }

  return {
    status: 'ready',
    cacheDeletedCount,
    eventDeletedCount,
  };
}
