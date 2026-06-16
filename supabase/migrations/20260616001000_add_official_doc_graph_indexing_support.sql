-- Official guide Graph RAG support.
-- Vector chunks remain the primary exact evidence store; these assertion rows add
-- guide structure, claim type, and topic relations for official documents.

CREATE INDEX IF NOT EXISTS evidence_assertions_official_doc_active_idx
  ON compass.evidence_assertions (source_document_id, source_chunk_id, claim_type)
  WHERE source_kind = 'official_doc' AND review_status <> 'stale';

CREATE INDEX IF NOT EXISTS evidence_assertions_official_doc_vendor_claim_idx
  ON compass.evidence_assertions (vendor, claim_type, created_at DESC)
  WHERE source_kind = 'official_doc' AND evidence_decision = 'verified' AND review_status = 'approved';

CREATE INDEX IF NOT EXISTS evidence_assertions_metadata_graph_topics_idx
  ON compass.evidence_assertions USING gin ((metadata -> 'graphTopics'));

CREATE OR REPLACE FUNCTION compass.stale_official_doc_assertions(
  p_source_document_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected integer := 0;
BEGIN
  UPDATE compass.evidence_assertions
     SET review_status = 'stale',
         valid_to = now(),
         updated_at = now()
   WHERE source_kind = 'official_doc'
     AND source_document_id = p_source_document_id
     AND review_status <> 'stale';

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION compass.stale_official_doc_assertions(text) TO service_role;
