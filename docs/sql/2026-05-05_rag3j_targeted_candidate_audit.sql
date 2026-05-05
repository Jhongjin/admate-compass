-- Gate RAG-3J: targeted candidate audit for price/discount and gambling policy.
-- Run in Admate-Vision SQL Editor only.
-- SELECT-only. Do not execute INSERT/UPDATE/DELETE/TRUNCATE/DROP/ALTER.
--
-- Purpose:
-- - Find data-only candidates from compass.document_chunks for the two remaining
--   RAG-3H source-only failures:
--   1. kakao-price-discount
--   2. gambling-policy
-- - Verify content/title quality, existing ollama overlap, and embedding
--   compatibility before any future sample import.

with
base_chunks as (
  select
    c.id,
    c.document_id,
    c.chunk_id,
    c.content,
    c.metadata,
    c.embedding is not null as embedding_present,
    case when c.embedding is not null then vector_dims(c.embedding) else null end as embedding_dim,
    coalesce(nullif(c.metadata->>'title', ''), nullif(c.metadata->>'source', ''), d.title, '') as source_title,
    coalesce(nullif(c.metadata->>'source_url', ''), nullif(c.metadata->>'document_url', ''), d.document_url, d.url, '') as source_url,
    d.title as parent_title,
    d.document_url as parent_document_url,
    d.url as parent_url,
    lower(
      concat_ws(
        ' ',
        c.id::text,
        c.document_id::text,
        c.chunk_id::text,
        coalesce(c.metadata->>'title', ''),
        coalesce(c.metadata->>'source', ''),
        coalesce(d.title, ''),
        coalesce(d.document_url, ''),
        coalesce(d.url, ''),
        coalesce(c.content, ''),
        coalesce(c.metadata::text, '')
      )
    ) as haystack
  from compass.document_chunks c
  left join compass.documents d on d.id = c.document_id
  where c.content is not null
),
classified as (
  select
    *,
    case
      when haystack ~ '(kakao|카카오|카카오톡|톡채널|비즈보드|모먼트)' then 'KAKAO'
      when haystack ~ '(naver|네이버|쇼핑검색|파워링크|브랜드검색)' then 'NAVER'
      when haystack ~ '(google|구글|youtube|유튜브|gdn|google ads)' then 'GOOGLE'
      when haystack ~ '(meta|facebook|페이스북|instagram|인스타그램|reels|릴스)' then 'META'
      else 'UNKNOWN'
    end as source_vendor,
    case
      when haystack ~ '(가격|할인|할인율)' then 'price_discount'
      when haystack ~ '(도박|사행|사행성)' then 'gambling_policy'
      else null
    end as target_topic,
    array_remove(array[
      case when haystack ~ '(가격|할인|할인율)' then 'price' end,
      case when haystack ~ '(표시|소재|문구|광고)' then 'material_display' end,
      case when haystack ~ '(도박|사행|사행성)' then 'gambling' end,
      case when haystack ~ '(정책|운영정책|집행기준|심사 가이드|광고등록기준|가이드)' then 'policy_title' end,
      case when haystack ~ '(금지|제한|불가|허용)' then 'restriction' end
    ], null) as topic_labels
  from base_chunks
),
scored as (
  select
    *,
    char_length(content) as content_length,
    md5(regexp_replace(left(content, 1800), '\s+', ' ', 'g')) as content_fingerprint,
    case when source_url <> '' then 1 else 0 end as has_url,
    case
      when coalesce(source_title, '') ~ '(정책|운영정책|집행기준|심사 가이드|광고등록기준|가이드|클린센터)' then 1
      else 0
    end as title_policy_grade,
    case
      when content ~* '(document\.queryselector|__next|webpack|function\(|var |const |window\.|cookie|로그인|회원가입|뒤로가기|breadcrumb|footer|header|이전 다음|was this helpful|last updated)'
        then 1
      else 0
    end as noisy_pattern,
    case
      when target_topic = 'price_discount' then (
        20
        + case when haystack ~ '(가격)' then 14 else 0 end
        + case when haystack ~ '(할인|할인율)' then 14 else 0 end
        + case when haystack ~ '(표시|소재|문구)' then 10 else 0 end
        + case when coalesce(source_title, '') ~ '(정책|운영정책|집행기준|심사 가이드|광고등록기준|가이드)' then 16 else 0 end
        + case when source_vendor in ('KAKAO', 'NAVER', 'GOOGLE', 'META') then 8 else 0 end
        + case when source_url <> '' then 6 else 0 end
        + case when char_length(content) between 180 and 1800 then 10 else -10 end
      )
      when target_topic = 'gambling_policy' then (
        20
        + case when haystack ~ '(도박)' then 18 else 0 end
        + case when haystack ~ '(사행|사행성)' then 18 else 0 end
        + case when haystack ~ '(금지|제한|불가|허용)' then 10 else 0 end
        + case when coalesce(source_title, '') ~ '(정책|운영정책|집행기준|심사 가이드|광고등록기준|가이드|클린센터)' then 16 else 0 end
        + case when source_vendor in ('KAKAO', 'NAVER', 'GOOGLE', 'META') then 8 else 0 end
        + case when source_url <> '' then 6 else 0 end
        + case when char_length(content) between 180 and 1800 then 10 else -10 end
      )
      else 0
    end
    - case
        when content ~* '(document\.queryselector|__next|webpack|function\(|var |const |window\.|cookie|로그인|회원가입|뒤로가기|breadcrumb|footer|header|이전 다음|was this helpful|last updated)'
          then 50
        else 0
      end as quality_score
  from classified
  where target_topic is not null
),
overlap_checked as (
  select
    s.*,
    exists (
      select 1
      from compass.ollama_document_chunks o
      where o.document_id = s.document_id
         or o.chunk_id = s.chunk_id
         or md5(regexp_replace(left(coalesce(o.content, ''), 1800), '\s+', ' ', 'g')) = s.content_fingerprint
    ) as overlaps_existing_ollama
  from scored s
),
eligible as (
  select *
  from overlap_checked
  where noisy_pattern = 0
    and content_length between 120 and 2200
    and embedding_present
    and embedding_dim = 1024
    and quality_score >= 70
),
deduped as (
  select *
  from (
    select
      *,
      row_number() over (
        partition by target_topic, source_vendor, content_fingerprint
        order by overlaps_existing_ollama asc, title_policy_grade desc, quality_score desc, has_url desc, content_length desc
      ) as fingerprint_rank,
      row_number() over (
        partition by target_topic, source_vendor, document_id, chunk_id
        order by overlaps_existing_ollama asc, title_policy_grade desc, quality_score desc
      ) as chunk_rank
    from eligible
  ) ranked
  where fingerprint_rank = 1
    and chunk_rank = 1
),
ranked as (
  select
    *,
    row_number() over (
      partition by target_topic
      order by
        overlaps_existing_ollama asc,
        title_policy_grade desc,
        case source_vendor
          when 'KAKAO' then 1
          when 'NAVER' then 2
          when 'META' then 3
          when 'GOOGLE' then 4
          else 9
        end,
        quality_score desc,
        has_url desc,
        content_length desc
    ) as topic_rank,
    row_number() over (
      partition by target_topic, source_vendor
      order by overlaps_existing_ollama asc, title_policy_grade desc, quality_score desc, has_url desc, content_length desc
    ) as vendor_topic_rank
  from deduped
),
selected as (
  select *
  from ranked
  where topic_rank <= 20
     or vendor_topic_rank <= 5
)
select
  target_topic,
  source_vendor,
  case
    when source_vendor = 'KAKAO' then '카카오 광고 심사 가이드'
    when source_vendor = 'NAVER' then '네이버 광고 가이드'
    when source_vendor = 'GOOGLE' then 'Google Ads 가이드'
    when source_vendor = 'META' then 'Meta 광고 정책'
    else source_title
  end as canonical_title,
  source_title,
  source_url,
  document_id as source_document_id,
  chunk_id as source_chunk_id,
  id as source_row_id,
  topic_labels,
  quality_score,
  title_policy_grade,
  content_length,
  embedding_present,
  embedding_dim,
  overlaps_existing_ollama,
  noisy_pattern,
  left(content, 700) as content_preview
from selected
order by target_topic, topic_rank, vendor_topic_rank, quality_score desc;
