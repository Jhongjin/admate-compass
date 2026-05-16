-- Read-only verification for Compass source proposal queue.

select
  table_schema,
  table_name
from information_schema.tables
where table_schema = 'compass'
  and table_name in (
    'source_proposal_runs',
    'source_proposal_queue'
  )
order by table_name;

select
  conname,
  pg_get_constraintdef(c.oid) as constraint_def
from pg_constraint c
join pg_class rel on rel.oid = c.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'compass'
  and rel.relname in (
    'source_proposal_runs',
    'source_proposal_queue'
  )
order by rel.relname, conname;
