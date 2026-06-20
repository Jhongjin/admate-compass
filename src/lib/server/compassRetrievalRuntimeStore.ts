import { createCompassServiceClient } from '@/lib/supabase/compass';

export type CompassRetrievalCacheNamespace =
  | 'supabase_rows'
  | 'focused_product_graph_rpc';

export type CompassRetrievalDurableCacheEntry<TPayload> = {
  payload: TPayload;
  expiresAt: string;
  metadata?: Record<string, unknown>;
};

export type CompassRetrievalDurableCacheMetricsSnapshot = {
  status: 'ready' | 'disabled' | 'unavailable';
  activeEntryCount?: number;
  hitCount?: number;
  namespaceBreakdown?: Array<{
    namespace: string;
    activeEntryCount: number;
    hitCount: number;
  }>;
  reason?: string;
};

type CompassRetrievalDurableStoreArea =
  | 'cache_read'
  | 'cache_write'
  | 'metrics_read'
  | 'maintenance';

function resolveDurableRetrievalTimeoutMs(
  envName: string,
  fallbackMs: number,
  maxMs: number,
) {
  const parsed = Number(
    process.env[envName]
    || process.env.COMPASS_DURABLE_RETRIEVAL_CACHE_TIMEOUT_MS
    || fallbackMs,
  );
  const timeoutMs = Number.isFinite(parsed) ? parsed : fallbackMs;
  return Math.min(Math.max(Math.floor(timeoutMs), 300), maxMs);
}

const DURABLE_RETRIEVAL_TIMEOUTS_MS: Record<CompassRetrievalDurableStoreArea, number> = {
  cache_read: resolveDurableRetrievalTimeoutMs(
    'COMPASS_DURABLE_RETRIEVAL_CACHE_READ_TIMEOUT_MS',
    700,
    2500,
  ),
  cache_write: resolveDurableRetrievalTimeoutMs(
    'COMPASS_DURABLE_RETRIEVAL_CACHE_WRITE_TIMEOUT_MS',
    1200,
    4000,
  ),
  metrics_read: resolveDurableRetrievalTimeoutMs(
    'COMPASS_DURABLE_RETRIEVAL_CACHE_METRICS_READ_TIMEOUT_MS',
    1200,
    4000,
  ),
  maintenance: resolveDurableRetrievalTimeoutMs(
    'COMPASS_DURABLE_RETRIEVAL_CACHE_MAINTENANCE_TIMEOUT_MS',
    2000,
    7000,
  ),
};

const DURABLE_RETRIEVAL_SUPPRESSION_MS = Math.min(
  Math.max(Number(process.env.COMPASS_DURABLE_RETRIEVAL_CACHE_SUPPRESSION_MS || 60000), 5000),
  300000,
);

const durableRetrievalUnavailableUntilByArea: Partial<Record<CompassRetrievalDurableStoreArea, number>> = {};
let durableRetrievalLastError: {
  area: CompassRetrievalDurableStoreArea;
  at: string;
  name: string;
  code?: string;
  message?: string;
} | null = null;

function hasCompassDurableRetrievalStoreConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function isDurableRetrievalCacheEnabled() {
  return process.env.COMPASS_DURABLE_RETRIEVAL_CACHE_ENABLED !== 'false';
}

function isDurableRetrievalStoreSuppressed(area: CompassRetrievalDurableStoreArea) {
  return (durableRetrievalUnavailableUntilByArea[area] || 0) > Date.now();
}

function getDurableRetrievalSuppressedAreas() {
  const now = Date.now();
  return Object.entries(durableRetrievalUnavailableUntilByArea)
    .filter((entry): entry is [CompassRetrievalDurableStoreArea, number] => (
      Number(entry[1]) > now
    ))
    .map(([area, unavailableUntil]) => ({
      area,
      unavailableUntil: new Date(unavailableUntil).toISOString(),
    }));
}

function toErrorMetadata(error: unknown, area: CompassRetrievalDurableStoreArea) {
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  return {
    area,
    at: new Date().toISOString(),
    name: String(candidate?.name || 'CompassDurableRetrievalCacheError'),
    code: candidate?.code ? String(candidate.code) : undefined,
    message: candidate?.message ? String(candidate.message).slice(0, 180) : undefined,
  };
}

function markDurableRetrievalStoreUnavailable(error: unknown, area: CompassRetrievalDurableStoreArea) {
  durableRetrievalUnavailableUntilByArea[area] = Date.now() + DURABLE_RETRIEVAL_SUPPRESSION_MS;
  durableRetrievalLastError = toErrorMetadata(error, area);
  console.warn('Compass durable retrieval cache temporarily unavailable', {
    area: durableRetrievalLastError.area,
    name: durableRetrievalLastError.name,
    code: durableRetrievalLastError.code,
    timeoutMs: DURABLE_RETRIEVAL_TIMEOUTS_MS[area],
    suppressedMs: DURABLE_RETRIEVAL_SUPPRESSION_MS,
  });
}

async function withDurableRetrievalTimeout<T>(
  operation: PromiseLike<T>,
  area: CompassRetrievalDurableStoreArea,
): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = DURABLE_RETRIEVAL_TIMEOUTS_MS[area];
  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), timeoutMs);
    });
    const result = await Promise.race([Promise.resolve(operation), timeout]);
    if (result === null) {
      markDurableRetrievalStoreUnavailable(new Error(`durable retrieval cache operation timed out after ${timeoutMs}ms`), area);
    }
    return result;
  } catch (error) {
    markDurableRetrievalStoreUnavailable(error, area);
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function shouldUseDurableRetrievalCache(area: CompassRetrievalDurableStoreArea) {
  return hasCompassDurableRetrievalStoreConfig()
    && isDurableRetrievalCacheEnabled()
    && !isDurableRetrievalStoreSuppressed(area);
}

function normalizePayload<TPayload>(value: unknown): TPayload | null {
  if (value === null || typeof value === 'undefined') return null;
  return value as TPayload;
}

export function getCompassRetrievalDurableCacheStatus() {
  const suppressedAreas = getDurableRetrievalSuppressedAreas();
  const unavailableUntil = suppressedAreas.reduce<string | null>((latest, entry) => (
    latest && latest > entry.unavailableUntil ? latest : entry.unavailableUntil
  ), null);
  const configured = hasCompassDurableRetrievalStoreConfig();

  return {
    configured,
    enabled: isDurableRetrievalCacheEnabled(),
    available: configured && suppressedAreas.length === 0,
    partiallyAvailable: configured
      && suppressedAreas.length > 0
      && suppressedAreas.length < Object.keys(DURABLE_RETRIEVAL_TIMEOUTS_MS).length,
    timeoutsMs: DURABLE_RETRIEVAL_TIMEOUTS_MS,
    unavailableUntil,
    suppressedAreas,
    lastError: durableRetrievalLastError,
  };
}

export async function readCompassRetrievalDurableCache<TPayload>(
  namespace: CompassRetrievalCacheNamespace,
  cacheKey: string,
): Promise<CompassRetrievalDurableCacheEntry<TPayload> | null> {
  if (!shouldUseDurableRetrievalCache('cache_read')) return null;

  const supabase = createCompassServiceClient();
  const response = await withDurableRetrievalTimeout(
    supabase
      .from('retrieval_response_cache')
      .select('payload,expires_at,metadata')
      .eq('cache_namespace', namespace)
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle(),
    'cache_read',
  );

  if (!response) return null;
  if (response.error) {
    if (response.error.code !== 'PGRST116') {
      markDurableRetrievalStoreUnavailable(response.error, 'cache_read');
    }
    return null;
  }

  const row = response.data as Record<string, unknown> | null;
  const payload = normalizePayload<TPayload>(row?.payload);
  if (!row || payload === null) return null;

  return {
    payload,
    expiresAt: String(row.expires_at || ''),
    metadata: row.metadata && typeof row.metadata === 'object'
      ? row.metadata as Record<string, unknown>
      : {},
  };
}

export async function writeCompassRetrievalDurableCache<TPayload>({
  namespace,
  cacheKey,
  payload,
  expiresAt,
  metadata,
}: {
  namespace: CompassRetrievalCacheNamespace;
  cacheKey: string;
  payload: TPayload;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  if (!shouldUseDurableRetrievalCache('cache_write')) return false;

  const supabase = createCompassServiceClient();
  const response = await withDurableRetrievalTimeout(
    supabase
      .from('retrieval_response_cache')
      .upsert(
        {
          cache_namespace: namespace,
          cache_key: cacheKey,
          payload,
          expires_at: expiresAt.toISOString(),
          metadata: metadata || {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'cache_namespace,cache_key' },
      ),
    'cache_write',
  );

  if (!response) return false;
  if (response.error) {
    markDurableRetrievalStoreUnavailable(response.error, 'cache_write');
    return false;
  }
  return true;
}

export async function readCompassRetrievalDurableCacheMetricsSnapshot(): Promise<CompassRetrievalDurableCacheMetricsSnapshot> {
  if (!isDurableRetrievalCacheEnabled()) {
    return { status: 'disabled', reason: 'COMPASS_DURABLE_RETRIEVAL_CACHE_ENABLED=false' };
  }
  if (!hasCompassDurableRetrievalStoreConfig()) {
    return { status: 'unavailable', reason: 'Supabase service environment is not configured.' };
  }
  if (isDurableRetrievalStoreSuppressed('metrics_read')) {
    return {
      status: 'unavailable',
      reason: 'Durable retrieval cache is temporarily suppressed after a recent failure.',
    };
  }

  const supabase = createCompassServiceClient();
  const response = await withDurableRetrievalTimeout(
    supabase.rpc('get_retrieval_response_cache_metrics'),
    'metrics_read',
  );

  if (!response) {
    return { status: 'unavailable', reason: 'Durable retrieval cache metrics read timed out.' };
  }
  if (response.error) {
    markDurableRetrievalStoreUnavailable(response.error, 'metrics_read');
    return { status: 'unavailable', reason: 'Durable retrieval cache metrics are not readable.' };
  }

  const data = response.data;
  if (!data || typeof data !== 'object') {
    return { status: 'unavailable', reason: 'Durable retrieval cache metrics returned an empty payload.' };
  }

  return data as CompassRetrievalDurableCacheMetricsSnapshot;
}

export async function runCompassRetrievalDurableCacheMaintenance() {
  if (!shouldUseDurableRetrievalCache('maintenance')) {
    return { status: isDurableRetrievalCacheEnabled() ? 'unavailable' : 'disabled' };
  }

  const supabase = createCompassServiceClient();
  const response = await withDurableRetrievalTimeout(
    supabase.rpc('prune_expired_retrieval_response_cache'),
    'maintenance',
  );

  if (!response) return { status: 'unavailable' };
  if (response.error) {
    markDurableRetrievalStoreUnavailable(response.error, 'maintenance');
    return { status: 'unavailable' };
  }
  return {
    status: 'ready',
    cacheDeletedCount: Number(response.data || 0),
  };
}
