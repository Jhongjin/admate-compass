-- Compass shared retrieval cache for DB/RPC retrieval rows.
-- Answer response cache remains separate so answer cache metrics stay clean.

CREATE SCHEMA IF NOT EXISTS compass;

CREATE TABLE IF NOT EXISTS compass.retrieval_response_cache (
  cache_namespace text NOT NULL,
  cache_key text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  hit_count bigint NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cache_namespace, cache_key)
);

CREATE INDEX IF NOT EXISTS retrieval_response_cache_expires_at_idx
  ON compass.retrieval_response_cache (expires_at);

CREATE INDEX IF NOT EXISTS retrieval_response_cache_namespace_expires_at_idx
  ON compass.retrieval_response_cache (cache_namespace, expires_at);

ALTER TABLE compass.retrieval_response_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage retrieval response cache" ON compass.retrieval_response_cache;
CREATE POLICY "Service role can manage retrieval response cache"
  ON compass.retrieval_response_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION compass.touch_retrieval_response_cache_hit(
  p_cache_namespace text,
  p_cache_key text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = compass, public
AS $$
  UPDATE compass.retrieval_response_cache
     SET hit_count = hit_count + 1,
         last_hit_at = now(),
         updated_at = now()
   WHERE cache_namespace = p_cache_namespace
     AND cache_key = p_cache_key;
$$;

CREATE OR REPLACE FUNCTION compass.prune_expired_retrieval_response_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = compass, public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  DELETE FROM compass.retrieval_response_cache
   WHERE expires_at <= now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION compass.get_retrieval_response_cache_metrics()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = compass, public
AS $$
  WITH active AS (
    SELECT *
      FROM compass.retrieval_response_cache
     WHERE expires_at > now()
  ),
  aggregate AS (
    SELECT
      count(*)::integer AS active_entry_count,
      coalesce(sum(hit_count), 0)::bigint AS hit_count
    FROM active
  ),
  namespace_breakdown AS (
    SELECT
      cache_namespace,
      count(*)::integer AS active_entry_count,
      coalesce(sum(hit_count), 0)::bigint AS hit_count
    FROM active
    GROUP BY cache_namespace
  ),
  namespace_json AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'namespace', cache_namespace,
          'activeEntryCount', active_entry_count,
          'hitCount', hit_count
        )
        ORDER BY active_entry_count DESC, cache_namespace
      ),
      '[]'::jsonb
    ) AS items
    FROM namespace_breakdown
  )
  SELECT jsonb_build_object(
    'status', 'ready',
    'activeEntryCount', aggregate.active_entry_count,
    'hitCount', aggregate.hit_count,
    'namespaceBreakdown', namespace_json.items
  )
  FROM aggregate
  CROSS JOIN namespace_json;
$$;

GRANT USAGE ON SCHEMA compass TO anon, authenticated, service_role;
GRANT ALL ON TABLE compass.retrieval_response_cache TO service_role;
REVOKE ALL ON FUNCTION compass.touch_retrieval_response_cache_hit(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION compass.prune_expired_retrieval_response_cache() FROM PUBLIC;
REVOKE ALL ON FUNCTION compass.get_retrieval_response_cache_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compass.touch_retrieval_response_cache_hit(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION compass.prune_expired_retrieval_response_cache() TO service_role;
GRANT EXECUTE ON FUNCTION compass.get_retrieval_response_cache_metrics() TO service_role;
