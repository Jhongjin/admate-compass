-- Rollback for Compass source proposal queue.
-- Scope is limited to source proposal queue tables/functions.
-- Human apply required in production SQL editor.

drop table if exists compass.source_proposal_queue;
drop table if exists compass.source_proposal_runs;
drop function if exists compass.update_source_proposal_queue_updated_at();
