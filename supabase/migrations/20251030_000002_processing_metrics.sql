-- processing_metrics: store per-job performance measurements for dashboarding
create table if not exists public.processing_metrics (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  bytes bigint,
  dl_ms integer,
  parse_ms integer,
  ocr_ms integer,
  emb_ms integer,
  total_ms integer,
  text_length integer,
  chunks integer,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists processing_metrics_created_at_idx on public.processing_metrics(created_at desc);
create index if not exists processing_metrics_job_id_idx on public.processing_metrics(job_id);
create index if not exists processing_metrics_document_id_idx on public.processing_metrics(document_id);

alter table public.processing_metrics enable row level security;

-- Allow authenticated users to read metrics (adjust as needed)
create policy if not exists processing_metrics_read on public.processing_metrics
  for select to authenticated using (true);

-- Only service role can insert/delete (APIs will run with service role if needed)
create policy if not exists processing_metrics_insert on public.processing_metrics
  for insert to service_role with check (true);

create policy if not exists processing_metrics_delete on public.processing_metrics
  for delete to service_role using (true);







