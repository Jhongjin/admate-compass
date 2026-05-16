-- AdMate Compass source proposal queue.
-- Scope: durable proposal queue only. This does not index documents,
-- write chunks, generate embeddings, or promote corpus data.
-- Human apply required in production SQL editor.

create schema if not exists compass;
create extension if not exists pgcrypto;

create table if not exists compass.source_proposal_runs (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'proposal-only'
    check (mode = 'proposal-only'),
  dry_run boolean not null default true
    check (dry_run = true),
  mutation_enabled boolean not null default false
    check (mutation_enabled = false),
  fetch_enabled boolean not null default false,
  requested_source_id text,
  max_sources integer,
  generated_by text not null default 'backend-agent'
    check (generated_by = 'backend-agent'),
  status text not null default 'completed'
    check (status = any (array['completed', 'failed'])),
  candidate_count integer not null default 0,
  safety_notes jsonb not null default '[]'::jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists compass.source_proposal_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references compass.source_proposal_runs(id) on delete set null,
  source_id text not null,
  vendor text not null check (vendor = any (array['META', 'KAKAO', 'NAVER', 'GOOGLE'])),
  label text not null,
  url text not null,
  host text not null,
  canonical_url text,
  title text,
  proposal_status text not null
    check (proposal_status = any (array['candidate_ready', 'fetch_disabled', 'fetch_failed', 'blocked'])),
  review_status text not null default 'pending'
    check (review_status = any (array['pending', 'rejected', 'expired'])),
  risk_level text not null
    check (risk_level = any (array['low', 'medium', 'high'])),
  headings jsonb not null default '[]'::jsonb,
  content_preview text,
  content_length integer,
  fetched_at timestamp with time zone,
  source_status text,
  reason text not null,
  would_fetch boolean not null default false,
  would_index boolean not null default false
    check (would_index = false),
  would_promote boolean not null default false
    check (would_promote = false),
  safety jsonb not null default '{}'::jsonb,
  raw_candidate jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists idx_compass_source_proposal_queue_source_id
on compass.source_proposal_queue(source_id);

create index if not exists idx_compass_source_proposal_queue_review_status
on compass.source_proposal_queue(review_status);

create index if not exists idx_compass_source_proposal_queue_created_at
on compass.source_proposal_queue(created_at desc);

create index if not exists idx_compass_source_proposal_queue_host
on compass.source_proposal_queue(host);

create or replace function compass.update_source_proposal_queue_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists update_source_proposal_queue_updated_at
on compass.source_proposal_queue;

create trigger update_source_proposal_queue_updated_at
before update on compass.source_proposal_queue
for each row
execute function compass.update_source_proposal_queue_updated_at();

grant usage on schema compass to service_role;
grant select, insert on compass.source_proposal_runs to service_role;
grant select, insert, update on compass.source_proposal_queue to service_role;
