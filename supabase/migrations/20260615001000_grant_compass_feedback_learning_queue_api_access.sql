-- Expose Compass feedback/history tables safely to Supabase PostgREST roles.
-- This SQL handles grants only. The Supabase API "Exposed schemas" setting
-- must also include `compass` for REST access to compass.* tables.

CREATE SCHEMA IF NOT EXISTS compass;

GRANT USAGE ON SCHEMA compass TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE compass.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE compass.feedback TO authenticated;
GRANT SELECT ON TABLE compass.learning_feedback TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA compass TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA compass TO service_role;
GRANT USAGE, SELECT ON SEQUENCE compass.feedback_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE compass.learning_feedback_id_seq TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA compass
  GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA compass
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
