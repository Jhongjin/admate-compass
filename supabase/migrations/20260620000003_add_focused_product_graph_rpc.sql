-- Collapse focused single-vendor product overview graph retrieval into one DB call.
-- The application keeps the existing multi-query PostgREST path as a fallback.

CREATE INDEX IF NOT EXISTS evidence_assertions_verified_vendor_source_created_idx
  ON compass.evidence_assertions (vendor, source_kind, created_at DESC)
  WHERE evidence_decision = 'verified' AND review_status = 'approved';

CREATE OR REPLACE FUNCTION compass.search_focused_product_graph_assertions(
  p_vendors text[],
  p_source_kinds text[],
  p_graph_topics text[],
  p_claim_types text[],
  p_limit integer DEFAULT 48
)
RETURNS SETOF compass.evidence_assertions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = compass, public
AS $$
  WITH params AS (
    SELECT
      coalesce(p_vendors, ARRAY[]::text[]) AS vendors,
      coalesce(p_source_kinds, ARRAY[]::text[]) AS source_kinds,
      coalesce(p_graph_topics, ARRAY[]::text[]) AS graph_topics,
      coalesce(p_claim_types, ARRAY[]::text[]) AS claim_types,
      least(greatest(coalesce(p_limit, 48), 1), 120) AS row_limit
  )
  SELECT ea.*
    FROM compass.evidence_assertions ea
    CROSS JOIN params p
   WHERE ea.evidence_decision = 'verified'
     AND ea.review_status = 'approved'
     AND (cardinality(p.vendors) = 0 OR ea.vendor = ANY(p.vendors))
     AND (cardinality(p.source_kinds) = 0 OR ea.source_kind = ANY(p.source_kinds))
     AND (
       (cardinality(p.graph_topics) = 0 AND cardinality(p.claim_types) = 0)
       OR (
         cardinality(p.graph_topics) > 0
         AND (ea.metadata -> 'graphTopics') ?| p.graph_topics
       )
       OR (
         cardinality(p.claim_types) > 0
         AND ea.claim_type = ANY(p.claim_types)
       )
     )
   ORDER BY
     CASE
       WHEN cardinality(p.graph_topics) > 0
        AND (ea.metadata -> 'graphTopics') ?| p.graph_topics THEN 0
       ELSE 1
     END,
     CASE
       WHEN cardinality(p.claim_types) > 0
        AND ea.claim_type = ANY(p.claim_types) THEN 0
       ELSE 1
     END,
     ea.created_at DESC NULLS LAST,
     ea.id
   LIMIT (SELECT row_limit FROM params);
$$;

GRANT EXECUTE ON FUNCTION compass.search_focused_product_graph_assertions(text[], text[], text[], text[], integer)
  TO service_role;
