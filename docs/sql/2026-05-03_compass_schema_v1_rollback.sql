-- Rollback for AdMate Compass schema v1.
-- Scope is intentionally limited to the compass schema.
-- Review data/archive requirements before execution.

drop schema if exists compass cascade;
