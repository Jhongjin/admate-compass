-- Gate RAG-3E: full-content rehydration and embedding compatibility check.
-- Run in Admate-Vision SQL Editor only.
-- SELECT-only. Do not execute INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER.
--
-- Usage:
-- 1. Replace the manifest CTE with rows from
--    C:/Users/Administrator/Downloads/rag3d_selected_sample_manifest.csv.
-- 2. Keep the column names shown below.
-- 3. Execute the SELECT-only checks.
--
-- This file is a reproducible SQL shape. The local RAG-3E preview was generated
-- from the same manifest using read-only Supabase API queries.

with manifest as (
  -- Example row shape:
  -- select
  --   'KAKAO:review'::text as sample_bucket,
  --   'KAKAO'::text as source_vendor,
  --   '카카오 광고 심사 가이드'::text as canonical_title,
  --   '심사 가이드'::text as source_title,
  --   '...'::text as source_url,
  --   'doc_id'::text as source_document_id,
  --   'chunk_id'::text as source_chunk_id,
  --   'row_id'::text as source_row_id,
  --   'review|rights'::text as topic_labels,
  --   'kakao-review-standards'::text as fixture_matches,
  --   100::numeric as quality_score,
  --   1000::integer as manifest_content_length,
  --   1::integer as has_url,
  --   'preview'::text as content_preview,
  --   'fingerprint'::text as manifest_fingerprint
  select null::text as sample_bucket
  where false
),
rehydrated as (
  select
    m.*,
    c.id as matched_source_row_id,
    c.document_id,
    c.chunk_id,
    c.content as full_content,
    char_length(c.content) as full_content_length,
    md5(regexp_replace(coalesce(c.content, ''), '\s+', ' ', 'g')) as full_content_hash,
    c.embedding is not null as embedding_present,
    case when c.embedding is not null then vector_dims(c.embedding) else null end as embedding_dim,
    c.metadata as source_chunk_metadata,
    d.title as parent_title,
    coalesce(d.document_url, d.url, '') as parent_url,
    exists (
      select 1
      from compass.ollama_document_chunks o
      where o.document_id = c.document_id
         or o.chunk_id = c.chunk_id
         or md5(regexp_replace(coalesce(o.content, ''), '\s+', ' ', 'g')) = md5(regexp_replace(coalesce(c.content, ''), '\s+', ' ', 'g'))
    ) as overlaps_existing_ollama,
    (
      c.content ~* '(document\.queryselector|__next|webpack|function\(|var |const |window\.|cookie|로그인|회원가입|뒤로가기|breadcrumb|footer|header|이전 다음|was this helpful|last updated)'
    ) as noisy_pattern
  from manifest m
  left join compass.document_chunks c
    on c.id = m.source_row_id
    or (c.document_id = m.source_document_id and c.chunk_id = m.source_chunk_id)
  left join compass.documents d on d.id = c.document_id
),
summary as (
  select 'expected_rows' as check_name, count(*)::text as value from manifest
  union all
  select 'matched_rows', count(*) filter (where matched_source_row_id is not null)::text from rehydrated
  union all
  select 'full_content_present', count(*) filter (where nullif(full_content, '') is not null)::text from rehydrated
  union all
  select 'embedding_present', count(*) filter (where embedding_present)::text from rehydrated
  union all
  select 'embedding_dim_min_max', concat(min(embedding_dim), ',', max(embedding_dim)) from rehydrated where embedding_dim is not null
  union all
  select 'short_content_lt_80', count(*) filter (where full_content_length < 80)::text from rehydrated
  union all
  select 'long_content_gt_2400', count(*) filter (where full_content_length > 2400)::text from rehydrated
  union all
  select 'noisy_pattern_count', count(*) filter (where noisy_pattern)::text from rehydrated
  union all
  select 'existing_ollama_overlap', count(*) filter (where overlaps_existing_ollama)::text from rehydrated
)
select *
from summary
order by check_name;

-- Detail preview:
-- select
--   source_vendor,
--   sample_bucket,
--   source_title,
--   source_document_id,
--   source_chunk_id,
--   source_row_id,
--   full_content_length,
--   embedding_present,
--   embedding_dim,
--   overlaps_existing_ollama,
--   noisy_pattern,
--   left(full_content, 240) as full_content_preview
-- from rehydrated
-- order by source_vendor, quality_score desc;
